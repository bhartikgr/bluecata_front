/**
 * server/lib/emptyCompanyProfile.ts — Avi 22-May Issue 1 fix.
 *
 * Avi reported: "Company Profile page — there is a loading error" in his
 * production deployment.
 *
 * Root cause (diagnosed against avi_v19_tree):
 *   The GET /api/companies/:id/profile endpoint (profileStore.ts) returned
 *   404 when the in-memory `companyProfiles` Map had no entry AND the legacy
 *   companyProfileStore had no entry either. The client's `client/src/pages/
 *   founder/Company.tsx` issues `useQuery<CompanyProfile>` against that
 *   endpoint; queryClient's `getQueryFn` translates non-2xx to `null`, and
 *   the page's render guard (`isLoading || !profile`) then stays on
 *   "Loading company profile…" forever — exactly Avi's symptom.
 *
 *   The same path triggers for ANY freshly-signed-up founder (who hasn't
 *   completed the wizard) and for any company created via the founder New
 *   Company flow (`POST /api/founder/companies/new` does NOT seed a profile
 *   row).
 *
 * Fix (this module + profileStore.ts patch):
 *   Synthesise a schema-complete-but-empty CompanyProfile object whose
 *   fields default to the values the 4-step wizard would render at "step 1
 *   not yet filled in". The shape is BYTE-COMPATIBLE with the zod schema
 *   in client/src/lib/profile/types.ts so the page's render code does not
 *   need to learn a separate "no profile yet" branch.
 *
 *   The legal-entity step's derived fields are populated from a sensible
 *   default jurisdiction ("US"); when the founder picks a country in
 *   Step 3 the PATCH path will overwrite them via `deriveLegalFields()`.
 *
 *   No mock data is invented — every string field is the empty string and
 *   every boolean is false. The page treats an all-empty profile as a
 *   "complete the wizard" prompt (already the behavior for a half-filled
 *   profile).
 *
 * Math-sacred contract:
 *   This module touches NO cap-table math. It exclusively shapes the
 *   founder onboarding profile.
 */

import type {
  CompanyProfile,
  CompanyContactInfo,
  CompanyMailingAddress,
  CompanyLegalEntity,
  CompanyMAIntelligence,
} from "../../client/src/lib/profile/types";
import { deriveLegalFields } from "../../client/src/lib/profile/types";

function emptyContact(): CompanyContactInfo {
  return {
    companyName: "",
    companyEmail: "",
    industry: null,
    phoneCountryCode: "",
    phoneNumber: "",
    companyWebsiteUrl: "",
    numberOfEmployees: null,
    dateOfIncorporation: "",
    oneSentenceHeadliner: "",
    problemStatement: "",
    solutionStatement: "",
    logoDataUrl: null,
  };
}

function emptyAddress(): CompanyMailingAddress {
  return {
    street: "",
    unitSuite: null,
    city: "",
    stateProvince: "",
    postalCode: "",
    countryCode: "",
  };
}

function emptyLegal(): CompanyLegalEntity {
  // Default jurisdiction: US. Founder overwrites via Step 3 country picker.
  const derived = deriveLegalFields("US");
  return {
    articlesFileName: null,
    articlesFileSizeBytes: null,
    articlesFileSha256: null,
    legalEntityName: "",
    businessNumber: "",
    countryOfIncorporationCode: "US",
    entityType: null,
    isPubliclyTraded: false,
    registeredOfficeAddress: "",
    ...derived,
  };
}

function emptyMa(): CompanyMAIntelligence {
  return {
    strategicPriorities: [],
    transactionInterests: [],
    partnerTypesSought: [],
    dealBreakers: [],
    competitor1Name: "",
    competitor1WebsiteUrl: "",
    competitor1Differentiator: "",
    competitor2Name: "",
    competitor2WebsiteUrl: "",
    competitor2Differentiator: "",
    competitor3Name: "",
    competitor3WebsiteUrl: "",
    competitor3Differentiator: "",
    hasFormalBoard: false,
    hasPendingLitigation: false,
    isRegulatoryCompliant: false,
    hasExternalLegalCounsel: false,
    isFinanciallyAudited: false,
    isSaasRecurring: false,
    holdsMaterialIp: false,
    hasEsgFramework: false,
    hasDeiPolicy: false,
    hasCybersecurityCertification: false,
    accountingFirmName: "",
    operatingGeographies: [],
    customerSegments: [],
    hasMfnExclusivity: false,
    hasRevenueConcentration30Pct: false,
    hasChangeOfControlClauses: false,
    maReadinessNarrative: "",
    uniqueValueProposition: "",
  };
}

/**
 * Build a freshly-empty CompanyProfile for a known company id. The profile
 * is schema-complete (passes companyProfilePatchSchema's zod parse) but
 * every field is its empty default — the page renders the wizard's Step 1
 * with no pre-filled data.
 *
 * Inputs:
 *   - id: the canonical companies.id (e.g. "co_<hex>")
 *   - tenantId: the canonical tenant id; pass "tenant_co_<id>" for
 *     founder-owned companies, the partner tenant for partner-owned.
 *   - companyName: optional — when present, prefills contact.companyName so
 *     the founder immediately recognises their freshly-created shell.
 */
export function makeEmptyCompanyProfile(args: {
  id: string;
  tenantId: string;
  companyName?: string;
}): CompanyProfile {
  const now = new Date().toISOString();
  const contact = emptyContact();
  if (args.companyName) contact.companyName = args.companyName;
  return {
    id: args.id,
    tenantId: args.tenantId,
    schemaVersion: "1.0",
    createdAt: now,
    updatedAt: now,
    contact,
    address: emptyAddress(),
    legal: emptyLegal(),
    ma: emptyMa(),
  };
}
