import { z } from "zod";
import { type FieldPolicy, filterPayloadByPolicy, resolveConflicts, type Audience } from "./_common";

/**
 * Entity — Accreditation.
 * SOT: shared (Capavate originates, Collective can update with admin sign-off).
 */
export const AccreditationCanonicalSchema = z.object({
  userId: z.string(),
  status: z.enum(["unverified", "self_attested", "verified", "expired"]),
  method: z.enum(["self", "third_party", "income_doc", "asset_doc", "license"]).optional(),
  verifiedAt: z.string().optional(),
  expiresAt: z.string().optional(),
  jurisdiction: z.string().optional(),
  proofHashes: z.array(z.string()).optional(),  // VIS-1
  reviewerUserId: z.string().optional(),
  notes: z.string().optional(),
});

export type AccreditationCanonical = z.infer<typeof AccreditationCanonicalSchema>;

export const ACCREDITATION_POLICIES: Record<string, FieldPolicy> = {
  userId: { sot: "capavate" },
  status: { sot: "shared" },
  verifiedAt: { sot: "shared" },
  proofHashes: { sot: "capavate", privacy: "VIS-1" },
};

export function toCollectivePayload(p: AccreditationCanonical, audience: Audience = "collective_public") {
  return filterPayloadByPolicy(p, ACCREDITATION_POLICIES, audience);
}
export function fromCollectivePayload(p: Partial<AccreditationCanonical>): Partial<AccreditationCanonical> {
  const out: Record<string, unknown> = { ...p };
  for (const [k, pol] of Object.entries(ACCREDITATION_POLICIES)) if (pol.derived) delete out[k];
  return out as Partial<AccreditationCanonical>;
}
export function mergeWithConflicts(
  local: AccreditationCanonical, remote: Partial<AccreditationCanonical>,
  localUpdatedAt?: string, remoteUpdatedAt?: string,
) {
  return resolveConflicts<AccreditationCanonical>({ local, remote, localUpdatedAt, remoteUpdatedAt, policies: ACCREDITATION_POLICIES });
}
export function applyVisibilityFilter(p: AccreditationCanonical, audience: Audience) {
  return filterPayloadByPolicy(p, ACCREDITATION_POLICIES, audience);
}
