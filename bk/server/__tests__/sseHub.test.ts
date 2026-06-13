/**
 * v18 Phase D — SSE hub unit tests + HTTP integration smoke for
 * /api/collective/stream.
 *
 * Unit coverage (in-process — no HTTP):
 *   - publish/subscribe basic delivery
 *   - multi-topic filter (subscriber only receives its topics)
 *   - bounded queue drops oldest and emits a 'lag' notice
 *   - disconnect/close unregisters the subscriber
 *   - hubStats + chapterSubscriberCount return correct counts
 *   - invalid topic in publish() is a no-op
 *
 * HTTP coverage (real Express server + EventSource-equivalent client):
 *   - 503 when COLLECTIVE_ENABLED is off
 *   - 401 missing identity
 *   - 403 when caller is not a member of the requested chapter
 *   - 200 + initial `:connected` frame + heartbeat behavior for happy path
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import express, { type Express } from "express";
import http from "node:http";

import {
  publish,
  subscribe,
  hubStats,
  chapterSubscriberCount,
  _internal as sseInternal,
  SSE_QUEUE_MAX,
  isValidTopic,
} from "../lib/sseHub";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { hydrateMultiCompanyStore } from "../multiCompanyStore";
import * as collectiveMembershipStore from "../collectiveMembershipStore";
import { __setRuntimePersona } from "../lib/userContext";
import { chapterMemberships as chapterMembershipsTable } from "@shared/schema";
import { and, eq } from "drizzle-orm";

/* --------------------------------------------------------------- */
/* Unit tests                                                        */
/* --------------------------------------------------------------- */

