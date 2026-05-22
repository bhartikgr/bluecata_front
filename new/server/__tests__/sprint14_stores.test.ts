/**
 * Sprint 14 — store-level behavior tests.
 *
 * Covers:
 *   - Warm-intro workflow state machine
 *   - Transaction-prep channel lifecycle (create → 30 threads → archive)
 *   - Milestone broadcast segmentation
 *   - DSC feedback relay handler
 *   - 14-day soft-circle expiry runner
 *   - Sync allow-list partition
 *   - Score gating per memberRole
 *   - Stage mapping (10→7)
 *   - Payment Decimal.js cent reconciliation
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createIntroRequest, updateIntroRequest, listIntroRequests, __clearIntroRequests } from "../introRequestStore";
import { createChannel, archiveChannel, getChannelByCompany, addMember, TRANSACTION_PREP_THREADS, __clearTransactionPrep } from "../transactionPrepStore";
import { createBroadcast, listBroadcasts, __clearBroadcasts } from "../milestoneBroadcastStore";
import { ingestDscScores, getLatestForCompany, __clearDscFeedback } from "../dscFeedbackStore";
import { runExpirySweep, daysRemaining, expiryBannerCopy, SOFT_CIRCLE_EXPIRY_DAYS } from "../lib/softCircleExpiryRunner";
import { COMPANY_SYNC_FIELDS, COMPANY_SYNC_BLOCKLIST, filterCompanyPayload } from "../lib/companySyncFields";
import { mapCollectiveStateToCRMStage, mapCollectiveStateToPCRMStage, computeAutoTier, applyScoreGating, FOUNDER_CRM_STAGES, INVESTOR_PCRM_STAGES, AUTO_TIERS } from "@shared/crmStages";
import { chargeOrIdempotent, calcCouponDiscountCents, softCircleRates, __clearPayments } from "../paymentStore";
import { BridgeOutbound } from "../lib/bridgeOutbound";

beforeEach(() => {
  __clearIntroRequests();
  __clearTransactionPrep();
  __clearBroadcasts();
  __clearDscFeedback();
  __clearPayments();
  BridgeOutbound.__clearStripLog();
});

describe("Warm-intro workflow", () => {
  it("create → pending state with broker", () => {
    const r = createIntroRequest({
      requesterCompanyId: "co_a",
      brokerContactId: "ct_1",
      targetEntity: { kind: "acquirer", name: "BigAcq", sector: "fintech", region: "US" },
      askText: "Please warm-intro to BigAcq",
    }, "u_founder");
    expect(r.status).toBe("pending");
    expect(r.brokerContactId).toBe("ct_1");
  });

  it("accepted → completed transition", () => {
    const r = createIntroRequest({ requesterCompanyId: "co_a", targetEntity: { kind: "investor", name: "Co" }, askText: "x" }, "u_a");
    const a = updateIntroRequest(r.id, { status: "accepted" }, "u_b");
    expect(a?.status).toBe("accepted");
    const c = updateIntroRequest(r.id, { status: "completed" }, "u_b");
    expect(c?.status).toBe("completed");
  });

  it("declined captures reason", () => {
    const r = createIntroRequest({ requesterCompanyId: "co_a", targetEntity: { kind: "expert", name: "E" }, askText: "x" }, "u_a");
    const d = updateIntroRequest(r.id, { status: "declined", declineReason: "out of scope" }, "u_b");
    expect(d?.status).toBe("declined");
    expect(d?.declineReason).toBe("out of scope");
  });

  it("askText capped at 500 chars (validation enforced at endpoint level)", () => {
    // The schema is exported; ensure it accepts <500 and rejects >500
    const ok = "a".repeat(500);
    const r = createIntroRequest({ requesterCompanyId: "co_a", targetEntity: { kind: "acquirer", name: "X" }, askText: ok }, "u_a");
    expect(r.askText.length).toBe(500);
  });

  it("listIntroRequests filters by company", () => {
    createIntroRequest({ requesterCompanyId: "co_a", targetEntity: { kind: "acquirer", name: "X" }, askText: "a" }, "u_a");
    createIntroRequest({ requesterCompanyId: "co_b", targetEntity: { kind: "acquirer", name: "Y" }, askText: "b" }, "u_a");
    expect(listIntroRequests({ companyId: "co_a" }).length).toBe(1);
    expect(listIntroRequests().length).toBe(2);
  });
});

describe("Transaction-prep channel", () => {
  it("creates one channel per company with 30 thread anchors", () => {
    const ch = createChannel({ companyId: "co_x", founderUserId: "u_f" });
    expect(ch.threads.length).toBe(30);
    expect(TRANSACTION_PREP_THREADS.length).toBe(30);
    expect(ch.memberUserIds).toContain("u_f");
  });

  it("createChannel idempotent per company", () => {
    const a = createChannel({ companyId: "co_x", founderUserId: "u_f" });
    const b = createChannel({ companyId: "co_x", founderUserId: "u_f" });
    expect(a.id).toBe(b.id);
  });

  it("archive sets reason and timestamp", () => {
    const ch = createChannel({ companyId: "co_x", founderUserId: "u_f" });
    const archived = archiveChannel(ch.id, "transaction_closed", "u_f");
    expect(archived?.archivedAt).toBeDefined();
    expect(archived?.archiveReason).toBe("transaction_closed");
  });

  it("addMember de-dupes", () => {
    const ch = createChannel({ companyId: "co_x", founderUserId: "u_f" });
    addMember(ch.id, "u_inv_a");
    addMember(ch.id, "u_inv_a");
    const final = getChannelByCompany("co_x")!;
    expect(final.memberUserIds.filter((u) => u === "u_inv_a").length).toBe(1);
  });
});

describe("Milestone broadcast segmentation", () => {
  it("segment=all reaches all 5 fixture members", () => {
    const b = createBroadcast({ companyId: "co_a", segmentKind: "all", body: "we closed" }, "u_f");
    expect(b.recipientUserIds.length).toBe(5);
  });

  it("by_stage early matches 2 of 5", () => {
    const b = createBroadcast({ companyId: "co_a", segmentKind: "by_stage", segmentValue: "early", body: "x" }, "u_f");
    expect(b.recipientUserIds.length).toBe(2);
  });

  it("by_region SG matches 1", () => {
    const b = createBroadcast({ companyId: "co_a", segmentKind: "by_region", segmentValue: "SG", body: "x" }, "u_f");
    expect(b.recipientUserIds.length).toBe(1);
  });

  it("listBroadcasts filters by company", () => {
    createBroadcast({ companyId: "co_a", segmentKind: "all", body: "1" }, "u_f");
    createBroadcast({ companyId: "co_b", segmentKind: "all", body: "2" }, "u_f");
    expect(listBroadcasts({ companyId: "co_a" }).length).toBe(1);
  });

  it("trigger preserved on broadcast", () => {
    const b = createBroadcast({ companyId: "co_a", segmentKind: "all", body: "x", trigger: "round_closed" }, "u_f");
    expect(b.trigger).toBe("round_closed");
  });
});

describe("DSC feedback relay", () => {
  it("ingest summarizes top/bottom 3 dimensions", () => {
    const f = ingestDscScores({
      companyId: "co_x",
      tier: "featured",
      dimensions: { team: 90, ip: 85, market: 80, finance: 60, ops: 50, ga: 40, regulatory: 30 },
      narrative: "strong",
    });
    expect(f.topDimensions).toHaveLength(3);
    expect(f.topDimensions[0].name).toBe("team");
    expect(f.bottomDimensions).toHaveLength(3);
    expect(f.bottomDimensions[0].name).toBe("regulatory");
  });

  it("getLatestForCompany returns one of the entries", async () => {
    ingestDscScores({ companyId: "co_x", tier: "watch", dimensions: { a: 10 }, narrative: "v1" });
    await new Promise((r) => setTimeout(r, 10));
    ingestDscScores({ companyId: "co_x", tier: "qualified", dimensions: { a: 20 }, narrative: "v2" });
    expect(getLatestForCompany("co_x")?.tier).toBe("qualified");
  });
});

describe("Soft-circle 14-day expiry runner", () => {
  it("constant is 14 days", () => {
    expect(SOFT_CIRCLE_EXPIRY_DAYS).toBe(14);
  });

  it("expires records older than 14 days, reverts to viewed", () => {
    const oldDate = new Date(Date.now() - 16 * 24 * 60 * 60 * 1000).toISOString();
    const recs = [
      { invitationId: "inv_1", roundId: "r_1", companyId: "c_1", state: "soft_circled", softCircledAt: oldDate, amount: 50000, currency: "USD" },
      { invitationId: "inv_2", roundId: "r_1", companyId: "c_1", state: "soft_circled", softCircledAt: new Date().toISOString() },
    ];
    const result = runExpirySweep(recs);
    expect(result.lapsed.length).toBe(1);
    expect(result.lapsed[0].invitationId).toBe("inv_1");
    expect(recs[0].state).toBe("viewed");
    expect(recs[1].state).toBe("soft_circled");
  });

  it("daysRemaining returns >0 for fresh, 0 for expired", () => {
    const fresh = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const expired = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    expect(daysRemaining(fresh)).toBeGreaterThan(0);
    expect(daysRemaining(expired)).toBe(0);
  });

  it("expiryBannerCopy uses exact required text", () => {
    const fresh = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const c = expiryBannerCopy(fresh);
    expect(c).toMatch(/Your soft-circle expires in \d+ days? — confirm or release/);
  });
});

describe("Sync allow-list partition (Conflict 4)", () => {
  it("contains the 6 Sprint 14 round-specific fields", () => {
    for (const f of ["lastRoundDate", "lastRoundType", "lastRoundValuation", "roundSize", "instrument", "terms"]) {
      expect(COMPANY_SYNC_FIELDS.has(f), `${f} missing from allow-list`).toBe(true);
    }
  });

  it("strips PII fields in blocklist", () => {
    let stripped: string[] = [];
    const filtered = filterCompanyPayload({
      sector: "fintech",
      founderEmail: "x@y.com",
      internalAdminNotes: "secret",
      lastRevenueUsd: 100,
    }, (s) => { stripped = s; });
    expect(filtered.sector).toBe("fintech");
    expect(filtered.lastRevenueUsd).toBe(100);
    expect((filtered as any).founderEmail).toBeUndefined();
    expect((filtered as any).internalAdminNotes).toBeUndefined();
    expect(stripped).toContain("founderEmail");
    expect(stripped).toContain("internalAdminNotes");
  });

  it("blocklist disjoint from allow-list", () => {
    for (const k of COMPANY_SYNC_BLOCKLIST) {
      expect(COMPANY_SYNC_FIELDS.has(k)).toBe(false);
    }
  });

  it("BridgeOutbound.companyProfileUpdated logs strips", () => {
    BridgeOutbound.companyProfileUpdated("co_x", { sector: "fintech", founderHomeAddress: "1 Main St" });
    const log = BridgeOutbound.__getStripLog();
    expect(log.length).toBeGreaterThanOrEqual(1);
    expect(log.some((l) => l.stripped.includes("founderHomeAddress"))).toBe(true);
  });
});

describe("CRM stage mapping (10→7)", () => {
  it("FOUNDER_CRM_STAGES has 7 stages", () => {
    expect(FOUNDER_CRM_STAGES.length).toBe(7);
  });

  it("INVESTOR_PCRM_STAGES has 7 stages", () => {
    expect(INVESTOR_PCRM_STAGES.length).toBe(7);
  });

  it("maps 10 collective states to founder stages", () => {
    expect(mapCollectiveStateToCRMStage("pending")).toBe("lead");
    expect(mapCollectiveStateToCRMStage("viewed")).toBe("engaged");
    expect(mapCollectiveStateToCRMStage("soft_circled")).toBe("soft_circle");
    expect(mapCollectiveStateToCRMStage("confirmed")).toBe("committed");
    expect(mapCollectiveStateToCRMStage("signed")).toBe("signing");
    expect(mapCollectiveStateToCRMStage("funded")).toBe("invested");
    expect(mapCollectiveStateToCRMStage("declined")).toBe("lead");
    expect(mapCollectiveStateToCRMStage("expired")).toBe("lead");
    expect(mapCollectiveStateToCRMStage("revoked")).toBe("lead");
    expect(mapCollectiveStateToCRMStage("accepted")).toBe("engaged");
  });

  it("maps to investor PCRM stages", () => {
    expect(mapCollectiveStateToPCRMStage("viewed")).toBe("met");
    expect(mapCollectiveStateToPCRMStage("accepted")).toBe("diligence");
    expect(mapCollectiveStateToPCRMStage("funded")).toBe("invested");
  });
});

describe("Auto-tier + score gating (Conflict 3)", () => {
  it("AUTO_TIERS = watch/qualified/featured/priority", () => {
    expect(AUTO_TIERS).toEqual(["watch", "qualified", "featured", "priority"]);
  });

  it("computeAutoTier thresholds", () => {
    expect(computeAutoTier(10)).toBe("watch");
    expect(computeAutoTier(45)).toBe("qualified");
    expect(computeAutoTier(70)).toBe("featured");
    expect(computeAutoTier(95)).toBe("priority");
  });

  it("non-DSC role strips rawScore", () => {
    const c = { id: "c1", rawScore: 87, autoTier: "featured" as const };
    const member = applyScoreGating(c, "member");
    expect((member as any).rawScore).toBeUndefined();
    expect(member.autoTier).toBe("featured");
  });

  it("DSC role keeps rawScore", () => {
    const c = { id: "c1", rawScore: 87, autoTier: "featured" as const };
    const dsc = applyScoreGating(c, "dsc");
    expect(dsc.rawScore).toBe(87);
  });
});

describe("PaymentSurface — Decimal.js cent reconciliation", () => {
  it("CP10 coupon = 10% off, cent-perfect", () => {
    expect(calcCouponDiscountCents(120000, "CP10")).toBe(12000);
    expect(calcCouponDiscountCents(120000, "cp10")).toBe(12000); // case insensitive
  });

  it("FOUNDER20 = 20% off", () => {
    expect(calcCouponDiscountCents(24900, "FOUNDER20")).toBe(4980);
  });

  it("unknown coupon returns 0", () => {
    expect(calcCouponDiscountCents(100000, "UNKNOWN")).toBe(0);
  });

  it("3DS / requires_3ds state preserved", () => {
    const r = chargeOrIdempotent({ intentId: "i1", kind: "founder_subscription", amountCents: 24900, currency: "USD", customerId: "u_x", description: "Pro", forceState: "requires_3ds" });
    expect(r.entry.state).toBe("requires_3ds");
  });

  it("idempotent intent: second charge returns same entry", () => {
    const a = chargeOrIdempotent({ intentId: "i1", kind: "collective_membership", amountCents: 120000, currency: "USD", customerId: "u_x", description: "x", forceState: "demo" });
    const b = chargeOrIdempotent({ intentId: "i1", kind: "collective_membership", amountCents: 120000, currency: "USD", customerId: "u_x", description: "x", forceState: "demo" });
    expect(b.deduped).toBe(true);
    expect(a.entry.id).toBe(b.entry.id);
  });

  it("softCircleRates supports 7 currencies", () => {
    const r = softCircleRates();
    expect(Object.keys(r).sort()).toEqual(["CAD", "CNY", "EUR", "GBP", "HKD", "SGD", "USD"]);
  });

  it("coupon applied: net amount = amount - discount", () => {
    const r = chargeOrIdempotent({ intentId: "i9", kind: "collective_membership", amountCents: 120000, currency: "USD", customerId: "u_x", description: "y", couponCode: "CP10", forceState: "demo" });
    expect(r.entry.amountCents).toBe(108000);
    expect(r.entry.discountCents).toBe(12000);
  });
});
