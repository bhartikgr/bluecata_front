/**
 * Sprint 8 — Production-shape profile schemas.
 *
 * Every type in this file is the EXACT shape that production Postgres will
 * store and that the Capavate ↔ Collective outbox replicates. The TypeScript
 * shape uses camelCase; the wire format (JSON over HTTP, JSON in outbox
 * payloads) uses camelCase as well. The Postgres column equivalent (snake_case)
 * is documented inline next to each field.
 *
 * See:
 *   - capavate_collective_sync_schema.md §3 (company partition)
 *   - capavate_collective_sync_schema.md §4 (investor partition)
 *   - capavate_founder_deep_audit.md §1 (Step 1-4 fields)
 *   - capavate_investor_deep_audit.md §1-§3 (Step 1-3 fields)
 *
 * Zod schemas validate every PATCH on the server and every form submission on
 * the client. They are the contract between client + server + Collective.
 */

import { z } from "zod";
import type { Region } from "@capavate/cap-table-engine";
import { regionForCountry, engineAttribution } from "./region";
import {
  INDUSTRY_OPTIONS, EMPLOYEE_COUNT_OPTIONS,
  STRATEGIC_PRIORITY_OPTIONS, TRANSACTION_INTEREST_OPTIONS,
  PARTNER_TYPE_OPTIONS, DEAL_BREAKER_OPTIONS,
  OPERATING_GEOGRAPHY_OPTIONS, CUSTOMER_SEGMENT_OPTIONS,
  ENTITY_TYPE_OPTIONS,
  INVESTOR_TYPE_OPTIONS, ACCREDITED_STATUS_OPTIONS,
  INDUSTRY_EXPERTISE_OPTIONS, CHEQUE_SIZE_OPTIONS,
  GEOGRAPHY_FOCUS_OPTIONS, PREFERRED_STAGE_OPTIONS,
  HANDS_ON_OPTIONS, MA_INTEREST_OPTIONS, INVESTMENT_INTEREST_OPTIONS,
  KYC_VARIANT_OPTIONS, kycVariantForCountry,
  type IndustryValue, type EmployeeCountValue,
  type StrategicPriorityValue, type TransactionInterestValue,
  type PartnerTypeValue, type DealBreakerValue,
  type OperatingGeographyValue, type CustomerSegmentValue,
  type EntityTypeValue,
  type InvestorTypeValue, type AccreditedStatusValue,
  type IndustryExpertiseValue, type ChequeSizeValue,
  type GeographyFocusValue, type PreferredStageValue,
  type HandsOnValue, type MaInterestValue, type InvestmentInterestValue,
  type KycVariantValue,
} from "./data/enums";
import { COUNTRY_CODES } from "./data/countries";

/* ==================================================================== */
/* COMPANY PROFILE — production-shape                                    */
/* ==================================================================== */

/**
 * Company contact step (audit §1) — 11 fields + logo adaptation.
 * Postgres: `company_profiles.contact_*`
 */
export interface CompanyContactInfo {
  /** company_name */
  companyName: string;
  /** company_email */
  companyEmail: string;
  /** industry_value */
  industry: IndustryValue | null;
  /** phone_country_code (ISO-3166 α2) */
  phoneCountryCode: string;
  /** phone_number_e164 */
  phoneNumber: string;
  /** company_website_url */
  companyWebsiteUrl: string;
  /** number_of_employees_range */
  numberOfEmployees: EmployeeCountValue | null;
  /** date_of_incorporation (ISO-8601 yyyy-mm-dd) */
  dateOfIncorporation: string;
  /** one_sentence_headliner */
  oneSentenceHeadliner: string;
  /** problem_statement */
  problemStatement: string;
  /** solution_statement */
  solutionStatement: string;
  /** logo_data_url — Sprint 8 adaptation (nullable) */
  logoDataUrl: string | null;
}

/**
 * Mailing address step (audit §2) — 6 fields.
 * Postgres: `company_profiles.mailing_*`
 */
export interface CompanyMailingAddress {
  /** mailing_street */
  street: string;
  /** mailing_unit_suite (nullable) */
  unitSuite: string | null;
  /** mailing_city */
  city: string;
  /** mailing_state_province */
  stateProvince: string;
  /** mailing_postal_code */
  postalCode: string;
  /** mailing_country_code (ISO-3166 α2) */
  countryCode: string;
}

