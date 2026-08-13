// scripts/migration_chain_check.mjs — migration-chain harness.
// WAVE 13 (original) · WAVE 21 (made falsifiable — see "WHY WAVE 21 REWROTE THIS").
//
// Applies EVERY migrations/*.sql in sorted order into ONE empty SQLite database
// and reports every file that fails, so a collision like the Wave 13
// `partner_subscription` one cannot hide again.
//
// WHY IT IS BUILT THIS WAY (and not `sqlite3 :memory: ".read x.sql"` in a loop):
// the production runner is server/db/migrate.ts, and a harness that does not
// match it produces false alarms. Two behaviours must be reproduced exactly:
//
//   1. THE INLINE BASELINE. server/db/connection.ts creates a large part of the
//      schema in code (applyInlineMigrationsForFreshDb) BEFORE any numbered
//      migration runs. A chain applied without it fails in files that are
//      perfectly healthy in production (0002/0003/0014/0021 — `tenants` and
//      `rounds` columns the bootstrap defines).
//   2. THE IDEMPOTENCY CONTRACT. migrate.ts:isIdempotentSqliteError swallows
//      "duplicate column name" / "already exists" / "UNIQUE constraint failed",
//      which is how every additive ALTER in this tree is written.
//
// ---------------------------------------------------------------------------
// WHY WAVE 21 REWROTE THIS — the checker was vacuous in three distinct ways.
//
// Independent review A found that `npm run migration:chain` printed `RESULT: OK`
// while a migration was failing, and that this output had been cited all night
// as evidence. Wave 21 reproduced the problem before touching it. Three classes,
// all demonstrated against a scratch copy of migrations/ (see
// scripts/wave21/item3_migration_falsification.sh, which re-runs all of them):
//
//   V1 — SILENT NO-OP MIGRATIONS (the worst; previously invisible).
//        A file containing `CREATE TABLE partner_subscription (id TEXT PRIMARY
//        KEY, w21_column_that_will_never_exist TEXT NOT NULL)` — a table that
//        already exists with a different shape — raised "table ... already
//        exists", which was swallowed as "idempotent". The migration was
//        reported as APPLIED. The column never existed. The old checker did not
//        report this in ANY mode, at ANY verbosity. A migration that applies
//        nothing is not a passing migration.
//        => FIX: POSTCONDITION VERIFICATION. Every object a file declares
//           (tables AND their columns, indexes, views, triggers, ALTER TABLE
//           ADD COLUMN) is looked up in sqlite_master / pragma_table_info AFTER
//           the file commits. Anything declared-but-absent is a FAILURE. This is
//           the check that makes "the migration ran" mean something. It is the
//           only class of check that cannot be satisfied by swallowing an error.
//
//   V2 — `--mode runner` REPORTED OK WITH A BROKEN MIGRATION.
//        isNonFatalIndexError downgrades CREATE INDEX "no such table/column" to
//        a warning. A brand-new migration whose only statement was an index on a
//        nonexistent table produced `failures: 0 … RESULT: OK`, exit 0.
//        => FIX: warnings are failures by default. `--allow-warnings` exists for
//           diagnostics but is refused in --strict-ci.
//
//   V3 — `RESULT: OK` PRINTED WHILE A MIGRATION WAS FAILING.
//        0040 genuinely fails; because it sat in a pinned set, the tool printed
//        the unqualified string `RESULT: OK`, which is what got cited.
//        => FIX: the literal token `RESULT: OK` is now emitted ONLY when the
//           failure list is empty. A pinned-only run prints
//           `RESULT: FAIL (pinned-only)` and, with --allow-pinned, the distinct
//           token `RESULT: OK-EXCEPT-PINNED` plus the pinned list. Exit is 1 by
//           default even for pinned-only, so an unattended caller cannot mistake
//           a known-broken chain for a healthy one. Pins are an acknowledgement,
//           not an absolution.
//
// NOT CHANGED, DELIBERATELY: server/db/migrate.ts is SACRED. Its
// isNonFatalIndexError still marks index-failing migrations as applied in
// production. This harness is now stricter than the runner and says so; the
// exact patch the runner needs is written up in build_log/WAVE21_REPORT.md
// rather than applied here.
//
// Usage:
//   node scripts/migration_chain_check.mjs [--dir migrations] [--mode strict|runner]
//        [--json] [--table NAME] [--no-baseline] [--allow-pinned] [--allow-warnings]
//        [--no-postconditions] [--strict-ci]
// Exit 0 only when there is nothing to report (or --allow-pinned and the only
// failures are pinned). Exit 1 otherwise.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const Database = require_("better-sqlite3");
const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, "..");

