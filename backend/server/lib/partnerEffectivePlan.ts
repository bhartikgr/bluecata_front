/* GROUP C — per-Consortium-Partner dynamic plan/deal engine.
 *
 * resolvePartnerEffectivePlan(partnerId, tier, cycle) composes the partner's
 * EFFECTIVE plan from the EXISTING, already-deployed resolvers — nothing about
 * pricing, commission, or the fee-override model is reimplemented here:
 *
 *   advertisedPrice — resolveChargeTier(tier) (partnerTiers.ts): the SAME tier
 *                     row the PUBLIC /consortium/pricing page advertises
 *                     (advertised == charged). Unchanged, read-only.
 *   effectivePrice  — the per-partner override in contacts.fee_override_json
 *                     (subscription_monthly / subscription_annual), incl. an
 *                     explicit $0, when set; otherwise it falls back to the
 *                     advertised tier price. Override detection reuses
 *                     resolvePartnerFee (partnerFeeResolver.ts) — we take the
 *                     value ONLY when it resolved via 'partner_override', so
 *                     the fee-schedule tier/platform levels never leak into a
 *                     partner's effective subscription price (that stays the
 *                     advertised tier). FAIL-CLOSED: if NEITHER a per-partner
 *                     override NOR an advertised tier resolves, we throw rather
 *                     than silently charging $0 (an explicit $0 override is the
 *                     ONLY way effectivePrice becomes 0).
 *   commissionPct   — resolveCommissionRate(partnerId, tier) (partnerFeeResolver
 *                     .ts): per-partner override → DB tier config → literal
 *                     fallback. Unchanged.
 *   arrangement     — the parsed contacts.arrangement_json (migration 0105):
 *                     subscription model, report-only quota, fixed rev-share.
 *   quotaProgress   — a REPORT-ONLY count of partner-attributed companies
 *                     registered in the current CALENDAR MONTH vs the arrangement
 *                     threshold. Never gates access or changes price.
 *
 * Money is integer minor units throughout. This module is READ-ONLY: it never
 * writes, and it never touches Airwallex / payment code.
 */
import { rawDb } from "../db/connection";
import type { PartnerTier } from "../adminContactsStoreShim";
import { resolveChargeTier } from "./partnerTiers";
import {
  resolvePartnerFee,
  resolveCommissionRate,
  FeeResolutionError,
  type FeeKind,
} from "./partnerFeeResolver";

export type SubscriptionCycle = "monthly" | "annual";

export interface EffectivePrice {
  amountMinor: number;
  currency: string;
  /** 'partner_override' when a per-partner fee_override_json price wins; else 'tier_advertised'. */
  source: "partner_override" | "tier_advertised";
}

export interface PartnerArrangement {
  subscriptionModel?: string | null;
  quota?: {
    metric?: string;
    threshold?: number;
    period?: "monthly";
    enforcement?: "report" | "warn";
  } | null;
  revShare?: {
    enabled?: boolean;
    fixedAmountMinor?: number;
    currency?: string;
    appliesTo?: string;
    source?: string;
  } | null;
  notes?: string | null;
}

export interface QuotaProgress {
  metric: string;
  registeredThisPeriod: number;
  threshold: number | null;
  period: "monthly";
  enforcement: "report" | "warn";
  /** true only when a threshold is configured AND has been reached/exceeded. */
  met: boolean;
}

export interface PartnerEffectivePlan {
  partnerId: string;
  tier: PartnerTier;
  cycle: SubscriptionCycle;
  advertisedPrice: { amountMinor: number; currency: string } | null;
  effectivePrice: EffectivePrice;
  commission: { rate: number; via: string };
  arrangement: PartnerArrangement | null;
  quotaProgress: QuotaProgress;
}

export class EffectivePlanError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "EffectivePlanError";
    this.code = code;
  }
}

/** Read + parse contacts.arrangement_json. Returns null when absent/malformed. */
export function readPartnerArrangement(partnerId: string): PartnerArrangement | null {
  const row = rawDb()
    .prepare(
      `SELECT arrangement_json FROM contacts WHERE id = ? AND kind = 'consortium_partner' AND deleted_at IS NULL`,
    )
    .get(partnerId) as { arrangement_json: string | null } | undefined;
  if (!row || !row.arrangement_json) return null;
  try {
    return JSON.parse(row.arrangement_json) as PartnerArrangement;
  } catch {
    return null;
  }
}

