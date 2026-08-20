/**
 * Consortium Partner tier taxonomy — IDENTITY here, PRICE in the database.
 *
 * ORIGINALLY v25.47 APD-030 (HIGH-11): the five-tier ladder
 *   catalyst / builder / amplifier / nexus / founding_member.
 *
 * ── WAVE 45 (owner ruling R3, 2026-08-13) ────────────────────────────────────
 *
 * WHAT CHANGED, AND WHY IT MATTERED
 *   This module used to carry `fallbackMinor` — literal prices 49900 / 99900 /
 *   149900 / 499900 / 0 — and `resolveConsortiumPricing()` returned them
 *   whenever the DB tier list came back empty. Because the DB read is
 *   fail-closed (any error yields an empty list), a transient database problem
 *   did not surface as an error: it silently QUOTED $499/mo from a compiled-in
 *   constant. A price nobody could see, edit or audit could reach a customer.
 *
 *   R3 forbids that outright: THE DATABASE IS THE ONLY SOURCE OF A PRICE. If no
 *   priced row resolves, this module REFUSES and says so. There is no longer any
 *   number in this file that a price read could return — the literals are gone
 *   rather than merely unused, so no future edit can reach for them.
 *
 * WHAT THIS MODULE STILL OWNS
 *   Tier IDENTITY only: the canonical slug set, their display order, their
 *   labels, and which are invite-only. None of those are money. Identity in code
 *   and price in data is the whole point of R3 — the five tiers became CAPABILITY
 *   levels, so their price is no longer what distinguishes them.
 *
 * WHERE THE PRICE COMES FROM NOW
 *   `partner_tier_price` (migration 0153, priced for the authoritative slugs by
 *   migration 0185): cadence 'annual', active, `derivation='admin_set'`. That is
 *   the same row the subscription charge path reads, so ADVERTISED == CHARGED is
 *   preserved by construction rather than by two code paths agreeing by luck.
 *   Under R3 the platform is annual-only at a flat $240.00/yr; the retired
 *   monthly rows and the legacy `platform_fees` ladder are both left in place so
 *   that reverting to tiered and/or monthly pricing is a CONFIGURATION change
 *   (`partner_pricing_model_config`), not a rewrite.
 *
 * ARCHIVED AND FROZEN TIERS
 *   `partner_tier_lifecycle` gives three states. An ARCHIVED tier is omitted
 *   from the advertised surface but still resolves its name and price for
 *   historical invoices — which is why `resolveTierIdentity()` and
 *   `resolveHistoricalTier()` exist separately from `resolveConsortiumPricing()`.
 *   A FROZEN tier stays visible but is not purchasable.
 *
 * MONEY
 *   Integer minor units throughout. No `/100` or `*100` appears in this file.
 *
 * SEPARATE/PARALLEL to the Capavate founder/investor flow (Rule 76).
 */
import { wave45Db } from "./applyWave45PricingSchema";
import { ensureWave50MoneyDefectSchema } from "./applyWave50MoneyDefectSchema";
/* WAVE 56 (R21/R36) — the tier domain is DATA. See partnerTierDomain.ts. */
import { tierDomainSlugs } from "./partnerTierDomain";

/** Tier IDENTITY metadata. Deliberately carries NO amount — see the header. */
export interface PartnerTierDef {
  slug: string;
  label: string;
  inviteOnly: boolean;
}

/** Canonical tier order (drives pricing-page ordering). Identity, not price. */
export const PARTNER_TIERS: readonly PartnerTierDef[] = [
  { slug: "catalyst", label: "Catalyst", inviteOnly: false },
  { slug: "builder", label: "Builder", inviteOnly: false },
  { slug: "amplifier", label: "Amplifier", inviteOnly: false },
  { slug: "nexus", label: "Nexus", inviteOnly: false },
  { slug: "founding_member", label: "Founding Member", inviteOnly: true },
];

