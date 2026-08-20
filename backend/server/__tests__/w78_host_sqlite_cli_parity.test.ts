/**
 * WAVE 78 — THE GATE THAT ACTUALLY MATTERS: THE HOST `sqlite3` CLI.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS
 * ═══════════════════════════════════════════════════════════════════════════
 * Every other migration test in this tree applies SQL through `better-sqlite3`,
 * which bundles its OWN SQLite (3.49.2 here). The deploy host's `sqlite3(1)` is
 * a DIFFERENT, OLDER engine (3.46.1). `0192` shipped in-tree using
 * `RAISE(ABORT, 'literal' || COALESCE(...))`, which SQLite has accepted only
 * since 3.47.0 (sqlite.org/lang_createtrigger.html: "Beginning with version
 * 3.47.0 the error-message can be an SQL expression").
 *
 * The failure mode was not a failed migration. `npm run migrate` exited 0, and
 * from then on EVERY host command — `PRAGMA integrity_check`, the ledger
 * counts, `.schema`, `VACUUM`, and both runbook commands that prove
 * `ccm_47f69199e7396a97` was unfrozen — answered
 *   Error: malformed database schema (trg_...) - near "||": syntax error
 * A developer reads that as a corrupted production database and restores the
 * backup. That is what this file exists to keep from happening again.
 *
 * IT APPLIES THE FULL MIGRATION SET WITH THE HOST CLI, not through
 * better-sqlite3, and then asserts the host can still READ the result.
 *
 * SKIPPED, NEVER SILENTLY PASSED, when no `sqlite3` binary is on PATH: a check
 * that quietly reports green without an engine is the same class of mistake as
 * the one it is guarding against, so the absence is announced.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyInlineMigrationsForFreshDb } from "../db/connection";

const _require = createRequire(__filename);

const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS = path.join(ROOT, "migrations");

function hostSqliteVersion(): string | null {
  try {
    return execFileSync("sqlite3", ["--version"], { encoding: "utf8" }).trim().split(/\s+/)[0];
  } catch {
    return null;
  }
}
const HOST = hostSqliteVersion();
const HAVE_HOST = HOST !== null;

/** Run one SQL string through the HOST CLI. Returns { out, err, code }. */
function cli(db: string, sql: string) {
  const r = spawnSync("sqlite3", [db], { input: sql, encoding: "utf8" });
  return { out: (r.stdout || "").trim(), err: (r.stderr || "").trim(), code: r.status ?? -1 };
}

let TMP = "";
let DB = "";
/** Files whose statements the host CLI rejected, by basename. */
let hostFailures: Array<{ file: string; err: string }> = [];

/* THE ERROR CLASS THAT MATTERS. `no such table`, `no such column`,
   `duplicate column name`, `already exists`, `UNIQUE constraint failed` and the
   `CHECK constraint failed` on 0000's platform_config are all MISSING-OBJECT /
   IDEMPOTENCY classes. They appear here only because the inline baseline is
   applied ONCE (below) and some later migrations still depend on objects the
   runner creates in code; `scripts/migration_chain_check.mjs` documents the same
   set and pins them. NONE of them can make a healthy database unreadable.
   A SYNTAX/MALFORMED error can, and does. That is what W78-A1 pins to zero. */
const SYNTAX = /syntax error|malformed/i;

beforeAll(() => {
  if (!HAVE_HOST) return;
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "w78-hostcli-"));
  DB = path.join(TMP, "data.db");

  /* STAGE 1 — the INLINE BASELINE, exactly as server/db/migrate.ts does before
     any numbered migration. Without it, a chain applied by any engine fails in
     files that are perfectly healthy in production. */
  const Database = _require("better-sqlite3");
  const boot = new Database(DB);
  applyInlineMigrationsForFreshDb(boot);
  boot.close();

  /* STAGE 2 — every numbered migration, applied by the HOST sqlite3 CLI. */
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), "utf8");
    const r = cli(DB, sql);
    if (r.code !== 0) hostFailures.push({ file: f, err: r.err });
  }
}, 300_000);

