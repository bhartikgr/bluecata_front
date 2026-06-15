/**
 * Sprint 13 — Bridge Runtime.
 *
 * Built on top of `server/bridgeStore.ts` (HMAC + chain + outbox primitives).
 * Adds: production-shape outbound delivery (mock or live mode by env),
 *       inbound endpoint with HMAC verify + idempotency,
 *       cursor + replay,
 *       health endpoint with queue depths + lag + chain status,
 *       per-event-type counters,
 *       latency tracker (last 50 events).
 */
/* v25.25.2 — createRequire shim: lazy require() calls in this file must work
   in BOTH the dev/prod tsx runtime (ESM, where `require` is undefined) AND
   the bundled CJS dist. This is the minimal, zero-risk way to unblock the
   v25.25 login 500 ("require is not defined" at userContext.ts:585 and other
   sites) without converting every lazy require() to a static import (which
   would re-introduce circular-import bugs). */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

import type { Express, Request, Response } from "express";
import {
  emitBridgeEvent,
  drainOutbox,
  getOutbox,
  getInbox,
  pushInbound,
  hmacSign,
  verifyHmac,
  ALL_OUTBOUND_EVENT_TYPES,
  ALL_INBOUND_EVENT_TYPES,
  type OutboundEventType,
  type InboundEventType,
  type BridgeEnvelope,
  type EmitArgs,
  type OutboxEntry,
} from "../bridgeStore";

import { dispatchInbound } from "./bridgeInbound";
import { requireAdmin } from "./authMiddleware"; // B16 (v24.0) — lock bridge runtime ops to admins

const COLLECTIVE_WEBHOOK_URL = process.env.COLLECTIVE_WEBHOOK_URL ?? "";
const COLLECTIVE_WEBHOOK_SECRET = process.env.COLLECTIVE_WEBHOOK_SECRET ?? "";
/* v25.17 Lane E NH1 — if LIVE_MODE is on but the HMAC secret is missing,
   refuse to send unsigned (empty-secret) events. In production this aborts
   the boot to make the misconfiguration loud. In non-production we log and
   disable LIVE_MODE so dev/test still work. */
if (COLLECTIVE_WEBHOOK_URL && !COLLECTIVE_WEBHOOK_SECRET) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("[bridgeRuntime] COLLECTIVE_WEBHOOK_URL set without COLLECTIVE_WEBHOOK_SECRET — refusing to start (would emit unsigned webhooks).");
  } else {
    // eslint-disable-next-line no-console
    console.warn("[bridgeRuntime] COLLECTIVE_WEBHOOK_URL set without COLLECTIVE_WEBHOOK_SECRET; LIVE_MODE disabled.");
  }
}
const LIVE_MODE = !!COLLECTIVE_WEBHOOK_URL && !!COLLECTIVE_WEBHOOK_SECRET;

/** Latency samples (last N events). */
const latencyMs: number[] = [];
const LATENCY_KEEP = 50;
const inboundSeen = new Set<string>();
let lastSuccessAt: string | null = null;
let lastReceivedEventId: string | null = null;
let lastReceivedAt: string | null = null;
let lastDeliveredEventId: string | null = null;

function recordLatency(ms: number) {
  latencyMs.push(ms);
  if (latencyMs.length > LATENCY_KEEP) latencyMs.shift();
}

export function pNN(p: number): number {
  if (latencyMs.length === 0) return 0;
  const sorted = [...latencyMs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

/** Attempt a single drain pass. */
export async function deliverOnce(): Promise<{ delivered: number; deadLettered: number }> {
  return drainOutbox(async (env, hmac) => {
    const start = Date.now();
    const occurredAt = Date.parse(env.occurredAt);
    if (LIVE_MODE) {
      try {
        const res = await fetch(COLLECTIVE_WEBHOOK_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-bridge-signature": hmacSign(JSON.stringify(env), COLLECTIVE_WEBHOOK_SECRET),
            "idempotency-key": env.eventId,
          },
          body: JSON.stringify(env),
        });
        const ok = res.ok;
        if (ok) {
          recordLatency(Date.now() - occurredAt);
          lastSuccessAt = new Date().toISOString();
          lastDeliveredEventId = env.eventId;
        }
        return { ok, status: res.status };
      } catch {
        return { ok: false, status: 0 };
      }
    }
    // v24.0 C14: in-process mock receiver is DEV-ONLY. In production the mock
    // delivery path is disabled (no synthetic delivery emulation).
    if (process.env.NODE_ENV !== "production") {
      // Mock: deliver to in-process handler emulating Collective receiver.
      const ok = mockReceive(env, hmac);
      if (ok) {
        recordLatency(Date.now() - occurredAt);
        lastSuccessAt = new Date().toISOString();
        lastDeliveredEventId = env.eventId;
      }
      void start; // suppress unused
      return { ok, status: ok ? 200 : 500 };
    }
    void start; // suppress unused
    return { ok: false, status: 501 };
  });
}

function mockReceive(env: BridgeEnvelope, hmac: string): boolean {
  // verify HMAC over payload string
  const body = JSON.stringify(env);
  return verifyHmac(body, hmac);
}

/**
 * Counts per event type for outbound queue.
 */
export function outboundCounts(): { byEventType: Record<string, number>; lastByType: Record<string, string> } {
  const byEventType: Record<string, number> = {};
  const lastByType: Record<string, string> = {};
  for (const e of getOutbox()) {
    byEventType[e.envelope.eventType] = (byEventType[e.envelope.eventType] ?? 0) + 1;
    if (e.deliveredAt) lastByType[e.envelope.eventType] = e.deliveredAt;
  }
  return { byEventType, lastByType };
}

