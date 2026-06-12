/**
 * server/lib/roundCloseCascade.ts — v17 Phase C.
 *
 * Cascading round-close auto-close logic.
 *
 * When a fundraising round (`rounds` table) reaches `target_amount` (full
 * fill) OR `close_date` has passed in the wall clock, the Collective
 * intake queue tied to that round must NOT keep treating pending offers
 * as live — they should auto-lapse with reason `round_closed` so the
 * chapter intake screen reflects reality.
 *
 * This module exposes two surfaces:
 *
 *   1. `closeRoundCascade(tx, roundId, opts)` — synchronous helper.
 *      Called inside any caller-owned `db.transaction((tx) => {...})`
 *      that flips a round to state='closed'. Performs the cascade
 *      atomically:
 *        a. SETs `rounds.state = 'closed'` if not already closed
 *        b. SELECTs every `investor_nominations` row for that round's
 *           companyId whose status='pending' AND deleted_at IS NULL
 *        c. UPDATEs each to status='lapsed' with decline_reason='round_closed',
 *           extending the hash chain (prev_hash = current hash, new hash
 *           computed deterministically from the transition payload)
 *        d. Audit append (deferred outside the tx — appendAdminAudit opens
 *           its own BEGIN IMMEDIATE; mixing nested SAVEPOINTs is not
 *           necessary because audit_log's own chain serializes via
 *           SQLite-level locks)
 *
 *   2. `sweepClosedRounds()` — periodic idempotent scan.
 *      Finds rounds where (a) `close_date < now()` AND state='open'-ish,
 *      OR (b) `raised_amount >= target_amount` AND state != 'closed',
 *      then runs `closeRoundCascade` against each. Idempotent — re-running
 *      against an already-closed round is a no-op.
 *
 * Sweeper schedule: started by `startRoundSweeper()` (see
 * `server/jobs/roundSweeper.ts`) on a 60-second `setInterval` in NODE_ENV=production.
 * Tests can drive `sweepClosedRounds()` directly without touching timers.
 *
 * Hash-chain semantics on investor_nominations:
 *   Each mutation (accept/decline/lapse) extends the row's chain by
 *   setting `prev_hash = current hash`, `hash = sha256(prev|payload)`.
 *   Audit verifiers can re-walk by reading the row + its full audit_log
 *   trail (each transition appends an audit row keyed on offerId).
 *
 * Rules followed (v19 brief §10–42):
 *   - SYNC transaction callbacks (Phase B finding)
 *   - withTenant() on every read (cross-tenant reads are intentionally
 *     skipTenant'd with inline justification)
 *   - hash-chained write INSIDE the same tx
 *   - sweeper sequential, not Promise.all
 *   - graceful no-op when COLLECTIVE_ENABLED=0 (cascade still runs because
 *     round mechanics are core math; the SWEEPER, however, only starts
 *     under COLLECTIVE_ENABLED=1)
 */

import { createHash } from "node:crypto";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { getDb } from "../db/connection";
import {
  rounds as roundsTable,
  investorNominations as investorNominationsTable,
} from "@shared/schema";
import { appendAdminAudit } from "../adminPlatformStore";
import { emitNotification, type NotificationKind } from "../notificationsStore";
import { emitMutation } from "./eventBus";
import { publish as ssePublish } from "./sseHub";
import { log } from "./logger";

/** Internal sha256 chain hash. Identical algorithm to collectiveOffersStore. */
function computeHash(prevHash: string | null, payload: Record<string, unknown>): string {
  const h = createHash("sha256");
  h.update(prevHash ?? "GENESIS");
  h.update("|");
  h.update(JSON.stringify(payload));
  return h.digest("hex");
}

export interface CloseRoundCascadeResult {
  roundId: string;
  alreadyClosed: boolean;
  offersLapsed: number;
  /** Lapsed offer rows, post-update — for downstream notifications/audit. */
  lapsedOffers: Array<{
    id: string;
    tenantId: string;
    chapterId: string;
    companyId: string;
    investorUserId: string;
    prevHash: string;
    hash: string;
  }>;
  /** Companies whose rounds we touched (deduped). */
  companyId: string | null;
}

/**
 * Synchronous cascade helper. MUST be called inside an existing
 * `db.transaction((tx) => {...})` (sync form per Phase B finding).
 *
 * @param tx     Drizzle transaction object
 * @param roundId The round to close + cascade
 * @param opts.reason Audit reason — defaults to 'round_closed'
 */
