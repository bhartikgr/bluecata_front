/* v25.44 S14 — Venture markets widget source-render assertions (registry + known values). */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setup, recorder } from "./v25_42_helpers.mjs";
let h; const { results, record } = recorder();
beforeAll(async () => { h = await setup("s14wr"); }, 60_000);
afterAll(async () => { await h.teardown(); });
describe("v25.44 S14 venture widget render — E2E", () => {
  it("1. TSXV high-confidence baseline = 2418", async () => {
    const r = await h.req("GET", "/api/feeds/venture-markets", { userId: h.ids.MEMBER });
    const tsxv = r.body.records.find((x) => x.exchangeSymbol === "TSXV");
    const ok = tsxv?.marketValue === 2418 && tsxv?.confidence === "high";
    record("TSXV 2418 high", ok, JSON.stringify(tsxv?.marketValue));
    expect(ok).toBe(true);
  });
  it("2. AIM baseline = 787", async () => {
    const r = await h.req("GET", "/api/feeds/venture-markets", { userId: h.ids.MEMBER });
    const aim = r.body.records.find((x) => x.exchangeSymbol === "AIM");
    record("AIM 787", aim?.marketValue === 787, JSON.stringify(aim?.marketValue));
    expect(aim?.marketValue).toBe(787);
  });
  it("3. each record has displayFlag + exchangeName for render", async () => {
    const r = await h.req("GET", "/api/feeds/venture-markets", { userId: h.ids.MEMBER });
    const ok = r.body.records.every((x) => typeof x.displayFlag === "string" && x.displayFlag.length > 0 && typeof x.exchangeName === "string");
    record("flag + name present", ok);
    expect(ok).toBe(true);
  });
  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.44 S14 venture widget render E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
