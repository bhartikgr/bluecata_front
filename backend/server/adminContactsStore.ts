/**
 * server/adminContactsStore.ts — v25.34 Collective Mega-Wave (DB-direct read migration)
 *
 * ===========================================================================
 * v25.34 CHANGE BLOCK
 * ---------------------------------------------------------------------------
 * Prior state: the Admin CRM was a hybrid store whose READS were served
 * entirely from the in-memory Maps (`contacts` / `revisions`). The header
 * already declared "Source of truth = SQLite contacts + contact_revisions;
 * Map = hot cache", but every public reader (getAllContacts / listContacts /
 * getContactStats) and the by-id / history route handlers read the Map, NOT
 * the DB — so the actual served data was the cache, in violation of Ozan's
 * rule #1 ("Nothing in memory. All DB driven").
 *
 * v25.34 delta:
 *   - Added `readAllContactsFromDb()` / `readContactFromDb(id)` /
 *     `readRevisionsFromDb(id)` that query SQLite directly via
 *     rawDb()/getDb() and reconstruct via the existing rowToContact mapper.
 *   - getAllContacts / listContacts / getContactStats and the GET-by-id and
 *     GET-history route handlers now read DB-FIRST. The Map is used ONLY as a
 *     fallback when the DB read itself throws.
 *   - WRITES (createContact / updateContact) were ALREADY fail-closed and
 *     write-after-success: persistContact/persistRevision run inside
 *     db.transaction(...) and the contacts.set/revisions.set calls execute at
 *     the end of that synchronous tx callback — so a DB failure throws and the
 *     cache is never mutated. Left intact.
 * Public function signatures preserved exactly. Satisfies Ozan's rule #1.
 * ===========================================================================
 *
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
 */

import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { appendAdminAudit } from "./adminPlatformStore";
import { emitBridgeEvent } from "./bridgeStore";
import { DEMO_SEED_ENABLED } from "./lib/demoGate";
import { getDb } from "./db/connection";
import {
  contacts as contactsTable,
  contactRevisions as contactRevisionsTable,
} from "../shared/schema";
import { log } from "./lib/logger";
import { getRedeemedRecords } from "./roundInvitationsStore"; // v23.8 W-9 — surface real investors

// Patch v12 Day 2 Wave 2 — adminContactsStore is HIGH-CARE hybrid:
//   - Source of truth = SQLite `contacts` + `contact_revisions` tables.
//   - In-memory Maps (`contacts`, `revisions`) remain as a hot cache; every
//     mutation does write-through to DB and then updates the cache, so the
//     `_testContacts.getContacts()/getRevisions()` accessors observed by 8
//     existing test files continue to function unchanged.
//   - Tenant for platform-level admin CRM = "tenant_platform".
//   - All writes go through `db.transaction((tx) => { ... })` — Drizzle invokes
//     the callback for us, NO trailing `()`.
const ADMIN_CONTACTS_TENANT = "tenant_platform";

/* DB row <-> AdminContact serialisation -------------------------------- */

// Fields stored in dedicated columns on the `contacts` table.
// Everything else lives in metadata_json so we don't drop richness.
function extractMetadata(c: AdminContact): string {
  const meta = {
    type: c.type,
    hqCity: c.hqCity,
    hqCountry: c.hqCountry,
    aumMinor: c.aumMinor,
    aumCurrency: c.aumCurrency,
    checkSizeMinMinor: c.checkSizeMinMinor,
    checkSizeMaxMinor: c.checkSizeMaxMinor,
    industries: c.industries,
    stages: c.stages,
    companyIds: c.companyIds,
    partnerWeight: c.partnerWeight,
    partnerSince: c.partnerSince,
    website: c.website,
    linkedinUrl: c.linkedinUrl,
    tags: c.tags,
    notes: c.notes,
    tier: c.tier ?? null,
    tierSince: c.tierSince ?? null,
    foundingMember: c.foundingMember ?? false,
    partnerType: c.partnerType ?? null,
    regionCode: c.regionCode ?? null,
    preferredPayoutCurrency: c.preferredPayoutCurrency ?? null,
    configJson: c.configJson ?? null,
    isSeed: c.isSeed ?? false,
  };
  return JSON.stringify(meta);
}

