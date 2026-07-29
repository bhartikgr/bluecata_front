/**
 * server/__tests__/w2b_hardening_engagement.test.ts
 *
 * w-collective WAVE 2 — STAGE B verification suite.
 *
 * Stage B closed four durability holes. This file is the evidence that each one
 * is actually closed, and each test is written to FAIL against the pre-Stage-B
 * file it guards (see _W2B_RESULT.md for the recorded pre-fix failure modes):
 *
 *  B1  server/commsStore.ts   — the two 500-item ring buffers (`auditEntries`,
 *      a hash chain, and `outbox`, whose envelopes carry that chain as
 *      `auditChain: {priorHash, hash}`) used to `splice()` their head away with
 *      no durable copy and no counter. A hash-chained log that amputates its own
 *      head is indistinguishable from one that never received the events.
 *      → tests 1 (contiguity across the eviction boundary) and 1b (drops are
 *        counted, never silent).
 *  B2  server/routes.ts       — `/api/healthz` now surfaces the drop counter.
 *      → test 2.
 *  B2  server/durableMap.ts   — `writeThrough` returned void, so a caller could
 *      not tell a durable write from one that had degraded to RAM-only.
 *      → test 3.
 *  B3  rate limits on the comms engagement writes (`collectiveRateLimit`, the
 *      EXISTING sacred limiter — call-only).
 *      → test 7.
 *  B4  server/postEngagementStore.ts — likes/comments/shares were in-memory
 *      only; `restorePostFromDb` hardcoded them back to empty, so every restart
 *      of the live server wiped all engagement on every post.
 *      → tests 4, 5, 6, 8.
 *
 * NOTE ON IMPORT STYLE: `commsStore` and `durableMap` are imported as
 * NAMESPACES, not named bindings. That is deliberate — the anti-vacuity proof
 * swaps the pristine pre-Stage-B copy of each file into place, and a named ESM
 * import of an export that does not exist yet fails at link time (killing the
 * whole file instead of producing a readable per-test failure).
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { installV14TestIdentity } from "./_v14TestIdentity";
import * as commsStore from "../commsStore";
import * as durableMapMod from "../durableMap";
import {
  readDrainedCommsAudit,
  readDrainedCommsOutbox,
  verifyCommsAuditChain,
  type CommsAuditEntry,
} from "../commsAuditDurable";
import { rawDb } from "../db/connection";
import { CollectiveBucketLimits } from "../lib/rateLimit";
// `../routes` is imported DYNAMICALLY inside test 2 on purpose: it has a static
// `import { getCommsOverflowCounts } from "./commsStore"`, so during the
// anti-vacuity proof (pristine commsStore swapped in) a top-level import here
// would fail at link time and take every other test in this file down with it.

/** Mirrors COMMS_RING_LIMIT / COMMS_RING_HARD_CAP in server/commsStore.ts. */
const RING_LIMIT = 500;
const HARD_CAP = RING_LIMIT * 10;
const GENESIS = "0".repeat(64);

/* ------------------------------------------------------------------ *
 * Harness: ONE long-lived comms app/server for the whole file.
 * (A server-per-request harness cannot afford the >500-event burst.)
 * ------------------------------------------------------------------ */
let commsServer: http.Server;
let commsPort = 0;

function buildCommsApp(): Express {
  const app = express();
  app.use(express.json());
  installV14TestIdentity(app);
  commsStore.registerCommsRoutes(app);
  return app;
}

interface Reply { status: number; body: any; headers: http.IncomingHttpHeaders }

function call(
  method: string,
  path: string,
  opts: { body?: unknown; actor?: string; port?: number } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    // x-user-id -> userContext.userId (the identity surface the production
    // guard stack produces, and the key `clientKey()` rate-limits on).
    if (opts.actor) headers["x-user-id"] = opts.actor;
    const r = http.request(
      { hostname: "127.0.0.1", port: opts.port ?? commsPort, path, method, headers },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let parsed: any = null;
          try { parsed = buf ? JSON.parse(buf) : null; } catch { parsed = buf; }
          resolve({ status: res.statusCode ?? 0, body: parsed, headers: res.headers });
        });
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

