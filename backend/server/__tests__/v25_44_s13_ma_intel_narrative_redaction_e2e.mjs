/* v25.44 S13 — M&A Intelligence NARRATIVE REDACTION E2E (ROUND 2 strengthened).
 *
 * Stores a DISTINCTIVE narrative string in the company's real Step 4 profile,
 * then proves:
 *   - The string NEVER appears ANYWHERE in the /api/collective/ma-intel
 *     aggregate response (any view) for a non-authorized member.
 *   - The string DOES appear in the FOUNDER's per-company detail view
 *     (legacy /api/investor/ma/intelligence/:companyId as the company founder).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setup, recorder } from "./v25_42_helpers.mjs";
import { seedCompany, OPT_IN } from "./v25_44_ma_seed.mjs";

let h; const { results, record } = recorder();
const STAMP = Date.now();
const SECTOR = `NarrSect_${STAMP}`;
const DISTINCT = `ZZZ_DISTINCT_NARRATIVE_${STAMP}_QQQ`;
const founderCo = `co_narr_founder_${STAMP}`;
let founderUserId;

beforeAll(async () => {
  h = await setup("s13narr");
  founderUserId = `u_narr_founder_${STAMP}`;
  // 6 opted-in companies so benchmarks render; one carries the distinctive
  // narrative AND a company_members row making founderUserId its founder.
  seedCompany({
    id: founderCo, name: "Narr Founder Co", sector: SECTOR, privacy: OPT_IN,
    narrative: DISTINCT, memberUserId: founderUserId,
  });
  for (let i = 0; i < 5; i++) {
    seedCompany({ id: `co_narr_${STAMP}_${i}`, name: `Narr ${i}`, sector: SECTOR, privacy: OPT_IN });
  }
}, 60_000);
afterAll(async () => { await h.teardown(); });

describe("v25.44 S13 narrative redaction — E2E (round 2)", () => {
  for (const view of ["dashboard_card", "pipeline", "comps", "benchmarks"]) {
    it(`${view}: distinctive narrative string absent from entire JSON response`, async () => {
      const r = await h.req("GET", `/api/collective/ma-intel?view=${view}`, { userId: h.ids.MEMBER });
      expect(r.status).toBe(200);
      // The CORE assertion: the actual stored narrative content must not appear.
      const leaked = JSON.stringify(r.body).includes(DISTINCT);
      record(`${view}: stored narrative content redacted`, !leaked);
      expect(leaked).toBe(false);
    });
  }

  it("founder per-company detail view DOES contain the narrative", async () => {
    // The founder of founderCo (a company_members row) gets FULL detail incl.
    // narrative via the gated legacy endpoint.
    const r = await h.req("GET", `/api/investor/ma/intelligence/${founderCo}`, { userId: founderUserId });
    expect(r.status).toBe(200);
    const present = JSON.stringify(r.body).includes(DISTINCT);
    record("founder sees their own narrative", present, `accessLevel=${r.body?.accessLevel}`);
    expect(present).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.44 S13 narrative redaction E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
