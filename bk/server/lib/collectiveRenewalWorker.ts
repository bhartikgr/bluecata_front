/**
 * server/lib/collectiveRenewalWorker.ts — v25.4
 *
 * Recurring renewal scheduler for Collective membership billing.
 *
 * Airwallex does not ship a hosted subscription primitive equivalent to
 * Stripe Subscriptions. Each annual (or monthly) renewal is driven by this
 * worker: every poll interval it scans `collective_memberships_billing`
 * for rows whose `current_period_end` is within the renewal lead window
 * and whose status is `active` (i.e. not cancelled).
 *
 * For each due row:
 *   - If `cancel_at_period_end = 1`, flip status to `cancelled` and emit
 *     `collective.billing.cancelled`.
 *   - Else mint a fresh Airwallex payment intent with the same merchant
 *     order id (so the webhook resolves back to the same billing row),
 *     mark the row `past_due` until the webhook flips it back to `active`,
 *     and append a `collective.billing.renewal_scheduled` audit entry.
 *
 * The worker is single-process; multi-instance deploys should disable it
 * on all but one instance (env: COLLECTIVE_RENEWAL_WORKER_ENABLED=1). It
 * is intentionally OFF by default in dev/test.
 *
 * Idempotency:
 *   - We use the row's id + the cycle start timestamp as the idempotency
 *     key so a worker restart in the middle of a sweep cannot double-charge.
 *   - The Airwallex gateway itself accepts an idempotencyKey and rejects
 *     duplicates within a 24h window.
 *
 * Failure handling:
 *   - On gateway error we leave the row in `active` and let the next sweep
 *     retry; exponential backoff is owned by Airwallex's retry contract.
 *   - On three consecutive failures we flip to `past_due` so the admin
 *     console + UI signal a real problem.
 */

import { createCollectiveIntent } from "./airwallexCollective";
import { rawDb } from "../db/connection";
import { appendAdminAudit } from "../adminPlatformStore";
import { log } from "./logger";
// v25.21 Lane D NC-002/NC-003 fix — when the worker cancels a billing row or
// marks it past_due, the corresponding collective membership MUST also be
// deactivated. Without this the gate `requireCollectiveMember` still passes
// for a non-paying ex-member because it keys off `collectiveMembershipStore.isActive`.
import * as collectiveMembershipStore from "../collectiveMembershipStore";

interface BillingRowDB {
  id: string;
  tenant_id: string;
  chapter_id: string;
  user_id: string;
  tier: "basic" | "standard" | "premium";
  status: string;
  current_period_end: number | null;
  cancel_at_period_end: number;
  stripe_subscription_id: string | null; /* legacy column; holds intent id */
  updated_at: string;
}

let timer: NodeJS.Timeout | null = null;
let inFlight = false;
let consecutiveFailures = new Map<string, number>();

const POLL_INTERVAL_MS = Number(process.env.COLLECTIVE_RENEWAL_POLL_MS ?? 60_000);
const LEAD_WINDOW_SEC = Number(process.env.COLLECTIVE_RENEWAL_LEAD_SEC ?? 24 * 60 * 60); /* renew 24h before period end */
const MAX_CONSECUTIVE_FAILURES = 3;

export function isRenewalWorkerEnabled(): boolean {
  return process.env.COLLECTIVE_RENEWAL_WORKER_ENABLED === "1";
}

/**
 * Start the worker if enabled. Idempotent. Returns true if started.
 */
export function startCollectiveRenewalWorker(): boolean {
  if (!isRenewalWorkerEnabled()) return false;
  if (timer) return true;
  log.info(`[collectiveRenewalWorker] starting — poll ${POLL_INTERVAL_MS}ms, lead ${LEAD_WINDOW_SEC}s`);
  timer = setInterval(() => { void tick(); }, POLL_INTERVAL_MS);
  /* Don't keep the event loop alive during tests. */
  if (typeof timer.unref === "function") timer.unref();
  return true;
}

/**
 * Stop the worker. Used by tests + graceful shutdown.
 */
export function stopCollectiveRenewalWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/**
 * Run a single sweep. Exposed for tests + manual admin trigger.
 */