/**
 * Legal entity step (audit §3) — 7 fields + 2 Sprint-8 adaptations.
 * Postgres: `company_profiles.legal_*`
 */
export interface CompanyLegalEntity {
  /** articles_file_name (filename only — file blob lives in S3 in production) */
  articlesFileName: string | null;
  /** articles_file_size_bytes */
  articlesFileSizeBytes: number | null;
  /** articles_file_sha256 — file integrity hash (production: KMS-encrypted) */
  articlesFileSha256: string | null;
  /** legal_entity_name */
  legalEntityName: string;
  /** business_number */
  businessNumber: string;
  /** country_of_incorporation_code (ISO-3166 α2) — DRIVES REGION */
  countryOfIncorporationCode: string;
  /** entity_type_value */
  entityType: EntityTypeValue | null;
  /** is_publicly_traded */
  isPubliclyTraded: boolean;
  /** Sprint 18 Phase 2 T3.3 — listing country (ISO-3166 α2). */
  listingCountryCode?: string;
  /** Sprint 18 Phase 2 T3.3 — stock exchange code (e.g. NYSE, TSX, LSE). */
  exchangeCode?: string;
  /** Sprint 18 Phase 2 T3.3 — listing name / ticker symbol. */
  tickerSymbol?: string;
  /** registered_office_address */
  registeredOfficeAddress: string;
  /** region (DERIVED, read-only) — drives engine selection */
  region: Region;
  /** kyc_variant (DERIVED) — jurisdiction-aware KYC for invited investors */
  kycVariant: KycVariantValue;
  /** engine_attribution — denormalised display string */
  engineAttribution: string;
}

/**
 * 30-field M&A intelligence (audit §4) — Step 4 of the wizard.
 *
 * EVERY field here is Collective-shared (sync schema §3.4). A change to ANY
 * field emits `company.ma_intelligence.updated` to the outbox.
 *
 * Postgres: `company_ma_intelligence.*`
 */
export interface CompanyMAIntelligence {
  /* Section 1 — Strategic Priorities (multi-selects) */
  strategicPriorities: StrategicPriorityValue[];      // up to 3
  transactionInterests: TransactionInterestValue[];
  partnerTypesSought: PartnerTypeValue[];
  dealBreakers: DealBreakerValue[];

  /* Section 2 — Competitive Landscape (3 competitors × 3 fields) */
  competitor1Name: string;
  competitor1WebsiteUrl: string;
  competitor1Differentiator: string;
  competitor2Name: string;
  competitor2WebsiteUrl: string;
  competitor2Differentiator: string;
  competitor3Name: string;
  competitor3WebsiteUrl: string;
  competitor3Differentiator: string;

  /* Section 3 — Corporate Governance (11 booleans + 1 text) */
  hasFormalBoard: boolean;
  hasPendingLitigation: boolean;
  isRegulatoryCompliant: boolean;
  hasExternalLegalCounsel: boolean;
  isFinanciallyAudited: boolean;
  isSaasRecurring: boolean;
  holdsMaterialIp: boolean;
  hasEsgFramework: boolean;
  hasDeiPolicy: boolean;
  hasCybersecurityCertification: boolean;
  accountingFirmName: string;

  /* Section 4 — Market Presence (5 fields) */
  operatingGeographies: OperatingGeographyValue[];
  customerSegments: CustomerSegmentValue[];
  hasMfnExclusivity: boolean;
  hasRevenueConcentration30Pct: boolean;
  hasChangeOfControlClauses: boolean;

  /* Section 5 — Narrative (2 textareas) */
  maReadinessNarrative: string;
  uniqueValueProposition: string;
}

/** The full assembled company profile. */
export interface CompanyProfile {
  /** Stable ID — production: companies.id (text, e.g. "co_novapay"). */
  id: string;
  /** Tenant scope (production: tenant_id, RLS-enforced). */
  tenantId: string;
  /** Schema version — production-shape contract (bump on breaking change). */
  schemaVersion: "1.0";
  /** Last-updated ISO timestamp (production: updated_at). */
  updatedAt: string;
  /** ISO timestamp of profile creation. */
  createdAt: string;

