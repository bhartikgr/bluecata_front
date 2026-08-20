/**
 * server/collectiveSubscriptionAdminRoutes.ts — WAVE 4.
 *
 * Admin CRUD for the Collective dynamic subscription-package catalog. Every route
 * is admin-gated (requireAdmin). No payment/Airwallex code is touched; the store
 * only reads existing Airwallex tier refs. Publish is blocked on price mismatch.
 *
 * Base path: /api/admin/collective-subscriptions  (10 routes)
 */
import type { Express, Request, Response } from "express";
import { requireAdmin } from "./lib/authMiddleware";
import * as store from "./collectiveSubscriptionConfigStore";
import { log } from "./lib/logger";

function actorOf(req: Request): string {
  const ctx = (req as any).userContext;
  return String(ctx?.userId ?? "u_unknown_admin");
}

/* ── WAVE 57d · D4 — BIND THE ACTOR ON THE DESTRUCTIVE ROUTE, FAIL CLOSED ──────
   `actorOf()` above falls back to the literal `"u_unknown_admin"`. Wave 57c
   classified this file among the "24 non-destructive" anonymous-actor sites;
   independent Review 1 found that classification false and named
   `DELETE /api/admin/collective-subscriptions/:id` → `store.deletePackage()`
   explicitly. Deleting a subscription package is a money-control change, and an
   audit row attributed to `u_unknown_admin` looks like a record and is not one
   (R35).

   NARROWEST FIX, deliberately: only the DELETE route is switched to this
   fail-closed resolver. `actorOf` itself is LEFT AS IS so the five
   non-destructive routes in this file (list/get/create/update/promote/clone/
   bootstrap) keep their exact current behaviour — changing the shared helper
   would have been the sweeping option, and it is recorded as a recommendation
   for the authorised 57e sweep instead.

   `requireAdmin` is mounted on every route in this file and always assigns
   `req.userContext`, so the 401 branch is unreachable under today's mounts and
   no legitimate deletion is affected. The point is that it cannot become
   reachable silently. Pattern source: server/bridgeStore.ts:1500 and Wave 57c's
   four bound sites. */
function requireActorOrRefuse(req: Request, res: Response): string | null {
  const ctx = (req as any).userContext;
  const userId = ctx?.userId ? String(ctx.userId) : "";
  if (!userId) {
    res.status(401).json({ ok: false, error: "missing_identity", code: "missing_identity" });
    return null;
  }
  return userId;
}

export function registerCollectiveSubscriptionAdminRoutes(app: Express): void {
  const BASE = "/api/admin/collective-subscriptions";

  // GET list (?status=&includeDeleted=&includeExpired=)
  app.get(BASE, requireAdmin, (req: Request, res: Response) => {
    const status = typeof req.query.status === "string" ? (req.query.status as store.CollectiveSubscriptionStatus) : undefined;
    const includeDeleted = req.query.includeDeleted === "true";
    const includeExpired = req.query.includeExpired === "true";
    const packages = store.listPackages({ status, includeDeleted, includeExpired });
    res.json({ ok: true, packages });
  });

  // GET available Airwallex price refs (existing refs only)
  app.get(`${BASE}/airwallex-price-refs`, requireAdmin, (_req: Request, res: Response) => {
    res.json({ ok: true, refs: store.listAvailableAirwallexPriceRefs() });
  });

  // GET one
  app.get(`${BASE}/:id`, requireAdmin, (req: Request, res: Response) => {
    const pkg = store.getPackage(String(req.params.id));
    if (!pkg) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, package: pkg });
  });

  // GET history + chain health
  app.get(`${BASE}/:id/history`, requireAdmin, (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!store.getPackage(id, { includeDeleted: true })) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, history: store.getPackageHistory(id), chain: store.verifyPackageChain(id) });
  });

  // POST create
  app.post(BASE, requireAdmin, (req: Request, res: Response) => {
    const r = store.createPackage(req.body ?? {}, actorOf(req));
    if (!r.ok) return res.status(400).json(r);
    res.status(201).json(r);
  });

  // PATCH update
  app.patch(`${BASE}/:id`, requireAdmin, (req: Request, res: Response) => {
    const r = store.updatePackage(String(req.params.id), req.body ?? {}, actorOf(req));
    if (!r.ok) return res.status(r.error === "not_found" ? 404 : 400).json(r);
    res.json(r);
  });

  // POST promote { to }
  app.post(`${BASE}/:id/promote`, requireAdmin, (req: Request, res: Response) => {
    const to = String((req.body ?? {}).to ?? "") as store.CollectiveSubscriptionStatus;
    const r = store.promotePackage(String(req.params.id), to, actorOf(req));
    if (!r.ok) return res.status(r.error === "not_found" ? 404 : 400).json(r);
    res.json(r);
  });

  // POST clone
  app.post(`${BASE}/:id/clone`, requireAdmin, (req: Request, res: Response) => {
    const r = store.clonePackage(String(req.params.id), actorOf(req));
    if (!r.ok) return res.status(r.error === "not_found" ? 404 : 400).json(r);
    res.status(201).json(r);
  });

  // DELETE (soft; live -> must deprecate)
  app.delete(`${BASE}/:id`, requireAdmin, (req: Request, res: Response) => {
    /* WAVE 57d D4 — bound actor, fail closed BEFORE the delete. See header. */
    const deleteActorId = requireActorOrRefuse(req, res);
    if (!deleteActorId) return;
    const r = store.deletePackage(String(req.params.id), deleteActorId);
    if (!r.ok) return res.status(r.error === "not_found" ? 404 : 400).json(r);
    res.json(r);
  });

  // POST bootstrap-from-env (draft rows only; refuses if any rows exist)
  app.post(`${BASE}/bootstrap-from-env`, requireAdmin, (req: Request, res: Response) => {
    const r = store.bootstrapPackagesFromEnv(actorOf(req));
    if (!r.ok) return res.status(400).json(r);
    res.status(201).json(r);
  });

  log.info("[collectiveSubscriptionAdminRoutes] registered 10 routes under /api/admin/collective-subscriptions");
}