export async function tick(): Promise<{ swept: number; renewed: number; cancelled: number; failed: number }> {
  if (inFlight) return { swept: 0, renewed: 0, cancelled: 0, failed: 0 };
  inFlight = true;
  let swept = 0, renewed = 0, cancelled = 0, failed = 0;
  try {
    const db: any = rawDb();
    const nowSec = Math.floor(Date.now() / 1000);
    const cutoff = nowSec + LEAD_WINDOW_SEC;
    /* v25.21 Lane A NC-001 fix (REWORK after triple-verify): the sweep now
     * matches `status='active'` ONLY. `past_due` is a terminal state set by
     * `markPastDue` after MAX_CONSECUTIVE_FAILURES gateway errors — it must
     * NOT be re-selected by the sweep, otherwise the worker keeps minting
     * fresh intents against a row that's already been escalated. Webhook
     * delivery recovers `past_due` rows independently (`invoice.paid` flips
     * them back to `active`).
     *
     * Additionally, we exclude rows whose `updated_at` is within the last
     * 30 minutes — a heuristic to skip rows where `renewMembership` just
     * minted an intent and we're now waiting for the Airwallex webhook to
     * advance `current_period_end`. Without this lookback the same `active`
     * row stays re-selectable until the webhook lands (which can take
     * minutes), spamming fresh intents each tick. Combined with the
     * deterministic idempotency key (NC-002), this prevents both real
     * double-charges (gateway dedup) AND the audit-log spam (worker dedup). */
    const renewalDebounceMs = 30 * 60 * 1000;
    const debounceCutoff = new Date(Date.now() - renewalDebounceMs).toISOString();
    const rows = db
      .prepare(
        `SELECT id, tenant_id, chapter_id, user_id, tier, status, current_period_end,
                cancel_at_period_end, stripe_subscription_id, updated_at
           FROM collective_memberships_billing
          WHERE status = 'active'
            AND current_period_end IS NOT NULL
            AND current_period_end <= ?
            AND (deleted_at IS NULL OR deleted_at = '')
            AND (updated_at IS NULL OR updated_at <= ?)`,
      )
      .all(cutoff, debounceCutoff) as BillingRowDB[];
    swept = rows.length;

    for (const row of rows) {
      try {
        if (row.cancel_at_period_end === 1) {
          await cancelMembership(row);
          cancelled++;
          consecutiveFailures.delete(row.id);
        } else {
          await renewMembership(row);
          renewed++;
          consecutiveFailures.delete(row.id);
        }
      } catch (err) {
        failed++;
        const next = (consecutiveFailures.get(row.id) ?? 0) + 1;
        consecutiveFailures.set(row.id, next);
        log.warn(
          `[collectiveRenewalWorker] row ${row.id} attempt #${next} failed: ${(err as Error).message}`,
        );
        if (next >= MAX_CONSECUTIVE_FAILURES) {
          await markPastDue(row, (err as Error).message);
          consecutiveFailures.delete(row.id);
        }
      }
    }
  } catch (err) {
    log.error("[collectiveRenewalWorker.tick] unexpected error:", (err as Error).message);
  } finally {
    inFlight = false;
  }
  return { swept, renewed, cancelled, failed };
}

async function renewMembership(row: BillingRowDB): Promise<void> {
  /* Mint a fresh Airwallex payment intent. The merchant_order_id stays
   * the same so the webhook resolves back to this billing row, which then
   * rolls current_period_start/end forward via dispatchAirwallexEvent.
   *
   * v25.21 Lane A NC-002 fix — pass a deterministic idempotency anchor
   * derived from the billing cycle's `current_period_end` so a worker
   * restart mid-sweep, or a re-selection caused by a slow webhook, cannot
   * mint a second live charge against the same cycle. Airwallex's 24h
   * duplicate-rejection window now actually fires.
   */
  /* Coerce the numeric epoch to a string so the deterministic key is a
   * stable text token. `no_cycle` is a deliberate fallback for rows that
   * somehow lack `current_period_end`; the sweep query above filters those
   * out, so we only see this fallback in pathological data. */
  const cycleAnchor = String(row.current_period_end ?? "no_cycle");
  const result = await createCollectiveIntent({
    billingId: row.id,
    userId: row.user_id,
    chapterId: row.chapter_id,
    tier: row.tier,
    idempotencyAnchor: cycleAnchor,
  });
  if (!result.ok) {
    throw new Error(`createCollectiveIntent_failed:${result.error}`);
  }

  /* v25.21 Lane A NC-001 fix (REWORK after triple-verify): persist the new
   * intent id and bump `updated_at` to now. The sweep is now narrowed to
   * `status='active'` only AND skips rows whose updated_at falls inside the
   * 30-minute debounce window (see tick()). That combination prevents the
   * same active row from being re-selected before the Airwallex webhook
   * lands and rolls `current_period_end` forward. We deliberately do NOT
   * flip status to `past_due` here — that state is reserved for
   * MAX_CONSECUTIVE_FAILURES (markPastDue) and is terminal until webhook
   * recovery. Conflating "awaiting-webhook" with "payment-failed-3x" is
   * exactly the false premise the triple-verifier flagged.
   */
  try {
    const db: any = rawDb();
    db.prepare(
      `UPDATE collective_memberships_billing
          SET stripe_subscription_id = ?,
              updated_at = ?
        WHERE id = ?`,
    ).run(result.intent.id, new Date().toISOString(), row.id);
  } catch { /* non-fatal */ }

  try {
    appendAdminAudit(
      "system:collective_renewal_worker",
      `collective_billing:${row.id}`,
      "collective.billing.renewal_scheduled",
      {
        billingId: row.id,
        chapterId: row.chapter_id,
        userId: row.user_id,
        tier: row.tier,
        intentId: result.intent.id,
        hostedPaymentPageUrl: result.hostedPaymentPageUrl,
        gateway: "airwallex",
      },
    );
  } catch { /* non-fatal */ }
}