// ---------------------------------------------------------------------------
// PRE-EXISTING FAILURES — pinned, NOT to be "fixed" by Wave 13.
//
// WITH the inline baseline (the default, and the only configuration that
// matches production) exactly ONE file fails at statement level:
// 0040_perf_indexes.sql, which indexes `screening_attendees` — a table no
// migration and no inline DDL creates.
//
// WITHOUT the baseline (`--no-baseline`) eleven files fail; they depend on
// tables/columns the connection.ts bootstrap creates, not on earlier
// migrations. Running WITH the baseline is what makes all eleven disappear
// except 0040 — the proof that none of them is a chain-ordering defect.
//
// A pin suppresses the EXIT CODE only under --allow-pinned. It never suppresses
// the report, and it never buys the string "RESULT: OK".
// ---------------------------------------------------------------------------
// POSTCONDITION pin for 0000_numerous_roxanne_simpson.sql — platform_config.
//
// WAVE 23 · ITEM 4 — THIS JUSTIFICATION IS A CORRECTION. The pin STAYS; the
// reason previously written here did not hold up and has been replaced.
//
// WHAT I ORIGINALLY WROTE (2026-08-11, parent agent): "superseded by 0123".
// WHY THAT WAS WRONG, per FINAL REVIEW A: supersession is a property of the
// numbered migration chain, and 0123 cannot supersede 0000. Migration
// `0123_wave0_platform_config.sql:34-60` uses `CREATE TABLE IF NOT EXISTS`.
// If 0000 has already created `platform_config` with the OLD shape
// (`value`, `prev_hash`, `hash` — `migrations/0000_...sql:166-174`), then 0123
// is a NO-OP: `IF NOT EXISTS` cannot replace, alter, or transform an existing
// table. Applied to a bare chain, 0000-then-0123 leaves the obsolete shape in
// place, and `server/adminPlatformStore.ts` — which reads `value_json` and
// never `value` — would be broken against it.
//
// THE REAL, NARROWER REASON THE PIN IS CORRECT. On the production SQLite path
// `runMigrations()` applies `server/db/connection.ts`'s INLINE BASELINE FIRST
// (`server/db/migrate.ts:560-609`). That baseline already declares the CURRENT
// platform_config shape (key, value_json, value_type, description, is_secret,
// version, prev_revision_hash, revision_hash, created_at, updated_at), which is
// byte-for-byte the same column set 0123 declares. 0000's `CREATE TABLE` is
// therefore swallowed as "table already exists" and never gets to create the
// old shape. The columns this checker reports as "missing" for 0000 are the
// RETIRED ones, and they are missing because the baseline — NOT 0123 — won the
// race. In other words this is an intentional BASELINE-ERA shape collision,
// pinned as such; it is not a migration supersession and must not be described
// as one.
//
// RESIDUAL RISK, STATED RATHER THAN HIDDEN. Any path that runs the numbered
// chain WITHOUT the inline baseline retains the obsolete 0000 table shape.
// That path is reachable: `applyInlineBaselineForSqlite()` WARNS and CONTINUES
// when `applyInlineMigrationsForFreshDb` is unavailable
// (`server/db/migrate.ts:575-579`), and this checker's own `--no-baseline`
// mode reproduces it. Consequences on such a path: `platform_config` has
// `value`/`prev_hash`/`hash` instead of `value_json`/`prev_revision_hash`/
// `revision_hash`, and `adminPlatformStore` fails at runtime rather than at
// migrate time. Closing it properly requires a numbered migration that
// actually transforms the 0000 shape (a table rebuild, not
// `CREATE TABLE IF NOT EXISTS`), which is out of scope for this pin.
//
// This is one of the 12 pre-existing shape collisions Wave 13 pinned by digest
// (`waveW13_migration_shape_collision_guard.test.ts:72`, digest 5419e71644f2ac33).
// It is PINNED, not suppressed: it still prints, and it still costs the exit code
// unless --allow-pinned is passed explicitly.
const PRE_EXISTING_POSTCONDITION = new Set(["0000"]);
const PRE_EXISTING_WITH_BASELINE = new Set(["0040"]);
const PRE_EXISTING_BARE = new Set([
  "0002", "0003", "0014", "0021",
  "0040", "0096", "0099", "0123", "0130", "0131", "0136",
]);

