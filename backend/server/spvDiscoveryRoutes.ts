/**
 * WAVE 33 · CP-SPV-53 — SPV DISCOVERABILITY ROUTES.
 *
 *   GET /api/collective/discovery/spvs          the Collective discovery feed
 *   GET /api/capavate/discovery/spvs            the core-investor discovery feed
 *   GET /api/investor/me/spv-invitations        vehicles I have been invited to
 *   GET /api/investor/me/discovery/spv/:spvId   one vehicle, if I may reach it
 *   GET /api/partner/me/spv/:spvId/reach        GP: what reach does it ACTUALLY have
 *
 * ── WHY THESE EXIST ────────────────────────────────────────────────────────
 * `/api/collective/spvs` and `/api/capavate/spvs` already exist and are NOT
 * replaced or altered by this module — `/api/capavate/spvs` has a live consumer
 * (`client/src/pages/collective/MyPortfolioPage.tsx`). What neither of them can
 * do is honour an INVITATION, because `listVisibleForContext` is a pure
 * broadcast filter with no viewer argument, and `invite_only` is excluded from
 * it unconditionally. These routes add the viewer-scoped half and record that a
 * discovery actually happened, which is what lets the GP surface state reach
 * from rows instead of from the scope column.
 *
 * ── REFUSALS ───────────────────────────────────────────────────────────────
 * A vehicle the caller may not reach and a vehicle that does not exist return
 * the SAME 404 body. Cross-tenant refusals are 404, never 403 (a 403 confirms
 * the id exists and is an enumeration oracle). Unauthenticated is 401 and is
 * deliberately distinct, so a test can prove auth is actually mounted rather
 * than assuming it.
 */
import type { Express, Request, Response } from "express";
import { getUserContext } from "./lib/userContext";
import { requireCollectiveMember } from "./lib/requireCollectiveMember";
import { requirePartnerAuth } from "./lib/requirePartnerAuth";
import {
  discoverableSpvsFor,
  discoverableSpvFor,
  invitedSpvsFor,
  recordDiscoveryEvents,
  reachForSponsoredSpv,
} from "./spvDiscoveryStore";
import { SPV_SCOPE_REACH_COPY, isSpvScope } from "./lib/spvDiscoverability";
import { log } from "./lib/logger";

const NOT_FOUND = { error: "SPV_NOT_FOUND" } as const;

function fail(res: Response, e: unknown): Response {
  log.warn(`[spvDiscoveryRoutes] unexpected: ${e instanceof Error ? e.message : String(e)}`);
  return res.status(500).json({ error: "INTERNAL_ERROR" });
}

/** Copy for a scope, or a refusal — never a raw enum token in front of a user. */
function scopeCopy(scope: string): string {
  return isSpvScope(scope)
    ? SPV_SCOPE_REACH_COPY[scope]
    : "This vehicle's distribution scope is not one this platform recognises, so how it may be shared cannot be stated.";
}

export function registerSpvDiscoveryRoutes(app: Express): void {
  /* ── Collective discovery feed ─────────────────────────────────────────── */
  app.get("/api/collective/discovery/spvs", requireCollectiveMember, (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx?.isAuthed || !ctx.userId) return res.status(401).json({ error: "AUTH_REQUIRED" });
    try {
      const spvs = discoverableSpvsFor(ctx.userId, "collective");
      // Written only after the vehicles have been resolved.
      recordDiscoveryEvents(ctx.userId, "collective", spvs);
      res.json({
        context: "collective",
        spvs: spvs.map((s) => ({ ...s, scopeCopy: scopeCopy(s.scope) })),
        emptyCopy:
          "No vehicles are currently discoverable to you in the Collective. Private and invite-only vehicles are never listed here, and an invite-only vehicle appears only once its sponsor has invited you by email.",
      });
    } catch (e) { fail(res, e); }
  });

  /* ── Core Capavate investor discovery feed ─────────────────────────────── */
  app.get("/api/capavate/discovery/spvs", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx?.isAuthed || !ctx.userId) return res.status(401).json({ error: "AUTH_REQUIRED" });
    try {
      const spvs = discoverableSpvsFor(ctx.userId, "capavate");
      recordDiscoveryEvents(ctx.userId, "capavate", spvs);
      res.json({
        context: "capavate",
        spvs: spvs.map((s) => ({ ...s, scopeCopy: scopeCopy(s.scope) })),
        emptyCopy:
          "No vehicles are currently discoverable to you here. Collective-only vehicles are deliberately excluded from this surface.",
      });
    } catch (e) { fail(res, e); }
  });

  /* ── The invitation surface — the half that did not exist ──────────────── */
  app.get("/api/investor/me/spv-invitations", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx?.isAuthed || !ctx.userId) return res.status(401).json({ error: "AUTH_REQUIRED" });
    try {
      const spvs = invitedSpvsFor(ctx.userId);
      recordDiscoveryEvents(ctx.userId, "invited", spvs);
      res.json({
        spvs: spvs.map((s) => ({ ...s, scopeCopy: scopeCopy(s.scope) })),
        emptyCopy:
          "You have no live invitations to a sponsored vehicle. An invitation is addressed to your email address; if you expected one, check that it was sent to the address on this account.",
      });
    } catch (e) { fail(res, e); }
  });

  /* ── One vehicle, viewer-scoped ────────────────────────────────────────── */
  app.get("/api/investor/me/discovery/spv/:spvId", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx?.isAuthed || !ctx.userId) return res.status(401).json({ error: "AUTH_REQUIRED" });
    try {
      const spvId = String(req.params.spvId);
      // Try the broadcast context first, then the invitation. Both collapse to
      // the same 404, so the caller cannot distinguish "exists but private"
      // from "does not exist".
      const found =
        discoverableSpvFor(ctx.userId, spvId, "collective") ??
        discoverableSpvFor(ctx.userId, spvId, "capavate") ??
        discoverableSpvFor(ctx.userId, spvId, "invited");
      if (!found) return res.status(404).json(NOT_FOUND);
      recordDiscoveryEvents(ctx.userId, found.viaInvitation ? "invited" : "collective", [found]);
      res.json({ spv: { ...found, scopeCopy: scopeCopy(found.scope) } });
    } catch (e) { fail(res, e); }
  });

  /* ── GP: the honest reach of a vehicle I sponsor ───────────────────────── */
  app.get("/api/partner/me/spv/:spvId/reach", requirePartnerAuth, (req: Request, res: Response) => {
    // partnerId comes from the SESSION-resolved partner context, never from
    // the URL or the body — the same posture as every other /api/partner/me
    // route in the SPV engine.
    const partnerId = req.partnerContext?.partnerId;
    if (!partnerId) return res.status(401).json({ error: "AUTH_REQUIRED" });
    try {
      const reach = reachForSponsoredSpv(partnerId, String(req.params.spvId));
      // Cross-partner is 404, not 403.
      if (!reach) return res.status(404).json(NOT_FOUND);
      res.json({ reach });
    } catch (e) { fail(res, e); }
  });
}
