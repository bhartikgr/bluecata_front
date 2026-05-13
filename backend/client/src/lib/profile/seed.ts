/**
 * Demo seed for the in-memory company + investor profile stores.
 *
 * The shape MUST match production schemas in `./types.ts`. Demo values are
 * realistic so the preview is useful out of the box, but every field is
 * production-shape (no shortcuts).
 */
import type { CompanyProfile, InvestorProfile } from "./types";
import { deriveLegalFields, deriveInvestorKycVariant } from "./types";

const NOW = "2026-05-08T20:00:00Z";

export const SEED_COMPANY_PROFILE: CompanyProfile = {
  id: "co_novapay",
  tenantId: "tnt_capavate_us",
  schemaVersion: "1.0",
  createdAt: "2023-09-12T00:00:00Z",
  updatedAt: NOW,
  contact: {
    companyName: "NovaPay AI",
    companyEmail: "hello@novapay.ai",
    industry: "fintech_digital_payments",
    phoneCountryCode: "US",
    phoneNumber: "+1 415 555 0140",
    companyWebsiteUrl: "https://novapay.ai",
    numberOfEmployees: "11-50",
    dateOfIncorporation: "2023-09-12",
    oneSentenceHeadliner: "Agentic-AI payment routing for cross-border B2B settlements.",
    problemStatement:
      "Cross-border B2B payments today take 3-5 business days, traverse 4-7 correspondent banks, and fail without a clear retry path 2.4% of the time. Finance teams burn 18 hours per week reconciling them.",
    solutionStatement:
      "NovaPay routes B2B payments through agentic-AI orchestrated rails that pick the lowest-cost path in real time. We turn 5-day SWIFT flows into 90-second AI-orchestrated rails with transparent fallback routing.",
    logoDataUrl: null,
  },
  address: {
    street: "548 Market Street",
    unitSuite: "Suite 32341",
    city: "San Francisco",
    stateProvince: "California",
    postalCode: "94104",
    countryCode: "US",
  },
  legal: {
    articlesFileName: "NovaPay-Articles-of-Incorporation.pdf",
    articlesFileSizeBytes: 184_512,
    articlesFileSha256: "ad1f6e1c2b6ce30a1c68b9e8b4c5b2c3a8f6d4e7f1a2b3c4d5e6f7a8b9c0d1e2",
    legalEntityName: "NovaPay AI, Inc.",
    businessNumber: "EIN 88-3924711",
    countryOfIncorporationCode: "US",
    entityType: "us_c_corp",
    isPubliclyTraded: false,
    registeredOfficeAddress: "548 Market Street, Suite 32341, San Francisco, CA 94104, USA",
    ...deriveLegalFields("US"),
  },
  ma: {
    strategicPriorities: ["market_expansion", "tech_acquisition", "customer_distribution"],
    transactionInterests: ["jv_partnership", "minority_investment"],
    partnerTypesSought: ["distribution", "technology", "capital"],
    dealBreakers: ["sale_of_control", "license_core_ip"],

    competitor1Name: "Wise (Business Payments)",
    competitor1WebsiteUrl: "https://wise.com",
    competitor1Differentiator: "Wise is consumer-led with strong brand. We're API-first and AI-native — finance teams pay 41% less in FX spread on the same corridors.",
    competitor2Name: "Airwallex",
    competitor2WebsiteUrl: "https://airwallex.com",
    competitor2Differentiator: "Airwallex bundles payments + cards + spend. We focus narrowly on AI-orchestrated treasury routing with deeper integrations.",
    competitor3Name: "Currencycloud (Visa)",
    competitor3WebsiteUrl: "https://www.currencycloud.com",
    competitor3Differentiator: "Currencycloud is white-label for banks. We sell direct to growth-stage finance teams with a 14-day implementation SLA.",

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
    accountingFirmName: "Kruze Consulting",

    operatingGeographies: ["north_america", "western_europe", "southeast_asia"],
    customerSegments: ["enterprise", "mid_market"],
    hasMfnExclusivity: false,
    hasRevenueConcentration30Pct: false,
    hasChangeOfControlClauses: true,

    maReadinessNarrative:
      "NovaPay is approaching JV-readiness within the next 12 months. We have a regulatory-cleared core product, a recurring revenue base of $1.4M ARR with 142% NRR, and a defensible AI orchestration layer. We are not yet ready for full exit — the team and product roadmap need 18 months more — but we are actively interested in strategic partnerships with global banks or payments networks where our agentic routing layer would unlock new corridors. Our priority is sustainable scale, not a fast exit.",
    uniqueValueProposition:
      "We turn 5-day SWIFT flows into 90-second AI-orchestrated rails. We are the only B2B payments network whose routing engine optimises for total-cost-of-payment in real time across 12 corridors, with a 41% lower FX spread than incumbents and a 14-day implementation SLA.",
  },
};

export const SEED_INVESTOR_PROFILE: InvestorProfile = {
  id: "u_aisha_patel",
  tenantId: "tnt_capavate_us",
  schemaVersion: "1.0",
  createdAt: "2025-10-01T00:00:00Z",
  updatedAt: NOW,
  role: {
    screenName: "GreenwoodCap",
    currentCompanyName: "Greenwood Capital Partners",
    companyCountryCode: "CA",
    currentJobTitle: "Managing Partner",
    companyWebsite: "https://greenwood.capital",
  },
  contact: {
    firstName: "Aisha",
    lastName: "Patel",
    email: "aisha.patel@greenwood.capital",
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
      "Toronto-based VC investing in fintech and AI infrastructure across North America and Western Europe. Lead checks $1M–$3M, follow on later rounds. Founder-friendly, board roles welcome.",
    linkedinUrl: "https://www.linkedin.com/in/aisha-patel-vc",
    investsThroughCompany: true,
    investmentEntityName: "Greenwood Capital Partners II, L.P.",
    investmentEntityJurisdiction: "CA",
    countryOfTaxResidencyCode: "CA",
    taxIdOrNationalId: "SIN-***-***-921",
    kycDocuments: [
      { name: "passport.pdf",        sizeBytes: 412_201, sha256: "8b4a7e1c0f2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f", uploadedAt: "2026-04-01T08:30:00Z" },
      { name: "address-proof.pdf",   sizeBytes: 218_944, sha256: "1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d", uploadedAt: "2026-04-01T08:32:00Z" },
    ],
    profilePictureName: "aisha-headshot.jpg",
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
      joint_ventures_strategic: "Actively introducing portfolio companies to Greenwood's bank partners.",
    },
  },
  visibility: {
    visibleToCoMembers: true,        // demo: opted in to make co-member visibility demoable
    visibleToCollectiveNetwork: false,
    screenNameSet: true,
  },
};
