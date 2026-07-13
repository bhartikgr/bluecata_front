/**
 * SPINE-0 — Capavate v26.1.x Wave 2 (Option A single source of truth).
 *
 * This is THE ONE canonical place that maps every raw investor
 * invitation/position/eligibility signal onto the canonical ladder and
 * exposes derived, named selectors. After Wave 2, NO surface
 * (Dashboard / Invitations / ApplyToCollective / Messages / Portfolio) may
 * re-derive `state === x` locally — every surface imports the derived values
 * from here.
 *
 * Canonical ladder (Ozan-locked):
 *   invited → viewed → accepted → soft_circled → confirmed → signed → funded (= holding)
 *
 * Authoritative sources (reused, never fabricated):
 *   - ENH-1 durable your_decision_records + server/lib/userContext.ts
 *     `investor.invitedRounds` (already includes "accepted") via /api/auth/me.
 *   - GET /api/investor/invitations — the enriched per-invitation shape the
 *     surfaces already fetch (canonical `state` per round).
 *   - GET /api/investor/portfolio2 — funded cap-table holdings (positions).
 *
 * Fail-closed principle: an unknown/missing raw state maps to the SAFEST
 * bucket (`invited`), and a holding is NEVER fabricated — `holdings` only ever
 * reflects funded cap-table positions returned by the server.
 *
 * SANDBOX-SAFE: no Web Storage APIs; pure derivation + TanStack Query reads.
 *
 * Reference ladder: shared/schema.ts:721 YOUR_DECISION_STATES.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useEntitlement } from "@/lib/entitlement";

/* ==================================================================== */
/* Canonical ladder                                                     */
/* ==================================================================== */

/**
 * The canonical rungs, in order. This is the SINGLE definition of the
 * investor progression consumed by every surface.
 */
export const INVESTOR_LADDER = [
  "invited",
  "viewed",
  "accepted",
  "soft_circled",
  "confirmed",
  "signed",
  "funded",
] as const;

export type LadderStage = (typeof INVESTOR_LADDER)[number];

/** Terminal / non-actionable states that fall OFF the forward ladder. */
export type TerminalStage = "declined" | "expired" | "revoked";

/** The union every raw invitation state is normalized into. */
export type NormalizedStage = LadderStage | TerminalStage;

const LADDER_INDEX: Record<LadderStage, number> = INVESTOR_LADDER.reduce(
  (acc, stage, i) => {
    acc[stage] = i;
    return acc;
  },
  {} as Record<LadderStage, number>,
);

/**
 * Map a raw invitation/decision state (from the server, ENH-1 durable store,
 * userContext, or the 10-state YOUR_DECISION_STATES machine) onto the ONE
 * canonical ladder. This is the ONLY normalizer — surfaces must not re-map.
 *
 * Fail-closed: anything unrecognized maps to the safest forward rung
 * (`invited`) so a stale/garbage state can never masquerade as a holding.
 */
export function normalizeLadderState(raw: string | null | undefined): NormalizedStage {
  const s = (raw ?? "").trim().toLowerCase();
  switch (s) {
    // invited bucket — every "just received / not yet opened" alias
    case "invited":
    case "pending":
    case "sent":
    case "invite":
    case "invitation":
    case "":
      return "invited";
    case "viewed":
    case "opened":
    case "seen":
      return "viewed";
    case "accepted":
    case "accept":
      return "accepted";
    case "soft_circled":
    case "soft-circled":
    case "softcircled":
    case "soft_circle":
    case "intent":
    case "committed":
      return "soft_circled";
    case "confirmed":
      return "confirmed";
    case "signed":
      return "signed";
    case "funded":
    case "holding":
    case "wired":
      return "funded";
    // terminal / off-ladder
    case "declined":
    case "cancelled":
    case "canceled":
    case "withdrawn":
    case "rejected":
      return "declined";
    case "expired":
    case "lapsed":
      return "expired";
    case "revoked":
      return "revoked";
    default:
      // Fail-closed to the safest actionable rung — NEVER "funded".
      return "invited";
  }
}

