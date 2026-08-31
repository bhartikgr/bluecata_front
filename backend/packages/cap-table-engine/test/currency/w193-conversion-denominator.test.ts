/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 193 · ITEM A · R165.1 / R156.1 — THE CONVERSION DENOMINATOR.
 * ══════════════════════════════════════════════════════════════════════════════
 * `captable/compute.ts` sums the investment amounts of every post-money SAFE with
 * no currency check, and subtracts that sum from the converting SAFE's valuation
 * cap to form the divisor that re-bases `companyCapitalization`:
 *
 *     sharesIssued = SAFE_amount × S0 / (cap − Σ post_money_SAFE_amounts)
 *
 * So a company holding post-money SAFEs in two currencies does not get a
 * mislabelled figure — it gets the WRONG SHARE COUNT, which then sets the round's
 * price per share and therefore EVERY holder's ownership percentage. Capavate
 * converts no currency (R156.1), so the only honest output is a refusal.
 *
 * THE PROOF THAT MATTERS MOST IS THE FIRST ONE. A-1 asserts the FULL
 * `computeCapTable` output for the canonical Wave 52 fixture is BYTE-IDENTICAL to
 * a string captured from the engine BEFORE this wave changed a line. If this wave
 * can refuse a cap table that works today, A-1 is where it shows.
 *
 * THE FIXTURE IS THE EXISTING ONE, not a new one built to suit the fix: the
 * canonical Wave 52 · 52-Q6 scenario from `test/order/w52-pricing-order.test.ts`
 * — $2m post-money SAFE at a $10m cap, priced-round PPS DELIBERATELY ABSENT so the
 * engine must construct its own denominator, which is precisely the denominator
 * under test. Reproduced here rather than imported because that file does not
 * export it; A-0 pins the reproduction against the figures that file asserts, so a
 * drift in either copy is caught rather than hidden.
 */
import { describe, it, expect } from "vitest";
import { computeCapTable, MixedCurrencyConversionError } from "../../src/captable/compute.js";
import {
  computeWaterfall,
  MixedCurrencyWaterfallError,
  type WaterfallClass,
} from "../../src/waterfall/liquidationWaterfall.js";
import {
  statedCurrencies,
  isMixedCurrency,
  describeStatedCurrencies,
} from "../../src/primitives/currencySet.js";
import type { Transaction, Holder } from "../../src/types.js";

/* ───────────────────────── the canonical Wave 52 fixture ───────────────────── */

const FOUNDER_COMMON = BigInt(8_000_000);
const GRANTED_OPTIONS = BigInt(1_000_000);
const EXISTING_POOL = BigInt(1_000_000);

const HOLDERS = [
  { id: "h_f", name: "Founders" },
  { id: "h_o", name: "Options granted" },
  { id: "pool", name: "Option pool" },
  { id: "h_s", name: "SAFE investor" },
  { id: "investors-rA", name: "Series A investors" },
] as unknown as Holder[];

/**
 * @param safeCurrencies one entry per post-money SAFE. `undefined` means the SAFE
 *   carries NO `currency` key at all — which is what every SAFE on the platform
 *   looks like today, because `shared/roundMathEngineAdapter.ts` sets none.
 */
function fixture(safeCurrencies: Array<string | undefined>): Transaction[] {
  const safes = safeCurrencies.map((cur, i) => ({
    type: "issue",
    date: "2026-01-01",
    security: {
      id: `s${i + 1}`,
      holderId: "h_s",
      kind: "safe",
      series: "SAFE",
      /* Split so the TOTAL is always the canonical $2,000,000 however many SAFEs
         the case uses — the sum under test is held constant, and only its UNITS
         vary between cases. Without this, a refusal could be mistaken for an
         arithmetic change. */
      investmentAmount: String(2_000_000 / safeCurrencies.length),
      ...(cur === undefined ? {} : { currency: cur }),
      safe: { type: "post_money_cap", cap: "10000000" },
    },
  }));
  return [
    {
      type: "issue",
      date: "2026-01-01",
      security: { id: "f1", holderId: "h_f", kind: "common", series: "Common", shares: FOUNDER_COMMON },
    },
    {
      type: "issue",
      date: "2026-01-01",
      security: {
        id: "o1", holderId: "h_o", kind: "option", series: "Options",
        option: {
          grantedShares: GRANTED_OPTIONS, exercisePrice: "0.01", vestingMonths: 48, cliffMonths: 12,
          poolName: "Granted and outstanding options",
        },
      },
    },
    {
      type: "issue",
      date: "2026-01-01",
      security: {
        id: "o2", holderId: "pool", kind: "option", series: "Pool",
        option: {
          grantedShares: EXISTING_POOL, exercisePrice: "0.01", vestingMonths: 0, cliffMonths: 0,
          poolName: "Existing unallocated pool",
        },
      },
    },
    ...safes,
    {
      type: "issue_preferred_round",
      date: "2026-02-01",
      round: {
        id: "rA",
        series: "Series A",
        preMoneyValuation: "30000000",
        investmentAmount: "10000000",
        optionPoolPostPercent: "22.5",
        optionPoolMode: "pre_money",
        currency: "USD",
        /* PPS ABSENT ON PURPOSE — the engine must construct the denominator. */
      },
    },
  ] as unknown as Transaction[];
}

