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
import { appendAdminAudit } from "./adminPlatformStore"; /* v25.19 Lane 4 NC2 — immutable cross-product approval audit */
import { lookupByUserId, lookupByEmail } from "./userCredentialsStore"; // v23.8 W-14 member enrichment; v24.4 bootstrap
import { upsertDirectoryListing, removeDirectoryListing } from "./collectiveInterestStore"; /* v25.0 Track 2 B3 */
import { log } from "./lib/logger"; // v25.35 — fail-closed error logging

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

    // v25.35 — fail-closed: activate() now throws if the membership row does not
    // durably persist. Translate to 500 so the admin UI never shows a phantom
    // "member activated" that vanishes on restart.
    let membership;
    try {
      membership = collectiveMembershipStore.activate(userId, adminUserId, tier);
    } catch (err) {
      log.error("[adminCollectiveRoutes.bootstrap] membership activate failed:", (err as Error).message);
      return res.status(500).json({ ok: false, error: "MEMBERSHIP_PERSIST_FAILED", message: "Could not persist membership; please retry." });
    }
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
    // v25.40 FIX-6 (admin P1 #3): immutable audit row for the bootstrap activation.
    try {
      appendAdminAudit(
        adminUserId,
        `member:${userId}`,
        "collective.member.bootstrapped",
        { userId, tier, bootstrap: true, activatedAt: new Date().toISOString() },
      );
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

    // v25.35 — fail-closed: deactivate() now throws if the DB update fails.
    let membership;
    try {
      membership = collectiveMembershipStore.deactivate(targetUserId, adminUserId);
    } catch (err) {
      log.error("[adminCollectiveRoutes.suspend] membership deactivate failed:", (err as Error).message);
      return res.status(500).json({ ok: false, error: "MEMBERSHIP_PERSIST_FAILED", message: "Could not persist suspension; please retry." });
    }
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

    // v25.40 FIX-6 (admin P1 #3): the docstring above already promises an
    // audit_log row on suspend; the call was missing. Add it now.
    try {
      appendAdminAudit(
        adminUserId,
        `member:${targetUserId}`,
        "collective.member.suspended",
        {
          userId: targetUserId,
          reason: typeof req.body?.reason === "string" ? req.body.reason : undefined,
          suspendedAt: new Date().toISOString(),
        },
      );
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
      /* v25.21 Lane A NH-002 fix — if the status DB write failed,
       * `legacySetApplicationStatus` now returns null. Short-circuit BEFORE
       * activating the membership so we never produce a permanent
       * member-active / application-still-submitted half-state. */
      if (!updated) {
        return res.status(500).json({
          ok: false,
          error: "APPLICATION_STATUS_PERSIST_FAILED",
          message:
            "Could not persist application status; membership not activated. Please retry.",
        });
      }
      // v25.35 — fail-closed: if membership activation does not persist, return
      // 500 instead of a success that reverts on restart. The application
      // status was already committed above, so a retry is safe (idempotent).
      let membership;
      try {
        membership = collectiveMembershipStore.activate(legacyApp.userId, adminUserId);
      } catch (err) {
        log.error("[adminCollectiveRoutes.approve.legacy] membership activate failed:", (err as Error).message);
        return res.status(500).json({ ok: false, error: "MEMBERSHIP_PERSIST_FAILED", message: "Application accepted but membership did not persist; please retry." });
      }
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
      /* v25.19 Lane 4 NC2 (hard close) — write an immutable audit row so we can
         prove "investor X was approved into Collective on date Y by admin Z"
         from the audit chain. Lane 4 audit found ZERO appendAdminAudit calls
         in cross-product approval routes; compliance/forensics blind spot. */
      try {
        appendAdminAudit(
          adminUserId,
          `application:${id}`,
          "collective.application.approved",
          { applicationId: id, userId: legacyApp.userId, path: "legacy", approvedAt: new Date().toISOString() },
        );
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
    /* v25.21 Lane A NH-002 fix (REWORK after triple-verify): the modern
     * founder Path B path was the verifier's second blocking find — the
     * legacy fallback path was guarded but the modern path still proceeded
     * to activate membership when the status persist failed. Now both paths
     * short-circuit identically on DB failure (the helper returns null). */
    if (!updated) {
      return res.status(500).json({
        ok: false,
        error: "APPLICATION_STATUS_PERSIST_FAILED",
        message:
          "Could not persist application status; membership not activated. Please retry.",
      });
    }
    const userId = modernApp.founderId;
    // v25.35 — fail-closed: membership must durably persist or the route 500s.
    let membership;
    try {
      membership = collectiveMembershipStore.activate(userId, adminUserId);
    } catch (err) {
      log.error("[adminCollectiveRoutes.approve.modern] membership activate failed:", (err as Error).message);
      return res.status(500).json({ ok: false, error: "MEMBERSHIP_PERSIST_FAILED", message: "Application accepted but membership did not persist; please retry." });
    }
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
    /* v25.19 Lane 4 NC2 (hard close) — see explanation above. */
    try {
      appendAdminAudit(
        adminUserId,
        `application:${id}`,
        "collective.application.approved",
        { applicationId: id, userId, companyId: modernApp.companyId, path: "modern", approvedAt: new Date().toISOString() },
      );
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
      /* v25.21 Lane A NH-002 fix — if the status DB write failed, the helper
       * now returns null. Short-circuit BEFORE deactivating the membership
       * (and before sending the rejection notification) so we never tell a
       * user they were rejected while the DB still says `submitted`. */
      if (!updated) {
        return res.status(500).json({
          ok: false,
          error: "APPLICATION_STATUS_PERSIST_FAILED",
          message:
            "Could not persist application status; membership unchanged. Please retry.",
        });
      }
      try { deactivateMembership(legacyApp.userId); } catch { /* non-fatal */ }
      // v24.0 E2: rejection must deactivate BOTH stores (mirror of approval's
      // dual-write). Approval dual-writes membership; rejection previously only
      // single-wrote the legacy store, leaving the modern store active.
      // v25.35 fix-2 (Concern 4) — fail-closed: deactivate() now throws when the
      // membership row does not durably persist (mirror of approve/bootstrap/
      // suspend). Previously this throw was swallowed as non-fatal, so a reject
      // could report success while the durable membership stayed active. Let it
      // propagate as 500 so admins never see a phantom rejection.
      try {
        collectiveMembershipStore.deactivate(legacyApp.userId, adminUserId);
      } catch (err) {
        log.error("[adminCollectiveRoutes.reject] membership deactivate failed (legacy path):", (err as Error).message);
        return res.status(500).json({ ok: false, error: "MEMBERSHIP_PERSIST_FAILED", message: "Could not persist membership deactivation; please retry." });
      }
      try {
        emitBridgeEvent({
          eventType: "collective.member.updated",
          aggregateId: legacyApp.userId,
          aggregateKind: "investor",
          payload: { applicationId: id, userId: legacyApp.userId, status: "rejected", rejectedBy: adminUserId, reason },
        });
      } catch { /* non-fatal */ }
      // v25.13 NM4 — mirror the approve path's emitNotification call so a
      // rejected applicant actually receives an in-app notification instead
      // of waiting indefinitely with no signal.
      try {
        emitNotification({
          userId: legacyApp.userId,
          kind: "collective.membership_rejected",
          title: "Your Collective application was not accepted",
          body: reason.slice(0, 200),
          link: "/collective/apply",
        });
      } catch { /* non-fatal */ }
      /* v25.22 NH-10 fix — the reject path was missing an audit row
       * while the approve path had one (v25.19 Lane 4 NC2). Compliance /
       * forensics now has a complete cross-product approval+rejection
       * audit chain instead of only one side. */
      try {
        appendAdminAudit(
          adminUserId,
          `application:${id}`,
          "collective.application.rejected",
          {
            applicationId: id,
            userId: legacyApp.userId,
            path: "legacy",
            reason: reason.slice(0, 200),
            rejectedAt: new Date().toISOString(),
          },
        );
      } catch { /* non-fatal */ }
      return res.json({ ok: true, application: updated });
    }

    // Modern path: founder Path B application
    const modernApp = founderApply.getApplicationById(id);
    if (!modernApp) {
      return res.status(404).json({ ok: false, error: "APPLICATION_NOT_FOUND" });
    }
    const updated = founderApply.setApplicationStatus(id, "rejected", adminUserId);
    /* v25.21 Lane A NH-002 fix (REWORK after triple-verify) — mirror the
     * approve-path short-circuit on the reject side. Without this, a DB
     * failure on the status write still deactivates membership and emits a
     * rejection notification while the DB row stays `submitted`. */
    if (!updated) {
      return res.status(500).json({
        ok: false,
        error: "APPLICATION_STATUS_PERSIST_FAILED",
        message:
          "Could not persist application status; membership unchanged. Please retry.",
      });
    }
    const userId = modernApp.founderId;
    try { deactivateMembership(userId); } catch { /* non-fatal */ }
    // v24.0 E2: rejection must deactivate BOTH stores (mirror of approval).
    // v25.35 fix-2 (Concern 4) — fail-closed: let deactivate() throw propagate
    // as 500 (mirror of approve/bootstrap/suspend) so a reject never reports
    // success while durable membership stays active.
    try {
      collectiveMembershipStore.deactivate(userId, adminUserId);
    } catch (err) {
      log.error("[adminCollectiveRoutes.reject] membership deactivate failed (modern path):", (err as Error).message);
      return res.status(500).json({ ok: false, error: "MEMBERSHIP_PERSIST_FAILED", message: "Could not persist membership deactivation; please retry." });
    }
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
    // v25.13 NM4 — notify the founder of the rejection (modern path mirror).
    try {
      emitNotification({
        userId,
        kind: "collective.membership_rejected",
        title: "Your Collective application was not accepted",
        body: reason.slice(0, 200),
        link: "/collective/apply",
      });
    } catch { /* non-fatal */ }
    /* v25.22 NH-10 fix — modern path now also appends an audit row on
     * reject (mirrors the legacy path fix above + the existing approve
     * path's audit). Cross-product audit chain is now symmetric. */
    try {
      appendAdminAudit(
        adminUserId,
        `application:${id}`,
        "collective.application.rejected",
        {
          applicationId: id,
          userId,
          companyId: modernApp.companyId,
          path: "modern",
          reason: reason.slice(0, 200),
          rejectedAt: new Date().toISOString(),
        },
      );
    } catch { /* non-fatal */ }
    return res.json({ ok: true, application: updated });
  });
}
