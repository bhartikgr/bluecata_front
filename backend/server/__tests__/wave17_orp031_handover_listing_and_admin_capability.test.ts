/**
 * WAVE 17 — ORP-031, the two halves Wave 16 left open.
 *
 * WHAT THIS PROVES, and both poles of each:
 *
 * 1. HAND-OVER LISTING. Before this wave `mf_handover` had exactly one reader —
 *    the single-row `WHERE id = ?` inside `handoverConfirm`
 *    (server/managedFounderStore.ts:642). So a hand-over row was durably written
 *    and permanently unreachable: the id existed only in the initiate RESPONSE,
 *    which the client held in React state. This suite asserts a hand-over
 *    initiated in one request is listable in a LATER, INDEPENDENT request (the
 *    "different session" pole that React state could not survive) and confirmable
 *    from the listed id alone.
 * 2. PARTNER SCOPE. Partner B must never see Partner A's hand-overs — asserted
 *    positively (A sees its own) and negatively (B's list is empty), so a bug that
 *    dropped the `partner_id` predicate would fail here rather than pass quietly.
 * 3. ADMIN SURFACE. The six pre-existing `/api/admin/mfcrm/*` routes had ZERO
 *    client callers; the panel added this wave calls all of them, and two of them
 *    took an id (`:handoverId`, `:engagementId`) that no admin-scoped read
 *    returned. Both listings are asserted here, plus `seedableTypes` (so the
 *    client cannot drift from the server's own validator), the seed rejection
 *    pole, and the 403 pole for a non-admin caller.
 *
 * The routes are the REAL Express routes via supertest, and the store is the REAL
 * store over the REAL better-sqlite3 handle — no mocks, no fakes. That matters
 * because of RULE 1: this suite must be able to fail. `scripts/w17/falsify_orp031.py`
 * mutates each sink and requires a red run for every mutation.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerMfcrmRoutes } from "../managedFounderRoutes";
import { applyMfcrmSchema } from "../lib/mfcrmSchema";
import { managedFounderStore, SEEDABLE_PARTNER_TYPES } from "../managedFounderStore";
import { seedTestPartnerSandbox, partnerAttributionStore } from "../partnerWorkspaceStore";
import { _registerSeedPartner } from "../adminContactsStoreShim";

const PARTNER_A = "ac_consortium_partner_test_partner_inc";
const PARTNER_B = "ac_consortium_partner_w17_orp031_b";
const CO_A = "co_w17_orp031_alpha";
const CO_B = "co_w17_orp031_bravo";

/* The sandbox persona used by every other mfcrm suite for Partner A writes. */
const PARTNER_A_USER = "u_avi_managing";
/* Admin persona. getUserContext must report isAdmin for the /api/admin routes. */
const ADMIN_USER = "u_admin";

let app: express.Express;
let engagementId = "";

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerMfcrmRoutes(app);
  applyMfcrmSchema();
  seedTestPartnerSandbox({ force: true });

  _registerSeedPartner({
    id: PARTNER_B,
    legalName: "ORP031 B",
    displayName: "ORP031 B",
    email: "w17-orp031-b@test.example",
    region: "US",
    regionCode: "US",
    tier: "catalyst",
    partnerType: "angel_network",
  });

  partnerAttributionStore.create(PARTNER_A, CO_A, PARTNER_A_USER);
  partnerAttributionStore.create(PARTNER_B, CO_B, PARTNER_A_USER);

  /* Classify A so GATE 1 passes; delegated agency ON so a B→A hand-over can be
     confirmed (GATE 6) rather than testing only the refusal path. */
  managedFounderStore.setCapabilityProfile(PARTNER_A, {
    classified: true, sourcesCapital: true, delegatedAgency: true, advisoryCoseat: true,
  }, PARTNER_A_USER);
});

