/* v25.45 ROUND 2 (BLOCKER 3) — GET /api/collective/members routes display
 * names through the privacy resolver.
 *
 * GPT-5.5 + Gemini + Opus all flagged that the chapter member directory
 * returned raw legal/display names and never called resolveDisplayName(). This
 * test seeds two member contacts, opts ONE of them out of the Collective
 * directory (visibleInCollectiveDirectory:false), and asserts the endpoint
 * renders that member as "Private Investor" while the opted-in member keeps their
 * real name.
 *
 * v25.45 ROUND 3 (F13 privacy-leak fix): a member with NO saved privacy row now
 * defaults to opt-out and renders as "Private Investor" too. The resolver's
 * DEFAULT_PREFS sets visibleInCollectiveDirectory:false, so directory
 * visibility is opt-IN only; the prior no-row legacy-name bypass leaked raw
 * display names and has been removed from collectiveRoutes.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import { registerRoutes } from "../routes.ts";
import { rawDb } from "../db/connection.ts";
import { __setRuntimePersona } from "../lib/userContext.ts";
import * as membershipStore from "../collectiveMembershipStore.ts";
import { createContact } from "../adminContactsStore.ts";
import { writeUserPrivacy } from "../lib/userPrivacyResolver.ts";

let app, server, port;
const STAMP = Date.now();
const ADMIN = `u_r2priv_admin_${STAMP}`;
const CHAPTER = `chap_r2priv_${STAMP}`;
const MEMBER_PRIVATE = `u_r2priv_private_${STAMP}`;
const MEMBER_PUBLIC = `u_r2priv_public_${STAMP}`;
const MEMBER_LEGACY = `u_r2priv_legacy_${STAMP}`;
const EMAIL_PRIVATE = `private_${STAMP}@r2priv.test`;
const EMAIL_PUBLIC = `public_${STAMP}@r2priv.test`;
const EMAIL_LEGACY = `legacy_${STAMP}@r2priv.test`;
const NAME_PRIVATE = `Private Investor ${STAMP}`;
const NAME_PUBLIC = `Public Investor ${STAMP}`;
const NAME_LEGACY = `Legacy Investor ${STAMP}`;

function req(method, path, { body, userId } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { "Content-Type": "application/json", "x-user-id": userId ?? ADMIN };
    const payload = body ? JSON.stringify(body) : undefined;
    if (payload) headers["Content-Length"] = Buffer.byteLength(payload);
    const r = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      let buf = ""; res.on("data", (c) => (buf += c));
      res.on("end", () => { let p = buf; try { p = JSON.parse(buf); } catch {} resolve({ status: res.statusCode ?? 0, body: p }); });
    });
    r.on("error", reject); if (payload) r.write(payload); r.end();
  });
}

function seedUser(userId, email) {
  rawDb().prepare(
    `INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo) VALUES (?, ?, ?, ?, 'investor', 0)`,
  ).run(userId, `tenant_${CHAPTER}`, email, userId);
}

beforeAll(async () => {
  __setRuntimePersona({ userId: ADMIN, email: `${ADMIN}@r2priv.test`, name: "Admin", isFounder: false, isInvestor: true, isAdmin: true, hasInvitations: false });
  app = express(); app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise((r) => server.listen(0, () => { port = server.address().port; r(); }));

  seedUser(MEMBER_PRIVATE, EMAIL_PRIVATE);
  seedUser(MEMBER_PUBLIC, EMAIL_PUBLIC);
  seedUser(MEMBER_LEGACY, EMAIL_LEGACY);
  membershipStore.activate(ADMIN, ADMIN, "standard", { chapterId: CHAPTER });

  // Contacts keyed by the members' emails so the directory can resolve them.
  createContact({ kind: "investor", type: "individual", legalName: NAME_PRIVATE, displayName: NAME_PRIVATE, email: EMAIL_PRIVATE, status: "active", region: "NA", hqCountry: "CA", industries: [], stages: [], tags: [] }, ADMIN);
  createContact({ kind: "investor", type: "individual", legalName: NAME_PUBLIC, displayName: NAME_PUBLIC, email: EMAIL_PUBLIC, status: "active", region: "NA", hqCountry: "CA", industries: [], stages: [], tags: [] }, ADMIN);
  createContact({ kind: "investor", type: "individual", legalName: NAME_LEGACY, displayName: NAME_LEGACY, email: EMAIL_LEGACY, status: "active", region: "NA", hqCountry: "CA", industries: [], stages: [], tags: [] }, ADMIN);

  // Privacy rows: PRIVATE opts out of the directory; PUBLIC opts in; LEGACY has
  // NO row at all (must keep its legacy name).
  writeUserPrivacy(MEMBER_PRIVATE, { screenName: "", visibleToCoMembers: true, visibleInCollectiveDirectory: false });
  writeUserPrivacy(MEMBER_PUBLIC, { screenName: NAME_PUBLIC, visibleToCoMembers: true, visibleInCollectiveDirectory: true });
}, 60_000);

afterAll(async () => { await new Promise((r) => server.close(() => r())); });

describe("v25.45 R2 — collective members privacy resolver", () => {
  it("opted-out member renders as 'Private Investor', not the raw legal name", async () => {
    const res = await req("GET", "/api/collective/members", { userId: ADMIN });
    const names = (res.body?.members ?? []).map((m) => m.displayName);
    const hasPrivate = names.includes("Private Investor");
    const leaksReal = names.includes(NAME_PRIVATE);
    expect(res.status).toBe(200);
    expect(hasPrivate).toBe(true);
    expect(leaksReal).toBe(false);
  });

  it("opted-in member keeps their (screen) name", async () => {
    const res = await req("GET", "/api/collective/members", { userId: ADMIN });
    const names = (res.body?.members ?? []).map((m) => m.displayName);
    expect(names.includes(NAME_PUBLIC)).toBe(true);
  });

  it("member with NO privacy row defaults to opt-out ('Private Investor', no raw-name leak)", async () => {
    const res = await req("GET", "/api/collective/members", { userId: ADMIN });
    const names = (res.body?.members ?? []).map((m) => m.displayName);
    // v25.45 ROUND 3: no-row members default to private (opt-in required).
    expect(res.status).toBe(200);
    expect(names.includes(NAME_LEGACY)).toBe(false); // raw name must NOT leak
    expect(names.includes("Private Investor")).toBe(true);
  });

  it("private member's initials are derived from the masked name (no PII leak)", async () => {
    const res = await req("GET", "/api/collective/members", { userId: ADMIN });
    const priv = (res.body?.members ?? []).find((m) => m.displayName === "Private Investor");
    expect(priv).toBeTruthy();
    // "Private Investor" → "PI"; must NOT carry initials of the real legal name.
    expect(priv.initials).toBe("PI");
  });
});
