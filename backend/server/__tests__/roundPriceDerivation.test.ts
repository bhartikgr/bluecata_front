/**
 * Avi 22-May Issue 2 \u2014 share-price entered manually.
 *
 * Avi: "at the time of round creation, the share price has to be entered
 * manually."
 *
 * Answer (math is sacred, persistence is hardened):
 *   - Priced rounds (Preferred / Common) require an explicit PPS at creation;
 *     the canonical derivation is `PPS = preMoney / fullyDilutedSharesPreMoney`.
 *   - SAFE / Convertible / Option-pool rounds: NO PPS is set at issue. The
 *     UI hides the field; the server returns `requiresPps: false`.
 *   - Manual override permitted, but the server validates internal
 *     consistency against the formula within $0.01/share tolerance.
 *
 * No state mutation; all logic in server/lib/roundPriceDerivation.ts.
 */
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import {
  derivePricePerShare,
  instrumentRequiresPps,
  validatePpsConsistency,
  registerRoundPriceDerivationRoutes,
  PRICED_INSTRUMENTS,
  NON_PRICED_INSTRUMENTS,
} from "../lib/roundPriceDerivation";

describe("Avi 22-May Issue 2 \u2014 PPS derivation + validation (pure)", () => {
  it("PRICED_INSTRUMENTS includes preferred + common; NON_PRICED excludes them", () => {
    expect(PRICED_INSTRUMENTS).toContain("preferred");
    expect(PRICED_INSTRUMENTS).toContain("common");
    expect(NON_PRICED_INSTRUMENTS).toContain("safe_post");
    expect(NON_PRICED_INSTRUMENTS).toContain("safe_pre");
    expect(NON_PRICED_INSTRUMENTS).toContain("convertible_note");
    expect(NON_PRICED_INSTRUMENTS).toContain("option_pool");
  });

  it("instrumentRequiresPps returns true for priced, false for SAFEs", () => {
    expect(instrumentRequiresPps("preferred")).toBe(true);
    expect(instrumentRequiresPps("common")).toBe(true);
    expect(instrumentRequiresPps("safe_post")).toBe(false);
    expect(instrumentRequiresPps("safe_pre")).toBe(false);
    expect(instrumentRequiresPps("convertible_note")).toBe(false);
    expect(instrumentRequiresPps("option_pool")).toBe(false);
  });

  it("derivePricePerShare: $18M preMoney / 10M shares = $1.80", () => {
    const pps = derivePricePerShare({
      preMoneyValuation: 18_000_000,
      fullyDilutedSharesPreMoney: 10_000_000,
    });
    expect(pps).toBe(1.8);
  });

  it("derivePricePerShare: 6-decimal precision on awkward divisions", () => {
    const pps = derivePricePerShare({
      preMoneyValuation: 17_500_000,
      fullyDilutedSharesPreMoney: 9_321_456,
    });
    // 17500000 / 9321456 = 1.8773... \u2014 we round to 6dp.
    expect(pps).not.toBeNull();
    expect(pps!).toBeGreaterThan(1.877);
    expect(pps!).toBeLessThan(1.878);
  });

  it("derivePricePerShare: returns null on non-positive / non-finite inputs", () => {
    expect(derivePricePerShare({ preMoneyValuation: 0, fullyDilutedSharesPreMoney: 1 })).toBeNull();
    expect(derivePricePerShare({ preMoneyValuation: 1, fullyDilutedSharesPreMoney: 0 })).toBeNull();
    expect(derivePricePerShare({ preMoneyValuation: -1, fullyDilutedSharesPreMoney: 1 })).toBeNull();
    expect(derivePricePerShare({ preMoneyValuation: Number.NaN, fullyDilutedSharesPreMoney: 1 })).toBeNull();
    expect(derivePricePerShare({ preMoneyValuation: Number.POSITIVE_INFINITY, fullyDilutedSharesPreMoney: 1 })).toBeNull();
  });

  it("validatePpsConsistency: ok when entered PPS matches derived within tolerance", () => {
    const r = validatePpsConsistency({
      enteredPps: 1.80,
      preMoneyValuation: 18_000_000,
      fullyDilutedSharesPreMoney: 10_000_000,
      targetAmount: 2_000_000,
    });
    expect(r.ok).toBe(true);
    expect(r.suggestedPps).toBe(1.80);
    expect(r.issues).toEqual([]);
  });

  it("validatePpsConsistency: surfaces issue when entered diverges by more than $0.01", () => {
    const r = validatePpsConsistency({
      enteredPps: 2.50, // negotiated premium PPS \u2014 outside tolerance vs derived 1.80
      preMoneyValuation: 18_000_000,
      fullyDilutedSharesPreMoney: 10_000_000,
      targetAmount: 2_000_000,
    });
    expect(r.ok).toBe(false);
    expect(r.issues.join(" ")).toMatch(/outside the \$0\.01 tolerance/);
    expect(r.suggestedPps).toBe(1.80);
  });

  it("validatePpsConsistency: missing PPS fails the entered-PPS check", () => {
    const r = validatePpsConsistency({
      enteredPps: null,
      preMoneyValuation: 18_000_000,
      fullyDilutedSharesPreMoney: 10_000_000,
      targetAmount: 2_000_000,
    });
    expect(r.ok).toBe(false);
    expect(r.issues.join(" ")).toMatch(/missing or non-positive/);
  });
});

describe("Avi 22-May Issue 2 \u2014 PPS routes", () => {
  const app = express();
  app.use(express.json());
  registerRoundPriceDerivationRoutes(app);

  it("GET /api/rounds/derive-pps for a priced round returns the derivation", async () => {
    const r = await request(app)
      .get("/api/rounds/derive-pps")
      .query({ preMoney: 18_000_000, fullyDilutedShares: 10_000_000, instrument: "preferred" });
    expect(r.status).toBe(200);
    expect(r.body.requiresPps).toBe(true);
    expect(r.body.pps).toBe(1.80);
    expect(r.body.formula).toMatch(/PPS = pre_money_valuation/);
  });

  it("GET /api/rounds/derive-pps for a SAFE returns requiresPps=false (hidden in UI)", async () => {
    const r = await request(app)
      .get("/api/rounds/derive-pps")
      .query({ preMoney: 18_000_000, fullyDilutedShares: 10_000_000, instrument: "safe_post" });
    expect(r.status).toBe(200);
    expect(r.body.requiresPps).toBe(false);
    expect(r.body.pps).toBeNull();
    expect(r.body.rationale).toMatch(/does not fix a price-per-share/);
  });

  it("POST /api/rounds/validate-pps returns ok=true for a consistent set", async () => {
    const r = await request(app).post("/api/rounds/validate-pps").send({
      enteredPps: 1.80,
      preMoneyValuation: 18_000_000,
      fullyDilutedSharesPreMoney: 10_000_000,
      targetAmount: 2_000_000,
    });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.toleranceDollarsPerShare).toBe(0.01);
  });

  it("POST /api/rounds/validate-pps returns ok=false when entered diverges", async () => {
    const r = await request(app).post("/api/rounds/validate-pps").send({
      enteredPps: 2.50,
      preMoneyValuation: 18_000_000,
      fullyDilutedSharesPreMoney: 10_000_000,
      targetAmount: 2_000_000,
    });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(false);
    expect(Array.isArray(r.body.issues)).toBe(true);
    expect(r.body.issues.length).toBeGreaterThan(0);
    expect(r.body.suggestedPps).toBe(1.80);
  });
});
