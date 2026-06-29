/**
 * v25.45.4 L-2 — Platform fees store (DB-backed, narrow scope).
 *
 * This store manages exactly ONE fee key: "collective_application_fee" (formerly
 * the $2,500 hardcode). The schema + these accessors are intentionally
 * key-generic (read/write any key in platform_fees with ZERO schema change), but
 * the Capavate fee structure is managed in its ORIGINAL locations
 * (/admin/application-fee, /admin/commission-rates, /admin/partner-fees) — see
 * Sacred Tier 9 / Rule 76. The Consortium Partners fee keys (v25.46.1) are
 * wrapped by server/consortiumFeesStore.ts, not here.
 *
 * v25.46.1 NOTE: the v25.46 Track 4 fee kinds (subscription_tier.*,
 * application_fee.accept, per_deal.close_bps) were reverted byte-for-byte to the
 * pre-v25.46 working state per the founder request (APD-017). Only the original
 * collective_application_fee key remains here.
 *
 * DB is the read source (Tier 3 #27 "zero in-memory, 100% DB-driven"). A 60s
 * read-through cache sits in front of the DB; the DB remains the canonical
 * persisted state (the cache is a pure read accelerator and is invalidated
 * synchronously on every write via setFee()). This satisfies Tier 3 #27: state
 * survives restart because it lives in platform_fees, the cache is rebuilt on
 * first read after restart.
 */
import { rawDb } from "./db/connection";

export const COLLECTIVE_APPLICATION_FEE_KEY = "collective_application_fee";

/** Default used only if the seed row is somehow absent — matches the legacy
 *  $2,500 hardcode so behavior never regresses. */
const DEFAULT_FEES: Record<string, { amountMinor: number; currency: string }> = {
  [COLLECTIVE_APPLICATION_FEE_KEY]: { amountMinor: 250000, currency: "USD" },
};

// ── v25.45.4 L-2 — 60s read-through cache (invalidate-on-write) ────────────
const CACHE_TTL_MS = 60_000;
let _feeCache: { fees: PlatformFee[]; at: number } | null = null;

/** Drop the cache so the next read re-pulls from the DB. Called on every write
 *  and exposed for admin invalidate-on-PUT + tests. */
export function invalidateFeeCache(): void {
  _feeCache = null;
}

export interface PlatformFee {
  key: string;
  amountMinor: number;
  currency: string;
  updatedAt: string;
  updatedByUserId: string | null;
}

function rowToFee(r: any): PlatformFee {
  return {
    key: r.key,
    amountMinor: r.amount_minor ?? r.amountMinor,
    currency: r.currency,
    updatedAt: r.updated_at ?? r.updatedAt,
    updatedByUserId: r.updated_by_user_id ?? r.updatedByUserId ?? null,
  };
}

/** Read one fee by key. Falls back to the safe default if no row exists. */
export function getFee(key: string): PlatformFee {
  try {
    const row: any = rawDb().prepare(`SELECT * FROM platform_fees WHERE key = ?`).get(key);
    if (row) return rowToFee(row);
  } catch {
    /* fall through to default */
  }
  const d = DEFAULT_FEES[key] ?? { amountMinor: 0, currency: "USD" };
  return {
    key,
    amountMinor: d.amountMinor,
    currency: d.currency,
    updatedAt: new Date(0).toISOString(),
    updatedByUserId: null,
  };
}

/** List every configured fee. Served through the 60s read-through cache; the DB
 *  remains the canonical state. */
export function listFees(): PlatformFee[] {
  const now = Date.now();
  if (_feeCache && now - _feeCache.at < CACHE_TTL_MS) {
    return _feeCache.fees;
  }
  try {
    const rows: any[] = rawDb().prepare(`SELECT * FROM platform_fees ORDER BY key`).all();
    const fees = rows.map(rowToFee);
    _feeCache = { fees, at: now };
    return fees;
  } catch {
    return [getFee(COLLECTIVE_APPLICATION_FEE_KEY)];
  }
}

/** Upsert one fee. amountMinor must be a non-negative integer. */
export function setFee(args: {
  key: string;
  amountMinor: number;
  currency?: string;
  updatedByUserId: string | null;
}): PlatformFee {
  const amount = Math.max(0, Math.round(args.amountMinor));
  const currency = (args.currency ?? "USD").toUpperCase();
  const updatedAt = new Date().toISOString();
  rawDb()
    .prepare(
      `INSERT INTO platform_fees (key, amount_minor, currency, updated_at, updated_by_user_id)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         amount_minor = excluded.amount_minor,
         currency = excluded.currency,
         updated_at = excluded.updated_at,
         updated_by_user_id = excluded.updated_by_user_id`,
    )
    .run(args.key, amount, currency, updatedAt, args.updatedByUserId);
  // invalidate the read-through cache synchronously on write so
  // consumers see the new value on their next read (invalidate-on-PUT).
  invalidateFeeCache();
  return getFee(args.key);
}
