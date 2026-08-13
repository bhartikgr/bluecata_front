/**
 * W-FIX1e (2026-07-19) — SPV offline-first core math (SPV-CORE-1/2/3).
 *
 * These lock the pure, DB-independent helpers in server/lib/spvOfflineOps.ts.
 * They compute; they never move money and never block. The three offline GP
 * actions are:
 *   SPV-CORE-1  computeFundsConfirmation  — mismatch is an educational flag, never a block.
 *   SPV-CORE-2  computeDistributionSplit  — simple waterfall unchanged with no hurdle;
 *               preferred-return + GP-catch-up tiers engage only when a hurdle is set.
 *               computeCapitalAccounts    — per-LP contributed/confirmed/distributed.
 *   SPV-CORE-3  computeCloseSummary       — under-target NEVER blocks.
 *               canReopenClose            — rolling closes within a window.
 */
import { describe, it, expect } from "vitest";
import {
  computeFundsConfirmation,
  computeDistributionSplit,
  computeCapitalAccounts,
  computeCloseSummary,
  canReopenClose,
} from "../lib/spvOfflineOps";

describe("SPV-CORE-1 — computeFundsConfirmation (never blocks)", () => {
  it("matched when received equals expected", () => {
    const r = computeFundsConfirmation(100000, 100000, "WIRE-123");
    expect(r.status).toBe("matched");
    expect(r.mismatch).toBe(false);
    expect(r.deltaMinor).toBe(0);
    expect(r.reference).toBe("WIRE-123");
  });

  it("short when received is less — flags mismatch, still returns (no throw/block)", () => {
    const r = computeFundsConfirmation(100000, 90000);
    expect(r.status).toBe("short");
    expect(r.mismatch).toBe(true);
    expect(r.deltaMinor).toBe(-10000);
    expect(r.reference).toBeNull();
    expect(r.note).toMatch(/does not block/i);
  });

  it("over when received exceeds expected — flags mismatch, never blocks", () => {
    const r = computeFundsConfirmation(100000, 110000, "  ref-9 ");
    expect(r.status).toBe("over");
    expect(r.mismatch).toBe(true);
    expect(r.deltaMinor).toBe(10000);
    expect(r.reference).toBe("ref-9"); // trimmed
  });

  it("coerces junk/negative inputs to 0 without throwing", () => {
    const r = computeFundsConfirmation("not-a-number", -5);
    expect(r.expectedMinor).toBe(0);
    expect(r.receivedMinor).toBe(0);
    expect(r.status).toBe("matched");
  });

  it("accepts numeric strings", () => {
    const r = computeFundsConfirmation("100000", "100000.4");
    expect(r.status).toBe("matched"); // rounds to 100000
  });
});

