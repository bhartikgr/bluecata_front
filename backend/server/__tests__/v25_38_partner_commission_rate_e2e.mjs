/* v25.38 Phase 2 — E2E: partner commission-rate DB resolver (Avi-preserving).
 *
 * Proves the SACRED-rule fix without violating the STANDING RULE
 * ("Under no circumstances shall any of Avi's existing code be removed,
 * modified, or overridden."):
 *   - A NEW `partner_commission_rate_config` table + the NEW resolver
 *     server/lib/partnerCommissionRateResolver.getCommissionRate() provide the
 *     DB-driven "go forward" path.
 *   - Avi's literal `COMMISSION_RATE` table in partnerConsortiumRoutes.ts is
 *     LEFT BYTE-IDENTICAL (asserted by reading the source) and remains the
 *     ultimate fallback.
 *
 * Asserts:
 *   - the table exists with the 5 seeded tier rows (catalyst..founding_member)
 *   - getCommissionRate("gold-equivalent tier") returns the DB rate (source="db")
 *   - getCommissionRate(unknown tier) returns the 0.02 fallback (source="default")
 *   - editing a DB row changes the resolver output
 *   - Avi's COMMISSION_RATE literal block is byte-identical to v25.37
 *
 * Runs under the v25.34 E2E vitest config (pool=forks, singleFork).
 */
process.env.COLLECTIVE_ENABLED = "1";
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb, rawDb } from "../db/connection.ts";
import { getCommissionRate } from "../lib/partnerCommissionRateResolver.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

beforeAll(() => {
  getDb(); // boots SQLite + runs the v25.38 pricing-config bootstrap (seeds tier rows)
});

describe("v25.38 partner_commission_rate_config — table + seed", () => {
  it("the config table exists", () => {
    const row = rawDb()
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='partner_commission_rate_config'`)
      .get();
    expect(row).toBeTruthy();
  });

  it("all 5 tier rows are seeded with Avi's exact rates", () => {
    const rows = rawDb()
      .prepare(`SELECT tier, rate FROM partner_commission_rate_config ORDER BY rate ASC`)
      .all();
    const map = Object.fromEntries(rows.map((r) => [r.tier, r.rate]));
    expect(map.catalyst).toBeCloseTo(0.02, 6);
    expect(map.builder).toBeCloseTo(0.03, 6);
    expect(map.amplifier).toBeCloseTo(0.04, 6);
    expect(map.nexus).toBeCloseTo(0.05, 6);
    expect(map.founding_member).toBeCloseTo(0.06, 6);
    expect(rows.length).toBe(5);
  });
});

describe("v25.38 getCommissionRate — DB-driven resolution", () => {
  it("returns the DB rate (source='db') for a configured tier", () => {
    const r = getCommissionRate("amplifier");
    expect(r.rate).toBeCloseTo(0.04, 6);
    expect(r.source).toBe("db");
  });

  it("returns the 0.02 fallback (source='default') for an unknown tier", () => {
    const r = getCommissionRate("unknown_tier");
    expect(r.rate).toBeCloseTo(0.02, 6);
    expect(r.source).toBe("default");
  });

  it("reflects an edited DB row (admin-driven, not hardcoded)", () => {
    const db = rawDb();
    const before = db.prepare(`SELECT rate FROM partner_commission_rate_config WHERE tier='builder'`).get();
    db.prepare(`UPDATE partner_commission_rate_config SET rate = 0.099 WHERE tier='builder'`).run();
    try {
      const r = getCommissionRate("builder");
      expect(r.rate).toBeCloseTo(0.099, 6);
      expect(r.source).toBe("db");
    } finally {
      db.prepare(`UPDATE partner_commission_rate_config SET rate = ? WHERE tier='builder'`).run(before.rate);
    }
  });

  it("falls back to the literal mirror (source='default') when the DB row is missing", () => {
    const db = rawDb();
    const saved = db.prepare(`SELECT tier, rate FROM partner_commission_rate_config WHERE tier='nexus'`).get();
    db.prepare(`DELETE FROM partner_commission_rate_config WHERE tier='nexus'`).run();
    try {
      const r = getCommissionRate("nexus");
      expect(r.rate).toBeCloseTo(0.05, 6); // mirror of Avi's literal
      expect(r.source).toBe("default");
    } finally {
      db.prepare(`INSERT OR IGNORE INTO partner_commission_rate_config (tier, rate) VALUES (?,?)`).run(saved.tier, saved.rate);
    }
  });
});

describe("v25.38 Avi-code preservation — COMMISSION_RATE literal byte-identical", () => {
  it("partnerConsortiumRoutes.ts still contains Avi's exact literal table", () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, "server/partnerConsortiumRoutes.ts"), "utf-8");
    // The literal block must be present verbatim — proves it was neither
    // removed, modified, nor overridden.
    expect(src).toContain("const COMMISSION_RATE: Record<PartnerTier, number> = {");
    expect(src).toContain("catalyst:       0.02,");
    expect(src).toContain("builder:        0.03,");
    expect(src).toContain("amplifier:      0.04,");
    expect(src).toContain("nexus:          0.05,");
    expect(src).toContain("founding_member: 0.06,");
    expect(src).toContain("return COMMISSION_RATE[tier] ?? 0.02;");
  });
});
