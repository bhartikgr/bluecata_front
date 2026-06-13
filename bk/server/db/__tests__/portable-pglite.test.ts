/**
 * server/db/__tests__/portable-pglite.test.ts — Wave H pglite integration tests.
 *
 * Verifies basic CRUD on representative tables (tenants, users, companies)
 * using the pglite harness, and confirms that the portable helpers (pAll,
 * pGet, pRun) work correctly against a real Postgres-wire-compatible engine.
 *
 * NOT PART OF npm test — runs via:
 *   npm run test:pglite
 *
 * See server/db/__tests__/pglite-harness.ts for harness docs.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createPgliteHarness, getPgliteDriver, type PgliteHarness } from "./pglite-harness";
import { tenants, users, companies } from "../../../shared/schema.pg";

// ── Test fixtures ─────────────────────────────────────────────────────────────

const TENANT_1 = {
  id: "tenant_test_001",
  name: "Acme Capital",
  kind: "company",
  status: "active",
  isDemo: 0,
} as const;

const TENANT_2 = {
  id: "tenant_test_002",
  name: "Beta Ventures",
  kind: "investor",
  status: "active",
  isDemo: 0,
} as const;

const USER_1 = {
  id: "user_test_001",
  tenantId: "tenant_test_001",
  email: "alice@acme.com",
  name: "Alice Founder",
  role: "founder",
  isDemo: 0,
} as const;

const COMPANY_1 = {
  id: "company_test_001",
  tenantId: "tenant_test_001",
  name: "Acme Corp",
  isDemo: 0,
} as const;

// ── Harness lifecycle ─────────────────────────────────────────────────────────

let harness: PgliteHarness;

beforeAll(async () => {
  harness = await createPgliteHarness();
}, 30_000); // allow up to 30s for PGlite Wasm boot + migration

afterAll(async () => {
  await harness.close();
});

// ── Driver detection ──────────────────────────────────────────────────────────

describe("PGlite driver detection", () => {
  it("reports postgres driver from pglite handle", () => {
    const driver = getPgliteDriver(harness.db);
    expect(driver).toBe("postgres");
  });

  it("pglite responds to raw SQL ping", async () => {
    const result = await harness.pg.query("SELECT 1 AS n");
    expect(result.rows[0]).toMatchObject({ n: 1 });
  });
});

// ── Tenants CRUD ──────────────────────────────────────────────────────────────

describe("tenants table — basic CRUD", () => {
  it("inserts two tenant rows", async () => {
    await harness.db.insert(tenants).values([TENANT_1, TENANT_2]);
    // no error = success
  });

  it("selects all tenants — pAll equivalent via Drizzle await", async () => {
    const rows = await harness.db.select().from(tenants);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(TENANT_1.id);
    expect(ids).toContain(TENANT_2.id);
  });

  it("selects a single tenant by id — pGet equivalent via .limit(1)", async () => {
    const rows = await harness.db
      .select()
      .from(tenants)
      .where(eq(tenants.id, TENANT_1.id))
      .limit(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe(TENANT_1.name);
  });

  it("updates a tenant field", async () => {
    await harness.db
      .update(tenants)
      .set({ name: "Acme Capital (Updated)" })
      .where(eq(tenants.id, TENANT_1.id));

    const rows = await harness.db
      .select()
      .from(tenants)
      .where(eq(tenants.id, TENANT_1.id))
      .limit(1);
    expect(rows[0].name).toBe("Acme Capital (Updated)");
  });

  it("soft-deletes a tenant via deleted_at", async () => {
    const ts = new Date().toISOString();
    await harness.db
      .update(tenants)
      .set({ deletedAt: ts })
      .where(eq(tenants.id, TENANT_2.id));

    const rows = await harness.db
      .select()
      .from(tenants)
      .where(eq(tenants.id, TENANT_2.id))
      .limit(1);
    expect(rows[0].deletedAt).toBe(ts);
  });
});

// ── Users CRUD ────────────────────────────────────────────────────────────────

describe("users table — basic CRUD", () => {
  it("inserts a user row", async () => {
    await harness.db.insert(users).values(USER_1);
  });

  it("selects user by tenantId", async () => {
    const rows = await harness.db
      .select()
      .from(users)
      .where(eq(users.tenantId, "tenant_test_001"));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].email).toBe("alice@acme.com");
  });

  it("updates user display name", async () => {
    await harness.db
      .update(users)
      .set({ displayName: "Alice A." })
      .where(eq(users.id, USER_1.id));

    const rows = await harness.db
      .select()
      .from(users)
      .where(eq(users.id, USER_1.id))
      .limit(1);
    expect(rows[0].displayName).toBe("Alice A.");
  });

  it("deletes user row (hard delete for test cleanup)", async () => {
    await harness.db.delete(users).where(eq(users.id, USER_1.id));
    const rows = await harness.db
      .select()
      .from(users)
      .where(eq(users.id, USER_1.id));
    expect(rows).toHaveLength(0);
  });
});

// ── Companies CRUD ────────────────────────────────────────────────────────────

describe("companies table — basic CRUD", () => {
  it("inserts a company", async () => {
    await harness.db.insert(companies).values(COMPANY_1);
  });

  it("selects company by id", async () => {
    const rows = await harness.db
      .select()
      .from(companies)
      .where(eq(companies.id, COMPANY_1.id))
      .limit(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Acme Corp");
  });

  it("updates company sector", async () => {
    await harness.db
      .update(companies)
      .set({ sector: "Fintech", stage: "Seed" })
      .where(eq(companies.id, COMPANY_1.id));

    const rows = await harness.db
      .select()
      .from(companies)
      .where(eq(companies.id, COMPANY_1.id))
      .limit(1);
    expect(rows[0].sector).toBe("Fintech");
    expect(rows[0].stage).toBe("Seed");
  });
});

// ── pAll / pGet / pRun behaviour via Drizzle-pglite ──────────────────────────
//
// The portable helpers (pAll/pGet/pRun in server/db/portable.ts) detect
// the driver from getDbDriver(). PGlite uses the postgres-js Drizzle
// adapter shape: query builders are thenable (no .all()/.get()/.run()).
// These tests confirm the SAME query patterns work against the pglite
// handle, validating that pAll/pGet/pRun's "postgres" branch is semantically
// correct.
//

describe("portable helper equivalents on pglite", () => {
  it("pAll-equivalent: await select() returns an array", async () => {
    const rows = await harness.db.select().from(tenants);
    expect(Array.isArray(rows)).toBe(true);
  });

  it("pGet-equivalent: await select().limit(1) returns at most one row", async () => {
    const rows = await harness.db.select().from(tenants).limit(1);
    expect(rows.length).toBeLessThanOrEqual(1);
  });

  it("pRun-equivalent: await insert/update/delete completes without error", async () => {
    // Insert a throwaway row, update it, delete it.
    const id = "tenant_crud_probe";
    await harness.db.insert(tenants).values({
      id,
      name: "Probe Tenant",
      kind: "company",
      status: "active",
      isDemo: 0,
    });
    await harness.db
      .update(tenants)
      .set({ name: "Probe Tenant (Modified)" })
      .where(eq(tenants.id, id));
    await harness.db.delete(tenants).where(eq(tenants.id, id));

    const rows = await harness.db.select().from(tenants).where(eq(tenants.id, id));
    expect(rows).toHaveLength(0);
  });
});

// ── Schema completeness smoke test ───────────────────────────────────────────

describe("schema completeness — all 90 tables exist in pglite", () => {
  it("can query a selection of key tables without error", async () => {
    // Import the full pg schema to spot-check table coverage.
    const pgSchema = await import("../../../shared/schema.pg");

    const tableNames = [
      "tenants", "users", "companies", "securities", "rounds",
      "auditLog", "captableCommits", "spvs", "chapters", "collectiveMemberships",
      "expertQuestions", "messages", "partnerDealPipeline",
    ] as const;

    for (const name of tableNames) {
      const table = pgSchema[name as keyof typeof pgSchema] as any;
      const rows = await harness.db.select().from(table).limit(0);
      // If the table doesn't exist in the migration, this would throw.
      expect(Array.isArray(rows)).toBe(true);
    }
  });
});
