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
/* WAVE 121 · FINDING 2 — the ONE definition of "today" and of a target close
   date, taken from the ratified rule itself (WAVE 83 / Shadie V6 1a) instead of
   this file inventing a second one out of a UTC timestamp. See the sweeper's
   `timeExpired`. */
import { todayDateOnly, targetCloseDateOnly } from "@shared/roundTargetCloseRule";
/* WAVE 114 · FINDING 1 (item 8) — THE SWEEPER'S "FULLY SUBSCRIBED" TEST USED A
   FIGURE THAT IS PERMANENTLY ZERO, SO A ROUND COULD NEVER CONCLUDE ON ITS OWN.

   `rounds.raised_amount` has NO WRITER anywhere in the product (verified in
   build_log/wave114/W114_PREFLIGHT.md §1.1: it is initialised to 0 by
   `createRound`, read in eleven places, and only ever set to a non-zero value by
   the demo seed and by tests). `targetMet` below compared that zero with the
   target, so it could not become true on any real round.

   ⚠ THE PARAGRAPH THAT STOOD HERE IS WITHDRAWN BY RULING R93 (2026-08-22).
   It described wave 114's fix as DERIVING the funded total and OR-ing it into
   `targetMet`, and argued that "the new disjunct can only ever close MORE rounds,
   never fewer". **That sentence was the problem, not the reassurance it read as.**
   Closing more rounds is not a safe direction of travel for an UNATTENDED job
   that lapses investors' outstanding offers and notifies them. The disjunct has
   been removed; the full reasoning is at the `targetMet` assignment below.

   What remains true and worth keeping from that note: `rounds.raised_amount` is
   never written on a real round, so `storedTargetMet` cannot fire in production
   and `timeExpired` is in practice the only automatic trigger — which is the
   behaviour that shipped in every prior version and is therefore the behaviour
   preserved here. `server/__tests__/roundClose.test.ts` fabricates `raisedAmount`
   through `updateRound`, so it still exercises both a close and a non-close.

   This file is NOT sacred: proven empirically before editing (append a byte,
   `npm run sacred` still 48/48, revert, diff byte-identical) and it appears in no
   manifest, no ADDED_* list and no KNOWN_DRIFT row. It IS, however, covered by
   the preflight's `check-formula-bytes` gate, which is what caught wave 114's
   change — correctly, and it is the reason this ruling exists. */
/* R93 — NOTHING from `./roundRaisedTotals` is imported here, and that is
   deliberate. The sweeper must never close a round on the strength of a derived
   total; see the ruling at the `targetMet` assignment.

   WAVE 121 · FINDING 3 — this used to import `roundMoneyOnRecord` and two row
   types, and the header claimed "the sweeper reads the money rows (they feed the
   reconciliation warning below)". It did not: after R93 withdrew the action there
   were ZERO call sites for `roundMoneyOnRecord` in this file, and the two reads
   that fed it — every `soft_circles` row and every `captable_commits` row, both
   cross-tenant and unbounded — were executed on EVERY sweep tick and then
   discarded. `server/__tests__/w114_round_money_states.test.ts` "proved the
   observation survived" by asserting the IMPORT SPECIFIER, so a test passed on
   dead code.

   OPTION (b) WAS TAKEN — the import and both scans are removed. Reasoning, in
   full, in build_log/wave121/W121_PREFLIGHT.md §3. In short: (i) the observation
   had no consumer, no reader and no requirement — R93 removed the only thing that
   ever used it; (ii) the same reconciliation is computed, and SHOWN, on the
   round's own money surfaces from `./roundRaisedTotals`, which is untouched, so
   nothing is lost by not recomputing it in a background job; (iii) an unattended
   job is the worst possible place to keep two unbounded cross-tenant table scans
   alive for observation only — it pays them once a minute, for every tenant, to
   throw the result away. The reconciliation is not deleted from the product; only
   this dead copy of it is. */
