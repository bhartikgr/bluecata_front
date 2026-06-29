/* v25.38 Phase 1 — Collective application-fee resolver (DB-driven, no in-memory).
 *
 * SACRED RULE served: "Pricing plans are determined from the Admin area. They
 * are never hardcoded." This resolver promotes the former
 * `client/src/pages/founder/ApplyToCollective.tsx` literal
 * `const APPLICATION_FEE = 2_500` to a DB-driven value.
 *
 * Single source of truth: the `collective_application_fee_config` table (a
 * single-row config, id='default'). The numbered migration
 * 0057_v25_38_application_fee_config.sql AND the connection.ts bootstrap both
 * create the table (CREATE TABLE IF NOT EXISTS) and seed the default row
 * (INSERT OR IGNORE), so a fresh deploy always has a row.
 *
 * Fallback contract: if (and only if) the config row is genuinely missing, the
 * resolver returns the seed default of 2500 (the historical literal) with
 * source="default". When the row exists, it returns the DB value with
 * source="db". There is NO admin write endpoint in this wave — the seed value
 * is settable via SQL or a future wave; the contract is that every caller MUST
 * read via this resolver and NEVER hardcode the amount.
 *
 * Unit note: the historical literal was `2_500`, displayed with `fmtUSD(...)`,
 * which renders the number directly (no /100) → "$2,500". The seed stores the
 * same numeric value (2500) so the displayed amount is UNCHANGED. We keep the
 * field name `amountMinor` for API-shape consistency with the partner fee
 * resolver; the displayed value is identical to v25.37 either way.
 */
import { rawDb } from "../db/connection";

/** Historical seed/fallback default — the v25.37 literal value, unchanged. */
export const DEFAULT_APPLICATION_FEE_MINOR = 2500;
export const DEFAULT_APPLICATION_FEE_CURRENCY = "USD";

export interface ResolvedApplicationFee {
  amountMinor: number;
  currency: string;
  source: "db" | "default";
}

interface ConfigRow {
  amount_minor: number;
  currency: string | null;
}

/**
 * Resolve the collective application fee. Reads the single-row config table;
 * falls back to the seed default when no row exists (or on any read error, so
 * the founder application UI never blocks on a transient DB issue).
 *
 * @param currency  Reserved for future multi-currency config. The current
 *                  single-row config is USD; when a DB row exists its own
 *                  currency wins. The param exists so callers can pass a
 *                  desired display currency without changing the signature
 *                  later.
 */
export function getApplicationFeeMinor(
  currency: string = DEFAULT_APPLICATION_FEE_CURRENCY,
): ResolvedApplicationFee {
  // ---------------------------------------------------------------------------
  // SOURCE PRECEDENCE (v25.45.4 L-2 — FINAL):
  //   1. `collective_application_fee_config` (the ACTIVE admin editor at
  //      /admin/application-fee, wired since v25.39). When its row exists it is
  //      AUTHORITATIVE — this is what an admin edits today, so it must win.
  //   2. Hardcoded historical seed default (2500) with source='default' — the
  //      documented v25.38/v25.39 contract: when the config row is genuinely
  //      MISSING the resolver reports source='default' (and the endpoint still
  //      returns a clean 200). This MUST be preserved.
  //
  // L-2 BRIDGE (no resolver change to the source-precedence above): the new
  // /admin/platform-fees PUT path MIRROR-WRITES the collective_application_fee
  // value (cents ÷ 100) into `collective_application_fee_config` via
  // updateApplicationFee(). This way an admin edit through the new Platform Fees
  // panel flows to the founder Billing surface THROUGH the existing
  // config-table resolver (source='db'), WITHOUT inserting platform_fees as a
  // silent fallback here — which would have broken the documented source='default'
  // contract when the config row is absent. See server/adminPlatformFeesRoutes.ts.
  // ---------------------------------------------------------------------------
  try {
    const row = rawDb()
      .prepare(
        `SELECT amount_minor, currency FROM collective_application_fee_config WHERE id = 'default'`,
      )
      .get() as ConfigRow | undefined;
    if (row && typeof row.amount_minor === "number") {
      return {
        amountMinor: row.amount_minor,
        currency: row.currency || currency || DEFAULT_APPLICATION_FEE_CURRENCY,
        source: "db",
      };
    }
  } catch {
    // Fall through — never block the application UI on a transient DB / missing-
    // table condition. The dual bootstrap+migration path guarantees the table
    // normally exists.
  }
  return {
    amountMinor: DEFAULT_APPLICATION_FEE_MINOR,
    currency: currency || DEFAULT_APPLICATION_FEE_CURRENCY,
    source: "default",
  };
}

