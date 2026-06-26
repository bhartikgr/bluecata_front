/* v25.44 S14 — Venture markets seed E2E: 11 records, NO fake numbers (pending → null). */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setup, recorder } from "./v25_42_helpers.mjs";
let h; const { results, record } = recorder();
beforeAll(async () => { h = await setup("s14seed"); }, 60_000);
afterAll(async () => { await h.teardown(); });
describe("v25.44 S14 venture markets seed — E2E", () => {
  it("0. unauth blocked", async () => {
    const r = await h.reqNoAuth("GET", "/api/feeds/venture-markets");
    record("unauth blocked", [401, 403].includes(r.status), `status ${r.status}`);
    expect([401, 403]).toContain(r.status);
  });
  it("1. member → status OK, 11 records", async () => {
    const r = await h.req("GET", "/api/feeds/venture-markets", { userId: h.ids.MEMBER });
    const ok = r.status === 200 && r.body?.status === "OK" && Array.isArray(r.body?.records) && r.body.records.length === 11;
    record("11 records, status OK", ok, `n=${r.body?.records?.length}`);
    expect(ok).toBe(true);
  });
  it("2. pending boards render null (no fabricated numbers)", async () => {
    const r = await h.req("GET", "/api/feeds/venture-markets", { userId: h.ids.MEMBER });
    const symbols = r.body.records.map((x) => x.exchangeSymbol);
    const required = ["ChiNext", "STAR", "BSE", "KOSDAQ", "KONEX", "TSXV", "NCM", "NYSE American", "AIM", "First North", "Euronext Growth"];
    const allPresent = required.every((s) => symbols.includes(s));
    record("all 11 required markets present", allPresent);
    const pending = ["ChiNext", "STAR", "BSE", "KONEX", "NCM", "NYSE American"];
    const allNull = pending.every((s) => r.body.records.find((x) => x.exchangeSymbol === s)?.marketValue === null);
    record("pending boards are null (no fake data)", allNull);
    expect(allPresent && allNull).toBe(true);
  });
  it("3. metricType default = issuer_count", async () => {
    const r = await h.req("GET", "/api/feeds/venture-markets", { userId: h.ids.MEMBER });
    record("metricType issuer_count", r.body.metricType === "issuer_count", r.body.metricType);
    expect(r.body.metricType).toBe("issuer_count");
  });
  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.44 S14 venture seed E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