/** DDL copied verbatim from server/db/connection.ts (self-heal statements). */
const DDL_COMMS_AUDIT = `CREATE TABLE IF NOT EXISTS comms_audit_log (
  id           TEXT PRIMARY KEY NOT NULL,
  ts           TEXT NOT NULL,
  event_type   TEXT NOT NULL,
  actor_id     TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  prev_hash    TEXT NOT NULL,
  hash         TEXT NOT NULL,
  drained_at   TEXT NOT NULL
);`;
const DDL_COMMS_OUTBOX = `CREATE TABLE IF NOT EXISTS comms_outbox_events (
  event_id         TEXT PRIMARY KEY NOT NULL,
  event_type       TEXT NOT NULL,
  occurred_at      TEXT NOT NULL,
  actor_user_id    TEXT NOT NULL,
  actor_ip         TEXT,
  actor_user_agent TEXT,
  payload_json     TEXT NOT NULL,
  prior_hash       TEXT NOT NULL,
  hash             TEXT NOT NULL,
  schema_version   TEXT NOT NULL,
  drained_at       TEXT NOT NULL
);`;
const DDL_SYNC_INBOX = `CREATE TABLE IF NOT EXISTS sync_inbox_state (
  key         TEXT PRIMARY KEY NOT NULL,
  value_json  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);`;

const T = commsStore._commsTest as {
  channels: Map<string, any>;
  posts: Map<string, any>;
  outbox: any[];
  auditEntries: any[];
};

const PUMP_CHANNEL = "ch_w2b_pump";
const PUMP_ACTOR = "u_w2b_pump";

beforeAll(async () => {
  const app = buildCommsApp();
  commsServer = http.createServer(app);
  await new Promise<void>((r) => commsServer.listen(0, () => r()));
  commsPort = (commsServer.address() as { port: number }).port;

  // A channel the pump actor is a participant of, so /typing is a real 200
  // (the endpoint carries no rate limiter and emits exactly one outbox event
  //  + one audit-chain link per call — the cheapest way to overflow the ring).
  T.channels.set(PUMP_CHANNEL, {
    id: PUMP_CHANNEL,
    kind: "network",
    participantUserIds: [PUMP_ACTOR],
    createdAt: new Date().toISOString(),
    metadata: { title: "w2b pump", ownerUserId: PUMP_ACTOR },
  });
});

/* ================================================================== *
 * 1 — AUDIT CHAIN CONTIGUITY UNDER OVERFLOW  (B1, commsStore.ts)
 *
 * This is the test that would have caught the original silent splice.
 * It MUST run before anything else in this file touches the comms chain:
 * contiguity is asserted from the genesis hash, so the chain has to be
 * examined while it is still complete.
 * ================================================================== */
