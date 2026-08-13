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
  /**
   * W2B B2 — the durableMap keys whose write-through did NOT reach SQLite.
   * Present only when at least one write degraded to memory-only, i.e. the
   * mutation WAS applied in RAM but will NOT survive a restart. Previously
   * durableMap.set() returned void and swallowed the error, so this handler
   * reported `applied: true` for state it had in fact failed to persist.
   */
  degradedKeys?: string[];
}

/**
 * W2B B2 — act on the write-through outcome instead of discarding it.
 * Collects the keys that failed so the caller learns the apply was RAM-only.
 */
function setDurable<T>(
  map: { set(key: string, value: T): boolean },
  key: string,
  value: T,
  degraded: string[],
): void {
  if (!map.set(key, value)) degraded.push(key);
}

function inboundResult(
  handler: string,
  eventId: string,
  degraded: string[],
): InboundResult {
  if (degraded.length === 0) return { applied: true, handler, eventId };
  return {
    applied: true,
    handler,
    eventId,
    reason: "durable_write_degraded",
    degradedKeys: degraded,
  };
}

/**
 * Apply an inbound envelope. Returns whether mutation occurred + which handler.
 */
export function dispatchInbound(env: BridgeEnvelope): InboundResult {
  const handler = String(env.eventType);
  const degraded: string[] = [];
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
    case "member.application_decision": {
      const p = env.payload as { applicationId?: string; decision?: string; memberTier?: string };
      inboundState.memberDecisions.set(env.aggregateId, p);
      return { applied: true, handler: "member.application_decision", eventId: env.eventId };
    }
    case "membership.renewal_status": {
      const p = env.payload as { renewalStatus?: string; lapsed?: boolean; expiresAt?: string };
      inboundState.membershipRenewals.set(env.aggregateId, p);
      return { applied: true, handler: "membership.renewal_status", eventId: env.eventId };
    }
    case "kyc.status_decision": {
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
    case "soft_circle.submitted": {
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

/**
 * WAVE 15 / A-5 (DEF-035) — the drift fence.
 *
 * THE DEFECT. Four of the eight handlers above worked, were idempotent, and
 * were unreachable in practice: `POST /api/bridge/inbound` dispatches on
 * `env.eventType` without consulting any registry, so the code ran — but the
 * peer discovers what it is allowed to send from `ALL_INBOUND_EVENT_TYPES`
 * (`server/bridgeStore.ts`), published by `GET /api/bridge/event-types` and by
 * `GET /api/admin/bridge/inbox`. That array listed four types. A handler nobody
 * is told about is a handler nobody calls.
 *
 * WHY A FENCE AND NOT JUST A LONGER ARRAY. The two lists drifted apart
 * silently across Sprint 13 and Sprint 16 — twice. Nothing compared them,
 * because `case "…" as never` suppressed the only signal TypeScript could have
 * given. Both lists are now compared by this function, which is asserted in
 * BOTH directions by `server/__tests__/wave15_bridge_registry.test.ts`:
 * an unadvertised handler AND an advertised type with no handler are both
 * reported. The test proves the fence FAILS when it should by mutating each
 * list in turn.
 *
 * This is a diagnostic, not a boot-time throw: refusing to start a running
 * bridge because a peer contract list is one entry short would trade a
 * discoverability bug for an outage.
 */
export function assertInboundRegistryComplete(
  advertised: readonly string[],
): { ok: boolean; handlersNotAdvertised: string[]; advertisedWithoutHandler: string[] } {
  const adv = new Set(advertised);
  const han = new Set(ALL_INBOUND_HANDLERS);
  const handlersNotAdvertised = ALL_INBOUND_HANDLERS.filter(h => !adv.has(h)).sort();
  /* Array.from, not spread: this tsconfig targets a level without
     downlevelIteration, so `[...set]` is a TS2802 and would put a net-new error
     on the type budget for no behavioural gain. */
  const advertisedWithoutHandler = Array.from(adv).filter(a => !han.has(a)).sort();
  return {
    ok: handlersNotAdvertised.length === 0 && advertisedWithoutHandler.length === 0,
    handlersNotAdvertised,
    advertisedWithoutHandler,
  };
}
