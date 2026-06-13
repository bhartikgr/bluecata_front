/**
 * Sprint 13 — Sync Dashboard endpoints (read-mostly).
 * Exposes everything the /admin/sync UI needs in one tree.
 */
import type { Express, Request, Response } from "express";
import { bridgeHealth, outboundCounts, _resetRuntime } from "./bridgeRuntime";
import { getOutbox, getInbox, ALL_OUTBOUND_EVENT_TYPES, ALL_INBOUND_EVENT_TYPES } from "../bridgeStore";
import { computeDrift, seedSnapshot } from "./driftDetector";
import { ALL_INBOUND_HANDLERS } from "./bridgeInbound";

let seeded = false;

export function registerSyncDashboardRoutes(app: Express): void {
  if (!seeded) { seedSnapshot(); seeded = true; }

  app.get("/api/admin/sync/overview", (_req: Request, res: Response) => {
    const out = getOutbox();
    const dlq = out.filter(e => e.status === "dead_letter");
    res.json({
      health: bridgeHealth(),
      outboundCounts: outboundCounts(),
      outboundTotal: out.length,
      outboundDelivered: out.filter(e => e.status === "delivered").length,
      outboundQueued: out.filter(e => e.status === "queued" || e.status === "delivering").length,
      dlq: dlq.map(e => ({
        eventId: e.envelope.eventId,
        eventType: e.envelope.eventType,
        aggregateId: e.envelope.aggregateId,
        attempts: e.attempts,
        reason: e.lastError ?? "unknown",
        enqueuedAt: e.enqueuedAt,
      })),
      inboundTotal: getInbox().length,
      inboundHandlers: ALL_INBOUND_HANDLERS,
      eventTypes: { outbound: ALL_OUTBOUND_EVENT_TYPES, inbound: ALL_INBOUND_EVENT_TYPES },
    });
  });

  app.get("/api/admin/sync/drift", (_req: Request, res: Response) => {
    res.json({ rows: computeDrift() });
  });

  app.post("/api/admin/sync/replay", (req: Request, res: Response) => {
    const { eventId } = req.body ?? {};
    const out = getOutbox();
    const e = out.find(o => o.envelope.eventId === eventId);
    if (!e) return res.status(404).json({ error: "not_found" });
    e.status = "queued";
    e.attempts = 0;
    e.nextRetryAt = Date.now();
    e.lastError = null;
    e.receivedAck = false;
    return res.json({ ok: true, eventId });
  });

  // Test harness only.
  app.post("/api/admin/sync/_reset", (_req: Request, res: Response) => {
    _resetRuntime();
    res.json({ ok: true });
  });
}
