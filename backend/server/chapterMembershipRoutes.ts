/**
 * server/chapterMembershipRoutes.ts — W-COLLECTIVE Wave 2 STAGE D (D2).
 *
 * The minimal Collective/admin surface that makes the `chapter_memberships`
 * writer reachable in production. Before this file, audience ROW 5 in
 * `server/lib/networkPostAudience.ts` could never fire on live data because no
 * production path wrote that table (only the 0096 backfill, the demo seeder and
 * the test-debug endpoints did).
 *
 * ENDPOINTS (all under the existing `/api/collective` prefix)
 *   GET    /api/collective/chapters/:chapterId/members
 *          The ACTIVE roster. Names resolved PER VIEWER through the SACRED
 *          privacy resolver in the `chapterRoster` context, which requires an
 *          explicit `visibleInCollectiveDirectory` opt-in — so listing a roster
 *          can never reveal an identity its owner did not consent to expose
 *          socially. Raw `legalName` is never emitted.
 *   POST   /api/collective/chapters/:chapterId/members  { userId, role? }
 *          Add / restore an ACTIVE membership. Idempotent.
 *   DELETE /api/collective/chapters/:chapterId/members/:userId
 *          Revoke (soft, reversible).
 *
 * AUTHORISATION — fail closed, in this order:
 *   1. authenticated (`req.userContext.isAuthed`), else 401;
 *   2. platform admin (`userContext.isAdmin`) OR an ACTIVE chapter admin
 *      (`chapter_memberships.role='admin'`) OR the chapter's bootstrap
 *      `chapters.admin_user_id`, else 403.
 *   Reading the roster additionally allows any ACTIVE member of that chapter —
 *   a member may see who else is in their own chapter, subject to the per-member
 *   privacy resolution above.
 *
 * ⚠ MONEY. `chapter_memberships` gates Airwallex payment-intent creation and
 * subscription cancel/resume (`server/collectiveBillingStore.ts:190` →
 * `:1351/:1498/:1555/:1635/:1806`), the DSC vote quorum denominator
 * (`server/collectiveDscVoteRoutes.ts:136-145`) and M&A intel authz
 * (`server/lib/maAuthzGate.ts:111-118`). This file writes no billing row, but a
 * write here MOVES A PAYMENT AUTHORISATION. The hard preconditions live in
 * `server/lib/chapterGovernanceRules.ts` and are enforced inside the writer, so
 * they cannot be bypassed by a future caller that skips this route:
 *   409 SUBSCRIPTION_ACTIVE_CANCEL_FIRST — target still holds a billable row;
 *   409 LAST_CHAPTER_ADMIN               — would leave the chapter admin-less;
 *   503 BILLING_STATE_UNVERIFIABLE / ADMIN_STATE_UNVERIFIABLE / AUDIT_UNAVAILABLE
 *       — a precondition could not be evaluated, so the write was refused.
 *
 * ROUTE-SIGNATURE NOTE (Stage B's Express overload trap): every handler below is
 * registered with an EXPLICIT params generic (`app.get<{ chapterId: string }>`)
 * so `req.params.*` stays `string` and never widens to `string | string[]`.
 * No middleware argument is used — the auth checks are inline — so the
 * single-handler overload is what resolves.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";

import {
  activeChapter,
  addChapterMembership,
  revokeChapterMembership,
  listActiveChapterMembers,
  isActiveChapterMember,
  isChapterAdmin,
  type ChapterMemberRole,
} from "./lib/chapterMembershipWriter";
import {
  CONFLICT_GUARD_ERRORS,
  GUARD_ERRORS,
  UNAVAILABLE_GUARD_ERRORS,
} from "./lib/chapterGovernanceRules";
import { resolveDisplayName } from "./lib/userPrivacyResolver";
import { durableCommsUserRef } from "./lib/commsUserDirectory";
import { log } from "./lib/logger";

type Ctx = { userId?: string; isAuthed?: boolean; isAdmin?: boolean } | undefined;

function ctxOf(req: Request): Ctx {
  return (req as Request & { userContext?: Ctx }).userContext;
}

/**
 * HTTP status for a refused write. Guard refusals are CONFLICTS (409) or
 * DEGRADED (503) — never a 200, and never silently downgraded to a warning.
 */
function statusForWriteError(error: string, fallback: number): number {
  if (error === "user_not_found") return 404;
  if (error === "chapter_not_active") return 404;
  if (error === GUARD_ERRORS.NOT_CHAPTER_ADMIN) return 403;
  if (CONFLICT_GUARD_ERRORS.has(error)) return 409;
  if (UNAVAILABLE_GUARD_ERRORS.has(error)) return 503;
  if (error === "membership_state_unverifiable") return 503;
  return fallback;
}

const addMemberSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["member", "admin"]).optional(),
});

