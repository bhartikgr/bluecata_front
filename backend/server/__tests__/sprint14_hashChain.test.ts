/**
 * Sprint 14 D8 — Hash chain universality tests.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { HashChain, registerChain, getChain, listChains, __clearAllChains } from "../lib/hashChain";
import { createIntroRequest, updateIntroRequest, introChain, __clearIntroRequests } from "../introRequestStore";
import { createChannel, archiveChannel, transactionPrepChain, __clearTransactionPrep } from "../transactionPrepStore";
import { createBroadcast, broadcastChain, __clearBroadcasts } from "../milestoneBroadcastStore";
import { ingestDscScores, dscFeedbackChain, __clearDscFeedback } from "../dscFeedbackStore";
import { chargeOrIdempotent, paymentChain, __clearPayments } from "../paymentStore";

beforeEach(() => {
  __clearIntroRequests();
  __clearTransactionPrep();
  __clearBroadcasts();
  __clearDscFeedback();
  __clearPayments();
});

describe("HashChain core", () => {
  it("appends entries with linked hashes", () => {
    const chain = new HashChain<{ id: string; v: number }>("test_chain_a");
    const e1 = chain.append({ id: "1", v: 10 });
    const e2 = chain.append({ id: "2", v: 20 });
    expect(e1.prevHash).toBe("GENESIS");
    expect(e2.prevHash).toBe(e1.hash);
    expect(chain.verify().ok).toBe(true);
  });

  it("verify catches tampered entry", () => {
    const chain = new HashChain<{ id: string; v: number }>("test_chain_b");
    chain.append({ id: "1", v: 10 });
    chain.append({ id: "2", v: 20 });
    chain.__tamperForTest(0, (b) => ({ ...b, v: 99 }));
    const r = chain.verify();
    expect(r.ok).toBe(false);
    expect(r.brokenAt).toBe(0);
  });

  it("locks chain on tamper detect; further appends throw", () => {
    let compromiseCalled = false;
    const chain = new HashChain<{ id: string; v: number }>("test_chain_c", () => { compromiseCalled = true; });
    chain.append({ id: "1", v: 10 });
    chain.__tamperForTest(0, (b) => ({ ...b, v: 99 }));
    chain.verify(); // triggers compromise
    expect(compromiseCalled).toBe(true);
    expect(chain.isCompromised()).toBe(true);
    expect(() => chain.append({ id: "2", v: 20 })).toThrow(/hash_chain_locked/);
  });
});

describe("Registry includes 6+ Sprint 14 aggregates", () => {
  it("registry has all expected names", () => {
    const expected = ["intro_requests", "transaction_prep", "milestone_broadcasts", "dsc_feedback", "payments"];
    const all = listChains();
    for (const name of expected) {
      expect(all.includes(name), `${name} not registered`).toBe(true);
    }
  });
});

describe("Per-aggregate verify after activity", () => {
  it("intro_requests chain advances and verifies", () => {
    const r = createIntroRequest({ requesterCompanyId: "co_x", targetEntity: { kind: "acquirer", name: "X" }, askText: "ask" }, "u_a");
    updateIntroRequest(r.id, { status: "accepted" }, "u_b");
    expect(introChain.list().length).toBe(2);
    expect(introChain.verify().ok).toBe(true);
  });

  it("transaction_prep chain advances and verifies", () => {
    const ch = createChannel({ companyId: "co_x", founderUserId: "u_f" });
    archiveChannel(ch.id, "not_pursuing", "u_f");
    expect(transactionPrepChain.list().length).toBe(2);
    expect(transactionPrepChain.verify().ok).toBe(true);
  });

  it("milestone_broadcasts chain verifies", () => {
    createBroadcast({ companyId: "co_x", segmentKind: "all", body: "yo" }, "u_f");
    expect(broadcastChain.verify().ok).toBe(true);
  });

  it("dsc_feedback chain verifies", () => {
    ingestDscScores({ companyId: "co_x", tier: "watch", dimensions: { a: 30 }, narrative: "ok" });
    expect(dscFeedbackChain.verify().ok).toBe(true);
  });

  it("payments chain dedupes intentId and verifies", () => {
    const r1 = chargeOrIdempotent({ intentId: "int_1", kind: "collective_membership", amountCents: 120000, currency: "USD", customerId: "u_x", description: "y", forceState: "demo" });
    const r2 = chargeOrIdempotent({ intentId: "int_1", kind: "collective_membership", amountCents: 120000, currency: "USD", customerId: "u_x", description: "y", forceState: "demo" });
    expect(r1.deduped).toBe(false);
    expect(r2.deduped).toBe(true);
    expect(paymentChain.verify().ok).toBe(true);
    expect(paymentChain.list().length).toBe(1);
  });
});

describe("getChain by name", () => {
  it("retrieves a registered chain", () => {
    expect(getChain("intro_requests")).toBeDefined();
    expect(getChain("non_existent")).toBeUndefined();
  });
});
