/* v25.38 Phase 1 — E2E: collective application-fee DB resolver.
 *
 * Proves the SACRED-rule fix ("Pricing plans are determined from the Admin
 * area. They are never hardcoded."): the former ApplyToCollective.tsx literal
 * `const APPLICATION_FEE = 2_500` is promoted to a DB-driven value backed by
 * `collective_application_fee_config` and read via
 * server/lib/collectiveApplicationFeeResolver.getApplicationFeeMinor().
 *
 * Asserts:
 *   - the table exists with the seeded default row (id='default',
 *     amount_minor=2500, currency='USD') — created by the connection.ts
 *     bootstrap (applyV2538PricingConfigSchema) on DB open
 *   - getApplicationFeeMinor() returns the DB row (source="db") when present
 *   - getApplicationFeeMinor() returns the seed default (source="default")
 *     when the config row is missing
 *   - editing the DB row changes the resolver output (admin-driven contract)
 *
 * Runs under the v25.34 E2E vitest config (pool=forks, singleFork).
 */
process.env.COLLECTIVE_ENABLED = "1";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, rawDb } from "../db/connection.ts";
import {
  getApplicationFeeMinor,
  DEFAULT_APPLICATION_FEE_MINOR,
  DEFAULT_APPLICATION_FEE_CURRENCY,
} from "../lib/collectiveApplicationFeeResolver.ts";

beforeAll(() => {
  getDb(); // boots SQLite + runs the v25.38 pricing-config bootstrap (seeds default row)
});

describe("v25.38 collective_application_fee_config — table + seed", () => {
  it("the config table exists", () => {
    const row = rawDb()
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='collective_application_fee_config'`)
      .get();
    expect(row).toBeTruthy();
  });

  it("the seed default row is present (id='default', amount_minor=2500, currency='USD')", () => {
    const row = rawDb()
      .prepare(`SELECT id, amount_minor, currency FROM collective_application_fee_config WHERE id='default'`)
      .get();
    expect(row).toBeTruthy();
    expect(row.id).toBe("default");
    expect(row.amount_minor).toBe(2500);
    expect(row.currency).toBe("USD");
  });
});

describe("v25.38 getApplicationFeeMinor — DB-driven resolution", () => {
  it("returns the DB row with source='db' when the config row exists", () => {
    const r = getApplicationFeeMinor();
    expect(r.amountMinor).toBe(2500);
    expect(r.currency).toBe("USD");
    expect(r.source).toBe("db");
  });

  it("reflects an edited DB value (admin-driven, not hardcoded)", () => {
    const db = rawDb();
    const before = db.prepare(`SELECT amount_minor FROM collective_application_fee_config WHERE id='default'`).get();
    db.prepare(`UPDATE collective_application_fee_config SET amount_minor = 7500 WHERE id='default'`).run();
    try {
      const r = getApplicationFeeMinor();
      expect(r.amountMinor).toBe(7500);
      expect(r.source).toBe("db");
    } finally {
      db.prepare(`UPDATE collective_application_fee_config SET amount_minor = ? WHERE id='default'`).run(before.amount_minor);
    }
  });

  it("falls back to the seed DEFAULT (source='default') when the config row is missing", () => {
    const db = rawDb();
    const saved = db.prepare(`SELECT id, amount_minor, currency, updated_at, updated_by FROM collective_application_fee_config WHERE id='default'`).get();
    db.prepare(`DELETE FROM collective_application_fee_config WHERE id='default'`).run();
    try {
      const r = getApplicationFeeMinor();
      expect(r.amountMinor).toBe(DEFAULT_APPLICATION_FEE_MINOR);
      expect(r.currency).toBe(DEFAULT_APPLICATION_FEE_CURRENCY);
      expect(r.source).toBe("default");
    } finally {
      // restore the seed row for isolation
      db.prepare(`INSERT OR IGNORE INTO collective_application_fee_config (id, amount_minor, currency, updated_at, updated_by) VALUES (?,?,?,?,?)`)
        .run(saved.id, saved.amount_minor, saved.currency, saved.updated_at, saved.updated_by ?? null);
    }
  });

  it("the seed default equals the historical literal (2500) — displayed amount UNCHANGED", () => {
    expect(DEFAULT_APPLICATION_FEE_MINOR).toBe(2500);
  });
});
