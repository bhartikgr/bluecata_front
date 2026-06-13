/**
 * Patch v4 — fixture profiles for the in-memory profile stores.
 *
 * This module is consumed only by unit tests (`__tests__/*.ts`) to validate
 * schema parsing, patch merging, and M&A readiness scoring. It is NOT
 * imported by any application surface, so tree-shaking removes it from the
 * production bundle. All persona / company strings here are generic
 * placeholders that match the production schema shape but contain no
 * demo persona leaks.
 *
 * If you need to seed a running app for demos, set VITE_ENABLE_DEMO_SEED=1
 * and use a dev-only seeding endpoint instead.
 */
import type { CompanyProfile, InvestorProfile } from "./types";
import { deriveLegalFields, deriveInvestorKycVariant } from "./types";

const NOW = "2026-05-08T20:00:00Z";

export const SEED_COMPANY_PROFILE: CompanyProfile = {
  id: "co-fixture",
  tenantId: "tnt_capavate_us",
  schemaVersion: "1.0",
  createdAt: "2023-09-12T00:00:00Z",
  updatedAt: NOW,
  contact: {
    companyName: "Example Co",
    companyEmail: "hello@example.test",
    industry: "fintech_digital_payments",
    phoneCountryCode: "US",
    phoneNumber: "+1 415 555 0140",
    companyWebsiteUrl: "https://example.test",
    numberOfEmployees: "11-50",
    dateOfIncorporation: "2023-09-12",
    oneSentenceHeadliner: "Fixture headliner for schema validation only.",
    problemStatement:
      "Fixture problem statement long enough to satisfy any minimum-length validation rules applied by the company profile schema.",
    solutionStatement:
      "Fixture solution statement long enough to satisfy any minimum-length validation rules applied by the company profile schema.",
    logoDataUrl: null,
  },
  address: {
    street: "1 Example Street",
    unitSuite: "Suite 100",
    city: "San Francisco",
    stateProvince: "California",
    postalCode: "94104",
    countryCode: "US",
  },
  legal: {
    articlesFileName: "Articles-of-Incorporation.pdf",
    articlesFileSizeBytes: 184_512,
    articlesFileSha256: "ad1f6e1c2b6ce30a1c68b9e8b4c5b2c3a8f6d4e7f1a2b3c4d5e6f7a8b9c0d1e2",
    legalEntityName: "Example Co, Inc.",
    businessNumber: "EIN 88-3924711",
    countryOfIncorporationCode: "US",
    entityType: "us_c_corp",
    isPubliclyTraded: false,
    registeredOfficeAddress: "1 Example Street, Suite 100, San Francisco, CA 94104, USA",
    ...deriveLegalFields("US"),
  },
  ma: {
    strategicPriorities: ["market_expansion", "tech_acquisition", "customer_distribution"],
    transactionInterests: ["jv_partnership", "minority_investment"],
    partnerTypesSought: ["distribution", "technology", "capital"],
    dealBreakers: ["sale_of_control", "license_core_ip"],

    competitor1Name: "Competitor One",
    competitor1WebsiteUrl: "https://competitor-one.test",
    competitor1Differentiator: "Fixture differentiator one — used only by unit tests to validate the schema's minimum length on differentiator fields.",
    competitor2Name: "Competitor Two",
    competitor2WebsiteUrl: "https://competitor-two.test",
    competitor2Differentiator: "Fixture differentiator two — used only by unit tests to validate the schema's minimum length on differentiator fields.",
    competitor3Name: "Competitor Three",
    competitor3WebsiteUrl: "https://competitor-three.test",
    competitor3Differentiator: "Fixture differentiator three — used only by unit tests to validate the schema's minimum length on differentiator fields.",

    hasFormalBoard: true,
    hasPendingLitigation: false,
    isRegulatoryCompliant: true,
    hasExternalLegalCounsel: true,
    isFinanciallyAudited: false,
    isSaasRecurring: true,
    holdsMaterialIp: true,
    hasEsgFramework: false,
    hasDeiPolicy: true,
    hasCybersecurityCertification: true,
    accountingFirmName: "Fixture Accounting",

    operatingGeographies: ["north_america", "western_europe", "southeast_asia"],
    customerSegments: ["enterprise", "mid_market"],
    hasMfnExclusivity: false,
    hasRevenueConcentration30Pct: false,
    hasChangeOfControlClauses: true,

    maReadinessNarrative:
      "Fixture M&A readiness narrative long enough to satisfy schema minimum-length validation. The company is approaching JV-readiness, has a regulatory-cleared core product, recurring revenue, and a defensible technology layer. Priority is sustainable scale, not a fast exit.",
    uniqueValueProposition:
      "Fixture unique value proposition long enough to satisfy schema minimum-length validation. Differentiation comes from real-time optimisation across multiple corridors with measurable cost savings.",
  },
};

