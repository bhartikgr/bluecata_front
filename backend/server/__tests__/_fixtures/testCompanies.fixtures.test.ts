/**
 * v25.20 Lane 3 — Fixture guard.
 *
 * Fails LOUDLY if the canonical demo companies (co_novapay / co_arboreal) ever
 * disappear from the seed path again. The v25.19 Lane 2 audit lost a week to a
 * "fixtures were removed" red herring; this test turns that failure mode into a
 * single obvious red test instead of 18 mysterious cross-suite failures.
 *
 * It exercises the SAME path the carry-forward / SAFE / cap-table suites use:
 *   seedTestCompanies()  →  seedDemoData(getDb())  →  rows present in DB.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { getDb } from "../../db/connection";
import { companies as companiesTable } from "../../../shared/schema";
import {
  TEST_COMPANY_IDS,
  TEST_TENANT_IDS,
  TEST_COMPANIES,
  seedTestCompanies,
} from "./testCompanies";

describe("v25.20 Lane 3 — canonical test-company fixtures", () => {
  beforeAll(async () => {
    await seedTestCompanies();
  }, 30_000);

  it("the fixture catalog still includes co_novapay and co_arboreal", () => {
    const ids = TEST_COMPANIES.map((c) => c.id);
    expect(ids).toContain(TEST_COMPANY_IDS.novapay);
    expect(ids).toContain(TEST_COMPANY_IDS.arboreal);
  });

  it("seedTestCompanies() writes co_novapay into the companies table", () => {
    const db = getDb();
    const rows = db.select().from(companiesTable).all() as Array<{ id: string; tenantId?: string }>;
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(TEST_COMPANY_IDS.novapay);
    expect(ids).toContain(TEST_COMPANY_IDS.arboreal);
  });

  it("the canonical tenant IDs match the seeded company tenants", () => {
    const nova = TEST_COMPANIES.find((c) => c.id === TEST_COMPANY_IDS.novapay);
    const arb = TEST_COMPANIES.find((c) => c.id === TEST_COMPANY_IDS.arboreal);
    expect(nova?.tenantId).toBe(TEST_TENANT_IDS.novapay);
    expect(arb?.tenantId).toBe(TEST_TENANT_IDS.arboreal);
  });
});
