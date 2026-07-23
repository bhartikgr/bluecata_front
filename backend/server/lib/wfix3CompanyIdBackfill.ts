/**
 * W-FIX3 Bug#4 — reversible, guarded, idempotent backfill of NULL `company_id`
 * on existing `round_invitations` rows.
 *
 * ROOT CAUSE: invitation rows created before the W-FIX2 F1 write-path backfill
 * persisted `company_id = NULL`. A null companyId strips the invited investor of
 * every company-scoped capability (empty `investorVisibleCompanyIds` →
 * /securities 403, /dataroom 404) because the entitlement builder drops
 * null-companyId invitations. The write path (createInvitation) and read paths
 * (LIST F1b, userContext Option B) are fixed forward; this module repairs rows
 * already saved by the buggy path.
 *
 * PROPERTIES (owner decision 2026-07-21):
 *   - GUARDED   — only touches rows whose `company_id IS NULL`/'' AND whose round
 *                 resolves to a non-null companyId. Rows whose round is missing
 *                 or whose round.companyId is also null are SKIPPED and logged
 *                 (never guessed, never emptied).
 *   - REVERSIBLE— `revertWfix3CompanyIdBackfill(result)` restores NULL for
 *                 EXACTLY the rows/values the up-run changed, and only if the
 *                 current value still equals the recorded `after` (a manual edit
 *                 after migration is never clobbered).
 *   - LOGGED    — every before→after is captured in the returned result and
 *                 (when `artifactDir` is supplied) written as three artifacts.
 *   - IDEMPOTENT/LIVE-SAFE — a second up-run finds no null rows (already
 *                 backfilled) and changes nothing. Never overwrites a non-null
 *                 companyId.
 *
 * SACRED COMPLIANCE: writes ONLY to the `round_invitations` table via rawDb —
 * no import of any sacred store, no touch of the cap-table ledger, currency- and
 * tenant-agnostic (companyId is copied verbatim from the round).
 */
import fs from "fs";
import path from "path";
import { rawDb } from "../db/connection";
import { getRoundById } from "../roundsStore";
import { log } from "./logger";

export interface CompanyIdBackfillChange {
  table: "round_invitations";
  rowId: string;
  roundId: string;
  field: "company_id";
  before: null;
  after: string;
}

export interface CompanyIdBackfillResult {
  changedInvitationIds: string[];
  changes: CompanyIdBackfillChange[];
  scanned: number;
  skipped: number;
}

export interface CompanyIdBackfillOptions {
  /** When set, write the three artifacts here. */
  artifactDir?: string;
}

