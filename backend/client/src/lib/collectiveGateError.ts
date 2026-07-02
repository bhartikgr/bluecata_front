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