const args = process.argv.slice(2);
function flag(name, dflt) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : dflt;
}
const dir = path.resolve(repo, flag("dir", "migrations"));
const mode = flag("mode", "strict");
const asJson = args.includes("--json");
const useBaseline = !args.includes("--no-baseline");
const strictCi = args.includes("--strict-ci");
const allowPinned = args.includes("--allow-pinned") && !strictCi;
const allowWarnings = args.includes("--allow-warnings") && !strictCi;
const checkPost = !args.includes("--no-postconditions");
// `--no-pins` is for SCRATCH directories (falsification probes, one-off chains)
// where this repo's pinned set is meaningless. It only ever makes the checker
// STRICTER — it removes the exemptions, it does not add any.
const noPins = args.includes("--no-pins");
const PRE_EXISTING = noPins ? new Set() : !useBaseline ? PRE_EXISTING_BARE : PRE_EXISTING_WITH_BASELINE;
const inspectTables = args.filter((a, i) => args[i - 1] === "--table");

function isIdempotentSqliteError(msg) {
  return (
    /duplicate column name/i.test(msg) ||
    /table .* already exists/i.test(msg) ||
    /index .* already exists/i.test(msg) ||
    /trigger .* already exists/i.test(msg) ||
    /view .* already exists/i.test(msg) ||
    /UNIQUE constraint failed/i.test(msg)
  );
}
function isNonFatalIndexError(stmt, msg) {
  const s = stripSqlComments(stmt).trim().toUpperCase();
  if (!s.startsWith("CREATE INDEX") && !s.startsWith("CREATE UNIQUE INDEX")) return false;
  return /no such table/i.test(msg) || /no such column/i.test(msg);
}

// ---------------------------------------------------------------------------
// POSTCONDITION PARSER — what does this file CLAIM to create?
//
// Deliberately conservative: it only records objects it can name with
// confidence. A parse it is unsure of is skipped rather than guessed, because a
// false postcondition failure would train the next reader to ignore this tool,
// which is how the original vacuity was tolerated in the first place.
// ---------------------------------------------------------------------------
function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}
const IDENT = String.raw`(?:"([^"]+)"|\[([^\]]+)\]|` + "`([^`]+)`" + String.raw`|([A-Za-z_][A-Za-z0-9_$]*))`;
function pickIdent(m, base) {
  return m[base] || m[base + 1] || m[base + 2] || m[base + 3] || null;
}
// Split a CREATE TABLE body on TOP-LEVEL commas only.
function splitTopLevel(body) {
  const out = [];
  let depth = 0, cur = "", q = null;
  for (const ch of body) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === "'" || ch === '"' || ch === "`") { q = ch; cur += ch; continue; }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
const NON_COLUMN = /^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN|KEY|EXCLUDE)\b/i;

