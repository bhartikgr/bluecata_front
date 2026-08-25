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
 * DB is the read source (Tier 3 #27 "zero in-memory, 100% DB-driven").
 *
 * WAVE 131 (R95 — pricing must be real-time): the 60-second module-scope
 * read-through cache that used to sit in front of the DB IS GONE. It was a pure
 * read accelerator for a table with a handful of rows, and its cost was that an
 * owner who changed a price could watch the old one keep being served for up to
 * a minute — with the client's 30-second `staleTime` on top of it. Every read
 * now goes to `platform_fees`, so an admin write is visible on the NEXT request.
 * `invalidateFeeCache()` is retained as a no-op for its existing callers (the
 * admin PUT path and tests) rather than removed, so no caller breaks and the
 * intent stays greppable.
 */
import { rawDb } from "./db/connection";
import {
  DEFAULT_APPLICATION_FEE_MINOR,
  DEFAULT_APPLICATION_FEE_CURRENCY,
} from "./lib/collectiveApplicationFeeResolver";

export const COLLECTIVE_APPLICATION_FEE_KEY = "collective_application_fee";

/* WAVE 139 · RULINGS R101 + R102 — this fallback used to hardcode 250000
   ($2,500.00) "so behavior never regresses". The owner ruled on 2026-08-25 that
   the canonical Collective application fee is $300.00 = 30000 TRUE minor units,
   so preserving the legacy figure here was preserving a DEFECT: had the seed row
   ever been absent, this store would have quoted $2,500.00 while the resolver
   quoted $300.00 — the exact cross-screen disagreement R101 was raised to end.

   It is no longer a literal at all. R95/R102 require ONE authoritative source per
   price, so the value is imported from the canonical resolver constant rather
   than re-typed here. A second copy of a price is how these defects are born.
   Import direction is safe: the resolver imports only `rawDb`, never this store,
   so there is no cycle. */
const DEFAULT_FEES: Record<string, { amountMinor: number; currency: string }> = {
  [COLLECTIVE_APPLICATION_FEE_KEY]: {
    amountMinor: DEFAULT_APPLICATION_FEE_MINOR,
    currency: DEFAULT_APPLICATION_FEE_CURRENCY,
  },
};

// ── WAVE 131 — NO READ CACHE ───────────────────────────────────────────────
// There is deliberately no module-scope cache here any more. A price is not a
// value it is safe to serve stale, and the previous 60-second window meant the
// number an owner had just typed was NOT the number the platform quoted.

/** Retained no-op: there is no cache left to drop, and every read is DB-direct.
 *  Kept exported so the admin PUT path and existing tests keep compiling, and so
 *  "where is the fee cache invalidated" still has a greppable answer. */
export function invalidateFeeCache(): void {
  /* intentionally empty — see the WAVE 131 note above */
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

/** List every configured fee, DB-direct on every call (WAVE 131). */
export function listFees(): PlatformFee[] {
  try {
    const rows: any[] = rawDb().prepare(`SELECT * FROM platform_fees ORDER BY key`).all();
    return rows.map(rowToFee);
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
