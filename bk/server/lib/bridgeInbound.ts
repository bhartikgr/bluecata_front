/**
 * Sprint 13 — Inbound event handlers.
 *
 * Every inbound event type maps to a handler. Handlers are idempotent
 * (no-op on duplicate eventId — duplicate detection lives in bridgeRuntime).
 *
 * Sprint 12 base: dsc.scores, ma.intelligence_rankings, partner.introduction_status,
 * network.social_signals.
 *
 * Sprint 13 NEW: member.application_decision, membership.renewal_status, kyc.status_decision.
 */
import type { BridgeEnvelope } from "../bridgeStore";
import { resolveConflicts } from "@shared/schemas/sync";
import { COMPANY_POLICIES } from "@shared/schemas/sync/company";
import { INVESTOR_POLICIES } from "@shared/schemas/sync/investor";
import { durableMap } from "../durableMap";

/**
 * Sprint 29 KL-03 — Inbound state is now wrapped in durableMap().
 * In sandbox (no DATABASE_URL): in-memory, annotated as "ephemeral".
 * In production (DATABASE_URL set): writes through to sync_inbox_state table.
 *
 * The Map interface is preserved so all existing code compiles unchanged.
 */
export const inboundState = {
  companyTier: durableMap<string>("inbound:companyTier"),
  companyMa: durableMap<Record<string, unknown>>("inbound:companyMa"),
  companyDsc: durableMap<Record<string, unknown>>("inbound:companyDsc"),
  partnerStatus: durableMap<Record<string, unknown>>("inbound:partnerStatus"),
  socialSignals: durableMap<Record<string, unknown>>("inbound:socialSignals"),
  memberDecisions: durableMap<Record<string, unknown>>("inbound:memberDecisions"),
  membershipRenewals: durableMap<Record<string, unknown>>("inbound:membershipRenewals"),
  kycDecisions: durableMap<Record<string, unknown>>("inbound:kycDecisions"),
  // Sprint 16 G2 — round_participants from Collective-side soft-circles
  roundParticipants: durableMap<Record<string, unknown>>("inbound:roundParticipants"),
};

export function resetInboundState() {
  // DurableMap exposes the raw inner map via _raw() for test resets
  inboundState.companyTier._raw().clear();
  inboundState.companyMa._raw().clear();
  inboundState.companyDsc._raw().clear();
  inboundState.partnerStatus._raw().clear();
  inboundState.socialSignals._raw().clear();
  inboundState.memberDecisions._raw().clear();
  inboundState.membershipRenewals._raw().clear();
  inboundState.kycDecisions._raw().clear();
  inboundState.roundParticipants._raw().clear();
}

export interface InboundResult {
  applied: boolean;
  handler: string;
  eventId: string;
  reason?: string;
}

/**
 * Apply an inbound envelope. Returns whether mutation occurred + which handler.
 */
export function dispatchInbound(env: BridgeEnvelope): InboundResult {
  const handler = String(env.eventType);
  switch (env.eventType) {
    case "dsc.scores": {
      const p = env.payload as { dscScore?: number; dscRecommendation?: string; reviewerIds?: string[] };
      inboundState.companyDsc.set(env.aggregateId, p);
      return { applied: true, handler, eventId: env.eventId };
    }
    case "ma.intelligence_rankings": {
      const p = env.payload as { compositeScore?: number; mnaScore?: number; roundScore?: number; autoTier?: string; sectorBenchmark?: number };
      // Conflict resolution per company policies — Collective is SOT for ma fields.
      const prev = inboundState.companyMa.get(env.aggregateId) ?? {};
      const merged = resolveConflicts({
        local: prev as Record<string, unknown>,
        remote: p as Record<string, unknown>,
        policies: COMPANY_POLICIES,
      }).merged;
      inboundState.companyMa.set(env.aggregateId, merged);
      if (p.autoTier) inboundState.companyTier.set(env.aggregateId, p.autoTier);
      return { applied: true, handler, eventId: env.eventId };
    }
    case "partner.introduction_status": {
      const p = env.payload as { partnerId?: string; introductionStatus?: string; vouchWeight?: number };
      const key = `${env.aggregateId}:${p.partnerId ?? "_"}`;
      inboundState.partnerStatus.set(key, p);
      return { applied: true, handler, eventId: env.eventId };
    }
    case "network.social_signals": {
      const p = env.payload as { followerCount?: number; mentionCount?: number; networkActivity?: string };
      inboundState.socialSignals.set(env.aggregateId, p);
      return { applied: true, handler, eventId: env.eventId };
    }
    // Sprint 13 NEW
    case "member.application_decision" as never: {
      const p = env.payload as { applicationId?: string; decision?: string; memberTier?: string };
      inboundState.memberDecisions.set(env.aggregateId, p);
      return { applied: true, handler: "member.application_decision", eventId: env.eventId };
    }
    case "membership.renewal_status" as never: {
      const p = env.payload as { renewalStatus?: string; lapsed?: boolean; expiresAt?: string };
      inboundState.membershipRenewals.set(env.aggregateId, p);
      return { applied: true, handler: "membership.renewal_status", eventId: env.eventId };
    }
    case "kyc.status_decision" as never: {
      const p = env.payload as { kycStatus?: string; decidedAt?: string };
      const prev = inboundState.kycDecisions.get(env.aggregateId) ?? {};
      const merged = resolveConflicts({
        local: prev as Record<string, unknown>,
        remote: p as Record<string, unknown>,
        policies: INVESTOR_POLICIES,
      }).merged;
      inboundState.kycDecisions.set(env.aggregateId, merged);
      return { applied: true, handler: "kyc.status_decision", eventId: env.eventId };
    }
    // Sprint 16 G2 — idempotent apply of soft_circle.submitted from Collective members
    case "soft_circle.submitted" as never: {
      const p = env.payload as { softCircleId?: string; roundId?: string; companyId?: string; investorId?: string; amountUsd?: string; status?: string };
      const key = `${p.roundId ?? "_"}:${p.investorId ?? "_"}`;
      // Idempotent: replace prior record for same (round, investor) pair
      inboundState.roundParticipants.set(key, p as Record<string, unknown>);
      return { applied: true, handler: "soft_circle.submitted", eventId: env.eventId };
    }
    default:
      return { applied: false, handler: "unknown", eventId: env.eventId, reason: `no handler for ${String(env.eventType)}` };
  }
}

export const ALL_INBOUND_HANDLERS = [
  "dsc.scores",
  "ma.intelligence_rankings",
  "partner.introduction_status",
  "network.social_signals",
  "member.application_decision",
  "membership.renewal_status",
  "kyc.status_decision",
  // Sprint 16 G2
  "soft_circle.submitted",
];
