/**
 * Final Partner CRM — Adversarial tests for partner_deal_promotions.
 *
 * 8 attacks:
 *   1. URL-injection: PartnerA cannot promote PartnerB's deal (404, not 403)
 *   2. Sub-role gate: viewer cannot promote (403)
 *   3. Sub-role gate: viewer cannot refer (403)
 *   4. Idempotency / conflict: double-promote returns 409, no duplicate row
 *   5. partnerId comes from SESSION only — body partnerId is ignored
 *   6. Withdraw cross-partner — PartnerA cannot withdraw PartnerB's promotion
 *   7. Hash chain: revisionHash !== "" and prevRevisionHash === GENESIS on v1
 *   8. Bridge event emitted on promote with idempotencyKey === promotionId
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import {
  seedTestPartnerSandbox,
  partnerPipelineStore,
  partnerTeamStore,
  partnerDealPromotionsStore,
  _testPartnerStore,
  TEST_PARTNER_ID,
  TEST_PARTNER_USERS,
} from "../partnerWorkspaceStore";
import { _registerSeedPartner } from "../adminContactsStoreShim";
import { getOutbox } from "../bridgeStore";

let app: express.Express;
const PARTNER_A = TEST_PARTNER_ID;
const PARTNER_B = "ac_consortium_partner_partner_b_inc";
const USER_A_MANAGING = TEST_PARTNER_USERS.managing.userId;          // u_avi_managing
const USER_A_VIEWER = TEST_PARTNER_USERS.viewer.userId;              // u_avi_viewer
const USER_B_MANAGING = "u_partner_b_managing_test";

let dealAId: string;
let dealBId: string;

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);

  // Reset to known state
  _testPartnerStore.reset();
  seedTestPartnerSandbox({ force: true });

  // Seed Partner B (a second consortium partner) so cross-partner attacks work
  _registerSeedPartner({
    id: PARTNER_B,
    legalName: "PARTNER B, INC",
    displayName: "PARTNER B, INC",
    email: "ops@partner-b.example",
    region: "US",
    regionCode: "US",
    tier: "builder",
    partnerType: "accelerator",
  });
  partnerTeamStore.add(PARTNER_B, USER_B_MANAGING, "managing_partner", "u_system_seed", { isSeed: true });

  // Seed one deal per partner
  const dealA = partnerPipelineStore.create(PARTNER_A, {
    dealName: "Alpha Deal (Partner A)", ownerUserId: USER_A_MANAGING,
    sector: "fintech",
    estCheckSizeMinor: 50_000_00,
    currency: "USD",
  }, USER_A_MANAGING);
  dealAId = dealA.id;

  const dealB = partnerPipelineStore.create(PARTNER_B, {
    dealName: "Beta Deal (Partner B)", ownerUserId: USER_B_MANAGING,
    sector: "climate",
    estCheckSizeMinor: 100_000_00,
    currency: "USD",
  }, USER_B_MANAGING);
  dealBId = dealB.id;
});

describe("Adversarial: cross-partner URL injection", () => {
  it("Attack 1: Partner A cannot promote Partner B's deal — 404 DEAL_NOT_FOUND", async () => {
    const r = await request(app)
      .post(`/api/partner/me/pipeline/${dealBId}/promote-to-collective`)
      .set("x-user-id", USER_A_MANAGING)
      .send({ notes: "trying to steal partner B's deal" });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("DEAL_NOT_FOUND");
    // Verify no promotion was created in either partner's namespace
    expect(partnerDealPromotionsStore.listByPipelineDeal(PARTNER_B, dealBId).length).toBe(0);
    expect(partnerDealPromotionsStore.listByPipelineDeal(PARTNER_A, dealBId).length).toBe(0);
  });
});

describe("Adversarial: sub-role gates", () => {
  it("Attack 2: viewer cannot promote to collective — 403", async () => {
    const r = await request(app)
      .post(`/api/partner/me/pipeline/${dealAId}/promote-to-collective`)
      .set("x-user-id", USER_A_VIEWER)
      .send({ notes: "viewer attempt" });
    expect(r.status).toBe(403);
    // No promotion created
    const promos = partnerDealPromotionsStore.listByPipelineDeal(PARTNER_A, dealAId)
      .filter((p) => p.promotionType === "collective_deal_room");
    expect(promos.length).toBe(0);
  });

  it("Attack 3: viewer cannot refer to capavate — 403", async () => {
    const r = await request(app)
      .post(`/api/partner/me/pipeline/${dealAId}/refer-to-capavate`)
      .set("x-user-id", USER_A_VIEWER)
      .send({ notes: "viewer attempt" });
    expect(r.status).toBe(403);
    const promos = partnerDealPromotionsStore.listByPipelineDeal(PARTNER_A, dealAId)
      .filter((p) => p.promotionType === "capavate_referral");
    expect(promos.length).toBe(0);
  });
});

describe("Adversarial: idempotency / conflict", () => {
  it("Attack 4: double-promote same deal returns 409, no duplicate row", async () => {
    // First promote — should succeed (201)
    const r1 = await request(app)
      .post(`/api/partner/me/pipeline/${dealAId}/promote-to-collective`)
      .set("x-user-id", USER_A_MANAGING)
      .send({ notes: "first" });
    expect(r1.status).toBe(201);
    expect(r1.body.promotion.id).toBeDefined();
    const firstPromoId = r1.body.promotion.id;

    // Second attempt — should 409
    const r2 = await request(app)
      .post(`/api/partner/me/pipeline/${dealAId}/promote-to-collective`)
      .set("x-user-id", USER_A_MANAGING)
      .send({ notes: "duplicate" });
    expect(r2.status).toBe(409);
    expect(r2.body.error).toBe("PROMOTION_CONFLICT");

    // v25.15 F2-NH1 — created collective promotions now carry status
    // "pending_collective_review" until chapter-admin approval.
    const promos = partnerDealPromotionsStore
      .listByPipelineDeal(PARTNER_A, dealAId)
      .filter((p) => p.promotionType === "collective_deal_room" && p.status === "pending_collective_review");
    expect(promos.length).toBe(1);
    expect(promos[0].id).toBe(firstPromoId);
  });
});

describe("Adversarial: partnerId derives from SESSION only", () => {
  it("Attack 5: body partnerId is ignored — store-level invariant", () => {
    // Even if a caller could smuggle a body partnerId, the store function takes
    // partnerId as first arg, derived from req.partnerContext (session). We
    // verify the store API does NOT accept a body-side partnerId override:
    // calling create() with PARTNER_A always tags the promotion to PARTNER_A,
    // regardless of any other field on the data payload.
    _testPartnerStore.reset();
    seedTestPartnerSandbox({ force: true });
    _registerSeedPartner({
      id: PARTNER_B,
      legalName: "PARTNER B, INC",
      displayName: "PARTNER B, INC",
      email: "ops@partner-b.example",
      region: "US",
      regionCode: "US",
      tier: "builder",
      partnerType: "accelerator",
    });
    partnerTeamStore.add(PARTNER_B, USER_B_MANAGING, "managing_partner", "u_system_seed", { isSeed: true });
    const freshDeal = partnerPipelineStore.create(PARTNER_A, { dealName: "Gamma", ownerUserId: USER_A_MANAGING }, USER_A_MANAGING);

    const promo = partnerDealPromotionsStore.create(
      PARTNER_A,
      freshDeal.id,
      // Attacker payload tries to set companyId to a partner-B-owned thing.
      // The store correctly attributes promotion.partnerId from the FIRST arg only.
      { promotionType: "collective_deal_room", companyId: "co_partner_b_target", notes: "smuggled" },
      USER_A_MANAGING,
    );
    expect(promo.partnerId).toBe(PARTNER_A);
    expect(promo.partnerId).not.toBe(PARTNER_B);

    // And listByPartner(PARTNER_B) MUST NOT return this row
    const bPromos = partnerDealPromotionsStore.listByPartner(PARTNER_B);
    expect(bPromos.find((p) => p.id === promo.id)).toBeUndefined();
  });
});

describe("Adversarial: cross-partner withdraw", () => {
  it("Attack 6: Partner A cannot withdraw Partner B's promotion — 404", async () => {
    // Set up a fresh state with one promotion on Partner B's deal
    _testPartnerStore.reset();
    seedTestPartnerSandbox({ force: true });
    _registerSeedPartner({
      id: PARTNER_B,
      legalName: "PARTNER B, INC",
      displayName: "PARTNER B, INC",
      email: "ops@partner-b.example",
      region: "US",
      regionCode: "US",
      tier: "builder",
      partnerType: "accelerator",
    });
    partnerTeamStore.add(PARTNER_B, USER_B_MANAGING, "managing_partner", "u_system_seed", { isSeed: true });
    const dealB = partnerPipelineStore.create(PARTNER_B, { dealName: "Beta v2", ownerUserId: USER_B_MANAGING }, USER_B_MANAGING);
    const promoB = partnerDealPromotionsStore.create(
      PARTNER_B,
      dealB.id,
      { promotionType: "collective_deal_room", notes: null },
      USER_B_MANAGING,
    );

    // Partner A tries to withdraw Partner B's promotion via URL injection
    const r = await request(app)
      .post(`/api/partner/me/promotions/${promoB.id}/withdraw`)
      .set("x-user-id", USER_A_MANAGING)
      .send({});
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("PROMOTION_NOT_FOUND");

    // The promotion should still exist in Partner B's namespace (now
    // status='pending_collective_review' per v25.15 F2-NH1).
    const stillThere = partnerDealPromotionsStore.getById(promoB.id);
    expect(stillThere?.status).toBe("pending_collective_review");
    expect(stillThere?.partnerId).toBe(PARTNER_B);
  });
});

describe("Adversarial: hash chain integrity", () => {
  it("Attack 7: v1 has prevRevisionHash === GENESIS and revisionHash !== ''", () => {
    _testPartnerStore.reset();
    seedTestPartnerSandbox({ force: true });
    const deal = partnerPipelineStore.create(PARTNER_A, { dealName: "Delta", ownerUserId: USER_A_MANAGING }, USER_A_MANAGING);
    const p = partnerDealPromotionsStore.create(
      PARTNER_A,
      deal.id,
      { promotionType: "collective_deal_room" },
      USER_A_MANAGING,
    );
    expect(p.version).toBe(1);
    expect(p.prevRevisionHash).toBe(_testPartnerStore.GENESIS);
    expect(p.revisionHash).not.toBe("");
    expect(p.revisionHash.length).toBeGreaterThan(0);
    // Snapshot v1 hash BEFORE withdraw mutates the underlying record
    const v1Hash = p.revisionHash;

    // After withdrawal, v2 must chain off v1
    const withdrawn = partnerDealPromotionsStore.withdraw(PARTNER_A, p.id, USER_A_MANAGING);
    expect(withdrawn.version).toBe(2);
    expect(withdrawn.prevRevisionHash).toBe(v1Hash);
    expect(withdrawn.revisionHash).not.toBe(v1Hash);

    // Verify history captured both revisions
    const hist = _testPartnerStore.raw.dealPromotionsHistory.filter((h) => h.id === p.id);
    expect(hist.length).toBe(2);
    expect(hist.map((h) => h.version).sort()).toEqual([1, 2]);
  });
});

describe("Adversarial: bridge event emission", () => {
  it("Attack 8: bridge event emitted with idempotencyKey === promotionId", () => {
    _testPartnerStore.reset();
    seedTestPartnerSandbox({ force: true });
    const beforeOutbox = getOutbox().length;
    const deal = partnerPipelineStore.create(PARTNER_A, { dealName: "Epsilon", ownerUserId: USER_A_MANAGING }, USER_A_MANAGING);
    const p = partnerDealPromotionsStore.create(
      PARTNER_A,
      deal.id,
      { promotionType: "collective_deal_room", notes: null },
      USER_A_MANAGING,
    );
    const after = getOutbox();
    expect(after.length).toBeGreaterThan(beforeOutbox);

    // The most recent event of our type must reference this promotion
    const promoEvents = after.filter(
      (entry) =>
        entry.envelope.eventType === "partner.deal.promoted_to_collective" &&
        (entry.envelope.payload as { promotionId?: string }).promotionId === p.id,
    );
    expect(promoEvents.length).toBe(1);
    const payload = promoEvents[0].envelope.payload as {
      idempotencyKey?: string;
      partnerId?: string;
      pipelineDealId?: string;
    };
    expect(payload.idempotencyKey).toBe(p.id);
    expect(payload.partnerId).toBe(PARTNER_A);
    expect(payload.pipelineDealId).toBe(deal.id);

    // Also test the referral path emits the other event type
    const dealZ = partnerPipelineStore.create(PARTNER_A, { dealName: "Zeta", ownerUserId: USER_A_MANAGING }, USER_A_MANAGING);
    const pZ = partnerDealPromotionsStore.create(
      PARTNER_A,
      dealZ.id,
      { promotionType: "capavate_referral", targetEmail: "founder@zeta.example" },
      USER_A_MANAGING,
    );
    const referEvents = getOutbox().filter(
      (entry) =>
        entry.envelope.eventType === "partner.deal.referred_to_capavate" &&
        (entry.envelope.payload as { promotionId?: string }).promotionId === pZ.id,
    );
    expect(referEvents.length).toBe(1);
    expect((referEvents[0].envelope.payload as { idempotencyKey?: string }).idempotencyKey).toBe(pZ.id);
  });
});
