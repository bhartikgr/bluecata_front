/* v25.44 S14 — Venture markets provenance E2E: every record has asOfDate+source+confidence. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setup, recorder } from "./v25_42_helpers.mjs";
let h; const { results, record } = recorder();
beforeAll(async () => { h = await setup("s14prov"); }, 60_000);
afterAll(async () => { await h.teardown(); });
describe("v25.44 S14 venture provenance — E2E", () => {
  it("1. every record has asOfDate + source + confidence", async () => {
    const r = await h.req("GET", "/api/feeds/venture-markets", { userId: h.ids.MEMBER });
    expect(r.status).toBe(200);
    const valid = (r.body.records ?? []).every((x) =>
      typeof x.asOfDate === "string" && x.asOfDate.length >= 8 &&
      typeof x.source === "string" && x.source.length > 0 &&
      ["high", "medium", "low", "estimated"].includes(x.confidence));
    record("provenance on every record", valid);
    expect(valid).toBe(true);
  });
  it("2. estimated rows carry estimated:true", async () => {
    const r = await h.req("GET", "/api/feeds/venture-markets", { userId: h.ids.MEMBER });
    const kosdaq = r.body.records.find((x) => x.exchangeSymbol === "KOSDAQ");
    record("KOSDAQ ecosystem flagged estimated", kosdaq?.estimated === true, JSON.stringify(kosdaq?.estimated));
    expect(kosdaq?.estimated).toBe(true);
  });
  it("3. sorted DESC by marketValue (nulls last)", async () => {
    const r = await h.req("GET", "/api/feeds/venture-markets", { userId: h.ids.MEMBER });
    const vals = r.body.records.map((x) => x.marketValue);
    let okSorted = true;
    const nums = vals.filter((v) => v != null);
    for (let i = 1; i < nums.length; i++) if (nums[i] > nums[i - 1]) okSorted = false;
    const firstNullIdx = vals.findIndex((v) => v == null);
    const nullsLast = firstNullIdx === -1 || vals.slice(firstNullIdx).every((v) => v == null);
    record("DESC sort, nulls last", okSorted && nullsLast);
    expect(okSorted && nullsLast).toBe(true);
  });
  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.44 S14 venture provenance E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
