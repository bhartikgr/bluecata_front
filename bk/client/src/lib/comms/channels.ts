/**
 * Sprint 9 — Channel-membership recompute logic (pure functions).
 *
 * These are the rules that drive cap-table channel + soft-circle channel
 * membership in response to financial events. Pulled out into a pure
 * module so they can be unit-tested without spinning up the server.
 *
 * Cap-table channel rules
 *   - Founder is ALWAYS in the channel.
 *   - Every current security-holding user is in the channel — but their
 *     posted messages render as "[Anonymous Holder]" unless visibleToCoMembers.
 *   - When a holder fully transfers their position out, they are removed.
 *
 * Soft-circle channel rules
 *   - Created on first soft-circle.created event for a round.
 *   - Founder + every current soft-circler (including not-yet-confirmed) are members.
 *   - On soft-circle.signed → user remains in soft-circle channel until round.closed.
 *     User is also added to the cap-table channel (security issued).
 *   - On soft-circle.cancelled (declined / withdrawn) → user removed.
 *   - On round.closed → channel.archivedAt set; participants frozen for read.
 */

import type { Channel } from "./types";
import {
  capTableChannelId,
  softCircleChannelId,
} from "./types";

/* ==================================================================== */
/* CAP-TABLE CHANNEL                                                    */
/* ==================================================================== */

export interface CapTableHolderRef {
  /** Linked user-id, if the holder has a Capavate account. */
  userId?: string;
  /** Outstanding shares > 0 means the holder is currently on the cap table. */
  shares: number;
  /**
   * Investment amount > 0 (for SAFEs / notes that might have shares=0 but
   * still represent a position). Either > 0 ⇒ included.
   */
  investmentAmount?: number;
}

export interface CapTableMembershipInput {
  companyId: string;
  founderUserId: string;
  holders: CapTableHolderRef[];
}

export function computeCapTableMembers(input: CapTableMembershipInput): string[] {
  const set = new Set<string>();
  set.add(input.founderUserId);
  for (const h of input.holders) {
    if (!h.userId) continue;
    const hasShares = h.shares > 0;
    const hasInvestment = (h.investmentAmount ?? 0) > 0;
    if (hasShares || hasInvestment) set.add(h.userId);
  }
  return Array.from(set);
}

export function ensureCapTableChannel(
  existing: Channel | undefined,
  input: CapTableMembershipInput,
  nowIso: string,
): Channel {
  const id = capTableChannelId(input.companyId);
  const members = computeCapTableMembers(input);
  if (!existing) {
    return {
      id,
      kind: "cap_table",
      companyId: input.companyId,
      participantUserIds: members,
      createdAt: nowIso,
      metadata: { founderUserId: input.founderUserId },
    };
  }
  return {
    ...existing,
    participantUserIds: members,
  };
}

/**
 * Diff old vs new membership and return the set of additions/removals plus
 * a reason code for each — drives the `cap_table_channel.member_*` events.
 */
export function diffCapTableMembership(
  before: string[],
  after: string[],
): { added: string[]; removed: string[] } {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const added: string[] = [];
  const removed: string[] = [];
  afterSet.forEach((id) => {
    if (!beforeSet.has(id)) added.push(id);
  });
  beforeSet.forEach((id) => {
    if (!afterSet.has(id)) removed.push(id);
  });
  return { added, removed };
}

/* ==================================================================== */
/* SOFT-CIRCLE CHANNEL                                                  */
/* ==================================================================== */

export type SoftCircleStatus =
  | "intent"      // declared interest but not signed
  | "committed"   // confirmed allocation
  | "confirmed"   // founder confirmed back
  | "signed"      // documents signed
  | "funded"      // wires received
  | "cancelled"   // withdrew / declined
  ;

export interface SoftCircleRef {
  /** Linked user-id, if the soft-circler has a Capavate account. */
  userId?: string;
  status: SoftCircleStatus;
}

export interface SoftCircleMembershipInput {
  roundId: string;
  founderUserId: string;
  /** All current soft-circles for the round (any status). */
  softCircles: SoftCircleRef[];
  /** Has the round been closed? (drives archival.) */
  roundClosed?: boolean;
}

/**
 * Compute who should currently be a member of the per-round soft-circle channel.
 *
 * - Founder is always present.
 * - Soft-circlers in `intent | committed | confirmed | signed | funded` remain.
 *   (Signed users remain until the round closes — per the spec banner.)
 * - `cancelled` soft-circlers are removed.
 */
export function computeSoftCircleMembers(input: SoftCircleMembershipInput): string[] {
  const set = new Set<string>();
  set.add(input.founderUserId);
  for (const sc of input.softCircles) {
    if (!sc.userId) continue;
    if (sc.status === "cancelled") continue;
    set.add(sc.userId);
  }
  return Array.from(set);
}

export function ensureSoftCircleChannel(
  existing: Channel | undefined,
  input: SoftCircleMembershipInput,
  nowIso: string,
): Channel {
  const id = softCircleChannelId(input.roundId);
  const members = computeSoftCircleMembers(input);
  const archivedAt = input.roundClosed ? (existing?.archivedAt ?? nowIso) : existing?.archivedAt;
  if (!existing) {
    return {
      id,
      kind: "soft_circle",
      roundId: input.roundId,
      participantUserIds: members,
      createdAt: nowIso,
      archivedAt,
      metadata: { founderUserId: input.founderUserId },
    };
  }
  return {
    ...existing,
    participantUserIds: members,
    archivedAt,
  };
}

/**
 * Helper — given a soft-circle status transition, derive the lifecycle
 * reason code emitted on the cap-table channel event.
 */
export function softCircleTransitionReason(
  before: SoftCircleStatus | undefined,
  after: SoftCircleStatus,
): "soft_circle_created" | "soft_circle_signed" | "soft_circle_withdrawn" | "round_closed" | "no_change" {
  if (before === after) return "no_change";
  if (!before) return "soft_circle_created";
  if (after === "cancelled") return "soft_circle_withdrawn";
  if (after === "signed") return "soft_circle_signed";
  return "no_change";
}
