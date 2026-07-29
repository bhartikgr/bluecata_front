/**
 * server/commsAuditDurable.ts — w-collective Wave 2 Stage B (B1).
 *
 * THE DEFECT THIS REPLACES. `server/commsStore.ts` keeps two 500-item arrays:
 * `auditEntries` (a hash chain: every entry's `prevHash` is the previous
 * entry's `hash`) and `outbox` (structured events, each carrying that same
 * chain as `auditChain: {priorHash, hash}`). Both used to `splice()` their
 * oldest items away once they passed 500. A hash-chained log that amputates
 * its own head is indistinguishable from one that never received the events —
 * 501 comms mutations in a process lifetime and the forensic trail for the
 * first one is simply gone, with no record that it ever existed.
 *
 * THE REPLACEMENT. Overflow is PERSISTED FIRST and only evicted from memory
 * once the durable write is confirmed. If the durable write fails the entries
 * stay in memory and a failure counter increments, so the process degrades
 * loudly instead of silently. A hard memory ceiling still exists (a DB that is
 * down for hours must not OOM the server), but reaching it increments the
 * visible `auditDropped` / `outboxDropped` counters that /api/healthz already
 * serves — a drop is never silent.
 *
 * WHY NOT AN EXISTING TABLE. `audit_log` is walked as ONE global chain by
 * server/lib/auditChainVerifier.ts, so mixing a second independently-seeded
 * chain into it would make the verifier report a break on a live forensic
 * surface. `telemetry_events` feeds the admin activity feed and the KPI
 * counters, so comms rows would pollute a user-visible surface. The two
 * dedicated tables are created by the boot self-heal in server/db/connection.ts
 * (no migration file — Stage B is under a no-new-migrations rule, and
 * telemetry_events is the existing precedent for a self-heal-only table).
 */
import { rawDb } from "./db/connection";
import { log } from "./lib/logger";

export interface CommsAuditEntry {
  id: string;
  ts: string;
  eventType: string;
  actorId: string;
  payloadJson: string;
  prevHash: string;
  hash: string;
}

export interface CommsOutboxEnvelope {
  eventId: string;
  eventType: string;
  occurredAt: string;
  actor: { userId: string; ip?: string; userAgent?: string };
  payload: Record<string, unknown>;
  auditChain: { priorHash: string; hash: string };
  schemaVersion: "1.0";
}

export type DrainResult = { ok: true; persisted: number } | { ok: false; error: string };

/**
 * Persist audit entries. Idempotent per id (`INSERT OR IGNORE`) so a retry
 * after a partial failure cannot duplicate a chain link.
 */
