/* server/lib/legacySpvActivationFeeBasis.ts
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 163 · BLOCKER 2 · R137.2 / R134.1 — THE LEGACY OVERBILLING DOOR, CLOSED.
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT WENT WRONG, AND IT BILLED REAL MONEY. Wave 160 corrected the ENGINE
 * deployment-fee basis to `spv_subscription.status = 'committed'` only, because a
 * size-BANDED fee priced on an all-stages sum charged a partner 88,213 where the
 * confirmed-capital basis charges 11,137 — an 8× overcharge on non-binding
 * interest. A SECOND charge path survived that fix:
 *
 *   1. `spvEngineStore.subscribe` mirrors EVERY new subscription into the legacy
 *      `spv_commitments` table with legacy status `"signed"`
 *      (`spvFundStore.shadowCommitmentFromLegacyStrict:1417`, and
 *      `shadowCommitmentFromLegacy:1510`) — at `review` time, before anything is
 *      committed.
 *   2. `spvFundStore.addCommitment` counts `signed`/`funded` into the
 *      DENORMALISED mirror column `spvs.committed_minor` (`:834-840`).
 *   3. The legacy activation path banded the deployment fee directly on that
 *      column (`spvFundStore.ts:1294` before this wave), so a soft-circle
 *      inflated the band and overbilled the sourcing partner.
 *
 * R136.3 accepted this as "fenced, not fixed". R137.2 overrules that: *"W160-F1
 * must be FIXED or PROVEN UNREACHABLE before this batch ships. Not fenced, not
 * deferred. A partner being overbilled is not an open item; it is a defect."*
 * This module is the FIX. The path is reachable, so nothing is proved unreachable.
 *
 * ── WHY THE BASIS MOVED AND NOT THE MIRROR ───────────────────────────────────
 * Two repairs were available. Rewriting the mirror to write a non-counting legacy
 * status would change `spvs.committed_minor` itself — a column bound by the
 * CP-031 invariant `committed_minor >= distributed_minor + called_minor`
 * (`spvFundStore.ts:52`, enforced at `:1751`) and read by every legacy surface and
 * by the capital-call/distribution ladder. Moving it would relocate one money
 * defect into three. R134.1 rules on the FEE BASIS — *"the deployment-fee basis
 * must count CONFIRMED CAPITAL ONLY. A fee is money; money follows capital, never
 * interest"* — and the post-build review's own required correction is *"before
 * activation billing, derive the fee basis from the canonical committed-only
 * population"*. So the mirror column keeps its value and its meaning, and the
 * ONE place that turned it into money stops reading it.
 *
 * ── WHAT THIS PRESERVES ──────────────────────────────────────────────────────
 * • The TARGET-RAISE FALLBACK IS RETAINED (V2 §13.2 / R135.9). It is still the
 *   answer when there is no confirmed capital at all — e.g. a directly-funded SPV.
 * • A PURE-LEGACY VEHICLE IS BILLED EXACTLY AS BEFORE. A legacy `spv_commitments`
 *   row with no engine counterpart is real signed legacy capital; excluding it
 *   would silently UNDER-bill and would be the mirror-image defect. Only mirror
 *   rows — rows that duplicate an engine subscription — defer to the engine's
 *   stage, which is the authoritative one.
 * • THE CAP-CAPACITY BASIS IS UNTOUCHED (R133.1). Capacity is a different
 *   question from capital and is answered elsewhere.
 * • No `Number()`, `parseInt` or `parseFloat` on money anywhere in this file.
 */
import { SPV_COMMITTED_SUBSCRIPTION_STATUS } from "@shared/spvCommittedCapital";
import { log } from "./logger";

/** Legacy commitment statuses that `addCommitment` counts into the denormalised
 *  `spvs.committed_minor` column (`spvFundStore.ts:834`, `:864-865`, `:885`). */
export const LEGACY_COUNTED_COMMITMENT_STATUSES: readonly string[] = ["signed", "funded"];

export interface LegacyActivationFeeBasis {
  /** The size handed to the BANDED fee resolver. Never negative. */
  sizeMinor: number;
  /** Machine identifier for the basis actually used, persisted beside the charge
   *  so any future dispute can be answered without re-deriving it. */
  basis:
    | "confirmed_capital"
    | "confirmed_capital_with_legacy_signed"
    | "legacy_signed_only"
    | "target_raise_fallback"
    | "unavailable";
  /** Confirmed engine capital: `spv_subscription.status = 'committed'`. */
  confirmedCapitalMinor: number;
  /** Legacy signed/funded rows with NO engine mirror counterpart. */
  legacyOnlySignedMinor: number;
  /** What the OLD basis would have been — the inflated mirror column. Recorded so
   *  the size of the averted overcharge is visible in the log, not inferred. */
  legacyMirrorColumnMinor: number | null;
  /** Mirror rows excluded because their engine subscription is not committed. */
  excludedPreCommitmentRows: number;
  excludedPreCommitmentMinor: number;
}

/** Integer minor units or null. A non-integer is ABSENT, never coerced to 0. */
function integerMinorOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

/**
 * The confirmed-capital fee basis for a LEGACY SPV activation.
 *
 * Preference order, and each step states which population it used:
 *   1. Engine confirmed capital (`status = 'committed'`) PLUS legacy signed rows
 *      that do not mirror an engine subscription. Mirror rows whose engine
 *      subscription is at any pre-commitment stage are EXCLUDED — that exclusion
 *      is the whole defect being closed.
 *   2. `spvs.target_minor`, then the caller's own target, as the RETAINED
 *      fallback when there is no confirmed capital at all.
 *   3. `unavailable` with `sizeMinor: 0` when neither answers.
 *
 * `rawTx` is the same better-sqlite3 handle the caller's transaction runs on, so
 * these reads see the transaction's own writes.
 */
