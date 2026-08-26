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
 * FALLBACK CONTRACT — REPLACED BY BATCH 1 · ITEM 2 (R108.2, R95, R104).
 * This resolver used to return DEFAULT_APPLICATION_FEE_MINOR with
 * source="default" whenever the config row was missing OR the read threw. That
 * was a FABRICATED amount: a founder could not tell a fee that is on record from
 * one that is not, and R95 requires that a price which is not on record be
 * REFUSED AND SAID rather than substituted — even by its own correct number. The
 * substitution was harmless in VALUE only because 30000 happened to be right; the
 * same code returned a confident figure for a table that had been dropped,
 * renamed or truncated.
 *
 * The contract is now:
 *   row present   -> { amountMinor: <db value>, currency: <db>, source: "db" }
 *   row absent    -> { amountMinor: null, currency: null, source: "missing" }
 *   read threw    -> { amountMinor: null, currency: null, source: "unreadable" }
 * `source` distinguishes a genuinely absent price from a transient or structural
 * read failure, because those need different operator responses. NEITHER ever
 * carries a number. Every caller MUST read via this resolver and NEVER hardcode
 * the amount.
 *
 * THE FOUNDER SURFACE MUST NOT HARD-FAIL (R108.2). GET
 * /api/collective/application-fee still answers 200 with this body — never a 503
 * — so the application page renders normally and shows its existing unavailable
 * state; submission is already gated on `feeReady`, so nothing can be submitted
 * or charged against an amount that is not on record.
 *
 * Unit note — CORRECTED BY WAVE 139 (R101). `amountMinor` and the
 * `collective_application_fee_config.amount_minor` column hold TRUE MINOR UNITS:
 * the canonical Collective application fee of $300.00 is stored as 30000, and it
 * is rendered with `formatMinor(amountMinor, currency)`, which applies the
 * ISO-4217 exponent. This header previously asserted the whole-unit belief — that
 * the value was the historical v25.37 literal, rendered directly by a formatter
 * that applied no division, so the stored number was read as whole dollars. WAVE
 * 131 and WAVE 137 invalidated that reading: 137 repointed every display onto
 * `formatMinor` and 131 made the platform-fees mirror-write unscaled. R101 pins
 * $300 = 30000 as canonical, matching the live database and
 * DEFAULT_APPLICATION_FEE_MINOR below. The stale 2500 / 250000
 * MIGRATION SEEDS are corrected forward by
 * migrations/0196_wave139_application_fee_seed_correction.sql.
 */
import { rawDb } from "../db/connection";

/** APD-028 canonical REFERENCE value — $300 = 30000 TRUE minor units (R101).
 *
 *  BATCH 1 · ITEM 2 — this is a REFERENCE FIGURE AND MUST NEVER BE RETURNED BY A
 *  RESOLVER. It records what the Collective application fee is documented to be,
 *  so migrations, tests and the admin console's "expected" display have ONE named
 *  source instead of a re-typed literal. It is deliberately NOT a fallback any
 *  more: substituting it for an absent row is exactly the R95 shape ("a `?? 240`
 *  or `|| 10` fallback that substitutes a figure when the real one is absent").
 *  If it is ever wired into a read path again, that read path is lying about what
 *  is on record. `server/platformFeesStore.ts:51` imports it as the DOCUMENTED
 *  default for a fee-registry row, which is a different contract; that import is
 *  untouched by this item. */
export const DEFAULT_APPLICATION_FEE_MINOR = 30000;
export const DEFAULT_APPLICATION_FEE_CURRENCY = "USD";

/** BATCH 1 · ITEM 2 — `amountMinor` and `currency` are null exactly when `source`
 *  is not "db". "missing" = the table read cleanly and holds no usable row;
 *  "unreadable" = the read threw (absent table, lock, corruption). Neither
 *  carries a number, and no consumer may substitute one. */
export interface ResolvedApplicationFee {
  amountMinor: number | null;
  currency: string | null;
  source: "db" | "missing" | "unreadable";
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
  //   2. NOTHING. BATCH 1 · ITEM 2 (R108.2) REMOVED THE SECOND SOURCE. When the
  //      config row is MISSING the resolver reports source='missing' with a NULL
  //      amount, and when the read THROWS it reports source='unreadable' with a
  //      NULL amount. The endpoint still returns a clean 200 either way — the
  //      founder surface must not hard-fail — but it never states a price that is
  //      not on record (R95, R104).
  //
  // L-2 BRIDGE (no resolver change to the source-precedence above): the new
  // /admin/platform-fees PUT path MIRROR-WRITES the collective_application_fee
  // value into `collective_application_fee_config` via updateApplicationFee().
  // The mirror is UNSCALED — both columns are TRUE MINOR UNITS, so there is no
  // '÷ 100' on this path; WAVE 131 removed the conversion that used to be here
  // and this comment used to describe (see server/adminPlatformFeesRoutes.ts,
  // which records why). This way an admin edit through the new Platform Fees
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
    /* Read succeeded and there is no usable row. BATCH 1 · ITEM 2: report the
       ABSENCE. The application UI is not blocked — the caller returns 200 with
       this body and the page shows its existing unavailable state — but no
       figure is invented. */
    return { amountMinor: null, currency: null, source: "missing" };
  } catch {
    /* The read itself failed: absent table, lock, corruption. This is NOT the
       same condition as "no row", and the old bare catch could not tell them
       apart — it answered both with a confident 30000. Reported distinctly so an
       operator knows whether to publish a price or to fix a database, and still
       without a number. */
    return { amountMinor: null, currency: null, source: "unreadable" };
  }
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
  amountMinor: number | null;
  currency: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  /* BATCH 1 · ITEM 2 — same three-value contract as ResolvedApplicationFee, so
     the admin editor can SHOW the administrator which state the founder-facing
     resolver is in (R108.2 item 1: the `source` the resolver already returns
     must be made visible to the admin). */
  source: "db" | "missing" | "unreadable";
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
    /* No row: state the absence to the admin instead of echoing the reference
       figure back at them as though it were configured (BATCH 1 · ITEM 2). */
    return { amountMinor: null, currency: null, updatedAt: null, updatedBy: null, source: "missing" };
  } catch {
    return { amountMinor: null, currency: null, updatedAt: null, updatedBy: null, source: "unreadable" };
  }
}
