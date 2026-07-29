/**
 * PF-UX-1 — Collective membership gate helper.
 *
 * When a Collective endpoint 403s because the caller is not an active
 * Collective member (codes "not_collective_member" or "COLLECTIVE_INACTIVE"),
 * pages should render a friendly notice instead of the generic
 * "Failed to load. Please refresh." error banner.
 *
 * Usage:
 *   import { isCollectiveMembershipError, CollectiveMembershipNotice } from "@/lib/collectiveGateError";
 *
 *   if (isCollectiveMembershipError(error)) return <CollectiveMembershipNotice />;
 */

import React from "react";
import { Link } from "wouter";
import { ApiError } from "@/lib/queryClient";

const COLLECTIVE_GATE_CODES = new Set<string>([
  "not_collective_member",
  "COLLECTIVE_INACTIVE",
]);

/**
 * Returns true when the given error is an ApiError with HTTP 403 and one of
 * the collective-membership gate codes ("not_collective_member" or
 * "COLLECTIVE_INACTIVE").
 */
export function isCollectiveMembershipError(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.status !== 403) return false;
  return err.code !== null && COLLECTIVE_GATE_CODES.has(err.code);
}

/**
 * Every denial code a Collective gate can put on a 403, with widget-sized
 * honest copy for each.
 *
 * W-COLLECTIVE Wave 1 review fix B11 — this map replaces a 2-code set. The gate
 * can return six distinct 403 codes, but only `not_collective_member` and
 * `COLLECTIVE_INACTIVE` were recognised, so a member refused for any other
 * reason still saw "Couldn't load …" — the platform blaming itself for a correct
 * refusal, which is the exact defect widget honesty exists to fix.
 *
 * Sources, so a new code cannot ship mute:
 *   • `server/lib/requireCollectiveMember.ts` — `not_collective_member` (:120,
 *     :234, :246), `not_on_cap_table` (:169),
 *     `ACCREDITATION_STATUS_UNAVAILABLE` (:194),
 *     `ACCREDITATION_DECLARATION_REQUIRED` (:204).
 *   • `server/lib/requireEntitlement.ts:41` — `COLLECTIVE_INACTIVE`.
 *   • `server/lib/collectiveAccessDecision.ts:50` — the shared decision's
 *     `denialReason` union, published by `/api/collective/gate-state` and usable
 *     as an error code by any caller that forwards it.
 *
 * The two ORIGINAL codes keep their original text byte-for-byte, so no existing
 * message is removed or reworded. Copy is deliberately short rather than an echo
 * of the server's longer `message`: these strings render in a small widget error
 * slot, whereas the server copy is written for a full-page gate blocker.
 */
const COLLECTIVE_DENIAL_COPY: Readonly<Record<string, string>> = Object.freeze({
  /* --- pre-existing, unchanged --- */
  not_collective_member: "Collective membership required.",
  COLLECTIVE_INACTIVE: "Collective membership required.",
  /* --- B11: previously unmapped, rendered "Couldn't load…" --- */
  not_on_cap_table: "Collective access needs an active cap-table position.",
  ACCREDITATION_DECLARATION_REQUIRED:
    "Complete your accredited-investor declaration to view this.",
  ACCREDITATION_STATUS_UNAVAILABLE:
    "We couldn’t check your accreditation status. Try again shortly.",
  /* --- B11: the shared decision's remaining reasons --- */
  not_authed: "Sign in to view this.",
  partner_only: "Switch to your partner workspace to view this.",
  application_pending: "Your Collective application is still under review.",
  billing_deactivation_pending:
    "Your Collective membership is updating after a billing change.",
  accreditation_required:
    "Complete your accredited-investor declaration to view this.",
  accreditation_unavailable:
    "We couldn’t check your accreditation status. Try again shortly.",
});

/** Every code `collectiveWidgetErrorText` treats as an honest refusal. */
export const COLLECTIVE_DENIAL_CODES: readonly string[] = Object.freeze(
  Object.keys(COLLECTIVE_DENIAL_COPY),
);

/**
 * True when `err` is a 403 from a Collective gate — i.e. the server refused on
 * purpose and there is honest copy for it.
 *
 * Deliberately distinct from `isCollectiveMembershipError`, which stays narrow:
 * that predicate gates `CollectiveMembershipNotice`, whose copy and
 * "Go to Collective Membership" link are only correct for an inactive
 * MEMBERSHIP. Routing an accreditation or cap-table denial there would send the
 * user to a page that cannot resolve their block.
 */
export function isCollectiveGateDenial(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.status !== 403) return false;
  return err.code !== null && Object.prototype.hasOwnProperty.call(COLLECTIVE_DENIAL_COPY, err.code);
}

/**
 * W-COLLECTIVE Wave 1 (v4 §1.1 "widget honesty") — shared error text for the
 * Collective dashboard widgets.
 *
 * Every widget had its own hardcoded `Couldn't load <thing>.` branch, so a
 * non-member (or a member the gate denied) saw fourteen identical
 * "something broke" messages when in fact nothing was broken — the server had
 * correctly refused. That reads as a platform fault and generates support load.
 *
 * Returns honest copy when the failure IS a Collective gate refusal, and
 * otherwise the widget's own fallback verbatim. Purely a copy change: no widget
 * is removed, no error branch disappears, and a genuine transport failure still
 * says what it always said.
 */
export function collectiveWidgetErrorText(err: unknown, fallback: string): string {
  if (!isCollectiveGateDenial(err)) return fallback;
  const code = (err as ApiError).code as string;
  return COLLECTIVE_DENIAL_COPY[code] ?? fallback;
}

/**
 * Friendly notice shown in place of the generic error banner when a
 * Collective page 403s with a membership gate code.
 */
export function CollectiveMembershipNotice(): React.ReactElement {
  return React.createElement(
    "div",
    {
      className:
        "rounded-md border border-amber-200 bg-amber-50 p-5 flex flex-col items-start gap-3 text-sm",
      "data-testid": "collective-membership-notice",
    },
    React.createElement(
      "p",
      { className: "text-amber-900 font-medium" },
      "Your Collective membership isn\u2019t active yet \u2014 join or pending approval"
    ),
    React.createElement(
      "p",
      { className: "text-amber-800 text-xs" },
      "You need an active Collective membership to access this page. If you\u2019ve already applied, your membership may be pending admin approval."
    ),
    React.createElement(
      Link,
      {
        to: "/collective/membership",
        className:
          "inline-flex items-center gap-1.5 rounded-md bg-amber-700 hover:bg-amber-800 text-white text-xs font-medium px-3 py-1.5 transition-colors",
      },
      "Go to Collective Membership \u2192"
    )
  );
}
