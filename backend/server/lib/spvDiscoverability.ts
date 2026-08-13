/**
 * WAVE 33 · CP-SPV-53 — SPV private / invite-only / discoverable.
 *
 * THE PURE PREDICATE. No database, no request, no clock — so both poles of
 * every rule can be asserted directly rather than inferred from a route.
 *
 * ── WHAT WAS ACTUALLY WRONG ─────────────────────────────────────────────────
 * `server/spvEngineStore.ts:478` reads:
 *
 *     if (scope === "private" || scope === "invite_only") return false;
 *
 * `invite_only` was therefore excluded from every discovery context for every
 * viewer, INCLUDING the invited one. `spv_lp_invite` rows existed and a GP
 * invite route existed, but nothing joined an invitation to visibility. So the
 * platform shipped three scopes of which only two behaved differently, and the
 * one a GP would reach for when they want a private-but-shared vehicle was a
 * silent synonym for `private`.
 *
 * That existing line is NOT weakened. `listVisibleForContext` is a BROADCAST
 * predicate: it answers "may this vehicle be pushed at an audience with no
 * relationship to it?", and for `invite_only` the answer is still no. What was
 * missing is a second, VIEWER-SCOPED question — "may THIS person, who holds an
 * invitation, reach it?" — which is a different question with a different
 * answer and needed its own predicate. Widening the broadcast filter would have
 * published invite-only vehicles to the whole Collective.
 *
 * ── FAIL-CLOSED ─────────────────────────────────────────────────────────────
 * Every function here denies on anything it does not recognise. An unknown
 * scope string is not discoverable, an unknown context is not discoverable, and
 * an absent invitation is not an invitation. The default direction of every
 * branch is DENY, so a future scope added to the enum without being added here
 * is invisible rather than public.
 */

/** The four scopes the store already persists in `spv.distribution_scope`. */
export type SpvScope = "private" | "invite_only" | "collective_only" | "network";

/**
 * Discovery contexts.
 *   collective / capavate / network — BROADCAST audiences: a viewer with no
 *     prior relationship to the vehicle.
 *   invited — the VIEWER-SCOPED context: this person holds an invitation to
 *     this specific vehicle. It is not an audience; it is a relationship.
 */
export type SpvDiscoveryContext = "collective" | "capavate" | "network" | "invited";

export const SPV_SCOPES: readonly SpvScope[] = ["private", "invite_only", "collective_only", "network"];
export const SPV_DISCOVERY_CONTEXTS: readonly SpvDiscoveryContext[] = [
  "collective",
  "capavate",
  "network",
  "invited",
];

export function isSpvScope(v: unknown): v is SpvScope {
  return typeof v === "string" && (SPV_SCOPES as readonly string[]).includes(v);
}

export function isSpvDiscoveryContext(v: unknown): v is SpvDiscoveryContext {
  return typeof v === "string" && (SPV_DISCOVERY_CONTEXTS as readonly string[]).includes(v);
}

/**
 * BROADCAST reach. Mirrors `spvEngineStore.listVisibleForContext` exactly and
 * exists so that behaviour is testable as a value rather than only through a
 * store that needs a database. Any divergence between the two is a defect, and
 * the harness asserts they agree on all 4 x 3 combinations.
 */
export function isBroadcastDiscoverable(scope: unknown, context: unknown): boolean {
  if (!isSpvScope(scope)) return false;
  if (!isSpvDiscoveryContext(context)) return false;
  // `invited` is not a broadcast audience. Answering it here would let a
  // viewer-scoped relationship be mistaken for public reach.
  if (context === "invited") return false;
  if (scope === "private" || scope === "invite_only") return false;
  // collective_only is FIRST-CLASS: the Collective context and nowhere else.
  if (scope === "collective_only") return context === "collective";
  if (scope === "network") return true;
  return false;
}

/**
 * VIEWER-SCOPED reach — the half that did not exist.
 *
 * `hasInvitation` must be established from a real, live `spv_lp_invite` row by
 * the caller. It is passed in rather than looked up so this module stays pure
 * and so the invitation lookup has exactly one implementation (the store).
 *
 * A `private` vehicle is NOT reachable even with an invitation: `private` means
 * the GP has said no one outside the roster sees it, and an invitation that
 * silently overrode that would make the two scopes indistinguishable in the
 * other direction. To share a vehicle the GP must select `invite_only` — which
 * is now a meaningful choice for the first time.
 */
