/**
 * server/__tests__/wcoll_w1_bridge_archive.test.ts
 *
 * W-COLLECTIVE Wave 1 — v4 §1.6 as corrected by v5 §A. Bridge outbox ARCHIVE.
 *
 * CONTEXT. `COLLECTIVE_WEBHOOK_URL` pointed at `collective.capavate.com`, a host
 * that does not resolve. 578 envelopes accumulated (501 dead-lettered, the rest
 * queued) addressed to a peer that never existed. The durable local write had
 * already happened at emit time, so nothing local depends on them — but they
 * cannot simply be deleted either: eight admin surfaces read the outbox, and the
 * sacred `hashChainOk()` would become vacuously true over an empty set.
 *
 * The fix introduces a terminal `archived` status. This suite locks the four
 * properties that make that safe, and one that makes it survive a restart.
 *
 * ANTI-VACUITY — behaviour of each test on the PRISTINE tree
 * (/home/user/workspace/build/_presnapshot):
 *
 *   • "drainOutbox never delivers an archived envelope" — FAILS. Pristine
 *     `drainOutbox` skips only `delivered` and `dead_letter`, so the archived
 *     envelope is picked up on the next tick and the deliver spy is called.
 *   • "clearBridgeOutbox never purges archived history" (both variants) — FAILS.
 *     Pristine `clearBridgeOutbox` has no `NON_PURGEABLE_STATUSES` filter and no
 *     `NOT IN` guard on the DELETE; with `includeQueued` the archived row is
 *     spliced out of the in-memory outbox.
 *   • "hydrateBridgeStore restores archived envelopes" / "all envelopes survive a
 *     simulated restart" — FAIL. Pristine hydrate reads
 *     `WHERE status IN ('queued','delivering')`, so every archived row vanishes
 *     on the next boot (a D1 silent drop).
 *   • the `archiveBridgeOutbox` / `NON_PURGEABLE_STATUSES` tests — FAIL with
 *     `TypeError: bridge.archiveBridgeOutbox is not a function` /
 *     `expected undefined to contain 'archived'`, because pristine exports
 *     neither. The namespace import is deliberate so the file still LOADS on
 *     pristine and the semantic failures above are reachable rather than masked
 *     by an import error.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { getDb, rawDb } from "../db/connection";
import { bridgeOutbox as bridgeOutboxTable } from "../../shared/schema";
import * as bridge from "../bridgeStore";
import { hashChainOk } from "../lib/bridgeRuntime";
import {
  emitBridgeEvent,
  drainOutbox,
  clearBridgeOutbox,
  hydrateBridgeStore,
  getOutbox,
  _testBridge,
} from "../bridgeStore";

/** Deliver stub that records every envelope it is handed. */
function spyDeliver() {
  const seen: string[] = [];
  const fn = async (env: { eventId: string }) => {
    seen.push(env.eventId);
    return { ok: true, status: 200 };
  };
  return { seen, fn: fn as unknown as Parameters<typeof drainOutbox>[0] };
}

function emitOne(aggregateId: string) {
  return emitBridgeEvent({
    eventType: "company.profile.updated",
    aggregateId,
    aggregateKind: "company",
    payload: { changedFields: ["stage"] },
  });
}

beforeAll(() => {
  getDb();
});

beforeEach(() => {
  _testBridge.resetChain();
  try {
    getDb().delete(bridgeOutboxTable).run();
  } catch {
    /* first run creates it */
  }
});

describe("v5 §A.1 — `archived` is a declared, non-purgeable delivery status", () => {
  it("names `archived` as non-purgeable", () => {
    expect(bridge.NON_PURGEABLE_STATUSES).toContain("archived");
  });
});

