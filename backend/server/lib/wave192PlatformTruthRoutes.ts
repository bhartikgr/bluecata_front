/**
 * server/lib/wave192PlatformTruthRoutes.ts
 *
 * WAVE 192 · ITEM A · R164 — ONE READ-ONLY ROUTE FOR THE PLATFORM TRUTH SURFACE.
 *
 * Mirrors `server/lib/wave190PaymentGatewayRoutes.ts`, which mirrors
 * `GET /api/admin/bridge/mode` — the pattern R157.4 named as the one to copy:
 * admin-gated, GET only, returns the surface object and nothing else.
 *
 * A SEPARATE FILE, deliberately. Wave 191 is live in this tree; a new file cannot
 * collide with another wave's edit, and it keeps the surface findable.
 *
 * ══ NO CREDENTIAL VALUE CAN LEAVE THROUGH THIS ROUTE. ══
 * The handler serialises exactly what `platformTruth()` returns, and that object
 * has no field capable of carrying a value — see that module's header. The
 * handler reads no environment variable itself, adds nothing of its own, and its
 * error path returns a FIXED string rather than the caught error, so a thrown
 * message cannot become an exfiltration path either.
 *
 * READ-ONLY. GET only. No POST, PATCH or DELETE is registered here, so this
 * surface cannot change an environment variable, an identity, an audit row or a
 * gateway setting even by accident. **No auth behaviour is affected**: nothing in
 * this file is consulted by any auth path.
 */
import type { Express, Request, Response } from "express";
import { requireAdmin } from "./authMiddleware";
import { log } from "./logger";
import { platformTruth } from "./wave192PlatformTruthSurface";

export function registerWave192PlatformTruthRoutes(app: Express): void {
  /* ══ ITEM A — the four safety-critical states, presence and state only ═════ */
  app.get("/api/admin/platform-truth", requireAdmin, (_req: Request, res: Response) => {
    try {
      res.json({ ok: true, truth: platformTruth() });
    } catch (err) {
      /* Logged, NOT returned. `platformTruth` already isolates each sub-producer
         so this path should be unreachable; if it is reached, the client learns
         that the surface is unavailable and nothing else. */
      log.error(`[w192-platform-truth-routes] platform truth unavailable: ${String(err)}`);
      res.status(500).json({ ok: false, error: "PLATFORM_TRUTH_UNAVAILABLE" });
    }
  });
}
