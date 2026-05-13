/**
 * Round close gate tests:
 *   - divergence blocks (RoundCloseBlockedError)
 *   - match + missing signatures blocks (closed=false, awaitingSignoffs)
 *   - match + both signatures permits (ledger gets close entry)
 *   - post-permission close is immutable (chain stays valid)
 */
import { describe, it, expect } from "vitest";
import { runCloseGate, RoundCloseBlockedError } from "../../src/reconcile/closeGate.js";
import { emptyLedger, appendTransaction } from "../../src/ledger/ledger.js";
import { verifyChain } from "../../src/ledger/chain.js";
import { referenceComputeCapTable } from "../../../cap-table-engine-ref/src/refCapTable.js";
import type { Holder, Security } from "../../src/types.js";

const FOUNDER: Security = {
  id: "f1", holderId: "founder1", kind: "common", series: "Common", shares: 8000000n,
};

const HOLDERS: Holder[] = [
  { id: "founder1", name: "Avi", type: "founder" },
  { id: "investors-A", name: "Series A Investors", type: "investor" },
];

const COMPUTE_OPTS = {
  companyId: "cmp-gate",
  asOf: "2026-06-01",
  view: "fully_diluted" as const,
  formulaRegion: "US" as const,
  holders: HOLDERS,
  transactions: [{ type: "issue" as const, security: FOUNDER, date: "2026-01-01" }],
};

describe("close gate", () => {
  it("blocks on divergence", () => {
    const buggy = (opts: any) => {
      const r = referenceComputeCapTable(opts);
      return { ...r, totalShares: r.totalShares - 100n };
    };
    expect(() => {
      runCloseGate({
        computeOpts: COMPUTE_OPTS,
        ledger: emptyLedger(),
        roundId: "round-A",
      }, buggy);
    }).toThrow(RoundCloseBlockedError);
  });

  it("match + no signatures → not closed; awaiting both", () => {
    const out = runCloseGate({
      computeOpts: COMPUTE_OPTS,
      ledger: emptyLedger(),
      roundId: "round-A",
    }, referenceComputeCapTable);
    expect(out.closed).toBe(false);
    expect(out.awaitingSignoffs.founder).toBe(true);
    expect(out.awaitingSignoffs.admin).toBe(true);
    expect(out.reconciliation.status).toBe("match");
  });

  it("match + only founder signature → still awaiting admin", () => {
    const out = runCloseGate({
      computeOpts: COMPUTE_OPTS,
      ledger: emptyLedger(),
      roundId: "round-A",
      founderSignoff: { actorId: "founder1", ts: "2026-06-01T10:00:00Z", ipAddress: "10.0.0.1", identityHash: "f-hash" },
    }, referenceComputeCapTable);
    expect(out.closed).toBe(false);
    expect(out.awaitingSignoffs.founder).toBe(false);
    expect(out.awaitingSignoffs.admin).toBe(true);
  });

  it("match + both signatures → closed; ledger sealed; chain valid", () => {
    const out = runCloseGate({
      computeOpts: COMPUTE_OPTS,
      ledger: emptyLedger(),
      roundId: "round-A",
      founderSignoff: { actorId: "founder1", ts: "2026-06-01T10:00:00Z", ipAddress: "10.0.0.1", identityHash: "f-hash" },
      adminSignoff: { actorId: "admin1", ts: "2026-06-01T11:00:00Z", ipAddress: "10.0.0.2", identityHash: "a-hash" },
    }, referenceComputeCapTable);
    expect(out.closed).toBe(true);
    expect(out.ledger.length).toBe(1);
    expect(out.ledger.entries[0].type).toBe("round_close");
    const v = verifyChain(out.ledger.entries);
    expect(v.valid).toBe(true);
  });

  it("post-permission close is immutable (chain stays valid even with prior entries)", () => {
    let l = emptyLedger();
    l = appendTransaction(l, {
      id: "issue-founder", companyId: "cmp-gate", type: "issue",
      instrumentRef: "f1", timestamp: "2026-01-01T00:00:00Z",
      actorId: "founder1", actorRole: "founder",
      idempotencyKey: "issue-founder-1",
      payload: { type: "issue", data: { security: FOUNDER } },
    });
    const out = runCloseGate({
      computeOpts: COMPUTE_OPTS,
      ledger: l,
      roundId: "round-A",
      founderSignoff: { actorId: "founder1", ts: "2026-06-01T10:00:00Z", identityHash: "f-hash" },
      adminSignoff: { actorId: "admin1", ts: "2026-06-01T11:00:00Z", identityHash: "a-hash" },
    }, referenceComputeCapTable);
    expect(out.closed).toBe(true);
    expect(out.ledger.length).toBe(2);
    const v = verifyChain(out.ledger.entries);
    expect(v.valid).toBe(true);
    // Tampering with the close entry breaks the chain
    const tampered = [...out.ledger.entries];
    tampered[1] = { ...tampered[1], actorId: "different-admin" };
    const v2 = verifyChain(tampered);
    expect(v2.valid).toBe(false);
  });
});
