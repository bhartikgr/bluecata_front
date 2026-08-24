#!/usr/bin/env tsx
/**
 * scripts/silent-drop-guard/w121_route_census.ts
 *
 * WAVE 121 · FINDING 1 — the route-registration census, run with the guard's OWN
 * exported walker and resolver (the same instrument Reviewer A used, kept in the
 * tree this time so the number can be re-measured instead of remembered).
 *
 * For every `app.<method>(…)` registration in `server/**.ts` whose first
 * argument is NOT a plain string / no-substitution template literal, it reports:
 *
 *   registrations  — how many such registrations exist
 *   resolved       — how many `resolveRoutePaths` can reduce to concrete paths
 *   opaqueOnly     — how many stay unreadable
 *   bareTokens     — DISTINCT bare `<expr:…>` tokens they produce (the pre-121
 *                    id space; fewer than `registrations` means COLLISIONS)
 *   collisions     — bare tokens produced by more than one registration
 *   uniqueIds      — DISTINCT collision-proof ids (must equal `registrations`)
 *
 * Usage: npx tsx scripts/silent-drop-guard/w121_route_census.ts [root]
 */
import * as ts from "typescript";
import * as path from "node:path";
import {
  listServerFiles,
  resolveRoutePaths,
  visitLive,
  extractRoutes,
  resetSourceCache,
} from "./extract-inventory.ts";
import * as fs from "node:fs";

const root = path.resolve(process.argv[2] ?? process.cwd());

/* The FIVE methods `extract-inventory.ts` inventories (its own `HTTP_METHODS`).
   `app.use` / `app.all` / `app.options` / `app.head` are outside the route
   inventory by design and are counted separately below, not silently merged —
   Reviewer A's census of 49 used the wider set. */
const HTTP = new Set(["get", "post", "put", "patch", "delete"]);
const HTTP_WIDER = new Set(["options", "head", "all", "use"]);
let widerRegistrations = 0;

let registrations = 0;
let resolved = 0;
const bare = new Map<string, number>();
const rows: string[] = [];

for (const file of listServerFiles(root)) {
  const sf = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf-8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  visitLive(sf, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    const method = node.expression.name.text.toLowerCase();
    if (node.expression.expression.getText(sf) !== "app") return;
    if (node.arguments.length < 1) return;
    const arg0 = node.arguments[0];
    if (ts.isStringLiteral(arg0) || ts.isNoSubstitutionTemplateLiteral(arg0)) return;
    if (HTTP_WIDER.has(method)) {
      widerRegistrations += 1;
      return;
    }
    if (!HTTP.has(method)) return;
    const arg = arg0;
    registrations += 1;
    const M = method.toUpperCase();
    const token = `${M} <expr:${arg.getText(sf).replace(/\s+/g, " ").trim()}>`;
    bare.set(token, (bare.get(token) ?? 0) + 1);
    const r = resolveRoutePaths(arg, node, sf);
    if (r) resolved += 1;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    rows.push(
      `${r ? "RESOLVED  " : "OPAQUEONLY"} ${path.relative(root, file)}:${line + 1} ${token}` +
        (r ? ` -> ${r.join(", ")}` : ""),
    );
  });
}

resetSourceCache();
const all = extractRoutes(root);
resetSourceCache();
const uniqueIds = all.filter((id) => / @[^#]+#[0-9a-f]{12}>$/.test(id)).length;
const collisions = [...bare.entries()].filter(([, n]) => n > 1);

for (const row of rows.sort()) console.log(row);
console.log("");
console.log(`registrations = ${registrations}   (the five methods the inventory covers)`);
console.log(`app.use/all/options/head with a non-literal first arg = ${widerRegistrations}  (not inventoried, by design)`);
console.log(`resolved      = ${resolved}`);
console.log(`opaqueOnly    = ${registrations - resolved}`);
console.log(`bareTokens    = ${bare.size}  (distinct pre-WAVE-121 ids)`);
console.log(`collisions    = ${collisions.length}  ${JSON.stringify(collisions)}`);
console.log(`uniqueIds     = ${uniqueIds}  (collision-proof ids; must equal registrations)`);
console.log(`routes total  = ${all.length}`);
if (uniqueIds !== registrations) {
  console.error("CENSUS FAIL: collision-proof ids do not cover every registration one-to-one");
  process.exit(1);
}
