/* v25.38 Phase 2 — Partner commission-rate resolver (DB-driven, no in-memory).
 *
 * SACRED RULE served: "Pricing plans are determined from the Admin area. They
 * are never hardcoded." This resolver introduces a DB-driven "go forward" path
 * for partner-tier commission rates.
 *
 * AVI-CODE PRESERVATION (STANDING RULE — verbatim from Ozan):
 *   "Under no circumstances shall any of Avi's existing code be removed (unless
 *    absolutely necessary), modified, or overridden."
 * Avi's literal `COMMISSION_RATE` table in server/partnerConsortiumRoutes.ts is
 * LEFT BYTE-IDENTICAL and remains the ultimate fallback. This resolver is
 * PURELY ADDITIVE: it reads the new `partner_commission_rate_config` table and,
 * only when no DB row exists, falls back to a MIRROR of Avi's literal values
 * (mirrored here — NOT imported — to avoid a circular dependency between
 * partnerConsortiumRoutes.ts and this lib). When the DB row is missing the
 * returned rate equals Avi's table value exactly, so behavior is unchanged.
 *
 * Exposes getCommissionRate(tier) → { rate, source: "db" | "default" }.
 */
import { rawDb } from "../db/connection";
import type { PartnerTier } from "../adminContactsStoreShim";
/* WAVE 56 (R36) — the tier domain is DATA, read from partner_tier_lifecycle. */
import { tierDomainSlugs, isTierInDomain } from "./partnerTierDomain";

/* ═══════════════════════════════════════════════════════════════════════════
 * WAVE 184 · ITEM B · R156.2 — THE FALLBACK RATE TABLE IS GONE.
 *
 * Owner, verbatim: "ALL fees are dynamic (https://capavate.com/admin/fees). I
 * believe I had set the annual fee to be at $240 but this should never be
 * hardcoded. None of the fees should be hardcoded anywhere."
 *
 * WHAT USED TO STAND HERE. Two constants:
 *
 *   const FALLBACK_COMMISSION_RATE = { catalyst: 0.02, builder: 0.03,
 *     amplifier: 0.04, nexus: 0.05, founding_member: 0.06 };
 *   const DEFAULT_RATE = 0.02;
 *
 * WHY THEY WERE A DEFECT AND NOT A SEED. A seed is written into the database
 * once and read back from the database thereafter. These were never written
 * anywhere: `getCommissionRate()` returned them, with `source: "default"`, when
 * the database read SUCCEEDED and simply found no row — i.e. a compiled-in
 * commission rate standing in for a database value, on a surface that reports
 * partner commission (the partner Fee Schedule card) and on the path that
 * inserts `partner_billing_entries`. `listCommissionRates()` printed them on
 * the ADMIN fee surface as though they were configured. That is exactly the
 * class of thing R156.2 forbids: a fallback on a money surface.
 *
 * WHY REMOVING THEM CANNOT CHANGE A CONFIGURED AMOUNT. All five tiers are
 * seeded into `partner_commission_rate_config` by BOTH
 * migrations/0058_v25_38_partner_commission_rate_config.sql AND the
 * server/db/connection.ts bootstrap (`INSERT OR IGNORE`, same five values). On
 * any migrated database the row exists, `source` is "db", and these constants
 * were already unreachable. The only behaviour that changes is a database whose
 * row has been DELETED: it now gets the named refusal below instead of a
 * compiled-in rate. Reported explicitly in W184_BUILD.md.
 *
 * AVI-CODE PRESERVATION. Avi's own `COMMISSION_RATE` literal in
 * server/partnerConsortiumRoutes.ts is NOT touched by this wave — not removed,
 * not modified, not overridden. It remains reachable on a transient DB read
 * failure, which is reported as a residual needing an owner ruling rather than
 * decided here.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** WAVE 184 · ITEM B · R156.2 — the refusal for a DB read that FAILED, as
 * distinct from a DB read that succeeded and found no row. The distinction
 * matters: "no rate is configured" is a data fix an admin can make, while "the
 * rate could not be read" is not, and telling a partner to go set a field that
 * is already set would be a false statement. Callers that only need to know
 * "was this the unconfigured case?" use `isUnknownCommissionTierError`, which
 * deliberately does NOT match this error. */
export const E_COMMISSION_RATE_UNREADABLE = "PARTNER_COMMISSION_RATE_UNREADABLE";

export class CommissionRateUnreadableError extends Error {
  readonly code = E_COMMISSION_RATE_UNREADABLE;
  readonly tier: string;
  constructor(tier: string, cause: unknown) {
    super(
      `${E_COMMISSION_RATE_UNREADABLE}: the commission rate for tier "${tier}" could not be read ` +
        `from partner_commission_rate_config (${cause instanceof Error ? cause.message : String(cause)}). ` +
        `No rate has been assumed: this build carries no compiled-in commission rate.`,
    );
    this.name = "CommissionRateUnreadableError";
    this.tier = tier;
  }
}

export interface ResolvedCommissionRate {
  rate: number;
  source: "db" | "default";
}