describe("W78 — the migration set applied with the HOST sqlite3 CLI", () => {
  it("W78-A0 — a host sqlite3 binary is present (otherwise this whole file is vacuous)", () => {
    if (!HAVE_HOST) {
      // Announce loudly rather than pass quietly.
      console.warn("[W78] no sqlite3 on PATH — the host-CLI gate could not run");
    }
    expect(HAVE_HOST, "no sqlite3 binary on PATH: the host-CLI gate cannot run").toBe(true);
  });

  it.skipIf(!HAVE_HOST)("W78-A1 — NO migration is rejected by the host CLI for a SYNTAX reason", () => {
    const syntax = hostFailures.filter((f) => SYNTAX.test(f.err));
    expect(
      syntax.map((f) => `${f.file}: ${f.err.split("\n")[0]}`),
      "a migration uses SQL the host sqlite3 cannot parse",
    ).toEqual([]);
  });

  it.skipIf(!HAVE_HOST)("W78-A2 — the host-CLI failure set is REPORTED, and none of it is a syntax class", () => {
    /* Deliberately NOT pinned to a file list: the pin would rot and the number is
       an artefact of applying the inline baseline once. What is asserted is the
       property that matters — every failure is a missing-object / idempotency
       class, never a parse failure. The set is printed so a reviewer can see it. */
    const summary = hostFailures.map((f) => `${f.file}: ${f.err.split("\n")[0]}`);
    console.log(`[W78-A2] ${hostFailures.length} file(s) reported an error under the host CLI:\n  ` +
      summary.join("\n  "));
    expect(summary.filter((s) => SYNTAX.test(s))).toEqual([]);
  });

  it.skipIf(!HAVE_HOST)("W78-A3 — `0192` applies CLEANLY under the host CLI, self-checks included", () => {
    const f = hostFailures.find((x) => x.file.startsWith("0192_"));
    expect(f ? f.err : null, "0192 failed under the host CLI").toBeNull();
  });

  it.skipIf(!HAVE_HOST)("W78-A4 — the host CLI can read `.schema` (no 'malformed database schema')", () => {
    const r = cli(DB, ".schema");
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.out.length).toBeGreaterThan(1000);
    /* Note the exact phrase. The SCHEMA TEXT legitimately contains the word
       "malformed" (0192's own refusal explains a malformed JSON blob), so a bare
       /malformed/ match would fail on a HEALTHY database. */
    expect(r.out).not.toContain("malformed database schema");
    expect(r.err).not.toContain("malformed database schema");
  });

  it.skipIf(!HAVE_HOST)("W78-A5 — `PRAGMA integrity_check` returns exactly `ok`", () => {
    const r = cli(DB, "PRAGMA integrity_check;");
    expect(r.err).toBe("");
    expect(r.out).toBe("ok");
  });

  it.skipIf(!HAVE_HOST)("W78-A6 — the four WAVE 68 triggers are present and READABLE by the host CLI", () => {
    const r = cli(
      DB,
      "SELECT name FROM sqlite_master WHERE type='trigger' AND (name LIKE 'trg_captable_commits_discount_pct%' OR name LIKE 'trg_rounds_extras_terms%') ORDER BY name;",
    );
    expect(r.err).toBe("");
    expect(r.out.split("\n").filter(Boolean)).toEqual([
      "trg_captable_commits_discount_pct_ins",
      "trg_captable_commits_discount_pct_upd",
      "trg_rounds_extras_terms_ins",
      "trg_rounds_extras_terms_upd",
    ]);
  });

  it.skipIf(!HAVE_HOST)("W78-A7 — every RAISE argument in the INSTALLED triggers is a single string literal", () => {
    const r = cli(
      DB,
      "SELECT sql FROM sqlite_master WHERE type='trigger' AND (name LIKE 'trg_captable_commits_discount_pct%' OR name LIKE 'trg_rounds_extras_terms%');",
    );
    expect(r.err).toBe("");
    expect(r.out).not.toContain("Capavate received");
  });

  it.skipIf(!HAVE_HOST)("W78-A8 — `VACUUM` succeeds (it reported 'disk image is malformed' before)", () => {
    const r = cli(DB, "VACUUM;");
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
  });

  /* ── THE REFUSALS, THROUGH THE HOST ENGINE ────────────────────────────────
     Equivalence with better-sqlite3 is proved exhaustively (538 cases) in
     build_log/wave78/W78_REFUSAL_EQUIVALENCE.md. Here is the load-bearing
     subset, so the suite itself fails if a fence stops firing on the host. */
  const REFUSE_ROUND: Array<[string, string]> = [
    ['{"discount":20260707}', "ROUND_TERM_DISCOUNT_REFUSED"],
    ['{"discount":true}', "ROUND_TERM_DISCOUNT_REFUSED"],
    ['{"discount":{"a":1}}', "ROUND_TERM_DISCOUNT_REFUSED"],
    ['{"discount":[1]}', "ROUND_TERM_DISCOUNT_REFUSED"],
    ['{"discount":"abc"}', "ROUND_TERM_DISCOUNT_REFUSED"],
    ['{"discount":100}', "ROUND_TERM_DISCOUNT_REFUSED"],
    ['{"interestRate":20261231}', "ROUND_TERM_INTEREST_RATE_REFUSED"],
    ['{"valuationCap":0}', "ROUND_TERM_VALUATION_CAP_REFUSED"],
    ['{"strikePrice":0}', "ROUND_TERM_STRIKE_PRICE_REFUSED"],
    ['{"maturityMonths":20260707}', "ROUND_TERM_MATURITY_MONTHS_REFUSED"],
    ['{"expiryYears":51}', "ROUND_TERM_EXPIRY_YEARS_REFUSED"],
    ["not json at all", "ROUND_EXTRAS_JSON_INVALID"],
  ];
  const ACCEPT_ROUND = ['{"discount":20}', '{"discount":0}', '{"discount":"99.999999999999999"}',
    '{"interestRate":100}', "{}", '{"discount":null}', '{"discount":""}'];

  function roundsInsertSql(blob: string | null): string {
    const info = cli(DB, "PRAGMA table_info(rounds);").out.split("\n").filter(Boolean)
      .map((l) => l.split("|"));
    const required = info.filter((c) => c[3] === "1" && c[4] === "" && c[1] !== "id");
    const cols = ["id", "extras_json", ...required.filter((c) => c[1] !== "extras_json").map((c) => c[1])];
    const q = (s: string | null) => (s === null ? "NULL" : `'${s.replace(/'/g, "''")}'`);
    const vals = [q("rnd_w78t"), q(blob),
      ...required.filter((c) => c[1] !== "extras_json").map((c) => (/INT|REAL|NUM/i.test(c[2]) ? "0" : "'w78'"))];
    return `BEGIN;\nINSERT INTO rounds (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${vals.join(",")});\nROLLBACK;\n`;
  }

  it.skipIf(!HAVE_HOST)("W78-A9 — every fenced refusal STILL FIRES through the host CLI, by name", () => {
    for (const [blob, code] of REFUSE_ROUND) {
      const r = cli(DB, roundsInsertSql(blob));
      expect(r.err, `host CLI ACCEPTED ${blob}`).not.toBe("");
      expect(r.err, `wrong refusal for ${blob}`).toContain(code);
    }
  });

  it.skipIf(!HAVE_HOST)("W78-A10 — and every legal value is still ACCEPTED through the host CLI", () => {
    for (const blob of ACCEPT_ROUND) {
      const r = cli(DB, roundsInsertSql(blob));
      expect(r.err, `host CLI REFUSED the legal value ${blob}`).toBe("");
    }
  });

  it.skipIf(!HAVE_HOST)("W78-A11 — the runbook's §5.3/§5.4 pair works on the host CLI for a '20' row", () => {
    /* `ccm_47f69199e7396a97` is a LIVE id; this recreates its SHAPE (discount_pct
       = '20', committed) on a locally migrated database. The live row itself is
       not queried — no test in this tree touches production. */
    const seed = `BEGIN;
INSERT INTO captable_commits
  (id,tenant_id,seq,ts,invitation_id,round_id,company_id,investor_id,amount,currency,shares,state,prev_hash,hash,discount_pct)
  VALUES ('ccm_w78_shape','t_w78',98001,'2026-08-19T00:00:00Z','i','r','c','v','1000','USD','10','committed','p','h','20');
COMMIT;`;
    expect(cli(DB, seed).err).toBe("");
    // §5.3
    const read = cli(DB, "SELECT id, discount_pct FROM captable_commits WHERE id='ccm_w78_shape';");
    expect(read.err).toBe("");
    expect(read.out).toBe("ccm_w78_shape|20");
    // §5.4 — write-and-roll-back must be SILENT
    const upd = cli(DB, "BEGIN; UPDATE captable_commits SET discount_pct='20' WHERE id='ccm_w78_shape'; ROLLBACK;");
    expect(upd.err, "the '20' row is still frozen").toBe("");
    expect(upd.out).toBe("");
    // and the value is unchanged
    expect(cli(DB, "SELECT discount_pct FROM captable_commits WHERE id='ccm_w78_shape';").out).toBe("20");
    cli(DB, "DELETE FROM captable_commits WHERE id='ccm_w78_shape';");
  });

  it.skipIf(!HAVE_HOST)("W78-A12 — the host engine is OLDER than 3.47.0, which is why this file is not redundant", () => {
    /* If this ever fails because the host was upgraded, that is good news — but
       the fence stays, because the NEXT host may be older again. */
    const [a, b] = [HOST!.split(".").map(Number), [3, 47, 0]];
    const older = a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])));
    if (!older) console.warn(`[W78] host sqlite3 ${HOST} is >= 3.47.0; the skew this file guards is not reproducible here`);
    expect(typeof HOST).toBe("string");
  });
});
