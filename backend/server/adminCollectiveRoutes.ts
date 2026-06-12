/**
 * Patch v10 — Admin Collective Application Approval Pipeline.
 *
 * Bug IDs: P0-10, C-CORE-1, BUG-14, BUG-7, P1-I-4 (status race).
 *
 * v23.5 C-009 FIX: Bridge admin endpoints to read from BOTH stores.
 *   - Legacy: collectiveAppStore (investor-side applications, StoredApplication)
 *   - Modern: founderCollectiveApplyStore (founder Path B applications, CompanyApplication)
 *
 * Same architectural pattern as v23.4.13 L-009 (preview/redeem bridge).
 * Admin GET merges both. Approve/reject: try legacy first, fall through to modern.
 *
 * This module wires the admin surfaces:
 *   GET   /api/admin/collective/applications              — list w/ status filter (BOTH stores)
 *   POST  /api/admin/collective/applications/:id/approve  — activate membership (BOTH stores)
 *   POST  /api/admin/collective/applications/:id/reject   — mark rejected (BOTH stores)
 *   GET   /api/admin/collective/members                   — list active collective members
 *
 * Approval side-effects:
 *   1. setApplicationStatus(id, "accepted") on whichever store had the hit.
 *   2. collectiveMembershipStore.activate(userId, adminUserId).
 *   3. Bridge event collective.member.updated emitted via emitBridgeEvent.
 *   4. In-app notification collective.membership_approved to the applicant.
 *
 * The admin role gate is enforced both by the centralised applyRouteGuards
 * middleware (which guards every /api/admin/* path) AND by an explicit
 * requireAdmin import for defense in depth.
 */
import type { Express, Request, Response } from "express";
import { requireAdmin } from "./lib/authMiddleware";

type AugReq = Request & { userContext?: { userId?: string; isAdmin?: boolean; isAuthed?: boolean } };
import {
  listApplications as legacyListApplications,
  getApplicationById as legacyGetApplicationById,
  setApplicationStatus as legacySetApplicationStatus,
} from "./collectiveAppStore";
import * as founderApply from "./founderCollectiveApplyStore";
import * as collectiveMembershipStore from "./collectiveMembershipStore";
import { upsertActiveMembership, deactivateMembership } from "./membershipStore"; /* v16 F-coll-X3 dual-write */
import { emitBridgeEvent } from "./bridgeStore";
import { emitNotification } from "./notificationsStore";
// C-011 fix v23.6: enrich admin applications list with resolved names
import { getCompanyNameById } from "./multiCompanyStore";
import { getUserContextForId } from "./lib/userContext";
import { lookupByUserId, lookupByEmail } from "./userCredentialsStore"; // v23.8 W-14 member enrichment; v24.4 bootstrap
import { upsertDirectoryListing, removeDirectoryListing } from "./collectiveInterestStore"; /* v25.0 Track 2 B3 */

