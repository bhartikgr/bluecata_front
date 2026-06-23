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

/* ---------------------------------------------------------------------------
 * Fallback mirror of Avi's COMMISSION_RATE literal
 * (server/partnerConsortiumRoutes.ts). Mirrored, NOT imported, to avoid a
 * circular import. Kept byte-equivalent in VALUE to Avi's table; Avi's source
 * remains the single ultimate fallback for his own call site.
 * ------------------------------------------------------------------------- */
const FALLBACK_COMMISSION_RATE: Record<string, number> = {
  catalyst: 0.02,
  builder: 0.03,
  amplifier: 0.04,
  nexus: 0.05,
  founding_member: 0.06,
};

/** Ultimate default for an unknown / unmapped tier — matches Avi's
 * `COMMISSION_RATE[tier] ?? 0.02` floor. */
const DEFAULT_RATE = 0.02;

export interface ResolvedCommissionRate {
  rate: number;
  source: "db" | "default";
}

/**
 * Resolve the commission rate (fraction, e.g. 0.03 = 3%) for a partner tier.
 * Precedence:
 *   1. partner_commission_rate_config row for the tier (source="db")
 *   2. mirror of Avi's literal table (source="default")
 *   3. DEFAULT_RATE 0.02 floor for an unknown tier (source="default")
 *
 * On any DB read error it falls back to the mirror — the dual bootstrap+
 * migration path guarantees the table normally exists, and we never want fee
 * math to throw because of a transient read.
 */
export function getCommissionRate(tier: PartnerTier | string): ResolvedCommissionRate {
  try {
    const row = rawDb()
      .prepare(`SELECT rate FROM partner_commission_rate_config WHERE tier = ?`)
      .get(tier) as { rate: number } | undefined;
    if (row && typeof row.rate === "number" && Number.isFinite(row.rate)) {
      return { rate: row.rate, source: "db" };
    }
  } catch {
    // fall through to the literal mirror below
  }
  const fallback = FALLBACK_COMMISSION_RATE[tier as string];
  return {
    rate: typeof fallback === "number" ? fallback : DEFAULT_RATE,
    source: "default",
  };
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

export function isCommissionRateTier(tier: unknown): tier is CommissionRateTier {
  return typeof tier === "string" && (COMMISSION_RATE_TIERS as readonly string[]).includes(tier);
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
  rate: number;
  updatedAt: string | null;
  updatedBy: string | null;
  source: "db" | "default";
}

/**
 * List all 5 tier rates in a DETERMINISTIC order (COMMISSION_RATE_TIERS order).
 * Tiers missing a DB row report their literal-mirror fallback with
 * source="default" so the admin list always shows the effective rate.
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
  return COMMISSION_RATE_TIERS.map((tier) => {
    const row = byTier.get(tier);
    if (row && typeof row.rate === "number" && Number.isFinite(row.rate)) {
      return {
        tier,
        rate: row.rate,
        updatedAt: row.updated_at ?? null,
        updatedBy: row.updated_by ?? null,
        source: "db" as const,
      };
    }
    return {
      tier,
      rate: FALLBACK_COMMISSION_RATE[tier] ?? DEFAULT_RATE,
      updatedAt: null,
      updatedBy: null,
      source: "default" as const,
    };
  });
}