const run = (safeCurrencies: Array<string | undefined>) =>
  computeCapTable({
    asOf: "2026-02-01",
    view: "fd",
    formulaRegion: "US",
    holders: HOLDERS,
    transactions: fixture(safeCurrencies),
  } as never);

/** Whole-result serialisation. `bigint` is not JSON-representable, so it is
 *  stringified — the only transformation, applied identically before and after. */
const serialise = (r: unknown) =>
  JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v));

/**
 * CAPTURED FROM THE ENGINE BEFORE WAVE 193 CHANGED A LINE, by running
 * `computeCapTable` over `fixture(["USD"])` on the pre-change tree and printing
 * `serialise(...)` verbatim. 3,863 characters. Pinned as a literal rather than
 * recomputed, because a golden recomputed by the code under test proves nothing.
 */
const GOLDEN_SINGLE_CURRENCY_OUTPUT =
  "{\"asOf\":\"2026-02-01\",\"view\":\"fd\",\"region\":\"US\",\"rows\":[{\"holderId\":\"h_f\",\"holderName\":\"Founders\",\"holderType\":\"other\",\"kind\":\"common\",\"series\":\"Common\",\"shares\":\"8000000\",\"ownershipPercent\":\"40\"},{\"holderId\":\"h_o\",\"holderName\":\"Options granted\",\"holderType\":\"other\",\"kind\":\"option\",\"series\":\"Options\",\"shares\":\"1000000\",\"ownershipPercent\":\"5\"},{\"holderId\":\"pool\",\"holderName\":\"Option pool\",\"holderType\":\"other\",\"kind\":\"option\",\"series\":\"Pool\",\"shares\":\"1000000\",\"ownershipPercent\":\"5\"},{\"holderId\":\"h_s\",\"holderName\":\"SAFE investor\",\"holderType\":\"other\",\"kind\":\"preferred\",\"series\":\"Series A\",\"shares\":\"2500000\",\"ownershipPercent\":\"12.5\",\"invested\":\"2000000\",\"currency\":\"USD\"},{\"holderId\":\"pool\",\"holderName\":\"Option pool\",\"holderType\":\"other\",\"kind\":\"option\",\"series\":\"Pool\",\"shares\":\"2500000\",\"ownershipPercent\":\"12.5\"},{\"holderId\":\"investors-rA\",\"holderName\":\"Series A investors\",\"holderType\":\"other\",\"kind\":\"preferred\",\"series\":\"Series A\",\"shares\":\"5000000\",\"ownershipPercent\":\"25\",\"invested\":\"10000000\",\"currency\":\"USD\"}],\"totalShares\":\"20000000\",\"trace\":[{\"formulaId\":\"round.pricing.order\",\"formulaVersion\":\"52.2.0\",\"region\":\"US\",\"inputs\":{\"storedPricePerShare\":\"(absent - derived)\",\"preMoneyValuation\":\"30000000\",\"investmentAmount\":\"10000000\",\"fdBeforeRound\":\"10000000\"},\"outputs\":{\"pricePerShare\":\"2\",\"pricingDenominator\":\"15000000\",\"newInvestorShares\":\"5000000\",\"iterations\":\"8\",\"converged\":\"true\",\"trail\":\"3 -> 2.0666666712592592694650205988111568862 -> 2.0062630181391589504676398468980565598 -> 2.0006043158770159172747447912432748852 -> 2.0000584017053297956300323969459908229 -> 2.0000056000156800439041229315442083238 -> 2.0000005333334755555934814915950644254 -> 2 -> 2\",\"pricingOrderMode\":\"w52_post_pool_post_conversion\"},\"defHash\":\"see-formula\",\"note\":\"WAVE 52 (52-Q6 option 2): price per share is solved AFTER the option-pool top-up and AFTER SAFE/note conversion, so the pricing denominator contains both. Previously the price was fixed before either existed.\"},{\"formulaId\":\"safe.postmoney.conversion\",\"formulaVersion\":\"1.0.0\",\"region\":\"US\",\"inputs\":{\"purchaseAmount\":\"2000000\",\"capType\":\"post_money_cap\",\"cap\":\"10000000\",\"discount\":\"0\",\"seriesPricePerShare\":\"2\",\"companyCapitalization\":\"12500000\"},\"outputs\":{\"conversionPrice\":\"0.8\",\"safeShares\":\"2500000\",\"binding\":\"cap\"},\"defHash\":\"2f6646a6215bc96b76212f49610e36a1bea9de632816c5f8dfdf173d3b40660a\"},{\"formulaId\":\"esop.topup\",\"formulaVersion\":\"1.0.0\",\"region\":\"US\",\"inputs\":{\"mode\":\"pre_money\",\"targetPoolPercent\":\"22.5\",\"targetPoolPercentUnit\":\"percent_as_written_r16\",\"existingShares\":\"10500000\",\"existingPool\":\"2000000\",\"newInvestorShares\":\"5000000\"},\"outputs\":{\"poolSharesToAdd\":\"2500000\",\"newPoolTotal\":\"4500000\",\"newTotalShares\":\"20000000\",\"resultingPoolPercent\":\"22.5\",\"resultingPoolPercentUnit\":\"percent_as_written_r16\",\"resultingPoolPercentDenominator\":\"existingShares + existingPool + newInvestorShares + poolSharesToAdd (WAVE 58 \u00b7 R27: existingPool is now INSIDE the denominator and inside the solved base)\",\"poolTargetBase\":\"17500000\",\"poolTargetBaseDefinition\":\"existingShares + existingPool + newInvestorShares\",\"poolTargetBaseExclusions\":\"granted options are NOT separated from the unallocated reserve (one data-model figure); warrants are not in compute.ts::applyTopUp's base\"},\"defHash\":\"6223f192abdcf26db61f1e7b7d0848e328d4e2179dd8435aaaea341bb4eaa456\",\"note\":\"Pre-money pool: dilution borne by existing shareholders\"},{\"formulaId\":\"ownership.percent\",\"formulaVersion\":\"1.0.0\",\"region\":\"US\",\"inputs\":{\"totalShares\":\"20000000\",\"holderRows\":\"6\"},\"outputs\":{\"totalOwnership\":\"100.000000\",\"totalOwnershipArithmetic\":\"decimal.js exact sum of the row strings, stated to 6 dp (WAVE 71 \u00b7 D17)\"},\"defHash\":\"see-formula\",\"note\":\"Ownership pro-rata over chosen view denominator\"}],\"formulaIdsUsed\":[\"safe.postmoney.conversion\",\"esop.topup\",\"round.pricing.order\",\"ownership.percent\"]}";

