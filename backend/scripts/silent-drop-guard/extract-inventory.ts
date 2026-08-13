#!/usr/bin/env tsx
/**
 * scripts/silent-drop-guard/extract-inventory.ts
 *
 * Anti-Silent-Drop Build Guard — inventory extractor (v26.7.3, G-1).
 *
 * Pure, deterministic, side-effect-free static scanner of the SOURCE tree.
 *
 * ---------------------------------------------------------------------------
 * WHAT CHANGED IN G-1 (and why)
 * ---------------------------------------------------------------------------
 * The pre-G-1 extractor produced three inventories (routes, clientRoutes, nav)
 * from a *presence-of-token* scan. Four bypasses were reproduced against it:
 *
 *   (a) `{false && (<Route .../>)}`         — statically present, dynamically
 *       dead. Token scan still sees the Route.
 *       FIX: control-flow-aware traversal. Statically-dead branches
 *       (`false &&`, `0 &&`, `"" &&`, `cond ? live : dead`, `if (false)`) are
 *       not traversed, so nothing inside them is inventoried.
 *
 *   (b) deleting a table `<TableHead>` / `<TableCell>` (e.g. the Amount column
 *       at client/src/pages/admin/AdminFeesConsolidated.tsx:1383,1396-1402).
 *       No route, nav or page changes, so the old guard saw nothing.
 *       FIX: the `copy` inventory (every rendered literal string) and the
 *       `panels` inventory (every container element plus a digest of its
 *       direct child-element sequence) both change when a column goes.
 *
 *   (c) `<Route path="…">{() => null}</Route>` — route identifier preserved,
 *       page erased (V6 REVIEW B §2, "Attack G-1.candidate").
 *       FIX: `routeTargets` records what each live Route actually renders.
 *       render=null is a different signature from render=jsx.
 *
 *   (d) route AND target identifier preserved, the *target module* replaced by
 *       a component that returns null (V7 REVIEW B, BLOCKER 2).
 *       FIX: `routeTargets` resolves the target identifier through its import
 *       to the module on disk and records the resolved component's body kind
 *       (jsx | null | redirect | empty | unknown). Erasing the page changes
 *       body=jsx to body=null even though path, target and import are intact.
 *
 * ---------------------------------------------------------------------------
 * THE EIGHT OCCURRENCE INVENTORIES
 * ---------------------------------------------------------------------------
 *   1. routes        server `app.(get|post|put|patch|delete)("<path>")`
 *                    → "METHOD path"
 *   2. clientRoutes  live wouter `<Route path="…">`               → "path"
 *   3. nav           `{ href, label }` objects in *Shell*.tsx     → "href\tlabel"
 *   4. tabs          TabsTrigger / TabsContent / Tab `value=…`     → "file\tTag\tvalue\tlabel"
 *   5. buttons       `<Button>` / `<button>` / role="button"      → "file\tTag\tid"
 *   6. events        every live `on[A-Z]…` JSX handler binding    → "file\tTag\tprop\thandler"
 *   7. copy          every live rendered literal string           → "file\ttext"
 *   8. panels        container elements + child-sequence digest   → "file\tTag\tid\tchildren=…"
 *
 * plus  routeTargets  route-TARGET signatures (the (c)/(d) fix)
 *                    → "path\ttarget=X\tmodule=…\trender=…\tbody=…"
 *
 * `routes`, `clientRoutes` and `nav` keep their exact pre-G-1 identifier shape,
 * because scripts/silent-drop-guard/baseline.json is PROTECTED and must stay
 * byte-identical (sha256 8e8b8856…4d68). The five new occurrence inventories
 * and routeTargets are baselined in the separate, versioned companion file
 * baseline.route-targets.json (G-1c), generated against the immutable G-0
 * snapshot.
 *
 * NEVER scans: server/public/** (built bundles), node_modules, dist, build,
 * coverage, .git, the .g0-snapshot directory, and any *.test.* / *.spec.* file.
 *
 * ESM only — no require(). Deterministic: every returned array is sorted and
 * de-duplicated, and directory traversal order is sorted.
 */

import * as ts from "typescript";
import * as fs from "node:fs";
import * as crypto from "node:crypto";
import * as path from "node:path";

export interface Inventory {
  // The three protected classes (shape frozen by baseline.json).
  routes: string[]; // "METHOD path"
  clientRoutes: string[]; // "path"
  nav: string[]; // "href\tlabel"
  // The five new occurrence classes + route targets (companion baseline).
  tabs?: string[];
  buttons?: string[];
  events?: string[];
  copy?: string[];
  panels?: string[];
  routeTargets?: string[];
  /** WAVE 2B / BLOCKER 2 — reachable render surface behind each live Route. */
  routedSurfaces?: string[];
}

/** The five new occurrence classes plus routeTargets, in report order. */
export const COMPANION_CLASSES = [
  "routeTargets",
  "routedSurfaces",
  "tabs",
  "buttons",
  "events",
  "copy",
  "panels",
] as const;
export type CompanionClass = (typeof COMPANION_CLASSES)[number];

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);

/** Directory / file segments that must never be scanned. */
const EXCLUDED_DIR_SEGMENTS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".git",
  ".g0-snapshot",
  "__fixtures__",
]);

/** Layout/auth wrappers that are not "the page" for route-target purposes. */
const ROUTE_WRAPPERS = new Set([
  "RequireAuth",
  "RequireRole",
  "RequireAdmin",
  "RequirePartner",
  "Suspense",
  "ErrorBoundary",
  "Fragment",
  "React.Fragment",
  "Switch",
  "Router",
  "QueryClientProvider",
  "TooltipProvider",
  "Providers",
  "Layout",
]);
/** Any *Shell component is a layout wrapper too (CollectiveShell, AdminShell…). */
function isWrapper(name: string): boolean {
  return ROUTE_WRAPPERS.has(name) || /Shell$/.test(name) || /Provider$/.test(name);
}

const REDIRECT_TAGS = new Set(["Redirect", "Navigate"]);

const BUTTON_TAGS = new Set(["Button", "button", "IconButton", "LinkButton"]);

const TAB_TAGS = new Set([
  "TabsTrigger",
  "TabsContent",
  "TabsList",
  "Tab",
  "TabPanel",
]);

