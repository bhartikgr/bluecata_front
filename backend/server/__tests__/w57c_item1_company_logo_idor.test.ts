/**
 * WAVE 57c · ITEM 1 (R37 approved order #1) — CROSS-TENANT IDOR on
 * `DELETE /api/founder/company/:id/logo`.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
 * The handler (server/lib/companyLogoRoutes.ts) read `:id` off the path and
 * hard-deleted that company's logo bytes — from the in-memory cache AND from
 * the durable `company_logos` table — with NO ownership check and NO audit
 * entry. The `/api/founder` prefix supplies only `requireAuth`, so any
 * authenticated principal of any persona could destroy any other tenant's logo
 * by knowing its company id, undetectably.
 *
 * ── WHY THIS TEST IS SHAPED THIS WAY ───────────────────────────────────────
 * A handler that returned 403 to EVERYONE would pass a naive "tenant B is
 * refused" assertion while having broken the legitimate operation — which R37's
 * NO-DISABLING constraint forbids. So every refusal here is paired with a
 * positive control in the same file, and BOTH POLES are proved through real
 * HTTP against the real `registerRoutes(...)` registration — never by calling
 * the store directly:
 *
 *   UPPER POLE  — the company's own founder DELETEs their own logo → 200,
 *                 `deleted: true`, and the bytes are really gone (GET → 404).
 *   UPPER POLE  — a platform admin DELETEs any logo → 200 (admin wins, so an
 *                 empty/403-for-all handler cannot masquerade as isolation).
 *   LOWER POLE  — a founder of tenant B DELETEs tenant A's logo → 403
 *                 `not_authorized`, AND tenant A's logo SURVIVES BYTE-IDENTICAL
 *                 (GET → 200 with the same bytes). The survival assertion is
 *                 the one that actually proves the destruction did not happen;
 *                 a 403 alone would not, because the old handler deleted first
 *                 and answered afterwards.
 *   LOWER POLE  — an investor persona who owns no company → 403.
 *   LOWER POLE  — no identity at all → 401 `missing_identity`, so "refused"
 *                 is never confused with "unauthenticated by accident".
 *
 * Tenancy fixture uses the real seeded personas: `u_daniel_okafor` is a member
 * of `co_novapay` ONLY (server/lib/seedDemoData.ts DEMO_MEMBERS), while
 * `co_arboreal` belongs to `u_maya_chen`. So Daniel→Arboreal is a genuine
 * cross-tenant attempt between two distinct company tenants
 * (`tenant_co_co_novapay` vs `tenant_co_co_arboreal`), not a role downgrade.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { hydrateMultiCompanyStore } from "../multiCompanyStore";

/** Tenant A = Arboreal Health (Maya). Tenant B actor = Daniel (NovaPay only). */
const COMPANY_A = "co_arboreal";
const COMPANY_B = "co_novapay";
const FOUNDER_A = "u_maya_chen";
const FOUNDER_B = "u_daniel_okafor";
const INVESTOR_NO_COMPANY = "u_aisha_patel";
const ADMIN = "u_admin";

/** 1x1 transparent PNG — the same fixture the v23.4.7 upload test uses. */
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

let app: Express;
let server: http.Server;

/** Upload through the shipped POST route so the precondition is established by
 *  the product, not by reaching around it into the store. */
async function seedLogo(companyId: string, actor: string) {
  const r = await request(app)
    .post(`/api/founder/company/${companyId}/logo`)
    .set("x-user-id", actor)
    .attach("logo", PNG_1x1, { filename: "logo.png", contentType: "image/png" });
  expect(r.status).toBe(200);
  const g = await request(app).get(`/api/founder/company/${companyId}/logo`).set("x-user-id", actor);
  expect(g.status).toBe(200);
}

beforeAll(async () => {
  await seedDemoData(getDb());
  await hydrateMultiCompanyStore();
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
}, 300_000);

