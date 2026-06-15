import { z } from "zod";
import { type FieldPolicy, filterPayloadByPolicy, resolveConflicts, type Audience } from "./_common";

/**
 * Entity 11 — Member Tier + Collective Membership.
 * SOT: Collective. Trigger: membership.renewal_status, member.application_decision.
 */
export const MemberTierCanonicalSchema = z.object({
  userId: z.string(),
  memberTier: z.enum(["standard", "plus", "individual", "none"]),
  applicationStatus: z.enum(["draft", "submitted", "in_review", "approved", "rejected", "withdrawn"]).optional(),
  applicationId: z.string().optional(),
  decisionAt: z.string().optional(),
  decisionReason: z.string().optional(),
  membershipStartDate: z.string().optional(),
  membershipExpiresAt: z.string().optional(),
  lapsed: z.boolean().optional(),
  renewalStatus: z.enum(["active", "expiring_soon", "lapsed", "cancelled"]).optional(),
  amountPaidUsd: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type MemberTierCanonical = z.infer<typeof MemberTierCanonicalSchema>;

export const MEMBERTIER_POLICIES: Record<string, FieldPolicy> = {
  userId: { sot: "capavate" },
  memberTier: { sot: "collective" },
  applicationStatus: { sot: "collective" },
  decisionAt: { sot: "collective" },
  membershipStartDate: { sot: "collective" },
  membershipExpiresAt: { sot: "collective" },
  lapsed: { sot: "collective" },
  renewalStatus: { sot: "collective" },
};

export function toCollectivePayload(p: MemberTierCanonical, audience: Audience = "collective_public") {
  return filterPayloadByPolicy(p, MEMBERTIER_POLICIES, audience);
}
export function fromCollectivePayload(p: Partial<MemberTierCanonical>): Partial<MemberTierCanonical> {
  const out: Record<string, unknown> = { ...p };
  for (const [k, pol] of Object.entries(MEMBERTIER_POLICIES)) if (pol.derived) delete out[k];
  return out as Partial<MemberTierCanonical>;
}
export function mergeWithConflicts(
  local: MemberTierCanonical, remote: Partial<MemberTierCanonical>,
  localUpdatedAt?: string, remoteUpdatedAt?: string,
) {
  return resolveConflicts<MemberTierCanonical>({ local, remote, localUpdatedAt, remoteUpdatedAt, policies: MEMBERTIER_POLICIES });
}
export function applyVisibilityFilter(p: MemberTierCanonical, audience: Audience) {
  return filterPayloadByPolicy(p, MEMBERTIER_POLICIES, audience);
}
