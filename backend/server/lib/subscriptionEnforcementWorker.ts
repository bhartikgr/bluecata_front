// server/lib/subscriptionEnforcementWorker.ts
//
// WAVE 11 / EN-8 — grace period and non-payment enforcement, persona-agnostic.
//
// ============================================================================
// THE FINDING, VERIFIED AT SOURCE
// ============================================================================
// The config key `collective.partner_membership.grace_days_after_expiry` is
// SEEDED — `server/db/connection.ts:936`, value `0`, history id
// `pch_gen_grace_days` — and is read by NOTHING outside the seed itself and the
// tests that assert the seed exists. Confirmed by
// `grep -rn 'grace_days_after_expiry' server/ client/`: seed, seed-shape tests,
// and no consumer. DEF-076 ("grace configured but never enforced") and DEF-077
// ("the only lifecycle worker is Collective-scoped") are both real.
//
// TRAP 2 APPLIES HERE: the key ALREADY EXISTED. This is a WIRING job for the
// config, and a BUILD job for the sweep. Stated per the standing instruction.
//
// ============================================================================
// SETTLED RULING OBSERVED — REPORTING AND STATUS ONLY
// ============================================================================
// Suspension here changes `partner_subscription.status` and emits an event. It
// does NOT touch permissions, navigation, route access, or the PT-5 fence. A
// suspended subject is REPORTED as suspended and can be FILTERED on; whether any
// surface reacts to that is a separate, owner-gated decision. This worker will
// not become a backdoor access-control system.
//
// ============================================================================
// SINK, AND THE SECOND PATH
// ============================================================================
// SINK: `tick()` -> `partnerSubscriptionStore.setStatus`, which is the single
// writer of `partner_subscription.status` (every other transition — activation,
// plan change, cancellation — funnels through the same function, so every
// transition lands in `partner_subscription_event`).
// SECOND PATH CHECKED: `collectiveRenewalWorker.markPastDue` also moves a
// membership to `past_due`, on `collective_memberships_billing` — a DIFFERENT
// table for a different subject. It is untouched, and this worker deliberately
// does not read that table: two workers writing one row is how double
// enforcement happens. The proving test asserts this worker leaves
// `collective_memberships_billing` byte-for-byte unchanged.
//
// FAIL CLOSED ON MISSING CONFIG. If the grace-days row is absent, the worker
// does NOT fall back to a hardcoded number and does NOT suspend anybody: it
// reports `configMissing: true` and sweeps nothing. Guessing a grace window is
// how you cut off a paying customer.
import { rawDb } from "../db/connection";
import { log } from "./logger";
import {
  addCycle,
  getById,
  setStatus,
  type PartnerSubscriptionRow,
} from "./partnerSubscriptionStore";

export const GRACE_CONFIG_KEY = "collective.partner_membership.grace_days_after_expiry";
const MS_PER_DAY = 86_400_000;
/** Same 30-minute debounce the Collective worker uses, same reason. */
const DEBOUNCE_MS = 30 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;
let inFlight = false;

export interface GraceConfig {
  graceDays: number;
  configMissing: boolean;
  rawValue: string | null;
}

/**
 * Read the grace window from the DB. No hardcoded default: `configMissing`
 * is the signal, and the caller refuses to enforce when it is set.
 */
export function readGraceConfig(): GraceConfig {
  const db: any = rawDb();
  try {
    /* The column is `value_json` (server/db/connection.ts:948, STRICT table with
       a `json_valid(value_json)` CHECK) — NOT `value`. Verified at source; a
       `SELECT value` here would throw and be swallowed into configMissing,
       which is exactly the silent-vacuity failure this wave was warned about. */
    const row = db
      .prepare(`SELECT value_json, value_type FROM platform_config WHERE key = ?`)
      .get(GRACE_CONFIG_KEY) as { value_json?: unknown } | undefined;
    if (!row || row.value_json === null || row.value_json === undefined) {
      return { graceDays: 0, configMissing: true, rawValue: null };
    }
    const raw =
      typeof row.value_json === "string" ? row.value_json : JSON.stringify(row.value_json);
    /* The seed stores the JSON number `0`; an object-wrapped value is accepted
       too so an admin console write in either shape is honoured. */
    let parsed: unknown = raw;
    try {
      parsed = JSON.parse(raw);
    } catch {
      /* bare, non-JSON string — use as-is */
    }
    const n =
      typeof parsed === "number"
        ? parsed
        : typeof parsed === "object" && parsed !== null && "value" in (parsed as any)
          ? Number((parsed as any).value)
          : Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      return { graceDays: 0, configMissing: true, rawValue: raw };
    }
    return { graceDays: Math.floor(n), configMissing: false, rawValue: raw };
  } catch (err) {
    log.warn(`[wave11/EN-8] grace config read failed: ${(err as Error).message}`);
    return { graceDays: 0, configMissing: true, rawValue: null };
  }
}

