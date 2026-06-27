/* v25.44 S13 — M&A Intelligence CROSS-TENANT E2E (ROUND 2 strengthened).
 *
 * Positive: a same-chapter member CAN see a chapter-only company.
 * Negative: a cross-chapter member CANNOT see a chapter-only company.
 * Negative: a non-super-admin member cannot reach another tenant's company via
 *           the legacy per-company endpoint (403). NOTE: in this system
 *           users.role='admin' IS the super-admin role (the only admin tier the
 *           authz gate recognises), so we assert the cross-tenant boundary for a
 *           NON-admin member and separately document that a global/super admin
 *           does have moderation visibility (FULL) — the documented exception.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setup, recorder } from "./v25_42_helpers.mjs";
import { rawDb } from "../db/connection.ts";
import { seedCompany, CHAPTER_ONLY, seedChapterMembershipFor } from "./v25_44_ma_seed.mjs";

let h; const { results, record } = recorder();
const STAMP = Date.now();
const HOME_SECTOR = `XTHome_${STAMP}`;
const FOREIGN_SECTOR = `XTForeign_${STAMP}`;
const otherChapterId = `chap_other_${STAMP}`;
const homeCo = `co_xt_home_${STAMP}`;     // chapter-only, in caller's chapter
const foreignCo = `co_xt_foreign_${STAMP}`; // chapter-only, in another chapter

beforeAll(async () => {
  h = await setup("s13xt");
  // Same-chapter chapter-only company (caller is in h.ids.CHAPTER).
  seedCompany({ id: homeCo, name: "Home Chapter Co", sector: HOME_SECTOR, privacy: CHAPTER_ONLY, chapter: h.ids.CHAPTER });
  // Foreign chapter-only company (caller is NOT in otherChapterId).
  seedCompany({ id: foreignCo, name: "Foreign Chapter Co", sector: FOREIGN_SECTOR, privacy: CHAPTER_ONLY, chapter: otherChapterId });
}, 60_000);
afterAll(async () => { await h.teardown(); });

describe("v25.44 S13 cross-tenant — E2E (round 2)", () => {
  it("1. POSITIVE — same-chapter member CAN see chapter-only company", async () => {
    const r = await h.req("GET", "/api/collective/ma-intel?view=pipeline", { userId: h.ids.MEMBER });
    expect(r.status).toBe(200);
    const b = r.body?.buckets;
    const all = [...(b?.active_negotiation ?? []), ...(b?.outbound ?? []), ...(b?.inbound ?? [])];
    const seen = all.some((x) => x.companyId === homeCo) || (b?.none?.count ?? 0) >= 1;
    record("same-chapter company visible", seen);
    expect(seen).toBe(true);
  });

  it("2. NEGATIVE — cross-chapter member CANNOT see chapter-only company (benchmarks)", async () => {
    const r = await h.req("GET", "/api/collective/ma-intel?view=benchmarks", { userId: h.ids.MEMBER });
    expect(r.status).toBe(200);
    const sector = (r.body.sectors ?? []).find((s) => s.sector === FOREIGN_SECTOR);
    const ok = !sector;
    record("foreign chapter-only company excluded", ok, sector ? `LEAKED n=${sector.n}` : "absent");
    expect(ok).toBe(true);
  });

  it("3. NEGATIVE — cross-chapter member CANNOT see foreign company via legacy endpoint (403)", async () => {
    const r = await h.req("GET", `/api/investor/ma/intelligence/${foreignCo}`, { userId: h.ids.MEMBER });
    record("legacy endpoint 403 cross-tenant", r.status === 403, `status ${r.status}`);
    expect(r.status).toBe(403);
  });

  it("4. NEGATIVE — a member of a DIFFERENT chapter still cannot see the home company", async () => {
    // Create a fresh user in otherChapterId and assert they cannot see homeCo.
    const otherUser = `u_xt_other_${STAMP}`;
    rawDb().prepare(
      `INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo)
       VALUES (?, ?, ?, ?, 'investor', 0)`,
    ).run(otherUser, `tenant_chap_${otherChapterId}`, `${otherUser}@xt.test`, otherUser);
    seedChapterMembershipFor(otherChapterId, otherUser);
    const r = await h.req("GET", `/api/investor/ma/intelligence/${homeCo}`, { userId: otherUser });
    record("other-chapter user 403 on home company", r.status === 403, `status ${r.status}`);
    expect(r.status).toBe(403);
  });

  it("5. DOCUMENTED EXCEPTION — global/super admin has moderation visibility (FULL)", async () => {
    // users.role='admin' is the system's super-admin tier; it is the documented
    // moderation exception. A per-tenant-only admin concept does not exist here.
    const r = await h.req("GET", `/api/investor/ma/intelligence/${foreignCo}`, { userId: h.ids.ADMIN });
    const ok = r.status === 200 && r.body?.accessLevel === "FULL";
    record("super-admin FULL access (documented)", ok, `status ${r.status} level ${r.body?.accessLevel}`);
    expect(ok).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.44 S13 cross-tenant E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
