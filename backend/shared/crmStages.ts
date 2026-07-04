/**
 * Sprint 14 D3 — CRM stage definitions and mapper.
 *
 * Founder pipeline (7 stages, replaces older 5-stage pipeline):
 *   lead → engaged → soft_circle → committed → signing → invested → longterm
 *
 * Investor PCRM (Sprint 10) becomes 7 stages:
 *   lead → met → diligence → soft_circle → signing → invested → exited
 *
 * Mapping helper: 10-state Collective machine (yourDecisionStore) → Capavate
 * pipeline stages. Used by `pages/founder/InvestorCRM.tsx` and
 * `pages/investor/CRM.tsx` to render the right column for the right state.
 */

/* v25.48.3 Q-K1 — `invited_unregistered` ("Invited – not registered") precedes
 * `prospect` (renamed from "lead"). Legacy `lead` is retained as a trailing
 * alias so historical rows/tests referencing it still type-check; the UI maps
 * it to the Prospect label. */
export const FOUNDER_CRM_STAGES = [
  "invited_unregistered", "prospect", "engaged", "soft_circle", "committed", "signing", "invested", "longterm", "lead",
] as const;
export type FounderCRMStage = (typeof FOUNDER_CRM_STAGES)[number];

export const INVESTOR_PCRM_STAGES = [
  "lead", "met", "diligence", "soft_circle", "signing", "invested", "exited",
] as const;
export type InvestorPCRMStage = (typeof INVESTOR_PCRM_STAGES)[number];

/** 10-state Collective machine alias (kept here to avoid runtime imports between client/server). */
export type CollectiveDecisionState =
  | "pending" | "viewed" | "accepted" | "soft_circled" | "confirmed"
  | "signed" | "funded" | "declined" | "expired" | "revoked";

/** Map Collective state → Founder CRM stage. */
export function mapCollectiveStateToCRMStage(state: CollectiveDecisionState): FounderCRMStage {
  switch (state) {
    /* v25.48.3 Q-K1 — "lead" renamed to "prospect". */
    case "pending":      return "prospect";
    case "viewed":       return "engaged";
    case "accepted":     return "engaged";
    case "soft_circled": return "soft_circle";
    case "confirmed":    return "committed";
    case "signed":       return "signing";
    case "funded":       return "invested";
    case "declined":     return "prospect";  // back to top of pipeline
    case "expired":      return "prospect";
    case "revoked":      return "prospect";
  }
}

/** Map Collective state → Investor PCRM stage. */
export function mapCollectiveStateToPCRMStage(state: CollectiveDecisionState): InvestorPCRMStage {
  switch (state) {
    case "pending":      return "lead";
    case "viewed":       return "met";
    case "accepted":     return "diligence";
    case "soft_circled": return "soft_circle";
    case "confirmed":    return "signing";
    case "signed":       return "signing";
    case "funded":       return "invested";
    case "declined":     return "lead";
    case "expired":      return "lead";
    case "revoked":      return "lead";
  }
}

/** Auto-tier badge per harvest §3 Pattern 11. Driven by an engagement score. */
export const AUTO_TIERS = ["watch", "qualified", "featured", "priority"] as const;
export type AutoTier = (typeof AUTO_TIERS)[number];

export function computeAutoTier(engagementScore: number): AutoTier {
  if (engagementScore >= 80) return "priority";
  if (engagementScore >= 60) return "featured";
  if (engagementScore >= 40) return "qualified";
  return "watch";
}

/** Score gating per Conflict 3 fix: non-DSC member roles see auto_tier only. */
export function applyScoreGating<T extends { rawScore?: number; autoTier?: AutoTier }>(
  contact: T,
  memberRole: "dsc" | "member" | "lapsed" | "non_member",
): T {
  if (memberRole === "dsc") return contact;
  // Strip rawScore for non-DSC roles
  const { rawScore: _strip, ...rest } = contact as T & { rawScore?: number };
  return rest as T;
}

/** 5-lane Connections graph kanban filter (Pattern 2). */
export const CONNECTION_LANES = ["cap_table", "round", "dsc", "angel_network", "social"] as const;
export type ConnectionLane = (typeof CONNECTION_LANES)[number];

/* v25.49 Phase-3A — Consortium Partner Clients CRM stages. This is the SEPARATE
 * partner-clients engine (kept distinct from the founder/investor CRM per Ozan),
 * but it reuses the founder-pipeline vocabulary above so the two engines speak
 * the same stage language. A focused 5-stage subset — no "invited_unregistered"
 * (partners only ever see already-attributed companies) and no legacy "lead"
 * alias. `prospect` is the default for a freshly-attributed company. */
export const PARTNER_CLIENT_STAGES = [
  "prospect", "engaged", "committed", "invested", "longterm",
] as const;
export type PartnerClientStage = (typeof PARTNER_CLIENT_STAGES)[number];

export const PARTNER_CLIENT_STAGE_LABELS: Record<PartnerClientStage, string> = {
  prospect: "Prospect",
  engaged: "Engaged",
  committed: "Committed",
  invested: "Invested",
  longterm: "Long-term",
};

export const PARTNER_CLIENT_DEFAULT_STAGE: PartnerClientStage = "prospect";

export function isPartnerClientStage(v: unknown): v is PartnerClientStage {
  return typeof v === "string" && (PARTNER_CLIENT_STAGES as readonly string[]).includes(v);
}
