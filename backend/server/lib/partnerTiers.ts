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
  listTiers,
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

/** Metadata lookup for a canonical tier def by slug. */
const PARTNER_TIER_DEF_BY_SLUG = new Map<string, PartnerTierDef>(PARTNER_TIERS.map((t) => [t.slug, t]));

/** Humanize a slug for a DB-added tier that has no canonical def, e.g.
 * "growth_plus" → "Growth Plus". */
function humanizeSlug(slug: string): string {
  return slug
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * v25.48 CP-2a — FULLY DYNAMIC consortium pricing. Resolve the pricing surface
 * by iterating the LIVE DB tiers (subscriptionTierStore.listTiers), NOT the
 * fixed PARTNER_TIERS list:
 *   - Admin SOFT-DELETE hides a tier      → it is absent from listTiers()  → hidden here.
 *   - Admin ADD (upsertTier new slug)     → appears in listTiers()         → shown here.
 *   - Admin REPRICE                        → reflected via the DB amount.
 * label + inviteOnly come from the canonical def metadata when the slug is
 * known; DB-added slugs fall back to a humanized label + inviteOnly=false.
 * Ordering: canonical tiers first (in canonical order), then any extra
 * DB-added tiers appended alphabetically for a stable surface. Fail-closed:
 * on any DB read error, listTiers() returns [] and we fall back to the
 * canonical seed list so the pricing page still renders.
 */
export function resolveConsortiumPricing(): ResolvedPartnerTier[] {
  let dbTiers = listTiers(CONSORTIUM_SUBSCRIPTION_PREFIX);
  // Ignore legacy partner_* rows on the public pricing surface (they are
  // deprecated aliases preserved for back-compat, not advertised tiers).
  dbTiers = dbTiers.filter((t) => !t.slug.startsWith("partner_"));

  // If the DB has no live consortium tiers at all (e.g. a bare DB before the
  // seed ran), fall back to the canonical seed list so the page still renders.
  if (dbTiers.length === 0) {
    return PARTNER_TIERS.map((def) => ({
      slug: def.slug,
      label: def.label,
      amountMinor: def.fallbackMinor,
      currency: "USD",
      billingPeriod: "monthly",
      inviteOnly: def.inviteOnly,
      fromDb: false,
    }));
  }

  const bySlug = new Map(dbTiers.map((t) => [t.slug, t]));
  const resolved: ResolvedPartnerTier[] = [];
  const seen = new Set<string>();

  // 1) Canonical tiers first, in canonical order — but ONLY if still live in DB
  //    (soft-deleted canonical tiers are correctly omitted).
  for (const def of PARTNER_TIERS) {
    const row = bySlug.get(def.slug);
    if (!row) continue; // soft-deleted / absent → hidden
    resolved.push({
      slug: def.slug,
      label: def.label,
      amountMinor: row.amountMinor,
      currency: row.currency,
      billingPeriod: row.billingPeriod,
      inviteOnly: def.inviteOnly,
      fromDb: true,
    });
    seen.add(def.slug);
  }

  // 2) Any DB-added tiers not in the canonical list, appended in slug order.
  const extras = dbTiers
    .filter((t) => !seen.has(t.slug))
    .sort((a, b) => a.slug.localeCompare(b.slug));
  for (const row of extras) {
    const def = PARTNER_TIER_DEF_BY_SLUG.get(row.slug);
    resolved.push({
      slug: row.slug,
      label: def?.label ?? humanizeSlug(row.slug),
      amountMinor: row.amountMinor,
      currency: row.currency,
      billingPeriod: row.billingPeriod,
      inviteOnly: def?.inviteOnly ?? false,
      fromDb: true,
    });
  }

  return resolved;
}

/**
 * v25.48 CP-2b helper — resolve the SINGLE tier row the pricing page advertises
 * for a given slug (canonical or legacy alias), so the subscribe charge can read
 * the SAME source of truth. Returns null when the tier is not live (unknown or
 * soft-deleted) so the charge path can fail closed. Advertised == charged.
 */
export function resolveChargeTier(slug: unknown): ResolvedPartnerTier | null {
  const canonical = resolvePartnerTierSlug(slug);
  if (!canonical) return null;
  const all = resolveConsortiumPricing();
  return all.find((t) => t.slug === canonical) ?? null;
}
