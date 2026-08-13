/**
 * WAVE 15 / A-5 (DEF-035) — the four unadvertised inbound bridge handlers.
 *
 * WHAT WAS ACTUALLY WRONG. Nothing was missing. `server/lib/bridgeInbound.ts`
 * has had working, idempotent handlers for `member.application_decision`,
 * `membership.renewal_status`, `kyc.status_decision` (Sprint 13) and
 * `soft_circle.submitted` (Sprint 16 G2) for many sprints. What was missing was
 * the ADVERTISEMENT: `ALL_INBOUND_EVENT_TYPES` (`server/bridgeStore.ts`) listed
 * four types, and that array is what `GET /api/bridge/event-types` publishes to
 * the Collective peer. The peer cannot send an event type it has not been told
 * exists, so four working handlers were dead code by omission. This is a WIRING
 * item, not a BUILD item.
 *
 * WHY THE TYPE SYSTEM DID NOT CATCH IT. The four case labels were written
 * `case "kyc.status_decision" as never:` — an assertion that silences the only
 * diagnostic TypeScript could have produced for a case label outside the
 * switched union. The casts are removed; the union carries the types instead.
 *
 * A CHECK THAT PASSES MAY BE CHECKING NOTHING. Every assertion below is
 * asserted in BOTH directions: the completeness fence is fed deliberately
 * broken inputs and must REPORT them, and fed the real inputs and must pass.
 * A fence that only ever sees the good input proves nothing.
 */
import { describe, it, expect } from "vitest";
import { ALL_INBOUND_EVENT_TYPES, type InboundEventType } from "../bridgeStore";
import {
  ALL_INBOUND_HANDLERS,
  assertInboundRegistryComplete,
  dispatchInbound,
  inboundState,
  resetInboundState,
} from "../lib/bridgeInbound";
import type { BridgeEnvelope } from "../bridgeStore";

const FOUR_PREVIOUSLY_UNADVERTISED = [
  "member.application_decision",
  "membership.renewal_status",
  "kyc.status_decision",
  "soft_circle.submitted",
] as const;

function envelope(eventType: string, aggregateId: string, payload: Record<string, unknown>): BridgeEnvelope {
  return {
    eventId: `evt_${eventType}_${aggregateId}`,
    eventType: eventType as InboundEventType,
    aggregateId,
    aggregateKind: "company",
    occurredAt: new Date().toISOString(),
    payload,
    auditChain: { priorHash: "0".repeat(64), hash: "0".repeat(64) },
  } as unknown as BridgeEnvelope;
}

describe("A-5 — the four handlers are now on the published peer contract", () => {
  it("advertises all four previously-omitted types", () => {
    for (const t of FOUR_PREVIOUSLY_UNADVERTISED) {
      expect(ALL_INBOUND_EVENT_TYPES as readonly string[]).toContain(t);
    }
  });

  it("advertises exactly as many types as there are handlers — no drift in either direction", () => {
    expect([...ALL_INBOUND_EVENT_TYPES].sort()).toEqual([...ALL_INBOUND_HANDLERS].sort());
  });
});

describe("A-5 — the completeness fence FAILS when it should (both poles)", () => {
  it("POSITIVE POLE: the real registry passes", () => {
    const out = assertInboundRegistryComplete(ALL_INBOUND_EVENT_TYPES);
    expect(out.ok).toBe(true);
    expect(out.handlersNotAdvertised).toEqual([]);
    expect(out.advertisedWithoutHandler).toEqual([]);
  });

  it("NEGATIVE POLE A: a handler that is not advertised is REPORTED, not passed", () => {
    // This is literally the pre-Wave-15 state of the tree: the four-entry array.
    const preWave15 = ["dsc.scores", "ma.intelligence_rankings", "partner.introduction_status", "network.social_signals"];
    const out = assertInboundRegistryComplete(preWave15);
    expect(out.ok).toBe(false);
    expect(out.handlersNotAdvertised).toEqual([...FOUR_PREVIOUSLY_UNADVERTISED].sort());
    // and the fence must not invent the opposite complaint
    expect(out.advertisedWithoutHandler).toEqual([]);
  });

  it("NEGATIVE POLE B: an advertised type with no handler is REPORTED — an inbound event that would be silently dropped", () => {
    const out = assertInboundRegistryComplete([...ALL_INBOUND_EVENT_TYPES, "totally.invented.type"]);
    expect(out.ok).toBe(false);
    expect(out.advertisedWithoutHandler).toEqual(["totally.invented.type"]);
    expect(out.handlersNotAdvertised).toEqual([]);
  });

  it("NEGATIVE POLE C: an empty registry is not treated as vacuously complete", () => {
    const out = assertInboundRegistryComplete([]);
    expect(out.ok).toBe(false);
    expect(out.handlersNotAdvertised.length).toBe(ALL_INBOUND_HANDLERS.length);
  });
});

describe("A-5 — the handlers the peer can now reach actually mutate state", () => {
  it("each of the four applies and is idempotent on replay", () => {
    resetInboundState();

    const member = dispatchInbound(envelope("member.application_decision", "app_1", { applicationId: "app_1", decision: "approved", memberTier: "core" }));
    expect(member.applied).toBe(true);
    expect(member.handler).toBe("member.application_decision");
    expect(inboundState.memberDecisions.get("app_1")).toMatchObject({ decision: "approved" });

    const renewal = dispatchInbound(envelope("membership.renewal_status", "m_1", { renewalStatus: "lapsed", lapsed: true, expiresAt: "2026-01-01T00:00:00.000Z" }));
    expect(renewal.applied).toBe(true);
    expect(inboundState.membershipRenewals.get("m_1")).toMatchObject({ lapsed: true });

    const kyc = dispatchInbound(envelope("kyc.status_decision", "inv_1", { kycStatus: "verified", decidedAt: "2026-02-02T00:00:00.000Z" }));
    expect(kyc.applied).toBe(true);
    expect(inboundState.kycDecisions.get("inv_1")).toBeTruthy();

    const soft = dispatchInbound(envelope("soft_circle.submitted", "sc_1", { softCircleId: "sc_1", roundId: "r_1", investorId: "inv_1", amountUsd: "25000", status: "submitted" }));
    expect(soft.applied).toBe(true);
    expect(inboundState.roundParticipants.get("r_1:inv_1")).toMatchObject({ status: "submitted" });

    // Idempotency: the same (round, investor) pair replaces rather than accumulates.
    dispatchInbound(envelope("soft_circle.submitted", "sc_1", { softCircleId: "sc_1", roundId: "r_1", investorId: "inv_1", amountUsd: "25000", status: "submitted" }));
    expect(inboundState.roundParticipants._raw().size).toBe(1);
  });

  it("CONTROL: an unadvertised, unhandled type is refused rather than silently swallowed", () => {
    const out = dispatchInbound(envelope("no.such.event", "x", {}));
    expect(out.applied).toBe(false);
    expect(out.handler).toBe("unknown");
    expect(out.reason).toContain("no handler");
  });
});
