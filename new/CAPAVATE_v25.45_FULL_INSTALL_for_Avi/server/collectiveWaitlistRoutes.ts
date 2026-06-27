/**
 * server/collectiveWaitlistRoutes.ts — v16 Fix 6.
 *
 * HTTP surface for the Collective waitlist (the honest "ship safely" layer).
 *
 * User-facing (requireAuth):
 *   POST /api/collective/waitlist/investor-membership
 *   POST /api/collective/waitlist/founder-application
 *   POST /api/collective/waitlist/cap-table-promote
 *
 * Admin (requireAdmin):
 *   GET   /api/admin/collective/waitlist?kind=...&status=...
 *   PATCH /api/admin/collective/waitlist/:id   body { status, note? }
 *
 * Available regardless of COLLECTIVE_ENABLED — these endpoints are designed
 * to accept signups EVEN when the rest of the Collective subsystem is gated
 * off. They are the front door during invite-only beta.
 */
import type { Express, Request, Response } from "express";
import { requireAuth, requireAdmin } from "./lib/authMiddleware";
import {
  createWaitlistEntry,
  reviewWaitlistEntry,
  listWaitlist,
  listWaitlistForUser,
  getWaitlistEntry,
  type WaitlistKind,
  type WaitlistStatus,
} from "./collectiveWaitlistStore";
import { isOnCapTable } from "./membershipStore";
// v25.21 Lane C NH-5 fix — admin Accept on a waitlist row must do more than
// flip a status. It needs to activate the collective membership, emit a
// bridge event for any open dashboard, and notify the applicant. Lane C
// found the promotion path simply did not exist — accepting a waitlisted
// applicant was a dead end.
import * as collectiveMembershipStore from "./collectiveMembershipStore";
import { emitBridgeEvent } from "./bridgeStore";
import { emitNotification } from "./notificationsStore";
import type { NotificationKind } from "./notificationsStore";
import { appendAdminAudit } from "./adminPlatformStore";
import { log } from "./lib/logger";
import { getCompaniesForFounder } from "./multiCompanyStore";

const THANK_YOU = "Thank you — we'll be in touch as we open chapter access.";

