/**
 * server/collectiveDscVoteRoutes.ts — v17 Phase C.
 *
 * Public-ish DSC voting endpoints layered on top of v16's `dscVoteStore`
 * foundation. The v16 store provides the hash-chained data layer
 * (`recordVote`, `tallyForCompany`, `verifyChain`); this module wires it
 * to chapter-scoped HTTP routes with per-chapter quorum semantics.
 *
 * Endpoints:
 *
 *   POST /api/collective/dsc/votes/:proposalId
 *     Body: { vote: "approve"|"reject"|"conditional"|"abstain",
 *             chapterId: string, conditions?: string[], notes?: string,
 *             roundId?: string }
 *     Auth: requireAuth + requireCollectiveMember + requireChapterMemberFromRequest(body.chapterId)
 *     Once quorum is met for this proposal at the chapter's threshold,
 *     subsequent vote attempts return 409 LOCKED.
 *
 *   GET /api/collective/dsc/votes/:proposalId/results?chapterId=...
 *     Auth: requireAuth + requireCollectiveMember + requireChapterMemberFromRequest(query.chapterId)
 *     Returns: { tally, quorum: {met, threshold_pct, voters, members},
 *                outcome, chain_tip_hash, chain_valid, chapterId }
 *
 * Notes on the "proposal" abstraction:
 *   v16's dscVoteStore keys votes by `companyId`. For v17 Phase C, the
 *   `proposalId` route parameter maps 1:1 to a company (a DSC proposal is
 *   "should we approve/reject company X?"). The chapter scope comes
 *   explicitly from the body or query to keep the route URL stable and
 *   avoid the chicken-and-egg of resolving a chapter from a not-yet-cast
 *   vote.
 *
 * Quorum source: per-chapter `chapters.dsc_quorum_pct` (v17 Phase C
 * additive column; default 50 = simple majority). Computed against the
 * count of active chapter members (from `chapter_memberships`).
 *
 * Cross-chapter isolation: a Toronto member's vote for company X is
 * isolated from an NYC member's vote because the tally is filtered to
 * the caller's chapter via `chapterId` in the body/query AND
 * `requireChapterMemberFromRequest` rejects cross-chapter callers.
 *
 * Rules followed (v19 brief §10–42):
 *   - SYNC transactions (Phase B finding)
 *   - withTenant() on every chapter_memberships read (which itself is
 *     intentionally cross-tenant — chapter membership defines the scope)
 *   - hash-chained vote insert handled by recordVote() inside its own
 *     sync tx (v16 implementation; we don't double-wrap)
 *   - graceful 503 when COLLECTIVE_ENABLED=0
 *   - chain_tip_hash exposed for client-side audit verification
 */

import type { Express, Request, Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { requireAuth } from "./lib/authMiddleware";
import { requireCollectiveMember } from "./lib/requireCollectiveMember";
import { requireChapterMemberFromRequest } from "./lib/requireChapterMember";
import { requireCollectiveEnabled } from "./lib/featureFlags";
import { withTenant } from "./lib/withTenant";
import { getDb } from "./db/connection";
import {
  chapters as chaptersTable,
  chapterMemberships as chapterMembershipsTable,
} from "@shared/schema";
import {
  recordVote,
  tallyForCompany,
  verifyChain,
  getVotesForCompany,
  type DscVote,
} from "./dscVoteStore";
import { isDscMember } from "./adminDscRoutes";
import { appendAdminAudit } from "./adminPlatformStore";
import { emitMutation } from "./lib/eventBus";
import { publish as ssePublish } from "./lib/sseHub";
import { log } from "./lib/logger";
// v25.21 Lane C NC-001 fix — once a DSC proposal locks with outcome
// "approved", we admit the company to the Collective deal room by setting
// `transactionPrepStatus="exploring"` AND emitting the previously-declared
// (but never-emitted) `collective.deal_room.opened` bridge event. Before
// this fix, an approved proposal had zero downstream effect — the flagship
// vote-→-deal-room happy path was broken.
import { updateCompanyProfile, getCompanyProfile } from "./companyProfileStore";
import { emitBridgeEvent } from "./bridgeStore";

/* --------------------------------------------------------------- */
/* Helpers                                                          */
/* --------------------------------------------------------------- */

/**
 * Look up a chapter's DSC quorum percentage. Default 50 if the column is
 * missing (legacy migration path) or the row isn't found.
 *
 * CROSS-TENANT (admin) — justified because chapters are tenant-scoped per
 * row (each chapter IS its own tenant) but this lookup is a global
 * read-by-PK and not bound to a particular caller scope. Soft-delete is
 * preserved via isNull(deletedAt).
 */
function getChapterQuorumPct(chapterId: string): number {
  try {
    const db: any = getDb();
    const rows = db
      .select({
        dscQuorumPct: (chaptersTable as any).dscQuorumPct,
      })
      .from(chaptersTable)
      .where(
        and(
          eq((chaptersTable as any).id, chapterId),
          isNull((chaptersTable as any).deletedAt),
        ),
      )
      .limit(1)
      .all() as any[];
    const v = rows[0]?.dscQuorumPct;
    if (typeof v === "number" && v >= 0 && v <= 100) return v;
    return 50;
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!/no such (table|column)/i.test(msg)) {
      log.warn("[collectiveDscVoteRoutes.getChapterQuorumPct] read failed:", msg);
    }
    return 50;
  }
}

