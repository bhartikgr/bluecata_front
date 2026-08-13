/**
 * WAVE 18 / XT-7 — the partner surface on the already-registered SSE topics.
 *
 * WHAT THIS ITEM ACTUALLY WAS. Publisher, transport and per-topic
 * authorization for `spv` / `crm` / `partner-workspace` all shipped long ago
 * (`server/spvFundStore.ts:1571`, `server/lib/sseHub.ts:32-57`,
 * `server/collectiveSseRoutes.ts:69-73`). What was missing was a subscriber, and
 * the reason no partner page could BE one is subtle and lived in the client:
 * `useCollectiveStream` bailed on `if (!chapterId) return;`, while a partner
 * topic has no chapter — the server resolves the partner id from the session and
 * ignores `chapter_id` for these topics entirely
 * (`server/collectiveSseRoutes.ts:157,:218-227`).
 *
 * So the change under test is a client one (`scope: "partner"`, which OMITS
 * `chapter_id`), and this suite exists to prove the CONTRACT that change relies
 * on is real rather than assumed — i.e. that a chapter-less request for partner
 * topics is genuinely accepted, genuinely scoped, and genuinely refused to
 * everyone else. Every claim is asserted at BOTH poles.
 *
 * Harness: in-process Express + raw http.request, mirroring
 * `server/__tests__/ssePartnerAuth.test.ts` (SSE never terminates on its own, so
 * each read is bounded by a timeout and the socket is destroyed).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { and, eq } from "drizzle-orm";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { hydrateMultiCompanyStore } from "../multiCompanyStore";
import * as collectiveMembershipStore from "../collectiveMembershipStore";
import { __setRuntimePersona } from "../lib/userContext";
import { chapterMemberships as chapterMembershipsTable } from "@shared/schema";
import {
  seedTestPartnerSandbox,
  TEST_PARTNER_ID,
  TEST_PARTNER_USERS,
} from "../partnerWorkspaceStore";
import { publish as ssePublish, _internal as sseInternal } from "../lib/sseHub";

const CHAPTER_ID = "chap_keiretsu_canada";
const TENANT_ID = "tenant_chap_chap_keiretsu_canada";

/** A partner team member. Authorised for partner topics, member of no chapter. */
const PARTNER_USER = TEST_PARTNER_USERS.managing.userId;
/** A viewer on the SAME partner — partner topics are team-wide, not role-gated. */
const PARTNER_VIEWER = TEST_PARTNER_USERS.viewer.userId;
/** The negative pole: a real, authenticated user who is on no partner team. */
const OUTSIDER = "u_xt7_not_a_partner";

let app: Express;
let server: http.Server;
let port: number;

function nowIso(): string {
  return new Date().toISOString();
}

function ensureChapterMembership(userId: string): void {
  const db: any = getDb();
  const existing = db
    .select({ id: (chapterMembershipsTable as any).id })
    .from(chapterMembershipsTable)
    .where(
      and(
        eq((chapterMembershipsTable as any).userId, userId),
        eq((chapterMembershipsTable as any).chapterId, CHAPTER_ID),
      ),
    )
    .all() as any[];
  if (existing.length > 0) return;
  db.insert(chapterMembershipsTable)
    .values({
      id: `chmem_xt7_${userId}_${Math.random().toString(36).slice(2, 8)}`,
      tenantId: TENANT_ID,
      chapterId: CHAPTER_ID,
      userId,
      role: "member",
      status: "active",
      joinedAt: nowIso(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    } as any)
    .run();
}

interface StreamResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/**
 * Open a stream. `chapterId` is only sent when supplied — the whole point of
 * this item is what happens when the param is ABSENT, which is a different
 * request from sending it empty.
 *
 * `afterConnect` runs once the response headers are in, which is the earliest
 * moment a publish is guaranteed to land on an established subscription.
 */
function openStream(opts: {
  userId?: string;
  path?: string;
  chapterId?: string;
  topics?: string;
  partnerId?: string;
  timeoutMs?: number;
  afterConnect?: () => void;
}): Promise<StreamResult> {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams();
    if (opts.chapterId) qs.set("chapter_id", opts.chapterId);
    if (opts.topics) qs.set("topics", opts.topics);
    if (opts.partnerId) qs.set("partner_id", opts.partnerId);
    const headers: Record<string, string> = { accept: "text/event-stream" };
    if (opts.userId) headers["x-user-id"] = opts.userId;
    const reqPath = (opts.path ?? "/api/stream") + `?${qs.toString()}`;
    const req = http.request(
      { hostname: "127.0.0.1", port, path: reqPath, method: "GET", headers },
      (res) => {
        let buf = "";
        const timer = setTimeout(() => {
          res.destroy();
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: buf });
        }, opts.timeoutMs ?? 300);
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
        if (opts.afterConnect) setTimeout(opts.afterConnect, 40);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1";
  await seedDemoData(getDb());
  await hydrateMultiCompanyStore();
  seedTestPartnerSandbox({ force: true });

  __setRuntimePersona({
    userId: OUTSIDER,
    email: "xt7-outsider@capavate.example",
    name: "XT7 Outsider",
    isFounder: false,
    isInvestor: true,
    isAdmin: false,
    hasInvitations: false,
  });
  /* The outsider is deliberately given a Collective membership AND a chapter
   * membership. That makes the negative pole meaningful: the refusal must come
   * from not being a PARTNER, not from being a stranger to the platform. */
  collectiveMembershipStore.activate(OUTSIDER, "u_admin_test");
  ensureChapterMembership(OUTSIDER);

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
}, 40_000);

