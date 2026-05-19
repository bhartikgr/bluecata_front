/**
 * Patch v10 \u2014 Admin DSC Committee Promotion (P0-9 / P1-I-6).
 *
 * The Capavate Collective's Diligence & Scoring Committee (DSC) is a
 * privileged sub-role within an *active* Collective membership. The v9 fix
 * (P0-5) closed the IDOR where any caller could send `x-role: dsc` to bypass
 * the gate \u2014 but the legitimate promotion path was simply missing. This
 * file adds:
 *
 *   POST /api/admin/dsc/promote   \u2014 admin elevates an active member to DSC.
 *   POST /api/admin/dsc/demote    \u2014 admin revokes DSC.
 *   POST /api/admin/dsc/submit    \u2014 investor on cap-table submits their company
 *                                    for DSC review (Phase 4C task #5).
 *   GET  /api/admin/dsc/pipeline  \u2014 admin reads submitted companies.
 *
 * The DSC role flag itself is *not* persisted in this minimal module \u2014 it
 * lives as a set of userIds whose entitlement gate (`collectiveRoutes.ts`
 * P0-5 helper) consults. A future v11 wave can promote this to a typed table.
 */
import type { Express, Request, Response } from "express";
import { requireAdmin, requireAuth } from "./lib/authMiddleware";
import * as collectiveMembershipStore from "./collectiveMembershipStore";
import { emitBridgeEvent } from "./bridgeStore";
import { emitNotification } from "./notificationsStore";
import { isOnCapTable } from "./membershipStore";

/** In-memory DSC role registry. */
const dscRole = new Set<string>();

/** DSC pipeline submissions (companies submitted by investors for DSC review). */
type DscSubmission = {
  id: string;
  companyId: string;
  submittedBy: string;
  submittedAt: string;
  status: "pending" | "in_review" | "scored" | "rejected";
};
const dscPipeline: DscSubmission[] = [];

export function isDscMember(userId: string): boolean {
  return dscRole.has(userId);
}

export function _resetForTests(): void {
  dscRole.clear();
  dscPipeline.length = 0;
}

export function registerAdminDscRoutes(app: Express): void {
  app.post("/api/admin/dsc/promote", requireAdmin, (req: Request, res: Response) => {
    const targetUserId = typeof req.body?.userId === "string" ? req.body.userId : null;
    if (!targetUserId) return res.status(400).json({ ok: false, error: "userId required" });

    // Per spec: target must be an *active* Collective member.
    if (!collectiveMembershipStore.isActive(targetUserId)) {
      return res.status(409).json({ ok: false, error: "NOT_ACTIVE_MEMBER", message: "Target user is not an active Collective member." });
    }
    dscRole.add(targetUserId);
    const adminUserId = req.userContext?.userId ?? "u_admin";

    try {
      emitBridgeEvent({
        eventType: "dsc.score.recomputed",
        aggregateId: targetUserId,
        aggregateKind: "investor",
        payload: { userId: targetUserId, action: "promoted_to_dsc", actor: adminUserId },
      });
    } catch { /* non-fatal */ }

    try {
      emitNotification({
        userId: targetUserId,
        kind: "dsc.company_assigned",
        title: "You've been promoted to the DSC Committee.",
        body: "You can now review and score companies in the DSC pipeline.",
        link: "/collective/dsc",
      });
    } catch { /* non-fatal */ }

    res.json({ ok: true, userId: targetUserId, role: "dsc" });
  });

  app.post("/api/admin/dsc/demote", requireAdmin, (req: Request, res: Response) => {
    const targetUserId = typeof req.body?.userId === "string" ? req.body.userId : null;
    if (!targetUserId) return res.status(400).json({ ok: false, error: "userId required" });
    dscRole.delete(targetUserId);
    res.json({ ok: true, userId: targetUserId, role: null });
  });

  /**
   * Investor-side DSC committee submission endpoint (Phase 4C task #5).
   *
   * An investor on a cap table can submit their company to the DSC committee
   * for diligence review. This is the "promote my company to DSC" workflow.
   *
   * NOTE: mounted at `/api/investor/dsc/submit` — NOT `/api/admin/*` —
   * because the centralised `applyRouteGuards` middleware short-circuits
   * every `/api/admin/*` path with `requireAdmin`. Investors must call the
   * investor-namespaced submission route.
   */
  app.post("/api/investor/dsc/submit", requireAuth, (req: Request, res: Response) => {
    const ctx = req.userContext;
    if (!ctx?.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    const companyId = typeof req.body?.companyId === "string" ? req.body.companyId : null;
    if (!companyId) return res.status(400).json({ ok: false, error: "companyId required" });

    // Caller must be on the cap table of the company they submit (or admin).
    if (!ctx.isAdmin && !isOnCapTable(ctx.userId, companyId)) {
      return res.status(403).json({ ok: false, error: "NOT_ON_CAP_TABLE", message: "You must be an investor on this company's cap table to submit it for DSC review." });
    }

    const submission: DscSubmission = {
      id: `dsc_sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      companyId,
      submittedBy: ctx.userId,
      submittedAt: new Date().toISOString(),
      status: "pending",
    };
    dscPipeline.push(submission);

    try {
      emitBridgeEvent({
        eventType: "dsc.score.recomputed",
        aggregateId: companyId,
        aggregateKind: "company",
        payload: { companyId, submittedBy: ctx.userId, submissionId: submission.id, status: "pending" },
      });
    } catch { /* non-fatal */ }

    res.status(201).json({ ok: true, submission });
  });

  app.get("/api/admin/dsc/pipeline", requireAdmin, (_req: Request, res: Response) => {
    res.json({ items: dscPipeline.slice(), count: dscPipeline.length });
  });
}
