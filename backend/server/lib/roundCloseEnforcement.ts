// server/lib/roundCloseEnforcement.ts
//
// WAVE 43 · R7 — THE SERVER-SIDE REFUSAL. This is the fix; the UI is the report.
//
//   Live audit F-7, 2026-08-13: two rounds whose decision windows closed on 3
//   and 6 August still rendered a fully enabled "Submit soft-circle ($250,000)"
//   button on 13 August. "An investor can commit $250,000 to a round that closed
//   ten days ago, and neither party knows which rules apply."
//
//   Owner: "Go with your recommendation to enforce the close.
//           Accepting late commitments should be allowed."
//
// A DISABLED BUTTON IS COSMETIC. Anyone with `curl` bypasses it, and every one
// of the three money-entry paths in this codebase
//
//   POST  /api/rounds/:id/soft-circle
//   POST  /api/investor/invitations/:id/soft-circle
//   PATCH /api/rounds/:roundId/invitations/:invId/decision   (action soft_circle)
//
// accepted a commitment against a closed round without a word. All three now
// call `evaluateCommitmentAdmission` below, which is the ONLY authority on
// whether money may enter a round. It resolves the window through
// `shared/roundClose.ts` — the same module the investor card and the "Expired"
// filter import — so the screen and the server cannot disagree again.
//
// WHAT IT WILL NOT DO
//   · It will not refuse a round that has no close date. Absence of a date is
//     not evidence of expiry; inventing one would refuse live money. R6's
//     explicit refusal is a DISPLAY rule ("No close date recorded"), never a
//     licence to lock a funnel. A fix that refuses everything would pass a
//     one-sided test and break the entire funnel.
//   · It will not create, mutate or consume a grant. Reading whether a round is
//     closed must never have a side effect — the late-acceptance path is
//     deliberate, and a read that grants itself permission is not deliberate.
//     `consumeGrant` is called by the route AFTER the commitment lands.
//
// SACRED: `captableCommitStore.ts` is untouched. "Accepted after close" is
// DERIVED here from the late-acceptance ledger + the resolved close window and
// joined into the founder, investor and cap-table projections at read time.
import {
  resolveCloseWindow,
  isClosedAt,
  closedStatement,
  type CloseWindow,
} from "../../shared/roundClose";
import { getRoundById } from "../roundsStore";
import { getInvitation } from "../roundInvitationsStore";
import {
  findLiveReopen,
  findOpenLateGrant,
  listForSoftCircleIds,
  type LateAcceptanceRow,
} from "./roundLateAcceptanceStore";
import { log } from "./logger";

/** The typed refusal code every money route returns for a closed round. */
export const ROUND_CLOSED = "ROUND_CLOSED";

/**
 * HTTP 409, not 403 and not 400. The caller is authenticated and authorized and
 * the request is well-formed — the resource is in a state that will not accept
 * it. (Cross-tenant / not-yours stays 404 at the route's own ownership guard,
 * which runs BEFORE this check so a stranger cannot learn a round's close date
 * by probing for a 409.)
 */
export const ROUND_CLOSED_STATUS = 409;

export interface ResolvedWindow {
  win: CloseWindow;
  closed: boolean;
  /** Present when the round has no recorded close date at all (R6). */
  noCloseDate: boolean;
}

/**
 * Resolve a round's window, optionally narrowed by one invitation's own expiry.
 *
 * `S3` in shared/roundClose.ts: the effective deadline is the EARLIEST of the
 * invitation's `expires_at` and the round's `close_date`, and a round whose
 * `state` is `closed` is closed regardless of either.
 */
export function resolveWindowFor(
  roundId: string,
  invitationId: string | null | undefined,
  nowMs: number,
): ResolvedWindow {
  const round = getRoundById(roundId);
  let invitationExpiresAt: string | null = null;
  if (invitationId) {
    try {
      const inv = getInvitation(invitationId);
      // Only an invitation that actually belongs to this round may narrow the
      // window. A mismatched id is ignored here, not trusted — the route's own
      // ownership guard is what rejects it.
      if (inv && inv.roundId === roundId) invitationExpiresAt = inv.expiresAt ?? null;
    } catch (err) {
      log.warn("[roundCloseEnforcement] invitation lookup failed:", (err as Error).message);
    }
  }
  const win = resolveCloseWindow({
    roundState: round?.state ?? null,
    roundCloseDate: (round as { closeDate?: string | null } | undefined)?.closeDate ?? null,
    invitationExpiresAt,
  });
  return {
    win,
    closed: isClosedAt(win, nowMs),
    noCloseDate: win.deadlineMs === null && !win.hardClosed,
  };
}

export type AdmissionDecision =
  /** The window is open (or there is no deadline). Ordinary commitment. */
  | { allow: true; late: false; win: CloseWindow; grant: null }
  /**
   * The window is CLOSED and a deliberate founder grant admits this commitment.
   * `grant` must be recorded against the new commitment by the caller:
   * `consumeGrant(grant.id, softCircle.id)` for a `late_commitment` grant.
   */
  | { allow: true; late: true; win: CloseWindow; grant: LateAcceptanceRow }
  /** The window is CLOSED and nothing admits this commitment. */
  | { allow: false; win: CloseWindow; code: typeof ROUND_CLOSED; status: number; message: string };

