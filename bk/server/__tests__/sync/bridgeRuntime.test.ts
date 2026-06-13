/**
 * Sprint 13 — Bridge runtime: queue, retry, DLQ, replay, cursor, health.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { _testBridge, emitBridgeEvent, drainOutbox, getOutbox } from "../../bridgeStore";
import { bridgeHealth, deliverOnce, replayFrom, getBridgeCursor, _resetRuntime, hashChainOk } from "../../lib/bridgeRuntime";

beforeEach(() => {
  _testBridge.resetChain();
  _resetRuntime();
});

describe("Sprint 13 — Bridge Runtime", () => {
  it("emit + deliverOnce delivers via mock receiver and updates health", async () => {
    emitBridgeEvent({
      eventType: "company.profile.updated",
      aggregateId: "co_a",
      aggregateKind: "company",
      payload: { x: 1 },
    });
    const r = await deliverOnce();
    expect(r.delivered).toBe(1);
    const h = bridgeHealth();
    expect(h.outboundQueueDepth).toBe(0);
    expect(h.dlqDepth).toBe(0);
    expect(h.hashChainOk).toBe(true);
    expect(h.lastSuccessAt).toBeTruthy();
  });

  it("retries with exponential backoff and lands in DLQ after 5 attempts", async () => {
    emitBridgeEvent({
      eventType: "company.profile.updated",
      aggregateId: "co_b",
      aggregateKind: "company",
      payload: {},
    });
    // Simulate 5 failed delivery passes by using drainOutbox directly with always-fail.
    const failingDeliver = async () => ({ ok: false, status: 500 });
    for (let i = 0; i < 5; i++) {
      // Force nextRetryAt to now so loop processes.
      for (const e of getOutbox()) e.nextRetryAt = 0;
      await drainOutbox(failingDeliver);
    }
    const last = getOutbox().slice(-1)[0];
    expect(last.attempts).toBeGreaterThanOrEqual(5);
    expect(last.status).toBe("dead_letter");
    expect(bridgeHealth().dlqDepth).toBeGreaterThanOrEqual(1);
  });

  it("replayFrom requeues delivered events past cursor", async () => {
    emitBridgeEvent({ eventType: "company.profile.updated", aggregateId: "co_c", aggregateKind: "company", payload: {} });
    emitBridgeEvent({ eventType: "investor.profile.updated", aggregateId: "u_x", aggregateKind: "investor", payload: {} });
    await deliverOnce();
    const out = getOutbox();
    expect(out.every(e => e.status === "delivered")).toBe(true);
    const r = replayFrom(out[0].envelope.eventId);
    expect(r.requeued).toBe(1);
    expect(getOutbox()[1].status).toBe("queued");
  });

  it("cursor reflects last delivered + last received", () => {
    emitBridgeEvent({ eventType: "company.profile.updated", aggregateId: "co_d", aggregateKind: "company", payload: {} });
    const c = getBridgeCursor();
    expect(c).toHaveProperty("lastDeliveredEventId");
    expect(c).toHaveProperty("lastReceivedEventId");
  });

  it("hash chain ok across multiple emitted events", () => {
    emitBridgeEvent({ eventType: "company.profile.updated", aggregateId: "co_e", aggregateKind: "company", payload: {} });
    emitBridgeEvent({ eventType: "audit_log.appended", aggregateId: "co_e", aggregateKind: "company", payload: {} });
    emitBridgeEvent({ eventType: "round.closed", aggregateId: "rnd_x", aggregateKind: "round", payload: {} });
    expect(hashChainOk()).toBe(true);
  });

  it("p50/p95 latency tracked for delivered events", async () => {
    for (let i = 0; i < 10; i++) {
      emitBridgeEvent({ eventType: "company.profile.updated", aggregateId: `co_${i}`, aggregateKind: "company", payload: {} });
    }
    await deliverOnce();
    const h = bridgeHealth();
    expect(h.samples).toBeGreaterThan(0);
    expect(h.latencyP50).toBeGreaterThanOrEqual(0);
    expect(h.latencyP95).toBeGreaterThanOrEqual(h.latencyP50);
  });
});
