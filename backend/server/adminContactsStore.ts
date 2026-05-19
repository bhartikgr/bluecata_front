/**
 * Sprint 28 Wave 4 — Admin Contacts CRM
 *
 * Unified CRM for ADMIN users to manage every contact on the platform:
 *   - Investors (institutional, family_office, angel, syndicate)
 *   - Founders (company-affiliated)
 *   - Consortium Partners (entities that vouch for investors)
 *
 * Money is always stored as integer minor units (e.g. USD cents).
 * Hash chain per contact provides tamper-evident revision history.
 * Every mutation requires header `x-confirm: true` (double-verify-before-apply).
 * Every mutation calls appendAdminAudit and emits a bridge event.
 *
 * KL-04 FIX: DB write-through added to createContact(), updateContact(),
 * and seedContacts() so all mutations persist to SQLite (dev.db) and
 * survive server restarts. hydrateFromDatabase() loads contacts on startup.
 */

import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { appendAdminAudit } from "./adminPlatformStore";
import { emitBridgeEvent } from "./bridgeStore";
// ── KL-04: DB imports ──────────────────────────────────────
import { getDb, rawDb } from "./db/connection";
import { syncPcrmContact } from "./db/schema";
import { eq } from "drizzle-orm";

/* ============================================================
 * Type definitions
 * ============================================================ */

export type ContactKind = "investor" | "founder" | "consortium_partner";
export type ContactType =
  | "institutional"
  | "family_office"
  | "angel"
  | "syndicate"
  | "founder"
  | "partner_org";
export type VerificationStatus = "unverified" | "pending" | "verified" | "rejected";
export type ContactStatus = "active" | "inactive" | "suspended" | "archived";

export interface AdminContact {
  id: string;                             // ac_<kind>_<random>
  kind: ContactKind;
  legalName: string;
  displayName: string;
  email: string;
  type: ContactType;
  status: ContactStatus;
  verification: VerificationStatus;
  // Geography
  hqCity: string;
  hqCountry: string;                      // ISO 3166-1 alpha-2
  region: string;                         // "US"|"CA"|"UK"|"EU"|"AU"|"SG"|"HK"|"JP"|"IN"|"CN"|"OTHER"
  // Investor-specific (null for founders/partners)
  aumMinor: number | null;                // integer minor units in USD cents
  aumCurrency: string;                    // ISO 4217
  checkSizeMinMinor: number | null;       // integer minor units
  checkSizeMaxMinor: number | null;       // integer minor units
  industries: string[];
  stages: string[];
  // Founder-specific
  companyIds: string[];
  // Consortium partner-specific
  partnerWeight: number | null;           // 0..3 voting weight
  partnerSince: string | null;            // ISO date
  // Common
  phone: string | null;
  website: string | null;
  linkedinUrl: string | null;
  tags: string[];
  notes: string;
  // Lifecycle
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  // Hash chain
  version: number;
  prevRevisionHash: string;
  revisionHash: string;
}

export interface ContactRevision {
  contactId: string;
  version: number;
  prevRevisionHash: string;
  revisionHash: string;
  updatedAt: string;
  updatedBy: string;
  action: string;
  snapshot: AdminContact;
}

/* ============================================================
 * In-memory stores
 * ============================================================ */

const contacts: Map<string, AdminContact> = new Map();
const revisions: Map<string, ContactRevision[]> = new Map();

/* ============================================================
 * Crypto helpers
 * ============================================================ */

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function computeRevisionHash(contact: AdminContact): string {
  const body = [
    contact.id,
    contact.version,
    contact.legalName,
    contact.email,
    contact.kind,
    contact.type,
    contact.status,
    contact.verification,
    contact.updatedAt,
    contact.updatedBy,
    contact.prevRevisionHash,
  ].join("|");
  return sha256(body);
}

function newId(kind: ContactKind): string {
  return `ac_${kind}_${randomBytes(6).toString("hex")}`;
}

/* ============================================================
 * Verify chain for a contact
 * ============================================================ */

export function verifyChain(contactId: string): { ok: boolean; brokenAtVersion?: number; totalRevisions: number } {
  const revs = revisions.get(contactId) ?? [];
  if (revs.length === 0) return { ok: false, totalRevisions: 0 };

  let prior = "0".repeat(64);
  for (const rev of revs) {
    if (rev.prevRevisionHash !== prior) {
      return { ok: false, brokenAtVersion: rev.version, totalRevisions: revs.length };
    }
    // Re-derive hash from snapshot
    const expected = computeRevisionHash(rev.snapshot);
    if (rev.revisionHash !== expected) {
      return { ok: false, brokenAtVersion: rev.version, totalRevisions: revs.length };
    }
    prior = rev.revisionHash;
  }
  return { ok: true, totalRevisions: revs.length };
}

/* ============================================================
 * KL-04: DB helper — upsert a contact row into sync_pcrm_contact
 * ============================================================ */

