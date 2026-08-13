/**
 * WAVE 35 · F5 (sites 3 and 4) — the MIGRATION BACKFILL poles.
 *
 * `backfillLegacyChildCommitments()` re-reads legacy `kv_partnerSpvPositions`
 * and `kv_partnerFundCommitments` rows and applies `fxRateToSpvBase` /
 * `fxRateToFundBase` before shadow-persisting each one as an engine
 * subscription. Both sites did `Math.round(minor * rate)` with no exponent
 * re-scale — so a one-time, irreversible migration would have written every
 * JPY→USD commitment into the canonical engine 100× too small.
 *
 * These two sites are guarded by an idempotency marker
 * (`_migrations_applied` key `wave_b_child_backfill_v1`), so this file
 * establishes its own precondition by clearing that marker — it never reads
 * `process.env` and never depends on boot ordering.
 *
 * Poles asserted: JPY→USD (100× — the fix), EUR→USD (unchanged — nothing
 * broken), and UNCONVERTIBLE (a rate with an unknown currency pair is
 * quarantined, never guessed and never raw-summed).
 */
import { describe, it, expect, beforeEach } from "vitest";

import { createHash } from "node:crypto";

import { rawDb } from "../db/connection";
import {
  backfillLegacyChildCommitments,
  shadowPersistPartnerSpvToEngine,
  spvEngineStore,
} from "../spvEngineStore";

const ACTOR = "u_w35_bf";
const PARTNER = "ptnr_w35_bf";
const JPY_USD = "0.0067";
const EUR_USD = "1.09";

function clearBackfillMarker(): void {
  rawDb()
    .prepare("DELETE FROM _migrations_applied WHERE key = 'wave_b_child_backfill_v1'")
    .run();
}

function seedLegacyPosition(row: {
  id: string;
  partnerSpvId: string;
  lpContactId: string;
  positionAmountMinor: number;
  currency?: string;
  fxRateToSpvBase?: string;
}): void {
  const db = rawDb();
  db.prepare(
    `CREATE TABLE IF NOT EXISTS kv_partnerSpvPositions (
       id TEXT PRIMARY KEY NOT NULL,
       payload_json TEXT NOT NULL,
       updated_at TEXT NOT NULL,
       deleted_at TEXT
     )`,
  ).run();
  db.prepare(
    `INSERT OR REPLACE INTO kv_partnerSpvPositions (id, payload_json, updated_at, deleted_at)
     VALUES (?, ?, ?, NULL)`,
  ).run(row.id, JSON.stringify({ ...row, positionStatus: "committed" }), new Date().toISOString());
}

/** Put a parent SPV into the engine under the id the backfill will look up. */
function seedEngineParent(legacySpvId: string, currency: string): void {
  shadowPersistPartnerSpvToEngine({
    legacyId: legacySpvId,
    partnerId: PARTNER,
    name: `W35 BF parent ${legacySpvId}`,
    currency,
    jurisdiction: "DE",
    recordedBy: ACTOR,
    status: "open",
  });
}

/** The engine's deterministic migration id, mirrored from `_migId`. */
function engineIdFor(legacySpvId: string): string {
  return `spv_mig_${createHash("sha256").update(legacySpvId).digest("hex").slice(0, 24)}`;
}

function subscriptionsOf(legacySpvId: string) {
  return spvEngineStore.listSubscriptions(PARTNER, engineIdFor(legacySpvId));
}

beforeEach(() => {
  clearBackfillMarker();
});

describe("W35-F5-BF — the migration backfill re-scales by BOTH exponents", () => {
  it("BF1 JPY POLE: ¥1,000,000 @0.0067 backfills as 670,000 USD minor, not 6,700", () => {
    const legacySpv = "pspv_w35_bf_jpy";
    seedEngineParent(legacySpv, "USD");
    seedLegacyPosition({
      id: "pos_w35_bf_jpy",
      partnerSpvId: legacySpv,
      lpContactId: "lp_w35_bf_1",
      positionAmountMinor: 1_000_000,
      currency: "JPY",
      fxRateToSpvBase: JPY_USD,
    });

    const r = backfillLegacyChildCommitments();
    expect(r.lost).toBe(0);

    const subs = subscriptionsOf(legacySpv);
    const mine = subs.find((s) => s.investorId === "lp_w35_bf_1");
    expect(mine).toBeTruthy();
    expect(mine!.commitmentMinor).toBe(670_000);
    // THE DEFECT'S MIGRATED VALUE — irreversible once the marker is set.
    expect(mine!.commitmentMinor).not.toBe(6_700);
  });

  it("BF2 EUR POLE: same exponent — the backfill result is unchanged", () => {
    const legacySpv = "pspv_w35_bf_eur";
    seedEngineParent(legacySpv, "USD");
    seedLegacyPosition({
      id: "pos_w35_bf_eur",
      partnerSpvId: legacySpv,
      lpContactId: "lp_w35_bf_2",
      positionAmountMinor: 1_000_000,
      currency: "EUR",
      fxRateToSpvBase: EUR_USD,
    });

    backfillLegacyChildCommitments();

    const mine = subscriptionsOf(legacySpv).find((s) => s.investorId === "lp_w35_bf_2");
    expect(mine).toBeTruthy();
    expect(mine!.commitmentMinor).toBe(1_090_000);
  });

  it("BF3 SAME-CURRENCY POLE: no rate, no conversion, exact passthrough", () => {
    const legacySpv = "pspv_w35_bf_same";
    seedEngineParent(legacySpv, "USD");
    seedLegacyPosition({
      id: "pos_w35_bf_same",
      partnerSpvId: legacySpv,
      lpContactId: "lp_w35_bf_3",
      positionAmountMinor: 4_200_000,
      currency: "USD",
    });

    backfillLegacyChildCommitments();

    const mine = subscriptionsOf(legacySpv).find((s) => s.investorId === "lp_w35_bf_3");
    expect(mine!.commitmentMinor).toBe(4_200_000);
  });

  it("BF4 UNCONVERTIBLE POLE: a rate with no source currency is quarantined, not guessed", () => {
    const legacySpv = "pspv_w35_bf_unk";
    seedEngineParent(legacySpv, "USD");
    seedLegacyPosition({
      id: "pos_w35_bf_unk",
      partnerSpvId: legacySpv,
      lpContactId: "lp_w35_bf_4",
      positionAmountMinor: 1_000_000,
      fxRateToSpvBase: JPY_USD, // rate present, currency ABSENT
    });

    const r = backfillLegacyChildCommitments();
    expect(r.quarantined).toBeGreaterThan(0);

    const mine = subscriptionsOf(legacySpv).find((s) => s.investorId === "lp_w35_bf_4");
    // Neither the raw amount nor a guessed conversion may reach the engine.
    expect(mine).toBeUndefined();
  });
});
