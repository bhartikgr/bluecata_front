import { z } from "zod";
import { type FieldPolicy, filterPayloadByPolicy, resolveConflicts, type Audience } from "./_common";

/**
 * Entity 17 — Pricing Tier Definition.
 * SOT: Capavate (admin). Bidirectional read.
 */
export const PricingTierCanonicalSchema = z.object({
  id: z.string(),
  surface: z.enum(["founder", "collective"]),
  tierName: z.string(),
  region: z.string().optional(),
  usdMonthly: z.number().optional(),
  usdAnnual: z.number().optional(),
  features: z.array(z.string()).optional(),
  active: z.boolean().optional(),
  effectiveAt: z.string().optional(),
});

export type PricingTierCanonical = z.infer<typeof PricingTierCanonicalSchema>;

export const PRICINGTIER_POLICIES: Record<string, FieldPolicy> = {
  id: { sot: "capavate" },
  usdMonthly: { sot: "capavate" },
  usdAnnual: { sot: "capavate" },
  active: { sot: "capavate" },
};

export function toCollectivePayload(p: PricingTierCanonical, audience: Audience = "collective_public") {
  return filterPayloadByPolicy(p, PRICINGTIER_POLICIES, audience);
}
export function fromCollectivePayload(p: Partial<PricingTierCanonical>): Partial<PricingTierCanonical> {
  const out: Record<string, unknown> = { ...p };
  for (const [k, pol] of Object.entries(PRICINGTIER_POLICIES)) if (pol.derived) delete out[k];
  return out as Partial<PricingTierCanonical>;
}
export function mergeWithConflicts(
  local: PricingTierCanonical, remote: Partial<PricingTierCanonical>,
  localUpdatedAt?: string, remoteUpdatedAt?: string,
) {
  return resolveConflicts<PricingTierCanonical>({ local, remote, localUpdatedAt, remoteUpdatedAt, policies: PRICINGTIER_POLICIES });
}
export function applyVisibilityFilter(p: PricingTierCanonical, audience: Audience) {
  return filterPayloadByPolicy(p, PRICINGTIER_POLICIES, audience);
}