function rowToContact(row: any): AdminContact {
  const meta = row.metadataJson ? JSON.parse(row.metadataJson) : {};
  return {
    id: row.id,
    kind: row.kind as ContactKind,
    legalName: row.legalName,
    displayName: row.displayName ?? row.legalName,
    email: row.email ?? "",
    type: (meta.type ?? "institutional") as ContactType,
    status: row.status as ContactStatus,
    verification: row.verification as VerificationStatus,
    hqCity: meta.hqCity ?? "",
    hqCountry: meta.hqCountry ?? "US",
    region: row.region ?? "US",
    aumMinor: meta.aumMinor ?? null,
    aumCurrency: meta.aumCurrency ?? "USD",
    checkSizeMinMinor: meta.checkSizeMinMinor ?? null,
    checkSizeMaxMinor: meta.checkSizeMaxMinor ?? null,
    industries: meta.industries ?? [],
    stages: meta.stages ?? [],
    companyIds: meta.companyIds ?? [],
    partnerWeight: meta.partnerWeight ?? null,
    partnerSince: meta.partnerSince ?? null,
    phone: row.phone ?? null,
    website: meta.website ?? null,
    linkedinUrl: meta.linkedinUrl ?? null,
    tags: meta.tags ?? [],
    notes: meta.notes ?? "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    version: row.version,
    prevRevisionHash: row.prevRevisionHash,
    revisionHash: row.revisionHash,
    tier: meta.tier ?? null,
    tierSince: meta.tierSince ?? null,
    foundingMember: meta.foundingMember ?? false,
    partnerType: meta.partnerType ?? null,
    regionCode: meta.regionCode ?? null,
    preferredPayoutCurrency: meta.preferredPayoutCurrency ?? null,
    configJson: meta.configJson ?? null,
    isSeed: meta.isSeed ?? false,
  };
}

function persistContact(tx: any, c: AdminContact): void {
  tx.insert(contactsTable)
    .values({
      id: c.id,
      kind: c.kind,
      legalName: c.legalName,
      displayName: c.displayName,
      email: c.email,
      phone: c.phone,
      region: c.region,
      status: c.status,
      verification: c.verification,
      metadataJson: extractMetadata(c),
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      createdBy: c.createdBy,
      updatedBy: c.updatedBy,
      version: c.version,
      prevRevisionHash: c.prevRevisionHash,
      revisionHash: c.revisionHash,
      // tenantId + deletedAt are NOT in the Drizzle schema definition for
      // `contacts` (added via ALTER TABLE in v12 connection.ts). They get
      // the column DEFAULTs ('tenant_platform' / NULL) on insert.
    } as any)
    .onConflictDoUpdate({
      target: contactsTable.id,
      set: {
        legalName: c.legalName,
        displayName: c.displayName,
        email: c.email,
        phone: c.phone,
        region: c.region,
        status: c.status,
        verification: c.verification,
        metadataJson: extractMetadata(c),
        updatedAt: c.updatedAt,
        updatedBy: c.updatedBy,
        version: c.version,
        prevRevisionHash: c.prevRevisionHash,
        revisionHash: c.revisionHash,
      },
    })
    .run();
}

function persistRevision(tx: any, rev: ContactRevision): void {
  tx.insert(contactRevisionsTable)
    .values({
      id: `crev_${rev.contactId}_${rev.version}`,
      contactId: rev.contactId,
      tenantId: ADMIN_CONTACTS_TENANT,
      version: rev.version,
      prevRevisionHash: rev.prevRevisionHash,
      revisionHash: rev.revisionHash,
      updatedAt: rev.updatedAt,
      updatedBy: rev.updatedBy,
      action: rev.action,
      snapshotJson: JSON.stringify(rev.snapshot),
    })
    .onConflictDoNothing()
    .run();
}

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

