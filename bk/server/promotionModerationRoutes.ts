/**
 * server/promotionModerationRoutes.ts — CP Phase B (CP-015 .. CP-018).
 *
 * Chapter-admin moderation queue for partner-promoted Collective Deal Room
 * entries. Every Collective Deal Room promotion is created with
 * moderation_status='pending' and is invisible to non-admin Collective
 * members until a chapter admin approves it.
 *
 * Surfaces:
 *
 *   GET   /api/admin/partner/promotions/queue?status=pending
 *   GET   /api/admin/partner/promotions/:id
 *   POST  /api/admin/partner/promotions/:id/approve         body { notes? }
 *   POST  /api/admin/partner/promotions/:id/reject          body { notes? }
 *   POST  /api/admin/partner/promotions/:id/request-changes body { notes? }
 *
 * All endpoints require requireAuth + chapter-admin. The chapter resolver
 * uses the DEFAULT_CHAPTER_ID for the single-chapter v19 deployment (there
 * is currently only one chapter: chap_keiretsu_canada). Platform admins
 * bypass the chapter-admin check via the existing requireChapterAdmin
 * middleware.
 *
 * The store layer (partnerWorkspaceStore.partnerDealPromotionsStore.applyModeration)
 * performs the hash-chained UPDATE; this module is HTTP-only.
 *
 * SSE: after each transition, publish() to the 'promotion-moderation'
 * topic on the chapter.
 */

import type { Express, Request, Response } from "express";

import { requireAuth } from "./lib/authMiddleware";
import { requireChapterAdminFromRequest } from "./lib/requireChapterMember";
import {
  partnerDealPromotionsStore,
  partnerTeamStore,
  type PartnerDealModerationStatus,
} from "./partnerWorkspaceStore";
import { DEFAULT_CHAPTER_ID } from "./lib/chapterDefaults";
import { publish as ssePublish } from "./lib/sseHub";
import { appendAdminAudit } from "./adminPlatformStore";
import { emitNotification, type NotificationKind } from "./notificationsStore";
import { getDb } from "./db/connection";
import { and, eq, isNull } from "drizzle-orm";
import { chapterMemberships as chapterMembershipsTable } from "@shared/schema";
import { log } from "./lib/logger";

/**
 * CP Phase C — cross-platform notification fanout (CP-035/036/037).
 *
 * Used by the moderation route to notify both:
 *   1. The partner team (managing_partner + the user who originally promoted)
 *      when an admin action lands on their submission.
 *   2. Chapter members of the promotion's chapter when an approval flips a
 *      promotion to live, so they can see the new Deal Room entry.
 *
 * The fanout is best-effort; errors are logged but never block the
 * moderation transition.
 */
function listActiveChapterMemberUserIds(chapterId: string): string[] {
  try {
    const db: any = getDb();
    // CROSS-TENANT (admin) — chapter_memberships defines the active scope.
    const rows = db
      .select({ userId: (chapterMembershipsTable as any).userId })
      .from(chapterMembershipsTable)
      .where(
        and(
          eq((chapterMembershipsTable as any).chapterId, chapterId),
          eq((chapterMembershipsTable as any).status, "active"),
          isNull((chapterMembershipsTable as any).deletedAt),
        ),
      )
      .all() as any[];
    return rows.map((r) => String(r.userId));
  } catch (err) {
    log.warn({
      route: "promotionModeration.listChapterMembers",
      message: (err as Error).message,
    });
    return [];
  }
}

function notifyPartner(args: {
  partnerId: string;
  promoterUserId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link: string;
}): void {
  // Always notify the promoter (the user who submitted the promotion).
  const targets = new Set<string>([args.promoterUserId]);
  // Also notify every active partner team member of the partner_id so the
  // managing_partner sees moderation outcomes when an associate submitted.
  try {
    const team = partnerTeamStore.listByPartner(args.partnerId);
    for (const m of team) {
      if (m.status === "active") targets.add(m.userId);
    }
  } catch { /* non-fatal */ }
  Array.from(targets).forEach((uid) => {
    try {
      emitNotification({
        userId: uid,
        kind: args.kind,
        title: args.title,
        body: args.body,
        link: args.link,
      });
    } catch { /* non-fatal */ }
  });
}

function notifyChapterMembersOfApproval(args: {
  chapterId: string;
  promotionId: string;
  partnerId: string;
}): void {
  void args.promotionId;
  void args.partnerId;
  const userIds = listActiveChapterMemberUserIds(args.chapterId);
  for (const uid of userIds) {
    try {
      emitNotification({
        userId: uid,
        kind: "cap_table.broadcast" as NotificationKind,
        title: "New partner promotion in the Deal Room",
        body: "A consortium partner has been approved to share a new deal.",
        link: `/collective/dealroom`,
      });
    } catch { /* non-fatal */ }
  }
}

type ModerationAction = "approve" | "reject" | "request-changes";

const ACTION_MAP: Record<ModerationAction, PartnerDealModerationStatus> = {
  approve: "approved",
  reject: "rejected",
  "request-changes": "changes_requested",
};

function getActor(req: Request): string {
  const ctx = (req as Request & { userContext?: { userId?: string } }).userContext;
  return ctx?.userId ?? "u_admin_unknown";
}

