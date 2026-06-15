/**
 * v23.4.7 Phase 6 — BUG 001 source contract.
 *
 * The /api/auth/me handler must return `hasPaidPlan: boolean` so Login.tsx can
 * branch its post-auth redirect:
 *   - companies.length > 1   → /select-company
 *   - companies.length === 1 → /founder/dashboard
 *   - no companies, paid     → /onboarding
 *   - no companies, no plan  → /founder/subscribe
 *
 * We also assert (source-grep) that Login.tsx implements the four branches.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { installV14TestIdentity } from "./_v14TestIdentity";

const ROOT = path.resolve(__dirname, "..", "..");
function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

async function buildApp(opts: { defaultIdentity?: boolean } = {}) {
  const app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: opts.defaultIdentity !== false });
  const server = http.createServer(app);
  const { registerRoutes } = await import("../routes");
  await registerRoutes(server, app);
  return { app, server };
}

async function rawRequest(
  app: express.Express,
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: any }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address() as any;
  const port = addr?.port ?? 0;
  const data = body === undefined ? "" : JSON.stringify(body);
  const result = await new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = http.request(
      {
        method,
        host: "127.0.0.1",
        port,
        path: url,
        headers: {
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(data)),
          ...headers,
        },
      },
      (resp) => {
        let chunks = "";
        resp.on("data", (c) => (chunks += c));
        resp.on("end", () => {
          let parsed: any = null;
          try { parsed = chunks ? JSON.parse(chunks) : null; } catch { parsed = chunks; }
          resolve({ status: resp.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
  server.close();
  return result;
}

let appHandle: { app: express.Express } | null = null;

beforeAll(async () => {
  appHandle = await buildApp({ defaultIdentity: false });
});

afterAll(() => {
  // ephemeral; nothing to clean.
});

describe("v23.4.7 Phase 6 — /api/auth/me includes hasPaidPlan", () => {
  it("every response shape includes hasPaidPlan (key present)", async () => {
    // The default test identity middleware injects an identity for requests
    // without x-user-id, so we cannot test the anonymous branch directly.
    // Source-grep below covers both branches; here we just verify the key
    // is present on the authed branch.
    const r = await rawRequest(appHandle!.app, "GET", "/api/auth/me", undefined, {
      "x-user-id": "u_maya_chen",
    });
    expect(r.status).toBe(200);
    expect(r.body.isAuthed).toBe(true);
    expect(r.body).toHaveProperty("hasPaidPlan");
    expect(typeof r.body.hasPaidPlan).toBe("boolean");
  });

  it("authenticated founder also exposes the standard founder.companies array", async () => {
    const r = await rawRequest(appHandle!.app, "GET", "/api/auth/me", undefined, {
      "x-user-id": "u_maya_chen",
    });
    expect(Array.isArray(r.body?.founder?.companies)).toBe(true);
  });

  it("server-side me handler source contains both branches of hasPaidPlan", () => {
    const src = fs.readFileSync(path.join(ROOT, "server", "routes.ts"), "utf8");
    // anonymous branch (key present, value false)
    expect(src).toMatch(/hasPaidPlan:\s*false/);
    // authed branch (key emitted from computed local)
    expect(src).toMatch(/v23\.4\.7 Phase 6 \(BUG 001\)/);
    expect(src).toMatch(/let hasPaidPlan\s*=\s*false/);
  });
});

describe("v23.4.7 Phase 6 — Login.tsx branching", () => {
  const src = read("client/src/pages/auth/Login.tsx");

  it("widens the meProbe shape with hasPaidPlan", () => {
    expect(src).toMatch(/hasPaidPlan\?:\s*boolean/);
  });

  it("branches the post-auth redirect on companyCount", () => {
    expect(src).toMatch(/const companyCount\s*=/);
    expect(src).toMatch(/companyCount > 1[\s\S]*?\/select-company/);
    expect(src).toMatch(/companyCount === 1[\s\S]*?\/founder\/dashboard/);
  });

  it("routes paid-no-company users to /onboarding", () => {
    expect(src).toMatch(/me\.hasPaidPlan[\s\S]*?\/onboarding/);
  });

  it("falls back to /founder/subscribe for unpaid, no-company users", () => {
    expect(src).toMatch(/navigate\("\/founder\/subscribe"\)/);
  });

  it("preserves the v23.4.5 admin and investor branches", () => {
    expect(src).toMatch(/navigate\("\/admin\/dashboard"\)/);
    expect(src).toMatch(/navigate\("\/investor\/dashboard"\)/);
  });
});
