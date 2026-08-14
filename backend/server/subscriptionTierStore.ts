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
import { ensureWave7AliasRetired } from "./lib/applyWave7AliasRetirement";
import { ensureWave7bAliasesRetired } from "./lib/applyWave7bAliasRetirement";

/* ==========================================================================
 * WAVE 7 X-C3 — bootstrap heal for the stale `partner_enterprise` alias row.
 *
 * THIS IS THE SINK. `listTiers()` below is the ONLY thing that decides which
 * partner subscription tiers the admin editor shows: the page renders one
 * editable amount field per row it returns (AdminFeesConsolidated.tsx:1005).
 * So "remove the alias row AND its display" is one change here, not two —
 * there is no hardcoded tier list anywhere to also edit, which is the payoff
 * of the all-DB-driven rule.
 *
 * The heal is needed because the SACRED bootstrap (connection.ts:1920) re-seeds
 * the alias row into every fresh database, so migration 0163 alone would fix
 * upgraded databases and silently regress new ones. Memoised, fail-soft, same
 * shape as server/wave9ReportingStore.ts:42-51.
 * ======================================================================== */

/* WAVE 7B A-21 extends the SAME heal to `partner_basic` and `partner_pro`,
 * which connection.ts:1918-1919 re-seeds from the same v25.46.1 block. Owner
 * ruling: "partner_basic and partner_pro are stale exactly like
 * partner_enterprise … fix all three." Wired HERE, at the one sink, and not at
 * a second one — a second heal site would be the duplicate-writer shape. */

let _aliasRetirementEnsured = false;
function ensureAliasRetirement(): void {
  if (_aliasRetirementEnsured) return;
  _aliasRetirementEnsured = true;
  try {
    ensureWave7AliasRetired(rawDb() as never);
  } catch {
    /* fail-soft: the migration runner is the primary path */
  }
  try {
    ensureWave7bAliasesRetired(rawDb() as never);
  } catch {
    /* fail-soft: the migration runner is the primary path */
  }
}

/** Test hook — lets a suite re-run the heal against a fresh :memory: db. */
export function _resetWave7AliasRetirementGuardForTests(): void {
  _aliasRetirementEnsured = false;
}

/** WAVE 7B A-21 alias — same latch, named for the item that also uses it. */
export function _resetWave7bAliasRetirementGuardForTests(): void {
  _aliasRetirementEnsured = false;
}

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
  ensureAliasRetirement();
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
  ensureAliasRetirement();
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
  /* ── WAVE 45 (R3) — ONE NUMBER, ONE SOURCE ────────────────────────────────
   *
   * This admin surface writes the consortium subscription price into
   * `platform_fees`. Since WAVE 45 the price a partner is CHARGED, and the price
   * the public /consortium/pricing page ADVERTISES, both resolve from
   * `partner_tier_price` instead — that is the table the owner's flat $240.00
   * annual fee lives in, and the only place a price may come from.
   *
   * Left alone, that would split one number across two tables: an admin could
   * edit the price here and watch nothing change anywhere, which is exactly the
   * defect this wave was sent to remove (and exactly the split already found
   * between the SPV deployment fee's two sources). So the edit is PROJECTED onto
   * the authoritative row. The admin surface is unchanged; its write now lands
   * where the reads look.
   *
   * Three deliberate properties:
   *   • the cadence written is the one the platform actually SELLS, read from
   *     partner_pricing_model_config — not a compiled-in "monthly". Editing the
   *     price of a cadence nobody can buy would be a silent no-op.
   *   • a FROZEN tier's trigger will reject this UPDATE and the error propagates.
   *     Freeze has to hold from every surface, including this one, or it is
   *     decorative.
   *   • only the five canonical slugs are projected. The eight orphan slugs from
   *     migration 0153 are an open owner question (OQ-W45-1) and are not touched.
   */
  projectTierPriceToPartnerTierPrice(args.prefix, args.slug, amount, currency, args.updatedByUserId);

  const tier = getTier(args.prefix, args.slug);
  if (!tier) throw new Error("upsert_failed");
  return tier;
}

/** The five canonical capability tiers — the taxonomy every live partner is on. */
const WAVE45_CANONICAL_SLUGS = new Set([
  "catalyst",
  "builder",
  "amplifier",
  "nexus",
  "founding_member",
]);

function projectTierPriceToPartnerTierPrice(
  prefix: TierFamily,
  slug: string,
  amountMinor: number,
  currency: string,
  updatedByUserId: string | null,
): void {
  if (prefix !== CONSORTIUM_SUBSCRIPTION_PREFIX) return;
  if (!WAVE45_CANONICAL_SLUGS.has(slug)) return;

  const db = rawDb();
  // Before migration 0185 has run (or in a harness that builds a partial schema)
  // there is nothing to project onto. Absence is not an error; a WRONG write
  // would be.
  const present = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'partner_tier_price'`)
    .get() as { name: string } | undefined;
  if (!present) return;

  let cadence = "annual";
  try {
    const cfg = db
      .prepare(
        `SELECT annual_purchasable, monthly_purchasable FROM partner_pricing_model_config WHERE id = 'singleton'`,
      )
      .get() as { annual_purchasable: number; monthly_purchasable: number } | undefined;
    if (cfg && cfg.annual_purchasable !== 1 && cfg.monthly_purchasable === 1) cadence = "monthly";
  } catch {
    // Config table absent — annual is the R3 model, and it is also the cadence
    // the price rows are seeded on, so this default cannot silently mis-target.
  }

  const now = new Date().toISOString();
  // NOTE: amountMinor is carried through as the integer it already is. No /100,
  // no *100 — the value is in minor units on both sides of this write.
  db.prepare(
    `INSERT INTO partner_tier_price
       (id, tier_slug, cadence, price_minor, currency, derivation, active, created_at, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, 'admin_set', 1, ?, ?, ?)
     ON CONFLICT (tier_slug, cadence) DO UPDATE SET
       price_minor = excluded.price_minor,
       currency    = excluded.currency,
       derivation  = 'admin_set',
       active      = 1,
       updated_at  = excluded.updated_at,
       updated_by  = excluded.updated_by`,
  ).run(
    `ptp_${slug}_${cadence}`,
    slug,
    cadence,
    amountMinor,
    currency,
    now,
    now,
    updatedByUserId ?? "admin",
  );
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
