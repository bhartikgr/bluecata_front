/**
 * Sprint 10 — Server-side telemetry envelope.
 *
 * Every state change in the investor surface emits an envelope that matches
 * `capavate_collective_sync_schema.md §9`:
 *
 *   {
 *     eventId, eventType, aggregateId, aggregateKind, occurredAt,
 *     tenantId, actor: { userId, ip }, payload, schemaVersion: "1.0"
 *   }
 *
 * Envelopes are stored in-memory and exposed via GET /api/telemetry/sprint10
 * for inspection by tests and the admin Telemetry page. In production this
 * is replaced by the outbox table → webhook relay.
 */
import type { Request } from "express";
import { randomBytes } from "node:crypto";
import type { SyncEnvelope } from "@shared/schema";
import { currentTrace, singleStepTrace } from "./lib/trace";

const events: SyncEnvelope<unknown>[] = [];

export function emitSync<T>(opts: {
  eventType: string;
  aggregateId: string;
  aggregateKind: SyncEnvelope<unknown>["aggregateKind"];
  payload: T;
  req?: Request;
  tenantId?: string;
  actorUserId?: string;
}): SyncEnvelope<T> {
  const env: SyncEnvelope<T> = {
    eventId: `evt_${randomBytes(8).toString("hex")}`,
    eventType: opts.eventType,
    aggregateId: opts.aggregateId,
    aggregateKind: opts.aggregateKind,
    occurredAt: new Date().toISOString(),
    tenantId: opts.tenantId ?? "tnt_capavate_us",
    actor: {
      userId: opts.actorUserId ?? "u_unknown",
      ip: opts.req?.ip,
    },
    payload: opts.payload,
    // Sprint 14 D7 — attach the active trace[] (set up by withTrace()) so every
    // mutation envelope has at least one trace step. If no frame is active we
    // synthesize a single-step trace from the eventType so the array is never
    // empty for downstream replay/regression tooling.
    trace: currentTrace() ?? singleStepTrace(opts.eventType, "1.0.0", "US"),
    schemaVersion: "1.0",
  };
  events.push(env);
  // Cap memory in preview
  if (events.length > 2000) events.splice(0, events.length - 2000);
  return env;
}

export function getRecentEvents(limit = 200): SyncEnvelope<unknown>[] {
  return events.slice(-limit);
}

export function findEventsByType(eventType: string): SyncEnvelope<unknown>[] {
  return events.filter((e) => e.eventType === eventType);
}

export function clearEvents(): void {
  events.length = 0;
}
