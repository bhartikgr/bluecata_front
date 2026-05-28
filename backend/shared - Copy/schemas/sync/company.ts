/**
 * Entity 1 — Company Profile (130+ fields).
 * SOT: Capavate (single source of truth).
 * Trigger: company.profile.updated (also company.ma_intelligence.updated for §6 fields).
 */
import { z } from "zod";
import {
  type FieldPolicy,
  filterPayloadByPolicy,
  resolveConflicts,
  type Audience,
} from "./_common";

export const CompanyCanonicalSchema = z.object({
  // Identity (1.1.1)
  id: z.string(),
  legalName: z.string().min(1).max(200),
  dbaTrade: z.string().max(200).optional(),
  entityType: z.enum(["Corporation", "LLC", "Pvt Ltd", "Partnership", "Other"]),
  jurisdiction: z.string(),
  registrationId: z.string().optional(), // VIS-1
  formationDate: z.string().optional(),
  fiscalYearEnd: z.string().optional(),
  primaryEmail: z.string().email().optional(), // VIS-1
  primaryPhone: z.string().optional(),         // VIS-1
  websiteUrl: z.string().url().optional(),
  taxIdNationalId: z.string().optional(),      // VIS-1
  legalAddress: z.string().optional(),
  operatingAddresses: z.array(z.string()).optional(), // VIS-1
  // Business
  industry: z.string().optional(),
  subIndustry: z.string().optional(),
  stage: z.enum(["pre_seed", "seed", "seed_extension", "series_a", "series_b", "series_c", "growth", "other"]).optional(),
  productSummary: z.string().optional(),
  problemSummary: z.string().optional(),
  marketSummary: z.string().optional(),
  customerNames: z.array(z.string()).optional(), // VIS-9
  partnersList: z.array(z.string()).optional(),
  competitors: z.array(z.string()).optional(),
  // People (key fields)
  founderName: z.string().optional(),
  founderEmail: z.string().email().optional(),  // VIS-1
  founderTitle: z.string().optional(),
  ceoName: z.string().optional(),
  signatoryUserIds: z.array(z.string()).optional(),
  boardMembers: z.array(z.string()).optional(),
  boardObservers: z.array(z.string()).optional(), // VIS-9
  advisors: z.array(z.string()).optional(),
  // Cap-table summary (denormalized — derived from positions)
  totalSharesOutstanding: z.string().optional(), // derived
  preMoneyValuation: z.string().optional(),
  postMoneyValuation: z.string().optional(),
  fdSharesOutstanding: z.string().optional(),    // derived
  esopPoolPct: z.number().optional(),
  // Financials
  revenueLast12M: z.string().optional(),
  arr: z.string().optional(),
  burnRate: z.string().optional(),               // VIS-8 — never shared
  runwayMonths: z.number().optional(),
  cashOnHand: z.string().optional(),
  debtFacilities: z.array(z.string()).optional(),// VIS-9
  // Round-current
  currentRoundId: z.string().optional(),
  currentRoundStatus: z.string().optional(),
  currentRoundTargetUsd: z.string().optional(),
  currentRoundCommittedUsd: z.string().optional(),
  // M&A intelligence — Entity 6 split-out fields ride here for §1.6
  maReadinessScore: z.number().min(0).max(100).optional(),
  maStrategicFit: z.string().optional(),
  maAcquirerProfile: z.string().optional(),
  maPreferredOutcome: z.string().optional(),
  maExitTimeline: z.string().optional(),
  // Auto-tier (set by inbound dsc.scores / ma.intelligence_rankings)
  autoTier: z.enum(["A", "B", "C", "watch", "unrated"]).optional(),
  compositeScore: z.number().optional(),  // VIS-4
  mnaScore: z.number().optional(),        // VIS-4
  roundScore: z.number().optional(),      // VIS-4
  sectorBenchmark: z.number().optional(),
  // Lifecycle
  archived: z.boolean().optional(),
  archivedAt: z.string().optional(),
  // Visibility
  visibleToCollective: z.boolean().optional(),
  // Bookkeeping
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional(),
});

export type CompanyCanonical = z.infer<typeof CompanyCanonicalSchema>;

/** Field-policy table — drives conflict resolver + privacy filter. */
export const COMPANY_POLICIES: Record<string, FieldPolicy> = {
  id: { sot: "capavate" },
  legalName: { sot: "capavate" },
  dbaTrade: { sot: "capavate" },
  entityType: { sot: "capavate" },
  jurisdiction: { sot: "capavate" },
  registrationId: { sot: "capavate", privacy: "VIS-1" },
  primaryEmail: { sot: "capavate", privacy: "VIS-1" },
  primaryPhone: { sot: "capavate", privacy: "VIS-1" },
  taxIdNationalId: { sot: "capavate", privacy: "VIS-1" },
  operatingAddresses: { sot: "capavate", privacy: "VIS-1" },
  founderEmail: { sot: "capavate", privacy: "VIS-1" },
  customerNames: { sot: "capavate", privacy: "VIS-9" },
  boardObservers: { sot: "capavate", privacy: "VIS-9" },
  debtFacilities: { sot: "capavate", privacy: "VIS-9" },
  burnRate: { sot: "capavate", privacy: "VIS-8" },
  runwayMonths: { sot: "derived", derived: true },
  totalSharesOutstanding: { sot: "derived", derived: true },
  fdSharesOutstanding: { sot: "derived", derived: true },
  // M&A intelligence — Collective owns the scores (it's their ranking)
  compositeScore: { sot: "collective", privacy: "VIS-4" },
  mnaScore: { sot: "collective", privacy: "VIS-4" },
  roundScore: { sot: "collective", privacy: "VIS-4" },
  sectorBenchmark: { sot: "collective" },
  autoTier: { sot: "collective" },
  // Round/cap summary fields are derived but exposed
  preMoneyValuation: { sot: "shared" },
  postMoneyValuation: { sot: "shared" },
};

/** Outbound — strip privacy-restricted fields for the given audience. */
export function toCollectivePayload(
  c: CompanyCanonical,
  audience: Audience = "collective_public",
): Partial<CompanyCanonical> {
  return filterPayloadByPolicy(c, COMPANY_POLICIES, audience);
}

/** Inbound — accept Collective payload, drop derived. */
export function fromCollectivePayload(p: Partial<CompanyCanonical>): Partial<CompanyCanonical> {
  const out: Record<string, unknown> = { ...p };
  for (const [k, pol] of Object.entries(COMPANY_POLICIES)) {
    if (pol.derived) delete out[k];
  }
  return out as Partial<CompanyCanonical>;
}

export function mergeWithConflicts(
  local: CompanyCanonical,
  remote: Partial<CompanyCanonical>,
  localUpdatedAt?: string,
  remoteUpdatedAt?: string,
) {
  return resolveConflicts<CompanyCanonical>({
    local,
    remote,
    localUpdatedAt,
    remoteUpdatedAt,
    policies: COMPANY_POLICIES,
  });
}

export function applyVisibilityFilter(c: CompanyCanonical, audience: Audience) {
  return filterPayloadByPolicy(c, COMPANY_POLICIES, audience);
}