describe("ORP-031 / collaborator sanity — the REAL store is loaded", () => {
  it("the store exposes listHandovers and the exported seedable type set", () => {
    /* RULE 1: a check that passes may be checking nothing. If the store were
       shadowed by a stub, the assertions below would pass against an empty
       implementation. Pin the collaborator explicitly. */
    expect(typeof managedFounderStore.listHandovers).toBe("function");
    expect(SEEDABLE_PARTNER_TYPES.length).toBeGreaterThan(0);
    expect(SEEDABLE_PARTNER_TYPES).toContain("angel_network");
  });
});

describe("ORP-031 — partner hand-over listing", () => {
  it("creates the engagement the hand-over hangs off (201)", async () => {
    const r = await request(app)
      .post("/api/partner/me/mfcrm/engagements")
      .set("x-user-id", PARTNER_A_USER)
      .send({ companyId: CO_A });
    expect(r.status).toBe(201);
    engagementId = r.body.engagement.id;
    expect(r.body.engagement.mode).toBe("B");
  });

  it("the list is EMPTY before anything is initiated (negative pole)", async () => {
    const r = await request(app)
      .get(`/api/partner/me/mfcrm/handovers?engagementId=${engagementId}`)
      .set("x-user-id", PARTNER_A_USER);
    expect(r.status).toBe(200);
    expect(r.body.handovers).toEqual([]);
  });

  it("after initiate, a LATER independent request lists the pending hand-over", async () => {
    const init = await request(app)
      .post(`/api/partner/me/mfcrm/engagements/${engagementId}/handover`)
      .set("x-user-id", PARTNER_A_USER)
      .send({ direction: "B_TO_A", initiatorParty: "partner", authorityArtifactRef: "doc_w17_orp031" });
    expect(init.status).toBe(201);

    /* A SEPARATE request — this is the pole React state could never satisfy. */
    const list = await request(app)
      .get("/api/partner/me/mfcrm/handovers")
      .set("x-user-id", PARTNER_A_USER);
    expect(list.status).toBe(200);
    const rows = list.body.handovers as any[];
    expect(rows.length).toBeGreaterThan(0);
    const row = rows.find((h) => h.id === init.body.handover.id);
    expect(row).toBeTruthy();
    expect(row.status).toBe("initiated");
    expect(row.direction).toBe("B_TO_A");
    expect(row.initiatorParty).toBe("partner");
    expect(row.engagementId).toBe(engagementId);
    expect(row.companyId).toBe(CO_A);
    expect(row.authorityArtifactRef).toBe("doc_w17_orp031");
    /* camelCase mapping — a raw row would carry engagement_id and break clients. */
    expect(row.engagement_id).toBeUndefined();
  });

  it("the engagementId filter selects, and a bogus filter returns nothing", async () => {
    const hit = await request(app)
      .get(`/api/partner/me/mfcrm/handovers?engagementId=${engagementId}`)
      .set("x-user-id", PARTNER_A_USER);
    expect((hit.body.handovers as any[]).length).toBeGreaterThan(0);
    const miss = await request(app)
      .get("/api/partner/me/mfcrm/handovers?engagementId=mfe_does_not_exist")
      .set("x-user-id", PARTNER_A_USER);
    expect(miss.body.handovers).toEqual([]);
  });

  it("the status filter selects on status", async () => {
    const pending = await request(app)
      .get("/api/partner/me/mfcrm/handovers?status=initiated")
      .set("x-user-id", PARTNER_A_USER);
    expect((pending.body.handovers as any[]).every((h) => h.status === "initiated")).toBe(true);
    const confirmed = await request(app)
      .get("/api/partner/me/mfcrm/handovers?status=confirmed")
      .set("x-user-id", PARTNER_A_USER);
    expect(confirmed.body.handovers).toEqual([]);
  });

  it("an unauthenticated caller is refused (403/401), never served a list", async () => {
    const r = await request(app).get("/api/partner/me/mfcrm/handovers");
    expect([401, 403]).toContain(r.status);
    expect(r.body.handovers).toBeUndefined();
  });

  it("the listed id alone is enough to CONFIRM — the loop is closed", async () => {
    const list = await request(app)
      .get("/api/partner/me/mfcrm/handovers?status=initiated")
      .set("x-user-id", PARTNER_A_USER);
    const id = (list.body.handovers as any[])[0].id;
    const conf = await request(app)
      .post(`/api/partner/me/mfcrm/handovers/${id}/confirm`)
      .set("x-user-id", PARTNER_A_USER)
      .send({});
    expect(conf.status).toBe(200);
    expect(conf.body.engagement.mode).toBe("A");

    /* And the listing reflects the new state rather than a cached one. */
    const after = await request(app)
      .get("/api/partner/me/mfcrm/handovers")
      .set("x-user-id", PARTNER_A_USER);
    const row = (after.body.handovers as any[]).find((h) => h.id === id);
    expect(row.status).toBe("confirmed");
    expect(row.confirmedAt).toBeTruthy();

    /* Negative pole: confirming twice must be refused, not silently repeated. */
    const again = await request(app)
      .post(`/api/partner/me/mfcrm/handovers/${id}/confirm`)
      .set("x-user-id", PARTNER_A_USER)
      .send({});
    expect(again.status).toBeGreaterThanOrEqual(400);
  });
});

