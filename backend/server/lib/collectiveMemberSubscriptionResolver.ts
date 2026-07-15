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
// W5.3 — SINGLE SOURCE OF TRUTH. The W4 admin-authored catalog
// (collective_subscription_configs) is now the canonical source for the member
// subscription tier. We prefer a W4 live published package here; the legacy
// platform_fees rows below are the FALLBACK only (kept so no deploy is bricked
// before an admin publishes a package). Static import (ESM; no runtime require
// of a .ts module) — no import cycle: the W4 store imports only
// airwallexCollective / db / logger, never this resolver.
import * as w4Store from "../collectiveSubscriptionConfigStore";
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

/* ---------------------------------------------------------------------------
 * v25.47 APD-019 / APD-032(B) — single canonical member tier.
 *
 * The Collective membership ladder has collapsed to ONE canonical recurring
 * tier: collective.member_subscription.standard ($249/mo == 24900 minor).
 * Legacy basic/pro/enterprise rows are PRESERVED in platform_fees (deprecated
 * in code only). The functions below are the canonical read path for the
 * single-tier membership surface; legacy slugs map onto `standard`.
 * ------------------------------------------------------------------------- */

/** The one canonical member tier slug. */
export const CANONICAL_MEMBER_TIER_SLUG = "standard";

/** Legacy slugs that all collapse onto the canonical `standard` tier. */
const LEGACY_MEMBER_TIER_SLUGS = new Set(["basic", "pro", "enterprise"]);

/** Seed fallback amount if the row is somehow absent (matches connection.ts). */
const CANONICAL_MEMBER_FALLBACK_MINOR = 24900;

export interface CanonicalMemberTier extends ResolvedMemberSubscriptionTier {
  /** True when a live DB row backed this result; false on seed fallback. */
  fromDb: boolean;
  /** W5.3 — which source of truth backed this result. */
  source?: "admin" | "platform_fees" | "seed_fallback";
}

/**
 * Map any tier slug (legacy or current) onto the canonical `standard` slug.
 * Unknown/empty input also collapses to `standard` — there is only one tier.
 */
export function resolveCanonicalMemberTierSlug(slug: unknown): string {
  if (typeof slug === "string") {
    const s = slug.trim().toLowerCase();
    if (s === CANONICAL_MEMBER_TIER_SLUG || LEGACY_MEMBER_TIER_SLUGS.has(s)) {
      return CANONICAL_MEMBER_TIER_SLUG;
    }
  }
  return CANONICAL_MEMBER_TIER_SLUG;
}

/**
 * Resolve the single canonical member tier from the DB. Always returns a tier
 * (never null) — falls back to the canonical seed amount if the row is missing
 * so the membership surface can always render.
 */
export function resolveCanonicalMemberTier(): CanonicalMemberTier {
  // W5.3 — PREFER the W4 live admin catalog (single source of truth). Project the
  // first live published package (lowest sortOrder) onto the canonical member-tier
  // shape. `interval` maps to a legacy billingPeriod string. On any error or when
  // no package is live, fall through to the legacy platform_fees resolver.
  try {
    const live = w4Store.listPublishedPackages();
    if (live.length > 0) {
      const p = [...live].sort((a, b) => a.sortOrder - b.sortOrder)[0];
      const billingPeriod =
        p.interval === "monthly" ? "monthly"
        : p.interval === "annual" ? "yearly"
        : p.interval === "quarterly" ? "quarterly"
        : p.interval === "one_time" ? "one_time"
        : "monthly";
      return {
        slug: p.slug,
        key: `${COLLECTIVE_MEMBER_SUBSCRIPTION_PREFIX}${p.airwallexTier}`,
        amountMinor: p.amountMinor,
        currency: p.currency,
        billingPeriod,
        fromDb: true,
        source: "admin",
      };
    }
  } catch (err) {
    log.warn(
      "[collectiveMemberSubscriptionResolver] W4 live-package read failed, using platform_fees fallback:",
      (err as Error).message,
    );
  }

  const t = resolveCollectiveMemberSubscriptionTier(CANONICAL_MEMBER_TIER_SLUG);
  if (t) return { ...t, fromDb: true, source: "platform_fees" };
  return {
    slug: CANONICAL_MEMBER_TIER_SLUG,
    key: `${COLLECTIVE_MEMBER_SUBSCRIPTION_PREFIX}${CANONICAL_MEMBER_TIER_SLUG}`,
    amountMinor: CANONICAL_MEMBER_FALLBACK_MINOR,
    currency: "USD",
    billingPeriod: "monthly",
    fromDb: false,
    source: "seed_fallback",
  };
}
