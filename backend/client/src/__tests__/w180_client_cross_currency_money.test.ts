/**
 * WAVE 180 · ITEM A — THE CROSS-CURRENCY MONEY SWEEP, EXECUTED (client half).
 *
 * SITES COVERED: 4 (admin/Pricing.tsx billing metrics), 5 (admin/Companies.tsx
 * ARR and total-raised columns), 7 (CapitalizationJourney.tsx cumulative-raised
 * chart), plus the shared client bucket contract they all run on
 * (client/src/lib/money/currencyBuckets.ts).
 *
 * WHY THE TESTS ARE SHAPED THIS WAY. R137 says a fix must reach the rendered
 * surface, not just a store — so what is asserted here is the STRING each site
 * puts on screen, produced by the same exported function the JSX calls. Each site
 * gets a MIXED case (USD + CAD + HKD, the live combination from R149.4) and a
 * SINGLE-CURRENCY NEGATIVE CONTROL. The controls matter as much as the mixed
 * cases: a "fix" that printed a refusal unconditionally would satisfy every mixed
 * assertion and would have destroyed the ordinary single-currency view.
 *
 * THE CONTROLS USE CAD AND HKD, NOT USD, on purpose. A USD control passes against
 * a hardcoded `"USD"` formatter argument and therefore measures nothing — that
 * hardcoded default was half of the original defect.
 *
 * NO CONVERTED TOTAL IS ASSERTED ANYWHERE. There is no rate source on this
 * platform (see the P2 case in the server half of this wave for the full state of
 * the two FX tables), so an expected converted figure would be a rate invented in
 * a test file.
 *
 * The bigint arithmetic and the MAX_SAFE_INTEGER boundary are exercised directly,
 * because HK$2,000,000.00 is 200,000,000 minor units and a portfolio of them is
 * exactly where a float or an unguarded Number() starts losing cents.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  newBuckets, addMinor, singleScalar, bucketRows, dividedBuckets, mergeBucketMaps,
  normalizeCode, isIsoCode, type CurrencyBucketRow,
} from "@/lib/money/currencyBuckets";
import { billingMetricScope, billingMetricValue } from "@/pages/admin/Pricing";
import { annualArrHint, raisedMixedText } from "@/pages/admin/Companies";

/* The three live currencies. CA$1,200.00 and HK$2,000,000.00 are the two figures
 * owner ruling R149.4 records as really present in live data. */
const USD_MINOR = 500_00;
const CAD_MINOR = 1_200_00;
const HKD_MINOR = 2_000_000_00;

const rows = (...pairs: Array<[string, number | null]>): CurrencyBucketRow[] =>
  pairs.map(([currency, minor]) => ({ currency, minor }));

/* A plain formatter, so the assertions below pin the CURRENCY ROUTING rather than
 * Intl's locale output, which varies by ICU build. */
const fmt = (minor: number, currency: string) => `${currency} ${(minor / 100).toFixed(2)}`;

/* ══════════════════════════════════════════════════════════════════════════
 * THE SHARED CONTRACT — client/src/lib/money/currencyBuckets.ts
 * ════════════════════════════════════════════════════════════════════════ */
