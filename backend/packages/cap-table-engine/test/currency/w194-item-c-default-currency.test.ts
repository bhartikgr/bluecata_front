/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 194 · ITEM C · SITE 1 · R156.2 — A DEFAULTED CURRENCY, ON A REACHABLE PATH.
 * ══════════════════════════════════════════════════════════════════════════════
 * `captable/compute.ts` issued the new investors' preferred security with
 *
 *     currency: round.currency ?? "USD"
 *
 * and that right-hand side was REACHED, not dormant. `projectPostClose`
 * (`server/roundMathRoutes.ts:2545-2574`) synthesises its `issue_preferred_round`
 * transaction with NO `currency` key at all, so every projection the platform
 * runs for a round with no recorded currency — all 1045 of them — labelled the new
 * investors' money as United States dollars on the strength of a compiled-in
 * constant. R156.2: never substitute a constant for a missing fact; name the fact
 * or leave it absent.
 *
 * THE FIX IS AN OMISSION, WHICH IS WHY IT NEEDS A TEST OF ITS OWN. The key is now
 * spread conditionally, so an absent currency stays absent instead of becoming a
 * claim. The `round-math` route does not project `currency` onto a holder row
 * (asserted in `server/__tests__/wave194_production_path_currency.test.ts` A-2-5),
 * so this change is INVISIBLE in that route's response bytes — which is exactly
 * why proving it there would prove nothing and it is proved here, at the layer
 * where the value lives.
 *
 * NO CURRENCY IS CONVERTED AND NONE IS INFERRED (R156.1).
 */
import { describe, it, expect } from "vitest";
import { computeCapTable } from "../../src/captable/compute.js";
import type { Transaction, Holder } from "../../src/types.js";

const HOLDERS = [
  { id: "h_f", name: "Founders" },
  { id: "investors-rA", name: "Series A investors" },
] as unknown as Holder[];

/**
 * The minimum that reaches the new-investor issuance: a founder block and a
 * priced round. No SAFE, deliberately — this site is on the ROUND's own currency
 * and must be provable without the conversion machinery in the way.
 *
 * @param currency `undefined` means the round transaction carries NO `currency`
 *   key, which is precisely what `projectPostClose` synthesises today.
 */
function fixture(currency: string | undefined): Transaction[] {
  return [
    {
      type: "issue",
      date: "2026-01-01",
      security: { id: "f1", holderId: "h_f", kind: "common", series: "Common", shares: BigInt(8_000_000) },
    },
    {
      type: "issue_preferred_round",
      date: "2026-02-01",
      round: {
        id: "rA",
        series: "Series A",
        preMoneyValuation: "30000000",
        investmentAmount: "10000000",
        pricePerShare: "3",
        ...(currency === undefined ? {} : { currency }),
      },
    },
  ] as unknown as Transaction[];
}

const run = (currency: string | undefined) =>
  computeCapTable({
    asOf: "2026-02-01",
    view: "fd",
    formulaRegion: "US",
    holders: HOLDERS,
    transactions: fixture(currency),
  } as never);

/** The new investors' row, found by the id `compute.ts` gives it. */
function newInvestorRow(result: unknown): Record<string, unknown> {
  const rows = (result as { rows: Array<Record<string, unknown>> }).rows;
  const row = rows.find((r) => String(r.securityId ?? r.id ?? "").includes("newpref"))
    ?? rows.find((r) => String(r.holderId ?? "").startsWith("investors-"));
  if (!row) {
    throw new Error(
      `no new-investor row in ${JSON.stringify(rows.map((r) => ({ id: r.id, holderId: r.holderId })))}`,
    );
  }
  return row;
}

describe("WAVE 194 · ITEM C SITE 1 — an absent round currency is no longer answered with a constant", () => {
  it("C1-1 a round that records NO currency produces a row that CLAIMS no currency", () => {
    const row = newInvestorRow(run(undefined));
    /* Before this wave this read "USD". The distinction is not cosmetic: a stated
       code is what `isMixedCurrency` counts, so a fabricated "USD" is a value the
       platform can later contradict a real record with. */
    const stated = row.currency;
    expect(stated === undefined || stated === null).toBe(true);
  });

  it("C1-2 the RECORDED currency is still carried through, verbatim and un-normalised", () => {
    expect(newInvestorRow(run("USD")).currency).toBe("USD");
    /* Not upper-cased, not validated against a compiled-in list of codes, not
       mapped: this is a READ. A round recorded in Singapore dollars says so. */
    expect(newInvestorRow(run("SGD")).currency).toBe("SGD");
    expect(newInvestorRow(run("gbp")).currency).toBe("gbp");
  });

  it("C1-3 removing the default moved NO number — the shares and price are unchanged", () => {
    const withCur = run("USD") as { rows: Array<Record<string, unknown>> };
    const without = run(undefined) as { rows: Array<Record<string, unknown>> };
    const numbersOf = (r: { rows: Array<Record<string, unknown>> }) =>
      JSON.stringify(
        r.rows.map((x) => ({
          holderId: x.holderId,
          kind: x.kind,
          shares: String(x.shares ?? ""),
          ownershipPercent: String(x.ownershipPercent ?? ""),
        })),
      );
    /* The whole safety argument for Item C site 1 in one assertion: the constant
       was a LABEL, and labels do not participate in the arithmetic. If this fails,
       the default was load-bearing and the fix is not safe. */
    expect(numbersOf(without)).toBe(numbersOf(withCur));
  });

  it("C1-4 no row anywhere in the result invents a currency for the absent case", () => {
    const rows = (run(undefined) as { rows: Array<Record<string, unknown>> }).rows;
    const invented = rows.filter((r) => r.currency !== undefined && r.currency !== null);
    expect(
      invented.map((r) => `${String(r.holderId)}=${String(r.currency)}`),
      "a row states a currency that no record states",
    ).toEqual([]);
  });
});