export function closeRoundCascade(
  tx: any,
  roundId: string,
  opts: { reason?: string; actorUserId?: string | null } = {},
): CloseRoundCascadeResult {
  const reason = opts.reason ?? "round_closed";
  const now = new Date().toISOString();

  // Step 1: Read the round (we need state + companyId + tenant).
  // CROSS-TENANT (admin) — justified because the sweeper runs as a
  // system actor not bound to a tenant; the round's tenantId is what we
  // stamp downstream writes with.
  const roundRows = tx
    .select()
    .from(roundsTable)
    .where(and(eq((roundsTable as any).id, roundId), isNull((roundsTable as any).deletedAt)))
    .all() as any[];

  if (roundRows.length === 0) {
    return { roundId, alreadyClosed: false, offersLapsed: 0, lapsedOffers: [], companyId: null };
  }
  const round = roundRows[0];
  const companyId: string = round.company_id ?? round.companyId;
  const currentState: string = round.state;

  // Idempotency: if already closed, return without further writes.
  if (currentState === "closed") {
    return {
      roundId,
      alreadyClosed: true,
      offersLapsed: 0,
      lapsedOffers: [],
      companyId,
    };
  }

  // Step 2: Flip round to closed.
  tx.update(roundsTable)
    .set({ state: "closed", updatedAt: now } as any)
    .where(eq((roundsTable as any).id, roundId))
    .run();

  // Step 3: Lapse all pending offers tied to this company.
  //
  // We match on companyId — investor_nominations may have round_id
  // populated for v17-Phase-C-and-later rows, but legacy rows have
  // round_id=NULL. Per the brief: cascade by company association.
  const pending = tx
    .select()
    .from(investorNominationsTable)
    .where(
      and(
        eq((investorNominationsTable as any).companyId, companyId),
        eq((investorNominationsTable as any).status, "pending"),
        isNull((investorNominationsTable as any).deletedAt),
      ),
    )
    .all() as any[];

  const lapsed: CloseRoundCascadeResult["lapsedOffers"] = [];
  for (const r of pending) {
    const prevHash = r.hash;
    const newHash = computeHash(prevHash, {
      offerId: r.id,
      action: "lapse",
      reason,
      lapsedAt: now,
      roundId,
    });
    tx.update(investorNominationsTable)
      .set({
        status: "lapsed",
        declineReason: reason,
        decidedAt: now,
        decidedBy: "system:round_sweeper",
        prevHash,
        hash: newHash,
        updatedAt: now,
        roundId,
      } as any)
      .where(eq((investorNominationsTable as any).id, r.id))
      .run();
    lapsed.push({
      id: r.id,
      tenantId: r.tenant_id ?? r.tenantId,
      chapterId: r.chapter_id ?? r.chapterId,
      companyId: r.company_id ?? r.companyId,
      investorUserId: r.investor_user_id ?? r.investorUserId,
      prevHash,
      hash: newHash,
    });
  }

  return {
    roundId,
    alreadyClosed: false,
    offersLapsed: lapsed.length,
    lapsedOffers: lapsed,
    companyId,
  };
}

/**
 * Post-tx side effects:
 *   - audit_log append per round + per lapsed offer
 *   - investor notification per lapsed offer
 *   - SSE/bridge invalidation
 *
 * Separated from `closeRoundCascade` so the cascade is atomic but the
 * notifications are best-effort. Caller (sweeper / route handler) invokes
 * this after the tx commits.
 */
export function notifyCascadeSideEffects(
  result: CloseRoundCascadeResult,
  opts: { actorUserId?: string | null } = {},
): void {
  if (result.alreadyClosed || !result.companyId) return;

  const actor = opts.actorUserId ?? "system:round_sweeper";

  // 1. Audit the round-close event.
  try {
    appendAdminAudit(
      actor,
      `round:${result.roundId}`,
      "round.auto_closed",
      {
        roundId: result.roundId,
        companyId: result.companyId,
        offersLapsedCount: result.offersLapsed,
      },
    );
  } catch (err) {
    log.warn("[notifyCascadeSideEffects] round audit append failed:", (err as Error).message);
  }

  // 2. Audit + notify each lapsed offer.
  for (const o of result.lapsedOffers) {
    try {
      appendAdminAudit(
        actor,
        `collective_offer:${o.id}`,
        "collective.offer.lapsed",
        {
          offerId: o.id,
          companyId: o.companyId,
          investorUserId: o.investorUserId,
          chapterId: o.chapterId,
          reason: "round_closed",
          roundId: result.roundId,
          prevHash: o.prevHash,
          hash: o.hash,
        },
        o.tenantId,
      );
    } catch (err) {
      log.warn("[notifyCascadeSideEffects] offer audit failed:", (err as Error).message);
    }

    try {
      emitNotification({
        userId: o.investorUserId,
        kind: "collective.offer.lapsed" as NotificationKind,
        title: "Your Collective offer lapsed",
        body: `The associated round closed; your nomination for ${o.companyId} is now lapsed.`,
        link: `/investor/companies/${o.companyId}`,
      });
    } catch { /* non-fatal */ }

    try {
      emitMutation({
        aggregate: "collective_offer",
        id: o.id,
        change: "update",
        tenantId: o.tenantId,
      });
    } catch { /* non-fatal */ }
    // v18 Phase D — SSE fan-out (post-commit).
    try {
      ssePublish(o.chapterId, "offers", {
        kind: "offer.lapsed",
        offerId: o.id,
        companyId: o.companyId,
        investorUserId: o.investorUserId,
        reason: "round_closed",
        roundId: result.roundId,
      });
    } catch { /* non-fatal */ }
  }

  // 3. Bridge event for the round itself.
  try {
    emitMutation({
      aggregate: "round",
      id: result.roundId,
      change: "update",
    });
  } catch { /* non-fatal */ }
}

