/**
 * WAVE 24 — shared reachability engine for the falsification harnesses.
 *
 * THE RULE IT MECHANISES (brief, Rule 3): "an engine with no route, or a
 * component mounted nowhere, is NOT shipped." FINAL REVIEW B found eleven
 * endpoints whose only problem was that no reachable client file ever called
 * them. Wiring them is only half the job — the other half is a check that
 * would GO RED if the wiring were removed, which is what this module exists
 * to make possible.
 *
 * WHY AN IMPORT GRAPH AND NOT A GREP. A grep for the URL passes the moment the
 * string appears ANYWHERE — including in a component that nothing mounts,
 * which is precisely the defect being fixed. Twelve checks in this build
 * passed while checking nothing; a grep-only reachability check would have
 * been the thirteenth. So: resolve the import graph from the real application
 * root (`client/src/App.tsx`, itself reached from `main.tsx`) and count a
 * caller only if its file is in the transitive closure.
 *
 * WHAT IT DOES NOT CLAIM. Reachability of the MODULE, not of the rendered
 * subtree. A component that is imported but rendered behind `false` would
 * still count here. That limit is stated rather than hidden; each harness
 * separately asserts the mount-site JSX exists, which covers the gap for the
 * specific mounts Wave 24 adds.
 */
import fs from "node:fs";
import path from "node:path";

const CLIENT_SRC = path.join(process.cwd(), "client", "src");
const EXTS = [".tsx", ".ts", ".jsx", ".js"];

/** Resolve a module specifier the way the Vite alias config does. */
export function resolveSpecifier(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(CLIENT_SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null; // node_modules / bare package — not part of the app graph
  for (const e of EXTS) {
    if (fs.existsSync(base + e) && fs.statSync(base + e).isFile()) return base + e;
  }
  if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
    for (const e of EXTS) {
      const idx = path.join(base, "index" + e);
      if (fs.existsSync(idx)) return idx;
    }
  }
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  return null;
}

const SPEC_RE = /(?:from\s*|import\s*\(\s*)["']([^"']+)["']/g;

/** Every module specifier a file imports, static or dynamic. */
export function specifiersOf(file: string): string[] {
  const src = fs.readFileSync(file, "utf8");
  const out: string[] = [];
  for (const m of src.matchAll(SPEC_RE)) out.push(m[1]);
  return out;
}

/**
 * Transitive closure of imports from the application root.
 * Returns absolute paths.
 */
export function reachableFiles(roots = [path.join(CLIENT_SRC, "main.tsx"), path.join(CLIENT_SRC, "App.tsx")]): Set<string> {
  const seen = new Set<string>();
  const stack = roots.filter((r) => fs.existsSync(r));
  while (stack.length > 0) {
    const f = stack.pop() as string;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const spec of specifiersOf(f)) {
      const r = resolveSpecifier(f, spec);
      if (r && !seen.has(r)) stack.push(r);
    }
  }
  return seen;
}

/** Files (relative to repo root) in the reachable set that contain `token`. */
export function reachableCallers(token: string, reachable: Set<string>): string[] {
  const hits: string[] = [];
  for (const f of reachable) {
    let src: string;
    try {
      src = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    if (src.includes(token)) hits.push(path.relative(process.cwd(), f));
  }
  return hits.sort();
}

/** Same, but over ALL of client/src regardless of reachability. */
export function allClientFilesContaining(token: string): string[] {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "__tests__") continue;
        walk(p);
      } else if (EXTS.some((x) => e.name.endsWith(x))) {
        if (fs.readFileSync(p, "utf8").includes(token)) hits.push(path.relative(process.cwd(), p));
      }
    }
  };
  walk(CLIENT_SRC);
  return hits.sort();
}

export { CLIENT_SRC };