  contact: CompanyContactInfo;
  address: CompanyMailingAddress;
  legal: CompanyLegalEntity;
  ma: CompanyMAIntelligence;
}

/* ==================================================================== */
/* INVESTOR PROFILE — production-shape                                   */
/* ==================================================================== */

/** Step 1 Section A: current role. Audit §1. */
export interface InvestorRole {
  /** screen_name (3-30 chars, [a-zA-Z0-9_-], unique platform-wide) */
  screenName: string | null;
  currentCompanyName: string;
  /** company_country_code (ISO-3166 α2) */
  companyCountryCode: string;
  currentJobTitle: string;
  companyWebsite: string;
}

/** Step 1 Section B: contact. */
export interface InvestorContact {
  firstName: string;
  lastName: string;
  /** Read-only — set at Auth0 invitation redemption. */
  email: string;
  /** contact_country_code (ISO-3166 α2) */
  countryCode: string;
  stateProvince: string;
  city: string;
  /** mobile_country_code (ISO-3166 α2) */
  mobileCountryCode: string;
  mobileNumber: string;
}

/** Step 2: Investor profile + KYC + accreditation. Audit §2. */
export interface InvestorProfileCore {
  investorType: InvestorTypeValue | null;
  accreditedStatus: AccreditedStatusValue | null;
  /** Cleared back to false when accreditedStatus changes pending re-verification. */
  accreditationVerified: boolean;
  accreditationVerifiedAt: string | null;
  networkBio: string;
  linkedinUrl: string;
  investsThroughCompany: boolean;
  investmentEntityName: string | null;
  investmentEntityJurisdiction: string | null;
  countryOfTaxResidencyCode: string;
  taxIdOrNationalId: string;
  /** kyc_documents — multi-file. Each entry: filename + size + sha256 hash. */
  kycDocuments: Array<{ name: string; sizeBytes: number; sha256: string; uploadedAt: string }>;
  profilePictureName: string | null;
  /** kyc_variant (DERIVED) — set from countryOfTaxResidencyCode. */
  kycVariant: KycVariantValue;
}

/** Step 3: Network profile. Audit §3 — multi-selects + privacy toggles. */
export interface InvestorNetwork {
  industryExpertise: IndustryExpertiseValue[];
  chequeSizes: ChequeSizeValue[];
  geographyFocus: GeographyFocusValue[];
  preferredStages: PreferredStageValue[];
  handsOn: HandsOnValue[];
  maInterests: MaInterestValue[];
  investmentInterests: InvestmentInterestValue[];
  /** Per-interest description text (sparse map). */
  investmentInterestDescriptions: Partial<Record<InvestmentInterestValue, string>>;
}

/** Privacy + visibility (R200.gating §6). Default off on all three. */
export interface InvestorVisibility {
  visibleToCoMembers: boolean;
  visibleToCollectiveNetwork: boolean;
  /** Derived: was a screen name set? (driven by InvestorRole.screenName !== null && !=='') */
  screenNameSet: boolean;
}

export interface InvestorProfile {
  id: string;
  tenantId: string;
  schemaVersion: "1.0";
  updatedAt: string;
  createdAt: string;

  role: InvestorRole;
  contact: InvestorContact;
  profile: InvestorProfileCore;
  network: InvestorNetwork;
  visibility: InvestorVisibility;
}

/* ==================================================================== */
/* ZOD SCHEMAS — runtime validation                                      */
/* ==================================================================== */

const enumValues = <T extends readonly { value: string }[]>(o: T) =>
  o.map(x => x.value) as unknown as readonly [string, ...string[]];

