#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════
 * WAVE 261 — THE TWO-SCHEMA-PATHS PARITY CHECK.
 *
 * WHAT THIS EXISTS TO STOP.
 *
 * This tree has TWO schema paths and they are not connected to each other:
 *
 *   PATH 1 — `migrations/NNNN_*.sql`, applied by `server/db/migrate.ts`
 *            (`npm run db:migrate`). `MIGRATIONS_DIR` defaults to `./migrations`,
 *            so THE ROOT DIRECTORY IS THE ONE DEPLOYS READ. This is the path a
 *            real installed server gets.
 *
 *   PATH 2 — an inline bootstrap inside `server/db/connection.ts`, which builds
 *            the sandbox database, the dev database and EVERY `:memory:` test
 *            database. `server/db/connection.ts` is FROZEN (sacred BASE), so no
 *            wave may register a new column there.
 *
 * CONSEQUENCE, observed and not theorised: a wave writes a migration, adds a
 * column, passes its own tests, and ships a column that DOES NOT EXIST where
 * those tests ran. Wave 217 hit exactly this — migration 0222's five columns did
 * not exist in the in-memory database and every insert returned 500 with
 * "table consortium_applications has no column named compliance_attested_at".
 * Wave 211's migration-0220 columns are absent from the bootstrap for the same
 * reason.
 *
 * WHY A CHECK AND NOT A FIX. The brief for this wave is explicit: "a check that
 * makes the divergence loud is worth more than a fix that hides it." The frozen
 * file cannot be edited, so any "fix" is a self-heal installer bolted on beside
 * it — and a self-heal installer that nobody wrote is indistinguishable, from
 * inside a passing test run, from a column that exists. This check is the thing
 * that tells the difference. It fails when a migration adds schema that the
 * bootstrap does not provide AND no self-heal installer reads that migration.
 *
 * IT IS A BASELINED FENCE, in the idiom of the tree's other seven fences. The
 * historical divergences are enumerated in
 * `scripts/lint/schema_path_parity_baseline.json` with a per-entry reason. A NEW
 * divergence fails the build. A baseline entry that has been resolved is
 * reported as STALE and also fails, so the baseline cannot rot into a
 * permanent amnesty.
 *
 * DECLARED LIMITS — read these before trusting a green result:
 *   · It is a TEXT scanner over SQL and over one TypeScript file. It is not a
 *     SQLite parser and it does not execute anything.
 *   · It recognises `CREATE TABLE [IF NOT EXISTS] <t>` and
 *     `ALTER TABLE <t> ADD [COLUMN] <c>`. A column introduced by any other
 *     means — a table recreated with a wider definition, a `CREATE TABLE` whose
 *     body the bootstrap writes differently — is NOT compared column-by-column.
 *     Table-level presence is compared; column-level presence is compared only
 *     for `ADD COLUMN`.
 *   · "A self-heal installer exists" is established by finding the migration's
 *     BASENAME inside a non-test `server/**` source file after comments are
 *     stripped. That proves a reference, not a working installer. It does not
 *     prove the installer is called on the path that needs it.
 *   · Comments are stripped from BOTH corpora before any conclusion is drawn,
 *     and the stripper is self-tested by `--selftest`.
 * ══════════════════════════════════════════════════════════════════════════ */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DEPLOY_DIR = path.join(ROOT, "migrations");
const MIRROR_DIR = path.join(ROOT, "server", "db", "migrations");
const BOOTSTRAP = path.join(ROOT, "server", "db", "connection.ts");
const BASELINE = path.join(ROOT, "scripts", "lint", "schema_path_parity_baseline.json");

/* ── comment stripping ───────────────────────────────────────────────────── */

