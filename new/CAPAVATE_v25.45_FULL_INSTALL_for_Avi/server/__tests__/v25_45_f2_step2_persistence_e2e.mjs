/* v25.45 F2 — Step 2 (Mailing Address) persistence. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupFounder, recorder } from "./v25_45_helpers.mjs";
let h; const { results, record } = recorder();
beforeAll(async () => { h = await setupFounder("f2s2"); }, 60_000);
afterAll(async () => { await h.teardown(); });

describe("v25.45 F2 Step 2 persistence — E2E", () => {
  it("1. patch address → 200", async () => {
    const r = await h.patchProfile({ address: {
      street: "1 Market St", unitSuite: "Suite 400", city: "San Francisco",
      stateProvince: "CA", postalCode: "94105", countryCode: "US",
    }});
    const ok = r.status === 200 && r.body?.address?.city === "San Francisco";
    record("address patch → 200", ok, `status ${r.status}`);
    expect(ok).toBe(true);
  });
  it("2. persisted durably", async () => {
    const d = h.readDurable();
    const ok = d?.address?.street === "1 Market St" && d?.address?.postalCode === "94105";
    record("durable row has address", ok, `street ${d?.address?.street}`);
    expect(ok).toBe(true);
  });
  it("3. partial address edit (single field) → 200 + persists", async () => {
    const r = await h.patchProfile({ address: { city: "Oakland" } });
    const d = h.readDurable();
    const ok = r.status === 200 && d?.address?.city === "Oakland" && d?.address?.street === "1 Market St";
    record("single-field address patch merges + persists", ok, `status ${r.status} city ${d?.address?.city}`);
    expect(ok).toBe(true);
  });
  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.45 F2 Step2 E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
