/**
 * CROSS-TENANT PROBE — GET /api/collective/partners/public is chapter-scoped.
 *
 * ── WAVE 38 ROW 2: WHY THIS FILE NEVER LOADED, AND WHAT CHANGED ────────────
 * This file used to `import { app } from "../index"`. It is the ONLY test in
 * the tree that imported the real server entrypoint, and importing it executes
 * `server/index.ts` top to bottom: dotenv loads the deployment `.env`, which
 * sets `DATABASE_URL=file:/var/www/html/backend/data.db`, and
 * `server/db/connection.ts` (SACRED — read, never edited) resolves an explicit
 * `file:` URL AHEAD of the `NODE_ENV=test → :memory:` rule. In this checkout
 * that directory does not exist, so `new Database(path)` threw
 * `TypeError: Cannot open database because the directory does not exist`
 * during boot, as an UNHANDLED REJECTION.
 *
 * The consequence is the whole point of Wave 38 Row 2: the file failed at
 * RUNNER level and recorded ZERO assertions. Vitest reported it as a failed
 * FILE, but an assertion-based failure counter could not see it at all — which
 * is how a 122-failed-file suite was reported as 120 failing files. Two files
 * that never loaded were invisible to the counter watching the gate.
 *
 * The fix is not to point the old probe at a different database. It is to stop
 * depending on ambient deployment configuration entirely: this file now builds
 * its own express app and calls `registerRoutes` directly — the same harness
 * every other server integration test uses — and SEEDS ITS OWN FIXTURES rather
 * than hoping the shared demo database happens to contain them.
 *
 * ── WHAT THE OLD FILE ASSERTED: NOTHING ────────────────────────────────────
 * Even had it loaded, it asserted `res.status === 200` and then `console.log`ed
 * the names it received, with a comment saying what it "expected". A probe that
 * prints the answer instead of asserting it is a check that checks nothing —
 * the exact class this program has paid for 25+ times. It is now a real
 * cross-tenant isolation test.
 *
 * ── BOTH POLES, EVERY CASE ─────────────────────────────────────────────────
 * A handler that returned `items: []` to everyone would pass any "member A
 * cannot see partner B" assertion. So every isolation assertion is paired with
 * a POSITIVE control in the same request:
 *   - member A MUST see their own chapter's partner (upper pole) and MUST NOT
 *     see the other chapter's partner (lower pole);
 *   - a deliberately chapter-agnostic partner (`primary_chapter_id IS NULL`)
 *     MUST be visible to BOTH members, proving the filter narrows by chapter
 *     rather than by anything incidental to the fixture;
 *   - a platform admin MUST see all three, proving the rows exist and are
 *     `status = 'active'` — so an empty member response can never be mistaken
 *     for correct scoping;
 *   - an identity-less request MUST be refused, so "sees nothing" is never
 *     reported as isolation.
 * Finally the projection is asserted to carry no economics columns, which is
 * the HARD CONSTRAINT the route documents.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import * as collectiveMembershipStore from "../collectiveMembershipStore";
import { upsertCapTablePositionForTests } from "../membershipStore";
import { hydrateMultiCompanyStore } from "../multiCompanyStore";

/** Two real seeded personas, in two different chapters. */
const MEMBER_A = "u_maya_chen";
const MEMBER_B = "u_daniel_okafor";
const ADMIN = "u_admin";

const CHAPTER_A = "chap_xtp_alpha";
const CHAPTER_B = "chap_xtp_beta";
const TENANT_A = "tenant_xtp_alpha";
const TENANT_B = "tenant_xtp_beta";

const PARTNER_A = "XTP Alpha Chapter Partner";
const PARTNER_B = "XTP Beta Chapter Partner";
const PARTNER_GLOBAL = "XTP Chapter-Agnostic Partner";

let app: Express;
let server: http.Server;

const NOW = new Date().toISOString();

function sql(q: string, ...args: unknown[]) {
  return rawDb().prepare(q).run(...args);
}

beforeAll(async () => {
  // PRECONDITIONS ARE ESTABLISHED HERE, NOT READ FROM THE ENVIRONMENT.
  process.env.COLLECTIVE_ENABLED = "1";

  await seedDemoData(getDb());
  await hydrateMultiCompanyStore();

  for (const uid of [MEMBER_A, MEMBER_B]) {
    collectiveMembershipStore.activate(uid, "u_admin_test");
    upsertCapTablePositionForTests(uid);
  }

  // Two chapters in two tenants.
  for (const [cid, tid, name] of [
    [CHAPTER_A, TENANT_A, "XTP Alpha"],
    [CHAPTER_B, TENANT_B, "XTP Beta"],
  ]) {
    sql(
      `INSERT OR REPLACE INTO chapters
         (id, tenant_id, name, region, status, dsc_quorum_pct, created_at, updated_at)
       VALUES (?, ?, ?, 'test-region', 'active', 50, ?, ?)`,
      cid, tid, name, NOW, NOW,
    );
  }

  // Each member belongs to exactly one chapter.
  for (const [uid, cid, tid] of [
    [MEMBER_A, CHAPTER_A, TENANT_A],
    [MEMBER_B, CHAPTER_B, TENANT_B],
  ]) {
    sql(
      `INSERT OR REPLACE INTO chapter_memberships
         (id, tenant_id, chapter_id, user_id, role, status, joined_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'member', 'active', ?, ?, ?)`,
      `cm_xtp_${uid}`, tid, cid, uid, NOW, NOW, NOW,
    );
  }

  // Three active partner organizations: one per chapter, one chapter-agnostic.
  for (const [pid, tid, name, chapterId] of [
    ["po_xtp_alpha", TENANT_A, PARTNER_A, CHAPTER_A],
    ["po_xtp_beta", TENANT_B, PARTNER_B, CHAPTER_B],
    ["po_xtp_global", TENANT_A, PARTNER_GLOBAL, null],
  ] as Array<[string, string, string, string | null]>) {
    sql(
      `INSERT OR REPLACE INTO partner_organizations
         (id, tenant_id, name, jurisdiction, partner_type, aum_range, primary_chapter_id,
          status, onboarding_state, created_at, updated_at)
       VALUES (?, ?, ?, 'US-DE', 'vc_fund', '100m_500m', ?, 'active', 'complete', ?, ?)`,
      pid, tid, name, chapterId, NOW, NOW,
    );
  }

  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);

  // `requireCollectiveMember` has a fail-closed accreditation sub-check
  // (step 4): a member with no recorded self-declaration is refused with
  // ACCREDITATION_DECLARATION_REQUIRED. That is correct behaviour, so the
  // precondition is SATISFIED THROUGH THE SHIPPED ENDPOINT rather than by
  // reaching around the gate — if the declaration flow breaks, this file goes
  // red instead of quietly asserting against a refused caller.
  for (const uid of [MEMBER_A, MEMBER_B]) {
    const decl = await request(app)
      .post("/api/investor/compliance/accreditation-declaration")
      .set("x-user-id", uid)
      .send({
        signatureName: "Cross Tenant Probe Fixture",
        criteria: ["us_net_worth"],
        jurisdiction: "US",
      });
    // Asserted, not hoped for. A silently failing fixture would leave every
    // member assertion below measuring a 403.
    expect(decl.status).toBe(201);
  }
}, 300_000);

