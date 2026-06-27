/* v25.45 F2 — Step 3 (Legal Entity Info) persistence.
 * Also guards the legal-default regression: the old client fallback seeded
 * kycVariant:"standard" + null listing fields, which the schema rejected. We
 * assert a realistic legal block (derived US defaults) persists cleanly.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupFounder, recorder } from "./v25_45_helpers.mjs";
let h; const { results, record } = recorder();
beforeAll(async () => { h = await setupFounder("f2s3"); }, 60_000);
afterAll(async () => { await h.teardown(); });

describe("v25.45 F2 Step 3 persistence — E2E", () => {
  it("1. patch legal single field → 200", async () => {
    const r = await h.patchProfile({ legal: { legalEntityName: "Acme Robotics, Inc." } });
    const ok = r.status === 200 && r.body?.legal?.legalEntityName === "Acme Robotics, Inc.";
    record("legal name patch → 200", ok, `status ${r.status} ${JSON.stringify(r.body?.errors ?? "")}`);
    expect(ok).toBe(true);
  });
  it("2. patch jurisdiction re-derives region/kyc + persists", async () => {
    const r = await h.patchProfile({ legal: {
      legalEntityName: "Acme Robotics, Inc.", countryOfIncorporationCode: "US",
      entityType: null, isPubliclyTraded: false, registeredOfficeAddress: "1 Market St",
      businessNumber: "12-3456789", listingCountryCode: "", exchangeCode: "", tickerSymbol: "",
    }});
    const d = h.readDurable();
    const ok = r.status === 200 && d?.legal?.registeredOfficeAddress === "1 Market St"
      && typeof d?.legal?.kycVariant === "string" && d?.legal?.kycVariant.length > 0;
    record("jurisdiction patch persists + valid kycVariant", ok, `status ${r.status} kyc ${d?.legal?.kycVariant}`);
    expect(ok).toBe(true);
  });
  it("3. boardComposition (F18c) sub-field persists", async () => {
    const r = await h.patchProfile({ legal: {
      boardComposition: { directorsCount: 3, directorsSnapshot: [{ name: "A. Director", role: "Chair" }] },
    }});
    const d = h.readDurable();
    const ok = r.status === 200 && d?.legal?.boardComposition?.directorsCount === 3
      && Array.isArray(d?.legal?.boardComposition?.directorsSnapshot)
      && d.legal.boardComposition.directorsSnapshot.length === 1;
    record("legal.boardComposition persists", ok, `status ${r.status} count ${d?.legal?.boardComposition?.directorsCount}`);
    expect(ok).toBe(true);
  });
  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.45 F2 Step3 E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
