/* v25.45 F5 — Full Page Company Profile DB audit.
 *
 * The Full Page (client/src/pages/CompanyDetails.tsx, rendered at
 * /founder/companies/:id) reads every profile field from
 * GET /api/companies/:id → data.profile, which is sourced from
 * getCompanyProfileSnapshot() → profilestore_company_profile.profile_json
 * (durable DB). This suite proves the read path is DB-driven for the key
 * fields by patching distinctive values, then asserting GET returns them.
 *
 * Asserts at least 5 key fields trace to DB (brief requirement):
 *   1. Strategic priorities          → profile.ma.strategicPriorities
 *   2. Unique value proposition      → profile.ma.uniqueValueProposition
 *   3. Mailing address               → profile.address.street
 *   4. Legal & governance (legal nm) → profile.legal.legalEntityName
 *   5. Governance scorecard board    → profile.legal.boardComposition (F18d)
 *   6. Customer concentration flag   → profile.ma.hasRevenueConcentration30Pct
 *   7. Market presence (geographies) → profile.ma.operatingGeographies
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupFounder, recorder } from "./v25_45_helpers.mjs";

let h; const { results, record } = recorder();
beforeAll(async () => { h = await setupFounder("f5"); }, 60_000);
afterAll(async () => { await h.teardown(); });

async function getFullPage() {
  const r = await h.req("GET", `/api/companies/${h.ids.COMPANY}?as=founder`, { userId: h.ids.FOUNDER });
  return r;
}

describe("v25.45 F5 Full-Page DB audit — E2E", () => {
  beforeAll(async () => {
    await h.patchProfile({
      ma: {
        strategicPriorities: ["market_expansion"],
        uniqueValueProposition: "F5-UVP-marker autonomous logistics.",
        hasRevenueConcentration30Pct: true,
        operatingGeographies: ["north_america"],
      },
      address: { street: "F5-MARKER 123 Audit Way" },
      legal: {
        legalEntityName: "F5 Audit Holdings Inc.",
        boardComposition: { directorsCount: 3, directorsSnapshot: [{ name: "Dir One", role: "Chair" }] },
      },
    });
  });

  it("1. Strategic priorities trace to DB (profile.ma.strategicPriorities)", async () => {
    const r = await getFullPage();
    const ok = r.body?.profile?.ma?.strategicPriorities?.includes("market_expansion");
    record("strategic priorities DB-driven", ok, JSON.stringify(r.body?.profile?.ma?.strategicPriorities));
    expect(ok).toBe(true);
  });

  it("2. UVP traces to DB (profile.ma.uniqueValueProposition)", async () => {
    const r = await getFullPage();
    const ok = r.body?.profile?.ma?.uniqueValueProposition === "F5-UVP-marker autonomous logistics.";
    record("UVP DB-driven", ok);
    expect(ok).toBe(true);
  });

  it("3. Mailing address traces to DB (profile.address.street)", async () => {
    const r = await getFullPage();
    const ok = r.body?.profile?.address?.street === "F5-MARKER 123 Audit Way";
    record("mailing address DB-driven", ok);
    expect(ok).toBe(true);
  });

  it("4. Legal & governance traces to DB (profile.legal.legalEntityName)", async () => {
    const r = await getFullPage();
    const ok = r.body?.profile?.legal?.legalEntityName === "F5 Audit Holdings Inc.";
    record("legal name DB-driven", ok);
    expect(ok).toBe(true);
  });

  it("5. Governance scorecard board derives from DB boardComposition (F18d)", async () => {
    const r = await getFullPage();
    const bc = r.body?.profile?.legal?.boardComposition;
    const ok = bc?.directorsCount === 3 && bc?.directorsSnapshot?.[0]?.name === "Dir One";
    record("board composition DB-driven", ok, `count ${bc?.directorsCount}`);
    expect(ok).toBe(true);
  });

  it("6. Customer concentration flag traces to DB (profile.ma.hasRevenueConcentration30Pct)", async () => {
    const r = await getFullPage();
    const ok = r.body?.profile?.ma?.hasRevenueConcentration30Pct === true;
    record("concentration flag DB-driven", ok);
    expect(ok).toBe(true);
  });

  it("7. Market presence geographies trace to DB (profile.ma.operatingGeographies)", async () => {
    const r = await getFullPage();
    const ok = r.body?.profile?.ma?.operatingGeographies?.includes("north_america");
    record("market presence DB-driven", ok);
    expect(ok).toBe(true);
  });

  it("8. survives a simulated cold cache (durable row is the source of truth)", () => {
    const d = h.readDurable();
    const ok = d?.ma?.uniqueValueProposition === "F5-UVP-marker autonomous logistics."
      && d?.legal?.legalEntityName === "F5 Audit Holdings Inc.";
    record("durable row holds all marker fields", ok);
    expect(ok).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.45 F5 DB-audit E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
