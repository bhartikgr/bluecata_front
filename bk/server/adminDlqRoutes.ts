/**
 * Patch v10 \u2014 Admin Dead-Letter Queue Routes (BUG-17, deferred from v9).
 *
 * Read-only admin surface over the bridge outbox failures. Mounted at
 * `/api/admin/dlq/*`. Gated by both `applyRouteGuards` (admin prefix gate)
 * and per-handler `requireAdmin` for defense in depth.
 */
import type { Express, Request, Response } from "express";
import { requireAdmin } from "./lib/authMiddleware";
import { getOutbox, replayDeadLetter } from "./bridgeStore";
import { appendAdminAudit } from "./adminPlatformStore"; /* v25.19 Lane 4 NC3 */

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
   *
   * v25.19 Lane 4 NC3 (hard close) — wired to the new `replayDeadLetter`
   * primitive in bridgeStore. Flips a dead_letter envelope back to queued,
   * resets attempts + lastError + nextRetryAt, persists, and audits.
   * Returns 404 when the event is unknown, 409 when it isn't actually in
   * dead_letter (so admins can't accidentally replay an in-flight event).
   */
  app.post("/api/admin/dlq/:eventId/replay", requireAdmin, (req: Request, res: Response) => {
    const eventId = String(req.params.eventId);
    const r = replayDeadLetter(eventId);
    if (!r.ok) {
      const code = r.error === "event_not_found" ? 404 : 409;
      return res.status(code).json({ ok: false, error: r.error, eventId });
    }
    const actor = (req as any).userContext?.userId ?? "";
    try { appendAdminAudit(actor, `dlq:${eventId}`, "bridge.dlq.replayed", { eventId, eventType: r.entry.envelope.eventType }); } catch { /* non-fatal */ }
    return res.json({ ok: true, eventId, status: r.entry.status });
  });
}
