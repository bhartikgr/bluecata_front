/**
 * v25.47 APD-030 (HIGH-11) — Consortium Partner 5-tier taxonomy.
 *
 * The Consortium Partner subscription expanded from a legacy 3-tier ladder
 * (partner_basic/pro/enterprise) to the canonical 5-tier taxonomy:
 *
 *   catalyst         $499/mo   (49900)
 *   builder          $999/mo   (99900)
 *   amplifier        $1,499/mo (149900)
 *   nexus            $4,999/mo (499900)
 *   founding_member  $0/mo     (0)   — invite-only
 *
 * Legacy rows are PRESERVED in platform_fees (deprecated in code only). This
 * module owns the canonical tier ORDER + metadata; amounts are DB-resolved via
 * subscriptionTierStore (no hardcoded prices leak into the read path — the
 * literals here are seed fallbacks only).
 *
 * SEPARATE/PARALLEL to the Capavate founder/investor flow (Rule 76): reads ONLY
 * platform_fees via subscriptionTierStore.
 */
import {
  CONSORTIUM_SUBSCRIPTION_PREFIX,
  getTier,
} from "../subscriptionTierStore";

export interface PartnerTierDef {
  slug: string;
  label: string;
  /** Seed fallback amount (TRUE minor units) — DB row is authoritative. */
  fallbackMinor: number;
  inviteOnly: boolean;
}

/** Canonical tier order (drives pricing-page ordering). */
export const PARTNER_TIERS: readonly PartnerTierDef[] = [
  { slug: "catalyst", label: "Catalyst", fallbackMinor: 49900, inviteOnly: false },
  { slug: "builder", label: "Builder", fallbackMinor: 99900, inviteOnly: false },
  { slug: "amplifier", label: "Amplifier", fallbackMinor: 149900, inviteOnly: false },
  { slug: "nexus", label: "Nexus", fallbackMinor: 499900, inviteOnly: false },
  { slug: "founding_member", label: "Founding Member", fallbackMinor: 0, inviteOnly: true },
];

const CANONICAL_SLUGS = new Set(PARTNER_TIERS.map((t) => t.slug));

/** Legacy → canonical slug mapping (deprecated partner_* slugs). */
const LEGACY_PARTNER_SLUG_MAP: Record<string, string> = {
  partner_basic: "catalyst",
  partner_pro: "builder",
  partner_enterprise: "amplifier",
  basic: "catalyst",
  pro: "builder",
  enterprise: "amplifier",
};

/**
 * Map a partner tier slug (legacy or current) to its canonical slug. Returns
 * null when the slug is unknown (not a canonical tier and not a known legacy
 * alias) so callers can fail closed.
 */
export function resolvePartnerTierSlug(slug: unknown): string | null {
  if (typeof slug !== "string") return null;
  const s = slug.trim().toLowerCase();
  if (CANONICAL_SLUGS.has(s)) return s;
  return LEGACY_PARTNER_SLUG_MAP[s] ?? null;
}

export interface ResolvedPartnerTier {
  slug: string;
  label: string;
  amountMinor: number;
  currency: string;
  billingPeriod: string;
  inviteOnly: boolean;
  /** True when a live DB row backed the amount; false on seed fallback. */
  fromDb: boolean;
}

/**
 * Resolve the full canonical 5-tier pricing, in canonical order. Each tier's
 * amount is read from platform_fees; missing rows fall back to the seed amount
 * so the pricing page always renders all five tiers.
 */
export function resolveConsortiumPricing(): ResolvedPartnerTier[] {
  return PARTNER_TIERS.map((def) => {
    const row = getTier(CONSORTIUM_SUBSCRIPTION_PREFIX, def.slug);
    return {
      slug: def.slug,
      label: def.label,
      amountMinor: row ? row.amountMinor : def.fallbackMinor,
      currency: row ? row.currency : "USD",
      billingPeriod: row ? row.billingPeriod : "monthly",
      inviteOnly: def.inviteOnly,
      fromDb: Boolean(row),
    };
  });
}
