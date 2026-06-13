/**
 * Sprint 13 — Real-time E2E sync verification (D8).
 *
 * For each of 24 canonical entities:
 *   1. Build a sample
 *   2. Apply transform out → in (round-trip)
 *   3. For entities with a 1:1 outbound event, fire it through BridgeOutbound,
 *      assert the spy captured it, and confirm hash chain remains valid.
 *   4. Drain via deliverOnce and confirm latency is recorded.
 *
 * Final assertions: p50 < 100ms, p95 < 500ms in the mock loop (in-process,
 * effectively zero latency by clock).
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { ALL_ENTITY_KEYS, Registry, buildSample, type EntityKey } from "@shared/schemas/sync";
import { BridgeOutbound } from "../lib/bridgeOutbound";
import { _testBridge, getOutbox } from "../bridgeStore";
import { bridgeHealth, deliverOnce, hashChainOk, _resetRuntime } from "../lib/bridgeRuntime";
import { dispatchInbound, resetInboundState } from "../lib/bridgeInbound";

beforeAll(() => {
  _testBridge.resetChain();
  _resetRuntime();
  BridgeOutbound.__clearSpy();
  resetInboundState();
});

/** Map entity key → emit fn (return null if entity has no 1:1 outbound). */
function fireOutbound(key: EntityKey, sample: Record<string, unknown>): boolean {
  const id = String(sample.id ?? sample.userId ?? sample.companyId ?? sample.subjectId ?? `${key}_x`);
  switch (key) {
    case "company":
      BridgeOutbound.companyProfileUpdated(id, sample); return true;
    case "investor":
      BridgeOutbound.investorProfileUpdated(id, sample); return true;
    case "capTablePosition":
      BridgeOutbound.capTableMutated(String(sample.companyId ?? id), sample); return true;
    case "round":
      BridgeOutbound.roundClosed(id, sample); return true;
    case "auditEntry":
      BridgeOutbound.auditLogAppended(String(sample.aggregateId ?? id), sample); return true;
    case "lifecyclePolicy":
      BridgeOutbound.lifecyclePolicyChanged(sample); return true;
    case "maIntelligence":
      BridgeOutbound.companyMaIntelligenceUpdated(String(sample.companyId ?? id), sample); return true;
    case "eligibilitySnapshot":
      BridgeOutbound.eligibilityRecomputed(String(sample.userId ?? id), sample); return true;
    case "termSheet":
      BridgeOutbound.governanceMetricPublished(String(sample.companyId ?? id), sample); return true;
    case "softCircle":
      BridgeOutbound.companyProfileUpdated(String(sample.companyId ?? id), sample); return true;
    default:
      return false;
  }
}

describe("Sprint 13 — Sync E2E (24 entities, round-trip + bridge)", () => {
  beforeEach(() => {
    BridgeOutbound.__clearSpy();
  });

  for (const key of ALL_ENTITY_KEYS) {
    it(`${key}: round-trips through Collective transform`, () => {
      const sample = buildSample(key);
      const reg = Registry[key] as {
        toCollectivePayload: (p: unknown, audience?: string) => Record<string, unknown>;
        fromCollectivePayload: (p: unknown) => Record<string, unknown>;
      };
      const wire = reg.toCollectivePayload(sample, "internal");
      expect(wire).toBeDefined();
      expect(typeof wire).toBe("object");
      const back = reg.fromCollectivePayload(wire);
      expect(back).toBeDefined();
      // Identity-ish: at least the natural-id field should survive.
      const idField = sample.id ?? sample.userId ?? sample.companyId ?? sample.subjectId;
      const backId = back.id ?? back.userId ?? back.companyId ?? back.subjectId;
      if (idField !== undefined) expect(backId).toBe(idField);
    });
  }

  it("fires outbound events through BridgeOutbound for entities with 1:1 mapping; spy captures all", () => {
    BridgeOutbound.__clearSpy();
    let fired = 0;
    for (const key of ALL_ENTITY_KEYS) {
      const sample = buildSample(key);
      if (fireOutbound(key, sample)) fired++;
    }
    const spy = BridgeOutbound.__getSpy();
    expect(spy.length).toBe(fired);
    // Each captured entry has eventType + aggregateId + ts
    for (const e of spy) {
      expect(e.eventType).toBeTruthy();
      expect(e.aggregateId).toBeTruthy();
      expect(e.ts).toBeTruthy();
    }
  });

  it("hash chain remains valid after a burst of mixed outbound events", () => {
    _testBridge.resetChain();
    for (const key of ALL_ENTITY_KEYS) {
      const sample = buildSample(key);
      fireOutbound(key, sample);
    }
    expect(hashChainOk()).toBe(true);
  });

  it("deliverOnce drains the burst in mock mode and records latency", async () => {
    _testBridge.resetChain();
    _resetRuntime();
    BridgeOutbound.__clearSpy();
    for (const key of ALL_ENTITY_KEYS) {
      const sample = buildSample(key);
      fireOutbound(key, sample);
    }
    const before = getOutbox().length;
    expect(before).toBeGreaterThan(0);
    const r = await deliverOnce();
    expect(r.delivered).toBe(before);
    const h = bridgeHealth();
    expect(h.outboundQueueDepth).toBe(0);
    expect(h.dlqDepth).toBe(0);
    expect(h.hashChainOk).toBe(true);
    expect(h.samples).toBeGreaterThan(0);
  });

  it("p50 < 100ms and p95 < 500ms in the mock loop", async () => {
    _testBridge.resetChain();
    _resetRuntime();
    for (let i = 0; i < 25; i++) {
      BridgeOutbound.companyProfileUpdated(`co_p${i}`, { i });
    }
    await deliverOnce();
    const h = bridgeHealth();
    expect(h.latencyP50).toBeLessThan(100);
    expect(h.latencyP95).toBeLessThan(500);
  });

  it("inbound dispatch flow: dsc.scores envelope round-trips into inboundState", () => {
    resetInboundState();
    const env = {
      eventId: "evt_e2e_1",
      eventType: "dsc.scores" as const,
      aggregateId: "co_e2e",
      aggregateKind: "company" as const,
      occurredAt: new Date().toISOString(),
      tenantId: "t_default",
      actor: { userId: "u_collective" },
      payload: { dscScore: 4.5, dscRecommendation: "advance" },
      trace: [],
      auditChain: { priorHash: "0".repeat(64), hash: "x".repeat(64) },
      schemaVersion: "1.0" as const,
    };
    const r = dispatchInbound(env);
    expect(r.applied).toBe(true);
    expect(r.handler).toBe("dsc.scores");
  });
});
