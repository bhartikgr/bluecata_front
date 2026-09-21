/**
 * Generate `shared/notificationRouteManifest.ts` from the ACTUAL client route
 * table (`client/src/App.tsx`) using the TypeScript AST — every `<Route
 * path="…">` JSX attribute whose value is a string literal. Nothing is
 * inferred; a `<Route>` without a string `path` (the fallback) contributes
 * nothing.
 *
 * 2026-09-19 · slide 13a hardening: the notification destination classifier
 * may attribute a link to a persona shell ONLY when the path matches a
 * mounted route pattern. A shell-prefixed path that no route mounts falls to
 * the app-level `NotFoundOrLogin` (outside every shell), so classifying it by
 * prefix would send a persona to a page without their navigation — the very
 * defect this wave repairs. The manifest is plain data in `shared/` so the
 * server never imports the client app at runtime.
 *
 *   npx tsx scripts/generate-notification-route-manifest.ts          # write
 *   npx tsx scripts/generate-notification-route-manifest.ts --check  # rc 1 on drift
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
export const APP_TSX = path.join(ROOT, "client/src/App.tsx");
export const MANIFEST_TS = path.join(ROOT, "shared/notificationRouteManifest.ts");

/** Pure extraction: string-literal `path` attributes of `<Route>` JSX elements. */
export function extractRoutePatterns(source: string, fileName = "App.tsx"): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf);
      if (tag === "Route") {
        for (const attr of node.attributes.properties) {
          if (!ts.isJsxAttribute(attr)) continue;
          if (attr.name.getText(sf) !== "path" || !attr.initializer) continue;
          const init = attr.initializer;
          if (ts.isStringLiteral(init)) out.add(init.text);
          else if (ts.isJsxExpression(init) && init.expression && ts.isStringLiteralLike(init.expression)) out.add(init.expression.text);
          /* any other initializer (identifier, template with holes) is NOT a
             static pattern; it is deliberately not guessed. */
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return [...out].sort();
}

export function renderManifest(patterns: readonly string[]): string {
  const body = patterns.map((p) => `  ${JSON.stringify(p)},`).join("\n");
  return `/* GENERATED FILE — DO NOT EDIT BY HAND.
 * Source: client/src/App.tsx  (every <Route path="…"> string literal, via the TypeScript AST)
 * Generator: scripts/generate-notification-route-manifest.ts   (\`--check\` fails on drift)
 * Parity test: shared/__tests__/notification_persona_2026_09_19_route_manifest.test.ts
 *
 * The notification destination classifier (shared/notificationDestination.ts)
 * attributes a link to a persona shell ONLY when the path matches one of these
 * mounted patterns. Pattern grammar (wouter): literal segments, \`:param\`
 * (exactly one non-empty segment), \`:param?\` (optional), \`:param*\` / \`:param+\`
 * (rest). ${patterns.length} patterns.
 */
export const CLIENT_ROUTE_PATTERNS: readonly string[] = Object.freeze([
${body}
]);
`;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const patterns = extractRoutePatterns(fs.readFileSync(APP_TSX, "utf8"));
  const rendered = renderManifest(patterns);
  if (process.argv.includes("--check")) {
    const cur = fs.existsSync(MANIFEST_TS) ? fs.readFileSync(MANIFEST_TS, "utf8") : "";
    if (cur !== rendered) {
      console.error(`notificationRouteManifest DRIFT: ${path.relative(ROOT, MANIFEST_TS)} does not match ${path.relative(ROOT, APP_TSX)} (${patterns.length} patterns). Re-run the generator.`);
      process.exit(1);
    }
    console.log(`notificationRouteManifest in sync (${patterns.length} patterns).`);
  } else {
    fs.writeFileSync(MANIFEST_TS, rendered);
    console.log(`wrote ${path.relative(ROOT, MANIFEST_TS)} (${patterns.length} patterns)`);
  }
}
