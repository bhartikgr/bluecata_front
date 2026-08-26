/* ═══════════════════════════════════════════════════════════════════════════
   WAVE 155 — ADMIN SURFACE FOR THE COMPED MEMBERSHIP GRANT.
                                          R123.1, R124.4.3, R114.3, R111 Q13, R77
   ═══════════════════════════════════════════════════════════════════════════
   THIS UNBLOCKS A PLATFORM LOCKOUT. R123.1: with the eligibility gate at
   `enforced`, `capavate_subscriptions` holds zero rows and the live payment path
   is unconfigured, so the gate would refuse every SPV create, fund create and
   create-on-behalf for every partner — and R124.4.3 records that the table has no
   admin write path at all, so nobody could clear it. These endpoints are the way
   the owner puts a company or a partner in good standing without a card.

   Endpoints (all `requireAdmin`):
     GET  /api/admin/comped-memberships              — the FULL ledger
     POST /api/admin/comped-memberships              — grant (reason REQUIRED)
     POST /api/admin/comped-memberships/:id/revoke   — end it, never delete
     GET  /api/admin/comped-memberships/standing     — what the GATE READER sees
                                                       for one company/partner

   THE `standing` ENDPOINT IS DELIBERATELY THE GATE'S OWN READER, not a second
   opinion. It calls `resolveCompanyMembership` /
   `resolvePartnerAccountMembership` from `server/lib/spvEligibilityGate.ts` —
   the same functions `evaluateLaunchGate` calls — so what this screen reports and
   what the gate does can never drift. A duplicate reader here would be the exact
   two-sources-of-truth defect this batch exists to remove.

   A COMP IS NEVER PRESENTED AS REVENUE. There is no amount, currency or invoice
   in the request or the response: `standingLabel` renders
   "Comped by Capavate (no payment taken)", never "Paid", and the ledger is a
   separate table that no revenue or MRR query reads.

   THE ACTOR IS BOUND TO THE SESSION and there is NO PLACEHOLDER FALLBACK — the
   `intent_required` / `actor_required` pattern at
   `server/adminPlatformStore.ts:2205`. A comp recorded against
   "u_unknown_admin" is a comp nobody granted.
   ═══════════════════════════════════════════════════════════════════════════ */
import type { Express, Request, Response } from "express";
import { requireAdmin } from "./lib/authMiddleware";
import { appendAdminAudit } from "./adminPlatformStore";
import { sanitizeErrorMessage } from "./lib/sanitize";
import { log } from "./lib/logger";
import {
  grantCompedMembership,
  revokeCompedMembership,
  listAllGrants,
  isGrantLive,
  CompedMembershipWriteError,
  type CompedMembershipGrant,
  type CompedSubjectKind,
} from "./lib/compedMembershipStore";
import {
  resolveCompanyMembership,
  resolvePartnerAccountMembership,
  renderMembershipStanding,
  companyLabel,
  partnerLabel,
} from "./lib/spvEligibilityGate";

/** R84 condition 2 / adminPlatformStore.ts:2205 — WHO. No placeholder fallback:
 *  an empty string here becomes an `actor_required` refusal below, never a
 *  synthetic actor written into a permanent record. */
function actorOf(req: Request): string {
  const ctx = (req as Request & {
    userContext?: { identity?: { email?: string }; userId?: string };
  }).userContext;
  return String(ctx?.identity?.email ?? ctx?.userId ?? "").trim();
}

function subjectLabel(kind: CompedSubjectKind, id: string): string {
  return kind === "company" ? companyLabel(id) : partnerLabel(id);
}

/** The wire shape. `isRevenue` is stated on every row so that no consumer has to
 *  infer it, and `amount`/`currency` are absent because a comp has neither. */
function toWire(g: CompedMembershipGrant) {
  return {
    ...g,
    subjectLabel: subjectLabel(g.subjectKind, g.subjectId),
    live: isGrantLive(g),
    isRevenue: false,
    standingLabel: isGrantLive(g)
      ? "Comped by Capavate (no payment taken)"
      : "Ended — kept on the record",
  };
}

