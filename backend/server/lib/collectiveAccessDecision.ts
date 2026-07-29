/**
 * server/lib/collectiveAccessDecision.ts
 *
 * W-COLLECTIVE Wave 1 — v4 §1.1 as corrected by v5 §C and v6 §2.
 *
 * ONE decision contract shared by the server gate (`requireCollectiveMember`)
 * and the client gate state (`GET /api/collective/gate-state`). Before this
 * module the two disagreed: the middleware ran a four-step tree (admin bypass →
 * fail-closed billing override → active-member sources → cap-table →
 * accreditation) while `gate-state` only reported membership + accreditation. A
 * user denied by the billing override or the cap-table sub-check therefore saw
 * a mounted dashboard spraying 403s instead of an explanatory blocker.
 *
 * Design rules this file is required to hold to:
 *
 *  1. **Admin bypass is evaluated FIRST** — before the billing/deactivation
 *     override — exactly as `requireCollectiveMember` does today. An admin whose
 *     own billing lapsed still gets moderation access.
 *  2. **Tri-state, not boolean.** Every signal whose source can fail on read is
 *     read through a `yes | no | error` sibling. `"error"` maps to
 *     `reason:"unknown"`, which the client renders as the EXISTING retry card —
 *     never as billing copy and never as `application_pending`. A boolean cannot
 *     express this because the fail-closed booleans return `true` both when a
 *     membership genuinely lapsed and when the table was unreadable.
 *  3. **Every reason has a real mechanism**, not just a name in a union.
 *  4. **This module never widens access.** `allow:true` is returned only when
 *     every check the server middleware runs has passed. It is a reporting and
 *     display contract layered over the enforcement, not a replacement for it.
 *  5. **Not wired into `GET /api/collective/eligibility`** — that route honours
 *     an admin-supplied `?userId=`, so running this decision there would let an
 *     admin read another user's billing state through a diagnostic surface.
 *     `gate-state` takes its subject strictly from the session.
 *
 * `application_pending` is a DB-derived DISPLAY substate only. It never weakens
 * the server gate: the user is still not a member, still gets 403 from the
 * middleware, and only the copy shown to them changes.
 */
import * as collectiveMembershipStore from "../collectiveMembershipStore";
import {
  hasOpenMembershipDeactivationTri,
  hasCancelledOrPastDueBillingTri,
} from "../collectiveMembershipDeactivationStore";
import { getMembership, isOnCapTable } from "../membershipStore";
import { getAccreditationGateStatus } from "../investorComplianceRoutes";
import { partnerTeamStore } from "../partnerWorkspaceStore";
import { rawDb } from "../db/connection";
import { isDbAdmin, isDbActiveMember } from "./requireCollectiveMember";
import { log } from "./logger";

export type CollectiveDenialReason =
  | "not_authed"
  | "not_collective_member"
  | "partner_only"
  | "application_pending"
  | "billing_deactivation_pending"
  | "not_on_cap_table"
  | "accreditation_required"
  | "accreditation_unavailable"
  | "unknown";

export type CollectiveAccessDecision =
  | { allow: true; adminBypass: boolean }
  | { allow: false; reason: CollectiveDenialReason };

export interface CollectiveDecisionSubject {
  userId?: string;
  isAuthed?: boolean;
  isAdmin?: boolean;
  collective?: { status?: string };
}

type Tri = true | false | "error";

/* ------------------------------------------------------------------ *
 * v6 §2 — strict founder / investor application readers.
 *
 * `application_pending` must come from a NAMED durable source, never from a
 * cache and never inferred. Two tables carry the signal:
 *   • `founder_collective_applications` (shared/schema.ts:1623), keyed by
 *     `founder_id`; statuses submitted | reviewing | invited | rejected |
 *     waitlisted — "still in flight" is submitted | reviewing | waitlisted.
 *   • `collective_apps` (shared/schema.ts:1562), keyed by `user_id`; statuses
 *     submitted | approved | rejected | withdrawn — "still in flight" is
 *     submitted.
 * `consortium_applications` (shared/schema.ts:2466) is the PARTNER track and is
 * deliberately NOT part of this signal.
 *
 * A read failure in EITHER table yields `"error"` for the combined signal, which
 * maps to `reason:"unknown"` → retry card. It must never map to
 * `application_pending`: telling a user "your application is being reviewed"
 * because a table was unreadable is a fabricated status on a gating surface.
 * ------------------------------------------------------------------ */

