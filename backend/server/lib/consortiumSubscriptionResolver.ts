/**
 * v25.46.1 — Consortium Partner subscription resolver (DB-driven, read-only).
 *
 * APD-018. Modeled on server/lib/canonicalPlanResolver.ts: a single,
 * dependency-light projection that is the ONE canonical read path for the
 * Consortium Partner subscription-tier catalog. UI and billing surfaces (when
 * they land — deferred to v25.47, registered as an open item in the fix log)
 * MUST read the partner-tier catalog through here rather than re-deriving keys
 * or hardcoding amounts.
 *
 * Source of truth: the recurring `consortium.subscription.*` rows in
 * platform_fees, read via the generic server/subscriptionTierStore.ts (which is
 * itself DB-direct, soft-delete aware, zero in-memory). This resolver adds NO
 * state of its own.
 *
 * Tier-isolation (Sacred Tier 9 / UPDATED Rule 77): scoped to the
 * consortium.subscription.* family only. SEPARATE / PARALLEL to the Capavate
 * founder/investor flow (Sacred Rule 76): it never touches
 * capavate_subscriptions, pricing tiers, paymentGatewayAdapter, or
 * canonicalPlanResolver — exactly like canonicalPlanResolver deliberately avoids
 * multiCompanyStore/paymentGatewayAdapter to dodge circular-import bugs.
 */
import {
  listTiers,
  getTier,
  CONSORTIUM_SUBSCRIPTION_PREFIX,
  type SubscriptionTier,
} from "../subscriptionTierStore";
import { log } from "./logger";

export interface ResolvedSubscriptionTier {
  /** Slug only, e.g. "partner_pro". */
  slug: string;
  /** Full platform_fees key, e.g. "consortium.subscription.partner_pro". */
  key: string;
  amountMinor: number;
  currency: string;
  billingPeriod: string;
}

function project(t: SubscriptionTier): ResolvedSubscriptionTier {
  return {
    slug: t.slug,
    key: t.key,
    amountMinor: t.amountMinor,
    currency: t.currency,
    billingPeriod: t.billingPeriod,
  };
}

/** Resolve the full LIVE Consortium Partner subscription catalog (ordered). */
export function resolveConsortiumSubscriptionTiers(): ResolvedSubscriptionTier[] {
  try {
    return listTiers(CONSORTIUM_SUBSCRIPTION_PREFIX).map(project);
  } catch (err) {
    log.warn(
      "[consortiumSubscriptionResolver] catalog read failed:",
      (err as Error).message,
    );
    return [];
  }
}

/** Resolve one Consortium Partner tier by slug. Null when missing/soft-deleted. */
export function resolveConsortiumSubscriptionTier(
  slug: string,
): ResolvedSubscriptionTier | null {
  try {
    const t = getTier(CONSORTIUM_SUBSCRIPTION_PREFIX, slug);
    return t ? project(t) : null;
  } catch (err) {
    log.warn(
      "[consortiumSubscriptionResolver] tier read failed:",
      (err as Error).message,
    );
    return null;
  }
}
