#!/usr/bin/env node
/**
 * scripts/lint/raise_literal_fence.mjs — WAVE 78 · THE HOST-CLI SYNTAX FENCE.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS. Read this before relaxing anything in it.
 * ═══════════════════════════════════════════════════════════════════════════
 * `migrations/0192_wave68_term_domain_fences.sql` shipped, in-tree, with
 * `RAISE(ABORT, 'literal' || COALESCE(...))` — a BUILT-UP argument. SQLite has
 * accepted an expression as the RAISE error-message only since 3.47.0
 * (2024-10-21): "Beginning with version 3.47.0 the error-message can be an SQL
 * expression. In older versions of SQLite, the error-message was required to be
 * a string literal." (sqlite.org/lang_createtrigger.html).
 *
 * The app bundles better-sqlite3, whose SQLite is 3.49.2, so THE MIGRATION
 * APPLIED CLEANLY and `npm run migrate` exited 0. The deploy host's `sqlite3(1)`
 * is 3.46.1 — one release BELOW the line. From that moment the host CLI could
 * not parse the schema it had just been given, and EVERY host command answered
 *
 *     Error: malformed database schema (trg_...) - near "||": syntax error
 *
 * including `PRAGMA integrity_check`, the ledger counts, `.schema`, `VACUUM`
 * ("database disk image is malformed") and BOTH runbook commands that prove
 * `ccm_47f69199e7396a97` was unfrozen. A developer reads that as a corrupted
 * production database and restores the backup. The defect is therefore not
 * "a migration failed" — it is "the migration succeeded and made the host lie".
 *
 * A version skew between the bundled engine and the host CLI is INVISIBLE to
 * every test that only goes through better-sqlite3. This lint is the check that
 * does not need a host to be present to catch it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IT ENFORCES
 * ═══════════════════════════════════════════════════════════════════════════
 *  1. RAISE-LITERAL. Every `RAISE(ABORT|FAIL|ROLLBACK, x)` in every scanned SQL
 *     file has a SINGLE STRING LITERAL as `x`. No `||`, COALESCE, CASE,
 *     quote(), substr(), column reference, or parameter.
 *  2. VERSION FLOOR. No scanned file uses a construct that requires a SQLite
 *     newer than SQLITE_FLOOR below.
 *  3. HOST PARSE (only when a `sqlite3` binary is on PATH, and only additive):
 *     if the host CLI is OLDER than the floor, that is reported too, because a
 *     floor nobody meets is not a floor.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE FLOOR, AND WHY IT IS 3.37.0 AND NOT 3.46.1
 * ═══════════════════════════════════════════════════════════════════════════
 * 3.46.1 is the ONE host we have measured. Setting the floor there would leave
 * zero margin: the next host, container base image or LTS distro that is a few
 * months older breaks in exactly the same silent way. The floor is therefore
 * set to the OLDEST version this tree can actually be read by — which is fixed
 * by `) STRICT` tables (SQLite 3.37.0, 2021-11-27), used in 68 places from
 * migration 0121 onward and not removable without rewriting them.
 *
 * So: THE FLOOR SHOULD BE LOWER THAN 3.46.1, and 3.37.0 is the lowest value
 * the tree can honestly claim. Measured, not assumed: this lint passes the whole
 * tree at 3.37.0 today. Raise SQLITE_FLOOR only with a deliberate decision and
 * a note about which hosts you are dropping.
 *
 * usage:
 *   node scripts/lint/raise_literal_fence.mjs            # default dirs, exit 1 on any finding
 *   node scripts/lint/raise_literal_fence.mjs --json
 *   node scripts/lint/raise_literal_fence.mjs --dir migrations --dir server/db/migrations
 *   node scripts/lint/raise_literal_fence.mjs --census    # print every RAISE, pass or fail
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

/** The oldest SQLite this tree promises to be readable by. See header. */
export const SQLITE_FLOOR = "3.37.0";

const DEFAULT_DIRS = ["migrations", "server/db/migrations"];

