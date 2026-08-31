// server/lib/pricePeriodOffer.ts
//
// WAVE 202 · ITEM A · R178.1 — THE BILLING PERIOD, PER PRICE, AS THE OWNER'S CHOICE.
//
// THE OWNER'S WORDS
//   "the admin area pricing section should allow me to choose between annual and/or
//    monthly pricing. Whatever I choose should be dynamically displayed in the
//    frontend."
//
// WHAT THIS FILE IS, IN ONE SENTENCE
//   The per-price resolver that answers "may this figure show a monthly period?" by
//   reading the owner's choice for THAT price, and falling back to wave 199's
//   platform-wide answer when he has not made one.
//
// WHY IT EXISTS
//   Wave 199 wired every monthly display in the frontend to ONE boolean, sourced
//   from the partner_pricing_model_config singleton. That was the right fix for
//   R173.6 ("there really should not be a displayed as monthly") but it is a
//   platform-wide rule, and R178.1 asks for a per-price choice. This file adds the
//   per-price layer WITHOUT removing the platform-wide one: the singleton stays, and
//   becomes the default that applies to every price the owner has not spoken about.
//
// WHAT IS NOT DELETED
//   `readBillingPeriodOffer()` (wave 188) is untouched and is still the mechanism.
//   `readPriceDisplayPolicy()`'s existing fields are untouched. Monthly stays priced,
//   stored, derivable and administrable everywhere it already was. Nothing here
//   removes a control, a column or a capability.
//
// WHAT THIS IS NOT
//   - NOT a charge decision. No charge path reads it. `resolveChargeTier()`,
//     `assertTierPurchasable()` and every subscription path continue to consult
//     monthly_purchasable / annual_purchasable. Display ≠ charge (R159.3).
//   - NOT a second home for an amount. Every amount stays in the store that owns it.
//     The one amount this layer can hold is an annual figure for a scope whose
//     canonical store has NO annual row — a gap-filler, provenance-tagged.
//   - NOT a place where an annual figure may be derived. There is no `* 12` and no
//     `/ 12` in this file, and the schema cannot store a derived value:
//     `annual_derivation` admits only 'unset' and 'admin_set'
//     (forbid_x12_derivation = 1, R156.1, R156.2).
//   - NOT a holder of any literal price, currency or cadence value (R156.2). The
//     only literals here are column names, JSON keys, scope-key namespaces and
//     English sentences.
//
// FAIL-CLOSED, AT BOTH LEVELS
//   An unreadable per-scope row falls back to the platform-wide answer. An
//   unreadable platform-wide answer reports monthly NOT allowed. There is no path
//   where "unknown" means "show monthly", which is the property R178.1 most needs:
//   making the period configurable must not re-expose a monthly figure the owner has
//   not asked for.
//
// ABSENCE IS NEVER A VALUE
//   An unset annual amount is `null` and is tested with `=== null`. It is never
//   compared to, defaulted to, or rendered as `0` (R176.1, R143.4 — "Capavate will
//   not show a zero total for a figure it does not hold").
//
// RULING: R178.1, R173.6, R156.1, R156.2, R143.4, R176.1, R159.3, R3.

import fs from "node:fs";
import path from "node:path";
import { wave45Db } from "./applyWave45PricingSchema";
import { readBillingPeriodOffer } from "./partnerFeeAdminDisplayPolicy";
/* WAVE 202 — THE 240-CHARACTER GATE. `client/src/lib/queryClient.ts` discards a
   server message of 240 characters or more, so a refusal that runs long has not
   partly fired, it has NOT FIRED. This class has bitten four times (waves 192, 195,
   193, 198). The only refusal below that interpolates unbounded text is the write
   failure, and it is assembled through wave 195's helper rather than trimmed by
   hand. */
import { fitToGate, DEFAULT_ID_FRAGMENT_BUDGETS } from "../../shared/refusalHeadlineGate";

const MIGRATION_BASENAME = "0216_wave202_price_period_offer.sql";

export const PRICE_PERIOD_OFFER_TABLE = "price_period_offer";

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  SCOPE KEYS
 *
 *  A scope key names ONE price. It is namespaced by the store that owns that
 *  price so that a platform_fees key, a partner tier slug and a pricing-model id
 *  can never collide in one table.
 * ═══════════════════════════════════════════════════════════════════════════ */

export const SCOPE_NS_PLATFORM_FEE = "platform_fee";
export const SCOPE_NS_PARTNER_TIER = "partner_tier";
export const SCOPE_NS_PRICING_MODEL = "pricing_model";

