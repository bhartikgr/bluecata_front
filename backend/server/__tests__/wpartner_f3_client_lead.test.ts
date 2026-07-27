/**
 * w-partner F3 — designated partner-member lead on the client CRM.
 *
 * ANTI-VACUITY. Each test here fails if the specific defect it names is
 * reintroduced; none of them pass merely because the endpoint returns 200.
 *
 *  1. CARRY-FORWARD (the C4 defect). setStage builds a WHOLE new row and
 *     replaces the cached projection with it. If it stops copying the existing
 *     leadUserId, the lead vanishes from RAM on the next stage change even
 *     though the DB column is untouched — so the assertion is on the IN-MEMORY
 *     projection with NO re-hydrate, plus a separate raw-DB assertion. A test
 *     that hydrated first would pass against the broken code and prove nothing.
 *  2. The inverse: lead_user_id must NOT be in persistCrm's ON CONFLICT SET
 *     list, because `excluded` derives from the row setStage builds. Covered by
 *     the raw-DB half of (1).
 *  3. LEAD_NOT_ACTIVE_MEMBER — a member of ANOTHER workspace and a REMOVED
 *     member are both rejected 400 (partnerTeamStore.listByPartner already
 *     filters status === "active", so one check covers both).
 *  4. Hydrator round-trip — the column actually survives a boot rebuild.
 *  5. No-drop — stage, activity timeline and the existing gates still work.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerPartnerClientCrmRoutes } from "../partnerClientCrmRoutes";
import {
  seedTestPartnerSandbox,
  partnerAttributionStore,
  partnerTeamStore,
} from "../partnerWorkspaceStore";
import {
  partnerClientCrmStore,
  hydratePartnerClientCrmStore,
} from "../partnerClientCrmStore";
import { PARTNER_CLIENT_DEFAULT_STAGE } from "../../shared/crmStages";
import { _registerSeedPartner } from "../adminContactsStoreShim";
import { rawDb } from "../db/connection";

const PARTNER_A = "ac_consortium_partner_test_partner_inc";
const PARTNER_B = "ac_consortium_partner_f3_lead_iso_b";

const CO_LEAD = "co_f3_lead_alpha";
const CO_LEAD_B = "co_f3_lead_bravo";

/* Active seats on PARTNER_A (seeded sandbox). */
const MANAGING = "u_avi_managing";
const VIEWER_SEAT = "u_avi_viewer";
/* Seats that must NOT be assignable as PARTNER_A's lead. */
const FOREIGN_MEMBER = "u_f3_foreign_member";
const REMOVED_MEMBER = "u_f3_removed_member";

let app: express.Express;

function dbLead(partnerId: string, companyId: string): string | null | undefined {
  const row = rawDb()
    .prepare(`SELECT lead_user_id FROM partner_client_crm WHERE partner_id = ? AND company_id = ?`)
    .get(partnerId, companyId) as { lead_user_id: string | null } | undefined;
  return row ? row.lead_user_id : undefined;
}

function dbStage(partnerId: string, companyId: string): string | undefined {
  const row = rawDb()
    .prepare(`SELECT stage FROM partner_client_crm WHERE partner_id = ? AND company_id = ?`)
    .get(partnerId, companyId) as { stage: string } | undefined;
  return row ? row.stage : undefined;
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerPartnerClientCrmRoutes(app);
  seedTestPartnerSandbox({ force: true });

  _registerSeedPartner({
    id: PARTNER_B,
    legalName: "F3 LEAD ISO B",
    displayName: "F3 ISO B",
    email: "f3-lead-iso-b@test.example",
    region: "US",
    regionCode: "US",
    tier: "catalyst",
    partnerType: "angel_network",
  });

  partnerAttributionStore.create(PARTNER_A, CO_LEAD, MANAGING);
  partnerAttributionStore.create(PARTNER_B, CO_LEAD_B, MANAGING);

  /* An ACTIVE member of the OTHER workspace. */
  partnerTeamStore.add(PARTNER_B, FOREIGN_MEMBER, "associate", "u_system_seed", { isSeed: true });
  /* A member of THIS workspace who has since been removed. */
  partnerTeamStore.add(PARTNER_A, REMOVED_MEMBER, "associate", "u_system_seed", { isSeed: true });
  partnerTeamStore.remove(PARTNER_A, REMOVED_MEMBER, "u_system_seed");
});

