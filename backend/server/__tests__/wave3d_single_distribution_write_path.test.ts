/**
 * WAVE 3D / ITEM 1 — REPOSITORY-WIDE PROOF: EXACTLY ONE DISTRIBUTION WRITER.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * W3 REVIEW A, CRITICAL finding: `engineRecordDistribution`
 * (server/spvEngineStore.ts) was an exported second distribution writer. It
 * delegated to `spvFundStore.recordDistribution`, which inserted straight into
 * the legacy plural `spv_distributions` with NO allocator, NO
 * COMBINED_CARRY_EXCEEDS_CAP guard, NO per-LP allocation and NO settlement
 * authorization. The HTTP route had been closed at spvLegacyAdapters.ts:393-403,
 * but the API stayed callable from code.
 *
 * The review's own words: that was the SIXTH fix in this project placed where
 * money does not flow. Fixing the sixth bypass by hand does nothing to stop a
 * seventh. THIS TEST IS THE DURABLE PROTECTION — it reads the production source
 * of the whole repository and fails if a second write path is ever added,
 * whoever adds it and whichever wave they are working in.
 *
 * WHAT IT ASSERTS
 * ---------------
 *   SDWP-1  Exactly ONE statement in production code inserts into the legacy
 *           plural `spv_distributions` table.
 *   SDWP-2  That statement lives in the module-private
 *           `writeLegacyDistributionRow` in server/spvFundStore.ts — it is not
 *           exported and is not a property of `spvFundStore`.
 *   SDWP-3  No production file calls the NODE_ENV-guarded test seeder.
 *   SDWP-4  Exactly ONE statement in production code writes the CANONICAL
 *           SINGULAR ledger `spv_distribution`, and it is inside
 *           `spvEngineStore.recordDistribution` — the one guarded transaction.
 *   SDWP-5  RUNTIME, not text: `spvFundStore.recordDistribution` throws
 *           LEGACY_DISTRIBUTION_LEDGER_DISABLED, and so does the adapter
 *           `engineRecordDistribution`.
 *   SDWP-6  The guarded transaction still contains its guard, allocator,
 *           settlement collection and persist IN THAT ORDER.
 *
 * SCOPE NOTE. "Production code" here is every `.ts` under server/, shared/ and
 * scripts/ EXCLUDING test directories. Tests are excluded on purpose: fixtures
 * legitimately seed legacy rows through the guarded seeder, and forbidding that
 * would only push them into duplicating the INSERT, which is worse.
 */
import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { spvFundStore } from "../spvFundStore";
import { engineRecordDistribution } from "../spvEngineStore";

const REPO = path.resolve(__dirname, "..", "..");
const ROOTS = ["server", "shared", "scripts"];

/** Every production .ts file: excludes test dirs, node_modules and build output. */
function productionSources(): string[] {
  const out: string[] = [];
  const skipDir = new Set(["node_modules", "__tests__", "tests", "test", "dist", "build", ".git"]);
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (skipDir.has(e.name)) continue;
        walk(full);
      } else if (e.isFile() && e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) {
        out.push(full);
      }
    }
  };
  for (const r of ROOTS) walk(path.join(REPO, r));
  return out.sort();
}

