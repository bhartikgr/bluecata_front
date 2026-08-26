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
/* WAVE 152 · ITEM G — the four `intentional_zero*` columns migration 0200 adds
   live on `platform_fees`, and `server/db/connection.ts` (which mirrors numbered
   migrations for databases opened without the runner) IS SACRED AND FROZEN. The
   parity install therefore happens here, on the store that owns this table, the
   first time anything reads or writes it. Memoised per driver handle. */
import { ensureWave152PricingSchema } from "./lib/applyWave152PricingSchema";

export const COLLECTIVE_APPLICATION_FEE_KEY = "collective_application_fee";

/* `rawDb()` can throw when the process has no database open yet. A schema
   install is never a reason to turn a read into a crash, so the handle is
   fetched defensively and a missing handle simply skips the install; the read
   below then fails or succeeds on its own merits. */
function safeRawDb(): any {
  try {
    return rawDb();
  } catch {
    return null;
  }
}

/* WAVE 144 · ITEM 2 — R108.2 / R95 / R104 item 3: THERE IS NO DEFAULT FEE.

   HISTORY, on the record rather than erased. This module used to carry
   `DEFAULT_FEES`, a substitute amount returned whenever the `platform_fees` row
   was missing or the read threw:

     · originally a literal `250000` ($2,500.00) — the wrong PRODUCT's figure;
     · WAVE 139 replaced that literal with an import of
       `DEFAULT_APPLICATION_FEE_MINOR` (30000). That removed the wrong-product
       number but LEFT A FABRICATED PRICE, which is precisely what R95 forbids
       ("a `?? 240` fallback that substitutes a figure when the real one is
       absent") and what R104 item 3 forbids ("if a fee's row is missing, the
       surface must say so rather than silently substituting a number").
     · Post-build Review 2 found the live consequence: `GET
       /api/admin/platform-fees` published that substitute, so the admin console
       could quote a fee nobody had set.

   A key with NO row also used to resolve to `{ amountMinor: 0 }` — an even worse
   answer, because a confident ZERO reads as "this fee is nil".

   THE RULE NOW: absence is REPORTED, never substituted. `getFee` returns
   `amountMinor: null` / `currency: null` with `source: "missing"` (no row) or
   `source: "unreadable"` (the read threw). It still never throws, so every
   caller keeps failing SOFT — R108.2's requirement is an honest unavailable
   state, not a broken surface. The import of the resolver constant is gone with
   the fallback it fed; the canonical figure lives in exactly one place
   (`server/lib/collectiveApplicationFeeResolver.ts`) and is reached through the
   database, never through this module. */

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

/** WAVE 144 · ITEM 2 — where the answer came from. `db` is the only state that
 *  carries an amount; the other two carry `null` and MUST be rendered as an
 *  unavailable state, never as a figure and never as zero. */
export type PlatformFeeSource = "db" | "missing" | "unreadable";

export interface PlatformFee {
  key: string;
  /** WAVE 144 · ITEM 2 — NULLABLE. `null` means "not on record", not "zero". */
  amountMinor: number | null;
  currency: string | null;
  updatedAt: string | null;
  updatedByUserId: string | null;
  source: PlatformFeeSource;
}

function rowToFee(r: any): PlatformFee {
  return {
    key: r.key,
    amountMinor: r.amount_minor ?? r.amountMinor,
    currency: r.currency,
    updatedAt: r.updated_at ?? r.updatedAt,
    updatedByUserId: r.updated_by_user_id ?? r.updatedByUserId ?? null,
    source: "db",
  };
}

/** An ABSENT fee. No amount, no currency, and the reason it is absent.
 *  Deliberately not exported as a "default": there is nothing default about it. */
function absentFee(key: string, source: "missing" | "unreadable"): PlatformFee {
  return {
    key,
    amountMinor: null,
    currency: null,
    updatedAt: null,
    updatedByUserId: null,
    source,
  };
}

/**
 * Read one fee by key. Reports ABSENCE instead of substituting a number:
 * `source: "missing"` when there is no row, `source: "unreadable"` when the read
 * threw. Never throws (fail SOFT, R108.2) and never invents an amount (R95,
 * R104 item 3).
 *
 * WAVE 152 · ITEM G · G-C7 (R115.2 #7). This read used to ignore `deleted_at`,
 * so the three `consortium.subscription.*` tiers soft-deleted on 2026-08-10 were
 * still servable to any caller. A RETIRED PRICE MUST NOT BE SERVABLE. The filter
 * matches the one `server/subscriptionTierStore.ts` and
 * `server/publicPricingRoutes.ts` already use. A soft-deleted row now returns
 * `absentFee(key, "missing")`, which is the correct meaning: there is no live row.
 */
