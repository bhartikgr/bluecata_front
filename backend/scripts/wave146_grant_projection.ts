/**
 * WAVE 146 · ITEM A · per-grant access projection (owner precondition, spec §A.4).
 *
 * Tightening a permission is the classic way to silently remove access somebody
 * depends on. The owner forbids silent drops, so before the tightening in
 * `server/lib/shareholderRegisterStore.ts` lands, this script names — per grant,
 * not as a count — exactly WHO would lose cap-table visibility.
 *
 * Both decisions are produced by calling `decideCapTableSinkAccess` ITSELF:
 * run this script against the BEFORE tree with `--label before`, then against
 * the AFTER tree with `--label after`, then `--merge` to join the two runs.
 *
 * Usage (never against the live db — always a copy):
 *   SQLITE_PATH=w146_scratch/dbcopy/data_ro.db npx tsx scripts/wave146_grant_projection.ts --label before --out w146_scratch/proj_before.tsv
 *   SQLITE_PATH=w146_scratch/dbcopy/data_ro.db npx tsx scripts/wave146_grant_projection.ts --label after  --out w146_scratch/proj_after.tsv
 *   npx tsx scripts/wave146_grant_projection.ts --merge w146_scratch/proj_before.tsv w146_scratch/proj_after.tsv --out build_log/batch2/A_grant_projection.tsv
 */
import * as fs from "fs";

const HEADER = [
  "grant_id",
  "company_id",
  "subject_kind",
  "subject_id",
  "resolved_user_ids",
  "decision_before",
  "decision_after",
].join("\t");

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? String(process.argv[i + 1]) : null;
}

function merge(beforePath: string, afterPath: string, out: string): void {
  const read = (p: string) =>
    fs
      .readFileSync(p, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0 && !l.startsWith("grant_id\t"));
  const decisionOf = (line: string) => line.split("\t")[5] ?? "";
  const before = read(beforePath);
  const after = read(afterPath);
  const afterByKey = new Map(after.map((l) => [l.split("\t").slice(0, 4).join("\t"), l]));
  const lines: string[] = [HEADER];
  let losses = 0;
  for (const b of before) {
    const cells = b.split("\t");
    const key = cells.slice(0, 4).join("\t");
    const a = afterByKey.get(key);
    const dBefore = decisionOf(b);
    const dAfter = a ? decisionOf(a) : "row_absent_after";
    if (dBefore === "allow" && dAfter !== "allow") losses += 1;
    lines.push([...cells.slice(0, 5), dBefore, dAfter].join("\t"));
  }
  lines.push(`# rows: ${before.length}`);
  lines.push(`# allow_to_refuse (access LOST): ${losses}`);
  fs.writeFileSync(out, lines.join("\n") + "\n");
  // eslint-disable-next-line no-console
  console.log(`merged ${before.length} rows; allow→refuse = ${losses}; wrote ${out}`);
}

async function project(label: string, out: string): Promise<void> {
  const { rawDb } = await import("../server/db/connection");
  const { decideCapTableSinkAccess } = await import("../server/lib/capTableSinkScope");

  let rows: Array<Record<string, any>> = [];
  let tableState = "present";
  try {
    rows = rawDb()
      .prepare(`SELECT * FROM captable_visibility_grants ORDER BY created_at ASC`)
      .all() as Array<Record<string, any>>;
  } catch (err) {
    tableState = `absent (${(err as Error).message})`;
  }

  const lines: string[] = [HEADER];
  for (const r of rows) {
    // The grant's subject_id is "their Capavate account"
    // (client/src/components/founder/ShareholderRegisterPanel.tsx, "Their Capavate account"),
    // so the resolved viewer for a grant IS that account id.
    const subjectId = String(r.subject_id ?? "");
    const ctx = {
      userId: subjectId,
      isAdmin: false,
      isAuthed: true,
      founder: { companies: [] },
      investor: { capTablePositions: [], invitedRounds: [] },
      collective: { status: "none", role: null, expiresAt: null },
    };
    const decision = decideCapTableSinkAccess(ctx as any, String(r.company_id ?? ""));
    lines.push(
      [
        String(r.id ?? ""),
        String(r.company_id ?? ""),
        r.subject_kind == null || String(r.subject_kind).trim() === ""
          ? "(NULL — mapGrant would default this to consortium_partner)"
          : String(r.subject_kind),
        subjectId,
        subjectId || "(none)",
        decision.outcome,
        "",
      ].join("\t"),
    );
  }
  lines.push(`# label: ${label}`);
  lines.push(`# sqlite_path: ${process.env.SQLITE_PATH ?? "(default)"}`);
  lines.push(`# captable_visibility_grants: ${tableState}`);
  lines.push(`# grant rows: ${rows.length}`);
  fs.writeFileSync(out, lines.join("\n") + "\n");
  // eslint-disable-next-line no-console
  console.log(`[${label}] grants=${rows.length} table=${tableState} -> ${out}`);
}

const mergeIdx = process.argv.indexOf("--merge");
const outPath = arg("--out") ?? "A_grant_projection.tsv";
if (mergeIdx >= 0) {
  merge(process.argv[mergeIdx + 1], process.argv[mergeIdx + 2], outPath);
} else {
  void project(arg("--label") ?? "unlabelled", outPath);
}
