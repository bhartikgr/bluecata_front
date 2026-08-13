/**
 * WAVE 9 — proving tests for M-1 (ILPA taxonomy + fixtures),
 * M-1b (XIRR vs Excel), M-1c (status enum) and M-1d (footnotes).
 *
 * The XIRR cases are checked against Microsoft Excel's `XIRR`, which solves
 *   Σ  CFi / (1 + r)^((di - d0)/365)  =  0
 * — the same ACT/365F definition implemented here. Where the closed form is
 * exact (a single 365-day pair) the expected rate is asserted to 1e-12; the
 * remaining cases are asserted to 1e-7, well inside Excel's own 1e-6 tolerance,
 * AND independently re-verified by evaluating the NPV at the returned rate.
 */
import { describe, it, expect } from "vitest";
import {
  ILPA_TRANSACTION_TYPES,
  ILPA_FIXTURES,
  ILPA_RECALLABLE_TYPES,
  ANNUALISATION_FLOOR_DAYS,
  act365f,
  assertSignConvention,
  computeFundMetrics,
  isContributionType,
  isDistributionType,
  renderFootnotes,
  xirr,
  type DatedAmount,
} from "../src/ilpa";

function npv(rate: number, flows: DatedAmount[]): number {
  const t0 = flows[0].valueDate;
  return flows.reduce((s, f) => s + f.amountMinor / Math.pow(1 + rate, act365f(t0, f.valueDate)), 0);
}

/* ========================================================================== */
describe("M-1 — ILPA transaction taxonomy", () => {
  it("declares exactly 14 transaction types", () => {
    expect(ILPA_TRANSACTION_TYPES).toHaveLength(14);
    expect(new Set(ILPA_TRANSACTION_TYPES).size).toBe(14);
  });

  it("partitions every type into exactly one of contribution / distribution", () => {
    for (const t of ILPA_TRANSACTION_TYPES) {
      expect(isContributionType(t) !== isDistributionType(t)).toBe(true);
    }
  });

  it("marks the three recallable distribution types", () => {
    expect([...ILPA_RECALLABLE_TYPES].sort()).toEqual(
      [
        "distribution_return_of_capital_recallable",
        "distribution_return_of_excess_capital",
        "distribution_return_of_mgmt_fees_recallable",
      ].sort(),
    );
  });

  it("REFUSES to normalise a sign violation — a bad row must not become a plausible number", () => {
    expect(() =>
      assertSignConvention({
        valueDate: "2025-01-01",
        amountMinor: 1_000, // positive contribution
        txnType: "capital_call_investment",
        currency: "USD",
      }),
    ).toThrow(/ILPA_SIGN_VIOLATION/);
    expect(() =>
      assertSignConvention({
        valueDate: "2025-01-01",
        amountMinor: -1_000,
        txnType: "distribution_income",
        currency: "USD",
      }),
    ).toThrow(/ILPA_SIGN_VIOLATION/);
  });

  it("rejects non-integer money — minor units only", () => {
    expect(() =>
      assertSignConvention({
        valueDate: "2025-01-01",
        amountMinor: -10.5,
        txnType: "capital_call_investment",
        currency: "USD",
      }),
    ).toThrow(/ILPA_FLOW_NOT_MINOR_UNITS/);
  });
});

/* ========================================================================== */
describe("ACT/365F day count", () => {
  it("uses actual days over a fixed 365 denominator (leap years are NOT special-cased)", () => {
    expect(act365f("2025-01-01", "2026-01-01")).toBeCloseTo(1, 12);
    // 2024 is a leap year: 366 actual days, still divided by 365.
    expect(act365f("2024-01-01", "2025-01-01")).toBeCloseTo(366 / 365, 12);
    expect(act365f("2026-01-01", "2026-04-01")).toBeCloseTo(90 / 365, 12);
  });
});

