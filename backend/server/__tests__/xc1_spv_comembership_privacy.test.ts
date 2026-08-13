/**
 * X-C1 / P1-8 — SPV co-membership privacy, PRIMARY GATE.
 *
 * WHY THIS EXISTS
 * SPVs are stored as companies in the sacred `captable_commits` ledger by design
 * (ENGINE_REGISTRY C-1). Co-membership was derived from `company_id` equality alone,
 * so two passive LPs who merely subscribed to the same vehicle resolved as
 * "co-members" — and six live callers (messagingPolicy, networkPostAudience,
 * commsStore x2, collectiveWaveAStore, routes.ts) treat that as authorisation to
 * reveal one another. Co-investors in a syndicate frequently must not learn of each
 * other at all. ENGINE_REGISTRY calls it "a live privacy exposure, not a theoretical one."
 *
 * Wave 25 fixed the LIST-form second path (`durableCapTablePeerIds`). WAIVER-4
 * (owner-signed 2026-08-11) authorised the primary gate.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 35 · ROW 9 — REWRITTEN. F10(b) in FINAL_REVIEW_v26_16_A.md.
 * ══════════════════════════════════════════════════════════════════════════════
 * The previous version of this file DID NOT TEST THE SHIPPED CODE. It declared a
 * local `coMembers(db, a, b, withFix)` that re-implemented the production SQL in
 * the test body, opened its own throwaway `better-sqlite3` file with a two-column
 * caricature of `captable_commits`, and asserted against that copy. The shipped
 * `areCoMembersOnAnyCapTable` was never called. Its only link to production was a
 * `grep` for two substrings — **the file would have passed with the shipped
 * function deleted.**
 *
 * That is the same defect class that let the ¥1,200,000 → $12,000 pricing bug
 * (F1) survive every wave that declared it closed: a test asserting on its own
 * copy of the logic proves only that the test author can write the logic twice.
 *
 * This version:
 *   · imports and CALLS `areCoMembersOnAnyCapTable` — the real exported symbol
 *     behind all six live callers;
 *   · seeds the REAL schema through the REAL `rawDb()` connection, so the real
 *     `spv` and `captable_commits` column sets are exercised, not a two-column
 *     stand-in;
 *   · establishes every precondition itself and asserts the ones that matter
 *     (e.g. that the "real company" is genuinely absent from `spv`) rather than
 *     assuming a seed;
 *   · reads NOTHING from `process.env`;
 *   · uses static / dynamic `import()`, never `require()`.
 *
 * The "prove the defect was real" case can no longer run the production query
 * with the guard removed — the guard is IN the production string. It is replaced
 * by an equivalent that is still executed rather than asserted about: the same
 * join WITHOUT the shared predicate, run against the SAME seeded rows, must
 * return the two LPs as co-members. That demonstrates the exposure is a property
 * of the data and not of the fixture, and the difference between the two answers
 * is attributable to the shipped guard alone.
 *
 * BOTH POLES ARE ASSERTED. A test that only proves LPs are hidden would also pass
 * if the function simply returned false for everyone — which would silently
 * destroy real counterparty messaging across six callers.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { areCoMembersOnAnyCapTable } from "../lib/capTableMembership";
import { notSpvBackedSql } from "../lib/spvBackedCompanies";
import { rawDb } from "../db/connection";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

/* Ids are namespaced so this file cannot collide with, or be satisfied by, any
   other suite's fixtures. */
const SPV_ID = "spv_xc1_r9_vehicle";
const REAL_CO = "co_xc1_r9_operating";
const OTHER_CO = "co_xc1_r9_other";
const LP_ALICE = "u_xc1_r9_lp_alice";
const LP_BOB = "u_xc1_r9_lp_bob";
const INV_CAROL = "u_xc1_r9_inv_carol";
const INV_DAVE = "u_xc1_r9_inv_dave";
const LONER = "u_xc1_r9_loner";

const ALL_COMPANIES = [SPV_ID, REAL_CO, OTHER_CO];
const CC_IDS = [
  "cc_xc1_r9_1",
  "cc_xc1_r9_2",
  "cc_xc1_r9_3",
  "cc_xc1_r9_4",
  "cc_xc1_r9_5",
  "cc_xc1_r9_6",
  "cc_xc1_r9_7",
];

let db: any;

