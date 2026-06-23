/**
 * v25.20 Lane 3 — Vitest CJS require() resolution shim (TEST SCAFFOLDING ONLY).
 *
 * Many production store modules use a lazy `require("./someModule")` to break
 * import cycles (e.g. server/lib/storePersistenceShim, server/captableCommitStore,
 * server/lib/sessionCookie, …). Under `tsx`/production-bundle these resolve fine
 * because the toolchain knows about the `.ts` extension. Under Vitest, however,
 * those `require()` calls fall through to Node's *native* CJS loader, which has
 * no `.ts` resolver registered — so they throw
 *
 *     Error: Cannot find module './storePersistenceShim'
 *
 * which surfaced as silent non-fatal hydrate warnings AND as hard 500s on routes
 * (see server/lib/userContext.ts). That broke the carry-forward / SAFE / cap-table
 * suites for reasons unrelated to the code under test.
 *
 * This shim teaches Node's CJS resolver to retry a failed relative resolution
 * with `.ts` / `.tsx` / `.js` extensions, then hands the actual loading to
 * Vitest's transform pipeline (which is already registered for `.ts`). It is
 * loaded via vitest.config.ts `setupFiles`, so it ONLY affects the test runtime
 * and never ships to production.
 */
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require("node:module") as typeof import("node:module");

const EXT_CANDIDATES = [".ts", ".tsx", ".js", ".mjs", ".cjs", "/index.ts", "/index.tsx", "/index.js"];

const _origResolve = (Module as any)._resolveFilename;

(Module as any)._resolveFilename = function patched(
  request: string,
  parent: any,
  ...rest: any[]
): string {
  try {
    return _origResolve.call(this, request, parent, ...rest);
  } catch (err) {
    // Only attempt to repair *relative* requests; leave bare specifiers
    // (node_modules packages, node: builtins) to the original resolver.
    if (request.startsWith(".") && parent && parent.filename) {
      const baseDir = path.dirname(parent.filename);
      const abs = path.resolve(baseDir, request);
      for (const ext of EXT_CANDIDATES) {
        const candidate = abs + ext;
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }
    throw err;
  }
};

export {};
