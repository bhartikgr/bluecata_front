/**
 * Entity 2 — Investor Profile (90+ fields). SOT: Capavate.
 * Trigger: investor.profile.updated, investor.kyc.uploaded, investor.accreditation.changed.
 */
import { z } from "zod";
import { type FieldPolicy, filterPayloadByPolicy, resolveConflicts, type Audience } from "./_common";

export const InvestorCanonicalSchema = z.object({
  id: z.string(),
  // Identity
  firstName: z.string().optional(),       // VIS-2
  lastName: z.string().optional(),        // VIS-2
  screenName: z.string().optional(),
  email: z.string().email().optional(),   // VIS-1
  phone: z.string().optional(),           // VIS-1
  jurisdiction: z.string().optional(),
  countryOfResidence: z.string().optional(),
  // Investor type
  investorType: z.enum(["individual", "family_office", "syndicate", "fund", "other"]).optional(),
  accreditationStatus: z.enum(["unverified", "self_attested", "verified", "expired"]).optional(),
  accreditationVerifiedAt: z.string().optional(),
  accreditationDocHashes: z.array(z.string()).optional(), // VIS-1
  kycStatus: z.enum(["unverified", "in_review", "verified", "rejected", "expired"]).optional(),
  kycVerifiedAt: z.string().optional(),
  kycDocumentHashes: z.array(z.string()).optional(),      // VIS-1
  // Preferences / thesis
  investmentThesis: z.string().optional(),
  preferredStages: z.array(z.string()).optional(),
  preferredSectors: z.array(z.string()).optional(),
  preferredGeographies: z.array(z.string()).optional(),
  ticketSizeMinUsd: z.string().optional(),
  ticketSizeMaxUsd: z.string().optional(),
  // Track record
  totalInvestmentsCount: z.number().optional(),
  totalInvestedUsd: z.string().optional(),
  notableInvestments: z.array(z.string()).optional(),
  // Privacy / visibility
  visibleToCoMembers: z.boolean().optional(), // VIS-3 / VIS-10
  shareScreenNameOnly: z.boolean().optional(),
  // Eligibility
  eligibilityScore: z.number().optional(),
  eligibilityFlags: z.record(z.boolean()).optional(),
  // Member tier
  collectiveMemberTier: z.enum(["standard", "plus", "individual", "none"]).optional(),
  membershipStartDate: z.string().optional(),
  membershipExpiresAt: z.string().optional(),
  membershipLapsed: z.boolean().optional(),
  // Network signals (Collective inbound)
  followerCount: z.number().optional(),
  mentionCount: z.number().optional(),
  networkActivity: z.string().optional(),
  // Bookkeeping
  updatedAt: z.string().optional(),
});

export type InvestorCanonical = z.infer<typeof InvestorCanonicalSchema>;

export const INVESTOR_POLICIES: Record<string, FieldPolicy> = {
  id: { sot: "capavate" },
  firstName: { sot: "capavate", privacy: "VIS-2" },
  lastName: { sot: "capavate", privacy: "VIS-2" },
  email: { sot: "capavate", privacy: "VIS-1" },
  phone: { sot: "capavate", privacy: "VIS-1" },
  accreditationDocHashes: { sot: "capavate", privacy: "VIS-1" },
  kycDocumentHashes: { sot: "capavate", privacy: "VIS-1" },
  // Membership tier owned by Collective
  collectiveMemberTier: { sot: "collective" },
  membershipStartDate: { sot: "collective" },
  membershipExpiresAt: { sot: "collective" },
  membershipLapsed: { sot: "collective" },
  // Network signals — Collective owned
  followerCount: { sot: "collective" },
  mentionCount: { sot: "collective" },
  networkActivity: { sot: "collective" },
  eligibilityScore: { sot: "derived", derived: true },
  eligibilityFlags: { sot: "derived", derived: true },
  visibleToCoMembers: { sot: "shared" },
};

export function toCollectivePayload(p: InvestorCanonical, audience: Audience = "collective_public") {
  // VIS-2 swap: when leaving for collective_public, replace real names with screenName
  const swapped: InvestorCanonical = { ...p };
  if (audience === "collective_public") {
    swapped.firstName = undefined;
    swapped.lastName = undefined;
  }
  return filterPayloadByPolicy(swapped, INVESTOR_POLICIES, audience);
}
export function fromCollectivePayload(p: Partial<InvestorCanonical>): Partial<InvestorCanonical> {
  const out: Record<string, unknown> = { ...p };
  for (const [k, pol] of Object.entries(INVESTOR_POLICIES)) if (pol.derived) delete out[k];
  return out as Partial<InvestorCanonical>;
}
export function mergeWithConflicts(
  local: InvestorCanonical, remote: Partial<InvestorCanonical>,
  localUpdatedAt?: string, remoteUpdatedAt?: string,
) {
  return resolveConflicts<InvestorCanonical>({ local, remote, localUpdatedAt, remoteUpdatedAt, policies: INVESTOR_POLICIES });
}
export function applyVisibilityFilter(p: InvestorCanonical, audience: Audience) {
  return toCollectivePayload(p, audience);
}
