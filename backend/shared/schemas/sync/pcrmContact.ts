import { z } from "zod";
import { type FieldPolicy, filterPayloadByPolicy, resolveConflicts, type Audience } from "./_common";

/**
 * Entity 19 — PCRM Contact + Note + Task.
 * SOT: Capavate. Sprint 10 pcrm_*.
 */
export const PcrmContactCanonicalSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  name: z.string(),
  email: z.string().optional(),       // VIS-1
  phone: z.string().optional(),       // VIS-1
  organization: z.string().optional(),
  role: z.string().optional(),
  stage: z.string().optional(),
  tags: z.array(z.string()).optional(),
  notesCount: z.number().optional(),
  tasksOpen: z.number().optional(),
  lastInteractionAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type PcrmContactCanonical = z.infer<typeof PcrmContactCanonicalSchema>;

export const PCRMCONTACT_POLICIES: Record<string, FieldPolicy> = {
  id: { sot: "capavate" },
  email: { sot: "capavate", privacy: "VIS-1" },
  phone: { sot: "capavate", privacy: "VIS-1" },
};

export function toCollectivePayload(p: PcrmContactCanonical, audience: Audience = "collective_public") {
  return filterPayloadByPolicy(p, PCRMCONTACT_POLICIES, audience);
}
export function fromCollectivePayload(p: Partial<PcrmContactCanonical>): Partial<PcrmContactCanonical> {
  const out: Record<string, unknown> = { ...p };
  for (const [k, pol] of Object.entries(PCRMCONTACT_POLICIES)) if (pol.derived) delete out[k];
  return out as Partial<PcrmContactCanonical>;
}
export function mergeWithConflicts(
  local: PcrmContactCanonical, remote: Partial<PcrmContactCanonical>,
  localUpdatedAt?: string, remoteUpdatedAt?: string,
) {
  return resolveConflicts<PcrmContactCanonical>({ local, remote, localUpdatedAt, remoteUpdatedAt, policies: PCRMCONTACT_POLICIES });
}
export function applyVisibilityFilter(p: PcrmContactCanonical, audience: Audience) {
  return filterPayloadByPolicy(p, PCRMCONTACT_POLICIES, audience);
}
