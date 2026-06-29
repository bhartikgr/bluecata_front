/**
 * v25.46.1 — Generic subscription-tier store (DB-backed, no in-memory state).
 *
 * APD-018. Backs the recurring multi-tier fee tables in BOTH new admin fee
 * sections:
 *   - Collective → Cap Table Investor Membership Subscription
 *       key prefix: "collective.member_subscription."
 *   - Consortium Partners → Partner Subscription Tiers
 *       key prefix: "consortium.subscription."
 *
 * Tier-isolation (Sacred Tier 9 / Rule 77): a single generic store, but every
 * call is SCOPED to one prefix ("family"), so the two sections can never read or
 * mutate each other's rows. The flat fees (collective_application_fee,
 * consortium.spv_deployment_fee) are owned elsewhere and are NOT subscription
 * tiers — they are never returned by listTiers().
 *
 * SEPARATE + PARALLEL to the Capavate founder/investor subscription flow
 * (Sacred Rule 76): this store does NOT touch capavate_subscriptions, the
 * pricing tiers tables, paymentGatewayAdapter, or canonicalPlanResolver. It only
 * reads/writes the platform_fees table.
 *
 * Storage (additive only — migration 0068 + connection.ts bootstrap):
 *   platform_fees(
 *     key TEXT PK,            -- "<prefix>.<tier_slug>"
 *     amount_minor INTEGER,   -- TRUE minor units (cents); $499/mo == 49900
 *     currency TEXT,
 *     updated_at TEXT,
 *     updated_by_user_id TEXT,
 *     billing_period TEXT,    -- v25.46.1 additive col; 'monthly' when NULL
 *     deleted_at TEXT         -- v25.46.1 additive col; soft-delete (NULL = live)
 *   )
 *
 * Zero in-memory (Tier 3 #27): every read/write is DB-direct via rawDb(). We do
 * NOT use platformFeesStore's 60s cache here because tier CRUD (create/delete)
 * changes the ROW SET (not just one value), and the admin editor must see writes
 * immediately on the next read; DB-direct keeps it canonical and restart-safe.
 */
import { rawDb } from "./db/connection";

/** Canonical family prefixes. The trailing dot is part of the key namespace. */
export const COLLECTIVE_MEMBER_SUBSCRIPTION_PREFIX = "collective.member_subscription.";
export const CONSORTIUM_SUBSCRIPTION_PREFIX = "consortium.subscription.";

export type TierFamily =
  | typeof COLLECTIVE_MEMBER_SUBSCRIPTION_PREFIX
  | typeof CONSORTIUM_SUBSCRIPTION_PREFIX;

export const DEFAULT_BILLING_PERIOD = "monthly";

export interface SubscriptionTier {
  /** Full platform_fees key, e.g. "consortium.subscription.partner_pro". */
  key: string;
  /** Slug only (key with the family prefix stripped), e.g. "partner_pro". */
  slug: string;
  amountMinor: number;
  currency: string;
  billingPeriod: string;
  updatedAt: string;
  updatedByUserId: string | null;
}

function rowToTier(r: any, prefix: string): SubscriptionTier {
  const key: string = r.key;
  return {
    key,
    slug: key.startsWith(prefix) ? key.slice(prefix.length) : key,
    amountMinor: r.amount_minor ?? 0,
    currency: r.currency || "USD",
    billingPeriod: r.billing_period || DEFAULT_BILLING_PERIOD,
    updatedAt: r.updated_at ?? new Date(0).toISOString(),
    updatedByUserId: r.updated_by_user_id ?? null,
  };
}

/** Validate a tier slug: lowercase alnum + underscore, 1..64 chars. */
export function isValidTierSlug(slug: unknown): slug is string {
  return typeof slug === "string" && /^[a-z0-9_]{1,64}$/.test(slug);
}

/** List the LIVE (not soft-deleted) tiers for one family, ordered by key. */
export function listTiers(prefix: TierFamily): SubscriptionTier[] {
  try {
    const rows: any[] = rawDb()
      .prepare(
        `SELECT * FROM platform_fees
           WHERE key LIKE ? AND (deleted_at IS NULL OR deleted_at = '')
           ORDER BY key`,
      )
      .all(`${prefix}%`);
    return rows.map((r) => rowToTier(r, prefix));
  } catch {
    return [];
  }
}

/** Read one tier by full key (LIVE only). Returns null if missing/deleted. */
export function getTier(prefix: TierFamily, slug: string): SubscriptionTier | null {
  if (!isValidTierSlug(slug)) return null;
  const key = `${prefix}${slug}`;
  try {
    const row: any = rawDb()
      .prepare(
        `SELECT * FROM platform_fees
           WHERE key = ? AND (deleted_at IS NULL OR deleted_at = '')`,
      )
      .get(key);
    return row ? rowToTier(row, prefix) : null;
  } catch {
    return null;
  }
}

/** Create OR update (upsert) one tier. amountMinor must be a non-negative
 *  integer (minor units). If the row was previously soft-deleted, this
 *  RESURRECTS it (deleted_at → NULL). */
export function upsertTier(args: {
  prefix: TierFamily;
  slug: string;
  amountMinor: number;
  currency?: string;
  billingPeriod?: string;
  updatedByUserId: string | null;
}): SubscriptionTier {
  if (!isValidTierSlug(args.slug)) {
    throw new Error("invalid_tier_slug");
  }
  const amount = Math.max(0, Math.round(args.amountMinor));
  if (!Number.isSafeInteger(amount)) throw new Error("amount_out_of_range");
  const currency = (args.currency ?? "USD").toUpperCase();
  const billingPeriod = (args.billingPeriod ?? DEFAULT_BILLING_PERIOD).toLowerCase();
  const updatedAt = new Date().toISOString();
  const key = `${args.prefix}${args.slug}`;
  rawDb()
    .prepare(
      `INSERT INTO platform_fees
         (key, amount_minor, currency, updated_at, updated_by_user_id, billing_period, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(key) DO UPDATE SET
         amount_minor       = excluded.amount_minor,
         currency           = excluded.currency,
         updated_at         = excluded.updated_at,
         updated_by_user_id = excluded.updated_by_user_id,
         billing_period     = excluded.billing_period,
         deleted_at         = NULL`,
    )
    .run(key, amount, currency, updatedAt, args.updatedByUserId, billingPeriod);
  const tier = getTier(args.prefix, args.slug);
  if (!tier) throw new Error("upsert_failed");
  return tier;
}

/** Soft-delete one tier (sets deleted_at). Idempotent; returns true if a LIVE
 *  row existed and was deleted, false if it was already absent/deleted. No row
 *  is ever physically removed (no silent drops; reversible). */
export function softDeleteTier(prefix: TierFamily, slug: string): boolean {
  if (!isValidTierSlug(slug)) return false;
  const key = `${prefix}${slug}`;
  const deletedAt = new Date().toISOString();
  const info = rawDb()
    .prepare(
      `UPDATE platform_fees
         SET deleted_at = ?, updated_at = ?
         WHERE key = ? AND (deleted_at IS NULL OR deleted_at = '')`,
    )
    .run(deletedAt, deletedAt, key);
  return info.changes > 0;
}
