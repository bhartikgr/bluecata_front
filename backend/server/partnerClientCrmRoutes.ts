/**
 * v25.49 Phase-3A — Consortium Partner Clients CRM routes.
 *
 * PARALLEL, additive route module for the separate partner-clients CRM engine.
 * Registered alongside (not inside) partnerRoutes so no existing file/route is
 * disturbed. Route base `/api/partner/me/client-crm*` is deliberately distinct
 * from the existing `/api/partner/me/clients/:id` so there is no Express path
 * collision — the two coexist.
 *
 * FAIL-CLOSED isolation: partnerId is always taken from req.partnerContext
 * (session-derived, never the URL). Every :companyId is verified to be
 * attributed to THAT partner before the store is touched; an unattributed /
 * cross-partner companyId returns 404 (never leaks existence or state).
 */
import type { Express, Request, Response } from "express";
import { requirePartnerAuth, assertSubRole } from "./lib/requirePartnerAuth";
import { partnerAttributionStore } from "./partnerWorkspaceStore";
import { partnerClientCrmStore } from "./partnerClientCrmStore";
import { PARTNER_CLIENT_STAGES, isPartnerClientStage } from "../shared/crmStages";

/** Returns true iff companyId is attributed to this partner (partner-scoped). */
function isAttributed(partnerId: string, companyId: string): boolean {
  return partnerAttributionStore.listByPartner(partnerId).some((a) => a.companyId === companyId);
}

export function registerPartnerClientCrmRoutes(app: Express): void {
  /* Stage index across all of this partner's attributed companies + vocabulary.
   * Used by the Clients list for per-row stage badges and filtering. */
  app.get("/api/partner/me/client-crm-index", requirePartnerAuth, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    res.json({
      stages: partnerClientCrmStore.listStages(pid),
      vocabulary: PARTNER_CLIENT_STAGES,
    });
  });

  /* Stage + activity timeline for one attributed company. */
  app.get("/api/partner/me/client-crm/:companyId", requirePartnerAuth, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    const companyId = String(req.params.companyId);
    if (!isAttributed(pid, companyId)) {
      return res.status(404).json({ error: "CLIENT_NOT_FOUND_OR_NOT_ATTRIBUTED" });
    }
    res.json({
      companyId,
      stage: partnerClientCrmStore.getStage(pid, companyId),
      vocabulary: PARTNER_CLIENT_STAGES,
      activity: partnerClientCrmStore.listActivity(pid, companyId),
    });
  });

  /* Durable stage transition. Write-gated to the same sub-roles that may edit
   * the pipeline (managing_partner / associate / bd); viewers are 403. */
  app.patch(
    "/api/partner/me/client-crm/:companyId",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate", "bd"),
    (req: Request, res: Response) => {
      const pid = req.partnerContext!.partnerId;
      const actor = req.partnerContext!.userId;
      const companyId = String(req.params.companyId);
      const stage = (req.body ?? {}).stage;
      if (!isPartnerClientStage(stage)) {
        return res.status(400).json({ error: "INVALID_STAGE", details: { allowed: PARTNER_CLIENT_STAGES } });
      }
      if (!isAttributed(pid, companyId)) {
        return res.status(404).json({ error: "CLIENT_NOT_FOUND_OR_NOT_ATTRIBUTED" });
      }
      const row = partnerClientCrmStore.setStage(pid, companyId, stage, actor);
      res.json({
        companyId,
        stage: row.stage,
        activity: partnerClientCrmStore.listActivity(pid, companyId),
      });
    },
  );

  /* Append a manual client-scoped activity (timeline note). */
  app.post(
    "/api/partner/me/client-crm/:companyId/activity",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate", "bd"),
    (req: Request, res: Response) => {
      const pid = req.partnerContext!.partnerId;
      const actor = req.partnerContext!.userId;
      const companyId = String(req.params.companyId);
      const body = (req.body ?? {}).body;
      if (typeof body !== "string" || !body.trim()) {
        return res.status(400).json({ error: "BODY_REQUIRED" });
      }
      if (!isAttributed(pid, companyId)) {
        return res.status(404).json({ error: "CLIENT_NOT_FOUND_OR_NOT_ATTRIBUTED" });
      }
      partnerClientCrmStore.addActivity(pid, companyId, {
        activityType: "note",
        body: body.trim(),
        actorUserId: actor,
      });
      res.json({ companyId, activity: partnerClientCrmStore.listActivity(pid, companyId) });
    },
  );
}