describe("ORP-031 — admin capability + admin listings", () => {
  it("GET capability returns the profile AND the server's seedable type set", async () => {
    const r = await request(app)
      .get(`/api/admin/mfcrm/capability/${PARTNER_A}`)
      .set("x-user-id", ADMIN_USER);
    expect(r.status).toBe(200);
    expect(r.body.capability.partnerId).toBe(PARTNER_A);
    expect(r.body.capability.classified).toBe(true);
    /* The admin panel renders its seed dropdown from THIS field. If it were
       missing the dropdown would be empty and the surface unusable. */
    expect(Array.isArray(r.body.seedableTypes)).toBe(true);
    expect(r.body.seedableTypes).toEqual([...SEEDABLE_PARTNER_TYPES]);
  });

  it("a NON-admin caller gets 403 from every admin route (negative pole)", async () => {
    const paths = [
      `/api/admin/mfcrm/capability/${PARTNER_A}`,
      `/api/admin/mfcrm/engagements/${PARTNER_A}`,
      `/api/admin/mfcrm/handovers/${PARTNER_A}`,
    ];
    for (const p of paths) {
      const r = await request(app).get(p).set("x-user-id", PARTNER_A_USER);
      expect(r.status, p).toBe(403);
    }
  });

  it("PATCH capability toggles a flag and the change is READ BACK from the row", async () => {
    const before = await request(app)
      .get(`/api/admin/mfcrm/capability/${PARTNER_A}`)
      .set("x-user-id", ADMIN_USER);
    const wasFundAdmin = before.body.capability.fundAdmin === true;

    const p = await request(app)
      .patch(`/api/admin/mfcrm/capability/${PARTNER_A}`)
      .set("x-user-id", ADMIN_USER)
      .send({ fundAdmin: !wasFundAdmin });
    expect(p.status).toBe(200);
    expect(p.body.capability.fundAdmin).toBe(!wasFundAdmin);

    const after = await request(app)
      .get(`/api/admin/mfcrm/capability/${PARTNER_A}`)
      .set("x-user-id", ADMIN_USER);
    expect(after.body.capability.fundAdmin).toBe(!wasFundAdmin);
  });

  it("seeding with an UNKNOWN type is rejected, not silently seeded all-false", async () => {
    const r = await request(app)
      .post(`/api/admin/mfcrm/capability/${PARTNER_B}/seed`)
      .set("x-user-id", ADMIN_USER)
      .send({ partnerType: "not_a_real_type" });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(String(r.body.error)).toBe("INVALID_CAPABILITY_SEED_TYPE");
  });

  it("seeding Partner B with a LISTED type classifies it (the panel's happy path)", async () => {
    const r = await request(app)
      .post(`/api/admin/mfcrm/capability/${PARTNER_B}/seed`)
      .set("x-user-id", ADMIN_USER)
      .send({ partnerType: "angel_network" });
    expect(r.status).toBe(201);
    expect(r.body.capability.classified).toBe(true);
    expect(r.body.capability.partnerType).toBe("angel_network");
  });

  it("admin engagement listing returns the partner's engagements (feeds trial-override)", async () => {
    const r = await request(app)
      .get(`/api/admin/mfcrm/engagements/${PARTNER_A}`)
      .set("x-user-id", ADMIN_USER);
    expect(r.status).toBe(200);
    const ids = (r.body.engagements as any[]).map((e) => e.id);
    expect(ids).toContain(engagementId);
  });

  it("admin engagement listing is partner-scoped — B's list excludes A's engagement", async () => {
    const r = await request(app)
      .get(`/api/admin/mfcrm/engagements/${PARTNER_B}`)
      .set("x-user-id", ADMIN_USER);
    expect(r.status).toBe(200);
    const ids = (r.body.engagements as any[]).map((e) => e.id);
    expect(ids).not.toContain(engagementId);
  });

  it("admin hand-over listing returns the rows the override route needs", async () => {
    const r = await request(app)
      .get(`/api/admin/mfcrm/handovers/${PARTNER_A}`)
      .set("x-user-id", ADMIN_USER);
    expect(r.status).toBe(200);
    expect((r.body.handovers as any[]).length).toBeGreaterThan(0);
    /* Partner scope on the ADMIN read too: B has no hand-overs. */
    const b = await request(app)
      .get(`/api/admin/mfcrm/handovers/${PARTNER_B}`)
      .set("x-user-id", ADMIN_USER);
    expect(b.body.handovers).toEqual([]);
  });

  it("an admin OVERRIDE confirms a stuck hand-over found via the listing", async () => {
    /* Initiate a fresh A→B hand-over, then override it as the admin would from
       the panel: list → pick id → override. */
    const init = await request(app)
      .post(`/api/partner/me/mfcrm/engagements/${engagementId}/handover`)
      .set("x-user-id", PARTNER_A_USER)
      .send({ direction: "A_TO_B", initiatorParty: "founder" });
    expect(init.status).toBe(201);

    const list = await request(app)
      .get(`/api/admin/mfcrm/handovers/${PARTNER_A}?status=initiated`)
      .set("x-user-id", ADMIN_USER);
    const row = (list.body.handovers as any[]).find((h) => h.id === init.body.handover.id);
    expect(row).toBeTruthy();
    expect(row.initiatorParty).toBe("founder");

    const ovr = await request(app)
      .post(`/api/admin/mfcrm/handovers/${PARTNER_A}/${row.id}/override`)
      .set("x-user-id", ADMIN_USER)
      .send({});
    expect(ovr.status).toBe(200);
    expect(ovr.body.engagement.mode).toBe("B");

    const after = await request(app)
      .get(`/api/admin/mfcrm/handovers/${PARTNER_A}`)
      .set("x-user-id", ADMIN_USER);
    expect((after.body.handovers as any[]).find((h) => h.id === row.id).status).toBe("overridden");
  });

  it("expire-stale-trials answers with a count the panel can report", async () => {
    const r = await request(app)
      .post(`/api/admin/mfcrm/engagements/${PARTNER_A}/expire-stale-trials`)
      .set("x-user-id", ADMIN_USER)
      .send({});
    expect(r.status).toBe(200);
    expect(typeof r.body.lapsed).toBe("number");
  });

  it("trial-override refuses an empty expiry (the panel disables the button too)", async () => {
    const r = await request(app)
      .post(`/api/admin/mfcrm/engagements/${PARTNER_A}/${engagementId}/trial-override`)
      .set("x-user-id", ADMIN_USER)
      .send({});
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toBe("TRIAL_EXPIRES_AT_REQUIRED");
  });
});
