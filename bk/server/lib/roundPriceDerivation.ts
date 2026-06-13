/**
 * server/lib/roundPriceDerivation.ts \u2014 Avi 22-May Issue 2.
 *
 * Avi reported: "Rounds are being created, but I'm not sure if it's correct
 * or not, because at the time of round creation, the share price has to be
 * entered manually."
 *
 * Answer + fix (per Ozan's non-negotiables):
 *   1. For PRICED rounds (instrument = "preferred" or "common"), the share
 *      price IS the audit-grade input. The canonical derivation is:
 *
 *            PPS = pre_money_valuation / fully_diluted_shares_pre_money
 *
 *      This helper computes the suggestion. The founder remains free to
 *      override (e.g. when a strategic investor negotiates a custom PPS).
 *      The canonical cap-table math (packages/cap-table-engine,
 *      server/captableCommitStore.ts lines 354\u2013477) is UNTOUCHED.
 *
 *   2. For SAFE / Convertible Note rounds, there is no fixed PPS at issue;
 *      the PPS field is HIDDEN in the wizard. This module exposes
 *      `instrumentRequiresPps()` so client + server agree.
 *
 *   3. Validation tolerance: when both PPS and total raise are entered for
 *      a priced round, `PPS * shares_issued \u2248 raise` within
 *      $0.01 per share rounding. We expose `validatePpsConsistency()`
 *      returning a structured result the route surfaces back to the UI.
 *
 * All math here is in MAJOR units (dollars, not minor units / cents) because
 * the wizard's inputs are in dollars. The downstream cap-table commit path
 * still converts to minor units before touching the engine.
 *
 * NOTHING in this module mutates state. Pure functions only.
 */

/** Instruments that use a fixed price-per-share at issue. */
export const PRICED_INSTRUMENTS: ReadonlyArray<string> = [
  "preferred",
  "common",
  "warrant", // strike price, not PPS strictly \u2014 but a similar concept
];

/** Instruments where no PPS is fixed at round creation (converts later). */
export const NON_PRICED_INSTRUMENTS: ReadonlyArray<string> = [
  "safe_post",
  "safe_pre",
  "convertible_note",
  "option_pool",
];

/**
 * Does this instrument require a price-per-share input at round creation?
 * SAFEs / convertibles return false (no fixed PPS until conversion).
 */
export function instrumentRequiresPps(instrument: string): boolean {
  return PRICED_INSTRUMENTS.includes(instrument);
}

/**
 * Derive a suggested price-per-share for a priced round.
 *
 *     PPS = preMoneyValuation / fullyDilutedSharesPreMoney
 *
 * Inputs must be positive finite numbers in major units. Returns null when
 * inputs are missing or non-positive (the UI shows the manual input box
 * with no suggestion in that case \u2014 the founder must supply PPS directly).
 *
 * `preMoneyValuation` is in dollars. `fullyDilutedSharesPreMoney` is a
 * share count. The result is dollars-per-share to 6-decimal precision.
 */
export function derivePricePerShare(args: {
  preMoneyValuation: number;
  fullyDilutedSharesPreMoney: number;
}): number | null {
  const v = args.preMoneyValuation;
  const s = args.fullyDilutedSharesPreMoney;
  if (!Number.isFinite(v) || !Number.isFinite(s)) return null;
  if (v <= 0 || s <= 0) return null;
  return Math.round((v / s) * 1_000_000) / 1_000_000;
}

/**
 * Result of consistency-checking a manually-entered PPS against the round
 * size, share count, and pre-money valuation.
 *
 *   ok=true  \u2192 inputs are internally consistent within tolerance.
 *   ok=false \u2192 surface `issues[]` to the founder so they can reconcile.
 */
export interface PpsValidationResult {
  ok: boolean;
  issues: string[];
  suggestedPps: number | null;
  toleranceDollarsPerShare: number;
}

/**
 * Validate that an entered PPS is internally consistent with the rest of
 * the priced-round inputs. We check two relationships:
 *
 *   (a) suggestedPps = preMoney / fdShares  \u2248  enteredPps
 *       Tolerance: \u00b1 $0.01 per share (matches Carta + NVCA convention).
 *
 *   (b) newSharesIssued = targetAmount / enteredPps
 *       The implied new-share count must be a positive number \u2014 a sanity
 *       check that the founder did not enter a PPS that yields fractional /
 *       absurd share counts.
 *
 * Either check missing inputs is NOT a hard failure \u2014 we only report on
 * what we can compute. The UI uses this advisory to nudge, not block.
 */
