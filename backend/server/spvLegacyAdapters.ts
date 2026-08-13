/**
 * server/spvLegacyAdapters.ts — Wave B (v26.4.0) Stage 2
 *
 * Contract-preserving adapter routes for the 10 legacy SPV endpoints that
 * were previously registered by `spvFundStore.registerSpvFundRoutes(app)`.
 *
 * ============================================================================
 * WAVE B STAGE 2 SCOPE
 * ============================================================================
 *
 * This file replaces `registerSpvFundRoutes` as the route-registration entry
 * for the 10 `/api/partner/me/spvs/:id/*` child routes. Every response body
 * shape, status code, error code, gate, and SSE event name is preserved
 * byte-identically with the pre-Wave-B behaviour.
 *
 * The adapter routes now import ONLY from `./spvEngineStore` (the engine's
 * Wave B Stage 2 adapter methods: `engineAddCommitment`, `engineListCapitalCalls`,
 * `engineReconcileLegacySpv`, etc.). This breaks the direct `routes.ts →
 * spvFundStore` coupling, allowing `spvFundStore.ts` to be treated as an
 * internal implementation module (no longer surfaced in the route
 * registration path).
 *
 * ============================================================================
 * ROUTES REGISTERED (identical to legacy `registerSpvFundRoutes`)
 * ============================================================================
 *
 *   1.  GET    /api/partner/me/spvs/:id/detail
 *   2.  GET    /api/partner/me/spvs/:id/commitments
 *   3.  POST   /api/partner/me/spvs/:id/commitments
 *   4.  PATCH  /api/partner/me/spvs/:id/commitments/:commitmentId
 *   5.  GET    /api/partner/me/spvs/:id/capital-calls
 *   6.  POST   /api/partner/me/spvs/:id/capital-calls
 *   7.  GET    /api/partner/me/spvs/:id/distributions
 *   8.  POST   /api/partner/me/spvs/:id/distributions
 *   9.  GET    /api/partner/me/spvs/:id/db-positions
 *  10.  POST   /api/partner/me/spvs/:id/db-positions
 *
 * ============================================================================
 * GATE PRESERVATION (audited against v26.3.5)
 * ============================================================================
 *
 * Every route retains its pre-Wave-B middleware chain:
 *   - requirePartnerAuth on ALL routes
 *   - assertSubRole("managing_partner") on POST/PATCH writes
 *   - requireSignedAgreement on POST/PATCH writes (W2-I override)
 *   - gate(req, res) → CONSORTIUM_ENABLED feature-flag check (503 if off)
 *
 * ============================================================================
 * ERROR STATUS MAP (preserved 1:1 from legacy)
 * ============================================================================
 *
 *   404 NOT_FOUND                                — SPV missing, NOT OWNED BY THE
 *                                                  CALLER, or COMMITMENT_NOT_FOUND
 *
 *   WAVE 35 · F9 — `403 NOT_OWNER` (partner mismatch) is RETIRED. Answering a
 *   different status for "exists but not yours" than for "does not exist" let
 *   any authenticated partner enumerate every SPV id on the platform. Both
 *   cases now answer 404 NOT_FOUND. This IS a deliberate contract change and
 *   is reported as such, not a silent one.
 *   400 INVALID_BODY                             — Zod validation fail
 *   422 INVARIANT_DISTRIBUTION_EXCEEDS_COMMITMENTS — I-2 breach on distribution
 *   500 COMMITMENT_FAILED | TRANSITION_FAILED
 *       | CAPITAL_CALL_FAILED | DISTRIBUTION_FAILED
 *       | POSITION_FAILED                       — persistence failure
 *   503 CONSORTIUM_DISABLED                     — feature flag
 *
 * ============================================================================
 * SSE EVENTS (preserved names)
 * ============================================================================
 *
 *   spv.commitment.created / spv.commitment.transitioned
 *   spv.capital_call.recorded
 *   spv.distribution.recorded
 *   spv.position.recorded
 *
 * All emitted on channel "spv" via `ssePublish(ctx.partnerId, "spv", ...)`.
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";

import { requirePartnerAuth, assertSubRole } from "./lib/requirePartnerAuth";
import { requireSignedAgreement } from "./lib/requireSignedAgreement";
/* WAVE 2B / BLOCKER 1 — legacy plural distribution ledger fail-closed. */
import { legacyDistributionLedgerClosed } from "./lib/legacyDistributionLedger";
import { publish as ssePublish } from "./lib/sseHub";
import { log, errorMeta } from "./lib/logger";
import {
  engineGetLegacySpvById,
  engineListLegacyCommitments,
  engineListCapitalCalls,
  engineListLegacyDistributions,
  engineListLegacyPositions,
  engineReconcileLegacySpv,
  engineAddCommitment,
  engineTransitionCommitment,
  engineRecordCapitalCall,
  engineRecordDistribution,
  engineRecordLegacyPosition,
} from "./spvEngineStore";

