/**
 * WAVE 32 · CP-SPV-30 · CAPABILITY 5 — LP POSITIONS ROUTES.
 *
 *   GET /api/investor/me/lp-positions            every LP position THIS identity holds
 *   GET /api/investor/me/lp-positions/:spvId     one of them, in detail
 *
 * NOT A SEPARATE PORTAL (ruling A-23 and `spec/LP_SCOPED_VIEW_DESIGN.md`). These
 * are investor-portal routes on the existing investor session identity. There is
 * no `client/src/pages/lp/*`, no second login and no LP account type; the scoped
 * view is what the DATA PREDICATE produces for someone who holds only vehicle
 * positions.
 *
 * LP PRIVACY (WAVE 29 / WAIVER-4).
 *   · the investor comes from the SESSION; there is no path, query or body field
 *     naming an investor, so there is nothing for LP A to point at LP B;
 *   · the store scopes by `investor_id` in the SQL; the register, co-investor
 *     identities and other LPs' commitments never enter the response. Only a
 *     vehicle-level SUM is used, to compute the caller's own ownership
 *     fraction — an aggregate, not a disclosure;
 *   · a non-member asking for a specific vehicle gets 404, byte-identical to a
 *     vehicle that does not exist (rule 6: 404, not 403 — no enumeration oracle);
 *   · the LIST route returns an empty array for someone with no LP positions
 *     rather than an error, so its shape leaks nothing either.
 *
 * `capTableMembership.ts` (sacred) is neither called around nor re-implemented.
 * An LP interest is an interest in the VEHICLE; the vehicle is the cap-table
 * member. That separation is the whole enforcement point of the ruling.
 */
import type { Express, Request, Response } from "express";
import { getUserContext } from "./lib/userContext";
import { lpPositionsFor, lpPositionFor, LP_COLLECTIVE_SCOPE } from "./lpPositionsStore";
import { log } from "./lib/logger";

function fail(res: Response, e: unknown): Response {
  log.warn(`[lpPositionsRoutes] unexpected: ${e instanceof Error ? e.message : String(e)}`);
  return res.status(500).json({ error: "INTERNAL_ERROR" });
}

export function registerLpPositionsRoutes(app: Express): void {
  app.get("/api/investor/me/lp-positions", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx?.isAuthed || !ctx.userId) return res.status(401).json({ error: "AUTH_REQUIRED" });
    try {
      res.json({
        positions: lpPositionsFor(ctx.userId),
        // Stated on the wire so the UI can render the boundary honestly rather
        // than inferring it, and so a change of ruling is visible in responses.
        collectiveScope: LP_COLLECTIVE_SCOPE,
      });
    } catch (e) { fail(res, e); }
  });

  app.get("/api/investor/me/lp-positions/:spvId", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx?.isAuthed || !ctx.userId) return res.status(401).json({ error: "AUTH_REQUIRED" });
    try {
      const position = lpPositionFor(String(req.params.spvId), ctx.userId);
      // Non-membership and non-existence collapse into ONE refusal.
      if (!position) return res.status(404).json({ error: "SPV_NOT_FOUND" });
      res.json({ position, collectiveScope: LP_COLLECTIVE_SCOPE });
    } catch (e) { fail(res, e); }
  });
}
