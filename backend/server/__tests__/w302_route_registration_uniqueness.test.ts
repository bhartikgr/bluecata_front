/**
 * W302 (R246.3) — REGISTRATION-UNIQUENESS FENCE for GET /api/founder/crm/contacts
 *
 * ── WHAT THIS FILE IS FOR ──────────────────────────────────────────────────
 * `server/routes.ts` used to register `GET /api/founder/crm/contacts` a SECOND
 * time. That duplicate resolved the company as
 *
 *     ctx.founder?.activeCompanyId
 *       ?? (typeof req.query.companyId === "string" ? req.query.companyId : null)
 *
 * — a caller-supplied company id with NO ownership check — and handed it
 * straight to `listContactsForCompany()`, which filters by whatever id it is
 * given. The only thing that stopped it being a cross-tenant read of ANY
 * company's founder CRM by ANY authenticated user was that Express serves the
 * FIRST matching registration, and the correctly scoped one
 * (`founderCrmStore.ts` → `registerFounderCrmRoutes`) happens to be installed
 * earlier in `registerRoutes`.
 *
 * R246.3: "shadowed by the accident of registration order" is not a security
 * control. The duplicate has been retired. THIS FILE IS THE PART THAT KEEPS IT
 * retired — a reordering, a rename, a copy-paste, or a merge that reintroduces a
 * second registration of this path must fail the build rather than silently
 * re-arm the defect.
 *
 * ── WHY IT ASSERTS TWO THINGS, NOT ONE ─────────────────────────────────────
 * A test that only counted registrations would pass if someone deleted the SAFE
 * registration and kept the unsafe one: still exactly one. So the count is
 * paired with a BEHAVIOURAL identification of the survivor, over HTTP, using a
 * refusal string only the scoped handler can produce. Position AND consequence:
 *   - POSITION:    exactly one GET layer for this path on the real router;
 *   - CONSEQUENCE: the handler at that position refuses a caller who names a
 *                  company they do not own.
 *
 * ── WHY IT IS NOT A REPLICA ────────────────────────────────────────────────
 * The router inspected here is the one produced by the real `registerRoutes` on
 * a real `express()` app — the same call `server/index.ts` makes. No substitute
 * handler is mounted, no resolution logic is reimplemented, and the fixture is
 * built through the SHIPPED signup / company-create / CRM-create routes, so a
 * break in any of those turns this file red instead of leaving it asserting
 * against an empty database.
 *
 * ── THE FIXTURE GIVES BOTH TENANTS REAL ROWS ───────────────────────────────
 * A scoping assertion where both sides are empty proves nothing. Two founders
 * are created, each with their own company and their own CRM contact, and the
 * rows are read back out of `founder_crm_contacts` before anything is asserted.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { hydrateMultiCompanyStore } from "../multiCompanyStore";
import { patchConfig, getConfig } from "../emailTransport";
import { _resetRateLimitsForTests } from "../lib/rateLimit";

const CRM_PATH = "/api/founder/crm/contacts";
const CO_A = "co_w302_fence_alpha";
const CO_B = "co_w302_fence_beta";

/** An authenticated caller who owns NO company. Only such a caller can tell the
 *  two implementations apart: the scoped handler refuses them, the unsafe one
 *  serves them whatever `?companyId=` says. */
const NO_COMPANY_CALLER = "u_aisha_patel";

let app: Express;
let server: http.Server;
let founderA = "";
let founderB = "";

/** Read the real router's layer stack. Express 5 exposes `app.router`; Express 4
 *  exposed `app._router`. Both are read so this fence survives an Express
 *  upgrade rather than silently finding zero layers and passing. */
function routerStack(a: Express): Array<Record<string, any>> {
  const holder = a as unknown as {
    router?: { stack?: Array<Record<string, any>> };
    _router?: { stack?: Array<Record<string, any>> };
  };
  return holder.router?.stack ?? holder._router?.stack ?? [];
}

function getRegistrationsOf(a: Express, path: string): Array<Record<string, any>> {
  return routerStack(a).filter(
    (layer) => layer?.route?.path === path && layer?.route?.methods?.get === true,
  );
}

