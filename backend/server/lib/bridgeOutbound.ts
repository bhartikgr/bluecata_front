/**
 * Sprint 13 — Centralized typed outbound emit helpers.
 *
 * Every Capavate mutation that must replicate to Collective should call one
 * of these helpers. They wrap `emitBridgeEvent` from the bridgeRuntime with
 * the right aggregate kind + payload shape.
 *
 * Spy hook: `BridgeOutbound.__getSpy()` exposes a list of recent emissions
 * for tests; `__clearSpy()` empties it.
 */
import {
  emitBridgeEvent,
  ALL_OUTBOUND_EVENT_TYPES,
  type OutboundEventType,
  type EmitArgs,
} from "../bridgeStore";
import { filterCompanyPayload } from "./companySyncFields";

interface SpyEntry {
  eventType: OutboundEventType;
  aggregateId: string;
  payload: Record<string, unknown>;
  ts: string;
}
const spy: SpyEntry[] = [];

function emit(args: EmitArgs) {
  const entry = emitBridgeEvent(args);
  spy.push({
    eventType: args.eventType,
    aggregateId: args.aggregateId,
    payload: args.payload,
    ts: entry.envelope.occurredAt,
  });
  if (spy.length > 200) spy.shift();
  return entry;
}

/** Track stripped fields per emit for visibility-test assertion. */
const lastStrip: { companyId: string; stripped: string[]; ts: string }[] = [];

export const BridgeOutbound = {
  companyProfileUpdated(companyId: string, payload: Record<string, unknown>) {
    // Sprint 14 D5 / Conflict 4 — enforce explicit allow-list before emit.
    const filtered = filterCompanyPayload(payload, (stripped) => {
      if (stripped.length) {
        lastStrip.push({ companyId, stripped, ts: new Date().toISOString() });
        if (lastStrip.length > 50) lastStrip.shift();
      }
    });
    return emit({ eventType: "company.profile.updated", aggregateId: companyId, aggregateKind: "company", payload: filtered as Record<string, unknown> });
  },
  __getStripLog(): readonly { companyId: string; stripped: string[]; ts: string }[] { return lastStrip; },
  __clearStripLog(): void { lastStrip.length = 0; },
  companyMaIntelligenceUpdated(companyId: string, payload: Record<string, unknown>) {
    return emit({ eventType: "company.ma_intelligence.updated", aggregateId: companyId, aggregateKind: "company", payload });
  },
  investorProfileUpdated(userId: string, payload: Record<string, unknown>) {
    return emit({ eventType: "investor.profile.updated", aggregateId: userId, aggregateKind: "investor", payload });
  },
  capTableMutated(companyId: string, payload: Record<string, unknown>) {
    return emit({ eventType: "cap_table.mutated", aggregateId: companyId, aggregateKind: "company", payload });
  },
  eligibilityRecomputed(userId: string, payload: Record<string, unknown>) {
    return emit({ eventType: "eligibility.recomputed", aggregateId: userId, aggregateKind: "investor", payload });
  },
  lifecyclePolicyChanged(payload: Record<string, unknown>) {
    return emit({ eventType: "lifecycle_policy.changed", aggregateId: "platform", aggregateKind: "platform", payload });
  },
  formulaPublished(formulaId: string, payload: Record<string, unknown>) {
    return emit({ eventType: "formula.published", aggregateId: formulaId, aggregateKind: "platform", payload });
  },
  auditLogAppended(aggregateId: string, payload: Record<string, unknown>) {
    return emit({ eventType: "audit_log.appended", aggregateId, aggregateKind: "company", payload });
  },
  safeConverted(companyId: string, payload: Record<string, unknown>) {
    return emit({ eventType: "safe.converted", aggregateId: companyId, aggregateKind: "company", payload });
  },
  noteConverted(companyId: string, payload: Record<string, unknown>) {
    return emit({ eventType: "note.converted", aggregateId: companyId, aggregateKind: "company", payload });
  },
  roundClosed(roundId: string, payload: Record<string, unknown>) {
    return emit({ eventType: "round.closed", aggregateId: roundId, aggregateKind: "round", payload });
  },
  governanceMetricPublished(companyId: string, payload: Record<string, unknown>) {
    return emit({ eventType: "governance_metric.published", aggregateId: companyId, aggregateKind: "company", payload });
  },
  // Sprint 16 G1 — outbound for soft-circle creations
  softCircleSubmitted(softCircleId: string, payload: Record<string, unknown>) {
    return emit({ eventType: "soft_circle.submitted", aggregateId: softCircleId, aggregateKind: "round", payload });
  },

  /** Test helpers. */
  __getSpy(): readonly SpyEntry[] { return spy; },
  __clearSpy(): void { spy.length = 0; },
  __allTypes(): readonly OutboundEventType[] { return ALL_OUTBOUND_EVENT_TYPES; },
};