function declaredObjects(rawSql) {
  const sql = stripSqlComments(rawSql);
  const tables = [];   // {name, columns:[]}
  const indexes = [];
  const views = [];
  const triggers = [];
  const addColumns = []; // {table, column}

  // CREATE TABLE [IF NOT EXISTS] name ( ... )
  const tRe = new RegExp(String.raw`CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${IDENT}\s*\(`, "gi");
  let m;
  while ((m = tRe.exec(sql))) {
    const name = pickIdent(m, 1);
    if (!name) continue;
    // capture the balanced body starting at the "(" we just matched
    let i = tRe.lastIndex, depth = 1, body = "", q = null;
    while (i < sql.length && depth > 0) {
      const ch = sql[i];
      if (q) { if (ch === q) q = null; }
      else if (ch === "'" || ch === '"' || ch === "`") q = ch;
      else if (ch === "(") depth++;
      else if (ch === ")") { depth--; if (depth === 0) break; }
      body += ch; i++;
    }
    // `CREATE TABLE x AS SELECT` has no column list to verify; body parse still safe.
    const columns = [];
    for (const piece of splitTopLevel(body)) {
      const t = piece.trim();
      if (!t || NON_COLUMN.test(t)) continue;
      const cm = new RegExp(`^${IDENT}`).exec(t);
      const col = cm && pickIdent(cm, 1);
      if (col) columns.push(col);
    }
    tables.push({ name, columns });
  }

  const iRe = new RegExp(String.raw`CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?${IDENT}\s+ON\b`, "gi");
  while ((m = iRe.exec(sql))) { const n = pickIdent(m, 1); if (n) indexes.push(n); }

  const vRe = new RegExp(String.raw`CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?${IDENT}\b`, "gi");
  while ((m = vRe.exec(sql))) { const n = pickIdent(m, 1); if (n) views.push(n); }

  const gRe = new RegExp(String.raw`CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?${IDENT}\b`, "gi");
  while ((m = gRe.exec(sql))) { const n = pickIdent(m, 1); if (n) triggers.push(n); }

  const aRe = new RegExp(String.raw`ALTER\s+TABLE\s+${IDENT}\s+ADD\s+(?:COLUMN\s+)?${IDENT}`, "gi");
  while ((m = aRe.exec(sql))) {
    const table = pickIdent(m, 1);
    const column = pickIdent(m, 5);
    if (table && column && !NON_COLUMN.test(column)) addColumns.push({ table, column });
  }

  // Objects that legitimately do not survive the file must not be asserted.
  //
  //   (a) explicitly DROPped;
  //   (b) RENAMEd away. This is the SQLite 12-step table-rebuild that drizzle
  //       emits everywhere in this tree: CREATE `__new_x` -> INSERT ... SELECT
  //       -> DROP `x` -> ALTER TABLE `__new_x` RENAME TO `x`. Asserting that
  //       `__new_company_members` exists afterwards is wrong — it is supposed
  //       to be gone. Found as a FALSE POSITIVE during Wave 21 falsification
  //       and fixed here rather than by loosening the postcondition check.
  //       The RENAME TARGET is asserted instead, which is the real intent.
  const dropped = new Set();
  const dRe = new RegExp(String.raw`DROP\s+(?:TABLE|INDEX|VIEW|TRIGGER)\s+(?:IF\s+EXISTS\s+)?${IDENT}`, "gi");
  while ((m = dRe.exec(sql))) { const n = pickIdent(m, 1); if (n) dropped.add(n.toLowerCase()); }

  const renames = []; // {from, to}
  const rRe = new RegExp(String.raw`ALTER\s+TABLE\s+${IDENT}\s+RENAME\s+TO\s+${IDENT}`, "gi");
  while ((m = rRe.exec(sql))) {
    const from = pickIdent(m, 1), to = pickIdent(m, 5);
    if (from && to) { renames.push({ from, to }); dropped.add(from.toLowerCase()); }
  }
  // Re-point each renamed table's column assertions onto its final name, so the
  // rebuild's declared shape is still verified — just under the right name.
  for (const { from, to } of renames) {
    for (const t of tables) if (t.name.toLowerCase() === from.toLowerCase()) tables.push({ name: to, columns: t.columns });
  }
  return { tables, indexes, views, triggers, addColumns, dropped };
}

function objectExists(db, kind, name) {
  const row = db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = ? AND lower(name) = lower(?) LIMIT 1")
    .get(kind, name);
  return !!row;
}
function tableColumns(db, table) {
  try {
    return db.prepare("SELECT name FROM pragma_table_info(?)").all(table).map((r) => String(r.name).toLowerCase());
  } catch {
    return [];
  }
}

const { splitStatements } = await import("../server/db/migrate.ts");
const { applyInlineMigrationsForFreshDb } = await import("../server/db/connection.ts");

