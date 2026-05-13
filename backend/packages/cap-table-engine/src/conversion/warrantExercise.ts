/**
 * Warrant exercise — convert a warrant into common shares.
 *
 * Cash exercise:    sharesIssued = underlyingShares
 * Cashless exercise:sharesIssued = underlyingShares × (FMV − strike) / FMV
 *
 * If FMV ≤ strike under cashless, no shares issued (out-of-the-money).
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

export function exerciseWarrant(input: WarrantExerciseInput): WarrantExerciseOutput {
  let sharesIssued: Shares;
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