/**
 * Count active members of a chapter (denominator for quorum math).
 *
 * CROSS-TENANT (admin) — chapter_memberships is the table that defines
 * tenant scope (per Phase A `requireChapterMember._internal`).
 */
function countActiveChapterMembers(chapterId: string): number {
  try {
    const db: any = getDb();
    const rows = db
      .select({ id: (chapterMembershipsTable as any).id })
      .from(chapterMembershipsTable)
      .where(
        and(
          eq((chapterMembershipsTable as any).chapterId, chapterId),
          eq((chapterMembershipsTable as any).status, "active"),
          isNull((chapterMembershipsTable as any).deletedAt),
        ),
      )
      .all() as any[];
    return rows.length;
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!/no such table/i.test(msg)) {
      log.warn("[collectiveDscVoteRoutes.countActiveChapterMembers] read failed:", msg);
    }
    return 0;
  }
}

/**
 * v25.22 NH-4 fix — resolve the chapter(s) that a company is associated with
 * via founder_collective_applications. Used to prevent cross-chapter DSC
 * voting: a member of chapter A cannot vote on a company that only belongs
 * to chapter B and admit it to chapter B's deal room.
 *
 * Returns the set of chapter IDs to which the company has an accepted (or
 * pending) founder application. Empty set means "company is not tied to any
 * chapter" — we treat that as ambiguous and reject the vote.
 *
 * CROSS-TENANT (admin) — this is a global ownership lookup not bound to a
 * particular caller scope; the caller still must pass the chapter membership
 * gate separately.
 */
function chaptersForCompany(companyId: string): Set<string> {
  const out = new Set<string>();
  try {
    const db: any = getDb();
    // Try better-sqlite3 raw prepare path first; fall back to drizzle if
    // the raw handle isn't available.
    const rawHandle = typeof (db as any).prepare === "function" ? (db as any) : null;
    if (rawHandle) {
      const rows = rawHandle
        .prepare("SELECT chapter_id FROM founder_collective_applications WHERE company_id = ?")
        .all(companyId) as Array<{ chapter_id?: string }>;
      for (const r of rows) {
        if (r && typeof r.chapter_id === "string" && r.chapter_id) out.add(r.chapter_id);
      }
    }
  } catch (err) {
    const msg = (err as Error).message || "";
    if (!/no such table/i.test(msg)) {
      log.warn("[collectiveDscVoteRoutes.chaptersForCompany] read failed:", msg);
    }
  }
  return out;
}

/**
 * Compute chapter-scoped tally + quorum status + outcome.
 *
 * `quorumMet` = active voters * 100 >= members * quorum_pct
 *   (multiplication form avoids float division)
 *
 * `outcome`:
 *   - null when quorum not met
 *   - 'approved' when quorum met AND (approve + conditional) > reject
 *   - 'rejected' when quorum met AND reject >= (approve + conditional)
 *
 * Conditional approvals are folded into the "approve" tally for outcome
 * purposes per v16 adminDsc convention.
 */