beforeAll(async () => {
  // Forced inert BEFORE registerRoutes: `emailSender` defaults SMTP_MODE to
  // "smtp" and `.env` carries live credentials.
  patchConfig({ mode: "dry_run" });

  await seedDemoData(getDb());
  await hydrateMultiCompanyStore();

  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);

  // Two founders, through the SHIPPED signup route.
  for (const [email, name] of [
    ["w302.fence.a@example.test", "W302 Fence Founder A"],
    ["w302.fence.b@example.test", "W302 Fence Founder B"],
  ]) {
    _resetRateLimitsForTests();
    const r = await request(app).post("/api/auth/signup").send({ email, name, password: "w302-fence-pw" });
    expect(r.status).toBe(200);
    const uid = String(r.body?.ctx?.userId ?? "");
    expect(uid).not.toBe("");
    if (email.includes(".a@")) founderA = uid; else founderB = uid;
  }

  // A company each, through the SHIPPED company-create route.
  for (const [uid, companyId, companyName] of [
    [founderA, CO_A, "W302 Fence Alpha Co"],
    [founderB, CO_B, "W302 Fence Beta Co"],
  ]) {
    _resetRateLimitsForTests();
    const r = await request(app).post("/api/founder/companies")
      .set("x-user-id", uid).send({ companyId, companyName });
    expect(r.status).toBe(201);
  }
  await hydrateMultiCompanyStore();

  // A CRM contact each, through the SHIPPED CRM-create route.
  for (const [uid, companyId, tag] of [
    [founderA, CO_A, "alpha"],
    [founderB, CO_B, "beta"],
  ]) {
    _resetRateLimitsForTests();
    const r = await request(app).post("/api/founder/investor-crm").set("x-user-id", uid).send({
      companyId,
      name: `W302 fence ${tag} contact`,
      email: `w302.fence.${tag}.contact@example.test`,
      stage: "prospect",
      region: "US",
    });
    expect(r.status).toBe(200);
  }

  // BOTH tenants demonstrably hold a row. Without this, every assertion below
  // could be passing on an empty database.
  const rows = rawDb()
    .prepare(`SELECT company_id FROM founder_crm_contacts WHERE company_id IN (?, ?)`)
    .all(CO_A, CO_B) as Array<{ company_id: string }>;
  expect(rows.map((r) => r.company_id).sort()).toEqual([CO_A, CO_B].sort());
}, 300_000);

afterAll(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

describe("W302 — GET /api/founder/crm/contacts has exactly ONE registration", () => {
  it("CONTROL: the router was actually inspected — the layer stack is non-trivial", () => {
    // A fence that silently found zero layers would report "exactly one
    // registration" as vacuously true for every path in the app.
    expect(routerStack(app).length).toBeGreaterThan(100);
  });

  it("CONTROL: the mail transport is inert, so this file cannot send real mail", () => {
    expect(getConfig().mode).toBe("dry_run");
  });

  it("POSITION: the path is registered exactly ONCE for GET", () => {
    const hits = getRegistrationsOf(app, CRM_PATH);
    // If this fails with 2, a second registration of the founder CRM contacts
    // route has reappeared. Do NOT relax this number. Find the duplicate and
    // retire it — see the W302 banner in server/routes.ts.
    expect(hits.length).toBe(1);
  });

  it("CONTROL: the sibling investor-crm path is also registered exactly once", () => {
    // Proves the counting method discriminates rather than returning 1 for
    // anything it is handed.
    expect(getRegistrationsOf(app, "/api/founder/investor-crm").length).toBe(1);
  });

  it("CONTROL: a path that does not exist has ZERO registrations", () => {
    expect(getRegistrationsOf(app, "/api/founder/crm/contacts-that-do-not-exist").length).toBe(0);
  });

  it("CONSEQUENCE: the surviving handler is the SCOPED one — it refuses a caller who names a company they do not own", async () => {
    const r = await request(app).get(`${CRM_PATH}?companyId=${CO_B}`).set("x-user-id", NO_COMPANY_CALLER);
    // `missing_active_company` is emitted by ensureCompanyId in
    // founderCrmStore.ts and by NOTHING in the retired duplicate, which would
    // have answered 200 with company B's rows. This is a positive
    // identification of the served code, not an inference from a status code.
    expect(r.status).toBe(400);
    expect(r.body?.error).toBe("missing_active_company");
    expect(JSON.stringify(r.body)).not.toContain("W302 fence beta contact");
  }, 60_000);

  it("CONSEQUENCE: a founder asking for ANOTHER tenant's company by query param never receives that tenant's rows", async () => {
    const r = await request(app).get(`${CRM_PATH}?companyId=${CO_B}`).set("x-user-id", founderA);
    expect(r.status).toBe(200);
    const body = JSON.stringify(r.body);
    expect(body).not.toContain("W302 fence beta contact");
    expect(body).not.toContain(CO_B);
  }, 60_000);

  it("LEGITIMATE CALLER STILL SUCCEEDS: founder A reads their OWN contact", async () => {
    // The upper pole. Without it, a handler that returned [] to everyone would
    // satisfy every isolation assertion above.
    const r = await request(app).get(CRM_PATH).set("x-user-id", founderA);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(JSON.stringify(r.body)).toContain("W302 fence alpha contact");
  }, 60_000);

  it("LEGITIMATE CALLER STILL SUCCEEDS: founder B reads their OWN contact", async () => {
    const r = await request(app).get(CRM_PATH).set("x-user-id", founderB);
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).toContain("W302 fence beta contact");
    expect(JSON.stringify(r.body)).not.toContain("W302 fence alpha contact");
  }, 60_000);

  it("LEGITIMATE CALLER STILL SUCCEEDS: a founder may still name their OWN company by query param", async () => {
    // The multi-company founder path. An over-tight fix that stopped honouring
    // ?companyId= for companies the caller DOES own would break company
    // switching, and would be a worse outcome than the latent defect.
    const r = await request(app).get(`${CRM_PATH}?companyId=${CO_A}`).set("x-user-id", founderA);
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).toContain("W302 fence alpha contact");
  }, 60_000);
});
