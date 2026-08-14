/**
 * v25.46.1 — Consortium Partners SPV deployment fee store (DB-backed, no
 * in-memory state).
 *
 * APD-018 (corrected scope). Wraps the single FLAT `platform_fees` row that
 * backs Section B of the Consortium Partners admin fee tab:
 *   - consortium.spv_deployment_fee   flat fee per SPV deployment
 *
 * NOTE (Ozan correction #1): the earlier `consortium.partner_application_fee`
 * is NO LONGER IN SCOPE and was removed. The recurring Partner Subscription
 * Tiers (Section A, keys `consortium.subscription.*`) are owned by the generic
 * server/subscriptionTierStore.ts, NOT here. This module owns only the one
 * flat SPV deployment fee.
 *
 * Tier-isolation (Sacred Tier 9 / UPDATED Rule 77): the Consortium fee tab is
 * isolated from the Capavate (Rule 76) and Collective fee tabs. The Capavate fee
 * structure is untouched and the Collective application fee is owned by
 * server/lib/collectiveApplicationFeeResolver.ts.
 *
 * Zero in-memory (Tier 3 #27): reads go RAW through
 * server/lib/spvDeploymentFeeSource.ts; the write goes through
 * platformFeesStore.setFee (which invalidates its own 60s read-through cache).
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║ WAVE 46 — OWNER RULINGS **R21** ("100% dynamic. Nothing static or hard    ║
 * ║ coded."), **R22** (one source) and **R6** (honest refusal).               ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * WHAT THIS FILE USED TO DO — **LIVE DEAD VALUE, now removed:**
 *
 *     const amountMinor =
 *       fee.updatedByUserId === null && fee.amountMinor === 0
 *         ? fallbackMinor                      // ← 500000, compiled in
 *         : fee.amountMinor;
 *
 * `platformFeesStore.getFee()` resolves a genuinely MISSING row to
 * `amountMinor = 0`, and this file promoted that 0 to a **compiled-in $5,000**
 * so "the admin editor never shows $0.00 on an un-seeded DB". Both branches of
 * that trade are now forbidden: R6 forbids the $0, and R21 forbids the
 * hardcoded substitute. An un-seeded DB has NO PRICE, and the honest rendering
 * of no price is an explicit refusal — not $0.00 and not a number this build
 * invented. Wave 45 deleted exactly this shape (`fallbackMinor`) from
 * `server/lib/partnerTiers.ts`; this is the same deletion on the sibling
 * surface.
 *
 * SO: the read is now RAW and TOTAL — `getSpvDeploymentFeeOrNull()` returns
 * `null` when the row cannot answer, and `getSpvDeploymentFee()` THROWS
 * `SpvDeploymentFeeUnconfiguredError`. Callers must say "Not provided".
 *
 * AND: this is the **same row** `chargeSpvDeploymentFee` now bills from (R22).
 * The console read and the charge read are literally the same function call, so
 * they cannot drift again.
 */
import { setFee } from "./platformFeesStore";
import {
  AUTHORITATIVE_SPV_DEPLOYMENT_FEE_KEY,
  resolveAuthoritativeSpvDeploymentFee,
  requireAuthoritativeSpvDeploymentFee,
  SpvDeploymentFeeUnconfiguredError,
  type AuthoritativeSpvDeploymentFee,
} from "./lib/spvDeploymentFeeSource";

export const CONSORTIUM_SPV_DEPLOYMENT_FEE_KEY = AUTHORITATIVE_SPV_DEPLOYMENT_FEE_KEY;

export { SpvDeploymentFeeUnconfiguredError };

/**
 * ⚠️ **NOT A FALLBACK AND NOT A DEFAULT — A DOCUMENTED HISTORICAL FACT.**
 *
 * `500000` ($5,000) is the amount of the SEED row written by
 * `migrations/0068_v25_46_1_consortium_fees.sql` and by the `connection.ts`
 * bootstrap. It is retained as an exported constant ONLY so that tests which
 * assert "a freshly-seeded DB serves the seeded amount" (see
 * `server/__tests__/v25_46_1_fee_tiers.test.ts` → "GET returns the seeded
 * $5,000 flat fee") can name the seed they are asserting about instead of
 * repeating a bare literal.
 *
 * **NO READ PATH IN THIS TREE CONSULTS IT.** It is not a fallback, it cannot be
 * returned when the row is absent, and `server/__tests__/
 * wave46_one_price_one_source.test.ts` proves it: with the row deleted, every
 * read refuses and no caller can observe this number. The live production value
 * is the owner's **$240.00**, held in the DB, and no code in this build knows
 * that number either.
 */
export const DEFAULT_CONSORTIUM_SPV_DEPLOYMENT_FEE_MINOR = 500000; // seed row, never a fallback

export interface ConsortiumFee {
  amountMinor: number;
  currency: string;
  updatedAt: string;
  updatedBy: string | null;
}

function toConsortiumFee(fee: AuthoritativeSpvDeploymentFee): ConsortiumFee {
  return {
    amountMinor: fee.amountMinor,
    currency: fee.currency,
    updatedAt: fee.updatedAt,
    updatedBy: fee.updatedByUserId,
  };
}

/**
 * Read the flat SPV deployment fee (DB-driven, raw, uncached).
 *
 * Returns `null` when the authoritative row cannot answer — absent,
 * soft-deleted, or an untouched zero no operator ever entered. **Display
 * surfaces must use this and render an explicit refusal on `null` (R6).**
 */
export function getSpvDeploymentFeeOrNull(): ConsortiumFee | null {
  const fee = resolveAuthoritativeSpvDeploymentFee();
  return fee ? toConsortiumFee(fee) : null;
}

/**
 * Read the flat SPV deployment fee, or THROW `SpvDeploymentFeeUnconfiguredError`.
 * Use on any path that must produce a price (e.g. freezing a fee onto a
 * deployment record). Never returns an invented amount.
 */
export function getSpvDeploymentFee(): ConsortiumFee {
  return toConsortiumFee(requireAuthoritativeSpvDeploymentFee());
}

/** Upsert the flat SPV deployment fee. amountMinor must be a non-negative
 *  integer (minor units). This is the ONE write; `chargeSpvDeploymentFee` reads
 *  back the very row it lands in (R22). */
export function setSpvDeploymentFee(args: {
  amountMinor: number;
  currency?: string;
  updatedByUserId: string | null;
}): ConsortiumFee {
  const fee = setFee({
    key: CONSORTIUM_SPV_DEPLOYMENT_FEE_KEY,
    amountMinor: args.amountMinor,
    currency: args.currency,
    updatedByUserId: args.updatedByUserId,
  });
  /* Re-read raw rather than trusting the write's echo: this proves the row the
   * console just wrote is the row every reader will see. Falls back to the echo
   * only if the raw read is unavailable (e.g. no rawDb in a unit harness). */
  const readBack = resolveAuthoritativeSpvDeploymentFee();
  if (readBack) return toConsortiumFee(readBack);
  return {
    amountMinor: fee.amountMinor,
    currency: fee.currency || "USD",
    updatedAt: fee.updatedAt,
    updatedBy: fee.updatedByUserId,
  };
}
