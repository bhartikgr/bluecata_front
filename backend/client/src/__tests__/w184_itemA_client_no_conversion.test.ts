/**
 * WAVE 184 · ITEM A · R156.1 — NO CURRENCY CONVERSION ANYWHERE (client half).
 *
 * TWO SITES, both named by the owner:
 *
 *   SITE 8 — client/src/pages/admin/Pricing.tsx, the "Total MRR (shown)" tile.
 *   It summed `annualAmountMinor / 12` across every filtered subscription
 *   regardless of `s.currency` and then labelled the result "USD". The row cell
 *   in the same table formats each row with `s.currency`, which is the proof the
 *   rows are mixed.
 *
 *   THE SOFT-CIRCLE CURRENCY PICKER — client/src/pages/investor/CompanyDetail.tsx.
 *   It converts nothing, and it is DELIBERATELY NOT REMOVED. The owner's standing
 *   rules are no silent drops and "I'd rather add than delete". What it must now
 *   do is STATE the delivery rule rather than leave an investor to assume the
 *   platform will convert.
 *
 * WHY EACH ASSERTION IS SHAPED THIS WAY.
 *
 *   · The MRR tile is proved through the SAME exported functions the JSX calls,
 *     composed in the SAME order, so the assertion measures the rendered string
 *     rather than a private helper.
 *   · Every mixed case is paired with a SINGLE-CURRENCY NEGATIVE CONTROL. A
 *     "fix" that refused unconditionally would satisfy every refusal assertion
 *     while destroying the ordinary view, and would pass a one-poled test.
 *   · The controls use CAD and HKD, never USD: a USD control passes against a
 *     hardcoded `"USD"` formatter argument and therefore measures nothing — that
 *     hardcoded default was half of the original defect.
 *   · NO CONVERTED TOTAL IS ASSERTED ANYWHERE. This platform holds no exchange
 *     rate; an expected converted figure would be a rate invented in a test.
 *   · The picker is proved by counting the control and its options in source, so
 *     that a future wave which quietly deletes the widget fails here as well as
 *     in the guard.
 *
 * Static imports only; no process.env.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { newBuckets, addMinor, bucketRows, dividedBuckets } from "@/lib/money/currencyBuckets";
import { billingMetricScope, billingMetricValue } from "@/pages/admin/Pricing";

const REPO = path.resolve(__dirname, "..", "..", "..");
const PRICING = path.join(REPO, "client/src/pages/admin/Pricing.tsx");
const COMPANY_DETAIL = path.join(REPO, "client/src/pages/investor/CompanyDetail.tsx");

/* A plain formatter, so the assertions pin CURRENCY ROUTING rather than Intl's
 * locale output, which varies by ICU build. */
const fmt = (minor: number, currency: string) => `${currency} ${(minor / 100).toFixed(2)}`;

/* The live combination recorded by R149.4: USD alongside CA$1,200.00 and
 * HK$2,000,000.00. Annual amounts in minor units. */
type Sub = { currency: string; annualAmountMinor: number };
const USD_ANNUAL = 240_00;          // the owner's own $240 annual fee
const CAD_ANNUAL = 1_200_00;
const HKD_ANNUAL = 2_000_000_00;

/** Exactly the composition the tile performs: bucket the ANNUAL amounts per ISO
 *  code, divide once at the bucket, then render. */
function tile(subs: Sub[]): { value: string; scope: string; rowCount: number } {
  const b = newBuckets();
  let excluded = 0;
  for (const s of subs) if (!addMinor(b, s.currency, s.annualAmountMinor)) excluded += 1;
  const mrrRows = bucketRows(dividedBuckets(b, 12));
  return {
    value: billingMetricValue(mrrRows, fmt),
    scope: billingMetricScope(bucketRows(b), excluded),
    rowCount: mrrRows.length,
  };
}

describe("W184 · A · site 8 — the Total MRR tile REFUSES a mixed-currency total", () => {
  it("names the currencies and adds nothing when subscriptions span three codes", () => {
    const t = tile([
      { currency: "USD", annualAmountMinor: USD_ANNUAL },
      { currency: "CAD", annualAmountMinor: CAD_ANNUAL },
      { currency: "HKD", annualAmountMinor: HKD_ANNUAL },
    ]);
    expect(t.value).toContain("not added");
    for (const c of ["USD", "CAD", "HKD"]) expect(t.value).toContain(c);
    expect(t.rowCount).toBe(3);
  });

  it("the refusal is not a zero and not a blank", () => {
    const t = tile([
      { currency: "CAD", annualAmountMinor: CAD_ANNUAL },
      { currency: "HKD", annualAmountMinor: HKD_ANNUAL },
    ]);
    expect(t.value.trim().length).toBeGreaterThan(0);
    expect(t.value).not.toMatch(/^\D*0(\.00)?\D*$/);
  });

  it("no converted figure appears: the old code would have printed the raw SUM labelled USD", () => {
    const t = tile([
      { currency: "USD", annualAmountMinor: USD_ANNUAL },
      { currency: "CAD", annualAmountMinor: CAD_ANNUAL },
    ]);
    /* The old defect, computed here only to assert it is ABSENT. */
    const oldWrongTotal = fmt(Math.round((USD_ANNUAL + CAD_ANNUAL) / 12), "USD");
    expect(t.value).not.toBe(oldWrongTotal);
  });

  it("the scope sentence states why no combined figure is shown", () => {
    const t = tile([
      { currency: "USD", annualAmountMinor: USD_ANNUAL },
      { currency: "CAD", annualAmountMinor: CAD_ANNUAL },
    ]);
    expect(t.scope).toContain("no exchange rate");
    expect(t.scope).toContain("2 currencies");
  });
});