/* ── argv ────────────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const census = argv.includes("--census");
const dirs = [];
for (let i = 0; i < argv.length; i++) if (argv[i] === "--dir") dirs.push(argv[i + 1]);
const SCAN = dirs.length ? dirs : DEFAULT_DIRS;

/* ── version helpers ─────────────────────────────────────────────────────── */
const vparse = (s) => s.split(".").map(Number);
function vcmp(a, b) {
  const A = vparse(a), B = vparse(b);
  for (let i = 0; i < 3; i++) if ((A[i] || 0) !== (B[i] || 0)) return (A[i] || 0) - (B[i] || 0);
  return 0;
}

/* ── comment-aware blanking (offsets preserved) ──────────────────────────── */
/**
 * Returns a same-length copy in which
 *   · `--` and `/* *\/` comments are blanked, and
 *   · the CONTENTS of every string literal are replaced by `x`,
 * so that a pattern occurring inside prose or inside a quoted string cannot be
 * mistaken for code. Offsets are preserved, so the caller can slice the ORIGINAL
 * text at any index found here. (This matters: 0192 legitimately contains the
 * text `RAISE(ABORT,` INSIDE a postcondition's LIKE pattern.)
 */
export function maskLiterals(s) {
  const out = s.split("");
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === "'") {
      let j = i + 1;
      while (j < n) {
        if (s[j] === "'") { if (s[j + 1] === "'") { out[j] = "x"; out[j + 1] = "x"; j += 2; continue; } break; }
        if (out[j] !== "\n") out[j] = "x";
        j++;
      }
      i = j + 1; continue;
    }
    if (c === '"') { let j = i + 1; while (j < n && s[j] !== '"') { if (out[j] !== "\n") out[j] = "x"; j++; } i = j + 1; continue; }
    if (c === "-" && s[i + 1] === "-") {
      let j = s.indexOf("\n", i); if (j < 0) j = n;
      for (let k = i; k < j; k++) out[k] = " ";
      i = j; continue;
    }
    if (c === "/" && s[i + 1] === "*") {
      let j = s.indexOf("*/", i + 2); j = j < 0 ? n : j + 2;
      for (let k = i; k < j && k < n; k++) if (out[k] !== "\n") out[k] = " ";
      i = j; continue;
    }
    i++;
  }
  return out.join("");
}

export function blankComments(s) {
  const out = s.split("");
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === "'") {
      let j = i + 1;
      while (j < n) {
        if (s[j] === "'") { if (s[j + 1] === "'") { j += 2; continue; } break; }
        j++;
      }
      i = j + 1; continue;
    }
    if (c === '"') { let j = i + 1; while (j < n && s[j] !== '"') j++; i = j + 1; continue; }
    if (c === "-" && s[i + 1] === "-") {
      let j = s.indexOf("\n", i); if (j < 0) j = n;
      for (let k = i; k < j; k++) out[k] = " ";
      i = j; continue;
    }
    if (c === "/" && s[i + 1] === "*") {
      let j = s.indexOf("*/", i + 2); j = j < 0 ? n : j + 2;
      for (let k = i; k < j && k < n; k++) if (out[k] !== "\n") out[k] = " ";
      i = j; continue;
    }
    i++;
  }
  return out.join("");
}

/** Index of the ')' matching the '(' at `open`, string-literal aware. */
function matchParen(s, open) {
  let depth = 0, i = open;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === "'") {
      i++;
      while (i < n) { if (s[i] === "'") { if (s[i + 1] === "'") { i += 2; continue; } break; } i++; }
    } else if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth === 0) return i; }
    i++;
  }
  return -1;
}

function splitTopComma(s) {
  const parts = [];
  let depth = 0, cur = "", i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === "'") {
      cur += c; i++;
      while (i < n) { cur += s[i]; if (s[i] === "'") { if (s[i + 1] === "'") { cur += s[i + 1]; i += 2; continue; } break; } i++; }
      i++; continue;
    }
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) { parts.push(cur); cur = ""; i++; continue; }
    cur += c; i++;
  }
  parts.push(cur);
  return parts;
}

const SINGLE_LITERAL = /^\s*'(?:[^']|'')*'\s*$/s;