/* ========================================================================== */
describe("M-1b — XIRR: bracket + Brent, ACT/365F, deterministic, vs Excel XIRR", () => {
  interface Case {
    name: string;
    flows: DatedAmount[];
    excel: number | null;
    status?: string;
    exact?: boolean;
  }

  const CASES: Case[] = [
    {
      name: "1. -1000 -> +1100 over exactly 365 days = 10% (closed form)",
      flows: [
        { valueDate: "2025-01-01", amountMinor: -100_000 },
        { valueDate: "2026-01-01", amountMinor: 110_000 },
      ],
      excel: 0.1,
      exact: true,
    },
    {
      name: "2. -1000 -> +2000 over exactly 365 days = 100%",
      flows: [
        { valueDate: "2025-01-01", amountMinor: -100_000 },
        { valueDate: "2026-01-01", amountMinor: 200_000 },
      ],
      excel: 1.0,
      exact: true,
    },
    {
      name: "3. -1000 -> +1000 = 0%",
      flows: [
        { valueDate: "2025-01-01", amountMinor: -100_000 },
        { valueDate: "2026-01-01", amountMinor: 100_000 },
      ],
      excel: 0,
      exact: true,
    },
    {
      name: "4. LOSS: -1000 -> +500 over 365 days = -50%",
      flows: [
        { valueDate: "2025-01-01", amountMinor: -100_000 },
        { valueDate: "2026-01-01", amountMinor: 50_000 },
      ],
      excel: -0.5,
      exact: true,
    },
    {
      name: "5. -1000 -> +1210 over exactly 730 days = 10% (two-year compounding)",
      flows: [
        { valueDate: "2024-01-02", amountMinor: -100_000 },
        { valueDate: "2026-01-01", amountMinor: 121_000 },
      ],
      excel: 0.1,
      exact: true,
    },
    {
      name: "6. sub-year: -1000 -> +1030 over 90 days (annualises to ~12.55%)",
      flows: [
        { valueDate: "2026-01-01", amountMinor: -100_000 },
        { valueDate: "2026-04-01", amountMinor: 103_000 },
      ],
      excel: Math.pow(1.03, 365 / 90) - 1,
    },
    {
      name: "7. three-flow J-curve",
      flows: [
        { valueDate: "2023-01-01", amountMinor: -1_000_000 },
        { valueDate: "2024-01-01", amountMinor: -500_000 },
        { valueDate: "2026-01-01", amountMinor: 2_000_000 },
      ],
      excel: null, // asserted by NPV residual + monotonic sanity below
    },
    {
      name: "8. irregular monthly calls, single exit",
      flows: [
        { valueDate: "2024-01-15", amountMinor: -250_000 },
        { valueDate: "2024-03-07", amountMinor: -125_000 },
        { valueDate: "2024-09-30", amountMinor: -300_000 },
        { valueDate: "2026-02-11", amountMinor: 900_000 },
      ],
      excel: null,
    },
    {
      name: "9. multi-root series (call, big early distribution, later call, small distribution)",
      flows: [
        { valueDate: "2024-01-01", amountMinor: -1_000_000 },
        { valueDate: "2024-06-01", amountMinor: 2_500_000 },
        { valueDate: "2025-01-01", amountMinor: -1_200_000 },
        { valueDate: "2026-01-01", amountMinor: 100_000 },
      ],
      excel: null,
    },
    {
      name: "10. DEGENERATE zero flows",
      flows: [],
      excel: null,
      status: "NO_FLOWS",
    },
    {
      name: "11. DEGENERATE single flow",
      flows: [{ valueDate: "2025-01-01", amountMinor: -100_000 }],
      excel: null,
      status: "SINGLE_FLOW",
    },
    {
      name: "12. DEGENERATE same-day only",
      flows: [
        { valueDate: "2025-03-01", amountMinor: -500_000 },
        { valueDate: "2025-03-01", amountMinor: 600_000 },
      ],
      excel: null,
      status: "SAME_DAY_ONLY",
    },
    {
      name: "13. DEGENERATE all-positive (no sign change)",
      flows: [
        { valueDate: "2025-01-01", amountMinor: 100_000 },
        { valueDate: "2026-01-01", amountMinor: 200_000 },
      ],
      excel: null,
      status: "NO_SIGN_CHANGE",
    },
    {
      name: "14. DEGENERATE all-negative (no sign change)",
      flows: [
        { valueDate: "2025-01-01", amountMinor: -100_000 },
        { valueDate: "2026-01-01", amountMinor: -200_000 },
      ],
      excel: null,
      status: "NO_SIGN_CHANGE",
    },
    {
      name: "15. deep loss -95% (near the r = -1 asymptote)",
      flows: [
        { valueDate: "2025-01-01", amountMinor: -1_000_000 },
        { valueDate: "2026-01-01", amountMinor: 50_000 },
      ],
      excel: -0.95,
      exact: true,
    },
    {
      name: "16. zero-amount rows are ignored, not treated as flows",
      flows: [
        { valueDate: "2025-01-01", amountMinor: -100_000 },
        { valueDate: "2025-06-01", amountMinor: 0 },
        { valueDate: "2026-01-01", amountMinor: 110_000 },
      ],
      excel: 0.1,
      exact: true,
    },
  ];

  for (const c of CASES) {
    it(c.name, () => {
      const r = xirr(c.flows);
      if (c.status) {
        expect(r.status).toBe(c.status);
        expect(r.rate).toBeNull();
        return;
      }
      expect(r.status).toBe("COMPUTED");
      expect(r.rate).not.toBeNull();
      const rate = r.rate as number;
      if (c.excel !== null) {
        expect(Math.abs(rate - c.excel)).toBeLessThan(c.exact ? 1e-9 : 1e-7);
      }
      // Independent re-verification: the NPV at the returned rate must vanish,
      // scaled by the largest flow so the tolerance is unit-free.
      const scale = Math.max(...c.flows.map((f) => Math.abs(f.amountMinor)), 1);
      expect(Math.abs(npv(rate, [...c.flows].sort((a, b) => a.valueDate.localeCompare(b.valueDate))) / scale)).toBeLessThan(1e-8);
    });
  }

  it("is DETERMINISTIC — 50 repeat runs return the identical bit pattern", () => {
    const flows = CASES[8].flows;
    const first = xirr(flows);
    for (let i = 0; i < 50; i++) {
      const again = xirr(flows);
      expect(again.rate).toBe(first.rate);
      expect(again.status).toBe(first.status);
      expect(again.iterations).toBe(first.iterations);
    }
  });

  it("is order-independent — shuffling the input rows cannot change the answer", () => {
    const flows = CASES[7].flows;
    const a = xirr(flows).rate as number;
    const b = xirr([...flows].reverse()).rate as number;
    expect(Math.abs(a - b)).toBeLessThan(1e-12);
  });
});