const FOUNDER_APP_PENDING_STATUSES = ["submitted", "reviewing", "waitlisted"] as const;
const INVESTOR_APP_PENDING_STATUSES = ["submitted"] as const;

/** Strict reader: does the user have an in-flight FOUNDER collective application? */
export function hasPendingFounderApplicationTri(userId: string): Tri {
  if (!userId) return false;
  try {
    const ph = FOUNDER_APP_PENDING_STATUSES.map(() => "?").join(",");
    const row = rawDb()
      .prepare(
        `SELECT 1 FROM founder_collective_applications
          WHERE founder_id = ?
            AND status IN (${ph})
            AND (deleted_at IS NULL OR deleted_at = '')
          LIMIT 1`,
      )
      .get(userId, ...FOUNDER_APP_PENDING_STATUSES);
    return !!row;
  } catch (err) {
    log.warn(
      "[collectiveAccessDecision] founder_collective_applications read failed for",
      userId,
      "-",
      (err as Error).message,
    );
    return "error";
  }
}

/** Strict reader: does the user have an in-flight INVESTOR collective application? */
export function hasPendingInvestorApplicationTri(userId: string): Tri {
  if (!userId) return false;
  try {
    const ph = INVESTOR_APP_PENDING_STATUSES.map(() => "?").join(",");
    const row = rawDb()
      .prepare(
        `SELECT 1 FROM collective_apps
          WHERE user_id = ?
            AND status IN (${ph})
            AND (deleted_at IS NULL OR deleted_at = '')
          LIMIT 1`,
      )
      .get(userId, ...INVESTOR_APP_PENDING_STATUSES);
    return !!row;
  } catch (err) {
    log.warn(
      "[collectiveAccessDecision] collective_apps read failed for",
      userId,
      "-",
      (err as Error).message,
    );
    return "error";
  }
}

/**
 * Combined application signal across BOTH tables. `"error"` from either table
 * wins, because a half-read cannot prove "no application exists".
 */
export function hasPendingCollectiveApplicationTri(userId: string): Tri {
  const founder = hasPendingFounderApplicationTri(userId);
  const investor = hasPendingInvestorApplicationTri(userId);
  if (founder === "error" || investor === "error") return "error";
  return founder === true || investor === true;
}

/** Tri-state accreditation read. Source can throw, so "error" is distinct. */
export function accreditationStatusTri(
  userId: string,
): "none" | "self_certified" | "verified" | "error" {
  try {
    return getAccreditationGateStatus(userId).status;
  } catch (err) {
    log.warn(
      "[collectiveAccessDecision] accreditation read failed for",
      userId,
      "-",
      (err as Error).message,
    );
    return "error";
  }
}

/** Tri-state cap-table read (`isOnCapTable` throws rather than returning false). */
export function onCapTableTri(userId: string): Tri {
  try {
    return isOnCapTable(userId) === true;
  } catch {
    return "error";
  }
}

/** Tri-state partner-session read. */
export function isPartnerSessionTri(userId: string): Tri {
  try {
    return !!partnerTeamStore.findByUserId(userId);
  } catch {
    return "error";
  }
}

/**
 * Resolve the shared access decision for a subject.
 *
 * The order below MIRRORS `requireCollectiveMember` deliberately. Do not
 * reorder: moving the billing override above the admin bypass would lock admins
 * out of moderation the moment their own billing lapsed, and moving the
 * cap-table check above the active-member sources would deny non-members with a
 * cap-table-shaped reason.
 */
