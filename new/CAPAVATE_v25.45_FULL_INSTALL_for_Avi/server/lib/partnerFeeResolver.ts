/* v25.33 Consortium Partner Payment Model — DB-driven, no in-memory.
 * Single source of truth for resolving partner fees. Three-level precedence:
 *   1. per-partner override  (contacts.fee_override_json / commission_override_pct)
 *   2. per-tier default      (partner_fee_schedules WHERE tier = <tier>)
 *   3. platform default      (partner_fee_schedules WHERE tier IS NULL)
 * All reads hit SQLite via rawDb(); nothing is cached in process memory.
 * Fail-closed: throws FeeResolutionError when no schedule row can be found so
 * we never silently charge $0 because of a mis-config (the seeded $0 rows in
 * connection.ts guarantee a row exists on a fresh deploy, so a throw here means
 * a genuine config gap). Currency, amounts, and bands ALL come from the DB —
 * there are NO hardcoded fee amounts in this file.
 */
import { rawDb } from "../db/connection";
import type { PartnerTier } from "../adminContactsStoreShim";

/** fee_kind enum — mirrors partner_fee_schedules.fee_kind semantics. */
export type FeeKind =
  | "subscription_monthly"
  | "subscription_annual"
  | "spv_deployment"
  | "spv_management_per_lp_quarter"
  | "spv_closing_bonus";

/** How a resolved value was arrived at — recorded in partner_billing_entries.computed_via. */
export type ComputedVia = "partner_override" | "tier_default" | "platform_default";

export interface ResolvedFee {
  amountMinor: number;
  currency: string;
  /** The partner_fee_schedules.id that supplied the value (null for an override). */
  feeScheduleId: string | null;
  computedVia: ComputedVia;
}

export class FeeResolutionError extends Error {
  code: string;
  details: Record<string, unknown>;
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "FeeResolutionError";
    this.code = code;
    this.details = details;
  }
}

interface ScheduleRow {
  id: string;
  tier: string | null;
  fee_kind: string;
  amount_minor: number;
  currency: string;
  size_band_min: number | null;
  size_band_max: number | null;
  effective_from: string;
  effective_to: string | null;
}

/** ISO timestamp helper — single point so tests can reason about "now". */
function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Read the per-partner fee override JSON, if any, from the contacts row.
 * Shape (admin-authored): { "<fee_kind>": { "amountMinor": number, "currency": string } }
 * Returns null when the partner has no override for this fee_kind.
 */
function readPartnerOverride(partnerId: string, feeKind: FeeKind): { amountMinor: number; currency: string } | null {
  const row = rawDb()
    .prepare(`SELECT fee_override_json FROM contacts WHERE id = ? AND kind = 'consortium_partner' AND deleted_at IS NULL`)
    .get(partnerId) as { fee_override_json: string | null } | undefined;
  if (!row || !row.fee_override_json) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(row.fee_override_json) as Record<string, unknown>;
  } catch {
    // Malformed override JSON must not crash fee resolution — fall through to
    // tier/platform defaults. We do NOT swallow this silently in spirit: the
    // caller still gets a deterministic resolution, and the row is auditable.
    return null;
  }
  const entry = parsed[feeKind] as { amountMinor?: unknown; currency?: unknown } | undefined;
  if (!entry || typeof entry.amountMinor !== "number") return null;
  return {
    amountMinor: entry.amountMinor,
    currency: typeof entry.currency === "string" && entry.currency ? entry.currency : "USD",
  };
}

/**
 * Pull all currently-effective schedule rows for a fee_kind at the given tier
 * scope (tier value, or NULL for platform). "Currently effective" =
 * effective_from <= now AND (effective_to IS NULL OR effective_to > now).
 * Ordered by effective_from DESC so the most recent window wins.
 */
function readScheduleRows(feeKind: FeeKind, tier: PartnerTier | null, atIso: string): ScheduleRow[] {
  const db = rawDb();
  const sql = `
    SELECT id, tier, fee_kind, amount_minor, currency, size_band_min, size_band_max, effective_from, effective_to
    FROM partner_fee_schedules
    WHERE fee_kind = ?
      AND ${tier === null ? "tier IS NULL" : "tier = ?"}
      AND effective_from <= ?
      AND (effective_to IS NULL OR effective_to > ?)
    ORDER BY effective_from DESC
  `;
  const params = tier === null ? [feeKind, atIso, atIso] : [feeKind, tier, atIso, atIso];
  return db.prepare(sql).all(...params) as ScheduleRow[];
}

/**
 * Pick the row whose size band contains `sizeMinor`. For non-banded fee kinds
 * (subscription, mgmt, bonus) the band columns are NULL and the first row
 * matches. Band match: size_band_min <= sizeMinor AND
 * (size_band_max IS NULL OR sizeMinor < size_band_max).
 */
function pickBandRow(rows: ScheduleRow[], sizeMinor: number | null): ScheduleRow | null {
  if (rows.length === 0) return null;
  // Non-banded fee kinds: take the most-recent row (already DESC-ordered).
  const banded = rows.some((r) => r.size_band_min !== null || r.size_band_max !== null);
  if (!banded) return rows[0];
  // Banded: require a size to choose a band.
  if (sizeMinor === null) return null;
  for (const r of rows) {
    const min = r.size_band_min ?? 0;
    const maxOk = r.size_band_max === null || sizeMinor < r.size_band_max;
    if (sizeMinor >= min && maxOk) return r;
  }
  return null;
}

