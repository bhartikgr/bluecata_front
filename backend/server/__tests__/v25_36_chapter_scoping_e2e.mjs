/* v25.36 Phase 5 — E2E: cross-chapter scoping isolation sweep.
 *
 * Proves the 7 leak sites fixed in v25.36/collectiveRoutes.ts no longer return
 * platform-wide data to a chapter-scoped member. For every endpoint we assert
 * the canonical chapter-scoping contract:
 *
 *   - member_a (in chapter_a) sees ONLY chapter_a's listed companies / members
 *   - member_b (in chapter_b) sees ONLY chapter_b's listed companies / members
 *   - admin sees BOTH chapters (admins are NOT chapter-scoped)
 *   - an empty-chapter member sees [] / counts of 0 (NOT a 403)
 *   - an unauthenticated caller gets 401 (requireCollectiveMember upstream)
 *
 * Endpoints covered (per /tmp/v25_36_brief.md Phase 5):
 *   1. GET /api/collective/dashboard            — member roster + DSC depth KPIs
 *   2. GET /api/collective/dsc/pipeline         — kanban profiles
 *   3. GET /api/collective/dsc/scores           — composite table
 *   4. GET /api/collective/dsc/composite/:id    — 404 for a foreign-chapter company
 *   5. GET /api/collective/dsc/prep             — transaction-prep channels
 *   6. GET /api/collective/dealroom/companies   — partner promotion NOT leaked
 *   7. GET /api/collective/members              — member directory
 *   8. GET /api/collective/soft-circles         — soft-circle aggregates
 *
 * Everything runs against the live SQLite DB via rawDb() and the in-memory
 * stores, with the express app booted exactly as the live server boots it
 * (registerRoutes), matching the v25.34 / v25.35 E2E harness. No dev-only
 * code paths beyond the Vitest-gated x-user-id identity the harness already
 * relies on.
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
import { createContact } from "../adminContactsStore.ts";
import { createChannel } from "../transactionPrepStore.ts";
import { createSoftCircle } from "../softCircleStore.ts";
import { _testPartnerStore } from "../partnerWorkspaceStore.ts";

let app, server, port;
const STAMP = Date.now();
const ADMIN = `u_v2536_admin_${STAMP}`;

// Chapter A actors / objects.
const CHAPTER_A = `chap_v2536_a_${STAMP}`;
const MEMBER_A = `u_v2536_member_a_${STAMP}`;
const COMPANY_A = `co_v2536_a_${STAMP}`;
const EMAIL_A = `member_a_${STAMP}@v2536.test`;

// Chapter B actors / objects.
const CHAPTER_B = `chap_v2536_b_${STAMP}`;
const MEMBER_B = `u_v2536_member_b_${STAMP}`;
const COMPANY_B = `co_v2536_b_${STAMP}`;
const EMAIL_B = `member_b_${STAMP}@v2536.test`;

// An active member who belongs to NO chapter (empty-chapter caller).
const MEMBER_EMPTY = `u_v2536_member_empty_${STAMP}`;

// Round ids used to attribute soft circles to a company (the route groups by
// roundId but attributes the chapter via the circle's own companyId).
const ROUND_A = `rnd_v2536_a_${STAMP}`;
const ROUND_B = `rnd_v2536_b_${STAMP}`;

const results = [];
function record(name, pass, extra = "") {
  results.push({ name, pass });
  // eslint-disable-next-line no-console
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${extra ? " — " + extra : ""}`);
}

/** HTTP request with an explicit x-user-id (defaults to ADMIN). */
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

/** HTTP request with NO identity header, with the dev-bypass disabled so the
 * sandbox demo-persona fallback does NOT authenticate. Proves the 401 path. */
