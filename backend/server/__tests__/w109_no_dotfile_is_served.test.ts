/**
 * WAVE 109 — THE PUBLIC DIRECTORY MUST NEVER SERVE A DOTFILE.
 * ════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS. Measured on production on 2026-08-22, while auditing the
 * v26.20.0 release:
 *
 *     GET https://capavate.com/.env
 *       → HTTP 200 · 1,451 bytes · application/octet-stream
 *       → body began "# --- Runtime (PRODUCTION mode) --- NODE_ENV=production"
 *
 * The response listed 30 configuration values. Among them: the session secret,
 * the SMTP password, the payment gateway API key, the payment gateway webhook
 * secret, the bridge inbound HMAC secret, and an AWS access key pair. The
 * payment gateway was in LIVE mode at the time.
 *
 * It was proved to be a real file rather than the single-page-app fallback by
 * comparison in the same minute: `GET /nonexistent.xyz` returned 956 bytes of
 * `text/html` (the app shell), while `/.env` returned 1,451 bytes of
 * `application/octet-stream`. Different length, different type, different
 * handler.
 *
 * CAUSE. `express.static` serves dotfiles unless told otherwise, and a `.env`
 * had come to sit inside the directory `serveStatic` publishes. That file is not
 * in the source tree, so this is not something a reader of the repository could
 * have noticed — which is precisely why the application must not rely on the
 * served directory being clean.
 *
 * WHAT IS ASSERTED HERE. Both layers, independently:
 *   1. the dot-segment guard, including percent-encoded and backslash evasions;
 *   2. `express.static` configured with `dotfiles: "deny"`.
 * Plus the one deliberate exception, `/.well-known/`, which is a public
 * standardised path used for certificate issuance and domain verification.
 *
 * A 404 is asserted rather than a 403 on purpose: a 403 would confirm that the
 * file exists. A request for a secret must learn nothing.
 *
 * THIS TEST MUST FAIL on the code that shipped in v26.20.0. If it ever passes
 * against a build whose `serveStatic` lacks both layers, the test is wrong.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";

import { serveStatic } from "../static";

/** A throwaway public directory containing exactly the files we want to probe. */
let publicRoot: string;
let bundleRoot: string;
let server: Server;
let base: string;

/** The files planted in the served directory. */
const SECRET_BODY = "# --- Runtime (PRODUCTION mode) ---\nSESSION_SECRET=planted-for-this-test-only\n";
const WELL_KNOWN_BODY = "well-known-probe-token";

beforeAll(async () => {
  /* A throwaway directory, passed to `serveStatic` through its test-only seam.
     The planted `.env` therefore NEVER touches the real, shippable
     `server/public` — deliberate: this project has previously left a
     fence-defeating fixture inside the shipped tree. */
  bundleRoot = fs.mkdtempSync(path.join(os.tmpdir(), "w109-"));
  publicRoot = path.join(bundleRoot, "public");
  fs.mkdirSync(publicRoot, { recursive: true });

  fs.writeFileSync(path.join(publicRoot, "index.html"), "<!doctype html><html><body>app shell</body></html>");
  fs.writeFileSync(path.join(publicRoot, "ordinary.txt"), "ordinary asset");
  /* The stray secret, exactly as production had it. */
  fs.writeFileSync(path.join(publicRoot, ".env"), SECRET_BODY);
  /* A nested dotfile directory, the other common exposure. */
  fs.mkdirSync(path.join(publicRoot, ".git"), { recursive: true });
  fs.writeFileSync(path.join(publicRoot, ".git", "config"), "[core]\n  bare = false\n");
  /* A name that READS as a dotfile but uses U+FF0E FULLWIDTH FULL STOP. An
     independent reviewer defeated the first version of this guard with exactly
     this file: HTTP 200, secret returned. */
  fs.writeFileSync(path.join(publicRoot, "\uFF0Eenv"), SECRET_BODY);

  /* The one legitimate dot path. */
  fs.mkdirSync(path.join(publicRoot, ".well-known"), { recursive: true });
  fs.writeFileSync(path.join(publicRoot, ".well-known", "probe"), WELL_KNOWN_BODY);
  /* REVIEWER C's attack: a secret planted INSIDE the one allow-listed subtree.
     The first version of this guard returned 200 and the secret for this path. */
  fs.writeFileSync(path.join(publicRoot, ".well-known", ".env"), SECRET_BODY);
  fs.mkdirSync(path.join(publicRoot, ".well-known", ".git"), { recursive: true });
  fs.writeFileSync(path.join(publicRoot, ".well-known", ".git", "config"), SECRET_BODY);

  const app = express();
  serveStatic(app, publicRoot);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });

  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("test server did not bind a port");
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (bundleRoot) fs.rmSync(bundleRoot, { recursive: true, force: true });
});

