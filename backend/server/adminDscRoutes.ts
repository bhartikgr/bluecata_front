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
import { isNull, eq } from "drizzle-orm";
import { randomBytes, createHash } from "node:crypto";
import { requireAdmin, requireAuth } from "./lib/authMiddleware";
import * as collectiveMembershipStore from "./collectiveMembershipStore";
import { emitBridgeEvent } from "./bridgeStore";
import { emitNotification } from "./notificationsStore";
import { isOnCapTable } from "./membershipStore";
import { getDb } from "./db/connection"; /* v17 Phase B */
import { dscRoles as dscRolesTable, dscPipeline as dscPipelineTable } from "@shared/schema";
import { DEFAULT_CHAPTER_ID, DEFAULT_CHAPTER_TENANT_ID } from "./lib/chapterDefaults";
import { log } from "./lib/logger";

/** In-memory DSC role registry (mirrors `dsc_roles` table; reads stay sync). */
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

/** v17 Phase B — chain tip for dsc_roles audit trail per tenant. */
const roleChainTipByTenant = new Map<string, string | null>();

function computeRoleHash(prevHash: string | null, payload: Record<string, unknown>): string {
  const h = createHash("sha256");
  h.update(prevHash ?? "GENESIS");
  h.update("|");
  h.update(JSON.stringify(payload));
  return h.digest("hex");
}

export function isDscMember(userId: string): boolean {
  return dscRole.has(userId);
}

export function _resetForTests(): void {
  dscRole.clear();
  dscPipeline.length = 0;
  roleChainTipByTenant.clear();
}

/**
 * Test-only helper — directly seat a userId into the in-memory DSC role
 * registry. Used by v17 Phase C tests that need a DSC voter without going
 * through the admin promote HTTP path.
 */
export function _addDscMemberForTests(userId: string): void {
  dscRole.add(userId);
}

/* ---------- v17 Phase B — hydrator ---------- */
export async function hydrateAdminDscStore(): Promise<void> {
  dscRole.clear();
  dscPipeline.length = 0;
  roleChainTipByTenant.clear();
  try {
    const db: any = getDb();
    const roleRows = db
      .select()
      .from(dscRolesTable)
      .where(isNull((dscRolesTable as any).deletedAt))
      .all() as any[];
    // Sort by created_at to rebuild chain tips deterministically.
    roleRows.sort((a: any, b: any) =>
      String(a.created_at ?? a.createdAt ?? "").localeCompare(String(b.created_at ?? b.createdAt ?? "")),
    );
    for (const r of roleRows) {
      const status = r.status ?? "active";
      if (status === "active") dscRole.add(r.user_id ?? r.userId);
      const tenantId = r.tenant_id ?? r.tenantId ?? DEFAULT_CHAPTER_TENANT_ID;
      roleChainTipByTenant.set(tenantId, r.hash);
    }
    const pipeRows = db
      .select()
      .from(dscPipelineTable)
      .where(isNull((dscPipelineTable as any).deletedAt))
      .all() as any[];
    for (const r of pipeRows) {
      dscPipeline.push({
        id: r.id,
        companyId: r.company_id ?? r.companyId,
        submittedBy: r.submitted_by ?? r.submittedBy,
        submittedAt: r.submitted_at ?? r.submittedAt,
        status: (r.status ?? "pending") as DscSubmission["status"],
      });
    }
    if (roleRows.length + pipeRows.length > 0) {
      log.info(`[hydrate] adminDscStore: ${roleRows.length} role rows + ${pipeRows.length} pipeline rows restored`);
    }
    void DEFAULT_CHAPTER_ID;
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!/no such table/i.test(msg)) {
      log.warn("[hydrate] adminDscStore: DB read failed:", msg);
    }
  }
}