const industryEnum            = z.enum(enumValues(INDUSTRY_OPTIONS) as [IndustryValue, ...IndustryValue[]]);
const employeeEnum            = z.enum(enumValues(EMPLOYEE_COUNT_OPTIONS) as [EmployeeCountValue, ...EmployeeCountValue[]]);
const strategicPriorityEnum   = z.enum(enumValues(STRATEGIC_PRIORITY_OPTIONS) as [StrategicPriorityValue, ...StrategicPriorityValue[]]);
const transactionInterestEnum = z.enum(enumValues(TRANSACTION_INTEREST_OPTIONS) as [TransactionInterestValue, ...TransactionInterestValue[]]);
const partnerTypeEnum         = z.enum(enumValues(PARTNER_TYPE_OPTIONS) as [PartnerTypeValue, ...PartnerTypeValue[]]);
const dealBreakerEnum         = z.enum(enumValues(DEAL_BREAKER_OPTIONS) as [DealBreakerValue, ...DealBreakerValue[]]);
const operatingGeoEnum        = z.enum(enumValues(OPERATING_GEOGRAPHY_OPTIONS) as [OperatingGeographyValue, ...OperatingGeographyValue[]]);
const customerSegmentEnum     = z.enum(enumValues(CUSTOMER_SEGMENT_OPTIONS) as [CustomerSegmentValue, ...CustomerSegmentValue[]]);
const entityTypeEnum          = z.enum(enumValues(ENTITY_TYPE_OPTIONS) as [EntityTypeValue, ...EntityTypeValue[]]);
const investorTypeEnum        = z.enum(enumValues(INVESTOR_TYPE_OPTIONS) as [InvestorTypeValue, ...InvestorTypeValue[]]);
const accreditedEnum          = z.enum(enumValues(ACCREDITED_STATUS_OPTIONS) as [AccreditedStatusValue, ...AccreditedStatusValue[]]);
const industryExpertiseEnum   = z.enum(enumValues(INDUSTRY_EXPERTISE_OPTIONS) as [IndustryExpertiseValue, ...IndustryExpertiseValue[]]);
const chequeSizeEnum          = z.enum(enumValues(CHEQUE_SIZE_OPTIONS) as [ChequeSizeValue, ...ChequeSizeValue[]]);
const geographyFocusEnum      = z.enum(enumValues(GEOGRAPHY_FOCUS_OPTIONS) as [GeographyFocusValue, ...GeographyFocusValue[]]);
const preferredStageEnum      = z.enum(enumValues(PREFERRED_STAGE_OPTIONS) as [PreferredStageValue, ...PreferredStageValue[]]);
const handsOnEnum             = z.enum(enumValues(HANDS_ON_OPTIONS) as [HandsOnValue, ...HandsOnValue[]]);
const maInterestEnum          = z.enum(enumValues(MA_INTEREST_OPTIONS) as [MaInterestValue, ...MaInterestValue[]]);
const investmentInterestEnum  = z.enum(enumValues(INVESTMENT_INTEREST_OPTIONS) as [InvestmentInterestValue, ...InvestmentInterestValue[]]);
const kycVariantEnum          = z.enum(enumValues(KYC_VARIANT_OPTIONS) as [KycVariantValue, ...KycVariantValue[]]);
const countryEnum             = z.enum(COUNTRY_CODES as unknown as [string, ...string[]]);

export const companyContactSchema = z.object({
  companyName: z.string().min(1).max(100),
  companyEmail: z.string().email(),
  industry: industryEnum.nullable(),
  phoneCountryCode: countryEnum.or(z.literal("")),
  phoneNumber: z.string().max(40),
  companyWebsiteUrl: z.string().url().or(z.literal("")),
  numberOfEmployees: employeeEnum.nullable(),
  dateOfIncorporation: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")),
  oneSentenceHeadliner: z.string().max(400),
  problemStatement: z.string().max(600),
  solutionStatement: z.string().max(600),
  logoDataUrl: z.string().nullable(),
});

export const companyAddressSchema = z.object({
  street: z.string().max(200),
  unitSuite: z.string().max(40).nullable(),
  city: z.string().max(80),
  stateProvince: z.string().max(80),
  postalCode: z.string().max(20),
  countryCode: countryEnum.or(z.literal("")),
});