export function platformFeeScopeKey(feeKey: string): string {
  return `${SCOPE_NS_PLATFORM_FEE}:${feeKey}`;
}
export function partnerTierScopeKey(tierSlug: string): string {
  return `${SCOPE_NS_PARTNER_TIER}:${tierSlug}`;
}
export function pricingModelScopeKey(modelId: string): string {
  return `${SCOPE_NS_PRICING_MODEL}:${modelId}`;
}

/**
 * A scope key is well-formed when it names a namespace this platform knows and a
 * non-empty identifier inside it. An unknown namespace is REFUSED rather than
 * accepted and silently ignored, so a typo in an admin call cannot quietly create
 * a row nothing will ever read.
 */
export function isKnownScopeKey(scopeKey: string): boolean {
  const idx = scopeKey.indexOf(":");
  if (idx <= 0 || idx === scopeKey.length - 1) return false;
  const ns = scopeKey.slice(0, idx);
  return (
    ns === SCOPE_NS_PLATFORM_FEE ||
    ns === SCOPE_NS_PARTNER_TIER ||
    ns === SCOPE_NS_PRICING_MODEL
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  SCHEMA
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Both trees hold a byte-identical copy; either will do. */
function candidatePaths(): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "server", "db", "migrations", MIGRATION_BASENAME),
    path.join(cwd, "migrations", MIGRATION_BASENAME),
  ];
}

function readMigrationSql(): string {
  for (const p of candidatePaths()) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error(
    `[pricePeriodOffer] migration ${MIGRATION_BASENAME} not found in either migrations directory`,
  );
}

/**
 * Idempotent by INSPECTION of sqlite_master, not by a module-level boolean — a memo
 * would answer "already done" for a second in-memory database that has none of it.
 * Same shape as `ensureFeeAdminDisplayPolicySchema()`, deliberately.
 */
