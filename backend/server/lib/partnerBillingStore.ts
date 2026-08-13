/**
 * server/lib/partnerBillingStore.ts — WAVE 5.
 *
 * Items: W-7, XT-4, CP-SUB-05/09/11/12/13/15/17/19, CP-COM-02/04/05,
 *        CP-PROMO-04/07/09/17/19/20/22/23, CP-ONB-01/04/05.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * MONEY DISCIPLINE IN THIS FILE (non-negotiable, all learned the hard way)
 * ═════════════════════════════════════════════════════════════════════════
 *   • Every amount is an INTEGER in MINOR UNITS. There is no float money here.
 *   • NO `Math.round` on a per-party share, ever. Where a total must be split,
 *     `allocateResidualCents` from ./money is used, whose comparator is
 *     (remainder DESC, weight DESC, index ASC) — so the parts sum EXACTLY to
 *     the whole. Independently rounding each share was a live cent-conservation
 *     defect in this codebase.
 *   • Percentages are FRACTIONS, stored on the exact integer scale
 *     CARRY_FRACTION_SCALE (1e9). A percent discount is applied by integer
 *     BigInt multiply-then-floor, never by `amount * rate` in binary double.
 *   • Discount can never exceed the amount, and the resulting charge can never
 *     be negative. Both are asserted, not assumed.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHERE THE MONEY ACTUALLY FLOWS — the sinks this store serves
 * ═════════════════════════════════════════════════════════════════════════
 *   W-7 / XT-4 sink:
 *     POST /api/partner/me/subscribe  (server/lib/partnerSelfServiceRoutes.ts)
 *     -> `quotePartnerSubscription()` here supplies the `amountMinor` that the
 *        response carries into the existing billing/gateway path. That response
 *        field IS the charged amount; it is not a preview.
 *   Second-path check (W-7): six other `* 12` sites exist tree-wide —
 *     server/subscriptionsStore.ts:129, server/adminPricingStore.ts:49,
 *     server/adminPlatformStore.ts:2209, server/pricingTiersStore.ts:103,
 *     server/pricingModelStore.ts:691, and server/paymentGatewayAdapter.ts:1492.
 *     The LAST of those is SACRED (read, never edited). They are NOT on the
 *     partner-subscribe path (they serve founder/company pricing surfaces), so
 *     they are out of this wave's scope and are reported, not silently touched.
 *     `resolveTierPrice()` is exported so those surfaces can adopt the row-based
 *     price when their own wave reaches them.
 *
 *   CP-SUB-05 sink: `partner_subscription`, one live row per partner enforced by
 *     the partial unique index `uq_psub_one_live` in migration 0153 — so a
 *     double-subscribe is a DB error, not a duplicate charge.
 *   CP-COM-* sink: `partner_invoice` + `partner_invoice_line`. The invoice total
 *     is maintained BY THE DATABASE from the lines (triggers trg_pinvl_*), which
 *     is the schema-level answer to "is there a second path to this write?" —
 *     there can be, and the total still cannot drift.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WIRED vs BUILT
 * ═════════════════════════════════════════════════════════════════════════
 *   WIRED (existing engine reused, not reimplemented):
 *     • `calcCouponDiscountCents` in server/paymentStore.ts is the platform's
 *       existing discount engine (percent / flat_minor / trial_extension_days).
 *       XT-4's gap was never "there is no coupon engine" — it was that
 *       partnerSelfServiceRoutes contained ZERO references to discount or
 *       coupon (verified by grep: 0 hits), so the partner checkout was the one
 *       checkout that could not take one. `resolvePromotionDiscount` below
 *       mirrors that engine's SEMANTICS exactly and defers to partner-scoped
 *       promotions, rather than growing a second discount vocabulary.
 *     • `allocateResidualCents` from server/lib/money.ts for every split.
 *     • The outbound event vocabulary, via ./wave5EventNames (CP-SUB-15).
 *   BUILT: the partner subscription/invoice/promotion records themselves, which
 *     genuinely did not exist (proof of absence recorded in migration 0153's
 *     CP-SUB-05 header).
 */
import { rawDb, getDb, getDbDriver } from "../db/connection";
import { log } from "./logger";
import { allocateResidualCents, CARRY_FRACTION_SCALE } from "./money";
import {
  addToBucket,
  normalizeCurrency,
  singleCurrencyScalar,
  type CurrencyBuckets,
  type MoneyScalar,
} from "./currencyScalar";
import { ensureWave5MoneySchema } from "./applyWave5MoneySchema";
import { applyWave38EventLedgerSchemaOnce } from "./applyWave38EventLedgerSchema";
import { assertReusedEventName } from "./wave5EventNames";

/* ── errors ─────────────────────────────────────────────────────────────── */

export const PARTNER_BILLING_UNAVAILABLE = "PARTNER_BILLING_UNAVAILABLE";
/** The (tier, cadence) row exists but is deliberately UNPRICED. Never charge. */
export const TIER_PRICE_UNPRICED = "TIER_PRICE_UNPRICED";
/** A discount would exceed the amount it is applied to. */
export const DISCOUNT_EXCEEDS_AMOUNT = "DISCOUNT_EXCEEDS_AMOUNT";
/** The promotion code is unknown, inactive, expired, or out of redemptions. */
export const PROMOTION_NOT_APPLICABLE = "PROMOTION_NOT_APPLICABLE";
/** The promotion exists but its scope does not cover this partner/tier. */
export const PROMOTION_OUT_OF_SCOPE = "PROMOTION_OUT_OF_SCOPE";
/** A computed money value was not an integer number of minor units. */
export const NON_INTEGER_MINOR = "NON_INTEGER_MINOR";
/** Invoice lines do not sum to the invoice total. Cent conservation broken. */
export const INVOICE_NOT_CONSERVED = "INVOICE_NOT_CONSERVED";

function db(): any {
  if (getDbDriver() === "postgres") throw new Error(PARTNER_BILLING_UNAVAILABLE);
  getDb();
  const handle = rawDb() as any;
  ensureWave5MoneySchema(handle);
  // WAVE 38 ROW 4 — 0183 adds the canonical ledger columns to
  // `partner_money_event`; `emitMoneyEvent` writes `actor_id` and `seq`. This
  // accessor is hot, so the once-per-HANDLE wrapper is used.
  applyWave38EventLedgerSchemaOnce(handle);
  return handle;
}

const nowIso = () => new Date().toISOString();
const newId = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