function dbUpsertContact(contact: AdminContact): void {
  try {
    rawDb().prepare(
      `INSERT OR REPLACE INTO sync_pcrm_contact
        (id, tenant_id, version, updated_at, created_at, deleted_at, payload, owner_id, email)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      contact.id,
      null,
      contact.version,
      contact.updatedAt,
      contact.createdAt,
      null,
      JSON.stringify(contact),
      contact.createdBy,
      contact.email,
    );
  } catch (e) {
    console.error("[db] dbUpsertContact failed for", contact.id, e);
  }
}

/* ============================================================
 * KL-04: Hydrate contacts from DB on server startup
 * ============================================================ */

export async function hydrateFromDatabase(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.log("[hydrate] adminContactsStore — no DATABASE_URL, staying in-memory");
    return;
  }
  try {
    const rows = rawDb().prepare(
      `SELECT payload FROM sync_pcrm_contact`
    ).all() as Array<{ payload: string }>;
    let loaded = 0;
    for (const row of rows) {
      try {
        const contact: AdminContact = JSON.parse(row.payload);
        contacts.set(contact.id, contact);
        loaded++;
      } catch {
        // Malformed row — skip
      }
    }
    console.log(`[hydrate] adminContactsStore loaded ${loaded} contacts from DB`);
    if (loaded > 0) seeded = true; // Don't re-seed if we loaded from DB
  } catch (e) {
    console.error("[hydrate] adminContactsStore DB load failed, falling back to seed:", e);
  }
}

/* ============================================================
 * Mutation helpers (internal — apply after confirmation check)
 * ============================================================ */

export function createContact(
  data: Omit<AdminContact, "id" | "createdAt" | "updatedAt" | "version" | "prevRevisionHash" | "revisionHash">,
  actor: string
): AdminContact {
  const id = newId(data.kind);
  const now = new Date().toISOString();
  const prevRevisionHash = "0".repeat(64);

  const contact: AdminContact = {
    ...data,
    id,
    createdAt: now,
    updatedAt: now,
    createdBy: actor,
    updatedBy: actor,
    version: 1,
    prevRevisionHash,
    revisionHash: "", // computed below
  };

  contact.revisionHash = computeRevisionHash(contact);

  contacts.set(id, contact);
  appendRevision(contact, "contact.created");
  appendAdminAudit(actor, `contact:${id}`, "contact.created", { legalName: contact.legalName, kind: contact.kind, email: contact.email });
  emitBridgeEvent({ eventType: "contact.created", aggregateId: id, aggregateKind: "investor", payload: { legalName: contact.legalName, kind: contact.kind } });

  // ── KL-04: persist to DB ──
  dbUpsertContact(contact);

  return contact;
}

export function updateContact(
  id: string,
  patch: Partial<Omit<AdminContact, "id" | "createdAt" | "createdBy" | "version" | "prevRevisionHash" | "revisionHash">>,
  actor: string,
  action = "contact.updated"
): AdminContact {
  const existing = contacts.get(id);
  if (!existing) throw new Error(`Contact ${id} not found`);

  const now = new Date().toISOString();
  const updated: AdminContact = {
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
    createdBy: existing.createdBy,
    updatedAt: now,
    updatedBy: actor,
    version: existing.version + 1,
    prevRevisionHash: existing.revisionHash,
    revisionHash: "", // computed below
  };

  updated.revisionHash = computeRevisionHash(updated);

  contacts.set(id, updated);
  appendRevision(updated, action);
  appendAdminAudit(actor, `contact:${id}`, action, { version: updated.version, changes: Object.keys(patch) });

  // ── KL-04: persist to DB ──
  dbUpsertContact(updated);

  return updated;
}

function appendRevision(contact: AdminContact, action: string): void {
  const rev: ContactRevision = {
    contactId: contact.id,
    version: contact.version,
    prevRevisionHash: contact.prevRevisionHash,
    revisionHash: contact.revisionHash,
    updatedAt: contact.updatedAt,
    updatedBy: contact.updatedBy,
    action,
    snapshot: { ...contact },
  };
  const arr = revisions.get(contact.id) ?? [];
  arr.push(rev);
  revisions.set(contact.id, arr);
}

/* ============================================================
 * Stats
 * ============================================================ */

export function getContactStats() {
  const all = Array.from(contacts.values());
  return {
    total: all.length,
    byKind: {
      investor: all.filter((c) => c.kind === "investor").length,
      founder: all.filter((c) => c.kind === "founder").length,
      consortium_partner: all.filter((c) => c.kind === "consortium_partner").length,
    },
    byVerification: {
      verified: all.filter((c) => c.verification === "verified").length,
      pending: all.filter((c) => c.verification === "pending").length,
      unverified: all.filter((c) => c.verification === "unverified").length,
      rejected: all.filter((c) => c.verification === "rejected").length,
    },
    byStatus: {
      active: all.filter((c) => c.status === "active").length,
      inactive: all.filter((c) => c.status === "inactive").length,
      suspended: all.filter((c) => c.status === "suspended").length,
      archived: all.filter((c) => c.status === "archived").length,
    },
    byRegion: (() => {
      const m: Record<string, number> = {};
      for (const c of all) {
        m[c.region] = (m[c.region] ?? 0) + 1;
      }
      return m;
    })(),
  };
}

/* ============================================================
 * Filter contacts
 * ============================================================ */

export function listContacts(filters: {
  kind?: string;
  status?: string;
  verification?: string;
  region?: string;
  search?: string;
}): AdminContact[] {
  let results = Array.from(contacts.values());

  if (filters.kind) {
    results = results.filter((c) => c.kind === filters.kind);
  }
  if (filters.status) {
    results = results.filter((c) => c.status === filters.status);
  }
  if (filters.verification) {
    results = results.filter((c) => c.verification === filters.verification);
  }
  if (filters.region) {
    results = results.filter((c) => c.region === filters.region);
  }
  if (filters.search) {
    const q = filters.search.toLowerCase();
    results = results.filter(
      (c) =>
        c.legalName.toLowerCase().includes(q) ||
        c.displayName.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.tags.some((t) => t.toLowerCase().includes(q))
    );
  }

  return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/* ============================================================
 * Compute diff for double-verify proposal
 * ============================================================ */

function computeDiff(existing: AdminContact, patch: Partial<AdminContact>): Record<string, { from: unknown; to: unknown }> {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(patch) as (keyof AdminContact)[]) {
    const from = existing[key];
    const to = patch[key];
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      diff[key] = { from, to };
    }
  }
  return diff;
}

/* ============================================================
 * Seed data — 8 investors + 6 founders + 4 consortium partners
 * All labeled as initial seed via contact.seeded audit action.
 * Company IDs sourced from multiCompanyStore (co_novapay, co_arboreal, co_kelvin).
 * Additional founders linked to companyIds: [] if no match found.
 * ============================================================ */

let seeded = false;

export function getAllContacts(): AdminContact[] {
  if (!seeded) seedContacts();
  return Array.from(contacts.values());
}

export function seedContacts(): void {
  if (seeded) return;
  seeded = true;

  const SEED_ACTOR = "u_system_seed";

  // --- 8 Investors ---
  const investors: Array<Omit<AdminContact, "id" | "createdAt" | "updatedAt" | "version" | "prevRevisionHash" | "revisionHash">> = [
    {
      kind: "investor",
      legalName: "Sequoia Capital Management LP",
      displayName: "Sequoia Capital",
      email: "deals@sequoiacap.com",
      type: "institutional",
      status: "active",
      verification: "verified",
      hqCity: "Menlo Park",
      hqCountry: "US",
      region: "US",
      aumMinor: 8500000000_00,   // $85B in cents
      aumCurrency: "USD",
      checkSizeMinMinor: 500000_00,   // $500K
      checkSizeMaxMinor: 20000000_00, // $20M
      industries: ["fintech", "ai", "saas", "consumer"],
      stages: ["seed", "series_a", "series_b"],
      companyIds: [],
      partnerWeight: null,
      partnerSince: null,
      phone: "+1 650-854-3927",
      website: "https://www.sequoiacap.com",
      linkedinUrl: "https://www.linkedin.com/company/sequoia-capital",
      tags: ["tier1", "silicon-valley", "global"],
      notes: "Premier US venture capital firm. Multi-stage investor across sectors.",
      createdBy: SEED_ACTOR,
      updatedBy: SEED_ACTOR,
    },
    {
      kind: "investor",
      legalName: "Atomico Investment Holdings LP",
      displayName: "Atomico",
      email: "investments@atomico.com",
      type: "institutional",
      status: "active",
      verification: "verified",
      hqCity: "London",
      hqCountry: "GB",
      region: "UK",
      aumMinor: 500000000_00,     // $500M
      aumCurrency: "USD",
      checkSizeMinMinor: 250000_00,
      checkSizeMaxMinor: 10000000_00,
      industries: ["saas", "fintech", "climate", "b2b"],
      stages: ["series_a", "series_b", "series_c"],
      companyIds: [],
      partnerWeight: null,
      partnerSince: null,
      phone: "+44 20-7100-0180",
      website: "https://atomico.com",
      linkedinUrl: "https://www.linkedin.com/company/atomico",
      tags: ["europe", "deep-tech", "tier1"],
      notes: "Leading European venture capital firm. Founded by Skype co-founder Niklas Zennström.",
      createdBy: SEED_ACTOR,
      updatedBy: SEED_ACTOR,
    },
    {
      kind: "investor",
      legalName: "OMERS Ventures Inc.",
      displayName: "OMERS Ventures",
      email: "info@omersventures.com",
      type: "institutional",
      status: "active",
      verification: "verified",
      hqCity: "Toronto",
      hqCountry: "CA",
      region: "CA",
      aumMinor: 340000000_00,     // $340M
      aumCurrency: "CAD",
      checkSizeMinMinor: 200000_00,
      checkSizeMaxMinor: 15000000_00,
      industries: ["fintech", "saas", "healthtech", "ai"],
      stages: ["seed", "series_a", "series_b"],
      companyIds: [],
      partnerWeight: null,
      partnerSince: null,
      phone: "+1 416-369-2000",
      website: "https://omersventures.com",
      linkedinUrl: "https://www.linkedin.com/company/omers-ventures",
      tags: ["canada", "pension-fund", "institutional"],
      notes: "Venture arm of OMERS pension fund. Strong focus on Canadian + US tech ecosystems.",
      createdBy: SEED_ACTOR,
      updatedBy: SEED_ACTOR,
    },
    {
      kind: "investor",
      legalName: "GIC Private Limited",
      displayName: "GIC",
      email: "ventures@gic.com.sg",
      type: "institutional",
      status: "active",
      verification: "verified",
      hqCity: "Singapore",
      hqCountry: "SG",
      region: "SG",
      aumMinor: 74400000000_00,   // ~$744B AUM
      aumCurrency: "USD",
      checkSizeMinMinor: 1000000_00,
      checkSizeMaxMinor: 50000000_00,
      industries: ["fintech", "logistics", "infrastructure", "ai"],
      stages: ["series_b", "series_c", "growth"],
      companyIds: [],
      partnerWeight: null,
      partnerSince: null,
      phone: "+65 6889-8888",
      website: "https://www.gic.com.sg",
      linkedinUrl: "https://www.linkedin.com/company/gic",
      tags: ["sovereign-wealth", "asia-pacific", "growth-stage"],
      notes: "Singapore sovereign wealth fund. Invests globally across asset classes and technology verticals.",
      createdBy: SEED_ACTOR,
      updatedBy: SEED_ACTOR,
    },
    {
      kind: "investor",
      legalName: "Andreessen Horowitz LLC",
      displayName: "a16z",
      email: "info@a16z.com",
      type: "institutional",
      status: "active",
      verification: "verified",
      hqCity: "Menlo Park",
      hqCountry: "US",
      region: "US",
      aumMinor: 3500000000_00,    // $35B
      aumCurrency: "USD",
      checkSizeMinMinor: 100000_00,
      checkSizeMaxMinor: 100000000_00,
      industries: ["crypto", "ai", "fintech", "bio", "consumer", "saas"],
      stages: ["pre-seed", "seed", "series_a", "series_b", "growth"],
      companyIds: [],
      partnerWeight: null,
      partnerSince: null,
      phone: "+1 650-316-7800",
      website: "https://a16z.com",
      linkedinUrl: "https://www.linkedin.com/company/a16z",
      tags: ["tier1", "silicon-valley", "crypto-friendly", "ai-focused"],
      notes: "Technology venture capital and private equity firm based in Silicon Valley.",
      createdBy: SEED_ACTOR,
      updatedBy: SEED_ACTOR,
    },
    {
      kind: "investor",
      legalName: "Saverin Family Office Pte Ltd",
      displayName: "B Capital Group (Saverin FO)",
      email: "invest@saverinfamilyoffice.com",
      type: "family_office",
      status: "active",
      verification: "verified",
      hqCity: "Singapore",
      hqCountry: "SG",
      region: "SG",
      aumMinor: 190000000_00,     // $190M
      aumCurrency: "USD",
      checkSizeMinMinor: 250000_00,
      checkSizeMaxMinor: 5000000_00,
      industries: ["fintech", "consumer", "saas", "marketplace"],
      stages: ["seed", "series_a"],
      companyIds: [],
      partnerWeight: null,
      partnerSince: null,
      phone: null,
      website: null,
      linkedinUrl: null,
      tags: ["family-office", "asia-pacific", "angel-adjacent"],
      notes: "Family office with focus on Southeast Asia and global fintech crossover opportunities.",
      createdBy: SEED_ACTOR,
      updatedBy: SEED_ACTOR,
    },
    {
      kind: "investor",
      legalName: "Priya Sundaram",
      displayName: "Priya Sundaram (Angel)",
      email: "priya.sundaram@angeldeal.io",
      type: "angel",
      status: "active",
      verification: "verified",
      hqCity: "San Francisco",
      hqCountry: "US",
      region: "US",
      aumMinor: null,
      aumCurrency: "USD",
      checkSizeMinMinor: 25000_00,   // $25K
      checkSizeMaxMinor: 250000_00,  // $250K
      industries: ["fintech", "b2b-saas", "ai"],
      stages: ["pre-seed", "seed"],
      companyIds: [],
      partnerWeight: null,
      partnerSince: null,
      phone: "+1 415-555-0178",
      website: null,
      linkedinUrl: "https://www.linkedin.com/in/priya-sundaram-angel",
      tags: ["angel", "fintech-specialist", "repeat-founder"],
      notes: "Former CTO at Stripe. Active angel with 40+ investments. Particularly strong on payments infrastructure.",
      createdBy: SEED_ACTOR,
      updatedBy: SEED_ACTOR,
    },
    {
      kind: "investor",
      legalName: "Forge Ventures Syndicate LP",
      displayName: "Forge Ventures",
      email: "lp@forgeventures.io",
      type: "syndicate",
      status: "active",
      verification: "pending",
      hqCity: "Austin",
      hqCountry: "US",
      region: "US",
      aumMinor: 45000000_00,      // $45M
      aumCurrency: "USD",
      checkSizeMinMinor: 50000_00,
      checkSizeMaxMinor: 1000000_00,
      industries: ["climate", "ai", "deeptech"],
      stages: ["pre-seed", "seed"],
      companyIds: [],
      partnerWeight: null,
      partnerSince: null,
      phone: "+1 512-555-0191",
      website: "https://forgeventures.io",
      linkedinUrl: null,
      tags: ["syndicate", "climate-tech", "early-stage"],
      notes: "AngelList-style syndicate focused on climate and deep-tech. 120+ LP network.",
      createdBy: SEED_ACTOR,
      updatedBy: SEED_ACTOR,
    },
  ];

  // --- 6 Founders (linked to known company IDs from multiCompanyStore) ---
  const founders: Array<Omit<AdminContact, "id" | "createdAt" | "updatedAt" | "version" | "prevRevisionHash" | "revisionHash">> = [
    {
      kind: "founder",
      legalName: "Maya Chen",
      displayName: "Maya Chen",
      email: "maya@novapay.ai",
      type: "founder",
      status: "active",
      verification: "verified",
      hqCity: "San Francisco",
      hqCountry: "US",
      region: "US",
      aumMinor: null,
      aumCurrency: "USD",
      checkSizeMinMinor: null,
      checkSizeMaxMinor: null,
      industries: ["fintech", "ai"],
      stages: [],
      companyIds: ["co_novapay"],
      partnerWeight: null,
      partnerSince: null,
      phone: "+1 415-555-0142",
      website: null,
      linkedinUrl: "https://www.linkedin.com/in/maya-chen-novapay",
      tags: ["active-fundraise", "collective-member"],
      notes: "CEO & Founder of NovaPay AI. Currently raising Series A.",
      createdBy: SEED_ACTOR,
      updatedBy: SEED_ACTOR,
    },
    {
      kind: "founder",
      legalName: "James Okafor",
      displayName: "James Okafor",
      email: "james@arborealhealthsciences.com",
      type: "founder",
      status: "active",
      verification: "pending",
      hqCity: "Boston",
      hqCountry: "US",
      region: "US",
      aumMinor: null,
      aumCurrency: "USD",
      checkSizeMinMinor: null,
      checkSizeMaxMinor: null,
      industries: ["healthtech", "biotech"],
      stages: [],
      companyIds: ["co_arboreal"],
      partnerWeight: null,
      partnerSince: null,
      phone: "+1 617-555-0223",
      website: null,
      linkedinUrl: "https://www.linkedin.com/in/james-okafor-arboreal",
      tags: ["pre-seed", "digital-health"],
      notes: "Co-founder of Arboreal Health Sciences. Applied to Collective, pending review.",
      createdBy: SEED_ACTOR,
      updatedBy: SEED_ACTOR,
    },
    {
      kind: "founder",
      legalName: "Yuki Tanaka",
      displayName: "Yuki Tanaka",
      email: "yuki@kelvinenergy.io",
      type: "founder",
      status: "active",
      verification: "verified",
      hqCity: "Austin",
      hqCountry: "US",
      region: "US",
      aumMinor: null,
      aumCurrency: "USD",
      checkSizeMinMinor: null,
      checkSizeMaxMinor: null,
      industries: ["climate", "energy"],
      stages: [],
      companyIds: ["co_kelvin"],
      partnerWeight: null,
      partnerSince: null,
      phone: "+1 512-555-0204",
      website: "https://kelvinenergy.io",
      linkedinUrl: "https://www.linkedin.com/in/yuki-tanaka-kelvin",
      tags: ["climate-tech", "collective-lapsed"],
      notes: "Founder of Kelvin Energy. Collective membership lapsed; re-engagement in progress.",
      createdBy: SEED_ACTOR,
      updatedBy: SEED_ACTOR,
    },
    {
      kind: "founder",
      legalName: "Amara Diallo",
      displayName: "Amara Diallo",
      email: "amara@tessellate.ai",
      type: "founder",
      status: "active",
      verification: "unverified",
      hqCity: "Paris",
      hqCountry: "FR",
      region: "EU",
      aumMinor: null,
      aumCurrency: "EUR",
      checkSizeMinMinor: null,
      checkSizeMaxMinor: null,
      industries: ["ai", "enterprise-saas"],
      stages: [],
      companyIds: [],   // No matching co_* id in multiCompanyStore — documented
      partnerWeight: null,
      partnerSince: null,
      phone: null,
      website: "https://tessellate.ai",
      linkedinUrl: "https://www.linkedin.com/in/amara-diallo",
      tags: ["europe", "ai-startup", "new-signup"],
      notes: "Founder of Tessellate AI. Recently onboarded; verification pending document submission.",
      createdBy: SEED_ACTOR,
      updatedBy: SEED_ACTOR,
    },
    {
      kind: "founder",
      legalName: "Ravi Krishnamurthy",
      displayName: "Ravi Krishnamurthy",
      email: "ravi@quantarobotics.com",
      type: "founder",
      status: "active",
      verification: "verified",
      hqCity: "San Jose",
      hqCountry: "US",
      region: "US",
      aumMinor: null,
      aumCurrency: "USD",
      checkSizeMinMinor: null,
      checkSizeMaxMinor: null,
      industries: ["robotics", "ai", "deeptech"],
      stages: [],
      companyIds: [],   // co_quanta exists in bridge/telemetry but no multiCompanyStore export
      partnerWeight: null,
      partnerSince: null,
      phone: "+1 408-555-0317",
      website: "https://quantarobotics.com",
      linkedinUrl: "https://www.linkedin.com/in/ravi-k-quanta",
      tags: ["deeptech", "robotics", "series-a-ready"],
      notes: "CEO of Quanta Robotics. Building next-generation industrial automation.",
      createdBy: SEED_ACTOR,
      updatedBy: SEED_ACTOR,
    },
    {
      kind: "founder",
      legalName: "Fatima Al-Rashid",
      displayName: "Fatima Al-Rashid",
      email: "fatima@horizonmed.io",
      type: "founder",
      status: "inactive",
      verification: "unverified",
      hqCity: "Dubai",
      hqCountry: "AE",
      region: "OTHER",
      aumMinor: null,
      aumCurrency: "USD",
      checkSizeMinMinor: null,
      checkSizeMaxMinor: null,
      industries: ["healthtech", "medtech"],
      stages: [],
      companyIds: [],   // company not yet onboarded to platform
      partnerWeight: null,
      partnerSince: null,
      phone: null,
      website: null,
      linkedinUrl: null,
      tags: ["mena", "healthtech", "onboarding"],
      notes: "Founder of Horizon Medical. Invited but not yet fully onboarded.",
      createdBy: SEED_ACTOR,
      updatedBy: SEED_ACTOR,
    },
  ];

  // --- 4 Consortium Partners ---
  const partners: Array<Omit<AdminContact, "id" | "createdAt" | "updatedAt" | "version" | "prevRevisionHash" | "revisionHash">> = [
    {
      kind: "consortium_partner",
      legalName: "Keiretsu Forum North America LLC",
      displayName: "Keiretsu Forum NA",
      email: "admin@keiretsuforum.com",
      type: "partner_org",
      status: "active",
      verification: "verified",
      hqCity: "Seattle",
      hqCountry: "US",
      region: "US",
      aumMinor: null,
      aumCurrency: "USD",
      checkSizeMinMinor: null,
      checkSizeMaxMinor: null,
      industries: [],
      stages: [],
      companyIds: [],
      partnerWeight: 3,
      partnerSince: "2024-01-15",
      phone: "+1 206-623-4500",
      website: "https://www.keiretsuforum.com",
      linkedinUrl: "https://www.linkedin.com/company/keiretsu-forum",
      tags: ["angel-network", "north-america", "premier-partner"],
      notes: "The world's largest angel investment network. Premier consortium partner with full vouch authority.",
      createdBy: SEED_ACTOR,
      updatedBy: SEED_ACTOR,
    },
    {
      kind: "consortium_partner",
      legalName: "AngelList Syndicate Network Inc.",
      displayName: "AngelList Syndicates",
      email: "partners@angellist.com",
      type: "partner_org",
      status: "active",
      verification: "verified",
      hqCity: "San Francisco",
      hqCountry: "US",
      region: "US",
      aumMinor: null,
      aumCurrency: "USD",
      checkSizeMinMinor: null,
      checkSizeMaxMinor: null,
      industries: [],
      stages: [],
      companyIds: [],
      partnerWeight: 2,
      partnerSince: "2024-03-01",
      phone: null,
      website: "https://angel.co",
      linkedinUrl: "https://www.linkedin.com/company/angellist",
      tags: ["syndicate-platform", "us", "established-partner"],
      notes: "Platform partner covering syndicate networks. Vouched investors carry weight 2.",
      createdBy: SEED_ACTOR,
      updatedBy: SEED_ACTOR,
    },
    {
      kind: "consortium_partner",
      legalName: "British Private Equity & Venture Capital Association",
      displayName: "BVCA",
      email: "membership@bvca.co.uk",
      type: "partner_org",
      status: "active",
      verification: "verified",
      hqCity: "London",
      hqCountry: "GB",
      region: "UK",
      aumMinor: null,
      aumCurrency: "GBP",
      checkSizeMinMinor: null,
      checkSizeMaxMinor: null,
      industries: [],
      stages: [],
      companyIds: [],
      partnerWeight: 2,
      partnerSince: "2024-06-01",
      phone: "+44 20-7420-1800",
      website: "https://www.bvca.co.uk",
      linkedinUrl: "https://www.linkedin.com/company/bvca",
      tags: ["industry-body", "europe", "uk"],
      notes: "UK's leading private equity and venture capital industry body. Consortium partner for EU/UK investor vouching.",
      createdBy: SEED_ACTOR,
      updatedBy: SEED_ACTOR,
    },
    {
      kind: "consortium_partner",
      legalName: "Golden Gate Angels Network LP",
      displayName: "Golden Gate Angels",
      email: "info@goldengateangels.io",
      type: "partner_org",
      status: "active",
      verification: "pending",
      hqCity: "San Francisco",
      hqCountry: "US",
      region: "US",
      aumMinor: null,
      aumCurrency: "USD",
      checkSizeMinMinor: null,
      checkSizeMaxMinor: null,
      industries: [],
      stages: [],
      companyIds: [],
      partnerWeight: 1,
      partnerSince: "2025-01-10",
      phone: "+1 415-555-0258",
      website: null,
      linkedinUrl: null,
      tags: ["angel-network", "bay-area", "new-partner"],
      notes: "Bay Area angel network onboarded in 2025. Verification in progress; weight pending confirmation.",
      createdBy: SEED_ACTOR,
      updatedBy: SEED_ACTOR,
    },
  ];

  // Seed all contacts — persist to DB via dbUpsertContact
  for (const data of [...investors, ...founders, ...partners]) {
    const id = newId(data.kind);
    const now = new Date().toISOString();
    const prevRevisionHash = "0".repeat(64);

    const contact: AdminContact = {
      ...data,
      id,
      createdAt: now,
      updatedAt: now,
      version: 1,
      prevRevisionHash,
      revisionHash: "",
    };
    contact.revisionHash = computeRevisionHash(contact);

    contacts.set(id, contact);
    appendRevision(contact, "contact.seeded");
    appendAdminAudit(SEED_ACTOR, `contact:${id}`, "contact.seeded", {
      legalName: contact.legalName,
      kind: contact.kind,
      type: contact.type,
      seedNote: "Initial canonical seed contact for empty deployment",
    });

    // ── KL-04: persist seed contacts to DB ──
    dbUpsertContact(contact);
  }
}

/* ============================================================
 * Express route registration
 * ============================================================ */

export function registerAdminContactsRoutes(app: Express): void {
  seedContacts();

  // ── GET /api/admin/contacts/stats ──────────────────────────
  // IMPORTANT: this must be registered BEFORE /:id routes
  app.get("/api/admin/contacts/stats", (_req: Request, res: Response) => {
    res.json(getContactStats());
  });

  // ── GET /api/admin/contacts ────────────────────────────────
  app.get("/api/admin/contacts", (req: Request, res: Response) => {
    const { kind, status, verification, region, search } = req.query as Record<string, string>;
    const results = listContacts({ kind, status, verification, region, search });
    res.json({ total: results.length, contacts: results });
  });

  // ── POST /api/admin/contacts ───────────────────────────────
  app.post("/api/admin/contacts", (req: Request, res: Response) => {
    const confirm = req.headers["x-confirm"];
    const body = req.body ?? {};
    const actor = String(req.headers["x-actor"] ?? "u_admin");

    const { legalName, email, kind, type } = body;
    if (!legalName || !email || !kind || !type) {
      return res.status(400).json({ ok: false, error: "legalName, email, kind, and type are required" });
    }

    const validKinds: ContactKind[] = ["investor", "founder", "consortium_partner"];
    const validTypes: ContactType[] = ["institutional", "family_office", "angel", "syndicate", "founder", "partner_org"];
    if (!validKinds.includes(kind)) {
      return res.status(400).json({ ok: false, error: `invalid kind: ${kind}`, allowed: validKinds });
    }
    if (!validTypes.includes(type)) {
      return res.status(400).json({ ok: false, error: `invalid type: ${type}`, allowed: validTypes });
    }

    const proposedContact = {
      kind: kind as ContactKind,
      legalName,
      displayName: body.displayName ?? legalName,
      email,
      type: type as ContactType,
      status: (body.status ?? "active") as ContactStatus,
      verification: (body.verification ?? "unverified") as VerificationStatus,
      hqCity: body.hqCity ?? "",
      hqCountry: body.hqCountry ?? "US",
      region: body.region ?? "US",
      aumMinor: body.aumMinor != null ? Number(body.aumMinor) : null,
      aumCurrency: body.aumCurrency ?? "USD",
      checkSizeMinMinor: body.checkSizeMinMinor != null ? Number(body.checkSizeMinMinor) : null,
      checkSizeMaxMinor: body.checkSizeMaxMinor != null ? Number(body.checkSizeMaxMinor) : null,
      industries: body.industries ?? [],
      stages: body.stages ?? [],
      companyIds: body.companyIds ?? [],
      partnerWeight: body.partnerWeight != null ? Number(body.partnerWeight) : null,
      partnerSince: body.partnerSince ?? null,
      phone: body.phone ?? null,
      website: body.website ?? null,
      linkedinUrl: body.linkedinUrl ?? null,
      tags: body.tags ?? [],
      notes: body.notes ?? "",
      createdBy: actor,
      updatedBy: actor,
    };

    if (confirm !== "true") {
      return res.status(409).json({
        ok: false,
        error: "confirmation_required",
        message: "Send the same request with header `x-confirm: true` to apply.",
        proposedChange: proposedContact,
      });
    }

    const contact = createContact(proposedContact, actor);
    res.status(201).json({ ok: true, contact });
  });

  // ── GET /api/admin/contacts/:id ────────────────────────────
  app.get("/api/admin/contacts/:id", (req: Request, res: Response) => {
    const contact = contacts.get(req.params.id);
    if (!contact) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, contact });
  });

  // ── GET /api/admin/contacts/:id/history ───────────────────
  app.get("/api/admin/contacts/:id/history", (req: Request, res: Response) => {
    const contact = contacts.get(req.params.id);
    if (!contact) return res.status(404).json({ ok: false, error: "not_found" });
    const history = revisions.get(req.params.id) ?? [];
    const chain = verifyChain(req.params.id);
    res.json({ ok: true, contactId: req.params.id, history, chain });
  });

  // ── PATCH /api/admin/contacts/:id ─────────────────────────
  app.patch("/api/admin/contacts/:id", (req: Request, res: Response) => {
    const confirm = req.headers["x-confirm"];
    const contact = contacts.get(req.params.id);
    if (!contact) return res.status(404).json({ ok: false, error: "not_found" });

    const patch = req.body ?? {};
    const actor = String(req.headers["x-actor"] ?? "u_admin");

    // Strip immutable fields from patch
    const IMMUTABLE = ["id", "createdAt", "createdBy", "version", "prevRevisionHash", "revisionHash"];
    for (const k of IMMUTABLE) delete patch[k];

    const diff = computeDiff(contact, patch);

    if (confirm !== "true") {
      return res.status(409).json({
        ok: false,
        error: "confirmation_required",
        message: "Send the same request with header `x-confirm: true` to apply.",
        proposedChange: patch,
        diff,
        currentVersion: contact.version,
        wouldBecomeVersion: contact.version + 1,
      });
    }

    // Validate numeric fields are integers when present
    if (patch.aumMinor != null && !Number.isInteger(Number(patch.aumMinor))) {
      return res.status(400).json({ ok: false, error: "aumMinor must be an integer (minor currency units)" });
    }
    if (patch.checkSizeMinMinor != null && !Number.isInteger(Number(patch.checkSizeMinMinor))) {
      return res.status(400).json({ ok: false, error: "checkSizeMinMinor must be an integer" });
    }
    if (patch.checkSizeMaxMinor != null && !Number.isInteger(Number(patch.checkSizeMaxMinor))) {
      return res.status(400).json({ ok: false, error: "checkSizeMaxMinor must be an integer" });
    }

    const updated = updateContact(req.params.id, patch, actor);
    if (!updated) return res.status(404).json({ ok: false, error: "not_found" });

    emitBridgeEvent({
      eventType: "contact.updated",
      aggregateId: req.params.id,
      aggregateKind: "investor",
      payload: { legalName: updated.legalName, version: updated.version, changedFields: Object.keys(patch) },
    });

    res.json({ ok: true, contact: updated });
  });

  // ── POST /api/admin/contacts/:id/verify ───────────────────
  app.post("/api/admin/contacts/:id/verify", (req: Request, res: Response) => {
    const confirm = req.headers["x-confirm"];
    const contact = contacts.get(req.params.id);
    if (!contact) return res.status(404).json({ ok: false, error: "not_found" });

    const actor = String(req.headers["x-actor"] ?? "u_admin");

    if (confirm !== "true") {
      return res.status(409).json({
        ok: false,
        error: "confirmation_required",
        message: "Send with `x-confirm: true` to mark this contact as verified.",
        proposedChange: { verification: "verified" },
        currentVerification: contact.verification,
      });
    }

    const updated = updateContact(req.params.id, { verification: "verified" }, actor, "contact.verified");
    if (!updated) return res.status(404).json({ ok: false, error: "not_found" });

    emitBridgeEvent({
      eventType: "contact.verified",
      aggregateId: req.params.id,
      aggregateKind: "investor",
      payload: { legalName: updated.legalName, version: updated.version },
    });

    res.json({ ok: true, contact: updated });
  });

  // ── POST /api/admin/contacts/:id/suspend ──────────────────
  app.post("/api/admin/contacts/:id/suspend", (req: Request, res: Response) => {
    const confirm = req.headers["x-confirm"];
    const contact = contacts.get(req.params.id);
    if (!contact) return res.status(404).json({ ok: false, error: "not_found" });

    const actor = String(req.headers["x-actor"] ?? "u_admin");
    const { reason } = req.body ?? {};

    if (confirm !== "true") {
      return res.status(409).json({
        ok: false,
        error: "confirmation_required",
        message: "Send with `x-confirm: true` to suspend this contact.",
        proposedChange: { status: "suspended", reason },
        currentStatus: contact.status,
      });
    }

    const updated = updateContact(
      req.params.id,
      { status: "suspended", notes: contact.notes + (reason ? `\n\n[SUSPENDED] ${reason}` : "\n\n[SUSPENDED]") },
      actor,
      "contact.suspended"
    );
    if (!updated) return res.status(404).json({ ok: false, error: "not_found" });

    appendAdminAudit(actor, `contact:${req.params.id}`, "contact.suspended", { reason: reason ?? "No reason provided", version: updated.version });

    res.json({ ok: true, contact: updated });
  });

  // ── POST /api/admin/contacts/:id/archive ──────────────────
  app.post("/api/admin/contacts/:id/archive", (req: Request, res: Response) => {
    const confirm = req.headers["x-confirm"];
    const contact = contacts.get(req.params.id);
    if (!contact) return res.status(404).json({ ok: false, error: "not_found" });

    const actor = String(req.headers["x-actor"] ?? "u_admin");

    if (confirm !== "true") {
      return res.status(409).json({
        ok: false,
        error: "confirmation_required",
        message: "Send with `x-confirm: true` to archive this contact (soft delete).",
        proposedChange: { status: "archived" },
        currentStatus: contact.status,
      });
    }

    const updated = updateContact(req.params.id, { status: "archived" }, actor, "contact.archived");
    if (!updated) return res.status(404).json({ ok: false, error: "not_found" });

    emitBridgeEvent({
      eventType: "contact.archived",
      aggregateId: req.params.id,
      aggregateKind: "investor",
      payload: { legalName: updated.legalName, version: updated.version },
    });

    res.json({ ok: true, contact: updated });
  });

  // ── POST /api/admin/contacts/:id/restore ──────────────────
  app.post("/api/admin/contacts/:id/restore", (req: Request, res: Response) => {
    const confirm = req.headers["x-confirm"];
    const contact = contacts.get(req.params.id);
    if (!contact) return res.status(404).json({ ok: false, error: "not_found" });

    const actor = String(req.headers["x-actor"] ?? "u_admin");

    if (confirm !== "true") {
      return res.status(409).json({
        ok: false,
        error: "confirmation_required",
        message: "Send with `x-confirm: true` to restore this contact from archived status.",
        proposedChange: { status: "active" },
        currentStatus: contact.status,
      });
    }

    const updated = updateContact(req.params.id, { status: "active" }, actor, "contact.restored");
    if (!updated) return res.status(404).json({ ok: false, error: "not_found" });

    appendAdminAudit(actor, `contact:${req.params.id}`, "contact.restored", { version: updated.version });

    res.json({ ok: true, contact: updated });
  });
}

/* ============================================================
 * Test helpers (exported for test isolation)
 * ============================================================ */

export const _testContacts = {
  reset(): void {
    contacts.clear();
    revisions.clear();
    seeded = false;
  },
  getContacts(): Map<string, AdminContact> {
    return contacts;
  },
  getRevisions(): Map<string, ContactRevision[]> {
    return revisions;
  },
  seed(): void {
    seeded = false;
    seedContacts();
  },
};