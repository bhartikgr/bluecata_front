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

/**
 * @param publicDirOverride  Test-only seam. Production callers pass nothing and
 *   get the historical behaviour exactly: `<bundle dir>/public`. It exists so
 *   the dotfile guard below can be proved against a throwaway directory instead
 *   of planting a fake secret inside the real, shippable `server/public` — this
 *   project has previously left a fence-defeating fixture in the shipped tree,
 *   and `process.chdir` is unavailable inside the test runner's workers.
 */
export function serveStatic(app: Express, publicDirOverride?: string) {
  const __dirname = BUNDLE_DIR;

  const distPath = publicDirOverride ?? path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  /* ══════════════════════════════════════════════════════════════════════════
     W109 · NO DOTFILE IS EVER SERVED FROM THE PUBLIC DIRECTORY.

     MEASURED ON PRODUCTION, 2026-08-22: `GET https://capavate.com/.env`
     returned HTTP 200 with 1,451 bytes of real environment file, as
     `application/octet-stream`, beginning "# --- Runtime (PRODUCTION mode)".
     It listed 30 configuration values, among them the session secret, the SMTP
     password, the payment gateway API key and its webhook secret, the bridge
     inbound HMAC secret, and an AWS access key pair. A request for a path that
     does not exist returned the 956-byte SPA shell instead, which is how we know
     a REAL FILE was being served rather than the fallback.

     HOW IT HAPPENED. `express.static` serves dotfiles by default, and a `.env`
     had come to sit inside the directory this function publishes. Nothing in the
     application intended it; nothing warned about it; the platform reported
     itself healthy throughout. The stray file must be removed from the host as
     well — that is a deploy action, recorded in the runbook — but the
     application must never depend on the served directory being clean.

     WHY TWO LAYERS. The guard below refuses dot-segments before the static
     handler ever looks at the filesystem, and the static handler is
     independently configured to deny them. Either alone would have prevented
     this; a single layer is what we had.

     WHY 404 AND NOT 403. A 403 confirms the file exists. A request for a secret
     should learn nothing at all, so this answers exactly as it would for any
     path that is not there.

     THE ONE EXCEPTION is `/.well-known/`, which is a public, standardised path
     used for certificate issuance and domain verification. It is allow-listed
     deliberately and narrowly. Nothing else beginning with a dot is served.
     ══════════════════════════════════════════════════════════════════════════ */
  const WELL_KNOWN_SEGMENT = ".well-known";

  app.use((req: Request, res: Response, next: express.NextFunction) => {
    /* ── Build the string we TEST against. It is never the string we SERVE. ──

       Three transformations, in this order, each for a reason an independent
       reviewer demonstrated:

       1. DECODE REPEATEDLY, bounded. One pass catches `%2e%65nv`. A second
          catches `%252eenv`, which decodes to `%2eenv` and would otherwise pass
          a single-pass test. Bounded at three passes so a hostile input cannot
          make this loop for ever. A malformed escape is itself grounds to refuse.

       2. NORMALISE UNICODE (NFKC). A reviewer defeated the first version of this
          guard with a file named `．env`, using U+FF0E FULLWIDTH FULL STOP
          instead of an ASCII dot: HTTP 200, secret returned. It was not an
          encoding alias for the real ASCII `.env`, so production was never
          exposed through it — but the promise above says NO dotfile is served,
          and a name that reads as a dotfile to a human must be treated as one.
          NFKC folds the fullwidth stop, and its siblings, onto `.`.

       3. STRIP TRAILING DOTS AND SPACES per segment. Some filesystems resolve
          `foo.` and `foo ` to `foo`.

       Serving still happens from `req.path` via `express.static`, so this
       normalisation cannot itself be used to reach a different file. ────── */
    let probe = req.path;
    try {
      for (let pass = 0; pass < 3; pass++) {
        const next = decodeURIComponent(probe);
        if (next === probe) break;
        probe = next;
      }
    } catch {
      res.status(404).type("text/plain").send("Not found");
      return;
    }
    probe = probe.normalize("NFKC");

    /* Traversal, in any spelling, is refused outright. */
    if (probe.includes("..")) {
      res.status(404).type("text/plain").send("Not found");
      return;
    }

    /* ── `.well-known` IS THE ONLY DOT SEGMENT THAT MAY EVER APPEAR. ───────

       The first version of this guard returned `next()` as soon as the path
       began `/.well-known/`, WITHOUT testing the rest of it. An independent
       reviewer then fetched `GET /.well-known/.env` and got HTTP 200 and the
       planted secret — a hole of precisely the class this guard exists to close,
       sitting inside the one exception the guard grants.

       So the allow-list is expressed as a property of a SEGMENT, not a prefix:
       every segment is tested, and `.well-known` is the single permitted
       exception. `/.well-known/.env` therefore has a forbidden second segment and
       is refused, while `/.well-known/probe` is served. ───────────────── */
    const segments = probe.split(/[/\\]/).map((s) => s.replace(/[.\s]+$/, ""));

    const hasForbiddenDotSegment = segments.some(
      (segment) =>
        segment.startsWith(".") &&
        segment !== "" &&
        segment !== "." &&
        segment !== ".." &&
        segment !== WELL_KNOWN_SEGMENT,
    );

    if (hasForbiddenDotSegment) {
      res.status(404).type("text/plain").send("Not found");
      return;
    }

    next();
  });

  /* The allow-listed exception, mounted BEFORE the denying handler so it is the
     only dot path that can ever resolve. Scoped to this one subtree, and to a
     directory that need not exist — `express.static` simply passes control on
     when it does not, so production is unaffected if nothing publishes here. */
  app.use(
    `/${WELL_KNOWN_SEGMENT}`,
    /* `deny`, not `allow`. Mounted here, the static handler sees only the path
       BELOW `.well-known`, so nothing legitimate in this subtree is a dotfile —
       and a `.env` dropped into it stays unreachable even if the guard above is
       ever loosened. The first version of this line said `allow`, and a reviewer
       walked straight through it. */
    express.static(path.join(distPath, WELL_KNOWN_SEGMENT), { dotfiles: "deny" }),
  );

  app.use(
    express.static(distPath, {
      /* Second, independent layer. `deny` makes the static handler refuse a
         dotfile even if the guard above is ever changed or bypassed. */
      dotfiles: "deny",
    }),
  );

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