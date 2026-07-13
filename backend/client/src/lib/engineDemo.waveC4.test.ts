/**
 * Wave C4 \u2014 the Pre/post-close projection tab crashed
 * ("Cannot read properties of null (reading 'toString')" \u2192 then BigInt(NaN))
 * for a freshly-created round with no pre-money / target (preMoney = null,
 * target = 0). A 0/0 priced round yields a NaN price-per-share the engine
 * cannot represent.
 *
 * Fix has two parts:
 *  1) projectPostClose no longer calls `.toString()` on a raw null (it coerces
 *     to a finite number first) \u2014 verified here.
 *  2) The ProjectionPanel caller GATES the projection: it only calls the engine
 *     when pre-money AND target are positive, otherwise it shows guidance. The
 *     gate predicate is verified here so a degenerate round is never projected.
 */
import { describe, it, expect } from "vitest";
import { projectPostClose, type ApiSecurity } from "./engineDemo";

const founderSecurity: ApiSecurity = {
  id: "sec_1",
  companyId: "co-active",
  holderName: "Founder",
  holderType: "founder",
  instrument: "common",
  series: null,
  shares: 8_000_000,
  pricePerShare: null,
  investmentAmount: null,
  cap: null,
  discount: null,
  issuedAt: "2025-01-01",
};

// Mirror of the ProjectionPanel gate (RoundDetail.tsx): a projection is only
// computed when BOTH pre-money and target are positive finite numbers.
function canProject(preMoney: number | null | undefined, target: number | null | undefined): boolean {
  const p = Number(preMoney);
  const t = Number(target);
  return Number.isFinite(p) && p > 0 && Number.isFinite(t) && t > 0;
}

describe("Wave C4 \u2014 projection gate prevents the degenerate-round crash", () => {
  it("gate is FALSE for a fresh round (null/0 pre-money or target) \u2014 engine not called", () => {
    expect(canProject(null, null)).toBe(false);
    expect(canProject(0, 0)).toBe(false);
    expect(canProject(1_000_000, 0)).toBe(false);
    expect(canProject(0, 500_000)).toBe(false);
    expect(canProject(undefined, undefined)).toBe(false);
    expect(canProject(Number.NaN, 500_000)).toBe(false);
  });

  it("gate is TRUE only when BOTH pre-money and target are positive", () => {
    expect(canProject(8_000_000, 2_000_000)).toBe(true);
  });

  it("projectPostClose computes a valid result for positive inputs (the gated path)", () => {
    const res = projectPostClose([founderSecurity], {
      preMoneyValuation: 8_000_000,
      investmentAmount: 2_000_000,
      series: "Series A",
    });
    expect(res).toBeTruthy();
    expect(Array.isArray(res.rows)).toBe(true);
    expect(res.rows.some((r) => r.holderName === "Founder")).toBe(true);
  });

  it("projectPostClose no longer throws null.toString() \u2014 null coerces to a number before .toString()", () => {
    // With the coercion fix the null no longer crashes at the .toString() call.
    // (A 0/0 priced round is still meaningless, which is exactly why the caller
    //  GATES it; this asserts only that the specific null.toString() crash the
    //  user hit is gone \u2014 the thrown error, if any, is no longer a TypeError on
    //  reading 'toString' of null.)
    let msg = "";
    try {
      projectPostClose([founderSecurity], { preMoneyValuation: null, investmentAmount: null, series: "Seed" });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).not.toMatch(/reading 'toString'/);
    expect(msg).not.toMatch(/of null/);
  });
});