export function resolveCollectiveAccessDecision(
  subject: CollectiveDecisionSubject | undefined,
): CollectiveAccessDecision {
  const userId = subject?.userId;

  // ---- 0: identity (v5 §C — v4 omitted this reason entirely) ----
  if (!userId || subject?.isAuthed === false) {
    return { allow: false, reason: "not_authed" };
  }

  // ---- 1: ADMIN BYPASS FIRST (before any billing override) ----
  if (subject?.isAdmin === true || isDbAdmin(userId)) {
    return { allow: true, adminBypass: true };
  }

  // ---- 2: fail-closed billing / deactivation override ----
  const openMarker = hasOpenMembershipDeactivationTri(userId);
  const lapsedBilling = hasCancelledOrPastDueBillingTri(userId);
  if (openMarker === "error" || lapsedBilling === "error") {
    // Deny, but as "unreadable" — the client shows the retry card, not billing
    // copy. The server middleware independently denies via its boolean path.
    return { allow: false, reason: "unknown" };
  }
  if (openMarker === true || lapsedBilling === true) {
    return { allow: false, reason: "billing_deactivation_pending" };
  }

  // ---- 3: active-member sources (any one counts, same as the middleware) ----
  const fromAdminStore = (() => {
    try {
      return collectiveMembershipStore.isActive(userId) === true;
    } catch {
      return false;
    }
  })();
  let fromSeedStore = false;
  try {
    const m = getMembership(userId);
    fromSeedStore = !!m && m.isCollectiveMember === true;
  } catch {
    /* not available in every context — same tolerance as the middleware */
  }
  const fromCtxOverlay = subject?.collective?.status === "active";
  const isActiveMember =
    fromAdminStore || fromSeedStore || fromCtxOverlay || isDbActiveMember(userId);

  if (!isActiveMember) {
    // Partner-only session → route them to the partner workspace.
    const partner = isPartnerSessionTri(userId);
    if (partner === true) return { allow: false, reason: "partner_only" };
    // DISPLAY substate only. On "error" we report `unknown` (retry card) rather
    // than guessing at an application status.
    const pendingApp = hasPendingCollectiveApplicationTri(userId);
    if (pendingApp === "error") return { allow: false, reason: "unknown" };
    if (pendingApp === true) return { allow: false, reason: "application_pending" };
    return { allow: false, reason: "not_collective_member" };
  }

  // ---- 4: cap-table sub-check (exempt-aware) ----
  let capTableExempt = false;
  try {
    capTableExempt = collectiveMembershipStore.get(userId)?.capTableExempt === true;
  } catch {
    capTableExempt = false; // fail-closed: treat as non-exempt
  }
  if (!capTableExempt) {
    const onCapTable = onCapTableTri(userId);
    if (onCapTable === "error") return { allow: false, reason: "unknown" };
    if (onCapTable === false) return { allow: false, reason: "not_on_cap_table" };
  }

  // ---- 5: first-sign-on accreditation capture ----
  const accred = accreditationStatusTri(userId);
  if (accred === "error") {
    return { allow: false, reason: "accreditation_unavailable" };
  }
  if (accred === "none") {
    return { allow: false, reason: "accreditation_required" };
  }

  return { allow: true, adminBypass: false };
}

/** Human copy per reason. Kept beside the union so a new reason cannot ship mute. */
export const COLLECTIVE_DENIAL_MESSAGES: Record<CollectiveDenialReason, string> = {
  not_authed: "Sign in to continue.",
  not_collective_member:
    "Your account isn't an active Collective member yet. If you applied recently, an admin still needs to approve your membership.",
  partner_only:
    "You're signed in as a consortium partner. Switch to your partner workspace to continue.",
  application_pending:
    "Your Collective application is with our review team. Access unlocks automatically once it's approved.",
  billing_deactivation_pending:
    "Your Collective membership is being updated after a billing change. Access will resume once billing is current.",
  not_on_cap_table:
    "Collective membership requires an active cap-table position. Once you hold equity in a Collective company you'll gain access.",
  accreditation_required:
    "Please complete your accredited-investor self-declaration to enter Collective. This is a self-certification, not KYC/AML.",
  accreditation_unavailable:
    "We couldn't verify your accreditation status right now. Please refresh or try again shortly.",
  unknown: "We could not verify your Collective access. Refresh or contact support.",
};

export default resolveCollectiveAccessDecision;
