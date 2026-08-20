/**
 * WAVE 57c · ITEM 7 (R37 approved order #7) — THE DESTRUCTIVE-STORE IMPORT FENCE.
 *
 * ── THE FINDING ────────────────────────────────────────────────────────────
 * The W57c destructive-endpoint sweep (build_log/wave57c/DESTRUCTIVE_ENDPOINT_SWEEP.md
 * §5.6) found exported functions that destroy financially significant data,
 * have ZERO non-test callers, and carry NO guard of their own:
 *
 *   server/captableCommitStore.ts:493  clearLedger()
 *       tx.delete(captable_commits) + tx.delete(funded_queue) in one
 *       transaction, then DELETE FROM compliance_holds — the entire cap-table
 *       ledger, the funding queue and every compliance hold.
 *   server/captableCommitStore.ts:275  clearFundedQueue()
 *       tx.delete(funded_queue) — the whole table.
 *   server/softCircleStore.ts:306      deleteSoftCircle()
 *       hard DELETE FROM soft_circles WHERE id = ? — an investor's commitment
 *       record, with no audit-log write.
 *
 * R37: they are "one `import` from being live … Add the guard now, not when
 * called." This file IS that guard.
 *
 * ── WHY AN IMPORT FENCE AND NOT AN IN-FUNCTION CHECK ───────────────────────
 * `clearLedger` and `clearFundedQueue` live in `server/captableCommitStore.ts`,
 * which is SACRED — read, never edited. A guard inside them is therefore not
 * available to this wave at all (R37 order #2's rule applies equally here: if
 * the fix requires editing the sacred file, it becomes an owner question, and it
 * is raised as one in WAVE57C_REPORT.md rather than taken).
 *
 * The stronger guard — a database trigger `trg_captable_commits_no_delete`,
 * mirroring the proven `trg_sfcr_no_update` / `trg_sfcr_no_delete` pair in
 * migrations/0153_wave5_money_captable.sql:717-721 — needs BOTH a new migration
 * AND matching inline DDL inside SACRED `server/db/connection.ts` (dev/test
 * SQLite is built from those inline definitions, so a migration-only trigger
 * would exist in production and not under test). That is the sacred-parity
 * situation the wave brief says to STOP and report on, so it is reported, not
 * taken.
 *
 * What IS available, and is a real guard rather than a hope, is to make the one
 * step that turns these functions from dormant into live — an import from
 * production code — FAIL A GATE. Zero non-test callers is a fact today; this
 * fence is what keeps it a fact tomorrow.
 *
 * ── WHAT IT CHECKS ─────────────────────────────────────────────────────────
 * Every production TypeScript/TSX source file under server/, client/src/,
 * shared/ and scripts/ — EXCLUDING test files, test fixtures and this fence
 * itself — is parsed with the TypeScript compiler, and any IMPORT of a fenced
 * name, or any CALL of a fenced name, is a violation. AST-based, so a comment
 * that merely names `clearLedger` (like the ones in this file, and the ones the
 * wave added to the report) does not trip it, while `import { clearLedger }` in
 * a route file does.
 *
 * Test files are deliberately allowed: these functions are, in practice, test
 * reset helpers, and R37 asks for a guard against them becoming LIVE, not for
 * their deletion (deleting them from the production module is R35 Tier-4 item 18
 * and would be a retirement under R28, which this wave is not authorised to do).
 *
 * ── ESCAPE HATCH ───────────────────────────────────────────────────────────
 * None by design. If a future wave genuinely needs one of these in production,
 * that is an owner decision about erasing cap-table data and belongs in a visible
 * diff to FENCED below, with a ruling reference.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 57d · D6.2 — WHAT THIS FENCE DOES **NOT** CATCH. READ THIS BEFORE
 * TREATING A CLEAN RUN AS PROOF THAT THESE FUNCTIONS CANNOT BE REACHED.
 * ══════════════════════════════════════════════════════════════════════════════
 * Wave 57c's report implied that "no production file can import or call" these
 * functions. Independent Review 1 enumerated twelve ordinary JS/TS forms that
 * walk straight past the detector. Wave 57d closed the ones that can be closed
 * with a syntactic check and DOCUMENTS THE REST HERE, on purpose, so that nobody
 * mistakes this gate for complete.
 *
 * CLOSED IN WAVE 57d (each has a NEGATIVE test in
 * server/__tests__/w57d_d6_fence_evasions.test.ts):
 *   - object-destructuring of a fenced name from ANY initializer, which covers
 *     `const { clearLedger } = require(p)`, `const { clearLedger: wipe } =
 *     await import(p)` and the same shape from a namespace object;
 *   - computed/element access by string literal: `store["clearLedger"]()`;
 *   - a bare property read used for indirection: `const wipe = store.clearLedger`
 *     and `const ops = { wipe: store.clearLedger }`;
 *   - ANY string literal whose exact text is a fenced name, which is what
 *     `Reflect.get(store, "clearLedger")`, `import("./x").then(m =>
 *     m["clearLedger"]())` and most reflective forms reduce to;
 *   - `.js`, `.jsx`, `.mjs`, `.cjs` and `.cts` production sources, which were
 *     not scanned at all (the tree already contains files in those extensions).
 *
 * STILL OPEN — RESIDUAL EVASIONS, HONESTLY LISTED:
 *   R1. **String-built names.** `store["clear" + "Ledger"]()`, template literals,
 *       base64/charCode-assembled names, or a name read from config/env at
 *       runtime. Nothing syntactic can see these; only a runtime capability
 *       check or a DB-level rule can.
 *   R2. **A wrapper exported from a DEFINING module.** `server/softCircleStore.ts`
 *       and SACRED `server/captableCommitStore.ts` are wholly exempt (fencing a
 *       definition would make the rule unsatisfiable without a sacred edit). A
 *       new differently-named export in one of those files that wraps the fenced
 *       function would be invisible here, and production could then call the
 *       wrapper. THIS IS THE LARGEST REMAINING HOLE.
 *   R3. **Equivalent raw SQL.** The fence guards three NAMES, not their effects.
 *       `DELETE FROM captable_commits` / `funded_queue` / `soft_circles` written
 *       directly anywhere in production is outside this fence entirely.
 *   R4. **Anything under an exempt path.** Every `__tests__/` and `__artifacts__/`
 *       path and every `*.test.ts[x]/.test.mts` file is skipped even if a
 *       production file imports it. A "test helper" that production imports is a
 *       production file in every sense except this fence's.
 *   R5. **Build output.** `server/public/**` (the compiled client bundle) is
 *       exempt as a generated artifact, so a bundled call would not be seen.
 *   R6. **Runtime, not enforcement.** This is a CI/lint gate. It does not
 *       mediate authority at runtime, it can be skipped by running the build
 *       without `npm run preflight`, and it cannot stop anything on a live box.
 *
 * THEREFORE the honest label is: **a narrow lint tripwire against the direct and
 * the commonly-obfuscated forms — NOT sufficient protection for functions that
 * erase the cap-table ledger.** The sufficient control is a database-level rule
 * (or a check inside the primitive), which needs a sacred edit plus a migration
 * and is an OPEN OWNER QUESTION (Q1), not something a wave may take alone.
 *
 * Run: npm run lint:destructive-store-fence
 * WAVE 57d · D5 — now chained into `npm run preflight` in package.json. Before
 * 57d this gate was defined and executed by nothing at all.
 * Also asserted by server/__tests__/w57c_item7_destructive_store_fence.test.ts
 * and server/__tests__/w57d_d6_fence_evasions.test.ts
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

/** Fenced export name → the module that owns it, for the failure message. */
/* NOTE, and it is not a stylistic one: this map is created with a NULL PROTOTYPE.
   The first version of this fence used a plain object literal and tested
   membership with `FENCED[name]`, which inherits from Object.prototype — so
   every `x.toString()` in the tree matched `FENCED["toString"]` and the fence
   reported hundreds of false violations on its first run. Lookups below go
   through `isFenced()`, which uses Object.hasOwn. */
