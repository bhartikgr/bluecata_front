/**
 * Sprint 13 — Sync Dashboard endpoints (read-mostly).
 *
 * v25.31.1 — /api/admin/sync/drift is now backed by the durable
 * `sync_snapshots` SQLite table (see server/db/connection.ts schema).
 * No process-local Maps are consulted. Each row carries the local payload,
 * the last-acked payload, and a `last_synced_at` timestamp, so drift state
 * survives PM2 reload.
 *
 * Avi's existing `driftDetector.ts` is preserved byte-identical for tests
 * and any callers that import its helpers — but the production drift read
 * goes through the DB.
 */
import type { Express, Request, Response } from "express";
import { bridgeHealth, outboundCounts, _resetRuntime } from "./bridgeRuntime";
import { getOutbox, getInbox, ALL_OUTBOUND_EVENT_TYPES, ALL_INBOUND_EVENT_TYPES, replayDeadLetter } from "../bridgeStore";
import { computeDrift, seedSnapshot } from "./driftDetector";
import { ALL_INBOUND_HANDLERS } from "./bridgeInbound";
import { rawDb } from "../db/connection";

export type DriftStatus = "clean" | "drifted" | "never_synced";

export interface DriftRow {
  entityKey: string;
  aggregateId: string;
  status: DriftStatus;
  driftedFields?: string[];
  lastSyncedAt?: string;
}

function jsonDiffKeys(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const out: string[] = [];
  const keys = Array.from(new Set([...Object.keys(a || {}), ...Object.keys(b || {})]));
  for (const k of keys) {
    if (JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k])) out.push(k);
  }
  return out;
}

/**
 * v25.31.1 — durable drift read.
 * Returns rows computed directly from the `sync_snapshots` table.
 */
function computeDriftFromDb(): DriftRow[] {
  const rows = rawDb().prepare(
    `SELECT entity_key, aggregate_id, local_json, acked_json, last_synced_at
       FROM sync_snapshots
      WHERE local_json IS NOT NULL`
  ).all() as Array<{
    entity_key: string;
    aggregate_id: string;
    local_json: string | null;
    acked_json: string | null;
    last_synced_at: string | null;
  }>;

  const out: DriftRow[] = [];
  for (const r of rows) {
    let local: Record<string, unknown> = {};
    let acked: Record<string, unknown> | null = null;
    try { local = JSON.parse(r.local_json ?? "{}"); } catch { /* skip */ }
    try { acked = r.acked_json ? JSON.parse(r.acked_json) : null; } catch { /* skip */ }

    if (!acked) {
      out.push({ entityKey: r.entity_key, aggregateId: r.aggregate_id, status: "never_synced" });
      continue;
    }
    const driftedFields = jsonDiffKeys(local, acked);
    out.push({
      entityKey: r.entity_key,
      aggregateId: r.aggregate_id,
      status: driftedFields.length === 0 ? "clean" : "drifted",
      driftedFields: driftedFields.length ? driftedFields : undefined,
      lastSyncedAt: r.last_synced_at ?? undefined,
    });
  }
  return out;
}

/**
 * v25.31.1 — durable snapshot writer. Helpers exported so sync emit/ack
 * paths can persist directly. ON CONFLICT updates the local_json / acked_json
 * column in place, keeping a single canonical row per (entity, aggregate).
 */
export function persistLocalSnapshot(entityKey: string, aggregateId: string, payload: Record<string, unknown>, tenantId?: string): void {
  const now = new Date().toISOString();
  const tid = tenantId ?? "_global";
  rawDb().prepare(
    `INSERT INTO sync_snapshots (tenant_id, entity_key, aggregate_id, local_json, acked_json, last_synced_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, NULL, ?)
     ON CONFLICT(tenant_id, entity_key, aggregate_id) DO UPDATE SET
       local_json = excluded.local_json,
       updated_at = excluded.updated_at`
  ).run(tid, entityKey, aggregateId, JSON.stringify(payload), now);
}

