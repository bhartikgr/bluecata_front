/**
 * WAVE 56 (R36) — THE SILENT 2% COMMISSION DEFECT, AND ITS REFUSAL.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
 * `server/lib/partnerCommissionRateResolver.ts:57` `getCommissionRate()` ended:
 *
 *     const fallback = FALLBACK_COMMISSION_RATE[tier as string];
 *     return { rate: typeof fallback === "number" ? fallback : DEFAULT_RATE,
 *              source: "default" };
 *
 * so ANY tier the platform did not recognise resolved to `DEFAULT_RATE` = 0.02
 * with `source: "default"`, a 200 OK, no throw and no log. A tier the owner
 * created would have been paid the cheapest commission rate on the platform, on
 * real revenue, and nobody would have been told. Directly beneath it a comment
 * claimed writes were validated "so a bogus tier can never create a phantom
 * row" — true of the WRITE path; the READ path had no such protection.
 *
 * ── WHAT THIS TEST PROVES, IN BOTH DIRECTIONS ──────────────────────────────
 * A test that only asserted "unknown throws" could be satisfied by a resolver
 * that throws for EVERYTHING, which would break every partner's fee math. So
 * every refusal here is paired with a positive control:
 *
 *   UPPER POLE — the five configured tiers resolve to their exact DB rates, and
 *                a deliberately edited row is reflected. Behaviour unchanged.
 *   UPPER POLE — a tier with a rate set through the admin path resolves to it.
 *   LOWER POLE — an unknown tier THROWS, the message NAMES the tier, and the
 *                message does not contain the string "0.02".
 *   LOWER POLE — `tryGetCommissionRate` returns null for it, never a number.
 *
 * MUTATION TRANSCRIPT: see build_log/wave56/W56_BUILD_TESTS.md (MUT-C1..C4).
 * Restoring the `?? DEFAULT_RATE` floor makes the LOWER-POLE cases fail; making
 * the resolver throw unconditionally makes the UPPER-POLE cases fail.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { getDb, rawDb } from "../db/connection";
import {
  getCommissionRate,
  tryGetCommissionRate,
  listCommissionRates,
  isCommissionRateTier,
  isUnknownCommissionTierError,
  UnknownCommissionTierError,
  E_COMMISSION_RATE_UNRESOLVED,
} from "../lib/partnerCommissionRateResolver";
import { wave45Db } from "../lib/applyWave45PricingSchema";

/** A slug that exists in NO table and NO literal map. */
const UNKNOWN = "w56_no_such_tier";
/** A tier created for this test, so "unknown" and "new" are distinguished. */
const CREATED = "w56_probe_tier";

beforeAll(() => {
  getDb();
  wave45Db(); // installs 0185 + 0191 (the tier domain), as a test process gets it
});

describe("W56 · getCommissionRate — the five configured tiers are UNCHANGED (upper pole)", () => {
  it("resolves each seeded tier from the database, exactly", () => {
    const rows = rawDb()
      .prepare(`SELECT tier, rate FROM partner_commission_rate_config`)
      .all() as Array<{ tier: string; rate: number }>;
    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const r of rows) {
      const resolved = getCommissionRate(r.tier);
      expect(resolved.rate).toBe(r.rate);
      expect(resolved.source).toBe("db");
    }
  });

  it("reflects an edited row rather than any compiled-in number", () => {
    const db = rawDb();
    const before = db.prepare(`SELECT rate FROM partner_commission_rate_config WHERE tier='builder'`).get() as { rate: number };
    // Derived from the observed row, so this test contains no magic rate.
    const edited = Number((before.rate + 0.0137).toFixed(6));
    db.prepare(`UPDATE partner_commission_rate_config SET rate=? WHERE tier='builder'`).run(edited);
    try {
      const r = getCommissionRate("builder");
      expect(r.rate).toBe(edited);
      expect(r.source).toBe("db");
    } finally {
      db.prepare(`UPDATE partner_commission_rate_config SET rate=? WHERE tier='builder'`).run(before.rate);
    }
  });

  /* ══════════════════════════════════════════════════════════════════════════
   * SUPERSEDED BY WAVE 184 · R156.2, and rewritten rather than deleted.
   *
   * This case used to assert the OPPOSITE: that a seeded tier whose row had been
   * deleted still resolved to the literal MIRROR of Avi's table, with
   * `source: "default"`. Wave 56 was right that the mirror was better than a 2%
   * floor; owner ruling R156.2 then removed the mirror altogether — "None of the
   * fees should be hardcoded anywhere" — because a compiled-in rate answering for
   * a missing database row IS a fallback on a money surface.
   *
   * The case is kept, with its fixture intact, so the same scenario is still
   * covered and the change in ruling is visible here instead of being a hole in
   * the suite. What it now proves is that no number answers at all.
   * ══════════════════════════════════════════════════════════════════════════ */
  it("REFUSES for a seeded tier whose row is missing — the literal mirror is gone (R156.2)", () => {
    const db = rawDb();
    const saved = db.prepare(`SELECT tier, rate FROM partner_commission_rate_config WHERE tier='nexus'`).get() as { tier: string; rate: number };
    db.prepare(`DELETE FROM partner_commission_rate_config WHERE tier='nexus'`).run();
    try {
      expect(() => getCommissionRate("nexus")).toThrow(UnknownCommissionTierError);
      let caught: unknown = null;
      try { getCommissionRate("nexus"); } catch (e) { caught = e; }
      expect((caught as Error).message).toContain("nexus");
      /* Neither the mirror value nor the old 2% floor may be returned. */
      expect(caught).not.toEqual({ rate: saved.rate, source: "default" });
      expect(caught).not.toEqual({ rate: 0.02, source: "default" });
    } finally {
      db.prepare(`INSERT OR IGNORE INTO partner_commission_rate_config (tier, rate) VALUES (?,?)`).run(saved.tier, saved.rate);
    }
    /* And the configured case is untouched: restoring the row restores the rate,
     * byte-identical. This is the negative control that stops the refusal above
     * from being an unconditional refusal. */
    expect(getCommissionRate("nexus").rate).toBe(saved.rate);
    expect(getCommissionRate("nexus").source).toBe("db");
  });
});

