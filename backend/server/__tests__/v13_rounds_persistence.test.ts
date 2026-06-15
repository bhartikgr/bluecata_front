/**
 * v13 — Avi's Issue 3: Rounds persistence.
 *
 * Avi reported: "In the Round module, I created two entries, but they are not
 *  saved in the record table."
 *
 * This test exercises the new roundsStore (DB-backed hybrid):
 *  1. Create two rounds via createRound().
 *  2. Verify both rows appear in the `rounds` SQL table.
 *  3. Reset the in-memory cache (simulating a server restart).
 *  4. Call hydrateRoundsStore() — both rounds rehydrate from DB.
 *  5. Verify the audit log has two `round.created` entries.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { getDb } from "../db/connection";
import { rounds as roundsTable, auditLog as auditLogTable } from "../../shared/schema";
import { eq, and } from "drizzle-orm";
import {
  createRound,
  hydrateRoundsStore,
  getRoundsForCompany,
  _testAccessRounds,
} from "../roundsStore";

describe("v13 B-V13-3 — rounds DB persistence", () => {
  const COMPANY_ID = "co_v13rounds_test";

  beforeAll(() => {
    // Ensure clean state: nuke any prior test rounds for this company.
    const db = getDb();
    try {
      db.delete(roundsTable).where(eq(roundsTable.companyId, COMPANY_ID)).run();
    } catch { /* tolerated */ }
    _testAccessRounds.reset();
  });

  it("createRound writes to the DB", () => {
    const r1 = createRound({
      companyId: COMPANY_ID,
      name: "Seed v13 #1",
      type: "seed",
      targetAmount: 1_000_000,
      actorUserId: "u_test_avi",
      extras: { useOfProceeds: "hiring + GTM" },
    });
    const r2 = createRound({
      companyId: COMPANY_ID,
      name: "Series A v13 #2",
      type: "series_a",
      targetAmount: 8_000_000,
      actorUserId: "u_test_avi",
      extras: { useOfProceeds: "international expansion" },
    });
    expect(r1.id).toMatch(/^rnd_/);
    expect(r2.id).toMatch(/^rnd_/);

    const db = getDb();
    const rows = db
      .select()
      .from(roundsTable)
      .where(eq(roundsTable.companyId, COMPANY_ID))
      .all();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const ids = new Set(rows.map((r: any) => r.id));
    expect(ids.has(r1.id)).toBe(true);
    expect(ids.has(r2.id)).toBe(true);
  });

  it("hydrateRoundsStore rebuilds the cache after a simulated restart", async () => {
    _testAccessRounds.reset();
    expect(getRoundsForCompany(COMPANY_ID).length).toBe(0);
    await hydrateRoundsStore();
    const hydrated = getRoundsForCompany(COMPANY_ID);
    expect(hydrated.length).toBeGreaterThanOrEqual(2);
    const names = new Set(hydrated.map((r) => r.name));
    expect(names.has("Seed v13 #1")).toBe(true);
    expect(names.has("Series A v13 #2")).toBe(true);
    // extras_json round-trip
    const seed = hydrated.find((r) => r.name === "Seed v13 #1") as any;
    expect(seed?.useOfProceeds).toBe("hiring + GTM");
  });

  it("each round.created emits an audit_log entry (B-V11-7 preserved)", () => {
    const db = getDb();
    const tenantId = `tenant_co_${COMPANY_ID}`;
    const rows = db
      .select()
      .from(auditLogTable)
      .where(and(eq(auditLogTable.tenantId, tenantId), eq(auditLogTable.action, "round.created")))
      .all();
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });
});