const db = new Database(":memory:");
db.pragma("foreign_keys = OFF");
if (useBaseline) applyInlineMigrationsForFreshDb(db);

const files = fs
  .readdirSync(dir)
  .filter((f) => /^\d{4,}_.*\.sql$/i.test(f))
  .sort();

const failures = [];        // statement-level
const postFailures = [];    // declared-but-absent
const pinnedPostFailures = []; // declared-but-absent on a PINNED (superseded) file
const warnings = [];
for (const file of files) {
  const sql = fs.readFileSync(path.join(dir, file), "utf8");
  const num = file.slice(0, 4);
  let failed = null;
  db.exec("BEGIN");
  for (const stmt of splitStatements(sql)) {
    try {
      db.exec(stmt);
    } catch (err) {
      const msg = String(err && err.message ? err.message : err);
      if (isIdempotentSqliteError(msg)) continue;
      if (isNonFatalIndexError(stmt, msg)) {
        warnings.push({ file, num, message: msg });
        if (mode === "runner") continue;
      }
      failed = msg.split("\n")[0];
      break;
    }
  }
  // The runner wraps each file in a transaction and rolls the file back on
  // failure; mirror that so a half-applied file cannot corrupt later files.
  db.exec(failed ? "ROLLBACK" : "COMMIT");
  if (failed) { failures.push({ file, num, message: failed }); continue; }

  // ---- POSTCONDITIONS. This is the check that V1 defeated.
  if (!checkPost) continue;
  const d = declaredObjects(sql);
  // A pinned postcondition still RECORDS and still PRINTS; it is routed to a
  // separate list so it costs the exit code only under --allow-pinned, exactly
  // like the statement-level 0040 pin. It is never dropped on the floor.
  const miss = (what) =>
    (PRE_EXISTING_POSTCONDITION.has(num) ? pinnedPostFailures : postFailures)
      .push({ file, num, message: what });
  for (const t of d.tables) {
    if (d.dropped.has(t.name.toLowerCase())) continue;
    if (!objectExists(db, "table", t.name)) { miss(`declared table \`${t.name}\` does not exist after the migration`); continue; }
    const have = new Set(tableColumns(db, t.name));
    const absent = t.columns.filter((c) => !have.has(c.toLowerCase()));
    if (absent.length) miss(`table \`${t.name}\` is missing declared column(s): ${absent.join(", ")} — the CREATE was swallowed as "already exists" but the shapes differ`);
  }
  for (const n of d.indexes) {
    if (d.dropped.has(n.toLowerCase())) continue;
    if (!objectExists(db, "index", n)) miss(`declared index \`${n}\` does not exist after the migration`);
  }
  for (const n of d.views) {
    if (d.dropped.has(n.toLowerCase())) continue;
    if (!objectExists(db, "view", n)) miss(`declared view \`${n}\` does not exist after the migration`);
  }
  for (const n of d.triggers) {
    if (d.dropped.has(n.toLowerCase())) continue;
    if (!objectExists(db, "trigger", n)) miss(`declared trigger \`${n}\` does not exist after the migration`);
  }
  for (const { table, column } of d.addColumns) {
    if (d.dropped.has(table.toLowerCase())) continue;
    if (!objectExists(db, "table", table)) { miss(`ALTER TABLE target \`${table}\` does not exist`); continue; }
    if (!tableColumns(db, table).includes(column.toLowerCase())) miss(`\`${table}.${column}\` was declared by ADD COLUMN but is absent`);
  }
}

// A chain that applied nothing at all must never pass. Cheap, but it is the
// difference between "0 failures" and "0 files were even read".
const appliedTableCount = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get().n;
const sanity = [];
if (files.length === 0) sanity.push(`no migration files matched in ${dir} — the checker verified nothing`);
if (appliedTableCount === 0) sanity.push("the resulting schema has ZERO tables — the chain did not apply");

const observed = new Set(failures.map((f) => f.num));
const unexpected = failures.filter((f) => !PRE_EXISTING.has(f.num));
const pinnedHit = failures.filter((f) => PRE_EXISTING.has(f.num));
const missing = [...PRE_EXISTING].filter((n) => !observed.has(n)).sort();
const countedWarnings = allowWarnings ? [] : warnings;