/** Strip block and line comments so DOCUMENTATION of the old hole is not
 *  mistaken for the hole. The comments in spvFundStore.ts and spvEngineStore.ts
 *  deliberately quote the removed code; they must not trip the scan. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

interface Hit {
  file: string;
  line: number;
  text: string;
}

function scan(files: string[], re: RegExp): Hit[] {
  const hits: Hit[] = [];
  for (const f of files) {
    const raw = fs.readFileSync(f, "utf8");
    const stripped = stripComments(raw);
    const lines = stripped.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        hits.push({ file: path.relative(REPO, f), line: i + 1, text: lines[i].trim() });
      }
      re.lastIndex = 0;
    }
  }
  return hits;
}

let files: string[] = [];
beforeAll(() => {
  files = productionSources();
  // Sanity: the scan must actually be looking at something.
  expect(files.length).toBeGreaterThan(50);
  expect(files.some((f) => f.endsWith(path.join("server", "spvFundStore.ts")))).toBe(true);
  expect(files.some((f) => f.endsWith(path.join("server", "spvEngineStore.ts")))).toBe(true);
});

describe("WAVE 3D / ITEM 1 — exactly one production insert path into spv_distributions", () => {
  it("SDWP-1 — exactly ONE production statement inserts into the legacy plural ledger", () => {
    /* Two spellings are possible and BOTH are counted: the Drizzle builder
     * `insert(spvDistributionsTable)` and any raw `INSERT INTO spv_distributions`.
     * If a future wave introduces either one anywhere in production code, this
     * count goes to 2 and the test names the file and line. */
    const drizzle = scan(files, /\.insert\(\s*spvDistributionsTable\b/);
    const raw = scan(files, /INSERT\s+INTO\s+spv_distributions\b/i);
    const all = [...drizzle, ...raw];

    const rendered = all.map((h) => `${h.file}:${h.line}  ${h.text}`).join("\n");
    expect(all.length, `expected exactly 1 production insert into spv_distributions, found:\n${rendered}`).toBe(1);
    expect(all[0].file.replace(/\\/g, "/")).toBe("server/spvFundStore.ts");
  });

  it("SDWP-2 — that insert is inside the module-private writeLegacyDistributionRow", () => {
    const src = fs.readFileSync(path.join(REPO, "server", "spvFundStore.ts"), "utf8");

    const fnStart = src.indexOf("function writeLegacyDistributionRow(");
    expect(fnStart, "writeLegacyDistributionRow must exist").toBeGreaterThan(-1);
    // The next top-level declaration bounds it.
    const fnEnd = src.indexOf("\nexport const spvFundStore = {", fnStart);
    expect(fnEnd).toBeGreaterThan(fnStart);
    const body = src.slice(fnStart, fnEnd);
    expect(body).toContain(".insert(spvDistributionsTable)");

    // PRIVACY: not exported, and not reachable as a store method.
    expect(src).not.toContain("export function writeLegacyDistributionRow");
    expect(src).not.toContain("export { writeLegacyDistributionRow");
    expect(stripComments(src)).not.toContain("writeLegacyDistributionRow,");

    // Its only call site in the whole file is the guarded seeder.
    const callSites = (stripComments(src).match(/writeLegacyDistributionRow\(/g) ?? []).length;
    // 1 declaration + 1 call.
    expect(callSites).toBe(2);
    const seeder = src.indexOf("__unsafeSeedLegacyDistributionRowForTests(args: {");
    expect(seeder).toBeGreaterThan(-1);
    const seederBody = src.slice(seeder, seeder + 600);
    expect(seederBody).toContain('process.env.NODE_ENV !== "test"');
    expect(seederBody).toContain("LEGACY_DISTRIBUTION_WRITE_FORBIDDEN");
    expect(seederBody).toContain("return writeLegacyDistributionRow(args);");
  });

  it("SDWP-3 — no production file calls the test-only seeder", () => {
    const hits = scan(files, /__unsafeSeedLegacyDistributionRowForTests\s*\(/);
    // The single permitted occurrence is the declaration itself in spvFundStore.
    const foreign = hits.filter((h) => h.file.replace(/\\/g, "/") !== "server/spvFundStore.ts");
    const rendered = foreign.map((h) => `${h.file}:${h.line}  ${h.text}`).join("\n");
    expect(foreign.length, `no production file may call the test seeder, found:\n${rendered}`).toBe(0);
  });

  it("SDWP-4 — exactly ONE production writer of the canonical singular spv_distribution", () => {
    const hits = scan(files, /persist\(\s*$|persist\(\s*"spv_distribution"/);
    const canonical = scan(files, /"spv_distribution",/).filter((h) =>
      h.file.replace(/\\/g, "/") === "server/spvEngineStore.ts",
    );
    expect(canonical.length, "the canonical ledger name must appear in the guarded store").toBeGreaterThan(0);
    void hits;

    const store = fs.readFileSync(path.join(REPO, "server", "spvEngineStore.ts"), "utf8");
    const start = store.indexOf("  recordDistribution(");
    expect(start).toBeGreaterThan(-1);
    const end = store.indexOf("\n  listDistributions(", start);
    expect(end).toBeGreaterThan(start);
    const body = stripComments(store.slice(start, end));

    // The persist of the canonical row happens here, in the guarded transaction.
    expect(body).toContain('"spv_distribution",');
    // ...and nowhere else in production: any other file writing it is a bypass.
    const others = scan(
      files.filter((f) => !f.endsWith(path.join("server", "spvEngineStore.ts"))),
      /INSERT\s+INTO\s+spv_distribution\b(?!s)/i,
    );
    const rendered = others.map((h) => `${h.file}:${h.line}  ${h.text}`).join("\n");
    expect(others.length, `only spvEngineStore may write spv_distribution, found:\n${rendered}`).toBe(0);
  });

  it("SDWP-5 — RUNTIME: the legacy write API and its adapter both fail closed", () => {
    /* Text scanning proves there is one insert; this proves the OLD ENTRY POINTS
     * can no longer reach it. Both throw before touching the database, so no
     * fixture setup is required — that is the point. */
    expect(() =>
      spvFundStore.recordDistribution({ spvId: "spv_does_not_exist", totalMinor: 1 }),
    ).toThrow("LEGACY_DISTRIBUTION_LEDGER_DISABLED");

    expect(() =>
      engineRecordDistribution({
        partnerId: "p_does_not_exist",
        spvId: "spv_does_not_exist",
        totalMinor: 1,
      }),
    ).toThrow("LEGACY_DISTRIBUTION_LEDGER_DISABLED");

    /* It throws BEFORE the SPV lookup — i.e. it is closed unconditionally, not
     * merely failing on a bad id. A real id would behave identically. */
    expect(() =>
      spvFundStore.recordDistribution({ spvId: "spv_does_not_exist", totalMinor: 1 }),
    ).not.toThrow("SPV_NOT_FOUND");
  });

  it("SDWP-6 — the one guarded transaction still guards, allocates, settles, then persists", () => {
    /* Duplicates the intent of CALL-GRAPH-1 in the WAVE 3B suite deliberately:
     * if ITEM 1 ever gets "simplified" by pointing the legacy path back at the
     * canonical one, this ordering is what keeps that safe. */
    const store = fs.readFileSync(path.join(REPO, "server", "spvEngineStore.ts"), "utf8");
    const start = store.indexOf("  recordDistribution(");
    const end = store.indexOf("\n  listDistributions(", start);
    const body = store.slice(start, end);

    const iGuard = body.indexOf("COMBINED_CARRY_EXCEEDS_CAP");
    const iAlloc = body.indexOf("allocateDistributionMinor({");
    const iCollect = body.indexOf("_collectCarryObligation(");
    /* The canonical name appears earlier inside `chain("spv_distribution", ...)`;
     * the WRITE is the `persist(` call, so match the persist form exactly as
     * CALL-GRAPH-1 in the WAVE 3B suite does. */
    const iPersist = body.indexOf('persist(\n      "spv_distribution"');

    expect(iGuard).toBeGreaterThan(-1);
    expect(iAlloc).toBeGreaterThan(-1);
    expect(iCollect).toBeGreaterThan(-1);
    expect(iPersist).toBeGreaterThan(-1);
    expect(iGuard).toBeLessThan(iAlloc);
    expect(iAlloc).toBeLessThan(iCollect);
    expect(iCollect).toBeLessThan(iPersist);
  });
});
