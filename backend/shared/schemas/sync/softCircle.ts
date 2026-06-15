import { z } from "zod";
import { type FieldPolicy, filterPayloadByPolicy, resolveConflicts, type Audience } from "./_common";

/**
 * Entity 4 — Soft-Circle Commitment.
 * SOT: Capavate. VIS-7 amounts are founder-private; aggregate totals only in MIM.
 */
export const SoftCircleCanonicalSchema = z.object({
  id: z.string(),
  roundId: z.string(),
  companyId: z.string(),
  investorId: z.string(),
  amountUsd: z.string().optional(),    // VIS-7
  status: z.enum(["recorded", "withdrawn", "converted_to_signed", "expired"]).optional(),
  recordedAt: z.string().optional(),
  reasonNote: z.string().optional(),
  channelId: z.string().optional(),
  visibility: z.enum(["founder_only", "investor_too", "co_members"]).optional(),
  updatedAt: z.string().optional(),
});

export type SoftCircleCanonical = z.infer<typeof SoftCircleCanonicalSchema>;

export const SOFTCIRCLE_POLICIES: Record<string, FieldPolicy> = {
  id: { sot: "capavate" },
  amountUsd: { sot: "capavate", privacy: "VIS-7" },
  status: { sot: "capavate" },
};

export function toCollectivePayload(p: SoftCircleCanonical, audience: Audience = "collective_public") {
  return filterPayloadByPolicy(p, SOFTCIRCLE_POLICIES, audience);
}
export function fromCollectivePayload(p: Partial<SoftCircleCanonical>): Partial<SoftCircleCanonical> {
  const out: Record<string, unknown> = { ...p };
  for (const [k, pol] of Object.entries(SOFTCIRCLE_POLICIES)) if (pol.derived) delete out[k];
  return out as Partial<SoftCircleCanonical>;
}
export function mergeWithConflicts(
  local: SoftCircleCanonical, remote: Partial<SoftCircleCanonical>,
  localUpdatedAt?: string, remoteUpdatedAt?: string,
) {
  return resolveConflicts<SoftCircleCanonical>({ local, remote, localUpdatedAt, remoteUpdatedAt, policies: SOFTCIRCLE_POLICIES });
}
export function applyVisibilityFilter(p: SoftCircleCanonical, audience: Audience) {
  return filterPayloadByPolicy(p, SOFTCIRCLE_POLICIES, audience);
}
