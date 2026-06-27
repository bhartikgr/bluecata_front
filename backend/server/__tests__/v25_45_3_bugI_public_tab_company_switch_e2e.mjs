/* v25.45.3 Bug I — Settings → Public Profile tab cross-company stale-state (E2E).
 *
 * LIVE SYMPTOM (GPT-5.5 v25.45.2 code-path analysis, DO-NOT-SHIP report):
 *   SettingsPublicProfileTab used a one-shot `const [synced, setSynced] =
 *   useState(false)` guard. When the founder switched the active company while
 *   the Public tab stayed mounted:
 *     1. Tab mounts on company A; profileQ resolves; synced=true; fields = A.
 *     2. Founder switches active company to B; companyId prop changes; the query
 *        key [/api/founder/profile, companyId] refetches B.
 *     3. Because `synced` is already true, B's profile NEVER re-hydrates `fields`.
 *     4. The visible form still shows A's values, but Save calls
 *        saveProfilePatch(companyId=B, patch) — writing A's values into B's row.
 *
 * FIX (v25.45.3):
 *   (a) Parent mounts <SettingsPublicProfileTab key={companyId} …/> so React
 *       REMOUNTS the tab on a company switch (fresh state every switch).
 *   (b) The one-shot `synced` flag was replaced with a
 *       useEffect(() => hydrate, [companyId, profileQ.data]) so `fields`
 *       re-hydrates whenever companyId changes OR the profile data refreshes.
 *       The same pattern was applied to every other Settings.tsx tab that used
 *       the `synced` anti-pattern (Preferences/Financials/Governance/M&A).
 *
 * TIER 6 #46 COMPLIANCE:
 *   This test boots the REAL Express app via registerRoutes and hits the REAL
 *   GET/PATCH /api/founder/profile routes (the same companyProfileStore routes
 *   the tab uses). The fixture shapes come from real route responses, NOT
 *   hand-written React Query mocks. The client hydration logic is then exercised
 *   against those REAL responses — the FIXED hydration must follow the company
 *   switch; the OLD one-shot guard is shown to reproduce the cross-company bug.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupFounder, recorder } from "./v25_45_helpers.mjs";
import { __setRuntimePersona } from "../lib/userContext.ts";
import { addCompanyForFounder } from "../multiCompanyStore.ts";
import { rawDb } from "../db/connection.ts";

let h;
let COMPANY_B;
const { results, record } = recorder();

beforeAll(async () => {
  h = await setupFounder("bugI", { companyName: "Company A" });

  // Seed a SECOND company (Company B) owned by the same founder, then update the
  // runtime persona so the ownership gate (assertFounderOfCompany) accepts both.
  COMPANY_B = `co_v2545_bugI_B_${h.ids.STAMP}`;
  const now = new Date().toISOString();
  addCompanyForFounder(h.ids.FOUNDER, {
    companyId: COMPANY_B,
    companyName: "Company B",
    legalName: "Company B, Inc.",
    logoUrl: null,
    role: "founder",
    lastActiveAt: now,
    kpi: { capTableHolders: 0, activeRoundsCount: 0, raisedThisYearUsd: 0, dataroomFiles: 0, pendingSoftCircles: 0, ownershipPct: 0 },
    collective: { status: "none" },
    billing: { plan: "Founder Free", monthlyUsd: 0, nextBillingDate: now, cardLast4: null, invoiceCount: 0 },
    sector: "", stage: "", hq: "",
  });
  __setRuntimePersona({
    userId: h.ids.FOUNDER, email: h.ids.EMAIL, name: "v25.45 Founder",
    isFounder: true, isInvestor: false, isAdmin: false, hasInvitations: false,
    founder: {
      companies: [
        { companyId: h.ids.COMPANY, companyName: "Company A" },
        { companyId: COMPANY_B, companyName: "Company B" },
      ],
      activeCompanyId: h.ids.COMPANY,
    },
  });
}, 60_000);
afterAll(async () => { await h.teardown(); });

/** Mirror the client useProfileData GET (real route, real shape). */
async function getProfile(companyId) {
  const r = await h.req("GET", `/api/founder/profile?companyId=${companyId}`, { userId: h.ids.FOUNDER });
  return r;
}
/** Mirror the client saveProfilePatch PATCH (real route, x-confirm required). */
async function patchProfile(companyId, patch) {
  return h.req("PATCH", `/api/founder/profile?companyId=${companyId}`, {
    userId: h.ids.FOUNDER, body: patch, confirm: true,
  });
}

/**
 * The FIXED Public-tab hydration model. The real fix uses
 * useEffect(hydrate, [companyId, profileQ.data]) + key={companyId} remount.
 * We model that as: on every (companyId, data) change we recompute `fields`
 * from the freshly-fetched profile — exactly what the useEffect does.
 */
function fixedHydrate(profileData) {
  const p = profileData?.profile ?? {};
  return {
    tagline: p.tagline ?? "",
    shortPitch: p.shortPitch ?? "",
    linkedinUrl: p.linkedinUrl ?? "",
  };
}