export function ensurePricePeriodOfferSchema(): void {
  const db = wave45Db();
  const present = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(PRICE_PERIOD_OFFER_TABLE) as { name: string } | undefined;
  if (present) return;
  // Executed as ONE script, never split on ';'.
  db.exec(readMigrationSql());
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  READ
 * ═══════════════════════════════════════════════════════════════════════════ */

export type PricePeriodOfferSource = "per_price" | "platform_default";
export type AnnualDerivation = "unset" | "admin_set";

export interface PricePeriodOffer {
  scopeKey: string;
  /** May a surface print an annual period beside this price? */
  annualOffered: boolean;
  /** May a surface print a monthly period beside this price? */
  monthlyOffered: boolean;
  /**
   * 'per_price'        — the owner has recorded a choice for THIS price.
   * 'platform_default' — he has not; wave 199's platform-wide answer applies.
   */
  source: PricePeriodOfferSource;
  /**
   * An annual amount recorded here for a scope whose canonical store holds none.
   * `null` means UNSET. It is never 0-by-default and never derived (R143.4).
   */
  annualAmountMinor: number | null;
  annualCurrency: string | null;
  annualDerivation: AnnualDerivation;
  /** True when a client must not divide or multiply by twelve. Passed through. */
  forbidX12Derivation: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  notes: string | null;
  /** Set only when the per-price row could not be read; null on the happy path. */
  unavailableReason: string | null;
}

interface OfferRow {
  scope_key: string;
  annual_offered: number;
  monthly_offered: number;
  annual_amount_minor: number | null;
  annual_currency: string | null;
  annual_derivation: string;
  updated_at: string | null;
  updated_by: string | null;
  notes: string | null;
}

/**
 * The platform-wide answer, i.e. exactly what wave 199 already serves. Kept as its
 * own function so that the fallback and wave 199's endpoint can never drift.
 */
function platformDefault(scopeKey: string, unavailableReason: string | null): PricePeriodOffer {
  try {
    const offer = readBillingPeriodOffer();
    return {
      scopeKey,
      annualOffered: offer.annualOffered,
      monthlyOffered: offer.monthlyOffered,
      source: "platform_default",
      annualAmountMinor: null,
      annualCurrency: null,
      annualDerivation: "unset",
      forbidX12Derivation: offer.forbidX12Derivation,
      updatedAt: offer.updatedAt,
      updatedBy: offer.updatedBy,
      notes: offer.notes,
      unavailableReason,
    };
  } catch {
    /* Fail-closed: monthly not shown, annual unaffected. Same answer wave 199's
       endpoint gives on the same failure, for the same reasons. */
    return {
      scopeKey,
      annualOffered: true,
      monthlyOffered: false,
      source: "platform_default",
      annualAmountMinor: null,
      annualCurrency: null,
      annualDerivation: "unset",
      forbidX12Derivation: true,
      updatedAt: null,
      updatedBy: null,
      notes: null,
      unavailableReason:
        unavailableReason ??
        "The billing-period choice could not be read on this request, so monthly figures are not being shown. Annual and fixed prices are unaffected.",
    };
  }
}

function normaliseDerivation(raw: string): AnnualDerivation {
  /* The schema admits only these two. Anything else is treated as UNSET rather
     than trusted — there is deliberately no 'derived_x12' branch to fall into. */
  return raw === "admin_set" ? "admin_set" : "unset";
}

function rowToOffer(row: OfferRow, forbidX12Derivation: boolean): PricePeriodOffer {
  const derivation = normaliseDerivation(row.annual_derivation);
  /* ABSENCE IS NEVER A VALUE (R176.1). `annual_amount_minor` is read as null-or-
     number with an explicit null test; it is never coerced, never defaulted to 0
     and never compared to 0 to decide whether it exists. */
  const amount = row.annual_amount_minor === null ? null : row.annual_amount_minor;
  return {
    scopeKey: row.scope_key,
    annualOffered: row.annual_offered === 1,
    monthlyOffered: row.monthly_offered === 1,
    source: "per_price",
    annualAmountMinor: derivation === "admin_set" ? amount : null,
    annualCurrency: derivation === "admin_set" ? row.annual_currency : null,
    annualDerivation: derivation,
    forbidX12Derivation,
    updatedAt: row.updated_at ?? null,
    updatedBy: row.updated_by ?? null,
    notes: row.notes ?? null,
    unavailableReason: null,
  };
}

/**
 * THE ONE RESOLVER. Per-price choice if the owner made one; wave 199's
 * platform-wide answer if he did not; fail-closed if neither can be read.
 */
export function resolvePricePeriodOffer(scopeKey: string): PricePeriodOffer {
  if (!isKnownScopeKey(scopeKey)) {
    return platformDefault(
      scopeKey,
      "That price could not be identified, so the platform-wide billing-period setting is being used instead.",
    );
  }

  let forbidX12Derivation = true;
  try {
    forbidX12Derivation = readBillingPeriodOffer().forbidX12Derivation;
  } catch {
    /* Fail-closed to "you may not derive". */
  }

  let row: OfferRow | undefined;
  try {
    ensurePricePeriodOfferSchema();
    const db = wave45Db();
    row = db
      .prepare(
        `SELECT scope_key, annual_offered, monthly_offered, annual_amount_minor,
                annual_currency, annual_derivation, updated_at, updated_by, notes
           FROM ${PRICE_PERIOD_OFFER_TABLE} WHERE scope_key = ?`,
      )
      .get(scopeKey) as OfferRow | undefined;
  } catch {
    return platformDefault(
      scopeKey,
      "The per-price billing-period choice could not be read on this request, so the platform-wide setting is being used instead. No price is affected.",
    );
  }

  /* NO ROW IS NOT AN ERROR. It is the shipped state: the owner has not chosen a
     period for this price, so the platform-wide setting applies. This is why the
     migration seeds nothing — behaviour is identical to wave 199 until he chooses. */
  if (!row) return platformDefault(scopeKey, null);

  return rowToOffer(row, forbidX12Derivation);
}

/** Every choice the owner has actually recorded. Used by the admin screen. */
export function listPricePeriodOffers(): PricePeriodOffer[] {
  let forbidX12Derivation = true;
  try {
    forbidX12Derivation = readBillingPeriodOffer().forbidX12Derivation;
  } catch {
    /* Fail-closed. */
  }
  try {
    ensurePricePeriodOfferSchema();
    const db = wave45Db();
    const rows = db
      .prepare(
        `SELECT scope_key, annual_offered, monthly_offered, annual_amount_minor,
                annual_currency, annual_derivation, updated_at, updated_by, notes
           FROM ${PRICE_PERIOD_OFFER_TABLE} ORDER BY scope_key`,
      )
      .all() as OfferRow[];
    return rows.map((r) => rowToOffer(r, forbidX12Derivation));
  } catch {
    /* An unreadable table is reported as "no choices recorded", which resolves
       every scope to the platform default — the fail-closed answer. */
    return [];
  }
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  WRITE — admin only. The caller is responsible for authorisation; this
 *  function refuses anything the schema or the rulings forbid.
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface WritePricePeriodOfferArgs {
  scopeKey: string;
  annualOffered: boolean;
  monthlyOffered: boolean;
  /**
   * `null` clears any annual amount recorded here and returns the scope to UNSET.
   * A number is stored verbatim in minor units, attributed to `updatedBy`, and
   * tagged 'admin_set'. There is no third option: an annual figure is either one
   * the owner typed or one that does not exist.
   */
  annualAmountMinor: number | null;
  annualCurrency: string | null;
  updatedBy: string;
  notes?: string | null;
}

export type WritePricePeriodOfferResult =
  | { ok: true; offer: PricePeriodOffer }
  | { ok: false; refusal: string };

/**
 * MONEY BOUNDARY. The amount arrives from an HTTP body, so it is validated here and
 * nowhere else. `Number()` / `parseInt` / `parseFloat` are NOT used for arithmetic:
 * the value must already be an integer-valued number, it is bounded by
 * MAX_SAFE_INTEGER, and it is handed to SQLite unchanged. No arithmetic is performed
 * on it at any point in this file.
 */
export function writePricePeriodOffer(
  args: WritePricePeriodOfferArgs,
): WritePricePeriodOfferResult {
  if (!isKnownScopeKey(args.scopeKey)) {
    return {
      ok: false,
      refusal:
        "That price could not be identified, so no billing-period choice was saved. Nothing was changed.",
    };
  }

  const updatedBy = args.updatedBy.trim();
  if (updatedBy.length === 0) {
    /* An unattributed pricing decision is not auditable, and R158.1 treats a value
       whose origin cannot be read as not configured. */
    return {
      ok: false,
      refusal:
        "This change was not saved because the platform could not record who made it, so nothing was changed. Sign in again and retry.",
    };
  }

  let amountMinor: number | null = null;
  let currency: string | null = null;
  let derivation: AnnualDerivation = "unset";

  /* EXPLICIT NULL TEST (R176.1). A missing amount is not compared with, coerced to
     or defaulted to a number. */
  if (args.annualAmountMinor !== null) {
    const raw = args.annualAmountMinor;
    if (typeof raw !== "number" || !Number.isInteger(raw)) {
      return {
        ok: false,
        refusal:
          "The annual price must be a whole number of cents. Nothing was changed.",
      };
    }
    if (raw < 0) {
      return { ok: false, refusal: "An annual price cannot be negative. Nothing was changed." };
    }
    if (raw > Number.MAX_SAFE_INTEGER) {
      return {
        ok: false,
        refusal:
          "That annual price is larger than this platform can record exactly, so it was not saved. Nothing was changed.",
      };
    }
    const ccy = (args.annualCurrency ?? "").trim().toUpperCase();
    if (ccy.length === 0) {
      /* R156.2 — no currency may be assumed. An amount with no stated currency is
         not a price. */
      return {
        ok: false,
        refusal:
          "An annual price needs a currency, and none was given. Nothing was changed. No currency is ever assumed.",
      };
    }
    amountMinor = raw;
    currency = ccy;
    derivation = "admin_set";
  }

  try {
    ensurePricePeriodOfferSchema();
    const db = wave45Db();
    db.prepare(
      `INSERT INTO ${PRICE_PERIOD_OFFER_TABLE}
         (scope_key, annual_offered, monthly_offered, annual_amount_minor,
          annual_currency, annual_derivation, updated_at, updated_by, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(scope_key) DO UPDATE SET
         annual_offered      = excluded.annual_offered,
         monthly_offered     = excluded.monthly_offered,
         annual_amount_minor = excluded.annual_amount_minor,
         annual_currency     = excluded.annual_currency,
         annual_derivation   = excluded.annual_derivation,
         updated_at          = excluded.updated_at,
         updated_by          = excluded.updated_by,
         notes               = excluded.notes`,
    ).run(
      args.scopeKey,
      args.annualOffered ? 1 : 0,
      args.monthlyOffered ? 1 : 0,
      amountMinor,
      currency,
      derivation,
      new Date().toISOString(),
      updatedBy,
      args.notes ?? null,
    );
  } catch (err) {
    const detail = String((err as Error).message ?? "");
    return {
      ok: false,
      refusal: fitToGate(
        (budget) =>
          budget > 0
            ? `This billing-period choice was not saved (${detail.slice(0, budget)}). Nothing was changed.`
            : "This billing-period choice was not saved. Nothing was changed.",
        DEFAULT_ID_FRAGMENT_BUDGETS,
      ),
    };
  }

  return { ok: true, offer: resolvePricePeriodOffer(args.scopeKey) };
}