/* ── constructs that require a SQLite newer than some version ────────────── */
/* Each entry: [human name, regex, min SQLite version]. Only constructs a
   migration in this tree could plausibly use are listed; the point is not to be
   a complete SQLite grammar but to catch the classes that silently skew. */
export const VERSION_GATED = [
  ["RAISE() with a non-literal error-message", null, "3.47.0"], // handled structurally
  ["jsonb_* function", /\bjsonb_[a-z_]+\s*\(/i, "3.45.0"],
  ["json_pretty()", /\bjson_pretty\s*\(/i, "3.44.0"],
  ["concat() / concat_ws()", /\bconcat(?:_ws)?\s*\(/i, "3.44.0"],
  ["string_agg()", /\bstring_agg\s*\(/i, "3.44.0"],
  ["ORDER BY inside an aggregate", /\b(?:group_concat|string_agg)\s*\([^()]*\bORDER\s+BY\b/i, "3.44.0"],
  ["octet_length()", /\boctet_length\s*\(/i, "3.43.0"],
  ["timediff()", /\btimediff\s*\(/i, "3.43.0"],
  ["RIGHT / FULL OUTER JOIN", /\b(?:RIGHT|FULL)\s+(?:OUTER\s+)?JOIN\b/i, "3.39.0"],
  ["IS [NOT] DISTINCT FROM", /\bIS\s+(?:NOT\s+)?DISTINCT\s+FROM\b/i, "3.39.0"],
  ["unixepoch()", /\bunixepoch\s*\(/i, "3.38.0"],
  ["-> / ->> JSON operator", /(?:->>?)\s*(?:'|\$)/, "3.38.0"],
  ["STRICT table", /\)\s*STRICT\b/i, "3.37.0"],
  ["RETURNING clause", /\bRETURNING\b/i, "3.35.0"],
  ["ALTER TABLE ... DROP COLUMN", /\bALTER\s+TABLE\s+[^\s;]+\s+DROP\s+(?:COLUMN\s+)?[A-Za-z_"]/i, "3.35.0"],
  ["materialisation hint on a CTE", /\bAS\s+(?:NOT\s+)?MATERIALIZED\b/i, "3.35.0"],
  ["math built-in (pow/log/floor/…)", /\b(?:ceil|ceiling|floor|trunc|log2|pow|power|sqrt|exp|ln|log10|acos|asin|atan2|degrees|radians)\s*\(/i, "3.35.0"],
  ["window function", /\bOVER\s*\(/i, "3.25.0"],
  ["ALTER TABLE ... RENAME COLUMN", /\bRENAME\s+COLUMN\b/i, "3.25.0"],
  ["UPSERT (ON CONFLICT ... DO)", /\bON\s+CONFLICT\b[\s\S]{0,200}?\bDO\b/i, "3.24.0"],
  ["iif()", /\biif\s*\(/i, "3.32.0"],
  ["generated column", /\bGENERATED\s+ALWAYS\s+AS\b|\bAS\s*\([^)]*\)\s*(?:VIRTUAL|STORED)\b/i, "3.31.0"],
];

/* ── the scan ────────────────────────────────────────────────────────────── */
function listSql(dir) {
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs).filter((f) => f.endsWith(".sql")).sort().map((f) => path.join(dir, f));
}

const findings = [];
const raiseCensus = [];
let filesScanned = 0, raiseSites = 0;

for (const dir of SCAN) {
  for (const rel of listSql(dir)) {
    filesScanned++;
    const raw = fs.readFileSync(rel, "utf8");
    const text = maskLiterals(raw);      // scanned: literals and comments neutralised
    const lineOf = (off) => text.slice(0, off).split("\n").length;
    const realSlice = (a, b) => raw.slice(a, b);

    /* 1. RAISE literal */
    const re = /\bRAISE\s*\(/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      const open = m.index + m[0].length - 1;
      const close = matchParen(text, open);
      if (close < 0) {
        findings.push({ file: rel, line: lineOf(m.index), rule: "raise-literal",
          detail: "unbalanced parentheses after RAISE(" });
        continue;
      }
      const parts = splitTopComma(text.slice(open + 1, close));
      const action = parts[0].trim().toUpperCase();
      if (parts.length < 2) {
        if (action !== "IGNORE") {
          findings.push({ file: rel, line: lineOf(m.index), rule: "raise-literal",
            detail: `RAISE(${action}) with no error-message` });
        }
        raiseCensus.push({ file: rel, line: lineOf(m.index), verdict: "ok", form: `RAISE(${action})` });
        raiseSites++;
        continue;
      }
      raiseSites++;
      const arg = parts.slice(1).join(",");
      const argReal = realSlice(open + 1 + parts[0].length + 1, close);
      const ok = SINGLE_LITERAL.test(arg);
      raiseCensus.push({
        file: rel, line: lineOf(m.index),
        verdict: ok ? "ok" : "VIOLATION",
        form: ok ? "single string literal" : argReal.replace(/\s+/g, " ").trim().slice(0, 140),
      });
      if (!ok) {
        findings.push({
          file: rel, line: lineOf(m.index), rule: "raise-literal",
          requires: "3.47.0", floor: SQLITE_FLOOR,
          detail: `RAISE(${action}, …) argument is NOT a single string literal — needs SQLite >= 3.47.0, ` +
                  `floor is ${SQLITE_FLOOR}: ${argReal.replace(/\s+/g, " ").trim().slice(0, 160)}`,
        });
      }
    }

    /* 2. version-gated constructs */
    for (const [name, rx, minv] of VERSION_GATED) {
      if (!rx) continue;
      if (vcmp(minv, SQLITE_FLOOR) <= 0) continue; // allowed at the floor
      const g = new RegExp(rx.source, rx.flags.includes("g") ? rx.flags : rx.flags + "g");
      let k;
      while ((k = g.exec(text)) !== null) {
        findings.push({
          file: rel, line: lineOf(k.index), rule: "version-floor",
          requires: minv, floor: SQLITE_FLOOR,
          detail: `${name} requires SQLite >= ${minv}, floor is ${SQLITE_FLOOR}: ` +
                  k[0].replace(/\s+/g, " ").slice(0, 80),
        });
      }
    }
  }
}

/* 3. the host CLI, if there is one */
let hostVersion = null, hostNote = null;
try {
  hostVersion = execFileSync("sqlite3", ["--version"], { encoding: "utf8" }).trim().split(/\s+/)[0];
  if (vcmp(hostVersion, SQLITE_FLOOR) < 0) {
    hostNote = `host sqlite3 ${hostVersion} is OLDER than the declared floor ${SQLITE_FLOOR}`;
    findings.push({ file: "(host)", line: 0, rule: "host-below-floor", detail: hostNote });
  } else {
    hostNote = `host sqlite3 ${hostVersion} >= floor ${SQLITE_FLOOR} (ok)`;
  }
} catch {
  hostNote = "no sqlite3 binary on PATH — host parse check skipped (not a failure)";
}

const summary = {
  floor: SQLITE_FLOOR,
  files_scanned: filesScanned,
  raise_sites: raiseSites,
  findings: findings.length,
  host: hostNote,
};

if (asJson) {
  console.log(JSON.stringify({ summary, findings, census: census ? raiseCensus : undefined }, null, 1));
} else {
  console.log(`[raise-literal-fence] floor=${SQLITE_FLOOR}  files=${filesScanned}  RAISE sites=${raiseSites}`);
  console.log(`[raise-literal-fence] ${hostNote}`);
  if (census) for (const c of raiseCensus) console.log(`   ${c.verdict === "ok" ? " ok " : "FAIL"}  ${c.file}:${c.line}  ${c.form}`);
  for (const f of findings) console.error(`  ${f.rule}  ${f.file}:${f.line}  ${f.detail}`);
  console.log(findings.length === 0
    ? "[raise-literal-fence] RESULT: OK — every RAISE argument is a single string literal and nothing needs a newer SQLite."
    : `[raise-literal-fence] RESULT: FAIL — ${findings.length} finding(s).`);
}
process.exit(findings.length === 0 ? 0 : 1);