export function persistAck(entityKey: string, aggregateId: string, payload: Record<string, unknown>, tenantId?: string): void {
  const now = new Date().toISOString();
  const tid = tenantId ?? "_global";
  rawDb().prepare(
    `INSERT INTO sync_snapshots (tenant_id, entity_key, aggregate_id, local_json, acked_json, last_synced_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?)
     ON CONFLICT(tenant_id, entity_key, aggregate_id) DO UPDATE SET
       acked_json = excluded.acked_json,
       last_synced_at = excluded.last_synced_at,
       updated_at = excluded.updated_at`
  ).run(tid, entityKey, aggregateId, JSON.stringify(payload), now, now);
}

let seeded = false;

export function registerSyncDashboardRoutes(app: Express): void {
  if (!seeded) {
    // Keep Avi's in-memory seed for any code path that still calls computeDrift().
    seedSnapshot();
    seeded = true;
  }

  app.get("/api/admin/sync/overview", (_req: Request, res: Response) => {
    const out = getOutbox();
    const dlq = out.filter(e => e.status === "dead_letter");
    res.json({
      health: bridgeHealth(),
      outboundCounts: outboundCounts(),
      outboundTotal: out.length,
      outboundDelivered: out.filter(e => e.status === "delivered").length,
      outboundQueued: out.filter(e => e.status === "queued" || e.status === "delivering").length,
      dlq: dlq.map(e => ({
        eventId: e.envelope.eventId,
        eventType: e.envelope.eventType,
        aggregateId: e.envelope.aggregateId,
        attempts: e.attempts,
        reason: e.lastError ?? "unknown",
        enqueuedAt: e.enqueuedAt,
      })),
      inboundTotal: getInbox().length,
      inboundHandlers: ALL_INBOUND_HANDLERS,
      eventTypes: { outbound: ALL_OUTBOUND_EVENT_TYPES, inbound: ALL_INBOUND_EVENT_TYPES },
    });
  });

  /* v25.31.1 Wave A #3 — drift now reads from the durable sync_snapshots
   * table. The legacy in-memory computeDrift() path is intentionally NOT
   * consulted. Production starts with an empty table; rows accumulate as
   * sync emit/ack handlers call persistLocalSnapshot/persistAck. */
  app.get("/api/admin/sync/drift", (_req: Request, res: Response) => {
    try {
      const rows = computeDriftFromDb();
      res.json({ rows, source: "sync_snapshots" });
    } catch (e) {
      res.status(500).json({ error: "drift_read_failed", detail: String((e as any)?.message || e) });
    }
  });

  /* v25.31.1 — use Avi's durable replayDeadLetter() helper from bridgeStore
   * instead of mutating the raw in-memory entry. Avi's helper writes through
   * to the `bridge_outbox` SQLite table via persistOutboxUpdate() so the
   * requeue survives PM2 reload. Previously this handler mutated `e.status`
   * etc. on the in-memory entry without updating the DB row — a violation
   * of the no-in-memory rule and a silent dataloss bug on restart. */
  app.post("/api/admin/sync/replay", (req: Request, res: Response) => {
    const { eventId } = req.body ?? {};
    if (!eventId) return res.status(400).json({ error: "eventId_required" });
    const result = replayDeadLetter(String(eventId));
    if (!result.ok) {
      const status = result.error === "event_not_found" ? 404 : 409;
      return res.status(status).json({ error: result.error });
    }
    return res.json({ ok: true, eventId });
  });

  // Test harness only.
  app.post("/api/admin/sync/_reset", (_req: Request, res: Response) => {
    _resetRuntime();
    // Also clear the durable snapshot table to keep test runs deterministic.
    try { rawDb().prepare(`DELETE FROM sync_snapshots`).run(); } catch { /* table may not exist in some test DBs */ }
    res.json({ ok: true });
  });

  // Keep the legacy in-memory drift function reachable for any test that imports it.
  void computeDrift;
}
