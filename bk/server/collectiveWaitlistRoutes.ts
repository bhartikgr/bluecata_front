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
      const entry = createWaitlistEntry({
        kind: "investor_membership",
        userId,
        companyId: null,
        chapterHint: typeof body.chapterHint === "string" ? body.chapterHint : null,
        payload: { application: body.fullApplicationPayload ?? {} },
      });
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
      const entry = createWaitlistEntry({
        kind: waitKind,
        userId,
        companyId: body.companyId,
        chapterHint: typeof body.chapterHint === "string" ? body.chapterHint : null,
        payload: { application: body.payload ?? {} },
      });
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
      const entry = createWaitlistEntry({
        kind: "cap_table_promote",
        userId,
        companyId: body.companyId,
        chapterHint: typeof body.chapterHint === "string" ? body.chapterHint : null,
        payload: { rationale: typeof body.rationale === "string" ? body.rationale : "" },
      });
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
      const updated = reviewWaitlistEntry(id, body.status, adminUserId);
      res.json({ ok: true, entry: updated, note: body.note ?? null });
    },
  );
}
