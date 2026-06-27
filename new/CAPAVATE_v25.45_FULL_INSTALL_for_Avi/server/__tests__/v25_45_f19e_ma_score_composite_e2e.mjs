/* v25.45 F19e — maScore composite folds in the new readiness sliders (50%).
 *
 * v25.45 ROUND 2 (BLOCKER 4) — REWRITTEN. The original test (lines 26-40)
 * encoded the regression as expected behaviour: it asserted that an all-zero
 * readiness block (transactionStatus='not_pursuing') still blended to HALF the
 * existing qualitative sub-score. That silently halved strong v25.44 scores
 * (80 → 40) the moment the Step-4 UI initialised an all-zero readiness block.
 *
 * Correct expectations (matching the round-2 backward-compat guard):
 *   1. All-zero readiness + transactionStatus='not_pursuing' → the maScore is
 *      UNCHANGED from the no-readiness baseline (v25.44 behaviour).
 *   2. Some readiness slider > 0 → 50/50 blend applies.
 *   3. transactionStatus !== 'not_pursuing' with all-zero sliders → 50/50 blend
 *      STILL applies (the founder explicitly set a transaction state).
 *   4. financialAudit weighted highest (25%) > ESG (10%).
 *   5. composite stays within [0,100].
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupFounder, recorder } from "./v25_45_helpers.mjs";

let h; const { results, record } = recorder();
beforeAll(async () => { h = await setupFounder("f19e"); }, 60_000);
afterAll(async () => { await h.teardown(); });

async function scoreAfter(maPatch) {
  const r = await h.patchProfile({ ma: maPatch });
  return r.body?.maScore?.score ?? null;
}

// A fixed qualitative baseline (governance + risk + narrative) that yields a
// strong existing sub-score so the regression (halving) would be obvious.
const QUAL_BASE = {
  hasFormalBoard: true, hasExternalLegalCounsel: true, isFinanciallyAudited: true,
  holdsMaterialIp: true, isRegulatoryCompliant: true,
  maReadinessNarrative: "A".repeat(220), uniqueValueProposition: "B".repeat(60),
};

describe("v25.45 F19e maScore composite — E2E (round 2)", () => {
  let baselineNoReadiness = null;
  let scoreZeroNotPursuing = null;

  it("1. baseline qualitative score WITHOUT any readiness block", async () => {
    // No `readiness` key at all → pure qualitative score (v25.44 path).
    baselineNoReadiness = await scoreAfter({ ...QUAL_BASE });
    const ok = typeof baselineNoReadiness === "number" && baselineNoReadiness > 0;
    record("baseline qualitative score computed", ok, `score ${baselineNoReadiness}`);
    expect(ok).toBe(true);
  });

  it("2. all-zero readiness + not_pursuing → UNCHANGED from qualitative baseline (no halving)", async () => {
    scoreZeroNotPursuing = await scoreAfter({
      ...QUAL_BASE,
      readiness: {
        ipDueDiligence: 0, customerContracts: 0, financialAudit: 0,
        dataRoomOrganization: 0, regulatoryFilings: 0, esgDisclosure: 0,
        transactionStatus: "not_pursuing",
      },
    });
    // CRITICAL: must equal the no-readiness baseline. The round-1 bug returned ~half.
    const ok = scoreZeroNotPursuing === baselineNoReadiness;
    record("all-zero/not_pursuing returns old qualitative score unchanged", ok,
      `withZero ${scoreZeroNotPursuing} baseline ${baselineNoReadiness}`);
    expect(scoreZeroNotPursuing).toBe(baselineNoReadiness);
  });

  it("3. some readiness slider > 0 → 50/50 blend applies", async () => {
    const blended = await scoreAfter({
      ...QUAL_BASE,
      readiness: {
        ipDueDiligence: 100, customerContracts: 100, financialAudit: 100,
        dataRoomOrganization: 100, regulatoryFilings: 100, esgDisclosure: 100,
        transactionStatus: "not_pursuing",
      },
    });
    // slider sub-score = 100 → contributes 50; existing half stays. Blend differs
    // from the pure-qualitative baseline (which would be ~existingRaw).
    const ok = typeof blended === "number" && blended !== baselineNoReadiness && blended <= 100;
    record("non-zero sliders trigger 50/50 blend", ok, `blended ${blended} baseline ${baselineNoReadiness}`);
    expect(ok).toBe(true);
  });

  it("4. transactionStatus='active_negotiation' with ZERO sliders → blend still applies", async () => {
    // All sliders zero, but the founder explicitly set a transaction state →
    // the 50/50 blend must apply, which (with zero sliders) HALVES the
    // qualitative score. This is intentional: the founder declared transaction
    // intent, so readiness data is now meaningful.
    const activeZero = await scoreAfter({
      ...QUAL_BASE,
      readiness: {
        ipDueDiligence: 0, customerContracts: 0, financialAudit: 0,
        dataRoomOrganization: 0, regulatoryFilings: 0, esgDisclosure: 0,
        transactionStatus: "active_negotiation",
      },
    });
    const ok = typeof activeZero === "number" && activeZero < baselineNoReadiness;
    record("explicit transaction state triggers blend even with zero sliders", ok,
      `activeZero ${activeZero} baseline ${baselineNoReadiness}`);
    expect(ok).toBe(true);
  });

  it("5. financialAudit weighted highest (25%) — isolating it outscores ESG (10%)", async () => {
    const base = { ipDueDiligence: 0, customerContracts: 0, financialAudit: 0, dataRoomOrganization: 0, regulatoryFilings: 0, esgDisclosure: 0, transactionStatus: "exploring" };
    const faOnly = await scoreAfter({ ...QUAL_BASE, readiness: { ...base, financialAudit: 100 } });
    const esgOnly = await scoreAfter({ ...QUAL_BASE, readiness: { ...base, esgDisclosure: 100 } });
    const ok = faOnly > esgOnly;
    record("financialAudit (25%) outweighs ESG (10%)", ok, `fa ${faOnly} esg ${esgOnly}`);
    expect(ok).toBe(true);
  });

  it("6. composite stays within 0-100 bound", async () => {
    const s = await scoreAfter({ ...QUAL_BASE, readiness: { ipDueDiligence: 100, customerContracts: 100, financialAudit: 100, dataRoomOrganization: 100, regulatoryFilings: 100, esgDisclosure: 100, transactionStatus: "active_negotiation" } });
    const ok = s >= 0 && s <= 100;
    record("composite within [0,100]", ok, `score ${s}`);
    expect(ok).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.45 F19e E2E (round 2): ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