// Patch v6 — Partner CRM tier ladder + partner_type enums
export type PartnerTier = "catalyst" | "builder" | "amplifier" | "nexus" | "founding_member";
export const TIER_RANK: Record<PartnerTier, number> = {
  catalyst: 1,
  builder: 2,
  amplifier: 3,
  nexus: 4,
  founding_member: 5,
};
export const TIER_SEAT_LIMITS: Record<PartnerTier, number> = {
  catalyst: 2,
  builder: 10,
  amplifier: 25,
  nexus: 9999,
  founding_member: 9999,
};
export type PartnerType =
  | "angel_network"
  | "accelerator"
  | "incubator"
  | "accounting"
  | "law"
  | "investment_bank"
  | "professional_services";

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
  // Patch v6 — partner identity fields (consortium_partner kind only; null otherwise)
  tier?: PartnerTier | null;
  tierSince?: string | null;
  foundingMember?: boolean;
  partnerType?: PartnerType | null;
  regionCode?: string | null;
  preferredPayoutCurrency?: string | null;
  configJson?: string | null;

  // Patch v5 — marks rows created by the demo-seed function so they can be
  // filtered out in production regardless of DEMO_SEED_ENABLED state.
  isSeed?: boolean;
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
 * v25.34 — DB-direct readers (DB is source of truth; Map is fallback)
 * ============================================================ */

/** Read every non-soft-deleted contact straight from SQLite. */
function readAllContactsFromDb(): AdminContact[] {
  const db: any = getDb();
  const rows = db.select().from(contactsTable).all() as any[];
  const out: AdminContact[] = [];
  for (const r of rows) {
    if (r.deleted_at != null && r.deleted_at !== "") continue;
    out.push(rowToContact(r));
  }
  return out;
}

/** Read a single contact by id straight from SQLite (null if missing/deleted). */
function readContactFromDb(id: string): AdminContact | null {
  const db: any = getDb();
  const rows = db
    .select()
    .from(contactsTable)
    .where(eq((contactsTable as any).id, id))
    .limit(1)
    .all() as any[];
  const r = rows[0];
  if (!r) return null;
  if (r.deleted_at != null && r.deleted_at !== "") return null;
  return rowToContact(r);
}

/**
 * v25.34 (BLOCKER 2): DB-first resolver used by the write route handlers
 * (PATCH/verify/suspend/archive/restore). Tries the in-memory cache first; on a
 * cache miss it reads the row straight from SQLite (cold start / restart /
 * cross-process write) and repopulates the cache before returning. Returns null
 * only when the row truly does not exist (so callers still 404 correctly).
 */
function resolveContactDbFirst(id: string): AdminContact | null {
  let contact = contacts.get(id) ?? null;
  if (!contact) {
    try {
      const dbRow = readContactFromDb(String(id));
      if (dbRow) {
        contact = dbRow;
        contacts.set(dbRow.id, dbRow);
      }
    } catch (err) {
      log.warn("[adminContactsStore] DB-first lookup failed:", (err as Error).message);
    }
  }
  return contact;
}

/** Read the revision history for a contact straight from SQLite (version ASC). */
function readRevisionsFromDb(contactId: string): ContactRevision[] {
  const db: any = getDb();
  const revRows = db
    .select()
    .from(contactRevisionsTable)
    .where(eq((contactRevisionsTable as any).contactId, contactId))
    .all() as any[];
  revRows.sort((a, b) => a.version - b.version);
  return revRows.map((r) => ({
    contactId: r.contactId,
    version: r.version,
    prevRevisionHash: r.prevRevisionHash,
    revisionHash: r.revisionHash,
    updatedAt: r.updatedAt,
    updatedBy: r.updatedBy,
    action: r.action,
    snapshot: JSON.parse(r.snapshotJson) as AdminContact,
  }));
}

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
  // v25.34 (BLOCKER 2): DB-first fallback — if the in-memory revisions Map is
  // empty (cold start / cross-process write), read the chain from the DB so we
  // don't falsely report a contact as having zero revisions.
  let revs = revisions.get(contactId) ?? [];
  if (revs.length === 0) {
    try {
      const dbRevs = readRevisionsFromDb(contactId);
      if (dbRevs.length > 0) {
        revs = dbRevs;
        revisions.set(contactId, dbRevs);
      }
    } catch (err) {
      log.warn("[adminContactsStore.verifyChain] DB-first revisions lookup failed:", (err as Error).message);
    }
  }
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
 * Mutation helpers (internal — apply after confirmation check)
 * ============================================================ */

