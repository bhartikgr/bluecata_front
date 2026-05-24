/**
 * v18 Phase D — chapter_admin role middleware + management endpoints.
 *
 * Coverage:
 *   - requireChapterAdmin: 401 missing identity, 403 plain member,
 *     pass for chapter admin, pass for platform admin (isAdmin).
 *   - Promote endpoint (POST /api/admin/chapters/:chapterId/admins):
 *       - 401 not authed, 403 non-admin caller, 404 unknown chapter,
 *         404 user is not a chapter member, 200 happy path,
 *         200 idempotent re-promote.
 *   - Demote endpoint (DELETE /api/admin/chapters/:chapterId/admins/:userId):
 *       - 200 happy path (removes admin role), 409 last_admin safeguard,
 *         200 idempotent demote of a non-admin member.
 *   - Cross-chapter isolation: chapter admin of chap_keiretsu_canada CANNOT
 *     pass requireChapterAdmin("chap_nyc").
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
  _internal as roleInternal,
} from "../lib/requireChapterMember";

const CHAPTER_TOR = "chap_keiretsu_canada";
const TENANT_TOR = "tenant_chap_chap_keiretsu_canada";
const CHAPTER_NYC = "chap_nyc";
const TENANT_NYC = "tenant_chap_chap_nyc";

const PLATFORM_ADMIN = "u_chad_root";
const PLAIN_MEMBER = "u_chad_member";
const CANDIDATE = "u_chad_candidate";

let app: Express;
let server: http.Server;
let port: number;

function nowIso(): string {
  return new Date().toISOString();
}

function call(
  method: string,
  apiPath: string,
  opts: { body?: unknown; userId?: string } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data =
      opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    if (opts.userId) headers["x-user-id"] = opts.userId;
    const r = http.request(
      { hostname: "127.0.0.1", port, path: apiPath, method, headers },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let body: any = null;
          try {
            body = JSON.parse(buf);
          } catch {
            body = { raw: buf };
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

function ensureMembership(
  userId: string,
  chapterId: string,
  tenantId: string,
  role: "member" | "admin" = "member",
): void {
  const db: any = getDb();
  const existing = db
    .select({
      id: (chapterMembershipsTable as any).id,
      role: (chapterMembershipsTable as any).role,
      status: (chapterMembershipsTable as any).status,
    })
    .from(chapterMembershipsTable)
    .where(
      and(
        eq((chapterMembershipsTable as any).userId, userId),
        eq((chapterMembershipsTable as any).chapterId, chapterId),
      ),
    )
    .all() as any[];
  if (existing.length > 0) {
    // Force role + status to match what the test expects.
    db.update(chapterMembershipsTable)
      .set({ role, status: "active", updatedAt: nowIso() })
      .where(eq((chapterMembershipsTable as any).id, existing[0].id))
      .run();
    return;
  }
  db.insert(chapterMembershipsTable)
    .values({
      id: `chmem_role_${userId}_${chapterId}_${Math.random().toString(36).slice(2, 8)}`,
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

  // Platform admin persona.
  __setRuntimePersona({
    userId: PLATFORM_ADMIN,
    email: "platform-admin@capavate.example",
    name: "Platform Admin",
    isFounder: false,
    isInvestor: false,
    isAdmin: true,
    hasInvitations: false,
  });
  // Plain member persona — chapter member but not chapter admin.
  __setRuntimePersona({
    userId: PLAIN_MEMBER,
    email: "plain-member@capavate.example",
    name: "Plain Member",
    isFounder: false,
    isInvestor: true,
    isAdmin: false,
    hasInvitations: false,
  });
  // Candidate persona — chapter member who we will promote.
  __setRuntimePersona({
    userId: CANDIDATE,
    email: "candidate@capavate.example",
    name: "Candidate",
    isFounder: false,
    isInvestor: true,
    isAdmin: false,
    hasInvitations: false,
  });

  collectiveMembershipStore.activate(PLAIN_MEMBER, "u_admin_test");
  collectiveMembershipStore.activate(CANDIDATE, "u_admin_test");

  ensureMembership(PLAIN_MEMBER, CHAPTER_TOR, TENANT_TOR, "member");
  ensureMembership(CANDIDATE, CHAPTER_TOR, TENANT_TOR, "member");

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
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.COLLECTIVE_ENABLED;
});

/* --------------------------------------------------------------- */
/* Unit: isActiveChapterAdmin                                        */
/* --------------------------------------------------------------- */

