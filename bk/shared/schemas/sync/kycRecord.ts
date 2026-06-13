import { z } from "zod";
import { type FieldPolicy, filterPayloadByPolicy, resolveConflicts, type Audience } from "./_common";

/**
 * Entity 10 — KYC Record + Accreditation Status (jurisdiction-aware).
 * SOT: Capavate. Trigger: kyc.status_changed (NEW Sprint 13).
 */
export const KycRecordCanonicalSchema = z.object({
  userId: z.string(),
  kycVariant: z.enum(["us_individual", "us_entity", "non_us_individual", "non_us_entity", "in_individual", "uk_individual", "eu_individual"]).optional(),
  kycStatus: z.enum(["unverified", "in_review", "verified", "rejected", "expired"]),
  kycVerifiedAt: z.string().optional(),
  kycExpiresAt: z.string().optional(),
  kycProvider: z.string().optional(),
  kycRefId: z.string().optional(),
  kycDocumentHashes: z.array(z.string()).optional(),  // VIS-1
  jurisdiction: z.string().optional(),
  riskScore: z.number().optional(),
  pepFlag: z.boolean().optional(),
  sanctionsFlag: z.boolean().optional(),
  reviewedBy: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type KycRecordCanonical = z.infer<typeof KycRecordCanonicalSchema>;

export const KYCRECORD_POLICIES: Record<string, FieldPolicy> = {
  userId: { sot: "capavate" },
  kycStatus: { sot: "shared" },
  kycDocumentHashes: { sot: "capavate", privacy: "VIS-1" },
};

export function toCollectivePayload(p: KycRecordCanonical, audience: Audience = "collective_public") {
  return filterPayloadByPolicy(p, KYCRECORD_POLICIES, audience);
}
export function fromCollectivePayload(p: Partial<KycRecordCanonical>): Partial<KycRecordCanonical> {
  const out: Record<string, unknown> = { ...p };
  for (const [k, pol] of Object.entries(KYCRECORD_POLICIES)) if (pol.derived) delete out[k];
  return out as Partial<KycRecordCanonical>;
}
export function mergeWithConflicts(
  local: KycRecordCanonical, remote: Partial<KycRecordCanonical>,
  localUpdatedAt?: string, remoteUpdatedAt?: string,
) {
  return resolveConflicts<KycRecordCanonical>({ local, remote, localUpdatedAt, remoteUpdatedAt, policies: KYCRECORD_POLICIES });
}
export function applyVisibilityFilter(p: KycRecordCanonical, audience: Audience) {
  return filterPayloadByPolicy(p, KYCRECORD_POLICIES, audience);
}
