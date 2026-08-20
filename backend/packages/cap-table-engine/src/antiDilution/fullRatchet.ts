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

  /* ═══════════════════════════════════════════════════════════════════════
     WAVE 81 · ITEM 3 (D5) — ONE FUSED DIVISION, NOT DIVIDE-THEN-MULTIPLY.
     ═══════════════════════════════════════════════════════════════════════
     WHAT WAS WRONG. This was `oip.div(nip)` into a `ratio`, then
     `protectedDec.mul(ratio)`. The intermediate ratio is rounded to the
     configured significant digits FIRST, so an exact-integer entitlement came
     back as `…9999999999` and `decimalToShares(…, "floor")` then floored it one
     share LOW. Measured at the engine's declared 38 / ROUND_HALF_EVEN:

         protected 7,777,777, OIP 1.00, NIP 0.875 (exact answer 8,888,888)
           divide-then-multiply -> 8888887.9999999999999999999999999999997 -> 8,888,887
           one fused division   -> 8888888                                 -> 8,888,888

     Over an exact-integer sweep of 960 OIP/NIP/share combinations the split
     form loses a share in 77 of them; the fused form loses none.
     `newConversionPrice` is untouched — it is NIP, not a quotient.

     WHY IT SHIPS WITH ITEM 1 AND NOT AFTER IT. Item 1 pins this engine to
     38 / ROUND_HALF_EVEN, which is the configuration in which this defect
     BITES; at the 40 / ROUND_HALF_UP production was accidentally running at, 70
     of the same 960 still lost a share. Fixing the configuration without fixing
     the arithmetic would make the loss deterministic instead of removing it. */
  const protectedDec = D(input.protectedShares.toString());
  const newSharesDec = protectedDec.mul(oip).div(nip);
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
