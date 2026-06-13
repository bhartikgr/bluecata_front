/**
 * server/lib/emptyInvestorProfile.ts — v24.1 Bug E fix.
 *
 * Avi #7 reported: "Investor profile not loading" (infinite skeleton).
 *
 * Root cause (V24_1_ROOTCAUSE.md §Bug E):
 *   GET /api/investors/:id/profile (profileStore.ts:394-399) returned 404 when
 *   the in-memory `investorProfiles` Map had no entry. Investors provisioned at
 *   runtime via invitation redemption (server/lib/userContext.ts) never get an
 *   `investorProfiles` row created, so the authenticated investor's own profile
 *   GET 404'd and the client (investor/Profile.tsx) stayed on an endless
 *   loading skeleton.
 *
 * Fix (this module + profileStore.ts patch):
 *   Synthesise a schema-complete-but-empty InvestorProfile for the
 *   authenticated investor when no row exists yet, then cache/persist it in the
 *   store so subsequent GETs return it without re-synthesis. Mirrors the
 *   existing makeEmptyCompanyProfile() pattern.
 *
 *   No mock data is invented — every string field is the empty string, every
 *   boolean default-false, and every array empty. The page treats an all-empty
 *   profile as a "complete your profile" prompt, which is the same branch it
 *   already uses for a half-filled profile.
 *
 * Math-sacred contract:
 *   This module touches NO cap-table math. It exclusively shapes the investor
 *   onboarding profile.
 */
import {
  deriveInvestorKycVariant,
  type InvestorProfile,
} from "../../client/src/lib/profile/types";

/**
 * Build a schema-complete, all-empty InvestorProfile for `id`.
 *
 * @param id        The investor's user id (becomes profile.id — must match the
 *                  authenticated owner so the PATCH ownership guard passes).
 * @param tenantId  Tenant the investor belongs to.
 * @param email     Read-only email (set at invitation redemption). May be "".
 */
export function makeEmptyInvestorProfile(
  id: string,
  tenantId: string,
  email: string,
): InvestorProfile {
  const now = new Date().toISOString();
  // Default jurisdiction "US" only drives the DERIVED kyc variant; the investor
  // overwrites it on Step 2 via the PATCH path (deriveInvestorKycVariant).
  const defaultCountry = "US";
  return {
    id,
    tenantId,
    schemaVersion: "1.0",
    createdAt: now,
    updatedAt: now,
    role: {
      screenName: null,
      currentCompanyName: "",
      companyCountryCode: "",
      currentJobTitle: "",
      companyWebsite: "",
    },
    contact: {
      firstName: "",
      lastName: "",
      email: email ?? "",
      countryCode: "",
      stateProvince: "",
      city: "",
      mobileCountryCode: "",
      mobileNumber: "",
    },
    profile: {
      investorType: null,
      accreditedStatus: null,
      accreditationVerified: false,
      accreditationVerifiedAt: null,
      networkBio: "",
      linkedinUrl: "",
      investsThroughCompany: false,
      investmentEntityName: null,
      investmentEntityJurisdiction: null,
      countryOfTaxResidencyCode: "",
      taxIdOrNationalId: "",
      kycDocuments: [],
      profilePictureName: null,
      kycVariant: deriveInvestorKycVariant(defaultCountry),
    },
    network: {
      industryExpertise: [],
      chequeSizes: [],
      geographyFocus: [],
      preferredStages: [],
      handsOn: [],
      maInterests: [],
      investmentInterests: [],
      investmentInterestDescriptions: {},
    },
    visibility: {
      visibleToCoMembers: false,
      visibleToCollectiveNetwork: false,
      screenNameSet: false,
    },
  };
}