export function registerAdminCollectiveRoutes(app: Express): void {
  /**
   * GET /api/admin/collective/applications
   *   ?status=submitted|reviewing|accepted|rejected|waitlisted
   *
   * C-009 fix v23.5: reads from BOTH collectiveAppStore (legacy/investor) AND
   * founderCollectiveApplyStore (modern/founder Path B). Merged and sorted by
   * submittedAt desc.
   */
  app.get("/api/admin/collective/applications", requireAdmin, (req: Request, res: Response) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    // Legacy store: investor-side applications (collectiveAppStore)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const legacy = status ? legacyListApplications({ status: status as any }) : legacyListApplications();
    // Modern store: founder Path B applications (founderCollectiveApplyStore)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const modern = status ? founderApply.listApplications({ status: status as any }) : founderApply.listApplications();
    // Merge and sort by submittedAt descending
    const merged = ([...legacy, ...modern] as Array<{ submittedAt?: string; [k: string]: unknown }>)
      .sort((a, b) =>
        new Date((b.submittedAt ?? 0)).getTime() - new Date((a.submittedAt ?? 0)).getTime()
      );
    // C-011 fix v23.6: enrich admin applications list with resolved names
    const enriched = merged.map((app) => {
      const companyId = (app as any).companyId as string | undefined;
      const founderId = (app as any).founderId as string | undefined;
      const userId = (app as any).userId as string | undefined;
      // Resolve company name: try multiCompanyStore (all real companies)
      const companyName = companyId ? getCompanyNameById(companyId) : undefined;
      // Resolve founder name: try userContext for founderId or userId
      let founderName: string | undefined;
      try {
        const uid = founderId ?? userId;
        if (uid) {
          const uctx = getUserContextForId(uid);
          founderName = uctx?.identity?.name || undefined;
        }
      } catch { /* non-fatal — founderName stays undefined */ }
      return {
        ...app,
        companyName: companyName ?? companyId,
        founderName: founderName ?? founderId ?? userId,
      };
    });
    res.json({ items: enriched, count: enriched.length });
  });

  /**
   * GET /api/admin/collective/members
   *
   * v23.5: list active Collective members from collectiveMembershipStore.
   */
  app.get("/api/admin/collective/members", requireAdmin, (_req: Request, res: Response) => {
    const members = collectiveMembershipStore.listActive();
    // v23.8 W-14: enrich each row with userName + userEmail so the admin UI can
    // show real identities instead of raw opaque user IDs. Personas resolve via
    // getUserContextForId; real signups via the credential store.
    const items = members.map((m) => {
      let userName = "";
      let userEmail = "";
      try {
        const ident = getUserContextForId(m.userId).identity;
        userName = ident.name ?? "";
        userEmail = ident.email ?? "";
      } catch { /* non-fatal */ }
      if (!userEmail) {
        try {
          const cred = lookupByUserId(m.userId);
          if (cred) {
            userEmail = cred.email;
            if (!userName) userName = cred.name ?? "";
          }
        } catch { /* non-fatal */ }
      }
      return { ...m, userName, userEmail };
    });
    res.json({ items, count: items.length });
  });

  /**
   * v24.4 — Bootstrap a Collective member directly (Shadie design gap).
   *
   * POST /api/admin/collective/members/bootstrap
   *   Body: { userId?: string; email?: string; tier?: string }
   *
   * Resolves a user by id or email and activates Collective membership WITHOUT
   * an application, solving the first-member / chicken-and-egg problem. Emits
   * the SAME dual-write + bridge/notification side effects as the approval path
   * so downstream consumers stay consistent.
   *
   * Note: collectiveMembershipStore.activate accepts tier "standard" | "plus"
   * (default "standard"). We accept any string body and coerce to a valid tier.
   */
  app.post("/api/admin/collective/members/bootstrap", requireAdmin, (req: AugReq, res: Response) => {
    const adminUserId = req.userContext?.userId ?? "";
    if (!adminUserId) return res.status(401).json({ error: "missing_identity" });

    const body = req.body ?? {};
    const rawUserId = typeof body.userId === "string" ? body.userId.trim() : "";
    const rawEmail = typeof body.email === "string" ? body.email.trim() : "";
    if (!rawUserId && !rawEmail) {
      return res.status(400).json({ ok: false, error: "missing_user", message: "Provide userId or email." });
    }

    // Resolve the target userId. Prefer an explicit userId; otherwise look up by
    // email via the durable credential store.
    let userId = rawUserId;
    if (!userId && rawEmail) {
      const cred = lookupByEmail(rawEmail);
      if (!cred) {
        return res.status(404).json({ ok: false, error: "USER_NOT_FOUND", message: `No user for email ${rawEmail}.` });
      }
      userId = cred.userId;
    }
    if (!userId) {
      return res.status(404).json({ ok: false, error: "USER_NOT_FOUND" });
    }

    // Coerce tier to a valid value ("standard" | "plus"); default "standard".
    const tier: "standard" | "plus" = body.tier === "plus" ? "plus" : "standard";

    const membership = collectiveMembershipStore.activate(userId, adminUserId, tier);
    try { upsertActiveMembership(userId); } catch { /* non-fatal */ }
    try {
      emitBridgeEvent({
        eventType: "collective.member.updated",
        aggregateId: userId,
        aggregateKind: "investor",
        payload: { userId, status: "active", activatedBy: adminUserId, bootstrap: true, tier },
      });
    } catch { /* non-fatal */ }
    try {
      emitNotification({
        userId,
        kind: "collective.membership_approved",
        title: "You're in — welcome to the Collective.",
        body: "An administrator has activated your Capavate Collective membership.",
        link: "/collective",
      });
    } catch { /* non-fatal */ }
    return res.json({ ok: true, membership });
  });

  /**
   * POST /api/admin/collective/members/:userId/suspend
   *
   * v24.4.1 Bug 4 — the collective-membership store had a `deactivate()` method
   * since sprint 23 but no HTTP entry-point ever exposed it. Admins could grant
   * membership but never revoke it via the API. This route closes that gap.
   *
   * Body is optional: `{ reason?: string }` is recorded in audit_log if present.
   * The route is idempotent — suspending an already-suspended member returns 200
   * with the current row (no-op) so callers can safely retry. Emits a
   * collective.member.updated bridge event so downstream consumers stay in sync.
   */
  app.post("/api/admin/collective/members/:userId/suspend", requireAdmin, (req: AugReq, res: Response) => {
    const adminUserId = req.userContext?.userId ?? "";
    if (!adminUserId) return res.status(401).json({ error: "missing_identity" });

    const targetUserId = String(req.params.userId || "").trim();
    if (!targetUserId) {
      return res.status(400).json({ ok: false, error: "missing_user", message: "userId path parameter is required." });
    }

    const membership = collectiveMembershipStore.deactivate(targetUserId, adminUserId);
    if (!membership) {
      return res.status(404).json({ ok: false, error: "MEMBERSHIP_NOT_FOUND", message: `No collective membership for ${targetUserId}.` });
    }

    try {
      emitBridgeEvent({
        eventType: "collective.member.updated",
        aggregateId: targetUserId,
        aggregateKind: "investor",
        payload: { userId: targetUserId, status: "suspended", deactivatedBy: adminUserId },
      });
    } catch { /* non-fatal */ }
    try {
      // Reuse the existing `membership.lapsed` notification kind — it's the
      // closest semantic match in the canonical enum and avoids growing the
      // shared NotificationKind union (which is wired into the email-cadence
      // and SSE filter switches).
      emitNotification({
        userId: targetUserId,
        kind: "membership.lapsed",
        title: "Your Collective membership has been paused.",
        body: "An administrator has suspended your Capavate Collective membership. Reach out to support if you have questions.",
        link: "/collective",
      });
    } catch { /* non-fatal */ }

    return res.json({ ok: true, membership });
  });

  app.post("/api/admin/collective/applications/:id/approve", requireAdmin, (req: AugReq, res: Response) => {
    const id = String(req.params.id);
    const adminUserId = req.userContext?.userId ?? "";
    if (!adminUserId) return res.status(401).json({ error: "missing_identity" });

    // C-009 fix v23.5: try legacy store first, fall through to modern store.
    const legacyApp = legacyGetApplicationById(id);
    if (legacyApp) {
      // Legacy path: investor-side application — userId is legacyApp.userId
      const updated = legacySetApplicationStatus(id, "accepted");
      const membership = collectiveMembershipStore.activate(legacyApp.userId, adminUserId);
      try { upsertActiveMembership(legacyApp.userId); } catch { /* non-fatal */ }
      try {
        emitBridgeEvent({
          eventType: "collective.member.updated",
          aggregateId: legacyApp.userId,
          aggregateKind: "investor",
          payload: { applicationId: id, userId: legacyApp.userId, status: "active", activatedBy: adminUserId },
        });
      } catch { /* non-fatal */ }
      try {
        emitNotification({
          userId: legacyApp.userId,
          kind: "collective.membership_approved",
          title: "You're in — welcome to the Collective.",
          body: "Your Capavate Collective application has been approved.",
          link: "/collective",
        });
      } catch { /* non-fatal */ }
      return res.json({ ok: true, application: updated, membership });
    }

    // Modern path: founder Path B application — userId is founderId
    const modernApp = founderApply.getApplicationById(id);
    if (!modernApp) {
      return res.status(404).json({ ok: false, error: "APPLICATION_NOT_FOUND" });
    }
    // v23.8 W-21: use "accepted" (not "invited") so the status matches the
    // admin filter tab and downstream founder dashboard / member badge.
    const updated = founderApply.setApplicationStatus(id, "accepted", adminUserId);
    const userId = modernApp.founderId;
    const membership = collectiveMembershipStore.activate(userId, adminUserId);
    try { upsertActiveMembership(userId); } catch { /* non-fatal */ }
    // v25.0 Track 2 B3 — Auto-enroll the founder's company into the directory.
    try {
      upsertDirectoryListing(modernApp.companyId, id, {
        stage: undefined, sector: undefined, chapter: undefined,
      });
    } catch { /* non-fatal */ }
    try {
      emitBridgeEvent({
        eventType: "collective.member.updated",
        aggregateId: userId,
        aggregateKind: "investor",
        payload: { applicationId: id, userId, status: "active", activatedBy: adminUserId },
      });
    } catch { /* non-fatal */ }
    try {
      emitNotification({
        userId,
        kind: "collective.membership_approved",
        title: "You're in — welcome to the Collective.",
        body: "Your Capavate Collective company presentation application has been approved.",
        link: "/collective",
      });
    } catch { /* non-fatal */ }
    return res.json({ ok: true, application: updated, membership });
  });

  app.post("/api/admin/collective/applications/:id/reject", requireAdmin, (req: AugReq, res: Response) => {
    const id = String(req.params.id);
    const reason = typeof req.body?.reason === "string" ? req.body.reason : "Application not accepted at this time.";
    const adminUserId = req.userContext?.userId ?? "";
    if (!adminUserId) return res.status(401).json({ error: "missing_identity" });

    // C-009 fix v23.5: try legacy store first, fall through to modern store.
    const legacyApp = legacyGetApplicationById(id);
    if (legacyApp) {
      const updated = legacySetApplicationStatus(id, "rejected");
      try { deactivateMembership(legacyApp.userId); } catch { /* non-fatal */ }
      // v24.0 E2: rejection must deactivate BOTH stores (mirror of approval's
      // dual-write). Approval dual-writes membership; rejection previously only
      // single-wrote the legacy store, leaving the modern store active.
      try { collectiveMembershipStore.deactivate(legacyApp.userId, adminUserId); } catch { /* non-fatal */ }
      try {
        emitBridgeEvent({
          eventType: "collective.member.updated",
          aggregateId: legacyApp.userId,
          aggregateKind: "investor",
          payload: { applicationId: id, userId: legacyApp.userId, status: "rejected", rejectedBy: adminUserId, reason },
        });
      } catch { /* non-fatal */ }
      return res.json({ ok: true, application: updated });
    }

    // Modern path: founder Path B application
    const modernApp = founderApply.getApplicationById(id);
    if (!modernApp) {
      return res.status(404).json({ ok: false, error: "APPLICATION_NOT_FOUND" });
    }
    const updated = founderApply.setApplicationStatus(id, "rejected", adminUserId);
    const userId = modernApp.founderId;
    try { deactivateMembership(userId); } catch { /* non-fatal */ }
    // v24.0 E2: rejection must deactivate BOTH stores (mirror of approval).
    try { collectiveMembershipStore.deactivate(userId, adminUserId); } catch { /* non-fatal */ }
    // v25.0 Track 2 B3 — Remove the founder's company from the directory on rejection.
    try { removeDirectoryListing(modernApp.companyId); } catch { /* non-fatal */ }
    try {
      emitBridgeEvent({
        eventType: "collective.member.updated",
        aggregateId: userId,
        aggregateKind: "investor",
        payload: { applicationId: id, userId, status: "rejected", rejectedBy: adminUserId, reason },
      });
    } catch { /* non-fatal */ }
    return res.json({ ok: true, application: updated });
  });
}