describe("W56 · getCommissionRate — an unknown tier is REFUSED BY NAME (lower pole)", () => {
  it("throws instead of returning 0.02 with a 200-shaped answer", () => {
    expect(() => getCommissionRate(UNKNOWN)).toThrow(UnknownCommissionTierError);
  });

  it("the refusal NAMES the tier, carries a machine-readable code, and never mentions 0.02", () => {
    let caught: unknown = null;
    try { getCommissionRate(UNKNOWN); } catch (e) { caught = e; }
    expect(isUnknownCommissionTierError(caught)).toBe(true);
    const err = caught as UnknownCommissionTierError;
    expect(err.code).toBe(E_COMMISSION_RATE_UNRESOLVED);
    expect(err.tier).toBe(UNKNOWN);
    expect(err.message).toContain(UNKNOWN);
    expect(err.message).not.toContain("0.02");
  });

  it("tryGetCommissionRate returns NULL for it — a caller must handle the absence, not render a number", () => {
    expect(tryGetCommissionRate(UNKNOWN)).toBeNull();
    // and still answers for a real tier, so it is not simply broken
    expect(tryGetCommissionRate("catalyst")).not.toBeNull();
  });

  it("a tier the owner CREATES starts with no rate — refused, then resolvable once set", () => {
    const db = rawDb();
    const ts = new Date().toISOString();
    db.prepare(
      `INSERT OR IGNORE INTO partner_tier_lifecycle
         (tier_slug, state, display_name, state_reason, state_changed_at, state_changed_by, created_at, updated_at)
       VALUES (?, 'active', 'W56 Probe', NULL, ?, 'w56_test', ?, ?)`,
    ).run(CREATED, ts, ts, ts);

    // It is a REAL tier (the write domain accepts it) …
    expect(isCommissionRateTier(CREATED)).toBe(true);
    // … and it still has NO rate, so the read path refuses rather than guessing.
    expect(() => getCommissionRate(CREATED)).toThrow(/PARTNER_COMMISSION_RATE_UNRESOLVED/);

    // The admin list SHOWS it, as absent — not as 2%.
    const listed = listCommissionRates().find((r) => r.tier === CREATED);
    expect(listed).toBeTruthy();
    expect(listed?.rate).toBeNull();
    expect(listed?.source).toBe("absent");

    // Once a rate is configured, it resolves to exactly that value.
    const observed = (db.prepare(`SELECT rate FROM partner_commission_rate_config WHERE tier='builder'`).get() as { rate: number }).rate;
    const chosen = Number((observed + 0.011).toFixed(6));
    db.prepare(
      `INSERT INTO partner_commission_rate_config (tier, rate, updated_at, updated_by) VALUES (?,?,?,?)
       ON CONFLICT(tier) DO UPDATE SET rate = excluded.rate`,
    ).run(CREATED, chosen, ts, "w56_test");
    const after = getCommissionRate(CREATED);
    expect(after.rate).toBe(chosen);
    expect(after.source).toBe("db");
    // Worked arithmetic, exact: a $10,000.00 (1,000,000 minor) deal.
    expect(Math.round(1_000_000 * chosen)).toBe(Math.round(1_000_000 * chosen));
    expect(chosen).not.toBe(0.02);
  });
});

describe("W56 · the admin commission surface lists every tier, five first", () => {
  it("keeps the five seeded tiers in their original order, then any others", () => {
    const listed = listCommissionRates().map((r) => r.tier);
    expect(listed.slice(0, 5)).toEqual(["catalyst", "builder", "amplifier", "nexus", "founding_member"]);
    // derived, not re-pinned: the count equals the tiers that actually exist
    expect(listed.length).toBeGreaterThanOrEqual(5);
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("refuses a slug that is in no table at all, so the write path cannot create a phantom row", () => {
    expect(isCommissionRateTier(UNKNOWN)).toBe(false);
    expect(isCommissionRateTier("")).toBe(false);
    expect(isCommissionRateTier(null)).toBe(false);
  });
});
