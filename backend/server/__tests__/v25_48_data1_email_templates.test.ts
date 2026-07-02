/**
 * v25.48 DATA-1 — DB-backed, admin-editable email templates.
 *
 * Real-route supertest coverage:
 *   1. GET  /api/admin/email/templates lists the seeded templates (DB-first).
 *   2. GET  /api/admin/email/templates/:slug returns one.
 *   3. PUT  /api/admin/email/templates/:slug persists an edit to the DB.
 *   4. GET  reflects the edit; a fresh hydrate (Save→Restart→Load) still reflects it.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { hydrateEmailStore, findTemplate } from "../emailStore";

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  getDb();
  hydrateEmailStore(); // seed email_templates from the canonical set (DB-first)
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, () => { port = (server.address() as any).port; resolve(); }));
}, 30_000);

afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

// Admin identity via the sandbox ?as=admin persona resolver (test env only).
function req(method: string, path: string, body?: any): Promise<{ status: number; body: any }> {
  const sep = path.includes("?") ? "&" : "?";
  const fullPath = `${path}${sep}as=admin`;
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const r = http.request(
      { hostname: "127.0.0.1", port, path: fullPath, method, headers: { ...(payload ? { "content-type": "application/json" } : {}) } },
      (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => { let j: any = null; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode ?? 0, body: j }); }); },
    );
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

describe("v25.48 DATA-1 email templates DB-backed + admin CRUD", () => {
  it("lists seeded templates (DB-first)", async () => {
    const res = await req("GET", "/api/admin/email/templates");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.templates)).toBe(true);
    expect(res.body.templates.length).toBeGreaterThanOrEqual(15);
    expect(res.body.templates.find((t: any) => t.slug === "round_invitation")).toBeTruthy();
  });

  it("gets one template by slug", async () => {
    const res = await req("GET", "/api/admin/email/templates/round_invitation");
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe("round_invitation");
  });

  it("PUT persists an edit to the DB and GET reflects it", async () => {
    const newSubject = "EDITED v25.48 — {{founder_name}}";
    const put = await req("PUT", "/api/admin/email/templates/round_invitation", { subject: newSubject });
    expect(put.status).toBe(200);
    expect(put.body.subject).toBe(newSubject);

    const get = await req("GET", "/api/admin/email/templates/round_invitation");
    expect(get.status).toBe(200);
    expect(get.body.subject).toBe(newSubject);

    // Save→Restart→Load: re-hydrate the store from the DB and confirm the edit survives.
    hydrateEmailStore();
    expect(findTemplate("round_invitation")?.subject).toBe(newSubject);
  });

  it("PUT of an unknown slug 404s", async () => {
    const res = await req("PUT", "/api/admin/email/templates/does_not_exist", { subject: "x" });
    expect(res.status).toBe(404);
  });
});
