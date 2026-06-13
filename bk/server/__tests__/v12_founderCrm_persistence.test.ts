/**
 * Patch v12 Day 3 — founderCrmStore persistence test.
 *
 * Verifies that contacts written via the in-memory cache are mirrored to
 * the founder_crm_contacts table and survive a simulated restart (cache
 * cleared, hydrator re-runs from DB).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  _testAccessFounderCrm,
  listContactsForCompany,
  hydrateFounderCrmStore,
  type FounderCrmContact,
} from "../founderCrmStore";
import { founderCrmContacts } from "@shared/schema";
import { getDb } from "../db/connection";

function makeContact(over: Partial<FounderCrmContact> = {}): FounderCrmContact {
  return {
    id: "fcrm_test_aaa",
    companyId: "co_test_persist_1",
    investorId: "u_test_inv1",
    name: "Alice Persist",
    firmName: "Acme VC",
    email: "alice@acme.test",
    region: "US",
    stage: "lead",
    ownership: { sharesUsd: 0, pct: 0 },
    softCircleHistory: [],
    maSignals: 0,
    threadIds: [],
    notes: "",
    notesUpdatedAt: new Date().toISOString(),
    tasks: [],
    series: "—",
    ...over,
  };
}

function insertRow(c: FounderCrmContact) {
  const now = new Date().toISOString();
  getDb().transaction((tx: any) => {
    tx.insert(founderCrmContacts).values({
      id: c.id,
      tenantId: `tenant_co_${c.companyId}`,
      companyId: c.companyId,
      investorId: c.investorId,
      name: c.name,
      firmName: c.firmName,
      role: null,
      email: c.email,
      region: c.region,
      stage: c.stage,
      ownership: JSON.stringify(c.ownership),
      softCircleHistory: JSON.stringify(c.softCircleHistory),
      tasks: JSON.stringify(c.tasks),
      threadIds: JSON.stringify(c.threadIds),
      maSignals: c.maSignals,
      notes: c.notes,
      notesUpdatedAt: c.notesUpdatedAt,
      series: c.series,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }).run();
  });
}

function resetCacheAndDb() {
  _testAccessFounderCrm.contacts.length = 0;
  try {
    getDb().delete(founderCrmContacts).run();
  } catch {
    // ignore
  }
}

describe("v12 founderCrmStore — DB persistence + hydration", () => {
  beforeEach(() => {
    resetCacheAndDb();
  });

  it("persists newly inserted contacts and re-hydrates from DB", async () => {
    const c = makeContact();
    _testAccessFounderCrm.contacts.push(c);
    insertRow(c);

    const rows = getDb()
      .select()
      .from(founderCrmContacts)
      .where(eq(founderCrmContacts.id, c.id))
      .all() as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe("Alice Persist");

    // Simulate restart
    _testAccessFounderCrm.contacts.length = 0;
    await hydrateFounderCrmStore();

    const restored = listContactsForCompany(c.companyId);
    expect(restored.find((x) => x.id === c.id)?.name).toBe("Alice Persist");
  });

  it("scopes contacts per company on hydration", async () => {
    const a = makeContact({ id: "fcrm_test_co_a", companyId: "co_alpha", name: "Inv A" });
    const b = makeContact({ id: "fcrm_test_co_b", companyId: "co_beta", name: "Inv B" });
    for (const c of [a, b]) {
      _testAccessFounderCrm.contacts.push(c);
      insertRow(c);
    }

    _testAccessFounderCrm.contacts.length = 0;
    await hydrateFounderCrmStore();

    expect(listContactsForCompany("co_alpha").find((x) => x.id === a.id)).toBeDefined();
    expect(listContactsForCompany("co_beta").find((x) => x.id === b.id)).toBeDefined();
    expect(listContactsForCompany("co_alpha").find((x) => x.id === b.id)).toBeUndefined();
  });
});