/**
 * WAVE 56 (R21/R36) — CANONICAL MEMBERSHIP IS A DATABASE QUESTION.
 *
 * This used to be a module-level Set built from the five-element PARTNER_TIERS
 * array, and it was the reason a fully created tier could not be BOUGHT:
 * `resolvePartnerTierSlug("bridge")` returned null, so `requireChargeTier()`
 * refused with PARTNER_TIER_PRICE_UNRESOLVED while the public pricing page
 * advertised the tier at its real price. Advertised ≠ charged is the one thing
 * this file's own header says must never happen.
 *
 * It is now a function: the five seeded slugs (so an existing tier can never
 * drop out) union every tier that exists in `partner_tier_lifecycle`. A slug
 * that is in NEITHER is still refused, so the fail-closed direction is intact.
 */
function canonicalSlugs(): Set<string> {
  const out = new Set(PARTNER_TIERS.map((t) => t.slug));
  try {
    for (const slug of tierDomainSlugs()) out.add(slug);
  } catch {
    /* unreadable domain: the seeded five still answer, nothing new is admitted */
  }
  return out;
}

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
  if (canonicalSlugs().has(s)) return s;
  return LEGACY_PARTNER_SLUG_MAP[s] ?? null;
}

/**
 * WAVE 45 — the refusal. Thrown when a price is ASKED FOR and no priced row
 * resolves. It carries the slug and cadence it failed on so the operator is told
 * what to price, rather than being handed a plausible-looking number.
 *
 * This existing, distinguishable error type is what makes "the DB is the only
 * source of a price" observable: the alternative to a real price is an
 * exception, never a constant.
 */
export class PartnerTierPriceUnresolvedError extends Error {
  readonly code = "PARTNER_TIER_PRICE_UNRESOLVED";
  readonly slug: string;
  readonly cadence: string;
  constructor(slug: string, cadence: string, detail: string) {
    super(
      `PARTNER_TIER_PRICE_UNRESOLVED: no priced ${cadence} row resolves for tier "${slug}" (${detail}). ` +
        `A price must come from partner_tier_price; this build has no compiled-in price to fall back on. ` +
        `Set the price in Admin → Partner Billing Ops → Tier Prices.`,
    );
    this.name = "PartnerTierPriceUnresolvedError";
    this.slug = slug;
    this.cadence = cadence;
  }
}

export type TierLifecycleState = "active" | "frozen" | "archived";

export interface ResolvedPartnerTier {
  slug: string;
  label: string;
  amountMinor: number;
  currency: string;
  billingPeriod: string;
  inviteOnly: boolean;
  /**
   * Invariantly true. Retained so existing callers keep compiling and so the
   * guarantee is legible at the call site: if a tier is returned at all, its
   * amount came from a database row. There is no `false` case any more, because
   * the seed-fallback branch that produced it no longer exists.
   */
  fromDb: true;
  /** Three-state lifecycle. Only 'active' tiers are purchasable. */
  lifecycleState: TierLifecycleState;
  /** Provenance of the amount: 'admin_set' is authoritative. */
  derivation: string;
}

/** Metadata lookup for a canonical tier def by slug. */
const PARTNER_TIER_DEF_BY_SLUG = new Map<string, PartnerTierDef>(
  PARTNER_TIERS.map((t) => [t.slug, t]),
);

