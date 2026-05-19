import { z } from "zod";
import { type FieldPolicy, filterPayloadByPolicy, resolveConflicts, type Audience } from "./_common";

/**
 * Entity 5 — Round (terms, lifecycle, region, instrument).
 * SOT: Capavate. Trigger: round.closed.
 */
export const RoundCanonicalSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  name: z.string(),
  region: z.string(),
  jurisdiction: z.string().optional(),
  instrumentType: z.enum(["safe_postmoney", "safe_premoney", "convertible_note", "priced_round", "spv"]),
  status: z.enum(["draft", "review", "approved", "signing_open", "closed", "withdrawn"]),
  targetUsd: z.string().optional(),
  minimumUsd: z.string().optional(),
  maximumUsd: z.string().optional(),
  pricePerShare: z.string().optional(),
  preMoneyUsd: z.string().optional(),
  postMoneyUsd: z.string().optional(),
  esopTopUpPct: z.number().optional(),
  discountRate: z.number().optional(),
  valuationCapUsd: z.string().optional(),
  consortiumPartnerIds: z.array(z.string()).optional(),
  partnerIntroductions: z.array(z.unknown()).optional(),
  formulaId: z.string().optional(),
  formulaVersion: z.string().optional(),
  closeDate: z.string().optional(),
  amountClosedUsd: z.string().optional(),
  participantCount: z.number().optional(),
  capTableSnapshot: z.unknown().optional(),
  termSheetUrl: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type RoundCanonical = z.infer<typeof RoundCanonicalSchema>;

export const ROUND_POLICIES: Record<string, FieldPolicy> = {
  id: { sot: "capavate" },
  status: { sot: "capavate" },
  amountClosedUsd: { sot: "capavate" },
  capTableSnapshot: { sot: "capavate" },
};

export function toCollectivePayload(p: RoundCanonical, audience: Audience = "collective_public") {
  return filterPayloadByPolicy(p, ROUND_POLICIES, audience);
}
export function fromCollectivePayload(p: Partial<RoundCanonical>): Partial<RoundCanonical> {
  const out: Record<string, unknown> = { ...p };
  for (const [k, pol] of Object.entries(ROUND_POLICIES)) if (pol.derived) delete out[k];
  return out as Partial<RoundCanonical>;
}
export function mergeWithConflicts(
  local: RoundCanonical, remote: Partial<RoundCanonical>,
  localUpdatedAt?: string, remoteUpdatedAt?: string,
) {
  return resolveConflicts<RoundCanonical>({ local, remote, localUpdatedAt, remoteUpdatedAt, policies: ROUND_POLICIES });
}
export function applyVisibilityFilter(p: RoundCanonical, audience: Audience) {
  return filterPayloadByPolicy(p, ROUND_POLICIES, audience);
}