describe("SPV-CORE-2 — computeDistributionSplit (simple waterfall, no hurdle)", () => {
  it("returns capital first, then carry on profit, rest to LPs", () => {
    // gross 300k, contributed 100k, carry 20% → profit 200k, carry 40k, lp profit 160k
    const r = computeDistributionSplit({
      grossProceedsMinor: 300000,
      contributedMinor: 100000,
      carryPct: 0.2,
    });
    expect(r.tiered).toBe(false);
    expect(r.gpTotalMinor).toBe(40000);
    expect(r.lpTotalMinor).toBe(260000); // 100k roc + 160k profit
    const kinds = r.tiers.map((t) => t.tier);
    expect(kinds).toEqual(["return_of_capital", "gp_carry", "lp_profit"]);
  });

  it("no profit → all return of capital, zero carry", () => {
    const r = computeDistributionSplit({
      grossProceedsMinor: 80000,
      contributedMinor: 100000,
      carryPct: 0.2,
    });
    expect(r.gpTotalMinor).toBe(0);
    expect(r.lpTotalMinor).toBe(80000);
    expect(r.tiered).toBe(false);
  });

  /* ══ WAVE 37 — THESE TWO CASES WERE STALE. THE CODE IS RIGHT. ══
   *
   * HISTORY. The original pin was "accepts carry as a percent (20) same as
   * fraction (0.2)", which pinned `frac()`'s `n > 1 ? n/100 : n` guess. WAVE 4A
   * correctly retired that guess, but replaced the expectation with SATURATION
   * ("20 is clamped to 1 — a loud, visible result"). WAVE 10 / EN-5 then
   * retired the clamp too, and it was right to: saturation IS the P-4 money
   * defect. An unnormalised `8` becoming a 100% preferred return let the
   * pref tier swallow an entire distribution before any LP profit was
   * allocated (`server/lib/spvOfflineOps.ts:92-108`).
   *
   * THE RULING. `spec/PERCENT_POLICY_v2.md:851-852` — the `spvOfflineOps.ts`
   * carry and hurdle sites "throw instead of silently clamping"; §2.4/P-4
   * requires an out-of-domain rate to be REJECTED, never clamped. `n > 1 ?
   * n/100 : n` is forbidden, and so is `Math.min(1, n)`.
   *
   * WHAT CHANGED HERE. The expectation is re-aimed from "clamps" to "rejects",
   * and both cases are STRENGTHENED rather than loosened. Each now asserts
   * BOTH poles in one body: the in-domain fraction still produces the exact
   * split (a module that threw on everything would fail), and the
   * out-of-domain value throws the NAMED policy error for the NAMED field
   * with its declared domain, returning nothing at all. If the clamp is ever
   * reinstated, the call returns a value and every one of these fails.
   * The two domains are deliberately distinct — `spv.carryPct` and
   * `spv.hurdleRateFraction` — so a single mis-wired field name is caught. */
  it("treats carry as a FRACTION only — 20 is REJECTED, never rescaled and never clamped", () => {
    // LOWER POLE — 0.2 still means 20% of the 200k profit, to the minor unit.
    const asFraction = computeDistributionSplit({ grossProceedsMinor: 300000, contributedMinor: 100000, carryPct: 0.2 });
    expect(asFraction.gpTotalMinor).toBe(40000);
    expect(asFraction.lpTotalMinor).toBe(260000);

    // UPPER POLE — 20 is neither 20% (the retired n/100 guess) nor 100% (the
    // retired Math.min(1,n) clamp). It is refused, by name, with its domain.
    let thrown: unknown = null;
    let returned: unknown = "NOTHING_RETURNED";
    try {
      returned = computeDistributionSplit({ grossProceedsMinor: 300000, contributedMinor: 100000, carryPct: 20 });
    } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(Error);
    const msg = String((thrown as Error).message);
    expect(msg).toContain("PERCENT_FIELD_OUT_OF_DOMAIN");
    expect(msg).toContain("spv.carryPct");
    expect(msg).toContain("[0,1]");
    // Neither the rescaled (40000) nor the saturated (200000) answer exists.
    expect(returned).toBe("NOTHING_RETURNED");
  });

  it("treats the hurdle as a FRACTION only — 8 is REJECTED, never rescaled and never clamped", () => {
    // LOWER POLE — 0.08 is an 8% preferred return on the 100k contributed.
    const asFraction = computeDistributionSplit({
      grossProceedsMinor: 300000, contributedMinor: 100000, carryPct: 0.2, hurdleRatePct: 0.08,
    });
    const pref = (r: typeof asFraction) =>
      Object.fromEntries(r.tiers.map((t) => [t.tier, t.amountMinor]))["preferred_return"];
    expect(pref(asFraction)).toBe(8000);

    // UPPER POLE — THE P-4 DEFECT ITSELF. Under the retired clamp, 8 became a
    // 100% preferred return and this tier took 100000, the whole contributed
    // base, before any LP profit. It must throw instead.
    let thrown: unknown = null;
    let returned: unknown = "NOTHING_RETURNED";
    try {
      returned = computeDistributionSplit({
        grossProceedsMinor: 300000, contributedMinor: 100000, carryPct: 0.2, hurdleRatePct: 8,
      });
    } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(Error);
    const msg = String((thrown as Error).message);
    expect(msg).toContain("PERCENT_FIELD_OUT_OF_DOMAIN");
    // The FRACTION domain, not the percent-as-written one — a mis-wired field
    // name would let 8 through as a legal `spv.hurdleRatePct`.
    expect(msg).toContain("spv.hurdleRateFraction");
    expect(msg).toContain("[0,1]");
    expect(returned).toBe("NOTHING_RETURNED");
  });
});

describe("SPV-CORE-2 — computeDistributionSplit (tiered: hurdle + GP catch-up)", () => {
  it("engages preferred return + full GP catch-up when a hurdle is set", () => {
    // gross 300k, contributed 100k, carry 20%, hurdle 8%
    // roc 100k; pref = 8% of 100k = 8k; remaining 192k
    // full catch-up = 0.2*8000/0.8 = 2000; remaining 190k
    // residual carry = 20% of 190k = 38000; lp residual 152000
    const r = computeDistributionSplit({
      grossProceedsMinor: 300000,
      contributedMinor: 100000,
      carryPct: 0.2,
      hurdleRatePct: 0.08,
    });
    expect(r.tiered).toBe(true);
    const byTier = Object.fromEntries(r.tiers.map((t) => [t.tier, t.amountMinor]));
    expect(byTier["return_of_capital"]).toBe(100000);
    expect(byTier["preferred_return"]).toBe(8000);
    expect(byTier["gp_catch_up"]).toBe(2000);
    expect(byTier["gp_carry"]).toBe(38000);
    expect(byTier["lp_residual"]).toBe(152000);
    // GP total = catch-up + residual carry = 40000; LP = 100k + 8k + 152k = 260000
    expect(r.gpTotalMinor).toBe(40000);
    expect(r.lpTotalMinor).toBe(260000);
  });

  it("partial GP catch-up rate reduces the catch-up tier", () => {
    const r = computeDistributionSplit({
      grossProceedsMinor: 300000,
      contributedMinor: 100000,
      carryPct: 0.2,
      hurdleRatePct: 0.08,
      gpCatchUpPct: 0.5, // half catch-up
    });
    const byTier = Object.fromEntries(r.tiers.map((t) => [t.tier, t.amountMinor]));
    expect(byTier["gp_catch_up"]).toBe(1000); // 2000 × 0.5
  });

  it("conserves money: LP + GP totals equal gross proceeds", () => {
    const r = computeDistributionSplit({
      grossProceedsMinor: 500000,
      contributedMinor: 120000,
      carryPct: 0.2,
      hurdleRatePct: 0.08,
    });
    expect(r.lpTotalMinor + r.gpTotalMinor).toBe(500000);
  });
});