describe("WAVE 193 · A — the post-money SAFE conversion denominator", () => {
  it("A-0 the reproduced fixture IS the canonical Wave 52 scenario", () => {
    /* Anti-drift. If the reproduction here and the fixture in
       test/order/w52-pricing-order.test.ts ever diverge, A-1's golden would be
       pinning a scenario nobody else tests. These four figures are the ones that
       file asserts against the externally published worked example. */
    const r = run(["USD"]) as unknown as {
      totalShares: bigint;
      trace: { formulaId: string; outputs: Record<string, string> }[];
    };
    const pricing = r.trace.find((t) => t.formulaId === "round.pricing.order")!;
    expect(pricing.outputs.pricingDenominator).toBe("15000000");
    expect(pricing.outputs.pricePerShare).toBe("2");
    expect(pricing.outputs.newInvestorShares).toBe("5000000");
    expect(r.totalShares.toString()).toBe("20000000");
    /* And the PPS really is absent from the fixture, so the denominator under
       test really is the one the engine constructed. */
    const round = (fixture(["USD"]).find((t) => t.type === "issue_preferred_round") as {
      round: Record<string, unknown>;
    }).round;
    expect(Object.prototype.hasOwnProperty.call(round, "pricePerShare")).toBe(false);
  });

  it("A-1 THE REGRESSION THAT MATTERS MOST — a single-currency cap table is BYTE-IDENTICAL to before this wave", () => {
    expect(serialise(run(["USD"]))).toBe(GOLDEN_SINGLE_CURRENCY_OUTPUT);
  });

  it("A-1b and byte-identical is asserted over the WHOLE result, not a summary of it", () => {
    /* Guards A-1 against being weakened into a spot-check later: the golden must
       still contain the rows, the total, the trace and the formula ids. */
    expect(GOLDEN_SINGLE_CURRENCY_OUTPUT.length).toBe(3863);
    for (const key of ["rows", "totalShares", "trace", "formulaIdsUsed", "ownershipPercent", "safeShares"]) {
      expect(GOLDEN_SINGLE_CURRENCY_OUTPUT).toContain(key);
    }
  });

  it("A-2 a GENUINELY MIXED set REFUSES rather than producing a share count", () => {
    expect(() => run(["USD", "GBP"])).toThrow(MixedCurrencyConversionError);
  });

  it("A-2b the refusal NAMES the currencies it found and states the consequence, with no ALL-CAPS code", () => {
    let caught: unknown;
    try { run(["USD", "GBP"]); } catch (e) { caught = e; }
    const err = caught as MixedCurrencyConversionError;
    expect(err).toBeInstanceOf(MixedCurrencyConversionError);
    expect(err.code).toBe("mixed_currency_conversion_denominator");
    expect(err.statedCurrencies).toBe("GBP and USD");
    expect(err.message).toContain("GBP and USD");
    expect(err.message).toContain("does not convert currency");
    expect(err.message).toContain("ownership");
    /* R152 item 3 / R165.4 — never an all-caps underscore code in the words a
       person reads. The machine code lives on `.code`, in lower case. */
    expect(err.message).not.toMatch(/[A-Z]{3,}_[A-Z]{3,}/);
  });

  it("A-3 an ALL-ABSENT set still computes — this is every cap table on the platform today", () => {
    /* Rounds are 1045/1045 NULL currency and the production adapter passes no
       currency at all, so absence is the universal case. Refusing it would break
       every existing cap table for no correctness gain. */
    expect(() => run([undefined, undefined])).not.toThrow();
    expect(serialise(run([undefined]))).toBe(
      GOLDEN_SINGLE_CURRENCY_OUTPUT.replace('"invested":"2000000","currency":"USD"', '"invested":"2000000"'),
    );
  });

  it("A-4 ONE STATED currency plus ABSENT siblings computes — the mid-migration case", () => {
    /* The 1045 NULL rounds are corrected ONE AT A TIME through the round edit
       dialog, so a company legitimately holds one stated round and three unstated
       ones halfway through. Refusing that would break the platform precisely for
       the founder who is doing the right thing. */
    expect(() => run(["USD", undefined])).not.toThrow();
    expect(() => run([undefined, "GBP", undefined])).not.toThrow();
  });

  it("A-5 THREE stated currencies refuse and all three are named", () => {
    let caught: unknown;
    try { run(["USD", "GBP", "EUR"]); } catch (e) { caught = e; }
    expect((caught as MixedCurrencyConversionError).statedCurrencies).toBe("EUR, GBP and USD");
  });

  it("A-6 the refusal fires even when the mixed sum drives the effective cap to zero or below", () => {
    /* THE TRAP. `effectiveCap.gt(0)` is itself decided by the corrupt sum: when
       the sum meets or exceeds the cap, the rebase is silently SKIPPED and the
       SAFE converts against the unrebased companyCap — a different wrong answer,
       equally silent. A guard placed inside that branch would let this case
       through. Σ = $10m against a $10m cap makes effectiveCap exactly 0. */
    const cap10mWorthOfSafes = fixture(["USD", "GBP"]).map((t) => {
      const sec = (t as { security?: { safe?: { type?: string } }; }).security;
      if (sec?.safe?.type === "post_money_cap") {
        (sec as { investmentAmount: string }).investmentAmount = "5000000";
      }
      return t;
    });
    expect(() =>
      computeCapTable({
        asOf: "2026-02-01", view: "fd", formulaRegion: "US",
        holders: HOLDERS, transactions: cap10mWorthOfSafes,
      } as never),
    ).toThrow(MixedCurrencyConversionError);
  });

  it("A-7 a PRE-MONEY SAFE never consults the sum, so a mixed set does not refuse it", () => {
    /* The refusal is at the point of USE, not the point of computation: only a
       post-money SAFE with a positive cap consumes the sum. A cap table the
       corrupt sum never touches must not be refused. */
    const txs = fixture(["USD", "GBP"]).map((t) => {
      const sec = (t as { security?: { safe?: { type?: string } } }).security;
      if (sec?.safe?.type === "post_money_cap") sec.safe.type = "pre_money_cap";
      return t;
    });
    expect(() =>
      computeCapTable({
        asOf: "2026-02-01", view: "fd", formulaRegion: "US",
        holders: HOLDERS, transactions: txs,
      } as never),
    ).not.toThrow();
  });
});

