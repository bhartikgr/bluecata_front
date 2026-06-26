/* v25.44 S13 — M&A Intelligence PRIVACY GATE E2E (ROUND 2 strengthened).
 *
 * Verifies: opt-OUT default blocks cross-Collective exposure; opt-IN companies
 * appear; opted-out companies never leak; the legacy per-company endpoint is
 * 403 for unauthorized requesters; a company with a TRULY NULL ma_privacy_json
 * (no consent row at all) defaults to opt-OUT for Collective; a same-chapter
 * shareWithChapter=true / shareWithCollective=false company is visible to a
 * chapter peer (with narrative redacted).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setup, recorder } from "./v25_42_helpers.mjs";
import { rawDb } from "../db/connection.ts";
import { seedCompany, OPT_IN, OPT_OUT, CHAPTER_ONLY } from "./v25_44_ma_seed.mjs";

let h; const { results, record } = recorder();
const SECTOR = `PGSect_${Date.now()}`;
const optInId = `co_pg_in_${Date.now()}`;
const optOutId = `co_pg_out_${Date.now()}`;
const nullPrivacyId = `co_pg_null_${Date.now()}`;
const chapterOnlyId = `co_pg_chap_${Date.now()}`;
const NARRATIVE = `PG_DISTINCTIVE_NARRATIVE_${Date.now()}`;

beforeAll(async () => {
  h = await setup("s13pg");
  // Opt-IN company → visible cross-Collective.
  seedCompany({ id: optInId, name: "OptIn Co", sector: SECTOR, privacy: OPT_IN });
  // Opt-OUT of everything → never appears.
  seedCompany({ id: optOutId, name: "OptOut Co", sector: SECTOR, privacy: OPT_OUT });
  // Same-chapter chapter-only company (caller IS in this chapter) with a
  // distinctive narrative that must stay redacted from the aggregate.
  seedCompany({
    id: chapterOnlyId, name: "Chapter Only Co", sector: SECTOR,
    privacy: CHAPTER_ONLY, chapter: h.ids.CHAPTER, narrative: NARRATIVE,
  });
  // Fresh company with a TRULY NULL ma_privacy_json (no consent row at all).
  // Has real M&A data but NULL privacy → must default to opt-OUT for Collective.
  seedCompany({ id: nullPrivacyId, name: "Null Privacy Co", sector: SECTOR, privacy: OPT_IN });
  rawDb().prepare(`UPDATE companies SET ma_privacy_json = NULL WHERE id = ?`).run(nullPrivacyId);
}, 60_000);
afterAll(async () => { await h.teardown(); });

describe("v25.44 S13 M&A privacy gate — E2E (round 2)", () => {
  it("0. unauth blocked", async () => {
    const r = await h.reqNoAuth("GET", "/api/collective/ma-intel?view=pipeline");
    record("unauth blocked", [401, 403].includes(r.status), `status ${r.status}`);
    expect([401, 403]).toContain(r.status);
  });

  it("1. opt-OUT company excluded from cross-Collective benchmark scope", async () => {
    const r = await h.req("GET", "/api/collective/ma-intel?view=benchmarks", { userId: h.ids.MEMBER });
    expect(r.status).toBe(200);
    const sector = (r.body?.sectors ?? []).find((s) => s.sector === SECTOR);
    // Visible to MEMBER: optIn (collective) + chapterOnly (same chapter) = n 2.
    // optOut + nullPrivacy must be excluded.
    const ok = sector && sector.n === 2;
    record("opt-out + null-privacy excluded (n=2)", ok, `n=${sector?.n}`);
    expect(ok).toBe(true);
  });

  it("2. NEW — fresh company with NULL ma_privacy_json defaults to opt-OUT for Collective", async () => {
    // A member NOT in the company's chapter and with no collective opt-in must
    // never see the null-privacy company. We assert it's absent from pipeline.
    const r = await h.req("GET", "/api/collective/ma-intel?view=pipeline", { userId: h.ids.MEMBER });
    const b = r.body?.buckets;
    const all = [...(b?.active_negotiation ?? []), ...(b?.outbound ?? []), ...(b?.inbound ?? [])];
    const leaked = all.some((x) => x.companyId === nullPrivacyId);
    record("null ma_privacy_json → opt-OUT default (excluded)", !leaked);
    expect(leaked).toBe(false);
  });

  it("3. opt-IN company appears in pipeline scope", async () => {
    const r = await h.req("GET", "/api/collective/ma-intel?view=pipeline", { userId: h.ids.MEMBER });
    expect(r.status).toBe(200);
    const b = r.body?.buckets;
    const all = [...(b?.active_negotiation ?? []), ...(b?.outbound ?? []), ...(b?.inbound ?? [])];
    const seenOptIn = all.some((x) => x.companyId === optInId) || (b?.none?.count ?? 0) >= 1;
    record("opt-in company within scope", seenOptIn);
    expect(seenOptIn).toBe(true);
  });

  it("4. opt-OUT company NEVER appears as an attributed pipeline row", async () => {
    const r = await h.req("GET", "/api/collective/ma-intel?view=pipeline", { userId: h.ids.MEMBER });
    const b = r.body?.buckets;
    const all = [...(b?.active_negotiation ?? []), ...(b?.outbound ?? []), ...(b?.inbound ?? [])];
    const leaked = all.some((x) => x.companyId === optOutId);
    record("opt-out NOT leaked", !leaked);
    expect(leaked).toBe(false);
  });

  it("5. NEW — same-chapter shareWithChapter=true company is visible to chapter peer, narrative redacted", async () => {
    const r = await h.req("GET", "/api/collective/ma-intel?view=pipeline", { userId: h.ids.MEMBER });
    const b = r.body?.buckets;
    const all = [...(b?.active_negotiation ?? []), ...(b?.outbound ?? []), ...(b?.inbound ?? [])];
    const seen = all.some((x) => x.companyId === chapterOnlyId) || (b?.none?.count ?? 0) >= 1;
    const narrativeLeaked = JSON.stringify(r.body).includes(NARRATIVE);
    const ok = seen && !narrativeLeaked;
    record("chapter peer sees chapter-only co, narrative redacted", ok, `seen=${seen} narrativeLeaked=${narrativeLeaked}`);
    expect(ok).toBe(true);
  });

  it("6. NEW — legacy /api/investor/ma/intelligence/:companyId returns 403 for unauthorized requester", async () => {
    // MEMBER is not a member of optOutId's company and optOutId opted out of
    // everything → the legacy endpoint must 403 (no bypass of the privacy gate).
    const r = await h.req("GET", `/api/investor/ma/intelligence/${optOutId}`, { userId: h.ids.MEMBER });
    record("legacy endpoint 403 for unauthorized", r.status === 403, `status ${r.status}`);
    expect(r.status).toBe(403);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.44 S13 privacy gate E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
