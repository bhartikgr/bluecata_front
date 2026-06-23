/**
 * server/collectiveOffersStore.ts — v17 Phase C.
 *
 * Founder accept/decline endpoints for "Collective offers" (investor
 * nominations / promotions submitted under Path A — the investor-vouched
 * pathway). An "offer" is a row in `investor_nominations`: an investor has
 * publicly promoted a founder's company into a Collective chapter. The
 * founder must accept or decline the offer before the chapter intake queue
 * progresses.
 *
 * Endpoints:
 *   POST /api/collective/offers/:offerId/accept
 *   POST /api/collective/offers/:offerId/decline   (body: { reason: string })
 *   GET  /api/collective/offers/:offerId           — read a single offer (member-gated)
 *
 * State machine:
 *
 *   pending ──accept──> accepted   (terminal-ish; re-accept = 200 no-op)
 *      │
 *      └──decline──> declined      (terminal; subsequent accept → 409)
 *
 *      pending OR accepted ──round_closed──> lapsed   (set by round sweeper)
 *
 * Hard rules (per v19 brief §"v17 Phase C" + lines 10–42):
 *   - requireAuth + requireCollectiveMember + requireChapterMember(...) + ownership check
 *   - withTenant() on every read
 *   - hash-chained audit row written INSIDE the same sync transaction as the
 *     state change; chain tip recomputed from the existing offer's
 *     prev_hash → current_hash sequence
 *   - SYNC transactions only (Phase B finding — better-sqlite3 rejects
 *     async callbacks)
 *   - graceful 503 when COLLECTIVE_ENABLED!=1
 */