describe("W2B B1 — comms audit chain stays contiguous across ring overflow", () => {
  const EVENTS = 620; // well over the 500 truncation threshold

  it("chain is contiguous and verifiable across the eviction boundary", async () => {
    for (let i = 0; i < EVENTS; i++) {
      const r = await call("POST", `/api/comms/channels/${PUMP_CHANNEL}/typing`, { actor: PUMP_ACTOR });
      expect(r.status).toBe(200);
    }

    // The in-memory ring is still bounded — the fix did not just raise the cap.
    expect(T.auditEntries.length).toBeLessThanOrEqual(RING_LIMIT);
    expect(T.outbox.length).toBeLessThanOrEqual(RING_LIMIT);

    const drainedAudit = readDrainedCommsAudit();
    const drainedOutbox = readDrainedCommsOutbox();

    // THE CORE ASSERTION, checked first so a regression names the break:
    // drained ++ in-memory tail must be ONE chain, unbroken back to genesis.
    // Pre-Stage-B this is where the silent splice shows up — the surviving
    // head's priorHash points at an entry that no longer exists anywhere.
    const fullChain: CommsAuditEntry[] = [...drainedAudit, ...(T.auditEntries as CommsAuditEntry[])];
    const verdict = verifyCommsAuditChain(fullChain, GENESIS);
    expect(
      verdict.brokenAtIndex,
      `chain broken at index ${verdict.brokenAtIndex} (id ${verdict.brokenAtId}) — ` +
        `priorHash points at a link that is in neither comms_audit_log nor memory`,
    ).toBeNull();
    expect(verdict.brokenAtId).toBeNull();
    expect(verdict.ok).toBe(true);

    // The overflow was PERSISTED, not spliced away, and nothing was lost.
    expect(drainedAudit.length).toBeGreaterThanOrEqual(EVENTS - RING_LIMIT);
    expect(drainedOutbox.length).toBeGreaterThanOrEqual(EVENTS - RING_LIMIT);
    expect(fullChain.length).toBeGreaterThanOrEqual(EVENTS);

    // And no id appears twice (the drain is INSERT OR IGNORE + evict-after-ack,
    // so a retry must not duplicate a chain link).
    expect(new Set(fullChain.map((e) => e.id)).size).toBe(fullChain.length);
  });

  it("outbox envelopes carry the same unbroken auditChain across the boundary", () => {
    const envelopes = [...readDrainedCommsOutbox(), ...(T.outbox as any[])];
    for (let i = 0; i < envelopes.length; i++) {
      const expected = i === 0 ? GENESIS : envelopes[i - 1].auditChain.hash;
      expect(
        envelopes[i].auditChain.priorHash,
        `outbox envelope ${i} (${envelopes[i].eventId}) priorHash points at a dropped link`,
      ).toBe(expected);
    }
    expect(envelopes.length).toBeGreaterThanOrEqual(EVENTS);
    expect(new Set(envelopes.map((e) => e.eventId)).size).toBe(envelopes.length);
  });

  it("outboxOverflowCount is non-zero and monotonic once the durable drain fails past the hard cap", async () => {
    const counts = (commsStore as any).getCommsOverflowCounts;
    expect(typeof counts).toBe("function");

    // Baseline: with a healthy drain, NOTHING is dropped.
    expect(counts().total).toBe(0);
    expect(counts().auditPersisted).toBeGreaterThan(0);

    // Break the durable drain, then push the ring past its hard memory cap.
    // (A DB that is down for hours must not OOM the process; reaching the cap
    //  is allowed, but it must be COUNTED.)
    const db: any = rawDb();
    db.exec(`DROP TABLE IF EXISTS comms_audit_log;`);
    db.exec(`DROP TABLE IF EXISTS comms_outbox_events;`);
    try {
      const pad = HARD_CAP + 200 - T.auditEntries.length;
      for (let i = 0; i < pad; i++) {
        T.auditEntries.push({
          id: `pad_a_${i}`, ts: new Date().toISOString(), eventType: "pad",
          actorId: PUMP_ACTOR, payloadJson: "{}", prevHash: GENESIS, hash: GENESIS,
        });
      }
      const padO = HARD_CAP + 200 - T.outbox.length;
      for (let i = 0; i < padO; i++) {
        T.outbox.push({
          eventId: `pad_o_${i}`, eventType: "pad", occurredAt: new Date().toISOString(),
          actor: { userId: PUMP_ACTOR }, payload: {},
          auditChain: { priorHash: GENESIS, hash: GENESIS }, schemaVersion: "1.0",
        });
      }
      expect(T.auditEntries.length).toBeGreaterThan(HARD_CAP);
      expect(T.outbox.length).toBeGreaterThan(HARD_CAP);

      // One more event: drain fails, hard cap exceeded → drop, and COUNT it.
      const r = await call("POST", `/api/comms/channels/${PUMP_CHANNEL}/typing`, { actor: PUMP_ACTOR });
      expect(r.status).toBe(200);
      const after1 = counts();
      expect(after1.drainFailures).toBeGreaterThan(0);
      expect(after1.total).toBeGreaterThan(0);
      expect(after1.auditDropped).toBeGreaterThan(0);
      expect(after1.outboxDropped).toBeGreaterThan(0);

      // Monotonic: a counter that can go down is not an audit signal.
      await call("POST", `/api/comms/channels/${PUMP_CHANNEL}/typing`, { actor: PUMP_ACTOR });
      const after2 = counts();
      expect(after2.total).toBeGreaterThanOrEqual(after1.total);
      expect(after2.auditDropped).toBeGreaterThanOrEqual(after1.auditDropped);
      expect(after2.outboxDropped).toBeGreaterThanOrEqual(after1.outboxDropped);
    } finally {
      // Restore the durable surface for the rest of the file.
      db.exec(DDL_COMMS_AUDIT);
      db.exec(DDL_COMMS_OUTBOX);
      T.auditEntries.splice(0, T.auditEntries.length);
      T.outbox.splice(0, T.outbox.length);
    }
  });
});