describe("WAVE 193 · A.5 — the exit waterfall can now refuse, because it now has a unit", () => {
  const cls = (id: string, invested: string, currency?: string): WaterfallClass => ({
    classId: id,
    className: id,
    invested,
    shares: BigInt(4_000_000),
    liquidationPreferenceMultiple: 1,
    participating: false,
    seniority: 0,
    ...(currency === undefined ? {} : { currency }),
  });

  const waterfall = (preferred: WaterfallClass[], exitProceedsCurrency?: string) =>
    computeWaterfall({
      exitProceeds: "50000000",
      preferred,
      common: [{ holderId: "h_f", shares: BigInt(8_000_000) }],
      formulaId: "waterfall.liquidation",
      formulaVersion: "1.0.0",
      region: "US",
      formulaDef: { formula: "test" },
      ...(exitProceedsCurrency === undefined ? {} : { exitProceedsCurrency }),
    });

  it("A.5-1 the type now HAS a currency field — the refusal was impossible without it", () => {
    /* R165.1 named this: the class had no currency field at all, so it could not
       even refuse. Asserted on the VALUE, so the field cannot be deleted again
       without this failing. */
    expect(cls("A", "10000000", "GBP").currency).toBe("GBP");
    expect(cls("A", "10000000").currency).toBeUndefined();
  });

  it("A.5-2 a MIXED-currency waterfall REFUSES", () => {
    expect(() => waterfall([cls("A", "10000000", "USD"), cls("B", "4000000", "GBP")]))
      .toThrow(MixedCurrencyWaterfallError);
  });

  it("A.5-3 exit proceeds stated in a DIFFERENT currency from the classes also refuses", () => {
    /* The preference stack is subtracted FROM the proceeds and each class's
       preference is compared AGAINST a share of them, so this is the same
       corruption one level up. */
    expect(() => waterfall([cls("A", "10000000", "USD")], "GBP")).toThrow(MixedCurrencyWaterfallError);
  });

  it("A.5-4 the refusal names the currencies and reads as a sentence", () => {
    let caught: unknown;
    try { waterfall([cls("A", "10000000", "USD"), cls("B", "4000000", "GBP")]); } catch (e) { caught = e; }
    const err = caught as MixedCurrencyWaterfallError;
    expect(err.code).toBe("mixed_currency_exit_waterfall");
    expect(err.message).toContain("GBP and USD");
    expect(err.message).toContain("does not convert currency");
    expect(err.message).not.toMatch(/[A-Z]{3,}_[A-Z]{3,}/);
  });

  it("A.5-5 every EXISTING waterfall is unaffected — no caller states a currency, and absence never refuses", () => {
    const out = waterfall([cls("A", "10000000"), cls("B", "4000000")]);
    expect(out.payouts.length).toBeGreaterThan(0);
    /* And one stated code with absent siblings computes too, for the same
       mid-migration reason as A-4. */
    expect(() => waterfall([cls("A", "10000000", "USD"), cls("B", "4000000")])).not.toThrow();
  });
});

