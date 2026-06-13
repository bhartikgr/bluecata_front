import { z } from "zod";
import { type FieldPolicy, filterPayloadByPolicy, resolveConflicts, type Audience } from "./_common";

/**
 * Entity 3 — Cap-Table Position (per-holder, per-instrument).
 * SOT: Capavate. Trigger: cap_table.mutated. VIS-5 ledger entries never replicated.
 */
export const CapTablePositionCanonicalSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  holderUserId: z.string().optional(),
  holderName: z.string().optional(),       // VIS-2
  instrumentType: z.enum(["common", "preferred", "safe", "convertible_note", "warrant", "option"]),
  shareClass: z.string().optional(),
  shares: z.string().optional(),
  optionShares: z.string().optional(),
  pricePerShare: z.string().optional(),
  investmentAmountUsd: z.string().optional(),
  ownershipPct: z.number().optional(),       // derived
  fdOwnershipPct: z.number().optional(),     // derived
  vestingSchedule: z.string().optional(),
  cliffMonths: z.number().optional(),
  preferenceMultiple: z.number().optional(),
  participating: z.boolean().optional(),
  liquidationPreferenceUsd: z.string().optional(),
  conversionRatio: z.number().optional(),
  antiDilution: z.enum(["none", "broad_based", "narrow_based", "full_ratchet"]).optional(),
  // Per-holder ledger never replicated
  ledger: z.array(z.unknown()).optional(),   // VIS-5
  trace: z.array(z.unknown()).optional(),    // VIS-5
  visibleToCoMembers: z.boolean().optional(),
  updatedAt: z.string().optional(),
});

export type CapTablePositionCanonical = z.infer<typeof CapTablePositionCanonicalSchema>;

export const CAPTABLEPOSITION_POLICIES: Record<string, FieldPolicy> = {
  id: { sot: "capavate" },
  companyId: { sot: "capavate" },
  holderUserId: { sot: "capavate" },
  holderName: { sot: "capavate", privacy: "VIS-2" },
  instrumentType: { sot: "capavate" },
  shares: { sot: "capavate" },
  pricePerShare: { sot: "capavate" },
  ownershipPct: { sot: "derived", derived: true },
  fdOwnershipPct: { sot: "derived", derived: true },
  ledger: { sot: "capavate", privacy: "VIS-5" },
  trace: { sot: "capavate", privacy: "VIS-5" },
  visibleToCoMembers: { sot: "shared" },
};

export function toCollectivePayload(p: CapTablePositionCanonical, audience: Audience = "collective_public") {
  return filterPayloadByPolicy(p, CAPTABLEPOSITION_POLICIES, audience);
}
export function fromCollectivePayload(p: Partial<CapTablePositionCanonical>): Partial<CapTablePositionCanonical> {
  const out: Record<string, unknown> = { ...p };
  for (const [k, pol] of Object.entries(CAPTABLEPOSITION_POLICIES)) if (pol.derived) delete out[k];
  return out as Partial<CapTablePositionCanonical>;
}
export function mergeWithConflicts(
  local: CapTablePositionCanonical, remote: Partial<CapTablePositionCanonical>,
  localUpdatedAt?: string, remoteUpdatedAt?: string,
) {
  return resolveConflicts<CapTablePositionCanonical>({ local, remote, localUpdatedAt, remoteUpdatedAt, policies: CAPTABLEPOSITION_POLICIES });
}
export function applyVisibilityFilter(p: CapTablePositionCanonical, audience: Audience) {
  return filterPayloadByPolicy(p, CAPTABLEPOSITION_POLICIES, audience);
}
