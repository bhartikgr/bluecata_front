/**
 * Broad-based Weighted-Average anti-dilution.
 *
 * NVCA / Carta formula:
 *   NCP = OCP × (A + B) / (A + C)
 * where:
 *   OCP = Original Conversion Price
 *   NCP = New Conversion Price
 *   A   = Outstanding shares (broad-based: common + preferred as-converted + options
 *         outstanding + warrants + reserved option pool)
 *   B   = (Money raised in dilutive issuance) / OCP   = "shares that would have been
 *         issued at OCP"
 *   C   = Shares actually issued in the dilutive issuance
 *
 * New share count of protected class:
 *   newShares = oldShares × (OCP / NCP)
 *
 * Reference:
 *   - NVCA Model Charter §4.4(d)(ii)(A) "Broad-Based Weighted Average"
 *   - https://nvca.org/model-legal-documents/
 *   - Carta blog: "How weighted-average anti-dilution works"
 *     https://carta.com/blog/anti-dilution-protection/
 */
import { D, Decimal } from "../primitives/bigDecimal.js";
import { decimalToShares, type Shares } from "../primitives/shareCount.js";
import { hashFormulaDef } from "../primitives/hash.js";
import type { TraceStep, Region } from "../types.js";

export type WeightedAverageInput = {
  originalConversionPrice: string;
  newIssuePrice: string;          // PPS of dilutive issuance
  moneyRaised: string;            // dollars raised
  outstandingBroadBased: bigint;  // A — broad-based outstanding (incl options + warrants + pool)
  sharesIssuedInRound: bigint;    // C
  protectedShares: Shares;        // current preferred shares of protected class
  formulaId: string;
  formulaVersion: string;
  region: Region;
  formulaDef: Record<string, unknown>;
};

export type WeightedAverageOutput = {
  newConversionPrice: string;
  newShares: Shares;
  delta: Shares;
  trace: TraceStep;
};

export function applyBroadBasedWeightedAverage(input: WeightedAverageInput): WeightedAverageOutput {
  const ocp = D(input.originalConversionPrice);
  const nip = D(input.newIssuePrice);
  if (nip.gte(ocp)) {
    return noChange(input, ocp);
  }

  const A = D(input.outstandingBroadBased.toString());
  const B = D(input.moneyRaised).div(ocp);
  const C = D(input.sharesIssuedInRound.toString());

  const numerator: Decimal = A.plus(B);
  const denominator: Decimal = A.plus(C);
  if (denominator.lte(0)) throw new Error("Anti-dilution: denominator A+C must be > 0");

  const ncp = ocp.mul(numerator).div(denominator);
  const protectedDec = D(input.protectedShares.toString());
  const newSharesDec = protectedDec.mul(ocp).div(ncp);
  // Floor to integer shares but never below the original count (rounding monotonicity guard).
  let newShares = decimalToShares(newSharesDec, "floor");
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
        A: A.toFixed(),
        B: B.toFixed(),
        C: C.toFixed(),
        protectedShares: input.protectedShares.toString(),
      },
      outputs: {
        NCP: ncp.toFixed(),
        newShares: newShares.toString(),
        delta: delta.toString(),
      },
      defHash: hashFormulaDef(input.formulaDef),
      note: "NCP = OCP × (A+B)/(A+C); newShares = old × OCP/NCP",
    },
  };
}

function noChange(input: WeightedAverageInput, ocp: Decimal): WeightedAverageOutput {
  return {
    newConversionPrice: ocp.toFixed(),
    newShares: input.protectedShares,
    delta: 0n,
    trace: {
      formulaId: input.formulaId,
      formulaVersion: input.formulaVersion,
      region: input.region,
      inputs: {
        OCP: ocp.toFixed(),
        NIP: D(input.newIssuePrice).toFixed(),
      },
      outputs: { NCP: ocp.toFixed(), newShares: input.protectedShares.toString(), delta: "0" },
      defHash: hashFormulaDef(input.formulaDef),
      note: "No down-round; weighted-average not triggered",
    },
  };
}