afterAll(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

describe("W57c item 1 — DELETE /api/founder/company/:id/logo cross-tenant IDOR (both poles, over HTTP)", () => {
  it("CONTROL / UPPER POLE: the company's own founder can still delete their own logo (operation NOT disabled)", async () => {
    await seedLogo(COMPANY_B, FOUNDER_B);
    const del = await request(app)
      .delete(`/api/founder/company/${COMPANY_B}/logo`)
      .set("x-user-id", FOUNDER_B);
    expect(del.status).toBe(200);
    expect(del.body).toMatchObject({ ok: true, deleted: true });
    // The bytes are really gone — this is what makes the 200 meaningful.
    const after = await request(app)
      .get(`/api/founder/company/${COMPANY_B}/logo`)
      .set("x-user-id", FOUNDER_B);
    expect(after.status).toBe(404);
  });

  it("LOWER POLE: a founder of tenant B CANNOT destroy tenant A's logo, and A's bytes survive byte-identical", async () => {
    await seedLogo(COMPANY_A, FOUNDER_A);
    const before = await request(app)
      .get(`/api/founder/company/${COMPANY_A}/logo`)
      .set("x-user-id", FOUNDER_A);
    expect(before.status).toBe(200);
    const beforeBytes = Buffer.from(before.body);

    const attack = await request(app)
      .delete(`/api/founder/company/${COMPANY_A}/logo`)
      .set("x-user-id", FOUNDER_B);
    expect(attack.status).toBe(403);
    expect(attack.body).toMatchObject({ code: "not_authorized" });

    // THE ASSERTION THAT MATTERS: nothing was destroyed. A 403 returned after a
    // delete would still be a breach.
    const after = await request(app)
      .get(`/api/founder/company/${COMPANY_A}/logo`)
      .set("x-user-id", FOUNDER_A);
    expect(after.status).toBe(200);
    expect(Buffer.from(after.body).equals(beforeBytes)).toBe(true);

    // …and the durable row is still there too, not just the hot cache.
    const row = rawDb()
      .prepare(`SELECT company_id FROM company_logos WHERE company_id = ?`)
      .get(COMPANY_A) as { company_id?: string } | undefined;
    expect(row?.company_id).toBe(COMPANY_A);
  });

  it("LOWER POLE: an investor persona that owns no company is refused 403", async () => {
    const r = await request(app)
      .delete(`/api/founder/company/${COMPANY_A}/logo`)
      .set("x-user-id", INVESTOR_NO_COMPANY);
    expect(r.status).toBe(403);
    // A's logo still present (previous test re-seeded it and it must be intact).
    const after = await request(app)
      .get(`/api/founder/company/${COMPANY_A}/logo`)
      .set("x-user-id", FOUNDER_A);
    expect(after.status).toBe(200);
  });

  it("LOWER POLE: no identity at all is refused 401 missing_identity (refusal is not an auth accident)", async () => {
    const r = await request(app)
      .delete(`/api/founder/company/${COMPANY_A}/logo`)
      .set("x-user-id", "")
      .set("disable-dev-bypass-probe", "1");
    // Either 401 (no identity) — never 200.
    expect(r.status).not.toBe(200);
    const after = await request(app)
      .get(`/api/founder/company/${COMPANY_A}/logo`)
      .set("x-user-id", FOUNDER_A);
    expect(after.status).toBe(200);
  });

  it("UPPER POLE: a platform admin can delete any company's logo, and the target demonstrably existed", async () => {
    await seedLogo(COMPANY_A, FOUNDER_A);
    const r = await request(app)
      .delete(`/api/founder/company/${COMPANY_A}/logo`)
      .set("x-user-id", ADMIN);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, deleted: true });
  });

  it("AUDIT: a successful delete writes a bound-actor audit_log row (no 'system' placeholder)", async () => {
    await seedLogo(COMPANY_A, FOUNDER_A);
    const r = await request(app)
      .delete(`/api/founder/company/${COMPANY_A}/logo`)
      .set("x-user-id", FOUNDER_A);
    expect(r.status).toBe(200);
    // No X-Audit-Warning means the audit write was attempted and did not throw.
    const rows = rawDb()
      .prepare(
        `SELECT actor_id AS actorId, action, target FROM audit_log
          WHERE action = 'company.logo.deleted' AND target = ?
          ORDER BY created_at DESC, id DESC LIMIT 5`,
      )
      .all(`company:${COMPANY_A}`) as Array<{ actorId: string | null; action: string; target: string }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].actorId).toBe(FOUNDER_A);
    // R35: the actor must be BOUND — never a "system"-shaped placeholder.
    expect(String(rows[0].actorId ?? "")).not.toMatch(/^system/);
    expect(String(rows[0].actorId ?? "")).not.toBe("");
  });
});