export const companyLegalSchema = z.object({
  articlesFileName: z.string().nullable(),
  articlesFileSizeBytes: z.number().nonnegative().nullable(),
  articlesFileSha256: z.string().nullable(),
  legalEntityName: z.string().max(200),
  // Sprint 18 Phase 2 — T3.1: business number is optional.
  businessNumber: z.string().max(80).optional().default(""),
  countryOfIncorporationCode: countryEnum.or(z.literal("")),
  entityType: entityTypeEnum.nullable(),
  isPubliclyTraded: z.boolean(),
  listingCountryCode: z.string().max(2).optional().default(""),
  exchangeCode: z.string().max(60).optional().default(""),
  tickerSymbol: z.string().max(40).optional().default(""),
  registeredOfficeAddress: z.string().max(400),
  // Region + KYC variant + attribution are derived server-side. Accept on
  // input but recompute deterministically before persist.
  region: z.string(),
  kycVariant: kycVariantEnum,
  engineAttribution: z.string(),
});

export const companyMaSchema = z.object({
  strategicPriorities: z.array(strategicPriorityEnum).max(3),
  transactionInterests: z.array(transactionInterestEnum),
  partnerTypesSought: z.array(partnerTypeEnum),
  dealBreakers: z.array(dealBreakerEnum),

  competitor1Name: z.string().max(400),
  competitor1WebsiteUrl: z.string().max(400),
  competitor1Differentiator: z.string().max(400),
  competitor2Name: z.string().max(400),
  competitor2WebsiteUrl: z.string().max(400),
  competitor2Differentiator: z.string().max(400),
  competitor3Name: z.string().max(400),
  competitor3WebsiteUrl: z.string().max(400),
  competitor3Differentiator: z.string().max(400),

  hasFormalBoard: z.boolean(),
  hasPendingLitigation: z.boolean(),
  isRegulatoryCompliant: z.boolean(),
  hasExternalLegalCounsel: z.boolean(),
  isFinanciallyAudited: z.boolean(),
  isSaasRecurring: z.boolean(),
  holdsMaterialIp: z.boolean(),
  hasEsgFramework: z.boolean(),
  hasDeiPolicy: z.boolean(),
  hasCybersecurityCertification: z.boolean(),
  accountingFirmName: z.string().max(120),

  operatingGeographies: z.array(operatingGeoEnum),
  customerSegments: z.array(customerSegmentEnum),
  hasMfnExclusivity: z.boolean(),
  hasRevenueConcentration30Pct: z.boolean(),
  hasChangeOfControlClauses: z.boolean(),

  maReadinessNarrative: z.string().max(2000),
  uniqueValueProposition: z.string().max(800),
});

export const companyProfileSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  schemaVersion: z.literal("1.0"),
  updatedAt: z.string(),
  createdAt: z.string(),
  contact: companyContactSchema,
  address: companyAddressSchema,
  legal: companyLegalSchema,
  ma: companyMaSchema,
});

/** PATCH partial — accepts any subset of the four section objects. */
export const companyProfilePatchSchema = z.object({
  contact: companyContactSchema.partial().optional(),
  address: companyAddressSchema.partial().optional(),
  legal: companyLegalSchema.partial().optional(),
  ma: companyMaSchema.partial().optional(),
});
export type CompanyProfilePatch = z.infer<typeof companyProfilePatchSchema>;

/* Investor profile schemas. */
const screenNameRegex = /^[A-Za-z0-9_-]+$/;
export const screenNameSchema = z.string()
  .min(3, "Screen name must be at least 3 characters")
  .max(30, "Screen name must be 30 characters or fewer")
  .regex(screenNameRegex, "Letters, digits, underscore, and dash only");

export const investorRoleSchema = z.object({
  screenName: screenNameSchema.nullable().or(z.literal("")),
  currentCompanyName: z.string().max(200),
  companyCountryCode: countryEnum.or(z.literal("")),
  currentJobTitle: z.string().max(120),
  companyWebsite: z.string().url().or(z.literal("")),
});

export const investorContactSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  email: z.string().email(),
  countryCode: countryEnum.or(z.literal("")),
  stateProvince: z.string().max(80),
  city: z.string().max(80),
  mobileCountryCode: countryEnum.or(z.literal("")),
  mobileNumber: z.string().max(40),
});