async function cancelMembership(row: BillingRowDB): Promise<void> {
  const ts = new Date().toISOString();
  try {
    const db: any = rawDb();
    db.prepare(
      `UPDATE collective_memberships_billing
          SET status = 'cancelled', updated_at = ?, cancel_at_period_end = 0
        WHERE id = ?`,
    ).run(ts, row.id);
  } catch (err) {
    throw new Error(`db_update_failed:${(err as Error).message}`);
  }
  /* v25.21 Lane D NC-002 fix — deactivate the collective membership row so
   * `requireCollectiveMember` no longer admits this user. Without this the
   * gate keeps passing because it checks `collectiveMembershipStore.isActive`,
   * not the billing row's status. Best-effort (the billing transition above
   * is the source of truth; membership deactivation is a downstream gate). */
  try {
    collectiveMembershipStore.deactivate(
      row.user_id,
      "system:collective_renewal_worker",
    );
  } catch (deactivateErr) {
    log.warn(
      "[collectiveRenewalWorker.cancelMembership] membership deactivate failed (non-fatal):",
      (deactivateErr as Error).message,
    );
  }
  try {
    appendAdminAudit(
      "system:collective_renewal_worker",
      `collective_billing:${row.id}`,
      "collective.billing.cancelled_at_period_end",
      {
        billingId: row.id,
        chapterId: row.chapter_id,
        userId: row.user_id,
        tier: row.tier,
        gateway: "airwallex",
      },
    );
  } catch { /* non-fatal */ }
}

async function markPastDue(row: BillingRowDB, reason: string): Promise<void> {
  const ts = new Date().toISOString();
  try {
    const db: any = rawDb();
    db.prepare(
      `UPDATE collective_memberships_billing
          SET status = 'past_due', updated_at = ?
        WHERE id = ?`,
    ).run(ts, row.id);
  } catch { /* non-fatal */ }
  /* v25.21 Lane D NC-003 fix — three consecutive renewal failures = stop
   * granting collective access. Deactivate the membership row so the gate
   * (`requireCollectiveMember` / `collectiveMembershipStore.isActive`) closes.
   * If a subsequent successful webhook lands, dispatchAirwallexEvent's
   * activate path re-enables the membership; this is the documented
   * recovery channel. */
  try {
    collectiveMembershipStore.deactivate(
      row.user_id,
      "system:collective_renewal_worker",
    );
  } catch (deactivateErr) {
    log.warn(
      "[collectiveRenewalWorker.markPastDue] membership deactivate failed (non-fatal):",
      (deactivateErr as Error).message,
    );
  }
  try {
    appendAdminAudit(
      "system:collective_renewal_worker",
      `collective_billing:${row.id}`,
      "collective.billing.past_due",
      {
        billingId: row.id,
        chapterId: row.chapter_id,
        userId: row.user_id,
        tier: row.tier,
        reason,
        gateway: "airwallex",
      },
    );
  } catch { /* non-fatal */ }
}

/** Test-only — clear in-memory state. */
export function _resetWorkerState(): void {
  consecutiveFailures.clear();
}
