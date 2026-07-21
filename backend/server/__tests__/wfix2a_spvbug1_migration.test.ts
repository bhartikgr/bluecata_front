/**
 * W-FIX2a SPV-BUG-1 — reversible ×10^exp migration for SPV amounts saved at
 * 1/100 by the buggy wizard write-path.
 *
 * Covers: (1) buggy-path record (target displays implausibly small) is scaled
 * up on all co-written fields incl. its fixed fee; (2) a plausible-size record
 * is left untouched (magnitude guard); (3) down-migration restores the exact
 * prior values; (4) 0-decimal currency (JPY) is never touched; (5) idempotency
 * — a second up-run is a no-op; (6) artifact emission writes the 3 files.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { rawDb, getDb } from "../db/connection";
import {
  migrateSpvBug1,
  revertSpvBug1Migration,
} from "../lib/spvBug1Migration";

const HASH0 = "0".repeat(64);

function seedSpv(
  id: string,
  currency: string,
  target: number | null,
  min: number | null,
  cap: number | null,
) {
  const now = new Date().toISOString();
  rawDb()
    .prepare(
      `INSERT OR REPLACE INTO spv
         (id, sponsor_partner_id, gp_user_id, name, spv_type, jurisdiction, status,
          distribution_scope, target_raise_minor, min_check_minor, cap_minor, currency,
          carry_basis, lp_visibility, target_company_id, close_date, terms_json, migrated_from,
          created_at, created_by, updated_at, updated_by, archived_at, prev_hash, curr_hash)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id, "prt_bug1", null, `SPV ${id}`, "spv", "US", "draft",
      "private", target, min, cap, currency,
      "committed_capital", "own_only", null, null, null, null,
      now, "prt_bug1", now, "prt_bug1", null, HASH0, `hash_${id}`,
    );
}

function seedFee(feeId: string, spvId: string, currency: string, fixed: number) {
  const now = new Date().toISOString();
  rawDb()
    .prepare(
      `INSERT OR REPLACE INTO spv_fee
         (id, spv_id, layer, fee_type, fixed_amount_minor, carry_pct, currency,
          effective_date, set_by, created_at, prev_hash, curr_hash)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(feeId, spvId, "spv", "fixed", fixed, null, currency, now, "prt_bug1", now, HASH0, `hash_${feeId}`);
}

function spvAmounts(id: string) {
  return rawDb()
    .prepare(`SELECT target_raise_minor AS t, min_check_minor AS m, cap_minor AS c FROM spv WHERE id = ?`)
    .get(id) as { t: number; m: number; c: number };
}

let artifactDir: string;

describe("W-FIX2a SPV-BUG-1 — reversible ×10^exp migration", () => {
  beforeAll(() => {
    getDb();
    artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), "spvbug1-"));
  });
  afterAll(() => {
    try { fs.rmSync(artifactDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it("scales a buggy-path record (target displays as $5,000 → true $500,000) incl. its fee", () => {
    // $500,000 entered but stored as 500000 minor (bug) → displays $5,000.
    seedSpv("spv_bug_a", "USD", 500000, 100000, 1000000);
    seedFee("fee_bug_a", "spv_bug_a", "USD", 25000); // $250 shown, true $25,000

    const res = migrateSpvBug1({ artifactDir });
    expect(res.changedSpvIds).toContain("spv_bug_a");

    const after = spvAmounts("spv_bug_a");
    expect(after.t).toBe(50000000); // $500,000.00
    expect(after.m).toBe(10000000);
    expect(after.c).toBe(100000000);

    const fee = rawDb()
      .prepare(`SELECT fixed_amount_minor AS f FROM spv_fee WHERE id = ?`)
      .get("fee_bug_a") as { f: number };
    expect(fee.f).toBe(2500000); // $25,000.00
  });

  it("leaves a plausible institutional record untouched (magnitude guard)", () => {
    // $500,000 correctly stored as 50,000,000 minor → displays $500,000; NOT buggy.
    seedSpv("spv_ok_b", "USD", 50000000, 10000000, 100000000);
    const res = migrateSpvBug1();
    expect(res.changedSpvIds).not.toContain("spv_ok_b");
    const after = spvAmounts("spv_ok_b");
    expect(after.t).toBe(50000000);
  });

  it("never touches a 0-decimal currency (JPY has no minor unit)", () => {
    seedSpv("spv_jpy_c", "JPY", 5000, 1000, 10000);
    const res = migrateSpvBug1();
    expect(res.changedSpvIds).not.toContain("spv_jpy_c");
    expect(spvAmounts("spv_jpy_c").t).toBe(5000);
  });

  it("down-migration restores the exact prior values", () => {
    seedSpv("spv_bug_d", "USD", 750000, null, null);
    const up = migrateSpvBug1();
    expect(up.changedSpvIds).toContain("spv_bug_d");
    expect(spvAmounts("spv_bug_d").t).toBe(75000000);

    const reverted = revertSpvBug1Migration(up);
    expect(reverted).toBeGreaterThanOrEqual(1);
    expect(spvAmounts("spv_bug_d").t).toBe(750000);
  });

  it("is idempotent — a second up-run does not re-scale corrected records", () => {
    seedSpv("spv_bug_e", "USD", 300000, null, null);
    const first = migrateSpvBug1();
    expect(first.changedSpvIds).toContain("spv_bug_e");
    expect(spvAmounts("spv_bug_e").t).toBe(30000000); // $300,000, now plausible

    const second = migrateSpvBug1();
    expect(second.changedSpvIds).not.toContain("spv_bug_e");
    expect(spvAmounts("spv_bug_e").t).toBe(30000000);
  });

  it("emits the three artifacts", () => {
    migrateSpvBug1({ artifactDir });
    expect(fs.existsSync(path.join(artifactDir, "spv_bug1_migration_up.json"))).toBe(true);
    expect(fs.existsSync(path.join(artifactDir, "spv_bug1_migration_down.json"))).toBe(true);
    const md = fs.readFileSync(path.join(artifactDir, "spv_bug1_corrected.md"), "utf8");
    expect(md).toContain("SPV-BUG-1");
  });
});
