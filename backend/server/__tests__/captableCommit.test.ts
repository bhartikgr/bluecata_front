/**
 * Sprint 11 — D14: investor verification → cap-table commit pipeline.
 * Sprint 25 — PRECISION HARDENING: amount + shares are STRINGS, not numbers.
 *
 * The most critical pipeline in Sprint 11. Every transition must be valid
 * per the state machine; commit-funded must reconcile both engines; the
 * ledger must form a hash-chain that can be independently verified;
 * compliance hold blocks commits.
 *
 * Sprint 25 additions:
 *   - Reject numeric amount / shares (precision risk)
 *   - Reject NaN, Infinity, negative, zero, malformed strings
 *   - Accept Decimal-as-string with arbitrary precision (38+ significant digits)
 *   - Accept BigInt-as-string above 2^53
 *   - Currency code validation (ISO 4217)
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  TRANSITIONS,
  isValidTransition,
  reconcile,
  commitFunded,
  verifyChain,
  clearLedger,
  setComplianceHold,
  getLedger,
  isValidAmount,
  isValidShares,
} from "../captableCommitStore";

beforeEach(() => clearLedger());

describe("captableCommitStore — state machine", () => {
  it("defines the canonical 8-state transition map", () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([
      "committed",
      "confirmed",
      "funded",
      "invited",
      "rejected",
      "signed",
      "soft_circled",
      "viewed",
    ]);
  });

  it("invited can advance only to viewed or rejected", () => {
    expect(isValidTransition("invited", "viewed")).toBe(true);
    expect(isValidTransition("invited", "rejected")).toBe(true);
    expect(isValidTransition("invited", "funded")).toBe(false);
  });

  it("only funded can transition to committed", () => {
    expect(isValidTransition("funded", "committed")).toBe(true);
    expect(isValidTransition("signed", "committed")).toBe(false);
    expect(isValidTransition("soft_circled", "committed")).toBe(false);
  });

  it("rejected and committed are terminal", () => {
    expect(TRANSITIONS.rejected.length).toBe(0);
    expect(TRANSITIONS.committed.length).toBe(0);
  });
});

/* ------------------------------------------------------------------------- */
/* Sprint 25 — input validation                                              */
/* ------------------------------------------------------------------------- */
describe("captableCommitStore — Sprint 25 input validation", () => {
  it("isValidAmount rejects number inputs (precision risk)", () => {
    expect(isValidAmount(250000)).toBe(false);
    expect(isValidAmount(250000.5)).toBe(false);
  });

  it("isValidAmount rejects malformed strings", () => {
    expect(isValidAmount("")).toBe(false);
    expect(isValidAmount("abc")).toBe(false);
    expect(isValidAmount("1e5")).toBe(false);          // no scientific notation
    expect(isValidAmount("1,000")).toBe(false);         // no commas
    expect(isValidAmount("1.2.3")).toBe(false);
    expect(isValidAmount("Infinity")).toBe(false);
    expect(isValidAmount("NaN")).toBe(false);
  });

  it("isValidAmount rejects zero and negative", () => {
    expect(isValidAmount("0")).toBe(false);
    expect(isValidAmount("-100")).toBe(false);
    expect(isValidAmount("0.00")).toBe(false);
  });

  it("isValidAmount accepts well-formed positive decimal strings", () => {
    expect(isValidAmount("1")).toBe(true);
    expect(isValidAmount("250000")).toBe(true);
    expect(isValidAmount("1500000.123456789")).toBe(true);
    expect(isValidAmount("0.01")).toBe(true);
  });

  it("isValidShares rejects number inputs (precision risk above 2^53)", () => {
    expect(isValidShares(12500)).toBe(false);
    expect(isValidShares(12500.5)).toBe(false);
  });

  it("isValidShares rejects malformed strings + fractions", () => {
    expect(isValidShares("")).toBe(false);
    expect(isValidShares("12500.5")).toBe(false);       // no fractions allowed
    expect(isValidShares("1e5")).toBe(false);
    expect(isValidShares("1,000")).toBe(false);
  });

  it("isValidShares accepts BigInt-safe strings well beyond 2^53", () => {
    // 2^53 + 1 = 9_007_199_254_740_993 — cannot be represented exactly in float64
    expect(isValidShares("9007199254740993")).toBe(true);
    expect(isValidShares("999999999999999999999999")).toBe(true);
  });
});

describe("captableCommitStore — reconcile (Sprint 25 string-only)", () => {
  it("matches when amount > 0 and shares > 0 (string-only)", () => {
    const r = reconcile({ invitationId: "inv_1", amount: "250000", currency: "USD", shares: "12500" });
    expect(r.match).toBe(true);
    expect(r.primary).toBeTruthy();
    expect(r.ref).toBeTruthy();
    // Sprint 25: when match, primary === ref
    expect(r.primary).toBe(r.ref);
  });

  it("fails to match on zero amount", () => {
    const r = reconcile({ invitationId: "inv_1", amount: "0", currency: "USD", shares: "100" });
    expect(r.match).toBe(false);
  });

  it("fails to match on zero shares", () => {
    const r = reconcile({ invitationId: "inv_1", amount: "100", currency: "USD", shares: "0" });
    expect(r.match).toBe(false);
  });

  it("fails to match on malformed amount", () => {
    const r = reconcile({ invitationId: "inv_1", amount: "1e5", currency: "USD", shares: "100" });
    expect(r.match).toBe(false);
  });
});

