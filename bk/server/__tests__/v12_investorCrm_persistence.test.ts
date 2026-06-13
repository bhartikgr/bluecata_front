/**
 * Patch v12 Day 3 — investorCrmStore persistence test.
 *
 * Verifies that contacts inserted into the DB are restored on hydration
 * and that the in-memory Map cache is rebuilt with the same shape.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  _testInvestorCrm,
  hydrateInvestorCrmStore,
  type InvestorCrmContact,
} from "../investorCrmStore";
import { investorCrmContacts } from "@shared/schema";
import { getDb } from "../db/connection";

function makeContact(over: Partial<InvestorCrmContact> = {}): InvestorCrmContact {
  const now = new Date().toISOString();
  return {
    id: "icrm_test_aaa",
    investorId: "u_test_inv_1",
    name: "Sample VC",
    role: "Partner",
    email: "vc@sample.test",
    affiliation: "Sample Capital",
    stage: "cold",
    tags: ["seed"],
    notes: "hello",
    noteLog: [],
    tasks: [],
    starred: false,
    createdAt: now,
    updatedAt: now,
    ...over,
  } as InvestorCrmContact;
}

function insertRow(c: InvestorCrmContact) {
  getDb().transaction((tx: any) => {
    tx.insert(investorCrmContacts).values({
      id: c.id,
      tenantId: `tenant_inv_${c.investorId}`,
      investorId: c.investorId,
      platformUserId: null,
      name: c.name,
      role: c.role,
      email: c.email,
      affiliation: c.affiliation,
      stage: c.stage,
      tags: JSON.stringify(c.tags ?? []),
      notes: c.notes,
      noteLog: JSON.stringify(c.noteLog ?? []),
      tasks: JSON.stringify(c.tasks ?? []),
      starred: c.starred,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      companyId: c.companyId ?? null,
      companyName: c.companyName ?? null,
      founderName: c.founderName ?? null,
      founderEmail: c.founderEmail ?? null,
      sector: c.sector ?? null,
      region: c.region ?? null,
      checkSizeUsd: typeof c.checkSizeUsd === "number" ? c.checkSizeUsd : null,
      notesUpdatedAt: c.notesUpdatedAt ?? null,
      deletedAt: null,
    }).run();
  });
}

describe("v12 investorCrmStore — DB persistence + hydration", () => {
  beforeEach(() => {
    _testInvestorCrm.reset();
  });

  it("restores DB rows into the in-memory cache on hydrate", async () => {
    const c = makeContact();
    insertRow(c);

    // Cache empty before hydrate
    expect(_testInvestorCrm.contacts.size).toBe(0);

    await hydrateInvestorCrmStore();

    expect(_testInvestorCrm.contacts.size).toBeGreaterThanOrEqual(1);
    const restored = _testInvestorCrm.contacts.get(c.id);
    expect(restored).toBeDefined();
    expect(restored?.name).toBe("Sample VC");
    expect(restored?.tags).toEqual(["seed"]);
    expect(restored?.starred).toBe(false);
  });

  it("excludes soft-deleted rows from hydration", async () => {
    const c = makeContact({ id: "icrm_test_soft_del" });
    insertRow(c);
    // soft-delete
    getDb()
      .update(investorCrmContacts)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(investorCrmContacts.id, c.id))
      .run();

    await hydrateInvestorCrmStore();

    expect(_testInvestorCrm.contacts.get(c.id)).toBeUndefined();
  });
});
