/**
 * v25.46.1 — Collective Cap Table Investor Membership subscription resolver
 * (DB-driven, read-only).
 *
 * APD-018. Modeled on server/lib/canonicalPlanResolver.ts: a single,
 * dependency-light projection that is the ONE canonical read path for the
 * Collective Cap Table Investor Membership subscription-tier catalog (Section B
 * of the Collective fee tab). UI / billing surfaces (deferred to v25.47,
 * registered as an open item in the fix log) MUST read through here rather than
 * re-deriving keys or hardcoding amounts.
 *
 * Source of truth: the recurring `collective.member_subscription.*` rows in
 * platform_fees, read via the generic server/subscriptionTierStore.ts. This
 * resolver adds NO state of its own.
 *
 * Tier-isolation (Sacred Tier 9 / UPDATED Rule 77): scoped to the
 * collective.member_subscription.* family only — it does NOT read the flat
 * collective_application_fee (Section A, owned by
 * collectiveApplicationFeeResolver.ts) nor any Consortium key. SEPARATE /
 * PARALLEL to the Capavate founder/investor flow (Sacred Rule 76).
 */
import {
  listTiers,
  getTier,
  COLLECTIVE_MEMBER_SUBSCRIPTION_PREFIX,
  type SubscriptionTier,
} from "../subscriptionTierStore";
import { log } from "./logger";

export interface ResolvedMemberSubscriptionTier {
  /** Slug only, e.g. "pro". */
  slug: string;
  /** Full platform_fees key, e.g. "collective.member_subscription.pro". */
  key: string;
  amountMinor: number;
  currency: string;
  billingPeriod: string;
}

function project(t: SubscriptionTier): ResolvedMemberSubscriptionTier {
  return {
    slug: t.slug,
    key: t.key,
    amountMinor: t.amountMinor,
    currency: t.currency,
    billingPeriod: t.billingPeriod,
  };
}

/** Resolve the full LIVE Collective member-subscription catalog (ordered). */
export function resolveCollectiveMemberSubscriptionTiers(): ResolvedMemberSubscriptionTier[] {
  try {
    return listTiers(COLLECTIVE_MEMBER_SUBSCRIPTION_PREFIX).map(project);
  } catch (err) {
    log.warn(
      "[collectiveMemberSubscriptionResolver] catalog read failed:",
      (err as Error).message,
    );
    return [];
  }
}

/** Resolve one Collective member-subscription tier by slug. Null when missing. */
export function resolveCollectiveMemberSubscriptionTier(
  slug: string,
): ResolvedMemberSubscriptionTier | null {
  try {
    const t = getTier(COLLECTIVE_MEMBER_SUBSCRIPTION_PREFIX, slug);
    return t ? project(t) : null;
  } catch (err) {
    log.warn(
      "[collectiveMemberSubscriptionResolver] tier read failed:",
      (err as Error).message,
    );
    return null;
  }
}