export const SEED_INVESTOR_PROFILE: InvestorProfile = {
  id: "u-fixture-investor",
  tenantId: "tnt_capavate_us",
  schemaVersion: "1.0",
  createdAt: "2025-10-01T00:00:00Z",
  updatedAt: NOW,
  role: {
    screenName: "FixtureCap",
    currentCompanyName: "Fixture Capital Partners",
    companyCountryCode: "CA",
    currentJobTitle: "Managing Partner",
    companyWebsite: "https://fixture.capital",
  },
  contact: {
    firstName: "Jane",
    lastName: "Doe",
    email: "jane.doe@fixture.capital",
    countryCode: "CA",
    stateProvince: "Ontario",
    city: "Toronto",
    mobileCountryCode: "CA",
    mobileNumber: "+1 416 555 0177",
  },
  profile: {
    investorType: "venture_capital",
    accreditedStatus: "accredited",
    accreditationVerified: true,
    accreditationVerifiedAt: "2026-04-01T00:00:00Z",
    networkBio:
      "Fixture investor bio long enough to satisfy schema minimum-length validation. Invests in fintech and AI infrastructure across North America and Western Europe.",
    linkedinUrl: "https://www.linkedin.com/in/fixture-investor",
    investsThroughCompany: true,
    investmentEntityName: "Fixture Capital Partners II, L.P.",
    investmentEntityJurisdiction: "CA",
    countryOfTaxResidencyCode: "CA",
    taxIdOrNationalId: "SIN-***-***-921",
    kycDocuments: [
      { name: "passport.pdf",        sizeBytes: 412_201, sha256: "8b4a7e1c0f2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f", uploadedAt: "2026-04-01T08:30:00Z" },
      { name: "address-proof.pdf",   sizeBytes: 218_944, sha256: "1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d", uploadedAt: "2026-04-01T08:32:00Z" },
    ],
    profilePictureName: "fixture-headshot.jpg",
    kycVariant: deriveInvestorKycVariant("CA"),
  },
  network: {
    industryExpertise: ["fintech_digital_payments", "ai_ml", "cybersecurity", "information_technology"],
    chequeSizes: ["100k_250k", "250k_500k", "500k_1m", "1m_5m"],
    geographyFocus: ["home_country", "global"],
    preferredStages: ["seed", "series_a", "series_b"],
    handsOn: ["board_roles", "intros_deal_flow", "portfolio_support"],
    maInterests: ["mergers", "strategic_partnerships", "cross_border_ma"],
    investmentInterests: ["recapitalizations", "secondaries", "joint_ventures_strategic"],
    investmentInterestDescriptions: {
      recapitalizations: "Open to founder-friendly recaps where existing investors take partial liquidity.",
      secondaries: "Will lead secondary purchases of $1M+ in growth-stage companies with 100%+ NRR.",
      joint_ventures_strategic: "Actively introducing portfolio companies to bank partners.",
    },
  },
  visibility: {
    visibleToCoMembers: true,        // fixture: opted in to make co-member visibility testable
    visibleToCollectiveNetwork: false,
    screenNameSet: true,
  },
};
