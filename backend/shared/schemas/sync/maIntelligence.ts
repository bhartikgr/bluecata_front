import { z } from "zod";
import { type FieldPolicy, filterPayloadByPolicy, resolveConflicts, type Audience } from "./_common";

/**
 * Entity 6 — M&A Intelligence Rankings (Collective → Capavate inbound).
 * SOT: Collective. Trigger: ma.intelligence_rankings nightly batch + dsc.scores.
 */
export const MaIntelligenceCanonicalSchema = z.object({
  companyId: z.string(),
  compositeScore: z.number().min(0).max(100).optional(),  // VIS-4
  mnaScore: z.number().min(0).max(100).optional(),        // VIS-4
  roundScore: z.number().min(0).max(100).optional(),      // VIS-4
  sectorBenchmark: z.number().optional(),
  autoTier: z.enum(["A", "B", "C", "watch", "unrated"]).optional(),
  rankInSector: z.number().optional(),
  totalInSector: z.number().optional(),
  signalsConsidered: z.array(z.string()).optional(),
  computedAt: z.string().optional(),
  modelVersion: z.string().optional(),
});

export type MaIntelligenceCanonical = z.infer<typeof MaIntelligenceCanonicalSchema>;

export const MAINTELLIGENCE_POLICIES: Record<string, FieldPolicy> = {
  companyId: { sot: "capavate" },
  compositeScore: { sot: "collective", privacy: "VIS-4" },
  mnaScore: { sot: "collective", privacy: "VIS-4" },
  roundScore: { sot: "collective", privacy: "VIS-4" },
  sectorBenchmark: { sot: "collective" },
  autoTier: { sot: "collective" },
  rankInSector: { sot: "collective" },
  totalInSector: { sot: "collective" },
  computedAt: { sot: "collective" },
  modelVersion: { sot: "collective" },
};

export function toCollectivePayload(p: MaIntelligenceCanonical, audience: Audience = "collective_public") {
  return filterPayloadByPolicy(p, MAINTELLIGENCE_POLICIES, audience);
}
export function fromCollectivePayload(p: Partial<MaIntelligenceCanonical>): Partial<MaIntelligenceCanonical> {
  const out: Record<string, unknown> = { ...p };
  for (const [k, pol] of Object.entries(MAINTELLIGENCE_POLICIES)) if (pol.derived) delete out[k];
  return out as Partial<MaIntelligenceCanonical>;
}
export function mergeWithConflicts(
  local: MaIntelligenceCanonical, remote: Partial<MaIntelligenceCanonical>,
  localUpdatedAt?: string, remoteUpdatedAt?: string,
) {
  return resolveConflicts<MaIntelligenceCanonical>({ local, remote, localUpdatedAt, remoteUpdatedAt, policies: MAINTELLIGENCE_POLICIES });
}
export function applyVisibilityFilter(p: MaIntelligenceCanonical, audience: Audience) {
  return filterPayloadByPolicy(p, MAINTELLIGENCE_POLICIES, audience);
}