export function registerAdminCompedMembershipRoutes(app: Express): void {
  /* ── the ledger, revoked rows included: this is the audit view ──────────── */
  app.get("/api/admin/comped-memberships", requireAdmin, (_req: Request, res: Response) => {
    try {
      const all = listAllGrants();
      res.json({
        ok: true,
        grants: all.map(toWire),
        total: all.length,
        liveTotal: all.filter((g) => isGrantLive(g)).length,
        note:
          "A comped membership is given by Capavate without payment. It puts the company or partner in good standing for the SPV launch check, and it is never counted as revenue.",
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: "COMPED_LIST_FAILED",
        message: `The comped membership list could not be read: ${sanitizeErrorMessage(err)}`,
      });
    }
  });

  /* ── grant ──────────────────────────────────────────────────────────────── */
  app.post("/api/admin/comped-memberships", requireAdmin, (req: Request, res: Response) => {
    const actor = actorOf(req);
    if (!actor) {
      return res.status(403).json({
        ok: false,
        error: "actor_required",
        message:
          "This grant is recorded against the person who makes it, and the platform could not identify you. Nothing was changed.",
      });
    }
    const reason = String(req.body?.reason ?? "").trim();
    if (!reason) {
      return res.status(400).json({
        ok: false,
        error: "intent_required",
        message:
          "State why this membership is being given without payment. The reason is recorded permanently and cannot be edited afterwards.",
      });
    }
    try {
      const created = grantCompedMembership({
        subjectKind: (req.body?.subjectKind ?? "") as CompedSubjectKind,
        subjectId: String(req.body?.subjectId ?? ""),
        reason,
        grantedBy: actor, // BOUND to the session, never the body
        expiresAt: req.body?.expiresAt ? String(req.body.expiresAt) : null,
      });
      try {
        appendAdminAudit(
          actor,
          `comped_membership:${created.subjectKind}:${created.subjectId}`,
          "comped_membership_granted",
          {
            grantId: created.id,
            subjectKind: created.subjectKind,
            subjectId: created.subjectId,
            reason: created.reason,
            expiresAt: created.expiresAt,
            /* Recorded in the audit payload itself so an auditor reading only
               the log knows no money changed hands. */
            isRevenue: false,
          },
        );
      } catch (auditErr) {
        log.warn("[adminCompedMembershipRoutes] grant audit append failed (non-fatal):", auditErr);
      }
      return res.status(201).json({ ok: true, grant: toWire(created) });
    } catch (err) {
      if (err instanceof CompedMembershipWriteError) {
        const status =
          err.code === "COMPED_ACTOR_REQUIRED"
            ? 403
            : err.code === "COMPED_ALREADY_GRANTED"
              ? 409
              : 400;
        return res.status(status).json({ ok: false, error: err.code, message: err.message });
      }
      return res.status(500).json({
        ok: false,
        error: "COMPED_WRITE_FAILED",
        message: `The comped membership was not saved: ${sanitizeErrorMessage(err)}`,
      });
    }
  });

  /* ── revoke: NEVER a delete ─────────────────────────────────────────────── */
  app.post(
    "/api/admin/comped-memberships/:id/revoke",
    requireAdmin,
    (req: Request, res: Response) => {
      const actor = actorOf(req);
      if (!actor) {
        return res.status(403).json({
          ok: false,
          error: "actor_required",
          message:
            "This action is recorded against the person who takes it, and the platform could not identify you. Nothing was changed.",
        });
      }
      const reason = String(req.body?.reason ?? "").trim();
      if (!reason) {
        return res.status(400).json({
          ok: false,
          error: "intent_required",
          message:
            "State why this comped membership is ending. The reason is recorded permanently, and the grant itself is kept on the record.",
        });
      }
      try {
        const revoked = revokeCompedMembership({
          id: String(req.params.id),
          revokedBy: actor,
          reason,
        });
        try {
          appendAdminAudit(
            actor,
            `comped_membership:${revoked.subjectKind}:${revoked.subjectId}`,
            "comped_membership_revoked",
            {
              grantId: revoked.id,
              subjectKind: revoked.subjectKind,
              subjectId: revoked.subjectId,
              revokedAt: revoked.revokedAt,
              revokeReason: revoked.revokeReason,
              recordRetained: true,
            },
          );
        } catch (auditErr) {
          log.warn(
            "[adminCompedMembershipRoutes] revoke audit append failed (non-fatal):",
            auditErr,
          );
        }
        return res.json({
          ok: true,
          grant: toWire(revoked),
          message:
            "The comped membership has ended. The record is kept for history — it is not deleted — and it no longer puts this company or partner in good standing.",
        });
      } catch (err) {
        if (err instanceof CompedMembershipWriteError) {
          const status =
            err.code === "COMPED_NOT_FOUND" ? 404 : err.code === "COMPED_ACTOR_REQUIRED" ? 403 : 400;
          return res.status(status).json({ ok: false, error: err.code, message: err.message });
        }
        return res.status(500).json({
          ok: false,
          error: "COMPED_REVOKE_FAILED",
          message: `The comped membership was not ended: ${sanitizeErrorMessage(err)}`,
        });
      }
    },
  );

  /* ── what the GATE READER sees, for one company or partner ───────────────── */
  app.get(
    "/api/admin/comped-memberships/standing",
    requireAdmin,
    (req: Request, res: Response) => {
      const kind = String(req.query.subjectKind ?? "company") === "partner" ? "partner" : "company";
      const subjectId = String(req.query.subjectId ?? "").trim();
      if (!subjectId) {
        return res.status(400).json({
          ok: false,
          error: "SUBJECT_ID_REQUIRED",
          message: "Name the company or partner account you want to check.",
        });
      }
      try {
        const m =
          kind === "partner"
            ? resolvePartnerAccountMembership(subjectId)
            : resolveCompanyMembership(subjectId);
        return res.json({
          ok: true,
          subjectKind: kind,
          subjectId,
          subjectLabel: subjectLabel(kind, subjectId),
          state: m.state,
          basis: m.basis ?? null,
          /* The ONLY label a screen should show. A comp reads as a comp here. */
          standingLabel: renderMembershipStanding(m),
          inGoodStanding: m.state === "paid",
          isRevenue: false,
          compedGrantId: m.compedGrantId ?? null,
          reason: m.reason,
          checkedAt: m.checkedAt,
        });
      } catch (err) {
        return res.status(500).json({
          ok: false,
          error: "COMPED_STANDING_FAILED",
          message: `The membership standing could not be read: ${sanitizeErrorMessage(err)}`,
        });
      }
    },
  );
}
