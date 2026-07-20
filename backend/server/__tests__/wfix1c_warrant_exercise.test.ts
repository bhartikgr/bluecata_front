/**
 * W-FIX1c (2026-07-19) — warrant EXERCISE lifecycle (A5).
 *
 * Warrants are granted as priced-via-strike securities but had NO exercise
 * event to actually issue shares. This suite locks the added lifecycle:
 *   - cash exercise     → issues `qty` shares at the strike, via sacred commitFunded
 *   - cashless exercise → issues NET shares `floor(qty×(FMV−strike)/FMV)`, zero cash
 *   - expiry            → issues NO shares
 *   - fully-diluted     → correct share math pre/post exercise
 *
 * Share issuance goes through the SACRED commitFunded path (only CALLED); the
 * money ledger is READ, never written directly.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { clearLedger, listMembersForCompany } from "../captableCommitStore";
import { createRound } from "../roundsStore";
import { computeNetShares, computeExercise, exerciseWarrant, deterministicExerciseKey } from "../lib/warrantExercise";

function warrantRound(companyId: string, strike: number) {
  return createRound({
    companyId,
    name: `Warrants ${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: "seed",
    instrument: "warrant",
    extras: { strikePrice: strike },
  });
}

function committedShares(companyId: string): bigint {
  const rows = (listMembersForCompany(companyId) ?? []) as ReadonlyArray<{ shares?: string }>;
  return rows.reduce((sum, r) => sum + BigInt(r.shares && /^\d+$/.test(r.shares) ? r.shares : "0"), 0n);
}

/** Number of committed ledger rows for a given holder on a given round. */
function rowCountFor(companyId: string, roundId: string, investorId: string): number {
  const rows = (listMembersForCompany(companyId) ?? []) as ReadonlyArray<{ roundId?: string; investorId?: string }>;
  return rows.filter((r) => r.roundId === roundId && r.investorId === investorId).length;
}

beforeEach(() => clearLedger());

describe("A5 — computeNetShares (pure cashless math)", () => {
  it("floor(qty × (FMV − strike) / FMV)", () => {
    // 1000 × (5 − 2) / 5 = 600
    expect(computeNetShares(1000, 5, 2)).toBe("600");
  });
  it("out-of-the-money (FMV <= strike) yields 0", () => {
    expect(computeNetShares(1000, 2, 2)).toBe("0");
    expect(computeNetShares(1000, 1, 2)).toBe("0");
  });
  it("floors fractional net shares", () => {
    // 3 × (10 − 7) / 10 = 0.9 → floor → 0
    expect(computeNetShares(3, 10, 7)).toBe("0");
    // 7 × (10 − 3) / 10 = 4.9 → 4
    expect(computeNetShares(7, 10, 3)).toBe("4");
  });
});

describe("A5 — computeExercise (pure, reads round)", () => {
  it("cash exercise: shares = qty, cash = qty × strike", () => {
    const companyId = `co_wex_${Date.now()}`;
    const r = warrantRound(companyId, 2);
    const c = computeExercise({ companyId, roundId: r.id, investorId: "u_h", quantity: 1000, mode: "cash" });
    expect(c.sharesIssued).toBe("1000");
    expect(c.cashPaid).toBe("2000");
    // reconcile basis = strike (warrant round has no pps)
    expect(c.ledgerAmount).toBe("2000");
  });
  it("expiry: no shares, no cash", () => {
    const companyId = `co_wex_${Date.now()}`;
    const r = warrantRound(companyId, 2);
    const c = computeExercise({ companyId, roundId: r.id, investorId: "u_h", quantity: 1000, mode: "expire" });
    expect(c.sharesIssued).toBe("0");
    expect(c.cashPaid).toBe("0");
  });
});