export function createContact(
  data: Omit<AdminContact, "id" | "createdAt" | "updatedAt" | "version" | "prevRevisionHash" | "revisionHash">,
  actor: string,
  // v24.4.1 Bug 3 — optional preferred id (callers like consortium-apply
  // approval want the adminContacts id to match the partner_organizations id
  // so /api/admin/partners and /api/partner/me agree on a single partner id).
  // When omitted, a fresh id is generated as before. The id must use the
  // canonical `ac_<kind>_<hex>` format; if the supplied id collides with an
  // existing contact, we fall back to newId() rather than overwriting.
  preferredId?: string | null,
): AdminContact {
  const id = (preferredId && !contacts.has(preferredId)) ? preferredId : newId(data.kind);
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

  // v12 hybrid: persist to DB first, then update in-memory cache.
  const db = getDb();
  db.transaction((tx: any) => {
    persistContact(tx, contact);
    const rev: ContactRevision = buildRevision(contact, "contact.created");
    persistRevision(tx, rev);
    // Update caches inside the tx callback so they only become visible after
    // the tx commits (better-sqlite3 transactions are synchronous).
    contacts.set(id, contact);
    const arr = revisions.get(id) ?? [];
    arr.push(rev);
    revisions.set(id, arr);
  });

  appendAdminAudit(actor, `contact:${id}`, "contact.created", { legalName: contact.legalName, kind: contact.kind, email: contact.email });
  emitBridgeEvent({ eventType: "contact.created", aggregateId: id, aggregateKind: "investor", payload: { legalName: contact.legalName, kind: contact.kind } });

  return contact;
}

export function updateContact(
  id: string,
  patch: Partial<Omit<AdminContact, "id" | "createdAt" | "createdBy" | "version" | "prevRevisionHash" | "revisionHash">>,
  actor: string,
  action = "contact.updated"
): AdminContact {
  // v25.34 (BLOCKER 2): DB-first lookup — if the cache is cold but the row
  // exists in the DB, repopulate the cache instead of throwing not-found.
  let existing = contacts.get(id);
  if (!existing) {
    try {
      const dbRow = readContactFromDb(id);
      if (dbRow) {
        existing = dbRow;
        contacts.set(dbRow.id, dbRow);
      }
    } catch (err) {
      log.warn("[adminContactsStore.updateContact] DB-first lookup failed:", (err as Error).message);
    }
  }
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

  // v12 hybrid: persist to DB first, then update in-memory cache.
  const db = getDb();
  db.transaction((tx: any) => {
    persistContact(tx, updated);
    const rev = buildRevision(updated, action);
    persistRevision(tx, rev);
    contacts.set(id, updated);
    const arr = revisions.get(id) ?? [];
    arr.push(rev);
    revisions.set(id, arr);
  });

  appendAdminAudit(actor, `contact:${id}`, action, { version: updated.version, changes: Object.keys(patch) });

  return updated;
}

function buildRevision(contact: AdminContact, action: string): ContactRevision {
  return {
    contactId: contact.id,
    version: contact.version,
    prevRevisionHash: contact.prevRevisionHash,
    revisionHash: contact.revisionHash,
    updatedAt: contact.updatedAt,
    updatedBy: contact.updatedBy,
    action,
    snapshot: { ...contact },
  };
}

/** @deprecated kept for any straggling internal callers; new code calls
 *  buildRevision + persistRevision inside a tx. */
function appendRevision(contact: AdminContact, action: string): void {
  const rev = buildRevision(contact, action);
  const arr = revisions.get(contact.id) ?? [];
  arr.push(rev);
  revisions.set(contact.id, arr);
}

/* ============================================================
 * Stats
 * ============================================================ */