export const investorProfileCoreSchema = z.object({
  investorType: investorTypeEnum.nullable(),
  accreditedStatus: accreditedEnum.nullable(),
  accreditationVerified: z.boolean(),
  accreditationVerifiedAt: z.string().nullable(),
  networkBio: z.string().max(500),
  linkedinUrl: z.string().url().or(z.literal("")),
  investsThroughCompany: z.boolean(),
  investmentEntityName: z.string().max(200).nullable(),
  investmentEntityJurisdiction: countryEnum.or(z.literal("")).nullable(),
  countryOfTaxResidencyCode: countryEnum.or(z.literal("")),
  taxIdOrNationalId: z.string().max(80),
  kycDocuments: z.array(z.object({
    name: z.string(),
    sizeBytes: z.number().nonnegative(),
    sha256: z.string(),
    uploadedAt: z.string(),
  })),
  profilePictureName: z.string().nullable(),
  kycVariant: kycVariantEnum,
});

export const investorNetworkSchema = z.object({
  industryExpertise: z.array(industryExpertiseEnum),
  chequeSizes: z.array(chequeSizeEnum),
  geographyFocus: z.array(geographyFocusEnum),
  preferredStages: z.array(preferredStageEnum),
  handsOn: z.array(handsOnEnum),
  maInterests: z.array(maInterestEnum),
  investmentInterests: z.array(investmentInterestEnum),
  investmentInterestDescriptions: z.record(z.string(), z.string()),
});

export const investorVisibilitySchema = z.object({
  visibleToCoMembers: z.boolean(),
  visibleToCollectiveNetwork: z.boolean(),
  screenNameSet: z.boolean(),
});

export const investorProfileSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  schemaVersion: z.literal("1.0"),
  updatedAt: z.string(),
  createdAt: z.string(),
  role: investorRoleSchema,
  contact: investorContactSchema,
  profile: investorProfileCoreSchema,
  network: investorNetworkSchema,
  visibility: investorVisibilitySchema,
});

export const investorProfilePatchSchema = z.object({
  role: investorRoleSchema.partial().optional(),
  contact: investorContactSchema.partial().optional(),
  profile: investorProfileCoreSchema.partial().optional(),
  network: investorNetworkSchema.partial().optional(),
  visibility: investorVisibilitySchema.partial().optional(),
});
export type InvestorProfilePatch = z.infer<typeof investorProfilePatchSchema>;

export const investorPrivacyPatchSchema = investorVisibilitySchema.partial();
export type InvestorPrivacyPatch = z.infer<typeof investorPrivacyPatchSchema>;

/* ==================================================================== */
/* DERIVATIONS                                                          */
/* ==================================================================== */

/**
 * Recompute derived legal-entity fields (region, kycVariant, attribution)
 * from `countryOfIncorporationCode`. Used both client-side (for instant UI
 * feedback) and server-side (before persist) so the values are always
 * consistent.
 */
export function deriveLegalFields(
  countryOfIncorporationCode: string,
): Pick<CompanyLegalEntity, "region" | "kycVariant" | "engineAttribution"> {
  const region = regionForCountry(countryOfIncorporationCode);
  return {
    region,
    kycVariant: kycVariantForCountry(countryOfIncorporationCode),
    engineAttribution: engineAttribution(region),
  };
}

/** Recompute investor kycVariant from country_of_tax_residency_code. */
export function deriveInvestorKycVariant(countryCode: string): KycVariantValue {
  return kycVariantForCountry(countryCode);
}

/**
 * M&A readiness score (0-100). Production: weighted formula stored in the
 * formula registry (see packages/cap-table-engine/src/formulas/) — for the
 * preview we ship a simple weighted formula matching the cohort benchmark
 * shape from packages/telemetry/src/benchmarks.ts.
 *
 * Weights are documented inline. Sum of all max-scores = 100.
 */
