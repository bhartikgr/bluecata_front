/**
 * W7 — M&A intelligence parity envelope (redacted vs no-data vs available).
 *
 * The parity envelope is the shared contract every surface (investor, Collective
 * member, founder) uses to distinguish the three outcomes without leaking a
 * name/email the privacy gate would hide. This suite pins that contract.
 *
 * Coverage:
 *   - no-data:        hasData=false, redacted=false, reason=no_data (entitled but empty).
 *   - aggregate:      hasData=true,  redacted=true,  reason=aggregate (data exists, names withheld).
 *   - detail_partial: FULL/DETAIL with narrative and/or buyers withheld → redacted=true.
 *   - ok:             FULL/DETAIL, nothing withheld → redacted=false.
 *   - redacted != no-data: the two states are provably distinguishable.
 *   - friendly copy: each state carries direct, member/founder-friendly, non-empty prose.
 */
import { describe, it, expect } from "vitest";
import { buildMaParityEnvelope, MA_PARITY_COPY } from "../lib/maIntelParity";
import { buildMaAggregateResponse } from "../maIntelligenceStore";
import type { DerivedMaIntel } from "../lib/maProfileSource";

describe("W7 buildMaParityEnvelope", () => {
  it("no-data: entitled to view but company has no M&A profile yet", () => {
    const env = buildMaParityEnvelope({ level: "FULL", canSeeNarrative: true, canSeeBuyers: true }, false);
    expect(env.hasData).toBe(false);
    expect(env.redacted).toBe(false);
    expect(env.reason).toBe("no_data");
    expect(env.accessMessage).toBe(MA_PARITY_COPY.no_data);
  });

  it("aggregate: data exists but only anonymized scores are returned → redacted", () => {
    const env = buildMaParityEnvelope({ level: "AGGREGATE", canSeeNarrative: false, canSeeBuyers: false }, true);
    expect(env.hasData).toBe(true);
    expect(env.redacted).toBe(true);
    expect(env.reason).toBe("aggregate");
    expect(env.accessLevel).toBe("AGGREGATE");
  });

  it("detail_partial: DETAIL tier with buyers/narrative withheld → redacted", () => {
    const env = buildMaParityEnvelope({ level: "DETAIL", canSeeNarrative: false, canSeeBuyers: true }, true);
    expect(env.hasData).toBe(true);
    expect(env.redacted).toBe(true);
    expect(env.reason).toBe("detail_partial");
  });

  it("ok: FULL tier, nothing withheld → not redacted", () => {
    const env = buildMaParityEnvelope({ level: "FULL", canSeeNarrative: true, canSeeBuyers: true }, true);
    expect(env.hasData).toBe(true);
    expect(env.redacted).toBe(false);
    expect(env.reason).toBe("ok");
  });

  it("redacted is provably DISTINCT from no-data", () => {
    const redacted = buildMaParityEnvelope({ level: "AGGREGATE", canSeeNarrative: false, canSeeBuyers: false }, true);
    const noData = buildMaParityEnvelope({ level: "AGGREGATE", canSeeNarrative: false, canSeeBuyers: false }, false);
    // Same access decision, only hasData differs → the two outcomes must NOT collapse.
    expect(redacted.reason).not.toBe(noData.reason);
    expect(redacted.hasData).toBe(true);
    expect(noData.hasData).toBe(false);
    expect(redacted.redacted).toBe(true);
    expect(noData.redacted).toBe(false);
    expect(redacted.accessMessage).not.toBe(noData.accessMessage);
  });

  it("every state carries direct, non-empty, member/founder-friendly copy", () => {
    for (const key of ["no_data", "aggregate", "detail_partial", "ok"] as const) {
      const copy = MA_PARITY_COPY[key];
      expect(typeof copy).toBe("string");
      expect(copy.length).toBeGreaterThan(40); // thorough, not a terse code
      // No raw error codes / jargon leaking into member-facing prose.
      expect(copy).not.toMatch(/NONE|403|404|forbidden|null/);
    }
  });

  it("FULL with narrative allowed but buyers withheld is still redacted (partial)", () => {
    const env = buildMaParityEnvelope({ level: "FULL", canSeeNarrative: true, canSeeBuyers: false }, true);
    expect(env.redacted).toBe(true);
    expect(env.reason).toBe("detail_partial");
  });
});

describe("W7 aggregate response never leaks narrative/buyer names via the envelope", () => {
  it("buildMaAggregateResponse (with W7 envelope) contains no narrative or buyer name", () => {
    const NARRATIVE = "ULTRA_DISTINCTIVE_NARRATIVE_MARKER_XYZ";
    const BUYER = "SecretAcquirerCorp";
    const intel = {
      maScore: 80, acquirerFitScore: 75, intentSignal: "inbound",
      productMarketFit: 70, technologyDifferentiation: 72, customerConcentration: 30,
      growthRate: 60, marketShare: 20, managementTeamStrength: 65,
      strategicPriorities: [], transactionInterests: [],
      topBuyer: { name: BUYER, rationale: "secret" },
      comparableExits: [], revenueMultipleRange: { low: 3, high: 5 },
      maReadinessNarrative: NARRATIVE,
    } as unknown as DerivedMaIntel;
    const body = JSON.stringify(buildMaAggregateResponse("co_x", intel));
    expect(body).not.toContain(NARRATIVE);
    expect(body).not.toContain(BUYER);
    // But the parity envelope IS present (redacted=true, reason=aggregate).
    expect(body).toContain("aggregate");
    expect(body).toContain("\"redacted\":true");
  });
});
