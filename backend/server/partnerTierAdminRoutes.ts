/**
 * server/partnerTierAdminRoutes.ts — WAVE 56 (R36 / 56-Q9).
 *
 * THE ADMIN SURFACE FOR "ADD A TIER", WHICH THE PLATFORM DID NOT HAVE.
 *
 * Measured before this file was written (Wave 56 measurement pass, through the
 * real router, not by reading code):
 *
 *   POST /api/admin/partner-tiers            -> 404
 *   POST /api/admin/partner/tier-lifecycle   -> 404
 *   POST /api/admin/partner-billing/tiers    -> 404
 *   POST /api/admin/pricing/partner-tiers    -> 404
 *
 * Endpoints added here:
 *   GET   /api/admin/partner-tiers                  the tier catalogue, from the DB
 *   POST  /api/admin/partner-tiers                  create a tier
 *   POST  /api/admin/partner-tiers/:slug/freeze     visible, not purchasable, price locked
 *   POST  /api/admin/partner-tiers/:slug/archive    hidden from catalogues, history intact
 *   POST  /api/admin/partner-tiers/:slug/activate   back to purchasable
 *   PUT   /api/admin/partner-tiers/:slug/rank       re-rank an existing tier
 *
 * BOUND ACTOR, NOT "system" (R35 / R37 item 5). Every mutation resolves the
 * acting user from the request context and REFUSES with 401 when there is none.
 * The pre-existing `actorOf()` helper in adminCollectiveFeeRoutes.ts falls back
 * to the literal "u_unknown_admin"; that fallback is deliberately not copied
 * here — a change to the tier catalogue with no name attached is refused.
 *
 * NO DELETE. The database refuses it (trg_ptl_no_delete) because historical
 * invoices, subscriptions and commission rates resolve through the tier. Archive
 * is the reversible equivalent and is offered instead.
 *
 * NOTHING HERE SETS MONEY. Creating a tier does not create a price or a
 * commission rate; the response reports what is still missing so the surface
 * cannot imply the tier is ready to sell. A new tier that nobody has priced is
 * omitted from the pricing page and REFUSED by the charge path, which is the
 * correct fail-closed behaviour, not a bug to paper over.
 */
import type { Express, Request, Response } from "express";
import { requireAdmin } from "./lib/authMiddleware";
import { appendAdminAudit } from "./adminPlatformStore";
import { sanitizeErrorMessage } from "./lib/sanitize";
import { log } from "./lib/logger";
import {
  listTiers,
  getTier,
  createTier,
  freezeTier,
  archiveTier,
  activateTier,
  setTierRank,
  unresolvedFor,
  TierWriteError,
  E_TIER_EXISTS,
  E_TIER_ABSENT,
} from "./lib/partnerTierLifecycleStore";

/** The acting admin, or "" when the request carries no identity. NO FALLBACK. */
function boundActor(req: Request): string {
  const ctx = (req as Request & {
    userContext?: { identity?: { email?: string }; userId?: string };
  }).userContext;
  return String(ctx?.userId ?? ctx?.identity?.email ?? "").trim();
}

function statusFor(code: string): number {
  if (code === E_TIER_EXISTS) return 409;
  if (code === E_TIER_ABSENT) return 404;
  return 400;
}

function fail(res: Response, err: unknown): Response {
  if (err instanceof TierWriteError) {
    return res.status(statusFor(err.code)).json({ ok: false, error: err.code, message: err.message });
  }
  log.error("[partnerTierAdminRoutes] unexpected failure:", (err as Error)?.message);
  return res
    .status(500)
    .json({ ok: false, error: "TIER_WRITE_FAILED", message: sanitizeErrorMessage(err) });
}