export function getContactStats() {
  // v25.34: DB-first; fall back to the cache only if the DB read throws.
  let all: AdminContact[];
  try {
    all = readAllContactsFromDb();
  } catch (err) {
    log.warn("[adminContactsStore.getContactStats] DB read failed, using cache:", (err as Error).message);
    all = Array.from(contacts.values());
  }
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
  // v25.34: DB-first; fall back to the cache only if the DB read throws.
  let results: AdminContact[];
  try {
    results = readAllContactsFromDb();
  } catch (err) {
    log.warn("[adminContactsStore.listContacts] DB read failed, using cache:", (err as Error).message);
    results = Array.from(contacts.values());
  }

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
  // Patch v4: only seed contacts when demo gate is on.
  if (!seeded && DEMO_SEED_ENABLED) seedContacts();
  // v25.34: DB-first; fall back to the cache only if the DB read throws.
  try {
    return readAllContactsFromDb();
  } catch (err) {
    log.warn("[adminContactsStore.getAllContacts] DB read failed, using cache:", (err as Error).message);
    return Array.from(contacts.values());
  }
}

/**
 * A8 (v24.0) — idempotently create (or return) an active consortium_partner
 * admin contact for an approved partner application. requirePartnerAuth uses
 * this contact (looked up by the team member's partnerId) as the source of
 * truth for partner-workspace access, so consortium approval must create it.
 *
 * Returns the existing active contact if one with the same email already
 * exists; otherwise creates a fresh one. Never throws on duplicate.
 */
export function upsertConsortiumPartner(
  data: {
    legalName: string;
    email: string;
    website?: string | null;
    partnerType?: PartnerType | null;
    regionCode?: string | null;
    hqCountry?: string | null;
    // v24.4.1 Bug 3 — allow the caller to supply the id of the adminContacts
    // row so callers (e.g. consortium application approval) can keep their
    // partner identifier aligned with their own provisioning records. When
    // omitted, a fresh id is generated as before.
    preferredId?: string | null;
  },
  actor: string,
): AdminContact {
  const emailLc = (data.email || "").toLowerCase();
  /* v25.23 NH-I fix — the cache-only dedup could miss after a partial
   * hydration failure or a sibling-process insert, producing a duplicate
   * consortium_partner row with a different id (which then breaks
   * provisionedPartnerId alignment downstream). Probe the DB as well. */
  let existing = Array.from(contacts.values()).find(
    (c) => c.kind === "consortium_partner" && c.email.toLowerCase() === emailLc && c.status === "active",
  );
  if (!existing) {
    try {
      const db = getDb();
      const rows = db.select().from(contactsTable).all() as any[];
      for (const r of rows) {
        if (
          r &&
          r.kind === "consortium_partner" &&
          (r.email ?? "").toLowerCase() === emailLc &&
          (r.status ?? "active") === "active"
        ) {
          // Reconcile cache from DB row (defensive copy with required fields).
          existing = (r as unknown) as AdminContact;
          contacts.set(r.id, existing);
          break;
        }
      }
    } catch { /* non-fatal: cache lookup remains authoritative */ }
  }
  /* v25.24 NM-4 fix — honour preferredId on existing match.
   * Previously, if `existing` was found by email AND `data.preferredId` was
   * provided, we returned `existing` without checking whether its id matched
   * `preferredId`. The consortium approval cascade then stored
   * `provisionedPartnerId = preferredId` but the adminContacts row carried a
   * different (earlier-minted) id. Downstream lookups by either id silently
   * diverged. We now audit-log the mismatch loudly so operators can
   * reconcile, and return the existing row (id mismatch is irrecoverable in
   * this code path — changing existing.id would break every cross-table
   * foreign-key referencing it; the caller should detect and adjust
   * provisionedPartnerId instead). */
  if (existing) {
    if (data.preferredId && existing.id !== data.preferredId) {
      try {
        appendAdminAudit(
          actor,
          `contact:${existing.id}`,
          "contact.preferredId.mismatch",
          {
            existingId: existing.id,
            requestedPreferredId: data.preferredId,
            email: emailLc,
            kind: "consortium_partner",
            note: "caller should use existing.id as provisionedPartnerId",
          },
        );
      } catch { /* audit best-effort; v25.23 NH-J already guards chain corruption */ }
    }
    return existing;
  }
  return createContact(
    {
      kind: "consortium_partner",
      legalName: data.legalName,
      displayName: data.legalName,
      email: data.email,
      type: "partner_org" as ContactType,
      status: "active",
      verification: "verified",
      hqCity: "",
      hqCountry: data.hqCountry ?? "",
      region: data.regionCode ?? "OTHER",
      aumMinor: null,
      aumCurrency: "USD",
      checkSizeMinMinor: null,
      checkSizeMaxMinor: null,
      industries: [],
      stages: [],
      companyIds: [],
      partnerWeight: null,
      partnerSince: new Date().toISOString(),
      phone: null,
      website: data.website ?? null,
      linkedinUrl: null,
      tags: [],
      notes: "Provisioned by consortium application approval (v24.0 A8).",
      tier: "catalyst",
      tierSince: new Date().toISOString(),
      foundingMember: false,
      partnerType: data.partnerType ?? null,
      regionCode: data.regionCode ?? null,
      preferredPayoutCurrency: "USD",
      configJson: null,
      isSeed: false,
    } as unknown as Omit<AdminContact, "id" | "createdAt" | "updatedAt" | "version" | "prevRevisionHash" | "revisionHash">,
    actor,
    data.preferredId ?? null,
  );
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

  // Seed all contacts and emit contact.seeded audit.
  // v12 hybrid: each seeded row is persisted to DB inside a tx + cache update.
  const db = getDb();
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
      isSeed: true, // Patch v5 — stamp every seeded row for prod filtering.
    };
    contact.revisionHash = computeRevisionHash(contact);

    db.transaction((tx: any) => {
      persistContact(tx, contact);
      const rev = buildRevision(contact, "contact.seeded");
      persistRevision(tx, rev);
      contacts.set(id, contact);
      const arr = revisions.get(id) ?? [];
      arr.push(rev);
      revisions.set(id, arr);
    });

    appendAdminAudit(SEED_ACTOR, `contact:${id}`, "contact.seeded", {
      legalName: contact.legalName,
      kind: contact.kind,
      type: contact.type,
      seedNote: "Initial canonical seed contact for empty deployment",
    });
  }
}

