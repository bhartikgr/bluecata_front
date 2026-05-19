/**
 * Sprint 9 — Visibility resolver.
 *
 * THE single source of truth for "what name does Viewer V see when looking
 * at Author A?" — used everywhere identity renders (cap-table holder list,
 * cap-table co-member list on Company Detail, message author names, post
 * author names, DM thread headers, reaction tooltips).
 *
 * Rules (in priority order):
 *   1. If viewerUserId === authorUserId → real name.
 *   2. If author is the founder of the company in this surface → real name
 *      (founder identity is inherently public to their stakeholders).
 *   3. If author has visibleToCoMembers=true AND viewer + author share at
 *      least one cap table → screen name + canSendDm.
 *   4. If author has visibleToCollectiveNetwork=true AND viewer + author
 *      share a Collective surface → screen name + canSendDm.
 *   5. Otherwise → "[Anonymous Holder]" + DM disabled.
 *
 * The resolver is INTENTIONALLY pure — no I/O, no side effects. The caller
 * pre-computes shared context (cap tables / Collective chapters) and the
 * author's profile.privacy block, then asks the resolver.
 *
 * Edge case — past messages do NOT retroactively become anonymous when a
 * holder revokes visibility. Consent at write-time stands. The resolver is
 * always called per-message with the AUTHOR'S CURRENT visibility — the
 * caller is responsible for materialising the author's identity at write
 * time on any history they want to remain attributable.
 */

import type { Visibility } from "./types";

export interface ResolvedIdentity {
  /** What Viewer V should render for Author A on this surface. */
  displayName: string;
  /** True iff the resolver fell to the anonymous fallback. */
  isAnonymous: boolean;
  /** Whether Viewer V is allowed to start a DM with Author A. */
  canSendDm: boolean;
  /**
   * Reason for the resolved decision — useful for tooltips + telemetry.
   *  - self                : viewer is author
   *  - founder_passthrough : author is the founder of the company surface
   *  - co_member_visible   : opted-in cap-table co-member
   *  - collective_visible  : opted-in Collective network
   *  - anonymous           : default fallback
   */
  reason:
    | "self"
    | "founder_passthrough"
    | "co_member_visible"
    | "collective_visible"
    | "anonymous";
}

export interface ResolverInput {
  /** Authenticated viewer's user id. */
  viewerUserId: string;
  /** The user whose name we are resolving. */
  authorUserId: string;
  /** Author's legal name (production: never sent to the wire if anonymous). */
  authorLegalName: string;
  /** Author's privacy block — see profile.types.InvestorVisibility. */
  authorVisibility: Visibility;
  /** Shared context — what cap tables / Collective surfaces are common. */
  context: {
    /** Company IDs whose cap tables both viewer and author belong to. */
    sharedCapTables: string[];
    /** Collective chapter / DSC IDs both viewer and author are in. */
    sharedCollectiveChapters: string[];
    /**
     * Optional: when set, the surface we are rendering on is a company
     * surface where this user is the founder. If author === founderUserId
     * we ALWAYS show the real name (founder identity is public).
     */
    founderUserId?: string;
  };
}

/** "[Anonymous Holder]" — the literal label rendered when no opt-in applies. */
export const ANONYMOUS_LABEL = "[Anonymous Holder]";

export function resolveDisplayIdentity(input: ResolverInput): ResolvedIdentity {
  const { viewerUserId, authorUserId, authorLegalName, authorVisibility, context } = input;

  // Rule 1 — self-view.
  if (viewerUserId === authorUserId) {
    return {
      displayName: authorLegalName,
      isAnonymous: false,
      canSendDm: false, // can't DM yourself
      reason: "self",
    };
  }

  // Rule 2 — founder pass-through.
  if (context.founderUserId && context.founderUserId === authorUserId) {
    return {
      displayName: authorLegalName,
      isAnonymous: false,
      canSendDm: true,
      reason: "founder_passthrough",
    };
  }

  const screenName = (authorVisibility.screenName ?? "").trim();

  // Rule 3 — cap-table co-member opt-in.
  if (
    authorVisibility.visibleToCoMembers &&
    screenName.length > 0 &&
    context.sharedCapTables.length > 0
  ) {
    return {
      displayName: screenName,
      isAnonymous: false,
      canSendDm: true,
      reason: "co_member_visible",
    };
  }

  // Rule 4 — Collective network opt-in.
  if (
    authorVisibility.visibleToCollectiveNetwork &&
    screenName.length > 0 &&
    context.sharedCollectiveChapters.length > 0
  ) {
    return {
      displayName: screenName,
      isAnonymous: false,
      canSendDm: true,
      reason: "collective_visible",
    };
  }

  // Rule 5 — anonymous fallback.
  return {
    displayName: ANONYMOUS_LABEL,
    isAnonymous: true,
    canSendDm: false,
    reason: "anonymous",
  };
}

/**
 * Helper — given a list of authors and a viewer, resolve all of them in one
 * pass. Used to render holder lists and message lists.
 */
export function resolveDisplayIdentitiesForList(
  authors: Array<Omit<ResolverInput, "viewerUserId" | "context"> & {
    context: ResolverInput["context"];
  }>,
  viewerUserId: string,
): Map<string, ResolvedIdentity> {
  const map = new Map<string, ResolvedIdentity>();
  for (const a of authors) {
    map.set(
      a.authorUserId,
      resolveDisplayIdentity({
        viewerUserId,
        authorUserId: a.authorUserId,
        authorLegalName: a.authorLegalName,
        authorVisibility: a.authorVisibility,
        context: a.context,
      }),
    );
  }
  return map;
}

/**
 * Convenience wrapper for surfaces that already know the viewer's user id —
 * returns a function that resolves any author on the same shared-context.
 */
export function makeResolverFor(
  viewerUserId: string,
  context: ResolverInput["context"],
) {
  return (
    authorUserId: string,
    authorLegalName: string,
    authorVisibility: Visibility,
  ): ResolvedIdentity =>
    resolveDisplayIdentity({
      viewerUserId,
      authorUserId,
      authorLegalName,
      authorVisibility,
      context,
    });
}