/** True if a normalized stage sits on the forward ladder (not terminal). */
export function isLadderStage(s: NormalizedStage): s is LadderStage {
  return (INVESTOR_LADDER as readonly string[]).includes(s);
}

/**
 * Actionable = on the ladder and not yet at a final decision point.
 * Per Ozan: invited + viewed + accepted are the "pending/actionable" buckets
 * (accepted DOES count). soft_circled/confirmed/signed are "active" but past
 * the initial decision; funded is a holding, not an invitation.
 */
export function isPendingStage(s: NormalizedStage): boolean {
  return s === "invited" || s === "viewed" || s === "accepted";
}

/**
 * OnLadderStage = anything still live on the ladder short of funded (i.e. the
 * full pending set PLUS soft_circled/confirmed/signed). This is a broader,
 * separately-named concept than the Ozan-locked pending set.
 *
 * FIX #3 (count parity, Option A): this predicate is NOT the Invitations
 * "Active" tab. The "Active" tab and the Dashboard pending badge MUST count the
 * identical set = pendingInvitations (isPendingStage). This helper stays for a
 * legitimately broader "still on the forward ladder" meaning (e.g. any surface
 * that wants everything short of funded); it must never be re-wired to the
 * Active tab.
 */
export function isActiveStage(s: NormalizedStage): boolean {
  return isLadderStage(s) && s !== "funded";
}

export function isSoftCircledStage(s: NormalizedStage): boolean {
  // On or past the soft-circle rung, but not yet funded.
  if (!isLadderStage(s)) return false;
  return LADDER_INDEX[s] >= LADDER_INDEX.soft_circled && s !== "funded";
}

export function isFundedStage(s: NormalizedStage): boolean {
  return s === "funded";
}

/* ==================================================================== */
/* Shapes                                                               */
/* ==================================================================== */

/** Minimal raw invitation shape the spine consumes (superset-tolerant). */
export interface RawInvitationLike {
  id: string;
  state: string;
  company?: { id?: string; name?: string; sector?: string; description?: string };
  round?: { id?: string; name?: string; type?: string };
  [k: string]: unknown;
}

/** Minimal raw holding/position shape (funded cap-table position). */
export interface RawPositionLike {
  companyId: string;
  [k: string]: unknown;
}

/** An invitation with its canonical, normalized ladder stage attached. */
export interface SpineInvitation<T extends RawInvitationLike = RawInvitationLike> {
  raw: T;
  id: string;
  stage: NormalizedStage;
}

/** Channel unlock state derived from the ladder (drives Messages + copy). */
export interface ChannelUnlockState {
  /** Round ids for which a soft-circle channel is unlocked (soft_circled+). */
  softCircleRoundIds: string[];
  /** Company ids for which a cap-table channel is unlocked (funded holding). */
  capTableCompanyIds: string[];
  /** True once any soft-circle channel is unlocked. */
  hasSoftCircleChannel: boolean;
  /** True once any cap-table channel is unlocked. */
  hasCapTableChannel: boolean;
}

/** Eligibility signals for Collective — funded OR admin-granted (Ozan-locked). */
export interface EligibilitySignals {
  /** Funded cap-table position exists (the primary eligibility signal). */
  hasFundedPosition: boolean;
  /** Admin/chapter operator has granted access (server signal). */
  adminGranted: boolean;
  /** The unified verdict every surface (hero + gate) must agree on. */
  eligible: boolean;
  /** Human-readable reason set, consistent with the server. */
  reasons: string[];
}

/* ==================================================================== */
/* Pure selectors (framework-free, unit-testable)                       */
/* ==================================================================== */

/** Attach the canonical stage to each raw invitation. */
export function toSpineInvitations<T extends RawInvitationLike>(raw: T[] | null | undefined): SpineInvitation<T>[] {
  return (raw ?? []).map((r) => ({
    raw: r,
    id: r.id,
    stage: normalizeLadderState(r.state),
  }));
}

