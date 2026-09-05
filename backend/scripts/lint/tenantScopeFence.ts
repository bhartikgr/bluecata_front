/**
 * scripts/lint/tenantScopeFence.ts
 *
 * W316 — MAKE AN UNSCOPED READ OF A TENANT-SCOPED TABLE IMPOSSIBLE TO WRITE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 * Seven instances of "an unscoped reader on a tenant-scoped table" have been
 * found on this platform. Two were live cross-tenant leaks. HAND-ENUMERATION
 * HAS FAILED THREE TIMES, and it fails for a structural reason, not a lazy one:
 * the tree's tenant fence idiom is
 *
 *     AND (? IS NULL OR tenant_id = ?)          -- W303 (R247)
 *
 * which is OPTIONAL AT THE SQL LEVEL. Omitting the argument does not throw,
 * does not warn and does not fail to compile — it silently widens the read to
 * every tenant. `grep` cannot see an argument that is not there. YOU CANNOT
 * ENUMERATE AN ABSENCE. So the enumeration has to stop being a human's grep and
 * become a file that FAILS when it is wrong.
 *
 * That is this fence. Its baseline IS the enumeration.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT DOES
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Derives the tenant-scoped table list FROM THE MIGRATIONS AT RUN TIME —
 *    every table whose `CREATE TABLE` body mentions `tenant_id`, plus every
 *    table that gains one by `ALTER TABLE ... ADD [COLUMN] tenant_id`. NOTHING
 *    IS HARDCODED. A hardcoded list rots the first time a migration adds a
 *    table, and rotting silently is the failure mode this wave exists to end.
 * 2. Scans `server/**` (excluding `__tests__` and `*.test.ts`), stripping
 *    comments with the PROVEN stripper from `scripts/lint/schema-path-parity.mjs`
 *    (self-tested there by `--selftest`) so that a comment can never inflate or
 *    deflate a count. Twelve comments have already inflated a grep here.
 * 3. For every SQL string/template literal that SELECTs from one of those
 *    tables, FAILS unless the statement text carries a `tenant_id` predicate,
 *    or the statement is covered by a DECLARED EXCEPTION, or the statement is
 *    recorded in the baseline as a known-unfixed reader with a reason.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DECLARED EXCEPTION — BOTH HALVES ARE REQUIRED (Layer 2)
 * ─────────────────────────────────────────────────────────────────────────────
 *   (a) a marker comment immediately above the statement:
 *          /* TENANT-SCOPE-EXEMPT: <KEY> *\/
 *   (b) a matching entry in `scripts/lint/tenant_scope_exemptions.json`
 *       carrying key, file, function, ruling, reason and date.
 *
 * A marker with no entry FAILS. An entry with no marker FAILS AS STALE.
 * A DELIBERATE EXCEPTION THEREFORE CANNOT LOOK LIKE AN ACCIDENT, AND AN
 * ACCIDENT CANNOT LOOK LIKE AN EXCEPTION. That is the whole point: owner ruling
 * Q10 keeps `computeCohortBenchmark` cross-tenant, and a cross-tenant read that
 * is CORRECT must not be indistinguishable from six that are not.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BASELINE
 * ─────────────────────────────────────────────────────────────────────────────
 * `scripts/lint/tenant_scope_fence_baseline.json`, in the idiom of
 * `schema_path_parity_baseline.json`: today's known-unfixed readers, one entry
 * each, with a reason. A NEW violation fails. A STALE entry — one whose
 * statement has been fixed or moved — ALSO FAILS, so the baseline cannot rot
 * into a permanent amnesty. The entry key contains a hash of the statement
 * text, so editing a baselined statement invalidates its own amnesty.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DECLARED LIMITS — READ THESE BEFORE TRUSTING A GREEN RESULT
 * ─────────────────────────────────────────────────────────────────────────────
 *   · This is a TEXT SCANNER over SQL string literals. It executes nothing and
 *     it is not a SQL parser.
 *   · It will NOT see a statement assembled from fragments across functions,
 *     nor SQL built at run time from variables, nor SQL read from a file.
 *   · It sees a `tenant_id` predicate as TEXT: `tenant_id` followed by
 *     `= <> != IN IS`. A mere `SELECT tenant_id, ...` does NOT count — selecting
 *     a column scopes nothing. But `OR tenant_id IS NOT NULL` WOULD count, so
 *     the check is a NECESSARY condition, not a sufficient one.
 *   · It sees SQL WRITTEN AS A STRING LITERAL. Drizzle query-builder reads
 *     (`db.select().from(table).where(...)`) are INVISIBLE to it, and this tree
 *     has many — `listCommitsForUser` is one. Their absence from a green run is
 *     not evidence about them.
 *   · It scans READS. A write that fabricates or omits a `tenant_id` is a
 *     different and arguably worse defect and is NOT covered.
 *   · It scans `server/**` only. `client/**` and `scripts/**` are not scanned.
 *   · It is STRICTLY STRONGER than hand-enumeration, which has failed three
 *     times, and STRICTLY WEAKER than a type-level guarantee over every read.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * USAGE
 * ─────────────────────────────────────────────────────────────────────────────
 *   npm run lint:tenant-scope-fence
 *   npm run lint:tenant-scope-fence:selftest
 *   tsx scripts/lint/tenantScopeFence.ts --root <dir> [--baseline <f>]
 *                                        [--exemptions <f>] [--json]
 *   tsx scripts/lint/tenantScopeFence.ts --write-baseline     (review the diff!)
 *
 * EXIT CODES: 0 = clean · 1 = a real finding · 2 = the fence itself could not
 * run (missing migrations dir, unreadable baseline). A 2 is never a pass.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
/* ── the comment strippers: REUSED BYTE-FOR-BYTE, not re-implemented ──────────
 *
 * `scripts/lint/schema-path-parity.mjs` exports two strippers that are already
 * self-tested there (`--selftest`), and a second copy of them is a second place
 * for them to be wrong. They cannot be `import`ed, because that module runs its
 * whole check at import time and calls `process.exit` — importing it would end
 * this process before the fence ran, which is precisely the "a check that never
 * runs" defect this wave exists to eliminate. So the FUNCTION SOURCE IS READ
 * OUT OF THAT FILE and instantiated here. Same bytes, no side effects. If the
 * extraction ever fails, the fence exits 2 — it never silently continues with a
 * stripper of its own.
 */