/* ================================================================== *
 * 2 — /api/healthz SURFACES outboxOverflowCount  (B2, routes.ts)
 * ================================================================== */
describe("W2B B2 — /api/healthz surfaces outboxOverflowCount", () => {
  it("healthz reports the comms overflow drop counter (and keeps its existing fields)", async () => {
    const app = express();
    app.use(express.json());
    const srv = http.createServer(app);
    const { registerRoutes } = await import("../routes");
    await registerRoutes(srv, app);
    await new Promise<void>((r) => srv.listen(0, () => r()));
    const port = (srv.address() as { port: number }).port;
    try {
      const r = await call("GET", "/api/healthz", { port });
      expect(r.status).toBe(200);
      expect(r.body).toHaveProperty("outboxOverflowCount");
      expect(typeof r.body.outboxOverflowCount).toBe("number");
      // It is the real counter, not a hardcoded 0: test 1c already dropped.
      expect(r.body.outboxOverflowCount).toBe(
        (commsStore as any).getCommsOverflowCounts().total,
      );
      expect(r.body.outboxOverflowCount).toBeGreaterThan(0);
      // No silent drop of the pre-existing healthz payload.
      expect(r.body.ok).toBe(true);
      expect(r.body).toHaveProperty("dbConnected");
      expect(r.body).toHaveProperty("bridgeOutboxBacklog");
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });
});

/* ================================================================== *
 * 3 — writeThrough REPORTS FAILURE  (B2, durableMap.ts)
 * ================================================================== */
describe("W2B B2 — durableMap.writeThrough reports failure instead of swallowing it", () => {
  it("set() returns false on a DB failure, keeps the value in memory, and never throws", () => {
    (durableMapMod as any)._resetDurableMapHealthForTests?.();
    const m = durableMapMod.durableMap<{ v: number }>("w2b_probe_ns");
    const db: any = rawDb();

    // Healthy path: true, and the row is really there.
    const okResult = m.set("k_ok", { v: 1 });
    expect(okResult).toBe(true);
    const row = db.prepare(`SELECT value_json FROM sync_inbox_state WHERE key = ?`).get("w2b_probe_ns::k_ok");
    expect(row?.value_json).toBe(JSON.stringify({ v: 1 }));

    // Simulated DB failure.
    db.exec(`DROP TABLE IF EXISTS sync_inbox_state;`);
    try {
      let degraded: unknown;
      expect(() => { degraded = m.set("k_degraded", { v: 2 }); }).not.toThrow();
      // THE POINT OF THE FIX: the caller can OBSERVE the failure.
      expect(degraded).toBe(false);
      // ...and the in-memory fallback still holds the value. The goal was to
      // end the silence, not to start throwing on a live path.
      expect(m.get("k_degraded")).toEqual({ v: 2 });
      expect(m.has("k_degraded")).toBe(true);
      // A delete that could not reach the DB is reported too.
      expect(m.delete("k_degraded")).toBe(false);

      const health = (durableMapMod as any).getDurableMapHealth?.();
      expect(health?.writeFailures).toBeGreaterThan(0);
      expect(health?.deleteFailures).toBeGreaterThan(0);
      expect(String(health?.lastError)).toContain("w2b_probe_ns");
    } finally {
      db.exec(DDL_SYNC_INBOX);
    }

    // Recovered: the next write is durable again and says so.
    expect(m.set("k_recovered", { v: 3 })).toBe(true);
  });
});

/* ================================================================== *
 * 4-6, 8 — DURABLE POST ENGAGEMENT  (B4, postEngagementStore.ts)
 * ================================================================== */
function durableCounts(postId: string): { likes: number; comments: number; shares: number } {
  const db: any = rawDb();
  return {
    likes: db.prepare(`SELECT COUNT(*) AS c FROM network_post_likes WHERE post_id = ?`).get(postId).c as number,
    comments: db
      .prepare(`SELECT COUNT(*) AS c FROM network_post_comments WHERE post_id = ? AND deleted_at IS NULL`)
      .get(postId).c as number,
    shares: db.prepare(`SELECT COUNT(*) AS c FROM network_post_shares WHERE post_id = ?`).get(postId).c as number,
  };
}

function aggregateColumns(postId: string): { likes: number; comments: number } {
  const db: any = rawDb();
  const row: any = db.prepare(`SELECT likes, comments FROM network_posts WHERE id = ?`).get(postId);
  return { likes: row?.likes ?? -1, comments: row?.comments ?? -1 };
}

/** Simulate a server restart for ONE post: drop the in-memory projection and
 *  re-hydrate it from `network_posts` exactly as the boot path does. */
function restartPost(postId: string): any {
  const db: any = rawDb();
  const row: any = db.prepare(`SELECT * FROM network_posts WHERE id = ?`).get(postId);
  expect(row, "post must be durable in network_posts before a restart can restore it").toBeTruthy();
  const cj = (() => { try { return JSON.parse(row.content_json ?? "{}"); } catch { return {}; } })();
  T.posts.delete(postId);
  expect(T.posts.has(postId)).toBe(false);
  (commsStore as any).restorePostFromDb({
    id: row.id,
    authorUserId: row.author_user_id,
    authorKind: cj.authorKind ?? "user",
    body: row.body,
    createdAt: row.created_at,
    visibility: cj.visibility ?? row.audience,
    companyId: cj.companyId ?? null,
    mediaUrls: cj.mediaUrls ?? [],
    topics: cj.topics ?? [],
    commentParents: cj.commentParents,
  });
  return T.posts.get(postId);
}

async function createPost(author: string, body = "w2b engagement post"): Promise<string> {
  const r = await call("POST", "/api/comms/posts", { actor: author, body: { body, visibility: "network" } });
  expect(r.status).toBe(200);
  expect(r.body?.id).toBeTruthy();
  return r.body.id as string;
}

/** Make `actor` a participant of the post's channel so engagement writes are
 *  genuine 200s. Stage B does not change WHO may engage (Stage C owns that);
 *  this only avoids conflating a 403 with a durability failure. */
function admit(postId: string, actor: string): void {
  const p = T.posts.get(postId);
  const ch = T.channels.get(p.channelId);
  if (!ch.participantUserIds.includes(actor)) ch.participantUserIds.push(actor);
}

describe("W2B B4 — post engagement is durable", () => {
  it("4 — like + comment + share all survive a restart, and aggregates match the durable rows", async () => {
    const author = "u_w2b_survive_author";
    const liker = "u_w2b_survive_liker";
    const postId = await createPost(author);
    admit(postId, liker);

    expect((await call("POST", `/api/comms/posts/${postId}/like`, { actor: liker })).status).toBe(200);
    const c = await call("POST", `/api/comms/posts/${postId}/comments`, {
      actor: liker, body: { body: "durable comment" },
    });
    expect(c.status).toBe(200);
    const commentId = c.body.commentId as string;
    expect((await call("POST", `/api/comms/posts/${postId}/share`, { actor: liker })).status).toBe(200);

    // Durable rows exist BEFORE the restart (i.e. the write path is durable).
    expect(durableCounts(postId)).toEqual({ likes: 1, comments: 1, shares: 1 });

    const restored = restartPost(postId);
    expect(restored).toBeTruthy();
    expect(restored.likedByUserIds).toContain(liker);
    expect(restored.comments.map((x: any) => x.id)).toContain(commentId);
    expect(restored.comments[0].body).toBe("durable comment");
    expect(restored.commentCount).toBe(1);
    expect(restored.shareCount).toBe(1);

    // The aggregate columns the Collective feed reads must agree with the rows.
    expect(aggregateColumns(postId)).toEqual({ likes: 1, comments: 1 });
    const d = durableCounts(postId);
    expect(aggregateColumns(postId)).toEqual({ likes: d.likes, comments: d.comments });
  });

  it("5 — like is idempotent per (post, user): a second like is not an error and does not double-count", async () => {
    const author = "u_w2b_idem_author";
    const liker = "u_w2b_idem_liker";
    const postId = await createPost(author);
    admit(postId, liker);

    const first = await call("POST", `/api/comms/posts/${postId}/like`, { actor: liker });
    const second = await call("POST", `/api/comms/posts/${postId}/like`, { actor: liker });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200); // not a UNIQUE-constraint 500

    expect(durableCounts(postId).likes).toBe(1);
    expect(aggregateColumns(postId).likes).toBe(1);
    const restored = restartPost(postId);
    expect(restored.likedByUserIds).toEqual([liker]);
  });

  it("6 — soft-deleted comments are excluded on read", async () => {
    const author = "u_w2b_softdel_author";
    const postId = await createPost(author);

    const keep = await call("POST", `/api/comms/posts/${postId}/comments`, { actor: author, body: { body: "kept" } });
    const gone = await call("POST", `/api/comms/posts/${postId}/comments`, { actor: author, body: { body: "removed" } });
    expect(keep.status).toBe(200);
    expect(gone.status).toBe(200);
    expect(durableCounts(postId).comments).toBe(2);

    // Soft-delete (the row stays auditable in the table).
    const db: any = rawDb();
    db.prepare(`UPDATE network_post_comments SET deleted_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), gone.body.commentId);
    expect(db.prepare(`SELECT COUNT(*) AS c FROM network_post_comments WHERE post_id = ?`).get(postId).c).toBe(2);

    const restored = restartPost(postId);
    const ids = restored.comments.map((x: any) => x.id);
    expect(ids).toContain(keep.body.commentId);
    expect(ids).not.toContain(gone.body.commentId);
    expect(restored.commentCount).toBe(1);
    expect(durableCounts(postId).comments).toBe(1);
  });

  it("8 — aggregates cannot drift: syncPostAggregates leaves the columns equal to the durable counts", async () => {
    const { syncPostAggregates } = await import("../postEngagementStore");
    const author = "u_w2b_drift_author";
    const u1 = "u_w2b_drift_1";
    const u2 = "u_w2b_drift_2";
    const postId = await createPost(author);
    admit(postId, u1);
    admit(postId, u2);

    // Mixed sequence: like / like / unlike / comment / comment / soft-delete.
    await call("POST", `/api/comms/posts/${postId}/like`, { actor: u1 });
    await call("POST", `/api/comms/posts/${postId}/like`, { actor: u2 });
    await call("DELETE", `/api/comms/posts/${postId}/like`, { actor: u1 });
    const c1 = await call("POST", `/api/comms/posts/${postId}/comments`, { actor: u1, body: { body: "a" } });
    const c2 = await call("POST", `/api/comms/posts/${postId}/comments`, { actor: u2, body: { body: "b" } });
    const db: any = rawDb();
    db.prepare(`UPDATE network_post_comments SET deleted_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), c2.body.commentId);

    // Deliberately corrupt the aggregates, the way a lost incremental write
    // would have: a recompute must be self-correcting, not additive.
    db.prepare(`UPDATE network_posts SET likes = 99, comments = 77 WHERE id = ?`).run(postId);
    expect(aggregateColumns(postId)).toEqual({ likes: 99, comments: 77 });

    const res = syncPostAggregates(postId);
    expect(res.ok).toBe(true);

    const d = durableCounts(postId);
    expect(d.likes).toBe(1);      // u2 only (u1 unliked)
    expect(d.comments).toBe(1);   // c1 only (c2 soft-deleted)
    expect(aggregateColumns(postId)).toEqual({ likes: d.likes, comments: d.comments });
    expect(c1.body.commentId).toBeTruthy();

    // Idempotent: running it again changes nothing.
    expect(syncPostAggregates(postId).ok).toBe(true);
    expect(aggregateColumns(postId)).toEqual({ likes: d.likes, comments: d.comments });
  });
});

