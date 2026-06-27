/* v25.42 R8 / Bucket C — E2E: GET /api/collective/partners/public.
 *
 * Contract pinned here:
 *   0. unauthenticated → 401/403 (requireCollectiveMember fail-closed)
 *   1. member GET → 200 with the public-card envelope {count,total,limit,offset,items}
 *   2. ECONOMICS REDACTED — no item exposes adminFeePerDeal/carryPct/mgmtFeePct/
 *      revShareToCapavate/hurdleRatePct (Ozan HARD CONSTRAINT #1)
 *   3. only public-safe keys appear on each item
 *   4. only active partner_organizations rows are returned (paused excluded)
 *
 * v25.42 round-2 cross-tenant scope (Blocker 1):
 *   5. member in chapter A sees partners scoped to chapter A (and chapter-agnostic
 *      null primary_chapter_id partners), but NOT partners of chapter B
 *   6. admin sees both chapter A and chapter B partners (CROSS-TENANT)
 *   7. member with no chapters → 200 with empty array
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setup, seedPartnerOrg, recorder } from "./v25_42_helpers.mjs";
import { __setRuntimePersona } from "../lib/userContext.ts";
import * as collectiveMembershipStore from "../collectiveMembershipStore.ts";

let h;
const ECONOMICS = ["adminFeePerDeal", "carryPct", "mgmtFeePct", "revShareToCapavate", "hurdleRatePct"];
const ALLOWED = new Set(["id", "name", "logoUrl", "governance", "hq", "memberCount", "aumUsd", "sectors"]);
const { results, record } = recorder();

// Chapter B is a DIFFERENT chapter/tenant the member does NOT belong to.
let CHAPTER_B;

beforeAll(async () => {
  h = await setup("r8");
  CHAPTER_B = `chap_v2542_r8_other_${h.ids.STAMP}`;
  // Chapter-agnostic (null primary_chapter_id) — visible to all members.
  seedPartnerOrg(h.ids, { id: `po_active_${h.ids.STAMP}`, name: "Aurora Capital", status: "active" });
  seedPartnerOrg(h.ids, { id: `po_paused_${h.ids.STAMP}`, name: "Zenith Paused", status: "paused" });
  // Partner scoped to chapter A (the member's chapter) — member should see it.
  seedPartnerOrg(h.ids, {
    id: `po_chapA_${h.ids.STAMP}`,
    name: "Chapter A Partners",
    status: "active",
    primaryChapterId: h.ids.CHAPTER,
  });
  // Partner scoped to chapter B (a DIFFERENT chapter/tenant) — member must NOT see it.
  seedPartnerOrg(h.ids, {
    id: `po_chapB_${h.ids.STAMP}`,
    name: "Chapter B Partners",
    status: "active",
    tenantId: `tenant_chap_${CHAPTER_B}`,
    primaryChapterId: CHAPTER_B,
  });
}, 60_000);

afterAll(async () => { await h.teardown(); });

describe("v25.42 R8 partners/public — E2E", () => {
  it("0. unauthenticated → 401/403", async () => {
    const res = await h.reqNoAuth("GET", "/api/collective/partners/public");
    record("unauth blocked", res.status === 401 || res.status === 403, `status ${res.status}`);
    expect([401, 403]).toContain(res.status);
  });

  it("1. member GET → 200 with public-card envelope", async () => {
    const res = await h.req("GET", "/api/collective/partners/public", { userId: h.ids.MEMBER });
    record("member 200", res.status === 200, `status ${res.status}`);
    expect(res.status).toBe(200);
    record("envelope keys", Array.isArray(res.body?.items) && typeof res.body?.count === "number" && typeof res.body?.total === "number", JSON.stringify(Object.keys(res.body ?? {})));
    expect(Array.isArray(res.body?.items)).toBe(true);
    h._items = res.body.items;
  });

  it("2. ECONOMICS REDACTED on every item", async () => {
    const items = h._items ?? [];
    let leaked = false;
    for (const it of items) {
      for (const k of ECONOMICS) if (k in it) leaked = true;
    }
    record("no economics leak", !leaked, leaked ? "ECONOMICS LEAKED" : `${items.length} items clean`);
    expect(leaked).toBe(false);
  });

  it("3. only public-safe keys on each item", async () => {
    const items = h._items ?? [];
    let extraneous = null;
    for (const it of items) {
      for (const k of Object.keys(it)) if (!ALLOWED.has(k)) extraneous = k;
    }
    record("only allowed keys", extraneous === null, extraneous ? `unexpected key ${extraneous}` : "ok");
    expect(extraneous).toBeNull();
  });

  it("4. only active rows returned (paused excluded)", async () => {
    const items = h._items ?? [];
    const names = items.map((i) => i.name);
    record("active row present", names.includes("Aurora Capital"), names.join(","));
    record("paused row excluded", !names.includes("Zenith Paused"), names.join(","));
    expect(names).toContain("Aurora Capital");
    expect(names).not.toContain("Zenith Paused");
  });

  it("5. member in chapter A sees chapter-A + agnostic partners, NOT chapter-B", async () => {
    const res = await h.req("GET", "/api/collective/partners/public", { userId: h.ids.MEMBER });
    record("member 200 (scope)", res.status === 200, `status ${res.status}`);
    expect(res.status).toBe(200);
    const names = (res.body?.items ?? []).map((i) => i.name);
    record("sees chapter-A partner", names.includes("Chapter A Partners"), names.join(","));
    record("sees chapter-agnostic partner", names.includes("Aurora Capital"), names.join(","));
    record("does NOT see chapter-B partner", !names.includes("Chapter B Partners"), names.join(","));
    expect(names).toContain("Chapter A Partners");
    expect(names).toContain("Aurora Capital");
    expect(names).not.toContain("Chapter B Partners");
  });

  it("6. admin sees both chapter-A and chapter-B partners (cross-tenant)", async () => {
    const res = await h.req("GET", "/api/collective/partners/public", { userId: h.ids.ADMIN });
    record("admin 200", res.status === 200, `status ${res.status}`);
    expect(res.status).toBe(200);
    const names = (res.body?.items ?? []).map((i) => i.name);
    record("admin sees chapter-A partner", names.includes("Chapter A Partners"), names.join(","));
    record("admin sees chapter-B partner", names.includes("Chapter B Partners"), names.join(","));
    expect(names).toContain("Chapter A Partners");
    expect(names).toContain("Chapter B Partners");
  });

  it("7. member with no chapters → 200 with empty array", async () => {
    // An active collective member identity with NO chapter_memberships rows.
    // We activate collective membership (so requireCollectiveMember passes) but
    // deliberately never insert a chapter_memberships row, so
    // listChaptersForUser() returns [] — the no-chapters branch under test.
    const orphanId = `u_v2542_r8_orphan_${h.ids.STAMP}`;
    __setRuntimePersona({ userId: orphanId, email: `${orphanId}@v2542.test`, name: orphanId, isFounder: false, isInvestor: true, isAdmin: false, hasInvitations: false });
    collectiveMembershipStore.activate(orphanId, h.ids.ADMIN, "standard");
    const res = await h.req("GET", "/api/collective/partners/public", { userId: orphanId });
    record("orphan 200", res.status === 200, `status ${res.status}`);
    const empty = Array.isArray(res.body?.items) && res.body.items.length === 0;
    record("orphan empty array", empty, JSON.stringify(res.body?.items ?? null));
    expect(res.status).toBe(200);
    expect(empty).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    // eslint-disable-next-line no-console
    console.log(`\n  v25.42 R8 partners/public E2E: ${passed}/${results.length} assertions passed`);
    expect(passed).toBe(results.length);
  });
});