const FENCE_DIR = path.dirname(new URL(import.meta.url).pathname);

function loadStrippersFromParityFence(fenceDir: string): {
  stripTsComments: (s: string) => string;
  stripSqlComments: (s: string) => string;
  source: string;
} {
  const p = path.join(fenceDir, "schema-path-parity.mjs");
  let src = "";
  try {
    src = fs.readFileSync(p, "utf8");
  } catch {
    console.error(`FENCE CANNOT RUN — cannot read the proven stripper at ${p}`);
    process.exit(2);
  }
  const extract = (name: string): string => {
    const needle = `export function ${name}(`;
    const at = src.indexOf(needle);
    if (at < 0) {
      console.error(`FENCE CANNOT RUN — ${name} not found in schema-path-parity.mjs`);
      process.exit(2);
    }
    let i = src.indexOf("{", at);
    let depth = 0;
    let q: string | null = null;
    for (; i < src.length; i += 1) {
      const c = src[i];
      if (q) {
        if (c === "\\") { i += 1; continue; }
        if (c === q) q = null;
        continue;
      }
      if (c === "'" || c === '"' || c === "`") { q = c; continue; }
      if (c === "{") depth += 1;
      else if (c === "}") {
        depth -= 1;
        if (depth === 0) return `${src.slice(at, i + 1).replace("export function", "function")}`;
      }
    }
    console.error(`FENCE CANNOT RUN — could not delimit ${name} in schema-path-parity.mjs`);
    process.exit(2);
    return "";
  };
  const tsSrc = extract("stripTsComments");
  const sqlSrc = extract("stripSqlComments");
  // eslint-disable-next-line no-new-func
  const made = new Function(`${tsSrc}\n${sqlSrc}\nreturn { stripTsComments, stripSqlComments };`)() as {
    stripTsComments: (s: string) => string;
    stripSqlComments: (s: string) => string;
  };
  if (typeof made.stripTsComments !== "function" || typeof made.stripSqlComments !== "function") {
    console.error("FENCE CANNOT RUN — extracted strippers are not callable");
    process.exit(2);
  }
  return { ...made, source: `${tsSrc}\n${sqlSrc}` };
}