describe("A5 — exerciseWarrant (issues via sacred commitFunded)", () => {
  it("cash exercise issues qty shares at strike into the ledger", () => {
    const companyId = `co_wex_${Date.now()}_a`;
    const r = warrantRound(companyId, 2);
    expect(committedShares(companyId)).toBe(0n);
    const res = exerciseWarrant({ companyId, roundId: r.id, investorId: "u_holder", quantity: 1000, mode: "cash" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.sharesIssued).toBe("1000");
      expect(res.cashPaid).toBe("2000");
      expect(res.expired).toBe(false);
    }
    expect(committedShares(companyId)).toBe(1000n);
  });

  it("cashless exercise issues NET shares and zero cash", () => {
    const companyId = `co_wex_${Date.now()}_b`;
    const r = warrantRound(companyId, 2);
    const res = exerciseWarrant({ companyId, roundId: r.id, investorId: "u_holder", quantity: 1000, mode: "cashless", fmv: 5 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.sharesIssued).toBe("600");
      expect(res.cashPaid).toBe("0");
    }
    expect(committedShares(companyId)).toBe(600n);
  });

  it("cashless requires an FMV", () => {
    const companyId = `co_wex_${Date.now()}_c`;
    const r = warrantRound(companyId, 2);
    const res = exerciseWarrant({ companyId, roundId: r.id, investorId: "u_holder", quantity: 1000, mode: "cashless" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("fmv_required_for_cashless");
  });

  it("expired warrant issues NO shares", () => {
    const companyId = `co_wex_${Date.now()}_d`;
    const r = warrantRound(companyId, 2);
    const res = exerciseWarrant({ companyId, roundId: r.id, investorId: "u_holder", quantity: 1000, mode: "expire" });
    expect(res.ok).toBe(true);
    if (res.ok) { expect(res.sharesIssued).toBe("0"); expect(res.expired).toBe(true); }
    expect(committedShares(companyId)).toBe(0n);
  });

  it("fully-diluted math: cash then cashless accumulate correctly", () => {
    const companyId = `co_wex_${Date.now()}_e`;
    const r = warrantRound(companyId, 2);
    exerciseWarrant({ companyId, roundId: r.id, investorId: "u_a", quantity: 500, mode: "cash" });
    exerciseWarrant({ companyId, roundId: r.id, investorId: "u_b", quantity: 1000, mode: "cashless", fmv: 5 });
    // 500 (cash) + 600 (net of 1000 @ FMV 5, strike 2) = 1100
    expect(committedShares(companyId)).toBe(1100n);
  });

  it("unknown round fails cleanly", () => {
    const res = exerciseWarrant({ companyId: "co_x", roundId: "rnd_missing", investorId: "u_h", quantity: 10, mode: "cash" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("round_not_found");
  });
});

describe("A5 — deterministic idempotency key (retry cannot double-issue)", () => {
  it("same exercise request yields a stable key; differing inputs differ", () => {
    const base = { companyId: "co_k", roundId: "rnd_1", investorId: "u_a", quantity: 1000, mode: "cash" as const };
    expect(deterministicExerciseKey(base)).toBe(deterministicExerciseKey({ ...base }));
    // floored quantity is stable across equal numeric forms
    expect(deterministicExerciseKey({ ...base, quantity: "1000" })).toBe(deterministicExerciseKey(base));
    // any distinguishing field changes the key
    expect(deterministicExerciseKey({ ...base, mode: "cashless" })).not.toBe(deterministicExerciseKey(base));
    expect(deterministicExerciseKey({ ...base, investorId: "u_b" })).not.toBe(deterministicExerciseKey(base));
    expect(deterministicExerciseKey({ ...base, roundId: "rnd_2" })).not.toBe(deterministicExerciseKey(base));
    expect(deterministicExerciseKey({ ...base, quantity: 999 })).not.toBe(deterministicExerciseKey(base));
    // no Date.now() suffix — the key contains no timestamp digits beyond the inputs
    expect(deterministicExerciseKey(base)).toBe("wex_rnd_1_u_a_cash_1000");
  });

  it("a retried identical exercise (no explicit invitationId) does NOT double-issue", () => {
    const companyId = `co_wex_${Date.now()}_idem`;
    const r = warrantRound(companyId, 2);
    const req = { companyId, roundId: r.id, investorId: "u_holder", quantity: 1000, mode: "cash" as const };

    const first = exerciseWarrant(req);
    expect(first.ok).toBe(true);
    expect(committedShares(companyId)).toBe(1000n);
    expect(rowCountFor(companyId, r.id, "u_holder")).toBe(1);

    // Same request again → deterministic key → same ledger id → unique-constraint
    // rejects the duplicate insert. No second row, no doubled shares.
    const second = exerciseWarrant(req);
    expect(second.ok).toBe(false);
    expect(committedShares(companyId)).toBe(1000n);
    expect(rowCountFor(companyId, r.id, "u_holder")).toBe(1);
  });
});

describe("A5 — fully-diluted correctness across the warrant lifecycle (no double-count)", () => {
  // The issued cap-table ledger (listMembersForCompany) is the authoritative
  // record. A granted-but-UNEXERCISED warrant creates no committed ledger row
  // (its dilution is tracked as potential shares, separate from the ledger).
  // Exercising issues exactly ONE row via the sacred commitFunded path, so the
  // holding is counted ONCE (as issued), never twice (grant + issued).
  it("outstanding warrant contributes 0 issued rows; exercise counts exactly once", () => {
    const companyId = `co_wex_${Date.now()}_fd`;
    const r = warrantRound(companyId, 2);

    // OUTSTANDING (granted, not exercised): no issued row yet.
    expect(committedShares(companyId)).toBe(0n);
    expect(rowCountFor(companyId, r.id, "u_holder")).toBe(0);

    // EXERCISE: shares appear exactly once.
    const res = exerciseWarrant({ companyId, roundId: r.id, investorId: "u_holder", quantity: 1000, mode: "cash" });
    expect(res.ok).toBe(true);
    expect(committedShares(companyId)).toBe(1000n);
    expect(rowCountFor(companyId, r.id, "u_holder")).toBe(1);

    // A repeat of the SAME exercise does not add a second (grant+issued) row.
    exerciseWarrant({ companyId, roundId: r.id, investorId: "u_holder", quantity: 1000, mode: "cash" });
    expect(committedShares(companyId)).toBe(1000n);
    expect(rowCountFor(companyId, r.id, "u_holder")).toBe(1);
  });
});