export const FENCED: Record<string, string> = Object.assign(Object.create(null) as Record<string, string>, {
  clearLedger: "server/captableCommitStore.ts (SACRED) — erases captable_commits + funded_queue + compliance_holds",
  clearFundedQueue: "server/captableCommitStore.ts (SACRED) — erases the whole funded_queue table",
  deleteSoftCircle: "server/softCircleStore.ts — hard-deletes an investor commitment row, unaudited",
});

/** Own-property membership test. See the prototype note above FENCED. */
export function isFenced(name: string): boolean {
  return Object.hasOwn(FENCED, name);
}

export const SCAN_ROOTS = ["server", "client/src", "shared", "scripts"] as const;

/** Paths that may legitimately mention the fenced names. */
export function isExempt(rel: string): boolean {
  const p = rel.replace(/\\/g, "/");
  if (p.includes("/__tests__/")) return true;
  if (p.includes("/__artifacts__/")) return true;
  if (p.endsWith(".test.ts") || p.endsWith(".test.tsx") || p.endsWith(".test.mts")) return true;
  /* The fence itself, and the module that DEFINES each fenced function. A
     definition is not a call site; fencing the definition would make the rule
     unsatisfiable without editing a sacred file. */
  if (p === "scripts/lint/destructiveStoreFence.ts") return true;
  if (p === "server/captableCommitStore.ts") return true;
  if (p === "server/softCircleStore.ts") return true;
  /* WAVE 57d D6.2 — generated client bundle, not source. Listed as residual
     evasion R5 in the header rather than silently ignored. */
  if (p.startsWith("server/public/")) return true;
  return false;
}

/** WAVE 57d D6.2 — extensions scanned. `.js/.jsx/.mjs/.cjs/.cts` were NOT
 *  scanned before this wave (Review 1 evasion #10) even though the tree already
 *  contains production sources in several of them. */
export const SCANNED_EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs", ".cjs", ".cts"] as const;

