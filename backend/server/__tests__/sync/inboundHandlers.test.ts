/**
 * Sprint 13 — Inbound handler dispatch tests.
 *
 * Covers all 7 inbound event types (4 base + 3 new):
 *  - dsc.scores
 *  - ma.intelligence_rankings
 *  - partner.introduction_status
 *  - network.social_signals
 *  - member.application_decision (Sprint 13 new)
 *  - membership.renewal_status (Sprint 13 new)
 *  - kyc.status_decision (Sprint 13 new)
 *
 * For each: dispatch applies the payload into inboundState, and re-dispatching
 * the same envelope is idempotent at the handler layer (Maps overwrite cleanly).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { dispatchInbound, inboundState, resetInboundState, ALL_INBOUND_HANDLERS } from "../../lib/bridgeInbound";
import type { BridgeEnvelope } from "../../bridgeStore";

function envelope(eventType: string, aggregateId: string, payload: Record<string, unknown>): BridgeEnvelope {
  return {
    eventId: `evt_${Math.random().toString(36).slice(2, 10)}`,
    eventType: eventType as BridgeEnvelope["eventType"],
    aggregateId,
    aggregateKind: "company",
    occurredAt: new Date().toISOString(),
    tenantId: "tenant_default",
    actor: { userId: "u_test" },
    payload,
    trace: [],
    auditChain: { priorHash: "0".repeat(64), hash: "x".repeat(64) },
    schemaVersion: "1.0",
  };
}

beforeEach(() => {
  resetInboundState();
});

describe("Sprint 13 — Inbound handlers", () => {
  it("ALL_INBOUND_HANDLERS lists 7 event types (4 base + 3 new)", () => {
    // Sprint 16 G2 — added soft_circle.submitted handler → 8 total
    expect(ALL_INBOUND_HANDLERS).toHaveLength(8);
    expect(ALL_INBOUND_HANDLERS).toEqual(
      expect.arrayContaining([
        "dsc.scores",
        "ma.intelligence_rankings",
        "partner.introduction_status",
        "network.social_signals",
        "member.application_decision",
        "membership.renewal_status",
        "kyc.status_decision",
      ])
    );
  });

  it("dsc.scores stores into companyDsc map", () => {
    const env = envelope("dsc.scores", "co_test", {
      dscScore: 4.2, dscRecommendation: "advance", reviewerIds: ["u_r1"],
    });
    const out = dispatchInbound(env);
    expect(out.applied).toBe(true);
    expect(out.handler).toBe("dsc.scores");
    expect(inboundState.companyDsc.get("co_test")).toEqual({
      dscScore: 4.2, dscRecommendation: "advance", reviewerIds: ["u_r1"],
    });
  });

  it("ma.intelligence_rankings updates companyMa AND companyTier when autoTier present", () => {
    const env = envelope("ma.intelligence_rankings", "co_test", {
      compositeScore: 82, mnaScore: 76, autoTier: "A",
    });
    const out = dispatchInbound(env);
    expect(out.applied).toBe(true);
    expect(inboundState.companyMa.get("co_test")).toMatchObject({ compositeScore: 82, mnaScore: 76 });
    expect(inboundState.companyTier.get("co_test")).toBe("A");
  });

  it("partner.introduction_status keys by company:partner pair", () => {
    const env = envelope("partner.introduction_status", "co_test", {
      partnerId: "p_yc", introductionStatus: "intro_made", vouchWeight: 1,
    });
    const out = dispatchInbound(env);
    expect(out.applied).toBe(true);
    expect(inboundState.partnerStatus.get("co_test:p_yc")).toMatchObject({
      partnerId: "p_yc", introductionStatus: "intro_made",
    });
  });

  it("network.social_signals stores per-aggregate", () => {
    const env = envelope("network.social_signals", "co_test", {
      followerCount: 12000, mentionCount: 80, networkActivity: "trending",
    });
    const out = dispatchInbound(env);
    expect(out.applied).toBe(true);
    expect(inboundState.socialSignals.get("co_test")).toMatchObject({ followerCount: 12000 });
  });

  // ------------ Sprint 13 NEW handlers ------------

  it("member.application_decision (NEW) stores into memberDecisions", () => {
    const env = envelope("member.application_decision", "u_test", {
      applicationId: "app_001", decision: "approved", memberTier: "standard",
    });
    const out = dispatchInbound(env);
    expect(out.applied).toBe(true);
    expect(out.handler).toBe("member.application_decision");
    expect(inboundState.memberDecisions.get("u_test")).toMatchObject({ decision: "approved" });
  });

  it("membership.renewal_status (NEW) stores into membershipRenewals", () => {
    const env = envelope("membership.renewal_status", "u_test", {
      renewalStatus: "active", lapsed: false, expiresAt: "2027-05-09T00:00:00Z",
    });
    const out = dispatchInbound(env);
    expect(out.applied).toBe(true);
    expect(out.handler).toBe("membership.renewal_status");
    expect(inboundState.membershipRenewals.get("u_test")).toMatchObject({ renewalStatus: "active", lapsed: false });
  });

  it("kyc.status_decision (NEW) stores merged kycDecisions", () => {
    const env = envelope("kyc.status_decision", "u_test", {
      kycStatus: "verified", decidedAt: new Date().toISOString(),
    });
    const out = dispatchInbound(env);
    expect(out.applied).toBe(true);
    expect(out.handler).toBe("kyc.status_decision");
    expect(inboundState.kycDecisions.get("u_test")).toMatchObject({ kycStatus: "verified" });
  });

  // ------------ Idempotency at handler layer ------------

  it("re-dispatching same envelope is idempotent (handler overwrites cleanly)", () => {
    const env = envelope("dsc.scores", "co_idem", { dscScore: 4.0, dscRecommendation: "advance" });
    const r1 = dispatchInbound(env);
    const r2 = dispatchInbound(env);
    expect(r1.applied).toBe(true);
    expect(r2.applied).toBe(true);
    // Exactly one entry remains; second dispatch did not duplicate state.
    expect(inboundState.companyDsc.get("co_idem")).toMatchObject({ dscScore: 4.0 });
    expect(inboundState.companyDsc.size).toBe(1);
  });

  it("unknown event types return applied=false", () => {
    const env = envelope("not.a.real.event", "x", {});
    const out = dispatchInbound(env);
    expect(out.applied).toBe(false);
    expect(out.reason).toMatch(/no handler/);
  });

  it("each of the 7 handlers can be invoked independently in one session", () => {
    const cases: Array<[string, string, Record<string, unknown>]> = [
      ["dsc.scores", "co_a", { dscScore: 1 }],
      ["ma.intelligence_rankings", "co_a", { compositeScore: 50, autoTier: "B" }],
      ["partner.introduction_status", "co_a", { partnerId: "p_x", introductionStatus: "open" }],
      ["network.social_signals", "co_a", { followerCount: 1 }],
      ["member.application_decision", "u_a", { decision: "rejected" }],
      ["membership.renewal_status", "u_a", { renewalStatus: "lapsed", lapsed: true }],
      ["kyc.status_decision", "u_a", { kycStatus: "pending" }],
    ];
    for (const [type, agg, p] of cases) {
      const out = dispatchInbound(envelope(type, agg, p));
      expect(out.applied).toBe(true);
    }
    expect(inboundState.companyDsc.size).toBe(1);
    expect(inboundState.companyMa.size).toBe(1);
    expect(inboundState.partnerStatus.size).toBe(1);
    expect(inboundState.socialSignals.size).toBe(1);
    expect(inboundState.memberDecisions.size).toBe(1);
    expect(inboundState.membershipRenewals.size).toBe(1);
    expect(inboundState.kycDecisions.size).toBe(1);
  });
});