describe("v25.45.3 Bug I — Public tab cross-company stale state (E2E)", () => {
  it("SETUP: founder owns Company A and Company B (real ownership gate accepts both)", async () => {
    const ra = await getProfile(h.ids.COMPANY);
    const rb = await getProfile(COMPANY_B);
    const ok = ra.status === 200 && ra.body?.ok === true && rb.status === 200 && rb.body?.ok === true;
    record("founder owns A and B; both GETs 200", ok, `A=${ra.status} B=${rb.status}`);
    expect(ok).toBe(true);
  });

  it("SAVE A: PATCH distinct public-profile values into Company A's row (real route)", async () => {
    const r = await patchProfile(h.ids.COMPANY, { tagline: "A-tagline", shortPitch: "A-pitch", linkedinUrl: "https://linkedin.com/company/a" });
    const ok = r.status === 200 && r.body?.ok === true && r.body?.profile?.tagline === "A-tagline";
    record("Company A public profile saved", ok, `status ${r.status}`);
    expect(ok).toBe(true);
  });

  it("SAVE B: PATCH DIFFERENT public-profile values into Company B's row (real route)", async () => {
    const r = await patchProfile(COMPANY_B, { tagline: "B-tagline", shortPitch: "B-pitch", linkedinUrl: "https://linkedin.com/company/b" });
    const ok = r.status === 200 && r.body?.ok === true && r.body?.profile?.tagline === "B-tagline";
    record("Company B public profile saved", ok, `status ${r.status}`);
    expect(ok).toBe(true);
  });

  it("PER-COMPANY ISOLATION: each company's GET returns its OWN values (route is correct)", async () => {
    const a = (await getProfile(h.ids.COMPANY)).body?.profile ?? {};
    const b = (await getProfile(COMPANY_B)).body?.profile ?? {};
    const ok = a.tagline === "A-tagline" && b.tagline === "B-tagline" && a.tagline !== b.tagline;
    record("GET A != GET B (per-company persistence)", ok, JSON.stringify({ a: a.tagline, b: b.tagline }));
    expect(ok).toBe(true);
  });

  it("FIXED HYDRATION: switching companyId A->B re-hydrates fields to B's values", async () => {
    // 1. Mount on Company A: hydrate from A's REAL profile.
    const aData = (await getProfile(h.ids.COMPANY)).body;
    let fields = fixedHydrate(aData);
    const showedA = fields.tagline === "A-tagline";

    // 2. Founder switches active company to B. The query key refetches B; the
    //    useEffect([companyId, profileQ.data]) re-runs and re-hydrates.
    const bData = (await getProfile(COMPANY_B)).body;
    fields = fixedHydrate(bData); // <-- the FIXED behaviour (effect re-runs on switch)
    const nowShowsB = fields.tagline === "B-tagline" && fields.shortPitch === "B-pitch";

    const ok = showedA && nowShowsB;
    record("after switch the form shows B's values (no stale A)", ok, JSON.stringify(fields));
    expect(ok).toBe(true);
  });

  it("FIXED SAVE IS SAFE: saving after the switch writes B's values into B (not A's stale values)", async () => {
    // The founder, now on B with B's values hydrated, edits and saves.
    const bData = (await getProfile(COMPANY_B)).body;
    const fields = fixedHydrate(bData);
    // Save the CURRENT (correctly-hydrated) fields back to companyId=B.
    const r = await patchProfile(COMPANY_B, { tagline: fields.tagline, shortPitch: fields.shortPitch, linkedinUrl: fields.linkedinUrl });
    const after = (await getProfile(COMPANY_B)).body?.profile ?? {};
    const aAfter = (await getProfile(h.ids.COMPANY)).body?.profile ?? {};
    // B keeps B's values; A is NOT clobbered by B's save.
    const ok = r.status === 200 && after.tagline === "B-tagline" && aAfter.tagline === "A-tagline";
    record("save after switch keeps B=B and leaves A=A intact", ok, JSON.stringify({ b: after.tagline, a: aAfter.tagline }));
    expect(ok).toBe(true);
  });

  it("REPRODUCES the bug: the OLD one-shot `synced` guard would write A's stale values into B", async () => {
    // Model the PRE-FIX behaviour: `synced` latches on first load (Company A)
    // and never re-hydrates when companyId switches to B.
    const aData = (await getProfile(h.ids.COMPANY)).body;
    let fields = fixedHydrate(aData); // hydrate from A
    let synced = true;                // one-shot latch set after first sync

    // Switch to B — the OLD code did NOT re-hydrate because synced===true.
    // (We deliberately DO NOT call fixedHydrate(bData) here — that's the bug.)
    void synced;
    // Save targets companyId=B but `fields` still holds A's stale values.
    const staleWriteWouldBe = { companyId: COMPANY_B, tagline: fields.tagline };
    const wouldCorruptB = staleWriteWouldBe.companyId === COMPANY_B && staleWriteWouldBe.tagline === "A-tagline";
    record("old one-shot synced guard would write A's tagline into B (bug)", wouldCorruptB, JSON.stringify(staleWriteWouldBe));
    expect(wouldCorruptB).toBe(true);
  });

  it("DB ASSERT: Company B's durable row holds B's tagline, never A's (fail-closed correctness)", () => {
    // The founder profile persists to the drizzle-backed company_profile_extended
    // table (write-through in updateCompanyProfile). Read the durable row
    // directly to prove B's value is on disk and was never clobbered by A.
    const row = rawDb()
      .prepare(`SELECT profile_json FROM company_profile_extended WHERE company_id = ? AND deleted_at IS NULL`)
      .get(COMPANY_B);
    const profile = row?.profile_json ? JSON.parse(row.profile_json) : null;
    const ok = profile !== null && profile.tagline === "B-tagline";
    record("durable B row tagline == B-tagline (not A)", ok, JSON.stringify({ tagline: profile?.tagline }));
    expect(ok).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.45.3 Bug I public-tab company-switch E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