/* ── CLI ─────────────────────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(n);
const val = (n: string): string | null => {
  const i = argv.indexOf(n);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
};

const ROOT = path.resolve(val("--root") ?? process.cwd());
const BASELINE_PATH = path.resolve(
  val("--baseline") ?? path.join(ROOT, "scripts", "lint", "tenant_scope_fence_baseline.json"),
);
const EXEMPTIONS_PATH = path.resolve(
  val("--exemptions") ?? path.join(ROOT, "scripts", "lint", "tenant_scope_exemptions.json"),
);

const STRIPPERS = loadStrippersFromParityFence(FENCE_DIR);
const stripTsComments = STRIPPERS.stripTsComments;
const stripSqlComments = STRIPPERS.stripSqlComments;

/** The marker, spelled once. */
const MARKER_RE = /\/\*\s*TENANT-SCOPE-EXEMPT:\s*([A-Z0-9_]+)\s*\*\//g;
/** How far above a statement the marker may sit and still count as "immediately
 *  preceding". Generous enough for `db().prepare(` and a line break, tight
 *  enough that a marker cannot license an unrelated statement further down. */
const MARKER_WINDOW = 240;

/* ── 1. the tenant-scoped table list, DERIVED ────────────────────────────── */

export interface ScopedTables {
  tables: Set<string>;
  fromCreate: number;
  fromAlter: number;
  filesScanned: number;
  dirs: string[];
}

const unquote = (s: string) => s.replace(/^[`"'[]/, "").replace(/[`"'\]]$/, "").toLowerCase();

/** Split a SQL file into top-level statements on `;` (comments already stripped). */
function statementsOf(sql: string): string[] {
  return sql.split(";");
}

export function deriveScopedTables(root: string): ScopedTables {
  const dirs = [path.join(root, "migrations"), path.join(root, "server", "db", "migrations")].filter((d) =>
    fs.existsSync(d),
  );
  if (dirs.length === 0) {
    console.error(`FENCE CANNOT RUN — no migrations directory under ${root}`);
    process.exit(2);
  }
  const tables = new Set<string>();
  let fromCreate = 0;
  let fromAlter = 0;
  let filesScanned = 0;
  for (const dir of dirs) {
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) {
      const raw = fs.readFileSync(path.join(dir, f), "utf8");
      filesScanned += 1;
      const sql = stripSqlComments(raw);
      for (const stmt of statementsOf(sql)) {
        const create = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"'[]?[A-Za-z0-9_]+[`"'\]]?)/i.exec(stmt);
        if (create && /\btenant_id\b/i.test(stmt)) {
          const t = unquote(create[1]);
          if (!tables.has(t)) fromCreate += 1;
          tables.add(t);
          continue;
        }
        const alter = /ALTER\s+TABLE\s+([`"'[]?[A-Za-z0-9_]+[`"'\]]?)\s+ADD\s+(?:COLUMN\s+)?([`"'[]?[A-Za-z0-9_]+[`"'\]]?)/i.exec(
          stmt,
        );
        if (alter && unquote(alter[2]) === "tenant_id") {
          const t = unquote(alter[1]);
          if (!tables.has(t)) fromAlter += 1;
          tables.add(t);
        }
      }
    }
  }
  return { tables, fromCreate, fromAlter, filesScanned, dirs: dirs.map((d) => path.relative(root, d)) };
}

/* ── 2. the corpus ───────────────────────────────────────────────────────── */

function serverSourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "__tests__" || e.name === "migrations") continue;
        walk(p);
      } else if (e.isFile() && /\.(ts|mts|cts)$/.test(e.name) && !/\.test\.ts$/.test(e.name)) {
        out.push(p);
      }
    }
  };
  walk(path.join(root, "server"));
  return out.sort();
}

/**
 * Hoist every exemption marker into a STRING LITERAL of the same length before
 * comments are stripped, so the marker survives a stripper whose whole job is
 * to delete comments. Same length keeps every other offset intact.
 */
