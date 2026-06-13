/**
 * v23.4.7 Phase 3 (BUG 031) — Default plan for new companies.
 *
 * Bug: POST /api/founder/companies/new historically forced a `founder_pro`
 * trialing subscription, which then labeled every newly created company
 * "PRO" in the UI — contradicting the signup copy that promised
 * "14-day trial — no card required" for what users assumed was the
 * free tier. The fix: default to `founder_free` (no trial), accept an
 * optional `plan` body field whitelisted against the Plan union, and let
 * the NewCompanyDialog plan-picker upgrade-on-create.
 *
 * Coverage:
 *   1. POST with no plan → subscription plan is `founder_free`, no trial.
 *   2. POST with plan='founder_pro' → subscription plan is `founder_pro`,
 *      status='trialing'.
 *   3. POST with an unknown plan value → silently falls back to
 *      `founder_free` (defensive; we do not 400).
 */
import { describe, it, expect } from "vitest";
import express from "express";
import http from "node:http";
import { installV14TestIdentity } from "./_v14TestIdentity";
import { getSubscription } from "../subscriptionsStore";
import { registerFounderUser } from "../lib/userContext";

async function buildApp() {
  const app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: true });
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

describe("v23.4.7 Phase 3 (BUG 031) — default plan for new company", () => {
  it("POST /api/founder/companies/new with no plan defaults to founder_free", async () => {
    const { app } = await buildApp();
    const { userId } = registerFounderUser({
      email: `v2347p3a_${Date.now()}@test.example`,
      name: "v2347 P3a Founder",
      password: "password12345",
    });

    const r = await rawRequest(
      app,
      "POST",
      "/api/founder/companies/new",
      { name: "Free Default Co", sector: "SaaS" },
      { "x-user-id": userId },
    );
    expect(r.status).toBe(201);
    const companyId = r.body.companyId as string;
    const sub = getSubscription(companyId);
    expect(sub).not.toBeNull();
    expect(sub!.plan).toBe("founder_free");
    expect(sub!.status).not.toBe("trialing");
    expect(sub!.trialEndsOn).toBeUndefined();
  });

  it("POST with plan='founder_pro' provisions a trialing pro subscription", async () => {
    const { app } = await buildApp();
    const { userId } = registerFounderUser({
      email: `v2347p3b_${Date.now()}@test.example`,
      name: "v2347 P3b Founder",
      password: "password12345",
    });

    const r = await rawRequest(
      app,
      "POST",
      "/api/founder/companies/new",
      { name: "Pro Upgrade Co", plan: "founder_pro" },
      { "x-user-id": userId },
    );
    expect(r.status).toBe(201);
    const sub = getSubscription(r.body.companyId);
    expect(sub).not.toBeNull();
    expect(sub!.plan).toBe("founder_pro");
    expect(sub!.status).toBe("trialing");
  });

  it("POST with an unknown plan value silently falls back to founder_free", async () => {
    const { app } = await buildApp();
    const { userId } = registerFounderUser({
      email: `v2347p3c_${Date.now()}@test.example`,
      name: "v2347 P3c Founder",
      password: "password12345",
    });

    const r = await rawRequest(
      app,
      "POST",
      "/api/founder/companies/new",
      { name: "Bogus Plan Co", plan: "founder_unicorn" },
      { "x-user-id": userId },
    );
    expect(r.status).toBe(201);
    const sub = getSubscription(r.body.companyId);
    expect(sub).not.toBeNull();
    expect(sub!.plan).toBe("founder_free");
  });
});
