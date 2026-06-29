/**
 * v25.45 ROUND 7 — cap-table co-membership helper.
 *
 * POLICY (Ozan, 2026-06-25): cap-table members are KNOWN COUNTERPARTIES who
 * are able to collaborate and communicate between themselves to help their
 * portfolio companies. The privacy resolver therefore needs a cheap, reliable
 * way to ask: "are these two users both on at least one shared cap table?"
 *
 * Co-membership is derived from the durable `captable_commits` ledger (the
 * SACRED cap-table source of truth — we only READ it here, never mutate). Two
 * users are co-members iff there exists a single company on whose cap table
 * BOTH appear as a committed holder.
 *
 * ── APD-015 (v25.46, 2026-06-28) — spec-literal vs canonical-schema note ─────
 * The v25.46 locked spec describes the Investor↔Investor cap-table-share
 * unblock as "queryable via `cap_table_holders.investor_id`". GPT-5.5's verify
 * pass flagged that this code instead queries `captable_commits.investor_id`.
 * RESOLUTION: there is NO `cap_table_holders` table in the canonical schema —
 * the durable cap-table ledger is `captable_commits` (append-only, hash-chained;
 * migrations/0007_captable_commits.sql), which carries the `investor_id` and
 * `company_id` columns this join needs. `captable_commits.investor_id` IS the
 * cap-table-holder identity. Switching to a non-existent `cap_table_holders`
 * table would break the unblock. We therefore keep the ledger query (functionally
 * equivalent to the spec's intent) and register the deviation as APD-015 in
 * CAPAVATE_SACRED_FILES.md. Cap-table-share unblock uses
 * `captable_commits.investor_id` (durable ledger) instead of the spec-literal
 * `cap_table_holders.investor_id`. Functionally equivalent.
 *
 * Fail-closed: any DB error, missing table, or malformed input returns FALSE
 * (treated as "not co-members" → the resolver masks to "Private Investor").
 */
import { rawDb } from "../db/connection";

const isValidId = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

/**
 * Returns TRUE iff `userIdA` and `userIdB` are BOTH committed holders on at
 * least one shared company cap table.
 *
 * - Self-pairs (A === B) are NOT a counterparty relationship → FALSE.
 * - Only non-deleted, committed commits count.
 * - Fails closed (FALSE) on any error.
 */
export function areCoMembersOnAnyCapTable(userIdA: string, userIdB: string): boolean {
  if (!isValidId(userIdA) || !isValidId(userIdB)) return false;
  const a = userIdA.trim();
  const b = userIdB.trim();
  // A user being on a cap table with themselves is not a counterparty pair.
  if (a === b) return false;
  try {
    const db: any = rawDb();
    const row = db
      .prepare(
        `SELECT 1 AS hit
           FROM captable_commits ca
           JOIN captable_commits cb
             ON ca.company_id = cb.company_id
          WHERE ca.investor_id = ?
            AND cb.investor_id = ?
            AND ca.state = 'committed'
            AND cb.state = 'committed'
            AND ca.deleted_at IS NULL
            AND cb.deleted_at IS NULL
          LIMIT 1`,
      )
      .get(a, b) as { hit?: number } | undefined;
    return !!row?.hit;
  } catch {
    // Fail-closed: no proof of shared cap table → treat as non-counterparty.
    return false;
  }
}
