/**
 * Narrow-based Weighted-Average anti-dilution.
 *
 * Identical formula to broad-based, but A = only outstanding preferred (or only
 * outstanding common + preferred), excluding options, warrants, and reserved pool.
 *
 *   NCP = OCP × (A + B) / (A + C)
 *
 * Reference: NVCA Model Charter §4.4(d)(ii)(B) variant.
 */
import { D, Decimal } from "../primitives/bigDecimal.js";
import { decimalToShares, type Shares } from "../primitives/shareCount.js";
import { hashFormulaDef } from "../primitives/hash.js";
import type { TraceStep, Region } from "../types.js";

export type NarrowBasedInput = {
  originalConversionPrice: string;
  newIssuePrice: string;
  moneyRaised: string;
  outstandingNarrowBased: bigint; // A — narrow base
  sharesIssuedInRound: bigint;
  protectedShares: bigint;
  formulaId: string;
  formulaVersion: string;
  region: Region;
  formulaDef: Record<string, unknown>;
};

export function applyNarrowBasedWeightedAverage(input: NarrowBasedInput) {
  const ocp = D(input.originalConversionPrice);
  const nip = D(input.newIssuePrice);
  if (nip.gte(ocp)) {
    return {
      newConversionPrice: ocp.toFixed(),
      newShares: input.protectedShares,
      delta: 0n,
      trace: {
        formulaId: input.formulaId,
        formulaVersion: input.formulaVersion,
        region: input.region,
        inputs: { OCP: ocp.toFixed(), NIP: nip.toFixed() },
        outputs: { NCP: ocp.toFixed(), delta: "0" },
        defHash: hashFormulaDef(input.formulaDef),
        note: "No down round",
      } satisfies TraceStep,
    };
  }
  const A = D(input.outstandingNarrowBased.toString());
  const B: Decimal = D(input.moneyRaised).div(ocp);
  const C = D(input.sharesIssuedInRound.toString());
  const ncp = ocp.mul(A.plus(B)).div(A.plus(C));
  let newShares = decimalToShares(D(input.protectedShares.toString()).mul(ocp).div(ncp), "floor");
  if (newShares < input.protectedShares) newShares = input.protectedShares;
  const delta = newShares - input.protectedShares;

  return {
    newConversionPrice: ncp.toFixed(),
    newShares,
    delta,
    trace: {
      formulaId: input.formulaId,
      formulaVersion: input.formulaVersion,
      region: input.region,
      inputs: {
        OCP: ocp.toFixed(),
        NIP: nip.toFixed(),
        A_narrow: A.toFixed(),
        B: B.toFixed(),
        C: C.toFixed(),
        protectedShares: input.protectedShares.toString(),
      },
      outputs: { NCP: ncp.toFixed(), newShares: newShares.toString(), delta: delta.toString() },
      defHash: hashFormulaDef(input.formulaDef),
      note: "Narrow-based: A excludes options + reserved pool",
    } satisfies TraceStep,
  };
}
