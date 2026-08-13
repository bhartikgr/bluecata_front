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
import {
  enforceMembershipDeactivation,
  processPendingMembershipDeactivations,
} from "../collectiveMembershipDeactivationStore";

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

/* ═══════════════════════════════════════════════════════════════════════════
 * WAVE 14 / FE-16 — THE WORKER IS DB-CONFIGURED, NOT ENV-GATED.
 *
 * WHAT WAS WRONG. Four numbers governed real money movement and none of them
 * was visible or changeable in the product:
 *   COLLECTIVE_RENEWAL_WORKER_ENABLED  — whether renewals happen at all
 *   COLLECTIVE_RENEWAL_POLL_MS         — how often
 *   COLLECTIVE_RENEWAL_LEAD_SEC        — how far ahead of period end
 *   MAX_CONSECUTIVE_FAILURES = 3       — a bare literal, plus a 30-minute
 *                                        debounce hardcoded inside tick()
 * The standing rule is all-DB-driven with no hardcoding, and an owner cannot
 * turn renewal billing on or off by editing a shell environment.
 *
 * WHAT CHANGED. `collective_renewal_worker_config` (migration 0153, row
 * id='singleton', already seeded — this wave added NO schema for FE-16, because
 * re-seeding an existing fact is a second declaration of it) is now the
 * authority. Every read goes through `renewalWorkerConfig()`.
 *
 * THE ENV VAR IS NOT DELETED, AND THAT IS DELIBERATE. `env_override_allowed` on
 * the row decides whether it is honoured. Removing the emergency off-switch
 * outright would mean an operator with a runaway billing worker and no console
 * access has no way to stop it. So: the DB row is authoritative; the env var can
 * only act when the row PERMITS it; and when it acts, it is logged by name so
 * the divergence is never silent.
 *
 * FAIL-CLOSED. If the config row is missing or unreadable the worker reports
 * DISABLED. A billing worker that defaults to ON when it cannot read its own
 * configuration is the worst of the available failure modes.
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface RenewalWorkerConfig {
  enabled: boolean;
  pollIntervalMs: number;
  leadWindowSec: number;
  maxConsecutiveFailures: number;
  quietAfterWriteMin: number;
  envOverrideAllowed: boolean;
  /** How `enabled` was decided, so the admin surface can explain it. */
  source: "db_row" | "env_override" | "missing_row_fail_closed";
  updatedAt: string | null;
  updatedBy: string | null;
}

/* The DEFAULTS here match the CHECK-constrained defaults in migration 0153
   exactly (60000 / 86400 / 3 / 30) and are used ONLY when the row cannot be
   read — in which case `enabled` is false regardless, so they never cause a
   charge. They are not a second pricing model. */
const FAIL_CLOSED_CONFIG: RenewalWorkerConfig = {
  enabled: false,
  pollIntervalMs: 60_000,
  leadWindowSec: 24 * 60 * 60,
  maxConsecutiveFailures: 3,
  quietAfterWriteMin: 30,
  envOverrideAllowed: false,
  source: "missing_row_fail_closed",
  updatedAt: null,
  updatedBy: null,
};

/** Read the singleton config row. No caching: an admin toggling the row must
 *  take effect on the next sweep, not after a process restart. */
