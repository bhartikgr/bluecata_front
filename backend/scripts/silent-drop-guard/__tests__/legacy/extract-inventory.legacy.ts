#!/usr/bin/env tsx
/**
 * scripts/silent-drop-guard/extract-inventory.ts
 *
 * Anti-Silent-Drop Build Guard — inventory extractor (v26.1.x, pre-wave).
 *
 * Pure, deterministic, side-effect-free static scanner of the SOURCE tree.
 * It returns three inventories of "primary functionality":
 *
 *   1. routes        — every Express `app.(get|post|put|patch|delete)("<path>"...)`
 *                      registration across server/ **\/*.ts, normalized to
 *                      `METHOD path` (e.g. `POST /api/investors/:id/kyc`).
 *   2. clientRoutes  — every wouter `<Route path="..." ...>` in
 *                      client/src/ **\/*.tsx, normalized to the path string.
 *   3. nav           — every nav item ({ href, label }) in the shell components
 *                      (client/src/components/ **\/*Shell*.tsx), normalized to
 *                      `path\tlabel`.
 *
 * NEVER scans: server/public/** (built asset bundles), node_modules, dist,
 * build, coverage, and any *.test.* / *.spec.* file.
 *
 * Parsing uses the TypeScript compiler API (same approach as
 * scripts/extract-formula-bytes.ts) so multi-line calls, template literals,
 * and non-literal first args are all handled deterministically without regex
 * fragility. Non-string-literal route paths (template literals / identifiers)
 * are preserved verbatim as `<expr:...>` so nothing can ever be silently
 * dropped from tracking.
 *
 * ESM only — no require(). Deterministic: every returned array is sorted and
 * de-duplicated.
 *
 * Usage (library):
 *   import { buildInventory } from "./extract-inventory";
 *   const inv = buildInventory("/abs/path/to/repo");
 */

import * as ts from "typescript";
import * as fs from "node:fs";
import * as path from "node:path";

export interface Inventory {
  routes: string[]; // "METHOD path"
  clientRoutes: string[]; // "path"
  nav: string[]; // "path\tlabel"
}

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);

/** Directory / file segments that must never be scanned. */
const EXCLUDED_DIR_SEGMENTS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".git",
]);

function isExcludedFile(rel: string): boolean {
  const parts = rel.split(path.sep);
  // Never scan built server bundles.
  if (parts[0] === "server" && parts[1] === "public") return true;
  // Never scan any excluded directory segment.
  for (const seg of parts) {
    if (EXCLUDED_DIR_SEGMENTS.has(seg)) return true;
  }
  // Never scan tests / specs.
  const base = parts[parts.length - 1] ?? "";
  if (/\.(test|spec)\.[cm]?tsx?$/.test(base)) return true;
  return false;
}

/** Recursively collect files under `dir` (absolute) that match `predicate`. */
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
  // Sort entries for deterministic traversal order.
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

function parseSource(absPath: string): ts.SourceFile {
  const text = fs.readFileSync(absPath, "utf-8");
  return ts.createSourceFile(
    absPath,
    text,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true,
    absPath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/**
 * Canonicalize a route/path expression into a stable identifier.
 * - String literal            → the literal text (quotes stripped).
 * - No-substitution template  → the template text.
 * - Anything else (template
 *   with ${}, identifier, etc) → `<expr:...>` using the verbatim source text,
 *   so it is preserved and trackable, never silently dropped.
 */
function canonicalizeArg(node: ts.Node, sf: ts.SourceFile): string {
  if (ts.isStringLiteral(node)) {
    return node.text;
  }
  if (ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  // Non-literal (template expression, identifier, member access, etc.).
  const raw = node.getText(sf).replace(/\s+/g, " ").trim();
  return `<expr:${raw}>`;
}

/** Extract server route registrations from a parsed server .ts file. */
function extractRoutesFromFile(sf: ts.SourceFile, routes: Set<string>): void {
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text.toLowerCase();
      const objText = node.expression.expression.getText(sf);
      // Only Express-style `app.<method>(...)` registrations.
      if (objText === "app" && HTTP_METHODS.has(method) && node.arguments.length >= 1) {
        const pathArg = canonicalizeArg(node.arguments[0], sf);
        routes.add(`${method.toUpperCase()} ${pathArg}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

/** Extract wouter <Route path="..."> entries from a parsed client .tsx file. */
function extractClientRoutesFromFile(sf: ts.SourceFile, clientRoutes: Set<string>): void {
  const handleAttrs = (
    tagName: string,
    attrs: ts.JsxAttributes,
  ): void => {
    if (tagName !== "Route") return;
    for (const attr of attrs.properties) {
      if (!ts.isJsxAttribute(attr)) continue;
      if (attr.name.getText(sf) !== "path") continue;
      const init = attr.initializer;
      if (!init) continue;
      if (ts.isStringLiteral(init)) {
        clientRoutes.add(init.text);
      } else if (ts.isJsxExpression(init) && init.expression) {
        clientRoutes.add(canonicalizeArg(init.expression, sf));
      }
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      handleAttrs(node.tagName.getText(sf), node.attributes);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

/**
 * Extract nav items from a parsed shell .tsx file. A nav item is an object
 * literal that has BOTH an `href` and a `label` property (this is exactly the
 * shell NavItem shape and excludes type declarations, search-result hrefs, and
 * other unrelated href usages).
 */
function extractNavFromFile(sf: ts.SourceFile, nav: Set<string>): void {
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
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
      if (hrefVal !== undefined && labelVal !== undefined) {
        nav.add(`${hrefVal}\t${labelVal}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

function sortedUnique(set: Set<string>): string[] {
  return Array.from(set).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** List server .ts source files to scan for route registrations. */
export function listServerFiles(repoRoot: string): string[] {
  const out: string[] = [];
  walk(
    path.join(repoRoot, "server"),
    repoRoot,
    (rel) => /\.ts$/.test(rel) && !/\.tsx$/.test(rel),
    out,
  );
  return out.sort();
}

/** List client .tsx source files to scan for wouter routes. */
export function listClientTsxFiles(repoRoot: string): string[] {
  const out: string[] = [];
  walk(path.join(repoRoot, "client", "src"), repoRoot, (rel) => /\.tsx$/.test(rel), out);
  return out.sort();
}

/** List shell .tsx files (*Shell*.tsx) under client/src for nav extraction. */
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

/** Extract server routes as a sorted, de-duped array of "METHOD path". */
export function extractRoutes(repoRoot: string): string[] {
  const routes = new Set<string>();
  for (const file of listServerFiles(repoRoot)) {
    extractRoutesFromFile(parseSource(file), routes);
  }
  return sortedUnique(routes);
}

/** Extract wouter client routes as a sorted, de-duped array of path strings. */
export function extractClientRoutes(repoRoot: string): string[] {
  const clientRoutes = new Set<string>();
  for (const file of listClientTsxFiles(repoRoot)) {
    extractClientRoutesFromFile(parseSource(file), clientRoutes);
  }
  return sortedUnique(clientRoutes);
}

/** Extract shell nav entries as a sorted, de-duped array of "path\tlabel". */
export function extractNav(repoRoot: string): string[] {
  const nav = new Set<string>();
  for (const file of listShellFiles(repoRoot)) {
    extractNavFromFile(parseSource(file), nav);
  }
  return sortedUnique(nav);
}

/** Build the full inventory for the repo rooted at `repoRoot` (absolute). */
export function buildInventory(repoRoot: string): Inventory {
  return {
    routes: extractRoutes(repoRoot),
    clientRoutes: extractClientRoutes(repoRoot),
    nav: extractNav(repoRoot),
  };
}