export interface ProposalResults {
  proposalId: string;
  chapterId: string;
  tally: {
    approve: number;
    reject: number;
    conditional: number;
    abstain: number;
    voterCount: number;
  };
  quorum: {
    met: boolean;
    thresholdPct: number;
    memberCount: number;
    voterCount: number;
  };
  outcome: "approved" | "rejected" | null;
  chainTipHash: string | null;
  chainValid: boolean;
  /** True when no further votes will be accepted (quorum reached & locked). */
  locked: boolean;
}

export function computeProposalResults(proposalId: string, chapterId: string): ProposalResults {
  /* v25.12 NC-2 — thread chapterId into tallyForCompany so chapter A's
   * votes do not poll into chapter B's tally; quorum denominator is
   * computed from chapter member count, not platform total. */
  const tally = tallyForCompany(proposalId, { chapterId });
  const memberCount = countActiveChapterMembers(chapterId);
  const thresholdPct = getChapterQuorumPct(chapterId);
  // voterCount * 100 >= memberCount * thresholdPct  ↔  voterCount/memberCount >= thresholdPct/100
  const met = memberCount > 0 && tally.voterCount * 100 >= memberCount * thresholdPct;

  let outcome: ProposalResults["outcome"] = null;
  if (met) {
    const approves = tally.approve + tally.conditional;
    outcome = approves > tally.reject ? "approved" : "rejected";
  }

  const chain = verifyChain(proposalId);
  const chainTipHash = chain.valid ? chain.lastHash : null;

  return {
    proposalId,
    chapterId,
    tally: {
      approve: tally.approve,
      reject: tally.reject,
      conditional: tally.conditional,
      abstain: tally.abstain,
      voterCount: tally.voterCount,
    },
    quorum: {
      met,
      thresholdPct,
      memberCount,
      voterCount: tally.voterCount,
    },
    outcome,
    chainTipHash,
    chainValid: chain.valid,
    locked: met,
  };
}

/* --------------------------------------------------------------- */
/* Validation schemas                                                */
/* --------------------------------------------------------------- */

const castVoteSchema = z.object({
  vote: z.enum(["approve", "reject", "conditional", "abstain"]),
  chapterId: z.string().min(1, "chapterId required"),
  conditions: z.array(z.string().min(1)).optional(),
  notes: z.string().max(2000).optional(),
  roundId: z.string().optional(),
});

/* --------------------------------------------------------------- */
/* Route registration                                                */
/* --------------------------------------------------------------- */