function assertIntegerMinor(v: number, label: string): number {
  if (!Number.isInteger(v)) throw new Error(`${NON_INTEGER_MINOR}:${label}:${v}`);
  return v;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * W-7 / CP-SUB-12 / CP-SUB-13 / CP-SUB-19 — TIER PRICE, DB-DRIVEN
 * ═══════════════════════════════════════════════════════════════════════════ */

export type Cadence = "monthly" | "annual" | "quarterly" | "one_time";

export interface TierPrice {
  tierSlug: string;
  cadence: Cadence;
  /** NULL means DELIBERATELY UNPRICED — it is NOT zero. */
  priceMinor: number | null;
  currency: string;
  derivation: "unpriced" | "admin_set" | "derived_x12";
  active: boolean;
}

/** CP-SUB-13 — every (tier, cadence) row, including the unpriced ones, so an
 *  admin surface can show price COVERAGE rather than hiding the gaps. */
export function listTierPrices(): TierPrice[] {
  return db()
    .prepare(`SELECT * FROM partner_tier_price ORDER BY tier_slug ASC, cadence ASC`)
    .all()
    .map(
      (r: any): TierPrice => ({
        tierSlug: String(r.tier_slug),
        cadence: r.cadence,
        priceMinor: r.price_minor === null || r.price_minor === undefined ? null : Number(r.price_minor),
        currency: String(r.currency),
        derivation: r.derivation,
        active: !!r.active,
      }),
    );
}

export function resolveTierPrice(tierSlug: string, cadence: Cadence): TierPrice | null {
  const r = db()
    .prepare(`SELECT * FROM partner_tier_price WHERE tier_slug = ? AND cadence = ? AND active = 1`)
    .get(tierSlug, cadence);
  if (!r) return null;
  return {
    tierSlug: String(r.tier_slug),
    cadence: r.cadence,
    priceMinor: r.price_minor === null || r.price_minor === undefined ? null : Number(r.price_minor),
    currency: String(r.currency),
    derivation: r.derivation,
    active: !!r.active,
  };
}

/** CP-SUB-12 — admin sets a price. Rejects non-integer and negative amounts. */
export function setTierPrice(
  tierSlug: string,
  cadence: Cadence,
  priceMinor: number | null,
  opts: { currency?: string; updatedBy?: string; notes?: string } = {},
): TierPrice {
  if (priceMinor !== null) {
    assertIntegerMinor(priceMinor, `tier_price:${tierSlug}:${cadence}`);
    if (priceMinor < 0) throw new Error(`${NON_INTEGER_MINOR}:negative:${priceMinor}`);
  }
  const now = nowIso();
  const h = db();
  h.prepare(
    `INSERT INTO partner_tier_price
       (id, tier_slug, cadence, price_minor, currency, derivation, active, notes, created_at, updated_at, updated_by)
     VALUES (?,?,?,?,?,?,1,?,?,?,?)
     ON CONFLICT(tier_slug, cadence) DO UPDATE SET
       price_minor = excluded.price_minor,
       currency    = excluded.currency,
       derivation  = excluded.derivation,
       notes       = excluded.notes,
       updated_at  = excluded.updated_at,
       updated_by  = excluded.updated_by`,
  ).run(
    newId("ptp"),
    tierSlug,
    cadence,
    priceMinor,
    (opts.currency ?? "USD").toUpperCase(),
    priceMinor === null ? "unpriced" : "admin_set",
    opts.notes ?? null,
    now,
    now,
    opts.updatedBy ?? null,
  );
  return resolveTierPrice(tierSlug, cadence)!;
}

export interface AnnualPriceResolution {
  amountMinor: number;
  derivation: "tier_price_row" | "legacy_x12" | "partner_override";
  currency: string;
  /** True when the legacy ×12 convention was used because no row is priced. */
  usedLegacyFallback: boolean;
}

/**
 * W-7 — the annual amount, WITHOUT a hardcoded pricing model.
 *
 * THE DEFECT. server/lib/partnerSelfServiceRoutes.ts:500 read
 * `plan.effectivePrice.amountMinor * 12`. That hardcodes "an annual plan is
 * twelve monthly payments" into the artifact: the platform cannot offer an
 * annual discount at all, and an admin who authors an annual price is silently
 * ignored on the one path that actually charges the partner.
 *
 * THE RESOLUTION ORDER, most authoritative first:
 *   1. an admin-set `partner_tier_price` row for (tier, 'annual')  -> authoritative
 *   2. the legacy monthly × 12                                     -> LABELLED fallback
 *
 * The fallback is preserved deliberately: removing it would change the price of
 * every existing partner at deploy time, with no admin action, which is exactly
 * the kind of silent money change this wave exists to prevent. What changes is
 * that the derivation is now VISIBLE in the quote and persisted on the
 * subscription row, instead of being an invisible constant in a route handler.
 *
 * CP-SUB-19 is an OWNER decision (Owner? = Y) and is NOT answered here. All
 * three candidate models are expressible against this mechanism; the open
 * question is recorded durably as `percent_policy_record.ppr_annual_pricing_model`
 * with status 'open'. No default was invented — every tier ships unpriced except
 * `founder_free`, which is genuinely 0.
 */
export function resolveAnnualAmountMinor(
  tierSlug: string,
  monthlyAmountMinor: number,
  currency = "USD",
): AnnualPriceResolution {
  assertIntegerMinor(monthlyAmountMinor, "monthlyAmountMinor");
  const row = resolveTierPrice(tierSlug, "annual");
  if (row && row.priceMinor !== null) {
    return {
      amountMinor: assertIntegerMinor(row.priceMinor, "annual_tier_price"),
      derivation: "tier_price_row",
      currency: row.currency,
      usedLegacyFallback: false,
    };
  }
  return {
    amountMinor: monthlyAmountMinor * 12,
    derivation: "legacy_x12",
    currency,
    usedLegacyFallback: true,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * CP-PROMO-04/07/09/17/19/20 + XT-4 — PROMOTIONS AND DISCOUNTS
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface Promotion {
  id: string;
  code: string;
  name: string;
  scopeKind: "platform" | "tier" | "partner" | "deal";
  scopeId: string;
  valueKind: "percent" | "flat_minor" | "trial_extension_days";
  /** Exact integer on CARRY_FRACTION_SCALE (1e9). 1e9 === 100%. */
  valueScaled: number | null;
  valueMinor: number | null;
  valueDays: number | null;
  supersedesGrandfathered: boolean;
  moderationState: "draft" | "pending_review" | "approved" | "rejected" | "changes_requested";
  active: boolean;
  maxRedemptions: number | null;
  redemptionCount: number;
  expiresAt: string | null;
}

function mapPromotion(r: any): Promotion {
  return {
    id: String(r.id),
    code: String(r.code),
    name: String(r.name),
    scopeKind: r.scope_kind,
    scopeId: String(r.scope_id),
    valueKind: r.value_kind,
    valueScaled: r.value_scaled == null ? null : Number(r.value_scaled),
    valueMinor: r.value_minor == null ? null : Number(r.value_minor),
    valueDays: r.value_days == null ? null : Number(r.value_days),
    supersedesGrandfathered: !!r.supersedes_grandfathered,
    moderationState: r.moderation_state,
    active: !!r.active,
    maxRedemptions: r.max_redemptions == null ? null : Number(r.max_redemptions),
    redemptionCount: Number(r.redemption_count ?? 0),
    expiresAt: r.expires_at ?? null,
  };
}

export function getPromotionByCode(code: string): Promotion | null {
  const r = db().prepare(`SELECT * FROM partner_promotion WHERE code = ?`).get(String(code).trim());
  return r ? mapPromotion(r) : null;
}

export function listPromotions(filter: { moderationState?: string } = {}): Promotion[] {
  const h = db();
  const rows = filter.moderationState
    ? h.prepare(`SELECT * FROM partner_promotion WHERE moderation_state = ? ORDER BY created_at DESC`).all(filter.moderationState)
    : h.prepare(`SELECT * FROM partner_promotion ORDER BY created_at DESC`).all();
  return rows.map(mapPromotion);
}

/**
 * CP-PROMO-07 — SCOPE IS MANDATORY. A promotion applies to exactly one scope
 * and never implicitly to everything. The schema enforces the enum; this is the
 * runtime match.
 */
export function promotionCoversPartner(
  p: Promotion,
  ctx: { partnerId: string; tierSlug?: string; dealId?: string },
): boolean {
  switch (p.scopeKind) {
    case "platform":
      return true;
    case "tier":
      return !!ctx.tierSlug && p.scopeId === ctx.tierSlug;
    case "partner":
      return p.scopeId === ctx.partnerId;
    case "deal":
      return !!ctx.dealId && p.scopeId === ctx.dealId;
    default:
      return false;
  }
}

export interface DiscountResult {
  /** INTEGER minor units. Never negative, never greater than the base. */
  discountMinor: number;
  /** Trial extension in days, for `trial_extension_days` promotions. */
  trialExtensionDays: number;
  promotionId: string;
  code: string;
  valueKind: Promotion["valueKind"];
  /** PROMO-19 — this promotion replaces a grandfathered free status. */
  supersedesGrandfathered: boolean;
}

/**
 * CP-PROMO-09 + XT-4 — resolve a code to an exact integer discount.
 *
 * SEMANTICS ARE THE EXISTING ENGINE'S. server/paymentStore.ts's
 * `calcCouponDiscountCents` already defines the platform's three discount kinds
 * (percent / flat_minor / trial_extension_days) and their meaning. This does not
 * invent a fourth or reinterpret the three; it applies the same three to the
 * partner-scoped promotion table, which is the surface the partner checkout can
 * actually reach.
 *
 * THE ARITHMETIC IS EXACT INTEGER, NOT FLOAT.
 *   discount = floor(baseMinor × valueScaled / 1e9)
 * computed entirely in BigInt. `baseMinor * rate` in binary double is how a
 * 33.3333% discount on 300000 comes out a cent short of what the invoice says.
 * FLOOR, not round: the discount rounds in the PLATFORM's favour by at most one
 * minor unit, deterministically, rather than rounding half-up and occasionally
 * discounting a cent more than the promotion promises.
 *
 * A 100% promotion (`valueScaled = 1e9`) is legitimate and yields a discount
 * equal to the base — the owner-closed VIP case (P-2). It is NOT treated as a
 * data error.
 *
 * @throws PROMOTION_NOT_APPLICABLE / PROMOTION_OUT_OF_SCOPE / DISCOUNT_EXCEEDS_AMOUNT
 */
export function resolvePromotionDiscount(
  code: string,
  baseMinor: number,
  ctx: { partnerId: string; tierSlug?: string; dealId?: string; atIso?: string },
): DiscountResult {
  assertIntegerMinor(baseMinor, "baseMinor");
  if (baseMinor < 0) throw new Error(`${NON_INTEGER_MINOR}:negative_base:${baseMinor}`);
  const p = getPromotionByCode(code);
  if (!p) throw new Error(`${PROMOTION_NOT_APPLICABLE}:unknown_code`);
  if (!p.active) throw new Error(`${PROMOTION_NOT_APPLICABLE}:inactive`);
  // The schema already forbids active + not-approved, but a read-side check
  // costs nothing and survives a schema change.
  if (p.moderationState !== "approved") throw new Error(`${PROMOTION_NOT_APPLICABLE}:not_approved`);
  const at = ctx.atIso ?? nowIso();
  if (p.expiresAt && p.expiresAt <= at) throw new Error(`${PROMOTION_NOT_APPLICABLE}:expired`);
  if (p.maxRedemptions !== null && p.redemptionCount >= p.maxRedemptions) {
    throw new Error(`${PROMOTION_NOT_APPLICABLE}:redemptions_exhausted`);
  }
  if (!promotionCoversPartner(p, ctx)) throw new Error(`${PROMOTION_OUT_OF_SCOPE}:${p.scopeKind}`);

  let discountMinor = 0;
  let trialExtensionDays = 0;
  if (p.valueKind === "percent") {
    // EXACT integer arithmetic on scale 1e9. No binary float anywhere.
    const scaled = BigInt(p.valueScaled ?? 0);
    discountMinor = Number((BigInt(baseMinor) * scaled) / BigInt(CARRY_FRACTION_SCALE));
  } else if (p.valueKind === "flat_minor") {
    discountMinor = assertIntegerMinor(p.valueMinor ?? 0, "promotion.value_minor");
  } else {
    trialExtensionDays = p.valueDays ?? 0;
  }

  if (discountMinor < 0) throw new Error(`${NON_INTEGER_MINOR}:negative_discount:${discountMinor}`);
  if (discountMinor > baseMinor) {
    // A flat discount larger than the amount would produce a NEGATIVE charge —
    // i.e. the platform paying the partner. Cap it at the base and say so,
    // rather than letting a negative amount reach a gateway.
    log.warn(
      `[partnerBillingStore] promotion ${p.code} discount ${discountMinor} exceeds base ${baseMinor}; capping at base.`,
    );
    discountMinor = baseMinor;
  }
  return {
    discountMinor,
    trialExtensionDays,
    promotionId: p.id,
    code: p.code,
    valueKind: p.valueKind,
    supersedesGrandfathered: p.supersedesGrandfathered,
  };
}

/**
 * CP-PROMO-20 — moderation. An `approved` promotion may be activated; anything
 * else may not. The schema's `CHECK (active = 0 OR moderation_state = 'approved')`
 * makes that structural, so this writer cannot be bypassed into an active
 * unapproved promotion by a second path.
 */
export function moderatePromotion(
  promotionId: string,
  decision: "approved" | "rejected" | "changes_requested",
  by: string,
  note?: string,
): void {
  const now = nowIso();
  const h = db();
  h.prepare(
    `UPDATE partner_promotion
        SET moderation_state = ?, moderation_note = ?, moderated_by = ?, moderated_at = ?,
            active = CASE WHEN ? = 'approved' THEN active ELSE 0 END,
            updated_at = ?
      WHERE id = ?`,
  ).run(decision, note ?? null, by, now, decision, now, promotionId);
  const eventName =
    decision === "approved"
      ? "partner.promotion.approved"
      : decision === "rejected"
        ? "partner.promotion.rejected"
        : "partner.promotion_changes_requested";
  emitMoneyEvent(eventName, { subjectKind: "promotion", subjectId: promotionId, payload: { decision, by, note: note ?? null } });
}

/**
 * CP-PROMO-19 — a promotion SUPERSEDES a grandfathered free tier; it does not
 * stack with it. Recording the grant is what makes the supersession auditable:
 * the row says which subscription status was replaced and why.
 */
export function grantPromotion(
  promotionId: string,
  partnerId: string,
  appliedDiscountMinor: number,
  opts: { subscriptionId?: string; grantedBy?: string; supersededStatus?: string } = {},
): string {
  assertIntegerMinor(appliedDiscountMinor, "appliedDiscountMinor");
  const id = newId("ppgrant");
  db()
    .prepare(
      `INSERT INTO partner_promotion_grant
         (id, promotion_id, partner_id, subscription_id, applied_discount_minor, superseded_status, granted_at, granted_by)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(promotion_id, partner_id) DO NOTHING`,
    )
    .run(
      id,
      promotionId,
      partnerId,
      opts.subscriptionId ?? null,
      appliedDiscountMinor,
      opts.supersededStatus ?? null,
      nowIso(),
      opts.grantedBy ?? null,
    );
  return id;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * XT-4 + W-7 — THE QUOTE THAT THE SUBSCRIBE ROUTE ACTUALLY CHARGES
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface SubscriptionQuote {
  listAmountMinor: number;
  discountMinor: number;
  amountMinor: number;
  currency: string;
  priceDerivation: "tier_price_row" | "partner_override" | "legacy_x12" | "grandfathered_free";
  discountCode: string | null;
  trialExtensionDays: number;
  /** Present when a promotion code was supplied but could not be applied. */
  discountRejectedReason: string | null;
  /**
   * WAVE 14 / CP-PROMO-19 — carried on the QUOTE because the charge path needs
   * it BEFORE it writes, and the charge path does not read the promotion itself.
   *
   * Wave 5 put the grandfathered-supersession logic inside `createSubscription`
   * in this module, which has no route caller; the writer that actually runs in
   * production is `startPartnerCheckout` in ./partnerSubscriptionStore. That is
   * the second path, and it did not supersede. Because `uq_psub_one_live`
   * includes `grandfathered`, its INSERT did not "silently stack" — it hit a
   * UNIQUE constraint AFTER the payment intent had already been minted. Exposing
   * the flag here lets the real writer decide before it charges.
   */
  supersedesGrandfathered: boolean;
  /** The promotion that produced the discount, for grant recording. */
  promotionId: string | null;
}

/**
 * Compute the exact integer amount to charge a partner for one period.
 *
 * This is called from POST /api/partner/me/subscribe and its `amountMinor` is
 * the value carried into the existing billing/gateway path. It is the charged
 * amount, not a preview.
 *
 * A BAD PROMOTION CODE DOES NOT BLOCK CHECKOUT. It is reported in
 * `discountRejectedReason` and the list price is charged. Throwing would let a
 * typo'd code take down a partner's ability to subscribe at all; silently
 * ignoring it would let a partner believe a discount applied when it did not.
 * Reporting it does neither.
 */
export function quotePartnerSubscription(input: {
  partnerId: string;
  tierSlug: string;
  cycle: "monthly" | "annual";
  /** The per-MONTH list amount resolved by the existing effective-plan resolver. */
  monthlyAmountMinor: number;
  currency?: string;
  /** True when the amount came from an admin per-partner override (exact, no ×12). */
  isPartnerOverride?: boolean;
  /** The exact override amount for THIS cycle, when isPartnerOverride. */
  overrideAmountMinor?: number;
  promotionCode?: string | null;
  dealId?: string;
}): SubscriptionQuote {
  const currency = (input.currency ?? "USD").toUpperCase();
  let listAmountMinor: number;
  let priceDerivation: SubscriptionQuote["priceDerivation"];

  if (input.isPartnerOverride) {
    // An admin-set per-partner amount is EXACT for the cycle chosen — it is not
    // multiplied by anything. Preserved from the pre-Wave-5 behaviour.
    listAmountMinor = assertIntegerMinor(input.overrideAmountMinor ?? input.monthlyAmountMinor, "override");
    priceDerivation = "partner_override";
  } else if (input.cycle === "annual") {
    const r = resolveAnnualAmountMinor(input.tierSlug, input.monthlyAmountMinor, currency);
    listAmountMinor = r.amountMinor;
    priceDerivation = r.derivation === "tier_price_row" ? "tier_price_row" : "legacy_x12";
  } else {
    const row = resolveTierPrice(input.tierSlug, "monthly");
    if (row && row.priceMinor !== null) {
      listAmountMinor = row.priceMinor;
      priceDerivation = "tier_price_row";
    } else {
      listAmountMinor = assertIntegerMinor(input.monthlyAmountMinor, "monthlyAmountMinor");
      priceDerivation = "legacy_x12";
    }
  }

  let discountMinor = 0;
  let trialExtensionDays = 0;
  let discountCode: string | null = null;
  let discountRejectedReason: string | null = null;
  let supersedesGrandfathered = false;
  let promotionId: string | null = null;

  const code = (input.promotionCode ?? "").trim();
  if (code) {
    try {
      const d = resolvePromotionDiscount(code, listAmountMinor, {
        partnerId: input.partnerId,
        tierSlug: input.tierSlug,
        dealId: input.dealId,
      });
      discountMinor = d.discountMinor;
      trialExtensionDays = d.trialExtensionDays;
      discountCode = d.code;
      supersedesGrandfathered = d.supersedesGrandfathered;
      promotionId = d.promotionId;
    } catch (err) {
      discountRejectedReason = (err as Error).message;
      log.warn(`[partnerBillingStore] promotion "${code}" not applied for ${input.partnerId}: ${discountRejectedReason}`);
    }
  }

  const amountMinor = listAmountMinor - discountMinor;
  if (amountMinor < 0) throw new Error(`${DISCOUNT_EXCEEDS_AMOUNT}:${listAmountMinor}:${discountMinor}`);
  assertIntegerMinor(amountMinor, "amountMinor");

  return {
    listAmountMinor,
    discountMinor,
    amountMinor,
    currency,
    priceDerivation,
    discountCode,
    trialExtensionDays,
    discountRejectedReason,
    supersedesGrandfathered,
    promotionId,
  };
}

/**
 * WAVE 14 / CP-PROMO-19 — THE SUPERSESSION, EXTRACTED SO BOTH WRITERS SHARE IT.
 *
 * Rule: fix where the data flows, then hunt a SECOND path to the same write.
 * There are exactly two writers to `partner_subscription` in this tree:
 *   1. `createSubscription` (this module)                    — no route caller
 *   2. `startPartnerCheckout` (./partnerSubscriptionStore)   — the LIVE path,
 *      reached by POST /api/partner/me/checkout
 * Only (1) superseded. This function is now called by BOTH, so the invariant
 * does not depend on which writer runs.
 *
 * It must be called INSIDE the caller's transaction, immediately before the
 * INSERT, because the partial unique index `uq_psub_one_live` treats
 * 'grandfathered' as live: superseding in a separate transaction would leave a
 * window in which neither row exists.
 *
 * Returns the superseded row id, or null when there was nothing to supersede.
 */
export function supersedeGrandfatheredForInsert(
  handle: { prepare: (sql: string) => { get: (...a: unknown[]) => any; run: (...a: unknown[]) => unknown } },
  partnerId: string,
  newSubscriptionId: string,
  atIso: string,
): string | null {
  const existing = handle
    .prepare(
      `SELECT id FROM partner_subscription
        WHERE subject_kind = 'partner' AND subject_id = ? AND status = 'grandfathered'`,
    )
    .get(partnerId);
  if (!existing) return null;
  handle
    .prepare(
      `UPDATE partner_subscription
          SET status = 'superseded', superseded_by = ?, superseded_reason = ?, updated_at = ?
        WHERE id = ?`,
    )
    .run(
      newSubscriptionId,
      "CP-PROMO-19: promotion supersedes grandfathered free tier (does not stack)",
      atIso,
      String(existing.id),
    );
  return String(existing.id);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * CP-SUB-05 / CP-SUB-11 / CP-SUB-17 / CP-ONB-05 — THE SUBSCRIPTION RECORD
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface PartnerSubscription {
  id: string;
  partnerId: string;
  tierSlug: string;
  cadence: Cadence;
  status: "pending" | "active" | "past_due" | "cancelled" | "grandfathered" | "superseded";
  amountMinor: number;
  listAmountMinor: number;
  discountMinor: number;
  discountCode: string | null;
  currency: string;
  priceDerivation: string;
  periodStart: string | null;
  periodEnd: string | null;
  paymentIntentId: string | null;
  grandfatheredFrom: string | null;
  supersededBy: string | null;
  supersededReason: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/*
 * WAVE 13 — COLUMN NAMES BELOW ARE THE CANONICAL ONES.
 *
 * `partner_subscription` had TWO incompatible declarations (0153: partner_id /
 * cadence / period_*; 0167:37: subject_kind + subject_id / cycle /
 * current_period_*, the persona-agnostic EN-8 shape). This store was the only
 * consumer still reading the 0153 names, while partnerSubscriptionStore.ts,
 * subscriptionEnforcementWorker.ts and subscriptionChangeStore.ts read the 0167
 * names — so on a fresh database exactly one of the two groups was guaranteed to
 * be wrong. 0169_wave13_partner_subscription_shape_reconcile.sql reconciles the
 * table to the subject-keyed shape and this store is repointed at it here.
 *
 * THE TypeScript API IS DELIBERATELY UNCHANGED (`partnerId`, `cadence`,
 * `periodStart`, `periodEnd`). This store is the PARTNER-FACING facade for
 * CP-SUB/CP-COM: every caller is partner-scoped, so `partnerId` is the honest
 * name at this boundary and renaming it would churn call sites without making
 * anything more correct. What was wrong was the SQL, and only the SQL is
 * changed: partner_id → subject_id (with subject_kind = 'partner'),
 * cadence → cycle, period_start/end → current_period_start/end.
 */
const SUBJECT_KIND_PARTNER = "partner";

function mapSub(r: any): PartnerSubscription {
  return {
    id: String(r.id),
    partnerId: String(r.subject_id),
    tierSlug: String(r.tier_slug),
    cadence: r.cycle,
    status: r.status,
    amountMinor: Number(r.amount_minor),
    // `list_amount_minor` is NULLABLE in the canonical shape (0167 allowed a row
    // with no recorded list price). It is DERIVED, not invented, when absent:
    // the schema CHECK guarantees amount = list - discount, so
    // list = amount + discount exactly.
    listAmountMinor:
      r.list_amount_minor === null || r.list_amount_minor === undefined
        ? Number(r.amount_minor) + Number(r.discount_minor)
        : Number(r.list_amount_minor),
    discountMinor: Number(r.discount_minor),
    discountCode: r.discount_code ?? null,
    currency: String(r.currency),
    priceDerivation: String(r.price_derivation ?? "tier_price_row"),
    periodStart: r.current_period_start ?? null,
    periodEnd: r.current_period_end ?? null,
    paymentIntentId: r.payment_intent_id ?? null,
    grandfatheredFrom: r.grandfathered_from ?? null,
    supersededBy: r.superseded_by ?? null,
    supersededReason: r.superseded_reason ?? null,
    cancelledAt: r.cancelled_at ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export function getLiveSubscription(partnerId: string): PartnerSubscription | null {
  const r = db()
    .prepare(
      `SELECT * FROM partner_subscription
        WHERE subject_kind = ? AND subject_id = ?
          AND status IN ('pending','active','past_due','grace','grandfathered')
        LIMIT 1`,
    )
    .get(SUBJECT_KIND_PARTNER, partnerId);
  return r ? mapSub(r) : null;
}

export function listSubscriptions(partnerId: string): PartnerSubscription[] {
  return db()
    .prepare(
      `SELECT * FROM partner_subscription
        WHERE subject_kind = ? AND subject_id = ? ORDER BY created_at DESC`,
    )
    .all(SUBJECT_KIND_PARTNER, partnerId)
    .map(mapSub);
}

/**
 * CP-SUB-05 — create the canonical subscription row.
 *
 * SECOND-PATH DEFENCE IS STRUCTURAL. `uq_psub_one_live` (repointed by migration
 * 0169) is a PARTIAL UNIQUE INDEX on (subject_kind, subject_id) where status is
 * live. So even if a second
 * writer appears — a webhook, an admin tool, a retry — a partner cannot end up
 * with two live subscriptions and therefore cannot be charged twice for the same
 * entitlement. The invariant is in the database, not in this function.
 *
 * CP-PROMO-19 — when the quote carries a promotion that supersedes a
 * grandfathered status, the existing grandfathered row is moved to `superseded`
 * FIRST, in the same transaction, so the unique index is satisfied and the
 * supersession is recorded rather than the promotion silently stacking.
 */
export function createSubscription(input: {
  partnerId: string;
  tierSlug: string;
  cadence: Cadence;
  quote: SubscriptionQuote;
  status?: PartnerSubscription["status"];
  periodStart?: string;
  periodEnd?: string;
  paymentIntentId?: string;
  createdBy?: string;
  supersedesGrandfathered?: boolean;
}): PartnerSubscription {
  const h = db();
  const now = nowIso();
  const id = newId("psub");
  const tx = h.transaction(() => {
    // WAVE 14 — the inline block that used to live here is now
    // `supersedeGrandfatheredForInsert`, shared with the LIVE checkout writer.
    // The flag defaults to the quote's own answer so a caller that forgets to
    // pass `supersedesGrandfathered` still behaves correctly.
    if (input.supersedesGrandfathered ?? input.quote.supersedesGrandfathered) {
      supersedeGrandfatheredForInsert(h as never, input.partnerId, id, now);
    }
    h.prepare(
      `INSERT INTO partner_subscription
         (id, subject_kind, subject_id, tier_slug, cycle, status, amount_minor, list_amount_minor,
          discount_minor, discount_code, currency, price_derivation,
          current_period_start, current_period_end, payment_intent_id,
          created_at, updated_at, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      SUBJECT_KIND_PARTNER,
      input.partnerId,
      input.tierSlug,
      input.cadence,
      input.status ?? "pending",
      input.quote.amountMinor,
      input.quote.listAmountMinor,
      input.quote.discountMinor,
      input.quote.discountCode,
      input.quote.currency,
      input.quote.priceDerivation,
      input.periodStart ?? null,
      input.periodEnd ?? null,
      input.paymentIntentId ?? null,
      now,
      now,
      input.createdBy ?? null,
    );
  });
  tx();
  emitMoneyEvent("subscription.activated", {
    partnerId: input.partnerId,
    subjectKind: "subscription",
    subjectId: id,
    payload: {
      tierSlug: input.tierSlug,
      cadence: input.cadence,
      amountMinor: input.quote.amountMinor,
      listAmountMinor: input.quote.listAmountMinor,
      discountMinor: input.quote.discountMinor,
      priceDerivation: input.quote.priceDerivation,
    },
  });
  return mapSub(h.prepare(`SELECT * FROM partner_subscription WHERE id = ?`).get(id));
}

/* ═══════════════════════════════════════════════════════════════════════════
 * CP-SUB-09 / CP-COM-02 / CP-COM-04 / CP-COM-05 — INVOICES
 * ═══════════════════════════════════════════════════════════════════════════ */

export type EntryKind = "subscription" | "commission" | "spv_fee" | "adjustment" | "refund";
export type SettlementState = "pending" | "paid" | "waived" | "failed";

export interface InvoiceLine {
  id: string;
  invoiceId: string;
  entryKind: EntryKind;
  description: string;
  amountMinor: number;
  settlementState: SettlementState;
  sourceRef: string | null;
  settledAt: string | null;
}

export interface Invoice {
  id: string;
  partnerId: string;
  invoiceNumber: string;
  status: "draft" | "issued" | "paid" | "void" | "uncollectible";
  currency: string;
  totalMinor: number;
  periodStart: string | null;
  periodEnd: string | null;
  issuedAt: string | null;
  paidAt: string | null;
  lines: InvoiceLine[];
}

/** COM-05 — the five billing-entry kinds, exported so the UI enumerates the
 *  same five the database enforces rather than a hand-kept copy. */
export const BILLING_ENTRY_KINDS: readonly EntryKind[] = [
  "subscription",
  "commission",
  "spv_fee",
  "adjustment",
  "refund",
] as const;

export function createInvoice(input: {
  partnerId: string;
  invoiceNumber?: string;
  currency?: string;
  periodStart?: string;
  periodEnd?: string;
  subscriptionId?: string;
}): string {
  const now = nowIso();
  const id = newId("pinv");
  db()
    .prepare(
      `INSERT INTO partner_invoice
         (id, partner_id, invoice_number, status, currency, total_minor, period_start, period_end,
          subscription_id, created_at, updated_at)
       VALUES (?,?,?, 'draft', ?, 0, ?,?,?,?,?)`,
    )
    .run(
      id,
      input.partnerId,
      input.invoiceNumber ?? `INV-${id}`,
      (input.currency ?? "USD").toUpperCase(),
      input.periodStart ?? null,
      input.periodEnd ?? null,
      input.subscriptionId ?? null,
      now,
      now,
    );
  return id;
}

/**
 * CP-COM-02 — CONSOLIDATED BILLING. Subscription, commission and SPV-fee lines
 * live on ONE invoice.
 * CP-COM-04 — pending vs paid is tracked at LINE grain, not invoice grain,
 * because a single consolidated invoice legitimately mixes a paid subscription
 * line with a pending commission line. Tracking it at invoice grain would have
 * forced those apart and destroyed the consolidation.
 *
 * CENT CONSERVATION: the invoice `total_minor` is recomputed BY THE DATABASE
 * (triggers trg_pinvl_after_insert/update/delete in 0153) from the lines. This
 * function does not maintain the total, and could not corrupt it if it tried —
 * which is the point: a SECOND writer of lines still cannot make the total
 * disagree with the lines.
 */
export function addInvoiceLine(input: {
  invoiceId: string;
  entryKind: EntryKind;
  description: string;
  amountMinor: number;
  settlementState?: SettlementState;
  sourceRef?: string;
}): string {
  assertIntegerMinor(input.amountMinor, `invoice_line:${input.entryKind}`);
  const id = newId("pinvl");
  db()
    .prepare(
      `INSERT INTO partner_invoice_line
         (id, invoice_id, entry_kind, description, amount_minor, settlement_state, source_ref, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      input.invoiceId,
      input.entryKind,
      input.description,
      input.amountMinor,
      input.settlementState ?? "pending",
      input.sourceRef ?? null,
      nowIso(),
    );
  return id;
}

export function getInvoice(invoiceId: string): Invoice | null {
  const h = db();
  const r = h.prepare(`SELECT * FROM partner_invoice WHERE id = ?`).get(invoiceId);
  if (!r) return null;
  const lines: InvoiceLine[] = h
    .prepare(`SELECT * FROM partner_invoice_line WHERE invoice_id = ? ORDER BY created_at ASC, id ASC`)
    .all(invoiceId)
    .map((l: any) => ({
      id: String(l.id),
      invoiceId: String(l.invoice_id),
      entryKind: l.entry_kind,
      description: String(l.description),
      amountMinor: Number(l.amount_minor),
      settlementState: l.settlement_state,
      sourceRef: l.source_ref ?? null,
      settledAt: l.settled_at ?? null,
    }));
  return {
    id: String(r.id),
    partnerId: String(r.partner_id),
    invoiceNumber: String(r.invoice_number),
    status: r.status,
    currency: String(r.currency),
    totalMinor: Number(r.total_minor),
    periodStart: r.period_start ?? null,
    periodEnd: r.period_end ?? null,
    issuedAt: r.issued_at ?? null,
    paidAt: r.paid_at ?? null,
    lines,
  };
}

/**
 * Independent re-assertion of cent conservation. The DB triggers already keep
 * `total_minor` equal to the sum of the lines; this recomputes it in
 * application code and throws if they disagree.
 *
 * Belt AND braces, deliberately: a trigger that is accidentally dropped by a
 * future migration would otherwise fail SILENTLY, and a silently wrong invoice
 * total is the worst possible failure mode for this table.
 */
export function assertInvoiceConserved(invoiceId: string): number {
  const inv = getInvoice(invoiceId);
  if (!inv) throw new Error(`${INVOICE_NOT_CONSERVED}:no_such_invoice:${invoiceId}`);
  const sum = inv.lines.reduce((a, l) => a + l.amountMinor, 0);
  if (sum !== inv.totalMinor) {
    throw new Error(`${INVOICE_NOT_CONSERVED}:${invoiceId}:lines=${sum}:total=${inv.totalMinor}`);
  }
  return sum;
}

/** CP-COM-04 — the pending/paid split, computed from the LINES. */
export function commissionSplit(partnerId: string): { pendingMinor: number; paidMinor: number } {
  const rows = db()
    .prepare(
      `SELECT l.settlement_state AS s, SUM(l.amount_minor) AS t
         FROM partner_invoice_line l
         JOIN partner_invoice i ON i.id = l.invoice_id
        WHERE i.partner_id = ? AND l.entry_kind = 'commission'
        GROUP BY l.settlement_state`,
    )
    .all(partnerId);
  let pendingMinor = 0;
  let paidMinor = 0;
  for (const r of rows) {
    if (r.s === "paid") paidMinor += Number(r.t ?? 0);
    else if (r.s === "pending") pendingMinor += Number(r.t ?? 0);
  }
  return { pendingMinor, paidMinor };
}

/**
 * Split a single settled amount across several commission recipients WITHOUT
 * losing a cent.
 *
 * THIS IS THE PATTERN THE MONEY RULES MANDATE. The banned alternative is
 * `Math.round(total * share)` per recipient, which was a live defect in this
 * project: the independently rounded parts did not sum to the whole, so a
 * consolidated invoice was off by a cent or two and the difference went
 * nowhere. `allocateResidualCents` distributes the remainder deterministically
 * by (remainder DESC, weight DESC, index ASC), so the parts sum EXACTLY to the
 * total, every time, for any weights.
 */
export function splitCommissionMinor(totalMinor: number, weightsMinor: readonly number[]): number[] {
  assertIntegerMinor(totalMinor, "splitCommissionMinor.total");
  const parts = allocateResidualCents(
    BigInt(totalMinor),
    weightsMinor.map((w) => BigInt(assertIntegerMinor(w, "splitCommissionMinor.weight"))),
  ).map((b) => Number(b));
  const sum = parts.reduce((a, b) => a + b, 0);
  if (sum !== totalMinor) {
    // Unreachable if allocateResidualCents is correct. Asserted anyway, because
    // "the allocator is correct" is exactly the assumption that failed before.
    throw new Error(`${INVOICE_NOT_CONSERVED}:commission_split:${sum}!=${totalMinor}`);
  }
  return parts;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * CP-SUB-15 / CP-PROMO-23 — EVENTS (reusing the existing vocabulary)
 * ═══════════════════════════════════════════════════════════════════════════ */

export function emitMoneyEvent(
  eventName: string,
  input: {
    partnerId?: string;
    subjectKind: "subscription" | "invoice" | "promotion" | "commission" | "captable_commit";
    subjectId: string;
    payload: Record<string, unknown>;
    // WAVE 38 ROW 4 — canonical event columns (wave0/EVENT_COLUMNS_CANONICAL.sql).
    // All optional so no existing caller changes behaviour; `actorId` falls back
    // to 'system', which is the truthful statement that the emit was machine
    // originated, not a fabricated user id.
    actorId?: string | null;
    requestId?: string | null;
    idempotencyKey?: string | null;
    sourceEventType?: string | null;
    sourceEventId?: string | null;
  },
): string {
  // Fail closed on a NEW name. CP-SUB-15 is explicit that the existing outbound
  // vocabulary is reused; a name nobody consumes is the same as no event.
  assertReusedEventName(eventName);
  const id = newId("pme");
  const at = nowIso();
  try {
    db()
      .prepare(
        // `seq` is per-parent (canonical exception 2): the parent here is the
        // (subject_kind, subject_id) pair the timeline is read back by. The
        // scalar subquery is evaluated inside the same statement, so the value
        // is derived from the table rather than tracked in memory.
        `INSERT INTO partner_money_event
           (id, event_name, partner_id, subject_kind, subject_id, payload_json, emitted_at,
            actor_id, request_id, idempotency_key, source_event_type, source_event_id,
            seq, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,
                 (SELECT COALESCE(MAX(seq), 0) + 1 FROM partner_money_event
                   WHERE subject_kind = ? AND subject_id = ?),
                 ?)`,
      )
      .run(
        id, eventName, input.partnerId ?? null, input.subjectKind, input.subjectId,
        JSON.stringify(input.payload), at,
        input.actorId ?? "system",
        input.requestId ?? null,
        input.idempotencyKey ?? null,
        input.sourceEventType ?? null,
        input.sourceEventId ?? null,
        input.subjectKind, input.subjectId,
        at,
      );
  } catch (err) {
    // An event write must never roll back the money operation that produced it.
    log.warn(`[partnerBillingStore] event ${eventName} not recorded: ${(err as Error).message}`);
  }
  return id;
}

export function listMoneyEvents(subjectKind: string, subjectId: string): Array<{ eventName: string; payload: unknown; emittedAt: string }> {
  return db()
    .prepare(
      `SELECT event_name, payload_json, emitted_at FROM partner_money_event
        WHERE subject_kind = ? AND subject_id = ? ORDER BY emitted_at ASC, id ASC`,
    )
    .all(subjectKind, subjectId)
    .map((r: any) => ({
      eventName: String(r.event_name),
      payload: JSON.parse(String(r.payload_json)),
      emittedAt: String(r.emitted_at),
    }));
}

/* ═══════════════════════════════════════════════════════════════════════════
 * WAVE 14 — THE READ SIDE THE ROUTES NEED.
 *
 * Every function above this line was written in Wave 5 and, until Wave 14, only
 * `quotePartnerSubscription` had a live caller. Wiring the engine to routes
 * exposed three reads that did not exist because no route had ever asked for
 * them: invoices BY PARTNER, money events BY PARTNER, and the tier-price
 * coverage summary. They are read-only and add no second writer.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** CP-SUB-09 / CP-COM-02 — a partner's invoices, newest first, lines included. */
export function listInvoices(partnerId: string): Invoice[] {
  const ids = db()
    .prepare(`SELECT id FROM partner_invoice WHERE partner_id = ? ORDER BY created_at DESC, id DESC`)
    .all(partnerId)
    .map((r: any) => String(r.id));
  const out: Invoice[] = [];
  for (const id of ids) {
    const inv = getInvoice(id);
    if (inv) out.push(inv);
  }
  return out;
}

/**
 * CP-SUB-15 / CP-PROMO-23 — money events for one partner across every subject.
 *
 * `listMoneyEvents` is keyed by (subjectKind, subjectId), which is right for a
 * detail view and useless for a timeline. This is the timeline read. It returns
 * the subject so the client can link back, which the other function cannot do.
 */
export function listMoneyEventsForPartner(
  partnerId: string,
  limit = 200,
): Array<{ id: string; eventName: string; subjectKind: string; subjectId: string; payload: unknown; emittedAt: string }> {
  const capped = Number.isSafeInteger(limit) && limit > 0 && limit <= 1000 ? limit : 200;
  return db()
    .prepare(
      `SELECT id, event_name, subject_kind, subject_id, payload_json, emitted_at
         FROM partner_money_event
        WHERE partner_id = ?
        ORDER BY emitted_at DESC, id DESC
        LIMIT ?`,
    )
    .all(partnerId, capped)
    .map((r: any) => ({
      id: String(r.id),
      eventName: String(r.event_name),
      subjectKind: String(r.subject_kind),
      subjectId: String(r.subject_id),
      payload: (() => {
        try {
          return JSON.parse(String(r.payload_json));
        } catch {
          // A malformed payload is reported, never dropped: dropping it would
          // make the timeline silently shorter than the ledger.
          return { unparseable: String(r.payload_json) };
        }
      })(),
      emittedAt: String(r.emitted_at),
    }));
}

/**
 * CP-SUB-13 — price COVERAGE, which is the actual promise: an admin has to be
 * able to see WHICH tiers are unpriced, not just read a list.
 *
 * `unpriced` counts rows whose `price_minor IS NULL`. A row priced at 0 is a
 * real free tier and is counted as PRICED. Conflating the two is exactly the
 * mistake the NULL-vs-0 distinction in the schema exists to prevent.
 */
export function tierPriceCoverage(): {
  rows: TierPrice[];
  total: number;
  priced: number;
  unpriced: number;
  tiers: string[];
  unpricedPairs: Array<{ tierSlug: string; cadence: Cadence }>;
} {
  const rows = listTierPrices();
  const unpricedPairs = rows
    .filter((r) => r.priceMinor === null)
    .map((r) => ({ tierSlug: r.tierSlug, cadence: r.cadence }));
  return {
    rows,
    total: rows.length,
    priced: rows.length - unpricedPairs.length,
    unpriced: unpricedPairs.length,
    tiers: Array.from(new Set(rows.map((r) => r.tierSlug))).sort(),
    unpricedPairs,
  };
}

/**
 * CP-COM-04 / CP-COM-05 — the pending/paid position for ALL FIVE entry kinds.
 *
 * `commissionSplit` above answers only for `entry_kind = 'commission'`, which is
 * correct for its name and insufficient for the page: a partner's position spans
 * subscription, commission, spv_fee, adjustment and refund lines. Adding the
 * breakdown here rather than in the route keeps every money read in one file and
 * keeps the route free of SQL.
 *
 * Currency is REPORTED, not assumed.
 *
 * ============================================================
 * WAVE 21 · ITEM 2 site 2 (REVIEW A CRITICAL, was :1209-1247)
 *
 * WAS: the SQL correctly grouped by `i.currency`, and the loop then threw the
 * grouping away — `pendingMinor += amt` / `paidMinor += amt` over EVERY
 * currency — and returned `{ pendingMinor, paidMinor, currency: "USD",
 * mixed: true }`. The "USD" was a default, not a fact: JPY minor units were
 * summed into it and the partner-billing page rendered the result as dollars.
 * The comment above this function already said not to do this. The code did it
 * anyway, and a `mixed` flag was treated as sufficient mitigation. It is not:
 * a warning does not make invalid arithmetic valid.
 *
 * NOW: totals are per-currency (`byCurrency`, and `byKind[kind].byCurrency`).
 * `pendingMinor`/`paidMinor`/`currency` are still present for callers, but are
 * `null` whenever more than one currency is involved, and `pending`/`paid` are
 * explicit `MoneyScalar`s the UI must branch on. Nothing is ever stamped
 * "USD" unless USD is the only currency present.
 * ============================================================
 */
export function commissionPositionByKind(partnerId: string): {
  /** null when `mixed` — never a cross-currency sum. */
  pendingMinor: number | null;
  paidMinor: number | null;
  /** null when `mixed` — never a fabricated default. */
  currency: string | null;
  mixed: boolean;
  /** Explicit renderable state; authoritative over the scalars above. */
  pending: MoneyScalar;
  paid: MoneyScalar;
  /** Authoritative per-currency breakdown. */
  byCurrency: Array<{ currency: string; pendingMinor: number; paidMinor: number }>;
  currencies: string[];
  byKind: Record<string, {
    pendingMinor: number | null;
    paidMinor: number | null;
    byCurrency: Array<{ currency: string; pendingMinor: number; paidMinor: number }>;
  }>;
} {
  const rows = db()
    .prepare(
      `SELECT l.entry_kind AS k, l.settlement_state AS s, i.currency AS c, SUM(l.amount_minor) AS t
         FROM partner_invoice_line l
         JOIN partner_invoice i ON i.id = l.invoice_id
        WHERE i.partner_id = ?
        GROUP BY l.entry_kind, l.settlement_state, i.currency`,
    )
    .all(partnerId) as Array<{ k: string; s: string; c: string; t: number }>;

  // WAVE 21 · ITEM 2 — every accumulator below is keyed BY CURRENCY.
  const pendingBuckets: CurrencyBuckets = {};
  const paidBuckets: CurrencyBuckets = {};
  const kindBuckets: Record<string, { pending: CurrencyBuckets; paid: CurrencyBuckets }> = {};
  for (const kind of BILLING_ENTRY_KINDS) kindBuckets[kind] = { pending: {}, paid: {} };
  const currencies = new Set<string>();

  for (const r of rows) {
    const cur = normalizeCurrency(r.c) || "USD";
    currencies.add(cur);
    const bucket = kindBuckets[r.k] ?? (kindBuckets[r.k] = { pending: {}, paid: {} });
    const amt = Number(r.t ?? 0);
    if (r.s === "paid") {
      addToBucket(bucket.paid, cur, amt);
      addToBucket(paidBuckets, cur, amt);
    } else if (r.s === "pending") {
      addToBucket(bucket.pending, cur, amt);
      addToBucket(pendingBuckets, cur, amt);
    }
    // 'waived' and 'failed' are deliberately in NEITHER total: a waived fee is
    // not owed and a failed one is not settled. They remain visible on the
    // invoice itself, so nothing is dropped — only kept out of these two sums.
  }

  const currencyKeys = Array.from(
    new Set([...Object.keys(pendingBuckets), ...Object.keys(paidBuckets)]),
  ).sort();
  const byCurrency = currencyKeys.map((currency) => ({
    currency,
    pendingMinor: pendingBuckets[currency] ?? 0,
    paidMinor: paidBuckets[currency] ?? 0,
  }));

  // Only collapse to a scalar when the WHOLE position is one currency. When
  // there are no lines at all, 0 is 0 in every currency, so a USD zero is
  // honest — but only then.
  const oneCurrency = currencies.size <= 1;
  const soleCurrency = currencies.size === 1 ? Array.from(currencies)[0]! : "USD";
  const pending: MoneyScalar = oneCurrency
    ? { available: true, currency: soleCurrency, minor: pendingBuckets[soleCurrency] ?? 0 }
    : {
        available: false, currency: null, minor: null,
        reason: "needs_fx_conversion", currencies: Array.from(currencies).sort(),
      };
  const paid: MoneyScalar = oneCurrency
    ? { available: true, currency: soleCurrency, minor: paidBuckets[soleCurrency] ?? 0 }
    : {
        available: false, currency: null, minor: null,
        reason: "needs_fx_conversion", currencies: Array.from(currencies).sort(),
      };

  const byKind: Record<string, {
    pendingMinor: number | null;
    paidMinor: number | null;
    byCurrency: Array<{ currency: string; pendingMinor: number; paidMinor: number }>;
  }> = {};
  for (const [kind, b] of Object.entries(kindBuckets)) {
    const keys = Array.from(new Set([...Object.keys(b.pending), ...Object.keys(b.paid)])).sort();
    const p = singleCurrencyScalar(b.pending, oneCurrency ? soleCurrency : undefined);
    const q = singleCurrencyScalar(b.paid, oneCurrency ? soleCurrency : undefined);
    byKind[kind] = {
      pendingMinor: p.available ? p.minor : null,
      paidMinor: q.available ? q.minor : null,
      byCurrency: keys.map((currency) => ({
        currency,
        pendingMinor: b.pending[currency] ?? 0,
        paidMinor: b.paid[currency] ?? 0,
      })),
    };
  }

  return {
    pendingMinor: pending.available ? pending.minor : null,
    paidMinor: paid.available ? paid.minor : null,
    // NEVER a fabricated "USD" over mixed lines — null instead.
    currency: oneCurrency ? soleCurrency : null,
    mixed: currencies.size > 1,
    pending,
    paid,
    byCurrency,
    currencies: Array.from(currencies).sort(),
    byKind,
  };
}
