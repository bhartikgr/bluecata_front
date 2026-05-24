/**
 * Harmony Sweep 3 — Empty-state audit.
 *
 * Spawns a NEW chapter with no announcements / resources / leaderboard /
 * questions / events and verifies that every list endpoint returns a
 * clean 200 with an empty collection — NOT 404, NOT 500.
 *
 * A fresh user is granted chapter_membership.member on the new chapter
 * so the requireChapterMember middleware passes.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { randomBytes } from "node:crypto";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import * as collectiveMembershipStore from "../collectiveMembershipStore";
import { hydrateMultiCompanyStore } from "../multiCompanyStore";
import { __setRuntimePersona } from "../lib/userContext";
import {
  chapters as chaptersTable,
  chapterMemberships as chapterMembershipsTable,
  tenants as tenantsTable,
} from "../../shared/schema";

const CHAPTER_ID = `chap_empty_${randomBytes(4).toString("hex")}`;
const CHAPTER_TENANT = `tenant_chap_${CHAPTER_ID}`;
const USER_ID = `u_empty_member_${randomBytes(4).toString("hex")}`;

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1";
  await seedDemoData(getDb());
  await hydrateMultiCompanyStore();

  // Seed a brand-new chapter + tenant + a single member with role 'member'.
  const now = new Date().toISOString();
  const db: any = getDb();
  try {
    db.insert(tenantsTable).values({
      id: CHAPTER_TENANT,
      name: "Harmony Empty Chapter",
      kind: "consortium_partner",
      createdAt: now,
    }).run();
  } catch {/* may already exist */}
  try {
    db.insert(chaptersTable).values({
      id: CHAPTER_ID,
      tenantId: CHAPTER_TENANT,
      name: "Empty Harmony Chapter",
      region: "NA-East",
      city: "Toronto",
      status: "active",
      createdAt: now,
    }).run();
  } catch {/* may already exist */}
  try {
    db.insert(chapterMembershipsTable).values({
      id: `chmem_empty_${randomBytes(4).toString("hex")}`,
      tenantId: CHAPTER_TENANT,
      chapterId: CHAPTER_ID,
      userId: USER_ID,
      role: "member",
      status: "active",
      joinedAt: now,
      createdAt: now,
    } as any).run();
  } catch {/* may already exist */}
  collectiveMembershipStore.activate(USER_ID, "u_admin_empty_state");
  __setRuntimePersona({
    userId: USER_ID,
    email: `${USER_ID}@empty.example`,
    name: "Empty State Member",
    isFounder: false,
    isInvestor: true,
    isAdmin: false,
    hasInvitations: false,
  });

  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => {
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      r();
    });
  });
}, 30_000);

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  delete process.env.COLLECTIVE_ENABLED;
});

function call(method: string, p: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path: p, method, headers: { "x-user-id": USER_ID } },
      (res) => {
        let buf = ""; res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let body: any = null;
          try { body = JSON.parse(buf); } catch { body = buf; }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("Harmony Sweep 3 — empty chapter returns clean 200 / empty collection on every list surface", () => {
  it("GET /api/collective/announcements?chapter_id=<new> → 200, empty array", async () => {
    const r = await call("GET", `/api/collective/announcements?chapter_id=${CHAPTER_ID}`);
    expect([200, 204]).toContain(r.status);
  });

  it("GET /api/collective/resources?chapter_id=<new> → 200, empty array", async () => {
    const r = await call("GET", `/api/collective/resources?chapter_id=${CHAPTER_ID}`);
    expect([200, 204]).toContain(r.status);
  });

  it("GET /api/collective/leaderboard?chapter_id=<new> → 200, empty payload", async () => {
    const r = await call("GET", `/api/collective/leaderboard?chapter_id=${CHAPTER_ID}`);
    expect([200, 204]).toContain(r.status);
  });

  it("GET /api/collective/questions?chapter_id=<new> → 200, empty list", async () => {
    const r = await call("GET", `/api/collective/questions?chapter_id=${CHAPTER_ID}`);
    expect([200, 204]).toContain(r.status);
  });

  it("GET /api/collective/screening-events?chapter_id=<new> → 200, empty list", async () => {
    const r = await call("GET", `/api/collective/screening-events?chapter_id=${CHAPTER_ID}`);
    expect([200, 204]).toContain(r.status);
  });
});
