/**
 * v25.20 Lane 3 — Canonical test-company fixtures.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The carry-forward suite, the SAFE / round suites, and the cap-table suites
 * all depend on two seed companies being present after `seedDemoData(getDb())`:
 *
 *     co_novapay   (NovaPay AI,      tenant tenant_co_co_novapay)
 *     co_arboreal  (Arboreal Health, tenant tenant_co_co_arboreal)
 *
 * The v25.19 Lane 2 audit reported these fixtures as "removed". They were NOT
 * actually deleted from server/lib/seedDemoData.ts or server/mockData.ts — but
 * because the suite was (a) running against the shared ./data.db instead of an
 * isolated :memory: DB and (b) blowing up on an unrelated runtime require()
 * bug, the fixtures *appeared* to be missing. This module makes the dependency
 * EXPLICIT and adds a guard test (testCompanies.fixtures.test.ts) so a future
 * wave cannot silently delete the seed companies without a red test.
 *
 * This file is TEST SCAFFOLDING ONLY. It does not change any production data;
 * it re-exports the canonical IDs and a thin convenience seeder that wraps the
 * existing production seedDemoData() path. Keep it.
 */
import { getDb } from "../../db/connection";
import { seedDemoData, _demoSeedCatalog } from "../../lib/seedDemoData";

/** getDb() is typed `any` in connection.ts; alias for readability. */
type Db = ReturnType<typeof getDb>;

/** Canonical demo company IDs the carry-forward / SAFE / cap-table suites need. */
export const TEST_COMPANY_IDS = {
  novapay: "co_novapay",
  arboreal: "co_arboreal",
} as const;

/** Canonical tenant IDs that own the demo companies (as written by seedDemoData). */
export const TEST_TENANT_IDS = {
  novapay: "tenant_co_co_novapay",
  arboreal: "tenant_co_co_arboreal",
} as const;

/** Canonical founder / investor persona IDs used across the suites. */
export const TEST_PERSONA_IDS = {
  founderMaya: "u_maya_chen",
  founderDaniel: "u_daniel_okafor",
  investorAisha: "u_aisha_patel",
  admin: "u_admin",
} as const;

/** Canonical seed round IDs referenced by round* / roundDetailLoad tests. */
export const TEST_ROUND_IDS = {
  novapayFoundation: "rnd_novapay_foundation",
  novapayPreseed: "rnd_novapay_preseed",
  novapaySeedClosed: "rnd_novapay_seed_closed",
} as const;

/**
 * Lightweight readable shape of the demo companies, derived from the canonical
 * seed catalog so this fixture never drifts from production seed data.
 */
export const TEST_COMPANIES = _demoSeedCatalog.companies.filter(
  (c) => c.id === TEST_COMPANY_IDS.novapay || c.id === TEST_COMPANY_IDS.arboreal,
);

/**
 * Seed the canonical demo fixtures into the (in-memory) test DB.
 *
 * Thin wrapper over the production seedDemoData() path so suites get a single,
 * obvious entry point. Returns the DB handle for chaining. Idempotent — safe to
 * call from beforeAll/beforeEach.
 */
export async function seedTestCompanies(db: Db = getDb()): Promise<Db> {
  await seedDemoData(db);
  return db;
}