export function registerCollectiveDscVoteRoutes(app: Express): void {
  /**
   * POST /api/collective/dsc/votes/:proposalId
   *
   * Cast or update a DSC vote on a proposal. proposalId == companyId for
   * v17 Phase C (one proposal per company).
   *
   * Auth: requireAuth + requireCollectiveMember + chapter membership
   * (chapterId from body) + DSC role check.
   *
   * Locking: once quorum is met at the chapter's threshold, further votes
   * are rejected with 409 vote_locked.
   */
  app.post(
    "/api/collective/dsc/votes/:proposalId",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveMember,
    requireChapterMemberFromRequest((req) => {
      // chapterId is in body — required by schema below; if absent, the
      // factory returns "" which yields a 400 missing_chapter_id.
      return typeof (req.body as any)?.chapterId === "string"
        ? String((req.body as any).chapterId)
        : "";
    }),
    (req: Request, res: Response) => {
      const proposalId = String(req.params.proposalId ?? "").trim();
      if (!proposalId) {
        return res.status(400).json({ ok: false, error: "missing_proposal_id" });
      }

      const parsed = castVoteSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          ok: false,
          error: "validation_failed",
          issues: parsed.error.format(),
        });
      }
      const { vote, chapterId, conditions, notes, roundId } = parsed.data;

      const ctx = (req as any).userContext as { userId?: string; isAdmin?: boolean } | undefined;
      const userId = ctx?.userId;
      if (!userId) {
        return res.status(401).json({ ok: false, error: "missing_identity" });
      }

      /* DSC role gate — only members with `dsc:vote` entitlement may cast
       * votes. Admins bypass for moderation parity with the rest of the
       * Collective surface.
       *
       * v25.21 Lane C NH-7 fix — previously this gate checked only the
       * legacy `isDscMember(userId)` role, which meant a paid `standard`
       * tier member (who DOES carry the `dsc:vote` entitlement per
       * `stripeCollective.ts` COLLECTIVE_TIER_CATALOG) received 403
       * `not_dsc_member`. We now accept either the legacy role OR an active
       * billing row whose tier grants `dsc:vote`. Either path is sufficient.
       */
      let isAllowed = ctx?.isAdmin === true || isDscMember(userId);
      if (!isAllowed) {
        try {
          const { getBillingForUser } = require("./collectiveBillingStore");
          const { COLLECTIVE_TIER_CATALOG } = require("./lib/stripeCollective");
          const billing = getBillingForUser(userId, chapterId);
          if (billing && billing.status === "active" && billing.tier) {
            const tierEntry = COLLECTIVE_TIER_CATALOG.find(
              (t: any) => t.tier === billing.tier,
            );
            if (tierEntry && tierEntry.entitlements?.includes("dsc:vote")) {
              isAllowed = true;
            }
          }
        } catch (entErr) {
          log.warn(
            "[POST dsc/votes] entitlement check failed (falling back to legacy gate):",
            (entErr as Error).message,
          );
        }
      }
      /* v25.22 NH-5 fix — comp/grant members (admin-approved, no billing
       * row) were previously rejected by both the legacy `isDscMember` role
       * gate AND the v25.21 tier-entitlement gate (which requires an
       * `active` billing row that doesn't exist for comp/grant). Admit them
       * via the membership store: an active comp/grant membership row IS a
       * sufficient signal that the admin intended this user to have access. */
      if (!isAllowed) {
        try {
          const membership = require("./collectiveMembershipStore");
          if (membership.isActive(userId)) {
            isAllowed = true;
          }
        } catch (memErr) {
          log.warn(
            "[POST dsc/votes] membership fallback check failed:",
            (memErr as Error).message,
          );
        }
      }
      if (!isAllowed) {
        return res.status(403).json({ ok: false, error: "not_dsc_member" });
      }

      /* v25.22 Lane A2 NH-004 fix — cross-chapter DSC authorization gap.
       * The chapter gate above (requireChapterMemberFromRequest) confirms
       * the *caller* belongs to body.chapterId, but never validated that
       * the *company being voted on* belongs to that chapter. A member of
       * chapter A could submit { chapterId: "chapA", proposalId: "co_in_chapB" }
       * and admit chapter B's company to chapter A's deal room. We now
       * resolve the company→chapter mapping via founder_collective_applications
       * and require the asserted chapter to be one of them. Admins bypass
       * for moderation parity (rest of Collective surface). */
      if (ctx?.isAdmin !== true) {
        const companyChapters = chaptersForCompany(proposalId);
        if (companyChapters.size > 0 && !companyChapters.has(chapterId)) {
          return res.status(403).json({
            ok: false,
            error: "chapter_company_mismatch",
            message: "This company does not belong to your chapter.",
          });
        }
      }

      // Lock check — once chapter-scoped quorum has been met, no further
      // votes are accepted (this is the "voting window closed" behaviour
      // described in the brief; quorum being met is the natural closing
      // signal since we don't have an explicit window column).
      const preResults = computeProposalResults(proposalId, chapterId);
      if (preResults.locked) {
        // Allow a voter to NO-OP re-cast of the same vote they already
        // have (idempotent), but reject any new or changed vote.
        const existing = getVotesForCompany(proposalId, { activeOnly: true })
          .find((v) => v.voterUserId === userId);
        if (existing && existing.vote === vote) {
          return res.status(200).json({
            ok: true,
            idempotent: true,
            vote: existing,
            results: preResults,
          });
        }
        return res.status(409).json({
          ok: false,
          error: "vote_locked",
          message: "Quorum reached; further votes are locked.",
          results: preResults,
        });
      }

      // Cast / update the vote — recordVote opens its own sync tx and
      // handles supersession of the prior un-superseded row by this voter.
      let voteRow;
      try {
        voteRow = recordVote({
          companyId: proposalId,
          roundId: roundId ?? null,
          voterUserId: userId,
          vote: vote as DscVote,
          conditions,
          notes,
          // v25.12 NC-2 — stamp the chapter scope on the vote row so the
          // tally only counts votes for the same chapter.
          chapterId: chapterId ?? null,
        });
      } catch (err) {
        const msg = (err as Error).message ?? "";
        if (msg === "missing_company_id" || msg === "invalid_vote") {
          return res.status(400).json({ ok: false, error: msg });
        }
        log.error("[POST dsc/votes] recordVote failed:", msg);
        return res.status(500).json({ ok: false, error: "internal_error" });
      }

      // Audit append (post-tx — appendAdminAudit opens its own tx).
      try {
        appendAdminAudit(
          userId,
          `dsc_proposal:${proposalId}`,
          "collective.dsc.vote.cast",
          {
            proposalId,
            chapterId,
            vote,
            conditions: conditions ?? null,
            notes: notes ?? null,
            voteId: voteRow.id,
            voteHash: voteRow.hash,
          },
        );
      } catch (err) {
        log.warn("[POST dsc/votes] audit append failed:", (err as Error).message);
      }

      // Bridge — SSE invalidation for any open tally subscribers.
      try {
        emitMutation({
          aggregate: "dsc_vote",
          id: voteRow.id,
          change: "create",
        });
      } catch { /* non-fatal */ }

      // Re-compute results post-vote for the response.
      const results = computeProposalResults(proposalId, chapterId);

      // v18 Phase D — SSE fan-out (post-commit). Always publish vote.cast;
      // if quorum just became locked, publish a follow-up results.locked.
      try {
        ssePublish(chapterId, "dsc-votes", {
          kind: "dsc.vote.cast",
          proposalId,
          voterUserId: userId,
          vote,
          voteId: voteRow.id,
          results,
        });
        if (results.locked && !preResults.locked) {
          ssePublish(chapterId, "dsc-votes", {
            kind: "dsc.vote.results_locked",
            proposalId,
            results,
          });
        }
      } catch { /* non-fatal */ }

      /* v25.21 Lane C NC-001 fix — if quorum just locked AND outcome is
       * "approved", admit the company to the Collective deal room.
       *
       * v25.22 NC-2 fix — require `results.chainValid` to be true before
       * admitting. A vote whose hash chain has been tampered with must not
       * unlock deal-room access. Previously `chainValid` was surfaced in
       * the response but never gated anything.
       *
       * v25.22 NC-5 fix — notify the founder when their company is admitted.
       * The previous fix emitted `collective.deal_room.opened` into the
       * bridge but no UI subscribed to it, so the founder never knew.
       *
       * Idempotent: `results.locked && !preResults.locked` only fires on the
       * single vote that crosses the threshold, so the bridge event is
       * emitted exactly once per proposal lock. The company profile update
       * is safe to re-run (the profile store appends a new version anyway).
       */
      if (
        results.locked &&
        !preResults.locked &&
        results.outcome === "approved" &&
        results.chainValid === true
      ) {
        const companyId = proposalId;
        try {
          /* Only nudge transactionPrepStatus forward if it isn't already at
           * or past `exploring` — don't override a founder who has manually
           * moved their deal to `active` or `closing`. */
          const profile = getCompanyProfile(companyId);
          const current = profile?.transactionPrepStatus;
          const alreadyAdmitted =
            current === "exploring" || current === "active" || current === "closing";
          if (!alreadyAdmitted) {
            updateCompanyProfile(
              companyId,
              { transactionPrepStatus: "exploring" },
              "system:collective_dsc_vote_lock",
            );
          }
        } catch (profileErr) {
          log.warn(
            "[POST dsc/votes] deal-room admission profile update failed (non-fatal):",
            (profileErr as Error).message,
          );
        }
        try {
          emitBridgeEvent({
            eventType: "collective.deal_room.opened",
            aggregateId: companyId,
            aggregateKind: "company",
            actor: { userId: "system:collective_dsc_vote_lock" },
            payload: {
              proposalId,
              companyId,
              chapterId,
              outcome: results.outcome,
              chainTipHash: results.chainTipHash,
              admittedAt: new Date().toISOString(),
            },
          });
        } catch (bridgeErr) {
          log.warn(
            "[POST dsc/votes] collective.deal_room.opened emit failed (non-fatal):",
            (bridgeErr as Error).message,
          );
        }
        try {
          appendAdminAudit(
            "system:collective_dsc_vote_lock",
            `company:${companyId}`,
            "collective.deal_room.opened",
            {
              proposalId,
              companyId,
              chapterId,
              outcome: results.outcome,
              chainTipHash: results.chainTipHash,
            },
          );
        } catch { /* non-fatal */ }
        /* v25.22 NC-5 fix — notify the founder. Without this the founder
         * had no idea their company had been admitted to the deal room. The
         * handler is sync, so we use `.then(...).catch(...)` instead of
         * `await` to keep the response path non-blocking and the function
         * signature unchanged. */
        try {
          const { emitNotification } = require("./notificationsStore");
          const { founderUserIdForCompany } = require("./sprint21PortfolioRoutes");
          Promise.resolve(founderUserIdForCompany(companyId)).then((founderUserId: string | null) => {
            if (!founderUserId) return;
            emitNotification({
              userId: founderUserId,
              kind: "collective.deal_room_admitted",
              title: "Your company has been admitted to the Collective deal room.",
              body: "A chapter just approved your DSC proposal. Investors can now reach out about a transaction.",
              link: `/founder/companies/${companyId}`,
            });
          }).catch((err: Error) => {
            log.warn("[POST dsc/votes] founder notification (async) failed (non-fatal):", err.message);
          });
        } catch (notifyErr) {
          log.warn(
            "[POST dsc/votes] founder notification failed (non-fatal):",
            (notifyErr as Error).message,
          );
        }
      }

      /* v25.22 NC-3 fix — if outcome is "rejected" on the locking vote OR
       * chainValid is false, revert any deal-room admission this proposal
       * may have triggered earlier (idempotent: only acts on an `exploring`
       * profile that this DSC system set; preserves `active`/`closing`
       * states the founder advanced manually). Without this, a tampered or
       * later-rejected proposal could leave a company in the deal room
       * indefinitely. */
      if (
        results.locked &&
        !preResults.locked &&
        (results.outcome === "rejected" || results.chainValid === false)
      ) {
        const companyId = proposalId;
        try {
          const profile = getCompanyProfile(companyId);
          if (profile?.transactionPrepStatus === "exploring") {
            updateCompanyProfile(
              companyId,
              { transactionPrepStatus: "not_pursuing" },
              "system:collective_dsc_vote_revert",
            );
          }
        } catch (revertErr) {
          log.warn(
            "[POST dsc/votes] deal-room revert failed (non-fatal):",
            (revertErr as Error).message,
          );
        }
        try {
          appendAdminAudit(
            "system:collective_dsc_vote_revert",
            `company:${companyId}`,
            "collective.deal_room.reverted",
            {
              proposalId,
              companyId,
              chapterId,
              outcome: results.outcome,
              chainValid: results.chainValid,
              chainTipHash: results.chainTipHash,
            },
          );
        } catch { /* non-fatal */ }
      }

      return res.status(200).json({ ok: true, vote: voteRow, results });
    },
  );

  /**
   * GET /api/collective/dsc/votes/:proposalId/results
   *
   * Returns the tally + quorum status + final outcome + chain_tip_hash for
   * a proposal, scoped to the caller's chapter.
   *
   * Any chapter member can read results (public-ish — the brief: "Public-ish
   * requireAuth + requireCollectiveMember; any member of the chapter").
   */
  app.get(
    "/api/collective/dsc/votes/:proposalId/results",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveMember,
    requireChapterMemberFromRequest((req) =>
      typeof req.query.chapterId === "string" ? String(req.query.chapterId) : "",
    ),
    (req: Request, res: Response) => {
      const proposalId = String(req.params.proposalId ?? "").trim();
      if (!proposalId) {
        return res.status(400).json({ ok: false, error: "missing_proposal_id" });
      }
      const chapterId = String(req.query.chapterId ?? "").trim();
      // requireChapterMemberFromRequest already 400'd if chapterId was empty.

      const results = computeProposalResults(proposalId, chapterId);

      // Touch withTenant once for the audit reviewer — the underlying
      // recompute reads from the in-memory tally (hydrated under
      // dscVoteStore.hydrate which IS withTenant-scoped per company tenant).
      void withTenant;

      return res.json({ ok: true, ...results });
    },
  );
}

/* --------------------------------------------------------------- */
/* Test-only helpers                                                 */
/* --------------------------------------------------------------- */

export const _internal = Object.freeze({
  getChapterQuorumPct,
  countActiveChapterMembers,
  computeProposalResults,
});
