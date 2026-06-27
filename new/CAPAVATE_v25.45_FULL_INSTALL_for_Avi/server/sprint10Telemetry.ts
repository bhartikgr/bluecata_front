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
 * v25.42h Housekeeping — DB-backed firehose.
 * ------------------------------------------
 * Envelopes were previously buffered in a module-level
 * `const events: SyncEnvelope<unknown>[] = []` (preview-only, lost on restart;
 * the header described production as "replaced by the outbox table → webhook
 * relay"). They are now persisted to the durable `telemetry_events` table
 * (created idempotently in server/db/connection.ts applyV2542HTelemetryEvents-
 * Schema()). This makes the admin Telemetry power browser and KPI funnels read
 * real history that survives a restart.
 *
 *   emitSync()         → INSERT INTO telemetry_events (and a write-through to
 *                        audit_log, the forensic chain, per the v25.42h brief).
 *   getRecentEvents()  → SELECT ... ORDER BY occurred_at DESC LIMIT ?
 *   findEventsByType() → SELECT ... WHERE event_type = ? ORDER BY occurred_at DESC
 *   clearEvents()      → DELETE FROM telemetry_events (test reset only)
 *
 * better-sqlite3 is synchronous, so the public function signatures are
 * preserved (no async leakage into the dozens of emitSync call-sites).
 */
import type { Request } from "express";
import { randomBytes } from "node:crypto";
import type { SyncEnvelope } from "@shared/schema";
import { currentTrace, singleStepTrace } from "./lib/trace";
import { rawDb } from "./db/connection";
import { log } from "./lib/logger";
// NOTE: top-level import of adminPlatformStore creates a module cycle
// (adminPlatformStore imports getRecentEvents from this file). ES modules
// resolve this via live bindings: `appendAdminAudit` is only *called* at
// runtime (inside emitSync), never during module initialization, so the
// binding is fully defined by the time it is invoked. This is safe.
import { appendAdminAudit } from "./adminPlatformStore";

/**
 * Map a DB row back to the SyncEnvelope<unknown> shape the API + callers
 * expect. payload_json / trace_json are parsed defensively.
 */
function rowToEnvelope(r: {
  id: string;
  tenant_id: string;
  event_type: string;
  aggregate_id: string;
  aggregate_kind: string;
  occurred_at: string;
  actor_user_id: string | null;
  actor_ip: string | null;
  payload_json: string | null;
  trace_json: string | null;
  schema_version: string;
}): SyncEnvelope<unknown> {
  let payload: unknown = null;
  if (r.payload_json) {
    try { payload = JSON.parse(r.payload_json); } catch { payload = null; }
  }
  let trace: SyncEnvelope<unknown>["trace"];
  if (r.trace_json) {
    try { trace = JSON.parse(r.trace_json); } catch { trace = undefined; }
  }
  return {
    eventId: r.id,
    eventType: r.event_type,
    aggregateId: r.aggregate_id,
    aggregateKind: r.aggregate_kind as SyncEnvelope<unknown>["aggregateKind"],
    occurredAt: r.occurred_at,
    tenantId: r.tenant_id,
    actor: { userId: r.actor_user_id ?? "u_unknown", ip: r.actor_ip ?? undefined },
    payload,
    trace,
    schemaVersion: "1.0",
  };
}

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

  // v25.42h — durable INSERT into telemetry_events (high-volume KPI firehose).
  // better-sqlite3 .run() is synchronous, so the signature stays sync.
  try {
    const db = rawDb();
    db.prepare(
      `INSERT INTO telemetry_events
         (id, tenant_id, event_type, aggregate_id, aggregate_kind, occurred_at,
          actor_user_id, actor_ip, payload_json, trace_json, schema_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      env.eventId,
      env.tenantId,
      env.eventType,
      env.aggregateId,
      env.aggregateKind,
      env.occurredAt,
      env.actor.userId,
      env.actor.ip ?? null,
      JSON.stringify(env.payload ?? null),
      env.trace ? JSON.stringify(env.trace) : null,
      env.schemaVersion,
      new Date().toISOString(),
    );
  } catch (err) {
    // Telemetry is a non-critical firehose: a DB write failure must NOT crash
    // the mutating route that emitted the event. Log loudly and continue.
    log.warn("[sprint10Telemetry.emitSync] telemetry_events INSERT failed (continuing):", (err as Error).message);
  }

  // v25.42h brief req #4 — emitSync ALSO writes to audit_log (the forensic,
  // hash-chained record). telemetry_events is the high-volume firehose for KPI;
  // audit_log is the tamper-evident trail.
  try {
    appendAdminAudit(
      env.actor.userId,
      `${env.aggregateKind}:${env.aggregateId}`,
      `telemetry.${env.eventType}`,
      { eventId: env.eventId, payload: env.payload },
      env.tenantId,
    );
  } catch (err) {
    log.warn("[sprint10Telemetry.emitSync] audit_log write-through failed (continuing):", (err as Error).message);
  }

  return env;
}

export function getRecentEvents(limit = 200): SyncEnvelope<unknown>[] {
  try {
    const db = rawDb();
    const rows = db.prepare(
      `SELECT id, tenant_id, event_type, aggregate_id, aggregate_kind, occurred_at,
              actor_user_id, actor_ip, payload_json, trace_json, schema_version
         FROM telemetry_events
        ORDER BY occurred_at DESC, rowid DESC
        LIMIT ?`,
    ).all(limit) as any[];
    // Return ascending (oldest-first) to preserve the prior .slice(-limit)
    // ordering contract that callers (admin activity merge) relied on.
    return rows.map(rowToEnvelope).reverse();
  } catch (err) {
    log.warn("[sprint10Telemetry.getRecentEvents] DB read failed:", (err as Error).message);
    return [];
  }
}

export function findEventsByType(eventType: string): SyncEnvelope<unknown>[] {
  try {
    const db = rawDb();
    const rows = db.prepare(
      `SELECT id, tenant_id, event_type, aggregate_id, aggregate_kind, occurred_at,
              actor_user_id, actor_ip, payload_json, trace_json, schema_version
         FROM telemetry_events
        WHERE event_type = ?
        ORDER BY occurred_at ASC, rowid ASC`,
    ).all(eventType) as any[];
    return rows.map(rowToEnvelope);
  } catch (err) {
    log.warn("[sprint10Telemetry.findEventsByType] DB read failed:", (err as Error).message);
    return [];
  }
}

export function clearEvents(): void {
  try {
    rawDb().prepare(`DELETE FROM telemetry_events`).run();
  } catch (err) {
    log.warn("[sprint10Telemetry.clearEvents] DB delete failed:", (err as Error).message);
  }
}
