/**
 * server/__tests__/wave3_shadie_rounds.test.ts
 *
 * W3 Shadie round-flow fixes (server-side, deterministic):
 *   4a  round-name uniqueness is now scoped to company + STAGE (type),
 *       case- AND whitespace-insensitive. Two rounds at the SAME stage may NOT
 *       share a name; two rounds at DIFFERENT stages MAY. suggestUniqueRoundName
 *       is likewise stage-scoped.
 *   (1a server date-required backstop + 2a/2b invite-on-create are exercised by
 *    the existing round-create / invitation route suites.)
 */
import { describe, it, expect, beforeAll } from "vitest";
import { getDb } from "../db/connection";
import { rounds as roundsTable } from "../../shared/schema";
import { eq } from "drizzle-orm";
import {
  createRound,
  roundNameExistsForCompany,
  suggestUniqueRoundName,
} from "../roundsStore";

const COMPANY_ID = "co_w3_shadie_4a";

describe("W3 Shadie 4a — round-name uniqueness scoped to company + STAGE", () => {
  beforeAll(() => {
    try {
      const db = getDb();
      db.delete(roundsTable).where(eq(roundsTable.companyId, COMPANY_ID)).run();
    } catch { /* first boot: table may not exist yet */ }
    // Seed a Series A round named "Asia-market-entry".
    createRound({
      companyId: COMPANY_ID,
      name: "Asia-market-entry",
      type: "series_a",
      targetAmount: 1000000,
    });
  });

  it("ALLOWS a second Series A round with a DIFFERENT name (two Series A OK)", () => {
    expect(roundNameExistsForCompany(COMPANY_ID, "EU VC-partnership", "series_a")).toBe(false);
    const r = createRound({
      companyId: COMPANY_ID,
      name: "EU VC-partnership",
      type: "series_a",
      targetAmount: 2000000,
    });
    expect(r.id).toBeTruthy();
  });

  it("REJECTS a second round with the SAME name at the SAME stage", () => {
    expect(roundNameExistsForCompany(COMPANY_ID, "Asia-market-entry", "series_a")).toBe(true);
    expect(() =>
      createRound({ companyId: COMPANY_ID, name: "Asia-market-entry", type: "series_a", targetAmount: 500000 }),
    ).toThrow("ROUND_NAME_DUPLICATE");
  });

  it("ALLOWS the same name at a DIFFERENT stage", () => {
    // "Asia-market-entry" exists at series_a; the SAME name at seed is allowed.
    expect(roundNameExistsForCompany(COMPANY_ID, "Asia-market-entry", "seed")).toBe(false);
    const r = createRound({
      companyId: COMPANY_ID,
      name: "Asia-market-entry",
      type: "seed",
      targetAmount: 300000,
    });
    expect(r.id).toBeTruthy();
  });

  it("is case- AND whitespace-insensitive within a stage", () => {
    // "asia-market-entry" (lowercase) and "Asia-market-entry" collide at series_a.
    expect(roundNameExistsForCompany(COMPANY_ID, "  asia-market-entry  ", "series_a")).toBe(true);
    // Internal whitespace runs are collapsed: "July  13" vs "July 13".
    createRound({ companyId: COMPANY_ID, name: "July 13", type: "pre_seed", targetAmount: 100000 });
    expect(roundNameExistsForCompany(COMPANY_ID, "July   13", "pre_seed")).toBe(true);
  });

  it("suggestUniqueRoundName is stage-scoped", () => {
    // Duplicate at series_a → suggests "Asia-market-entry (2)".
    expect(suggestUniqueRoundName(COMPANY_ID, "Asia-market-entry", "series_a")).toBe("Asia-market-entry (2)");
    // Unique at a fresh stage → returned unchanged.
    expect(suggestUniqueRoundName(COMPANY_ID, "Asia-market-entry", "series_b")).toBe("Asia-market-entry");
  });
});