export function registerAdminDscRoutes(app: Express): void {
  app.post("/api/admin/dsc/promote", requireAdmin, (req: Request, res: Response) => {
    const targetUserId = typeof req.body?.userId === "string" ? req.body.userId : null;
    if (!targetUserId) return res.status(400).json({ ok: false, error: "userId required" });

    // Per spec: target must be an *active* Collective member.
    if (!collectiveMembershipStore.isActive(targetUserId)) {
      return res.status(409).json({ ok: false, error: "NOT_ACTIVE_MEMBER", message: "Target user is not an active Collective member." });
    }
    const adminUserId = req.userContext?.userId ?? ""; /* v14 */ if (!adminUserId) return res.status(401).json({ error: "missing_identity" });

    // v17 Phase B — DB write-through with hash-chain.
    const promotedAt = new Date().toISOString();
    const tenantId = DEFAULT_CHAPTER_TENANT_ID;
    const chapterId = DEFAULT_CHAPTER_ID;
    const roleId = `dscrole_${randomBytes(8).toString("hex")}`;
    try {
      const db: any = getDb();
      db.transaction((tx: any) => {
        const tipRows = tx
          .select({ hash: (dscRolesTable as any).hash, createdAt: (dscRolesTable as any).createdAt })
          .from(dscRolesTable)
          .where(eq((dscRolesTable as any).tenantId, tenantId))
          .all();
        const sorted = (tipRows as any[]).sort((a, b) =>
          String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")),
        );
        const prevHash = sorted.length > 0 ? sorted[sorted.length - 1].hash : null;
        const hash = computeRoleHash(prevHash, { roleId, userId: targetUserId, action: "promote", promotedAt });
        tx.insert(dscRolesTable).values({
          id: roleId,
          tenantId,
          chapterId,
          userId: targetUserId,
          status: "active",
          prevHash,
          hash,
          promotedBy: adminUserId,
          promotedAt,
          createdAt: promotedAt,
        } as any).run();
        roleChainTipByTenant.set(tenantId, hash);
      });
    } catch (err) {
      log.warn("[adminDscRoutes.promote] DB insert failed (memory only):", (err as Error).message);
    }
    dscRole.add(targetUserId);

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
    const adminUserId = req.userContext?.userId ?? "";

    /* v25.12 NM-4 — demote must also append a chain row + advance the
     * in-memory `roleChainTipByTenant` so the next promote does not fork
     * the chain. The prior implementation updated the existing role rows
     * to status="revoked" but never appended a demotion event and never
     * recomputed the tip — the next promote read the stale tip and
     * produced an inconsistent chain. We now write a new "demote" row in
     * the same transaction and stamp the new tip. */
    const demotedAt = new Date().toISOString();
    const tenantId = DEFAULT_CHAPTER_TENANT_ID;
    const chapterId = DEFAULT_CHAPTER_ID;
    const demoteRoleId = `dscrole_${randomBytes(8).toString("hex")}`;
    try {
      const db: any = getDb();
      db.transaction((tx: any) => {
        // 1) Mark existing active rows for this user as revoked.
        tx.update(dscRolesTable)
          .set({
            status: "revoked",
            demotedAt,
            demotedBy: adminUserId,
            updatedAt: demotedAt,
          } as any)
          .where(eq((dscRolesTable as any).userId, targetUserId))
          .run();

        // 2) Append a new chain row for the demote event.
        const tipRows = tx
          .select({ hash: (dscRolesTable as any).hash, createdAt: (dscRolesTable as any).createdAt })
          .from(dscRolesTable)
          .where(eq((dscRolesTable as any).tenantId, tenantId))
          .all() as any[];
        const sorted = tipRows.sort((a, b) =>
          String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")),
        );
        const prevHash = sorted.length > 0 ? sorted[sorted.length - 1].hash : null;
        const hash = computeRoleHash(prevHash, { roleId: demoteRoleId, userId: targetUserId, action: "demote", promotedAt: demotedAt });
        tx.insert(dscRolesTable).values({
          id: demoteRoleId,
          tenantId,
          chapterId,
          userId: targetUserId,
          status: "revoked",
          prevHash,
          hash,
          promotedBy: adminUserId,
          promotedAt: demotedAt,
          demotedAt,
          demotedBy: adminUserId,
          createdAt: demotedAt,
        } as any).run();
        roleChainTipByTenant.set(tenantId, hash);
      });
    } catch (err) {
      log.warn("[adminDscRoutes.demote] DB update failed (memory only):", (err as Error).message);
    }
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
    // v17 Phase B — DB write-through.
    try {
      const db: any = getDb();
      db.transaction((tx: any) => {
        tx.insert(dscPipelineTable).values({
          id: submission.id,
          tenantId: DEFAULT_CHAPTER_TENANT_ID,
          chapterId: DEFAULT_CHAPTER_ID,
          companyId: submission.companyId,
          submittedBy: submission.submittedBy,
          status: submission.status,
          submittedAt: submission.submittedAt,
          createdAt: submission.submittedAt,
        } as any).run();
      });
    } catch (err) {
      log.warn("[adminDscRoutes.submit] DB insert failed (memory only):", (err as Error).message);
    }
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
