/**
 * Full-ratchet anti-dilution.
 *
 * On a down-round at New Issue Price (NIP) below Original Issue Price (OIP),
 * the conversion price of the protected preferred is reset to NIP.
 *
 * Effect on share count:
 *   newConversionRatio = OIP / NIP
 *   newPreferredShares = originalPreferredShares × newConversionRatio
 *
 * Reference: NVCA Model Charter §4.4(d)(i) (full-ratchet);
 *            Pulley anti-dilution guide.
 */
import { D } from "../primitives/bigDecimal.js";
import { decimalToShares, type Shares } from "../primitives/shareCount.js";
import { hashFormulaDef } from "../primitives/hash.js";
import type { TraceStep, Region } from "../types.js";

export type FullRatchetInput = {
  originalIssuePrice: string;     // OIP
  newIssuePrice: string;          // NIP at down round
  protectedShares: Shares;        // current preferred shares of the protected class
  formulaId: string;
  formulaVersion: string;
  region: Region;
  formulaDef: Record<string, unknown>;
};

export type FullRatchetOutput = {
  newConversionPrice: string;
  newShares: Shares;
  delta: Shares;
  trace: TraceStep;
};

export function applyFullRatchet(input: FullRatchetInput): FullRatchetOutput {
  const oip = D(input.originalIssuePrice);
  const nip = D(input.newIssuePrice);
  if (nip.gte(oip)) {
    return {
      newConversionPrice: oip.toFixed(),
      newShares: input.protectedShares,
      delta: 0n,
      trace: {
        formulaId: input.formulaId,
        formulaVersion: input.formulaVersion,
        region: input.region,
        inputs: {
          originalIssuePrice: oip.toFixed(),
          newIssuePrice: nip.toFixed(),
          protectedShares: input.protectedShares.toString(),
        },
        outputs: { newConversionPrice: oip.toFixed(), newShares: input.protectedShares.toString(), delta: "0" },
        defHash: hashFormulaDef(input.formulaDef),
        note: "No down-round; full-ratchet not triggered",
      },
    };
  }

  const ratio = oip.div(nip);
  const protectedDec = D(input.protectedShares.toString());
  const newSharesDec = protectedDec.mul(ratio);
  let newShares = decimalToShares(newSharesDec, "floor");
  if (newShares < input.protectedShares) newShares = input.protectedShares;
  const delta = newShares - input.protectedShares;

  return {
    newConversionPrice: nip.toFixed(),
    newShares,
    delta,
    trace: {
      formulaId: input.formulaId,
      formulaVersion: input.formulaVersion,
      region: input.region,
      inputs: {
        originalIssuePrice: oip.toFixed(),
        newIssuePrice: nip.toFixed(),
        protectedShares: input.protectedShares.toString(),
      },
      outputs: {
        newConversionPrice: nip.toFixed(),
        newShares: newShares.toString(),
        delta: delta.toString(),
      },
      defHash: hashFormulaDef(input.formulaDef),
      note: "Full-ratchet conversion-price reset to NIP",
    },
  };
}
