/* v25.44 S13 — LEGACY ENDPOINT GATE E2E (ROUND 2, NEW FILE).
 *
 * Specifically tests that GET /api/investor/ma/intelligence/:companyId is
 * properly gated by the SHARED maAuthzGate. Cases:
 *   - founder of the company                      → 200 FULL (incl. narrative)
 *   - same-chapter member, shareWithChapter=true   → 200 DETAIL (narrative redacted)
 *   - same-chapter member, shareWithChapter=false   → 403
 *   - Collective member, shareWithCollective=false  → 403
 *   - Collective member, shareWithCollective=true   → 200 AGGREGATE-only
 *                                                     (no buyer names / narrative)
 *   - random investor (no relationship)             → 403
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setup, recorder } from "./v25_42_helpers.mjs";
import { rawDb } from "../db/connection.ts";
import { seedCompany, seedChapterMembershipFor } from "./v25_44_ma_seed.mjs";

let h; const { results, record } = recorder();
const STAMP = Date.now();

// Privacy postures.
const CHAP_SHARE   = { shareWithCollective: false, shareWithChapter: true,  shareWithAdvisors: true, redactNarrativeFromAggregates: true };
const CHAP_NOSHARE = { shareWithCollective: false, shareWithChapter: false, shareWithAdvisors: true, redactNarrativeFromAggregates: true };
const COLL_OPTIN   = { shareWithCollective: true,  shareWithChapter: false, shareWithAdvisors: true, redactNarrativeFromAggregates: true };
const COLL_OPTOUT  = { shareWithCollective: false, shareWithChapter: false, shareWithAdvisors: true, redactNarrativeFromAggregates: true };

const founderCo    = `co_le_founder_${STAMP}`;
const chapShareCo  = `co_le_chapshare_${STAMP}`;
const chapNoShareCo= `co_le_chapnoshare_${STAMP}`;
const collOptInCo  = `co_le_collin_${STAMP}`;
const collOptOutCo = `co_le_collout_${STAMP}`;

const NARRATIVE = `LEGACY_NARRATIVE_${STAMP}`;
let founderUserId, randomUserId;

beforeAll(async () => {
  h = await setup("s13legacy");
  founderUserId = `u_le_founder_${STAMP}`;
  randomUserId = `u_le_random_${STAMP}`;

  // Founder's own company (founderUserId is its company_members founder).
  seedCompany({ id: founderCo, name: "Founder Co", sector: `LE_${STAMP}`, privacy: CHAP_NOSHARE, narrative: NARRATIVE, memberUserId: founderUserId });

  // Same chapter as caller (h.ids.MEMBER ∈ h.ids.CHAPTER), shareWithChapter=true.
  seedCompany({ id: chapShareCo, name: "Chapter Share Co", sector: `LE_${STAMP}`, privacy: CHAP_SHARE, chapter: h.ids.CHAPTER, narrative: NARRATIVE });
  // Same chapter, shareWithChapter=false → 403 for chapter peer.
  seedCompany({ id: chapNoShareCo, name: "Chapter NoShare Co", sector: `LE_${STAMP}`, privacy: CHAP_NOSHARE, chapter: h.ids.CHAPTER, narrative: NARRATIVE });
  // Collective opt-in → AGGREGATE for collective member; opt-out → 403.
  seedCompany({ id: collOptInCo, name: "Coll OptIn Co", sector: `LE_${STAMP}`, privacy: COLL_OPTIN, narrative: NARRATIVE });
  seedCompany({ id: collOptOutCo, name: "Coll OptOut Co", sector: `LE_${STAMP}`, privacy: COLL_OPTOUT, narrative: NARRATIVE });

  // Random investor — exists + is a (different) chapter member but has no
  // relationship to any seeded company and no collective opt-in path to them.
  rawDb().prepare(
    `INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo) VALUES (?, ?, ?, ?, 'investor', 0)`,
  ).run(randomUserId, `tenant_rand_${STAMP}`, `${randomUserId}@le.test`, randomUserId);
  seedChapterMembershipFor(`chap_rand_${STAMP}`, randomUserId);
}, 60_000);
afterAll(async () => { await h.teardown(); });

describe("v25.44 S13 legacy endpoint gate — E2E (new)", () => {
  it("1. founder → 200 FULL with narrative", async () => {
    const r = await h.req("GET", `/api/investor/ma/intelligence/${founderCo}`, { userId: founderUserId });
    const ok = r.status === 200 && r.body?.accessLevel === "FULL" && JSON.stringify(r.body).includes(NARRATIVE);
    record("founder 200 FULL + narrative", ok, `status ${r.status} level ${r.body?.accessLevel}`);
    expect(ok).toBe(true);
  });

  it("2. same-chapter member, shareWithChapter=true → 200 DETAIL, narrative redacted", async () => {
    const r = await h.req("GET", `/api/investor/ma/intelligence/${chapShareCo}`, { userId: h.ids.MEMBER });
    const narrativeLeaked = JSON.stringify(r.body).includes(NARRATIVE);
    const ok = r.status === 200 && r.body?.accessLevel === "DETAIL" && !narrativeLeaked;
    record("chapter-share 200 DETAIL, narrative redacted", ok, `status ${r.status} level ${r.body?.accessLevel} narrativeLeaked=${narrativeLeaked}`);
    expect(ok).toBe(true);
  });

  it("3. same-chapter member, shareWithChapter=false → 403", async () => {
    const r = await h.req("GET", `/api/investor/ma/intelligence/${chapNoShareCo}`, { userId: h.ids.MEMBER });
    record("chapter-noshare 403", r.status === 403, `status ${r.status}`);
    expect(r.status).toBe(403);
  });

  it("4. Collective member, shareWithCollective=false → 403", async () => {
    const r = await h.req("GET", `/api/investor/ma/intelligence/${collOptOutCo}`, { userId: h.ids.MEMBER });
    record("collective opt-out 403", r.status === 403, `status ${r.status}`);
    expect(r.status).toBe(403);
  });

  it("5. Collective member, shareWithCollective=true → 200 AGGREGATE-only (no buyers/narrative)", async () => {
    const r = await h.req("GET", `/api/investor/ma/intelligence/${collOptInCo}`, { userId: h.ids.MEMBER });
    const json = JSON.stringify(r.body);
    const noBuyerNames = !("topStrategicBuyers" in (r.body ?? {}));
    const noNarrative = !json.includes(NARRATIVE) && !json.includes("maReadinessNarrative");
    const ok = r.status === 200 && r.body?.accessLevel === "AGGREGATE" && noBuyerNames && noNarrative
      && typeof r.body?.maScore === "number" && typeof r.body?.strategicBuyerCount === "number";
    record("collective opt-in 200 AGGREGATE-only", ok, `status ${r.status} level ${r.body?.accessLevel}`);
    expect(ok).toBe(true);
  });

  it("6. random investor → 403", async () => {
    const r = await h.req("GET", `/api/investor/ma/intelligence/${chapShareCo}`, { userId: randomUserId });
    record("random investor 403", r.status === 403, `status ${r.status}`);
    expect(r.status).toBe(403);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.44 S13 legacy endpoint gate E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
