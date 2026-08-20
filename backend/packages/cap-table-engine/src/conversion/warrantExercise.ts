/**
 * Warrant exercise — convert a warrant into common shares.
 *
 * Cash exercise:    sharesIssued = underlyingShares
 * Cashless exercise:sharesIssued = underlyingShares × (FMV − strike) / FMV
 *
 * If FMV ≤ strike under cashless, no shares issued (out-of-the-money).
 *
 * ── WAVE 71 · D12 — A CASHLESS EXERCISE WITH NO FMV REFUSES ───────────────────
 * THE DEFECT, measured. `if (input.cashless && input.fmvPerShare)` fell THROUGH
 * to the cash branch when a cashless exercise arrived with no fair market value,
 * and issued the FULL underlying: 200,000 shares on the documented fixture, where
 * the same exercise at an FMV of $2.00 over a $0.50 strike issues 150,000 and at
 * an FMV of $0.40 issues 0. There is no FMV at which the answer is 200,000. The
 * missing input was read as "not cashless", which is the one reading that gives
 * the holder the most shares and the company the most dilution.
 *
 * TWO IMPLEMENTATIONS, TWO BEHAVIOURS, AND THE ENGINE'S WAS THE DANGEROUS ONE.
 * `server/lib/warrantExercise.ts` already refuses this exact case by name —
 * `{ ok: false, error: "fmv_required_for_cashless" }` — and that is the reachable
 * path today. The engine leaf disagreed with it. R21: a rule that exists in two
 * places is a rule that will diverge; here it already had. The two now agree, and
 * the engine's refusal carries the same name so an operator reading either log
 * sees the same word.
 *
 * WHY A THROW AND NOT A ZERO. Zero shares is a real, correct answer for an
 * out-of-the-money cashless exercise (FMV ≤ strike, asserted in the tests). Using
 * zero for "we do not know the FMV" would make an unanswerable question
 * indistinguishable from an answered one. R6: absent is absent.
 *
 * AUTHORITY for the net-exercise formula itself is unchanged and is the standard
 * cashless/net-share settlement identity, `n × (FMV − K) / FMV`; it is arithmetic
 * on an FMV, and it has no value when the FMV is not supplied.
 */
import { D } from "../primitives/bigDecimal.js";
import { decimalToShares, type Shares } from "../primitives/shareCount.js";
import type { TraceStep, Region } from "../types.js";
import { hashFormulaDef } from "../primitives/hash.js";

export type WarrantExerciseInput = {
  underlyingShares: bigint;
  strikePrice: string;
  fmvPerShare?: string;
  cashless: boolean;
  formulaId: string;
  formulaVersion: string;
  region: Region;
  formulaDef: Record<string, unknown>;
};

export type WarrantExerciseOutput = {
  sharesIssued: Shares;
  trace: TraceStep;
};

/**
 * Thrown when a cashless exercise arrives with no fair market value. Carries the
 * SAME name the server implementation already used, so the two layers cannot be
 * read as describing different problems.
 */
export class CashlessExerciseFmvRequiredError extends Error {
  readonly code = "fmv_required_for_cashless" as const;
  readonly field = "fmvPerShare" as const;
  constructor(underlyingShares: bigint, strikePrice: string) {
    super(
      `A cashless (net) warrant exercise cannot be computed without a fair market value per share. ` +
      `The net-share formula is underlyingShares × (FMV − strike) ÷ FMV, and every term of it depends ` +
      `on the FMV: over a $${strikePrice} strike, an FMV of $2.00 issues 75% of the underlying and an ` +
      `FMV at or below the strike issues nothing at all. Capavate will not fall back to issuing the ` +
      `full ${underlyingShares.toString()} underlying shares, because that is the answer no FMV ` +
      `produces. Record the FMV (a 409A valuation or the round price), or exercise for cash.`,
    );
    this.name = "CashlessExerciseFmvRequiredError";
  }
}

/** `true` only for a value that can actually be used as a price. */
function usableFmv(v: string | undefined): v is string {
  return v !== undefined && v !== null && String(v).trim() !== "";
}

export function exerciseWarrant(input: WarrantExerciseInput): WarrantExerciseOutput {
  let sharesIssued: Shares;
  /* WAVE 71 · D12 — the refusal, BEFORE any branch can absorb the missing input. */
  if (input.cashless && !usableFmv(input.fmvPerShare)) {
    throw new CashlessExerciseFmvRequiredError(input.underlyingShares, input.strikePrice);
  }
  if (input.cashless && input.fmvPerShare) {
    const fmv = D(input.fmvPerShare);
    const strike = D(input.strikePrice);
    if (fmv.lte(strike)) {
      sharesIssued = 0n;
    } else {
      const ratio = fmv.minus(strike).div(fmv);
      const sharesDec = D(input.underlyingShares.toString()).mul(ratio);
      sharesIssued = decimalToShares(sharesDec);
    }
  } else {
    sharesIssued = input.underlyingShares;
  }

  const trace: TraceStep = {
    formulaId: input.formulaId,
    formulaVersion: input.formulaVersion,
    region: input.region,
    inputs: {
      underlyingShares: input.underlyingShares.toString(),
      strikePrice: input.strikePrice,
      fmvPerShare: input.fmvPerShare ?? "",
      cashless: String(input.cashless),
    },
    outputs: {
      sharesIssued: sharesIssued.toString(),
    },
    defHash: hashFormulaDef(input.formulaDef),
  };

  return { sharesIssued, trace };
}
