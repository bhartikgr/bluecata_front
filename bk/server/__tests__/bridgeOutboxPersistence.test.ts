/**
 * Wave C / FIX C3 — bridge_outbox DB write-through.
 *
 * V23_FINAL_CODE_AUDIT.md R-3 (P1): pre-fix the Capavate→Collective bridge
 * outbox lived ONLY in the in-memory `outbox: OutboxEntry[]` array. On
 * process restart every queued envelope was lost. The `bridge_outbox`
 * SQL table existed in `shared/schema.ts` but nothing wrote to it.
 *
 * The Wave C fix (server/bridgeStore.ts:emitBridgeEvent +
 * server/bridgeStore.ts:drainOutbox) writes through to the DB on every
 * INSERT (new envelope) and every UPDATE (delivery attempt). Best-effort
 * — a DB outage logs and continues. This test verifies the SQL row
 * appears with the right shape after emit and reflects status updates
 * after drainOutbox completes.
 *
 * Math-sacred guarantee: this test touches `bridge_outbox` only. No
 * cap-table tables are read or written.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../db/connection";
import { bridgeOutbox as bridgeOutboxTable } from "../../shared/schema";
import {
  emitBridgeEvent,
  drainOutbox,
  _testBridge,
} from "../bridgeStore";

beforeAll(() => {
  // Ensure DB exists (applyInlineMigrations is invoked on first getDb()).
  getDb();
});

beforeEach(() => {
  // Reset the in-memory outbox + chain between tests.
  _testBridge.resetChain();
  // Also clear the bridge_outbox SQL table so each test starts clean.
  const db = getDb();
  try {
    db.delete(bridgeOutboxTable).run();
  } catch {
    /* table may not exist on first run; getDb() above creates it */
  }
});