/** UTC calendar-month [start, nextStart) ISO bounds for the given instant. */
function calendarMonthBoundsIso(now: Date): { startIso: string; nextIso: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { startIso: start.toISOString(), nextIso: next.toISOString() };
}

/**
 * Count partner-attributed companies REGISTERED in the current calendar month.
 * Report-only. QUERY over the existing `partner_portfolio_company` table (the
 * partner's attributed companies; company_id aligns with capavate_subscriptions
 * for the rev-share join) — NO new join schema. created_at is the registration
 * instant. Soft-deleted rows are excluded.
 */
export function countRegisteredThisPeriod(partnerId: string, now: Date = new Date()): number {
  const { startIso, nextIso } = calendarMonthBoundsIso(now);
  const row = rawDb()
    .prepare(
      `SELECT COUNT(DISTINCT company_id) AS n
         FROM partner_portfolio_company
        WHERE partner_id = ?
          AND deleted_at IS NULL
          AND created_at >= ?
          AND created_at < ?`,
    )
    .get(partnerId, startIso, nextIso) as { n: number } | undefined;
  return row?.n ?? 0;
}

export interface ResolveEffectivePlanOpts {
  cycle?: SubscriptionCycle;
  /** Override "now" for calendar-month quota counting (tests). */
  now?: Date;
}

/**
 * Compose a partner's effective plan. Fail-closed on price (throws
 * EffectivePlanError when neither an override nor an advertised tier resolves).
 */
export function resolvePartnerEffectivePlan(
  partnerId: string,
  tier: PartnerTier,
  opts: ResolveEffectivePlanOpts = {},
): PartnerEffectivePlan {
  const cycle: SubscriptionCycle = opts.cycle === "annual" ? "annual" : "monthly";
  const feeKind: FeeKind = cycle === "annual" ? "subscription_annual" : "subscription_monthly";

  // Advertised (public) price — the tier row the pricing page shows.
  const advertisedTier = resolveChargeTier(tier);
  const advertisedPrice = advertisedTier
    ? { amountMinor: advertisedTier.amountMinor, currency: advertisedTier.currency }
    : null;

  // Per-partner override detection via the SACRED-adjacent 3-level resolver:
  // we accept its value ONLY when it resolved from the per-partner override,
  // so tier/platform fee-schedule rows never become a partner's effective price.
  let override: { amountMinor: number; currency: string } | null = null;
  try {
    const resolved = resolvePartnerFee(partnerId, tier, feeKind);
    if (resolved.computedVia === "partner_override") {
      override = { amountMinor: resolved.amountMinor, currency: resolved.currency };
    }
  } catch (err) {
    // A pure config gap (no override AND no schedule row) throws here; the
    // advertised tier is still the authoritative fallback below. Any non-fee
    // error is rethrown.
    if (!(err instanceof FeeResolutionError)) throw err;
  }

  let effectivePrice: EffectivePrice;
  if (override) {
    // Explicit per-partner price (incl. $0) supersedes the tier on the
    // partner's OWN view/checkout.
    effectivePrice = { amountMinor: override.amountMinor, currency: override.currency, source: "partner_override" };
  } else if (advertisedPrice) {
    effectivePrice = { amountMinor: advertisedPrice.amountMinor, currency: advertisedPrice.currency, source: "tier_advertised" };
  } else {
    // FAIL-CLOSED: never silently $0 unless an explicit $0 override was set.
    throw new EffectivePlanError(
      "no_effective_price",
      `No effective subscription price for partner='${partnerId}' tier='${tier}' cycle='${cycle}': ` +
        `neither a per-partner override nor an advertised tier price resolved.`,
    );
  }

  const commission = resolveCommissionRate(partnerId, tier);
  const arrangement = readPartnerArrangement(partnerId);

  const quotaCfg = arrangement?.quota ?? null;
  const threshold =
    quotaCfg && typeof quotaCfg.threshold === "number" ? quotaCfg.threshold : null;
  const registeredThisPeriod = countRegisteredThisPeriod(partnerId, opts.now ?? new Date());
  const quotaProgress: QuotaProgress = {
    metric: quotaCfg?.metric ?? "registered_companies",
    registeredThisPeriod,
    threshold,
    period: "monthly",
    enforcement: quotaCfg?.enforcement === "warn" ? "warn" : "report",
    met: threshold !== null && registeredThisPeriod >= threshold,
  };

  return {
    partnerId,
    tier,
    cycle,
    advertisedPrice,
    effectivePrice,
    commission: { rate: commission.rate, via: commission.via },
    arrangement,
    quotaProgress,
  };
}