/** Container elements whose child-sequence is tracked ("panel bodies"). */
const PANEL_TAGS = new Set([
  "Card",
  "CardHeader",
  "CardContent",
  "CardFooter",
  "Table",
  "TableHeader",
  "TableBody",
  "TableFooter",
  "TableRow",
  "TableHead",
  "TableCell",
  "TabsContent",
  "Dialog",
  "DialogContent",
  "Sheet",
  "SheetContent",
  "Accordion",
  "AccordionItem",
  "AccordionContent",
  "form",
  "section",
  "aside",
  "nav",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
]);

/** JSX attributes whose string value is user-visible copy. */
const COPY_ATTRS = new Set([
  "title",
  "label",
  "placeholder",
  "aria-label",
  "alt",
  "description",
  "emptyMessage",
  "tooltip",
]);

/* WAVE 10 / RS-4 + G-1c — DEAD ROUTER SNAPSHOTS ARE NOT INVENTORY.
 *
 * `client/src/App - Copy.tsx` and `client/src/App - Copy (2).tsx` are stale
 * editor snapshots of the router (DEF-055). They are imported by nothing —
 * `grep -rn "App - Copy"` over the whole tree returns zero references — and
 * `spec/ENGINE_REGISTRY.md:5` already lists them under `Excluded:`.
 *
 * They were nevertheless being WALKED, which had a concrete and provable
 * consequence: the G-1c companion baseline, generated from the immutable G-0
 * snapshot (which contains both files), captured 18 route-TARGET signatures
 * and 18 routed-page SURFACE signatures that NO LIVE FILE PRODUCES —
 * `/partner/me/dashboard`, `/partner/me/spvs`, `/partner/me/team` and 9 more
 * `/partner/me/*` redirect stubs that were consolidated onto
 * `/collective/partner/*` (client/src/App.tsx:1255 records the move), plus the
 * duplicate `render=redirect` signatures for `/admin/pricing-models`,
 * `/collective/membership`, `/collective/partner/funds` and
 * `/collective/partner/spvs`.
 *
 * The guard was therefore protecting functionality that exists only inside two
 * dead files. Deleting the dead files (RS-4) made the guard report 36 "silent
 * drops" that are not drops — reproduced before this change by moving both
 * files aside and running `npm run guard` (36 items, classes routeTargets and
 * routedSurfaces only; `routes`/`clientRoutes`/`nav`, which come from the
 * sha-protected baseline.json, reported NOTHING, which is the proof that
 * baseline.json was never contaminated and must not be touched).
 *
 * Excluding them here, then regenerating ONLY the companion baseline from the
 * G-0 snapshot via `npm run guard:companion`, removes the phantom entries from
 * BOTH sides of the comparison. Zero allowlist entries were added, and the
 * protected baseline.json (sha256 8e8b8856…4d68) is untouched — `guard.ts`
 * re-hashes it before and after companion generation and aborts on change.
 *
 * FALSIFICATION: this exclusion is narrow by construction. It matches only a
 * basename of the exact form `App - Copy.tsx` / `App - Copy (N).tsx` directly
 * under `client/src/`. `client/src/App.tsx` is NOT matched, and
 * `server/__tests__/waveW10_guard_dead_router_exclusion.test.ts` asserts both
 * directions — the copies excluded AND the live router still scanned — so the
 * fence cannot go vacuously green the way DA-3's did (WAVE 7B).
 */
export function isDeadRouterSnapshot(rel: string): boolean {
  const parts = rel.split(path.sep);
  if (parts.length !== 3) return false;
  if (parts[0] !== "client" || parts[1] !== "src") return false;
  return /^App - Copy(?: \(\d+\))?\.tsx$/.test(parts[2] ?? "");
}

export function isExcludedFile(rel: string): boolean {
  const parts = rel.split(path.sep);
  if (parts[0] === "server" && parts[1] === "public") return true;
  for (const seg of parts) if (EXCLUDED_DIR_SEGMENTS.has(seg)) return true;
  if (isDeadRouterSnapshot(rel)) return true;
  const base = parts[parts.length - 1] ?? "";
  if (/\.(test|spec)\.[cm]?tsx?$/.test(base)) return true;
  return false;
}

function walk(
  dir: string,
  repoRoot: string,
  predicate: (rel: string) => boolean,
  out: string[],
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(repoRoot, abs);
    if (isExcludedFile(rel)) continue;
    if (entry.isDirectory()) {
      if (EXCLUDED_DIR_SEGMENTS.has(entry.name)) continue;
      walk(abs, repoRoot, predicate, out);
    } else if (entry.isFile() && predicate(rel)) {
      out.push(abs);
    }
  }
}

const sourceCache = new Map<string, ts.SourceFile | null>();

function parseSource(absPath: string): ts.SourceFile {
  const cached = sourceCache.get(absPath);
  if (cached) return cached;
  const text = fs.readFileSync(absPath, "utf-8");
  const sf = ts.createSourceFile(
    absPath,
    text,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true,
    absPath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  sourceCache.set(absPath, sf);
  return sf;
}

function tryParseSource(absPath: string): ts.SourceFile | null {
  if (sourceCache.has(absPath)) return sourceCache.get(absPath) ?? null;
  if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
    sourceCache.set(absPath, null);
    return null;
  }
  return parseSource(absPath);
}

/** Reset the parse cache. Tests mutate fixture trees between runs. */
export function resetSourceCache(): void {
  sourceCache.clear();
}

function digest(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 12);
}

function normText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// ===========================================================================
// CONTROL FLOW — static truthiness, used to prune dead branches (bypass (a)).
// ===========================================================================

/**
 * Statically evaluate a condition to true/false when — and only when — it is
 * decidable from syntax alone. Returns undefined for anything dynamic. This is
 * deliberately conservative: a wrong `false` would hide live functionality.
 */
export function staticTruthiness(node: ts.Node): boolean | undefined {
  if (ts.isParenthesizedExpression(node)) return staticTruthiness(node.expression);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return false;
  if (ts.isIdentifier(node) && node.text === "undefined") return false;
  if (ts.isIdentifier(node) && node.text === "NaN") return false;
  if (ts.isNumericLiteral(node)) return Number(node.text) !== 0;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text.length > 0;
  }
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    const inner = staticTruthiness(node.operand);
    return inner === undefined ? undefined : !inner;
  }
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
      const l = staticTruthiness(node.left);
      if (l === false) return false;
      const r = staticTruthiness(node.right);
      if (l === true && r !== undefined) return r;
      return undefined;
    }
    if (op === ts.SyntaxKind.BarBarToken) {
      const l = staticTruthiness(node.left);
      if (l === true) return true;
      const r = staticTruthiness(node.right);
      if (l === false && r !== undefined) return r;
      return undefined;
    }
  }
  return undefined;
}

