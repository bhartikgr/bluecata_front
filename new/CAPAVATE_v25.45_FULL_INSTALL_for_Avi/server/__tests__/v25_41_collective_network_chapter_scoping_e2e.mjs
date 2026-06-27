/* v25.41 Phase 4 — E2E: collective network graph chapter-scoping + opaque ids (Q2).
 *
 * Q2 (Avi answer = A): GET /api/collective/network is now chapter-scoped like
 * the v25.36 sweep, AND investor node IDs are opaque sha256-derived hashes
 * (m_<12hex>), never the raw investor name. Display names live only in the
 * `label` field. Founder/company nodes use the companyId.
 *
 * Contract pinned here:
 *   - member_a (chapter_a) sees COMPANY_A founder node, NOT COMPANY_B's (scope)
 *   - member_b (chapter_b) sees COMPANY_B founder node, NOT COMPANY_A's (scope)
 *   - admin sees BOTH companies (admins are NOT chapter-scoped)
 *   - every member node id matches /^m_[0-9a-f]{12}$/ (opaque, NOT a raw name)
 *   - unauthenticated → 401 (requireCollectiveMember upstream)
 */
process.env.COLLECTIVE_ENABLED = "1";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import { registerRoutes } from "../routes.ts";
import { rawDb } from "../db/connection.ts";
import { __setRuntimePersona } from "../lib/userContext.ts";
import * as membershipStore from "../collectiveMembershipStore.ts";
import { updateCompanyProfile } from "../companyProfileStore.ts";
import { upsertDirectoryListing } from "../collectiveInterestStore.ts";

let app, server, port;
const STAMP = Date.now();
const ADMIN = `u_v2541_net_admin_${STAMP}`;

const CHAPTER_A = `chap_v2541_net_a_${STAMP}`;
const MEMBER_A = `u_v2541_net_member_a_${STAMP}`;
const COMPANY_A = `co_v2541_net_a_${STAMP}`;
const EMAIL_A = `net_member_a_${STAMP}@v2541.test`;

const CHAPTER_B = `chap_v2541_net_b_${STAMP}`;
const MEMBER_B = `u_v2541_net_member_b_${STAMP}`;
const COMPANY_B = `co_v2541_net_b_${STAMP}`;
const EMAIL_B = `net_member_b_${STAMP}@v2541.test`;

