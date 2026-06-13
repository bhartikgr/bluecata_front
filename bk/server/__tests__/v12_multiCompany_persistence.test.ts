/**
 * Patch v12 — Phase D persistence test.
 *
 * Verifies that the hybrid multiCompanyStore correctly persists company
 * creation, active-company flips, and Settings → Company edits to the
 * companies / company_members / tenants / user_prefs tables, and that
 * hydrateMultiCompanyStore() rebuilds the Maps after a simulated restart.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  addCompanyForFounder,
  setActiveCompanyId,
  getCompaniesForFounder,
  getActiveCompanyId,
  updateCompanyDetails,
  hydrateMultiCompanyStore,
  _testAccess,
  type FounderCompanyMembership,
} from "../multiCompanyStore";
import { getDb } from "../db/connection";
import {
  tenants as tenantsTable,
  companies as companiesTable,
  companyMembers as companyMembersTable,
  userPrefs as userPrefsTable,
} from "../../shared/schema";

function makeMembership(companyId: string, name: string): FounderCompanyMembership {
  return {
    companyId,
    companyName: name,
    legalName: `${name}, Inc.`,
    logoUrl: null,
    role: "founder",
    lastActiveAt: new Date().toISOString(),
    kpi: { capTableHolders: 0, activeRoundsCount: 0, raisedThisYearUsd: 0, dataroomFiles: 0, pendingSoftCircles: 0, ownershipPct: 0 },
    collective: { status: "none" },
    billing: { plan: "Founder Free", monthlyUsd: 0, nextBillingDate: "\u2014", cardLast4: null, invoiceCount: 0 },
    sector: "Test Sector",
    stage: "Pre-Seed",
    hq: "Toronto, ON",
  };
}

describe("v12 — multiCompanyStore DB persistence", () => {
  beforeAll(async () => {
    // Ensure DB tables exist; hydrate caches.
    await hydrateMultiCompanyStore();
  });

  it("addCompanyForFounder writes tenants + companies + company_members rows; setActive upserts user_prefs", async () => {
    const userId = `u_v12d_${Date.now()}`;
    const companyId = `co_v12d_${Date.now()}`;
    const tenantId = `tenant_co_${companyId}`;

    const mem = makeMembership(companyId, "V12D TestCo");
    addCompanyForFounder(userId, mem);

    // Map mirror
    expect(getCompaniesForFounder(userId).map((c) => c.companyId)).toContain(companyId);
    // First company → became active automatically (in-memory)
    expect(getActiveCompanyId(userId)).toBe(companyId);

    // DB rows
    const db = getDb();
    const tRows = (await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId))) as any[];
    expect(tRows.length).toBe(1);
    expect(tRows[0].kind).toBe("company");

    const cRows = (await db.select().from(companiesTable).where(eq(companiesTable.id, companyId))) as any[];
    expect(cRows.length).toBe(1);
    expect(cRows[0].tenantId).toBe(tenantId);
    expect(cRows[0].name).toBe("V12D TestCo");

    const mRows = (await db
      .select()
      .from(companyMembersTable)
      .where(eq(companyMembersTable.companyId, companyId))) as any[];
    expect(mRows.length).toBe(1);
    expect(mRows[0].userId).toBe(userId);
    expect(mRows[0].role).toBe("founder");

    const prefRows = (await db
      .select()
      .from(userPrefsTable)
      .where(eq(userPrefsTable.userId, userId))) as any[];
    expect(prefRows.length).toBe(1);
    expect(prefRows[0].activeTenantId).toBe(tenantId);
  });

  it("hydrateMultiCompanyStore rebuilds USER_COMPANIES + USER_ACTIVE_COMPANY from DB after Map.clear()", async () => {
    const userId = `u_v12d_hyd_${Date.now()}`;
    const companyAId = `co_v12dA_${Date.now()}`;
    const companyBId = `co_v12dB_${Date.now()}`;

    addCompanyForFounder(userId, makeMembership(companyAId, "Hyd Co A"));
    addCompanyForFounder(userId, makeMembership(companyBId, "Hyd Co B"));
    // Flip active to B (default would be A as first).
    setActiveCompanyId(userId, companyBId);

    expect(getActiveCompanyId(userId)).toBe(companyBId);
    expect(getCompaniesForFounder(userId).length).toBe(2);

    // Simulate restart: clear caches.
    _testAccess.USER_COMPANIES.clear();
    _testAccess.USER_ACTIVE_COMPANY.clear();
    expect(_testAccess.USER_COMPANIES.size).toBe(0);
    expect(_testAccess.USER_ACTIVE_COMPANY.size).toBe(0);

    // Hydrate from DB.
    await hydrateMultiCompanyStore();

    // Caches rebuilt for our user.
    const restored = getCompaniesForFounder(userId);
    const ids = restored.map((c) => c.companyId).sort();
    expect(ids).toEqual([companyAId, companyBId].sort());
    expect(getActiveCompanyId(userId)).toBe(companyBId);
  });

  it("updateCompanyDetails write-through updates the companies row", async () => {
    const userId = `u_v12d_upd_${Date.now()}`;
    const companyId = `co_v12dU_${Date.now()}`;
    addCompanyForFounder(userId, makeMembership(companyId, "UpdateCo Original"));

    const next = updateCompanyDetails(companyId, {
      companyName: "UpdateCo Renamed",
      sector: "Climate Tech",
      hq: "Vancouver, BC",
    });
    expect(next).not.toBeNull();
    expect(next!.companyName).toBe("UpdateCo Renamed");

    const db = getDb();
    const cRows = (await db.select().from(companiesTable).where(eq(companiesTable.id, companyId))) as any[];
    expect(cRows.length).toBe(1);
    expect(cRows[0].name).toBe("UpdateCo Renamed");
    expect(cRows[0].sector).toBe("Climate Tech");
    expect(cRows[0].hq).toBe("Vancouver, BC");
  });
});
