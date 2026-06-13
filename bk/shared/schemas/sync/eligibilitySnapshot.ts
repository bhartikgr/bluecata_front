import { z } from "zod";
import { type FieldPolicy, filterPayloadByPolicy, resolveConflicts, type Audience } from "./_common";

/**
 * Entity 7 — Eligibility Snapshot (per-user).
 * SOT: Capavate. Trigger: eligibility.recomputed on cap-table or policy change.
 */
export const EligibilitySnapshotCanonicalSchema = z.object({
  userId: z.string(),
  eligibilityScore: z.number().min(0).max(100),
  flags: z.object({
    investorOnCapTable: z.boolean(),
    founderOfCompany: z.boolean(),
    signatoryOnCompany: z.boolean(),
    vouchedByPartner: z.boolean(),
  }),
  reasons: z.array(z.string()).optional(),
  computedAt: z.string(),
  policyVersion: z.string().optional(),
});

export type EligibilitySnapshotCanonical = z.infer<typeof EligibilitySnapshotCanonicalSchema>;

export const ELIGIBILITYSNAPSHOT_POLICIES: Record<string, FieldPolicy> = {
  userId: { sot: "capavate" },
  eligibilityScore: { sot: "derived", derived: true },
  flags: { sot: "derived", derived: true },
  reasons: { sot: "derived", derived: true },
};

export function toCollectivePayload(p: EligibilitySnapshotCanonical, audience: Audience = "collective_public") {
  return filterPayloadByPolicy(p, ELIGIBILITYSNAPSHOT_POLICIES, audience);
}
export function fromCollectivePayload(p: Partial<EligibilitySnapshotCanonical>): Partial<EligibilitySnapshotCanonical> {
  const out: Record<string, unknown> = { ...p };
  for (const [k, pol] of Object.entries(ELIGIBILITYSNAPSHOT_POLICIES)) if (pol.derived) delete out[k];
  return out as Partial<EligibilitySnapshotCanonical>;
}
export function mergeWithConflicts(
  local: EligibilitySnapshotCanonical, remote: Partial<EligibilitySnapshotCanonical>,
  localUpdatedAt?: string, remoteUpdatedAt?: string,
) {
  return resolveConflicts<EligibilitySnapshotCanonical>({ local, remote, localUpdatedAt, remoteUpdatedAt, policies: ELIGIBILITYSNAPSHOT_POLICIES });
}
export function applyVisibilityFilter(p: EligibilitySnapshotCanonical, audience: Audience) {
  return filterPayloadByPolicy(p, ELIGIBILITYSNAPSHOT_POLICIES, audience);
}
