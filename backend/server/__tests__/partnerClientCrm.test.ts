/**
 * v25.49 Phase-3A/3B — Consortium Partner Clients CRM + comms scoping tests.
 *
 * ADVERSARIAL / fail-closed coverage for the SEPARATE partner-clients CRM
 * engine (partnerClientCrmStore / partnerClientCrmRoutes) plus a participant-
 * gating assertion for the shared comms endpoints the partner Messages/Posts
 * pages reuse (no parallel comms backend was built).
 *
 * The security boundary under test:
 *   - partnerId is ALWAYS derived from the session (x-user-id → persona),
 *     never the URL. A partner may only touch companies attributed to it.
 *   - A companyId attributed to a DIFFERENT partner must return 404 (never
 *     leak existence or stage state) — this is the cross-partner boundary.
 *   - Write endpoints (stage transition, activity) are sub-role gated;
 *     viewers get 403.
 *   - The shared comms channel list is participant-gated: a user who is not a
 *     participant of a private DM never sees it. The partner Messages page
 *     reuses this exact endpoint, so this IS the partner isolation guarantee.
 *
 * Tests hit REAL Express routes via supertest (per the phase brief).
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import http from "node:http";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerPartnerClientCrmRoutes } from "../partnerClientCrmRoutes";
import { seedTestPartnerSandbox, partnerAttributionStore } from "../partnerWorkspaceStore";
import { partnerClientCrmStore } from "../partnerClientCrmStore";
import { PARTNER_CLIENT_DEFAULT_STAGE } from "../../shared/crmStages";
import { _registerSeedPartner } from "../adminContactsStoreShim";
import { installV14TestIdentity } from "./_v14TestIdentity";
import { registerCommsRoutes } from "../commsStore";

const PARTNER_A = "ac_consortium_partner_test_partner_inc";
const PARTNER_B = "ac_consortium_partner_client_crm_iso_b";

/* Companies: co_alpha is attributed to Partner A; co_bravo to Partner B. */
const CO_ALPHA = "co_alpha_client_crm";
const CO_BRAVO = "co_bravo_client_crm";
const CO_UNKNOWN = "co_never_attributed";

let app: express.Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerPartnerClientCrmRoutes(app);
  seedTestPartnerSandbox({ force: true });

  _registerSeedPartner({
    id: PARTNER_B,
    legalName: "CLIENT CRM ISO B",
    displayName: "ISO B",
    email: "client-crm-iso-b@test.example",
    region: "US",
    regionCode: "US",
    tier: "catalyst",
    partnerType: "angel_network",
  });

  partnerAttributionStore.create(PARTNER_A, CO_ALPHA, "u_avi_managing");
  partnerAttributionStore.create(PARTNER_B, CO_BRAVO, "u_avi_managing");
});

describe("Partner Client CRM — read + vocabulary", () => {
  it("GET client-crm-index returns stage map + vocabulary for the partner", async () => {
    const r = await request(app)
      .get("/api/partner/me/client-crm-index")
      .set("x-user-id", "u_avi_managing");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.vocabulary)).toBe(true);
    expect(r.body.vocabulary).toContain("prospect");
    expect(typeof r.body.stages).toBe("object");
  });

  it("GET client-crm/:companyId returns default stage + empty activity for an attributed company", async () => {
    const r = await request(app)
      .get(`/api/partner/me/client-crm/${CO_ALPHA}`)
      .set("x-user-id", "u_avi_managing");
    expect(r.status).toBe(200);
    expect(r.body.companyId).toBe(CO_ALPHA);
    expect(r.body.stage).toBe(PARTNER_CLIENT_DEFAULT_STAGE);
    expect(Array.isArray(r.body.activity)).toBe(true);
  });

  it("GET requires auth — 401/403 when unauthenticated", async () => {
    const r = await request(app).get(`/api/partner/me/client-crm/${CO_ALPHA}`);
    expect([401, 403]).toContain(r.status);
  });
});