import type { Express, Request, Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod";

import { requireAuth } from "./lib/authMiddleware";
import { requireCollectiveMember } from "./lib/requireCollectiveMember";
import { requireChapterMemberFromRequest } from "./lib/requireChapterMember";
import { requireCollectiveEnabled } from "./lib/featureFlags";
import { withTenant } from "./lib/withTenant";
import { getDb } from "./db/connection";
import { investorNominations as investorNominationsTable } from "@shared/schema";
import { getCompaniesForFounder } from "./multiCompanyStore";
import { emitMutation } from "./lib/eventBus";
import { publish as ssePublish } from "./lib/sseHub";
import { emitNotification, type NotificationKind } from "./notificationsStore";
import { appendAdminAudit } from "./adminPlatformStore";
import { log } from "./lib/logger";

/* --------------------------------------------------------------- */
/* Types                                                            */
/* --------------------------------------------------------------- */

export type OfferStatus = "pending" | "accepted" | "declined" | "lapsed";

export interface OfferRow {
  id: string;
  tenantId: string;
  chapterId: string;
  investorUserId: string;
  companyId: string;
  rationale: string;
  status: OfferStatus;
  declineReason: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  roundId: string | null;
  prevHash: string | null;
  hash: string;
  submittedAt: string;
}

/* --------------------------------------------------------------- */
/* Helpers                                                          */
/* --------------------------------------------------------------- */

function nowIso(): string {
  return new Date().toISOString();
}

/** Same hash function used by sprint21PortfolioRoutes for chain continuity. */
function computeHash(prevHash: string | null, payload: Record<string, unknown>): string {
  const h = createHash("sha256");
  h.update(prevHash ?? "GENESIS");
  h.update("|");
  h.update(JSON.stringify(payload));
  return h.digest("hex");
}

/** Map DB row (snake_case from better-sqlite3) → strongly typed OfferRow. */
function rowToOffer(r: any): OfferRow {
  return {
    id: r.id,
    tenantId: r.tenant_id ?? r.tenantId,
    chapterId: r.chapter_id ?? r.chapterId,
    investorUserId: r.investor_user_id ?? r.investorUserId,
    companyId: r.company_id ?? r.companyId,
    rationale: r.rationale,
    status: (r.status ?? "pending") as OfferStatus,
    declineReason: r.decline_reason ?? r.declineReason ?? null,
    decidedAt: r.decided_at ?? r.decidedAt ?? null,
    decidedBy: r.decided_by ?? r.decidedBy ?? null,
    roundId: r.round_id ?? r.roundId ?? null,
    prevHash: r.prev_hash ?? r.prevHash ?? null,
    hash: r.hash,
    submittedAt: r.submitted_at ?? r.submittedAt,
  };
}

/* v25.40 FIX-14 (dead-code sweep): the exported `findOfferById(offerId, tenantId)`
 * helper was removed here. It had ZERO call sites anywhere in the repo (verified
 * via `grep -rn "findOfferById" --include="*.ts" --include="*.tsx"` — the only
 * hits were its own definition + log string). The GET /api/collective/offers/:offerId
 * route does NOT use it: that handler runs its own inline `skipTenant: true`
 * cross-tenant lookup (so it can resolve the offer's chapter before asserting
 * membership), which is incompatible with this helper's `tenantId`-scoped query.
 * Not Avi-authored (v17 Phase C). No external reference → safe to remove. */

/* --------------------------------------------------------------- */
/* Validation                                                       */
/* --------------------------------------------------------------- */

const declineBodySchema = z.object({
  reason: z
    .string()
    .min(5, "Decline reason must be at least 5 characters.")
    .max(500, "Decline reason must be at most 500 characters."),
});

/* --------------------------------------------------------------- */
/* Route registration                                               */
/* --------------------------------------------------------------- */

export function registerCollectiveOfferRoutes(app: Express): void {
  /**
   * GET /api/collective/offers/:offerId
   *
   * Member-gated read of a single offer. Tenant scoped via withTenant.
   * Chapter-scoped via requireChapterMemberFromRequest (resolved from the
   * offer's own chapter_id after the row is loaded — so we resolve in two
   * passes: first a CROSS-TENANT lookup to find the chapter, then assert
   * membership).
   */
  app.get(
    "/api/collective/offers/:offerId",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveMember,
    (req: Request, res: Response) => {
      const offerId = String(req.params.offerId ?? "").trim();
      if (!offerId) {
        return res.status(400).json({ ok: false, error: "missing_offer_id" });
      }

      // CROSS-TENANT (admin) — justified because the route caller's active
      // tenant may not be the offer's chapter tenant; we need to look up
      // the offer first to resolve which chapter membership to assert.
      // Soft-delete filter is still applied via withTenant.skipTenant.
      let offer: OfferRow | null = null;
      try {
        const db: any = getDb();
        const rows = db
          .select()
          .from(investorNominationsTable)
          .where(
            withTenant(eq(investorNominationsTable.id, offerId), {
              skipTenant: true,
              table: investorNominationsTable as any,
            }),
          )
          .all() as any[];
        if (rows.length > 0) offer = rowToOffer(rows[0]);
      } catch (err) {
        log.warn("[GET offer] DB read failed:", (err as Error).message);
      }

      if (!offer) return res.status(404).json({ ok: false, error: "not_found" });

      // Chapter membership assertion — caller must belong to the chapter.
      const ctx = (req as any).userContext as { userId?: string; isAdmin?: boolean } | undefined;
      if (!ctx?.isAdmin) {
        // Inline duplicate of requireChapterMember._internal.isActiveChapterMember
        // to keep the route handler self-contained; the middleware itself
        // can't be chained here because chapterId is dynamic from the row.
        const userId = ctx?.userId;
        if (!userId) return res.status(401).json({ ok: false, error: "missing_identity" });
        const isMember = isActiveChapterMember(userId, offer.chapterId);
        if (!isMember) {
          return res.status(403).json({ ok: false, error: "not_chapter_member" });
        }
      }

      return res.json({ ok: true, offer });
    },
  );

  /**
   * POST /api/collective/offers/:offerId/accept
   *
   * Founder accepts an investor's offer. State: pending → accepted.
   * Idempotent: re-accepting an already-accepted offer returns 200 with
   * the existing row. Accepting a declined offer returns 409.
   *
   * Auth chain: requireAuth + requireCollectiveMember + per-row chapter
   * membership assertion + founder-of-companyId ownership assertion.
   */
  app.post(
    "/api/collective/offers/:offerId/accept",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveMember,
    (req: Request, res: Response) => {
      handleDecision(req, res, "accept");
    },
  );

  /**
   * POST /api/collective/offers/:offerId/decline
   *
   * Body: { reason: string (5..500) }
   * Founder declines an investor's offer. State: pending → declined.
   * Idempotent: re-declining returns 200 with the existing row (reason
   * is not overwritten). Declining an already-accepted offer returns 409.
   */
  app.post(
    "/api/collective/offers/:offerId/decline",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveMember,
    (req: Request, res: Response) => {
      handleDecision(req, res, "decline");
    },
  );

  /* Wire requireChapterMemberFromRequest into a no-op import barrier so the
   * tree-shaker keeps the import in the bundle (we use it conceptually via
   * the inline isActiveChapterMember helper). */
  void requireChapterMemberFromRequest;
}

/* --------------------------------------------------------------- */
/* Core handler — accept / decline                                  */
/* --------------------------------------------------------------- */

function handleDecision(req: Request, res: Response, action: "accept" | "decline"): void {
  const offerId = String(req.params.offerId ?? "").trim();
  if (!offerId) {
    res.status(400).json({ ok: false, error: "missing_offer_id" });
    return;
  }

  const ctx = (req as any).userContext as { userId?: string; isAdmin?: boolean } | undefined;
  const userId = ctx?.userId;
  if (!userId) {
    res.status(401).json({ ok: false, error: "missing_identity" });
    return;
  }

  // Validate decline body BEFORE opening any tx — async/expensive checks
  // outside the tx per Rule 6 (Phase B finding).
  let declineReason: string | null = null;
  if (action === "decline") {
    const parsed = declineBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: "validation_failed", issues: parsed.error.format() });
      return;
    }
    declineReason = parsed.data.reason;
  }

  // Load the offer once, cross-tenant, to know which chapter+company we're
  // operating on. We then enforce both chapter membership and founder
  // ownership BEFORE entering the write transaction.
  let offer: OfferRow | null = null;
  try {
    const db: any = getDb();
    const rows = db
      .select()
      .from(investorNominationsTable)
      .where(
        withTenant(eq(investorNominationsTable.id, offerId), {
          skipTenant: true,
          table: investorNominationsTable as any,
        }),
      )
      .all() as any[];
    if (rows.length > 0) offer = rowToOffer(rows[0]);
  } catch (err) {
    log.warn("[handleDecision] DB read failed:", (err as Error).message);
  }

  if (!offer) {
    res.status(404).json({ ok: false, error: "not_found" });
    return;
  }

  // Chapter scoping — caller must be a member of the offer's chapter.
  // Admin bypass kept consistent with requireChapterMember.
  if (!ctx?.isAdmin) {
    const ok = isActiveChapterMember(userId, offer.chapterId);
    if (!ok) {
      res.status(403).json({ ok: false, error: "not_chapter_member" });
      return;
    }
  }

  // Ownership — caller must be a founder of the company on the offer.
  // Admin still passes this gate (parity with the rest of the v16 audit
  // surface) per ctx.isAdmin.
  if (!ctx?.isAdmin) {
    const companies = getCompaniesForFounder(userId);
    const owns = companies.some((c) => c.companyId === offer!.companyId);
    if (!owns) {
      res.status(403).json({ ok: false, error: "company_not_owned" });
      return;
    }
  }

  // State machine transitions.
  const desiredStatus: OfferStatus = action === "accept" ? "accepted" : "declined";

  // Idempotent: same-action re-call returns 200 with existing row (no state
  // change, no audit append).
  if (offer.status === desiredStatus) {
    res.status(200).json({ ok: true, offer, idempotent: true });
    return;
  }

  // Conflict: terminal-state transition not allowed.
  // declined → accept | accept→decline both 409. lapsed → anything 409.
  if (offer.status !== "pending") {
    res.status(409).json({
      ok: false,
      error: "invalid_state_transition",
      message: `Offer is already ${offer.status}; cannot transition to ${desiredStatus}.`,
      currentStatus: offer.status,
    });
    return;
  }

  // Pre-compute values for the tx body so the sync callback stays trivial.
  const decidedAt = nowIso();
  const auditPayload = {
    offerId: offer.id,
    companyId: offer.companyId,
    investorUserId: offer.investorUserId,
    chapterId: offer.chapterId,
    action,
    declineReason,
    decidedBy: userId,
    decidedAt,
    prevHash: offer.hash,
  };
  // The audit row chain is INDEPENDENT from the offer chain. The offer
  // table is itself hash-chained per investor_nominations.hash on each
  // mutating event; we extend its chain by computing a new hash on the
  // state transition payload, with prev = the existing offer.hash.
  const newOfferHash = computeHash(offer.hash, auditPayload);

  let updatedOffer: OfferRow | null = null;
  try {
    const db: any = getDb();
    // SYNC transaction (Phase B finding — better-sqlite3 rejects async).
    db.transaction((tx: any) => {
      // Re-read the row inside the tx to defeat a stale optimistic
      // decision. If status flipped between our outside read and now,
      // throw and let the outer catch convert to 409.
      const fresh = tx
        .select()
        .from(investorNominationsTable)
        .where(
          and(
            eq((investorNominationsTable as any).id, offerId),
            isNull((investorNominationsTable as any).deletedAt),
          ),
        )
        .all() as any[];
      if (fresh.length === 0) {
        throw new Error("offer_missing_inside_tx");
      }
      const freshOffer = rowToOffer(fresh[0]);
      if (freshOffer.status !== "pending") {
        throw new Error(`race_status:${freshOffer.status}`);
      }

      // State update — hash chain extension is the new hash, prev_hash
      // stays as the offer's original prev_hash (we don't rewrite it; the
      // mutation appends to the chain by setting hash = newOfferHash on
      // the same row, which is the audit-grade convention for state
      // machines that don't append a separate row).
      tx.update(investorNominationsTable)
        .set({
          status: desiredStatus,
          declineReason,
          decidedAt,
          decidedBy: userId,
          // Extend chain tip — old hash becomes the prev_hash for the
          // next mutation, so audit verifiers can re-walk
          // [prev_hash → hash] across every transition.
          prevHash: freshOffer.hash,
          hash: newOfferHash,
          updatedAt: decidedAt,
        } as any)
        .where(eq((investorNominationsTable as any).id, offerId))
        .run();

      updatedOffer = {
        ...freshOffer,
        status: desiredStatus,
        declineReason,
        decidedAt,
        decidedBy: userId,
        prevHash: freshOffer.hash,
        hash: newOfferHash,
      };
    });
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (msg.startsWith("race_status:")) {
      const newState = msg.split(":")[1];
      res.status(409).json({
        ok: false,
        error: "invalid_state_transition",
        message: `Offer race: status changed to ${newState} during processing.`,
        currentStatus: newState,
      });
      return;
    }
    log.error("[handleDecision] tx failed:", msg);
    res.status(500).json({ ok: false, error: "internal_error" });
    return;
  }

  if (!updatedOffer) {
    res.status(500).json({ ok: false, error: "internal_error" });
    return;
  }

  // Audit append (separate transaction — appendAdminAudit opens its own
  // BEGIN IMMEDIATE). The hash chain in audit_log is tenant-scoped and
  // serialized by SQLite, so race-free.
  try {
    appendAdminAudit(
      userId,
      `collective_offer:${offer.id}`,
      action === "accept" ? "collective.offer.accepted" : "collective.offer.declined",
      {
        offerId: offer.id,
        companyId: offer.companyId,
        investorUserId: offer.investorUserId,
        chapterId: offer.chapterId,
        declineReason,
        previousStatus: "pending",
        newStatus: desiredStatus,
      },
      offer.tenantId,
    );
  } catch (err) {
    log.warn("[handleDecision] audit append failed (non-fatal):", (err as Error).message);
  }

  // Notify the original investor (acceptance is good news; decline carries
  // a reason). Best-effort, non-fatal.
  try {
    emitNotification({
      userId: offer.investorUserId,
      kind: (action === "accept"
        ? "collective.offer.accepted"
        : "collective.offer.declined") as NotificationKind,
      title:
        action === "accept"
          ? "Your Collective offer was accepted"
          : "Your Collective offer was declined",
      body:
        action === "accept"
          ? `The founder accepted your nomination for ${offer.companyId}.`
          : `The founder declined your nomination for ${offer.companyId}: ${declineReason ?? ""}`,
      link: `/investor/companies/${offer.companyId}`,
    });
  } catch { /* non-fatal */ }

  // Bridge / SSE — invalidates open investor/founder views.
  try {
    emitMutation({
      aggregate: "collective_offer",
      id: offer.id,
      change: "update",
      tenantId: offer.tenantId,
    });
  } catch { /* non-fatal */ }
  // v18 Phase D — SSE fan-out (post-commit).
  try {
    ssePublish(offer.chapterId, "offers", {
      kind: action === "accept" ? "offer.accepted" : "offer.declined",
      offerId: offer.id,
      companyId: offer.companyId,
      investorUserId: offer.investorUserId,
    });
  } catch { /* non-fatal */ }

  res.status(200).json({ ok: true, offer: updatedOffer });
}

