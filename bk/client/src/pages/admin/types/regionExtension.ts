/**
 * Client-side type definitions for the Region Extension workflow.
 * Mirror of server/regionExtensionStore.ts types — kept in sync manually.
 */

export type RegionStatus =
  | "research"
  | "draft"
  | "review"
  | "approved"
  | "live"
  | "rejected"
  | "archived";

export interface RegionResearch {
  legalBasisSummary: string;
  primarySources: Array<{ label: string; url: string }>;
  recommendedSAFE: boolean;
  recommendedConvertibleNote: boolean;
  recommendedEquity: boolean;
  taxResidencyNotes: string;
  esopFrameworkNotes: string;
  antiDilutionNotes: string;
  vestingDefaultMonths: number;
  vestingCliffMonths: number;
  filingAgencyName: string;
  signatureLawName: string;
}

export interface ProposedFormula {
  id: string;
  category: string;
  name: string;
  definition: string;
  citationSource: string;
  citationUrl: string;
}

export interface RegionDraft {
  code: string;
  name: string;
  jurisdictionLabel: string;
  currency: string;
  flag: string;
  defaultLegalEntityType: string;
  defaultIncorporationDocs: string[];
  proposedFormulas: ProposedFormula[];
  pricingMultiplier: number;
  defaultSubscriptionCurrency: string;
  termSheetTemplateRefs: string[];
}

export interface RegionExtension {
  id: string;
  status: RegionStatus;
  code: string;
  name: string;
  research: RegionResearch;
  draft: RegionDraft | null;
  reviewerNotes: string;
  approvedAt: string | null;
  approvedBy: string | null;
  liveAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  version: number;
  prevRevisionHash: string;
  revisionHash: string;
}

export interface RegionRevision {
  extensionId: string;
  version: number;
  prevRevisionHash: string;
  revisionHash: string;
  changedBy: string;
  changedAt: string;
  snapshot: RegionExtension;
}

export interface RegionHistoryResponse {
  extensionId: string;
  chainVerify: { ok: boolean; brokenAt: number; totalLinks: number };
  totalRevisions: number;
  revisions: RegionRevision[];
}