/* ============================================================
 * Express route registration
 * ============================================================ */

export function registerAdminContactsRoutes(app: Express): void {
  if (DEMO_SEED_ENABLED) seedContacts();

  // ── GET /api/admin/contacts/stats ──────────────────────────
  // IMPORTANT: this must be registered BEFORE /:id routes
  app.get("/api/admin/contacts/stats", (_req: Request, res: Response) => {
    res.json(getContactStats());
  });

  // ── GET /api/admin/contacts ────────────────────────────────
  app.get("/api/admin/contacts", (req: Request, res: Response) => {
    const { kind, status, verification, region, search } = req.query as Record<string, string>;
    const results = listContacts({ kind, status, verification, region, search });

    // v23.8 W-9: the CRM `contacts` map is empty in production (demo-only seed),
    // so the admin Investors panel showed 0 rows. Surface REAL investors who
    // have redeemed a round invitation. These derived rows are read-only
    // augmentations (id prefix `derived_inv_`), deduped by email against the
    // managed CRM contacts so a manually-added contact always wins.
    const knownEmails = new Set(results.map((c) => c.email.toLowerCase()));
    const derived: AdminContact[] = [];
    if (!kind || kind === "investor") {
      const now = new Date().toISOString();
      const seenDerived = new Set<string>();
      for (const inv of getRedeemedRecords()) {
        const email = (inv.investorEmail ?? "").toLowerCase().trim();
        if (!email || knownEmails.has(email) || seenDerived.has(email)) continue;
        seenDerived.add(email);
        derived.push({
          id: `derived_inv_${inv.id}`,
          kind: "investor",
          legalName: inv.investorName || inv.investorEmail,
          displayName: inv.investorName || inv.investorEmail,
          email: inv.investorEmail,
          type: "angel",
          status: "active",
          verification: "unverified",
          hqCity: "",
          hqCountry: "US",
          region: "US",
          aumMinor: null,
          aumCurrency: "USD",
          checkSizeMinMinor: null,
          checkSizeMaxMinor: null,
          industries: [],
          stages: [],
          companyIds: inv.companyId ? [inv.companyId] : [],
          partnerWeight: null,
          partnerSince: null,
          phone: null,
          website: null,
          linkedinUrl: null,
          tags: ["round-invitation"],
          notes: "Derived from a redeemed round invitation (read-only).",
          createdAt: inv.redeemedAt ?? inv.createdAt ?? now,
          updatedAt: inv.redeemedAt ?? inv.updatedAt ?? now,
          createdBy: "system",
          updatedBy: "system",
          version: 0,
          prevRevisionHash: "",
          revisionHash: "",
        } as AdminContact);
      }
    }

    // Apply the same simple filters to derived rows so the response is coherent.
    let derivedFiltered = derived;
    if (region) derivedFiltered = derivedFiltered.filter((c) => c.region === region);
    if (status) derivedFiltered = derivedFiltered.filter((c) => c.status === status);
    if (verification) derivedFiltered = derivedFiltered.filter((c) => c.verification === verification);
    if (search) {
      const q = search.toLowerCase();
      derivedFiltered = derivedFiltered.filter(
        (c) => c.legalName.toLowerCase().includes(q) || c.email.toLowerCase().includes(q),
      );
    }

    const merged = [...results, ...derivedFiltered];
    res.json({ total: merged.length, contacts: merged });
  });

  // ── POST /api/admin/contacts ───────────────────────────────
  app.post("/api/admin/contacts", (req: Request, res: Response) => {
    const confirm = req.headers["x-confirm"];
    const body = req.body ?? {};
    const actor = String((req as any).userContext?.userId ?? "") /* v25.18 Lane B NC1: actor from session only */;
    if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });

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
    // v25.34: DB-first read (cache fallback only on DB error).
    const contactId = String(req.params.id);
    let contact: AdminContact | null;
    try {
      contact = readContactFromDb(contactId);
    } catch (err) {
      log.warn("[GET contacts/:id] DB read failed, using cache:", (err as Error).message);
      contact = contacts.get(contactId) ?? null;
    }
    if (!contact) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, contact });
  });

  // ── GET /api/admin/contacts/:id/history ───────────────────
  app.get("/api/admin/contacts/:id/history", (req: Request, res: Response) => {
    // v25.34: DB-first read (cache fallback only on DB error).
    const contactId = String(req.params.id);
    let contact: AdminContact | null;
    let history: ContactRevision[];
    try {
      contact = readContactFromDb(contactId);
      history = readRevisionsFromDb(contactId);
    } catch (err) {
      log.warn("[GET contacts/:id/history] DB read failed, using cache:", (err as Error).message);
      contact = contacts.get(contactId) ?? null;
      history = revisions.get(contactId) ?? [];
    }
    if (!contact) return res.status(404).json({ ok: false, error: "not_found" });
    const chain = verifyChain(contactId);
    res.json({ ok: true, contactId, history, chain });
  });

  // ── PATCH /api/admin/contacts/:id ─────────────────────────
  app.patch("/api/admin/contacts/:id", (req: Request, res: Response) => {
    const confirm = req.headers["x-confirm"];
    const contact = resolveContactDbFirst(String(req.params.id)); // v25.34 (BLOCKER 2): DB-first lookup
    if (!contact) return res.status(404).json({ ok: false, error: "not_found" });

    const patch = req.body ?? {};
    const actor = String((req as any).userContext?.userId ?? "") /* v25.18 Lane B NC1: actor from session only */;
    if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });

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
    const contact = resolveContactDbFirst(String(req.params.id)); // v25.34 (BLOCKER 2): DB-first lookup
    if (!contact) return res.status(404).json({ ok: false, error: "not_found" });

    const actor = String((req as any).userContext?.userId ?? "") /* v25.18 Lane B NC1: actor from session only */;
    if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });

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
    const contact = resolveContactDbFirst(String(req.params.id)); // v25.34 (BLOCKER 2): DB-first lookup
    if (!contact) return res.status(404).json({ ok: false, error: "not_found" });

    const actor = String((req as any).userContext?.userId ?? "") /* v25.18 Lane B NC1: actor from session only */;
    if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });
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

    /* v25.16 cross-comp NM4 — removed the duplicate appendAdminAudit call;
       updateContact() already writes a contact.suspended audit entry. */
    res.json({ ok: true, contact: updated });
  });

  // ── POST /api/admin/contacts/:id/archive ──────────────────
  app.post("/api/admin/contacts/:id/archive", (req: Request, res: Response) => {
    const confirm = req.headers["x-confirm"];
    const contact = resolveContactDbFirst(String(req.params.id)); // v25.34 (BLOCKER 2): DB-first lookup
    if (!contact) return res.status(404).json({ ok: false, error: "not_found" });

    const actor = String((req as any).userContext?.userId ?? "") /* v25.18 Lane B NC1: actor from session only */;
    if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });

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
    const contact = resolveContactDbFirst(String(req.params.id)); // v25.34 (BLOCKER 2): DB-first lookup
    if (!contact) return res.status(404).json({ ok: false, error: "not_found" });

    const actor = String((req as any).userContext?.userId ?? "") /* v25.18 Lane B NC1: actor from session only */;
    if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });

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

    /* v25.16 cross-comp NM4 — removed the duplicate appendAdminAudit call;
       updateContact() already writes the audit entry. */
    res.json({ ok: true, contact: updated });
  });
}

