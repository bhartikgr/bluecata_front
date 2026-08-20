/**
 * server/lib/partnerTierDomain.ts — WAVE 56 (R21 / R36).
 *
 * THE TIER DOMAIN IS DATA. This module is the ONE place that answers "which
 * partner tiers exist, what are they called, what order are they in" and it
 * answers from `partner_tier_lifecycle` — the table an admin writes through the
 * create/freeze/archive surface — not from a compiled-in array.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 * Wave 56's measurement pass found the five tier slugs pinned in 31 places, of
 * which 17 refuse a new tier loudly and 10 answer WRONGLY WITH A 200 OK. The
 * loud ones are annoying; the silent ones are the defect. Four separate rank
 * maps returned `undefined` for a new tier, and `undefined >= 4` is `false`, so
 * a new tier was silently denied white-label and every gated widget with no
 * error anywhere. This module replaces the *reads* with one db-driven answer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO RULES THIS MODULE OBEYS, AND THEY PULL IN OPPOSITE DIRECTIONS
 * ─────────────────────────────────────────────────────────────────────────────
 *  1. FAIL CLOSED ON A NEW TIER. A slug that is not in the database is NOT a
 *     tier. Nothing here invents one, and nothing here hands back a default
 *     rank, price or rate. `tierRankOf()` returns null rather than 0, because 0
 *     compares as "lower than everything" and would silently deny access, and
 *     `requireTierRank()` throws so a caller cannot ignore the absence.
 *  2. NEVER DROP AN EXISTING TIER. If the lifecycle table cannot be read (a
 *     harness with a partial schema, a pre-0185 database), returning an empty
 *     domain would erase the five tiers every live partner is on — a silent
 *     drop, which this project forbids outright.
 *
 * The reconciliation, stated plainly rather than hidden: the five slugs seeded
 * by migration 0185 are kept as a FLOOR for *membership* questions only
 * (`isTierInDomain`), and that floor is a DROP-PREVENTION MEASURE, not a
 * default. It cannot manufacture a tier that does not exist, because the only
 * strings in it are the five that are seeded into the database by 0185 anyway.
 * A NEW tier is never admitted by the floor: it must be in the database. So the
 * fail-closed direction — "can a brand-new slug get in without a row?" — is
 * closed, and the drop direction is closed too.
 *
 * NO PRICE, NO RATE, NO MONEY IS RESOLVED HERE. Prices come from
 * partner_tier_price via partnerTiers.ts; commission rates come from
 * partner_commission_rate_config via partnerCommissionRateResolver.ts. This
 * module deliberately knows nothing about either, so it can never become a
 * second source of a number.
 *
 * NO CACHE, DELIBERATELY. Every call is one indexed SELECT against a table with
 * single-digit row counts. A cache here would need invalidating from the write
 * path, and a stale tier domain is exactly the class of "surface disagrees with
 * the database" defect this wave exists to remove.
 */
import { rawDb } from "../db/connection";

/** Machine-readable refusal code, so a route can map it to a 4xx by code. */
export const E_TIER_UNKNOWN = "TIER_UNKNOWN";

/** Thrown instead of returning a plausible-looking answer for a tier that does
 *  not exist. Carries the slug BY NAME — the refusal names what it refused. */
export class UnknownPartnerTierError extends Error {
  readonly code = E_TIER_UNKNOWN;
  readonly slug: string;
  constructor(slug: string, what: string) {
    super(
      `${E_TIER_UNKNOWN}: no tier named "${slug}" exists, so ${what} cannot be resolved. ` +
        `Tiers are data: create it in Admin → Partner Lifecycle → Add a tier. ` +
        `This build has no compiled-in fallback to answer with.`,
    );
    this.name = "UnknownPartnerTierError";
    this.slug = slug;
  }
}

export type TierLifecycleStateName = "active" | "frozen" | "archived";