afterAll(async () => {
  // Guarded: an unguarded close() on an undefined server is a SECOND
  // runner-level error, which is exactly how the original failure presented.
  if (server) await new Promise<void>((r) => server.close(() => r()));
  delete process.env.COLLECTIVE_ENABLED;
});

function as(userId: string) {
  return request(app).get("/api/collective/partners/public").set("x-user-id", userId);
}

function namesOf(body: unknown): string[] {
  const items = (body as { items?: Array<{ name?: string }> } | null)?.items ?? [];
  return items.map((i) => String(i.name ?? ""));
}

describe("cross-tenant probe — GET /api/collective/partners/public", () => {
  it("CONTROL: an admin sees all three fixture partners, so the rows demonstrably exist and are active", async () => {
    const r = await as(ADMIN);
    expect(r.status).toBe(200);
    const names = namesOf(r.body);
    // Without this control, an empty member response below would be
    // indistinguishable from correct isolation.
    expect(names).toContain(PARTNER_A);
    expect(names).toContain(PARTNER_B);
    expect(names).toContain(PARTNER_GLOBAL);
  }, 60_000);

  it("CONTROL: an identity-less request is refused, so 'sees nothing' is never reported as isolation", async () => {
    const r = await request(app).get("/api/collective/partners/public");
    // requireCollectiveMember answers 401 missing_identity, or 403 if a
    // dev-persona fallback resolved an identity that is not a member. Either
    // way it must NOT be a 200 carrying partner rows.
    expect([401, 403]).toContain(r.status);
    expect(namesOf(r.body)).toEqual([]);
  }, 60_000);

  it("member A sees their own chapter's partner and the agnostic one — and NOT chapter B's", async () => {
    const r = await as(MEMBER_A);
    expect(r.status).toBe(200);
    const names = namesOf(r.body);
    expect(names).toContain(PARTNER_A); // upper pole — scoping did not empty the list
    expect(names).toContain(PARTNER_GLOBAL); // primary_chapter_id IS NULL stays visible
    expect(names).not.toContain(PARTNER_B); // lower pole — THE isolation claim
  }, 60_000);

  it("member B sees their own chapter's partner and the agnostic one — and NOT chapter A's", async () => {
    const r = await as(MEMBER_B);
    expect(r.status).toBe(200);
    const names = namesOf(r.body);
    expect(names).toContain(PARTNER_B);
    expect(names).toContain(PARTNER_GLOBAL);
    expect(names).not.toContain(PARTNER_A);
  }, 60_000);

  it("the two members' views are genuinely DIFFERENT — a handler ignoring chapter would fail here", async () => {
    const a = namesOf((await as(MEMBER_A)).body);
    const b = namesOf((await as(MEMBER_B)).body);
    // Symmetric difference must contain exactly the two chapter-bound partners.
    const onlyA = a.filter((n) => !b.includes(n));
    const onlyB = b.filter((n) => !a.includes(n));
    expect(onlyA).toContain(PARTNER_A);
    expect(onlyB).toContain(PARTNER_B);
    // And the shared part is non-empty, so "different" is not "one is empty".
    expect(a.filter((n) => b.includes(n))).toContain(PARTNER_GLOBAL);
  }, 60_000);

  it("the public projection carries no economics columns (Ozan HARD CONSTRAINT #1)", async () => {
    const r = await as(MEMBER_A);
    expect(r.status).toBe(200);
    const raw = JSON.stringify(r.body);
    for (const forbidden of [
      "adminFeePerDeal",
      "carryPct",
      "mgmtFeePct",
      "revShareToCapavate",
      "hurdleRatePct",
      "admin_fee_per_deal",
      "carry_pct",
      "mgmt_fee_pct",
    ]) {
      expect(raw).not.toContain(forbidden);
    }
    // ANTI-VACUITY: the body is non-trivial, so "contains no economics" is not
    // a statement about an empty string.
    expect(raw.length).toBeGreaterThan(50);
    expect(raw).toContain(PARTNER_A);
  }, 60_000);
});