/* ============================================================
 * Feature-flag gate — mirrors legacy `gate()` from spvFundStore.
 * Read CONSORTIUM_ENABLED env at call time (NOT module-load) so
 * tests that mutate process.env between requests see the change.
 * ============================================================ */

function consortiumEnabled(): boolean {
  const v = process.env.CONSORTIUM_ENABLED ?? "1";
  return v !== "0" && v.toLowerCase() !== "false";
}

function gate(_req: Request, res: Response): boolean {
  if (consortiumEnabled()) return true;
  res.status(503).json({
    error: "CONSORTIUM_DISABLED",
    message: "Consortium SPV/fund endpoints are disabled (CONSORTIUM_ENABLED=0).",
  });
  return false;
}

/* ============================================================
 * WAVE 2B / BLOCKER 1 — LEGACY DISTRIBUTION LEDGER: FAIL CLOSED
 * ============================================================
 *
 * WAVE 2 (SC-2) disabled the `Record Distribution` panel on
 * client/src/pages/partner/PartnerSpvDetail.tsx. Adversarial review B
 * (build_log/WAVES_012_REVIEW_B.md, BLOCKER 1) showed that this made the
 * surface UI-inert but NOT capability-inert: the same authenticated
 * managing partner can `fetch()` this route from DevTools, or replay a
 * captured request, and still create a financial record in the WRONG ledger.
 *
 * THE SPLIT LEDGER (the actual defect):
 *   POST /api/partner/me/spvs/:id/distributions   (PLURAL, this route)
 *     -> engineRecordDistribution -> spvFundStore.recordDistribution
 *     -> INSERT INTO spv_distributions            (server/spvFundStore.ts:902)
 *   POST /api/partner/me/spv/:id/distributions    (SINGULAR, canonical)
 *     -> spvEngineStore.recordDistribution
 *     -> INSERT INTO spv_distribution             (server/spvEngineStore.ts:1538)
 * The canonical singular read cannot see a plural write. The owner ruled the
 * SINGULAR table canonical, so a write here is a silent data-integrity loss.
 *
 * FAIL CLOSED, ON THE SERVER, BEFORE PARSING OR WRITING. This is the first
 * statement of the handler: no body parse, no SPV load, no store call, no SSE.
 * The middleware chain (auth / sub-role / signed agreement) still runs first so
 * this route leaks nothing new to an unauthenticated or under-privileged
 * caller — an anonymous request still gets 401, a viewer still gets 403.
 *
 * REVERSIBILITY: delete the two `if (legacyDistributionLedgerClosed(res)) return;`
 * call sites (here and in the retired server/spvFundStore.ts registrar) once
 * SC-5 repoints this route onto the canonical singular ledger.
 *
 * The closure itself lives in server/lib/legacyDistributionLedger.ts so both
 * registrars share one implementation.
 *
 * Proof it writes ZERO rows:
 *   server/__tests__/wave2b_blocker1_legacy_distribution_closed.test.ts
 */

/* ============================================================
 * Zod schemas — byte-identical to spvFundStore lines 393-425.
 * ============================================================ */

const commitmentCreateSchema = z.object({
  lp_user_id: z.string().min(1),
  amount_minor: z.number().int().min(0),
  commitment_doc_url: z.string().url().optional().nullable(),
});

const commitmentTransitionSchema = z.object({
  status: z.enum(["pending", "signed", "funded", "withdrawn"]),
});

const capitalCallSchema = z.object({
  amount_minor: z.number().int().min(0),
  called_at: z.string().optional(),
  due_at: z.string().optional().nullable(),
});