const results = [];
function record(name, pass, extra = "") {
  results.push({ name, pass });
  // eslint-disable-next-line no-console
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${extra ? " - " + extra : ""}`);
}

function req(method, path, { body, userId } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { "Content-Type": "application/json", "x-user-id": userId ?? ADMIN };
    const payload = body ? JSON.stringify(body) : undefined;
    if (payload) headers["Content-Length"] = Buffer.byteLength(payload);
    const r = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        let parsed = buf;
        try { parsed = JSON.parse(buf); } catch { /* raw */ }
        resolve({ status: res.statusCode ?? 0, body: parsed });
      });
    });
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

function reqNoAuth(method, path) {
  return new Promise((resolve, reject) => {
    const prev = process.env.DISABLE_DEV_BYPASS;
    process.env.DISABLE_DEV_BYPASS = "1";
    const headers = { "Content-Type": "application/json" };
    const r = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        if (prev === undefined) delete process.env.DISABLE_DEV_BYPASS;
        else process.env.DISABLE_DEV_BYPASS = prev;
        let parsed = buf;
        try { parsed = JSON.parse(buf); } catch { /* raw */ }
        resolve({ status: res.statusCode ?? 0, body: parsed });
      });
    });
    r.on("error", (e) => {
      if (prev === undefined) delete process.env.DISABLE_DEV_BYPASS;
      else process.env.DISABLE_DEV_BYPASS = prev;
      reject(e);
    });
    r.end();
  });
}

function seedUser(userId, email, chapterId) {
  rawDb().prepare(
    `INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo)
     VALUES (?, ?, ?, ?, 'investor', 0)`,
  ).run(userId, `tenant_chap_${chapterId}`, email, userId);
}
function seedChapter(chapterId) {
  const now = new Date().toISOString();
  rawDb().prepare(
    `INSERT OR IGNORE INTO chapters
       (id, tenant_id, name, region, city, status, dsc_quorum_pct, created_at)
     VALUES (?, ?, ?, 'NA', 'Toronto', 'active', 50, ?)`,
  ).run(chapterId, `tenant_chap_${chapterId}`, `Chapter ${chapterId}`, now);
}
function seedChapterMembership(userId, chapterId) {
  const now = new Date().toISOString();
  rawDb().prepare(
    `INSERT OR IGNORE INTO chapter_memberships
       (id, tenant_id, chapter_id, user_id, role, status, joined_at, created_at)
     VALUES (?, ?, ?, ?, 'member', 'active', ?, ?)`,
  ).run(`cm_${userId}_${chapterId}`, `tenant_chap_${chapterId}`, chapterId, userId, now, now);
}
function seedListing(companyId, chapterId) {
  upsertDirectoryListing(companyId, `app_${companyId}`, { chapter: chapterId, stage: "Seed", sector: "SaaS" });
}
function seedProfile(companyId, founderName) {
  updateCompanyProfile(companyId, { founderName, sector: "SaaS", stage: "Seed", transactionPrepStatus: "active", ipDdReadinessPct: 50, dataRoomOrganizedPct: 40 }, ADMIN);
}

beforeAll(async () => {
  __setRuntimePersona({ userId: ADMIN, email: `${ADMIN}@v2541.test`, name: "v25.41 Net Admin", isFounder: false, isInvestor: true, isAdmin: true, hasInvitations: false });
  __setRuntimePersona({ userId: MEMBER_A, email: EMAIL_A, name: MEMBER_A, isFounder: false, isInvestor: true, isAdmin: false, hasInvitations: false });
  __setRuntimePersona({ userId: MEMBER_B, email: EMAIL_B, name: MEMBER_B, isFounder: false, isInvestor: true, isAdmin: false, hasInvitations: false });

  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise((resolve) => server.listen(0, () => { port = server.address().port; resolve(); }));

  seedChapter(CHAPTER_A);
  seedChapter(CHAPTER_B);
  seedUser(MEMBER_A, EMAIL_A, CHAPTER_A);
  seedUser(MEMBER_B, EMAIL_B, CHAPTER_B);
  seedChapterMembership(MEMBER_A, CHAPTER_A);
  seedChapterMembership(MEMBER_B, CHAPTER_B);
  membershipStore.activate(MEMBER_A, ADMIN, "standard", { chapterId: CHAPTER_A });
  membershipStore.activate(MEMBER_B, ADMIN, "standard", { chapterId: CHAPTER_B });

  seedProfile(COMPANY_A, `Net Founder A ${STAMP}`);
  seedProfile(COMPANY_B, `Net Founder B ${STAMP}`);
  seedListing(COMPANY_A, CHAPTER_A);
  seedListing(COMPANY_B, CHAPTER_B);
}, 60_000);

afterAll(async () => {
  await new Promise((resolve) => server.close(() => resolve()));
});

describe("v25.41 collective network chapter-scoping + opaque ids (Q2) — E2E", () => {
  it("0. unauthenticated /network → 401", async () => {
    const res = await reqNoAuth("GET", "/api/collective/network");
    record("unauthenticated /network 401", res.status === 401, `status ${res.status}`);
    expect(res.status).toBe(401);
  });

  it("1. member_a network includes COMPANY_A founder node, EXCLUDES COMPANY_B", async () => {
    const a = await req("GET", "/api/collective/network", { userId: MEMBER_A });
    record("member_a /network 200", a.status === 200, `status ${a.status}`);
    expect(a.status).toBe(200);
    const founderIds = new Set((a.body?.nodes ?? []).filter((n) => n.type === "founder").map((n) => n.id));
    record("member_a network includes COMPANY_A", founderIds.has(COMPANY_A), [...founderIds].join(","));
    expect(founderIds.has(COMPANY_A)).toBe(true);
    record("member_a network EXCLUDES COMPANY_B (no leak)", !founderIds.has(COMPANY_B));
    expect(founderIds.has(COMPANY_B)).toBe(false);
  });

  it("2. member_b network includes COMPANY_B founder node, EXCLUDES COMPANY_A", async () => {
    const b = await req("GET", "/api/collective/network", { userId: MEMBER_B });
    const founderIds = new Set((b.body?.nodes ?? []).filter((n) => n.type === "founder").map((n) => n.id));
    record("member_b network includes COMPANY_B", founderIds.has(COMPANY_B), [...founderIds].join(","));
    expect(founderIds.has(COMPANY_B)).toBe(true);
    record("member_b network EXCLUDES COMPANY_A (no leak)", !founderIds.has(COMPANY_A));
    expect(founderIds.has(COMPANY_A)).toBe(false);
  });

  it("3. admin network includes BOTH companies (admins not scoped)", async () => {
    const adm = await req("GET", "/api/collective/network", { userId: ADMIN });
    const founderIds = new Set((adm.body?.nodes ?? []).filter((n) => n.type === "founder").map((n) => n.id));
    record("admin network includes BOTH companies", founderIds.has(COMPANY_A) && founderIds.has(COMPANY_B));
    expect(founderIds.has(COMPANY_A) && founderIds.has(COMPANY_B)).toBe(true);
  });

  it("4. every member node id is an opaque m_<12hex> hash, never a raw name", async () => {
    const adm = await req("GET", "/api/collective/network", { userId: ADMIN });
    const memberNodes = (adm.body?.nodes ?? []).filter((n) => n.type === "member");
    record("at least one member node present", memberNodes.length >= 1, `count ${memberNodes.length}`);
    expect(memberNodes.length).toBeGreaterThanOrEqual(1);
    const opaque = /^m_[0-9a-f]{12}$/;
    const allOpaque = memberNodes.every((n) => opaque.test(n.id));
    record("all member node ids match /^m_[0-9a-f]{12}$/", allOpaque, memberNodes.map((n) => n.id).slice(0, 4).join(","));
    expect(allOpaque).toBe(true);
    // The opaque id must NOT equal the user id / name carried in the label.
    const noRawId = memberNodes.every((n) => n.id !== n.label);
    record("member node id is NOT the raw label", noRawId);
    expect(noRawId).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    // eslint-disable-next-line no-console
    console.log(`\n  v25.41 collective network scoping E2E: ${passed}/${results.length} assertions passed`);
    expect(passed).toBe(results.length);
  });
});