function insCommit(
  id: string,
  seq: number,
  companyId: string,
  investorId: string,
  state: string,
  deletedAt: string | null,
) {
  db.prepare(
    `INSERT OR REPLACE INTO captable_commits
       (id,tenant_id,seq,ts,invitation_id,round_id,company_id,investor_id,amount,currency,
        shares,state,prev_hash,hash,reconcile_match,compliance_hold,deleted_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0,?)`,
  ).run(
    id,
    `tenant_${companyId}`,
    seq,
    "2026-01-01T00:00:00Z",
    `inv_${id}`,
    `rnd_${companyId}`,
    companyId,
    investorId,
    "100000",
    "USD",
    "0",
    state,
    "p",
    `h_${id}`,
    deletedAt,
  );
}

beforeAll(() => {
  db = rawDb();

  // ── Preconditions, established here and never assumed ────────────────────
  // The vehicle IS an SPV.
  db.prepare(
    `INSERT OR REPLACE INTO spv (id,sponsor_partner_id,name,jurisdiction,carry_basis,
       created_at,updated_at,curr_hash)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(
    SPV_ID,
    "p_xc1_r9",
    "X-C1 Row 9 Vehicle",
    "DE",
    "whole_fund",
    "2026-01-01T00:00:00Z",
    "2026-01-01T00:00:00Z",
    "x",
  );
  // The operating companies are NOT. Asserted below, not merely deleted.
  db.prepare(`DELETE FROM spv WHERE id IN (?,?)`).run(REAL_CO, OTHER_CO);

  // The vehicle's ledger: two unrelated passive LPs.
  insCommit(CC_IDS[0], 99301, SPV_ID, LP_ALICE, "committed", null);
  insCommit(CC_IDS[1], 99302, SPV_ID, LP_BOB, "committed", null);
  // A REAL operating company with two genuine counterparties.
  insCommit(CC_IDS[2], 99303, REAL_CO, INV_CAROL, "committed", null);
  insCommit(CC_IDS[3], 99304, REAL_CO, INV_DAVE, "committed", null);
  // A pending (non-committed) holder, and a soft-deleted one.
  insCommit(CC_IDS[4], 99305, REAL_CO, LONER, "pending", null);
  insCommit(CC_IDS[5], 99306, OTHER_CO, INV_CAROL, "committed", null);
  insCommit(CC_IDS[6], 99307, OTHER_CO, LONER, "committed", "2026-02-01T00:00:00Z");
});

afterAll(() => {
  try {
    const qs = CC_IDS.map(() => "?").join(",");
    db.prepare(`DELETE FROM captable_commits WHERE id IN (${qs})`).run(...CC_IDS);
    db.prepare(`DELETE FROM spv WHERE id = ?`).run(SPV_ID);
  } catch {
    /* leave the fixture rather than mask a real failure */
  }
});

/** The SAME join, WITHOUT the shared exclusion. Executed, not asserted about. */
function coMembersWithoutGuard(a: string, b: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS hit
         FROM captable_commits ca
         JOIN captable_commits cb ON ca.company_id = cb.company_id
        WHERE ca.investor_id = ? AND cb.investor_id = ?
          AND ca.state = 'committed' AND cb.state = 'committed'
          AND ca.deleted_at IS NULL AND cb.deleted_at IS NULL
        LIMIT 1`,
    )
    .get(a, b) as { hit?: number } | undefined;
  return !!row?.hit;
}

describe("X-C1 · preconditions are true, not assumed", () => {
  it("the vehicle is in `spv` and the operating companies are not", () => {
    const isSpv = (id: string) =>
      !!db.prepare(`SELECT 1 AS hit FROM spv WHERE id = ?`).get(id);
    expect(isSpv(SPV_ID)).toBe(true);
    expect(isSpv(REAL_CO)).toBe(false);
    expect(isSpv(OTHER_CO)).toBe(false);
  });

  it("the seeded ledger rows are actually present", () => {
    const qs = ALL_COMPANIES.map(() => "?").join(",");
    const n = db
      .prepare(
        `SELECT COUNT(*) AS n FROM captable_commits WHERE company_id IN (${qs})`,
      )
      .get(...ALL_COMPANIES) as { n: number };
    expect(n.n).toBeGreaterThanOrEqual(7);
  });
});

describe("X-C1 primary gate — the SHIPPED areCoMembersOnAnyCapTable", () => {
  it("POLE 1: two LPs in the SAME SPV are NOT co-members (the exposure)", () => {
    expect(areCoMembersOnAnyCapTable(LP_ALICE, LP_BOB)).toBe(false);
    expect(areCoMembersOnAnyCapTable(LP_BOB, LP_ALICE)).toBe(false);
  });

  it("POLE 2: two investors in a REAL company ARE still co-members", () => {
    // If this fails, the fix has broken counterparty messaging for six live
    // callers. A blanket `return false` cannot satisfy this file.
    expect(areCoMembersOnAnyCapTable(INV_CAROL, INV_DAVE)).toBe(true);
    expect(areCoMembersOnAnyCapTable(INV_DAVE, INV_CAROL)).toBe(true);
  });

  it("proves the defect is real IN THIS DATA: without the guard the two LPs join", () => {
    // Same rows, same join, exclusion removed. The two answers differ by the
    // shipped guard alone — so POLE 1 is not passing because the fixture is
    // empty or the ids are wrong.
    expect(coMembersWithoutGuard(LP_ALICE, LP_BOB)).toBe(true);
    expect(coMembersWithoutGuard(INV_CAROL, INV_DAVE)).toBe(true);
  });

  it("mixed membership: a shared REAL company still authorises two SPV co-LPs", () => {
    insCommit("cc_xc1_r9_mix_a", 99401, OTHER_CO, LP_ALICE, "committed", null);
    insCommit("cc_xc1_r9_mix_b", 99402, OTHER_CO, LP_BOB, "committed", null);
    try {
      expect(areCoMembersOnAnyCapTable(LP_ALICE, LP_BOB)).toBe(true);
    } finally {
      db.prepare(`DELETE FROM captable_commits WHERE id IN (?,?)`).run(
        "cc_xc1_r9_mix_a",
        "cc_xc1_r9_mix_b",
      );
    }
    // and it reverts once that shared company is gone
    expect(areCoMembersOnAnyCapTable(LP_ALICE, LP_BOB)).toBe(false);
  });

  it("DB-DRIVEN: marking a real company as an SPV excludes it, with no code change", () => {
    db.prepare(
      `INSERT OR REPLACE INTO spv (id,sponsor_partner_id,name,jurisdiction,carry_basis,
         created_at,updated_at,curr_hash)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(
      REAL_CO,
      "p_xc1_r9",
      "Now an SPV",
      "DE",
      "whole_fund",
      "2026-01-01T00:00:00Z",
      "2026-01-01T00:00:00Z",
      "x",
    );
    try {
      expect(areCoMembersOnAnyCapTable(INV_CAROL, INV_DAVE)).toBe(false);
    } finally {
      db.prepare(`DELETE FROM spv WHERE id = ?`).run(REAL_CO);
    }
    expect(areCoMembersOnAnyCapTable(INV_CAROL, INV_DAVE)).toBe(true);
  });

  it("non-committed and soft-deleted rows do not create co-membership", () => {
    // LONER is `pending` on REAL_CO and soft-deleted on OTHER_CO. Neither counts.
    expect(areCoMembersOnAnyCapTable(LONER, INV_CAROL)).toBe(false);
    expect(areCoMembersOnAnyCapTable(LONER, INV_DAVE)).toBe(false);
  });

  it("a self-pair is not a counterparty relationship", () => {
    expect(areCoMembersOnAnyCapTable(INV_CAROL, INV_CAROL)).toBe(false);
  });

  it("malformed input fails closed", () => {
    expect(areCoMembersOnAnyCapTable("", INV_CAROL)).toBe(false);
    expect(areCoMembersOnAnyCapTable("   ", INV_CAROL)).toBe(false);
    expect(areCoMembersOnAnyCapTable(null as never, INV_CAROL)).toBe(false);
    expect(areCoMembersOnAnyCapTable(INV_CAROL, undefined as never)).toBe(false);
  });

  it("an unknown identity is not co-member with anyone", () => {
    expect(areCoMembersOnAnyCapTable("u_xc1_r9_ghost", INV_CAROL)).toBe(false);
  });
});

describe("X-C1 · the two sinks share one predicate and cannot drift", () => {
  it("the shipped gate imports the shared predicate", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "server/lib/capTableMembership.ts"),
      "utf8",
    );
    expect(src).toContain('from "./spvBackedCompanies"');
    expect(src).toContain('notSpvBackedSql("ca")');
    const list = fs.readFileSync(
      path.join(ROOT, "server/lib/commsUserDirectory.ts"),
      "utf8",
    );
    expect(list).toContain("spvBackedCompanies");
  });

  it("alias validation refuses an injection attempt", () => {
    expect(() => notSpvBackedSql("ca; DROP TABLE spv;--")).toThrow();
    expect(() => notSpvBackedSql("")).toThrow();
    expect(notSpvBackedSql("ca")).toContain("NOT EXISTS");
  });
});