/**
 * WAVE 56 (R36) — the refusal that replaces the silent 0.02.
 *
 * Thrown when a commission rate is ASKED FOR and none is configured for the
 * tier. It names the tier, says where to set the rate, and states plainly that
 * there is no compiled-in number to fall back on. A refusal is recoverable
 * (an admin sets the rate); an invisible 2% on somebody's revenue is not.
 */
export const E_COMMISSION_RATE_UNRESOLVED = "PARTNER_COMMISSION_RATE_UNRESOLVED";

export class UnknownCommissionTierError extends Error {
  readonly code = E_COMMISSION_RATE_UNRESOLVED;
  readonly tier: string;
  constructor(tier: string) {
    super(
      `${E_COMMISSION_RATE_UNRESOLVED}: no commission rate is configured for tier "${tier}". ` +
        `Set it in Admin → Fees → Commission rates. This build has NO default rate to fall back on: ` +
        `a tier that silently inherited 2% would be paid the wrong amount with no error anywhere.`,
    );
    this.name = "UnknownCommissionTierError";
    this.tier = tier;
  }
}

/** True when the thrown value is the unresolved-rate refusal. Used by callers
 *  that must distinguish "no rate configured" (propagate) from a transient DB
 *  read failure (fall back to the literal mirror). */
export function isUnknownCommissionTierError(err: unknown): err is UnknownCommissionTierError {
  return (
    err instanceof UnknownCommissionTierError ||
    (typeof err === "object" &&
      err !== null &&
      (err as { code?: unknown }).code === E_COMMISSION_RATE_UNRESOLVED)
  );
}

/**
 * Resolve the commission rate (fraction, e.g. 0.03 = 3%) for a partner tier.
 * Precedence:
 *   1. partner_commission_rate_config row for the tier (source="db")
 *   2. mirror of Avi's literal table, for the five tiers it covers (source="default")
 *   3. NOTHING. An unknown tier THROWS UnknownCommissionTierError.
 *
 * WAVE 56 (R36) — step 3 used to be `DEFAULT_RATE` (0.02) with source="default"
 * for ANY unrecognised tier. Measured before the fix: getCommissionRate("bridge")
 * returned { rate: 0.02, source: "default" } with no throw and no log, so the
 * first tier the owner ever added would have been paid at the cheapest rate on
 * the platform and nobody would have been told. Behaviour for the five
 * configured tiers is UNCHANGED — this fix only removes the guess.
 *
 * WAVE 184 (R156.2) — STEP 2 IS GONE. The mirror of Avi's literal used to answer
 * here whenever the read succeeded and found no row, which made a compiled-in
 * number the effective source for a commission rate. There is now no step 2:
 * either the database has the rate, or the answer is a refusal. A DB read that
 * FAILS is reported as its own distinct fault (`CommissionRateUnreadableError`)
 * rather than being papered over with a constant, so the two are never confused
 * on a money surface.
 *
 * Precedence as of wave 184:
 *   1. partner_commission_rate_config row for the tier → { source: "db" }
 *   2. read failed            → CommissionRateUnreadableError
 *   3. read succeeded, no row → UnknownCommissionTierError
 */
export function getCommissionRate(tier: PartnerTier | string): ResolvedCommissionRate {
  let row: { rate: number } | undefined;
  try {
    row = rawDb()
      .prepare(`SELECT rate FROM partner_commission_rate_config WHERE tier = ?`)
      .get(tier) as { rate: number } | undefined;
  } catch (err) {
    throw new CommissionRateUnreadableError(String(tier), err);
  }
  if (row && typeof row.rate === "number" && Number.isFinite(row.rate)) {
    return { rate: row.rate, source: "db" };
  }
  /* NO MIRROR, NO FLOOR. The rate is a database question and the database has
   * no answer for this tier. Refuse by name. */
  throw new UnknownCommissionTierError(String(tier));
}

/**
 * The non-throwing form, for surfaces that must RENDER something for a tier with
 * no rate. It returns `null` — which a caller has to handle — rather than a
 * number that looks real. "Not configured" is a legitimate thing to display; 2%
 * is not.
 */
export function tryGetCommissionRate(
  tier: PartnerTier | string,
): ResolvedCommissionRate | null {
  try {
    return getCommissionRate(tier);
  } catch (err) {
    if (isUnknownCommissionTierError(err)) return null;
    throw err;
  }
}

/* ---------------------------------------------------------------------------
 * v25.39 Phase 3 — Admin write path + list view.
 *
 * The canonical tier set matches Avi's COMMISSION_RATE literal exactly
 * (catalyst, builder, amplifier, nexus, founding_member). Writes are validated
 * against this enum so a bogus tier can never create a phantom row.
 * ------------------------------------------------------------------------- */
export const COMMISSION_RATE_TIERS = [
  "catalyst",
  "builder",
  "amplifier",
  "nexus",
  "founding_member",
] as const;
export type CommissionRateTier = (typeof COMMISSION_RATE_TIERS)[number];