describe("v5 §A — archiveBridgeOutbox transitions without deleting", () => {
  it("dry-runs by default: reports eligible but mutates nothing", () => {
    const e = emitOne("co_arch_dry");
    const before = e.status;

    const res = bridge.archiveBridgeOutbox({ reason: "dead peer" });

    expect(res.dryRun).toBe(true);
    expect(res.eligible).toBe(1);
    expect(res.archived).toBe(0);
    expect(e.status).toBe(before);
  });

  it("archives queued/delivering, never `delivered` or `dead_letter`, and deletes nothing", () => {
    const queued = emitOne("co_arch_q");
    const dead = emitOne("co_arch_dl");
    const done = emitOne("co_arch_ok");
    dead.status = "dead_letter";
    done.status = "delivered";
    done.deliveredAt = new Date().toISOString();
    const totalBefore = getOutbox().length;

    const res = bridge.archiveBridgeOutbox({ reason: "dead peer", dryRun: false });

    expect(res.archived).toBe(1);
    expect(res.skippedDelivered).toBe(1);
    // Review fix B8 — `dead_letter` is EXEMPT so the DLQ signal stays derivable.
    expect(res.skippedDeadLettered).toBe(1);
    expect(queued.status).toBe("archived");
    expect(dead.status).toBe("dead_letter");
    expect(done.status).toBe("delivered");
    // NO DELETE — every envelope is still on every admin surface.
    expect(getOutbox().length).toBe(totalBefore);
  });

  it("is not presented as a delivery", () => {
    const e = emitOne("co_arch_notdelivered");
    bridge.archiveBridgeOutbox({ reason: "dead peer", dryRun: false });
    expect(e.status).toBe("archived");
    expect(e.deliveredAt).toBeNull();
    expect(e.receivedAck).toBe(false);
  });

  it("is idempotent — a second pass archives 0 and reports alreadyArchived", () => {
    emitOne("co_arch_idem");
    bridge.archiveBridgeOutbox({ reason: "first", dryRun: false });

    const second = bridge.archiveBridgeOutbox({ reason: "second", dryRun: false });

    expect(second.eligible).toBe(0);
    expect(second.archived).toBe(0);
    expect(second.alreadyArchived).toBe(1);
  });

  it("does not advance the hash-chain tip (no new links minted)", () => {
    emitOne("co_arch_chain");
    const tip = _testBridge.lastChainHash();
    bridge.archiveBridgeOutbox({ reason: "dead peer", dryRun: false });
    expect(_testBridge.lastChainHash()).toBe(tip);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * REVIEW FIX COVERAGE — B6 / B7 / B8.
 *
 * All three tests below FAIL on the pre-fix Wave 1 tree as well as on pristine:
 *   • B6: the pre-fix archive walked `outbox` only, so a DB row that hydration
 *     never restored stayed `queued` in `bridge_outbox` and `dbArchived` did not
 *     exist (`expected undefined to be 1`).
 *   • B7: the pre-fix archive assigned `e.lastError = \`archived: ${reason}\``,
 *     so the prior diagnostic was gone (`expected 'archived: …' to contain
 *     'ECONNREFUSED'`).
 *   • B8: the pre-fix `ARCHIVABLE_STATUSES` included `dead_letter`, so all three
 *     DLQ counters dropped to 0 (`expected 0 to be 1`).
 * ──────────────────────────────────────────────────────────────────────────── */
describe("review fix B6 — the archive is applied DB-wide, not just in memory", () => {
  it("archives a bridge_outbox row that hydration never restored", () => {
    // A row that exists in the DB but NOT in the in-memory outbox. This is the
    // real gap: `hydrateBridgeStore` skips any row whose envelope_json fails to
    // parse, and a row written by another process after boot is never hydrated
    // either. Pre-fix such a row stayed `queued` forever and WOULD have been
    // delivered the moment BRIDGE_ENABLED flipped to 1.
    rawDb()
      .prepare(
        `INSERT INTO bridge_outbox
           (id, event_type, aggregate_id, aggregate_kind, envelope_json, hmac,
            status, attempts, next_retry_at, enqueued_at, delivered_at, last_error)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        "evt_db_only_orphan",
        "company.profile.updated",
        "co_db_only",
        "company",
        "{not valid json",
        "deadbeef",
        "queued",
        0,
        0,
        new Date().toISOString(),
        null,
        null,
      );

    // Prove it is genuinely absent from memory before the pass.
    expect(
      getOutbox().some((e) => e.envelope.eventId === "evt_db_only_orphan"),
    ).toBe(false);

    const res = bridge.archiveBridgeOutbox({ reason: "dead peer", dryRun: false });

    expect(res.archived).toBe(0); // nothing in memory to archive
    expect(res.dbArchived).toBe(1); // but the DB row WAS transitioned
    expect(res.dbError).toBeNull();

    const row = rawDb()
      .prepare("SELECT status FROM bridge_outbox WHERE id = ?")
      .get("evt_db_only_orphan") as { status?: string } | undefined;
    expect(row?.status).toBe("archived");
  });

  it("a dry run reports dbEligible but mutates no DB row", () => {
    const e = emitOne("co_db_dry");

    const res = bridge.archiveBridgeOutbox({ reason: "dead peer" });

    expect(res.dryRun).toBe(true);
    expect(res.dbEligible).toBe(1);
    expect(res.dbArchived).toBe(0);
    const row = rawDb()
      .prepare("SELECT status FROM bridge_outbox WHERE id = ?")
      .get(e.envelope.eventId) as { status?: string } | undefined;
    expect(row?.status).toBe("queued");
  });

  it("the DB pass is idempotent and never double-annotates", () => {
    emitOne("co_db_idem");
    bridge.archiveBridgeOutbox({ reason: "first", dryRun: false });

    const second = bridge.archiveBridgeOutbox({ reason: "second", dryRun: false });

    expect(second.dbEligible).toBe(0);
    expect(second.dbArchived).toBe(0);
    const rows = rawDb()
      .prepare("SELECT last_error FROM bridge_outbox")
      .all() as Array<{ last_error: string | null }>;
    for (const r of rows) {
      expect(r.last_error).toContain("first");
      expect(r.last_error).not.toContain("second");
    }
  });

  it("the DB pass writes ONLY status / next_retry_at / last_error", () => {
    const e = emitOne("co_db_fields");
    const before = rawDb()
      .prepare(
        `SELECT envelope_json, hmac, event_type, aggregate_id, aggregate_kind,
                attempts, enqueued_at, delivered_at
           FROM bridge_outbox WHERE id = ?`,
      )
      .get(e.envelope.eventId);

    bridge.archiveBridgeOutbox({ reason: "dead peer", dryRun: false });

    const after = rawDb()
      .prepare(
        `SELECT envelope_json, hmac, event_type, aggregate_id, aggregate_kind,
                attempts, enqueued_at, delivered_at
           FROM bridge_outbox WHERE id = ?`,
      )
      .get(e.envelope.eventId);
    // The hash body is priorHash|eventId|eventType|aggregateId|occurredAt and
    // lives inside envelope_json; none of it may be rewritten.
    expect(after).toEqual(before);
  });
});

describe("review fix B7 — archiving preserves the delivery-failure diagnostic", () => {
  it("the prior lastError is retained, not clobbered", () => {
    const e = emitOne("co_arch_lasterr");
    e.lastError = "connect ECONNREFUSED 10.0.0.4:443";

    bridge.archiveBridgeOutbox({ reason: "dead peer", dryRun: false });

    expect(e.lastError).toContain("ECONNREFUSED 10.0.0.4:443");
    expect(e.lastError).toContain("dead peer");
  });

  it("the DB row retains it too, so a restart does not lose it", () => {
    const e = emitOne("co_arch_lasterr_db");
    rawDb()
      .prepare("UPDATE bridge_outbox SET last_error = ? WHERE id = ?")
      .run("getaddrinfo ENOTFOUND collective.capavate.com", e.envelope.eventId);
    e.lastError = "getaddrinfo ENOTFOUND collective.capavate.com";

    bridge.archiveBridgeOutbox({ reason: "peer retired", dryRun: false });

    const row = rawDb()
      .prepare("SELECT last_error FROM bridge_outbox WHERE id = ?")
      .get(e.envelope.eventId) as { last_error?: string } | undefined;
    expect(row?.last_error).toContain("ENOTFOUND collective.capavate.com");
    expect(row?.last_error).toContain("peer retired");
  });

  it("a row with no prior error gets a clean annotation, no dangling separator", () => {
    const e = emitOne("co_arch_noerr");
    expect(e.lastError).toBeNull();

    bridge.archiveBridgeOutbox({ reason: "dead peer", dryRun: false });

    expect(e.lastError).toBe("archived[from=queued]: dead peer");
    expect(e.lastError).not.toContain("prior:");
  });

  it("the pre-archive status stays derivable from the durable row (B8 rationale)", () => {
    const e = emitOne("co_arch_fromstatus");

    bridge.archiveBridgeOutbox({ reason: "dead peer", dryRun: false });

    const row = rawDb()
      .prepare("SELECT status, last_error FROM bridge_outbox WHERE id = ?")
      .get(e.envelope.eventId) as
      | { status?: string; last_error?: string }
      | undefined;
    expect(row?.status).toBe("archived");
    expect(row?.last_error).toContain("from=queued");
  });
});

describe("review fix B8 — archiving cannot zero the dead-letter signal", () => {
  it("a dead_letter row is left dead_letter in memory AND in the DB", () => {
    const dead = emitOne("co_dlq_mem");
    dead.status = "dead_letter";
    rawDb()
      .prepare("UPDATE bridge_outbox SET status = 'dead_letter' WHERE id = ?")
      .run(dead.envelope.eventId);

    bridge.archiveBridgeOutbox({ reason: "dead peer", dryRun: false });

    expect(dead.status).toBe("dead_letter");
    const row = rawDb()
      .prepare("SELECT status, last_error FROM bridge_outbox WHERE id = ?")
      .get(dead.envelope.eventId) as
      | { status?: string; last_error?: string }
      | undefined;
    expect(row?.status).toBe("dead_letter");
    // Not even annotated — the row is untouched.
    expect(row?.last_error ?? null).toBeNull();
  });

  it("`dead_letter` is not in ARCHIVABLE_STATUSES, so it is never eligible", () => {
    const dead = emitOne("co_dlq_eligible");
    dead.status = "dead_letter";

    const dry = bridge.archiveBridgeOutbox({ reason: "dead peer" });

    expect(dry.eligible).toBe(0);
    expect(dry.skippedDeadLettered).toBe(1);
  });

  it("all three live DLQ counters are unchanged by an archive pass", () => {
    // These are the exact expressions the three surfaces use:
    //   GET /api/admin/bridge/outbox   → deadLettered
    //   adminPlatformStore             → queues.deadLetter
    //   lib/syncDashboard              → dlq[]
    const dlqCount = () =>
      getOutbox().filter((e) => e.status === "dead_letter").length;

    const dead = emitOne("co_dlq_count_a");
    const dead2 = emitOne("co_dlq_count_b");
    emitOne("co_dlq_count_queued");
    dead.status = "dead_letter";
    dead2.status = "dead_letter";
    expect(dlqCount()).toBe(2);

    bridge.archiveBridgeOutbox({ reason: "dead peer", dryRun: false });

    expect(dlqCount()).toBe(2);
  });

  it("and they survive a restart as dead_letter, not as archived", () => {
    const dead = emitOne("co_dlq_restart");
    dead.status = "dead_letter";
    rawDb()
      .prepare("UPDATE bridge_outbox SET status = 'dead_letter' WHERE id = ?")
      .run(dead.envelope.eventId);

    bridge.archiveBridgeOutbox({ reason: "dead peer", dryRun: false });

    const row = rawDb()
      .prepare("SELECT status FROM bridge_outbox WHERE id = ?")
      .get(dead.envelope.eventId) as { status?: string } | undefined;
    expect(row?.status).toBe("dead_letter");
  });
});

describe("v5 §A.3 — an archived envelope is terminal for delivery", () => {
  it("drainOutbox never delivers an archived envelope", async () => {
    const archived = emitOne("co_drain_archived");
    const live = emitOne("co_drain_live");
    // Set the status DIRECTLY (not via archiveBridgeOutbox) so this assertion is
    // reachable on the pristine tree, where the archive API does not exist.
    archived.status = "archived" as typeof archived.status;
    archived.nextRetryAt = 0;
    live.nextRetryAt = 0;

    const spy = spyDeliver();
    await drainOutbox(spy.fn);

    expect(spy.seen).toContain(live.envelope.eventId);
    expect(spy.seen).not.toContain(archived.envelope.eventId);
    expect(archived.status).toBe("archived");
  });
});

describe("v5 §A.5 — archived history is never purged", () => {
  it("clearBridgeOutbox() leaves archived rows in place", () => {
    const archived = emitOne("co_clear_archived");
    const dead = emitOne("co_clear_dead");
    archived.status = "archived" as typeof archived.status;
    dead.status = "dead_letter";

    clearBridgeOutbox();

    const ids = getOutbox().map((e) => e.envelope.eventId);
    expect(ids).toContain(archived.envelope.eventId);
    expect(ids).not.toContain(dead.envelope.eventId);
  });

  it("clearBridgeOutbox({ includeQueued: true }) still leaves archived rows in place", () => {
    const archived = emitOne("co_clear_archived_2");
    const queued = emitOne("co_clear_queued_2");
    archived.status = "archived" as typeof archived.status;

    const res = clearBridgeOutbox({ includeQueued: true });

    const ids = getOutbox().map((e) => e.envelope.eventId);
    expect(ids).toContain(archived.envelope.eventId);
    expect(ids).not.toContain(queued.envelope.eventId);
    expect(res.statusesCleared).not.toContain("archived");
  });

  it("the SQL purge cannot delete an archived row either", () => {
    const archived = emitOne("co_clear_sql");
    rawDb()
      .prepare("UPDATE bridge_outbox SET status = 'archived' WHERE id = ?")
      .run(archived.envelope.eventId);

    clearBridgeOutbox({ includeQueued: true });

    const row = rawDb()
      .prepare("SELECT status FROM bridge_outbox WHERE id = ?")
      .get(archived.envelope.eventId) as { status?: string } | undefined;
    expect(row?.status).toBe("archived");
  });
});

describe("v5 §A.2 — archived envelopes survive a restart", () => {
  /** Wipe the in-memory outbox WITHOUT touching the DB, i.e. simulate a boot. */
  function simulateRestart(): void {
    getOutbox().length = 0;
  }

  it("hydrateBridgeStore restores archived envelopes", () => {
    const a = emitOne("co_hydrate_archived");
    const q = emitOne("co_hydrate_queued");
    rawDb()
      .prepare("UPDATE bridge_outbox SET status = 'archived' WHERE id = ?")
      .run(a.envelope.eventId);

    simulateRestart();
    expect(getOutbox().length).toBe(0);
    hydrateBridgeStore();

    const restored = getOutbox();
    const byId = new Map(restored.map((e) => [e.envelope.eventId, e]));
    expect(byId.get(a.envelope.eventId)?.status).toBe("archived");
    expect(byId.get(q.envelope.eventId)?.status).toBe("queued");
  });

  it("every archived envelope is still visible on the admin surfaces after a restart", () => {
    // A stand-in for the 578-envelope backlog: enough rows to prove the count is
    // carried, small enough to stay fast.
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) ids.push(emitOne(`co_backlog_${i}`).envelope.eventId);
    rawDb().prepare("UPDATE bridge_outbox SET status = 'archived'").run();

    simulateRestart();
    hydrateBridgeStore();

    const restored = getOutbox();
    expect(restored.length).toBe(ids.length);
    expect(restored.every((e) => e.status === "archived")).toBe(true);
    for (const id of ids) {
      expect(restored.some((e) => e.envelope.eventId === id)).toBe(true);
    }
  });
});

describe("v5 §A — the hash chain stays VERIFIABLE, and not vacuously so", () => {
  /**
   * `hashChainOk()` (server/lib/bridgeRuntime.ts:144) and the admin
   * `GET /api/admin/bridge/verify-chain` surface both walk `getOutbox()` and
   * return `ok:true` over an EMPTY array. So "the chain verifies" is only
   * meaningful when paired with "and it walked every envelope". Every assertion
   * below therefore pins the LINK COUNT as well as the verdict.
   *
   * `verify-chain` reports `totalLinks: outbox.length`, so `getOutbox().length`
   * is exactly the number that surface publishes.
   */
  function chain(): { ok: boolean; totalLinks: number } {
    return { ok: hashChainOk(), totalLinks: getOutbox().length };
  }

  it("the assertion has teeth: tampering with a chained field breaks it", () => {
    emitOne("co_chain_tamper_a");
    const b = emitOne("co_chain_tamper_b");
    expect(chain()).toEqual({ ok: true, totalLinks: 2 });

    // `occurredAt` is part of the chain body, so this must be detected.
    b.envelope.occurredAt = new Date(Date.now() + 60_000).toISOString();
    expect(hashChainOk()).toBe(false);
  });

  it("archiving does not break the chain and does not shrink the link count", () => {
    for (let i = 0; i < 5; i++) emitOne(`co_chain_arch_${i}`);
    expect(chain()).toEqual({ ok: true, totalLinks: 5 });

    bridge.archiveBridgeOutbox({ reason: "dead peer", dryRun: false });

    // Status is NOT part of the chain body
    // (`priorHash|eventId|eventType|aggregateId|occurredAt`), which is precisely
    // why an archive is chain-safe where a delete would not be.
    expect(chain()).toEqual({ ok: true, totalLinks: 5 });
  });

  it("after a restart the verify surface still sees EVERY archived link", () => {
    const n = 6;
    for (let i = 0; i < n; i++) emitOne(`co_chain_restart_${i}`);
    rawDb().prepare("UPDATE bridge_outbox SET status = 'archived'").run();

    getOutbox().length = 0;
    // A wiped outbox verifies vacuously — this is the state pristine hydrate
    // leaves behind, and the reason a bare `ok:true` proves nothing.
    expect(chain()).toEqual({ ok: true, totalLinks: 0 });

    hydrateBridgeStore();

    expect(chain()).toEqual({ ok: true, totalLinks: n });
  });

  it("a purge cannot hollow the chain out either", () => {
    const n = 4;
    for (let i = 0; i < n; i++) emitOne(`co_chain_purge_${i}`);
    rawDb().prepare("UPDATE bridge_outbox SET status = 'archived'").run();
    for (const e of getOutbox()) e.status = "archived" as typeof e.status;

    clearBridgeOutbox({ includeQueued: true });

    expect(chain()).toEqual({ ok: true, totalLinks: n });
  });
});
