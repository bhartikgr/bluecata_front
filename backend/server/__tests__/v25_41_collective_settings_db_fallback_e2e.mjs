/* v25.41 Phase 4 — E2E: collective settings recovered from DB (Q4, Avi=B).
 *
 * Q4 (Avi answer = B): getOrCreateSettings() is now DB-FIRST. The boot hydrator
 * only restores rows that existed at startup; a settings row written after this
 * process booted (or by another process) would previously be silently RE-MINTED
 * to defaults on a cold in-memory cache, forking the hash chain. Per Avi's
 * unifying directive ("nothing in memory; everything fetched from the record
 * table"), getOrCreateSettings now queries the durable collective_settings
 * table first and hydrates from it before minting a default.
 *
 * Contract pinned here:
 *   1. A member PATCHes a non-default setting → persisted to DB (200)
 *   2. The in-memory settings map is cleared (__clearCollectiveSettings) to
 *      simulate a cold cache / fresh process
 *   3. A subsequent GET RECOVERS the persisted value from the DB — it is NOT
 *      re-minted to the default, and the version/hash carry forward
 *   - unauthenticated GET → 401
 */
process.env.COLLECTIVE_ENABLED = "1";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import { registerRoutes } from "../routes.ts";
import { rawDb } from "../db/connection.ts";
import { __setRuntimePersona } from "../lib/userContext.ts";
import * as membershipStore from "../collectiveMembershipStore.ts";
import { upsertActiveMembership } from "../membershipStore.ts";
import { __clearCollectiveSettings } from "../collectiveSettingsStore.ts";

let app, server, port;
const STAMP = Date.now();
const ADMIN = `u_v2541_set_admin_${STAMP}`;
const CHAPTER = `chap_v2541_set_${STAMP}`;
const MEMBER = `u_v2541_set_member_${STAMP}`;
const EMAIL = `set_member_${STAMP}@v2541.test`;

// Default anonymityLevel is NOT "private"; we PATCH to "private" so the
// recovered value is provably distinct from a freshly-minted default.
const NON_DEFAULT = { anonymityLevel: "private", notifyOnDscScore: false };

const results = [];
function record(name, pass, extra = "") {
  results.push({ name, pass });
  // eslint-disable-next-line no-console
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${extra ? " - " + extra : ""}`);
}

function req(method, path, { body, userId, confirm } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { "Content-Type": "application/json", "x-user-id": userId ?? MEMBER };
    if (confirm) headers["x-confirm"] = "true";
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
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
  __setRuntimePersona({ userId: ADMIN, email: `${ADMIN}@v2541.test`, name: "v25.41 Set Admin", isFounder: false, isInvestor: false, isAdmin: true, hasInvitations: false });
  __setRuntimePersona({ userId: MEMBER, email: EMAIL, name: MEMBER, isFounder: false, isInvestor: true, isAdmin: false, hasInvitations: false });

  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise((resolve) => server.listen(0, () => { port = server.address().port; resolve(); }));

  seedChapter(CHAPTER);
  seedUser(MEMBER, EMAIL);
  seedChapterMembership(MEMBER, CHAPTER);
  membershipStore.activate(MEMBER, ADMIN, "standard", { chapterId: CHAPTER });
  // v25.41 round-2: the requireCollectiveMember middleware reads the LEGACY
  // membershipStore (server/membershipStore.ts) via getMembership() -> buildCollectiveOverlay.
  // The new collectiveMembershipStore.activate() alone is not visible to that
  // middleware. Mirror the activation into the legacy store so userContext.collective.status
  // === "active" for the test member.
  upsertActiveMembership(MEMBER);
}, 60_000);

afterAll(async () => {
  await new Promise((resolve) => server.close(() => resolve()));
});

describe("v25.41 collective settings DB fallback (Q4) — E2E", () => {
  it("0. unauthenticated GET /api/collective/settings/mine → 401", async () => {
    const res = await reqNoAuth("GET", "/api/collective/settings/mine");
    record("unauth settings 401", res.status === 401, `status ${res.status}`);
    expect(res.status).toBe(401);
  });

  it("1. member PATCHes a non-default setting → persisted (200)", async () => {
    const res = await req("PATCH", "/api/collective/settings/mine", { body: NON_DEFAULT, userId: MEMBER, confirm: true });
    record("PATCH settings 200", res.status === 200, `status ${res.status} ${JSON.stringify(res.body)?.slice(0,120)}`);
    expect(res.status).toBe(200);
    record("PATCH stored anonymityLevel=private", res.body?.anonymityLevel === "private", res.body?.anonymityLevel);
    expect(res.body?.anonymityLevel).toBe("private");
    record("PATCH version >= 2 (chained beyond mint)", (res.body?.version ?? 0) >= 2, `v ${res.body?.version}`);
    expect(res.body?.version).toBeGreaterThanOrEqual(2);
  });

  it("2. durable collective_settings row reflects the PATCH", () => {
    const row = rawDb().prepare(`SELECT anonymity_level, version FROM collective_settings WHERE user_id = ?`).get(MEMBER);
    record("DB row anonymity_level=private", row?.anonymity_level === "private", JSON.stringify(row));
    expect(row?.anonymity_level).toBe("private");
  });

  it("3. after clearing the in-memory cache, GET RECOVERS the value from DB (not re-minted)", async () => {
    // Capture the persisted version before the cold-cache simulation.
    const before = await req("GET", "/api/collective/settings/mine", { userId: MEMBER });
    const persistedVersion = before.body?.version;

    // Simulate a cold cache / fresh process: drop the in-memory settings map.
    __clearCollectiveSettings();

    const after = await req("GET", "/api/collective/settings/mine", { userId: MEMBER });
    record("post-clear GET 200", after.status === 200, `status ${after.status}`);
    expect(after.status).toBe(200);
    // The recovered value must be the persisted "private", NOT the default.
    record("recovered anonymityLevel=private (DB-first, NOT re-minted)", after.body?.anonymityLevel === "private", after.body?.anonymityLevel);
    expect(after.body?.anonymityLevel).toBe("private");
    record("recovered notifyOnDscScore=false (persisted)", after.body?.notifyOnDscScore === false, String(after.body?.notifyOnDscScore));
    expect(after.body?.notifyOnDscScore).toBe(false);
    // Version is carried forward from the DB row, NOT reset to a mint version.
    record("recovered version matches persisted (no chain fork)", after.body?.version === persistedVersion, `after ${after.body?.version} persisted ${persistedVersion}`);
    expect(after.body?.version).toBe(persistedVersion);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    // eslint-disable-next-line no-console
    console.log(`\n  v25.41 collective settings DB-fallback E2E: ${passed}/${results.length} assertions passed`);
    expect(passed).toBe(results.length);
  });
});