/**
 * THE ONE GATE. Called by every money-entry route before anything is written.
 *
 * Pure with respect to the database: it reads, it decides, it returns. The
 * grant is consumed by the caller after the commitment exists, so a refused or
 * failed commitment never burns a founder's single-use grant.
 */
export function evaluateCommitmentAdmission(args: {
  roundId: string;
  invitationId?: string | null;
  nowMs?: number;
}): AdmissionDecision {
  const nowMs = args.nowMs ?? Date.now();
  const { win, closed } = resolveWindowFor(args.roundId, args.invitationId ?? null, nowMs);

  if (!closed) return { allow: true, late: false, win, grant: null };

  // ── Door 1: the founder reopened the round. Still late: `closedAt` on the
  //    grant is the ORIGINAL deadline, so the marker outlives the reopen.
  let grant: LateAcceptanceRow | null = null;
  try {
    grant = findLiveReopen(args.roundId, nowMs);
  } catch (err) {
    log.warn("[roundCloseEnforcement] reopen lookup failed:", (err as Error).message);
  }

  // ── Door 2: the founder accepted this ONE investor's late commitment without
  //    reopening anything. Single-use; consumed by the caller.
  if (!grant && args.invitationId) {
    try {
      grant = findOpenLateGrant(args.roundId, args.invitationId);
    } catch (err) {
      log.warn("[roundCloseEnforcement] late-grant lookup failed:", (err as Error).message);
    }
  }

  if (grant) return { allow: true, late: true, win, grant };

  return {
    allow: false,
    win,
    code: ROUND_CLOSED,
    status: ROUND_CLOSED_STATUS,
    // The same sentence the UI states. The API says the fact, not "forbidden".
    message: closedStatement(win.deadlineIso),
  };
}

/**
 * The refusal body every money route returns. One shape, so a client never has
 * to guess which field carries the date.
 */
export function roundClosedBody(decision: Extract<AdmissionDecision, { allow: false }>) {
  return {
    ok: false,
    error: ROUND_CLOSED,
    message: decision.message,
    closedAt: decision.win.deadlineIso,
    closeSource: decision.win.source,
    /**
     * Told to the client explicitly so the UI can offer the founder the
     * late-acceptance path instead of inventing a retry that will also fail.
     */
    lateAcceptanceRequired: true,
  };
}

/* ═════════════════════════════════════════════════════════════════════════
 * THE VISIBLE MARK — derived, never stored on the commitment
 * ═════════════════════════════════════════════════════════════════════════ */

/** The label R7 requires wherever a late commitment appears. */
export const ACCEPTED_AFTER_CLOSE_LABEL = "Accepted after close";

export interface LateMark {
  acceptedAfterClose: true;
  /** The deadline that was passed. */
  closedAt: string;
  acceptedByUserId: string;
  acceptedByName: string | null;
  acceptedAt: string;
  reason: string | null;
  kind: LateAcceptanceRow["kind"];
  label: typeof ACCEPTED_AFTER_CLOSE_LABEL;
}

function toMark(g: LateAcceptanceRow): LateMark {
  return {
    acceptedAfterClose: true,
    closedAt: g.closedAt,
    acceptedByUserId: g.acceptedByUserId,
    acceptedByName: g.acceptedByName,
    acceptedAt: g.acceptedAt,
    reason: g.reason,
    kind: g.kind,
    label: ACCEPTED_AFTER_CLOSE_LABEL,
  };
}

/**
 * Mark a batch of commitments. One query for the whole page rather than one per
 * row, because this runs inside the founder round view, the investor list AND
 * the cap-table projection.
 *
 * A commitment carries a mark iff a grant names it. `createdAt` is deliberately
 * NOT used to infer lateness: a commitment created a minute after a deadline by
 * a clock skew is not a founder decision, and R7's marker records a DECISION.
 */
export function markLateCommitments(
  commitments: Array<{ id: string }>,
): Map<string, LateMark> {
  const out = new Map<string, LateMark>();
  const ids = commitments.map((c) => c.id).filter(Boolean);
  if (ids.length === 0) return out;
  let grants: Map<string, LateAcceptanceRow>;
  try {
    grants = listForSoftCircleIds(ids);
  } catch (err) {
    log.warn("[roundCloseEnforcement] late-mark lookup failed:", (err as Error).message);
    return out;
  }
  for (const [softCircleId, g] of Array.from(grants.entries())) {
    out.set(softCircleId, toMark(g));
  }
  return out;
}

/**
 * Attach the mark to one projected row. Returns the row unchanged when the
 * commitment was not late — `acceptedAfterClose` is present and `false` either
 * way so a consumer never has to distinguish "not late" from "field missing".
 */
export function withLateMark<T extends { id: string }>(
  row: T,
  marks: Map<string, LateMark>,
): T & { acceptedAfterClose: boolean; lateAcceptance: LateMark | null } {
  const m = marks.get(row.id) ?? null;
  return { ...row, acceptedAfterClose: m !== null, lateAcceptance: m };
}
