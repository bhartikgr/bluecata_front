/**
 * WAVE 23 · ITEM 4 (REVIEW A MAJOR) — falsification harness for the CORRECTED
 * justification of the 0000 postcondition pin in scripts/migration_chain_check.mjs.
 *
 * A comment cannot be tested by reading it, so this harness tests the two
 * factual claims the new comment makes, executably, against the real files:
 *
 *   CLAIM 1  "0123 cannot transform a table 0000 already created."
 *            Apply 0000's platform_config DDL, then 0123's, to a bare SQLite
 *            DB. If 0123 could supersede 0000 the table would end up with the
 *            CURRENT shape. Falsified if it does — it must end up OLD.
 *
 *   CLAIM 2  "the inline baseline is what actually wins, not 0123."
 *            Apply the connection.ts inline baseline first, then 0000, then
 *            0123. The table must end up with the CURRENT shape, and 0000's
 *            CREATE TABLE must have been swallowed as already-exists.
 *
 *   CLAIM 3  "0123 uses CREATE TABLE IF NOT EXISTS" — asserted against the
 *            actual migration text, so the claim cannot rot silently.
 *
 *   CLAIM 4  the pin itself is still IN PLACE and still costs the exit code,
 *            and the comment no longer contains the retracted wording.
 *
 * Run: cd /home/user/workspace/work && npx tsx scripts/wave23/item4_platform_config_pin_harness.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

let asserts = 0;
const failures: string[] = [];
function ok(cond: boolean, label: string) {
  asserts++;
  if (!cond) failures.push(label);
}
function eq(actual: unknown, expected: unknown, label: string) {
  asserts++;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const repo = process.cwd();
const MIG = path.join(repo, "migrations");
const CHECKER = path.join(repo, "scripts", "migration_chain_check.mjs");

const src0000 = fs.readFileSync(path.join(MIG, "0000_numerous_roxanne_simpson.sql"), "utf8");
const src0123 = fs.readFileSync(path.join(MIG, "0123_wave0_platform_config.sql"), "utf8");
const checker = fs.readFileSync(CHECKER, "utf8");

/** Pull the single `CREATE TABLE ... platform_config ...(...)` statement out of a
 *  migration file. Deliberately literal: we execute the REAL bytes, not a copy. */
function platformConfigDdl(sql: string): string {
  // Terminates on a `)` at column 0 followed by an optional table-option
  // (0123 is `) STRICT;`) and a semicolon.
  const re = /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+[`"]?platform_config[`"]?\s*\([\s\S]*?\n\)[A-Za-z ]*;/i;
  const m = re.exec(sql);
  if (!m) throw new Error("platform_config CREATE TABLE not found");
  return m[0];
}
function columnsOf(db: any): string[] {
  return (db.prepare("PRAGMA table_info(platform_config)").all() as any[]).map((r) => r.name).sort();
}
function tmpDb(): { db: any; file: string } {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "w23-item4-")), "t.db");
  return { db: new Database(file), file };
}

const OLD_MARKERS = ["value", "prev_hash", "hash"];
const CURRENT_MARKERS = ["value_json", "prev_revision_hash", "revision_hash"];

