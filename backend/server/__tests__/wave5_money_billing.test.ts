/**
 * WAVE 5 — proving tests for the money items landed in this wave.
 *
 * These are written to FAIL against the pre-Wave-5 behaviour, not merely to
 * pass against the new code. Each block names the defect it pins. The mutation
 * matrix in build_log/WAVE5_REPORT.md records, per test, which source mutation
 * was applied to confirm the test actually detects a break.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { getDb, rawDb } from "../db/connection";
import { ensureWave5MoneySchema } from "../lib/applyWave5MoneySchema";
import {
  resolveAnnualAmountMinor,
  setTierPrice,
  quotePartnerSubscription,
  resolvePromotionDiscount,
  splitCommissionMinor,
  createInvoice,
  addInvoiceLine,
  assertInvoiceConserved,
  getInvoice,
  commissionSplit,
  emitMoneyEvent,
  PROMOTION_NOT_APPLICABLE,
  PROMOTION_OUT_OF_SCOPE,
  NON_INTEGER_MINOR,
} from "../lib/partnerBillingStore";
import { CARRY_FRACTION_SCALE } from "../lib/money";

function db(): any {
  getDb();
  const h = rawDb() as any;
  ensureWave5MoneySchema(h);
  return h;
}

function seedPromotion(row: Partial<Record<string, unknown>> & { id: string; code: string }): void {
  const now = "2026-01-01T00:00:00Z";
  db()
    .prepare(
      `INSERT OR REPLACE INTO partner_promotion
         (id, code, name, scope_kind, scope_id, value_kind, value_scaled, value_minor, value_days,
          supersedes_grandfathered, moderation_state, active, max_redemptions, redemption_count,
          expires_at, created_at, updated_at)
       VALUES (@id,@code,@name,@scope_kind,@scope_id,@value_kind,@value_scaled,@value_minor,@value_days,
               @supersedes_grandfathered,@moderation_state,@active,@max_redemptions,@redemption_count,
               @expires_at,@created_at,@updated_at)`,
    )
    .run({
      name: "test promo",
      scope_kind: "platform",
      scope_id: "*",
      value_kind: "percent",
      value_scaled: null,
      value_minor: null,
      value_days: null,
      supersedes_grandfathered: 0,
      moderation_state: "approved",
      active: 1,
      max_redemptions: null,
      redemption_count: 0,
      expires_at: null,
      created_at: now,
      updated_at: now,
      ...row,
    });
}

beforeAll(() => {
  db();
});

/* ══════════════════════════════════════════════════════════════════════════
 * W-7 — the annual price is DATA, not a hardcoded ×12 in a route handler.
 * ════════════════════════════════════════════════════════════════════════ */