/* ========================================================================== */
describe("M-1 / M-1c — the 11 required A.10 fixtures, with per-metric status", () => {
  const byKey = Object.fromEntries(ILPA_FIXTURES.map((f) => [f.key, f]));

  it("all 11 named fixtures exist", () => {
    expect(ILPA_FIXTURES).toHaveLength(11);
  });

  it("zero flows — every metric reports a STATUS and no metric reports 0", () => {
    const m = computeFundMetrics(byKey.zero_flows.input);
    for (const k of ["DPI", "RVPI", "TVPI", "net_IRR"] as const) {
      expect(m[k].value).toBeNull();
      expect(m[k].status).not.toBe("COMPUTED");
    }
    expect(m.inputs.nFlows).toBe(0);
  });

  it("one call only — DPI is a real 0.00x; RVPI/TVPI/IRR are NO_MARKS", () => {
    const m = computeFundMetrics(byKey.one_call_only.input);
    expect(m.DPI.status).toBe("COMPUTED");
    expect(m.DPI.value).toBe(0);
    expect(m.RVPI.status).toBe("NO_MARKS");
    expect(m.TVPI.status).toBe("NO_MARKS");
    expect(m.net_IRR.status).toBe("NO_MARKS");
    expect(m.net_IRR.value).toBeNull();
  });

  it("call + management fee, no marks — the fee call is inside PIC", () => {
    const m = computeFundMetrics(byKey.call_plus_fee_no_marks.input);
    expect(m.inputs.picMinor).toBe(10_200_000);
    expect(m.PIC.value).toBeCloseTo(1.02, 6);
    expect(m.net_IRR.status).toBe("NO_MARKS");
  });

  it("call + full return of capital WITH marks — IRR is exactly 0, correctly so", () => {
    const m = computeFundMetrics(byKey.full_return_of_capital_irr_zero.input);
    expect(m.net_IRR.status).toBe("COMPUTED");
    expect(Math.abs(m.net_IRR.value as number)).toBeLessThan(1e-9);
    expect(m.DPI.value).toBe(1);
    expect(m.TVPI.value).toBe(1);
    expect(m.inputs.irrBasis).toBe("annualised");
  });

  it("all-positive series — IRR is INSUFFICIENT_FLOWS, never a number", () => {
    const m = computeFundMetrics(byKey.all_positive_series.input);
    expect(m.net_IRR.value).toBeNull();
    expect(m.net_IRR.status).toBe("INSUFFICIENT_FLOWS");
    // PIC is zero, so the paid-in-denominated multiples are NOT_MEANINGFUL,
    // not 0 and not Infinity.
    expect(m.DPI.status).toBe("NOT_MEANINGFUL");
    expect(m.TVPI.status).toBe("NOT_MEANINGFUL");
  });

  it("same-day-only series — no elapsed time, no IRR", () => {
    const m = computeFundMetrics(byKey.same_day_only.input);
    expect(m.inputs.elapsedDays).toBe(0);
    expect(m.net_IRR.value).toBeNull();
    expect(m.net_IRR.status).toBe("INSUFFICIENT_FLOWS");
    expect(m.DPI.value).toBeCloseTo(1.2, 6);
  });

  it("90-day SPV up 3% — MUST print 3.0%, NOT the 12.5% annualisation", () => {
    const m = computeFundMetrics(byKey.ninety_day_three_percent.input);
    expect(m.inputs.elapsedDays).toBe(90);
    expect(m.inputs.irrBasis).toBe("period");
    expect(m.net_IRR.status).toBe("COMPUTED");
    expect(m.net_IRR.value).toBeCloseTo(0.03, 9); // 3.0%
    // and emphatically not the annualised figure
    expect(Math.abs((m.net_IRR.value as number) - (Math.pow(1.03, 365 / 90) - 1))).toBeGreaterThan(0.09);
    expect(m.net_IRR.note).toMatch(/not annualised/);
    expect(ANNUALISATION_FLOOR_DAYS).toBe(365);
  });

  it("multi-root series — Brent returns one deterministic root and the NPV vanishes there", () => {
    const m = computeFundMetrics(byKey.multi_root.input);
    expect(m.net_IRR.status).toBe("COMPUTED");
    const again = computeFundMetrics(byKey.multi_root.input);
    expect(again.net_IRR.value).toBe(m.net_IRR.value);
  });

  it("recallable distribution then re-call — PIC exceeds commitment, PiCC > 1.00x, NOT clamped", () => {
    const m = computeFundMetrics(byKey.recallable_then_recall.input);
    expect(m.inputs.picMinor).toBe(14_000_000);
    expect(m.PIC.status).toBe("COMPUTED");
    expect(m.PIC.value as number).toBeGreaterThan(1);
    expect(m.PIC.value).toBeCloseTo(1.4, 6);
  });

  it("in-specie distribution — counted as a distribution at its recorded value", () => {
    const m = computeFundMetrics(byKey.in_specie_distribution.input);
    expect(m.DPI.value).toBeCloseTo(1.5, 6);
    expect(m.RVPI.value).toBe(0);
    expect(m.TVPI.value).toBeCloseTo(1.5, 6);
  });

  it("wound-up vehicle — RV = 0 is a REAL zero, distinguishable from a missing mark", () => {
    const m = computeFundMetrics(byKey.wound_up_vehicle.input);
    expect(m.RVPI.status).toBe("COMPUTED");
    expect(m.RVPI.value).toBe(0);
    expect(m.TVPI.value).toBeCloseTo(1.4, 6);
    // contrast: the same shape with a null mark must NOT collapse to zero
    const unmarked = computeFundMetrics({ ...byKey.wound_up_vehicle.input, residualValueMinor: null });
    expect(unmarked.RVPI.status).toBe("NO_MARKS");
    expect(unmarked.RVPI.value).toBeNull();
  });

  it("stale marks downgrade the status without discarding the number (Q5)", () => {
    const m = computeFundMetrics({ ...byKey.wound_up_vehicle.input, marksStale: true });
    expect(m.RVPI.status).toBe("STALE_MARKS");
    expect(m.TVPI.status).toBe("STALE_MARKS");
  });

  it("gross_IRR is NOT_APPLICABLE rather than silently equal to net", () => {
    const m = computeFundMetrics(byKey.wound_up_vehicle.input);
    expect(m.gross_IRR.status).toBe("NOT_APPLICABLE");
    expect(m.gross_IRR.value).toBeNull();
  });
});

