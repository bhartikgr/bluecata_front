/**
 * Metric calculator tests.
 */
import { describe, it, expect } from "vitest";
import { TelemetryStore } from "../src/recorder.js";
import {
  roundDurationDays, invitationToSoftCircleHours, softCircleToSignedHours,
  funnelDropoff, investorQuality,
} from "../src/metrics.js";

const ctx = (ts: string) => ({
  companyId: "c1", actorId: "u1", actorRole: "founder" as const, timestamp: ts,
});

describe("metrics", () => {
  it("roundDurationDays: created → closed", () => {
    const store = new TelemetryStore();
    store.recordEvent({ type: "round.created", payload: { roundId: "r1", series: "Seed", targetRaise: "1", instrument: "safe" } }, { ...ctx("2026-01-01T00:00:00Z"), roundId: "r1" });
    store.recordEvent({ type: "round.closed", payload: { roundId: "r1", primaryHash: "p", referenceHash: "r", finalAmount: "1000000" } }, { ...ctx("2026-03-01T00:00:00Z"), roundId: "r1" });
    const d = roundDurationDays(store.list(), "r1");
    expect(d).not.toBeNull();
    expect(d).toBeCloseTo(59, 0);
  });

  it("invitationToSoftCircleHours", () => {
    const store = new TelemetryStore();
    store.recordEvent({ type: "invitation.created", payload: { invitationId: "i1", roundId: "r1", investorId: "v1" } }, ctx("2026-01-01T00:00:00Z"));
    store.recordEvent({ type: "invitation.soft_circled", payload: { invitationId: "i1", amount: "100000" } }, ctx("2026-01-02T12:00:00Z"));
    const h = invitationToSoftCircleHours(store.list(), "i1");
    expect(h).toBeCloseTo(36, 0);
  });

  it("softCircleToSignedHours", () => {
    const store = new TelemetryStore();
    store.recordEvent({ type: "softcircle.created", payload: { softCircleId: "s1", roundId: "r1", investorId: "v1", amount: "100000" } }, ctx("2026-01-01T00:00:00Z"));
    store.recordEvent({ type: "softcircle.signed", payload: { softCircleId: "s1" } }, ctx("2026-01-04T00:00:00Z"));
    const h = softCircleToSignedHours(store.list(), "s1");
    expect(h).toBeCloseTo(72, 0);
  });

  it("funnelDropoff: invited → viewed → soft-circled → signed → funded", () => {
    const store = new TelemetryStore();
    for (let i = 0; i < 10; i++) {
      store.recordEvent({ type: "invitation.created", payload: { invitationId: `i${i}`, roundId: "r1", investorId: `v${i}` } }, ctx("2026-01-01T00:00:00Z"));
    }
    for (let i = 0; i < 7; i++) {
      store.recordEvent({ type: "invitation.viewed", payload: { invitationId: `i${i}` } }, ctx("2026-01-02T00:00:00Z"));
    }
    for (let i = 0; i < 4; i++) {
      store.recordEvent({ type: "invitation.soft_circled", payload: { invitationId: `i${i}`, amount: "100000" } }, ctx("2026-01-03T00:00:00Z"));
    }
    for (let i = 0; i < 3; i++) {
      store.recordEvent({ type: "softcircle.signed", payload: { softCircleId: `s${i}` } }, { ...ctx("2026-01-05T00:00:00Z"), roundId: "r1" });
    }
    for (let i = 0; i < 2; i++) {
      store.recordEvent({ type: "softcircle.funded", payload: { softCircleId: `s${i}`, amount: "100000" } }, { ...ctx("2026-01-08T00:00:00Z"), roundId: "r1" });
    }
    const f = funnelDropoff(store.list(), "r1");
    expect(f.invited).toBe(10);
    expect(f.viewed).toBe(7);
    expect(f.softCircled).toBe(4);
    expect(f.signed).toBe(3);
    expect(f.funded).toBe(2);
    expect(f.rates.viewRate).toBeCloseTo(0.7, 2);
    expect(f.rates.circleRate).toBeCloseTo(4 / 7, 2);
  });

  it("investorQuality: average cheque + total deals", () => {
    const store = new TelemetryStore();
    store.recordEvent({ type: "invitation.created", payload: { invitationId: "i1", roundId: "r1", investorId: "alice" } }, ctx("2026-01-01T00:00:00Z"));
    store.recordEvent({ type: "invitation.soft_circled", payload: { invitationId: "i1", amount: "200000" } }, ctx("2026-01-02T00:00:00Z"));
    store.recordEvent({ type: "softcircle.created", payload: { softCircleId: "s1", roundId: "r1", investorId: "alice", amount: "200000" } }, ctx("2026-01-02T00:00:00Z"));
    store.recordEvent({ type: "softcircle.created", payload: { softCircleId: "s2", roundId: "r2", investorId: "alice", amount: "100000" } }, ctx("2026-04-02T00:00:00Z"));
    const q = investorQuality(store.list(), "alice");
    expect(q.averageChequeSize).toBe(150000);
    expect(q.totalDeals).toBe(2);
  });
});