export interface SweepResult {
  swept: number;
  enteredGrace: number;
  suspended: number;
  cancelledAtPeriodEnd: number;
  skipped: number;
  configMissing: boolean;
  graceDays: number;
  decisions: Array<{
    subscriptionId: string;
    subjectKind: string;
    subjectId: string;
    from: string;
    to: string;
    reason: string;
  }>;
}

function emptyResult(cfg: GraceConfig): SweepResult {
  return {
    swept: 0,
    enteredGrace: 0,
    suspended: 0,
    cancelledAtPeriodEnd: 0,
    skipped: 0,
    configMissing: cfg.configMissing,
    graceDays: cfg.graceDays,
    decisions: [],
  };
}

/**
 * One sweep. Exported for the admin trigger AND the proving test — a worker you
 * can only observe through a timer is a worker you cannot falsify.
 *
 * The state machine, in order:
 *   active|past_due, period ended, cancellation scheduled -> cancelled
 *   active|past_due, period ended, graceDays > 0          -> grace (grace_until set)
 *   active|past_due, period ended, graceDays == 0         -> suspended
 *   grace, grace_until passed                             -> suspended
 */
export function tick(opts: { nowIso?: string; ignoreDebounce?: boolean } = {}): SweepResult {
  const cfg = readGraceConfig();
  if (inFlight) return emptyResult(cfg);
  inFlight = true;
  try {
    if (cfg.configMissing) {
      log.warn(
        `[wave11/EN-8] ${GRACE_CONFIG_KEY} is not readable; enforcement sweep skipped (fail closed)`,
      );
      return emptyResult(cfg);
    }
    const now = opts.nowIso ?? new Date().toISOString();
    const nowMs = new Date(now).getTime();
    const debounceCutoff = new Date(nowMs - DEBOUNCE_MS).toISOString();
    const db: any = rawDb();
    const result = emptyResult(cfg);

    let rows: any[];
    try {
      rows = db
        .prepare(
          `SELECT * FROM partner_subscription
            WHERE status IN ('active','past_due','grace')
              AND (
                    (current_period_end IS NOT NULL AND current_period_end <= ?)
                 OR (status = 'grace' AND grace_until IS NOT NULL AND grace_until <= ?)
              )
              AND (? = 1 OR updated_at IS NULL OR updated_at <= ?)`,
        )
        .all(now, now, opts.ignoreDebounce ? 1 : 0, debounceCutoff) as any[];
    } catch (err) {
      log.warn(`[wave11/EN-8] sweep query failed: ${(err as Error).message}`);
      return result;
    }
    result.swept = rows.length;

    for (const raw of rows) {
      const row = getById(String(raw.id)) as PartnerSubscriptionRow | null;
      if (!row) {
        result.skipped++;
        continue;
      }
      try {
        /* 1. A scheduled cancellation wins: the paid period is over and the
              partner asked not to renew. Never renew a cancelled row. */
        if (row.cancelledAt && new Date(row.cancelledAt).getTime() <= nowMs) {
          setStatus(row.id, "cancelled", { cancelledAt: row.cancelledAt }, {
            eventKind: "enforcement_cancelled_at_period_end",
            actor: "system:subscriptionEnforcementWorker",
            detail: { periodEnd: row.currentPeriodEnd },
          });
          result.cancelledAtPeriodEnd++;
          result.decisions.push({
            subscriptionId: row.id,
            subjectKind: row.subjectKind,
            subjectId: row.subjectId,
            from: row.status,
            to: "cancelled",
            reason: "cancellation scheduled at period end",
          });
          continue;
        }

        /* 2. Grace already granted and now exhausted -> suspend. */
        if (row.status === "grace") {
          if (row.graceUntil && new Date(row.graceUntil).getTime() <= nowMs) {
            setStatus(row.id, "suspended", { suspendedAt: now }, {
              eventKind: "enforcement_suspended_after_grace",
              actor: "system:subscriptionEnforcementWorker",
              detail: { graceUntil: row.graceUntil, graceDays: cfg.graceDays },
            });
            result.suspended++;
            result.decisions.push({
              subscriptionId: row.id,
              subjectKind: row.subjectKind,
              subjectId: row.subjectId,
              from: "grace",
              to: "suspended",
              reason: `grace window of ${cfg.graceDays} day(s) expired`,
            });
          } else {
            result.skipped++;
          }
          continue;
        }

        /* 3. Period ended, unpaid. Grace if configured, otherwise suspend now.
              graceDays === 0 is the SEEDED value, so "suspend immediately" is
              the configured behaviour, not a missing one. */
        const periodEnd = row.currentPeriodEnd;
        if (!periodEnd || new Date(periodEnd).getTime() > nowMs) {
          result.skipped++;
          continue;
        }
        if (cfg.graceDays > 0) {
          const graceUntil = new Date(
            new Date(periodEnd).getTime() + cfg.graceDays * MS_PER_DAY,
          ).toISOString();
          setStatus(row.id, "grace", { graceUntil }, {
            eventKind: "enforcement_entered_grace",
            actor: "system:subscriptionEnforcementWorker",
            detail: { periodEnd, graceUntil, graceDays: cfg.graceDays, configKey: GRACE_CONFIG_KEY },
          });
          result.enteredGrace++;
          result.decisions.push({
            subscriptionId: row.id,
            subjectKind: row.subjectKind,
            subjectId: row.subjectId,
            from: row.status,
            to: "grace",
            reason: `period ended ${periodEnd}; ${cfg.graceDays} day(s) grace granted`,
          });
        } else {
          setStatus(row.id, "suspended", { suspendedAt: now }, {
            eventKind: "enforcement_suspended_no_grace",
            actor: "system:subscriptionEnforcementWorker",
            detail: { periodEnd, graceDays: 0, configKey: GRACE_CONFIG_KEY },
          });
          result.suspended++;
          result.decisions.push({
            subscriptionId: row.id,
            subjectKind: row.subjectKind,
            subjectId: row.subjectId,
            from: row.status,
            to: "suspended",
            reason: `period ended ${periodEnd}; grace window configured as 0 days`,
          });
        }
      } catch (err) {
        result.skipped++;
        log.warn(
          `[wave11/EN-8] row ${row.id} enforcement failed: ${(err as Error).message}`,
        );
      }
    }
    return result;
  } finally {
    inFlight = false;
  }
}