describe("Partner Client CRM — cross-partner isolation (ADVERSARIAL)", () => {
  it("GET a company attributed to ANOTHER partner returns 404 (no leak)", async () => {
    const r = await request(app)
      .get(`/api/partner/me/client-crm/${CO_BRAVO}`)
      .set("x-user-id", "u_avi_managing");
    expect(r.status).toBe(404);
    expect(r.body.error).toMatch(/NOT_FOUND_OR_NOT_ATTRIBUTED/);
  });

  it("GET a never-attributed company returns 404", async () => {
    const r = await request(app)
      .get(`/api/partner/me/client-crm/${CO_UNKNOWN}`)
      .set("x-user-id", "u_avi_managing");
    expect(r.status).toBe(404);
  });

  it("PATCH stage on another partner's company returns 404 (attribution checked)", async () => {
    const r = await request(app)
      .patch(`/api/partner/me/client-crm/${CO_BRAVO}`)
      .set("x-user-id", "u_avi_managing")
      .send({ stage: "engaged" });
    expect(r.status).toBe(404);
  });

  it("POST activity on another partner's company returns 404", async () => {
    const r = await request(app)
      .post(`/api/partner/me/client-crm/${CO_BRAVO}/activity`)
      .set("x-user-id", "u_avi_managing")
      .send({ body: "cross-partner probe" });
    expect(r.status).toBe(404);
  });
});

