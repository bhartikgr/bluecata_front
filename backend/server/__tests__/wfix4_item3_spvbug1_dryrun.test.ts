/**
 * W-FIX4 item 3 — SPV-BUG-1 migration safety hardening.
 *
 * Covers the additive controls layered on top of the W-FIX2a migration:
 *   (1) dryRun computes the full before→after ledger + emits artifacts but
 *       writes NO rows (DB values unchanged, result.dryRun === true);
 *   (2) denyList skips listed SPV ids even when they match the bug heuristic;
 *   (3) allowList restricts processing to listed SPV ids only.
 * Detection/scaling math is unchanged (a matching, non-listed row still scales).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { rawDb, getDb } from "../db/connection";
import { migrateSpvBug1 } from "../lib/spvBug1Migration";

const HASH0 = "0".repeat(64);

function seedSpv(id: string, currency: string, target: number, min: number, cap: number) {
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
      id, "prt_bug1_v4", null, `SPV ${id}`, "spv", "US", "draft",
      "private", target, min, cap, currency,
      "committed_capital", "own_only", null, null, null, null,
      now, "prt_bug1_v4", now, "prt_bug1_v4", null, HASH0, `hash_${id}`,
    );
}

function target(id: string): number {
  return (rawDb()
    .prepare(`SELECT target_raise_minor AS t FROM spv WHERE id = ?`)
    .get(id) as { t: number }).t;
}

let artifactDir: string;

describe("W-FIX4 item 3 — SPV-BUG-1 dryRun / denyList / allowList", () => {
  beforeAll(() => {
    getDb();
    artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), "spvbug1-v4-"));
  });
  afterAll(() => {
    try { fs.rmSync(artifactDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it("dryRun writes nothing but reports what it WOULD change + emits artifacts", () => {
    seedSpv("spv_v4_dry", "USD", 500000, 100000, 1000000); // buggy-path magnitude
    const res = migrateSpvBug1({ dryRun: true, artifactDir });

    expect(res.dryRun).toBe(true);
    expect(res.changedSpvIds).toContain("spv_v4_dry"); // detected as a candidate
    expect(res.changes.length).toBeGreaterThan(0);      // ledger populated

    // But the DB row is untouched.
    expect(target("spv_v4_dry")).toBe(500000);

    // Artifacts still written for review.
    expect(fs.existsSync(path.join(artifactDir, "spv_bug1_corrected.md"))).toBe(true);
    expect(fs.existsSync(path.join(artifactDir, "spv_bug1_migration_up.json"))).toBe(true);
  });

  it("a real (non-dry) run of the same shape DOES write — proving math is unchanged", () => {
    seedSpv("spv_v4_real", "USD", 500000, 100000, 1000000);
    const res = migrateSpvBug1({});
    expect(res.dryRun).toBe(false);
    expect(res.changedSpvIds).toContain("spv_v4_real");
    expect(target("spv_v4_real")).toBe(50000000);
  });

  it("denyList skips a matching SPV even in a committing run", () => {
    seedSpv("spv_v4_deny", "USD", 500000, 100000, 1000000);
    const res = migrateSpvBug1({ denyList: ["spv_v4_deny"] });
    expect(res.changedSpvIds).not.toContain("spv_v4_deny");
    expect(target("spv_v4_deny")).toBe(500000); // untouched
  });

  it("allowList restricts processing to listed ids only", () => {
    seedSpv("spv_v4_allow_yes", "USD", 500000, 100000, 1000000);
    seedSpv("spv_v4_allow_no", "USD", 400000, 100000, 900000);
    const res = migrateSpvBug1({ allowList: ["spv_v4_allow_yes"] });
    expect(res.changedSpvIds).toContain("spv_v4_allow_yes");
    expect(res.changedSpvIds).not.toContain("spv_v4_allow_no");
    expect(target("spv_v4_allow_yes")).toBe(50000000);
    expect(target("spv_v4_allow_no")).toBe(400000); // untouched
  });
});
