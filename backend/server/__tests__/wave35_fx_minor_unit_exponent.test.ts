/**
 * WAVE 35 · F5 — `Math.round(minorUnits × fxRate)`: an entirely unexamined
 * defect class, proven by execution against the LIVE WRITE PATHS.
 *
 * THE ARITHMETIC
 * --------------
 * An FX rate quotes MAJOR units per MAJOR unit (1 JPY = 0.0067 USD). Minor
 * units are major × 10^exponent. So converting minor units between two
 * currencies requires re-scaling by BOTH exponents:
 *
 *     minorB = minorA / 10^expA * rate * 10^expB
 *            = minorA * rate * 10^(expB - expA)
 *
 * Four shipped sites wrote `Math.round(minorA * rate)` — the 10^(expB-expA)
 * factor was simply absent.
 *
 *   ¥1,000,000  =  1,000,000 minor (JPY, exponent 0)   @ 0.0067
 *     WRONG:  round(1_000_000 * 0.0067)          =   6,700 minor  = $67.00
 *     RIGHT:  round(1_000_000 * 0.0067 * 10^2)   = 670,000 minor  = $6,700.00
 *   Off by exactly 100×.
 *
 * WHY IT HID FOR SO LONG
 * ----------------------
 * The EUR→USD pole (exponent 2 → exponent 2) has a scale factor of 10^0 = 1.
 * Every same-exponent test passes against the DEFECT and against the FIX
 * identically. This file therefore asserts BOTH: the JPY pole (which pins the
 * fix) AND the EUR pole (which pins that a real conversion still happens and
 * that existing same-exponent behaviour was not disturbed).
 *
 * THE SECOND HALF OF THE DEFECT
 * -----------------------------
 * All four sites fell back to the RAW amount when no rate was supplied,
 * silently adding ¥ into a $ total. That is not a rounding error — it is a
 * meaningless number. The fix REFUSES.
 *
 * WHAT IS ASSERTED: the PERSISTED denormalised totals
 * (`totalCommittedMinor`, `committedSizeMinor`) that the two live write paths
 * actually store — not the return value of a helper. Preconditions are created
 * here; `process.env` is never read; imports are static.
 */
import { describe, it, expect } from "vitest";

import { convertMinorUnits, currencyExponent } from "../lib/money";
import { partnerSpvStore, partnerFundsStore } from "../partnerWorkspaceStore";

const ACTOR = "u_w35_fx_actor";
/** 1 JPY = 0.0067 USD. */
const JPY_USD = "0.0067";
/** 1 EUR = 1.09 USD — the same-exponent pole that hid the defect. */
const EUR_USD = "1.09";

/** This file owns its own partner namespace; nothing else writes under it. */
const partnerId = "ptnr_w35_fx";

/* ── (U) THE HELPER, IN ISOLATION ────────────────────────────────────────── */

describe("W35-F5-U — convertMinorUnits re-scales by BOTH exponents", () => {
  it("U0 preconditions: the exponents this file depends on", () => {
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("USD")).toBe(2);
    expect(currencyExponent("EUR")).toBe(2);
    expect(currencyExponent("KWD")).toBe(3);
  });

  it("U1 JPY→USD POLE: ¥1,000,000 @0.0067 is $6,700.00, not $67.00", () => {
    const r = convertMinorUnits(1_000_000, "JPY", "USD", JPY_USD);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.minor).toBe(670_000);
    expect(r.exponentScale).toBe(100);
    // THE DEFECT'S ANSWER.
    expect(r.minor).not.toBe(6_700);
  });

  it("U2 EUR→USD POLE: same exponent, scale 1 — the pole that hid the defect", () => {
    const r = convertMinorUnits(1_000_000, "EUR", "USD", EUR_USD);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.exponentScale).toBe(1);
    expect(r.minor).toBe(1_090_000);
    // Identical under the defect AND the fix — that is precisely the point.
  });

  it("U3 the OTHER direction: USD→JPY divides by 100", () => {
    const r = convertMinorUnits(670_000, "USD", "JPY", 1 / 0.0067);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.exponentScale).toBe(0.01);
    expect(r.minor).toBe(1_000_000);
  });

  it("U4 a 3-decimal currency proves it is table-driven, not a JPY special case", () => {
    // KWD exponent 3, USD exponent 2 → scale 10^-1.
    const r = convertMinorUnits(1_000, "KWD", "USD", 3.26);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.exponentScale).toBeCloseTo(0.1, 12);
    // 1.000 KWD * 3.26 = $3.26 = 326 minor.
    expect(r.minor).toBe(326);
  });

  it("U5 REFUSAL: different currencies with no rate is refused, never raw-summed", () => {
    const r = convertMinorUnits(1_000_000, "JPY", "USD", null);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("missing_rate");
    expect(r.message).toMatch(/meaningless/);
  });

  it("U6 SAME currency needs no rate and is an exact identity", () => {
    const r = convertMinorUnits(1_000_000, "USD", "USD", null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.identity).toBe(true);
    expect(r.minor).toBe(1_000_000);
  });
});

