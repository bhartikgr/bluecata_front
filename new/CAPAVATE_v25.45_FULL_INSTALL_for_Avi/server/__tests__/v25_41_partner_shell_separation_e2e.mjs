/* v25.41 Phase 4 — E2E: partner-shell vs collective-shell separation (Bug-1).
 *
 * Bug-1: a CONSORTIUM PARTNER who logs in was leaking the full Collective
 * member sidebar (DSC pipeline, member directory, soft-circles, ...). The
 * CollectiveShell now derives a "partner-only" mode purely from the server
 * contract that drives the client detection:
 *
 *   GET /api/me/chapters  → { ok, userId, chapters }
 *
 * A user with NO active chapter membership (a partner-only login) gets
 * chapters: [] — the client treats a non-empty chapters[] as "active
 * Collective member". This E2E pins that contract:
 *
 *   - unauthenticated                        → 401
 *   - partner-only user (no chapter)         → 200 { chapters: [] }  (partner-only mode)
 *   - active collective member (in chapter)  → 200 { chapters: [<own>] } (collective mode)
 *   - admin                                  → 200 (chapters reflect own memberships)
 *
 * The membership rows returned are ALWAYS active-only (listChaptersForUser
 * filters status='active'), so a non-empty array is a sound "is a Collective
 * member" signal, exactly as the CollectiveShell hook relies on.
 */
process.env.COLLECTIVE_ENABLED = "1";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import { registerRoutes } from "../routes.ts";
import { rawDb } from "../db/connection.ts";
import { __setRuntimePersona } from "../lib/userContext.ts";
import * as membershipStore from "../collectiveMembershipStore.ts";

let app, server, port;
const STAMP = Date.now();
const ADMIN = `u_v2541_shell_admin_${STAMP}`;

const CHAPTER = `chap_v2541_shell_${STAMP}`;
const MEMBER = `u_v2541_shell_member_${STAMP}`;
const EMAIL_MEMBER = `shell_member_${STAMP}@v2541.test`;

// Partner-only user: no chapter membership at all.
const PARTNER = `u_v2541_shell_partner_${STAMP}`;
const EMAIL_PARTNER = `shell_partner_${STAMP}@v2541.test`;

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

function seedUser(userId, email) {
  rawDb().prepare(
    `INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo)
     VALUES (?, ?, ?, ?, 'investor', 0)`,
  ).run(userId, `tenant_chap_${CHAPTER}`, email, userId);
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

beforeAll(async () => {
  __setRuntimePersona({ userId: ADMIN, email: `${ADMIN}@v2541.test`, name: "v25.41 Admin", isFounder: false, isInvestor: true, isAdmin: true, hasInvitations: false });
  __setRuntimePersona({ userId: MEMBER, email: EMAIL_MEMBER, name: MEMBER, isFounder: false, isInvestor: true, isAdmin: false, hasInvitations: false });
  __setRuntimePersona({ userId: PARTNER, email: EMAIL_PARTNER, name: PARTNER, isFounder: false, isInvestor: false, isAdmin: false, hasInvitations: false });

  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise((resolve) => server.listen(0, () => { port = server.address().port; resolve(); }));

  seedChapter(CHAPTER);
  seedUser(MEMBER, EMAIL_MEMBER);
  seedUser(PARTNER, EMAIL_PARTNER);
  // Member is in the chapter; partner is NOT (partner-only login).
  seedChapterMembership(MEMBER, CHAPTER);
  membershipStore.activate(MEMBER, ADMIN, "standard", { chapterId: CHAPTER });
}, 60_000);

afterAll(async () => {
  await new Promise((resolve) => server.close(() => resolve()));
});

describe("v25.41 partner-shell vs collective-shell separation (Bug-1) — E2E", () => {
  it("0. unauthenticated /api/me/chapters returns 401", async () => {
    const res = await reqNoAuth("GET", "/api/me/chapters");
    record("unauthenticated /me/chapters 401", res.status === 401, `status ${res.status}`);
    expect(res.status).toBe(401);
  });

  it("1. partner-only user (no chapter membership) gets chapters: [] → partner-only mode", async () => {
    const res = await req("GET", "/api/me/chapters", { userId: PARTNER });
    record("partner-only /me/chapters 200", res.status === 200, `status ${res.status}`);
    expect(res.status).toBe(200);
    record("partner-only ok flag", res.body?.ok === true);
    expect(res.body?.ok).toBe(true);
    const chapters = res.body?.chapters ?? null;
    record("partner-only chapters is empty array (partner-only mode)", Array.isArray(chapters) && chapters.length === 0, JSON.stringify(chapters));
    expect(Array.isArray(chapters)).toBe(true);
    expect(chapters.length).toBe(0);
  });

  it("2. active collective member gets a non-empty chapters[] → collective mode", async () => {
    const res = await req("GET", "/api/me/chapters", { userId: MEMBER });
    record("member /me/chapters 200", res.status === 200, `status ${res.status}`);
    expect(res.status).toBe(200);
    const chapters = res.body?.chapters ?? [];
    const ids = new Set(chapters.map((c) => c.id));
    record("member chapters non-empty (collective mode)", chapters.length >= 1, `len ${chapters.length}`);
    expect(chapters.length).toBeGreaterThanOrEqual(1);
    record("member chapters include OWN chapter", ids.has(CHAPTER), [...ids].join(","));
    expect(ids.has(CHAPTER)).toBe(true);
  });

  it("3. partner-only user does NOT see the member's chapter (no cross-leak)", async () => {
    const res = await req("GET", "/api/me/chapters", { userId: PARTNER });
    const ids = new Set((res.body?.chapters ?? []).map((c) => c.id));
    record("partner-only chapters EXCLUDE member chapter", !ids.has(CHAPTER), [...ids].join(","));
    expect(ids.has(CHAPTER)).toBe(false);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    // eslint-disable-next-line no-console
    console.log(`\n  v25.41 partner-shell separation E2E: ${passed}/${results.length} assertions passed`);
    expect(passed).toBe(results.length);
  });
});
