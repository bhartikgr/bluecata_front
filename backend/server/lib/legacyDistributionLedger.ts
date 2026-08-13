/**
 * server/lib/legacyDistributionLedger.ts — WAVE 2B / BLOCKER 1
 *
 * Server-side fail-closed for the LEGACY PLURAL distribution ledger.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * WAVE 2 (SC-2) disabled the "Record Distribution" panel on
 * `client/src/pages/partner/PartnerSpvDetail.tsx:323-359`. Adversarial review B
 * (`build_log/WAVES_012_REVIEW_B.md`, BLOCKER 1) demonstrated that the panel was
 * UI-inert but NOT capability-inert: the same authenticated managing partner can
 * issue `fetch()` from DevTools, replay a captured request, or call the route
 * directly, and still persist a financial record.
 *
 * THE SPLIT LEDGER
 * ----------------
 *   POST /api/partner/me/spvs/:id/distributions   (PLURAL, legacy)
 *     -> engineRecordDistribution -> spvFundStore.recordDistribution
 *     -> INSERT INTO spv_distributions        (server/spvFundStore.ts:902)
 *
 *   POST /api/partner/me/spv/:spvId/distributions (SINGULAR, canonical)
 *     -> spvEngineStore.recordDistribution
 *     -> INSERT INTO spv_distribution         (server/spvEngineStore.ts:1538)
 *
 * One letter apart, two tables. The canonical singular read CANNOT see a plural
 * write, so every legacy write is a silent data-integrity loss. The owner ruled
 * the singular table canonical.
 *
 * CONTRACT
 * --------
 * `legacyDistributionLedgerClosed(res)` writes 409
 * `LEGACY_DISTRIBUTION_LEDGER_DISABLED` and returns `true`. Call it as the FIRST
 * statement of the route handler — before the feature-flag gate, before
 * `safeParse`, before the SPV load, before any store call and before any SSE
 * publish. The auth / sub-role / signed-agreement middleware chain still runs
 * ahead of the handler, so this closure leaks nothing new: an anonymous caller
 * still gets 401 and a viewer still gets 403.
 *
 * It lives in `server/lib/` rather than in either route module so that BOTH
 * registrars (the live `server/spvLegacyAdapters.ts` and the retired
 * `server/spvFundStore.ts#registerSpvFundRoutes`) can share it without creating
 * an import cycle through `spvEngineStore`.
 *
 * REVERSAL (SC-5)
 * ---------------
 * Delete the two `if (legacyDistributionLedgerClosed(res)) return;` call sites
 * once the route is repointed onto the canonical singular ledger. Nothing else
 * in either handler was changed; the original body is retained verbatim below
 * the guard.
 *
 * PROOF: server/__tests__/wave2b_blocker1_legacy_distribution_closed.test.ts
 * asserts a valid managing-partner POST returns 409 and writes ZERO rows to
 * `spv_distributions`.
 */
import type { Response } from "express";

export const LEGACY_DISTRIBUTION_LEDGER_DISABLED = "LEGACY_DISTRIBUTION_LEDGER_DISABLED";

export const LEGACY_DISTRIBUTION_LEDGER_MESSAGE =
  "This endpoint wrote the legacy plural ledger (spv_distributions), which canonical " +
  "SPV reporting cannot read. It is closed. Record distributions through the canonical " +
  "engine: POST /api/partner/me/spv/:spvId/distributions.";

/**
 * Fail the legacy plural-ledger distribution write closed.
 *
 * Always returns `true` so the call site reads
 * `if (legacyDistributionLedgerClosed(res)) return;` — a shape that cannot be
 * accidentally negated into an open door.
 */
export function legacyDistributionLedgerClosed(res: Response): boolean {
  res.status(409).json({
    error: LEGACY_DISTRIBUTION_LEDGER_DISABLED,
    message: LEGACY_DISTRIBUTION_LEDGER_MESSAGE,
  });
  return true;
}