export function drainCommsAuditEntries(entries: readonly CommsAuditEntry[]): DrainResult {
  if (entries.length === 0) return { ok: true, persisted: 0 };
  try {
    const db: any = rawDb();
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO comms_audit_log
         (id, ts, event_type, actor_id, payload_json, prev_hash, hash, drained_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const drainedAt = new Date().toISOString();
    const tx = db.transaction((rows: readonly CommsAuditEntry[]) => {
      for (const e of rows) {
        stmt.run(e.id, e.ts, e.eventType, e.actorId, e.payloadJson, e.prevHash, e.hash, drainedAt);
      }
    });
    tx(entries);
    return { ok: true, persisted: entries.length };
  } catch (err) {
    log.error(
      `[commsAuditDurable] audit drain FAILED for ${entries.length} entr(ies); keeping them in memory:`,
      (err as Error).message,
    );
    return { ok: false, error: (err as Error).message };
  }
}

/** Persist outbox envelopes. Idempotent per eventId. */
export function drainCommsOutboxEvents(events: readonly CommsOutboxEnvelope[]): DrainResult {
  if (events.length === 0) return { ok: true, persisted: 0 };
  try {
    const db: any = rawDb();
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO comms_outbox_events
         (event_id, event_type, occurred_at, actor_user_id, actor_ip, actor_user_agent,
          payload_json, prior_hash, hash, schema_version, drained_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const drainedAt = new Date().toISOString();
    const tx = db.transaction((rows: readonly CommsOutboxEnvelope[]) => {
      for (const e of rows) {
        stmt.run(
          e.eventId,
          e.eventType,
          e.occurredAt,
          e.actor.userId,
          e.actor.ip ?? null,
          e.actor.userAgent ?? null,
          JSON.stringify(e.payload),
          e.auditChain.priorHash,
          e.auditChain.hash,
          e.schemaVersion,
          drainedAt,
        );
      }
    });
    tx(events);
    return { ok: true, persisted: events.length };
  } catch (err) {
    log.error(
      `[commsAuditDurable] outbox drain FAILED for ${events.length} event(s); keeping them in memory:`,
      (err as Error).message,
    );
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Read drained audit entries back in insertion order. `rowid` is the ordering
 * key, not `ts`: two entries appended inside the same millisecond tie on `ts`
 * and a tie-broken sort would report a false chain break.
 */
export function readDrainedCommsAudit(limit?: number): CommsAuditEntry[] {
  try {
    const db: any = rawDb();
    const sql =
      `SELECT id, ts, event_type, actor_id, payload_json, prev_hash, hash
         FROM comms_audit_log ORDER BY rowid ASC` + (limit ? ` LIMIT ${Math.floor(limit)}` : "");
    const rows: any[] = db.prepare(sql).all();
    return rows.map((r) => ({
      id: r.id,
      ts: r.ts,
      eventType: r.event_type,
      actorId: r.actor_id,
      payloadJson: r.payload_json,
      prevHash: r.prev_hash,
      hash: r.hash,
    }));
  } catch (err) {
    log.warn("[commsAuditDurable] drained audit read failed:", (err as Error).message);
    return [];
  }
}

/** Read drained outbox envelopes back in insertion order. */
export function readDrainedCommsOutbox(limit?: number): CommsOutboxEnvelope[] {
  try {
    const db: any = rawDb();
    const sql =
      `SELECT event_id, event_type, occurred_at, actor_user_id, actor_ip, actor_user_agent,
              payload_json, prior_hash, hash, schema_version
         FROM comms_outbox_events ORDER BY rowid ASC` + (limit ? ` LIMIT ${Math.floor(limit)}` : "");
    const rows: any[] = db.prepare(sql).all();
    return rows.map((r) => ({
      eventId: r.event_id,
      eventType: r.event_type,
      occurredAt: r.occurred_at,
      actor: { userId: r.actor_user_id, ip: r.actor_ip ?? undefined, userAgent: r.actor_user_agent ?? undefined },
      payload: (() => { try { return JSON.parse(r.payload_json); } catch { return {}; } })(),
      auditChain: { priorHash: r.prior_hash, hash: r.hash },
      schemaVersion: r.schema_version as "1.0",
    }));
  } catch (err) {
    log.warn("[commsAuditDurable] drained outbox read failed:", (err as Error).message);
    return [];
  }
}

/**
 * Verify that a sequence of audit entries is one contiguous hash chain:
 * every entry's `prevHash` equals its predecessor's `hash`. Callers pass
 * `drained ++ inMemoryTail` so the check spans the eviction boundary — that
 * boundary is exactly where the old splice used to break the chain.
 */
export function verifyCommsAuditChain(
  entries: readonly CommsAuditEntry[],
  genesisHash = "0".repeat(64),
): { ok: boolean; length: number; brokenAtIndex: number | null; brokenAtId: string | null } {
  for (let i = 0; i < entries.length; i++) {
    const expected = i === 0 ? genesisHash : entries[i - 1]!.hash;
    if (entries[i]!.prevHash !== expected) {
      return { ok: false, length: entries.length, brokenAtIndex: i, brokenAtId: entries[i]!.id };
    }
  }
  return { ok: true, length: entries.length, brokenAtIndex: null, brokenAtId: null };
}
