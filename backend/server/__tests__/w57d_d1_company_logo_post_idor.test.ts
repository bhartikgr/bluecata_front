/**
 * WAVE 57d · D1 — CROSS-TENANT OVERWRITE on `POST /api/founder/company/:id/logo`.
 *
 * ── WHAT WAS WRONG, AND WHY 57c DID NOT CLOSE IT ───────────────────────────
 * Wave 57c closed the cross-tenant IDOR on `DELETE /api/founder/company/:id/logo`
 * (2 ownership checks, bound-actor audit, both-pole test). It left the POST on
 * the SAME path with ZERO ownership checks: it read `:id` off the request and
 * replaced both the hot-cache entry and the durable `company_logos` row for that
 * id (`server/lib/companyLogoRoutes.ts`, pre-57d :158-200). The `/api/founder`
 * prefix mount supplies only `requireAuth`, so any authenticated principal of any
 * persona could overwrite any company's logo bytes. Overwriting destroys the
 * previous bytes exactly as permanently as the DELETE did, and it was unaudited,
 * so closing one and not the other was not closure. Independent Review 1 of Wave
 * 57c found this ("Bypass found: unauthorised POST overwrite").
 *
 * ── WHY THIS TEST IS SHAPED THIS WAY ───────────────────────────────────────
 * Deliberately mirrors server/__tests__/w57c_item1_company_logo_idor.test.ts:108-135,
 * because the same trap applies: a handler that refused EVERYONE would satisfy a
 * naive "tenant B gets 403" assertion while having broken the legitimate upload —
 * and unlike the DELETE, THIS route HAS a live UI caller
 * (client/src/pages/founder/Company.tsx:784). So every refusal below is paired
 * with a positive control, and both poles run through real HTTP against the real
 * `registerRoutes(...)` registration — never by calling the store directly.
 *
 *   UPPER POLE — the owning founder uploads their own logo → 200 and the bytes
 *                really land (GET returns them). The legitimate operation is NOT
 *                disabled.
 *   UPPER POLE — a platform admin uploads for any company → 200 (admin wins, so a
 *                refuse-everything handler cannot masquerade as isolation).
 *   LOWER POLE — a founder of tenant B uploads DIFFERENT bytes at tenant A's id →
 *                403 `not_authorized` AND tenant A's bytes are still
 *                `Buffer.equals`-identical afterwards. The survival assertion is
 *                the one that proves the overwrite did not happen: a 403 returned
 *                after `logoStore.set()` would still be a breach.
 *   LOWER POLE — an investor persona owning no company → 403.
 *   LOWER POLE — no identity at all → never 200.
 *   AUDIT      — a successful upload writes a `company.logo.replaced` row whose
 *                actor is the resolved session identity, never `system`-shaped.
 *
 * Tenancy fixture is 57c's: `u_daniel_okafor` is a member of `co_novapay` only,
 * `co_arboreal` belongs to `u_maya_chen` (server/lib/seedDemoData.ts DEMO_MEMBERS),
 * so Daniel → Arboreal is a genuine cross-tenant attempt between two company
 * tenants rather than a role downgrade.
 *
 * MUTATION TRANSCRIPT: build_log/wave57d/W57D_TESTS.md (M1).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { hydrateMultiCompanyStore } from "../multiCompanyStore";

const COMPANY_A = "co_arboreal";
const COMPANY_B = "co_novapay";
const FOUNDER_A = "u_maya_chen";
const FOUNDER_B = "u_daniel_okafor";
const INVESTOR_NO_COMPANY = "u_aisha_patel";
const ADMIN = "u_admin";

/** Two DIFFERENT valid 1x1 PNGs (white / black). Distinct bytes are what makes
 *  "the overwrite did not happen" a real assertion rather than a tautology. */
const PNG_WHITE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC",
  "base64",
);
const PNG_BLACK = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC",
  "base64",
);

let app: Express;
let server: http.Server;

function upload(companyId: string, actor: string, bytes: Buffer, filename = "logo.png") {
  const r = request(app)
    .post(`/api/founder/company/${companyId}/logo`)
    .attach("logo", bytes, { filename, contentType: "image/png" });
  return actor ? r.set("x-user-id", actor) : r.set("x-user-id", "").set("disable-dev-bypass-probe", "1");
}

function get(companyId: string, actor: string) {
  return request(app).get(`/api/founder/company/${companyId}/logo`).set("x-user-id", actor);
}

