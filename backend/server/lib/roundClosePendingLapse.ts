/**
 * server/lib/roundClosePendingLapse.ts — v25.48.2 Q13 (Ozan).
 *
 * PARALLEL module (does NOT touch sacred cap-table/ledger math). When a founder
 * finalizes a round close from ANY non-terminal state, any pending — i.e.
 * un-confirmed / open — soft-circle commitments must be closed out and marked
 * `lapsed`, recorded in the audit trail. CONFIRMED / signed commitments
 * (status confirmed | wired | committed) are preserved untouched; already
 * declined/lapsed rows are terminal no-ops.
 *
 * The soft_circles status vocabulary (server/softCircleStore.ts):
 *   intent    → un-confirmed / open   → LAPSED on close
 *   confirmed → founder-confirmed     → PRESERVED
 *   wired     → funds wired           → PRESERVED
 *   committed → signed / committed    → PRESERVED
 *   declined  → terminal              → left as-is
 *
 * Two surfaces:
 *   1. listPendingCommitments(roundId) — read-only preview that drives the
 *      client warning ("N pending commitments will be closed out and marked
 *      lapsed"). No writes.
 *   2. lapsePendingCommitments(roundId, opts) — FAIL-CLOSED batch: a single
 *      transaction flips every intent row to `lapsed`, then appends one audit
 *      row per lapse (post-commit, best-effort). Idempotent — re-running finds
 *      no `intent` rows and lapses nothing.
 *
 * The soft_circles.status column is free-text (SQLite has no enum constraint),
 * so writing "lapsed" is schema-safe and needs no migration.
 */
import { rawDb } from "../db/connection";
import { appendAdminAudit } from "../adminPlatformStore";
import { emitMutation } from "./eventBus";
import { log } from "./logger";

/** Statuses that represent an un-confirmed / open commitment. */
const PENDING_STATUSES = new Set(["intent"]);

export interface PendingCommitment {
  id: string;
  roundId: string;
  companyId: string | null;
  tenantId: string | null;
  investorName: string;
  investorUserId: string | null;
  amount: number;
  amountMinor: number;
  currency: string;
  status: string;
}

function selectPending(roundId: string): PendingCommitment[] {
  const rows = rawDb()
    .prepare(
      "SELECT * FROM soft_circles WHERE round_id = ? AND deleted_at IS NULL AND status = 'intent' ORDER BY created_at ASC",
    )
    .all(roundId) as any[];
  return rows.map((r) => ({
    id: r.id,
    roundId: r.round_id,
    companyId: r.company_id ?? null,
    tenantId: r.tenant_id ?? null,
    investorName: r.investor_name,
    investorUserId: r.investor_user_id ?? null,
    amount: Number(r.amount ?? 0),
    amountMinor: Number(r.amount_minor ?? 0),
    currency: r.currency ?? "USD",
    status: r.status,
  }));
}

/**
 * Read-only. Returns the pending (un-confirmed) soft-circle commitments that a
 * close would lapse. Drives the founder warning. Never mutates.
 *
 * v25.48.2 MF6 (Q13) — FAIL-CLOSED on a read error. Previously this swallowed
 * the error and returned { count: 0 }, silently suppressing the founder warning
 * so a close could proceed as if there were no pending commitments. A read
 * failure now THROWS so the preview route surfaces a non-200 degraded error
 * that BLOCKS confirmation instead of reporting a false zero.
 */
export function listPendingCommitments(roundId: string): {
  count: number;
  totalMinor: number;
  items: PendingCommitment[];
} {
  const items = selectPending(roundId);
  const totalMinor = items.reduce((sum, i) => sum + (i.amountMinor || 0), 0);
  return { count: items.length, totalMinor, items };
}

export interface LapseResult {
  lapsed: number;
  items: PendingCommitment[];
}

/**
 * v25.48.2 MF5 + MF6 (Q13) — lapse every un-confirmed (intent) soft-circle on
 * the round, INLINE (no own transaction) so it can share the caller's close
 * transaction and thus be ATOMIC with the terminal round-state UPDATE. Both the
 * status UPDATEs and the per-row audit appends run within the caller's tx:
 *
 *   - if any UPDATE throws → the whole close rolls back (round stays open),
 *   - if any audit append fails (appendAdminAudit returns the empty-hash
 *     sentinel on a DB write failure) → we THROW, rolling back the entire
 *     close (MF6: audit is part of the success criteria, not best-effort).
 *
 * Confirmed/wired/committed rows are never touched. Idempotent. Returns the
 * lapsed rows so the caller can emit SSE AFTER the tx commits.
 */
export function lapsePendingWithinTx(
  roundId: string,
  opts: { actorUserId?: string | null; reason?: string } = {},
): LapseResult {
  const actor = opts.actorUserId ?? "system:round_close";
  const reason = opts.reason ?? "round_closed";
  const now = new Date().toISOString();

  const pending = selectPending(roundId);
  if (pending.length === 0) return { lapsed: 0, items: [] };

  const db = rawDb();
  const stmt = db.prepare(
    "UPDATE soft_circles SET status = 'lapsed', updated_at = ? WHERE id = ? AND status = 'intent' AND deleted_at IS NULL",
  );
  let affected = 0;
  for (const r of pending) {
    const info = stmt.run(now, r.id);
    affected += Number(info.changes ?? 0);
    // MF6 — the audit append is part of the transaction's success criteria.
    // appendAdminAudit swallows DB errors and returns a sentinel with an empty
    // hash; treat that as a hard failure and throw so the whole close rolls back.
    const entry = appendAdminAudit(
      actor,
      `soft_circle:${r.id}`,
      "soft_circle.lapsed",
      {
        softCircleId: r.id,
        roundId,
        companyId: r.companyId,
        investorUserId: r.investorUserId,
        investorName: r.investorName,
        amountMinor: r.amountMinor,
        currency: r.currency,
        previousStatus: "intent",
        reason,
      },
      r.tenantId ?? undefined,
    );
    if (!entry || !entry.hash) {
      throw new Error(`audit append failed for soft_circle:${r.id} — rolling back close`);
    }
  }

  return { lapsed: affected, items: pending };
}

/** Emit post-commit SSE for lapsed rows. Call ONLY after the close tx commits. */
export function emitLapsedMutations(items: PendingCommitment[]): void {
  for (const r of items) {
    try {
      emitMutation({ aggregate: "softCircle", id: r.id, change: "update", tenantId: r.tenantId ?? undefined });
    } catch { /* non-fatal */ }
  }
}
