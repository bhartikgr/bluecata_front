/**
 * Wave B1 (3a) addendum — read-only company attribution endpoint.
 *
 * Verifies GET /api/companies/:id/attribution: requires auth, returns the
 * originating Consortium Partner for an attributed company, and null for an
 * unattributed company. Uses the B1 create path to establish an attributed
 * company, so the endpoint is exercised against real linked data.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerPartnerPortfolioCompanyRoutes } from "../partnerPortfolioCompanyRoutes";
import { registerCompanyAttributionRoutes } from "../companyAttributionRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";

const MANAGING = "u_avi_managing";
const PARTNER_A = "ac_consortium_partner_test_partner_inc";

let app: express.Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerPartnerPortfolioCompanyRoutes(app);
  registerCompanyAttributionRoutes(app);
  seedTestPartnerSandbox({ force: true });
});

describe("Wave B1 (3a) — GET /api/companies/:id/attribution", () => {
  it("is auth-guarded (401 when the dev bypass is disabled, i.e. production)", async () => {
    // The endpoint is mounted behind requireAuth. In the sandbox/test harness a
    // dev bypass supplies a default authed context even without a header, so we
    // disable it here to assert the production behaviour: an unauthenticated
    // request is rejected with 401.
    const prev = process.env.DISABLE_DEV_BYPASS;
    process.env.DISABLE_DEV_BYPASS = "1";
    try {
      const r = await request(app).get("/api/companies/co_anything/attribution");
      expect(r.status).toBe(401);
    } finally {
      if (prev === undefined) delete process.env.DISABLE_DEV_BYPASS;
      else process.env.DISABLE_DEV_BYPASS = prev;
    }
  });

  it("returns null for an unattributed company", async () => {
    const r = await request(app)
      .get("/api/companies/co_not_attributed_xyz/attribution")
      .set("x-user-id", MANAGING);
    expect(r.status).toBe(200);
    expect(r.body.attributedPartner).toBeNull();
  });

  it("returns the originating Consortium Partner to the LINKED partner member", async () => {
    // Establish an attributed company via the B1 create path (MANAGING is a
    // member of PARTNER_A, the linked partner).
    const create = await request(app)
      .post("/api/partner/me/portfolio-companies")
      .set("x-user-id", MANAGING)
      .send({ companyName: "Attribution Co", founderEmail: "attr-founder@example.com" });
    expect(create.status).toBe(201);
    const companyId = create.body.companyId as string;
    expect(create.body.attributedPartnerId).toBe(PARTNER_A);

    const r = await request(app)
      .get(`/api/companies/${companyId}/attribution`)
      .set("x-user-id", MANAGING);
    expect(r.status).toBe(200);
    expect(r.body.attributedPartner).not.toBeNull();
    expect(r.body.attributedPartner.partnerId).toBe(PARTNER_A);
    expect(typeof r.body.attributedPartner.name).toBe("string");
    expect(r.body.attributedPartner.name.length).toBeGreaterThan(0);
  });

  it("does NOT leak attribution of a PRIVATE company to an unrelated user (IDOR guard)", async () => {
    // Create a private (unpublished) attributed company.
    const create = await request(app)
      .post("/api/partner/me/portfolio-companies")
      .set("x-user-id", MANAGING)
      .send({ companyName: "Private Probe Co", founderEmail: "private-founder@example.com" });
    expect(create.status).toBe(201);
    const companyId = create.body.companyId as string;

    // An unrelated authenticated user (a seeded investor persona, NOT a member
    // of PARTNER_A and NOT a founder of this company) must NOT see who leads it.
    const r = await request(app)
      .get(`/api/companies/${companyId}/attribution`)
      .set("x-user-id", "u_aisha_patel");
    expect(r.status).toBe(200);
    expect(r.body.attributedPartner).toBeNull();
  });
});