const distributionSchema = z.object({
  distribution_type: z.enum(["dividend", "exit", "return_of_capital"]).optional(),
  total_minor: z.number().int().min(0),
  distributed_at: z.string().optional(),
});

const positionSchema = z.object({
  security_id: z.string().min(1),
  shares: z.string().min(1),
  basis_minor: z.number().int().min(0),
  acquired_at: z.string().optional().nullable(),
});

/* ============================================================
 * Ownership-check helper — DRY for the identical pattern used
 * across all 10 routes.
 *
 * WAVE 35 · F9 (SECOND PATH — not named by the review) ─────────
 * This helper USED to answer `spv ? 403 : 404` — 403 NOT_OWNER when the SPV
 * row exists but belongs to another partner, 404 NOT_FOUND when it does not
 * exist at all. That difference IS the leak. Any authenticated partner could
 * walk an id space against `GET /api/partner/me/spvs/:id/detail` and read off
 * exactly which SPV ids are real, because the two answers are
 * distinguishable. SPVs are the private vehicles; their mere existence, count
 * and id shape are confidential. This is the identical oracle Review A found
 * on the three cap-table routes (F9) — the review named those three; this is
 * the fourth, on a different router, keyed directly on the SPV id.
 *
 * Both branches now answer **404 NOT_FOUND**, so a wrong-but-real partner
 * cannot distinguish "exists but forbidden" from "does not exist". The
 * OWNER's 200 is untouched — that pole is asserted in
 * `server/__tests__/wave35_spv_detail_enumeration.test.ts`, so this cannot be
 * satisfied by simply refusing everyone.
 * ============================================================ */

/** The single refusal for an SPV the caller may not have. Never 403. */
export const SPV_SINK_NOT_FOUND = { error: "NOT_FOUND" as const };
export const SPV_SINK_NOT_FOUND_STATUS = 404;

function loadOwnedSpvOr404(
  req: Request,
  res: Response,
): import("./spvFundStore").SpvRow | null {
  const ctx = req.partnerContext!;
  const spv = engineGetLegacySpvById(String(req.params.id));
  if (!spv || spv.partnerId !== ctx.partnerId) {
    res.status(SPV_SINK_NOT_FOUND_STATUS).json(SPV_SINK_NOT_FOUND);
    return null;
  }
  return spv;
}

/* ============================================================
 * Route registration.
 * ============================================================ */

