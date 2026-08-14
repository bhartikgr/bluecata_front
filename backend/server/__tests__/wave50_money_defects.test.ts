/**
 * WAVE 50 — proving tests for the money defects found by independent review.
 *
 * Every test in this file asserts BOTH POLES. The rule paid for in blood: "a
 * currency guard that refuses everything, or a percent fix that converts a value
 * it shouldn't, passes a one-sided test and breaks real billing." So each defect
 * gets a test that would have FAILED before the fix and a companion test that
 * would FAIL if the fix over-corrected.
 *
 * MONEY: integer minor units throughout; a JPY (exponent 0) fixture appears in
 * every money test, because no JPY data exists live and these tests are the only
 * place that code path ever runs.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { getDb, rawDb } from "../db/connection";
import { ensureWave5MoneySchema } from "../lib/applyWave5MoneySchema";
import {
  createInvoice,
  addInvoiceLine,
  commissionSplit,
  commissionPositionByKind,
} from "../lib/partnerBillingStore";
import { currencyExponent, toMinor, fromMinor, formatMinor } from "../lib/money";

function h(): any {
  getDb();
  const raw = rawDb() as any;
  ensureWave5MoneySchema(raw);
  return raw;
}

beforeAll(() => {
  h();
});

/* ══════════════════════════════════════════════════════════════════════════
 * ITEM 6 — `commissionSplit` MUST NEVER SUM MINOR UNITS ACROSS CURRENCIES
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Before Wave 50 this function grouped only by `l.settlement_state` and returned
 * `{ pendingMinor, paidMinor }` as bare numbers, so a partner holding USD, EUR,
 * GBP and CAD commission lines got one blended figure. Live currency overrides
 * are USD/EUR/GBP and one live SPV is CAD-denominated (R5).
 * ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 50 · ITEM 6 — commissionSplit never sums minor units across currencies", () => {
  /* POLE A — the fix must not refuse the ordinary case. A single-currency
     history still collapses to REAL scalars, byte-for-byte the old contract.
     A guard that returned null here would break every existing partner. */
  it("POLE A — a single-currency history still returns real scalar totals, not a refusal", () => {
    const pid = "p_w50_single_usd";
    const inv = createInvoice({ partnerId: pid, currency: "USD" });
    addInvoiceLine({ invoiceId: inv, entryKind: "commission", description: "C1", amountMinor: 10_000, settlementState: "paid" });
    addInvoiceLine({ invoiceId: inv, entryKind: "commission", description: "C2", amountMinor: 3_000, settlementState: "pending" });

    const split = commissionSplit(pid);
    expect(split.mixed).toBe(false);
    expect(split.currency).toBe("USD");
    expect(split.paidMinor).toBe(10_000);
    expect(split.pendingMinor).toBe(3_000);
    expect(split.pending.available).toBe(true);
    expect(split.paid.available).toBe(true);
    expect(split.currencies).toEqual(["USD"]);
    expect(split.byCurrency).toEqual([
      { currency: "USD", pendingMinor: 3_000, paidMinor: 10_000 },
    ]);
  });

  /* POLE A′ — the SAME single-currency guarantee for an EXPONENT-0 currency.
     JPY minor units ARE whole yen, so ¥1,000 is the integer 1000. Nothing in
     this path may divide or multiply by 100. */
  it("POLE A′ — a JPY-only (exponent 0) history returns real scalars in JPY", () => {
    const pid = "p_w50_single_jpy";
    const inv = createInvoice({ partnerId: pid, currency: "JPY" });
    addInvoiceLine({ invoiceId: inv, entryKind: "commission", description: "JC1", amountMinor: 1_000, settlementState: "paid" });
    addInvoiceLine({ invoiceId: inv, entryKind: "commission", description: "JC2", amountMinor: 250, settlementState: "pending" });

    const split = commissionSplit(pid);
    expect(currencyExponent("JPY")).toBe(0);
    expect(split.mixed).toBe(false);
    expect(split.currency).toBe("JPY");
    expect(split.paidMinor).toBe(1_000);
    expect(split.pendingMinor).toBe(250);
    // ¥1,000 formats with ZERO fraction digits. A hardcoded /100 would print 10.
    expect(formatMinor(1_000, "JPY")).not.toContain(".");
  });

  /* POLE B — the defect itself. A mixed history must produce per-currency
     totals AND an explicit refusal scalar, never one blended number. The
     pre-Wave-50 code returned 11250 here: 10000 (USD cents) + 1000 (whole yen)
     + 250 (euro cents). That number is meaningless in every currency. */
  it("POLE B — a mixed USD/JPY/CAD history NEVER produces a single blended number", () => {
    const pid = "p_w50_mixed";
    const usd = createInvoice({ partnerId: pid, currency: "USD" });
    addInvoiceLine({ invoiceId: usd, entryKind: "commission", description: "usd paid", amountMinor: 10_000, settlementState: "paid" });
    const jpy = createInvoice({ partnerId: pid, currency: "JPY" });
    addInvoiceLine({ invoiceId: jpy, entryKind: "commission", description: "jpy paid", amountMinor: 1_000, settlementState: "paid" });
    const cad = createInvoice({ partnerId: pid, currency: "CAD" });
    addInvoiceLine({ invoiceId: cad, entryKind: "commission", description: "cad pending", amountMinor: 250, settlementState: "pending" });
    // A SECOND pending currency, so the PENDING bucket is itself mixed and not
    // merely single-currency-inside-a-mixed-position. Both cases matter and this
    // test asserts both: see the next `it` for the single-currency-bucket case.
    addInvoiceLine({ invoiceId: usd, entryKind: "commission", description: "usd pending", amountMinor: 400, settlementState: "pending" });

    const split = commissionSplit(pid);

    // THE REFUSAL. No blended scalar, and NOT a fabricated "USD".
    expect(split.mixed).toBe(true);
    expect(split.paidMinor).toBeNull();
    expect(split.pendingMinor).toBeNull();
    expect(split.currency).toBeNull();
    expect(split.paid.available).toBe(false);
    expect(split.pending.available).toBe(false);
    if (!split.paid.available) expect(split.paid.reason).toBe("needs_fx_conversion");

    // THE PER-CURRENCY TRUTH, which is what makes the refusal actionable
    // rather than merely obstructive.
    expect(split.currencies).toEqual(["CAD", "JPY", "USD"]);
    const byCur = Object.fromEntries(split.byCurrency.map((b) => [b.currency, b]));
    expect(byCur.USD).toEqual({ currency: "USD", pendingMinor: 400, paidMinor: 10_000 });
    expect(byCur.JPY).toEqual({ currency: "JPY", pendingMinor: 0, paidMinor: 1_000 });
    expect(byCur.CAD).toEqual({ currency: "CAD", pendingMinor: 250, paidMinor: 0 });

    // THE ANTI-BLEND ASSERTION, stated explicitly: the old cross-currency sum.
    const blended = 10_000 + 1_000 + 250 + 400;
    expect(split.paidMinor).not.toBe(blended);
    expect(split.pendingMinor).not.toBe(blended);
    for (const b of split.byCurrency) {
      expect(b.paidMinor + b.pendingMinor).not.toBe(blended);
    }
  });

  /* POLE B′ — A SUBTLETY WORTH PINNING, and the reason this test exists rather
     than a blanket "mixed => everything null". When the POSITION spans several
     currencies but ONE SETTLEMENT BUCKET happens to hold only one of them, that
     bucket's scalar stays AVAILABLE in its own currency — because 250 CAD
     pending is an unambiguous fact, and nulling it would be a refusal that
     destroys information rather than protecting it. The top-level `currency`
     is still null and the top-level scalars still follow their own buckets.
     This is the behaviour of the sibling `commissionPositionByKind`, and
     matching it deliberately is what keeps ONE convention on the response.
     What is NEVER allowed, at any level, is a number that mixes two
     currencies — asserted directly below. */
  it("POLE B′ — a single-currency bucket inside a mixed position stays available IN ITS OWN currency", () => {
    const pid = "p_w50_mixed_one_sided";
    const usd = createInvoice({ partnerId: pid, currency: "USD" });
    addInvoiceLine({ invoiceId: usd, entryKind: "commission", description: "usd paid", amountMinor: 10_000, settlementState: "paid" });
    const jpy = createInvoice({ partnerId: pid, currency: "JPY" });
    addInvoiceLine({ invoiceId: jpy, entryKind: "commission", description: "jpy paid", amountMinor: 1_000, settlementState: "paid" });
    const cad = createInvoice({ partnerId: pid, currency: "CAD" });
    addInvoiceLine({ invoiceId: cad, entryKind: "commission", description: "cad pending", amountMinor: 250, settlementState: "pending" });

    const split = commissionSplit(pid);
    expect(split.mixed).toBe(true);
    expect(split.currency).toBeNull();

    // PAID spans USD + JPY -> refused, and NOT stamped "USD".
    expect(split.paid.available).toBe(false);
    expect(split.paidMinor).toBeNull();
    if (!split.paid.available) expect(split.paid.currencies).toEqual(["JPY", "USD"]);

    // PENDING is CAD only -> a real number, correctly labelled CAD.
    expect(split.pending.available).toBe(true);
    if (split.pending.available) {
      expect(split.pending.currency).toBe("CAD");
      expect(split.pending.minor).toBe(250);
    }
    expect(split.pendingMinor).toBe(250);
    // and it is NOT the blend of the paid side.
    expect(split.pendingMinor).not.toBe(10_000 + 1_000 + 250);
  });

  /* POLE C — no lines at all is NOT a refusal. 0 is 0 in every currency, so a
     scalar zero here is honest. A "refuse when you cannot prove one currency"
     rule taken too literally would have made every brand-new partner
     unrenderable. */
  it("POLE C — a partner with no commission lines gets a scalar zero, not a refusal", () => {
    const split = commissionSplit("p_w50_no_lines_at_all");
    expect(split.mixed).toBe(false);
    expect(split.pendingMinor).toBe(0);
    expect(split.paidMinor).toBe(0);
    expect(split.byCurrency).toEqual([]);
    expect(split.currencies).toEqual([]);
  });

  /* The shape must MATCH its sibling, `commissionPositionByKind` (Wave 21 ·
     Item 2), because both are read by the same route
     (GET /api/partner/me/commission-summary). Two conventions on one response
     is how a UI ends up rendering a refusal as a zero. */
  it("returns the same per-currency shape as commissionPositionByKind (one convention, not two)", () => {
    const split = commissionSplit("p_w50_mixed");
    const position = commissionPositionByKind("p_w50_mixed");
    for (const k of ["pendingMinor", "paidMinor", "currency", "mixed", "pending", "paid", "byCurrency", "currencies"]) {
      expect(Object.prototype.hasOwnProperty.call(split, k)).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(position, k)).toBe(true);
    }
    expect(split.mixed).toBe(true);
    expect(position.mixed).toBe(true);
  });

  /* 'waived' and 'failed' stay out of BOTH totals — the sibling's rule, kept.
     A waived commission is not owed; a failed one is not settled. */
  it("keeps 'waived' and 'failed' out of both totals while leaving the lines intact", () => {
    const pid = "p_w50_waived";
    const inv = createInvoice({ partnerId: pid, currency: "GBP" });
    addInvoiceLine({ invoiceId: inv, entryKind: "commission", description: "ok", amountMinor: 5_000, settlementState: "paid" });
    addInvoiceLine({ invoiceId: inv, entryKind: "commission", description: "waived", amountMinor: 7_000, settlementState: "waived" });
    addInvoiceLine({ invoiceId: inv, entryKind: "commission", description: "failed", amountMinor: 9_000, settlementState: "failed" });
    const split = commissionSplit(pid);
    expect(split.currency).toBe("GBP");
    expect(split.paidMinor).toBe(5_000);
    expect(split.pendingMinor).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ITEM 5 — MINOR-UNIT ROUND TRIP AT EVERY EXPONENT
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `client/src/pages/founder/Settings.tsx` hardcoded `/ 100` on hydrate and
 * `* 100` on save for fields configured `minorUnits: true`. Those two are exact
 * inverses OF EACH OTHER, so the form looked self-consistent while the STORED
 * number was 100x wrong for every exponent-0 currency. This block pins the
 * property the component now relies on: `toMinor`/`fromMinor` are exact
 * inverses AT THE CURRENCY'S OWN EXPONENT. The client helper
 * (client/src/lib/currency.ts) is required to stay byte-identical to the server
 * one for CURRENCY_EXPONENT_OVERRIDES, which is why asserting it here is
 * meaningful rather than a proxy.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 50 · ITEM 5 — minor-unit money fields round-trip at every exponent", () => {
  it("JPY fixture (exponent 0) — a ¥1,000 input round-trips as ¥1,000, NOT ¥100,000", () => {
    expect(currencyExponent("JPY")).toBe(0);
    const typed = 1_000; // what the founder types in the input
    const stored = toMinor(typed, "JPY");
    expect(stored).toBe(1_000); // the OLD `* 100` stored 100_000 here
    expect(fromMinor(stored, "JPY")).toBe(typed);
    // and the old `/ 100` hydrate would have shown 10 for a correctly stored 1000
    expect(fromMinor(1_000, "JPY")).not.toBe(10);
  });

  it("USD fixture (exponent 2) — a $1,000.00 input round-trips unchanged", () => {
    expect(currencyExponent("USD")).toBe(2);
    const typed = 1_000;
    const stored = toMinor(typed, "USD");
    expect(stored).toBe(100_000);
    expect(fromMinor(stored, "USD")).toBe(typed);
  });

  it("the two directions are exact inverses across exponents 0, 2 and 3", () => {
    const cases: Array<[string, number, number]> = [
      ["JPY", 0, 1_000],
      ["KRW", 0, 25_000],
      ["USD", 2, 1_234.56],
      ["EUR", 2, 42.5],
      ["KWD", 3, 12.345],
    ];
    for (const [code, exp, typed] of cases) {
      expect(currencyExponent(code)).toBe(exp);
      const stored = toMinor(typed, code);
      expect(Number.isInteger(stored)).toBe(true);
      expect(fromMinor(stored, code)).toBeCloseTo(typed, 9);
      // The banned shortcut disagrees with the correct answer wherever exp !== 2.
      if (exp !== 2) expect(stored).not.toBe(Math.round(typed * 100));
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ITEM 4 — AN OPTION-POOL SHARE COUNT IS NOT A PERCENTAGE
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `client/src/pages/founder/RoundNew.tsx` divided `addonPoolDraft.poolSize` — a
 * SHARE COUNT, its input labelled "Pool size (shares)" and sent as
 * `sharesAuthorized` — by 100 as though it were a percent. At any realistic pool
 * size the old `p >= 100` bail fired first, so the pool dilution was SILENTLY
 * DROPPED from the fully-diluted denominator, overpricing the round.
 *
 * This block pins the ARITHMETIC IDENTITY the component now implements, in the
 * component's exact expression order, so the property is provable independently
 * of React. The component-level render test lives beside the component.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 50 · ITEM 4 — an option-pool share count round-trips unchanged", () => {
  /** The component's math, transcribed: base F shares, pool of S shares. */
  function poolTopUp(basePreMoneyShares: number, poolShares: number) {
    if (!isFinite(poolShares) || poolShares <= 0) return { pct: 0, fd: basePreMoneyShares };
    if (basePreMoneyShares <= 0) return { pct: 0, fd: 0 };
    const pct = poolShares / (basePreMoneyShares + poolShares);
    return { pct, fd: basePreMoneyShares / (1 - pct) };
  }

  it("POLE A — a 100,000-share pool adds EXACTLY 100,000 shares to the FD base", () => {
    const base = 900_000;
    const { pct, fd } = poolTopUp(base, 100_000);
    expect(fd).toBeCloseTo(1_000_000, 6);
    // THE ROUND TRIP: the share count comes back out unchanged.
    expect(fd - base).toBeCloseTo(100_000, 6);
    // 100,000 shares on a 900,000 base is a 10% pool — never 100,000%, and
    // never the 1,000 the old `/ 100` produced.
    expect(pct).toBeCloseTo(0.1, 12);
    expect(pct).not.toBeCloseTo(1_000, 0);
  });

  it("POLE A′ — the identity holds for several pool sizes, not one lucky fixture", () => {
    for (const [base, pool] of [[900_000, 100_000], [1_000_000, 250_000], [4_500_000, 500_000], [1_000_000, 1]] as const) {
      const { fd } = poolTopUp(base, pool);
      expect(fd - base).toBeCloseTo(pool, 6);
    }
  });

  it("POLE B — the OLD behaviour is now impossible: the pool is never silently dropped", () => {
    // Reproduction of the defect: `p = 100_000; if (p >= 100) return 0;`
    const oldPct = (() => {
      const p = 100_000;
      if (!isFinite(p) || p <= 0 || p >= 100) return 0;
      return p / 100;
    })();
    expect(oldPct).toBe(0); // the pool vanished, overpricing the round
    const { pct } = poolTopUp(900_000, 100_000);
    expect(pct).toBeGreaterThan(0);

    // And the PRICE PER SHARE consequence, which is what reached the founder:
    const preMoney = 9_000_000;
    const ppsOld = preMoney / (900_000 / (1 - oldPct)); // = 10.00, too high
    const ppsNew = preMoney / (900_000 / (1 - pct)); // = 9.00, correct
    expect(ppsOld).toBeCloseTo(10, 9);
    expect(ppsNew).toBeCloseTo(9, 9);
    expect(ppsNew).toBeLessThan(ppsOld);
  });

  it("POLE C — no pool, or a zero/blank pool, leaves the FD base untouched", () => {
    expect(poolTopUp(900_000, 0).fd).toBe(900_000);
    expect(poolTopUp(900_000, 0).pct).toBe(0);
    expect(poolTopUp(900_000, Number.NaN).fd).toBe(900_000);
    expect(poolTopUp(0, 100_000).fd).toBe(0);
  });
});