function reqNoAuth(method, path) {
  return new Promise((resolve, reject) => {
    const prev = process.env.DISABLE_DEV_BYPASS;
    process.env.DISABLE_DEV_BYPASS = "1"; // turn off the sandbox demo fallback
    const headers = { "Content-Type": "application/json" }; // NO x-user-id
    const r = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        // Restore the bypass flag once the request has been fully served.
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

function asAdmin() {
  __setRuntimePersona({ userId: ADMIN, email: `${ADMIN}@v2536.test`, name: "v25.36 Admin", isFounder: false, isInvestor: true, isAdmin: true, hasInvitations: false });
}

/** Register a member persona (NOT admin) so getUserContext resolves them as a
 * chapter-scoped caller, and seed the durable rows the scoping reads. */
function asMember(userId, email) {
  __setRuntimePersona({ userId, email, name: userId, isFounder: false, isInvestor: true, isAdmin: false, hasInvitations: false });
}

/** Insert a row into the users table (contact-email → user → chapter linkage). */
function seedUser(userId, email) {
  const db = rawDb();
  db.prepare(
    `INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo)
     VALUES (?, ?, ?, ?, 'investor', 0)`,
  ).run(userId, `tenant_chap_${CHAPTER_A}`, email, userId);
}

/** Insert a chapters row (listChaptersForUser drops dangling memberships). */
function seedChapter(chapterId) {
  const now = new Date().toISOString();
  rawDb().prepare(
    `INSERT OR IGNORE INTO chapters
       (id, tenant_id, name, region, city, status, dsc_quorum_pct, created_at)
     VALUES (?, ?, ?, 'NA', 'Toronto', 'active', 50, ?)`,
  ).run(chapterId, `tenant_chap_${chapterId}`, `Chapter ${chapterId}`, now);
}

/** Insert a chapter_memberships row so listChaptersForUser(userId) returns it. */
function seedChapterMembership(userId, chapterId) {
  const now = new Date().toISOString();
  rawDb().prepare(
    `INSERT OR IGNORE INTO chapter_memberships
       (id, tenant_id, chapter_id, user_id, role, status, joined_at, created_at)
     VALUES (?, ?, ?, ?, 'member', 'active', ?, ?)`,
  ).run(`cm_${userId}_${chapterId}`, `tenant_chap_${chapterId}`, chapterId, userId, now, now);
}

/** Seed a directory listing so the company is "listed" in a chapter (drives
 * getListedCompanyIdsForChapters → listedIds for that chapter's members). */
function seedListing(companyId, chapterId) {
  upsertDirectoryListing(companyId, `app_${companyId}`, { chapter: chapterId, stage: "Seed", sector: "SaaS" });
}

/** Seed a company profile with an 'active' transaction-prep status so it shows
 * up in the pipeline / dealroom / scores aggregates. */
function seedProfile(companyId, founderName) {
  updateCompanyProfile(
    companyId,
    {
      founderName,
      sector: "SaaS",
      stage: "Seed",
      transactionPrepStatus: "active",
      ipDdReadinessPct: 50,
      dataRoomOrganizedPct: 40,
    },
    ADMIN,
  );
}

/** Push a fully-formed, live + approved collective-deal-room promotion straight
 * into the in-memory promotions table (mirrors create()+approve() output). The
 * listLiveCollectivePromotions filter requires status==='live',
 * moderationStatus==='approved', and an 'active' owning partner (the default
 * fallback is 'active' when the contact lookup misses). */
function seedLivePromotion(companyId, chapterId) {
  const now = new Date().toISOString();
  _testPartnerStore.raw.dealPromotions.push({
    id: `ppromo_v2536_${companyId}`,
    partnerId: `ac_consortium_partner_v2536_${chapterId}`,
    pipelineDealId: `pd_${companyId}`,
    promotionType: "collective_deal_room",
    companyId,
    targetEmail: null,
    status: "live",
    promotedBy: ADMIN,
    promotedAt: now,
    approvedAt: now,
    approvedBy: ADMIN,
    rejectedAt: null,
    rejectedBy: null,
    rejectedReason: null,
    withdrawnAt: null,
    withdrawnBy: null,
    notes: null,
    version: 2,
    prevRevisionHash: "0".repeat(64),
    revisionHash: "deadbeef",
    updatedAt: now,
    updatedBy: ADMIN,
    isSeed: false,
    moderationStatus: "approved",
    moderatedByUserId: ADMIN,
    moderatedAt: now,
    moderationNotes: null,
    chapterId,
  });
}

beforeAll(async () => {
  asAdmin();
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise((resolve) => server.listen(0, () => { port = server.address().port; resolve(); }));

  // ── Seed chapters ──────────────────────────────────────────────
  seedChapter(CHAPTER_A);
  seedChapter(CHAPTER_B);

  // ── Seed users + chapter memberships (for /members email linkage + scope) ─
  seedUser(MEMBER_A, EMAIL_A);
  seedUser(MEMBER_B, EMAIL_B);
  seedChapterMembership(MEMBER_A, CHAPTER_A);
  seedChapterMembership(MEMBER_B, CHAPTER_B);
  // MEMBER_EMPTY: user row only, NO chapter membership → empty-chapter caller.
  seedUser(MEMBER_EMPTY, `member_empty_${STAMP}@v2536.test`);

  // ── Make all three active Collective members so requireCollectiveMember passes ─
  membershipStore.activate(MEMBER_A, ADMIN, "standard", { chapterId: CHAPTER_A });
  membershipStore.activate(MEMBER_B, ADMIN, "standard", { chapterId: CHAPTER_B });
  membershipStore.activate(MEMBER_EMPTY, ADMIN, "standard", { chapterId: CHAPTER_A });

  // ── Seed personas ──────────────────────────────────────────────
  asMember(MEMBER_A, EMAIL_A);
  asMember(MEMBER_B, EMAIL_B);
  asMember(MEMBER_EMPTY, `member_empty_${STAMP}@v2536.test`);
  asAdmin(); // leave admin as the active default persona

  // ── Seed company profiles ──────────────────────────────────────
  seedProfile(COMPANY_A, `Founder A ${STAMP}`);
  seedProfile(COMPANY_B, `Founder B ${STAMP}`);

  // ── Seed directory listings (chapter A → COMPANY_A, chapter B → COMPANY_B) ─
  seedListing(COMPANY_A, CHAPTER_A);
  seedListing(COMPANY_B, CHAPTER_B);

  // ── Seed member-directory contacts keyed by the members' emails ──
  // The /members + /dashboard roster scopes contacts by contact.email →
  // users.email → chapter_memberships. Each contact's email must match a
  // chapter member's user email to be visible to that chapter.
  createContact(
    { kind: "investor", type: "individual", legalName: `Investor A ${STAMP}`, displayName: `Investor A ${STAMP}`, email: EMAIL_A, status: "active", region: "NA", hqCountry: "CA", industries: [], stages: [], tags: [] },
    ADMIN,
  );
  createContact(
    { kind: "investor", type: "individual", legalName: `Investor B ${STAMP}`, displayName: `Investor B ${STAMP}`, email: EMAIL_B, status: "active", region: "NA", hqCountry: "CA", industries: [], stages: [], tags: [] },
    ADMIN,
  );

  // ── Seed transaction-prep channels (drives /dsc/prep) ──────────
  createChannel({ companyId: COMPANY_A, founderUserId: `f_${COMPANY_A}` });
  createChannel({ companyId: COMPANY_B, founderUserId: `f_${COMPANY_B}` });

  // ── Seed soft circles attributed to each company ───────────────
  createSoftCircle({ roundId: ROUND_A, companyId: COMPANY_A, investorName: "Inv A", amount: 25000, status: "intent", collectiveVisible: true });
  createSoftCircle({ roundId: ROUND_B, companyId: COMPANY_B, investorName: "Inv B", amount: 50000, status: "intent", collectiveVisible: true });

  // ── Seed a live partner promotion for COMPANY_B (chapter B only) ─
  seedLivePromotion(COMPANY_B, CHAPTER_B);
}, 60_000);

afterAll(async () => {
  await new Promise((resolve) => server.close(() => resolve()));
});

describe("v25.36 cross-chapter scoping isolation — E2E", () => {
  // ── 0. Unauthenticated → 401 (defense-in-depth, before any scoping) ───────
  it("0. unauthenticated caller gets 401 from a scoped endpoint", async () => {
    const res = await reqNoAuth("GET", "/api/collective/dashboard");
    record("unauthenticated /dashboard returns 401", res.status === 401, `status ${res.status} ${JSON.stringify(res.body)?.slice(0,80)}`);
    expect(res.status).toBe(401);
  });

  // ── 1. Dashboard — member roster + KPIs scoped per chapter ────────────────
  it("1. /dashboard scopes member count + DSC depth per chapter; admin sees both", async () => {
    const a = await req("GET", "/api/collective/dashboard", { userId: MEMBER_A });
    const b = await req("GET", "/api/collective/dashboard", { userId: MEMBER_B });
    const adm = await req("GET", "/api/collective/dashboard", { userId: ADMIN });
    const empty = await req("GET", "/api/collective/dashboard", { userId: MEMBER_EMPTY });

    record("member_a dashboard 200", a.status === 200, `status ${a.status}`);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(adm.status).toBe(200);

    // member_a should see exactly its own chapter's investor (Investor A), not B's.
    const aMembers = a.body?.kpis?.totalMembers ?? -1;
    const bMembers = b.body?.kpis?.totalMembers ?? -1;
    record("member_a sees exactly 1 chapter member (own)", aMembers === 1, `totalMembers=${aMembers}`);
    expect(aMembers).toBe(1);
    record("member_b sees exactly 1 chapter member (own)", bMembers === 1, `totalMembers=${bMembers}`);
    expect(bMembers).toBe(1);

    // Admin sees AT LEAST both seeded investors (platform-wide, not scoped).
    const admMembers = adm.body?.kpis?.totalMembers ?? -1;
    record("admin sees >= 2 members (platform-wide)", admMembers >= 2, `totalMembers=${admMembers}`);
    expect(admMembers).toBeGreaterThanOrEqual(2);

    // Empty-chapter member: 0 members, NOT a 403.
    record("empty-chapter member dashboard 200 (NOT 403)", empty.status === 200, `status ${empty.status}`);
    expect(empty.status).toBe(200);
    record("empty-chapter member sees 0 members", (empty.body?.kpis?.totalMembers ?? -1) === 0, `totalMembers=${empty.body?.kpis?.totalMembers}`);
    expect(empty.body?.kpis?.totalMembers).toBe(0);
  });

  // ── 2. DSC pipeline — profiles scoped per chapter ─────────────────────────
  it("2. /dsc/pipeline shows only the caller's chapter companies; admin sees both", async () => {
    const a = await req("GET", "/api/collective/dsc/pipeline", { userId: MEMBER_A });
    const b = await req("GET", "/api/collective/dsc/pipeline", { userId: MEMBER_B });
    const adm = await req("GET", "/api/collective/dsc/pipeline", { userId: ADMIN });
    const empty = await req("GET", "/api/collective/dsc/pipeline", { userId: MEMBER_EMPTY });

    const idsOf = (body) => new Set((body?.columns?.active ?? []).map((c) => c.companyId));
    const aIds = idsOf(a.body);
    const bIds = idsOf(b.body);
    const admIds = idsOf(adm.body);

    record("member_a pipeline includes COMPANY_A", aIds.has(COMPANY_A), [...aIds].join(","));
    expect(aIds.has(COMPANY_A)).toBe(true);
    record("member_a pipeline EXCLUDES COMPANY_B (no leak)", !aIds.has(COMPANY_B));
    expect(aIds.has(COMPANY_B)).toBe(false);
    record("member_b pipeline includes COMPANY_B", bIds.has(COMPANY_B));
    expect(bIds.has(COMPANY_B)).toBe(true);
    record("member_b pipeline EXCLUDES COMPANY_A (no leak)", !bIds.has(COMPANY_A));
    expect(bIds.has(COMPANY_A)).toBe(false);
    record("admin pipeline includes BOTH companies", admIds.has(COMPANY_A) && admIds.has(COMPANY_B));
    expect(admIds.has(COMPANY_A) && admIds.has(COMPANY_B)).toBe(true);
    record("empty-chapter pipeline total 0 (NOT 403)", empty.status === 200 && (empty.body?.total ?? -1) === 0, `status ${empty.status} total ${empty.body?.total}`);
    expect(empty.status).toBe(200);
    expect(empty.body?.total).toBe(0);
  });

  // ── 3. DSC scores — composites scoped per chapter ─────────────────────────
  it("3. /dsc/scores shows only the caller's chapter composites; admin sees both", async () => {
    const a = await req("GET", "/api/collective/dsc/scores", { userId: MEMBER_A });
    const b = await req("GET", "/api/collective/dsc/scores", { userId: MEMBER_B });
    const adm = await req("GET", "/api/collective/dsc/scores", { userId: ADMIN });

    const idsOf = (body) => new Set((body?.scores ?? []).map((s) => s.companyId));
    const aIds = idsOf(a.body);
    const bIds = idsOf(b.body);
    const admIds = idsOf(adm.body);

    record("member_a scores include COMPANY_A only", aIds.has(COMPANY_A) && !aIds.has(COMPANY_B), [...aIds].join(","));
    expect(aIds.has(COMPANY_A)).toBe(true);
    expect(aIds.has(COMPANY_B)).toBe(false);
    record("member_b scores include COMPANY_B only", bIds.has(COMPANY_B) && !bIds.has(COMPANY_A), [...bIds].join(","));
    expect(bIds.has(COMPANY_B)).toBe(true);
    expect(bIds.has(COMPANY_A)).toBe(false);
    record("admin scores include both", admIds.has(COMPANY_A) && admIds.has(COMPANY_B));
    expect(admIds.has(COMPANY_A) && admIds.has(COMPANY_B)).toBe(true);
  });

  // ── 4. DSC composite/:id — 404 for a foreign-chapter company ──────────────
  it("4. /dsc/composite/:id returns 404 for a foreign-chapter company; admin 200", async () => {
    // member_a may read its OWN company (200), but NOT chapter B's (404).
    const aOwn = await req("GET", `/api/collective/dsc/composite/${COMPANY_A}`, { userId: MEMBER_A });
    const aForeign = await req("GET", `/api/collective/dsc/composite/${COMPANY_B}`, { userId: MEMBER_A });
    const admForeign = await req("GET", `/api/collective/dsc/composite/${COMPANY_B}`, { userId: ADMIN });

    record("member_a composite for OWN company is NOT 404", aOwn.status !== 404, `status ${aOwn.status}`);
    expect(aOwn.status).not.toBe(404);
    record("member_a composite for FOREIGN company is 404 (no enumeration)", aForeign.status === 404, `status ${aForeign.status}`);
    expect(aForeign.status).toBe(404);
    record("admin composite for that same company is NOT 404", admForeign.status !== 404, `status ${admForeign.status}`);
    expect(admForeign.status).not.toBe(404);
  });

  // ── 5. DSC prep — channels scoped per chapter ─────────────────────────────
  it("5. /dsc/prep shows only the caller's chapter channels; admin sees both", async () => {
    const a = await req("GET", "/api/collective/dsc/prep", { userId: MEMBER_A });
    const b = await req("GET", "/api/collective/dsc/prep", { userId: MEMBER_B });
    const adm = await req("GET", "/api/collective/dsc/prep", { userId: ADMIN });
    const empty = await req("GET", "/api/collective/dsc/prep", { userId: MEMBER_EMPTY });

    const idsOf = (body) => new Set((body?.channels ?? []).map((c) => c.companyId));
    const aIds = idsOf(a.body);
    const bIds = idsOf(b.body);
    const admIds = idsOf(adm.body);

    record("member_a prep includes COMPANY_A only", aIds.has(COMPANY_A) && !aIds.has(COMPANY_B), [...aIds].join(","));
    expect(aIds.has(COMPANY_A)).toBe(true);
    expect(aIds.has(COMPANY_B)).toBe(false);
    record("member_b prep includes COMPANY_B only", bIds.has(COMPANY_B) && !bIds.has(COMPANY_A), [...bIds].join(","));
    expect(bIds.has(COMPANY_B)).toBe(true);
    expect(bIds.has(COMPANY_A)).toBe(false);
    record("admin prep includes both", admIds.has(COMPANY_A) && admIds.has(COMPANY_B));
    expect(admIds.has(COMPANY_A) && admIds.has(COMPANY_B)).toBe(true);
    record("empty-chapter prep total 0 (NOT 403)", empty.status === 200 && (empty.body?.total ?? -1) === 0, `status ${empty.status} total ${empty.body?.total}`);
    expect(empty.status).toBe(200);
    expect(empty.body?.total).toBe(0);
  });

  // ── 6. Dealroom — partner promotion for chapter B NOT visible to member_a ──
  it("6. /dealroom/companies does NOT leak chapter B's partner promotion to member_a", async () => {
    const a = await req("GET", "/api/collective/dealroom/companies", { userId: MEMBER_A });
    const b = await req("GET", "/api/collective/dealroom/companies", { userId: MEMBER_B });
    const adm = await req("GET", "/api/collective/dealroom/companies", { userId: ADMIN });

    const idsOf = (body) => new Set((body?.companies ?? []).map((c) => c.companyId));
    const aIds = idsOf(a.body);
    const bIds = idsOf(b.body);
    const admIds = idsOf(adm.body);

    // COMPANY_B is promoted (live partner promotion) AND in chapter B. member_a
    // must NOT see it even though a live promotion exists for it.
    record("member_a dealroom EXCLUDES promoted COMPANY_B (B6 fix)", !aIds.has(COMPANY_B), [...aIds].join(","));
    expect(aIds.has(COMPANY_B)).toBe(false);
    // member_b should see COMPANY_B (own chapter).
    record("member_b dealroom includes COMPANY_B", bIds.has(COMPANY_B));
    expect(bIds.has(COMPANY_B)).toBe(true);
    // Admin sees the promoted company.
    record("admin dealroom includes promoted COMPANY_B", admIds.has(COMPANY_B));
    expect(admIds.has(COMPANY_B)).toBe(true);
  });

  // ── 7. Members directory — roster scoped per chapter ──────────────────────
  it("7. /members shows only the caller's chapter roster; admin sees all", async () => {
    const a = await req("GET", "/api/collective/members", { userId: MEMBER_A });
    const b = await req("GET", "/api/collective/members", { userId: MEMBER_B });
    const adm = await req("GET", "/api/collective/members", { userId: ADMIN });
    const empty = await req("GET", "/api/collective/members", { userId: MEMBER_EMPTY });

    const namesOf = (body) => new Set((body?.members ?? []).map((m) => m.displayName));
    const aNames = namesOf(a.body);
    const bNames = namesOf(b.body);
    const admNames = namesOf(adm.body);

    const NAME_A = `Investor A ${STAMP}`;
    const NAME_B = `Investor B ${STAMP}`;
    record("member_a roster includes Investor A only", aNames.has(NAME_A) && !aNames.has(NAME_B), [...aNames].join("|"));
    expect(aNames.has(NAME_A)).toBe(true);
    expect(aNames.has(NAME_B)).toBe(false);
    record("member_b roster includes Investor B only", bNames.has(NAME_B) && !bNames.has(NAME_A), [...bNames].join("|"));
    expect(bNames.has(NAME_B)).toBe(true);
    expect(bNames.has(NAME_A)).toBe(false);
    record("admin roster includes both investors", admNames.has(NAME_A) && admNames.has(NAME_B));
    expect(admNames.has(NAME_A) && admNames.has(NAME_B)).toBe(true);
    record("empty-chapter member roster 0 (NOT 403)", empty.status === 200 && (empty.body?.total ?? -1) === 0, `status ${empty.status} total ${empty.body?.total}`);
    expect(empty.status).toBe(200);
    expect(empty.body?.total).toBe(0);
    // No PII leak — members must never carry email.
    const anyEmail = (a.body?.members ?? []).some((m) => "email" in m);
    record("members payload carries NO email field (PII guard intact)", !anyEmail);
    expect(anyEmail).toBe(false);
  });

  // ── 8. Soft circles — aggregates scoped per chapter ───────────────────────
  it("8. /soft-circles shows only the caller's chapter circles; admin sees both", async () => {
    const a = await req("GET", "/api/collective/soft-circles", { userId: MEMBER_A });
    const b = await req("GET", "/api/collective/soft-circles", { userId: MEMBER_B });
    const adm = await req("GET", "/api/collective/soft-circles", { userId: ADMIN });
    const empty = await req("GET", "/api/collective/soft-circles", { userId: MEMBER_EMPTY });

    const compIdsOf = (body) => new Set((body?.aggregates ?? []).map((g) => g.companyId));
    const aIds = compIdsOf(a.body);
    const bIds = compIdsOf(b.body);
    const admIds = compIdsOf(adm.body);

    record("member_a soft-circles include COMPANY_A only", aIds.has(COMPANY_A) && !aIds.has(COMPANY_B), [...aIds].join(","));
    expect(aIds.has(COMPANY_A)).toBe(true);
    expect(aIds.has(COMPANY_B)).toBe(false);
    record("member_b soft-circles include COMPANY_B only", bIds.has(COMPANY_B) && !bIds.has(COMPANY_A), [...bIds].join(","));
    expect(bIds.has(COMPANY_B)).toBe(true);
    expect(bIds.has(COMPANY_A)).toBe(false);
    record("admin soft-circles include both", admIds.has(COMPANY_A) && admIds.has(COMPANY_B));
    expect(admIds.has(COMPANY_A) && admIds.has(COMPANY_B)).toBe(true);
    record("empty-chapter soft-circles total 0 (NOT 403)", empty.status === 200 && (empty.body?.total ?? -1) === 0, `status ${empty.status} total ${empty.body?.total}`);
    expect(empty.status).toBe(200);
    expect(empty.body?.total).toBe(0);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    // eslint-disable-next-line no-console
    console.log(`\n  v25.36 chapter-scoping E2E: ${passed}/${results.length} assertions passed`);
    expect(passed).toBe(results.length);
  });
});