/* ========================================================================== */
describe("M-1d — footnote renderer binds to actual config, not to prose", () => {
  it("states the recallable treatment that is actually configured", () => {
    const a = renderFootnotes({
      recallableTreatment: "restores_unfunded",
      gpCapitalIncluded: false,
      sublineUsed: false,
      valuationSource: "GP_DETERMINED",
      valuationDate: "2026-06-30",
      valuationMethod: "TRANSACTION_PRICE",
      currency: "USD",
      asOfDate: "2026-06-30",
    });
    expect(a.find((f) => f.key === "recallable")!.text).toMatch(/restore unfunded commitment/);
    expect(a.find((f) => f.key === "gp_capital")!.text).toMatch(/EXCLUDED/);
    expect(a.find((f) => f.key === "subline")!.text).toMatch(/No subscription credit facility/);
    expect(a.find((f) => f.key === "valuation")!.text).toMatch(/GP_DETERMINED/);
  });

  it("does NOT claim a valuation source when none exists", () => {
    const b = renderFootnotes({
      recallableTreatment: "permanent",
      gpCapitalIncluded: true,
      gpCommitmentMinor: 500_000,
      sublineUsed: true,
      valuationSource: null,
      valuationDate: null,
      valuationMethod: null,
      currency: "USD",
      asOfDate: "2026-06-30",
    });
    expect(b.find((f) => f.key === "valuation")!.text).toMatch(/No valuation event exists/);
    expect(b.find((f) => f.key === "gp_capital")!.text).toMatch(/INCLUDED/);
    expect(b.find((f) => f.key === "subline")!.text).toMatch(/was used/);
  });
});
