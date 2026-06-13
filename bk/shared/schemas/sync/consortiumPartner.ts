import { z } from "zod";
import { type FieldPolicy, filterPayloadByPolicy, resolveConflicts, type Audience } from "./_common";

/**
 * Entity 12 — Consortium Partner Directory Entry.
 * SOT: Collective (directory) → Capavate. partner.introduction_status updates per-round.
 */
export const ConsortiumPartnerCanonicalSchema = z.object({
  id: z.string(),
  name: z.string(),
  partnerType: z.enum(["accelerator", "vc", "angel_network", "operator_network", "service", "other"]),
  websiteUrl: z.string().optional(),
  jurisdiction: z.string().optional(),
  vouchWeight: z.number().min(0).max(2).optional(),
  active: z.boolean().optional(),
  introCount: z.number().optional(),
  successCount: z.number().optional(),
  contactName: z.string().optional(),    // VIS-2 (real name)
  contactEmail: z.string().optional(),   // VIS-1
  updatedAt: z.string().optional(),
});

export type ConsortiumPartnerCanonical = z.infer<typeof ConsortiumPartnerCanonicalSchema>;

export const CONSORTIUMPARTNER_POLICIES: Record<string, FieldPolicy> = {
  id: { sot: "collective" },
  name: { sot: "collective" },
  partnerType: { sot: "collective" },
  vouchWeight: { sot: "collective" },
  active: { sot: "collective" },
  contactEmail: { sot: "collective", privacy: "VIS-1" },
  contactName: { sot: "collective", privacy: "VIS-2" },
};

export function toCollectivePayload(p: ConsortiumPartnerCanonical, audience: Audience = "collective_public") {
  return filterPayloadByPolicy(p, CONSORTIUMPARTNER_POLICIES, audience);
}
export function fromCollectivePayload(p: Partial<ConsortiumPartnerCanonical>): Partial<ConsortiumPartnerCanonical> {
  const out: Record<string, unknown> = { ...p };
  for (const [k, pol] of Object.entries(CONSORTIUMPARTNER_POLICIES)) if (pol.derived) delete out[k];
  return out as Partial<ConsortiumPartnerCanonical>;
}
export function mergeWithConflicts(
  local: ConsortiumPartnerCanonical, remote: Partial<ConsortiumPartnerCanonical>,
  localUpdatedAt?: string, remoteUpdatedAt?: string,
) {
  return resolveConflicts<ConsortiumPartnerCanonical>({ local, remote, localUpdatedAt, remoteUpdatedAt, policies: CONSORTIUMPARTNER_POLICIES });
}
export function applyVisibilityFilter(p: ConsortiumPartnerCanonical, audience: Audience) {
  return filterPayloadByPolicy(p, CONSORTIUMPARTNER_POLICIES, audience);
}
