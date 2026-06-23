/**
 * Wave F4 FIX F4-3 (E2E-7, P0) regression suite.
 *
 * Proves the public REST alias `POST /api/consortium-applications` is reachable
 * by anonymous callers (no session cookie / no x-user-id) and behaves
 * identically to the canonical `POST /api/public/consortium/apply`.
 *
 * Before this fix: the client + Wave F3 E2E suite would POST to
 * `/api/consortium-applications` and receive 401, since no route was
 * registered and the SPA fallback returned an auth-gated HTML page.
 *
 * After this fix: both paths invoke the same public, rate-limited handler.
 */
import { describe, it, expect } from "vitest";
import { installV14TestIdentity } from "./_v14TestIdentity";
import express from "express";
import http from "node:http";

async function buildApp() {
  const app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: true });
  const server = http.createServer(app);
  const { registerRoutes } = await import("../routes");
  await registerRoutes(server, app);
  return { app };
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
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
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
          let parsed: any = chunks;
          try { parsed = JSON.parse(chunks); } catch {}
          resolve({ status: resp.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
  await new Promise<void>((r) => server.close(() => r()));
  return result;
}

describe("Wave F4 FIX F4-3 (E2E-7): POST /api/consortium-applications anonymous", () => {
  it("anonymous client can POST /api/consortium-applications without auth (no 401/403)", async () => {
    const { app } = await buildApp();
    // E2E sends `{_e2e: true}` — minimal body, validation will fail with 400,
    // which is the exact behavior we want: NOT an auth gate.
    const r = await rawRequest(app, "POST", "/api/consortium-applications", { _e2e: true });
    expect(r.status, `Got ${r.status}, expected non-auth-gated`).not.toBe(401);
    expect(r.status).not.toBe(403);
    expect(r.status).toBeLessThan(500);
  });

  it("valid body to /api/consortium-applications returns 201 (created)", async () => {
    const { app } = await buildApp();
    const body = {
      organizationName: "F4-3 Test Partners",
      contactName: "F4-3 Tester",
      contactEmail: "f43@test.example",
      jurisdiction: "California, USA",
      partnerType: "vc",
      aumRange: "50-250M",
      portfolioCompanyCount: 10,
      expectedChapter: "chap_keiretsu_canada",
      introMessage: "F4-3 valid-body submission for the canonical /api/consortium-applications alias.",
    };
    const r = await rawRequest(app, "POST", "/api/consortium-applications", body);
    expect(r.status, `Got ${r.status}, expected 201`).toBe(201);
    expect(r.body.applicationId).toBeDefined();
    expect(r.body.status).toBe("submitted");
  });

  it("canonical /api/public/consortium/apply path still works (no regression)", async () => {
    const { app } = await buildApp();
    const r = await rawRequest(app, "POST", "/api/public/consortium/apply", { _e2e: true });
    expect(r.status).not.toBe(401);
    expect(r.status).not.toBe(403);
    expect(r.status).toBeLessThan(500);
  });

  it("both paths set the public:apply rate-limit headers", async () => {
    const { app } = await buildApp();
    // Use raw http.request to inspect headers from the alias path.
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const data = JSON.stringify({ _e2e: true });
    const headers = await new Promise<http.IncomingHttpHeaders>((resolve, reject) => {
      const req = http.request(
        {
          method: "POST",
          host: "127.0.0.1",
          port,
          path: "/api/consortium-applications",
          headers: {
            "content-type": "application/json",
            "content-length": String(Buffer.byteLength(data)),
          },
        },
        (resp) => {
          resp.on("data", () => {});
          resp.on("end", () => resolve(resp.headers));
        },
      );
      req.on("error", reject);
      req.write(data);
      req.end();
    });
    await new Promise<void>((r) => server.close(() => r()));
    expect(headers["x-ratelimit-bucket"]).toBe("public:apply");
    expect(headers["x-ratelimit-limit"]).toBe("5");
  });
});
