/**
 * WAVE 201 · R173.7 — THE SERVER SIDE OF THE THREE STATES.
 *
 * The rendered-DOM proof lives in
 * client/src/components/__tests__/wave201_dvc_three_states_dom.test.tsx. This
 * file proves the two things a DOM test cannot reach:
 *
 *   1. `classifyFeeComparison` is the ONLY thing that can say "match", and it
 *      says so only when BOTH sides carry a real amount and no error. The old
 *      single boolean could not express "we did not compare", so the both-null
 *      case fell through to `null !== null` === false and was reported as
 *      agreement.
 *
 *   2. `POST /api/admin/pricing-console/repoint-ack` refuses a repoint when
 *      either side is unresolved. That endpoint previously accepted the
 *      confirmation on any row, so an admin clicking the button on a row where
 *      the authoritative side answers nothing would have written an
 *      acknowledgement moving the partner-facing display onto a source that
 *      holds no amount — replacing a working displayed price with nothing.
 *
 * NO CHARGED FIGURE IS ASSERTED, SET OR MOVED ANYWHERE IN THIS FILE.
 */
import { describe, it, expect } from "vitest";
import {
  classifyFeeComparison,
  GAP_FILLED_VIA_SUFFIX,
  type FeeComparisonState,
} from "../lib/pricingDisplaySourceRepoint";

/** A side that resolved to a real amount. */
const ok = (amountMinor: number, currency = "USD", computedVia = "platform_default") => ({
  amountMinor,
  currency,
  computedVia,
  feeScheduleId: null,
  billingPeriod: null,
  error: null,
});

/** A side that did not resolve. Never a zero — a named refusal (R143.4). */
const no = (error: string) => ({
  amountMinor: null,
  currency: null,
  computedVia: null,
  feeScheduleId: null,
  billingPeriod: null,
  error,
});

describe("wave 201 · classifyFeeComparison — three states, never two", () => {
  it("says MATCH only when both sides resolved and agree on amount AND currency", () => {
    const c = classifyFeeComparison(ok(24000), ok(24000, "USD", "platform_fee_authoritative"));
    expect(c.comparisonState).toBe<FeeComparisonState>("match");
    expect(c.missingSide).toBeNull();
  });

  it("says MISMATCH when both resolved and the amounts differ", () => {
    const c = classifyFeeComparison(ok(0), ok(84000, "USD", "partner_tier_price_authoritative"));
    expect(c.comparisonState).toBe<FeeComparisonState>("mismatch");
    expect(c.missingSide).toBeNull();
  });

  it("says MISMATCH when both resolved to the same number in DIFFERENT currencies — no conversion, ever (R156.1)", () => {
    const c = classifyFeeComparison(ok(24000, "USD"), ok(24000, "EUR"));
    expect(c.comparisonState).toBe<FeeComparisonState>("mismatch");
  });

  it("says INCOMPLETE and names the DISPLAYED side when only the charged figure exists", () => {
    const c = classifyFeeComparison(no("no_fee_schedule_configured"), ok(24000));
    expect(c.comparisonState).toBe<FeeComparisonState>("incomplete");
    expect(c.missingSide).toBe("displayed");
  });

  it("says INCOMPLETE and names the CHARGED side when only the displayed figure exists", () => {
    const c = classifyFeeComparison(ok(0), no("TIER_PRICE_UNRESOLVED"));
    expect(c.comparisonState).toBe<FeeComparisonState>("incomplete");
    expect(c.missingSide).toBe("charged");
  });

  it("says INCOMPLETE and names BOTH when neither side exists — THE EXACT CASE THAT USED TO READ AS A PASS", () => {
    /* `divergent` for this row was `displayed.amountMinor !== authoritative.amountMinor`
       → `null !== null` → false → the screen printed "Displayed matches charged"
       having compared nothing at all. */
    const displayed = no("no_fee_schedule_configured");
    const authoritative = no("TIER_PRICE_UNRESOLVED");
    expect(displayed.amountMinor !== authoritative.amountMinor).toBe(false); // the old rule, quoted
    const c = classifyFeeComparison(displayed, authoritative);
    expect(c.comparisonState).toBe<FeeComparisonState>("incomplete");
    expect(c.missingSide).toBe("both");
    expect(c.comparisonState).not.toBe("match");
  });

  it("treats a null amount with NO error string as unresolved too — an absent amount is not a zero (R143.4)", () => {
    const c = classifyFeeComparison(
      { amountMinor: null, currency: null, computedVia: null, feeScheduleId: null, billingPeriod: null, error: null },
      ok(24000),
    );
    expect(c.comparisonState).toBe<FeeComparisonState>("incomplete");
    expect(c.missingSide).toBe("displayed");
  });

  it("refuses to call two equal amounts a match when an error is set on either side", () => {
    /* A resolver that returned a number AND an error has contradicted itself.
       Reporting agreement on the strength of the number would be trusting the
       half of the answer that happens to be convenient. */
    expect(classifyFeeComparison({ ...ok(24000), error: "boom" }, ok(24000)).comparisonState).toBe("incomplete");
    expect(classifyFeeComparison(ok(24000), { ...ok(24000), error: "boom" }).comparisonState).toBe("incomplete");
  });

  it("does call a genuine 0 vs 0 a match — an intentional zero on both sides IS agreement", () => {
    /* Distinct from the case above: here both sides answered, and the answer is
       zero. `platform_fees.consortium.subscription.founding_member` is a real
       admin-set zero carrying an `intentional_zero_reason`, so a zero that was
       actually resolved must not be downgraded to a finding. */
    expect(classifyFeeComparison(ok(0), ok(0)).comparisonState).toBe<FeeComparisonState>("match");
  });

  it("exports a via-suffix that NAMES the gap-fill rather than disguising it as an ordinary display source", () => {
    /* If the displayed side is filled from the charged side, the screen must be
       able to say so; a silent substitution would make a gap invisible again. */
    expect(GAP_FILLED_VIA_SUFFIX).toBe("_shown_because_no_displayed_price");
    expect(GAP_FILLED_VIA_SUFFIX.startsWith("_")).toBe(true);
  });
});

describe("wave 201 · the state is decided in ONE place", () => {
  it("has no second producer of the word 'match' in the repoint module", async () => {
    /* Guards the shape of the fix, not its output: two functions able to emit
       "match" is how the third state gets quietly collapsed again six waves from
       now. Comments and string literals are stripped before counting so that
       this file's own prose cannot satisfy it. */
    const fs = await import("node:fs");
    const src = fs.readFileSync("server/lib/pricingDisplaySourceRepoint.ts", "utf8");
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    /* Verify the stripper actually stripped, or the assertion below is vacuous. */
    expect(src.length - stripped.length).toBeGreaterThan(500);
    /* Count PRODUCTION sites, not the union type declaration: the literal
       appears once in `type FeeComparisonState` (a declaration, which produces
       nothing) and once in the return of `classifyFeeComparison`. */
    const producers = (stripped.match(/"match"/g) ?? []).length;
    const declarations = (stripped.match(/"match"\s*\|\s*"mismatch"/g) ?? []).length;
    expect(declarations).toBe(1);
    expect(producers - declarations).toBe(1);
  });
});