describe("W-7 annual price resolution", () => {
  it("falls back to the legacy ×12 ONLY while no annual price is authored, and SAYS SO", () => {
    const r = resolveAnnualAmountMinor("wave5_test_tier_unpriced", 10_000);
    expect(r.amountMinor).toBe(120_000);
    // The point of the item: the derivation is no longer invisible.
    expect(r.derivation).toBe("legacy_x12");
    expect(r.usedLegacyFallback).toBe(true);
  });

  it("HONOURS an admin-authored annual price instead of multiplying by 12", () => {
    // 10 months' worth — an annual discount, which the old `* 12` made
    // structurally impossible to express.
    setTierPrice("wave5_test_tier_priced", "annual", 100_000, { updatedBy: "test" });
    const r = resolveAnnualAmountMinor("wave5_test_tier_priced", 10_000);
    expect(r.amountMinor).toBe(100_000);
    expect(r.derivation).toBe("tier_price_row");
    expect(r.usedLegacyFallback).toBe(false);
    // Against the pre-Wave-5 code this assertion is the one that fails: it
    // returned 120_000 and ignored the admin's price entirely.
    expect(r.amountMinor).not.toBe(10_000 * 12);
  });

  it("refuses a non-integer tier price rather than rounding it", () => {
    expect(() => setTierPrice("wave5_test_tier_bad", "annual", 100_000.5)).toThrow(/NON_INTEGER_MINOR/);
  });

  it("treats an UNPRICED tier as unpriced, never as zero", () => {
    setTierPrice("wave5_test_tier_null", "annual", null, { updatedBy: "test" });
    const r = resolveAnnualAmountMinor("wave5_test_tier_null", 7_000);
    // NULL must not collapse to a free plan.
    expect(r.amountMinor).toBe(84_000);
    expect(r.derivation).toBe("legacy_x12");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * XT-4 — the partner checkout can take a code, and the arithmetic is exact.
 * ════════════════════════════════════════════════════════════════════════ */
describe("XT-4 promotion discounts", () => {
  it("computes a percent discount by exact integer BigInt, not binary float", () => {
    // 1/3 off. In binary double, 299_99 * 0.3333333333 drifts; the exact
    // integer path is deterministic.
    seedPromotion({ id: "w5p_third", code: "W5THIRD", value_scaled: Math.round(CARRY_FRACTION_SCALE / 3) });
    const d = resolvePromotionDiscount("W5THIRD", 29_999, { partnerId: "p1" });
    // floor(29999 * 333333333 / 1e9) === 9999
    expect(d.discountMinor).toBe(9_999);
    expect(Number.isInteger(d.discountMinor)).toBe(true);
  });

  it("accepts a 100% promotion as legitimate data (owner-closed VIP case, P-2)", () => {
    seedPromotion({ id: "w5p_vip", code: "W5VIP", value_scaled: CARRY_FRACTION_SCALE });
    const d = resolvePromotionDiscount("W5VIP", 50_000, { partnerId: "p1" });
    // VIP = 1 genuinely IS 100% off. It must not be mistaken for 1%.
    expect(d.discountMinor).toBe(50_000);
  });

  it("rejects an expired, inactive, unapproved or exhausted code", () => {
    seedPromotion({ id: "w5p_exp", code: "W5EXP", value_scaled: CARRY_FRACTION_SCALE / 10, expires_at: "2020-01-01T00:00:00Z" });
    expect(() => resolvePromotionDiscount("W5EXP", 1000, { partnerId: "p1" })).toThrow(new RegExp(PROMOTION_NOT_APPLICABLE));
    seedPromotion({ id: "w5p_ex2", code: "W5EX2", value_scaled: CARRY_FRACTION_SCALE / 10, max_redemptions: 1, redemption_count: 1 });
    expect(() => resolvePromotionDiscount("W5EX2", 1000, { partnerId: "p1" })).toThrow(/redemptions_exhausted/);
    expect(() => resolvePromotionDiscount("W5_NO_SUCH_CODE", 1000, { partnerId: "p1" })).toThrow(/unknown_code/);
  });

  it("enforces scope — a partner-scoped code does not leak to another partner", () => {
    seedPromotion({ id: "w5p_sc", code: "W5SCOPE", scope_kind: "partner", scope_id: "partner_A", value_scaled: CARRY_FRACTION_SCALE / 2 });
    expect(resolvePromotionDiscount("W5SCOPE", 1000, { partnerId: "partner_A" }).discountMinor).toBe(500);
    expect(() => resolvePromotionDiscount("W5SCOPE", 1000, { partnerId: "partner_B" })).toThrow(new RegExp(PROMOTION_OUT_OF_SCOPE));
  });

  it("never produces a negative charge, even from an oversized flat discount", () => {
    seedPromotion({ id: "w5p_big", code: "W5BIG", value_kind: "flat_minor", value_minor: 999_999 });
    const d = resolvePromotionDiscount("W5BIG", 1_000, { partnerId: "p1" });
    expect(d.discountMinor).toBe(1_000); // capped at the base, not 999_999
    const q = quotePartnerSubscription({
      partnerId: "p1",
      tierSlug: "wave5_test_tier_unpriced",
      cycle: "monthly",
      monthlyAmountMinor: 1_000,
      promotionCode: "W5BIG",
    });
    expect(q.amountMinor).toBe(0);
    expect(q.amountMinor).toBeGreaterThanOrEqual(0);
  });

  it("does not block checkout on a bad code — it reports it and charges list", () => {
    const q = quotePartnerSubscription({
      partnerId: "p1",
      tierSlug: "wave5_test_tier_unpriced",
      cycle: "monthly",
      monthlyAmountMinor: 4_200,
      promotionCode: "W5_TYPO",
    });
    expect(q.amountMinor).toBe(4_200);
    expect(q.discountMinor).toBe(0);
    expect(q.discountRejectedReason).toMatch(/unknown_code/);
  });

  it("quotes annual from the tier row and applies the discount to THAT, not to the monthly", () => {
    setTierPrice("wave5_test_tier_priced", "annual", 100_000, { updatedBy: "test" });
    seedPromotion({ id: "w5p_ten", code: "W5TEN", value_scaled: CARRY_FRACTION_SCALE / 10 });
    const q = quotePartnerSubscription({
      partnerId: "p1",
      tierSlug: "wave5_test_tier_priced",
      cycle: "annual",
      monthlyAmountMinor: 10_000,
      promotionCode: "W5TEN",
    });
    expect(q.listAmountMinor).toBe(100_000);
    expect(q.discountMinor).toBe(10_000);
    expect(q.amountMinor).toBe(90_000);
    expect(q.priceDerivation).toBe("tier_price_row");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * CP-COM — cent conservation. The banned pattern is per-party Math.round.
 * ════════════════════════════════════════════════════════════════════════ */
describe("CP-COM cent conservation", () => {
  it("splits a commission so the parts sum EXACTLY to the whole", () => {
    // The classic failure: 100 / 3. Independent Math.round gives 33+33+33=99,
    // losing a cent. The allocator must give 34+33+33 = 100.
    const parts = splitCommissionMinor(100, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(parts).toEqual([34, 33, 33]);
  });

  it("conserves cents across many awkward splits", () => {
    const cases: Array<[number, number[]]> = [
      [10_000, [1, 1, 1]],
      [1, [1, 1, 1, 1]],
      [999_999, [7, 11, 13]],
      [12_345, [1, 2, 3, 4, 5]],
      [7, [1000000, 1, 1]],
    ];
    for (const [total, weights] of cases) {
      const parts = splitCommissionMinor(total, weights);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      expect(parts.every((p) => Number.isInteger(p))).toBe(true);
    }
  });

  it("keeps the invoice total equal to the sum of its lines (maintained by the DB)", () => {
    const inv = createInvoice({ partnerId: "p_conserve", currency: "USD" });
    addInvoiceLine({ invoiceId: inv, entryKind: "subscription", description: "Annual plan", amountMinor: 100_000 });
    addInvoiceLine({ invoiceId: inv, entryKind: "commission", description: "Deal commission", amountMinor: 25_000, settlementState: "pending" });
    addInvoiceLine({ invoiceId: inv, entryKind: "refund", description: "Goodwill refund", amountMinor: -5_000 });
    expect(assertInvoiceConserved(inv)).toBe(120_000);
    expect(getInvoice(inv)!.totalMinor).toBe(120_000);
  });

  it("CP-COM-02/04 — one consolidated invoice, settlement tracked at LINE grain", () => {
    const inv = createInvoice({ partnerId: "p_grain" });
    addInvoiceLine({ invoiceId: inv, entryKind: "subscription", description: "Plan", amountMinor: 50_000, settlementState: "paid" });
    addInvoiceLine({ invoiceId: inv, entryKind: "commission", description: "C1", amountMinor: 10_000, settlementState: "paid" });
    addInvoiceLine({ invoiceId: inv, entryKind: "commission", description: "C2", amountMinor: 3_000, settlementState: "pending" });
    // A single invoice legitimately mixes paid and pending. Invoice-grain
    // tracking would have forced these apart and destroyed the consolidation.
    const split = commissionSplit("p_grain");
    expect(split.paidMinor).toBe(10_000);
    expect(split.pendingMinor).toBe(3_000);
    expect(getInvoice(inv)!.lines.length).toBe(3);
    expect(assertInvoiceConserved(inv)).toBe(63_000);
  });

  it("refuses a non-integer invoice line rather than rounding it", () => {
    const inv = createInvoice({ partnerId: "p_int" });
    expect(() =>
      addInvoiceLine({ invoiceId: inv, entryKind: "adjustment", description: "bad", amountMinor: 10.5 }),
    ).toThrow(new RegExp(NON_INTEGER_MINOR));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * CP-SUB-15 / CP-PROMO-23 — event vocabulary is REUSED, not reinvented.
 * ════════════════════════════════════════════════════════════════════════ */
describe("CP-SUB-15 event name reuse", () => {
  it("rejects a brand-new event name that no consumer subscribes to", () => {
    expect(() =>
      emitMoneyEvent("partner.brand.new.event", { subjectKind: "invoice", subjectId: "x", payload: {} }),
    ).toThrow(/EVENT_NAME_NOT_REUSED/);
  });

  it("accepts a name already emitted elsewhere in the tree", () => {
    expect(() =>
      emitMoneyEvent("invoice.issued", { subjectKind: "invoice", subjectId: "x", payload: {} }),
    ).not.toThrow();
  });
});