/** Strip `--` line comments and `/* *\/` block comments from SQL. */
export function stripSqlComments(sql) {
  let out = "";
  let i = 0;
  let inLine = false;
  let inBlock = false;
  let inStr = null;
  while (i < sql.length) {
    const c = sql[i];
    const n = sql[i + 1];
    if (inLine) {
      if (c === "\n") { inLine = false; out += c; }
      i += 1; continue;
    }
    if (inBlock) {
      if (c === "*" && n === "/") { inBlock = false; i += 2; continue; }
      if (c === "\n") out += c;
      i += 1; continue;
    }
    if (inStr) {
      out += c;
      if (c === inStr) inStr = null;
      i += 1; continue;
    }
    if (c === "'" || c === '"') { inStr = c; out += c; i += 1; continue; }
    if (c === "-" && n === "-") { inLine = true; i += 2; continue; }
    if (c === "/" && n === "*") { inBlock = true; i += 2; continue; }
    out += c; i += 1;
  }
  return out;
}

/** Strip `//` line comments and block comments from TypeScript. Template
 *  literals are treated as strings so SQL inside them survives. */
export function stripTsComments(src) {
  let out = "";
  let i = 0;
  let inLine = false;
  let inBlock = false;
  let inStr = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (inLine) {
      if (c === "\n") { inLine = false; out += c; }
      i += 1; continue;
    }
    if (inBlock) {
      if (c === "*" && n === "/") { inBlock = false; i += 2; continue; }
      if (c === "\n") out += c;
      i += 1; continue;
    }
    if (inStr) {
      out += c;
      if (c === "\\") { out += n ?? ""; i += 2; continue; }
      if (c === inStr) inStr = null;
      i += 1; continue;
    }
    if (c === "'" || c === '"' || c === "`") { inStr = c; out += c; i += 1; continue; }
    if (c === "/" && n === "/") { inLine = true; i += 2; continue; }
    if (c === "/" && n === "*") { inBlock = true; i += 2; continue; }
    out += c; i += 1;
  }
  return out;
}

/* ── extraction ──────────────────────────────────────────────────────────── */

const unquote = (s) => s.replace(/^[`"'\[]/, "").replace(/[`"'\]]$/, "").toLowerCase();

const RE_CREATE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"'\[]?[A-Za-z0-9_]+[`"'\]]?)/gi;
const RE_ADDCOL = /ALTER\s+TABLE\s+([`"'\[]?[A-Za-z0-9_]+[`"'\]]?)\s+ADD\s+(?:COLUMN\s+)?([`"'\[]?[A-Za-z0-9_]+[`"'\]]?)/gi;

function extract(text) {
  const tables = new Set();
  const columns = new Set();
  for (const m of text.matchAll(RE_CREATE)) tables.add(unquote(m[1]));
  for (const m of text.matchAll(RE_ADDCOL)) {
    const t = unquote(m[1]);
    const c = unquote(m[2]);
    if (["constraint", "primary", "unique", "check", "foreign"].includes(c)) continue;
    columns.add(`${t}.${c}`);
  }
  return { tables, columns };
}

function lineOf(text, needle) {
  const idx = text.indexOf(needle);
  if (idx < 0) return 0;
  return text.slice(0, idx).split("\n").length;
}

/* ── self-heal installer detection ───────────────────────────────────────── */

function serverSourceFiles() {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "__tests__" || e.name === "migrations") continue;
        walk(p);
      } else if (e.isFile() && /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) {
        out.push(p);
      }
    }
  };
  walk(path.join(ROOT, "server"));
  return out;
}

function installerIndex() {
  const idx = new Map(); // migration basename -> [files]
  const files = serverSourceFiles();
  const stripped = files.map((f) => {
    let s = "";
    try { s = stripTsComments(fs.readFileSync(f, "utf8")); } catch { /* unreadable */ }
    return [f, s];
  });
  for (const name of fs.readdirSync(DEPLOY_DIR).filter((f) => f.endsWith(".sql"))) {
    const hits = stripped.filter(([, s]) => s.includes(name)).map(([f]) => path.relative(ROOT, f));
    if (hits.length > 0) idx.set(name, hits);
  }
  return idx;
}

