/* v25.45 F2 — Step 4 (Strategic Intent / M&A) persistence. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupFounder, recorder } from "./v25_45_helpers.mjs";
let h; const { results, record } = recorder();
beforeAll(async () => { h = await setupFounder("f2s4"); }, 60_000);
afterAll(async () => { await h.teardown(); });

describe("v25.45 F2 Step 4 persistence — E2E", () => {
  it("1. patch ma narrative + UVP → 200", async () => {
    const r = await h.patchProfile({ ma: {
      maReadinessNarrative: "We are audit-ready and have clean IP.",
      uniqueValueProposition: "Lowest-cost autonomous robotics platform.",
    }});
    const ok = r.status === 200 && r.body?.ma?.uniqueValueProposition?.startsWith("Lowest-cost");
    record("ma narrative/UVP patch → 200", ok, `status ${r.status}`);
    expect(ok).toBe(true);
  });
  it("2. persisted durably", async () => {
    const d = h.readDurable();
    const ok = d?.ma?.maReadinessNarrative?.startsWith("We are audit-ready");
    record("durable row has ma narrative", ok, `narrative ${String(d?.ma?.maReadinessNarrative).slice(0,20)}`);
    expect(ok).toBe(true);
  });
  it("3. F19 readiness sliders + transaction status persist", async () => {
    const r = await h.patchProfile({ ma: {
      readiness: {
        ipDueDiligence: 80, customerContracts: 60, financialAudit: 90,
        dataRoomOrganization: 70, regulatoryFilings: 50, esgDisclosure: 40,
        transactionStatus: "exploring",
      },
    }});
    const d = h.readDurable();
    const ok = r.status === 200 && d?.ma?.readiness?.financialAudit === 90
      && d?.ma?.readiness?.transactionStatus === "exploring";
    record("ma.readiness persists", ok, `status ${r.status} fa ${d?.ma?.readiness?.financialAudit}`);
    expect(ok).toBe(true);
  });
  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.45 F2 Step4 E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
