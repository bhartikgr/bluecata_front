/**
 * server/lib/telemetryBridgeForward.ts
 *
 * WAVE 8 — ORP-045 / DEF-045.
 *
 * THE DEFECT (PLATFORM_ORPHAN_AUDIT §B5). `emitSync()`
 * (`server/sprint10Telemetry.ts`) is a second, parallel event system: it writes
 * `telemetry_events` + `audit_log` and is surfaced only on the admin Telemetry
 * page. Its 17 static event types — including the money/ledger events
 * `payment_charged` (`paymentStore.ts`) and `captable_commit`
 * (`captableCommitStore.ts`) — never reach the Collective peer, because nothing
 * ever calls `emitBridgeEvent` for them. The peer therefore has zero visibility
 * of a charge or a cap-table commit.
 *
 * THE SINK. `emitSync()` is the single funnel every one of the 17 call sites
 * goes through. Forwarding here — rather than at 17 call sites — means a
 * future 18th call site is covered automatically and no call site can opt out.
 *
 * NO HARD CODING. This module does not carry its own list. It asks the
 * canonical outbound registry (`ALL_OUTBOUND_EVENT_TYPES`,
 * `server/bridgeStore.ts:512`) whether the event type is part of the published
 * peer contract, and forwards only if it is. That is the same array
 * `GET /api/bridge/event-types` publishes and the same array the manual
 * emit/replay endpoint validates against, so "declared to the peer",
 * "forwarded to the peer" and "replayable" can no longer disagree.
 *
 * FAILURE POLICY. Telemetry must never break the business transaction that
 * emitted it. A forwarding failure is logged and swallowed; the durable
 * `telemetry_events` row has already been written by the caller, so nothing is
 * lost silently — the record still exists on the admin Telemetry page.
 */
import {
  ALL_OUTBOUND_EVENT_TYPES,
  emitBridgeEvent,
  type OutboundEventType,
} from "../bridgeStore";
import type { SyncEnvelope } from "@shared/schema";
import { log } from "./logger";

/** Registry membership test. The registry is the only source of truth. */
export function isBridgeRegisteredEventType(eventType: string): eventType is OutboundEventType {
  return (ALL_OUTBOUND_EVENT_TYPES as readonly string[]).includes(eventType);
}

/**
 * Forward a telemetry envelope onto the outbound bridge iff its event type is
 * on the published peer contract. Returns true when an outbox entry was
 * written, false when the type is not registered (the normal, quiet path for
 * dynamically-named telemetry) and false on a swallowed failure.
 */
export function forwardTelemetryToBridge(env: SyncEnvelope<unknown>): boolean {
  if (!isBridgeRegisteredEventType(env.eventType)) return false;
  try {
    emitBridgeEvent({
      eventType: env.eventType,
      aggregateId: env.aggregateId,
      aggregateKind: env.aggregateKind,
      tenantId: env.tenantId,
      actor: { userId: env.actor?.userId ?? "u_unknown", ip: env.actor?.ip },
      payload: {
        // Preserve the telemetry envelope's identity so the peer can correlate
        // an outbox entry back to the telemetry_events row it came from.
        telemetryEventId: env.eventId,
        occurredAt: env.occurredAt,
        payload: env.payload ?? null,
      },
      trace: env.trace as never,
    });
    return true;
  } catch (err) {
    log.warn(`[telemetry-bridge] forward failed for ${env.eventType}: ${String(err)}`);
    return false;
  }
}