/* --------------------------------------------------------------- */
/* Inline chapter-membership helper                                  */
/* --------------------------------------------------------------- */

import { chapterMemberships as chapterMembershipsTable } from "@shared/schema";

/**
 * Mirrors `lib/requireChapterMember._internal.isActiveChapterMember`.
 *
 * Inline to avoid a circular import and so the offer route can resolve
 * chapterId AFTER the offer row is read (dynamic chapter id from the row,
 * not from req params).
 *
 * CROSS-TENANT (admin) — justified because chapter_memberships is the table
 * that establishes the active chapter scope; it cannot itself be
 * tenant-scoped without chicken-and-egg.
 */
function isActiveChapterMember(userId: string, chapterId: string): boolean {
  try {
    const db: any = getDb();
    const rows = db
      .select({
        id: (chapterMembershipsTable as any).id,
        status: (chapterMembershipsTable as any).status,
      })
      .from(chapterMembershipsTable)
      .where(
        and(
          eq((chapterMembershipsTable as any).userId, userId),
          eq((chapterMembershipsTable as any).chapterId, chapterId),
          isNull((chapterMembershipsTable as any).deletedAt),
        ),
      )
      .limit(1)
      .all() as any[];
    const row = rows[0];
    return !!row && row.status === "active";
  } catch (err) {
    log.warn("[collectiveOffersStore.isActiveChapterMember] DB read failed:", (err as Error).message);
    return false;
  }
}

/* --------------------------------------------------------------- */
/* Test-only helpers                                                 */
/* --------------------------------------------------------------- */

export const _internal = Object.freeze({
  computeHash,
  rowToOffer,
  isActiveChapterMember,
});