export function registerCollectiveWaitlistRoutes(app: Express): void {
  /* ---------- Investor membership waitlist ---------- */
  app.post(
    "/api/collective/waitlist/investor-membership",
    requireAuth,
    (req: Request, res: Response) => {
      const userId = req.userContext?.userId;
      if (!userId) return res.status(401).json({ error: "missing_identity" });
      const body = (req.body ?? {}) as { chapterHint?: string; fullApplicationPayload?: unknown };
      // v25.13 NL3 — reject if the user already has a non-declined entry of
      // this kind. Without this, the endpoint accepted unlimited resubmits,
      // flooding the admin review queue with duplicates.
      const existing = listWaitlistForUser(userId).find(
        (e) => e.kind === "investor_membership" && e.status !== "declined",
      );
      if (existing) {
        return res.status(409).json({
          ok: false,
          error: "already_on_waitlist",
          waitlistId: existing.id,
          status: existing.status,
        });
      }
      // v25.35 Phase 4 #21 — createWaitlistEntry now fails-closed; translate a
      // persistence failure into a 500 instead of a memory-only 201.
      let entry;
      try {
        entry = createWaitlistEntry({
          kind: "investor_membership",
          userId,
          companyId: null,
          chapterHint: typeof body.chapterHint === "string" ? body.chapterHint : null,
          payload: { application: body.fullApplicationPayload ?? {} },
        });
      } catch (err) {
        log.error("[waitlist.investor-membership] persist failed:", (err as Error).message);
        return res.status(500).json({ ok: false, error: "WAITLIST_PERSIST_FAILED", message: "Could not save your application. Please retry." });
      }
      res.status(201).json({ ok: true, waitlistId: entry.id, message: THANK_YOU });
    },
  );

  /* ---------- Founder Path A / Path B waitlist ---------- */
  app.post(
    "/api/collective/waitlist/founder-application",
    requireAuth,
    (req: Request, res: Response) => {
      const userId = req.userContext?.userId;
      if (!userId) return res.status(401).json({ error: "missing_identity" });
      const body = (req.body ?? {}) as {
        companyId?: string;
        kind?: "path_a" | "path_b";
        payload?: unknown;
        chapterHint?: string;
      };
      if (!body.companyId) return res.status(400).json({ error: "companyId_required" });
      if (body.kind !== "path_a" && body.kind !== "path_b") {
        return res.status(400).json({ error: "kind_required", message: "kind must be 'path_a' or 'path_b'" });
      }
      // v16 ownership: must be a founder of this company.
      const ownsCompany = getCompaniesForFounder(userId).some((c) => c.companyId === body.companyId);
      if (!ownsCompany) {
        return res.status(403).json({ error: "company_not_owned" });
      }
      const waitKind: WaitlistKind = body.kind === "path_a" ? "founder_path_a" : "founder_path_b";
      // v25.13 NL3 — reject duplicate non-declined waitlist entries for the
      // same (user, kind, companyId) tuple.
      const existingF = listWaitlistForUser(userId).find(
        (e) =>
          e.kind === waitKind &&
          e.companyId === body.companyId &&
          e.status !== "declined",
      );
      if (existingF) {
        return res.status(409).json({
          ok: false,
          error: "already_on_waitlist",
          waitlistId: existingF.id,
          status: existingF.status,
        });
      }
      // v25.35 Phase 4 #21 — fail-closed on persistence failure.
      let entry;
      try {
        entry = createWaitlistEntry({
          kind: waitKind,
          userId,
          companyId: body.companyId,
          chapterHint: typeof body.chapterHint === "string" ? body.chapterHint : null,
          payload: { application: body.payload ?? {} },
        });
      } catch (err) {
        log.error("[waitlist.founder-application] persist failed:", (err as Error).message);
        return res.status(500).json({ ok: false, error: "WAITLIST_PERSIST_FAILED", message: "Could not save your application. Please retry." });
      }
      res.status(201).json({ ok: true, waitlistId: entry.id, message: THANK_YOU });
    },
  );

  /* ---------- Cap-table investor promote waitlist ---------- */
  app.post(
    "/api/collective/waitlist/cap-table-promote",
    requireAuth,
    (req: Request, res: Response) => {
      const userId = req.userContext?.userId;
      if (!userId) return res.status(401).json({ error: "missing_identity" });
      const body = (req.body ?? {}) as { companyId?: string; rationale?: string; chapterHint?: string };
      if (!body.companyId) return res.status(400).json({ error: "companyId_required" });
      // v16 ownership: must be on the cap table.
      if (!isOnCapTable(userId, body.companyId)) {
        return res.status(403).json({ error: "not_on_cap_table" });
      }
      // v25.13 NL3 — reject duplicate cap-table-promote entries for the
      // same (user, companyId) tuple.
      const existingP = listWaitlistForUser(userId).find(
        (e) =>
          e.kind === "cap_table_promote" &&
          e.companyId === body.companyId &&
          e.status !== "declined",
      );
      if (existingP) {
        return res.status(409).json({
          ok: false,
          error: "already_on_waitlist",
          waitlistId: existingP.id,
          status: existingP.status,
        });
      }
      // v25.35 Phase 4 #21 — fail-closed on persistence failure.
      let entry;
      try {
        entry = createWaitlistEntry({
          kind: "cap_table_promote",
          userId,
          companyId: body.companyId,
          chapterHint: typeof body.chapterHint === "string" ? body.chapterHint : null,
          payload: { rationale: typeof body.rationale === "string" ? body.rationale : "" },
        });
      } catch (err) {
        log.error("[waitlist.cap-table-promote] persist failed:", (err as Error).message);
        return res.status(500).json({ ok: false, error: "WAITLIST_PERSIST_FAILED", message: "Could not save your request. Please retry." });
      }
      res.status(201).json({ ok: true, waitlistId: entry.id, message: THANK_YOU });
    },
  );

  /* ---------- v23.8 C4/W-15 — the requester's own waitlist status ---------- */
  app.get(
    "/api/collective/waitlist/mine",
    requireAuth,
    (req: Request, res: Response) => {
      const userId = req.userContext?.userId;
      if (!userId) return res.status(401).json({ error: "missing_identity" });
      const items = listWaitlistForUser(userId);
      res.json({ items, count: items.length });
    },
  );

  /* ---------- Admin: list ---------- */
  app.get(
    "/api/admin/collective/waitlist",
    requireAdmin,
    (req: Request, res: Response) => {
      // CROSS-TENANT (admin) — entire-platform view.
      const kind = typeof req.query.kind === "string" ? (req.query.kind as WaitlistKind) : undefined;
      const status = typeof req.query.status === "string" ? (req.query.status as WaitlistStatus) : undefined;
      const items = listWaitlist({ kind, status });
      res.json({ items, count: items.length });
    },
  );

  /* ---------- Admin: review (accept/decline) ---------- */
  app.patch(
    "/api/admin/collective/waitlist/:id",
    requireAdmin,
    (req: Request, res: Response) => {
      const adminUserId = req.userContext?.userId ?? "";
      if (!adminUserId) return res.status(401).json({ error: "missing_identity" });
      const idRaw = req.params.id;
      const id = Array.isArray(idRaw) ? idRaw[0] : String(idRaw ?? "");
      const body = (req.body ?? {}) as { status?: WaitlistStatus; note?: string };
      if (body.status !== "accepted" && body.status !== "declined" && body.status !== "waitlist") {
        return res.status(400).json({ error: "invalid_status", message: "status must be accepted|declined|waitlist" });
      }
      const existing = getWaitlistEntry(id);
      if (!existing) return res.status(404).json({ error: "not_found" });
      // v25.13 NM3 — was previously echoed in the response and silently
      // discarded by reviewWaitlistEntry. Now persisted via payload.reviewNote.
      // v25.35 fix-2 (Concern 5) — reviewWaitlistEntry is now persist-first and
      // THROWS on a DB write failure (it no longer swallows it and returns a
      // memory-mutated row). Translate that throw into a 500 so a review never
      // reports success while the durable row is unchanged.
      let updated;
      try {
        updated = reviewWaitlistEntry(id, body.status, adminUserId, body.note ?? null);
      } catch (reviewErr) {
        log.error(
          "[waitlist review] reviewWaitlistEntry DB write failed:",
          (reviewErr as Error).message,
        );
        return res.status(500).json({ ok: false, error: "WAITLIST_PERSIST_FAILED", message: "Could not persist the waitlist review; please retry." });
      }

      /* v25.21 Lane C NH-5 fix — if status flipped to `accepted`, complete
       * the promotion path that didn't exist before:
       *   1. Activate the collective membership row (gate `requireCollectiveMember`
       *      now passes for this user) — ONLY for investor-membership kind.
       *   2. Emit `collective.member.updated` bridge event so open admin /
       *      member dashboards refresh.
       *   3. Send an in-app notification so the applicant knows they're in.
       *   4. Append an admin audit row for compliance.
       * Best-effort — the status update above is the source of truth; these
       * side effects log on failure but do not throw. Idempotency on the
       * membership store: `activate` is a SET, safe to re-run.
       *
       * v25.22 NH-4 fix — only activate INVESTOR membership for the
       * `investor_membership` waitlist kind. Founder waitlist kinds
       * (`founder_path_a` / `founder_path_b`) are about company-presentation
       * applications, not investor membership; activating an investor
       * membership for a founder would grant them DSC/dealroom access they
       * never applied for. For founder kinds we still emit the bridge +
       * notification + audit so the founder is told they're off the waitlist,
       * but we do NOT activate investor membership.
       */
      const isInvestorMembership = existing.kind === "investor_membership";
      if (body.status === "accepted" && existing.userId && isInvestorMembership) {
        // v25.35 fix-2 (Concern 5) — fail-closed: activate() now throws when the
        // membership row does not durably persist (mirror of the admin approve
        // path). Previously this throw was swallowed as non-fatal, so a waitlist
        // acceptance could report success while no durable membership existed.
        // Let it return 500 so the acceptance contract is honoured.
        try {
          collectiveMembershipStore.activate(existing.userId, adminUserId);
        } catch (activateErr) {
          log.error(
            "[waitlist accept] collectiveMembershipStore.activate failed:",
            (activateErr as Error).message,
          );
          return res.status(500).json({ ok: false, error: "MEMBERSHIP_PERSIST_FAILED", message: "Could not activate membership for the accepted entry; please retry." });
        }
      }
      if (body.status === "accepted" && existing.userId) {
        try {
          emitBridgeEvent({
            eventType: "collective.member.updated",
            aggregateId: existing.userId,
            aggregateKind: "investor",
            payload: {
              waitlistId: existing.id,
              userId: existing.userId,
              status: "active",
              activatedBy: adminUserId,
              source: "waitlist_accept",
            },
          });
        } catch (bridgeErr) {
          log.warn(
            "[waitlist accept] bridge event emit failed (non-fatal):",
            (bridgeErr as Error).message,
          );
        }
        try {
          emitNotification({
            userId: existing.userId,
            kind: "collective.membership_approved" as NotificationKind,
            title: "You're off the waitlist — welcome to the Collective.",
            body: "Your spot has been confirmed. Open the Collective workspace to get started.",
            link: "/collective",
          });
        } catch (notifyErr) {
          log.warn(
            "[waitlist accept] notification emit failed (non-fatal):",
            (notifyErr as Error).message,
          );
        }
        try {
          appendAdminAudit(
            adminUserId,
            `waitlist:${existing.id}`,
            "collective.waitlist.accepted",
            {
              waitlistId: existing.id,
              userId: existing.userId,
              kind: existing.kind,
              acceptedAt: new Date().toISOString(),
            },
          );
        } catch { /* non-fatal */ }
      }

      res.json({ ok: true, entry: updated, note: updated?.reviewNote ?? body.note ?? null });
    },
  );
}