/**
 * Children of `node` that are reachable. Statically-dead operands/branches are
 * omitted, so no inventory item can be harvested from them.
 */
function liveChildren(node: ts.Node): ts.Node[] {
  const out: ts.Node[] = [];
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
      const l = staticTruthiness(node.left);
      out.push(node.left);
      if (l !== false) out.push(node.right); // `false && X` → X never renders
      return out;
    }
    if (op === ts.SyntaxKind.BarBarToken) {
      const l = staticTruthiness(node.left);
      out.push(node.left);
      if (l !== true) out.push(node.right); // `true || X` → X never evaluates
      return out;
    }
  }
  if (ts.isConditionalExpression(node)) {
    const c = staticTruthiness(node.condition);
    out.push(node.condition);
    if (c !== false) out.push(node.whenTrue);
    if (c !== true) out.push(node.whenFalse);
    return out;
  }
  if (ts.isIfStatement(node)) {
    const c = staticTruthiness(node.expression);
    out.push(node.expression);
    if (c !== false) out.push(node.thenStatement);
    if (c !== true && node.elseStatement) out.push(node.elseStatement);
    return out;
  }
  ts.forEachChild(node, (c) => {
    out.push(c);
  });
  return out;
}

/** Depth-first traversal that never enters a statically-dead branch. */
export function visitLive(node: ts.Node, cb: (n: ts.Node) => void): void {
  cb(node);
  for (const c of liveChildren(node)) visitLive(c, cb);
}

// ===========================================================================
// Shared helpers
// ===========================================================================

function canonicalizeArg(node: ts.Node, sf: ts.SourceFile): string {
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  const raw = node.getText(sf).replace(/\s+/g, " ").trim();
  return `<expr:${raw}>`;
}

function attrName(attr: ts.JsxAttribute, sf: ts.SourceFile): string {
  return attr.name.getText(sf);
}

function jsxTagName(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement | ts.JsxClosingElement,
  sf: ts.SourceFile,
): string {
  return node.tagName.getText(sf);
}

function getAttrs(node: ts.Node): ts.JsxAttributes | undefined {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) return node.attributes;
  return undefined;
}

/** String value of a JSX attribute if it is a literal; undefined otherwise. */
function attrLiteral(
  attrs: ts.JsxAttributes,
  name: string,
  sf: ts.SourceFile,
): string | undefined {
  for (const a of attrs.properties) {
    if (!ts.isJsxAttribute(a)) continue;
    if (attrName(a, sf) !== name) continue;
    const init = a.initializer;
    if (!init) return "";
    if (ts.isStringLiteral(init)) return init.text;
    if (ts.isJsxExpression(init) && init.expression) {
      if (ts.isStringLiteral(init.expression)) return init.expression.text;
      if (ts.isNoSubstitutionTemplateLiteral(init.expression)) return init.expression.text;
      return `<expr:${normText(init.expression.getText(sf))}>`;
    }
  }
  return undefined;
}

/** Concatenated direct literal text of a JSX element (its visible label). */
function elementText(el: ts.Node, sf: ts.SourceFile): string {
  if (!ts.isJsxElement(el)) return "";
  const parts: string[] = [];
  for (const c of el.children) {
    if (ts.isJsxText(c)) {
      const t = normText(c.text);
      if (t) parts.push(t);
    } else if (ts.isJsxExpression(c) && c.expression) {
      if (ts.isStringLiteral(c.expression)) parts.push(c.expression.text);
    } else if (ts.isJsxElement(c)) {
      const inner = elementText(c, sf);
      if (inner) parts.push(inner);
    }
  }
  return normText(parts.join(" "));
}

function sortedUnique(set: Set<string>): string[] {
  return Array.from(set).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function relOf(repoRoot: string, abs: string): string {
  return path.relative(repoRoot, abs).split(path.sep).join("/");
}

// ===========================================================================
// 1. routes (server)
// ===========================================================================

function extractRoutesFromFile(sf: ts.SourceFile, routes: Set<string>): void {
  visitLive(sf, (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text.toLowerCase();
      const objText = node.expression.expression.getText(sf);
      if (objText === "app" && HTTP_METHODS.has(method) && node.arguments.length >= 1) {
        routes.add(`${method.toUpperCase()} ${canonicalizeArg(node.arguments[0], sf)}`);
      }
    }
  });
}

// ===========================================================================
// 2. clientRoutes + routeTargets
// ===========================================================================

interface ImportMap {
  /** local identifier → module specifier */
  bySpecifier: Map<string, string>;
}