describe("W184 · A · site 8 — NEGATIVE CONTROL: a single-currency platform is unharmed", () => {
  it("renders the same monthly figure it always did, in ITS OWN code (CAD, not USD)", () => {
    const t = tile([
      { currency: "CAD", annualAmountMinor: CAD_ANNUAL },
      { currency: "CAD", annualAmountMinor: CAD_ANNUAL },
    ]);
    /* Byte-identical to the old arithmetic for a non-negative total:
     * Math.round(total / 12). Sum-then-divide, as the tile now does. */
    expect(t.value).toBe(fmt(Math.round((CAD_ANNUAL * 2) / 12), "CAD"));
    expect(t.value).not.toContain("USD");
  });

  it("an HKD-only platform is likewise unconverted and unlabelled as dollars", () => {
    const t = tile([{ currency: "HKD", annualAmountMinor: HKD_ANNUAL }]);
    expect(t.value).toBe(fmt(Math.round(HKD_ANNUAL / 12), "HKD"));
  });

  it("an empty platform says so rather than printing 0", () => {
    expect(tile([]).value).toBe("Not on record");
  });

  it("a subscription with no ISO currency is EXCLUDED and the exclusion is stated, never silently folded in", () => {
    const t = tile([
      { currency: "CAD", annualAmountMinor: CAD_ANNUAL },
      { currency: "", annualAmountMinor: 99_99 },
    ]);
    expect(t.value).toBe(fmt(Math.round(CAD_ANNUAL / 12), "CAD"));
    expect(t.scope).toContain("1 subscription excluded");
  });
});

describe("W184 · A · site 8 — the tile's JSX no longer hardcodes a currency", () => {
  const src = fs.readFileSync(PRICING, "utf8");

  it('the "Total MRR (shown)" label is byte-verbatim (R143.1: a replaced text node is a removed string)', () => {
    expect(src).toContain(">Total MRR (shown)<");
  });

  it('the tile no longer formats its value with a literal "USD"', () => {
    const tileIdx = src.indexOf(">Total MRR (shown)<");
    expect(tileIdx).toBeGreaterThan(-1);
    const window = src.slice(tileIdx, tileIdx + 400);
    expect(window).not.toContain('"USD"');
    expect(window).toContain("mrrValueText");
  });

  it("the old cross-currency reduce is gone from the file's code", () => {
    /* `totalMrrMinor` survives only inside the explanatory comment that records
     * what was wrong; it must not survive as an identifier being rendered. */
    expect(src).not.toContain("{fmtMoney(Math.round(totalMrrMinor)");
  });

  it("the per-row cell still formats with the row's OWN currency (untouched)", () => {
    expect(src).toContain("fmtMoney(Math.round(annualMrr(s)), s.currency)");
  });
});

describe("W184 · A — the soft-circle currency picker STILL EXISTS and now states the delivery rule", () => {
  const src = fs.readFileSync(COMPANY_DETAIL, "utf8");

  it("the control, its trigger and all seven options are still there", () => {
    expect(src).toContain('data-testid="select-sc-currency"');
    expect(src).toContain("SUPPORTED_CURRENCIES.map");
    expect(src).toContain("option-currency-");
    /* The seven codes come from shared/schema.ts, not from this file — asserting
     * the mapping over SUPPORTED_CURRENCIES is what proves no option was pruned. */
  });

  it("the Amount, Currency and Type labels are all byte-verbatim", () => {
    for (const label of ["<Label>Amount</Label>", "<Label>Currency</Label>", "<Label>Type</Label>"]) {
      expect(src).toContain(label);
    }
  });

  it("a static statement of the delivery rule sits beside the picker", () => {
    expect(src).toContain('data-testid="text-sc-currency-delivery-rule"');
    expect(src).toContain("Capavate applies no exchange rate and converts nothing");
    expect(src).toContain("funds must be delivered");
  });

  it("the currency in that statement is DERIVED from the round, never hardcoded", () => {
    const idx = src.indexOf('data-testid="text-sc-currency-delivery-rule"');
    const window = src.slice(idx, idx + 1200);
    expect(window).toContain("roundCurrency");
    /* Not one of the seven ISO codes is named in the sentence itself. */
    for (const code of ["USD", "CAD", "GBP", "EUR", "SGD", "HKD", "CNY"]) {
      expect(window).not.toContain(`"${code}"`);
      expect(window).not.toContain(`in ${code}.`);
    }
  });

  it("a round with NO denomination on record is told so, rather than being shown a currency", () => {
    const idx = src.indexOf('data-testid="text-sc-currency-delivery-rule"');
    const window = src.slice(idx, idx + 1200);
    expect(window).toContain("no denomination on record");
  });

  it("the picker OPENS on the round's own denomination", () => {
    expect(src).toContain("const roundCurrency = (inv.currency ?? null)");
    expect(src).toContain("roundCurrency && (SUPPORTED_CURRENCIES as readonly string[]).includes(roundCurrency)");
  });
});