async function main() {
  /* ── CLAIM 3 — 0123 really is CREATE TABLE IF NOT EXISTS ───────────────── */
  const ddl0000 = platformConfigDdl(src0000);
  const ddl0123 = platformConfigDdl(src0123);
  ok(
    /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/i.test(ddl0123),
    "CLAIM 3: 0123 declares platform_config with CREATE TABLE IF NOT EXISTS",
  );
  ok(
    CURRENT_MARKERS.every((c) => new RegExp(`\\b${c}\\b`).test(ddl0123)),
    "CLAIM 3: 0123 declares the CURRENT column shape",
  );
  ok(
    OLD_MARKERS.every((c) => new RegExp(`\\b${c}\\b`).test(ddl0000)),
    "CLAIM 3: 0000 declares the OLD column shape",
  );

  /* ── CLAIM 1 — 0000 then 0123 on a BARE chain keeps the OLD shape ──────── */
  {
    const { db } = tmpDb();
    db.exec(ddl0000);
    // Must be a no-op. Guarded so a mutated/edited 0123 surfaces as a FAILING
    // ASSERTION rather than an uncaught crash the mutation runner would read
    // as a harness bug.
    let err0123: string | null = null;
    try {
      db.exec(ddl0123);
    } catch (e: any) {
      err0123 = e?.message ?? String(e);
    }
    ok(err0123 === null, `CLAIM 1: 0123 must apply as a silent no-op over 0000 (got: ${err0123})`);
    const cols = columnsOf(db);
    ok(cols.includes("value"), "CLAIM 1: bare chain retains 0000's `value` column");
    ok(cols.includes("prev_hash"), "CLAIM 1: bare chain retains 0000's `prev_hash`");
    ok(
      !cols.includes("value_json"),
      `CLAIM 1: 0123 did NOT supersede 0000 — value_json is absent (cols: ${cols.join(",")})`,
    );
    ok(!cols.includes("revision_hash"), "CLAIM 1: revision_hash is absent on a bare chain");
    db.close();
  }

  /* ── CLAIM 2 — the INLINE BASELINE, applied first, is what wins ────────── */
  {
    const { db } = tmpDb();
    const conn: any = await import("../../server/db/connection.ts");
    ok(
      typeof conn.applyInlineMigrationsForFreshDb === "function",
      "CLAIM 2: connection.ts exposes applyInlineMigrationsForFreshDb",
    );
    conn.applyInlineMigrationsForFreshDb(db);
    const afterBaseline = columnsOf(db);
    ok(
      afterBaseline.includes("value_json"),
      `CLAIM 2: the inline baseline alone already declares the CURRENT shape (cols: ${afterBaseline.join(",")})`,
    );

    // Now 0000 runs on top. Its CREATE TABLE must be swallowed as already-exists.
    let swallowed = false;
    try {
      db.exec(ddl0000);
    } catch (e: any) {
      swallowed = /already exists/i.test(e?.message ?? "");
      ok(swallowed, `CLAIM 2: 0000's CREATE TABLE fails only as "already exists" (got: ${e?.message})`);
    }
    ok(swallowed, "CLAIM 2: 0000's CREATE TABLE was swallowed, not applied");
    let err0123b: string | null = null;
    try {
      db.exec(ddl0123); // also a no-op
    } catch (e: any) {
      err0123b = e?.message ?? String(e);
    }
    ok(err0123b === null, `CLAIM 2: 0123 must apply as a silent no-op over the baseline (got: ${err0123b})`);
    const cols = columnsOf(db);
    ok(cols.includes("value_json"), "CLAIM 2: with the baseline, the CURRENT shape survives");
    ok(!cols.includes("prev_hash"), "CLAIM 2: the retired 0000 columns are absent");
    eq(
      columnsOf(db).join(","),
      afterBaseline.join(","),
      "CLAIM 2: neither 0000 nor 0123 changed the baseline's shape",
    );
    db.close();
  }

  /* ── CLAIM 4 — the pin is still in place and the retraction is recorded ── */
  ok(
    /const PRE_EXISTING_POSTCONDITION = new Set\(\["0000"\]\);/.test(checker),
    "CLAIM 4: the 0000 postcondition pin is still declared",
  );
  ok(
    /THIS JUSTIFICATION IS A CORRECTION/.test(checker),
    "CLAIM 4: the comment states that the justification was corrected",
  );
  ok(
    /RESIDUAL RISK/.test(checker) && /server\/db\/migrate\.ts:575-579/.test(checker),
    "CLAIM 4: the residual risk on the no-baseline path is stated with its citation",
  );
  ok(
    /IF NOT EXISTS` cannot replace, alter, or transform/.test(checker),
    "CLAIM 4: the comment states WHY 0123 cannot supersede 0000",
  );
  // The retracted phrase must not survive as a live claim. It may appear only
  // inside the explicit "WHAT I ORIGINALLY WROTE" retraction line.
  const supersededLines = checker
    .split("\n")
    .filter((l) => /superseded by 0123/i.test(l));
  eq(
    supersededLines.map((l) => /WHAT I ORIGINALLY WROTE/.test(l)),
    supersededLines.map(() => true),
    'CLAIM 4: "superseded by 0123" survives only as a labelled retraction',
  );
  ok(supersededLines.length === 1, "CLAIM 4: the retracted phrase appears exactly once");

  if (failures.length > 0) {
    console.error(`FAIL item4_platform_config_pin_harness: ${failures.length}/${asserts} asserts failed`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`PASS item4_platform_config_pin_harness: ${asserts} asserts, 0 failures`);
  process.exit(0);
}

main().catch((e) => {
  console.error("HARNESS ERROR", e);
  process.exit(1);
});