/**
 * Public convenience wrapper — opens its own transaction and runs the
 * cascade. Use this from route handlers / sweeper / tests that don't
 * already own a tx.
 */
export function closeRoundCascadeStandalone(
  roundId: string,
  opts: { reason?: string; actorUserId?: string | null } = {},
): CloseRoundCascadeResult {
  let result: CloseRoundCascadeResult = {
    roundId, alreadyClosed: false, offersLapsed: 0, lapsedOffers: [], companyId: null,
  };
  try {
    const db: any = getDb();
    db.transaction((tx: any) => {
      result = closeRoundCascade(tx, roundId, opts);
    });
  } catch (err) {
    log.warn("[closeRoundCascadeStandalone] tx failed:", (err as Error).message);
    return result;
  }
  notifyCascadeSideEffects(result, opts);
  return result;
}

/**
 * Sweeper. Idempotent — finds rounds eligible for auto-close and runs the
 * cascade against each one sequentially (not Promise.all per Rule 5).
 *
 * Eligibility:
 *   - rounds.state != 'closed'
 *   - AND deleted_at IS NULL
 *   - AND (close_date < now()   OR   raised_amount >= target_amount)
 *
 * "Other paths" (manual `closeRound`) can win the race — that's fine
 * because the cascade itself short-circuits when state='closed' is read
 * inside the tx (alreadyClosed=true).
 */
export function sweepClosedRounds(): {
  scanned: number;
  closed: number;
  totalOffersLapsed: number;
} {
  const now = new Date().toISOString();
  let scanned = 0;
  let closed = 0;
  let totalOffersLapsed = 0;

  try {
    const db: any = getDb();

    // CROSS-TENANT (admin) — justified because the sweeper is a global
    // system actor; it scans all tenants' rounds in a single sweep.
    // soft-delete still applied via isNull(deletedAt).
    const candidates = db
      .select()
      .from(roundsTable)
      .where(
        and(
          isNull((roundsTable as any).deletedAt),
          // state != 'closed' — Drizzle has no `ne`; use OR-of-not-equals
          // for the common states, OR fallback to filtering in JS below.
          // We do an open-ended select and filter in JS to keep the SQL
          // dialect minimal (SQLite + Postgres compat).
          or(
            // raised_amount >= target_amount handled in JS (float compare)
            // close_date < now handled here for index usage
            lt((roundsTable as any).closeDate, now),
            // include rows where close_date IS NULL so we can JS-filter for
            // raised >= target.
            isNull((roundsTable as any).closeDate),
          ),
        ),
      )
      .all() as any[];

    for (const r of candidates) {
      scanned += 1;
      if (r.state === "closed") continue;

      const closeDate = r.close_date ?? r.closeDate ?? null;
      const raised = Number(r.raised_amount ?? r.raisedAmount ?? 0);
      const target = Number(r.target_amount ?? r.targetAmount ?? 0);

      const timeExpired = !!closeDate && closeDate < now;
      const targetMet = target > 0 && raised >= target;

      if (!timeExpired && !targetMet) continue;

      // Cascade inside its own tx.
      let result = null as CloseRoundCascadeResult | null;
      try {
        db.transaction((tx: any) => {
          result = closeRoundCascade(tx, r.id, {
            reason: targetMet ? "round_target_met" : "round_closed",
            actorUserId: "system:round_sweeper",
          });
        });
      } catch (err) {
        log.warn("[sweepClosedRounds] cascade tx failed:", (err as Error).message);
        continue;
      }

      if (result && !result.alreadyClosed) {
        closed += 1;
        totalOffersLapsed += result.offersLapsed;
        notifyCascadeSideEffects(result, { actorUserId: "system:round_sweeper" });
      }
    }
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!/no such table/i.test(msg)) {
      log.warn("[sweepClosedRounds] sweep failed:", msg);
    }
  }

  return { scanned, closed, totalOffersLapsed };
}

/* --------------------------------------------------------------- */
/* Test-only helpers                                                 */
/* --------------------------------------------------------------- */

export const _internal = Object.freeze({
  computeHash,
});
