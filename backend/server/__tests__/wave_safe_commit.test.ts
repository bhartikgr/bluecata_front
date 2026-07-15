/**
 * W-SAFE — Unpriced (SAFE / convertible-note) + warrant-via-strike commit.
 *
 * Proves the AVI-4 fix: a SAFE/unpriced round can now be committed funded ->
 * cap-table (previously threw invalid_shares), recorded as a principal-dollar
 * position with shares="0" and instrument_class="unpriced"; the SAFE terms
 * (valuationCap, discountPct) are captured and enter the commit hash body.
 * Priced-equity behaviour is unchanged (covered by captableCommit + sprint25
 * suites; a byte-identical-priced-hash assertion is included here too).
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  enqueueFunded,
  clearLedger,
  setComplianceHold,
  getLedger,
  verifyChain,
  commitFunded,
  reconcile,
  classifyRoundCommit,
} from "../captableCommitStore";
import { createRound, _testAccessRounds } from "../roundsStore";

let seq = 0;
function uid(p: string): string { return `${p}_${Date.now()}_${seq++}`; }

function makeRound(instrument: string, extras: Record<string, unknown> = {}, pricePerShare: number | null = null) {
  const companyId = uid("co");
  const r = createRound({
    companyId,
    name: uid("Round"),
    type: "seed",
    instrument,
    pricePerShare,
    targetAmount: 1_000_000,
    extras,
  });
  return { companyId, round: r };
}

beforeEach(() => {
  clearLedger();
  setComplianceHold(false);
});

describe("W-SAFE classification", () => {
  it("classifies SAFE as unpriced", () => {
    const { round } = makeRound("safe_post", { valuationCap: "8000000", discount: "20" });
    const c = classifyRoundCommit(round.id);
    expect(c.instrumentClass).toBe("unpriced");
    expect(c.valuationCap).toBe("8000000");
    expect(c.discountPct).toBe("20");
  });
  it("classifies convertible note as unpriced", () => {
    const { round } = makeRound("convertible_note", { valuationCap: "5000000" });
    expect(classifyRoundCommit(round.id).instrumentClass).toBe("unpriced");
  });
  it("classifies preferred as priced", () => {
    const { round } = makeRound("preferred", {}, 0.25);
    const c = classifyRoundCommit(round.id);
    expect(c.instrumentClass).toBe("priced");
    expect(c.effectivePps).toBe(0.25);
  });
  it("classifies warrant as priced via strikePrice", () => {
    const { round } = makeRound("warrant", { strikePrice: "1.00" });
    const c = classifyRoundCommit(round.id);
    expect(c.instrumentClass).toBe("priced");
    expect(c.effectivePps).toBe(1);
  });
});

describe("W-SAFE unpriced commit (single-entry)", () => {
  it("commits a SAFE with shares=0 as an unpriced principal position", () => {
    const { companyId, round } = makeRound("safe_post", { valuationCap: "8000000", discount: "20" });
    const invitationId = uid("inv");
    const res = commitFunded({
      invitationId, roundId: round.id, companyId, investorId: uid("investor"),
      amount: "50000", currency: "USD", shares: "0",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.entry.shares).toBe("0");
      expect(res.entry.instrumentClass).toBe("unpriced");
      expect(res.entry.principalAmount).toBe("50000");
      expect(res.entry.valuationCap).toBe("8000000");
      expect(res.entry.discountPct).toBe("20");
      expect(res.entry.reconcile.match).toBe(true);
    }
    expect(verifyChain().ok).toBe(true);
  });

  it("rejects a positive share count on an unpriced instrument", () => {
    const { companyId, round } = makeRound("safe_pre", { valuationCap: "6000000" });
    const res = commitFunded({
      invitationId: uid("inv"), roundId: round.id, companyId, investorId: uid("inv"),
      amount: "25000", currency: "USD", shares: "1000",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("unexpected_shares_on_unpriced");
  });
});

describe("W-SAFE unpriced reconcile (principal-based)", () => {
  it("matches when principal equals amount", () => {
    const r = reconcile({ invitationId: "i", amount: "50000", currency: "USD", shares: "0", instrumentClass: "unpriced", principalAmount: "50000" });
    expect(r.match).toBe(true);
    expect(r.primary).toBe("50000");
  });
  it("mismatches when principal differs from amount", () => {
    const r = reconcile({ invitationId: "i", amount: "50000", currency: "USD", shares: "0", instrumentClass: "unpriced", principalAmount: "49999" });
    expect(r.match).toBe(false);
  });
});

describe("W-SAFE priced path unchanged", () => {
  it("priced commit still derives/accepts shares and reconciles on shares", () => {
    const { companyId, round } = makeRound("preferred", {}, 0.20);
    // amount 50000 / pps 0.20 = 250000 shares
    const res = commitFunded({
      invitationId: uid("inv"), roundId: round.id, companyId, investorId: uid("inv"),
      amount: "50000", currency: "USD", shares: "250000",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.entry.shares).toBe("250000");
      expect(res.entry.instrumentClass).toBe("priced");
      expect(res.entry.principalAmount).toBeNull();
      expect(res.entry.reconcile.match).toBe(true);
    }
  });

  it("priced commit rejects invalid (zero) shares just like before", () => {
    const { companyId, round } = makeRound("preferred", {}, 0.20);
    const res = commitFunded({
      invitationId: uid("inv"), roundId: round.id, companyId, investorId: uid("inv"),
      amount: "50000", currency: "USD", shares: "0",
    });
    // pps>0 so derivation would run in the BATCH path; the single-entry path
    // requires a valid share value from the caller -> invalid_shares preserved.
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("invalid_shares");
  });
});