export function selectPendingInvitations<T extends RawInvitationLike>(
  invitations: SpineInvitation<T>[],
): SpineInvitation<T>[] {
  return invitations.filter((i) => isPendingStage(i.stage));
}

/**
 * Everything still live on the ladder short of funded (broader than pending).
 * NOTE (FIX #3): this is NOT the Invitations "Active" tab — that tab reads
 * selectPendingInvitations for count parity with the Dashboard badge.
 */
export function selectActiveInvitations<T extends RawInvitationLike>(
  invitations: SpineInvitation<T>[],
): SpineInvitation<T>[] {
  return invitations.filter((i) => isActiveStage(i.stage));
}

export function selectSoftCircledInvitations<T extends RawInvitationLike>(
  invitations: SpineInvitation<T>[],
): SpineInvitation<T>[] {
  return invitations.filter((i) => isSoftCircledStage(i.stage));
}

export function selectDeclinedInvitations<T extends RawInvitationLike>(
  invitations: SpineInvitation<T>[],
): SpineInvitation<T>[] {
  return invitations.filter((i) => i.stage === "declined");
}

export function selectExpiredInvitations<T extends RawInvitationLike>(
  invitations: SpineInvitation<T>[],
): SpineInvitation<T>[] {
  return invitations.filter((i) => i.stage === "expired" || i.stage === "revoked");
}

/**
 * Holdings = funded cap-table positions ONLY. Fail-closed: we NEVER synthesize
 * a holding from an invitation state. The authoritative source is the server's
 * funded positions list (/api/investor/portfolio2). An invitation that has
 * reached `funded` is corroborating, but the position list is the truth.
 */
export function selectHoldings<P extends RawPositionLike>(positions: P[] | null | undefined): P[] {
  return positions ?? [];
}

export function selectHasFundedPosition<P extends RawPositionLike>(
  positions: P[] | null | undefined,
): boolean {
  return (positions?.length ?? 0) > 0;
}

/** Derive the channel-unlock state from the ladder (single definition). */
export function selectChannelUnlockState<T extends RawInvitationLike, P extends RawPositionLike>(
  invitations: SpineInvitation<T>[],
  positions: P[] | null | undefined,
): ChannelUnlockState {
  const softCircleRoundIds = Array.from(
    new Set(
      invitations
        .filter((i) => isSoftCircledStage(i.stage))
        .map((i) => i.raw.round?.id)
        .filter((x): x is string => typeof x === "string" && x.length > 0),
    ),
  );
  const capTableCompanyIds = Array.from(
    new Set((positions ?? []).map((p) => p.companyId).filter((x) => typeof x === "string" && x.length > 0)),
  );
  return {
    softCircleRoundIds,
    capTableCompanyIds,
    hasSoftCircleChannel: softCircleRoundIds.length > 0,
    hasCapTableChannel: capTableCompanyIds.length > 0,
  };
}

/* ==================================================================== */
/* Wave 5 (ENH-2) dashboard selectors — pure, SPINE-0-only.             */
/* Every ENH-2 dashboard panel derives ONLY from these (or the existing  */
/* spine buckets above); no panel re-derives `state === x` locally.      */
/* ==================================================================== */

/** A decision-ladder activity event derived from the canonical ladder. */
export interface SpineActivityEvent {
  /** Stable id (the invitation id the rung belongs to). */
  id: string;
  /** The canonical ladder rung the invitation currently sits on. */
  stage: LadderStage;
  /** Full company name (rule #13 — rendered verbatim, first+last/full). */
  companyName: string;
  companyId: string;
  /** Round name/id when present. */
  roundName: string;
  roundId: string;
}

/** Human label per ladder rung, used by the Recent-activity panel. */
export const LADDER_EVENT_LABEL: Record<LadderStage, string> = {
  invited: "Invited to round",
  viewed: "Viewed round",
  accepted: "Accepted invitation",
  soft_circled: "Soft-circled",
  confirmed: "Confirmed commitment",
  signed: "Signed documents",
  funded: "Funded (holding)",
};

