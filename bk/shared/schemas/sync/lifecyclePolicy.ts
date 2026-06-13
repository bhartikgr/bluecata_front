import { z } from "zod";
import { type FieldPolicy, filterPayloadByPolicy, resolveConflicts, type Audience } from "./_common";

/**
 * Entity 8 — Lifecycle Policy (admin-managed).
 * SOT: Capavate (admin). Trigger: lifecycle_policy.changed.
 */
export const LifecyclePolicyCanonicalSchema = z.object({
  policyVersion: z.string(),
  founderTenureDays: z.number(),
  archiveRetentionDays: z.number(),
  nonPaymentGraceDays: z.number(),
  invitationExpiryDays: z.number().optional(),
  softCircleTtlDays: z.number().optional(),
  termSheetExpiryDays: z.number().optional(),
  effectiveAt: z.string(),
  publishedBy: z.string(),
});

export type LifecyclePolicyCanonical = z.infer<typeof LifecyclePolicyCanonicalSchema>;

export const LIFECYCLEPOLICY_POLICIES: Record<string, FieldPolicy> = {
  policyVersion: { sot: "capavate" },
  founderTenureDays: { sot: "capavate" },
  archiveRetentionDays: { sot: "capavate" },
  nonPaymentGraceDays: { sot: "capavate" },
};

export function toCollectivePayload(p: LifecyclePolicyCanonical, audience: Audience = "collective_public") {
  return filterPayloadByPolicy(p, LIFECYCLEPOLICY_POLICIES, audience);
}
export function fromCollectivePayload(p: Partial<LifecyclePolicyCanonical>): Partial<LifecyclePolicyCanonical> {
  const out: Record<string, unknown> = { ...p };
  for (const [k, pol] of Object.entries(LIFECYCLEPOLICY_POLICIES)) if (pol.derived) delete out[k];
  return out as Partial<LifecyclePolicyCanonical>;
}
export function mergeWithConflicts(
  local: LifecyclePolicyCanonical, remote: Partial<LifecyclePolicyCanonical>,
  localUpdatedAt?: string, remoteUpdatedAt?: string,
) {
  return resolveConflicts<LifecyclePolicyCanonical>({ local, remote, localUpdatedAt, remoteUpdatedAt, policies: LIFECYCLEPOLICY_POLICIES });
}
export function applyVisibilityFilter(p: LifecyclePolicyCanonical, audience: Audience) {
  return filterPayloadByPolicy(p, LIFECYCLEPOLICY_POLICIES, audience);
}