export function computeMaReadinessScore(ma: CompanyMAIntelligence): {
  score: number;
  components: Array<{ label: string; weight: number; awarded: number }>;
} {
  const components: Array<{ label: string; weight: number; awarded: number }> = [];

  // Strategic clarity (15 pts): has at least one strategic priority + transaction interest.
  components.push({
    label: "Strategic clarity",
    weight: 15,
    awarded: (ma.strategicPriorities.length > 0 && !ma.strategicPriorities.includes("no_intention") ? 8 : 0)
           + (ma.transactionInterests.length > 0 ? 7 : 0),
  });

  // Governance basics (25 pts): board + counsel + audit + IP + ESG.
  components.push({
    label: "Governance",
    weight: 25,
    awarded: (ma.hasFormalBoard ? 5 : 0)
           + (ma.hasExternalLegalCounsel ? 5 : 0)
           + (ma.isFinanciallyAudited ? 8 : 0)
           + (ma.holdsMaterialIp ? 4 : 0)
           + (ma.hasEsgFramework ? 3 : 0),
  });

  // Risk posture (20 pts): low litigation/concentration risk, has cybersecurity.
  components.push({
    label: "Risk posture",
    weight: 20,
    awarded: (ma.hasPendingLitigation ? 0 : 8)
           + (ma.hasRevenueConcentration30Pct ? 0 : 4)
           + (ma.hasChangeOfControlClauses ? 0 : 4)
           + (ma.hasCybersecurityCertification ? 4 : 0),
  });

  // Compliance (15 pts): regulatory + DEI + recurring model.
  components.push({
    label: "Compliance & policies",
    weight: 15,
    awarded: (ma.isRegulatoryCompliant ? 8 : 0)
           + (ma.hasDeiPolicy ? 4 : 0)
           + (ma.isSaasRecurring ? 3 : 0),
  });

  // Market presence (15 pts): geographies + segments + competitive insight.
  const competitorsFilled = [ma.competitor1Name, ma.competitor2Name, ma.competitor3Name].filter(Boolean).length;
  components.push({
    label: "Market presence",
    weight: 15,
    awarded: Math.min(5, ma.operatingGeographies.length)
           + Math.min(5, ma.customerSegments.length)
           + Math.min(5, competitorsFilled * 1.7),
  });

  // Narrative (10 pts): readiness narrative + UVP.
  components.push({
    label: "Narrative",
    weight: 10,
    awarded: (ma.maReadinessNarrative.trim().length >= 200 ? 6 : ma.maReadinessNarrative.trim().length >= 50 ? 3 : 0)
           + (ma.uniqueValueProposition.trim().length >= 50 ? 4 : 0),
  });

  const score = Math.round(components.reduce((acc, c) => acc + Math.min(c.weight, c.awarded), 0));
  return { score: Math.max(0, Math.min(100, score)), components };
}

/* ==================================================================== */
/* CHANGED-FIELDS DIFF                                                   */
/* ==================================================================== */

/** Compute a flat `changedFields[]` list for sync events. Recurses sections. */
export function diffChangedFields(prev: unknown, next: unknown, prefix = ""): string[] {
  const out: string[] = [];
  if (typeof prev !== typeof next) {
    out.push(prefix || "(root)");
    return out;
  }
  if (prev === null || next === null || typeof prev !== "object" || typeof next !== "object") {
    if (JSON.stringify(prev) !== JSON.stringify(next)) out.push(prefix || "(root)");
    return out;
  }
  if (Array.isArray(prev) && Array.isArray(next)) {
    if (JSON.stringify(prev) !== JSON.stringify(next)) out.push(prefix);
    return out;
  }
  const a = prev as Record<string, unknown>;
  const b = next as Record<string, unknown>;
  const keysSet = new Set<string>();
  Object.keys(a).forEach((k) => keysSet.add(k));
  Object.keys(b).forEach((k) => keysSet.add(k));
  const keys: string[] = [];
  keysSet.forEach((k) => keys.push(k));
  for (const k of keys) {
    const childPath = prefix ? `${prefix}.${k}` : k;
    out.push(...diffChangedFields(a[k], b[k], childPath));
  }
  return out;
}

/**
 * Apply a deep-merge patch to a profile. Top-level sections (`contact`,
 * `address`, `legal`, `ma`, etc.) are merged shallowly; primitives + arrays
 * are replaced wholesale. Arrays are NEVER concatenated.
 */
export function applyProfilePatch<T extends Record<string, unknown>>(prev: T, patch: Partial<T>): T {
  const out: Record<string, unknown> = { ...prev };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const prevSection = (prev as Record<string, unknown>)[k];
    if (
      v && typeof v === "object" && !Array.isArray(v) &&
      prevSection && typeof prevSection === "object" && !Array.isArray(prevSection)
    ) {
      out[k] = { ...(prevSection as Record<string, unknown>), ...(v as Record<string, unknown>) };
    } else {
      out[k] = v;
    }
  }
  return out as T;
}
