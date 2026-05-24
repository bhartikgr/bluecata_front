/**
 * Shim layer to expose AdminContact lookups + partner-tier helpers to
 * partnerWorkspaceStore without inducing a circular import. Re-exports
 * the canonical type + constants from adminContactsStore and exposes a
 * `getById` helper plus a `_registerSeedPartner` test-only injector.
 */
import {
  AdminContact,
  PartnerTier,
  PartnerType,
  TIER_RANK,
  TIER_SEAT_LIMITS,
  _testContacts,
} from "./adminContactsStore";

export type { AdminContact, PartnerTier, PartnerType };
export type PartnerSubRole = "managing_partner" | "associate" | "bd" | "analyst" | "viewer";
export { TIER_RANK, TIER_SEAT_LIMITS };

export function getById(contactId: string): AdminContact | null {
  const map = _testContacts.getContacts();
  if (map && map.get) return map.get(contactId) ?? null;
  return null;
}

/**
 * Test/demo-only seed injector. Used by partnerWorkspaceStore.seedTestPartnerSandbox
 * to install a stable-ID consortium_partner record. NEVER called in production
 * (the caller gates on DEMO_SEED_ENABLED).
 */
export function _registerSeedPartner(args: {
  id: string;
  legalName: string;
  displayName: string;
  email: string;
  region: string;
  regionCode: string;
  tier: PartnerTier;
  partnerType: PartnerType;
}): AdminContact {
  const map = _testContacts.getContacts();
  if (!map) throw new Error("adminContactsStore._testContacts.getContacts() not available");
  if (map.has(args.id)) return map.get(args.id) as AdminContact;
  const now = new Date().toISOString();
  const contact: AdminContact = {
    id: args.id,
    kind: "consortium_partner",
    legalName: args.legalName,
    displayName: args.displayName,
    email: args.email,
    type: "partner_org",
    status: "active",
    verification: "verified",
    hqCity: "Test City",
    hqCountry: "US",
    region: args.region,
    aumMinor: null,
    aumCurrency: "USD",
    checkSizeMinMinor: null,
    checkSizeMaxMinor: null,
    industries: [],
    stages: [],
    companyIds: [],
    partnerWeight: 1,
    partnerSince: now,
    phone: null,
    website: null,
    linkedinUrl: null,
    tags: ["test-sandbox", "seed"],
    notes: "Foundation Build test sandbox partner. Auto-seeded under ENABLE_DEMO_SEED=1 only.",
    createdAt: now,
    updatedAt: now,
    createdBy: "u_system_seed",
    updatedBy: "u_system_seed",
    version: 1,
    prevRevisionHash: "0".repeat(64),
    revisionHash: "0".repeat(64),
    tier: args.tier,
    tierSince: now,
    foundingMember: false,
    partnerType: args.partnerType,
    regionCode: args.regionCode,
    preferredPayoutCurrency: "USD",
    configJson: null,
    // Patch v5 — mark the TEST PARTNER sandbox row as seed so the
    // production-mode filter in /api/collective/* strips it even if
    // DEMO_SEED_ENABLED was somehow toggled at runtime.
    isSeed: true,
  };
  map.set(args.id, contact);
  return contact;
}
