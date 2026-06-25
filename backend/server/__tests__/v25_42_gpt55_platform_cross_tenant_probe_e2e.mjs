/* GPT-5.5 platform-audit probe — verifies /api/collective/partners/public
 * with three distinct chapter-scoped partner rows plus a null-chapter partner.
 * This is intentionally adversarial and audit-only.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setup, seedPartnerOrg, recorder } from "./v25_42_helpers.mjs";
import { rawDb } from "../db/connection.ts";
import { __setRuntimePersona } from "../lib/userContext.ts";
import * as collectiveMembershipStore from "../collectiveMembershipStore.ts";
import { upsertActiveMembership } from "../membershipStore.ts";

let h;
const { results, record } = recorder();
let chapters;
let users;

function seedChapter(chapterId) {
  const now = new Date().toISOString();
  rawDb().prepare(
    `INSERT OR IGNORE INTO chapters
       (id, tenant_id, name, region, city, status, dsc_quorum_pct, created_at)
     VALUES (?, ?, ?, 'NA', ?, 'active', 50, ?)`,
  ).run(chapterId, `tenant_${chapterId}`, `GPT55 ${chapterId}`, chapterId, now);
}

function seedMember(chapterId, userId) {
  const now = new Date().toISOString();
  __setRuntimePersona({ userId, email: `${userId}@gpt55.test`, name: userId, isFounder: false, isInvestor: true, isAdmin: false, hasInvitations: false });
  rawDb().prepare(
    `INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo)
     VALUES (?, ?, ?, ?, 'investor', 0)`,
  ).run(userId, `tenant_${chapterId}`, `${userId}@gpt55.test`, userId);
  rawDb().prepare(
    `INSERT OR IGNORE INTO chapter_memberships
       (id, tenant_id, chapter_id, user_id, role, status, joined_at, created_at)
     VALUES (?, ?, ?, ?, 'member', 'active', ?, ?)`,
  ).run(`cm_${userId}_${chapterId}`, `tenant_${chapterId}`, chapterId, userId, now, now);
  collectiveMembershipStore.activate(userId, h.ids.ADMIN, "standard", { chapterId });
  upsertActiveMembership(userId);
}

beforeAll(async () => {
  h = await setup("gpt55x");
  chapters = [h.ids.CHAPTER, `chap_gpt55_b_${h.ids.STAMP}`, `chap_gpt55_c_${h.ids.STAMP}`];
  users = [h.ids.MEMBER, `u_gpt55_b_${h.ids.STAMP}`, `u_gpt55_c_${h.ids.STAMP}`];
  seedChapter(chapters[1]);
  seedChapter(chapters[2]);
  seedMember(chapters[1], users[1]);
  seedMember(chapters[2], users[2]);
  seedPartnerOrg(h.ids, { id: `po_gpt55_global_${h.ids.STAMP}`, name: "GPT55 Global Partner", status: "active", primaryChapterId: null });
  seedPartnerOrg(h.ids, { id: `po_gpt55_a_${h.ids.STAMP}`, name: "GPT55 Partner A", status: "active", tenantId: `tenant_${chapters[0]}`, primaryChapterId: chapters[0] });
  seedPartnerOrg(h.ids, { id: `po_gpt55_b_${h.ids.STAMP}`, name: "GPT55 Partner B", status: "active", tenantId: `tenant_${chapters[1]}`, primaryChapterId: chapters[1] });
  seedPartnerOrg(h.ids, { id: `po_gpt55_c_${h.ids.STAMP}`, name: "GPT55 Partner C", status: "active", tenantId: `tenant_${chapters[2]}`, primaryChapterId: chapters[2] });
}, 60_000);

afterAll(async () => { await h.teardown(); });

describe("GPT-5.5 audit cross-tenant probe — partners/public", () => {
  it("each chapter member sees only own chapter partner plus null-chapter partner", async () => {
    for (let i = 0; i < users.length; i++) {
      const res = await h.req("GET", "/api/collective/partners/public", { userId: users[i] });
      expect(res.status).toBe(200);
      const names = (res.body?.items ?? []).map((x) => x.name);
      const own = `GPT55 Partner ${String.fromCharCode(65 + i)}`;
      const others = ["GPT55 Partner A", "GPT55 Partner B", "GPT55 Partner C"].filter((n) => n !== own);
      record(`${users[i]} sees own`, names.includes(own), names.join(","));
      record(`${users[i]} sees global`, names.includes("GPT55 Global Partner"), names.join(","));
      record(`${users[i]} does not see other chapters`, others.every((n) => !names.includes(n)), names.join(","));
      expect(names).toContain(own);
      expect(names).toContain("GPT55 Global Partner");
      for (const other of others) expect(names).not.toContain(other);
    }
  });

  it("admin sees all three chapter partners", async () => {
    const res = await h.req("GET", "/api/collective/partners/public", { userId: h.ids.ADMIN });
    expect(res.status).toBe(200);
    const names = (res.body?.items ?? []).map((x) => x.name);
    for (const n of ["GPT55 Partner A", "GPT55 Partner B", "GPT55 Partner C", "GPT55 Global Partner"]) {
      record(`admin sees ${n}`, names.includes(n), names.join(","));
      expect(names).toContain(n);
    }
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  GPT-5.5 cross-tenant probe: ${passed}/${results.length} assertions passed`);
    expect(passed).toBe(results.length);
  });
});