export function registerSpvLegacyAdapterRoutes(app: Express): void {
  /* ---------- 1. GET /:id/detail (full reconcile bundle) ---------- */
  app.get("/api/partner/me/spvs/:id/detail", requirePartnerAuth, (req: Request, res: Response) => {
    if (!gate(req, res)) return;
    /* WAVE 35 · F9 — this handler carried its OWN inline copy of the ownership
       check with the separate 404/403 codes, so fixing the shared helper alone
       would have left the leak wide open on the very route Review A's class
       description fits best. It now goes THROUGH the shared helper, which is
       the only way a tenth route cannot reintroduce the oracle. */
    const spv = loadOwnedSpvOr404(req, res);
    if (!spv) return;
    const positions = engineListLegacyPositions(spv.id);
    const commitments = engineListLegacyCommitments(spv.id);
    const capitalCalls = engineListCapitalCalls(spv.id);
    const distributions = engineListLegacyDistributions(spv.id);
    const recon = engineReconcileLegacySpv(spv.id);
    res.json({
      spv,
      positions,
      commitments,
      capitalCalls,
      distributions,
      reconciliation: {
        committedMinor: recon.committedMinor.toString(),
        calledMinor: recon.calledMinor.toString(),
        distributedMinor: recon.distributedMinor.toString(),
        uncalledMinor: recon.uncalledMinor.toString(),
        netInvestedMinor: recon.netInvestedMinor.toString(),
        totalBasisMinor: recon.totalBasisMinor.toString(),
      },
    });
  });

  /* ---------- COMMITMENTS ---------- */
  /* 2. GET /:id/commitments */
  app.get("/api/partner/me/spvs/:id/commitments", requirePartnerAuth, (req: Request, res: Response) => {
    if (!gate(req, res)) return;
    const spv = loadOwnedSpvOr404(req, res);
    if (!spv) return;
    res.json({ commitments: engineListLegacyCommitments(spv.id) });
  });

  // v25.14 NH3 — restricted to managing_partner (financial mutation).
  /* 3. POST /:id/commitments */
  app.post(
    "/api/partner/me/spvs/:id/commitments",
    requirePartnerAuth,
    assertSubRole("managing_partner"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      if (!gate(req, res)) return;
      const ctx = req.partnerContext!;
      const spv = loadOwnedSpvOr404(req, res);
      if (!spv) return;
      const parsed = commitmentCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "INVALID_BODY", details: parsed.error.flatten() });
        return;
      }
      try {
        const row = engineAddCommitment({
          partnerId: ctx.partnerId,
          spvId: spv.id,
          lpUserId: parsed.data.lp_user_id,
          amountMinor: parsed.data.amount_minor,
          commitmentDocUrl: parsed.data.commitment_doc_url ?? null,
        });
        ssePublish(ctx.partnerId, "spv", { type: "spv.commitment.created", spvId: spv.id, commitmentId: row.id });
        res.status(201).json({ ok: true, commitment: row });
      } catch (e) {
        log.error(errorMeta("spv.commitment.create", e, { partnerId: ctx.partnerId, spvId: spv.id }));
        res.status(500).json({ error: "COMMITMENT_FAILED" });
      }
    },
  );

  // v25.23 NH-F fix — PATCH commitments matches POST gate (managing_partner).
  /* 4. PATCH /:id/commitments/:commitmentId */
  app.patch(
    "/api/partner/me/spvs/:id/commitments/:commitmentId",
    requirePartnerAuth,
    assertSubRole("managing_partner"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      if (!gate(req, res)) return;
      const ctx = req.partnerContext!;
      const spv = loadOwnedSpvOr404(req, res);
      if (!spv) return;
      const parsed = commitmentTransitionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "INVALID_BODY", details: parsed.error.flatten() });
        return;
      }
      try {
        const row = engineTransitionCommitment({
          partnerId: ctx.partnerId,
          spvId: spv.id,
          commitmentId: String(req.params.commitmentId),
          status: parsed.data.status,
        });
        ssePublish(ctx.partnerId, "spv", {
          type: "spv.commitment.transitioned",
          spvId: spv.id,
          commitmentId: row.id,
          status: row.status,
        });
        res.json({ ok: true, commitment: row });
      } catch (e) {
        const msg = (e as Error).message || "";
        if (msg === "COMMITMENT_NOT_FOUND") {
          res.status(404).json({ error: "NOT_FOUND" });
          return;
        }
        log.error(errorMeta("spv.commitment.transition", e, { partnerId: ctx.partnerId, spvId: spv.id }));
        res.status(500).json({ error: "TRANSITION_FAILED" });
      }
    },
  );

  /* ---------- CAPITAL CALLS ---------- */
  /* 5. GET /:id/capital-calls */
  app.get("/api/partner/me/spvs/:id/capital-calls", requirePartnerAuth, (req: Request, res: Response) => {
    if (!gate(req, res)) return;
    const spv = loadOwnedSpvOr404(req, res);
    if (!spv) return;
    res.json({ capitalCalls: engineListCapitalCalls(spv.id) });
  });

  // v25.23 NC-A + NH-F — managing_partner gate.
  /* 6. POST /:id/capital-calls */
  app.post(
    "/api/partner/me/spvs/:id/capital-calls",
    requirePartnerAuth,
    assertSubRole("managing_partner"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      if (!gate(req, res)) return;
      const ctx = req.partnerContext!;
      const spv = loadOwnedSpvOr404(req, res);
      if (!spv) return;
      const parsed = capitalCallSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "INVALID_BODY", details: parsed.error.flatten() });
        return;
      }
      try {
        const row = engineRecordCapitalCall({
          partnerId: ctx.partnerId,
          spvId: spv.id,
          amountMinor: parsed.data.amount_minor,
          calledAt: parsed.data.called_at,
          dueAt: parsed.data.due_at ?? null,
        });
        ssePublish(ctx.partnerId, "spv", {
          type: "spv.capital_call.recorded",
          spvId: spv.id,
          sequenceNo: row.sequenceNo,
        });
        res.status(201).json({ ok: true, capitalCall: row });
      } catch (e) {
        log.error(errorMeta("spv.capital_call.create", e, { partnerId: ctx.partnerId, spvId: spv.id }));
        res.status(500).json({ error: "CAPITAL_CALL_FAILED" });
      }
    },
  );

  /* ---------- DISTRIBUTIONS ---------- */
  /* 7. GET /:id/distributions */
  app.get("/api/partner/me/spvs/:id/distributions", requirePartnerAuth, (req: Request, res: Response) => {
    if (!gate(req, res)) return;
    const spv = loadOwnedSpvOr404(req, res);
    if (!spv) return;
    res.json({ distributions: engineListLegacyDistributions(spv.id) });
  });

  // v25.23 NC-A + NH-F — managing_partner gate.
  /* 8. POST /:id/distributions */
  app.post(
    "/api/partner/me/spvs/:id/distributions",
    requirePartnerAuth,
    assertSubRole("managing_partner"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      // WAVE 2B / BLOCKER 1 — fail closed BEFORE parsing or writing. See the
      // `legacyDistributionLedgerClosed` block above for the split-ledger
      // rationale. Everything below this line is retained, unreachable, and
      // returns intact when SC-5 repoints the route.
      if (legacyDistributionLedgerClosed(res)) return;
      if (!gate(req, res)) return;
      const ctx = req.partnerContext!;
      const spv = loadOwnedSpvOr404(req, res);
      if (!spv) return;
      const parsed = distributionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "INVALID_BODY", details: parsed.error.flatten() });
        return;
      }
      try {
        const row = engineRecordDistribution({
          partnerId: ctx.partnerId,
          spvId: spv.id,
          distributionType: parsed.data.distribution_type,
          totalMinor: parsed.data.total_minor,
          distributedAt: parsed.data.distributed_at,
        });
        ssePublish(ctx.partnerId, "spv", { type: "spv.distribution.recorded", spvId: spv.id, distributionId: row.id });
        res.status(201).json({ ok: true, distribution: row });
      } catch (e) {
        const msg = (e as Error).message || "";
        if (msg === "INVARIANT_DISTRIBUTION_EXCEEDS_COMMITMENTS") {
          res.status(422).json({
            error: "INVARIANT_DISTRIBUTION_EXCEEDS_COMMITMENTS",
            message:
              "committed_minor must be >= distributed_minor + called_minor (CP-031).",
          });
          return;
        }
        log.error(errorMeta("spv.distribution.create", e, { partnerId: ctx.partnerId, spvId: spv.id }));
        res.status(500).json({ error: "DISTRIBUTION_FAILED" });
      }
    },
  );

  /* ---------- DB-BACKED POSITIONS (non-conflicting path) ----------
   * Legacy /api/partner/me/spvs/:id/positions is owned by partnerRoutes.ts.
   * The DB-backed variant is at /db-positions to avoid collision.
   */
  /* 9. GET /:id/db-positions */
  app.get("/api/partner/me/spvs/:id/db-positions", requirePartnerAuth, (req: Request, res: Response) => {
    if (!gate(req, res)) return;
    const spv = loadOwnedSpvOr404(req, res);
    if (!spv) return;
    res.json({ positions: engineListLegacyPositions(spv.id) });
  });

  // v25.14 NH3 — managing_partner gate.
  /* 10. POST /:id/db-positions */
  app.post(
    "/api/partner/me/spvs/:id/db-positions",
    requirePartnerAuth,
    assertSubRole("managing_partner"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      if (!gate(req, res)) return;
      const ctx = req.partnerContext!;
      const spv = loadOwnedSpvOr404(req, res);
      if (!spv) return;
      const parsed = positionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "INVALID_BODY", details: parsed.error.flatten() });
        return;
      }
      try {
        const row = engineRecordLegacyPosition({
          partnerId: ctx.partnerId,
          spvId: spv.id,
          securityId: parsed.data.security_id,
          shares: parsed.data.shares,
          basisMinor: parsed.data.basis_minor,
          acquiredAt: parsed.data.acquired_at ?? null,
        });
        ssePublish(ctx.partnerId, "spv", { type: "spv.position.recorded", spvId: spv.id, positionId: row.id });
        res.status(201).json({ ok: true, position: row });
      } catch (e) {
        log.error(errorMeta("spv.position.create", e, { partnerId: ctx.partnerId, spvId: spv.id }));
        res.status(500).json({ error: "POSITION_FAILED" });
      }
    },
  );
}