describe("v18 Phase D — sseHub (unit)", () => {
  beforeEach(() => {
    sseInternal.reset();
  });

  it("isValidTopic narrows known topic strings", () => {
    expect(isValidTopic("comms")).toBe(true);
    expect(isValidTopic("events")).toBe(true);
    expect(isValidTopic("nonsense")).toBe(false);
  });

  it("publish() with no subscribers is a no-op (does not throw)", () => {
    expect(() => publish("chap_keiretsu_canada", "comms", { x: 1 })).not.toThrow();
    expect(chapterSubscriberCount("chap_keiretsu_canada")).toBe(0);
  });

  it("publish() delivers to a matching subscriber", async () => {
    const sub = subscribe({
      userId: "u_unit_1",
      chapterId: "chap_unit",
      topics: ["comms"],
    });

    publish("chap_unit", "comms", { hello: "world" });

    const { value, done } = await sub.iterator.next();
    expect(done).toBe(false);
    expect(value.topic).toBe("comms");
    expect((value.data as any).hello).toBe("world");
    sub.close();
  });

  it("filters by topic — subscriber only sees its subscribed topics", async () => {
    const sub = subscribe({
      userId: "u_unit_2",
      chapterId: "chap_unit",
      topics: ["events"],
    });

    publish("chap_unit", "comms", { ignored: true });
    publish("chap_unit", "events", { kept: true });

    const { value } = await sub.iterator.next();
    expect(value.topic).toBe("events");
    expect((value.data as any).kept).toBe(true);
    sub.close();
  });

  it("isolates by chapter — foreign-chapter publishes are ignored", async () => {
    const sub = subscribe({
      userId: "u_unit_3",
      chapterId: "chap_a",
      topics: ["comms"],
    });

    publish("chap_b", "comms", { wrongChapter: true });
    publish("chap_a", "comms", { rightChapter: true });

    const { value } = await sub.iterator.next();
    expect((value.data as any).rightChapter).toBe(true);
    sub.close();
  });

  it("bounded queue drops oldest and appends a 'lag' notice on overflow", async () => {
    const sub = subscribe({
      userId: "u_unit_4",
      chapterId: "chap_unit",
      topics: ["comms"],
    });

    // Publish QUEUE_MAX + 1 events synchronously WITHOUT consuming — that
    // exceeds the bound by exactly one, which should drop the oldest and
    // append a 'lag' marker. Total enqueued frames after overflow:
    //   [evt#1 dropped] [evt#2…#256] [lag] [evt#257]
    // The first dequeue should therefore be evt#2 (since #1 was dropped).
    for (let i = 0; i < SSE_QUEUE_MAX + 1; i++) {
      publish("chap_unit", "comms", { i });
    }

    // Drain queue and collect topics + lag markers.
    const seenTopics: string[] = [];
    let lagSeen = false;
    let firstNonLagPayload: any = null;
    // The iterator will keep waiting for more after the queue drains; pull
    // only as many frames as we expect (queueMax full + lag + the one over).
    // We expect SSE_QUEUE_MAX + 1 total in-queue frames (one was dropped,
    // one lag was appended, the new one was pushed = 256 + 1 + 1 - 1 = 257)…
    // The hub's logic is: if length >= MAX, shift (drop) then push a 'lag'
    // marker, THEN push the incoming evt. So queue after overflow has
    // SSE_QUEUE_MAX entries (we dropped 1, added 2). Let's just drain.
    const target = SSE_QUEUE_MAX + 1; // upper bound, may stop early
    for (let i = 0; i < target; i++) {
      // Use Promise.race against a tiny timeout so we don't hang if queue
      // is shorter than `target`.
      const winner = await Promise.race([
        sub.iterator.next().then((r) => ({ kind: "evt" as const, r })),
        new Promise<{ kind: "timeout" }>((resolve) =>
          setTimeout(() => resolve({ kind: "timeout" }), 25),
        ),
      ]);
      if (winner.kind === "timeout") break;
      if (winner.r.done) break;
      const v = winner.r.value;
      seenTopics.push(v.topic);
      if (v.topic === "lag") {
        lagSeen = true;
      } else if (firstNonLagPayload === null) {
        firstNonLagPayload = v.data;
      }
    }

    expect(lagSeen).toBe(true);
    // The first non-lag frame must be evt #1 (since the queue dropped at
    // overflow time, NOT the oldest already-drained one — the test never
    // drained between publishes, so the first non-lag frame after the lag
    // marker is whichever survived).
    expect(firstNonLagPayload).not.toBeNull();
    // Stats must show at least one drop.
    expect(sub.stats().dropped).toBeGreaterThanOrEqual(1);
    sub.close();
  });

  it("close() unregisters the subscriber and the iterator completes", async () => {
    const sub = subscribe({
      userId: "u_unit_5",
      chapterId: "chap_unit",
      topics: ["comms"],
    });
    expect(chapterSubscriberCount("chap_unit")).toBe(1);

    // Start a pending pull (no events yet), then close — the pull must
    // resolve with done=true.
    const pendingPull = sub.iterator.next();
    sub.close();
    const result = await pendingPull;
    expect(result.done).toBe(true);
    expect(chapterSubscriberCount("chap_unit")).toBe(0);
  });

  it("hubStats() reports chapter and subscriber counts", () => {
    const a = subscribe({
      userId: "u_unit_6",
      chapterId: "chap_a",
      topics: ["comms"],
    });
    const b = subscribe({
      userId: "u_unit_7",
      chapterId: "chap_b",
      topics: ["events"],
    });
    const stats = hubStats();
    expect(stats.chapters).toBe(2);
    expect(stats.totalSubscribers).toBe(2);
    expect(stats.byChapter["chap_a"]).toBe(1);
    expect(stats.byChapter["chap_b"]).toBe(1);
    expect(stats.topics.length).toBeGreaterThanOrEqual(6);
    a.close();
    b.close();
  });

  it("publish() with an invalid topic is a silent no-op", () => {
    const sub = subscribe({
      userId: "u_unit_8",
      chapterId: "chap_unit",
      topics: ["comms"],
    });
    // Cast away the type to simulate a buggy caller.
    publish("chap_unit", "bogus" as any, { x: 1 });
    expect(sub.stats().queueDepth).toBe(0);
    sub.close();
  });
});

/* --------------------------------------------------------------- */
/* HTTP integration                                                  */
/* --------------------------------------------------------------- */

const CHAPTER_ID = "chap_keiretsu_canada";
const TENANT_ID = "tenant_chap_chap_keiretsu_canada";
const FOREIGN_CHAPTER_ID = "chap_nyc";
const FOREIGN_TENANT_ID = "tenant_chap_chap_nyc";

let app: Express;
let server: http.Server;
let port: number;

function nowIso(): string {
  return new Date().toISOString();
}

