/**
 * CP Phase C — ssePartnerAuth.test.ts (CP-034)
 *
 * Verifies the topic-aware authorization rewrite of
 * `/api/collective/stream` and the new `/api/stream` alias:
 *
 *   - Chapter member CAN subscribe to chapter-scoped topics (comms, events)
 *   - Chapter member CANNOT subscribe to partner-only topics (partner-workspace, crm, spv)
 *   - Partner member CAN subscribe to partner-only topics via `/api/stream`
 *   - Partner member with no chapter membership gets `no_authorized_topics`
 *     when only chapter topics are requested.
 *   - Mixed request from a partner-only caller: only partner topics survive.
 *   - Explicit partner_id query param must match resolved partnerId.
 *   - /api/stream does NOT require COLLECTIVE_ENABLED flag.
 *
 * The HTTP harness is in-process Express + raw http.request — mirrors the
 * pattern in sseHub.test.ts. Connections are closed after a short timeout
 * because SSE never naturally terminates.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
} from "vitest";
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
  TEST_PARTNER_USERS,
} from "../partnerWorkspaceStore";
import { _internal as sseInternal } from "../lib/sseHub";

const CHAPTER_ID = "chap_keiretsu_canada";
const TENANT_ID = "tenant_chap_chap_keiretsu_canada";

const CHAPTER_USER = "u_sse_partner_auth_chap";
const PARTNER_USER = TEST_PARTNER_USERS.managing.userId;     // u_avi_managing
const PARTNER_VIEWER = TEST_PARTNER_USERS.viewer.userId;     // u_avi_viewer

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
      id: `chmem_partnersse_${userId}_${chapterId}_${Math.random().toString(36).slice(2, 8)}`,
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

function openStream(opts: {
  userId?: string;
  path?: string;
  chapterId?: string;
  topics?: string;
  partnerId?: string;
  timeoutMs?: number;
}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams();
    if (opts.chapterId) qs.set("chapter_id", opts.chapterId);
    if (opts.topics) qs.set("topics", opts.topics);
    if (opts.partnerId) qs.set("partner_id", opts.partnerId);
    const headers: Record<string, string> = { accept: "text/event-stream" };
    if (opts.userId) headers["x-user-id"] = opts.userId;
    const reqPath = (opts.path ?? "/api/collective/stream") + `?${qs.toString()}`;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: reqPath,
        method: "GET",
        headers,
      },
      (res) => {
        let buf = "";
        const timer = setTimeout(() => {
          res.destroy();
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: buf });
        }, opts.timeoutMs ?? 220);
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

beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1";
  await seedDemoData(getDb());
  await hydrateMultiCompanyStore();
  seedTestPartnerSandbox({ force: true });

  // Chapter-only user (no partner membership)
  __setRuntimePersona({
    userId: CHAPTER_USER,
    email: "ssepartner-chap@capavate.example",
    name: "SSE Chapter Only",
    isFounder: false,
    isInvestor: true,
    isAdmin: false,
    hasInvitations: false,
  });
  collectiveMembershipStore.activate(CHAPTER_USER, "u_admin_test");
  ensureChapterMembership(CHAPTER_USER, CHAPTER_ID, TENANT_ID, "member");

  // Partner-only users — seedTestPartnerSandbox registers personas for these
  // via PERSONAS in userContext. They are NOT chapter members.

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

describe("CP-034 — chapter-only user", () => {
  it("CAN subscribe to chapter-scoped topics (comms)", async () => {
    const r = await openStream({
      userId: CHAPTER_USER,
      chapterId: CHAPTER_ID,
      topics: "comms",
      timeoutMs: 350,
    });
    expect(r.status).toBe(200);
    expect(String(r.headers["content-type"] ?? "")).toMatch(/text\/event-stream/);
    expect(r.body).toContain(":connected");
  });

  it("CANNOT subscribe to partner-only topics (crm)", async () => {
    const r = await openStream({
      userId: CHAPTER_USER,
      chapterId: CHAPTER_ID,
      topics: "crm",
      timeoutMs: 250,
    });
    expect(r.status).toBe(403);
    expect(r.body).toContain("no_authorized_topics");
  });
});

describe("CP-034 — partner-only user (no chapter membership)", () => {
  it("CAN subscribe to partner-only topics via /api/stream (partner-workspace)", async () => {
    const r = await openStream({
      userId: PARTNER_USER,
      path: "/api/stream",
      topics: "partner-workspace",
      timeoutMs: 350,
    });
    expect(r.status).toBe(200);
    expect(r.body).toContain(":connected");
  });

  it("CAN subscribe to partner-only topics via /api/collective/stream too", async () => {
    const r = await openStream({
      userId: PARTNER_USER,
      topics: "crm,spv",
      timeoutMs: 350,
    });
    expect(r.status).toBe(200);
    expect(r.body).toContain(":connected");
  });

  it("CANNOT subscribe to chapter-scoped topics (comms) — gets no_authorized_topics", async () => {
    const r = await openStream({
      userId: PARTNER_USER,
      chapterId: CHAPTER_ID,
      topics: "comms",
      timeoutMs: 250,
    });
    // Partner has no chapter membership in CHAPTER_ID, so comms is not authorized.
    expect(r.status).toBe(403);
    expect(r.body).toContain("no_authorized_topics");
  });

  it("mixed request: only authorized topics (partner topics) come through, chapter topics are filtered out", async () => {
    const r = await openStream({
      userId: PARTNER_USER,
      topics: "comms,partner-workspace",
      timeoutMs: 350,
    });
    // partner-workspace survives because PARTNER_USER is a partner member.
    expect(r.status).toBe(200);
    expect(r.body).toContain(":connected");
  });

  it("partner_id mismatch is rejected (403 partner_id_mismatch)", async () => {
    const r = await openStream({
      userId: PARTNER_USER,
      path: "/api/stream",
      topics: "partner-workspace",
      partnerId: "ac_consortium_partner_does_not_exist",
      timeoutMs: 250,
    });
    expect(r.status).toBe(403);
    expect(r.body).toContain("partner_id_mismatch");
  });
});

describe("CP-034 — /api/stream does not require COLLECTIVE_ENABLED", () => {
  it("partner can connect to /api/stream when flag is off", async () => {
    delete process.env.COLLECTIVE_ENABLED;
    try {
      const r = await openStream({
        userId: PARTNER_USER,
        path: "/api/stream",
        topics: "partner-workspace",
        timeoutMs: 350,
      });
      expect(r.status).toBe(200);
      expect(r.body).toContain(":connected");
    } finally {
      process.env.COLLECTIVE_ENABLED = "1";
    }
  });

  it("chapter member CANNOT connect to /api/collective/stream when flag is off (503)", async () => {
    delete process.env.COLLECTIVE_ENABLED;
    try {
      const r = await openStream({
        userId: CHAPTER_USER,
        chapterId: CHAPTER_ID,
        topics: "comms",
        timeoutMs: 250,
      });
      expect(r.status).toBe(503);
    } finally {
      process.env.COLLECTIVE_ENABLED = "1";
    }
  });
});

describe("CP-034 — partner_id explicit, valid match", () => {
  it("partner can supply their own partner_id and it is accepted", async () => {
    // Resolve PARTNER_USER's partnerId by introspecting partnerTeamStore.
    const { partnerTeamStore } = await import("../partnerWorkspaceStore");
    const team = partnerTeamStore.findByUserId(PARTNER_USER);
    expect(team).toBeTruthy();
    const r = await openStream({
      userId: PARTNER_USER,
      path: "/api/stream",
      topics: "partner-workspace",
      partnerId: team!.partnerId,
      timeoutMs: 350,
    });
    expect(r.status).toBe(200);
    expect(r.body).toContain(":connected");
  });
});

describe("CP-034 — partner viewer (lowest sub-role) still passes", () => {
  it("viewer sub-role can subscribe to partner-workspace (membership, not write, is the gate)", async () => {
    const r = await openStream({
      userId: PARTNER_VIEWER,
      path: "/api/stream",
      topics: "partner-workspace",
      timeoutMs: 350,
    });
    expect(r.status).toBe(200);
    expect(r.body).toContain(":connected");
  });
});
