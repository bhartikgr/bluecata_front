/**
 * Patch v10 — Admin Collective Application Approval Pipeline.
 *
 * Bug IDs: P0-10, C-CORE-1, BUG-14, BUG-7, P1-I-4 (status race).
 *
 * Before v10, applications were write-only — investors could POST to
 * `/api/collective/applications` but no admin endpoint existed to approve or
 * reject. The submitted-application status was effectively dead state.
 *
 * This module wires the missing surfaces:
 *   GET   /api/admin/collective/applications              \u2014 list w/ status filter
 *   POST  /api/admin/collective/applications/:id/approve  \u2014 activate membership
 *   POST  /api/admin/collective/applications/:id/reject   \u2014 mark rejected
 *
 * Approval side-effects:
 *   1. `applicationsStore.setApplicationStatus(id, "accepted")`.
 *   2. `collectiveMembershipStore.activate(application.userId, adminUserId)`.
 *   3. Bridge event `collective.member.updated` emitted via `emitBridgeEvent`.
 *   4. In-app notification `collective.membership_approved` to the applicant.
 *
 * The admin role gate is enforced both by the centralised `applyRouteGuards`
 * middleware (which guards every `/api/admin/*` path) AND by an explicit
 * `requireAdmin` import for defense in depth.
 */
import type { Express, Request, Response } from "express";
import { requireAdmin } from "./lib/authMiddleware";
import {
  listApplications,
  getApplicationById,
  setApplicationStatus,
} from "./collectiveAppStore";
import * as collectiveMembershipStore from "./collectiveMembershipStore";
import { emitBridgeEvent } from "./bridgeStore";
import { emitNotification } from "./notificationsStore";

export function registerAdminCollectiveRoutes(app: Express): void {
  /**
   * GET /api/admin/collective/applications
   *   ?status=submitted|reviewing|accepted|rejected|waitlisted
   */
  app.get("/api/admin/collective/applications", requireAdmin, (req: Request, res: Response) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const apps = status
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? listApplications({ status: status as any })
      : listApplications();
    res.json({ items: apps, count: apps.length });
  });

  app.post("/api/admin/collective/applications/:id/approve", requireAdmin, (req: Request, res: Response) => {
    const id = req.params.id;
    const app1 = getApplicationById(id);
    if (!app1) return res.status(404).json({ ok: false, error: "APPLICATION_NOT_FOUND" });

    const adminUserId = req.userContext?.userId ?? "u_admin";
    const updated = setApplicationStatus(id, "accepted");
    const membership = collectiveMembershipStore.activate(app1.userId, adminUserId);

    // Bridge event so downstream consumers (Collective shell, entitlement
    // recompute jobs) pick up the activation without polling.
    try {
      emitBridgeEvent({
        eventType: "collective.member.updated",
        aggregateId: app1.userId,
        aggregateKind: "investor",
        payload: {
          applicationId: id,
          userId: app1.userId,
          status: "active",
          activatedBy: adminUserId,
        },
      });
    } catch { /* non-fatal */ }

    // In-app notification to the applicant.
    try {
      emitNotification({
        userId: app1.userId,
        kind: "collective.membership_approved",
        title: "You're in — welcome to the Collective.",
        body: "Your Capavate Collective application has been approved.",
        link: "/collective",
      });
    } catch { /* non-fatal */ }

    res.json({ ok: true, application: updated, membership });
  });

  app.post("/api/admin/collective/applications/:id/reject", requireAdmin, (req: Request, res: Response) => {
    const id = req.params.id;
    const reason = typeof req.body?.reason === "string" ? req.body.reason : "Application not accepted at this time.";
    const app1 = getApplicationById(id);
    if (!app1) return res.status(404).json({ ok: false, error: "APPLICATION_NOT_FOUND" });

    const adminUserId = req.userContext?.userId ?? "u_admin";
    const updated = setApplicationStatus(id, "rejected");

    try {
      emitBridgeEvent({
        eventType: "collective.member.updated",
        aggregateId: app1.userId,
        aggregateKind: "investor",
        payload: { applicationId: id, userId: app1.userId, status: "rejected", rejectedBy: adminUserId, reason },
      });
    } catch { /* non-fatal */ }

    res.json({ ok: true, application: updated });
  });
}