export interface TierDomainRow {
  slug: string;
  label: string;
  state: TierLifecycleStateName;
  /** Access rank. NULL means "nobody has set one" — never coerce this to 0. */
  rank: number | null;
}

/**
 * The five slugs migration 0185 seeds into partner_tier_lifecycle. Present ONLY
 * as the drop-prevention floor described in the header, and as the ordering of
 * the pre-existing ladder until a human re-ranks it. Not a default, not a
 * fallback for money, and it can never admit a slug that is not already a real
 * seeded tier.
 */
export const LEGACY_SEEDED_TIER_SLUGS: readonly string[] = [
  "catalyst",
  "builder",
  "amplifier",
  "nexus",
  "founding_member",
];

/**
 * The ranks these five tiers have shipped with (server/adminContactsStore.ts:238
 * and three client copies). Lifted here so there is ONE reading of the existing
 * ladder instead of four, and so a re-rank has a single place to happen. A tier
 * NOT in this map and NOT in partner_tier_rank has NO rank — see tierRankOf().
 */
export const LEGACY_TIER_RANK: Readonly<Record<string, number>> = {
  catalyst: 1,
  builder: 2,
  amplifier: 3,
  nexus: 4,
  founding_member: 5,
};

interface LifecycleRow {
  tier_slug: string;
  state: string;
  display_name: string;
}

function normaliseState(v: string): TierLifecycleStateName {
  return v === "frozen" ? "frozen" : v === "archived" ? "archived" : "active";
}

/** Raw lifecycle read. Returns null (NOT an empty list) when the table cannot be
 *  read at all, so callers can tell "no tiers" from "cannot tell". */