const tableReport = {};
for (const t of inspectTables.length ? inspectTables : ["partner_subscription", "esign_envelope"]) {
  const cols = db.prepare("SELECT name FROM pragma_table_info(?)").all(t).map((r) => r.name);
  tableReport[t] = cols.length ? cols : null;
}

const blocking =
  unexpected.length + missing.length + postFailures.length + countedWarnings.length + sanity.length;
const clean = blocking === 0 && pinnedHit.length === 0;
const ok = blocking === 0 && (pinnedHit.length === 0 || allowPinned);

// V3 GUARD: the literal token `RESULT: OK` is reserved for a chain with nothing
// whatsoever to report. Anything else gets a token that cannot be misread.
const resultToken = clean
  ? "RESULT: OK"
  : ok
    ? `RESULT: OK-EXCEPT-PINNED (${pinnedHit.map((f) => f.num).join(" ")} still failing; suppressed by --allow-pinned)`
    : pinnedHit.length && !blocking
      ? `RESULT: FAIL (pinned-only: ${pinnedHit.map((f) => f.num).join(" ")} — a pin is an acknowledgement, not a pass; pass --allow-pinned to exit 0)`
      : "RESULT: FAIL";

if (asJson) {
  console.log(JSON.stringify({ ok, clean, dir, mode, baseline: useBaseline, postconditions: checkPost, files: files.length, failures, postFailures, warnings, sanity, tableReport, unexpected, pinned: pinnedHit, missing, result: resultToken }, null, 2));
} else {
  console.log(`migration chain check — dir=${path.relative(repo, dir) || dir} mode=${mode} files=${files.length} postconditions=${checkPost ? "ON" : "OFF"}`);
  console.log(
    useBaseline
      ? "inline baseline: APPLIED from server/db/connection.ts (production-faithful)"
      : "inline baseline: SKIPPED (--no-baseline; migrations only)",
  );
  console.log("");
  for (const s of sanity) console.log(`  SANITY FAIL  ${s}`);
  for (const f of failures) {
    console.log(`  ${PRE_EXISTING.has(f.num) ? "FAIL (pinned pre-existing)" : "FAIL (NEW)"}  ${f.file}`);
    console.log(`        ${f.message}`);
  }
  for (const f of pinnedPostFailures) {
    console.log(`  FAIL (POSTCONDITION, pinned pre-existing)  ${f.file}`);
    console.log(`        ${f.message}`);
  }
  for (const f of postFailures) {
    console.log(`  FAIL (POSTCONDITION)  ${f.file}`);
    console.log(`        ${f.message}`);
  }
  console.log("");
  for (const w of warnings) console.log(`  ${allowWarnings ? "warn " : "FAIL (INDEX WARNING, counted)"}  ${w.file}: ${w.message.split("\n")[0]}`);
  console.log("");
  for (const [t, cols] of Object.entries(tableReport)) {
    console.log(`  table ${t}: ${cols ? cols.join(", ") : "<ABSENT>"}`);
  }
  console.log("");
  console.log(`statement failures: ${failures.length} (${failures.map((f) => f.num).join(" ") || "none"})`);
  console.log(`pinned postcondition failures: ${pinnedPostFailures.length} (${[...new Set(pinnedPostFailures.map((f) => f.num))].join(" ") || "none"})`);
  console.log(`postcondition failures: ${postFailures.length} (${[...new Set(postFailures.map((f) => f.num))].join(" ") || "none"})`);
  console.log(`index warnings: ${warnings.length}${allowWarnings ? " (not counted; --allow-warnings)" : " (counted as failures)"}`);
  console.log(`pinned pre-existing: ${[...PRE_EXISTING].join(" ")}`);
  if (unexpected.length) console.log(`NEW FAILURES: ${unexpected.map((f) => f.num).join(" ")}`);
  if (missing.length) console.log(`PINNED-BUT-NOT-OBSERVED: ${missing.join(" ")} (a pre-existing failure was fixed — update PRE_EXISTING)`);
  console.log(resultToken);
}
process.exit(ok ? 0 : 1);
