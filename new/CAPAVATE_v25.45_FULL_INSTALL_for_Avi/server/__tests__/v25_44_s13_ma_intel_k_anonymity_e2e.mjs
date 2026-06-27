/* v25.44 S13 — M&A Intelligence K-ANONYMITY E2E.
 * Seeds <5 opted-in companies in one sector and >=5 in another; asserts
 * INSUFFICIENT_DATA for the small sector and OK (medians present) for the large. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setup, recorder } from "./v25_42_helpers.mjs";
import { seedCompany, OPT_IN } from "./v25_44_ma_seed.mjs";
let h; const { results, record } = recorder();
const STAMP = Date.now();
const SMALL = `KSmall_${STAMP}`;   // 3 companies → INSUFFICIENT_DATA
const LARGE = `KLarge_${STAMP}`;   // 6 companies → OK
beforeAll(async () => {
  h = await setup("s13k");
  for (let i = 0; i < 3; i++) seedCompany({ id: `co_ksm_${STAMP}_${i}`, name: `Small ${i}`, sector: SMALL, privacy: OPT_IN });
  for (let i = 0; i < 6; i++) seedCompany({ id: `co_klg_${STAMP}_${i}`, name: `Large ${i}`, sector: LARGE, privacy: OPT_IN });
}, 60_000);
afterAll(async () => { await h.teardown(); });
describe("v25.44 S13 k-anonymity — E2E", () => {
  it("1. small sector (n<5) → INSUFFICIENT_DATA, medians null", async () => {
    const r = await h.req("GET", "/api/collective/ma-intel?view=benchmarks", { userId: h.ids.MEMBER });
    expect(r.status).toBe(200);
    const s = (r.body.sectors ?? []).find((x) => x.sector === SMALL);
    const ok = s && s.n === 3 && s.status === "INSUFFICIENT_DATA" && s.medians === null;
    record("n<5 → INSUFFICIENT_DATA + null medians", ok, JSON.stringify(s));
    expect(ok).toBe(true);
  });
  it("2. large sector (n>=5) → OK, medians present", async () => {
    const r = await h.req("GET", "/api/collective/ma-intel?view=benchmarks", { userId: h.ids.MEMBER });
    const s = (r.body.sectors ?? []).find((x) => x.sector === LARGE);
    const ok = s && s.n === 6 && s.status === "OK" && s.medians && typeof s.medians.maScore === "number";
    record("n>=5 → OK + medians", ok, JSON.stringify(s?.status));
    expect(ok).toBe(true);
  });

  it("3. NEW — benchmark sector filter is HONORED server-side (additional fix)", async () => {
    // Filtering to the LARGE sector must return ONLY that sector (the SMALL one
    // is filtered out before medians are computed). Round-1 ignored filters.
    const r = await h.req("GET", `/api/collective/ma-intel?view=benchmarks&sector=${encodeURIComponent(LARGE)}`, { userId: h.ids.MEMBER });
    expect(r.status).toBe(200);
    const sectors = r.body.sectors ?? [];
    const hasLarge = sectors.some((x) => x.sector === LARGE);
    const hasSmall = sectors.some((x) => x.sector === SMALL);
    const ok = hasLarge && !hasSmall;
    record("benchmark sector filter honored", ok, `large=${hasLarge} small=${hasSmall}`);
    expect(ok).toBe(true);
  });

  it("4. NEW — benchmark scoreMin filter narrows the scope before medians", async () => {
    // scoreMin above any company's maScore yields an empty (or smaller) sector set.
    const r = await h.req("GET", "/api/collective/ma-intel?view=benchmarks&scoreMin=101", { userId: h.ids.MEMBER });
    expect(r.status).toBe(200);
    const sectors = r.body.sectors ?? [];
    const ok = !sectors.some((x) => x.sector === LARGE && x.n > 0);
    record("scoreMin filter narrows scope", ok, `sectors=${sectors.length}`);
    expect(ok).toBe(true);
  });
  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.44 S13 k-anonymity E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
