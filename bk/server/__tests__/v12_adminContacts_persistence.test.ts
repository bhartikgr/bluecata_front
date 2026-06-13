/**
 * Patch v12 Day 2 Wave 2 — adminContactsStore persistence test (HIGH-CARE).
 *
 * Verifies the audit §3.x contract:
 *   - createContact writes through to `contacts` + `contact_revisions`
 *   - updateContact persists v2+ rows + appends a revision
 *   - Hash chain is reconstructable from the DB (revision genesis = 64×'0')
 *   - Hydrator rebuilds in-memory caches from the DB
 *   - DB-level tampering is detected by verifyChain after hydration
 *   - _testContacts.reset() truncates the DB (not just the in-memory maps)
 *   - All persisted fields round-trip through metadata_json
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  createContact,
  updateContact,
  verifyChain,
  hydrateAdminContactsStore,
  _testContacts,
  type AdminContact,
} from "../adminContactsStore";
import { getDb } from "../db/connection";
import {
  contacts as contactsTable,
  contactRevisions as contactRevisionsTable,
} from "../../shared/schema";
import { eq } from "drizzle-orm";

function baseContact(overrides: Partial<AdminContact> = {}): Omit<
  AdminContact,
  "id" | "createdAt" | "updatedAt" | "version" | "prevRevisionHash" | "revisionHash"
> {
  return {
    kind: "investor",
    legalName: "Test Capital LP",
    displayName: "Test Capital",
    email: "deals@testcap.example",
    type: "institutional",
    status: "active",
    verification: "verified",
    hqCity: "Toronto",
    hqCountry: "CA",
    region: "CA",
    aumMinor: 100_000_00,
    aumCurrency: "USD",
    checkSizeMinMinor: 25_000_00,
    checkSizeMaxMinor: 500_000_00,
    industries: ["fintech"],
    stages: ["seed"],
    companyIds: [],
    partnerWeight: null,
    partnerSince: null,
    phone: null,
    website: null,
    linkedinUrl: null,
    tags: ["test"],
    notes: "",
    createdBy: "u_test",
    updatedBy: "u_test",
    ...overrides,
  } as any;
}

describe("v12 adminContactsStore — DB persistence (HIGH-CARE)", () => {
  beforeEach(() => {
    _testContacts.reset();
  });

  it("createContact writes through to contacts + contact_revisions table", () => {
    const c = createContact(baseContact(), "u_admin");

    const db = getDb();
    const rows = db.select().from(contactsTable).where(eq(contactsTable.id, c.id)).all() as any[];
    expect(rows.length).toBe(1);
    const r = rows[0];
    expect(r.kind).toBe("investor");
    expect(r.legalName).toBe("Test Capital LP");
    expect(r.email).toBe("deals@testcap.example");
    expect(r.version).toBe(1);
    expect(r.prevRevisionHash).toBe("0".repeat(64));
    expect(r.revisionHash).toBe(c.revisionHash);

    // metadata_json round-trips investor-specific fields
    const meta = JSON.parse(r.metadataJson);
    expect(meta.aumMinor).toBe(100_000_00);
    expect(meta.industries).toEqual(["fintech"]);
    expect(meta.stages).toEqual(["seed"]);

    // Revision row persisted with action="contact.created"
    const revRows = db
      .select()
      .from(contactRevisionsTable)
      .where(eq(contactRevisionsTable.contactId, c.id))
      .all() as any[];
    expect(revRows.length).toBe(1);
    expect(revRows[0].version).toBe(1);
    expect(revRows[0].action).toBe("contact.created");
    expect(revRows[0].prevRevisionHash).toBe("0".repeat(64));
    expect(revRows[0].tenantId).toBe("tenant_platform");
  });

  it("updateContact appends v2 revision and persists new row state", () => {
    const c1 = createContact(baseContact(), "u_admin");
    const c2 = updateContact(c1.id, { status: "suspended", notes: "kyc flagged" }, "u_admin", "contact.suspended");

    expect(c2.version).toBe(2);
    expect(c2.prevRevisionHash).toBe(c1.revisionHash);

    const db = getDb();
    const rows = db.select().from(contactsTable).where(eq(contactsTable.id, c1.id)).all() as any[];
    expect(rows[0].status).toBe("suspended");
    expect(rows[0].version).toBe(2);
    expect(rows[0].revisionHash).toBe(c2.revisionHash);

    const revRows = db
      .select()
      .from(contactRevisionsTable)
      .where(eq(contactRevisionsTable.contactId, c1.id))
      .all() as any[];
    expect(revRows.length).toBe(2);
    const v1 = revRows.find((r) => r.version === 1);
    const v2 = revRows.find((r) => r.version === 2);
    expect(v1.action).toBe("contact.created");
    expect(v2.action).toBe("contact.suspended");
    expect(v2.prevRevisionHash).toBe(v1.revisionHash);
  });

  it("hydrator rebuilds in-memory caches from the DB", async () => {
    const c1 = createContact(baseContact({ legalName: "Alpha" }), "u_admin");
    const c2 = createContact(baseContact({ legalName: "Beta", email: "beta@x.example" }), "u_admin");
    updateContact(c1.id, { verification: "verified" }, "u_admin", "contact.verified");

    // Simulate process restart by clearing the maps WITHOUT touching the DB.
    _testContacts.getContacts().clear();
    _testContacts.getRevisions().clear();

    await hydrateAdminContactsStore();

    const m = _testContacts.getContacts();
    expect(m.size).toBe(2);
    const rebuilt1 = m.get(c1.id);
    expect(rebuilt1).toBeTruthy();
    expect(rebuilt1?.legalName).toBe("Alpha");
    expect(rebuilt1?.version).toBe(2);
    expect(rebuilt1?.verification).toBe("verified");

    const rebuilt2 = m.get(c2.id);
    expect(rebuilt2?.legalName).toBe("Beta");

    // Revisions per contact reloaded
    expect(_testContacts.getRevisions().get(c1.id)?.length).toBe(2);
    expect(_testContacts.getRevisions().get(c2.id)?.length).toBe(1);
  });

  it("verifyChain catches DB-level tampering of a stored revision", async () => {
    const c1 = createContact(baseContact(), "u_admin");
    updateContact(c1.id, { notes: "follow up" }, "u_admin");

    // Tamper at the DB level: corrupt the snapshot_json of v1.
    const db = getDb();
    const revs = db
      .select()
      .from(contactRevisionsTable)
      .where(eq(contactRevisionsTable.contactId, c1.id))
      .all() as any[];
    const v1 = revs.find((r) => r.version === 1);
    expect(v1).toBeTruthy();
    const tampered = JSON.parse(v1.snapshotJson);
    tampered.legalName = "Hacked Capital LP";
    db.update(contactRevisionsTable)
      .set({ snapshotJson: JSON.stringify(tampered) })
      .where(eq(contactRevisionsTable.id, v1.id))
      .run();

    // Reload caches from the DB
    _testContacts.getContacts().clear();
    _testContacts.getRevisions().clear();
    await hydrateAdminContactsStore();

    const result = verifyChain(c1.id);
    expect(result.ok).toBe(false);
    expect(result.brokenAtVersion).toBe(1);
  });

  it("_testContacts.reset() truncates both contacts and contact_revisions tables", () => {
    createContact(baseContact(), "u_admin");
    createContact(baseContact({ legalName: "Two" }), "u_admin");

    const db = getDb();
    expect((db.select().from(contactsTable).all() as any[]).length).toBe(2);
    expect((db.select().from(contactRevisionsTable).all() as any[]).length).toBe(2);

    _testContacts.reset();

    expect((db.select().from(contactsTable).all() as any[]).length).toBe(0);
    expect((db.select().from(contactRevisionsTable).all() as any[]).length).toBe(0);
    expect(_testContacts.getContacts().size).toBe(0);
    expect(_testContacts.getRevisions().size).toBe(0);
  });

  it("hash chain genesis = '0' x 64 and links across versions in DB", () => {
    const c1 = createContact(baseContact(), "u_admin");
    const c2 = updateContact(c1.id, { notes: "n1" }, "u_admin");
    const c3 = updateContact(c1.id, { notes: "n2" }, "u_admin");

    const db = getDb();
    const revs = db
      .select()
      .from(contactRevisionsTable)
      .where(eq(contactRevisionsTable.contactId, c1.id))
      .all() as any[];
    revs.sort((a, b) => a.version - b.version);

    expect(revs[0].prevRevisionHash).toBe("0".repeat(64));
    expect(revs[1].prevRevisionHash).toBe(revs[0].revisionHash);
    expect(revs[2].prevRevisionHash).toBe(revs[1].revisionHash);
    expect(revs[2].revisionHash).toBe(c3.revisionHash);

    // After reset, verifyChain on a fresh hydration confirms integrity.
    expect(verifyChain(c1.id).ok).toBe(true);
    expect(verifyChain(c1.id).totalRevisions).toBe(3);
  });
});