/** Fetch and return status, body and content type together. */
async function get(pathname: string) {
  const res = await fetch(`${base}${pathname}`, { redirect: "manual" });
  return { status: res.status, body: await res.text(), type: res.headers.get("content-type") ?? "" };
}

describe("W109 — no dotfile is served from the public directory", () => {
  it("the planted secret really is on disk in the served directory (otherwise this suite proves nothing)", () => {
    /* Guards against the whole file passing vacuously because the fixture failed
       to write. The production defect only exists when such a file is present. */
    expect(fs.existsSync(path.join(publicRoot, ".env"))).toBe(true);
    expect(fs.readFileSync(path.join(publicRoot, ".env"), "utf8")).toContain("SESSION_SECRET");
  });

  it("GET /.env does not return the file — this is the production defect", async () => {
    const r = await get("/.env");
    expect(r.status).toBe(404);
    expect(r.body).not.toContain("SESSION_SECRET");
    expect(r.body).not.toContain("PRODUCTION mode");
  });

  it("answers 404 rather than 403, so the response does not confirm the file exists", async () => {
    const present = await get("/.env");
    const absent = await get("/.env.not-here-at-all");
    expect(present.status).toBe(404);
    expect(absent.status).toBe(404);
  });

  it("a nested dotfile directory is refused too (/.git/config)", async () => {
    const r = await get("/.git/config");
    expect(r.status).toBe(404);
    expect(r.body).not.toContain("bare = false");
  });

  it("percent-encoded evasions are refused", async () => {
    for (const p of ["/%2Eenv", "/%2e%65nv", "/.%65nv"]) {
      const r = await get(p);
      expect(r.status, `${p} should be refused`).toBe(404);
      expect(r.body, `${p} must not leak the file`).not.toContain("SESSION_SECRET");
    }
  });

  it("traversal attempts are refused", async () => {
    for (const p of ["/..%2f.env", "/foo/../.env", "/%2e%2e/.env"]) {
      const r = await get(p);
      expect(r.body, `${p} must not leak the file`).not.toContain("SESSION_SECRET");
    }
  });

  it("ordinary assets are still served — the guard must not break the site", async () => {
    const r = await get("/ordinary.txt");
    expect(r.status).toBe(200);
    expect(r.body).toBe("ordinary asset");
  });

  it("the app shell still answers for an unknown route (single-page-app fallback intact)", async () => {
    const r = await get("/some/client/route");
    expect(r.status).toBe(200);
    expect(r.body).toContain("app shell");
  });

  it("/.well-known/ is deliberately still reachable, for certificates and domain verification", async () => {
    const r = await get("/.well-known/probe");
    expect(r.status).toBe(200);
    expect(r.body).toBe(WELL_KNOWN_BODY);
  });

  it("the unmatched-API handler still returns JSON rather than the app shell", async () => {
    const r = await get("/api/definitely-not-a-route");
    expect(r.status).toBe(404);
    expect(r.body).toContain("API_ROUTE_NOT_FOUND");
  });

  it("BOTH layers are present in the source, not just one", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../static.ts"), "utf8");
    expect(src, "express.static must independently deny dotfiles").toMatch(/dotfiles:\s*["']deny["']/);
    expect(src, "a guard must refuse dot segments before the static handler").toMatch(/startsWith\(["']\.["']\)/);
  });

  /* ────────────────────────────────────────────────────────────────────────
     REVIEWER A's EVASION MATRIX, 2026-08-22, kept verbatim as regressions.
     Fourteen of these were already refused by the first version of the guard.
     ONE was not: the fullwidth-Unicode-dot filename returned HTTP 200 and the
     planted secret. It is the reason NFKC normalisation exists above.
     ──────────────────────────────────────────────────────────────────────── */
  it("REVIEWER A — the fullwidth-Unicode-dot filename must not be served", async () => {
    /* U+FF0E FULLWIDTH FULL STOP, percent-encoded as %EF%BC%8E. */
    const r = await get("/%EF%BC%8Eenv");
    expect(r.body, "the planted secret was retrievable through a fullwidth dot").not.toContain(
      "SESSION_SECRET",
    );
    expect(r.status).toBe(404);
  });

  it("REVIEWER A — the raw (unencoded) fullwidth dot is refused too", async () => {
    const r = await get(`/${encodeURIComponent("\uFF0Eenv")}`);
    expect(r.body).not.toContain("SESSION_SECRET");
    expect(r.status).toBe(404);
  });

  it("REVIEWER A — a double-encoded dotfile name is refused", async () => {
    /* `%252eenv` decodes twice to `.env` — a real dotfile, so a real refusal. */
    const r = await get("/%252eenv");
    expect(r.body).not.toContain("SESSION_SECRET");
    expect(r.status).toBe(404);
  });

  it("REVIEWER A — `%252e%252fenv` is NOT a dotfile, and the app shell is the right answer", async () => {
    /* This one decodes twice to `./env`, which names `env` in the current
       directory — NOT a dotfile. My first assertion here demanded a 404 and was
       simply wrong: this guard's job is to refuse dotfiles, and `env` is not one.
       What matters is that nothing leaks, which is what is asserted. Widening the
       guard to swallow this path would have made it refuse legitimate URLs. */
    const r = await get("/%252e%252fenv");
    expect(r.body, "must not leak the planted secret").not.toContain("SESSION_SECRET");
    expect(r.body).toContain("app shell");
  });

  it("REVIEWER A — a traversal out of the allow-listed path is refused, not answered 200", async () => {
    for (const p of [
      "/.well-known/../.env",
      "/.well-known/%2e%2e/.env",
      "/.well-known/%252e%252e/.env",
    ]) {
      const r = await get(p);
      expect(r.body, `${p} must not leak`).not.toContain("SESSION_SECRET");
      expect(r.status, `${p} must be an indistinguishable 404`).toBe(404);
    }
  });

  it("REVIEWER A — mixed case and trailing-dot spellings stay refused", async () => {
    for (const p of ["/.EnV", "/.env.", "/.env%2e", "/%2EEnV", "/x%5c.env"]) {
      const r = await get(p);
      expect(r.body, `${p} must not leak`).not.toContain("SESSION_SECRET");
      expect(r.status, `${p} should be refused`).toBe(404);
    }
  });

  it("REVIEWER A — a malformed escape sequence is refused rather than thrown", async () => {
    const r = await get("/%E0%A4%A");
    expect(r.status).toBe(404);
  });

  /* ────────────────────────────────────────────────────────────────────────
     REVIEWER C, 2026-08-22: a dotfile INSIDE the allow-listed subtree.
     The guard allowed the `/.well-known/` PREFIX and never tested the rest of
     the path, so `GET /.well-known/.env` returned HTTP 200 and the secret — a
     hole of exactly the class this guard exists to close, inside the single
     exception it grants. The allow-list is now a property of a SEGMENT.
     ──────────────────────────────────────────────────────────────────────── */
  it("REVIEWER C — a dotfile inside the allow-listed subtree is refused", async () => {
    const r = await get("/.well-known/.env");
    expect(r.body, "the secret was retrievable inside the allow-listed subtree").not.toContain(
      "SESSION_SECRET",
    );
    expect(r.status).toBe(404);
  });

  it("REVIEWER C — a dot DIRECTORY inside the allow-listed subtree is refused", async () => {
    const r = await get("/.well-known/.git/config");
    expect(r.body).not.toContain("SESSION_SECRET");
    expect(r.status).toBe(404);
  });

  it("REVIEWER C — encoded and fullwidth spellings inside the subtree are refused", async () => {
    for (const p of ["/.well-known/%2eenv", "/.well-known/%252eenv", "/.well-known/%EF%BC%8Eenv"]) {
      const r = await get(p);
      expect(r.body, `${p} must not leak`).not.toContain("SESSION_SECRET");
      expect(r.status, `${p} should be refused`).toBe(404);
    }
  });

  it("and the legitimate allow-listed file is STILL served (the exception must survive)", async () => {
    const r = await get("/.well-known/probe");
    expect(r.status).toBe(200);
    expect(r.body).toBe(WELL_KNOWN_BODY);
  });
});
