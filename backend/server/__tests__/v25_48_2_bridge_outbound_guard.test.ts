/**
 * v25.48.2 Q1 (Ozan) — legacy outbound bridge neutralized in prod.
 *
 * Asserts the PARALLEL route-layer guard (server/lib/bridgeOutboundGuard.ts),
 * mounted BEFORE the real bridge routes, short-circuits the admin drain trigger
 * when the bridge is DISABLED (BRIDGE_ENABLED=0) so:
 *   - NO outbound send is attempted (no fetch to the receiver),
 *   - the response is a clean 200 { disabled: true, delivered: 0 } — NOT a 501,
 *   - nothing dead-letters.
 * Also asserts the additive DLQ-clear endpoint purges dead_letter queue rows
 * without touching audit history.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import installV14TestIdentity from "./_v14TestIdentity";
import {
  registerBridgeRoutes,
  emitBridgeEvent,
  getOutbox,
  clearBridgeOutbox,
  _testBridge,
} from "../bridgeStore";
import {
  registerBridgeOutboundGuard,
  maySendOutboundBridge,
  hasRealReceiver,
  isPlaceholderSecret,
} from "../lib/bridgeOutboundGuard";
import { tickBridgeWorker, isBridgeWorkerRunning, startBridgeWorker, stopBridgeWorker } from "../bridgeWorker";

const SAVED_BRIDGE_ENABLED = process.env.BRIDGE_ENABLED;
const SAVED_WEBHOOK_URL = process.env.COLLECTIVE_WEBHOOK_URL;
const SAVED_WEBHOOK_SECRET = process.env.COLLECTIVE_WEBHOOK_SECRET;

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  installV14TestIdentity(app);
  // Guard MUST be registered before the real routes so it matches first.
  registerBridgeOutboundGuard(app);
  registerBridgeRoutes(app);
  return app;
}

describe("v25.48.2 Q1 — outbound bridge guard + DLQ clear", () => {
  beforeEach(() => {
    _testBridge.resetChain();
  });
  afterEach(() => {
    if (SAVED_BRIDGE_ENABLED === undefined) delete process.env.BRIDGE_ENABLED;
    else process.env.BRIDGE_ENABLED = SAVED_BRIDGE_ENABLED;
    if (SAVED_WEBHOOK_URL === undefined) delete process.env.COLLECTIVE_WEBHOOK_URL;
    else process.env.COLLECTIVE_WEBHOOK_URL = SAVED_WEBHOOK_URL;
    if (SAVED_WEBHOOK_SECRET === undefined) delete process.env.COLLECTIVE_WEBHOOK_SECRET;
    else process.env.COLLECTIVE_WEBHOOK_SECRET = SAVED_WEBHOOK_SECRET;
  });

  it("short-circuits /api/admin/bridge/drain with disabled:true (no 501, no dead-letter) when BRIDGE_ENABLED=0", async () => {
    process.env.BRIDGE_ENABLED = "0";
    const app = makeApp();

    emitBridgeEvent({
      eventType: "company.profile.updated",
      aggregateId: "co_guard_test",
      aggregateKind: "company",
      payload: { changedFields: ["stage"] },
    });

    const res = await request(app).post("/api/admin/bridge/drain").send({});
    expect(res.status).toBe(200);
    expect(res.body.disabled).toBe(true);
    expect(res.body.delivered).toBe(0);
    expect(res.body.deadLettered).toBe(0);

    // The event was NOT delivered and did NOT dead-letter — it stays queued.
    const entry = getOutbox().find((e) => e.envelope.aggregateId === "co_guard_test");
    expect(entry).toBeTruthy();
    expect(entry!.status).toBe("queued");
  });

  it("clearBridgeOutbox() purges dead_letter rows only by default", () => {
    _testBridge.resetChain();
    const e = emitBridgeEvent({
      eventType: "cap_table.mutated",
      aggregateId: "co_dlq_test",
      aggregateKind: "company",
      payload: {},
    });
    // Force it into dead_letter.
    e.status = "dead_letter";
    const queued = emitBridgeEvent({
      eventType: "round.closed",
      aggregateId: "rnd_dlq_test",
      aggregateKind: "round",
      payload: {},
    });
    expect(queued.status).toBe("queued");

    const out = clearBridgeOutbox();
    expect(out.cleared).toBe(1);
    expect(out.statusesCleared).toEqual(["dead_letter"]);
    // The queued row survives (default only clears dead_letter).
    expect(getOutbox().some((x) => x.envelope.aggregateId === "rnd_dlq_test")).toBe(true);
    expect(getOutbox().some((x) => x.status === "dead_letter")).toBe(false);
  });

  it("passes through to the real drain when the bridge is enabled AND a real receiver is configured", async () => {
    process.env.BRIDGE_ENABLED = "1";
    process.env.COLLECTIVE_WEBHOOK_URL = "https://collective.example/inbound";
    process.env.COLLECTIVE_WEBHOOK_SECRET = "test-secret";
    const app = makeApp();
    emitBridgeEvent({
      eventType: "company.profile.updated",
      aggregateId: "co_enabled_test",
      aggregateKind: "company",
      payload: {},
    });
    const res = await request(app).post("/api/admin/bridge/drain").send({});
    // The guard did NOT short-circuit — control passed through to the real
    // (admin-gated) route, so the response is NOT the disabled shape.
    expect(res.body?.disabled).toBeFalsy();
  });

  /* ------------------------------------------------------------------ */
  /* v25.48.2 MF1 — placeholder-secret rejection + worker-path gating.   */
  /* ------------------------------------------------------------------ */

  it("rejects placeholder secrets (YOUR_STRONG_SECRET, changeme, blank, …)", () => {
    expect(isPlaceholderSecret("YOUR_STRONG_SECRET")).toBe(true);
    expect(isPlaceholderSecret("your-strong-secret")).toBe(true);
    expect(isPlaceholderSecret("changeme")).toBe(true);
    expect(isPlaceholderSecret("placeholder")).toBe(true);
    expect(isPlaceholderSecret("TODO")).toBe(true);
    expect(isPlaceholderSecret("example-key")).toBe(true);
    expect(isPlaceholderSecret("   ")).toBe(true);
    expect(isPlaceholderSecret("")).toBe(true);
    expect(isPlaceholderSecret(undefined)).toBe(true);
    // A genuine high-entropy secret is accepted.
    expect(isPlaceholderSecret("9f3c1a7be24d5081")).toBe(false);
  });

  it("BRIDGE_ENABLED=1 + URL set + secret=YOUR_STRONG_SECRET → guard blocks the drain route (no send)", async () => {
    process.env.BRIDGE_ENABLED = "1";
    process.env.COLLECTIVE_WEBHOOK_URL = "https://collective.example/inbound";
    process.env.COLLECTIVE_WEBHOOK_SECRET = "YOUR_STRONG_SECRET";

    expect(hasRealReceiver()).toBe(false);
    expect(maySendOutboundBridge()).toBe(false);

    const app = makeApp();
    emitBridgeEvent({
      eventType: "company.profile.updated",
      aggregateId: "co_placeholder_test",
      aggregateKind: "company",
      payload: {},
    });
    const res = await request(app).post("/api/admin/bridge/drain").send({});
    // Placeholder secret ⇒ neutralized: clean 200 disabled shape, no 501.
    expect(res.status).toBe(200);
    expect(res.body.disabled).toBe(true);
    expect(res.body.delivered).toBe(0);
    expect(res.body.deadLettered).toBe(0);
    // Event stays queued — never delivered, never dead-lettered.
    const entry = getOutbox().find((e) => e.envelope.aggregateId === "co_placeholder_test");
    expect(entry!.status).toBe("queued");
  });

  it("worker never starts and a simulated tick is a no-op when secret is a placeholder", async () => {
    process.env.BRIDGE_ENABLED = "1";
    process.env.COLLECTIVE_WEBHOOK_URL = "https://collective.example/inbound";
    process.env.COLLECTIVE_WEBHOOK_SECRET = "YOUR_STRONG_SECRET";

    // Worker start is refused (predicate false) — it bypasses the route guard,
    // so gating MUST happen here too.
    stopBridgeWorker();
    startBridgeWorker();
    expect(isBridgeWorkerRunning()).toBe(false);

    // A simulated tick no-ops WITHOUT reaching deliverOnce (which would 501 /
    // dead-letter in prod with no real receiver).
    const tick = await tickBridgeWorker();
    expect(tick).toEqual({ delivered: 0, deadLettered: 0 });
  });
});
