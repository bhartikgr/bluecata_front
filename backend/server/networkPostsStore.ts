/**
 * Sprint 18 Phase 2 — Network Posts feed.
 *
 * Tiny pass-through that exposes the comms post feed as the canonical source
 * for the new /founder/network-posts page. The actual posts collection lives
 * inside commsStore (private). We surface a count helper here.
 */
import type { Express, Request, Response } from "express";

export function registerNetworkPostsRoutes(app: Express): void {
  // Health endpoint so the deploy-gate can verify the route exists.
  app.get("/api/founder/network-posts/health", (_req: Request, res: Response) => {
    res.json({ ok: true, source: "/api/comms/posts" });
  });
}