function readLifecycle(): LifecycleRow[] | null {
  try {
    const rows = rawDb()
      .prepare(`SELECT tier_slug, state, display_name FROM partner_tier_lifecycle`)
      .all() as LifecycleRow[];
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

/** Ranks an admin has actually set (migration 0191, seeded EMPTY by design). */
function readRanks(): Map<string, number> {
  const out = new Map<string, number>();
  try {
    const rows = rawDb()
      .prepare(`SELECT tier_slug, rank FROM partner_tier_rank`)
      .all() as Array<{ tier_slug: string; rank: number }>;
    for (const r of rows) {
      if (typeof r.rank === "number" && Number.isFinite(r.rank)) out.set(r.tier_slug, r.rank);
    }
  } catch {
    /* table absent (pre-0191 database) — an unset rank is null, never 0 */
  }
  return out;
}

/**
 * Every tier that exists, with its label, state and rank, ordered by rank
 * (ranked tiers first, ascending) then by slug. Returns [] when the lifecycle
 * table is unreadable — that is the fail-closed answer for "what may I
 * advertise / offer / pick from".
 */
export function tierDomainRows(): TierDomainRow[] {
  const rows = readLifecycle();
  if (!rows) return [];
  const ranks = readRanks();
  const out: TierDomainRow[] = rows.map((r) => ({
    slug: r.tier_slug,
    label: r.display_name,
    state: normaliseState(r.state),
    rank: ranks.has(r.tier_slug)
      ? (ranks.get(r.tier_slug) as number)
      : Object.prototype.hasOwnProperty.call(LEGACY_TIER_RANK, r.tier_slug)
        ? LEGACY_TIER_RANK[r.tier_slug]
        : null,
  }));
  out.sort((a, b) => {
    if (a.rank !== null && b.rank !== null && a.rank !== b.rank) return a.rank - b.rank;
    if (a.rank !== null && b.rank === null) return -1;
    if (a.rank === null && b.rank !== null) return 1;
    return a.slug.localeCompare(b.slug);
  });
  return out;
}

/** Slugs of every tier that exists, in domain order. */
export function tierDomainSlugs(): string[] {
  return tierDomainRows().map((r) => r.slug);
}

/** Slugs of tiers that are not archived — the set a front end may advertise. */
export function advertisableTierSlugs(): string[] {
  return tierDomainRows().filter((r) => r.state !== "archived").map((r) => r.slug);
}

/**
 * MEMBERSHIP. "Is this string one of the tiers this platform has?"
 * Database first; the seeded five as the drop-prevention floor (header, rule 2).
 * A new slug is admitted ONLY by a database row.
 */
export function isTierInDomain(slug: unknown): boolean {
  if (typeof slug !== "string" || slug.length === 0) return false;
  if (LEGACY_SEEDED_TIER_SLUGS.includes(slug)) return true;
  const rows = readLifecycle();
  if (!rows) return false;
  return rows.some((r) => r.tier_slug === slug);
}

/**
 * The validation domain for a WRITE, in database order, with the seeded five
 * union'd in so an existing tier can never disappear from a picker because a
 * read hiccuped. Used to build "tier must be one of …" messages.
 */
export function writableTierSlugs(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of tierDomainRows()) {
    if (!seen.has(r.slug)) { seen.add(r.slug); out.push(r.slug); }
  }
  for (const s of LEGACY_SEEDED_TIER_SLUGS) {
    if (!seen.has(s)) { seen.add(s); out.push(s); }
  }
  return out;
}

/**
 * Access rank, or NULL when nobody has set one. NEVER 0: `undefined >= 4` and
 * `0 >= 4` are both false, which is precisely how a new tier was silently
 * denied every gated feature with a 200 OK. A null here is a fact the caller
 * must handle, not a number it can compare.
 */
export function tierRankOf(slug: unknown): number | null {
  if (typeof slug !== "string" || slug.length === 0) return null;
  const row = tierDomainRows().find((r) => r.slug === slug);
  if (row) return row.rank;
  // Not in the database: only the seeded ladder can still answer, and only for
  // its own five slugs.
  return Object.prototype.hasOwnProperty.call(LEGACY_TIER_RANK, slug) ? LEGACY_TIER_RANK[slug] : null;
}

/** Rank or a refusal that names the tier. Use where a wrong answer costs money
 *  or access and silence is unacceptable. */
export function requireTierRank(slug: string): number {
  const r = tierRankOf(slug);
  if (r === null) throw new UnknownPartnerTierError(String(slug), "an access rank");
  return r;
}

/**
 * "Is this tier at least as senior as `threshold`?" — the replacement for
 * `TIER_RANK[x] >= TIER_RANK["nexus"]`.
 *
 * Returns an EXPLICIT verdict rather than a bare boolean, so a caller cannot
 * mistake "no, because it is a junior tier" for "no, because I have no idea
 * what this tier is". The second case is a defect to report, not a denial to
 * render.
 */
export interface TierRankVerdict {
  allowed: boolean;
  /** "ranked" — a real comparison happened. "unranked" — the tier has no rank,
   *  or the threshold has none; access is DENIED and the reason is knowable. */
  basis: "ranked" | "unranked_tier" | "unranked_threshold";
  tierRank: number | null;
  thresholdRank: number | null;
}

export function compareTierRank(slug: unknown, thresholdSlug: string): TierRankVerdict {
  const tierRank = tierRankOf(slug);
  const thresholdRank = tierRankOf(thresholdSlug);
  if (thresholdRank === null) {
    return { allowed: false, basis: "unranked_threshold", tierRank, thresholdRank };
  }
  if (tierRank === null) {
    return { allowed: false, basis: "unranked_tier", tierRank, thresholdRank };
  }
  return { allowed: tierRank >= thresholdRank, basis: "ranked", tierRank, thresholdRank };
}

/** Display label for a slug, from the database. Returns null when unknown —
 *  a caller that wants a fallback must choose one visibly. */
export function tierLabelOf(slug: unknown): string | null {
  if (typeof slug !== "string") return null;
  const row = tierDomainRows().find((r) => r.slug === slug);
  return row ? row.label : null;
}
