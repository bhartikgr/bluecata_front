/**
 * server/collectiveMembershipDeactivationStore.ts
 *
 * W1 H6 (v26.2.0) — FAIL-CLOSED membership deactivation.
 *
 * Problem: when Collective billing flips to `cancelled` / `past_due` (Stripe or
 * Airwallex webhook, or the renewal worker), membership deactivation was
 * "best-effort" — if `collectiveMembershipStore.deactivate()` threw, the billing
 * state moved on while `requireCollectiveMember` kept ADMITTING the user (billing
 * state and gate state diverged).
 *
 * Fix: this durable queue records an intent-to-deactivate BEFORE attempting it.
 * While an unresolved row exists for a user, the membership gate DENIES access
 * (see requireCollectiveMember). Deactivation is retried until the membership row
 * is actually suspended, then the queue row is resolved. On billing recovery
 * (→ active), open markers are cleared.
 *
 * This is a STATE-TABLE-ONLY mechanism. It never touches Airwallex / payment
 * gateway code (rule #14) or the sacred money core.
 */
import { randomBytes } from "node:crypto";
import { rawDb } from "./db/connection";
import * as collectiveMembershipStore from "./collectiveMembershipStore";
import { log } from "./lib/logger";

export type DeactivationTargetStatus = "cancelled" | "past_due";

const RETRY_BACKOFF_MS = 5 * 60 * 1000; // 5 minutes between retries