/* ── (S) LIVE WRITE PATH 1 — partnerSpvStore.addPosition ─────────────────── */

describe("W35-F5-S — SPV addPosition persists a correctly-scaled totalCommittedMinor", () => {
  it("S1 JPY POLE: a ¥1,000,000 position into a USD SPV stores 670,000, not 6,700", () => {
    const spv = partnerSpvStore.create(
      partnerId,
      { spvName: "W35 USD SPV (jpy pole)", jurisdiction: "DE", vintage: 2026, currency: "USD", status: "open" },
      ACTOR,
    );
    expect(spv.totalCommittedMinor).toBe(0);

    partnerSpvStore.addPosition(
      partnerId,
      spv.id,
      { lpContactId: "lp_w35_a", positionAmountMinor: 1_000_000, currency: "JPY", fxRateToSpvBase: JPY_USD },
      ACTOR,
    );

    const after = partnerSpvStore._listAll().find((s) => s.id === spv.id)!;
    expect(after.totalCommittedMinor).toBe(670_000); // $6,700.00
    // THE DEFECT'S PERSISTED VALUE — this is what was in the database.
    expect(after.totalCommittedMinor).not.toBe(6_700);
  });

  it("S2 EUR POLE: the same-exponent path is UNCHANGED — no functionality dropped", () => {
    const spv = partnerSpvStore.create(
      partnerId,
      { spvName: "W35 USD SPV (eur pole)", jurisdiction: "DE", vintage: 2026, currency: "USD", status: "open" },
      ACTOR,
    );
    partnerSpvStore.addPosition(
      partnerId,
      spv.id,
      { lpContactId: "lp_w35_b", positionAmountMinor: 1_000_000, currency: "EUR", fxRateToSpvBase: EUR_USD },
      ACTOR,
    );
    const after = partnerSpvStore._listAll().find((s) => s.id === spv.id)!;
    expect(after.totalCommittedMinor).toBe(1_090_000);
  });

  it("S3 SAME-CURRENCY POLE: a USD position into a USD SPV still needs no rate", () => {
    const spv = partnerSpvStore.create(
      partnerId,
      { spvName: "W35 USD SPV (same)", jurisdiction: "DE", vintage: 2026, currency: "USD", status: "open" },
      ACTOR,
    );
    partnerSpvStore.addPosition(
      partnerId,
      spv.id,
      { lpContactId: "lp_w35_c", positionAmountMinor: 2_500_000, currency: "USD" },
      ACTOR,
    );
    const after = partnerSpvStore._listAll().find((s) => s.id === spv.id)!;
    expect(after.totalCommittedMinor).toBe(2_500_000);
  });

  it("S4 REFUSAL POLE: a cross-currency position with NO rate throws and writes nothing", () => {
    const spv = partnerSpvStore.create(
      partnerId,
      { spvName: "W35 USD SPV (refuse)", jurisdiction: "DE", vintage: 2026, currency: "USD", status: "open" },
      ACTOR,
    );
    expect(() =>
      partnerSpvStore.addPosition(
        partnerId,
        spv.id,
        { lpContactId: "lp_w35_d", positionAmountMinor: 1_000_000, currency: "JPY" },
        ACTOR,
      ),
    ).toThrow(/fxRateToSpvBase|meaningless/);

    const after = partnerSpvStore._listAll().find((s) => s.id === spv.id)!;
    // The old code raw-summed ¥1,000,000 into a $ total. It must be untouched.
    expect(after.totalCommittedMinor).toBe(0);
    expect(after.totalCommittedMinor).not.toBe(1_000_000);
  });

  it("S5 accumulation across TWO currencies is correct, not off by 100× on one leg", () => {
    const spv = partnerSpvStore.create(
      partnerId,
      { spvName: "W35 USD SPV (mixed)", jurisdiction: "DE", vintage: 2026, currency: "USD", status: "open" },
      ACTOR,
    );
    partnerSpvStore.addPosition(
      partnerId, spv.id,
      { lpContactId: "lp_w35_e", positionAmountMinor: 1_000_000, currency: "JPY", fxRateToSpvBase: JPY_USD },
      ACTOR,
    );
    partnerSpvStore.addPosition(
      partnerId, spv.id,
      { lpContactId: "lp_w35_f", positionAmountMinor: 1_000_000, currency: "EUR", fxRateToSpvBase: EUR_USD },
      ACTOR,
    );
    const after = partnerSpvStore._listAll().find((s) => s.id === spv.id)!;
    expect(after.totalCommittedMinor).toBe(670_000 + 1_090_000);
  });
});