/**
 * WAVE 56 (R36) — MEMBERSHIP IS NOW A DATABASE QUESTION.
 *
 * This predicate used to test membership of the five-element array above, which
 * is why an admin COULD NOT set a rate for a newly created tier: the write path
 * refused it, so `getCommissionRate` could not even be corrected by hand. It now
 * asks `partner_tier_lifecycle` — the table the create-a-tier surface writes —
 * with the five seeded slugs union'd in so an existing tier can never drop out
 * of the admin surface because of a read hiccup.
 *
 * The `tier is CommissionRateTier` narrowing is kept so no call site's types
 * move. It is a COMPILE-TIME convenience, not the domain; the domain is the
 * database, and this comment exists so the next reader is not misled by the
 * union the way this file's original author was.
 */
export function isCommissionRateTier(tier: unknown): tier is CommissionRateTier {
  if (typeof tier !== "string" || tier.length === 0) return false;
  if ((COMMISSION_RATE_TIERS as readonly string[]).includes(tier)) return true;
  return isTierInDomain(tier);
}

export interface UpdatedCommissionRate {
  tier: CommissionRateTier;
  rate: number;
  source: "db";
}

/**
 * UPSERT a single tier's commission rate. Pure w.r.t. audit (route layer owns
 * the appendAdminAudit call); records `actor` in `updated_by` for provenance.
 * Throws on an invalid tier or a rate outside the inclusive [0,1] range.
 */
export function updateCommissionRate(
  tier: string,
  rate: number,
  actor: string,
): UpdatedCommissionRate {
  if (!isCommissionRateTier(tier)) {
    throw new Error(`invalid tier: ${String(tier)}`);
  }
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new Error("rate must be a finite number between 0 and 1 (inclusive)");
  }
  const updatedBy = (typeof actor === "string" && actor) ? actor : "admin";
  rawDb()
    .prepare(
      `INSERT INTO partner_commission_rate_config (tier, rate, updated_at, updated_by)
         VALUES (?, ?, datetime('now'), ?)
       ON CONFLICT(tier) DO UPDATE SET
         rate       = excluded.rate,
         updated_at = datetime('now'),
         updated_by = excluded.updated_by`,
    )
    .run(tier, rate, updatedBy);
  return { tier, rate, source: "db" };
}

export interface CommissionRateConfigRow {
  tier: CommissionRateTier;
  /** NULL means no rate is configured. Never coerce this to 0.02 — see WAVE 56. */
  rate: number | null;
  updatedAt: string | null;
  updatedBy: string | null;
  source: "db" | "default" | "absent";
}

/**
 * The tiers the admin commission surface lists, in a DETERMINISTIC order:
 * the five seeded slugs first (COMMISSION_RATE_TIERS order, unchanged), then
 * every OTHER tier that exists in the database, in domain order.
 *
 * WAVE 56 (R36). Before this, `GET /api/admin/partner/commission-rates`
 * returned exactly five rows measured through HTTP, so a new tier was invisible
 * on the one screen that could have given it a rate. On a stock database this
 * function returns the same five slugs in the same order as before — the count
 * is DERIVED, so tests that assert five keep passing on a five-tier database
 * instead of being re-pinned to six.
 */
function commissionRateTierOrder(): string[] {
  const out: string[] = [...COMMISSION_RATE_TIERS];
  const seen = new Set(out);
  for (const slug of tierDomainSlugs()) {
    if (!seen.has(slug)) { seen.add(slug); out.push(slug); }
  }
  return out;
}

/**
 * List every tier's rate in a DETERMINISTIC order. Tiers missing a DB row report
 * their literal-mirror fallback with source="default" so the admin list always
 * shows the effective rate.
 *
 * WAVE 56: a tier with NO row and NO mirror entry — i.e. a newly created tier —
 * is listed with `rate: null` and `source: "absent"`, NOT with 0.02. The screen
 * must be able to say "not set", because that is the truth and because a
 * plausible 2% on a list is how the defect stayed invisible.
 */
export function listCommissionRates(): CommissionRateConfigRow[] {
  let rows: Array<{ tier: string; rate: number; updated_at: string | null; updated_by: string | null }> = [];
  try {
    rows = rawDb()
      .prepare(`SELECT tier, rate, updated_at, updated_by FROM partner_commission_rate_config`)
      .all() as typeof rows;
  } catch {
    rows = [];
  }
  const byTier = new Map(rows.map((r) => [r.tier, r]));
  return commissionRateTierOrder().map((slug) => {
    const tier = slug as CommissionRateTier;
    const row = byTier.get(slug);
    if (row && typeof row.rate === "number" && Number.isFinite(row.rate)) {
      return {
        tier,
        rate: row.rate,
        updatedAt: row.updated_at ?? null,
        updatedBy: row.updated_by ?? null,
        source: "db" as const,
      };
    }
    /* WAVE 184 · ITEM B · R156.2 — the branch that used to stand here returned
     * `FALLBACK_COMMISSION_RATE[slug]` with `source: "default"`, so the ADMIN
     * fee surface printed a compiled-in commission rate as if it had been
     * configured. A rate with no row is UNSET, and the admin reading this list
     * needs to see that it is unset — that is the whole point of the list. No
     * number is substituted. */
    return {
      tier,
      rate: null,
      updatedAt: null,
      updatedBy: null,
      source: "absent" as const,
    };
  });
}