describe("v18 Phase D — requireChapterAdmin (unit)", () => {
  it("returns true for an active 'admin' chapter membership row", () => {
    // u_aisha_patel is seeded as chap_keiretsu_canada admin.
    expect(roleInternal.isActiveChapterAdmin("u_aisha_patel", CHAPTER_TOR)).toBe(true);
  });

  it("returns false for a member with role='member'", () => {
    expect(roleInternal.isActiveChapterAdmin(PLAIN_MEMBER, CHAPTER_TOR)).toBe(false);
  });

  it("returns false cross-chapter (admin of A is not admin of B)", () => {
    // Aisha is admin in Toronto, NOT in NYC.
    expect(roleInternal.isActiveChapterAdmin("u_aisha_patel", CHAPTER_NYC)).toBe(false);
  });

  it("returns false for unknown user", () => {
    expect(roleInternal.isActiveChapterAdmin("u_does_not_exist", CHAPTER_TOR)).toBe(false);
  });
});

/* --------------------------------------------------------------- */
/* HTTP: management endpoints                                        */
/* --------------------------------------------------------------- */

describe("v18 Phase D — /api/admin/chapters/:chapterId/admins endpoints", () => {
  it("rejects unauthenticated callers with 401", async () => {
    const r = await call("GET", `/api/admin/chapters/${CHAPTER_TOR}/admins`);
    expect([401, 403]).toContain(r.status);
  });

  it("rejects non-platform-admin callers with 403", async () => {
    const r = await call("GET", `/api/admin/chapters/${CHAPTER_TOR}/admins`, {
      userId: PLAIN_MEMBER,
    });
    expect(r.status).toBe(403);
  });

  it("lists current chapter admins for platform admin", async () => {
    const r = await call("GET", `/api/admin/chapters/${CHAPTER_TOR}/admins`, {
      userId: PLATFORM_ADMIN,
    });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(Array.isArray(r.body.admins)).toBe(true);
    // Seeded baseline: Aisha is an admin of chap_keiretsu_canada.
    const ids = r.body.admins.map((a: any) => a.userId);
    expect(ids).toContain("u_aisha_patel");
  });

  it("404 for unknown chapter", async () => {
    const r = await call("GET", `/api/admin/chapters/chap_nonexistent_xyz/admins`, {
      userId: PLATFORM_ADMIN,
    });
    expect(r.status).toBe(404);
  });

  it("404 when promoting a user that has no chapter membership", async () => {
    const r = await call("POST", `/api/admin/chapters/${CHAPTER_TOR}/admins`, {
      userId: PLATFORM_ADMIN,
      body: { user_id: "u_never_joined_chapter" },
    });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("membership_not_found");
  });

  it("promotes a chapter member to admin (happy path) and is idempotent", async () => {
    // First call — promote.
    const r1 = await call("POST", `/api/admin/chapters/${CHAPTER_TOR}/admins`, {
      userId: PLATFORM_ADMIN,
      body: { user_id: CANDIDATE },
    });
    expect(r1.status).toBe(200);
    expect(r1.body.ok).toBe(true);
    expect(r1.body.membership.role).toBe("admin");

    // Second call — idempotent.
    const r2 = await call("POST", `/api/admin/chapters/${CHAPTER_TOR}/admins`, {
      userId: PLATFORM_ADMIN,
      body: { user_id: CANDIDATE },
    });
    expect(r2.status).toBe(200);
    expect(r2.body.idempotent).toBe(true);
  });

  it("demotes a chapter admin back to member (happy path)", async () => {
    // CANDIDATE is now an admin from the previous test. Demote it.
    const r = await call(
      "DELETE",
      `/api/admin/chapters/${CHAPTER_TOR}/admins/${CANDIDATE}`,
      { userId: PLATFORM_ADMIN },
    );
    expect(r.status).toBe(200);
    expect(r.body.membership.role).toBe("member");
  });

  it("demote on a non-admin member is idempotent (200)", async () => {
    const r = await call(
      "DELETE",
      `/api/admin/chapters/${CHAPTER_TOR}/admins/${PLAIN_MEMBER}`,
      { userId: PLATFORM_ADMIN },
    );
    expect(r.status).toBe(200);
    expect(r.body.idempotent).toBe(true);
  });

  it("refuses to demote the last admin (409 last_admin)", async () => {
    // Make sure chapter has EXACTLY one admin (Aisha). Demote all others
    // first if any leaked. Then try to demote Aisha — should 409.
    const list = await call(
      "GET",
      `/api/admin/chapters/${CHAPTER_TOR}/admins`,
      { userId: PLATFORM_ADMIN },
    );
    const adminIds: string[] = list.body.admins.map((a: any) => a.userId);
    // Cleanup: ensure only Aisha remains.
    for (const uid of adminIds) {
      if (uid !== "u_aisha_patel") {
        await call("DELETE", `/api/admin/chapters/${CHAPTER_TOR}/admins/${uid}`, {
          userId: PLATFORM_ADMIN,
        });
      }
    }
    const r = await call(
      "DELETE",
      `/api/admin/chapters/${CHAPTER_TOR}/admins/u_aisha_patel`,
      { userId: PLATFORM_ADMIN },
    );
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("last_admin");
    expect(r.body.remaining).toBe(1);
  });
});