export interface FenceViolation {
  file: string;
  line: number;
  column: number;
  name: string;
  /* WAVE 57d D6.2 added "destructure", "property" and "string". */
  kind: "import" | "call" | "destructure" | "property" | "string";
  snippet: string;
}

export function collectSourceFiles(): string[] {
  const out: string[] = [];
  for (const root of SCAN_ROOTS) {
    const abs = path.join(REPO_ROOT, root);
    if (!fs.existsSync(abs)) continue;
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === ".g0-snapshot") continue;
          walk(full);
          continue;
        }
        if (!SCANNED_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;
        const rel = path.relative(REPO_ROOT, full).replace(/\\/g, "/");
        if (isExempt(rel)) continue;
        out.push(rel);
      }
    };
    walk(abs);
  }
  return out.sort();
}

export function scanSource(relPath: string, source: string): FenceViolation[] {
  const sf = ts.createSourceFile(relPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const violations: FenceViolation[] = [];

  const push = (node: ts.Node, name: string, kind: FenceViolation["kind"]) => {
    const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    violations.push({
      file: relPath,
      line: line + 1,
      column: character + 1,
      name,
      kind,
      snippet: node.getText(sf).slice(0, 120),
    });
  };

  const visit = (node: ts.Node) => {
    /* import { clearLedger } from "..." / import { clearLedger as x } */
    if (ts.isImportSpecifier(node)) {
      const imported = node.propertyName?.text ?? node.name.text;
      if (isFenced(imported)) push(node, imported, "import");
    }
    /* export { clearLedger } — a re-export is an import in disguise. */
    if (ts.isExportSpecifier(node)) {
      const exported = node.propertyName?.text ?? node.name.text;
      if (isFenced(exported)) push(node, exported, "import");
    }
    /* clearLedger(...) or store.clearLedger(...) */
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)
          ? callee.name.text
          : null;
      if (name && isFenced(name)) push(node, name, "call");
    }
    /* ── WAVE 57d D6.2 — the commonly-obfuscated forms Review 1 enumerated ──── */
    /* `const { clearLedger } = X` / `const { clearLedger: wipe } = X`, whatever X
       is: a namespace object, `require(p)`, or `await import(p)`. The binding
       SOURCE name is what matters, so the alias cannot hide it. */
    if (ts.isBindingElement(node)) {
      const source = node.propertyName ?? node.name;
      if (ts.isIdentifier(source) && isFenced(source.text)) {
        push(node, source.text, "destructure");
      }
    }
    /* `const wipe = store.clearLedger` / `{ wipe: store.clearLedger }` — a bare
       property READ that is not itself a call. The call branch above only sees
       the eventual callee, which by then is named `wipe`. Calls are already
       reported by that branch, so only non-call positions are added here. */
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.name) &&
      isFenced(node.name.text) &&
      !(node.parent && ts.isCallExpression(node.parent) && node.parent.expression === node)
    ) {
      push(node, node.name.text, "property");
    }
    /* ANY string literal whose exact text is a fenced name. This is what
       `store["clearLedger"]()`, `Reflect.get(store, "clearLedger")` and
       `m["clearLedger"]()` all reduce to. Comments are not string literals, so
       the "a comment may name it" behaviour is unchanged. Concatenated or
       template-built names remain undetectable — residual evasion R1. */
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && isFenced(node.text)) {
      push(node, node.text, "string");
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return violations;
}

export function runDestructiveStoreFence(): { checked: string[]; violations: FenceViolation[] } {
  const checked = collectSourceFiles();
  const violations: FenceViolation[] = [];
  for (const rel of checked) {
    violations.push(...scanSource(rel, fs.readFileSync(path.join(REPO_ROOT, rel), "utf8")));
  }
  return { checked, violations };
}

export function formatViolations(violations: FenceViolation[]): string {
  return violations
    .map((v) => `  ${v.file}:${v.line}:${v.column} — ${v.kind} of "${v.name}" [${FENCED[v.name]}]\n      ${v.snippet}`)
    .join("\n");
}

/* ── CLI ────────────────────────────────────────────────────────────────── */
const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]).includes("destructiveStoreFence");

if (invokedDirectly) {
  const { checked, violations } = runDestructiveStoreFence();
  if (violations.length === 0) {
    console.log(
      `[destructive-store-fence] OK — none of ${Object.keys(FENCED).length} guarded destructive store ` +
        `function(s) is imported, re-exported, destructured, referenced by name string, or called from any of ` +
        `${checked.length} production source file(s). (WAVE 57c ITEM 7; detector widened in WAVE 57d D6.2.) ` +
        `THIS IS A LINT TRIPWIRE, NOT SUFFICIENT PROTECTION — see the residual evasions R1-R6 in this file's header.`,
    );
    process.exit(0);
  }
  console.error(
    `[destructive-store-fence] FAIL — a destructive store function reached production code.\n` +
      `These functions erase cap-table / investor-commitment data and have no guard of their own ` +
      `(R37 order #7). Making one reachable is an owner decision, not a code change.\n` +
      formatViolations(violations),
  );
  process.exit(1);
}