function hoistMarkers(src: string): string {
  return src.replace(MARKER_RE, (m, key: string) => {
    const token = `"TENANT-SCOPE-EXEMPT:${key}"`;
    if (token.length > m.length) return token; // pathological; offsets shift, still detected
    return token + " ".repeat(m.length - token.length);
  });
}

interface Literal {
  text: string;
  start: number;
  quote: string;
}

/** Every string / template literal in the (comment-stripped) source, with offsets. */
export function literalsOf(src: string): Literal[] {
  const out: Literal[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"' || c === "`") {
      const start = i;
      i += 1;
      let body = "";
      while (i < src.length) {
        const d = src[i];
        if (d === "\\") {
          body += src[i + 1] ?? "";
          i += 2;
          continue;
        }
        if (d === c) break;
        if (d === "\n" && c !== "`") break; // unterminated single-line literal
        body += d;
        i += 1;
      }
      out.push({ text: body, start, quote: c });
      i += 1;
      continue;
    }
    i += 1;
  }
  return out;
}

function enclosingFunction(src: string, offset: number): string {
  const head = src.slice(0, offset);
  const re = /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)|(?:const|let)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(/g;
  let name = "(top level)";
  for (const m of head.matchAll(re)) name = m[1] ?? m[2] ?? name;
  return name;
}

const lineOfOffset = (src: string, off: number) => src.slice(0, off).split("\n").length;

/* ── 3. the scan ─────────────────────────────────────────────────────────── */

export interface Finding {
  key: string;
  file: string;
  line: number;
  fn: string;
  table: string;
  scoped: boolean;
  exemptKey: string | null;
  snippet: string;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 12);