/**
 * Derive recent decision-ladder activity events ENTIRELY from the spine's
 * already-normalized invitations. We read each invitation's canonical `stage`
 * (NEVER re-map raw state here) and emit one event per on-ladder invitation.
 * Terminal (declined/expired/revoked) invitations are excluded from the
 * forward activity feed. Ordering is left to the caller.
 */
export function selectRecentActivity(
  invitations: SpineInvitation[],
): SpineActivityEvent[] {
  return invitations
    .filter((i) => isLadderStage(i.stage))
    .map((i) => ({
      id: i.id,
      stage: i.stage as LadderStage,
      companyName:
        (i.raw.company?.name && String(i.raw.company.name)) || "Company",
      companyId: (i.raw.company?.id && String(i.raw.company.id)) || "",
      roundName: (i.raw.round?.name && String(i.raw.round.name)) || "",
      roundId: (i.raw.round?.id && String(i.raw.round.id)) || "",
    }));
}

/**
 * The set of company ids the M&A panel should query intel for: the union of
 * the investor's funded holdings AND the companies they have been invited to
 * (any on-ladder invitation). Derived ONLY from spine buckets. De-duped,
 * order-stable (holdings first, then invited companies).
 */
export function selectMaCompanyIds(
  holdings: RawPositionLike[],
  invitations: SpineInvitation[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of holdings) {
    const id = h.companyId;
    if (typeof id === "string" && id.length > 0 && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  for (const i of invitations) {
    if (!isLadderStage(i.stage)) continue;
    const id = i.raw.company?.id;
    if (typeof id === "string" && id.length > 0 && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Compute the unified eligibility signals. Per Ozan: eligible = funded
 * cap-table position OR admin-granted. NOT accepted/soft-circled alone. This
 * MUST be the single verdict the hero and gate both read.
 */
export function computeEligibilitySignals(args: {
  hasFundedPosition: boolean;
  adminGranted: boolean;
}): EligibilitySignals {
  const { hasFundedPosition, adminGranted } = args;
  const eligible = hasFundedPosition || adminGranted;
  const reasons: string[] = [];
  if (hasFundedPosition) reasons.push("Funded position on a Capavate cap table.");
  if (adminGranted) reasons.push("Access granted by a Capavate Collective operator.");
  if (!eligible) {
    reasons.push(
      "A funded cap-table position is required. Soft-circle a round and complete funding, or request an operator grant.",
    );
  }
  return { hasFundedPosition, adminGranted, eligible, reasons };
}

/* ==================================================================== */
/* The hook — the ONLY place surfaces read derived investor state        */
/* ==================================================================== */

interface ServerEligibility {
  eligible?: boolean;
  reasons?: string[];
  passes?: Record<string, boolean>;
  collectiveStatus?: string;
  adminGranted?: boolean;
}

export interface InvestorSpine {
  /** Loading flag across the underlying authoritative queries. */
  isLoading: boolean;
  /** Every invitation with its canonical stage attached. */
  allInvitations: SpineInvitation[];
  /**
   * invited + viewed + accepted (actionable, Ozan-locked pending set).
   * FIX #3: this is the SINGLE source of truth for BOTH the Dashboard pending
   * badge AND the Invitations "Active" tab — both count this identical set.
   */
  pendingInvitations: SpineInvitation[];
  /**
   * Full ladder short of funded (pending PLUS soft_circled/confirmed/signed).
   * A broader, separately-named set — NOT the Invitations "Active" tab (see
   * FIX #3). Retained for any surface needing "everything short of funded".
   */
  activeInvitations: SpineInvitation[];
  /** soft_circled / confirmed / signed. */
  softCircledInvitations: SpineInvitation[];
  declinedInvitations: SpineInvitation[];
  expiredInvitations: SpineInvitation[];
  /** Funded cap-table positions only (never fabricated). */
  holdings: RawPositionLike[];
  hasFundedPosition: boolean;
  channelUnlockState: ChannelUnlockState;
  eligibilitySignals: EligibilitySignals;
  /**
   * Wave 5 (ENH-2) — decision-ladder activity events derived from the spine's
   * canonical invitation stages (Recent-activity panel reads ONLY this).
   */
  recentActivity: SpineActivityEvent[];
  /**
   * Wave 5 (ENH-2) — company ids the M&A panel should query intel for
   * (funded holdings + invited companies), de-duped. M&A panel reads ONLY this.
   */
  maCompanyIds: string[];
}

/**
 * useInvestorSpine — the canonical hook. Reads the authoritative sources and
 * returns the fully-derived, single-source-of-truth investor state.
 */
export function useInvestorSpine(): InvestorSpine {
  const entitlement = useEntitlement();

  // Per-invitation canonical state the surfaces already fetch.
  const invQuery = useQuery<RawInvitationLike[]>({
    queryKey: ["/api/investor/invitations"],
    staleTime: 30_000,
  });

  // Funded cap-table holdings (authoritative for holdings / hasFundedPosition).
  const posQuery = useQuery<RawPositionLike[]>({
    queryKey: ["/api/investor/portfolio2"],
    staleTime: 30_000,
  });

  // Server eligibility (source of the admin-granted signal + collectiveStatus).
  const eligQuery = useQuery<ServerEligibility>({
    queryKey: ["/api/collective/eligibility"],
    staleTime: 30_000,
  });

  return useMemo<InvestorSpine>(() => {
    const ctx = entitlement.data;

    // Merge authoritative invitation sources. Prefer the enriched
    // /api/investor/invitations rows (they carry round/company detail); fall
    // back to userContext.investor.invitedRounds so a surface still sees the
    // ladder even if the invitations endpoint is empty. De-dupe by id.
    const invRows = invQuery.data ?? [];
    const ctxRounds = (ctx?.investor?.invitedRounds ?? []).map((r) => ({
      id: r.invitationId,
      state: r.state,
      company: { id: r.companyId, name: r.companyName },
      round: { id: r.roundId, name: r.roundName },
    }));
    const byId = new Map<string, RawInvitationLike>();
    for (const r of ctxRounds) byId.set(r.id, r);
    // invitations endpoint wins on conflict (richer + fresher per-round state).
    for (const r of invRows) if (r && r.id) byId.set(r.id, r);
    const merged = Array.from(byId.values());

    const allInvitations = toSpineInvitations(merged);
    const positions = posQuery.data ?? [];

    const hasFundedPosition = selectHasFundedPosition(positions);
    const server = eligQuery.data;
    // Admin-granted: the server flag if present, else an active Collective
    // membership status (admin-approval writes a durable active row).
    const adminGranted =
      Boolean(server?.adminGranted) || server?.collectiveStatus === "active";

    return {
      isLoading: invQuery.isLoading || posQuery.isLoading || entitlement.isLoading,
      allInvitations,
      pendingInvitations: selectPendingInvitations(allInvitations),
      activeInvitations: selectActiveInvitations(allInvitations),
      softCircledInvitations: selectSoftCircledInvitations(allInvitations),
      declinedInvitations: selectDeclinedInvitations(allInvitations),
      expiredInvitations: selectExpiredInvitations(allInvitations),
      holdings: selectHoldings(positions),
      hasFundedPosition,
      channelUnlockState: selectChannelUnlockState(allInvitations, positions),
      eligibilitySignals: computeEligibilitySignals({ hasFundedPosition, adminGranted }),
      recentActivity: selectRecentActivity(allInvitations),
      maCompanyIds: selectMaCompanyIds(selectHoldings(positions), allInvitations),
    };
  }, [
    entitlement.data,
    entitlement.isLoading,
    invQuery.data,
    invQuery.isLoading,
    posQuery.data,
    posQuery.isLoading,
    eligQuery.data,
  ]);
}
