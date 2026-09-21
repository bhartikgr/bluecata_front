/**
 * W-MFCRM — cross-partner isolation (ADVERSARIAL, route-level via supertest).
 *
 * The security boundary under test (mirrors partnerClientCrm.test.ts):
 *   - partnerId is ALWAYS derived from the session (x-user-id → persona), never
 *     the URL or the request body. A partner may only touch companies attributed
 *     to it; a body-supplied partnerId is ignored.
 *   - A companyId attributed to a DIFFERENT partner (or never attributed) returns
 *     404 — never leaking existence or engagement state — BEFORE the store or any
 *     capability gate is consulted.
 *   - Write endpoints are sub-role gated; viewers get 403.
 *
 * Tests hit the REAL Express routes via supertest.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerMfcrmRoutes } from "../managedFounderRoutes";
import { applyMfcrmSchema } from "../lib/mfcrmSchema";
import { managedFounderStore } from "../managedFounderStore";
import { seedTestPartnerSandbox, partnerAttributionStore } from "../partnerWorkspaceStore";
import { _registerSeedPartner } from "../adminContactsStoreShim";

const PARTNER_A = "ac_consortium_partner_test_partner_inc";
const PARTNER_B = "ac_consortium_partner_mfcrm_iso_b";

const CO_ALPHA = "co_alpha_mfcrm";   // attributed to Partner A
const CO_BRAVO = "co_bravo_mfcrm";   // attributed to Partner B
const CO_UNKNOWN = "co_never_attributed_mfcrm";

let app: express.Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerMfcrmRoutes(app);
  applyMfcrmSchema();
  seedTestPartnerSandbox({ force: true });

  _registerSeedPartner({
    id: PARTNER_B,
    legalName: "MFCRM ISO B",
    displayName: "ISO B",
    email: "mfcrm-iso-b@test.example",
    region: "US",
    regionCode: "US",
    tier: "catalyst",
    partnerType: "angel_network",
  });

  partnerAttributionStore.create(PARTNER_A, CO_ALPHA, "u_avi_managing");
  partnerAttributionStore.create(PARTNER_B, CO_BRAVO, "u_avi_managing");

  // Classify Partner A so its own-scope happy path can succeed (GATE 1).
  managedFounderStore.setCapabilityProfile(PARTNER_A, {
    classified: true, sourcesCapital: true, delegatedAgency: true,
    spvWriteAuthority: true, collectiveFronting: true,
  }, "u_avi_managing");
});

describe("MFCRM isolation — own-scope happy path", () => {
  it("managing partner may create an engagement for an attributed company (201)", async () => {
    const r = await request(app)
      .post("/api/partner/me/mfcrm/engagements")
      .set("x-user-id", "u_avi_managing")
      .send({ companyId: CO_ALPHA });
    expect(r.status).toBe(201);
    expect(r.body.engagement.companyId).toBe(CO_ALPHA);
    expect(r.body.engagement.mode).toBe("B");
  });

  it("GET own engagement by id returns it (200)", async () => {
    const list = await request(app)
      .get("/api/partner/me/mfcrm/engagements")
      .set("x-user-id", "u_avi_managing");
    const id = list.body.engagements[0].id;
    const r = await request(app)
      .get(`/api/partner/me/mfcrm/engagements/${id}`)
      .set("x-user-id", "u_avi_managing");
    expect(r.status).toBe(200);
    expect(r.body.engagement.id).toBe(id);
  });
});

describe("MFCRM isolation — cross-partner denial (ADVERSARIAL)", () => {
  it("POST engagement for ANOTHER partner's company returns 404 (no leak)", async () => {
    const r = await request(app)
      .post("/api/partner/me/mfcrm/engagements")
      .set("x-user-id", "u_avi_managing")
      .send({ companyId: CO_BRAVO });
    expect(r.status).toBe(404);
    expect(r.body.error).toMatch(/NOT_FOUND_OR_NOT_ATTRIBUTED/);
  });

  it("POST engagement for a never-attributed company returns 404", async () => {
    const r = await request(app)
      .post("/api/partner/me/mfcrm/engagements")
      .set("x-user-id", "u_avi_managing")
      .send({ companyId: CO_UNKNOWN });
    expect(r.status).toBe(404);
  });

  it("GET attribution / layers / spv-on-behalf on another partner's company returns 404", async () => {
    for (const path of [
      `/api/partner/me/mfcrm/attribution/${CO_BRAVO}`,
      `/api/partner/me/mfcrm/layers/${CO_BRAVO}`,
      `/api/partner/me/mfcrm/spv-on-behalf?companyId=${CO_BRAVO}`,
    ]) {
      const r = await request(app).get(path).set("x-user-id", "u_avi_managing");
      expect(r.status, path).toBe(404);
    }
  });

  it("a fabricated engagement id (not this partner's) returns 404", async () => {
    const r = await request(app)
      .get("/api/partner/me/mfcrm/engagements/mfeng_does_not_exist")
      .set("x-user-id", "u_avi_managing");
    expect(r.status).toBe(404);
  });
});

describe("MFCRM isolation — partnerId is session-derived, body value is ignored", () => {
  it("a body-supplied partnerId cannot redirect the op to another partner", async () => {
    // Attacker supplies Partner B's id in the body but a company attributed to A:
    // the route MUST use the session (A) and succeed against A's own company,
    // proving the body partnerId is never consulted.
    const r = await request(app)
      .post("/api/partner/me/mfcrm/attribution")
      .set("x-user-id", "u_avi_managing")
      .send({ companyId: CO_ALPHA, partnerId: PARTNER_B });
    expect(r.status).toBe(201);
    // The stamp lands under Partner A's scope (readable by A).
    const read = await request(app)
      .get(`/api/partner/me/mfcrm/attribution/${CO_ALPHA}`)
      .set("x-user-id", "u_avi_managing");
    expect(read.status).toBe(200);
    expect(read.body.attributions.length).toBeGreaterThan(0);
  });
});

describe("MFCRM isolation — auth + sub-role gates (ADVERSARIAL)", () => {
  it("unauthenticated GET is denied (401/403)", async () => {
    const r = await request(app).get("/api/partner/me/mfcrm/engagements");
    expect([401, 403]).toContain(r.status);
  });

  it("viewer CANNOT create an engagement (403)", async () => {
    const r = await request(app)
      .post("/api/partner/me/mfcrm/engagements")
      .set("x-user-id", "u_avi_viewer")
      .send({ companyId: CO_ALPHA });
    expect(r.status).toBe(403);
  });
});
