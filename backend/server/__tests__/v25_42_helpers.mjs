/* v25.42 Phase 4 — shared E2E harness.
 *
 * Boots the real Express app (registerRoutes) on an ephemeral port, seeds a
 * collective member + admin persona + chapter, and exposes small request
 * helpers. Mirrors the pattern in v25_41_collective_settings_db_fallback_e2e.mjs.
 *
 * Each v25.42 surface test imports `setup()` and the `req`/`reqNoAuth` helpers
 * rather than duplicating the (heavy) boot logic 17 times.
 */
process.env.COLLECTIVE_ENABLED = "1";
import express from "express";
import http from "node:http";
import { registerRoutes } from "../routes.ts";
import { rawDb } from "../db/connection.ts";
import { __setRuntimePersona } from "../lib/userContext.ts";
import * as membershipStore from "../collectiveMembershipStore.ts";
import { upsertActiveMembership } from "../membershipStore.ts";

export function makeIds(tag) {
  const STAMP = Date.now() + "_" + Math.floor(Math.random() * 1e6);
  return {
    STAMP,
    ADMIN: `u_v2542_${tag}_admin_${STAMP}`,
    MEMBER: `u_v2542_${tag}_member_${STAMP}`,
    EMAIL: `${tag}_member_${STAMP}@v2542.test`,
    CHAPTER: `chap_v2542_${tag}_${STAMP}`,
  };
}

export function reqFactory(getPort, defaultUser) {
  return function req(method, path, { body, userId, confirm } = {}) {
    return new Promise((resolve, reject) => {
      const headers = { "Content-Type": "application/json", "x-user-id": userId ?? defaultUser() };
      if (confirm) headers["x-confirm"] = "true";
      const payload = body !== undefined ? JSON.stringify(body) : undefined;
      if (payload) headers["Content-Length"] = Buffer.byteLength(payload);
      const r = http.request(
        { hostname: "127.0.0.1", port: getPort(), path, method, headers },
        (res) => {
          let buf = "";
          res.on("data", (c) => (buf += c));
          res.on("end", () => {
            let parsed = buf;
            try { parsed = JSON.parse(buf); } catch { /* raw */ }
            resolve({ status: res.statusCode ?? 0, body: parsed });
          });
        },
      );
      r.on("error", reject);
      if (payload) r.write(payload);
      r.end();
    });
  };
}

export function reqNoAuthFactory(getPort) {
  return function reqNoAuth(method, path) {
    return new Promise((resolve, reject) => {
      const prev = process.env.DISABLE_DEV_BYPASS;
      process.env.DISABLE_DEV_BYPASS = "1";
      const headers = { "Content-Type": "application/json" };
      const r = http.request(
        { hostname: "127.0.0.1", port: getPort(), path, method, headers },
        (res) => {
          let buf = "";
          res.on("data", (c) => (buf += c));
          res.on("end", () => {
            if (prev === undefined) delete process.env.DISABLE_DEV_BYPASS;
            else process.env.DISABLE_DEV_BYPASS = prev;
            let parsed = buf;
            try { parsed = JSON.parse(buf); } catch { /* raw */ }
            resolve({ status: res.statusCode ?? 0, body: parsed });
          });
        },
      );
      r.on("error", (e) => {
        if (prev === undefined) delete process.env.DISABLE_DEV_BYPASS;
        else process.env.DISABLE_DEV_BYPASS = prev;
        reject(e);
      });
      r.end();
    });
  };
}

function seedUser(ids, userId, email) {
  rawDb().prepare(
    `INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo)
     VALUES (?, ?, ?, ?, 'investor', 0)`,
  ).run(userId, `tenant_chap_${ids.CHAPTER}`, email, userId);
}
function seedChapter(chapterId) {
  const now = new Date().toISOString();
  rawDb().prepare(
    `INSERT OR IGNORE INTO chapters
       (id, tenant_id, name, region, city, status, dsc_quorum_pct, created_at)
     VALUES (?, ?, ?, 'NA', 'Toronto', 'active', 50, ?)`,
  ).run(chapterId, `tenant_chap_${chapterId}`, `Chapter ${chapterId}`, now);
}
function seedChapterMembership(chapterId, userId) {
  const now = new Date().toISOString();
  rawDb().prepare(
    `INSERT OR IGNORE INTO chapter_memberships
       (id, tenant_id, chapter_id, user_id, role, status, joined_at, created_at)
     VALUES (?, ?, ?, ?, 'member', 'active', ?, ?)`,
  ).run(`cm_${userId}_${chapterId}`, `tenant_chap_${chapterId}`, chapterId, userId, now, now);
}

/** Seed an active partner_organizations row (for partners/public tests).
 *
 * v25.42 round-2 — supports optional `tenantId` + `primaryChapterId` so tests
 * can seed partners into DIFFERENT chapters/tenants and assert the chapter-
 * scoped read on /api/collective/partners/public. When `primaryChapterId` is
 * omitted the row is chapter-agnostic (NULL) and visible to all members. */
export function seedPartnerOrg(ids, { id, name, jurisdiction = "Singapore", partnerType = "fund", aumRange = "50m-250m", status = "active", tenantId, primaryChapterId = null }) {
  const now = new Date().toISOString();
  const tid = tenantId ?? `tenant_chap_${ids.CHAPTER}`;
  rawDb().prepare(
    `INSERT OR IGNORE INTO partner_organizations
       (id, tenant_id, name, jurisdiction, partner_type, aum_range, status, primary_chapter_id, onboarding_state, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)`,
  ).run(id, tid, name, jurisdiction, partnerType, aumRange, status, primaryChapterId, now, now);
}

/**
 * Boot the app + seed personas/chapter. Returns { app, server, getPort,
 * req, reqNoAuth, ids }. Call in beforeAll; call teardown() in afterAll.
 */
export async function setup(tag) {
  const ids = makeIds(tag);
  __setRuntimePersona({ userId: ids.ADMIN, email: `${ids.ADMIN}@v2542.test`, name: "v25.42 Admin", isFounder: false, isInvestor: false, isAdmin: true, hasInvitations: false });
  __setRuntimePersona({ userId: ids.MEMBER, email: ids.EMAIL, name: ids.MEMBER, isFounder: false, isInvestor: true, isAdmin: false, hasInvitations: false });

  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
  let port;
  await new Promise((resolve) => server.listen(0, () => { port = server.address().port; resolve(); }));
  const getPort = () => port;

  seedChapter(ids.CHAPTER);
  seedUser(ids, ids.MEMBER, ids.EMAIL);
  seedChapterMembership(ids.CHAPTER, ids.MEMBER);
  membershipStore.activate(ids.MEMBER, ids.ADMIN, "standard", { chapterId: ids.CHAPTER });
  upsertActiveMembership(ids.MEMBER);

  const req = reqFactory(getPort, () => ids.MEMBER);
  const reqNoAuth = reqNoAuthFactory(getPort);
  const teardown = () => new Promise((resolve) => server.close(() => resolve()));
  return { app, server, getPort, req, reqNoAuth, ids, teardown };
}

export function recorder() {
  const results = [];
  function record(name, pass, extra = "") {
    results.push({ name, pass });
    // eslint-disable-next-line no-console
    console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${extra ? " - " + extra : ""}`);
  }
  return { results, record };
}