/* ---------------------------------------------------------------------------
 * v25.39 Phase 2 — Admin write path.
 *
 * `updateApplicationFee(amountMinor, currency, actor)` UPSERTs the single-row
 * config (id='default') and returns the freshly-resolved fee with source="db".
 *
 * This function is PURE w.r.t. audit: it does NOT call appendAdminAudit — that
 * is the route layer's responsibility (server/adminCollectiveFeeRoutes.ts), so
 * the resolver stays free of cross-store coupling. The `actor` is recorded in
 * the row's `updated_by` column for provenance; the route layer additionally
 * writes the hash-chained admin audit entry.
 *
 * Validation: throws on a non-finite / negative / non-integer amount, mirroring
 * the contract enforced by the route (the route returns 400 before calling
 * this, but the resolver re-validates as a defense-in-depth invariant).
 * ------------------------------------------------------------------------- */
export function updateApplicationFee(
  amountMinor: number,
  currency: string,
  actor: string,
): ResolvedApplicationFee {
  // v25.39 round-2 (per GPT-5.5 concern #5): also reject unsafe integers > 2^53-1.
  if (typeof amountMinor !== "number" || !Number.isFinite(amountMinor) || !Number.isInteger(amountMinor) || !Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new Error("amountMinor must be a non-negative integer (minor units)");
  }
  const cur = (typeof currency === "string" && currency.trim())
    ? currency.trim().toUpperCase()
    : DEFAULT_APPLICATION_FEE_CURRENCY;
  const updatedBy = (typeof actor === "string" && actor) ? actor : "admin";
  rawDb()
    .prepare(
      `INSERT INTO collective_application_fee_config (id, amount_minor, currency, updated_at, updated_by)
         VALUES ('default', ?, ?, datetime('now'), ?)
       ON CONFLICT(id) DO UPDATE SET
         amount_minor = excluded.amount_minor,
         currency     = excluded.currency,
         updated_at   = datetime('now'),
         updated_by   = excluded.updated_by`,
    )
    .run(amountMinor, cur, updatedBy);
  return { amountMinor, currency: cur, source: "db" };
}

/** v25.39 — Read the full config row (incl. provenance) for the admin editor. */
export interface ApplicationFeeConfigRow {
  amountMinor: number;
  currency: string;
  updatedAt: string | null;
  updatedBy: string | null;
  source: "db" | "default";
}

export function getApplicationFeeConfig(): ApplicationFeeConfigRow {
  try {
    const row = rawDb()
      .prepare(
        `SELECT amount_minor, currency, updated_at, updated_by
           FROM collective_application_fee_config WHERE id = 'default'`,
      )
      .get() as
      | { amount_minor: number; currency: string | null; updated_at: string | null; updated_by: string | null }
      | undefined;
    if (row && typeof row.amount_minor === "number") {
      return {
        amountMinor: row.amount_minor,
        currency: row.currency || DEFAULT_APPLICATION_FEE_CURRENCY,
        updatedAt: row.updated_at ?? null,
        updatedBy: row.updated_by ?? null,
        source: "db",
      };
    }
  } catch {
    // fall through to seed default
  }
  return {
    amountMinor: DEFAULT_APPLICATION_FEE_MINOR,
    currency: DEFAULT_APPLICATION_FEE_CURRENCY,
    updatedAt: null,
    updatedBy: null,
    source: "default",
  };
}