export function registerPartnerTierAdminRoutes(app: Express): void {
  /* ----------------------------------------------------------------
   * GET /api/admin/partner-tiers
   * The catalogue, straight from partner_tier_lifecycle. Every picker on
   * every surface reads this, so no screen can carry its own list of five.
   * ---------------------------------------------------------------- */
  app.get("/api/admin/partner-tiers", requireAdmin, (_req: Request, res: Response) => {
    try {
      const tiers = listTiers().map((t) => ({ ...t, unresolved: unresolvedFor(t.slug) }));
      res.json({ ok: true, tiers });
    } catch (err) {
      return fail(res, err);
    }
  });

  /* ----------------------------------------------------------------
   * POST /api/admin/partner-tiers
   * Body: { slug, label, rank }
   * ---------------------------------------------------------------- */
  app.post("/api/admin/partner-tiers", requireAdmin, (req: Request, res: Response) => {
    const actor = boundActor(req);
    if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });
    const body = (req.body ?? {}) as { slug?: unknown; label?: unknown; rank?: unknown };
    try {
      const result = createTier(
        { slug: String(body.slug ?? ""), label: String(body.label ?? ""), rank: Number(body.rank) },
        actor,
      );
      appendAdminAudit(actor, `partner_tier_lifecycle:${result.tier.slug}`, "partner_tier.created", {
        slug: result.tier.slug,
        label: result.tier.label,
        rank: result.tier.rank,
        unresolved: result.unresolved,
      });
      return res.status(201).json({ ok: true, ...result });
    } catch (err) {
      return fail(res, err);
    }
  });

  /* ----------------------------------------------------------------
   * POST /api/admin/partner-tiers/:slug/freeze   Body: { reason }
   * ---------------------------------------------------------------- */
  app.post("/api/admin/partner-tiers/:slug/freeze", requireAdmin, (req: Request, res: Response) => {
    const actor = boundActor(req);
    if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });
    const slug = String(req.params.slug);
    const reason = String((req.body as { reason?: unknown })?.reason ?? "");
    try {
      const before = getTier(slug);
      const tier = freezeTier(slug, reason, actor);
      appendAdminAudit(actor, `partner_tier_lifecycle:${slug}`, "partner_tier.frozen", {
        slug, fromState: before?.state ?? null, toState: tier.state, reason: tier.stateReason,
      });
      return res.json({ ok: true, tier });
    } catch (err) {
      return fail(res, err);
    }
  });

  /* ----------------------------------------------------------------
   * POST /api/admin/partner-tiers/:slug/archive   Body: { reason }
   * ---------------------------------------------------------------- */
  app.post("/api/admin/partner-tiers/:slug/archive", requireAdmin, (req: Request, res: Response) => {
    const actor = boundActor(req);
    if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });
    const slug = String(req.params.slug);
    const reason = String((req.body as { reason?: unknown })?.reason ?? "");
    try {
      const before = getTier(slug);
      const tier = archiveTier(slug, reason, actor);
      appendAdminAudit(actor, `partner_tier_lifecycle:${slug}`, "partner_tier.archived", {
        slug, fromState: before?.state ?? null, toState: tier.state, reason: tier.stateReason,
      });
      return res.json({ ok: true, tier });
    } catch (err) {
      return fail(res, err);
    }
  });

  /* ----------------------------------------------------------------
   * POST /api/admin/partner-tiers/:slug/activate
   * ---------------------------------------------------------------- */
  app.post("/api/admin/partner-tiers/:slug/activate", requireAdmin, (req: Request, res: Response) => {
    const actor = boundActor(req);
    if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });
    const slug = String(req.params.slug);
    try {
      const before = getTier(slug);
      const tier = activateTier(slug, actor);
      appendAdminAudit(actor, `partner_tier_lifecycle:${slug}`, "partner_tier.activated", {
        slug, fromState: before?.state ?? null, toState: tier.state,
      });
      return res.json({ ok: true, tier });
    } catch (err) {
      return fail(res, err);
    }
  });

  /* ----------------------------------------------------------------
   * PUT /api/admin/partner-tiers/:slug/rank   Body: { rank }
   * Rank decides which gated features open, so the change is audited with the
   * before and after value, not just the new one.
   * ---------------------------------------------------------------- */
  app.put("/api/admin/partner-tiers/:slug/rank", requireAdmin, (req: Request, res: Response) => {
    const actor = boundActor(req);
    if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });
    const slug = String(req.params.slug);
    const rank = Number((req.body as { rank?: unknown })?.rank);
    try {
      const before = getTier(slug);
      const tier = setTierRank(slug, rank, actor);
      appendAdminAudit(actor, `partner_tier_rank:${slug}`, "partner_tier.reranked", {
        slug, fromRank: before?.rank ?? null, toRank: tier.rank,
      });
      return res.json({ ok: true, tier });
    } catch (err) {
      return fail(res, err);
    }
  });
}