export function getFee(key: string): PlatformFee {
  ensureWave152PricingSchema(safeRawDb());
  try {
    const row: any = rawDb()
      .prepare(`SELECT * FROM platform_fees WHERE key = ? AND (deleted_at IS NULL OR deleted_at = '')`)
      .get(key);
    if (row) return rowToFee(row);
    return absentFee(key, "missing");
  } catch {
    return absentFee(key, "unreadable");
  }
}

/** List every configured fee, DB-direct on every call (WAVE 131).
 *  WAVE 144 · ITEM 2 — when the table cannot be read this used to return a
 *  ONE-ROW list holding the fabricated default, i.e. an unreadable table was
 *  published to the admin editor as a real price. It now returns the absence
 *  itself, so the console can say the row is not on record. */
export function listFees(): PlatformFee[] {
  ensureWave152PricingSchema(safeRawDb());
  try {
    // WAVE 152 · ITEM G · G-C7 (R115.2 #7) — soft-deleted rows are not listed.
    const rows: any[] = rawDb()
      .prepare(`SELECT * FROM platform_fees WHERE (deleted_at IS NULL OR deleted_at = '') ORDER BY key`)
      .all();
    return rows.map(rowToFee);
  } catch {
    return [absentFee(COLLECTIVE_APPLICATION_FEE_KEY, "unreadable")];
  }
}

/** Upsert one fee. amountMinor must be a non-negative integer.
 *
 *  WAVE 152 · ITEM G · G-C9 (R115.3 Q6, R117.2 Q3) — `intentionalZero`.
 *
 *  A price of 0 is ambiguous in a way that costs money in BOTH directions: read
 *  as a real free price, the platform charges nothing for something it meant to
 *  charge for; read as an absence, a genuinely free product refuses to transact.
 *  The resolver used to guess from `updated_by_user_id IS NULL` — "somebody
 *  touched it, so they meant it" — which a seed stamping `system:seed` defeats,
 *  and which cannot represent an admin deliberately setting a free price at all.
 *
 *  So the declaration is now a COLUMN an administrator writes on purpose, not an
 *  inference. `intentionalZero` is only meaningful when the amount is 0; passing
 *  it with a non-zero amount clears it, because a $240 price is not a declared
 *  free one and leaving a stale flag behind would make the NEXT edit to 0 silently
 *  free. Omitting the argument entirely leaves whatever was already recorded, so
 *  an unrelated currency edit cannot revoke an existing declaration. */
export function setFee(args: {
  key: string;
  amountMinor: number;
  currency?: string;
  updatedByUserId: string | null;
  intentionalZero?: boolean;
  intentionalZeroReason?: string | null;
}): PlatformFee {
  ensureWave152PricingSchema(safeRawDb());
  const amount = Math.max(0, Math.round(args.amountMinor));
  const currency = (args.currency ?? "USD").toUpperCase();
  const updatedAt = new Date().toISOString();
  /* A declaration only exists when it was ASKED FOR, carries a reason, and the
     amount it describes is actually zero. */
  const reason =
    typeof args.intentionalZeroReason === "string" ? args.intentionalZeroReason.trim() : "";
  const declaredZero = amount === 0 && args.intentionalZero === true && reason.length > 0;
  const touchesDeclaration = args.intentionalZero !== undefined || amount !== 0;
  rawDb()
    .prepare(
      `INSERT INTO platform_fees
         (key, amount_minor, currency, updated_at, updated_by_user_id,
          intentional_zero, intentional_zero_reason, intentional_zero_by, intentional_zero_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         amount_minor = excluded.amount_minor,
         currency = excluded.currency,
         updated_at = excluded.updated_at,
         updated_by_user_id = excluded.updated_by_user_id,
         intentional_zero = CASE WHEN ? = 1 THEN excluded.intentional_zero ELSE platform_fees.intentional_zero END,
         intentional_zero_reason = CASE WHEN ? = 1 THEN excluded.intentional_zero_reason ELSE platform_fees.intentional_zero_reason END,
         intentional_zero_by = CASE WHEN ? = 1 THEN excluded.intentional_zero_by ELSE platform_fees.intentional_zero_by END,
         intentional_zero_at = CASE WHEN ? = 1 THEN excluded.intentional_zero_at ELSE platform_fees.intentional_zero_at END`,
    )
    .run(
      args.key,
      amount,
      currency,
      updatedAt,
      args.updatedByUserId,
      declaredZero ? 1 : 0,
      declaredZero ? reason : null,
      declaredZero ? args.updatedByUserId : null,
      declaredZero ? updatedAt : null,
      touchesDeclaration ? 1 : 0,
      touchesDeclaration ? 1 : 0,
      touchesDeclaration ? 1 : 0,
      touchesDeclaration ? 1 : 0,
    );
  // invalidate the read-through cache synchronously on write so
  // consumers see the new value on their next read (invalidate-on-PUT).
  invalidateFeeCache();
  return getFee(args.key);
}
