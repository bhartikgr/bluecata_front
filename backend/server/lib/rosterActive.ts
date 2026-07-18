/**
 * W-INVEST BUG B (2026-07-17) — founder-roster "Active" investor predicate.
 *
 * An investor is "Active" on the founder roster when they are committed/funded on
 * THIS round OR already hold a committed position in the company's cap table (from
 * a prior round). The two committed-identity sets are derived (read-only) from the
 * SACRED committed ledger (captableCommitStore.listMembersForCompany, state ===
 * "committed") in the route handler; this module holds only the pure row-level
 * predicate so it is unit-testable without a DB.
 */

export type CommittedSets = {
  /** investorId of every committed cap-table position in the company. */
  committedInvestorIds: Set<string>;
  /** invitationId of every committed cap-table position in the company. */
  committedInvitationIds: Set<string>;
};

/** Roster invitation row (public view) — only the fields the predicate needs. */
export type RosterInvitationLike = {
  id: string;
  redeemedByUserId?: string | null;
};

/** Roster soft-circle row — only the fields the predicate needs. */
export type RosterSoftCircleLike = {
  status?: string | null;
  invitationId?: string | null;
  investorUserId?: string | null;
};

export function isInvitationActive(inv: RosterInvitationLike, sets: CommittedSets): boolean {
  return sets.committedInvitationIds.has(String(inv.id))
    || (inv.redeemedByUserId != null && sets.committedInvestorIds.has(String(inv.redeemedByUserId)));
}

export function isSoftCircleActive(sc: RosterSoftCircleLike, sets: CommittedSets): boolean {
  return sc.status === "committed" || sc.status === "wired"
    || (sc.invitationId != null && sets.committedInvitationIds.has(String(sc.invitationId)))
    || (sc.investorUserId != null && sets.committedInvestorIds.has(String(sc.investorUserId)));
}
