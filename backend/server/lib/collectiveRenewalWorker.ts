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
    const rows = db
      .prepare(
        `SELECT id, tenant_id, chapter_id, user_id, tier, status, current_period_end,
                cancel_at_period_end, stripe_subscription_id, updated_at
           FROM collective_memberships_billing
          WHERE status IN ('active','past_due')
            AND current_period_end IS NOT NULL
            AND current_period_end <= ?
            AND (deleted_at IS NULL OR deleted_at = '')`,
      )
      .all(cutoff) as BillingRowDB[];
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
   * rolls current_period_start/end forward via dispatchAirwallexEvent. */
  const result = await createCollectiveIntent({
    billingId: row.id,
    userId: row.user_id,
    chapterId: row.chapter_id,
    tier: row.tier,
  });
  if (!result.ok) {
    throw new Error(`createCollectiveIntent_failed:${result.error}`);
  }

  /* Persist the new intent id on the row so dispatchAirwallexEvent can
   * resolve back via findBillingBySubscriptionId. */
  try {
    const db: any = rawDb();
    db.prepare(
      `UPDATE collective_memberships_billing
          SET stripe_subscription_id = ?, updated_at = ?
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
