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
import { requireSignedAgreement } from "./lib/requireSignedAgreement";
import { partnerAttributionStore, partnerTeamStore } from "./partnerWorkspaceStore";
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
      leads: partnerClientCrmStore.listLeads(pid),
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
      leadUserId: partnerClientCrmStore.getLead(pid, companyId),
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
    requireSignedAgreement,
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
        leadUserId: row.leadUserId,
        activity: partnerClientCrmStore.listActivity(pid, companyId),
      });
    },
  );

  /* w-partner F3 — assign (or clear) the designated partner-team lead for one
   * attributed company. Same write-gate as the stage transition minus `bd`:
   * choosing who owns a client is a managing_partner/associate decision.
   * The lead must be an ACTIVE member of THIS partner's team — listByPartner
   * already filters on status === "active", so a removed/suspended member and a
   * member of another workspace are both rejected by the same check. */
  app.patch(
    "/api/partner/me/client-crm/:companyId/lead",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const pid = req.partnerContext!.partnerId;
      const actor = req.partnerContext!.userId;
      const companyId = String(req.params.companyId);
      const raw = (req.body ?? {}).leadUserId;
      if (raw !== null && typeof raw !== "string") {
        return res.status(400).json({ error: "LEAD_USER_ID_REQUIRED" });
      }
      const leadUserId = typeof raw === "string" && raw.trim() ? raw.trim() : null;
      if (!isAttributed(pid, companyId)) {
        return res.status(404).json({ error: "CLIENT_NOT_FOUND_OR_NOT_ATTRIBUTED" });
      }
      if (leadUserId !== null) {
        const isActiveMember = partnerTeamStore
          .listByPartner(pid)
          .some((m) => m.userId === leadUserId);
        if (!isActiveMember) {
          return res.status(400).json({ error: "LEAD_NOT_ACTIVE_MEMBER" });
        }
      }
      const row = partnerClientCrmStore.setLead(pid, companyId, leadUserId, actor);
      res.json({
        companyId,
        stage: row.stage,
        leadUserId: row.leadUserId,
        activity: partnerClientCrmStore.listActivity(pid, companyId),
      });
    },
  );

  /* Append a manual client-scoped activity (timeline note). */
  app.post(
    "/api/partner/me/client-crm/:companyId/activity",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate", "bd"),
    requireSignedAgreement,
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