describe("F3 — setStage CARRIES FORWARD the designated lead (C4 regression)", () => {
  it("keeps leadUserId in the IN-MEMORY projection after a stage change (no re-hydrate)", () => {
    partnerClientCrmStore.setLead(PARTNER_A, CO_LEAD, VIEWER_SEAT, MANAGING);
    expect(partnerClientCrmStore.getLead(PARTNER_A, CO_LEAD)).toBe(VIEWER_SEAT);

    partnerClientCrmStore.setStage(PARTNER_A, CO_LEAD, "engaged", MANAGING);

    // Deliberately NOT hydrating: the defect is that setStage replaces the
    // cached row with one that has no lead. Reading the live projection is the
    // only assertion that catches it.
    expect(partnerClientCrmStore.getLead(PARTNER_A, CO_LEAD)).toBe(VIEWER_SEAT);
    expect(partnerClientCrmStore.getStage(PARTNER_A, CO_LEAD)).toBe("engaged");
    expect(partnerClientCrmStore.listLeads(PARTNER_A)[CO_LEAD]).toBe(VIEWER_SEAT);
  });

  it("leaves the lead_user_id COLUMN untouched across stage changes", () => {
    expect(dbLead(PARTNER_A, CO_LEAD)).toBe(VIEWER_SEAT);
    partnerClientCrmStore.setStage(PARTNER_A, CO_LEAD, "committed", MANAGING);
    // Would be NULL if lead_user_id were added to persistCrm's ON CONFLICT
    // SET list, because `excluded` comes from the row setStage builds.
    expect(dbLead(PARTNER_A, CO_LEAD)).toBe(VIEWER_SEAT);
  });

  it("survives a hydrator round-trip (the column is really persisted)", async () => {
    await hydratePartnerClientCrmStore();
    expect(partnerClientCrmStore.getLead(PARTNER_A, CO_LEAD)).toBe(VIEWER_SEAT);
    expect(partnerClientCrmStore.getStage(PARTNER_A, CO_LEAD)).toBe("committed");
  });
});

describe("F3 — setLead store semantics", () => {
  it("creates a row at the DEFAULT stage when none exists, and logs lead_assigned", () => {
    const fresh = "co_f3_lead_fresh";
    partnerAttributionStore.create(PARTNER_A, fresh, MANAGING);
    const row = partnerClientCrmStore.setLead(PARTNER_A, fresh, MANAGING, MANAGING);
    expect(row.stage).toBe(PARTNER_CLIENT_DEFAULT_STAGE);
    expect(row.leadUserId).toBe(MANAGING);
    expect(dbLead(PARTNER_A, fresh)).toBe(MANAGING);
    const assigned = partnerClientCrmStore
      .listActivity(PARTNER_A, fresh)
      .find((a) => a.activityType === "lead_assigned");
    expect(assigned).toBeTruthy();
    expect(assigned!.meta).toMatchObject({ from: null, to: MANAGING });
  });

  it("null CLEARS the lead in RAM and in the column", () => {
    const row = partnerClientCrmStore.setLead(PARTNER_A, CO_LEAD, null, MANAGING);
    expect(row.leadUserId).toBeNull();
    expect(partnerClientCrmStore.getLead(PARTNER_A, CO_LEAD)).toBeNull();
    expect(dbLead(PARTNER_A, CO_LEAD)).toBeNull();
    expect(partnerClientCrmStore.listLeads(PARTNER_A)[CO_LEAD]).toBeUndefined();
    // Re-assign so the endpoint tests below start from a known state.
    partnerClientCrmStore.setLead(PARTNER_A, CO_LEAD, VIEWER_SEAT, MANAGING);
  });

  it("is partner-scoped and rejects an empty partnerId", () => {
    expect(partnerClientCrmStore.getLead(PARTNER_B, CO_LEAD)).toBeNull();
    expect(partnerClientCrmStore.listLeads(PARTNER_B)[CO_LEAD]).toBeUndefined();
    expect(() => partnerClientCrmStore.setLead("", CO_LEAD, VIEWER_SEAT, MANAGING)).toThrow();
    expect(() => partnerClientCrmStore.getLead("", CO_LEAD)).toThrow();
  });
});