/* ============================================================
 * Test helpers (exported for test isolation)
 * ============================================================ */

/* ============================================================
 * v12 Hydrator — repopulate in-memory caches from DB on startup.
 *
 * Read order:
 *   1) `contacts` rows where deleted_at IS NULL
 *   2) For each contact, all `contact_revisions` ordered by version ASC
 *
 * If the DB read fails (sandbox with no schema yet, mid-migration) we keep
 * caches as-is and log a warning so the server can still boot.
 * ============================================================ */
export async function hydrateAdminContactsStore(): Promise<void> {
  try {
    const db = getDb();
    // CROSS-TENANT (admin) — admin CRM is platform-wide; we deliberately load
    // all tenants here. The `contacts` Drizzle schema definition does NOT yet
    // include the v12-added `deleted_at` / `tenant_id` columns, so we filter
    // soft-deletes via a raw column predicate by casting and reading them off
    // the result rows instead. For now: read everything; rows soft-deleted
    // via DELETE-IF-NULL semantics will simply appear with deleted_at set in
    // the underlying row (we never set it from this file).
    const rows = db.select().from(contactsTable).all() as any[];

    contacts.clear();
    revisions.clear();

    for (const r of rows) {
      // Skip soft-deleted rows when the column exists on the row object.
      if (r.deleted_at != null && r.deleted_at !== "") continue;
      const c = rowToContact(r);
      contacts.set(c.id, c);
    }

    const revRows = db.select().from(contactRevisionsTable).all() as any[];
    revRows.sort((a, b) => {
      if (a.contactId !== b.contactId) return a.contactId.localeCompare(b.contactId);
      return a.version - b.version;
    });
    for (const r of revRows) {
      const rev: ContactRevision = {
        contactId: r.contactId,
        version: r.version,
        prevRevisionHash: r.prevRevisionHash,
        revisionHash: r.revisionHash,
        updatedAt: r.updatedAt,
        updatedBy: r.updatedBy,
        action: r.action,
        snapshot: JSON.parse(r.snapshotJson) as AdminContact,
      };
      const arr = revisions.get(rev.contactId) ?? [];
      arr.push(rev);
      revisions.set(rev.contactId, arr);
    }

    // If we found any persisted contacts, mark seeded so seedContacts() is a
    // no-op on next call (avoids double-seeding after a restart).
    if (contacts.size > 0) {
      seeded = true;
    }

    if (rows.length > 0) {
      log.info(`[hydrate] adminContactsStore: loaded ${contacts.size} contacts, ${revRows.length} revisions`);
    }
  } catch (err) {
    log.warn("[hydrate] adminContactsStore: DB read failed:", (err as Error).message);
  }
}

export const _testContacts = {
  reset(): void {
    contacts.clear();
    revisions.clear();
    seeded = false;
    // v12 hybrid: also truncate the DB tables so test isolation matches the
    // in-memory reset semantics. Wrapped in try/catch because the DB may not
    // be available in unit-test contexts that bypass hydrate.
    try {
      const db = getDb();
      db.transaction((tx: any) => {
        tx.delete(contactRevisionsTable).run();
        tx.delete(contactsTable).run();
      });
    } catch (err) {
      // swallow — sandbox / pre-migration test envs
    }
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
