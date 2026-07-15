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
  return String(ctx?.userId ?? "admin");
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
    const r = store.deletePackage(String(req.params.id), actorOf(req));
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
