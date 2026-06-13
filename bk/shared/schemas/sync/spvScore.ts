import { z } from "zod";
import { type FieldPolicy, filterPayloadByPolicy, resolveConflicts, type Audience } from "./_common";

/**
 * Entity 22 — SPV / DSC Scoring (Collective inbound).
 * SOT: Collective. Trigger: dsc.scores.
 */
export const SpvScoreCanonicalSchema = z.object({
  companyId: z.string(),
  dscScore: z.number().min(0).max(5).optional(),  // VIS-4
  dscRecommendation: z.enum(["advance", "hold", "decline"]).optional(),  // VIS-4
  reviewerIds: z.array(z.string()).optional(),
  reviewSessionId: z.string().optional(),
  decidedAt: z.string().optional(),
  notesPublic: z.string().optional(),
  notesPrivate: z.string().optional(),  // VIS-4
  modelVersion: z.string().optional(),
});

export type SpvScoreCanonical = z.infer<typeof SpvScoreCanonicalSchema>;

export const SPVSCORE_POLICIES: Record<string, FieldPolicy> = {
  companyId: { sot: "capavate" },
  dscScore: { sot: "collective", privacy: "VIS-4" },
  dscRecommendation: { sot: "collective", privacy: "VIS-4" },
  reviewerIds: { sot: "collective" },
  decidedAt: { sot: "collective" },
  notesPrivate: { sot: "collective", privacy: "VIS-4" },
};

export function toCollectivePayload(p: SpvScoreCanonical, audience: Audience = "collective_public") {
  return filterPayloadByPolicy(p, SPVSCORE_POLICIES, audience);
}
export function fromCollectivePayload(p: Partial<SpvScoreCanonical>): Partial<SpvScoreCanonical> {
  const out: Record<string, unknown> = { ...p };
  for (const [k, pol] of Object.entries(SPVSCORE_POLICIES)) if (pol.derived) delete out[k];
  return out as Partial<SpvScoreCanonical>;
}
export function mergeWithConflicts(
  local: SpvScoreCanonical, remote: Partial<SpvScoreCanonical>,
  localUpdatedAt?: string, remoteUpdatedAt?: string,
) {
  return resolveConflicts<SpvScoreCanonical>({ local, remote, localUpdatedAt, remoteUpdatedAt, policies: SPVSCORE_POLICIES });
}
export function applyVisibilityFilter(p: SpvScoreCanonical, audience: Audience) {
  return filterPayloadByPolicy(p, SPVSCORE_POLICIES, audience);
}
