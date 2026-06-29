/**
 * v25.46.1 — Consortium Partners SPV deployment fee store (DB-backed, no
 * in-memory state).
 *
 * APD-018 (corrected scope). Wraps the single FLAT `platform_fees` row that
 * backs Section B of the Consortium Partners admin fee tab:
 *   - consortium.spv_deployment_fee   flat fee per SPV deployment ($5,000)
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
 * Zero in-memory (Tier 3 #27): reads/writes go through platformFeesStore
 * (DB-direct + a 60s read-through cache, invalidated on write). The row is
 * seeded by both the bootstrap (server/db/connection.ts) and migration
 * 0068_v25_46_1_consortium_fees.sql, so a fresh deploy / test DB always has a
 * row → the read below never throws.
 *
 * Default (used only if the seed row is genuinely absent — behavior never
 * regresses): SPV deployment flat fee $5,000 (500000 minor units).
 */
import { getFee, setFee, type PlatformFee } from "./platformFeesStore";

export const CONSORTIUM_SPV_DEPLOYMENT_FEE_KEY = "consortium.spv_deployment_fee";

/** Safe fallback — only used if the seeded row is genuinely missing. */
export const DEFAULT_CONSORTIUM_SPV_DEPLOYMENT_FEE_MINOR = 500000; // $5,000

export interface ConsortiumFee {
  amountMinor: number;
  currency: string;
  updatedAt: string;
  updatedBy: string | null;
}

function feeToConsortiumFee(
  fee: PlatformFee,
  fallbackMinor: number,
): ConsortiumFee {
  // platformFeesStore.getFee() resolves a genuinely missing row to
  // amountMinor=0 (the consortium key is NOT in platformFeesStore.DEFAULT_FEES
  // by design — it is owned here). Promote that to the documented consortium
  // default so the admin editor never shows $0.00 on an un-seeded DB.
  const amountMinor =
    fee.updatedByUserId === null && fee.amountMinor === 0
      ? fallbackMinor
      : fee.amountMinor;
  return {
    amountMinor,
    currency: fee.currency || "USD",
    updatedAt: fee.updatedAt,
    updatedBy: fee.updatedByUserId,
  };
}

/** Read the flat SPV deployment fee (DB-driven). */
export function getSpvDeploymentFee(): ConsortiumFee {
  return feeToConsortiumFee(
    getFee(CONSORTIUM_SPV_DEPLOYMENT_FEE_KEY),
    DEFAULT_CONSORTIUM_SPV_DEPLOYMENT_FEE_MINOR,
  );
}

/** Upsert the flat SPV deployment fee. amountMinor must be a non-negative
 *  integer (minor units). */
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
  return feeToConsortiumFee(fee, DEFAULT_CONSORTIUM_SPV_DEPLOYMENT_FEE_MINOR);
}
