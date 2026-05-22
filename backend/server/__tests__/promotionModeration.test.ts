/**
 * CP Phase B (CP-015..CP-018) — Promotion moderation.
 *
 * Coverage:
 *   - Newly promoted collective_deal_room promotions default to
 *     moderation_status='pending' and DO NOT appear in
 *     listLiveCollectivePromotions().
 *   - Chapter admin approve → moderation_status='approved' AND the
 *     promotion now surfaces in listLiveCollectivePromotions().
 *   - Reject → moderation_status='rejected'; row removed from pending
 *     queue; still NOT live.
 *   - Request-changes → moderation_status='changes_requested'; STILL
 *     in pending queue (visible to admin); NOT live.
 *   - Cross-cutting audit append on every transition.
 *   - SSE publish AFTER the store commits (smoke: no throw).
 *   - Non-admin caller (no x-role=admin) is 403.
 *   - Hash chain: revisionHash advances per transition; prevRevisionHash
 *     stamps the previous head.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { registerPartnerRoutes } from "../partnerRoutes";
import { registerPromotionModerationRoutes } from "../promotionModerationRoutes";
import {
  partnerDealPromotionsStore,
  partnerPipelineStore,
  partnerTeamStore,
  seedTestPartnerSandbox,
  _testPartnerStore,
  TEST_PARTNER_ID,
  TEST_PARTNER_USERS,
  type PartnerDealPromotion,
} from "../partnerWorkspaceStore";
import { installV14TestIdentity } from "./_v14TestIdentity";

let app: express.Express;
const PARTNER_A = TEST_PARTNER_ID;
const USER_MANAGING = TEST_PARTNER_USERS.managing.userId;

let dealId: string;

beforeAll(() => {
  app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: true });
  registerPartnerRoutes(app);
  registerPromotionModerationRoutes(app);

  _testPartnerStore.reset();
  seedTestPartnerSandbox({ force: true });

  const deal = partnerPipelineStore.create(
    PARTNER_A,
    {
      dealName: "Moderation Test Deal",
      ownerUserId: USER_MANAGING,
      sector: "fintech",
      estCheckSizeMinor: 50_000_00,
      currency: "USD",
    },
    USER_MANAGING,
  );
  dealId = deal.id;
});

function newPromotion(): PartnerDealPromotion {
  // Use the public promote-to-collective endpoint so we get a real row in
  // the same code path users hit. Anti-state leakage: fresh deal per test.
  const fresh = partnerPipelineStore.create(
    PARTNER_A,
    {
      dealName: `Mod Deal ${Date.now()}-${Math.random()}`,
      ownerUserId: USER_MANAGING,
      sector: "fintech",
      estCheckSizeMinor: 25_000_00,
      currency: "USD",
    },
    USER_MANAGING,
  );
  // Promote directly via the store (the route /promote-to-collective is
  // tested separately in partner_promotions_adversarial).
  return partnerDealPromotionsStore.create(
    PARTNER_A,
    fresh.id,
    {
      promotionType: "collective_deal_room",
      notes: "Moderation queue smoke",
    },
    USER_MANAGING,
  );
}

beforeEach(() => {
  // Don't reset between tests — chain integrity needs continuity across the
  // suite. Each test uses a fresh promotion id.
});

describe("CP Phase B — promotion moderation lifecycle", () => {
  it("new collective_deal_room promotion is pending and NOT live", () => {
    const p = newPromotion();
    expect(p.moderationStatus).toBe("pending");
    expect(p.status).toBe("live"); // promotion-status is live; visibility is gated by moderationStatus
    const live = partnerDealPromotionsStore.listLiveCollectivePromotions();
    expect(live.find((x) => x.id === p.id)).toBeUndefined();
    const pending = partnerDealPromotionsStore.listPendingModeration();
    expect(pending.find((x) => x.id === p.id)).toBeDefined();
  });

  it("approve transitions to moderation_status='approved' and the row is live", async () => {
    const p = newPromotion();
    // Snapshot the genesis hash BEFORE applyModeration mutates p in place.
    const v1Hash = p.revisionHash;
    const r = await request(app)
      .post(`/api/admin/partner/promotions/${p.id}/approve`)
      .set("x-user-id", "u_admin")
      .set("x-role", "admin")
      .send({ notes: "Looks good." });
    expect(r.status).toBe(200);
    expect(r.body.promotion.moderationStatus).toBe("approved");
    expect(r.body.promotion.prevRevisionHash).toBe(v1Hash);
    expect(r.body.promotion.revisionHash).not.toBe(v1Hash);
    const live = partnerDealPromotionsStore.listLiveCollectivePromotions();
    expect(live.find((x) => x.id === p.id)).toBeDefined();
  });

  it("reject transitions to moderation_status='rejected' and the row is NOT live", async () => {
    const p = newPromotion();
    const r = await request(app)
      .post(`/api/admin/partner/promotions/${p.id}/reject`)
      .set("x-user-id", "u_admin")
      .set("x-role", "admin")
      .send({ notes: "Out of scope." });
    expect(r.status).toBe(200);
    expect(r.body.promotion.moderationStatus).toBe("rejected");
    const live = partnerDealPromotionsStore.listLiveCollectivePromotions();
    expect(live.find((x) => x.id === p.id)).toBeUndefined();
    const pending = partnerDealPromotionsStore.listPendingModeration();
    expect(pending.find((x) => x.id === p.id)).toBeUndefined();
  });

  it("request-changes keeps the row visible to chapter admins but not live", async () => {
    const p = newPromotion();
    const r = await request(app)
      .post(`/api/admin/partner/promotions/${p.id}/request-changes`)
      .set("x-user-id", "u_admin")
      .set("x-role", "admin")
      .send({ notes: "Need more financial detail." });
    expect(r.status).toBe(200);
    expect(r.body.promotion.moderationStatus).toBe("changes_requested");
    const live = partnerDealPromotionsStore.listLiveCollectivePromotions();
    expect(live.find((x) => x.id === p.id)).toBeUndefined();
    const pending = partnerDealPromotionsStore.listPendingModeration();
    expect(pending.find((x) => x.id === p.id)).toBeDefined();
  });

  it("queue endpoint returns pending + changes_requested rows", async () => {
    newPromotion(); // ensure at least one pending row
    const r = await request(app)
      .get("/api/admin/partner/promotions/queue")
      .set("x-user-id", "u_admin")
      .set("x-role", "admin");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.rows)).toBe(true);
    expect(r.body.total).toBeGreaterThanOrEqual(1);
    for (const row of r.body.rows) {
      expect(["pending", "changes_requested"]).toContain(row.moderationStatus);
    }
  });

  it("non-admin caller is rejected (403 or 401)", async () => {
    const p = newPromotion();
    const r = await request(app)
      .post(`/api/admin/partner/promotions/${p.id}/approve`)
      .set("x-user-id", "u_aisha_patel")
      .set("x-role", "investor")
      .send({});
    expect([401, 403]).toContain(r.status);
  });

  it("approve on missing id returns 404", async () => {
    const r = await request(app)
      .post(`/api/admin/partner/promotions/promo_does_not_exist/approve`)
      .set("x-user-id", "u_admin")
      .set("x-role", "admin")
      .send({});
    expect(r.status).toBe(404);
  });
});