function buildImportMap(sf: ts.SourceFile): ImportMap {
  const bySpecifier = new Map<string, string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st)) continue;
    if (!ts.isStringLiteral(st.moduleSpecifier)) continue;
    const spec = st.moduleSpecifier.text;
    const clause = st.importClause;
    if (!clause) continue;
    if (clause.name) bySpecifier.set(clause.name.text, spec);
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const el of clause.namedBindings.elements) bySpecifier.set(el.name.text, spec);
    }
  }
  // `const X = lazy(() => import("..."))`
  visitLive(sf, (n) => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      ts.isCallExpression(n.initializer)
    ) {
      const txt = n.initializer.expression.getText(sf);
      if (txt === "lazy" || txt === "React.lazy") {
        const m = /import\(\s*["'`]([^"'`]+)["'`]\s*\)/.exec(n.initializer.getText(sf));
        if (m) bySpecifier.set(n.name.text, m[1]);
      }
    }
  });
  return { bySpecifier };
}

const MODULE_EXTS = [".tsx", ".ts", ".jsx", ".js"];

/** Resolve an import specifier to an absolute file, honouring the @/ alias. */
function resolveModule(repoRoot: string, fromFile: string, spec: string): string | undefined {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(repoRoot, "client", "src", spec.slice(2));
  else if (spec.startsWith("@shared/")) base = path.join(repoRoot, "shared", spec.slice(8));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return undefined; // bare package import — not a page module
  for (const ext of MODULE_EXTS) {
    const p = base + ext;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  for (const ext of MODULE_EXTS) {
    const p = path.join(base, "index" + ext);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  return undefined;
}

export type BodyKind = "jsx" | "null" | "redirect" | "empty" | "unknown";

/** Classify a render expression / component body. */
function classifyRenderExpression(expr: ts.Node | undefined, sf: ts.SourceFile): BodyKind {
  if (!expr) return "empty";
  if (ts.isParenthesizedExpression(expr)) return classifyRenderExpression(expr.expression, sf);
  if (expr.kind === ts.SyntaxKind.NullKeyword) return "null";
  if (ts.isIdentifier(expr) && expr.text === "undefined") return "null";
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return "null";
  if (ts.isJsxFragment(expr)) {
    const meaningful = expr.children.filter(
      (c) =>
        (ts.isJsxText(c) && normText(c.text).length > 0) ||
        ts.isJsxElement(c) ||
        ts.isJsxSelfClosingElement(c) ||
        (ts.isJsxExpression(c) && !!c.expression),
    );
    return meaningful.length === 0 ? "empty" : "jsx";
  }
  if (ts.isJsxElement(expr) || ts.isJsxSelfClosingElement(expr)) {
    const tag = ts.isJsxElement(expr)
      ? jsxTagName(expr.openingElement, sf)
      : jsxTagName(expr, sf);
    if (REDIRECT_TAGS.has(tag)) return "redirect";
    return "jsx";
  }
  if (ts.isConditionalExpression(expr)) {
    const c = staticTruthiness(expr.condition);
    if (c === true) return classifyRenderExpression(expr.whenTrue, sf);
    if (c === false) return classifyRenderExpression(expr.whenFalse, sf);
    const a = classifyRenderExpression(expr.whenTrue, sf);
    const b = classifyRenderExpression(expr.whenFalse, sf);
    if (a === b) return a;
    return a === "jsx" || b === "jsx" ? "jsx" : "unknown";
  }
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    if (staticTruthiness(expr.left) === false) return "null";
    return classifyRenderExpression(expr.right, sf);
  }
  // Any other expression (call, member access, map, …) may or may not render.
  let sawJsx = false;
  visitLive(expr, (n) => {
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) sawJsx = true;
  });
  return sawJsx ? "jsx" : "unknown";
}

/** Body kind of a function-like node, from its live return statements. */
function classifyFunctionBody(fn: ts.Node, sf: ts.SourceFile): BodyKind {
  const fnLike = fn as ts.FunctionLikeDeclaration;
  const body = fnLike.body;
  if (!body) return "unknown";
  if (!ts.isBlock(body)) return classifyRenderExpression(body, sf);

  const kinds: BodyKind[] = [];
  const collect = (n: ts.Node): void => {
    // Do not descend into nested functions — their returns are not this
    // component's render result.
    if (n !== fn && (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n))) {
      return;
    }
    if (ts.isReturnStatement(n)) kinds.push(classifyRenderExpression(n.expression, sf));
    for (const c of liveChildren(n)) collect(c);
  };
  for (const c of liveChildren(body)) collect(c);

  if (kinds.length === 0) return "empty";
  if (kinds.every((k) => k === "null" || k === "empty")) {
    return kinds.includes("null") ? "null" : "empty";
  }
  if (kinds.every((k) => k === "redirect")) return "redirect";
  if (kinds.some((k) => k === "jsx")) return "jsx";
  return "unknown";
}

/**
 * Body kind of the component a module exports (default export preferred,
 * otherwise a named export matching `wanted`).
 */
function classifyModuleComponent(absFile: string, wanted: string): BodyKind {
  const sf = tryParseSource(absFile);
  if (!sf) return "unknown";
  let result: BodyKind | undefined;

  const named = new Map<string, ts.Node>();
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) named.set(st.name.text, st);
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer) named.set(d.name.text, d.initializer);
      }
    }
  }

  for (const st of sf.statements) {
    // export default function Foo() {}
    if (ts.isFunctionDeclaration(st) && st.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) {
      result = classifyFunctionBody(st, sf);
      break;
    }
    // export default <expr>
    if (ts.isExportAssignment(st) && !st.isExportEquals) {
      const e = st.expression;
      if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) {
        result = classifyFunctionBody(e, sf);
      } else if (ts.isIdentifier(e) && named.has(e.text)) {
        const target = named.get(e.text)!;
        result = ts.isArrowFunction(target) || ts.isFunctionExpression(target) || ts.isFunctionDeclaration(target)
          ? classifyFunctionBody(target, sf)
          : "unknown";
      } else {
        result = "unknown";
      }
      break;
    }
  }

  if (result === undefined && named.has(wanted)) {
    const target = named.get(wanted)!;
    result =
      ts.isArrowFunction(target) || ts.isFunctionExpression(target) || ts.isFunctionDeclaration(target)
        ? classifyFunctionBody(target, sf)
        : "unknown";
  }
  return result ?? "unknown";
}

// ===========================================================================
// WAVE 2B / BLOCKER 2 — REACHABLE RENDER SURFACE
//
// THE HOLE THIS CLOSES
// --------------------
// Review B (build_log/WAVES_012_REVIEW_B.md, BLOCKER 2) showed that the guard
// accepts a functionally EMPTY routed page. The reproduction (preserved at
// /home/user/workspace/guard_bypass_probe.ts, output
// build_log/review_b_guard_bypass.txt) is:
//
//     -export default function PartnerSpvEngine() { …the whole real page… }
//     +function PreservedButNeverCalled()        { …the whole real page… }
//     +export default function PartnerSpvEngine(){ return <div />; }
//
// Every pre-WAVE-2B class survives that edit:
//   * `clientRoutes`  — the Route still exists
//   * `routeTargets`  — target/module/render are unchanged and `body=jsx`
//                       is still literally true: `<div />` IS JSX
//   * `buttons` / `copy` / `panels` — these are extracted PER FILE, and the
//                       real page is still IN the file, merely unreachable
// The guard exited 0 on a page reduced to a blank div.
//
// THE MECHANISM
// -------------
// `routedSurfaces` measures how much a routed component can ACTUALLY render:
// the JSX elements and literal copy inside the component function PLUS every
// local helper transitively CALLED from it. Code that is no longer reachable
// from the routed export contributes nothing, so hiding a page behind a dead
// function collapses the measurement.
//
// It is deliberately recorded as a coarse ORDER-OF-MAGNITUDE bucket, not an
// exact count. Exact counts would turn every ordinary edit (add a field, drop
// a redundant wrapper) into a build failure and the guard would be routed
// around within a week. A bucket only moves on a change of KIND, which is
// what "the page is gone" looks like.
// ===========================================================================

/** Order-of-magnitude buckets (base 4): 0 | 1-3 | 4-15 | 16-63 | 64-255 | 256+. */
export function surfaceBucket(n: number): string {
  if (n <= 0) return "s0";
  if (n < 4) return "s1";
  if (n < 16) return "s2";
  if (n < 64) return "s3";
  if (n < 256) return "s4";
  return "s5";
}

/** Function-like declarations addressable by name within one module. */
function localFunctionMap(sf: ts.SourceFile): Map<string, ts.Node> {
  const named = new Map<string, ts.Node>();
  const add = (name: string, node: ts.Node): void => {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node)
    ) {
      named.set(name, node);
    }
  };
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) add(st.name.text, st);
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer) add(d.name.text, d.initializer);
      }
    }
  }
  return named;
}

/** Resolve the routed component's function node inside its module. */
function findComponentNode(sf: ts.SourceFile, wanted: string): ts.Node | undefined {
  const named = localFunctionMap(sf);
  for (const st of sf.statements) {
    if (
      ts.isFunctionDeclaration(st) &&
      st.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
    ) {
      return st;
    }
    if (ts.isExportAssignment(st) && !st.isExportEquals) {
      const e = st.expression;
      if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) return e;
      if (ts.isIdentifier(e) && named.has(e.text)) return named.get(e.text);
      return undefined;
    }
  }
  return named.get(wanted);
}

/**
 * Count the render surface REACHABLE from `wanted` in `absFile`.
 *
 * Reachability is intra-module and call-graph based: starting at the routed
 * component we follow every identifier that names a local function, and we
 * count JSX elements plus distinct literal copy strings across that closure.
 * Statically-dead branches are pruned by `visitLive`, exactly as elsewhere.
 *
 * Intentional limits (stated so the next reviewer does not over-read it):
 *   - Imported components are NOT followed. Their own surface is measured by
 *     their own routed entries (if routed) and by the occurrence classes.
 *     Following them would make one shared component's edit move dozens of
 *     buckets at once.
 *   - Nested inline functions ARE counted, because they are part of the
 *     component body.
 */
export function reachableSurface(absFile: string, wanted: string): number {
  const sf = tryParseSource(absFile);
  if (!sf) return -1; // unparseable — caller records "unknown", never "empty"
  const root = findComponentNode(sf, wanted);
  if (!root) return -1;

  const named = localFunctionMap(sf);
  const seen = new Set<ts.Node>();
  const queue: ts.Node[] = [root];
  let elements = 0;
  const texts = new Set<string>();

  while (queue.length) {
    const fn = queue.pop()!;
    if (seen.has(fn)) continue;
    seen.add(fn);
    visitLive(fn, (n) => {
      if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) {
        elements += 1;
        const t = ts.isJsxElement(n) ? elementText(n, sf) : "";
        if (t) texts.add(t);
      } else if (ts.isJsxText(n)) {
        const t = normText(n.text);
        if (t) texts.add(t);
      } else if (ts.isIdentifier(n)) {
        const target = named.get(n.text);
        if (target && !seen.has(target)) queue.push(target);
      }
    });
  }
  return elements + texts.size;
}

/**
 * The page component identifier rendered by a Route child: the DEEPEST
 * non-wrapper capitalised JSX tag. `<RequireAuth><CollectiveShell><PartnerSpvEngine/>`
 * → PartnerSpvEngine.
 */
function findTargetIdentifier(node: ts.Node, sf: ts.SourceFile): string | undefined {
  let best: string | undefined;
  let bestDepth = -1;
  const walkJsx = (n: ts.Node, depth: number): void => {
    let d = depth;
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) {
      const tag = ts.isJsxElement(n) ? jsxTagName(n.openingElement, sf) : jsxTagName(n, sf);
      d = depth + 1;
      if (/^[A-Z]/.test(tag) && !isWrapper(tag) && !REDIRECT_TAGS.has(tag)) {
        if (d > bestDepth) {
          bestDepth = d;
          best = tag;
        }
      }
    }
    for (const c of liveChildren(n)) walkJsx(c, d);
  };
  walkJsx(node, 0);
  return best;
}

function routeChildExpression(el: ts.Node, sf: ts.SourceFile): ts.Node | undefined {
  if (!ts.isJsxElement(el)) return undefined;
  for (const c of el.children) {
    if (ts.isJsxText(c) && !normText(c.text)) continue;
    if (ts.isJsxExpression(c) && c.expression) {
      const e = c.expression;
      if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) {
        const b = (e as ts.FunctionLikeDeclaration).body;
        return b && ts.isBlock(b) ? b : b;
      }
      return e;
    }
    if (ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c) || ts.isJsxFragment(c)) return c;
  }
  return undefined;
}

function extractClientRoutesFromFile(
  repoRoot: string,
  absFile: string,
  sf: ts.SourceFile,
  clientRoutes: Set<string>,
  routeTargets: Set<string>,
  routedSurfaces?: Set<string>,
): void {
  const imports = buildImportMap(sf);

  const handle = (
    el: ts.Node,
    open: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  ): void => {
    if (jsxTagName(open, sf) !== "Route") return;
    let routePath: string | undefined;
    for (const attr of open.attributes.properties) {
      if (!ts.isJsxAttribute(attr)) continue;
      if (attrName(attr, sf) !== "path") continue;
      const init = attr.initializer;
      if (!init) continue;
      if (ts.isStringLiteral(init)) routePath = init.text;
      else if (ts.isJsxExpression(init) && init.expression) {
        routePath = canonicalizeArg(init.expression, sf);
      }
    }
    if (routePath === undefined) return;
    clientRoutes.add(routePath);

    // --- route TARGET signature (bypass (c) and (d)) -----------------------
    let renderNode: ts.Node | undefined;
    const componentAttr = attrLiteral(open.attributes, "component", sf);
    let targetIdent: string | undefined;

    if (componentAttr && componentAttr.startsWith("<expr:")) {
      targetIdent = componentAttr.slice(6, -1).trim();
    }
    if (!targetIdent) {
      renderNode = routeChildExpression(el, sf);
      if (renderNode) targetIdent = findTargetIdentifier(renderNode, sf);
    }

    let renderKind: BodyKind = "unknown";
    if (renderNode) {
      renderKind = ts.isBlock(renderNode)
        ? classifyFunctionBody(renderNode.parent, sf)
        : classifyRenderExpression(renderNode, sf);
      if (renderKind === "jsx" && !targetIdent) renderKind = "jsx";
    } else if (componentAttr) {
      renderKind = "jsx";
    }

    let moduleRel = "unresolved";
    let bodyKind: BodyKind = "unknown";
    /* WAVE 2B / BLOCKER 2 — measured on the SAME resolved module as bodyKind. */
    let surfaceCount = -1;
    if (targetIdent) {
      const spec = imports.bySpecifier.get(targetIdent);
      if (spec) {
        const abs = resolveModule(repoRoot, absFile, spec);
        if (abs) {
          moduleRel = relOf(repoRoot, abs);
          bodyKind = classifyModuleComponent(abs, targetIdent);
          surfaceCount = reachableSurface(abs, targetIdent);
        } else {
          moduleRel = `external:${spec}`;
          bodyKind = "unknown";
        }
      } else {
        // Declared in the same file.
        moduleRel = relOf(repoRoot, absFile);
        bodyKind = classifyModuleComponent(absFile, targetIdent);
        surfaceCount = reachableSurface(absFile, targetIdent);
      }
    }

    /* WAVE 2B / BLOCKER 2 — one entry per routed target. `surface=unknown` is
       used when the module could not be resolved or parsed, so an unresolvable
       import can never masquerade as a deliberately emptied page. */
    if (routedSurfaces) {
      routedSurfaces.add(
        [
          routePath,
          `target=${targetIdent ?? "-"}`,
          `module=${moduleRel}`,
          `surface=${surfaceCount < 0 ? "unknown" : surfaceBucket(surfaceCount)}`,
        ].join("\t"),
      );
    }

    routeTargets.add(
      [
        routePath,
        `target=${targetIdent ?? "-"}`,
        `module=${moduleRel}`,
        `render=${renderKind}`,
        `body=${bodyKind}`,
      ].join("\t"),
    );
  };

  visitLive(sf, (node) => {
    if (ts.isJsxElement(node)) handle(node, node.openingElement);
    else if (ts.isJsxSelfClosingElement(node)) handle(node, node);
  });
}

// ===========================================================================
// 3. nav
// ===========================================================================

function extractNavFromFile(sf: ts.SourceFile, nav: Set<string>): void {
  visitLive(sf, (node) => {
    if (!ts.isObjectLiteralExpression(node)) return;
    let hrefVal: string | undefined;
    let labelVal: string | undefined;
    for (const prop of node.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const key = ts.isStringLiteral(prop.name)
        ? prop.name.text
        : ts.isIdentifier(prop.name)
          ? prop.name.text
          : undefined;
      if (key === "href") hrefVal = canonicalizeArg(prop.initializer, sf);
      else if (key === "label") labelVal = canonicalizeArg(prop.initializer, sf);
    }
    if (hrefVal !== undefined && labelVal !== undefined) nav.add(`${hrefVal}\t${labelVal}`);
  });
}

// ===========================================================================
// 4–8. the five new occurrence inventories
// ===========================================================================

/** A stable discriminator for an element: testid → id → name → label → text. */
function elementIdentity(
  el: ts.Node,
  open: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  sf: ts.SourceFile,
): string {
  for (const key of ["data-testid", "id", "name", "value", "aria-label", "title"]) {
    const v = attrLiteral(open.attributes, key, sf);
    if (v !== undefined && v !== "") return `${key}=${v}`;
  }
  const txt = elementText(el, sf);
  if (txt) return `text=${txt.slice(0, 80)}`;
  const cls = attrLiteral(open.attributes, "className", sf);
  if (cls !== undefined && cls !== "" && !cls.startsWith("<expr:")) {
    return `class=${cls.slice(0, 60)}`;
  }
  return "anon";
}

/**
 * WAVE 11 — CONTAINER tags. Their identity must NEVER be derived from the
 * concatenated text of their children, because that makes ADDING a child
 * indistinguishable from REMOVING the whole container. Both real product
 * regressions this fixes were exactly that:
 *   - WAVE 4B: adding a column to the partner roster <table> reported the
 *     whole table as REMOVED (identity was `text=<all cell text>`).
 *   - WAVE 10: adding a 12th tab to SpvDetailTabs.tsx reported
 *     `REMOVED tabs (1)` for the TabsList, which had gained a child.
 */
const TAB_CONTAINER_TAGS = new Set(["TabsList", "Tabs", "TabsContent", "TabPanel"]);

/**
 * Addition-stable structural address of an element: enclosing declaration
 * name + the nearest ancestor JSX tag chain. Adding or removing a CHILD of
 * `el` cannot change this string; only moving `el` itself can.
 */
function jsxStructuralPath(el: ts.Node, sf: ts.SourceFile): string {
  const chain: string[] = [];
  let p: ts.Node | undefined = el.parent;
  while (p && chain.length < 6) {
    if (ts.isJsxElement(p)) chain.push(jsxTagName(p.openingElement, sf));
    p = p.parent;
  }
  chain.reverse();
  let owner = "";
  let q: ts.Node | undefined = el;
  while (q) {
    if (ts.isFunctionDeclaration(q) && q.name) {
      owner = q.name.text;
      break;
    }
    if (ts.isVariableDeclaration(q) && ts.isIdentifier(q.name)) {
      owner = q.name.text;
      break;
    }
    if (
      (ts.isMethodDeclaration(q) || ts.isPropertyAssignment(q)) &&
      ts.isIdentifier(q.name)
    ) {
      owner = q.name.text;
      break;
    }
    q = q.parent;
  }
  return `${owner || "-"}:${chain.join(">")}`;
}

/**
 * Identity for a container element. Attribute discriminators first (stable by
 * construction); otherwise the structural address plus an ordinal among
 * same-tag/same-path containers in the file. The ordinal counts EVERY such
 * container, attribute-identified or not, so adding a data-testid to a sibling
 * does not renumber its neighbours.
 */
function containerIdentity(
  el: ts.Node,
  open: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  sf: ts.SourceFile,
  tag: string,
  counters: Map<string, number>,
): string {
  const pathKey = `${tag}\u0000${jsxStructuralPath(el, sf)}`;
  const ord = (counters.get(pathKey) ?? 0) + 1;
  counters.set(pathKey, ord);
  /* Same discriminator order as elementIdentity, INCLUDING `value` — a
     <TabsContent value="config"> keyed on its ordinal instead of its value was
     renumbered when WAVE 9 inserted the fee-schedules panel above it, and the
     guard reported the config panel as removed. An attribute key is immune to
     insertion; the ordinal is the last resort only. */
  for (const key of ["data-testid", "id", "name", "value", "aria-label", "title"]) {
    const v = attrLiteral(open.attributes, key, sf);
    if (v !== undefined && v !== "") return `${key}=${v}`;
  }
  return `at=${jsxStructuralPath(el, sf)}#${ord}`;
}

/**
 * One token per direct child, in source order, plus the tags rendered INSIDE
 * conditional/mapped expression children.
 *
 * The expression token is deliberately OPAQUE (`{expr}`). An earlier version
 * joined every descendant tag into the token — `{div,Label,Input,Button}` —
 * which is the very defect this wave exists to remove, one level down: adding
 * a field inside a mapped row rewrote the token, so the container's child
 * record vanished and the guard called it a removal. The descendant tags are
 * returned separately in `inner` and become their own membership records, so
 * an addition inside a map is additive and a removal still disappears.
 */
function childTokens(
  el: ts.Node,
  sf: ts.SourceFile,
): { seq: string[]; inner: string[] } {
  if (!ts.isJsxElement(el)) return { seq: [], inner: [] };
  const seq: string[] = [];
  const inner: string[] = [];
  for (const c of el.children) {
    if (ts.isJsxElement(c)) seq.push(jsxTagName(c.openingElement, sf));
    else if (ts.isJsxSelfClosingElement(c)) seq.push(jsxTagName(c, sf));
    else if (ts.isJsxText(c) && normText(c.text)) seq.push("#text");
    else if (ts.isJsxExpression(c) && c.expression) {
      visitLive(c.expression, (n) => {
        if (ts.isJsxElement(n)) inner.push(jsxTagName(n.openingElement, sf));
        else if (ts.isJsxSelfClosingElement(n)) inner.push(jsxTagName(n, sf));
      });
      seq.push("{expr}");
    }
  }
  return { seq, inner };
}

/**
 * MEMBERSHIP records for a container's children: one line per child, with a
 * per-token multiplicity ordinal so cardinality is still enforced (dropping
 * the 6th of six TableCells removes `child=TableCell#6`) while appending a
 * seventh only ADDS `child=TableCell#7`. Plus a single `childorder=` line that
 * guard.ts compares as a subsequence, so reordering is still caught and
 * insertion is not.
 */
function childMembershipRecords(
  prefix: string,
  tokens: { seq: readonly string[]; inner: readonly string[] },
): string[] {
  const out: string[] = [];
  const mult = new Map<string, number>();
  for (const t of tokens.seq) {
    const k = (mult.get(t) ?? 0) + 1;
    mult.set(t, k);
    out.push(`${prefix}\tchild=${t}#${k}`);
  }
  /* Tags rendered inside expression children, as an unordered multiset: their
     position depends on branch/callback shape, but their PRESENCE is the
     functionality. Sorting first keeps the multiplicity ordinal stable when an
     unrelated sibling branch is added. */
  const innerMult = new Map<string, number>();
  for (const t of [...tokens.inner].sort()) {
    const k = (innerMult.get(t) ?? 0) + 1;
    innerMult.set(t, k);
    out.push(`${prefix}\tinner=${t}#${k}`);
  }
  out.push(`${prefix}\tchildorder=${tokens.seq.join("|")}`);
  return out;
}

/** Digest of the direct child ELEMENT sequence — the "panel body" shape. */
function childSequenceDigest(el: ts.Node, sf: ts.SourceFile): { n: number; d: string } {
  if (!ts.isJsxElement(el)) return { n: 0, d: digest("") };
  const seq: string[] = [];
  for (const c of el.children) {
    if (ts.isJsxElement(c)) seq.push(jsxTagName(c.openingElement, sf));
    else if (ts.isJsxSelfClosingElement(c)) seq.push(jsxTagName(c, sf));
    else if (ts.isJsxText(c) && normText(c.text)) seq.push("#text");
    else if (ts.isJsxExpression(c) && c.expression) {
      // A mapped list renders whatever the callback returns — record the
      // returned element tag so a deleted cell inside a map is still visible.
      const inner: string[] = [];
      visitLive(c.expression, (n) => {
        if (ts.isJsxElement(n)) inner.push(jsxTagName(n.openingElement, sf));
        else if (ts.isJsxSelfClosingElement(n)) inner.push(jsxTagName(n, sf));
      });
      seq.push(inner.length ? `{${inner.join(",")}}` : "{expr}");
    }
  }
  return { n: seq.length, d: digest(seq.join("|")) };
}

interface OccurrenceSets {
  tabs: Set<string>;
  buttons: Set<string>;
  events: Set<string>;
  copy: Set<string>;
  panels: Set<string>;
}

function extractOccurrencesFromFile(
  rel: string,
  sf: ts.SourceFile,
  out: OccurrenceSets,
): void {
  /* WAVE 11 — ordinals are per FILE and per (tag, structural path), assigned
     in source order, so they are deterministic across runs. */
  const containerOrdinals = new Map<string, number>();
  const handle = (
    el: ts.Node,
    open: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  ): void => {
    const tag = jsxTagName(open, sf);

    // 4. tabs
    if (TAB_TAGS.has(tag)) {
      const value = attrLiteral(open.attributes, "value", sf) ?? "-";
      /* WAVE 11 — a tab CONTAINER (TabsList / TabsContent / Tabs) must not be
         keyed on the concatenated text of its children: adding a tab changed
         the key and the guard reported the container as REMOVED. Leaf triggers
         keep their own visible label, which is their functionality. Text
         removal inside a container is still caught by the `copy` class, which
         records every text node individually. */
      const label = TAB_CONTAINER_TAGS.has(tag)
        ? attrLiteral(open.attributes, "aria-label", sf) ||
          `at=${jsxStructuralPath(el, sf)}`
        : elementText(el, sf) || attrLiteral(open.attributes, "label", sf) || "-";
      out.tabs.add(`${rel}\t${tag}\t${value}\t${label}`);
    }

    // 5. buttons
    const role = attrLiteral(open.attributes, "role", sf);
    if (BUTTON_TAGS.has(tag) || role === "button") {
      out.buttons.add(`${rel}\t${tag}\t${elementIdentity(el, open, sf)}`);
    }

    // 6. events
    for (const a of open.attributes.properties) {
      if (!ts.isJsxAttribute(a)) continue;
      const n = attrName(a, sf);
      if (!/^on[A-Z]/.test(n)) continue;
      const init = a.initializer;
      let handler = "-";
      if (init && ts.isJsxExpression(init) && init.expression) {
        const e = init.expression;
        handler =
          ts.isIdentifier(e) || ts.isPropertyAccessExpression(e)
            ? normText(e.getText(sf))
            : `expr:${digest(normText(e.getText(sf)))}`;
      }
      out.events.add(`${rel}\t${tag}\t${n}\t${handler}`);
    }

    // 7. copy — literal attribute copy
    for (const a of open.attributes.properties) {
      if (!ts.isJsxAttribute(a)) continue;
      const n = attrName(a, sf);
      if (!COPY_ATTRS.has(n)) continue;
      const v = attrLiteral(open.attributes, n, sf);
      if (v && !v.startsWith("<expr:")) out.copy.add(`${rel}\t${n}\t${v}`);
    }

    // 8. panels — WAVE 11: child-SET membership, not a concatenated digest.
    if (PANEL_TAGS.has(tag) && ts.isJsxElement(el)) {
      const prefix = `${rel}\t${tag}\t${containerIdentity(el, open, sf, tag, containerOrdinals)}`;
      for (const line of childMembershipRecords(prefix, childTokens(el, sf))) {
        out.panels.add(line);
      }
    }
  };

  visitLive(sf, (node) => {
    if (ts.isJsxElement(node)) handle(node, node.openingElement);
    else if (ts.isJsxSelfClosingElement(node)) handle(node, node);
    // 7. copy — rendered text nodes
    else if (ts.isJsxText(node)) {
      const t = normText(node.text);
      if (t.length >= 2 && /[A-Za-z0-9]/.test(t)) out.copy.add(`${rel}\ttext\t${t}`);
    }
  });
}

// ===========================================================================
// File listings
// ===========================================================================

export function listServerFiles(repoRoot: string): string[] {
  const out: string[] = [];
  walk(path.join(repoRoot, "server"), repoRoot, (rel) => /\.ts$/.test(rel) && !/\.tsx$/.test(rel), out);
  return out.sort();
}

export function listClientTsxFiles(repoRoot: string): string[] {
  const out: string[] = [];
  walk(path.join(repoRoot, "client", "src"), repoRoot, (rel) => /\.tsx$/.test(rel), out);
  return out.sort();
}

export function listShellFiles(repoRoot: string): string[] {
  const out: string[] = [];
  walk(
    path.join(repoRoot, "client", "src"),
    repoRoot,
    (rel) => /Shell.*\.tsx$/.test(path.basename(rel)),
    out,
  );
  return out.sort();
}

// ===========================================================================
// Public extraction API
// ===========================================================================

export function extractRoutes(repoRoot: string): string[] {
  const routes = new Set<string>();
  for (const file of listServerFiles(repoRoot)) extractRoutesFromFile(parseSource(file), routes);
  return sortedUnique(routes);
}

export function extractClientRoutes(repoRoot: string): string[] {
  const clientRoutes = new Set<string>();
  const routeTargets = new Set<string>();
  for (const file of listClientTsxFiles(repoRoot)) {
    extractClientRoutesFromFile(repoRoot, file, parseSource(file), clientRoutes, routeTargets);
  }
  return sortedUnique(clientRoutes);
}

export function extractRouteTargets(repoRoot: string): string[] {
  const clientRoutes = new Set<string>();
  const routeTargets = new Set<string>();
  for (const file of listClientTsxFiles(repoRoot)) {
    extractClientRoutesFromFile(repoRoot, file, parseSource(file), clientRoutes, routeTargets);
  }
  return sortedUnique(routeTargets);
}

/** WAVE 2B / BLOCKER 2 — routed-surface signatures, standalone. */
export function extractRoutedSurfaces(repoRoot: string): string[] {
  const clientRoutes = new Set<string>();
  const routeTargets = new Set<string>();
  const routedSurfaces = new Set<string>();
  for (const file of listClientTsxFiles(repoRoot)) {
    extractClientRoutesFromFile(
      repoRoot,
      file,
      parseSource(file),
      clientRoutes,
      routeTargets,
      routedSurfaces,
    );
  }
  return sortedUnique(routedSurfaces);
}

export function extractNav(repoRoot: string): string[] {
  const nav = new Set<string>();
  for (const file of listShellFiles(repoRoot)) extractNavFromFile(parseSource(file), nav);
  return sortedUnique(nav);
}

export function extractOccurrences(repoRoot: string): {
  tabs: string[];
  buttons: string[];
  events: string[];
  copy: string[];
  panels: string[];
} {
  const sets: OccurrenceSets = {
    tabs: new Set(),
    buttons: new Set(),
    events: new Set(),
    copy: new Set(),
    panels: new Set(),
  };
  for (const file of listClientTsxFiles(repoRoot)) {
    extractOccurrencesFromFile(relOf(repoRoot, file), parseSource(file), sets);
  }
  return {
    tabs: sortedUnique(sets.tabs),
    buttons: sortedUnique(sets.buttons),
    events: sortedUnique(sets.events),
    copy: sortedUnique(sets.copy),
    panels: sortedUnique(sets.panels),
  };
}

/**
 * Build the full eight-class inventory (plus routeTargets) for `repoRoot`.
 * One traversal per file class; the parse cache is reset first so repeated
 * calls against a mutated fixture tree are correct.
 */
export function buildInventory(repoRoot: string): Required<Inventory> {
  resetSourceCache();

  const routes = new Set<string>();
  for (const file of listServerFiles(repoRoot)) extractRoutesFromFile(parseSource(file), routes);

  const clientRoutes = new Set<string>();
  const routeTargets = new Set<string>();
  const routedSurfaces = new Set<string>();
  const occ: OccurrenceSets = {
    tabs: new Set(),
    buttons: new Set(),
    events: new Set(),
    copy: new Set(),
    panels: new Set(),
  };
  for (const file of listClientTsxFiles(repoRoot)) {
    const sf = parseSource(file);
    extractClientRoutesFromFile(repoRoot, file, sf, clientRoutes, routeTargets, routedSurfaces);
    extractOccurrencesFromFile(relOf(repoRoot, file), sf, occ);
  }

  const nav = new Set<string>();
  for (const file of listShellFiles(repoRoot)) extractNavFromFile(parseSource(file), nav);

  return {
    routes: sortedUnique(routes),
    clientRoutes: sortedUnique(clientRoutes),
    nav: sortedUnique(nav),
    tabs: sortedUnique(occ.tabs),
    buttons: sortedUnique(occ.buttons),
    events: sortedUnique(occ.events),
    copy: sortedUnique(occ.copy),
    panels: sortedUnique(occ.panels),
    routeTargets: sortedUnique(routeTargets),
    routedSurfaces: sortedUnique(routedSurfaces),
  };
}