export function isReachableByViewer(
  scope: unknown,
  context: unknown,
  viewer: { hasInvitation: boolean },
): boolean {
  if (!isSpvScope(scope)) return false;
  if (!isSpvDiscoveryContext(context)) return false;
  if (context === "invited") {
    if (viewer.hasInvitation !== true) return false;
    // An invitation reaches invite_only vehicles. It does not upgrade a
    // private one, and it is redundant (but harmless) for a broadcast scope.
    return scope === "invite_only" || scope === "collective_only" || scope === "network";
  }
  return isBroadcastDiscoverable(scope, context);
}

/**
 * Server-authored copy stating what a scope ACTUALLY does, printed verbatim by
 * the UI. The wording is deliberately about reach, not about intent: the defect
 * this item fixes was a label that described an intent the system never
 * honoured.
 */
export const SPV_SCOPE_REACH_COPY: Record<SpvScope, string> = {
  private:
    "Private. This vehicle is visible only to you and its existing roster. It is not broadcast anywhere, and an invitation does not grant access to a private vehicle — change the scope to invite-only to share it.",
  invite_only:
    "Invite-only. This vehicle is not broadcast to any audience. It is reachable only by the people you have invited by email, and only while their invitation is live.",
  collective_only:
    "Collective only. Discoverable by Capavate Collective members. It is deliberately excluded from the core Capavate investor surfaces.",
  network:
    "Network. Discoverable across the Collective and on the core Capavate investor surfaces.",
};

/**
 * The honest answer to "who can actually reach this vehicle right now?".
 *
 * `invitationCount` and `reachEvents` are counts of ROWS, supplied by the
 * store. When a scope claims broadcast reach the copy says so; when the only
 * reach is an invite list, it says how many invitations exist — and when there
 * are none it says nobody can reach it, which is the sentence SPV-53 exists to
 * make possible.
 */
export interface SpvReachSummary {
  scope: SpvScope | null;
  /** Contexts in which this vehicle is broadcast. Empty is a real answer. */
  broadcastContexts: SpvDiscoveryContext[];
  /** Live invitations. Null when unknown, never 0-for-unknown. */
  invitationCount: number | null;
  /** Distinct viewers who have actually resolved this vehicle. Null = unknown. */
  distinctViewers: number | null;
  /** Printed verbatim. Never assembled in the client. */
  reachCopy: string;
}

export function summariseReach(input: {
  scope: unknown;
  invitationCount: number | null;
  distinctViewers: number | null;
}): SpvReachSummary {
  const scope = isSpvScope(input.scope) ? input.scope : null;
  if (scope === null) {
    return {
      scope: null,
      broadcastContexts: [],
      invitationCount: input.invitationCount,
      distinctViewers: input.distinctViewers,
      reachCopy:
        "This vehicle has no recognised distribution scope recorded, so its reach cannot be stated. It is treated as unreachable until a scope is set.",
    };
  }
  const broadcastContexts = (["collective", "capavate", "network"] as SpvDiscoveryContext[]).filter(
    (c) => isBroadcastDiscoverable(scope, c),
  );
  const parts: string[] = [SPV_SCOPE_REACH_COPY[scope]];
  if (scope === "invite_only") {
    if (input.invitationCount === null) {
      parts.push("The number of live invitations could not be read, so its reach is unknown.");
    } else if (input.invitationCount === 0) {
      parts.push(
        "There are no live invitations, so nobody can currently reach this vehicle. Selecting invite-only does not by itself make it visible to anyone.",
      );
    } else {
      parts.push(
        `${input.invitationCount} live invitation${input.invitationCount === 1 ? "" : "s"} can reach it.`,
      );
    }
  }
  if (input.distinctViewers === null) {
    parts.push("Recorded reach could not be read.");
  } else if (input.distinctViewers === 0) {
    parts.push("No one has reached it through a discovery surface yet.");
  } else {
    parts.push(
      `${input.distinctViewers} ${input.distinctViewers === 1 ? "person has" : "people have"} reached it through a discovery surface.`,
    );
  }
  return {
    scope,
    broadcastContexts,
    invitationCount: input.invitationCount,
    distinctViewers: input.distinctViewers,
    reachCopy: parts.join(" "),
  };
}