afterAll(async () => {
  sseInternal.reset();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.COLLECTIVE_ENABLED;
});

describe("XT-7 — a partner surface can subscribe with NO chapter_id", () => {
  it("accepts topics=spv with the chapter_id param absent", async () => {
    const r = await openStream({ userId: PARTNER_USER, topics: "spv", timeoutMs: 350 });
    expect(r.status).toBe(200);
    expect(String(r.headers["content-type"] ?? "")).toMatch(/text\/event-stream/);
    expect(r.body).toContain(":connected");
  });

  it("accepts topics=crm and topics=partner-workspace with no chapter_id", async () => {
    for (const topics of ["crm", "partner-workspace", "spv,crm,partner-workspace"]) {
      const r = await openStream({ userId: PARTNER_USER, topics, timeoutMs: 300 });
      expect(r.status, `topics=${topics}`).toBe(200);
      expect(r.body, `topics=${topics}`).toContain(":connected");
    }
  });

  it("accepts a VIEWER on the same partner — partner topics are team-wide", async () => {
    const r = await openStream({ userId: PARTNER_VIEWER, topics: "spv", timeoutMs: 300 });
    expect(r.status).toBe(200);
  });

  /* THE OTHER POLE of the same mechanism: dropping chapter_id is legitimate
   * ONLY for partner topics. A chapter topic without a chapter must still be a
   * visible refusal, never a silently empty stream that a page would render as
   * "connected, nothing happening".
   *
   * MEASURED CONTRACT, and my first draft of this test asserted the wrong one.
   * I expected 400 `missing_chapter_id` (server/collectiveSseRoutes.ts:213).
   * The real answer is 403 `no_authorized_topics` (:207), and the ORDER is the
   * reason: `authorizedTopics` runs first, and for a caller who is a partner but
   * a member of NO chapter, `comms` never enters the allowed set at all, so the
   * intersection is empty and the request is refused for authorization before
   * anything asks whether a chapter id was supplied. The 400 is reachable only
   * by a caller who IS a member of the chapter they omitted. Both are visible
   * refusals with an error code, which is what the item requires; the test now
   * pins what the code does rather than what I assumed. */
  it("REFUSES a chapter-scoped topic when chapter_id is absent (visible refusal, not silence)", async () => {
    const r = await openStream({ userId: PARTNER_USER, topics: "comms", timeoutMs: 300 });
    expect(r.status).toBe(403);
    expect(r.body).toContain("no_authorized_topics");
    expect(r.body).not.toContain(":connected");
  });

  /* And the 400 branch. Finding, recorded because it is not what the code reads
   * like: for a NON-ADMIN the 400 is UNREACHABLE. `chapterMember` is computed as
   * `chapterId.length > 0 && isActiveChapterMember(...)`
   * (server/collectiveSseRoutes.ts:161), so omitting the chapter id makes the
   * caller a member of nothing, `comms` never enters the allowed set, and the
   * request dies at the 403 on :207 before reaching the `missing_chapter_id`
   * check on :213. The only caller who gets that far is an ADMIN, for whom every
   * topic is allowed unconditionally (:191). So the assertion below is made from
   * an admin session — and it still matters, because it proves the chapter
   * requirement is intact and that `scope: "partner"` on the client is an opt-in
   * for partner topics rather than a way to lose the chapter requirement. */
  it("an admin who omits chapter_id gets 400 missing_chapter_id for a chapter topic", async () => {
    const r = await openStream({ userId: "u_admin", topics: "comms", timeoutMs: 300 });
    expect(r.status).toBe(400);
    expect(r.body).toContain("missing_chapter_id");
  });

  it("a chapter member who omits chapter_id is refused too — 403, never a silent empty stream", async () => {
    const r = await openStream({ userId: OUTSIDER, topics: "comms", timeoutMs: 300 });
    expect(r.status).toBe(403);
    expect(r.body).not.toContain(":connected");
  });
});