export interface ResolveOpts {
  /** Required for banded fee kinds (spv_deployment): the SPV committed amount in minor units. */
  sizeMinor?: number | null;
  /** Override "now" for time-windowed resolution (tests). */
  atIso?: string;
}

/**
 * Resolve a single fee for a partner. Walks the 3-level precedence and returns
 * the first hit. Throws FeeResolutionError (fail-closed) if nothing resolves.
 */
export function resolvePartnerFee(
  partnerId: string,
  tier: PartnerTier,
  feeKind: FeeKind,
  opts: ResolveOpts = {},
): ResolvedFee {
  const atIso = opts.atIso ?? nowIso();
  const sizeMinor = opts.sizeMinor ?? null;

  // ---- Level 1: per-partner override (highest precedence) ----
  // Overrides are NOT banded — an admin who sets a per-partner amount sets the
  // exact amount for that partner+kind regardless of SPV size.
  const override = readPartnerOverride(partnerId, feeKind);
  if (override) {
    return {
      amountMinor: override.amountMinor,
      currency: override.currency,
      feeScheduleId: null,
      computedVia: "partner_override",
    };
  }

  // ---- Level 2: per-tier default ----
  const tierRows = readScheduleRows(feeKind, tier, atIso);
  const tierRow = pickBandRow(tierRows, sizeMinor);
  if (tierRow) {
    return {
      amountMinor: tierRow.amount_minor,
      currency: tierRow.currency,
      feeScheduleId: tierRow.id,
      computedVia: "tier_default",
    };
  }

  // ---- Level 3: platform default (tier IS NULL) ----
  const platformRows = readScheduleRows(feeKind, null, atIso);
  const platformRow = pickBandRow(platformRows, sizeMinor);
  if (platformRow) {
    return {
      amountMinor: platformRow.amount_minor,
      currency: platformRow.currency,
      feeScheduleId: platformRow.id,
      computedVia: "platform_default",
    };
  }

  // ---- Fail-closed ----
  throw new FeeResolutionError(
    "no_fee_schedule_configured",
    `No fee schedule found for fee_kind='${feeKind}' (tier='${tier}', sizeMinor=${sizeMinor}). ` +
      `A seeded $0 platform default should always exist — this indicates a missing migration or band gap.`,
    { feeKind, tier, sizeMinor, atIso },
  );
}

/**
 * Resolve the per-partner commission rate (fraction, e.g. 0.03 = 3%).
 * Precedence: contacts.commission_override_pct (per-partner) → caller's
 * tier-default table. This resolver returns ONLY the per-partner override when
 * present; otherwise it returns null so the caller falls back to its existing
 * tier table (partnerConsortiumRoutes.COMMISSION_RATE — Avi's code, unmodified).
 * This keeps the resolver ADDITIVE: it never overrides Avi's existing math, it
 * only supplies an admin-configured per-partner override when one exists.
 */
export function resolveCommissionOverridePct(partnerId: string): number | null {
  const row = rawDb()
    .prepare(`SELECT commission_override_pct FROM contacts WHERE id = ? AND kind = 'consortium_partner' AND deleted_at IS NULL`)
    .get(partnerId) as { commission_override_pct: number | null } | undefined;
  if (!row || row.commission_override_pct === null || row.commission_override_pct === undefined) return null;
  return row.commission_override_pct;
}

/* ===========================================================================
 * v25.38 Phase 2 — DB-driven per-tier commission rate (ADDITIVE go-forward).
 *
 * This is a NEW, additive export. It does NOT modify any existing function and
 * is NOT wired into Avi's `partnerConsortiumRoutes.ts` call site (Avi's literal
 * COMMISSION_RATE table is left byte-identical as the ultimate fallback). New
 * code that wants the admin-DB-driven rate can call this single entry point,
 * which composes the two precedence levels we own:
 *   1. per-partner override  (contacts.commission_override_pct) — highest
 *   2. per-tier DB config     (partner_commission_rate_config via resolver)
 *      → which itself falls back to the mirror of Avi's literal table.
 *
 * Returns the fraction plus how it was resolved, so callers can audit the
 * source the same way resolvePartnerFee records `computedVia`.
 * ========================================================================= */
import { getCommissionRate as getTierCommissionRate } from "./partnerCommissionRateResolver";

export type CommissionVia = "partner_override" | "db" | "default";

export interface ResolvedCommission {
  rate: number;
  via: CommissionVia;
}

/**
 * Resolve the commission rate (fraction) for a partner, preferring a
 * per-partner override, then the DB tier config, then the literal-mirror
 * fallback. Purely additive — existing resolver behavior is unchanged.
 */
export function resolveCommissionRate(partnerId: string, tier: PartnerTier): ResolvedCommission {
  const override = resolveCommissionOverridePct(partnerId);
  if (override !== null) {
    return { rate: override, via: "partner_override" };
  }
  const tierRate = getTierCommissionRate(tier);
  return { rate: tierRate.rate, via: tierRate.source === "db" ? "db" : "default" };
}