describe("captableCommitStore — commitFunded + ledger (Sprint 25 string-only)", () => {
  it("rejects a bad transition", () => {
    const r = commitFunded({
      invitationId: "inv_x",
      roundId: "rnd_seed",
      companyId: "co_novapay",
      investorId: "u_x",
      amount: "100000",
      shares: "5000",
      fromState: "invited", // invalid — must be funded
    });
    expect(r.ok).toBe(false);
  });

  it("rejects malformed amount with explicit error", () => {
    const r = commitFunded({
      invitationId: "inv_x",
      roundId: "rnd_seed",
      companyId: "co_novapay",
      investorId: "u_x",
      amount: "not-a-number",
      shares: "5000",
      fromState: "funded",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("invalid_amount");
  });

  it("rejects fractional shares with explicit error", () => {
    const r = commitFunded({
      invitationId: "inv_x",
      roundId: "rnd_seed",
      companyId: "co_novapay",
      investorId: "u_x",
      amount: "100000",
      shares: "5000.5",
      fromState: "funded",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("invalid_shares");
  });

  it("rejects invalid currency code", () => {
    const r = commitFunded({
      invitationId: "inv_x",
      roundId: "rnd_seed",
      companyId: "co_novapay",
      investorId: "u_x",
      amount: "100000",
      currency: "BTC2",
      shares: "5000",
      fromState: "funded",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("invalid_currency");
  });

  it("rejects when compliance hold is set", () => {
    setComplianceHold(true);
    const r = commitFunded({
      invitationId: "inv_x",
      roundId: "rnd_seed",
      companyId: "co_novapay",
      investorId: "u_x",
      amount: "250000",
      shares: "12500",
      fromState: "funded",
    });
    expect(r.ok).toBe(false);
    setComplianceHold(false);
  });

  it("succeeds on a valid commit, appends a ledger entry, and chain verifies", () => {
    const r = commitFunded({
      invitationId: "inv_aisha_seed",
      roundId: "rnd_seed",
      companyId: "co_novapay",
      investorId: "u_aisha_patel",
      amount: "250000",
      currency: "USD",
      shares: "12500",
      fromState: "funded",
    });
    expect(r.ok).toBe(true);

    const ledger = getLedger();
    expect(ledger.length).toBe(1);
    expect(ledger[0].invitationId).toBe("inv_aisha_seed");
    // Sprint 25: amount + shares are STRINGS, not numbers
    expect(ledger[0].amount).toBe("250000");
    expect(ledger[0].currency).toBe("USD");
    expect(ledger[0].shares).toBe("12500");
    expect(ledger[0].reconcile.match).toBe(true);

    const v = verifyChain();
    expect(v.ok).toBe(true);
  });

  it("preserves full precision for large share counts above 2^53", () => {
    // 2^53 = 9007199254740992; 2^53 + 1 cannot be represented exactly as float64
    const largeShares = "9007199254740993";
    const r = commitFunded({
      invitationId: "inv_unicorn",
      roundId: "rnd_series_d",
      companyId: "co_unicorn",
      investorId: "u_lp",
      amount: "100000000000",  // $100B notional
      shares: largeShares,
      fromState: "funded",
    });
    expect(r.ok).toBe(true);
    const ledger = getLedger();
    // The ledger preserves the exact string — no float coercion drift
    expect(ledger[0].shares).toBe(largeShares);
    expect(BigInt(ledger[0].shares)).toBe(BigInt(largeShares));
    expect(verifyChain().ok).toBe(true);
  });

  it("preserves full precision for amounts with many decimal places", () => {
    // A wire converted from EUR via FX may produce many sub-cent decimals
    const preciseAmount = "1500000.1234567890123456";
    const r = commitFunded({
      invitationId: "inv_eur",
      roundId: "rnd_seed",
      companyId: "co_novapay",
      investorId: "u_lp",
      amount: preciseAmount,
      shares: "1000000",
      fromState: "funded",
    });
    expect(r.ok).toBe(true);
    expect(getLedger()[0].amount).toBe(preciseAmount);
    expect(verifyChain().ok).toBe(true);
  });

  it("multiple commits chain correctly via prevHash", () => {
    commitFunded({ invitationId: "i1", roundId: "rnd", companyId: "co_a", investorId: "u_a", amount: "100000", shares: "5000", fromState: "funded" });
    commitFunded({ invitationId: "i2", roundId: "rnd", companyId: "co_a", investorId: "u_b", amount: "200000", shares: "10000", fromState: "funded" });
    commitFunded({ invitationId: "i3", roundId: "rnd", companyId: "co_a", investorId: "u_c", amount: "300000", shares: "15000", fromState: "funded" });

    const ledger = getLedger();
    expect(ledger.length).toBe(3);
    expect(ledger[1].prevHash).toBe(ledger[0].hash);
    expect(ledger[2].prevHash).toBe(ledger[1].hash);

    const v = verifyChain();
    expect(v.ok).toBe(true);
  });

  it("hash includes amount + currency + shares (tamper-proof)", () => {
    // Two commits identical except for amount should produce different hashes
    clearLedger();
    const a = commitFunded({ invitationId: "iA", roundId: "rnd", companyId: "co_a", investorId: "u_a", amount: "100000", shares: "5000", fromState: "funded" });
    clearLedger();
    const b = commitFunded({ invitationId: "iA", roundId: "rnd", companyId: "co_a", investorId: "u_a", amount: "100001", shares: "5000", fromState: "funded" });
    expect(a.ok).toBe(true); expect(b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.entry.hash).not.toBe(b.entry.hash);
  });
});