describe("WAVE 193 · A — the absent-vs-mixed decision itself, pinned", () => {
  it("absent, empty and whitespace are NOT stated currencies", () => {
    expect(statedCurrencies([undefined, null, "", "   "])).toEqual([]);
    expect(isMixedCurrency([undefined, null, "", "   "])).toBe(false);
  });

  it("one stated code, however many absent siblings, is not mixed", () => {
    expect(isMixedCurrency(["USD", undefined, null, "USD"])).toBe(false);
    expect(statedCurrencies(["USD", undefined, "USD"])).toEqual(["USD"]);
  });

  it("two or more distinct stated codes IS mixed, and the description is stable and sorted", () => {
    expect(isMixedCurrency(["USD", "GBP"])).toBe(true);
    expect(describeStatedCurrencies(["USD", "GBP"])).toBe("GBP and USD");
    expect(describeStatedCurrencies(["GBP", "USD"])).toBe("GBP and USD");
    expect(describeStatedCurrencies(["SGD", "USD", "GBP"])).toBe("GBP, SGD and USD");
  });

  it("codes are compared trimmed, so a stray space is not a second currency", () => {
    expect(isMixedCurrency(["USD", " USD "])).toBe(false);
  });

  it("no currency is hardcoded anywhere in the decision (R156.2) — an unknown code behaves like any other", () => {
    /* The helper never names a currency; it compares whatever arrives. Two codes
       the engine's own `Currency` union does not contain still refuse. */
    expect(isMixedCurrency(["XXX", "YYY"])).toBe(true);
    expect(isMixedCurrency(["XXX", "XXX"])).toBe(false);
  });
});