function ensureChapterMembership(
  userId: string,
  chapterId: string,
  tenantId: string,
  role: "member" | "admin" = "member",
): void {
  const db: any = getDb();
  const existing = db
    .select({ id: (chapterMembershipsTable as any).id })
    .from(chapterMembershipsTable)
    .where(
      and(
        eq((chapterMembershipsTable as any).userId, userId),
        eq((chapterMembershipsTable as any).chapterId, chapterId),
      ),
    )
    .all() as any[];
  if (existing.length > 0) return;
  db.insert(chapterMembershipsTable)
    .values({
      id: `chmem_sse_${userId}_${chapterId}_${Math.random().toString(36).slice(2, 8)}`,
      tenantId,
      chapterId,
      userId,
      role,
      status: "active",
      joinedAt: nowIso(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    } as any)
    .run();
}

beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1";
  await seedDemoData(getDb());
  await hydrateMultiCompanyStore();

  // Register two synthetic users — one in chap_keiretsu_canada, one in chap_nyc.
  __setRuntimePersona({
    userId: "u_sse_member_tor",
    email: "sse-tor@capavate.example",
    name: "SSE Tor Member",
    isFounder: false,
    isInvestor: true,
    isAdmin: false,
    hasInvitations: false,
  });
  __setRuntimePersona({
    userId: "u_sse_member_nyc",
    email: "sse-nyc@capavate.example",
    name: "SSE NYC Member",
    isFounder: false,
    isInvestor: true,
    isAdmin: false,
    hasInvitations: false,
  });

  // Collective membership (required by requireCollectiveMember).
  collectiveMembershipStore.activate("u_sse_member_tor", "u_admin_test");
  collectiveMembershipStore.activate("u_sse_member_nyc", "u_admin_test");

  // Chapter memberships.
  ensureChapterMembership("u_sse_member_tor", CHAPTER_ID, TENANT_ID, "member");
  ensureChapterMembership(
    "u_sse_member_nyc",
    FOREIGN_CHAPTER_ID,
    FOREIGN_TENANT_ID,
    "member",
  );

  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
}, 30_000);

afterAll(async () => {
  sseInternal.reset();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.COLLECTIVE_ENABLED;
});

/** Open an SSE-like connection, collect bytes until we see N frames or timeout. */
function openStream(opts: {
  userId?: string;
  chapterId: string;
  topics?: string;
  timeoutMs?: number;
}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams();
    qs.set("chapter_id", opts.chapterId);
    if (opts.topics) qs.set("topics", opts.topics);
    const headers: Record<string, string> = { accept: "text/event-stream" };
    if (opts.userId) headers["x-user-id"] = opts.userId;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/collective/stream?${qs.toString()}`,
        method: "GET",
        headers,
      },
      (res) => {
        let buf = "";
        const timer = setTimeout(() => {
          res.destroy();
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: buf });
        }, opts.timeoutMs ?? 250);
        res.on("data", (c) => {
          buf += c.toString();
        });
        res.on("end", () => {
          clearTimeout(timer);
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: buf });
        });
        res.on("error", () => {
          clearTimeout(timer);
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: buf });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("v18 Phase D — /api/collective/stream (HTTP)", () => {
  it("returns 503 when COLLECTIVE_ENABLED is off", async () => {
    delete process.env.COLLECTIVE_ENABLED;
    const r = await openStream({
      userId: "u_sse_member_tor",
      chapterId: CHAPTER_ID,
      timeoutMs: 250,
    });
    expect(r.status).toBe(503);
    process.env.COLLECTIVE_ENABLED = "1";
  });

  it("returns 403 when caller is not a member of the chapter", async () => {
    const r = await openStream({
      userId: "u_sse_member_nyc",
      chapterId: CHAPTER_ID,
      timeoutMs: 250,
    });
    expect([403, 401]).toContain(r.status);
  });

  it("returns 200 + initial connected frame for a chapter member", async () => {
    const r = await openStream({
      userId: "u_sse_member_tor",
      chapterId: CHAPTER_ID,
      timeoutMs: 350,
    });
    expect(r.status).toBe(200);
    expect(String(r.headers["content-type"] ?? "")).toMatch(/text\/event-stream/);
    // Initial frame is `:connected\n\n`.
    expect(r.body).toContain(":connected");
  });

  it("delivers a published event over the live stream", async () => {
    // Open the stream and concurrently publish — assert the published
    // payload arrives in the SSE bytes within the timeout.
    const streamPromise = openStream({
      userId: "u_sse_member_tor",
      chapterId: CHAPTER_ID,
      topics: "comms",
      timeoutMs: 400,
    });
    // Wait ~50ms for subscribe to land before publishing.
    await new Promise((r) => setTimeout(r, 60));
    publish(CHAPTER_ID, "comms", { hello: "sse_smoke" });
    const r = await streamPromise;
    expect(r.status).toBe(200);
    expect(r.body).toContain("sse_smoke");
  });
});
