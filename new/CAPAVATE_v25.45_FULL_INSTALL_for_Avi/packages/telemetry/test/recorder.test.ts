/**
 * Telemetry recorder tests — append, hash chain, performance.
 */
import { describe, it, expect } from "vitest";
import { TelemetryStore } from "../src/recorder.js";

const ctx = {
  companyId: "c1",
  actorId: "u1",
  actorRole: "founder" as const,
};

describe("TelemetryStore", () => {
  it("appends events and chains hashes", () => {
    const store = new TelemetryStore();
    const e1 = store.recordEvent({ type: "round.created", payload: { roundId: "r1", series: "Seed", targetRaise: "1000000", instrument: "safe" } }, ctx);
    const e2 = store.recordEvent({ type: "round.terms_set", payload: { roundId: "r1", preMoney: "5000000" } }, ctx);
    expect(e1.prevHash).toBe("0".repeat(64));
    expect(e2.prevHash).toBe(e1.hash);
    expect(store.length).toBe(2);
    const v = store.verifyChain();
    expect(v.valid).toBe(true);
  });

  it("performance: 100 events appended in well under 50ms each (avg)", () => {
    const store = new TelemetryStore();
    const t0 = Date.now();
    for (let i = 0; i < 100; i++) {
      store.recordEvent({ type: "invitation.created", payload: { invitationId: `i${i}`, roundId: "r1", investorId: `inv${i}` } }, ctx);
    }
    const elapsed = Date.now() - t0;
    expect(elapsed / 100).toBeLessThan(50);
    expect(store.verifyChain().valid).toBe(true);
  });

  it("filter by type works", () => {
    const store = new TelemetryStore();
    store.recordEvent({ type: "round.created", payload: { roundId: "r1", series: "S", targetRaise: "1", instrument: "safe" } }, ctx);
    store.recordEvent({ type: "invitation.created", payload: { invitationId: "i1", roundId: "r1", investorId: "v1" } }, ctx);
    store.recordEvent({ type: "invitation.created", payload: { invitationId: "i2", roundId: "r1", investorId: "v2" } }, ctx);
    const invs = store.filter((e) => e.type === "invitation.created");
    expect(invs).toHaveLength(2);
  });

  it("verifyChain detects tampered events", () => {
    const store = new TelemetryStore();
    store.recordEvent({ type: "round.created", payload: { roundId: "r1", series: "S", targetRaise: "1", instrument: "safe" } }, ctx);
    store.recordEvent({ type: "round.terms_set", payload: { roundId: "r1", preMoney: "5000000" } }, ctx);
    // Mutate the underlying array
    const list = store.list();
    (list[1] as any).payload.preMoney = "9999999";
    const v = store.verifyChain();
    expect(v.valid).toBe(false);
    expect(v.brokenAt).toBe(1);
  });
});