/** Idempotent inline schema self-heal (mirrors migration 0109). */
export function ensureCollectiveMembershipDeactivationTables(): void {
  try {
    const db = rawDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS collective_membership_deactivation_queue (
        id TEXT PRIMARY KEY,
        billing_id TEXT,
        user_id TEXT NOT NULL,
        target_status TEXT NOT NULL CHECK (target_status IN ('cancelled', 'past_due')),
        source TEXT NOT NULL,
        reason TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL,
        last_error TEXT,
        resolved_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_collective_deactivation_open_user_status
        ON collective_membership_deactivation_queue(user_id, target_status)
        WHERE resolved_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_collective_deactivation_next
        ON collective_membership_deactivation_queue(resolved_at, next_attempt_at);
      CREATE INDEX IF NOT EXISTS idx_collective_deactivation_user
        ON collective_membership_deactivation_queue(user_id, resolved_at);
    `);
  } catch (err) {
    log.warn(
      "[collectiveMembershipDeactivationStore] ensure tables failed:",
      (err as Error).message,
    );
  }
}

/**
 * Does the user have an unresolved deactivation marker? If YES, the membership
 * gate must DENY (fail-closed). On any read error, return TRUE (fail-closed):
 * we would rather briefly deny a member than leave access open after a billing
 * cancellation. A recovery to `active` clears the marker and restores access.
 */
export function hasOpenMembershipDeactivation(userId: string): boolean {
  if (!userId) return false;
  try {
    const row = rawDb()
      .prepare(
        `SELECT 1 FROM collective_membership_deactivation_queue
          WHERE user_id = ? AND resolved_at IS NULL LIMIT 1`,
      )
      .get(userId);
    return !!row;
  } catch (err) {
    // Table may not exist yet on a very fresh process — self-heal then re-check
    // once; if it still fails, fail-closed.
    try {
      ensureCollectiveMembershipDeactivationTables();
      const row = rawDb()
        .prepare(
          `SELECT 1 FROM collective_membership_deactivation_queue
            WHERE user_id = ? AND resolved_at IS NULL LIMIT 1`,
        )
        .get(userId);
      return !!row;
    } catch {
      log.warn(
        "[collectiveMembershipDeactivationStore] hasOpen read failed; failing closed for",
        userId,
      );
      return true;
    }
  }
}

/**
 * W1 H6 (round 2 — verifier fix) — INDEPENDENT fail-closed billing check.
 *
 * Defense-in-depth for the fail-open the deciding verifier found: the webhook /
 * worker paths commit the billing status transition (cancelled/past_due) BEFORE
 * calling enforceMembershipDeactivation, so if the queue marker write itself
 * fails, no open marker exists and the gate could still admit via stale active
 * membership state. This helper lets the gate ALSO deny whenever the user's
 * latest billing row is cancelled/past_due — a signal that is persisted by the
 * billing transition itself, so it does not depend on the marker write. Reads a
 * STATE table only (never Airwallex/payment code). Fails CLOSED on read error.
 */
export function hasCancelledOrPastDueBilling(userId: string): boolean {
  if (!userId) return false;
  try {
    const row = rawDb()
      .prepare(
        `SELECT 1 FROM collective_memberships_billing
          WHERE user_id = ?
            AND status IN ('cancelled', 'past_due')
            AND (deleted_at IS NULL OR deleted_at = '')
          LIMIT 1`,
      )
      .get(userId);
    return !!row;
  } catch {
    // Unknown billing state after a read error → fail CLOSED (deny). A genuinely
    // active member recovers as soon as the read succeeds again.
    return true;
  }
}

/** Clear (resolve) all open deactivation markers for a user — call on billing recovery. */
export function resolvePendingMembershipDeactivationsForUser(userId: string, actor: string): void {
  if (!userId) return;
  try {
    ensureCollectiveMembershipDeactivationTables();
    const now = new Date().toISOString();
    rawDb()
      .prepare(
        `UPDATE collective_membership_deactivation_queue
            SET resolved_at = ?, updated_at = ?, last_error = ?
          WHERE user_id = ? AND resolved_at IS NULL`,
      )
      .run(now, now, `resolved_by:${actor}`, userId);
  } catch (err) {
    log.warn(
      "[collectiveMembershipDeactivationStore] resolvePending failed for",
      userId,
      "-",
      (err as Error).message,
    );
  }
}

/**
 * Record intent-to-deactivate (BEFORE attempting), then attempt deactivation.
 * - Queue upsert MUST succeed; if it throws, we throw
 *   MEMBERSHIP_DEACTIVATION_STATE_FAILED so the caller does NOT report a clean
 *   billing transition while access might remain open.
 * - If deactivate() succeeds → mark the row resolved.
 * - If deactivate() fails → leave the row OPEN (gate denies), bump attempts.
 * Returns { ok:true, pending } where pending=true means access is fail-closed
 * via the open marker until a retry succeeds.
 */
export function enforceMembershipDeactivation(args: {
  userId: string;
  billingId?: string | null;
  targetStatus: DeactivationTargetStatus;
  source: string;
  reason?: string | null;
}): { ok: true; pending: boolean } {
  const { userId, billingId = null, targetStatus, source, reason = null } = args;
  ensureCollectiveMembershipDeactivationTables();

  const now = new Date().toISOString();
  const nextAttempt = now; // eligible for immediate retry
  const db = rawDb();

  // 1) Upsert an OPEN marker BEFORE attempting deactivation. The unique partial
  //    index collapses repeats to a single open row per (user, target_status).
  try {
    const existing = db
      .prepare(
        `SELECT id FROM collective_membership_deactivation_queue
          WHERE user_id = ? AND target_status = ? AND resolved_at IS NULL LIMIT 1`,
      )
      .get(userId, targetStatus) as { id: string } | undefined;

    if (existing) {
      db.prepare(
        `UPDATE collective_membership_deactivation_queue
            SET billing_id = ?, source = ?, reason = ?, updated_at = ?
          WHERE id = ?`,
      ).run(billingId, source, reason, now, existing.id);
    } else {
      const id = `cmdq_${randomBytes(8).toString("hex")}`;
      db.prepare(
        `INSERT INTO collective_membership_deactivation_queue
           (id, billing_id, user_id, target_status, source, reason,
            attempts, next_attempt_at, last_error, resolved_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL, NULL, ?, ?)`,
      ).run(id, billingId, userId, targetStatus, source, reason, nextAttempt, now, now);
    }
  } catch (err) {
    // Could not even record intent → do NOT let the caller proceed as if clean.
    log.error(
      "[collectiveMembershipDeactivationStore] queue upsert FAILED (fail-closed):",
      (err as Error).message,
    );
    throw new Error("MEMBERSHIP_DEACTIVATION_STATE_FAILED");
  }

  // 2) Attempt the actual deactivation. Failure keeps the marker OPEN.
  try {
    collectiveMembershipStore.deactivate(userId, source);
    // Success → resolve the marker.
    db.prepare(
      `UPDATE collective_membership_deactivation_queue
          SET resolved_at = ?, updated_at = ?
        WHERE user_id = ? AND target_status = ? AND resolved_at IS NULL`,
    ).run(now, now, userId, targetStatus);
    return { ok: true, pending: false };
  } catch (err) {
    // Deactivation failed — leave OPEN (gate denies), bump attempts/backoff.
    try {
      const retryAt = new Date(Date.now() + RETRY_BACKOFF_MS).toISOString();
      db.prepare(
        `UPDATE collective_membership_deactivation_queue
            SET attempts = attempts + 1, last_error = ?, next_attempt_at = ?, updated_at = ?
          WHERE user_id = ? AND target_status = ? AND resolved_at IS NULL`,
      ).run((err as Error).message, retryAt, now, userId, targetStatus);
    } catch { /* best-effort bookkeeping; marker remains open regardless */ }
    log.warn(
      "[collectiveMembershipDeactivationStore] deactivate failed; access FAIL-CLOSED via open marker for",
      userId,
    );
    return { ok: true, pending: true };
  }
}

/** Retry loop for pending markers (called from the renewal worker path). */
export function processPendingMembershipDeactivations(limit = 50): {
  attempted: number;
  resolved: number;
  failed: number;
} {
  ensureCollectiveMembershipDeactivationTables();
  const now = new Date().toISOString();
  let attempted = 0;
  let resolved = 0;
  let failed = 0;

  let rows: Array<{ id: string; user_id: string; target_status: string; source: string }> = [];
  try {
    rows = rawDb()
      .prepare(
        `SELECT id, user_id, target_status, source
           FROM collective_membership_deactivation_queue
          WHERE resolved_at IS NULL AND next_attempt_at <= ?
          ORDER BY next_attempt_at ASC
          LIMIT ?`,
      )
      .all(now, limit) as typeof rows;
  } catch (err) {
    log.warn(
      "[collectiveMembershipDeactivationStore] processPending read failed:",
      (err as Error).message,
    );
    return { attempted, resolved, failed };
  }

  for (const row of rows) {
    attempted += 1;
    const db = rawDb();
    try {
      collectiveMembershipStore.deactivate(row.user_id, row.source);
      db.prepare(
        `UPDATE collective_membership_deactivation_queue
            SET resolved_at = ?, updated_at = ? WHERE id = ?`,
      ).run(now, now, row.id);
      resolved += 1;
    } catch (err) {
      failed += 1;
      try {
        const retryAt = new Date(Date.now() + RETRY_BACKOFF_MS).toISOString();
        db.prepare(
          `UPDATE collective_membership_deactivation_queue
              SET attempts = attempts + 1, last_error = ?, next_attempt_at = ?, updated_at = ?
            WHERE id = ?`,
        ).run((err as Error).message, retryAt, now, row.id);
      } catch { /* keep open */ }
    }
  }
  return { attempted, resolved, failed };
}