/** A stored company_id is "missing" when it is null or an empty string. */
function isMissing(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/**
 * UP — backfill NULL company_id from the invitation's round.
 */
export function backfillWfix3CompanyId(
  opts: CompanyIdBackfillOptions = {},
): CompanyIdBackfillResult {
  const changes: CompanyIdBackfillChange[] = [];
  const changedInvitationIds: string[] = [];
  let scanned = 0;
  let skipped = 0;
  let db: any;
  try {
    db = rawDb();
  } catch {
    return { changedInvitationIds, changes, scanned, skipped };
  }

  let rows: any[] = [];
  try {
    rows = db
      .prepare(
        `SELECT id, round_id, company_id
           FROM round_invitations
          WHERE company_id IS NULL OR company_id = ''`,
      )
      .all() as any[];
  } catch (err) {
    log.warn?.("[wfix3CompanyId] scan failed:", (err as Error).message);
    return { changedInvitationIds, changes, scanned, skipped };
  }

  for (const row of rows) {
    scanned++;
    if (!isMissing(row.company_id)) {
      // Defensive: the WHERE already excludes these, but never overwrite a
      // non-null value.
      skipped++;
      continue;
    }
    const roundId = row.round_id as string;
    const derived = roundId ? getRoundById(roundId)?.companyId ?? null : null;
    if (!derived) {
      // Round missing, or round.companyId is itself null — cannot resolve a
      // trustworthy companyId. SKIP (never guess).
      log.info?.(
        `[wfix3CompanyId] skip invitation ${row.id}: round ${roundId} has no resolvable companyId`,
      );
      skipped++;
      continue;
    }
    try {
      db.prepare(
        `UPDATE round_invitations SET company_id = ?
          WHERE id = ? AND (company_id IS NULL OR company_id = '')`,
      ).run(derived, row.id);
    } catch (err) {
      log.warn?.(
        "[wfix3CompanyId] up failed for invitation",
        row.id,
        (err as Error).message,
      );
      skipped++;
      continue;
    }
    log.info?.(
      `[wfix3CompanyId] round_invitations.company_id ${row.id}: null → ${derived} (round ${roundId})`,
    );
    changes.push({
      table: "round_invitations",
      rowId: row.id,
      roundId,
      field: "company_id",
      before: null,
      after: derived,
    });
    changedInvitationIds.push(row.id);
  }

  log.info?.(
    `[wfix3CompanyId] up: backfilled ${changedInvitationIds.length} invitation(s); scanned ${scanned}, skipped ${skipped}`,
  );

  const result: CompanyIdBackfillResult = {
    changedInvitationIds,
    changes,
    scanned,
    skipped,
  };
  if (opts.artifactDir) {
    try {
      emitArtifacts(opts.artifactDir, result);
    } catch (err) {
      log.warn?.("[wfix3CompanyId] artifact emission failed:", (err as Error).message);
    }
  }
  return result;
}

/**
 * DOWN — undo exactly the changes an up-run made, restoring NULL company_id.
 * Only reverts rows whose CURRENT value still equals the recorded `after` (so a
 * manual edit after migration is not clobbered).
 */
export function revertWfix3CompanyIdBackfill(result: CompanyIdBackfillResult): number {
  let reverted = 0;
  let db: any;
  try {
    db = rawDb();
  } catch {
    return 0;
  }
  for (const c of result.changes) {
    try {
      const cur = db
        .prepare(`SELECT company_id AS v FROM round_invitations WHERE id = ?`)
        .get(c.rowId) as { v?: string | null } | undefined;
      if (!cur || cur.v !== c.after) continue; // changed since — leave it alone
      db.prepare(`UPDATE round_invitations SET company_id = NULL WHERE id = ?`).run(c.rowId);
      reverted++;
    } catch (err) {
      log.warn?.("[wfix3CompanyId] down failed for", c.rowId, (err as Error).message);
    }
  }
  log.info?.(`[wfix3CompanyId] down: reverted ${reverted} row(s)`);
  return reverted;
}

/**
 * Emit the THREE state-change artifacts.
 *   1. wfix3_companyid_backfill_up.json   — full before→after change ledger (source of truth for reversal)
 *   2. wfix3_companyid_backfill_down.json — the inverse operation manifest (restore NULL)
 *   3. wfix3_companyid_corrected.md       — human-readable corrected-invitation list (for the fix report)
 */
export function emitArtifacts(dir: string, result: CompanyIdBackfillResult): void {
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString();

  const upPath = path.join(dir, "wfix3_companyid_backfill_up.json");
  fs.writeFileSync(
    upPath,
    JSON.stringify(
      { artifact: "wfix3_companyid_backfill_up", generatedAt: ts, ...result },
      null,
      2,
    ),
  );

  const downPath = path.join(dir, "wfix3_companyid_backfill_down.json");
  fs.writeFileSync(
    downPath,
    JSON.stringify(
      {
        artifact: "wfix3_companyid_backfill_down",
        generatedAt: ts,
        note: "Apply these to reverse the up-migration (restore NULL company_id).",
        operations: result.changes.map((c) => ({
          table: c.table,
          rowId: c.rowId,
          field: c.field,
          setTo: null,
          onlyIfCurrentEquals: c.after,
        })),
      },
      null,
      2,
    ),
  );

  const lines: string[] = [];
  lines.push("# W-FIX3 Bug#4 — corrected invitation records (reversible company_id backfill)");
  lines.push("");
  lines.push(`Generated: ${ts}`);
  lines.push("");
  lines.push(
    `Scanned **${result.scanned}** null-companyId invitation(s); ` +
      `backfilled **${result.changedInvitationIds.length}**; ` +
      `skipped **${result.skipped}** (round missing / round.companyId also null).`,
  );
  lines.push("");
  if (!result.changedInvitationIds.length) {
    lines.push("_No affected records found — nothing to correct._");
  } else {
    lines.push("| invitation id | round id | company_id (before → after) |");
    lines.push("| --- | --- | --- |");
    for (const c of result.changes) {
      lines.push(`| ${c.rowId} | ${c.roundId} | null → ${c.after} |`);
    }
    lines.push("");
  }
  fs.writeFileSync(path.join(dir, "wfix3_companyid_corrected.md"), lines.join("\n") + "\n");

  log.info?.(
    `[wfix3CompanyId] artifacts written to ${dir} (up.json, down.json, corrected.md)`,
  );
}