/**
 * Reporting read: what the enforcement state of a subject is, and what the
 * worker WOULD do next. Drives the UI surface — an engine with no route is not
 * shipped, and an engine with no visible state is not verifiable by the owner.
 */
export function enforcementStatusForSubject(
  subjectKind: string,
  subjectId: string,
): {
  configKey: string;
  graceDays: number;
  configMissing: boolean;
  subscriptions: Array<{
    id: string;
    tierSlug: string;
    cycle: string;
    status: string;
    currentPeriodEnd: string | null;
    graceUntil: string | null;
    projectedGraceUntil: string | null;
    projectedNextAction: string;
  }>;
} {
  const cfg = readGraceConfig();
  const db: any = rawDb();
  let rows: any[] = [];
  try {
    rows = db
      .prepare(
        `SELECT * FROM partner_subscription
          WHERE subject_kind=? AND subject_id=?
          ORDER BY created_at DESC, id DESC`,
      )
      .all(subjectKind, subjectId) as any[];
  } catch {
    rows = [];
  }
  return {
    configKey: GRACE_CONFIG_KEY,
    graceDays: cfg.graceDays,
    configMissing: cfg.configMissing,
    subscriptions: rows.map((r) => {
      const periodEnd: string | null = r.current_period_end ?? null;
      const projectedGraceUntil =
        periodEnd && cfg.graceDays > 0 && !cfg.configMissing
          ? new Date(new Date(periodEnd).getTime() + cfg.graceDays * MS_PER_DAY).toISOString()
          : null;
      let next: string;
      if (cfg.configMissing) next = "no action — grace window is not configured (fail closed)";
      else if (r.status === "suspended") next = "suspended — awaiting payment or reactivation";
      else if (r.status === "cancelled") next = "cancelled — no further action";
      else if (r.status === "grace")
        next = `suspend at ${r.grace_until ?? "unknown"} unless paid`;
      else if (!periodEnd) next = "no period end recorded — nothing to enforce";
      else if (cfg.graceDays > 0)
        next = `enter ${cfg.graceDays}-day grace at ${periodEnd} unless renewed`;
      else next = `suspend at ${periodEnd} unless renewed (grace configured as 0 days)`;
      return {
        id: String(r.id),
        tierSlug: String(r.tier_slug),
        cycle: String(r.cycle),
        status: String(r.status),
        currentPeriodEnd: periodEnd,
        graceUntil: r.grace_until ?? null,
        projectedGraceUntil,
        projectedNextAction: next,
      };
    }),
  };
}

/** Reinstate after payment. Restarts the period from now. */
export function reinstate(subscriptionId: string, actor: string): PartnerSubscriptionRow | null {
  const row = getById(subscriptionId);
  if (!row) return null;
  const now = new Date().toISOString();
  return setStatus(
    subscriptionId,
    "active",
    {
      currentPeriodStart: now,
      currentPeriodEnd: addCycle(now, row.cycle),
      graceUntil: null,
      suspendedAt: null,
    },
    { eventKind: "reinstated", actor, detail: { from: row.status } },
  );
}

export function startSubscriptionEnforcementWorker(intervalMs = DEFAULT_INTERVAL_MS): void {
  if (timer) return;
  if (process.env.NODE_ENV === "test") return; /* tests drive tick() directly */
  timer = setInterval(() => {
    try {
      tick();
    } catch (err) {
      log.error(`[wave11/EN-8] sweep crashed: ${(err as Error).message}`);
    }
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  log.info(`[wave11/EN-8] subscription enforcement worker started (every ${intervalMs}ms)`);
}

export function stopSubscriptionEnforcementWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