/* ── (F) LIVE WRITE PATH 2 — partnerFundsStore.pledge ────────────────────── */

describe("W35-F5-F — fund pledge persists a correctly-scaled committedSizeMinor", () => {
  const newFund = (name: string) =>
    partnerFundsStore.create(
      partnerId,
      { fundName: name, fundType: "venture", jurisdiction: "DE", vintage: 2026, currency: "USD", status: "open" } as never,
      ACTOR,
    );

  it("F1 JPY POLE: a ¥1,000,000 commitment stores 670,000, not 6,700", () => {
    const f = newFund("W35 USD Fund (jpy)");
    partnerFundsStore.pledge(
      partnerId, f.id,
      { lpContactId: "lp_w35_g", commitmentMinor: 1_000_000, currency: "JPY", fxRateToFundBase: JPY_USD },
      ACTOR,
    );
    const after = partnerFundsStore._listAll().find((x) => x.id === f.id)!;
    expect(after.committedSizeMinor).toBe(670_000);
    expect(after.committedSizeMinor).not.toBe(6_700);
  });

  it("F2 EUR POLE: same-exponent behaviour unchanged", () => {
    const f = newFund("W35 USD Fund (eur)");
    partnerFundsStore.pledge(
      partnerId, f.id,
      { lpContactId: "lp_w35_h", commitmentMinor: 1_000_000, currency: "EUR", fxRateToFundBase: EUR_USD },
      ACTOR,
    );
    const after = partnerFundsStore._listAll().find((x) => x.id === f.id)!;
    expect(after.committedSizeMinor).toBe(1_090_000);
  });

  it("F3 REFUSAL POLE: no rate across currencies throws and leaves the total at 0", () => {
    const f = newFund("W35 USD Fund (refuse)");
    expect(() =>
      partnerFundsStore.pledge(
        partnerId, f.id,
        { lpContactId: "lp_w35_i", commitmentMinor: 1_000_000, currency: "JPY" },
        ACTOR,
      ),
    ).toThrow(/fxRateToFundBase|meaningless/);
    const after = partnerFundsStore._listAll().find((x) => x.id === f.id)!;
    expect(after.committedSizeMinor).toBe(0);
  });

  it("F4 SAME-CURRENCY POLE: a USD commitment into a USD fund still works with no rate", () => {
    const f = newFund("W35 USD Fund (same)");
    partnerFundsStore.pledge(
      partnerId, f.id,
      { lpContactId: "lp_w35_j", commitmentMinor: 5_000_000, currency: "USD" },
      ACTOR,
    );
    const after = partnerFundsStore._listAll().find((x) => x.id === f.id)!;
    expect(after.committedSizeMinor).toBe(5_000_000);
  });
});
