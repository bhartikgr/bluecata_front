/**
 * Capavate — static + SPA fallback
 *
 * Patch v11 (B-V11-3): The production bundle is emitted as CJS by esbuild
 * (see script/build.ts), but the dev runtime is ESM via tsx. esbuild warns
 * that `import.meta` is unavailable in CJS output, so the previous
 * `fileURLToPath(import.meta.url)` resolved to undefined at production
 * runtime — which broke `NODE_ENV=production node dist/index.cjs` with
 * "Could not find the build directory: undefined/public".
 *
 * Dual-mode resolution: prefer CJS-native `__dirname` when it exists
 * (production bundle), fall back to ESM `import.meta.url` for dev/tsx.
 */
import express from 'express';
import type { Express, Request, Response } from 'express';
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Patch v11 dual-mode resolver for the static-asset directory.
 *
 * In dev (tsx, ESM), `import.meta.url` is a valid file URL. In the
 * production CJS bundle (esbuild output dist/index.cjs), `import.meta.url`
 * is replaced with an empty string and `__dirname` is the real bundle dir.
 * We pick whichever is available without referencing `__dirname` directly
 * at the TypeScript layer (so ESM dev type-checking stays clean).
 */
// CJS path: esbuild injects `__dirname` as a module-scope binding in the
// emitted CJS bundle. We reference it via an ambient declaration so the
// TypeScript compiler accepts the name in ESM dev (tsx) too — the runtime
// `typeof __dirname !== "undefined"` guard short-circuits before any
// ReferenceError can fire in ESM. esbuild keeps the typeof guard as-is
// during minification (typeof on an undeclared identifier is legal JS).
//
// Resolved once at module load.
declare const __dirname: string | undefined;
const BUNDLE_DIR: string = (() => {
  if (typeof __dirname === "string" && __dirname.length > 0) return __dirname;
  try {
    const metaUrl = (import.meta as { url?: string }).url ?? "";
    if (metaUrl) return path.dirname(fileURLToPath(metaUrl));
  } catch { /* CJS without import.meta — fall through */ }
  // Last-resort fallback so a misconfigured runtime fails loudly with a
  // sensible path rather than `undefined/public`.
  return path.resolve(process.cwd(), "dist");
})();

export function serveStatic(app: Express) {
  const __dirname = BUNDLE_DIR;

  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // Patch v11 (B-V11-3): Express 5 ships path-to-regexp 6+, which rejects
  // bare "*" wildcards ("Missing parameter name at index 6: /api/*"). The
  // prefix-style middleware mount below is the Express-5-compatible way to
  // catch unhandled /api/* requests — every preceding API handler will have
  // already responded, so this only fires for unmatched paths.
  app.use("/api", (req: Request, res: Response) => {
    res.status(404).json({
      ok: false,
      error: "API_ROUTE_NOT_FOUND",
      message: `No API handler registered for ${req.method} ${req.path}`,
      path: req.path,
    });
  });

  // SPA fallback for everything else. Use a Express-5-safe named wildcard
  // so path-to-regexp doesn't reject the route at registration time.
  app.use((_req: Request, res: Response) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}