describe("W180 — the client bucket contract", () => {
  it("K1 accumulates per currency in bigint and never mixes two codes into one bucket", () => {
    const b = newBuckets();
    expect(addMinor(b, "USD", USD_MINOR)).toBe(true);
    expect(addMinor(b, "CAD", CAD_MINOR)).toBe(true);
    expect(addMinor(b, "HKD", HKD_MINOR)).toBe(true);
    expect(addMinor(b, "usd", USD_MINOR)).toBe(true); // case-folded onto the same bucket
    const r = bucketRows(b);
    expect(r).toHaveLength(3);
    expect(r.find((x) => x.currency === "USD")!.minor).toBe(USD_MINOR * 2);
    expect(r.find((x) => x.currency === "CAD")!.minor).toBe(CAD_MINOR);
    expect(r.find((x) => x.currency === "HKD")!.minor).toBe(HKD_MINOR);
  });

  it("K2 a single currency yields a scalar; more than one REFUSES with a named reason", () => {
    const one = newBuckets();
    addMinor(one, "HKD", HKD_MINOR);
    const s1 = singleScalar(one);
    expect(s1.available).toBe(true);
    expect(s1.minor).toBe(HKD_MINOR);
    expect(s1.currency).toBe("HKD");

    const many = newBuckets();
    addMinor(many, "USD", USD_MINOR);
    addMinor(many, "CAD", CAD_MINOR);
    const s2 = singleScalar(many);
    expect(s2.available).toBe(false);
    expect(s2.minor).toBeNull();
    expect(s2.currency).toBeNull();
    expect(s2.reason).toBe("needs_fx_conversion");
    expect([...s2.currencies].sort()).toEqual(["CAD", "USD"]);
  });

  it("K3 an empty bucket set refuses with `no_data` — NOT with a fabricated zero", () => {
    const s = singleScalar(newBuckets());
    expect(s.available).toBe(false);
    expect(s.minor).toBeNull();
    expect(s.reason).toBe("no_data");
    /* The distinction is the whole point: "nothing on record" and "nothing owed"
     * are different facts and used to render as the same $0.00. */
    expect(s.reason).not.toBe("needs_fx_conversion");
  });

  it("K4 non-ISO codes are COUNTED AND EXCLUDED, never silently folded in", () => {
    const b = newBuckets();
    expect(addMinor(b, "USD", USD_MINOR)).toBe(true);
    let excluded = 0;
    for (const junk of ["", "  ", "US$", "usd1", "BITCOIN", "12", "$"]) {
      if (!addMinor(b, junk, 999_00)) excluded += 1;
    }
    expect(excluded).toBe(7);
    /* Every rejected row is absent from the total, not rounded into it. */
    expect(bucketRows(b)).toHaveLength(1);
    expect(bucketRows(b)[0]!.minor).toBe(USD_MINOR);
    for (const junk of ["", "US$", "BITCOIN"]) expect(isIsoCode(junk)).toBe(false);
    expect(isIsoCode("hkd")).toBe(true);
    expect(normalizeCode(" cad ")).toBe("CAD");
  });

  it("K5 the MAX_SAFE_INTEGER boundary returns null rather than a wrong number", () => {
    const b = newBuckets();
    /* Two additions each just under the boundary: the bigint sum is exact, and it
     * is the CONVERSION back to a JS number that is refused. A float accumulator
     * would have returned a plausible, wrong, silently-rounded figure here. */
    addMinor(b, "HKD", Number.MAX_SAFE_INTEGER - 1);
    addMinor(b, "HKD", Number.MAX_SAFE_INTEGER - 1);
    const r = bucketRows(b);
    expect(r).toHaveLength(1);
    expect(r[0]!.currency).toBe("HKD");
    expect(r[0]!.minor).toBeNull();

    const s = singleScalar(b);
    expect(s.available).toBe(false);
    expect(s.reason).toBe("over_safe_integer");
    expect(s.minor).toBeNull();
  });

  it("K6 exactly MAX_SAFE_INTEGER is still reportable — the gate is not off by one", () => {
    const b = newBuckets();
    addMinor(b, "USD", Number.MAX_SAFE_INTEGER);
    expect(bucketRows(b)[0]!.minor).toBe(Number.MAX_SAFE_INTEGER);
    expect(singleScalar(b).available).toBe(true);
  });

  it("K7 dividing (monthly⇄annual) stays exact per currency and never crosses codes", () => {
    const b = newBuckets();
    addMinor(b, "USD", 1_200_00);   // 120000 / 12 = 10000
    addMinor(b, "HKD", 2_000_000_00);
    const d = bucketRows(dividedBuckets(b, 12));
    expect(d.find((x) => x.currency === "USD")!.minor).toBe(100_00);
    /* 200000000 / 12 = 16666666.66… → half-up in bigint, no float drift. */
    expect(d.find((x) => x.currency === "HKD")!.minor).toBe(16_666_667);
  });

  it("K8 merging two bucket maps adds like with like and keeps unlike apart", () => {
    const a = newBuckets(); addMinor(a, "USD", USD_MINOR); addMinor(a, "CAD", CAD_MINOR);
    const c = newBuckets(); addMinor(c, "USD", USD_MINOR); addMinor(c, "HKD", HKD_MINOR);
    const m = bucketRows(mergeBucketMaps(a, c));
    expect(m).toHaveLength(3);
    expect(m.find((x) => x.currency === "USD")!.minor).toBe(USD_MINOR * 2);
    expect(m.find((x) => x.currency === "CAD")!.minor).toBe(CAD_MINOR);
    expect(m.find((x) => x.currency === "HKD")!.minor).toBe(HKD_MINOR);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * SITE 4 — client/src/pages/admin/Pricing.tsx  (MRR / ARR / expansion tiles)
 * ════════════════════════════════════════════════════════════════════════ */
describe("SITE 4 — admin Pricing billing metrics", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../pages/admin/Pricing.tsx"), "utf8");

  it("S4.1 MIXED: a tile prints a stated refusal naming the currencies, not a number", () => {
    const out = billingMetricValue(rows(["USD", USD_MINOR], ["CAD", CAD_MINOR], ["HKD", HKD_MINOR]), fmt);
    for (const c of ["USD", "CAD", "HKD"]) expect(out).toContain(c);
    expect(out).toContain("not added");
    /* The pre-fix figure — the three minor amounts summed — must not appear in any
     * form, which is what makes this fail if the reducer comes back. */
    const wrong = USD_MINOR + CAD_MINOR + HKD_MINOR;
    expect(out).not.toContain(String(wrong));
    expect(out).not.toContain((wrong / 100).toFixed(2));
    /* And it is neither blank nor a zero. */
    expect(out.trim()).not.toBe("");
    expect(out).not.toMatch(/^[^0-9]*0(\.00)?[^0-9]*$/);
  });

  it("S4.2 MIXED: the scope sentence states what is included, excluded and why", () => {
    const s = billingMetricScope(rows(["USD", USD_MINOR], ["CAD", CAD_MINOR], ["HKD", HKD_MINOR]), 4);
    expect(s).toContain("3 currencies");
    for (const c of ["USD", "CAD", "HKD"]) expect(s).toContain(c);
    expect(s).toContain("no exchange rate");
    expect(s).toContain("4 subscriptions excluded");
    expect(s).toContain("no ISO currency on record");
  });

  it("S4.3 NEGATIVE CONTROL — single-currency (HKD) tiles still print the real figure, in HKD", () => {
    const out = billingMetricValue(rows(["HKD", HKD_MINOR]), fmt);
    expect(out).toBe("HKD 2000000.00");
    /* Specifically not relabelled as dollars, which the hardcoded formatter did. */
    expect(out).not.toContain("USD");
    const s = billingMetricScope(rows(["HKD", HKD_MINOR]), 0);
    expect(s).toContain("in HKD");
    expect(s).not.toContain("excluded");
  });

  it("S4.4 NO DATA states so; OVER-RANGE states so — neither is a zero or a blank", () => {
    expect(billingMetricValue([], fmt)).toBe("Not on record");
    expect(billingMetricScope([], 0)).toContain("No subscription amounts on record");
    const over = billingMetricValue(rows(["CAD", null]), fmt);
    expect(over).toContain("CAD");
    expect(over).toContain("exceeds exact range");
  });

  it("S4.5 R137 — the refusal and the scope sentence really are on the rendered page", () => {
    /* A helper that no JSX calls is a fix that never reaches a GP's screen. */
    expect(src).toContain('data-testid="text-billing-metrics-scope"');
    expect(src).toContain('data-testid="panel-billing-metrics-by-currency"');
    expect(src).toMatch(/billingMetricValue\(/);
    expect(src).toMatch(/billingMetricScope\(/);
    /* The tile LABELS are untouched — R143.1 scores a replaced text node as a
     * removed copy string, so these six literals must survive byte-verbatim. */
    for (const label of [
      'label: "MRR"', 'label: "ARR"', "Scale + Enterprise MRR", "New Revenue (trial)",
      "Cancelled share (all-time)", "Past due",
    ]) {
      expect(src, `${label} must still be present verbatim`).toContain(label);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * SITE 5 — client/src/pages/admin/Companies.tsx  (ARR + total raised columns)
 * ════════════════════════════════════════════════════════════════════════ */
describe("SITE 5 — admin Companies ARR and raised columns", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../pages/admin/Companies.tsx"), "utf8");

  it("S5.1 MIXED: the ARR hint lists each currency separately and says they are not added", () => {
    const h = annualArrHint(9, rows(["USD", USD_MINOR], ["CAD", CAD_MINOR], ["HKD", HKD_MINOR]), 0);
    expect(h).toContain("by currency");
    expect(h).toContain("Not added together");
    expect(h).toContain("no exchange rate");
    /* This page's formatter emits SYMBOLS, and the three symbols are distinct —
     * "$", "CA$", "HK$". That distinction IS the fix reaching the screen: before
     * this wave all three amounts were summed and printed behind a single "$". */
    expect(h).toContain("CA$");
    expect(h).toContain("HK$");
    expect(h).toMatch(/(^|[^A-Z])\$500/);
    expect(h).not.toContain(String(USD_MINOR + CAD_MINOR + HKD_MINOR));
  });

  it("S5.2 MIXED: excluded no-currency rows are COUNTED ON SCREEN, not dropped in silence", () => {
    const h = annualArrHint(9, rows(["USD", USD_MINOR], ["CAD", CAD_MINOR]), 3);
    expect(h).toContain("3 rows excluded");
    expect(h).toContain("no ISO currency on record");
    /* Singular is not mangled. */
    expect(annualArrHint(2, rows(["CAD", CAD_MINOR]), 1)).toContain("1 row excluded");
  });

  it("S5.3 NEGATIVE CONTROL — single-currency (CAD) still prints one real figure in CAD", () => {
    const h = annualArrHint(4, rows(["CAD", CAD_MINOR]), 0);
    expect(h).toContain("annual ARR");
    /* CA$1,200.00 from R149.4. This page's formatter abbreviates at scale, so the
     * assertion is on the CA$ symbol and the 1.2 magnitude rather than on Intl's
     * grouping, which varies with the ICU build. What matters is that it is
     * Canadian dollars and not the bare "$" it used to be. */
    expect(h).toContain("CA$");
    expect(h).toMatch(/1[.,]2/);
    expect(h).not.toContain("by currency");
    expect(h).not.toContain("excluded");
  });

  it("S5.4 the empty and the not-on-record cases are DIFFERENT stated sentences", () => {
    expect(annualArrHint(0, [], 0)).toContain("No rows in scope");
    expect(annualArrHint(5, [], 0)).toContain("not on record");
    /* Neither is a fabricated zero. */
    expect(annualArrHint(0, [], 0)).not.toContain("0.00");
    expect(annualArrHint(5, [], 0)).not.toContain("0.00");
  });

  it("S5.5 the custom noun is carried through and capitalised for the sentence form", () => {
    const h = annualArrHint(3, rows(["USD", USD_MINOR], ["HKD", HKD_MINOR]), 0, "past-due outstanding");
    expect(h).toContain("Past-due outstanding by currency");
  });

  it("S5.6 over-range in one currency is named, and the other currencies still report", () => {
    const h = annualArrHint(3, rows(["USD", USD_MINOR], ["HKD", null]), 0);
    expect(h).toContain("HKD not reportable");
    expect(h).toContain("500");
  });

  it("S5.7 the total-raised cell names both currencies instead of showing a total", () => {
    const t = raisedMixedText(["CAD", "HKD"]);
    expect(t).toContain("CAD");
    expect(t).toContain("HKD");
    expect(t).toContain("no single total");
    expect(t).toContain("no exchange rate");
  });

  it("S5.8 with no currencies on record the cell is the platform's em dash, never a zero", () => {
    expect(raisedMixedText([])).toBe("—");
    expect(raisedMixedText(undefined)).toBe("—");
  });

  it("S5.9 R137 — both helpers are called from JSX and the mixed cell has a testid", () => {
    expect(src).toMatch(/annualArrHint\(/);
    expect(src).toMatch(/raisedMixedText\(/);
    expect(src).toContain("text-raised-mixed-");
    /* WAVE 124's hint is untouched: its own test executes it directly, so its
     * signature and body must not have moved. */
    expect(src).toMatch(/pastDueOutstandingHint\(/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * SITE 7 — client/src/components/CapitalizationJourney.tsx (cumulative raised)
 * ════════════════════════════════════════════════════════════════════════ */
describe("SITE 7 — CapitalizationJourney cumulative-raised chart", () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, "../components/CapitalizationJourney.tsx"), "utf8",
  );

  it("S7.1 the chart derives the currency set from the rounds it is plotting", () => {
    expect(src).toMatch(/seriesCurrencies/);
    expect(src).toMatch(/seriesCrossCurrency/);
    expect(src).toMatch(/seriesCurrency/);
  });

  it("S7.2 MIXED: the cumulative series is broken rather than drawn across currencies", () => {
    /* A cumulative line adds each round onto the last, so a mixed series is a
     * line whose every point after the first is a meaningless number. The series
     * is broken at that point, and the panel says why. */
    expect(src).toMatch(/let broken = seriesCrossCurrency;/);
    expect(src).toContain('data-testid="panel-cumulative-raised-cross-currency"');
    expect(src).toContain('data-testid="text-cumulative-raised-refusal"');
  });

  it("S7.3 the scope of the chart is stated on screen beside it", () => {
    expect(src).toContain('data-testid="text-cumulative-raised-scope"');
  });

  it("S7.4 NEGATIVE CONTROL — the axis and tooltip format in the SERIES' currency, not USD", () => {
    /* Every formatter on this chart now receives the derived currency. If any one
     * of them kept a hardcoded default, a single-currency HKD chart would print
     * HK$ figures with a dollar sign. */
    const formatterCalls = [...src.matchAll(/currency:\s*seriesCurrency/g)];
    expect(formatterCalls.length).toBeGreaterThanOrEqual(3);
    /* And the cross-currency memo dependency is declared, so the chart re-derives
     * when the round set changes rather than caching a stale verdict. */
    expect(src).toMatch(/\[novapayRounds, seriesCrossCurrency\]/);
  });

  it("S7.5 the platform's existing mixed-currency refusal on this page is still wired", () => {
    /* readCompanyMoneyOnRecord already refused on a mixed ledger before this wave
     * and is surfaced further down this same component. Site 7 had to agree with
     * it rather than contradict it two panels apart. */
    expect(src).toMatch(/readCompanyMoneyOnRecord|mixed_currency/);
  });
});