describe("Partner Client CRM — stage transitions + activity timeline", () => {
  it("PATCH moves the stage and records a stage_changed activity", async () => {
    const r = await request(app)
      .patch(`/api/partner/me/client-crm/${CO_ALPHA}`)
      .set("x-user-id", "u_avi_managing")
      .send({ stage: "engaged" });
    expect(r.status).toBe(200);
    expect(r.body.stage).toBe("engaged");
    const changed = r.body.activity.find((a: any) => a.activityType === "stage_changed");
    expect(changed).toBeTruthy();
    expect(changed.meta.to).toBe("engaged");
  });

  it("stage transition is durable — GET reflects the new stage", async () => {
    const r = await request(app)
      .get(`/api/partner/me/client-crm/${CO_ALPHA}`)
      .set("x-user-id", "u_avi_managing");
    expect(r.status).toBe(200);
    expect(r.body.stage).toBe("engaged");
  });

  it("PATCH with an invalid stage returns 400 INVALID_STAGE", async () => {
    const r = await request(app)
      .patch(`/api/partner/me/client-crm/${CO_ALPHA}`)
      .set("x-user-id", "u_avi_managing")
      .send({ stage: "not_a_real_stage" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("INVALID_STAGE");
  });

  it("POST activity appends a note to the timeline (newest-first)", async () => {
    const r = await request(app)
      .post(`/api/partner/me/client-crm/${CO_ALPHA}/activity`)
      .set("x-user-id", "u_avi_managing")
      .send({ body: "Kickoff call scheduled" });
    expect(r.status).toBe(200);
    expect(r.body.activity[0].activityType).toBe("note");
    expect(r.body.activity[0].body).toBe("Kickoff call scheduled");
  });

  it("POST activity with an empty body returns 400", async () => {
    const r = await request(app)
      .post(`/api/partner/me/client-crm/${CO_ALPHA}/activity`)
      .set("x-user-id", "u_avi_managing")
      .send({ body: "   " });
    expect(r.status).toBe(400);
  });
});

describe("Partner Client CRM — sub-role gates (ADVERSARIAL)", () => {
  it("viewer CANNOT change a stage (403)", async () => {
    const r = await request(app)
      .patch(`/api/partner/me/client-crm/${CO_ALPHA}`)
      .set("x-user-id", "u_avi_viewer")
      .send({ stage: "committed" });
    expect(r.status).toBe(403);
  });

  it("viewer CANNOT add an activity (403)", async () => {
    const r = await request(app)
      .post(`/api/partner/me/client-crm/${CO_ALPHA}/activity`)
      .set("x-user-id", "u_avi_viewer")
      .send({ body: "viewer attempt" });
    expect(r.status).toBe(403);
  });
});

describe("Partner Client CRM — store-layer partner scoping (ADVERSARIAL)", () => {
  it("setStage for Partner A is invisible to Partner B's scope", () => {
    partnerClientCrmStore.setStage(PARTNER_A, CO_ALPHA, "committed", "u_avi_managing");
    // Partner B sees none of A's staged companies.
    expect(partnerClientCrmStore.listStages(PARTNER_B)).toEqual({});
    // And a getStage under B's scope falls back to the default (no leak of A's stage).
    expect(partnerClientCrmStore.getStage(PARTNER_B, CO_ALPHA)).toBe(PARTNER_CLIENT_DEFAULT_STAGE);
  });

  it("activity timeline is partner-scoped — B sees none of A's activity", () => {
    partnerClientCrmStore.addActivity(PARTNER_A, CO_ALPHA, { activityType: "note", body: "A-only" });
    expect(partnerClientCrmStore.listActivity(PARTNER_B, CO_ALPHA)).toEqual([]);
  });

  it("every store method throws PARTNER_ID_REQUIRED on empty partnerId", () => {
    expect(() => partnerClientCrmStore.getStage("", CO_ALPHA)).toThrow();
    expect(() => partnerClientCrmStore.listStages("")).toThrow();
    expect(() => partnerClientCrmStore.setStage("", CO_ALPHA, "engaged", "u")).toThrow();
    expect(() => partnerClientCrmStore.addActivity("", CO_ALPHA, { activityType: "note" })).toThrow();
  });
});

/* ====================================================================
   Phase-3B — shared comms participant-gating (partner Messages reuse)
   ==================================================================== */
function buildCommsApp(): express.Express {
  const a = express();
  a.use(express.json());
  installV14TestIdentity(a);
  registerCommsRoutes(a);
  return a;
}

function commsCall(
  commsApp: express.Express,
  method: string,
  path: string,
  opts: { body?: unknown; actorId?: string } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(commsApp).listen(0, () => {
      const port = (server.address() as any).port;
      const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
      const headers: Record<string, string> = {};
      if (data) {
        headers["content-type"] = "application/json";
        headers["content-length"] = String(Buffer.byteLength(data));
      }
      if (opts.actorId) headers["x-actor-id"] = opts.actorId;
      const req = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          server.close();
          try {
            resolve({ status: res.statusCode || 0, body: buf ? JSON.parse(buf) : null });
          } catch {
            resolve({ status: res.statusCode || 0, body: buf });
          }
        });
      });
      req.on("error", reject);
      if (data) req.write(data);
      req.end();
    });
  });
}

describe("Phase-3B comms scoping — private DM is participant-gated", () => {
  it("a non-participant does not see another pair's private DM channel", async () => {
    const commsApp = buildCommsApp();
    const dm = await commsCall(commsApp, "POST", "/api/comms/dm/start", {
      body: { targetUserId: "u_aisha_patel" },
      actorId: "u_maya_chen",
    });
    expect(dm.status).toBe(200);
    const dmChannelId = dm.body.channelId;
    expect(typeof dmChannelId).toBe("string");

    // Participant sees it.
    const mayaList = await commsCall(commsApp, "GET", "/api/comms/channels", { actorId: "u_maya_chen" });
    expect(mayaList.status).toBe(200);
    expect(mayaList.body.some((c: any) => c.id === dmChannelId)).toBe(true);

    // An uninvolved outsider (the isolation guarantee the partner Messages
    // page relies on) must NOT see the private DM.
    const outsiderList = await commsCall(commsApp, "GET", "/api/comms/channels", {
      actorId: "u_partner_comms_outsider_iso",
    });
    expect(outsiderList.status).toBe(200);
    expect(outsiderList.body.some((c: any) => c.id === dmChannelId)).toBe(false);
  });
});