/** Tables read by a SELECT statement: the FROM target and every JOIN target. */
function readTablesOf(stmt: string): string[] {
  const out: string[] = [];
  for (const m of stmt.matchAll(/\b(?:FROM|JOIN)\s+([`"'[]?[A-Za-z0-9_.]+[`"'\]]?)/gi)) {
    const t = unquote(m[1]);
    if (t.includes("(")) continue;
    out.push(t.includes(".") ? t.split(".").pop()! : t);
  }
  return out;
}

export function scanFile(absFile: string, root: string, scoped: Set<string>): Finding[] {
  const raw = fs.readFileSync(absFile, "utf8");
  const src = stripTsComments(hoistMarkers(raw));
  const rel = path.relative(root, absFile).split(path.sep).join("/");
  const out: Finding[] = [];
  for (const lit of literalsOf(src)) {
    const text = lit.text;
    if (!/\bSELECT\b/i.test(text)) continue;
    const hit = readTablesOf(text).filter((t) => scoped.has(t));
    if (hit.length === 0) continue;
    // A `tenant_id` mentioned ANYWHERE is not a fence: `SELECT tenant_id ...`
    // scopes nothing. The predicate must be in a comparison position.
    const isScoped = /\btenant_id\b\s*(?:=|<>|!=|\bIN\b|\bIS\b)/i.test(text);
    // The marker must sit in the window immediately above the literal.
    const windowText = src.slice(Math.max(0, lit.start - MARKER_WINDOW), lit.start);
    const marks = [...windowText.matchAll(/"TENANT-SCOPE-EXEMPT:([A-Z0-9_]+)"/g)];
    const exemptKey = marks.length ? marks[marks.length - 1][1] : null;
    for (const table of Array.from(new Set(hit)).sort()) {
      out.push({
        key: `${rel}::${table}::${hash(norm(text))}`,
        file: rel,
        line: lineOfOffset(src, lit.start),
        fn: enclosingFunction(src, lit.start),
        table,
        scoped: isScoped,
        exemptKey,
        snippet: norm(text).slice(0, 160),
      });
    }
  }
  return out;
}

export interface Report {
  scopedTables: number;
  filesScanned: number;
  statementsConsidered: number;
  scopedReads: number;
  exempted: Finding[];
  baselined: Finding[];
  violations: Finding[];
  markerWithoutEntry: Array<{ finding: Finding; key: string }>;
  staleExemptions: string[];
  staleBaseline: string[];
  exemptionsWithoutMarker: string[];
  rc: number;
}

export function runFence(root: string, baselinePath: string, exemptionsPath: string): Report {
  const derived = deriveScopedTables(root);
  const files = serverSourceFiles(root);

  let baseline: any = { knownUnscopedReads: [] };
  if (fs.existsSync(baselinePath)) {
    try {
      baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
    } catch (e) {
      console.error(`FENCE CANNOT RUN — baseline unreadable: ${(e as Error).message}`);
      process.exit(2);
    }
  }
  let exemptions: any = { exemptions: [] };
  if (fs.existsSync(exemptionsPath)) {
    try {
      exemptions = JSON.parse(fs.readFileSync(exemptionsPath, "utf8"));
    } catch (e) {
      console.error(`FENCE CANNOT RUN — exemptions unreadable: ${(e as Error).message}`);
      process.exit(2);
    }
  }
  const baselineKeys = new Map<string, any>(
    (baseline.knownUnscopedReads ?? []).map((d: any) => [String(d.key), d]),
  );
  const exemptionByKey = new Map<string, any>((exemptions.exemptions ?? []).map((d: any) => [String(d.key), d]));

  const all: Finding[] = [];
  for (const f of files) all.push(...scanFile(f, root, derived.tables));

  const exempted: Finding[] = [];
  const baselined: Finding[] = [];
  const violations: Finding[] = [];
  const markerWithoutEntry: Array<{ finding: Finding; key: string }> = [];
  const seenExemptionKeys = new Set<string>();
  const seenBaselineKeys = new Set<string>();
  let scopedReads = 0;

  for (const f of all) {
    if (f.scoped && !f.exemptKey) {
      scopedReads += 1;
      continue;
    }
    if (f.exemptKey) {
      seenExemptionKeys.add(f.exemptKey);
      const entry = exemptionByKey.get(f.exemptKey);
      if (!entry) {
        markerWithoutEntry.push({ finding: f, key: f.exemptKey });
        continue;
      }
      const fileMatches = String(entry.file ?? "") === f.file;
      if (!fileMatches) {
        markerWithoutEntry.push({ finding: f, key: `${f.exemptKey} (entry names ${entry.file}, marker is in ${f.file})` });
        continue;
      }
      exempted.push(f);
      continue;
    }
    if (baselineKeys.has(f.key)) {
      seenBaselineKeys.add(f.key);
      baselined.push(f);
      continue;
    }
    violations.push(f);
  }

  const staleExemptions = [...exemptionByKey.keys()].filter((k) => !seenExemptionKeys.has(k));
  const staleBaseline = [...baselineKeys.keys()].filter((k) => !seenBaselineKeys.has(k));

  const rc =
    violations.length > 0 || markerWithoutEntry.length > 0 || staleExemptions.length > 0 || staleBaseline.length > 0
      ? 1
      : 0;

  return {
    scopedTables: derived.tables.size,
    filesScanned: files.length,
    statementsConsidered: all.length,
    scopedReads,
    exempted,
    baselined,
    violations,
    markerWithoutEntry,
    staleExemptions,
    staleBaseline,
    exemptionsWithoutMarker: staleExemptions,
    rc,
  };
}

/* ── 4. selftest — both poles of every mechanism ─────────────────────────── */

function tmpTree(name: string): string {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", `tsf_${name}_`));
  fs.mkdirSync(path.join(dir, "migrations"), { recursive: true });
  fs.mkdirSync(path.join(dir, "server", "lib"), { recursive: true });
  fs.mkdirSync(path.join(dir, "scripts", "lint"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "migrations", "0001_scratch.sql"),
    `-- a scratch migration nobody edited the fence for\nCREATE TABLE IF NOT EXISTS w316_selftest_table (\n  id TEXT PRIMARY KEY,\n  tenant_id TEXT NOT NULL,\n  amount_minor INTEGER NOT NULL\n);\nCREATE TABLE IF NOT EXISTS w316_unscoped_table (\n  id TEXT PRIMARY KEY\n);\n`,
  );
  return dir;
}

function writeReader(dir: string, body: string): void {
  fs.writeFileSync(path.join(dir, "server", "lib", "reader.ts"), body);
}

function selftest(): void {
  let failures = 0;
  const check = (label: string, actual: unknown, expected: unknown) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log(`  ${ok ? "ok  " : "FAIL"} ${label}  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
    if (!ok) failures += 1;
  };

  console.log("selftest — POLE 1: an unscoped read of a derived scoped table FAILS");
  {
    const d = tmpTree("p1");
    writeReader(d, `export function r(db: any) { return db.prepare(\`SELECT id, amount_minor FROM w316_selftest_table WHERE id = ?\`).all(); }\n`);
    const r = runFence(d, path.join(d, "nope.json"), path.join(d, "nope2.json"));
    check("rc", r.rc, 1);
    check("one violation", r.violations.length, 1);
    check("names the table", r.violations[0]?.table, "w316_selftest_table");
    check("names the file", r.violations[0]?.file, "server/lib/reader.ts");
    check("table list derived without editing the fence", r.scopedTables >= 1, true);
  }

  console.log("selftest — POLE 2: the same read WITH a tenant_id predicate PASSES");
  {
    const d = tmpTree("p2");
    writeReader(d, `export function r(db: any) { return db.prepare(\`SELECT id FROM w316_selftest_table WHERE id = ? AND (? IS NULL OR tenant_id = ?)\`).all(); }\n`);
    const r = runFence(d, path.join(d, "nope.json"), path.join(d, "nope2.json"));
    check("rc", r.rc, 0);
    check("no violations", r.violations.length, 0);
    check("counted as scoped", r.scopedReads, 1);
  }

  console.log("selftest — POLE 3: a table WITHOUT tenant_id is not policed at all");
  {
    const d = tmpTree("p3");
    writeReader(d, `export function r(db: any) { return db.prepare(\`SELECT id FROM w316_unscoped_table\`).all(); }\n`);
    const r = runFence(d, path.join(d, "nope.json"), path.join(d, "nope2.json"));
    check("rc", r.rc, 0);
    check("statements considered", r.statementsConsidered, 0);
  }

  console.log("selftest — POLE 4: a marker with NO json entry FAILS");
  {
    const d = tmpTree("p4");
    writeReader(d, `export function r(db: any) { return db.prepare(/* TENANT-SCOPE-EXEMPT: SELFTEST_KEY */\n    \`SELECT id FROM w316_selftest_table\`).all(); }\n`);
    const r = runFence(d, path.join(d, "nope.json"), path.join(d, "nope2.json"));
    check("rc", r.rc, 1);
    check("markerWithoutEntry", r.markerWithoutEntry.length, 1);
    check("violations empty (it is a marker problem, not an unscoped read)", r.violations.length, 0);
  }

  console.log("selftest — POLE 5: a json entry with NO marker FAILS AS STALE");
  {
    const d = tmpTree("p5");
    writeReader(d, `export function r(db: any) { return db.prepare(\`SELECT id FROM w316_selftest_table WHERE tenant_id = ?\`).all(); }\n`);
    const ex = path.join(d, "scripts", "lint", "ex.json");
    fs.writeFileSync(
      ex,
      JSON.stringify({ exemptions: [{ key: "SELFTEST_KEY", file: "server/lib/reader.ts", function: "r", ruling: "X", reason: "y", date: "2026-09-05" }] }),
    );
    const r = runFence(d, path.join(d, "nope.json"), ex);
    check("rc", r.rc, 1);
    check("stale exemption named", r.staleExemptions, ["SELFTEST_KEY"]);
  }

  console.log("selftest — POLE 6: a MATCHED PAIR passes, and only the pair");
  {
    const d = tmpTree("p6");
    writeReader(d, `export function r(db: any) { return db.prepare(/* TENANT-SCOPE-EXEMPT: SELFTEST_KEY */\n    \`SELECT id FROM w316_selftest_table\`).all(); }\n`);
    const ex = path.join(d, "scripts", "lint", "ex.json");
    fs.writeFileSync(
      ex,
      JSON.stringify({ exemptions: [{ key: "SELFTEST_KEY", file: "server/lib/reader.ts", function: "r", ruling: "X", reason: "y", date: "2026-09-05" }] }),
    );
    const r = runFence(d, path.join(d, "nope.json"), ex);
    check("rc", r.rc, 0);
    check("one exempted", r.exempted.length, 1);
    check("exempt key", r.exempted[0]?.exemptKey, "SELFTEST_KEY");
    // and the entry pointing at the WRONG FILE is refused
    fs.writeFileSync(
      ex,
      JSON.stringify({ exemptions: [{ key: "SELFTEST_KEY", file: "server/lib/other.ts", function: "r", ruling: "X", reason: "y", date: "2026-09-05" }] }),
    );
    const r2 = runFence(d, path.join(d, "nope.json"), ex);
    check("wrong-file entry rejected", r2.rc, 1);
  }

  console.log("selftest — POLE 7: a baselined reader passes; a STALE baseline entry FAILS");
  {
    const d = tmpTree("p7");
    writeReader(d, `export function r(db: any) { return db.prepare(\`SELECT id FROM w316_selftest_table\`).all(); }\n`);
    const r0 = runFence(d, path.join(d, "nope.json"), path.join(d, "nope2.json"));
    const bl = path.join(d, "scripts", "lint", "bl.json");
    fs.writeFileSync(bl, JSON.stringify({ knownUnscopedReads: [{ key: r0.violations[0].key, reason: "selftest" }] }));
    const r1 = runFence(d, bl, path.join(d, "nope2.json"));
    check("baselined reader passes", r1.rc, 0);
    check("counted as baselined", r1.baselined.length, 1);
    // fix the reader: the baseline entry is now stale and must FAIL
    writeReader(d, `export function r(db: any) { return db.prepare(\`SELECT id FROM w316_selftest_table WHERE tenant_id = ?\`).all(); }\n`);
    const r2 = runFence(d, bl, path.join(d, "nope2.json"));
    check("stale baseline fails", r2.rc, 1);
    check("stale key named", r2.staleBaseline.length, 1);
  }

  console.log("selftest — POLE 8: a COMMENTED-OUT unscoped read is NOT a violation");
  {
    const d = tmpTree("p8");
    writeReader(d, `export function r(db: any) {\n  // return db.prepare(\`SELECT id FROM w316_selftest_table\`).all();\n  /* SELECT id FROM w316_selftest_table */\n  return [];\n}\n`);
    const r = runFence(d, path.join(d, "nope.json"), path.join(d, "nope2.json"));
    check("rc", r.rc, 0);
    check("nothing considered", r.statementsConsidered, 0);
  }

  console.log("selftest — POLE 9: a JOIN onto a scoped table is policed too");
  {
    const d = tmpTree("p9");
    writeReader(d, `export function r(db: any) { return db.prepare(\`SELECT a.id FROM w316_unscoped_table a JOIN w316_selftest_table b ON b.id = a.id\`).all(); }\n`);
    const r = runFence(d, path.join(d, "nope.json"), path.join(d, "nope2.json"));
    check("rc", r.rc, 1);
    check("the JOINed table is named", r.violations[0]?.table, "w316_selftest_table");
  }

  console.log("selftest — POLE 10: a __tests__ file is out of corpus");
  {
    const d = tmpTree("p10");
    fs.mkdirSync(path.join(d, "server", "__tests__"), { recursive: true });
    fs.writeFileSync(
      path.join(d, "server", "__tests__", "x.test.ts"),
      `it("x", () => { db.prepare(\`SELECT id FROM w316_selftest_table\`); });\n`,
    );
    writeReader(d, `export const x = 1;\n`);
    const r = runFence(d, path.join(d, "nope.json"), path.join(d, "nope2.json"));
    check("rc", r.rc, 0);
    check("nothing considered", r.statementsConsidered, 0);
  }

  console.log(failures === 0 ? "\nSELFTEST OK — every pole behaved in both directions." : `\nSELFTEST FAILED — ${failures} check(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

/* ── 5. main ─────────────────────────────────────────────────────────────── */

if (flag("--selftest")) selftest();

const derivedForPrint = deriveScopedTables(ROOT);
const report = runFence(ROOT, BASELINE_PATH, EXEMPTIONS_PATH);

if (flag("--json")) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.rc);
}

if (flag("--write-baseline")) {
  const entries = report.violations.map((v) => ({
    key: v.key,
    file: v.file,
    function: v.fn,
    table: v.table,
    line: v.line,
    reason: "TO BE REVIEWED — recorded by --write-baseline; a reason must be written by a human.",
    snippet: v.snippet,
  }));
  fs.writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify({ generatedBy: "tenantScopeFence --write-baseline", knownUnscopedReads: entries }, null, 2)}\n`,
  );
  console.log(`WROTE ${entries.length} entr(ies) to ${BASELINE_PATH}. REVIEW THEM — an unreviewed baseline is an amnesty.`);
  process.exit(0);
}

console.log("W316 — TENANT SCOPE FENCE");
console.log(`  root                     : ${ROOT}`);
console.log(`  migration dirs scanned   : ${derivedForPrint.dirs.join(", ")} (${derivedForPrint.filesScanned} file(s))`);
console.log(
  `  tenant-scoped tables     : ${derivedForPrint.tables.size} DERIVED at run time (${derivedForPrint.fromCreate} by CREATE TABLE, ${derivedForPrint.fromAlter} by ALTER TABLE ADD COLUMN) — nothing hardcoded`,
);
console.log(`  server files scanned     : ${report.filesScanned} (excluding __tests__ and *.test.ts)`);
console.log(`  SELECTs on scoped tables : ${report.statementsConsidered}`);
console.log(`     ├─ carrying a tenant_id predicate : ${report.scopedReads}`);
console.log(`     ├─ declared exceptions (marker + json entry, BOTH required) : ${report.exempted.length}`);
console.log(`     ├─ baselined known-unfixed readers : ${report.baselined.length}`);
console.log(`     └─ NEW VIOLATIONS : ${report.violations.length}`);

for (const e of report.exempted) {
  console.log(`  EXEMPT ${e.exemptKey}  ${e.file}:${e.line} ${e.fn}() → ${e.table}`);
}
for (const b of report.baselined) {
  console.log(`  BASELINED ${b.file}:${b.line} ${b.fn}() → ${b.table}`);
}

let failed = false;
if (report.violations.length > 0) {
  failed = true;
  console.error("\nFAIL — UNSCOPED READ OF A TENANT-SCOPED TABLE:");
  for (const v of report.violations) {
    console.error(`  ${v.file}:${v.line}  ${v.fn}()  reads ${v.table}  without a tenant_id predicate`);
    console.error(`      ${v.snippet}`);
    console.error(`      key: ${v.key}`);
  }
  console.error(
    "  Add a tenant_id predicate, or — if the cross-tenant read is DELIBERATE — add BOTH a\n" +
      "  /* TENANT-SCOPE-EXEMPT: <KEY> */ marker above the statement AND a matching entry in\n" +
      `  ${path.relative(ROOT, EXEMPTIONS_PATH)} carrying the ruling reference.`,
  );
}
if (report.markerWithoutEntry.length > 0) {
  failed = true;
  console.error("\nFAIL — EXEMPTION MARKER WITH NO MATCHING JSON ENTRY (an exception needs BOTH halves):");
  for (const m of report.markerWithoutEntry) {
    console.error(`  ${m.finding.file}:${m.finding.line} ${m.finding.fn}() → ${m.finding.table}  marker: ${m.key}`);
  }
}
if (report.staleExemptions.length > 0) {
  failed = true;
  console.error("\nFAIL — STALE EXEMPTION ENTRY: a json entry whose marker is gone. Remove it, or restore the marker:");
  for (const k of report.staleExemptions) console.error(`  ${k}`);
}
if (report.staleBaseline.length > 0) {
  failed = true;
  console.error(
    "\nFAIL — STALE BASELINE ENTRY: this reader was fixed or moved, so its amnesty no longer describes anything.\n" +
      "  Remove the entry. A baseline that outlives its finding is a permanent amnesty:",
  );
  for (const k of report.staleBaseline) console.error(`  ${k}`);
}

if (failed) process.exit(1);
console.log("\nOK — every SELECT on a tenant-scoped table in server/** is scoped, declared, or baselined.");
process.exit(0);