describe("XT-7 — omitting chapter_id widens nothing", () => {
  it("a non-partner (Collective + chapter member) is still refused partner topics", async () => {
    const r = await openStream({ userId: OUTSIDER, topics: "spv", timeoutMs: 300 });
    expect(r.status).toBe(403);
    expect(r.body).toContain("no_authorized_topics");
  });

  it("...and is refused all three partner topics, chapter_id present or absent", async () => {
    for (const topics of ["spv", "crm", "partner-workspace"]) {
      const bare = await openStream({ userId: OUTSIDER, topics, timeoutMs: 250 });
      expect(bare.status, `bare topics=${topics}`).toBe(403);
      const scoped = await openStream({
        userId: OUTSIDER,
        topics,
        chapterId: CHAPTER_ID,
        timeoutMs: 250,
      });
      expect(scoped.status, `chapter-scoped topics=${topics}`).toBe(403);
    }
  });

  it("the SAME outsider IS accepted for a chapter topic — so the 403 above is about partner scope, not identity", async () => {
    const r = await openStream({
      userId: OUTSIDER,
      topics: "comms",
      chapterId: CHAPTER_ID,
      timeoutMs: 300,
    });
    expect(r.status).toBe(200);
    expect(r.body).toContain(":connected");
  });

  it("an unauthenticated caller gets no stream at all", async () => {
    const r = await openStream({ topics: "spv", timeoutMs: 250 });
    expect(r.status).not.toBe(200);
  });
});

describe("XT-7 — frames published to the partner scope actually arrive", () => {
  /* This is the test that makes the wiring falsifiable end-to-end. It is not
   * enough that the connection opens: the subscription must be keyed to the
   * SAME scope the publisher uses. The publisher is
   * `ssePublish(ctx.partnerId, "spv", …)` (server/spvFundStore.ts:1571), so the
   * frame is published on TEST_PARTNER_ID and must reach a subscriber who never
   * mentioned a partner id at all. */
  it("delivers an `spv` frame published on the partner id to a chapter-less subscriber", async () => {
    const r = await openStream({
      userId: PARTNER_USER,
      topics: "spv",
      timeoutMs: 600,
      afterConnect: () =>
        ssePublish(TEST_PARTNER_ID, "spv", {
          type: "spv.capital_call.recorded",
          spvId: "spv_xt7_probe",
          sequenceNo: 1,
        }),
    });
    expect(r.status).toBe(200);
    expect(r.body).toContain("event: spv");
    expect(r.body).toContain("spv_xt7_probe");
  });

  it("delivers a `crm` frame the same way", async () => {
    const r = await openStream({
      userId: PARTNER_USER,
      topics: "crm",
      timeoutMs: 600,
      afterConnect: () =>
        ssePublish(TEST_PARTNER_ID, "crm", {
          type: "crm.created",
          contactId: "pcrm_xt7_probe",
          partnerId: TEST_PARTNER_ID,
        }),
    });
    expect(r.status).toBe(200);
    expect(r.body).toContain("event: crm");
    expect(r.body).toContain("pcrm_xt7_probe");
  });

  /* NEGATIVE POLE for the delivery claim: a frame published on ANOTHER
   * partner's scope must NOT arrive. Without this, the two tests above would
   * also pass if the server broadcast every frame to every partner — the
   * cross-tenant leak that would be far worse than the staleness being fixed. */
  it("does NOT deliver a frame published on a DIFFERENT partner's scope", async () => {
    const r = await openStream({
      userId: PARTNER_USER,
      topics: "spv",
      timeoutMs: 600,
      afterConnect: () =>
        ssePublish("ac_consortium_partner_someone_else", "spv", {
          type: "spv.position.recorded",
          spvId: "spv_xt7_other_partner",
        }),
    });
    expect(r.status).toBe(200);
    expect(r.body).not.toContain("spv_xt7_other_partner");
  });

  it("subscribing to `spv` does not deliver `crm` frames (per-topic, not a firehose)", async () => {
    const r = await openStream({
      userId: PARTNER_USER,
      topics: "spv",
      timeoutMs: 600,
      afterConnect: () =>
        ssePublish(TEST_PARTNER_ID, "crm", {
          type: "crm.created",
          contactId: "pcrm_xt7_should_not_arrive",
        }),
    });
    expect(r.status).toBe(200);
    expect(r.body).not.toContain("pcrm_xt7_should_not_arrive");
  });
});

describe("XT-7 — an explicit partner_id cannot be borrowed", () => {
  it("rejects a partner_id that is not the caller's", async () => {
    const r = await openStream({
      userId: PARTNER_USER,
      topics: "spv",
      partnerId: "ac_consortium_partner_someone_else",
      timeoutMs: 250,
    });
    expect(r.status).toBe(403);
    expect(r.body).toContain("partner_id_mismatch");
  });

  it("accepts the caller's own partner_id (so the 403 above is the mismatch, not the param)", async () => {
    const r = await openStream({
      userId: PARTNER_USER,
      topics: "spv",
      partnerId: TEST_PARTNER_ID,
      timeoutMs: 300,
    });
    expect(r.status).toBe(200);
  });
});