/** Humanize a slug for a DB tier that has no canonical def. */
function humanizeSlug(slug: string): string {
  return slug
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

interface PriceRow {
  tier_slug: string;
  cadence: string;
  price_minor: number | null;
  currency: string;
  derivation: string;
  active: number;
  /* WAVE 50 · ITEM 3 — migration 0187 §1. Optional on the type because a
   * database that has not yet had 0187 applied genuinely does not have them,
   * and pretending otherwise is how a check ends up checking nothing. */
  free_attested?: number | null;
  free_reason?: string | null;
}

/**
 * The purchasable cadence, read from configuration rather than assumed. R3 is
 * annual-only; flipping `monthly_purchasable` re-opens monthly with no code
 * change, which is what "a configuration change, not a rewrite" requires.
 */
export interface PricingModelConfig {
  model: "flat_annual" | "tiered";
  monthlyPurchasable: boolean;
  annualPurchasable: boolean;
  forbidX12Derivation: boolean;
}

export function readPricingModelConfig(): PricingModelConfig {
  const db = wave45Db();
  const row = db
    .prepare(
      `SELECT model, monthly_purchasable, annual_purchasable, forbid_x12_derivation
         FROM partner_pricing_model_config WHERE id = 'singleton'`,
    )
    .get() as
    | {
        model: string;
        monthly_purchasable: number;
        annual_purchasable: number;
        forbid_x12_derivation: number;
      }
    | undefined;
  // No row is NOT an excuse to invent a permissive default. Absent config means
  // the R3 shipped state: annual only, no x12 derivation.
  if (!row) {
    return {
      model: "flat_annual",
      monthlyPurchasable: false,
      annualPurchasable: true,
      forbidX12Derivation: true,
    };
  }
  return {
    model: row.model === "tiered" ? "tiered" : "flat_annual",
    monthlyPurchasable: row.monthly_purchasable === 1,
    annualPurchasable: row.annual_purchasable === 1,
    forbidX12Derivation: row.forbid_x12_derivation === 1,
  };
}

/** The cadence the platform currently sells. Annual under R3. */
export function purchasableCadences(): string[] {
  const cfg = readPricingModelConfig();
  const out: string[] = [];
  if (cfg.annualPurchasable) out.push("annual");
  if (cfg.monthlyPurchasable) out.push("monthly");
  return out;
}

function lifecycleStates(): Map<string, { state: TierLifecycleState; displayName: string }> {
  const db = wave45Db();
  const out = new Map<string, { state: TierLifecycleState; displayName: string }>();
  let rows: { tier_slug: string; state: string; display_name: string }[] = [];
  try {
    rows = db
      .prepare(`SELECT tier_slug, state, display_name FROM partner_tier_lifecycle`)
      .all() as { tier_slug: string; state: string; display_name: string }[];
  } catch {
    // A missing lifecycle table must not silently promote every tier to
    // purchasable. Returning an empty map makes resolveConsortiumPricing()
    // advertise nothing, which is the fail-closed direction.
    return out;
  }
  for (const r of rows) {
    const state: TierLifecycleState =
      r.state === "frozen" ? "frozen" : r.state === "archived" ? "archived" : "active";
    out.set(r.tier_slug, { state, displayName: r.display_name });
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * WAVE 50 · ITEM 3 — A TIER-LEVEL $0 MUST NOT SILENTLY MAKE PAYING PARTNERS FREE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THE DEFECT. This function's filter was
 *
 *     WHERE cadence = ? AND active = 1 AND price_minor IS NOT NULL
 *
 * which fails closed on NULL and then ACCEPTS `0`. `priceRows()` is the single
 * choke point for every advertised and charged partner price — everything
 * downstream (`resolveConsortiumPricing` -> `resolveChargeTier` /
 * `requireChargeTier` / `assertTierPurchasable` -> `resolvePartnerEffectivePlan`,
 * which reports `effectivePrice.source = "tier_advertised"`) simply trusts
 * whatever comes out. So a single `0` typed into one tier row resolved EVERY
 * partner on that tier to a $0 invoice, defeating R20 and contradicting the
 * documented invariant that "a per-partner explicit $0 override is the ONLY path
 * to a $0 amount".
 *
 * WHY MAGNITUDE CANNOT DECIDE IT. Both positions are already written into this
 * tree's own migrations. 0153, which created the table: "A zero price is a real
 * free tier and must be written as 0, never left NULL." 0185 §3, which seeded it:
 * founding_member is priced 24000 like everyone else because "a free TIER would
 * make every future occupant of that tier free by accident", and the five
 * founding partners are free via per-partner $0 overrides with written reasons
 * (R17). Meanwhile R3 requires a real free tier to stay EXPRESSIBLE. So `0` can
 * be neither banned nor trusted, and `= 0` carries no information about which it
 * is.
 *
 * THE RULE IMPLEMENTED HERE — PROVENANCE, NOT MAGNITUDE:
 *
 *     A `price_minor = 0` row is honoured as a real price ONLY when the row
 *     carries an explicit, durable free attestation: `free_attested = 1` AND a
 *     non-empty `free_reason` (migration 0187 §1). Any other `price_minor = 0`
 *     is MISCONFIGURED and refuses exactly like NULL — omitted from the
 *     advertised catalogue, and `requireChargeTier()` throws naming the tier,
 *     the cadence and the specific reason. Never a silent $0 invoice.
 *
 * This is the same move `derivation` already makes for how a price was arrived
 * at, and the same move R16 makes for a stored `4250`: when a value is ambiguous,
 * resolve it from recorded provenance and never from its magnitude. Attesting a
 * tier free is a deliberate operator act that leaves a written reason behind,
 * which is exactly what R17 demands of a $0 anywhere else in the system.
 *
 * BOTH POLES ARE REAL. A genuinely-free tier still resolves, still advertises at
 * 0, and still charges 0 — a rule that simply rejected every zero would have
 * broken R3's free tier, which is the over-correction this shape avoids.
 *
 * DEGRADED DATABASES FAIL CLOSED, NOT OPEN. If 0187 has not been applied the two
 * columns are absent, no row can possibly be attested, and every `0` is treated
 * as misconfigured. That direction refuses a price that might have been free;
 * the other direction would hand out free subscriptions.
 */
export type TierPriceRejection =
  | { kind: "unattested_zero"; reason: string }
  | { kind: "negative"; reason: string };

export interface TierPriceClassification {
  priced: Map<string, PriceRow>;
  rejected: Map<string, TierPriceRejection>;
}

/** True only for a row that carries a durable, written free attestation. */
export function tierPriceIsAttestedFree(r: PriceRow): boolean {
  return Number(r.free_attested ?? 0) === 1 && String(r.free_reason ?? "").trim().length > 0;
}

/**
 * WAVE 50 · ITEM 3 — why this is exported.
 *
 * `requireChargeTier()` reports the fault in its own message, but the partner
 * APPROVAL path (Wave 47 / R20) resolves prices through `partnerEffectivePlan`,
 * which sees only "no advertised price" and cannot tell a genuinely absent row
 * from a misconfigured `0`. Wave 47 owns a dedicated, louder refusal code for
 * exactly the second case, so it needs the distinction rather than a generic
 * unresolved-price error. This is a read-only lookup: it never mutates and never
 * turns a rejection into a price.
 */
export function tierPriceRejection(slug: string, cadence: string): TierPriceRejection | null {
  const canonical = resolvePartnerTierSlug(slug);
  if (!canonical) return null;
  return classifyPriceRows(cadence).rejected.get(canonical) ?? null;
}

function classifyPriceRows(cadence: string): TierPriceClassification {
  const db = wave45Db();
  const priced = new Map<string, PriceRow>();
  const rejected = new Map<string, TierPriceRejection>();
  // The Wave 50 columns come from 0187, which is not in connection.ts's inline
  // bootstrap (that file is SACRED), so the self-heal installer is what puts them
  // on a `:memory:` test database.
  try {
    ensureWave50MoneyDefectSchema(db as any);
  } catch {
    /* handled by the column probe below */
  }
  let hasAttestation = false;
  try {
    hasAttestation = db
      .prepare(`PRAGMA table_info(partner_tier_price)`)
      .all()
      .some((c: any) => String(c.name) === "free_attested");
  } catch {
    hasAttestation = false;
  }
  let rows: PriceRow[] = [];
  try {
    rows = db
      .prepare(
        `SELECT tier_slug, cadence, price_minor, currency, derivation, active${
          hasAttestation ? ", free_attested, free_reason" : ""
        }
           FROM partner_tier_price
          WHERE cadence = ? AND active = 1 AND price_minor IS NOT NULL`,
      )
      .all(cadence) as PriceRow[];
  } catch {
    return { priced, rejected };
  }
  for (const r of rows) {
    const amount = Number(r.price_minor);
    if (!Number.isFinite(amount) || amount < 0) {
      rejected.set(r.tier_slug, {
        kind: "negative",
        reason: `partner_tier_price.price_minor is ${String(r.price_minor)}, which is not a payable amount`,
      });
      continue;
    }
    if (amount === 0 && !tierPriceIsAttestedFree(r)) {
      rejected.set(r.tier_slug, {
        kind: "unattested_zero",
        reason:
          `partner_tier_price.price_minor is 0 but the row carries no free attestation ` +
          `(free_attested=1 with a written free_reason)` +
          (hasAttestation
            ? `. A tier-level zero without an attestation is treated as MISCONFIGURED, not as a free tier, ` +
              `because it would otherwise make every partner on this tier free. Either set the real price, ` +
              `or attest the tier free with a written reason, or make the individual partner free with a ` +
              `per-partner $0 override (R17).`
            : `, and migration 0187 has not been applied to this database, so no row can be attested free. ` +
              `Apply 0187 and attest the tier deliberately if it is genuinely free.`),
      });
      continue;
    }
    priced.set(r.tier_slug, r);
  }
  return { priced, rejected };
}

function priceRows(cadence: string): Map<string, PriceRow> {
  return classifyPriceRows(cadence).priced;
}

/**
 * The advertised pricing surface. Every amount is a database row; a tier with no
 * priced row is OMITTED rather than shown at an invented price, and an ARCHIVED
 * tier is omitted rather than sold.
 *
 * Returns an EMPTY LIST when nothing is priced. That is deliberate and is the
 * visible form of the refusal on a browse surface: a caller that wants a price
 * for a specific tier must use `requireChargeTier()`, which throws with an
 * explanation. An empty catalogue is an honest "we cannot quote right now"; a
 * catalogue full of compiled-in numbers was the defect R3 removed.
 */
export function resolveConsortiumPricing(): ResolvedPartnerTier[] {
  const cadence = purchasableCadences()[0] ?? "annual";
  const prices = priceRows(cadence);
  const life = lifecycleStates();
  const resolved: ResolvedPartnerTier[] = [];
  const seen = new Set<string>();

  const push = (slug: string, row: PriceRow) => {
    const lc = life.get(slug);
    // Unknown lifecycle → not advertised. Fail closed.
    if (!lc) return;
    if (lc.state === "archived") return; // hidden from the front end by design
    const def = PARTNER_TIER_DEF_BY_SLUG.get(slug);
    resolved.push({
      slug,
      label: def?.label ?? lc.displayName ?? humanizeSlug(slug),
      amountMinor: row.price_minor as number,
      currency: row.currency,
      billingPeriod: cadence,
      inviteOnly: def?.inviteOnly ?? false,
      fromDb: true,
      lifecycleState: lc.state,
      derivation: row.derivation,
    });
    seen.add(slug);
  };

  // 1) Canonical tiers first, in canonical order.
  for (const def of PARTNER_TIERS) {
    const row = prices.get(def.slug);
    if (!row) continue; // unpriced → omitted, never invented
    push(def.slug, row);
  }

  // 2) Any other priced, lifecycle-known tier, appended in slug order, so an
  //    admin-added tier appears without a code change.
  const extras = Array.from(prices.values())
    .filter((r) => !seen.has(r.tier_slug))
    .sort((a, b) => a.tier_slug.localeCompare(b.tier_slug));
  for (const row of extras) push(row.tier_slug, row);

  return resolved;
}

/**
 * Resolve the SINGLE tier row the pricing page advertises for a slug, so the
 * subscribe charge reads the SAME source of truth (advertised == charged).
 * Returns null when the tier is unknown, unpriced, or archived, so the charge
 * path fails closed. Callers wanting the reason should use `requireChargeTier`.
 */
export function resolveChargeTier(slug: unknown): ResolvedPartnerTier | null {
  const canonical = resolvePartnerTierSlug(slug);
  if (!canonical) return null;
  const all = resolveConsortiumPricing();
  return all.find((t) => t.slug === canonical) ?? null;
}

/**
 * Same resolution as `resolveChargeTier`, but THROWS a
 * `PartnerTierPriceUnresolvedError` naming the tier and cadence instead of
 * returning null. Use this on any path that must produce a price: it is what
 * turns "no priced row" into a visible refusal rather than a silent zero or a
 * compiled-in constant.
 */
export function requireChargeTier(slug: unknown): ResolvedPartnerTier {
  const canonical = resolvePartnerTierSlug(slug);
  const cadence = purchasableCadences()[0] ?? "annual";
  if (!canonical) {
    throw new PartnerTierPriceUnresolvedError(
      String(slug ?? "(none)"),
      cadence,
      "slug is not a canonical tier or a known legacy alias",
    );
  }
  const tier = resolveConsortiumPricing().find((t) => t.slug === canonical);
  if (!tier) {
    /* WAVE 50 · ITEM 3 — when the row EXISTS but was rejected, say which fault it
     * is. "No active priced row" would send an admin looking for a missing row
     * while a misconfigured `0` sat in front of them, and a generic message is
     * how a misconfiguration gets rediscovered as a $0 invoice instead. */
    const rejection = classifyPriceRows(cadence).rejected.get(canonical);
    throw new PartnerTierPriceUnresolvedError(
      canonical,
      cadence,
      rejection ? `${rejection.kind}: ${rejection.reason}` : "no active priced row, or the tier is archived",
    );
  }
  return tier;
}

/**
 * A tier is purchasable only when it is ACTIVE. Frozen tiers stay visible and
 * historically resolvable but cannot be bought; archived tiers are not returned
 * by `resolveConsortiumPricing()` at all.
 */
export function assertTierPurchasable(slug: string): ResolvedPartnerTier {
  const tier = requireChargeTier(slug);
  if (tier.lifecycleState !== "active") {
    throw new Error(
      `TIER_NOT_PURCHASABLE: tier "${tier.slug}" is ${tier.lifecycleState} and cannot be purchased. ` +
        `Frozen and archived tiers remain resolvable for existing subscriptions and historical invoices.`,
    );
  }
  return tier;
}

/**
 * HISTORICAL RESOLUTION — name and price for a tier regardless of lifecycle
 * state, including ARCHIVED. An invoice issued years ago must still render the
 * tier it was for; hiding a tier from the catalogue must never orphan its
 * history. Bypasses the archived filter deliberately, and only ever reads the DB.
 */
export function resolveHistoricalTier(
  slug: unknown,
  cadence = "annual",
): {
  slug: string;
  label: string;
  amountMinor: number | null;
  currency: string;
  lifecycleState: TierLifecycleState | "unknown";
  derivation: string | null;
} | null {
  const canonical = resolvePartnerTierSlug(slug);
  if (!canonical) return null;
  const db = wave45Db();
  const life = lifecycleStates().get(canonical);
  let row: PriceRow | undefined;
  try {
    row = db
      .prepare(
        `SELECT tier_slug, cadence, price_minor, currency, derivation, active
           FROM partner_tier_price WHERE tier_slug = ? AND cadence = ?`,
      )
      .get(canonical, cadence) as PriceRow | undefined;
  } catch {
    row = undefined;
  }
  const def = PARTNER_TIER_DEF_BY_SLUG.get(canonical);
  return {
    slug: canonical,
    label: def?.label ?? life?.displayName ?? humanizeSlug(canonical),
    // NULL stays NULL. An unpriced historical row is reported as unpriced, not
    // as zero (R6).
    amountMinor: row?.price_minor ?? null,
    currency: row?.currency ?? "USD",
    lifecycleState: life?.state ?? "unknown",
    derivation: row?.derivation ?? null,
  };
}