/* ================================================================== *
 * 7 — RATE LIMITS ON like / comment / share  (B3)
 *
 * `collectiveRateLimit` is the EXISTING sacred limiter (call-only). Its
 * "write" bucket is a per-(user, bucket) sliding window; all three endpoints
 * share that one bucket per user, so each burst below uses a FRESH actor.
 * ================================================================== */
describe("W2B B3 — engagement writes are rate-limited", () => {
  const WRITE_LIMIT = CollectiveBucketLimits.write;

  async function burst(postId: string, actor: string, fire: () => Promise<Reply>) {
    admit(postId, actor);
    const statuses: number[] = [];
    let limitHeader: string | undefined;
    for (let i = 0; i < WRITE_LIMIT + 5; i++) {
      const r = await fire();
      statuses.push(r.status);
      limitHeader ??= r.headers["x-ratelimit-limit"] as string | undefined;
      if (r.status === 429) {
        expect(r.body?.error).toBe("rate_limited");
        expect(r.body?.bucket).toBe("write");
        break;
      }
    }
    return { statuses, limitHeader, rejected: statuses.filter((s) => s === 429).length };
  }

  it("effective write-bucket limit is advertised on the engagement endpoints", async () => {
    const author = "u_w2b_rl_header";
    const postId = await createPost(author);
    const r = await call("POST", `/api/comms/posts/${postId}/like`, { actor: author });
    expect(r.status).toBe(200);
    // RECORDED IN THE REPORT: write=60/min, read=600/min, sse=30/min per user.
    expect(r.headers["x-ratelimit-bucket"]).toBe("write");
    expect(r.headers["x-ratelimit-limit"]).toBe(String(WRITE_LIMIT));
    expect(WRITE_LIMIT).toBe(60);
    expect(r.headers).toHaveProperty("x-ratelimit-remaining");
  });

  it("a like burst is rejected once the window is full", async () => {
    const postId = await createPost("u_w2b_rl_like_author");
    const actor = "u_w2b_rl_like";
    const out = await burst(postId, actor, () =>
      call("POST", `/api/comms/posts/${postId}/like`, { actor }));
    expect(out.rejected).toBeGreaterThan(0);
    // EXACT boundary (recorded in the report): the first 60 writes in the
    // window are accepted, the 61st is rejected with 429 rate_limited.
    expect(out.statuses.filter((s) => s === 200).length).toBe(WRITE_LIMIT);
    expect(out.statuses.length).toBe(WRITE_LIMIT + 1);
    expect(out.statuses[WRITE_LIMIT]).toBe(429);
  });

  it("a comment burst is rejected once the window is full", async () => {
    const postId = await createPost("u_w2b_rl_cmt_author");
    const actor = "u_w2b_rl_cmt";
    let n = 0;
    const out = await burst(postId, actor, () =>
      call("POST", `/api/comms/posts/${postId}/comments`, { actor, body: { body: `burst ${n++}` } }));
    expect(out.rejected).toBeGreaterThan(0);
  });

  it("a share burst is rejected once the window is full", async () => {
    const postId = await createPost("u_w2b_rl_share_author");
    const actor = "u_w2b_rl_share";
    const out = await burst(postId, actor, () =>
      call("POST", `/api/comms/posts/${postId}/share`, { actor }));
    expect(out.rejected).toBeGreaterThan(0);
  });
});