function getChapterIdFromRequest(_req: Request): string {
  // v19 single-chapter deployment. Chapter context is implicit; future
  // multi-chapter rollout will derive this from the promotion row itself.
  return DEFAULT_CHAPTER_ID;
}

export function registerPromotionModerationRoutes(app: Express): void {
  const chapterAdminGate = requireChapterAdminFromRequest(getChapterIdFromRequest);

  /* ---------- Queue ---------- */
  app.get(
    "/api/admin/partner/promotions/queue",
    requireAuth,
    chapterAdminGate,
    (req: Request, res: Response): void => {
      const statusFilter = (req.query.status as string | undefined) ?? "pending";
      let rows = partnerDealPromotionsStore.listPendingModeration();
      if (statusFilter && statusFilter !== "all") {
        rows = rows.filter((r) => r.moderationStatus === statusFilter);
      }
      // Sort newest-first by promotedAt for queue display.
      rows = rows
        .slice()
        .sort((a, b) => (a.promotedAt < b.promotedAt ? 1 : -1));
      res.json({ rows, total: rows.length });
    },
  );

  /* ---------- Get single ---------- */
  app.get(
    "/api/admin/partner/promotions/:id",
    requireAuth,
    chapterAdminGate,
    (req: Request, res: Response): void => {
      const id = String(req.params.id);
      const all = [
        ...partnerDealPromotionsStore.listPendingModeration(),
        ...partnerDealPromotionsStore.listLiveCollectivePromotions(),
        ...partnerDealPromotionsStore.history(),
      ];
      const found = all.find((p) => p.id === id);
      if (!found) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json({ promotion: found });
    },
  );

  /* ---------- Transitions ---------- */
  function handleTransition(action: ModerationAction) {
    return (req: Request, res: Response): void => {
      const id = String(req.params.id);
      const actor = getActor(req);
      const body = (req.body && typeof req.body === "object" ? req.body : {}) as {
        notes?: string;
      };
      const notes =
        typeof body.notes === "string" && body.notes.trim().length > 0
          ? body.notes.trim().slice(0, 4000)
          : null;
      const nextStatus = ACTION_MAP[action];
      try {
        const updated = partnerDealPromotionsStore.applyModeration(
          id,
          nextStatus,
          actor,
          notes,
        );
        // Cross-cutting admin audit (in addition to the store-side audit row).
        try {
          appendAdminAudit(
            actor,
            `partner:${updated.partnerId}`,
            `partner.promotion.moderation.${action}`,
            {
              promotionId: updated.id,
              moderationStatus: updated.moderationStatus,
              partnerId: updated.partnerId,
              pipelineDealId: updated.pipelineDealId,
              hasNotes: notes !== null,
            },
          );
        } catch {
          /* non-fatal */
        }
        // SSE — published AFTER the store has committed.
        try {
          ssePublish(DEFAULT_CHAPTER_ID, "promotion-moderation", {
            type: `promotion.moderation.${action}`,
            promotionId: updated.id,
            moderationStatus: updated.moderationStatus,
            moderatedAt: updated.moderatedAt,
            moderatedByUserId: updated.moderatedByUserId,
          });
        } catch {
          /* non-fatal */
        }

        // CP Phase C — cross-platform notification fanout (CP-035/036/037).
        // 1) Always notify the partner team that an admin acted.
        const partnerTitle =
          action === "approve"
            ? "Your Deal Room promotion was approved"
            : action === "reject"
              ? "Your Deal Room promotion was rejected"
              : "Changes requested on your Deal Room promotion";
        const partnerBody = notes
          ? `Reviewer notes: ${notes.slice(0, 200)}`
          : `Status: ${updated.moderationStatus}`;
        notifyPartner({
          partnerId: updated.partnerId,
          promoterUserId: updated.promotedBy,
          kind: "cap_table.broadcast" as NotificationKind,
          title: partnerTitle,
          body: partnerBody,
          link: "/partner/pipeline",
        });

        // 2) On approval, notify chapter members so they see the Deal Room
        //    update without polling.
        if (action === "approve") {
          notifyChapterMembersOfApproval({
            chapterId: DEFAULT_CHAPTER_ID,
            promotionId: updated.id,
            partnerId: updated.partnerId,
          });
        }

        res.json({ promotion: updated });
      } catch (err) {
        const msg = (err as Error).message;
        if (msg === "PROMOTION_NOT_FOUND") {
          res.status(404).json({ error: "not_found" });
          return;
        }
        if (msg === "PROMOTION_NOT_MODERATABLE") {
          res.status(409).json({ error: "not_moderatable" });
          return;
        }
        log.error(`[promotion.moderation.${action}] failed:`, err);
        res.status(500).json({ error: "moderation_failed" });
      }
    };
  }

  app.post(
    "/api/admin/partner/promotions/:id/approve",
    requireAuth,
    chapterAdminGate,
    handleTransition("approve"),
  );
  app.post(
    "/api/admin/partner/promotions/:id/reject",
    requireAuth,
    chapterAdminGate,
    handleTransition("reject"),
  );
  app.post(
    "/api/admin/partner/promotions/:id/request-changes",
    requireAuth,
    chapterAdminGate,
    handleTransition("request-changes"),
  );
}