/* ── selftest ────────────────────────────────────────────────────────────── */

function selftest() {
  const fails = [];
  const sql = `-- ALTER TABLE ghost ADD COLUMN never;\n/* CREATE TABLE phantom (x); */\nALTER TABLE real_t ADD COLUMN real_c TEXT;\n`;
  const s = stripSqlComments(sql);
  if (/ghost/.test(s)) fails.push("stripSqlComments left a -- comment in place");
  if (/phantom/.test(s)) fails.push("stripSqlComments left a block comment in place");
  const ex = extract(s);
  if (!ex.columns.has("real_t.real_c")) fails.push("extract missed a real ADD COLUMN");
  if (ex.tables.size !== 0) fails.push("extract invented a table from a comment");

  const ts = `// ALTER TABLE ghost2 ADD COLUMN never2;\n/* 0000_ghost.sql */\nconst q = \`ALTER TABLE kept ADD COLUMN kept_c TEXT\`;\n`;
  const t = stripTsComments(ts);
  if (/ghost2/.test(t)) fails.push("stripTsComments left a // comment in place");
  if (/0000_ghost\.sql/.test(t)) fails.push("stripTsComments left a block comment in place");
  if (!/kept_c/.test(t)) fails.push("stripTsComments destroyed a template literal");

  if (fails.length > 0) {
    console.error("schema-path-parity SELFTEST FAILED:");
    for (const f of fails) console.error("  - " + f);
    process.exit(1);
  }
  console.log("schema-path-parity SELFTEST OK: comment strippers strip, and the extractor reads only executable SQL.");
  process.exit(0);
}

/* ── main ────────────────────────────────────────────────────────────────── */

if (process.argv.includes("--selftest")) selftest();

const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
const knownSchema = new Set(baseline.knownDivergences.map((d) => d.key));
const knownMirror = new Set(baseline.knownMirrorGaps.map((d) => d.key));

const bootstrapRaw = fs.readFileSync(BOOTSTRAP, "utf8");
const bootstrap = extract(stripTsComments(bootstrapRaw));

const deployFiles = fs.readdirSync(DEPLOY_DIR).filter((f) => /^\d{4}.*\.sql$/.test(f)).sort();
const installers = installerIndex();

const newDivergences = [];
const coveredBySelfHeal = [];
const seenKeys = new Set();

for (const name of deployFiles) {
  const raw = fs.readFileSync(path.join(DEPLOY_DIR, name), "utf8");
  const text = stripSqlComments(raw);
  const { tables, columns } = extract(text);

  for (const key of [...[...tables].map((t) => `table:${t}`), ...[...columns].map((c) => `column:${c}`)]) {
    const bare = key.startsWith("table:") ? key.slice(6) : key.slice(7);
    const present = key.startsWith("table:") ? bootstrap.tables.has(bare) : bootstrap.columns.has(bare);
    if (present) continue;
    const full = `${name}::${key}`;
    seenKeys.add(full);
    const heal = installers.get(name);
    if (heal) { coveredBySelfHeal.push({ full, heal }); continue; }
    if (knownSchema.has(full)) continue;
    newDivergences.push({ name, key, line: lineOf(raw, bare) });
  }
}

/* mirror parity */
const mirrorFiles = new Set(fs.existsSync(MIRROR_DIR) ? fs.readdirSync(MIRROR_DIR).filter((f) => f.endsWith(".sql")) : []);
const newMirrorGaps = [];
for (const name of mirrorFiles) {
  if (!fs.existsSync(path.join(DEPLOY_DIR, name))) {
    const key = `deploy-invisible::${name}`;
    if (!knownMirror.has(key)) newMirrorGaps.push({ key, why: "exists only in server/db/migrations/, which deploys DO NOT read" });
  }
}
const mirrorByteDiffs = [];
for (const name of deployFiles) {
  if (!mirrorFiles.has(name)) continue;
  const a = fs.readFileSync(path.join(DEPLOY_DIR, name));
  const b = fs.readFileSync(path.join(MIRROR_DIR, name));
  if (!a.equals(b)) mirrorByteDiffs.push(name);
}

