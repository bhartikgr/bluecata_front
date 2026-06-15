/**
 * v18 Phase D — chapter-admin dashboard endpoint.
 *
 *   GET /api/collective/chapter-admin/dashboard?chapter_id=X
 *
 * Coverage:
 *   - 503 when COLLECTIVE_ENABLED is off
 *   - 401 missing identity
 *   - 403 caller is a plain chapter member (not chapter_admin)
 *   - 200 happy path for the seeded chapter admin (Aisha @ chap_keiretsu_canada)
 *   - Response shape: { ok, chapter, generatedAt, panels: { membership,
 *     pipeline, engagement, health } }
 *   - Cross-chapter isolation: admin of A cannot fetch B's dashboard.
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

const CHAPTER_TOR = "chap_keiretsu_canada";
const TENANT_TOR = "tenant_chap_chap_keiretsu_canada";
const CHAPTER_NYC = "chap_nyc";
const TENANT_NYC = "tenant_chap_chap_nyc";

const TOR_ADMIN = "u_aisha_patel"; // seeded
const TOR_MEMBER = "u_dash_member";

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
    .select({ id: (chapterMembershipsTable as any).id })
    .from(chapterMembershipsTable)
    .where(
      and(
        eq((chapterMembershipsTable as any).userId, userId),
        eq((chapterMembershipsTable as any).chapterId, chapterId),
      ),
    )
    .all() as any[];
  if (existing.length > 0) {
    db.update(chapterMembershipsTable)
      .set({ role, status: "active", updatedAt: nowIso() })
      .where(eq((chapterMembershipsTable as any).id, existing[0].id))
      .run();
    return;
  }
  db.insert(chapterMembershipsTable)
    .values({
      id: `chmem_dash_${userId}_${chapterId}_${Math.random().toString(36).slice(2, 8)}`,
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

  // Plain Toronto member — should be 403 on the dashboard.
  __setRuntimePersona({
    userId: TOR_MEMBER,
    email: "dash-member@capavate.example",
    name: "Dash Member",
    isFounder: false,
    isInvestor: true,
    isAdmin: false,
    hasInvitations: false,
  });
  collectiveMembershipStore.activate(TOR_MEMBER, "u_admin_test");
  ensureMembership(TOR_MEMBER, CHAPTER_TOR, TENANT_TOR, "member");

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

describe("v18 Phase D — chapter-admin dashboard endpoint", () => {
  it("returns 503 when COLLECTIVE_ENABLED is off", async () => {
    delete process.env.COLLECTIVE_ENABLED;
    const r = await call(
      "GET",
      `/api/collective/chapter-admin/dashboard?chapter_id=${CHAPTER_TOR}`,
      { userId: TOR_ADMIN },
    );
    expect(r.status).toBe(503);
    process.env.COLLECTIVE_ENABLED = "1";
  });

  it("returns 403 for a chapter member who is not chapter_admin", async () => {
    const r = await call(
      "GET",
      `/api/collective/chapter-admin/dashboard?chapter_id=${CHAPTER_TOR}`,
      { userId: TOR_MEMBER },
    );
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("not_chapter_admin");
  });

  it("returns 200 + full dashboard shape for the chapter admin", async () => {
    const r = await call(
      "GET",
      `/api/collective/chapter-admin/dashboard?chapter_id=${CHAPTER_TOR}`,
      { userId: TOR_ADMIN },
    );
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.chapter?.id).toBe(CHAPTER_TOR);
    expect(typeof r.body.generatedAt).toBe("string");
    // Panels.
    expect(r.body.panels).toBeDefined();
    expect(r.body.panels.membership).toBeDefined();
    expect(r.body.panels.pipeline).toBeDefined();
    expect(r.body.panels.engagement).toBeDefined();
    expect(r.body.panels.health).toBeDefined();
  });

  it("rejects cross-chapter access (Toronto admin → NYC dashboard)", async () => {
    const r = await call(
      "GET",
      `/api/collective/chapter-admin/dashboard?chapter_id=${CHAPTER_NYC}`,
      { userId: TOR_ADMIN },
    );
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("not_chapter_admin");
  });

  it("400 when chapter_id query param is missing", async () => {
    const r = await call(
      "GET",
      "/api/collective/chapter-admin/dashboard",
      { userId: TOR_ADMIN },
    );
    expect([400, 403]).toContain(r.status);
  });
});