export function renewalWorkerConfig(): RenewalWorkerConfig {
  let row: any;
  try {
    row = (rawDb() as any)
      .prepare(
        `SELECT enabled, poll_interval_ms, lead_window_sec, max_consecutive_failures,
                quiet_after_write_min, env_override_allowed, updated_at, updated_by
           FROM collective_renewal_worker_config
          WHERE id = 'singleton'`,
      )
      .get();
  } catch (err) {
    log.warn(
      `[collectiveRenewalWorker] FE-16: config row unreadable (${(err as Error).message}); worker DISABLED (fail-closed).`,
    );
    return { ...FAIL_CLOSED_CONFIG };
  }
  if (!row) {
    log.warn("[collectiveRenewalWorker] FE-16: no singleton config row; worker DISABLED (fail-closed).");
    return { ...FAIL_CLOSED_CONFIG };
  }

  const envOverrideAllowed = !!row.env_override_allowed;
  const dbEnabled = !!row.enabled;
  const envSaysOn = process.env.COLLECTIVE_RENEWAL_WORKER_ENABLED === "1";
  const envSaysOff = process.env.COLLECTIVE_RENEWAL_WORKER_ENABLED === "0";

  let enabled = dbEnabled;
  let source: RenewalWorkerConfig["source"] = "db_row";
  if (envOverrideAllowed && (envSaysOn || envSaysOff) && envSaysOn !== dbEnabled) {
    /* The override is LOUD. A worker running against its stored configuration
       without saying so is exactly the invisible state FE-16 exists to end. */
    enabled = envSaysOn;
    source = "env_override";
    log.warn(
      `[collectiveRenewalWorker] FE-16: COLLECTIVE_RENEWAL_WORKER_ENABLED=${envSaysOn ? "1" : "0"} OVERRIDES the stored config (enabled=${dbEnabled}). ` +
        `The row permits this (env_override_allowed=1). Set env_override_allowed=0 to make the database final.`,
    );
  }

  return {
    enabled,
    pollIntervalMs: Number(row.poll_interval_ms),
    leadWindowSec: Number(row.lead_window_sec),
    maxConsecutiveFailures: Number(row.max_consecutive_failures),
    quietAfterWriteMin: Number(row.quiet_after_write_min),
    envOverrideAllowed,
    source,
    updatedAt: row.updated_at ?? null,
    updatedBy: row.updated_by ?? null,
  };
}

export function isRenewalWorkerEnabled(): boolean {
  return renewalWorkerConfig().enabled;
}

/**
 * Start the worker if enabled. Idempotent. Returns true if started.
 */
export function startCollectiveRenewalWorker(): boolean {
  /* ONE read of the config for the whole start decision, so the interval the
     timer uses is guaranteed to be the interval that was logged. */
  const cfg = renewalWorkerConfig();
  if (!cfg.enabled) return false;
  if (timer) return true;
  log.info(
    `[collectiveRenewalWorker] starting — poll ${cfg.pollIntervalMs}ms, lead ${cfg.leadWindowSec}s, ` +
      `maxFailures ${cfg.maxConsecutiveFailures}, quiet ${cfg.quietAfterWriteMin}min (source=${cfg.source}, ` +
      `updated ${cfg.updatedAt ?? "never"} by ${cfg.updatedBy ?? "unknown"})`,
  );
  timer = setInterval(() => { void tick(); }, cfg.pollIntervalMs);
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
    /* FE-16 — the sweep reads its own window from the config row, so an admin
       change takes effect on the NEXT SWEEP rather than at the next restart. */
    const cfg = renewalWorkerConfig();
    const nowSec = Math.floor(Date.now() / 1000);
    const cutoff = nowSec + cfg.leadWindowSec;
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
    /* FE-16 — was a hardcoded 30 minutes. Now `quiet_after_write_min`. */
    const renewalDebounceMs = cfg.quietAfterWriteMin * 60 * 1000;
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
        if (next >= cfg.maxConsecutiveFailures) {
          await markPastDue(row, (err as Error).message);
          consecutiveFailures.delete(row.id);
        }
      }
    }
    // W1 H6 (v26.2.0) — retry any pending fail-closed deactivations (state-table
    // only; no Airwallex/payment code). Resolves markers once deactivate succeeds.
    try {
      processPendingMembershipDeactivations();
    } catch (err) {
      log.warn("[collectiveRenewalWorker.tick] pending-deactivation retry failed:", (err as Error).message);
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
  // W1 H6 (v26.2.0) — FAIL-CLOSED: record intent-to-deactivate BEFORE attempting,
  // so a deactivate() failure leaves the gate denying via the open marker.
  enforceMembershipDeactivation({
    userId: row.user_id,
    billingId: row.id,
    targetStatus: "cancelled",
    source: "system:collective_renewal_worker",
    reason: "cancel_at_period_end",
  });
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
  // W1 H6 (v26.2.0) — FAIL-CLOSED: record intent-to-deactivate BEFORE attempting.
  enforceMembershipDeactivation({
    userId: row.user_id,
    billingId: row.id,
    targetStatus: "past_due",
    source: "system:collective_renewal_worker",
    reason,
  });
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