describe("Wave C FIX C3 — bridge_outbox DB write-through", () => {
  it("INSERTs a row into bridge_outbox on emitBridgeEvent", () => {
    const entry = emitBridgeEvent({
      eventType: "company.profile.updated",
      aggregateId: "co_test_c3_a",
      aggregateKind: "company",
      payload: { changedFields: ["stage"], stage: "seed" },
    });

    const db = getDb();
    const rows = db
      .select()
      .from(bridgeOutboxTable)
      .where(eq(bridgeOutboxTable.id, entry.envelope.eventId))
      .all() as Array<{
        id: string;
        eventType: string;
        aggregateId: string;
        aggregateKind: string;
        envelopeJson: string;
        hmac: string;
        status: string;
        attempts: number;
        enqueuedAt: string;
      }>;
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe(entry.envelope.eventId);
    expect(rows[0].eventType).toBe("company.profile.updated");
    expect(rows[0].aggregateId).toBe("co_test_c3_a");
    expect(rows[0].aggregateKind).toBe("company");
    expect(rows[0].status).toBe("queued");
    expect(rows[0].attempts).toBe(0);
    expect(rows[0].hmac).toBe(entry.hmac);

    // The serialized envelope round-trips.
    const parsed = JSON.parse(rows[0].envelopeJson);
    expect(parsed.eventId).toBe(entry.envelope.eventId);
    expect(parsed.eventType).toBe("company.profile.updated");
    expect(parsed.auditChain.hash).toBe(entry.envelope.auditChain.hash);
  });

  it("UPDATEs the bridge_outbox row on successful drainOutbox delivery", async () => {
    const entry = emitBridgeEvent({
      eventType: "cap_table.mutated",
      aggregateId: "co_test_c3_b",
      aggregateKind: "company",
      payload: { roundId: "rnd_test", txCount: 1 },
    });

    // Drain successfully.
    const result = await drainOutbox(async () => ({ ok: true, status: 200 }));
    expect(result.delivered).toBeGreaterThanOrEqual(1);

    const db = getDb();
    const rows = db
      .select()
      .from(bridgeOutboxTable)
      .where(eq(bridgeOutboxTable.id, entry.envelope.eventId))
      .all() as Array<{
        status: string;
        attempts: number;
        deliveredAt: string | null;
        lastError: string | null;
      }>;
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("delivered");
    expect(rows[0].attempts).toBe(1);
    expect(rows[0].deliveredAt).not.toBeNull();
    expect(rows[0].lastError).toBeNull();
  });

  it("UPDATEs the bridge_outbox row on failed delivery (still queued, attempts incremented)", async () => {
    const entry = emitBridgeEvent({
      eventType: "audit_log.appended",
      aggregateId: "co_test_c3_c",
      aggregateKind: "company",
      payload: { entryId: "al_fail" },
    });

    await drainOutbox(async () => ({ ok: false, status: 500 }));

    const db = getDb();
    const rows = db
      .select()
      .from(bridgeOutboxTable)
      .where(eq(bridgeOutboxTable.id, entry.envelope.eventId))
      .all() as Array<{
        status: string;
        attempts: number;
        lastError: string | null;
      }>;
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("queued"); // still retryable (attempts < 5)
    expect(rows[0].attempts).toBe(1);
    expect(rows[0].lastError).toBe("HTTP 500");
  });

  it("transitions to dead_letter in the DB after 5 failed attempts", async () => {
    const entry = emitBridgeEvent({
      eventType: "investor.profile.updated",
      aggregateId: "u_test_c3_d",
      aggregateKind: "investor",
      payload: { foo: "bar" },
    });

    // 5 failed drains — but the in-memory entry has nextRetryAt backoff, so
    // we force each drain by mutating the entry. Simpler: just call drain
    // 5 times with a 100s gap by mutating the in-memory entry directly.
    const { _testBridge: _b } = await import("../bridgeStore");
    void _b; // suppress unused
    // Reach 5 attempts by direct calls; reset nextRetryAt between.
    for (let i = 0; i < 5; i++) {
      // Reset nextRetryAt so drain processes this entry on every iteration.
      // We get it via getOutbox().
      const { getOutbox } = await import("../bridgeStore");
      const e = getOutbox().find(o => o.envelope.eventId === entry.envelope.eventId);
      if (e) e.nextRetryAt = 0;
      await drainOutbox(async () => ({ ok: false, status: 503 }));
    }

    const db = getDb();
    const rows = db
      .select()
      .from(bridgeOutboxTable)
      .where(eq(bridgeOutboxTable.id, entry.envelope.eventId))
      .all() as Array<{ status: string; attempts: number }>;
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("dead_letter");
    expect(rows[0].attempts).toBeGreaterThanOrEqual(5);
  });

  it("multiple emits create distinct rows; chain order preserved in DB", () => {
    const a = emitBridgeEvent({
      eventType: "company.profile.updated",
      aggregateId: "co_chain_a",
      aggregateKind: "company",
      payload: { i: 1 },
    });
    const b = emitBridgeEvent({
      eventType: "company.profile.updated",
      aggregateId: "co_chain_b",
      aggregateKind: "company",
      payload: { i: 2 },
    });
    const c = emitBridgeEvent({
      eventType: "company.profile.updated",
      aggregateId: "co_chain_c",
      aggregateKind: "company",
      payload: { i: 3 },
    });

    const db = getDb();
    const rows = db
      .select()
      .from(bridgeOutboxTable)
      .all() as Array<{ id: string; envelopeJson: string }>;
    expect(rows.length).toBe(3);
    const byId: Record<string, string> = {};
    for (const r of rows) byId[r.id] = r.envelopeJson;
    expect(byId[a.envelope.eventId]).toBeTruthy();
    expect(byId[b.envelope.eventId]).toBeTruthy();
    expect(byId[c.envelope.eventId]).toBeTruthy();

    // b's parsed envelope.auditChain.priorHash equals a's hash.
    const bp = JSON.parse(byId[b.envelope.eventId]) as {
      auditChain: { priorHash: string; hash: string };
    };
    expect(bp.auditChain.priorHash).toBe(a.envelope.auditChain.hash);
    // c's priorHash equals b's hash.
    const cp = JSON.parse(byId[c.envelope.eventId]) as {
      auditChain: { priorHash: string; hash: string };
    };
    expect(cp.auditChain.priorHash).toBe(b.envelope.auditChain.hash);
  });

  it("INSERT is idempotent on conflicting eventId (no error thrown)", () => {
    const entry = emitBridgeEvent({
      eventType: "lifecycle_policy.changed",
      aggregateId: "platform",
      aggregateKind: "platform",
      payload: { v: 1 },
    });

    // Re-attempt the same insert directly through the DB layer; the
    // onConflictDoNothing() in persistOutboxInsert means a duplicate
    // emit would not throw.
    const db = getDb();
    expect(() => {
      db.insert(bridgeOutboxTable)
        .values({
          id: entry.envelope.eventId,
          eventType: entry.envelope.eventType,
          aggregateId: entry.envelope.aggregateId,
          aggregateKind: entry.envelope.aggregateKind,
          envelopeJson: JSON.stringify(entry.envelope),
          hmac: entry.hmac,
          status: entry.status,
          attempts: entry.attempts,
          nextRetryAt: entry.nextRetryAt,
          enqueuedAt: entry.enqueuedAt,
          deliveredAt: entry.deliveredAt,
          lastError: entry.lastError,
        })
        .onConflictDoNothing()
        .run();
    }).not.toThrow();
  });
});