export function registerChapterMembershipRoutes(app: Express): void {
  /* ---------------------------------------------------------------- roster */
  app.get<{ chapterId: string }>(
    "/api/collective/chapters/:chapterId/members",
    (req: Request<{ chapterId: string }>, res: Response) => {
      const ctx = ctxOf(req);
      if (!ctx?.isAuthed || !ctx.userId) {
        return res.status(401).json({ ok: false, error: "unauthenticated" });
      }
      const chapterId = req.params.chapterId;
      const chapter = activeChapter(chapterId);
      if (!chapter) return res.status(404).json({ ok: false, error: "chapter_not_active" });
      const viewerId = ctx.userId;
      const mayRead =
        ctx.isAdmin === true ||
        isChapterAdmin(chapterId, viewerId) ||
        isActiveChapterMember(chapterId, viewerId);
      if (!mayRead) return res.status(403).json({ ok: false, error: "not_a_chapter_member" });

      const members = listActiveChapterMembers(chapterId).map((m) => {
        const ref = durableCommsUserRef(m.userId);
        /* SACRED resolver, `chapterRoster` context: explicit opt-in required.
           `legalName` is passed IN (the resolver needs it to be able to return
           it) but is NEVER passed OUT — only the resolved label is. */
        const displayName = resolveDisplayName(m.userId, viewerId, "chapterRoster", {
          legalName: ref?.legalName ?? "",
        });
        return {
          userId: m.userId,
          displayName,
          isAnonymous: displayName === "Private Investor",
          role: m.role,
          status: m.status,
          joinedAt: m.joinedAt,
        };
      });
      return res.json({
        ok: true,
        chapterId: chapter.id,
        chapterName: chapter.name,
        memberCount: members.length,
        members,
      });
    },
  );

  /* ------------------------------------------------------------ add member */
  app.post<{ chapterId: string }>(
    "/api/collective/chapters/:chapterId/members",
    (req: Request<{ chapterId: string }>, res: Response) => {
      const ctx = ctxOf(req);
      if (!ctx?.isAuthed || !ctx.userId) {
        return res.status(401).json({ ok: false, error: "unauthenticated" });
      }
      const chapterId = req.params.chapterId;
      if (!activeChapter(chapterId)) {
        return res.status(404).json({ ok: false, error: "chapter_not_active" });
      }
      if (ctx.isAdmin !== true && !isChapterAdmin(chapterId, ctx.userId)) {
        return res.status(403).json({ ok: false, error: "not_a_chapter_admin" });
      }
      const parsed = addMemberSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ ok: false, error: "invalid", issues: parsed.error.issues });
      }
      const role = (parsed.data.role ?? "member") as ChapterMemberRole;
      const result = addChapterMembership(chapterId, parsed.data.userId, {
        userId: ctx.userId,
        isPlatformAdmin: ctx.isAdmin === true,
      }, role);
      if (!result.ok) {
        // Fail closed and say why — never a 200 for a write that did not land.
        return res.status(statusForWriteError(result.error, 400)).json({
          ok: false,
          error: result.error,
          ...(result.message ? { message: result.message } : {}),
          ...(result.rule ? { rule: result.rule } : {}),
          ...(result.details ? { details: result.details } : {}),
        });
      }
      log.info(
        `[chapterMembership] ${ctx.userId} added ${parsed.data.userId} to ${chapterId} as ${result.role ?? role}` +
          (result.roleUnchanged ? ` (requested ${role}; existing role PRESERVED — no implicit demotion)` : ""),
      );
      return res.json(result);
    },
  );

  /* --------------------------------------------------------- revoke member */
  app.delete<{ chapterId: string; userId: string }>(
    "/api/collective/chapters/:chapterId/members/:userId",
    (req: Request<{ chapterId: string; userId: string }>, res: Response) => {
      const ctx = ctxOf(req);
      if (!ctx?.isAuthed || !ctx.userId) {
        return res.status(401).json({ ok: false, error: "unauthenticated" });
      }
      const chapterId = req.params.chapterId;
      const targetUserId = req.params.userId;
      // A member may always remove THEMSELVES; otherwise chapter-admin only.
      const selfRemoval = targetUserId === ctx.userId;
      if (!selfRemoval && ctx.isAdmin !== true && !isChapterAdmin(chapterId, ctx.userId)) {
        return res.status(403).json({ ok: false, error: "not_a_chapter_admin" });
      }
      const result = revokeChapterMembership(chapterId, targetUserId, {
        userId: ctx.userId,
        isPlatformAdmin: ctx.isAdmin === true,
      });
      if (!result.ok) {
        return res.status(statusForWriteError(result.error, 400)).json({
          ok: false,
          error: result.error,
          ...(result.message ? { message: result.message } : {}),
          ...(result.rule ? { rule: result.rule } : {}),
          ...(result.details ? { details: result.details } : {}),
        });
      }
      log.info(`[chapterMembership] ${ctx.userId} revoked ${targetUserId} from ${chapterId}`);
      return res.json(result);
    },
  );
}

export default registerChapterMembershipRoutes;