/** True if hash chain across outbox is intact. */
export function hashChainOk(): boolean {
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
  let prior = "0".repeat(64);
  for (const e of getOutbox()) {
    if (e.envelope.auditChain.priorHash !== prior) return false;
    const expected = sha256(`${prior}|${e.envelope.eventId}|${e.envelope.eventType}|${e.envelope.aggregateId}|${e.envelope.occurredAt}`);
    if (e.envelope.auditChain.hash !== expected) return false;
    prior = e.envelope.auditChain.hash;
  }
  return true;
}

export function bridgeHealth() {
  const outbox = getOutbox();
  const queued = outbox.filter(e => e.status === "queued" || e.status === "delivering").length;
  const dlq = outbox.filter(e => e.status === "dead_letter").length;
  const lagMs = lastSuccessAt && outbox.length > 0
    ? Math.max(0, Date.parse(lastSuccessAt) - Date.parse(outbox[outbox.length - 1].envelope.occurredAt))
    : 0;
  return {
    mode: LIVE_MODE ? "live" : (process.env.NODE_ENV === "production" ? "disabled" : "mock"),
    outboundQueueDepth: queued,
    dlqDepth: dlq,
    lastSuccessAt,
    lastReceivedAt,
    lagMs,
    hashChainOk: hashChainOk(),
    latencyP50: pNN(50),
    latencyP95: pNN(95),
    inboundCount: getInbox().length,
    samples: latencyMs.length,
  };
}

export function getBridgeCursor() {
  return { lastDeliveredEventId, lastReceivedEventId };
}

export function eventsSince(cursorEventId: string | null): OutboxEntry[] {
  const outbox = getOutbox();
  if (!cursorEventId) return outbox;
  const idx = outbox.findIndex(e => e.envelope.eventId === cursorEventId);
  if (idx < 0) return outbox;
  return outbox.slice(idx + 1);
}

/** Re-emit (push back to queued) all events since the cursor. Admin-only. */
export function replayFrom(cursorEventId: string | null): { requeued: number } {
  const events = eventsSince(cursorEventId);
  let requeued = 0;
  for (const e of events) {
    if (e.status === "delivered") {
      // mark queued again so drain re-delivers
      e.status = "queued";
      e.attempts = 0;
      e.nextRetryAt = Date.now();
      e.lastError = null;
      e.receivedAck = false;
      requeued++;
    }
  }
  return { requeued };
}

export function registerBridgeRuntimeRoutes(app: Express): void {
  // B16 (v24.0 LOCKDOWN) — every bridge runtime/operations endpoint was PUBLIC,
  // exposing replay cursors, outbound counters, and drain/replay triggers to
  // any caller (a remote attacker could replay or drain the bridge). All of
  // these are admin-only operational endpoints; the ONLY exception is
  // /api/bridge/inbound, which is a signed webhook (HMAC-verified below) and
  // must remain reachable by the external bridge without an admin session.

  // Health
  app.get("/api/bridge/health", requireAdmin, (_req: Request, res: Response) => {
    res.json(bridgeHealth());
  });

  // Cursor
  app.get("/api/bridge/cursor", requireAdmin, (_req: Request, res: Response) => {
    res.json(getBridgeCursor());
  });

  // Replay
  app.post("/api/bridge/replay-from", requireAdmin, (req: Request, res: Response) => {
    const cursor = (req.query.cursor as string | undefined) ?? null;
    res.json(replayFrom(cursor));
  });

  // Inbound webhook
  app.post("/api/bridge/inbound", (req: Request, res: Response) => {
    const sig = String(req.headers["x-bridge-signature"] ?? "");
    const body = JSON.stringify(req.body ?? {});
    const env = req.body as BridgeEnvelope | undefined;
    if (!env || !env.eventId || !env.eventType) {
      return res.status(400).json({ error: "missing_envelope" });
    }
    if (!verifyHmac(body, sig)) return res.status(401).json({ error: "invalid_hmac" });
    if (inboundSeen.has(env.eventId)) {
      // replay-safe: ack 200
      return res.status(200).json({ ok: true, idempotent: true, eventId: env.eventId });
    }
    inboundSeen.add(env.eventId);
    pushInbound(env);
    lastReceivedEventId = env.eventId;
    lastReceivedAt = new Date().toISOString();
    try {
      const out = dispatchInbound(env);
      res.json({ ok: true, applied: out.applied, handler: out.handler });
    } catch (err) {
      res.status(500).json({ error: "handler_error", message: (err as Error).message });
    }
  });

  // Trigger drain (for tests & demo). Production runs the drainer on a timer.
  app.post("/api/bridge/drain", requireAdmin, async (_req: Request, res: Response) => {
    const out = await deliverOnce();
    res.json({ ...out, ...bridgeHealth() });
  });

  // Outbound counters
  app.get("/api/bridge/outbound-counts", requireAdmin, (_req: Request, res: Response) => {
    res.json(outboundCounts());
  });

  // Per-event type list
  app.get("/api/bridge/event-types", requireAdmin, (_req: Request, res: Response) => {
    res.json({ outbound: ALL_OUTBOUND_EVENT_TYPES, inbound: ALL_INBOUND_EVENT_TYPES });
  });
}

export { emitBridgeEvent, ALL_OUTBOUND_EVENT_TYPES, ALL_INBOUND_EVENT_TYPES };
export type { OutboundEventType, InboundEventType, EmitArgs, OutboxEntry };

/** Used by tests to reset internal state. */
export function _resetRuntime() {
  latencyMs.length = 0;
  inboundSeen.clear();
  lastSuccessAt = null;
  lastReceivedEventId = null;
  lastReceivedAt = null;
  lastDeliveredEventId = null;
}
