/**
 * Hash-chain tamper detection.
 *
 * Reference: SOC 2 CC7.2 — "evidence of operations is captured immutably".
 * Any modification to a ledger entry must invalidate the chain.
 */
import { describe, it, expect } from "vitest";
import { appendTransaction, emptyLedger } from "../../src/ledger/ledger.js";
import { verifyChain } from "../../src/ledger/chain.js";
import type { LedgerEntry } from "../../src/ledger/transaction.js";
import type { Security } from "../../src/types.js";

const SEC_A: Security = {
  id: "s-a", holderId: "h-1", kind: "common", series: "Common", shares: 1000n,
};
const SEC_B: Security = {
  id: "s-b", holderId: "h-1", kind: "common", series: "Common", shares: 500n,
};

function buildLedger() {
  let l = emptyLedger();
  l = appendTransaction(l, {
    id: "a", companyId: "c", type: "issue", instrumentRef: "s-a",
    timestamp: "2026-01-01T00:00:00Z", actorId: "u", actorRole: "founder",
    idempotencyKey: "k1", payload: { type: "issue", data: { security: SEC_A } },
  });
  l = appendTransaction(l, {
    id: "b", companyId: "c", type: "issue", instrumentRef: "s-b",
    timestamp: "2026-02-01T00:00:00Z", actorId: "u", actorRole: "founder",
    idempotencyKey: "k2", payload: { type: "issue", data: { security: SEC_B } },
  });
  l = appendTransaction(l, {
    id: "c", companyId: "c", type: "transfer", instrumentRef: "s-a",
    timestamp: "2026-03-01T00:00:00Z", actorId: "u", actorRole: "founder",
    idempotencyKey: "k3", payload: { type: "transfer", data: { securityId: "s-a", toHolderId: "h-2" } },
  });
  return l;
}

describe("hash chain — verifyChain", () => {
  it("returns valid:true for an unbroken chain", () => {
    const l = buildLedger();
    const v = verifyChain(l.entries);
    expect(v.valid).toBe(true);
    expect(v.length).toBe(3);
  });

  it("detects tampered payload at entry 1", () => {
    const l = buildLedger();
    const tampered: LedgerEntry[] = l.entries.map((e, i) => {
      if (i !== 1) return e;
      // Mutate the inner payload
      return {
        ...e,
        payload: { type: "issue", data: { security: { ...SEC_B, shares: 9999999n } } },
      } as LedgerEntry;
    });
    const v = verifyChain(tampered);
    expect(v.valid).toBe(false);
    expect(v.brokenAt).toBe(1);
  });

  it("detects a swapped prevHash on the 2nd entry", () => {
    const l = buildLedger();
    const broken: LedgerEntry[] = l.entries.map((e, i) =>
      i === 1 ? { ...e, prevHash: "0".repeat(64) } : e,
    );
    const v = verifyChain(broken);
    expect(v.valid).toBe(false);
    expect(v.brokenAt).toBe(1);
  });

  it("detects deletion of a middle entry", () => {
    const l = buildLedger();
    const skip = [l.entries[0], l.entries[2]];
    const v = verifyChain(skip);
    expect(v.valid).toBe(false);
    expect(v.brokenAt).toBe(1);
  });

  it("empty ledger is valid by definition", () => {
    const v = verifyChain([]);
    expect(v.valid).toBe(true);
    expect(v.length).toBe(0);
  });
});