import { appendAdminAudit } from "../adminPlatformStore";
import { emitNotification, type NotificationKind } from "../notificationsStore";
import { emitMutation } from "./eventBus";
import { publish as ssePublish } from "./sseHub";
import { log } from "./logger";
/* WAVE 17 ORP-044 — the milestone auto-trigger registry (a leaf module; see its
   header for why the emit points cannot import the broadcast store directly). */
import {
  fireAutoBroadcast,
  roundClosedBody,
  roundClosedKey,
} from "./wave17MilestoneAutoTriggers";

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
  /**
   * WAVE 17 ORP-044 — the round's human name, read from the same row the cascade
   * already SELECTs, so the auto-triggered broadcast can name the round instead
   * of publishing an opaque id to the whole cap table. Null when the row carries
   * no name.
   */
  roundName?: string | null;
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
      roundName: round.name ?? null,
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
    roundName: round.name ?? null,
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

  /* 4. WAVE 17 ORP-044 — AUTO-TRIGGER `round_closed`, SECOND PATH.

     THIS IS THE PATH A ONE-SITE FIX WOULD HAVE MISSED. The manual close goes
     through `closeRound` (server/roundsStore.ts:872, wired at
     server/roundCarryForwardRoutes.ts:921), but this cascade sets
     `rounds.state = 'closed'` with its OWN UPDATE (`:157`) and never calls
     `closeRound`. It is reached from the sweeper (`sweepClosedRounds`, used by
     server/jobs/roundSweeper.ts:20) and from `closeRoundCascadeStandalone`
     (server/routes.ts:90). A round auto-closed on its close date or on reaching
     target would therefore have notified nobody.

     Placed in `notifyCascadeSideEffects` because that is this path's declared
     post-commit side-effect sink — the same function that audits the close and
     notifies lapsed offers — and it already returns early on `alreadyClosed`,
     which is exactly the idempotency the sweeper needs. NO AMOUNT is published:
     the cascade has no final-amount input, and `roundClosedBody` omits the figure
     rather than inventing one. */
  try {
    fireAutoBroadcast({
      companyId: result.companyId,
      actorUserId: actor,
      trigger: "round_closed",
      body: roundClosedBody({ roundName: result.roundName ?? null, finalState: "closed" }),
      dedupeKey: roundClosedKey(result.roundId),
    });
  } catch (err) {
    /* fireAutoBroadcast does not throw; this belt is here because every other
       side effect in this function is individually guarded and a future change
       must not be able to break the sweeper loop. */
    log.warn("[notifyCascadeSideEffects] milestone broadcast failed:", (err as Error).message);
  }
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
  /* WAVE 121 · FINDING 2 — `now` is the local-calendar DATE (`YYYY-MM-DD`), from
     the ratified rule's own boundary, NOT a UTC timestamp. `close_date` is a
     date-only column (`shared/schema.ts`), so comparing it against
     `new Date().toISOString()` made `"2026-08-22" < "2026-08-22T20:13:00Z"` TRUE
     and swept a round whose target close is TODAY — a day early, against
     `shared/roundTargetCloseRule.ts` (WAVE 83 / Shadie V6 1a), on an unattended
     job that lapses investors' outstanding offers and notifies them. The
     comparison below is unchanged; what it compares is now like with like. */
  const now = todayDateOnly();
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
          // state != 'closed' — Drizzle has no `ne`; the state test is applied in
          // JS below. We do an open-ended select and filter in JS to keep the SQL
          // dialect minimal (SQLite + Postgres compat).
          //
          // WAVE 114 · FINDING 1 — the candidate filter USED to be
          //   or(lt(closeDate, now), isNull(closeDate))
          // which excluded every round with a FUTURE close date from the
          // target-met branch. That is the normal shape of a live round, so even
          // once the subscription total was derived correctly, a fully funded
          // round with a close date still ahead of it would never have been
          // examined. The filter is therefore WIDENED to every non-deleted round
          // and both tests (time-expiry and target-met) are applied in JS below.
          //
          // This can only ever consider MORE rounds, never fewer, and the two
          // close conditions themselves are unchanged in meaning — so no round
          // that the sweeper used to leave open for a REASON is closed now. The
          // time-expiry comparison against `now` still happens in JS exactly as
          // before, using the same `now` string. `lt` and `or` remain imported
          // for `closeRoundCascade`'s own queries.
        ),
      )
      .all() as any[];

    /* WAVE 121 · FINDING 3 — the two whole-table reads WAVE 114 added here
       (`allCircles` from `soft_circles`, `allLedger` from `captable_commits`,
       both cross-tenant and unbounded) are GONE. Nothing consumed either of them
       after R93 withdrew the automatic close: they were executed on every tick of
       an unattended job and discarded. Removing them changes no decision this
       function makes — the only inputs to `timeExpired` and `targetMet` are the
       round row's own `close_date`, `raised_amount` and `target_amount`. */

    for (const r of candidates) {
      scanned += 1;
      if (r.state === "closed") continue;

      /* Date-only in, date-only out — a stored timestamp is reduced to its day
         by the shared rule, never by timestamp arithmetic here. */
      const closeDate = targetCloseDateOnly(r.close_date ?? r.closeDate ?? null);
      const raised = Number(r.raised_amount ?? r.raisedAmount ?? 0);
      const target = Number(r.target_amount ?? r.targetAmount ?? 0);

      const timeExpired = !!closeDate && closeDate < now;
      /* The pre-wave-114 test, kept verbatim so no existing expectation moves.
         On a real round `raised` is always 0, so this alone never fires. */
      const storedTargetMet = target > 0 && raised >= target;

      /* ═══════════════════════════════════════════════════════════════════════
         RULING R93 — THE SWEEPER DOES NOT CLOSE A ROUND BECAUSE IT REACHED ITS
         TARGET. Lead developer, under delegation, 2026-08-22.

         Wave 114 added `derivedTargetMet = fundedMeetsTarget(money, target)` here
         and OR-ed it into `targetMet`, reasoning that a fully funded round should
         be able to conclude. The arithmetic was right and the reasoning about
         FUNDED cash being the only defensible basis was right. **Acting on it
         from this function was not.**

         WHAT THIS FUNCTION IS. `sweepClosedRounds` is an UNATTENDED periodic job
         (`server/jobs/roundSweeper.ts`). When it decides `targetMet` it calls
         `closeRoundCascade(...)` as `system:round_sweeper`, which CLOSES THE
         ROUND, LAPSES EVERY OUTSTANDING OFFER on it (`offersLapsed`) and then
         fires `notifyCascadeSideEffects`, notifying investors.

         WHY THE CHANGE WAS DANGEROUS. Before it, `raised` was the permanently
         zero `rounds.raised_amount` column, so `storedTargetMet` could never fire
         and the ONLY automatic trigger was `timeExpired`. The change therefore did
         not improve a working path — it ACTIVATED A DORMANT ONE, giving a
         background job a new power over live fundraises with no human in the loop.

         AND REACHING TARGET IS NOT A REASON TO CLOSE. In real fundraising a
         founder who hits his target routinely keeps the round open — to
         oversubscribe, to extend, to hold allocation for a strategic investor.
         Auto-closing on the first fully funded sweep would lapse other investors'
         live offers and tell them the round had closed, on the platform's own
         initiative. That is investor-visible, hard to undo, and not ours to decide.

         The owner's standing instruction is "Do not break anything or dramatically
         make assumptions to change things." Enabling unattended round closure is
         exactly that, so it is removed and `targetMet` is restored to the stored
         comparison alone. The derivation helpers in `./roundRaisedTotals` are
         UNTOUCHED and still used by every honest money tile — only this automatic
         ACTION is withdrawn. WAVE 121 · FINDING 3 — and nothing from that module is
         imported here any more: the revert left the import and two unbounded
         cross-tenant reads behind with no call site, so they were removed too.

         THE UNDERLYING NEED IS REAL AND IS NOT LOST. A fully funded round should be
         concludable — BY A HUMAN, from the round screen, with the derived total
         shown as the basis. That is recorded as an open wave; it is a
         human-triggered path, not a sweep.
         ═══════════════════════════════════════════════════════════════════════ */
      const targetMet = storedTargetMet;

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
