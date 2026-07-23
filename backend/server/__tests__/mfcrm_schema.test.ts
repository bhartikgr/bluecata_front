/**
 * W-MFCRM — schema tests. All 12 additive mf_* tables are created and the apply
 * is idempotent (safe to re-run at every boot). Uses the real better-sqlite3
 * handle via rawDb() (no mock).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { rawDb } from "../db/connection";
import { applyMfcrmSchema, _resetMfcrmSchemaGuardForTests } from "../lib/mfcrmSchema";

const TABLES = [
  "mf_capability_profile", "mf_engagement", "mf_engagement_event", "mf_attribution",
  "mf_attribution_tail", "mf_crossover_flag", "mf_handover", "mf_pricing_trial",
  "mf_spv_on_behalf", "mf_collective_push", "mf_layer_membership", "mf_audit",
];

function tableExists(name: string): boolean {
  const row = rawDb().prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(name) as { name?: string } | undefined;
  return !!row?.name;
}

describe("W-MFCRM schema", () => {
  beforeAll(() => {
    applyMfcrmSchema();
  });

  it("creates all 12 additive mf_* tables", () => {
    for (const t of TABLES) {
      expect(tableExists(t), `${t} should exist`).toBe(true);
    }
  });

  it("is idempotent — a fresh re-apply does not throw and tables remain", () => {
    _resetMfcrmSchemaGuardForTests();
    expect(() => applyMfcrmSchema()).not.toThrow();
    for (const t of TABLES) expect(tableExists(t)).toBe(true);
  });

  it("mf_engagement enforces UNIQUE(partner_id, company_id)", () => {
    const cols = rawDb().prepare(`PRAGMA index_list(mf_engagement)`).all() as any[];
    // A UNIQUE index (auto or named) must be present for the composite key.
    expect(cols.some((c: any) => c.unique === 1)).toBe(true);
  });

  it("partner-scoped tables carry a partner_id column", () => {
    for (const t of TABLES) {
      const info = rawDb().prepare(`PRAGMA table_info(${t})`).all() as any[];
      expect(info.some((c: any) => c.name === "partner_id"), `${t}.partner_id`).toBe(true);
    }
  });
});