describe("F3 — PATCH /client-crm/:companyId/lead (ADVERSARIAL)", () => {
  it("assigns an ACTIVE member of THIS workspace", async () => {
    const r = await request(app)
      .patch(`/api/partner/me/client-crm/${CO_LEAD}/lead`)
      .set("x-user-id", MANAGING)
      .send({ leadUserId: MANAGING });
    expect(r.status).toBe(200);
    expect(r.body.leadUserId).toBe(MANAGING);
    expect(r.body.activity.some((a: any) => a.activityType === "lead_assigned")).toBe(true);
  });

  it("rejects an ACTIVE member of ANOTHER workspace with 400 LEAD_NOT_ACTIVE_MEMBER", async () => {
    const r = await request(app)
      .patch(`/api/partner/me/client-crm/${CO_LEAD}/lead`)
      .set("x-user-id", MANAGING)
      .send({ leadUserId: FOREIGN_MEMBER });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("LEAD_NOT_ACTIVE_MEMBER");
    // And the previous lead is untouched by the rejected write.
    expect(partnerClientCrmStore.getLead(PARTNER_A, CO_LEAD)).toBe(MANAGING);
  });

  it("rejects a REMOVED member of this workspace with 400 LEAD_NOT_ACTIVE_MEMBER", async () => {
    const r = await request(app)
      .patch(`/api/partner/me/client-crm/${CO_LEAD}/lead`)
      .set("x-user-id", MANAGING)
      .send({ leadUserId: REMOVED_MEMBER });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("LEAD_NOT_ACTIVE_MEMBER");
  });

  it("rejects an unknown user id with 400", async () => {
    const r = await request(app)
      .patch(`/api/partner/me/client-crm/${CO_LEAD}/lead`)
      .set("x-user-id", MANAGING)
      .send({ leadUserId: "u_does_not_exist_anywhere" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("LEAD_NOT_ACTIVE_MEMBER");
  });

  it("returns 404 for a company attributed to ANOTHER partner (no existence leak)", async () => {
    const r = await request(app)
      .patch(`/api/partner/me/client-crm/${CO_LEAD_B}/lead`)
      .set("x-user-id", MANAGING)
      .send({ leadUserId: MANAGING });
    expect(r.status).toBe(404);
    expect(r.body.error).toMatch(/NOT_FOUND_OR_NOT_ATTRIBUTED/);
  });

  it("attribution is checked BEFORE membership — a bad lead on a foreign company is still 404", async () => {
    const r = await request(app)
      .patch(`/api/partner/me/client-crm/${CO_LEAD_B}/lead`)
      .set("x-user-id", MANAGING)
      .send({ leadUserId: FOREIGN_MEMBER });
    expect(r.status).toBe(404);
  });

  it("a viewer CANNOT assign a lead (403)", async () => {
    const r = await request(app)
      .patch(`/api/partner/me/client-crm/${CO_LEAD}/lead`)
      .set("x-user-id", VIEWER_SEAT)
      .send({ leadUserId: MANAGING });
    expect(r.status).toBe(403);
  });

  it("requires auth", async () => {
    const r = await request(app)
      .patch(`/api/partner/me/client-crm/${CO_LEAD}/lead`)
      .send({ leadUserId: MANAGING });
    expect([401, 403]).toContain(r.status);
  });

  it("rejects a non-string, non-null leadUserId with 400", async () => {
    const r = await request(app)
      .patch(`/api/partner/me/client-crm/${CO_LEAD}/lead`)
      .set("x-user-id", MANAGING)
      .send({ leadUserId: 42 });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("LEAD_USER_ID_REQUIRED");
  });

  it("null clears the lead through the endpoint", async () => {
    const r = await request(app)
      .patch(`/api/partner/me/client-crm/${CO_LEAD}/lead`)
      .set("x-user-id", MANAGING)
      .send({ leadUserId: null });
    expect(r.status).toBe(200);
    expect(r.body.leadUserId).toBeNull();
  });
});

/**
 * CODE-REVIEW B2 — setLead must not consult the RAM projection to answer a
 * DATABASE question.
 *
 * `const existing = crmByKey.get(...)` is a RAM read. On a cold or degraded boot
 * the RAM map can be empty while the DB row exists — precisely the state the C3
 * hydrator guard was added to survive, since a failed SELECT is swallowed
 * non-fatally and leaves the projection empty. Guarding the durable write on
 * `existing` then breaks two things at once:
 *
 *   (a) the lead never persists — persistCrm's ON CONFLICT SET list is
 *       stage/updated_at/updated_by only (deliberately, per C4), so the one
 *       statement that moves lead_user_id is persistLead, and it was skipped.
 *   (b) the durable stage is DESTROYED — `stage: existing?.stage ?? DEFAULT`
 *       falls back to the default on a RAM miss, and `stage` IS in the ON
 *       CONFLICT SET list, so assigning a lead silently rewrites a real stage
 *       transition back to prospect.
 *
 * crmByKey is module-private with no test hook, so the cold-projection state is
 * reproduced the way production reaches it: the DB row is written directly and
 * the store is never told about it. `listStages()` is RAM-derived, so its
 * omission of this company is a precise proof that the projection really is cold.
 */
describe("F3 — setLead on a COLD RAM projection (CODE-REVIEW B2)", () => {
  // CODE-REVIEW (decider): the two cold-projection tests MUST use DISTINCT company
  // ids. setLead ends with crmByKey.set(...), warming the RAM projection, and there
  // is no exported crmByKey reset hook — so a shared id would leave the second test's
  // "projection is cold" precondition warm (and the test vacuous / red). Distinct ids
  // keep each test genuinely cold.
  const CO_COLD_A = "co_f3_lead_cold_projection_a";
  const CO_COLD_B = "co_f3_lead_cold_projection_b";

  function seedDbOnlyRow(companyId: string, stage: string): void {
    rawDb()
      .prepare(
        `INSERT INTO partner_client_crm
           (partner_id, company_id, stage, updated_at, updated_by, lead_user_id)
         VALUES (?, ?, ?, ?, ?, NULL)
         ON CONFLICT(partner_id, company_id) DO UPDATE SET
           stage = excluded.stage, lead_user_id = NULL`,
      )
      .run(PARTNER_A, companyId, stage, new Date().toISOString(), MANAGING);
  }

  it("persists the lead even though the RAM projection has no row", () => {
    seedDbOnlyRow(CO_COLD_A, "committed");

    // The scenario is only meaningful if RAM really is cold and the DB really
    // is populated. Assert both, or the test proves nothing.
    expect(partnerClientCrmStore.listStages(PARTNER_A)[CO_COLD_A]).toBeUndefined();
    expect(partnerClientCrmStore.getStage(PARTNER_A, CO_COLD_A)).toBe(PARTNER_CLIENT_DEFAULT_STAGE);
    expect(dbStage(PARTNER_A, CO_COLD_A)).toBe("committed");
    expect(dbLead(PARTNER_A, CO_COLD_A)).toBeNull();

    partnerClientCrmStore.setLead(PARTNER_A, CO_COLD_A, VIEWER_SEAT, MANAGING);

    // Pre-fix this is still NULL: `if (existing) persistLead(row)` skipped the
    // only write that moves the column, so the 200 + RAM update were a lie that
    // evaporated at the next restart.
    expect(dbLead(PARTNER_A, CO_COLD_A)).toBe(VIEWER_SEAT);
    expect(partnerClientCrmStore.getLead(PARTNER_A, CO_COLD_A)).toBe(VIEWER_SEAT);
  });

  /* B2 half (b) — FIXED: setLead now resolves the existing stage from the DB when
     the RAM projection is cold (partnerClientCrmStore.ts readStageFromDb), so a
     lead assignment can no longer reset a client's durable stage via persistCrm's
     `stage = excluded.stage` ON CONFLICT clause. This test asserts the correct
     behaviour and fails against the pre-fix tree (stage would read 'prospect'). */
  it("does NOT reset the durable stage when the RAM projection is cold", () => {
    seedDbOnlyRow(CO_COLD_B, "committed");
    expect(partnerClientCrmStore.listStages(PARTNER_A)[CO_COLD_B]).toBeUndefined();
    expect(dbStage(PARTNER_A, CO_COLD_B)).toBe("committed");

    partnerClientCrmStore.setLead(PARTNER_A, CO_COLD_B, VIEWER_SEAT, MANAGING);

    expect(dbLead(PARTNER_A, CO_COLD_B)).toBe(VIEWER_SEAT);
    // Pre-fix: 'prospect' — a real stage transition destroyed by a lead assignment.
    expect(dbStage(PARTNER_A, CO_COLD_B)).toBe("committed");
  });
});

describe("F3 — NO-DROP: the pre-existing CRM surface still works", () => {
  it("the stage PATCH and activity POST are unchanged, and reads expose the lead", async () => {
    const stage = await request(app)
      .patch(`/api/partner/me/client-crm/${CO_LEAD}`)
      .set("x-user-id", MANAGING)
      .send({ stage: "engaged" });
    expect(stage.status).toBe(200);
    expect(stage.body.stage).toBe("engaged");

    const note = await request(app)
      .post(`/api/partner/me/client-crm/${CO_LEAD}/activity`)
      .set("x-user-id", MANAGING)
      .send({ body: "still works" });
    expect(note.status).toBe(200);
    expect(note.body.activity[0].body).toBe("still works");

    const get = await request(app)
      .get(`/api/partner/me/client-crm/${CO_LEAD}`)
      .set("x-user-id", MANAGING);
    expect(get.status).toBe(200);
    expect(get.body.stage).toBe("engaged");
    expect("leadUserId" in get.body).toBe(true);

    const index = await request(app)
      .get("/api/partner/me/client-crm-index")
      .set("x-user-id", MANAGING);
    expect(index.status).toBe(200);
    expect(typeof index.body.stages).toBe("object");
    expect(typeof index.body.leads).toBe("object");
    expect(Array.isArray(index.body.vocabulary)).toBe(true);
  });
});