describe("SPV-CORE-2 — computeCapitalAccounts", () => {
  it("reports contributed, confirmed, and distributed per LP", () => {
    const register = [
      { investorId: "lp1", commitmentMinor: 100000 },
      { investorId: "lp2", commitmentMinor: 50000 },
    ];
    const confirmed = { lp1: 100000, lp2: 40000 };
    const distributions = [
      { allocations: [{ investorId: "lp1", netMinor: 12000 }, { investorId: "lp2", netMinor: 6000 }] },
      { allocations: [{ investorId: "lp1", netMinor: 3000 }] },
    ];
    const rows = computeCapitalAccounts(register, confirmed, distributions);
    const lp1 = rows.find((r) => r.investorId === "lp1")!;
    const lp2 = rows.find((r) => r.investorId === "lp2")!;
    expect(lp1).toMatchObject({ contributedMinor: 100000, confirmedMinor: 100000, distributedMinor: 15000 });
    expect(lp2).toMatchObject({ contributedMinor: 50000, confirmedMinor: 40000, distributedMinor: 6000 });
  });

  it("confirmed defaults to 0 for an LP with no confirmation yet", () => {
    const rows = computeCapitalAccounts([{ investorId: "lp3", commitmentMinor: 25000 }], {}, []);
    expect(rows[0].confirmedMinor).toBe(0);
    expect(rows[0].distributedMinor).toBe(0);
  });
});

describe("SPV-CORE-3 — computeCloseSummary (under-target never blocks)", () => {
  it("counts only committed subs toward confirmed capital", () => {
    const r = computeCloseSummary([
      { status: "committed", commitmentMinor: 60000 },
      { status: "committed", commitmentMinor: 40000 },
      { status: "review", commitmentMinor: 999999 },
    ]);
    expect(r.confirmedCount).toBe(2);
    expect(r.confirmedMinor).toBe(100000);
  });

  it("under target: flags underTarget + shortfall but proceeds, suggests target = raised", () => {
    const r = computeCloseSummary(
      [{ status: "committed", commitmentMinor: 100000 }],
      150000,
    );
    expect(r.underTarget).toBe(true);
    expect(r.shortfallMinor).toBe(50000);
    expect(r.suggestedTargetMinor).toBe(100000);
    expect(r.note).toMatch(/close anyway/i);
  });

  it("at/over target: not under, no shortfall", () => {
    const r = computeCloseSummary([{ status: "committed", commitmentMinor: 200000 }], 150000);
    expect(r.underTarget).toBe(false);
    expect(r.shortfallMinor).toBe(0);
  });

  it("no target: ready to close, not under target", () => {
    const r = computeCloseSummary([{ status: "committed", commitmentMinor: 100000 }]);
    expect(r.targetMinor).toBeNull();
    expect(r.underTarget).toBe(false);
  });
});

describe("SPV-CORE-3 — canReopenClose (rolling close window)", () => {
  const now = new Date("2026-07-19T00:00:00Z");

  it("refuses when the SPV is not closed", () => {
    expect(canReopenClose("committed", "2026-07-10", 30, now).allowed).toBe(false);
  });

  it("allows within the rolling window", () => {
    const r = canReopenClose("closed", "2026-07-10", 30, now); // 9 days
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe("within_rolling_close_window");
  });

  it("refuses once the window has elapsed", () => {
    const r = canReopenClose("closed", "2026-05-01", 30, now); // ~79 days
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("rolling_close_window_elapsed");
  });

  it("fail-open on missing/unparseable close date (does not trap a closed SPV)", () => {
    expect(canReopenClose("closed", null, 30, now).allowed).toBe(true);
    expect(canReopenClose("closed", "not-a-date", 30, now).allowed).toBe(true);
  });
});