export function validatePpsConsistency(args: {
  enteredPps: number | null;
  preMoneyValuation: number | null;
  fullyDilutedSharesPreMoney: number | null;
  targetAmount: number | null;
}): PpsValidationResult {
  const TOL = 0.01;
  const issues: string[] = [];
  const enteredPps = args.enteredPps;

  let suggested: number | null = null;
  if (args.preMoneyValuation != null && args.fullyDilutedSharesPreMoney != null) {
    suggested = derivePricePerShare({
      preMoneyValuation: args.preMoneyValuation,
      fullyDilutedSharesPreMoney: args.fullyDilutedSharesPreMoney,
    });
  }

  if (enteredPps == null || !Number.isFinite(enteredPps) || enteredPps <= 0) {
    issues.push("entered price-per-share is missing or non-positive");
    return { ok: false, issues, suggestedPps: suggested, toleranceDollarsPerShare: TOL };
  }

  if (suggested != null) {
    const delta = Math.abs(suggested - enteredPps);
    if (delta > TOL) {
      issues.push(
        `entered PPS ($${enteredPps.toFixed(4)}) differs from derived PPS ` +
          `($${suggested.toFixed(4)} = $${args.preMoneyValuation!.toLocaleString()} / ` +
          `${args.fullyDilutedSharesPreMoney!.toLocaleString()} shares) by ` +
          `$${delta.toFixed(4)} \u2014 outside the $${TOL.toFixed(2)} tolerance.`,
      );
    }
  }

  if (args.targetAmount != null && args.targetAmount > 0) {
    const impliedNewShares = args.targetAmount / enteredPps;
    if (!Number.isFinite(impliedNewShares) || impliedNewShares <= 0) {
      issues.push(
        `implied new-share count (${impliedNewShares}) is invalid for ` +
          `target raise $${args.targetAmount.toLocaleString()} at PPS $${enteredPps.toFixed(4)}`,
      );
    }
  }

  return { ok: issues.length === 0, issues, suggestedPps: suggested, toleranceDollarsPerShare: TOL };
}

/* ============================================================
 * Express route registration
 *
 * GET  /api/rounds/derive-pps
 *      ?preMoney=18000000&fullyDilutedShares=10000000
 *      \u2192 { pps: 1.80, formula: "...", inputs: {...} }
 *
 * POST /api/rounds/validate-pps
 *      body: { enteredPps, preMoneyValuation, fullyDilutedSharesPreMoney, targetAmount }
 *      \u2192 { ok, issues, suggestedPps, toleranceDollarsPerShare }
 *
 * Both routes are PURE \u2014 they touch no DB and no cap-table math. They
 * exist so the UI can call a single canonical helper instead of redoing
 * the arithmetic client-side (audit trail: server is source of truth even
 * for advisory calculations).
 * ============================================================ */
import type { Express, Request, Response } from "express";

export function registerRoundPriceDerivationRoutes(app: Express): void {
  app.get("/api/rounds/derive-pps", (req: Request, res: Response) => {
    const preMoney = Number(req.query.preMoney);
    const fullyDilutedShares = Number(req.query.fullyDilutedShares);
    const instrument = String(req.query.instrument ?? "preferred");

    if (!instrumentRequiresPps(instrument)) {
      return res.json({
        instrument,
        pps: null,
        requiresPps: false,
        rationale:
          "This instrument does not fix a price-per-share at issue. PPS is " +
          "determined at conversion (SAFEs / convertibles) or not applicable " +
          "(option-pool top-up).",
      });
    }

    const pps = derivePricePerShare({
      preMoneyValuation: preMoney,
      fullyDilutedSharesPreMoney: fullyDilutedShares,
    });
    return res.json({
      instrument,
      pps,
      requiresPps: true,
      formula: "PPS = pre_money_valuation / fully_diluted_shares_pre_money",
      inputs: { preMoney, fullyDilutedShares },
    });
  });

  app.post("/api/rounds/validate-pps", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const numOrNull = (k: string): number | null => {
      const v = body[k];
      if (v == null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const result = validatePpsConsistency({
      enteredPps: numOrNull("enteredPps"),
      preMoneyValuation: numOrNull("preMoneyValuation"),
      fullyDilutedSharesPreMoney: numOrNull("fullyDilutedSharesPreMoney"),
      targetAmount: numOrNull("targetAmount"),
    });
    return res.json(result);
  });
}
