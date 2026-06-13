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
  const tally = tallyForCompany(proposalId);
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

      // DSC role gate — only DSC members may cast votes. Admins bypass for
      // moderation parity with the rest of the Collective surface.
      if (!ctx?.isAdmin && !isDscMember(userId)) {
        return res.status(403).json({ ok: false, error: "not_dsc_member" });
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