export function resolveLegacyActivationFeeBasis(
  rawTx: any,
  legacySpvId: string,
  callerTargetMinor: unknown,
): LegacyActivationFeeBasis {
  let confirmedCapitalMinor = 0;
  let legacyOnlySignedMinor = 0;
  let legacyMirrorColumnMinor: number | null = null;
  let excludedPreCommitmentRows = 0;
  let excludedPreCommitmentMinor = 0;

  /* The inflated column, read ONLY so the averted overcharge can be reported. It
   * never selects a band again. */
  try {
    const mirror = rawTx
      .prepare(`SELECT committed_minor FROM spvs WHERE id = ?`)
      .get(legacySpvId) as { committed_minor: number | null } | undefined;
    legacyMirrorColumnMinor = integerMinorOrNull(mirror?.committed_minor);
  } catch (err) {
    log.warn(`[legacy-spv-fee] mirror column read failed for ${legacySpvId}: ${String(err)}`);
  }

  /* 1a. Engine confirmed capital — the only population that is capital. */
  const engineRows = new Map<string, { status: string; minor: number | null }>();
  try {
    const rows = rawTx
      .prepare(`SELECT investor_id, status, commitment_minor FROM spv_subscription WHERE spv_id = ?`)
      .all(legacySpvId) as Array<{ investor_id: string; status: string; commitment_minor: number | null }>;
    for (const r of rows ?? []) {
      const minor = integerMinorOrNull(r?.commitment_minor);
      const status = String(r?.status ?? "").trim();
      engineRows.set(String(r?.investor_id ?? "").trim(), { status, minor });
      if (status === SPV_COMMITTED_SUBSCRIPTION_STATUS && minor !== null) confirmedCapitalMinor += minor;
    }
  } catch (err) {
    log.warn(`[legacy-spv-fee] engine subscription read failed for ${legacySpvId}: ${String(err)}`);
  }

  /* 1b. Legacy signed/funded rows. A row that MIRRORS an engine subscription
   *     defers to the engine stage: already counted above when committed,
   *     EXCLUDED when it is not. A row with no engine counterpart is genuine
   *     legacy capital and is counted, so a pure-legacy vehicle is billed
   *     exactly as it was before this wave. */
  try {
    const rows = rawTx
      .prepare(`SELECT lp_user_id, status, amount_minor FROM spv_commitments WHERE spv_id = ?`)
      .all(legacySpvId) as Array<{ lp_user_id: string; status: string; amount_minor: number | null }>;
    for (const r of rows ?? []) {
      if (!LEGACY_COUNTED_COMMITMENT_STATUSES.includes(String(r?.status ?? "").trim())) continue;
      const minor = integerMinorOrNull(r?.amount_minor);
      if (minor === null) continue;
      const engine = engineRows.get(String(r?.lp_user_id ?? "").trim());
      if (!engine) {
        legacyOnlySignedMinor += minor;
        continue;
      }
      if (engine.status !== SPV_COMMITTED_SUBSCRIPTION_STATUS) {
        excludedPreCommitmentRows += 1;
        excludedPreCommitmentMinor += minor;
      }
    }
  } catch (err) {
    log.warn(`[legacy-spv-fee] legacy commitment read failed for ${legacySpvId}: ${String(err)}`);
  }

  const total = confirmedCapitalMinor + legacyOnlySignedMinor;
  if (total > 0) {
    const basis =
      confirmedCapitalMinor > 0 && legacyOnlySignedMinor > 0
        ? "confirmed_capital_with_legacy_signed"
        : confirmedCapitalMinor > 0
          ? "confirmed_capital"
          : "legacy_signed_only";
    if (excludedPreCommitmentMinor > 0) {
      log.warn(
        `[legacy-spv-fee] ${legacySpvId}: excluded ${excludedPreCommitmentRows} pre-commitment mirror row(s) ` +
          `worth ${excludedPreCommitmentMinor} minor from the fee band. Mirror column read ` +
          `${String(legacyMirrorColumnMinor)}; confirmed basis is ${total}.`,
      );
    }
    return {
      sizeMinor: total,
      basis,
      confirmedCapitalMinor,
      legacyOnlySignedMinor,
      legacyMirrorColumnMinor,
      excludedPreCommitmentRows,
      excludedPreCommitmentMinor,
    };
  }

  /* 2. TARGET-RAISE FALLBACK — RETAINED (R135.9). */
  const shape = {
    confirmedCapitalMinor,
    legacyOnlySignedMinor,
    legacyMirrorColumnMinor,
    excludedPreCommitmentRows,
    excludedPreCommitmentMinor,
  };
  try {
    const row = rawTx
      .prepare(`SELECT target_minor FROM spvs WHERE id = ?`)
      .get(legacySpvId) as { target_minor: number | null } | undefined;
    const target = integerMinorOrNull(row?.target_minor);
    if (target !== null && target > 0) return { sizeMinor: target, basis: "target_raise_fallback", ...shape };
  } catch (err) {
    log.warn(`[legacy-spv-fee] target read failed for ${legacySpvId}: ${String(err)}`);
  }
  const callerTarget = integerMinorOrNull(callerTargetMinor);
  if (callerTarget !== null && callerTarget > 0) {
    return { sizeMinor: callerTarget, basis: "target_raise_fallback", ...shape };
  }
  return { sizeMinor: 0, basis: "unavailable", ...shape };
}
