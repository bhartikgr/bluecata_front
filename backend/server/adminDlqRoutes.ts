/**
 * Patch v10 \u2014 Admin Dead-Letter Queue Routes (BUG-17, deferred from v9).
 *
 * Read-only admin surface over the bridge outbox failures. Mounted at
 * `/api/admin/dlq/*`. Gated by both `applyRouteGuards` (admin prefix gate)
 * and per-handler `requireAdmin` for defense in depth.
 */
import type { Express, Request, Response } from "express";
import { requireAdmin } from "./lib/authMiddleware";
import { getOutbox } from "./bridgeStore";

export function registerAdminDlqRoutes(app: Express): void {
  app.get("/api/admin/dlq", requireAdmin, (_req: Request, res: Response) => {
    const all = getOutbox();
    const items = all.filter((e) => e.status === "dead_letter").map((e) => ({
      eventId: e.envelope.eventId,
      eventType: e.envelope.eventType,
      aggregateId: e.envelope.aggregateId,
      aggregateKind: e.envelope.aggregateKind,
      attempts: e.attempts,
      lastError: e.lastError,
      enqueuedAt: e.enqueuedAt,
      occurredAt: e.envelope.occurredAt,
    }));
    res.json({ items, count: items.length });
  });

  app.get("/api/admin/dlq/stats", requireAdmin, (_req: Request, res: Response) => {
    const all = getOutbox();
    const byStatus: Record<string, number> = {};
    for (const e of all) byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
    res.json({
      total: all.length,
      byStatus,
      deadLetter: byStatus.dead_letter ?? 0,
      queued: byStatus.queued ?? 0,
      delivering: byStatus.delivering ?? 0,
      delivered: byStatus.delivered ?? 0,
    });
  });

  /**
   * POST /api/admin/dlq/:eventId/replay
   * Returns 501 \u2014 the underlying outbox replay primitive doesn't yet exist
   * in the bridge layer (would need to mutate status from `dead_letter` back
   * to `queued` and reset `attempts`). Stubbed so the UI can render a Replay
   * button without 404'ing; mark TODO for v11.
   */
  app.post("/api/admin/dlq/:eventId/replay", requireAdmin, (req: Request, res: Response) => {
    res.status(501).json({ ok: false, error: "NOT_IMPLEMENTED", eventId: req.params.eventId, message: "DLQ replay primitive not yet wired in bridgeStore; tracked for v11." });
  });
}