/* stale baseline entries */
const staleSchema = baseline.knownDivergences.filter((d) => !seenKeys.has(d.key)).map((d) => d.key);
const staleMirror = baseline.knownMirrorGaps
  .filter((d) => d.key.startsWith("deploy-invisible::") && !mirrorFiles.has(d.key.slice("deploy-invisible::".length)))
  .map((d) => d.key);

/* ── report ──────────────────────────────────────────────────────────────── */

console.log("schema-path-parity — migrations/ (what deploys apply) versus the inline bootstrap in server/db/connection.ts (what the sandbox, dev and every :memory: test get).");
console.log(`  migrations scanned: ${deployFiles.length}  ·  bootstrap tables seen: ${bootstrap.tables.size}  ·  bootstrap ADD COLUMNs seen: ${bootstrap.columns.size}`);
console.log(`  divergences present in total: ${seenKeys.size}  ·  of those, covered by a self-heal installer: ${coveredBySelfHeal.length}  ·  baselined without one: ${[...seenKeys].filter((k) => knownSchema.has(k)).length}`);

if (coveredBySelfHeal.length > 0) {
  console.log("  self-heal installers found (a REFERENCE to the migration file, which is not proof the installer runs on the path that needs it):");
  const grouped = new Map();
  for (const c of coveredBySelfHeal) {
    const mig = c.full.split("::")[0];
    if (!grouped.has(mig)) grouped.set(mig, c.heal);
  }
  for (const [mig, files] of grouped) console.log(`    ${mig}  ←  ${files.join(", ")}`);
}

let failed = false;

if (newDivergences.length > 0) {
  failed = true;
  console.error("\nFAIL — NEW SCHEMA-PATH DIVERGENCE. A migration adds schema that the inline bootstrap does not provide, and no self-heal installer reads that migration. Tests that run against a :memory: database WILL NOT SEE THIS SCHEMA, so a passing test proves nothing about it.");
  for (const d of newDivergences) console.error(`  ${d.name}:${d.line}  ${d.key}`);
  console.error("  Either add a self-heal installer that READS ITS ALTER/CREATE STATEMENTS OUT OF THE MIGRATION FILE and PRAGMA-inspects on every call (see server/consortiumApplyStore.ts, wave 217), or record the divergence in scripts/lint/schema_path_parity_baseline.json with a reason.");
}

if (newMirrorGaps.length > 0) {
  failed = true;
  console.error("\nFAIL — MIGRATION PRESENT ONLY IN THE MIRROR DIRECTORY. server/db/migrate.ts reads ./migrations by default, so a file that exists only under server/db/migrations/ is never applied by a deploy.");
  for (const g of newMirrorGaps) console.error(`  ${g.key} — ${g.why}`);
}

if (mirrorByteDiffs.length > 0) {
  failed = true;
  console.error("\nFAIL — MIRRORED MIGRATION IS NOT BYTE-IDENTICAL. Both copies must be identical (R144.1).");
  for (const n of mirrorByteDiffs) console.error(`  ${n}`);
}

if (staleSchema.length > 0 || staleMirror.length > 0) {
  failed = true;
  console.error("\nFAIL — BASELINE IS STALE. These entries no longer describe a real divergence; remove them so the baseline cannot become a permanent amnesty.");
  for (const k of [...staleSchema, ...staleMirror]) console.error(`  ${k}`);
}

if (failed) process.exit(1);

console.log("\nOK — no new schema-path divergence, every mirrored migration is byte-identical, and no migration is deploy-invisible beyond the baselined set.");