beforeAll(async () => {
  expect(PNG_WHITE.equals(PNG_BLACK)).toBe(false);
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

describe("W57d D1 — POST /api/founder/company/:id/logo cross-tenant overwrite (both poles, over HTTP)", () => {
  it("CONTROL / UPPER POLE: the owning founder can still upload their own logo, and the bytes really land", async () => {
    const up = await upload(COMPANY_A, FOUNDER_A, PNG_WHITE);
    expect(up.status).toBe(200);
    expect(up.body).toMatchObject({ ok: true });
    const after = await get(COMPANY_A, FOUNDER_A);
    expect(after.status).toBe(200);
    expect(Buffer.from(after.body).equals(PNG_WHITE)).toBe(true);
  });

  it("LOWER POLE: a founder of tenant B CANNOT overwrite tenant A's logo, and A's bytes survive Buffer.equals-identical", async () => {
    // Establish tenant A's bytes through the product, then capture them.
    expect((await upload(COMPANY_A, FOUNDER_A, PNG_WHITE)).status).toBe(200);
    const before = await get(COMPANY_A, FOUNDER_A);
    expect(before.status).toBe(200);
    const beforeBytes = Buffer.from(before.body);
    expect(beforeBytes.equals(PNG_WHITE)).toBe(true);

    const attack = await upload(COMPANY_A, FOUNDER_B, PNG_BLACK);
    expect(attack.status).toBe(403);
    expect(attack.body).toMatchObject({ code: "not_authorized" });

    /* THE ASSERTION THAT MATTERS: nothing was replaced. A 403 answered after
       logoStore.set()/persistLogo() would still be a breach. */
    const after = await get(COMPANY_A, FOUNDER_A);
    expect(after.status).toBe(200);
    const afterBytes = Buffer.from(after.body);
    expect(afterBytes.equals(beforeBytes)).toBe(true);
    expect(afterBytes.equals(PNG_BLACK)).toBe(false);

    // …and the durable row still holds A's bytes, not just the hot cache.
    const row = rawDb()
      .prepare(`SELECT payload FROM company_logos WHERE company_id = ?`)
      .get(COMPANY_A) as { payload?: Buffer } | undefined;
    expect(row?.payload).toBeTruthy();
    expect(Buffer.from(row!.payload as Buffer).equals(PNG_WHITE)).toBe(true);
  });

  it("LOWER POLE: an investor persona that owns no company is refused 403 and destroys nothing", async () => {
    const r = await upload(COMPANY_A, INVESTOR_NO_COMPANY, PNG_BLACK);
    expect(r.status).toBe(403);
    const after = await get(COMPANY_A, FOUNDER_A);
    expect(after.status).toBe(200);
    expect(Buffer.from(after.body).equals(PNG_WHITE)).toBe(true);
  });

  it("LOWER POLE: no identity at all is never 200, and destroys nothing", async () => {
    const r = await upload(COMPANY_A, "", PNG_BLACK);
    expect(r.status).not.toBe(200);
    const after = await get(COMPANY_A, FOUNDER_A);
    expect(after.status).toBe(200);
    expect(Buffer.from(after.body).equals(PNG_WHITE)).toBe(true);
  });

  it("UPPER POLE: a platform admin may upload for any company (the bypass is intentional and still works)", async () => {
    const r = await upload(COMPANY_A, ADMIN, PNG_BLACK);
    expect(r.status).toBe(200);
    const after = await get(COMPANY_A, ADMIN);
    expect(after.status).toBe(200);
    expect(Buffer.from(after.body).equals(PNG_BLACK)).toBe(true);
    // Put tenant A back to its own bytes so later tests read a clean fixture.
    expect((await upload(COMPANY_A, FOUNDER_A, PNG_WHITE)).status).toBe(200);
  });

  it("UPPER POLE: the owning founder of the OTHER tenant is unaffected (no collateral lock-out)", async () => {
    const r = await upload(COMPANY_B, FOUNDER_B, PNG_BLACK);
    expect(r.status).toBe(200);
    const after = await get(COMPANY_B, FOUNDER_B);
    expect(after.status).toBe(200);
    expect(Buffer.from(after.body).equals(PNG_BLACK)).toBe(true);
  });

  it("AUDIT: a successful upload writes a bound-actor company.logo.replaced row (no 'system' placeholder)", async () => {
    const r = await upload(COMPANY_A, FOUNDER_A, PNG_WHITE);
    expect(r.status).toBe(200);
    // No X-Audit-Warning means the audit row was really written (W57d D2).
    expect(r.headers["x-audit-warning"]).toBeUndefined();
    const rows = rawDb()
      .prepare(
        `SELECT actor_id AS actorId, action, target FROM audit_log
          WHERE action = 'company.logo.replaced' AND target = ?
          ORDER BY created_at DESC, id DESC LIMIT 5`,
      )
      .all(`company:${COMPANY_A}`) as Array<{ actorId: string | null; action: string; target: string }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].actorId).toBe(FOUNDER_A);
    // R35: the actor must be BOUND — never a "system"-shaped placeholder.
    expect(String(rows[0].actorId ?? "")).not.toMatch(/^system/);
    expect(String(rows[0].actorId ?? "")).not.toBe("u_unknown_admin");
    expect(String(rows[0].actorId ?? "")).not.toBe("");
  });

  it("AUDIT: a REFUSED cross-tenant upload writes NO company.logo.replaced row for the victim", async () => {
    const beforeCount = (
      rawDb()
        .prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'company.logo.replaced' AND target = ?`)
        .get(`company:${COMPANY_A}`) as { n: number }
    ).n;
    const attack = await upload(COMPANY_A, FOUNDER_B, PNG_BLACK);
    expect(attack.status).toBe(403);
    const afterCount = (
      rawDb()
        .prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'company.logo.replaced' AND target = ?`)
        .get(`company:${COMPANY_A}`) as { n: number }
    ).n;
    expect(afterCount).toBe(beforeCount);
  });
});
