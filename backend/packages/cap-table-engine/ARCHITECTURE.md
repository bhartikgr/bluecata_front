# @capavate/cap-table-engine — Architecture (draft 2026-05-08)

## Non-negotiables
- **Zero tolerance for math divergence.** Every formula has at least one golden-master test pinned to a published reference (YC SAFE v1.2 worked examples, Carta scenarios, NVCA model docs, Pulley public guides).
- **No floating-point arithmetic on share counts.** Use BigInt for issued share counts. Use `decimal.js` (38-digit precision) for ownership percentages and intermediate FX/conversion math.
- **Deterministic, side-effect-free.** Every formula is a pure function. Inputs in, outputs out. No I/O, no time-based logic except where explicitly passed in.
- **Every result is auditable.** Every output carries a `trace` field listing the formula, the regional variant, the inputs, the intermediate steps, the output, and a hash of the formula definition.
- **Regional variants are data, not code.** A formula is `{ id, name, region, version, definition }`. The same engine evaluates any variant.

## Module layout
```
packages/cap-table-engine/
  src/
    primitives/
      bigDecimal.ts           # decimal.js wrapper, 38-digit precision
      shareCount.ts           # BigInt wrapper, never lossy
      fx.ts                   # FX rate snapshots
      hash.ts                 # formula definition hashing for trace
    instruments/
      common.ts               # Common shares — issuance, transfer, split
      preferred.ts            # Preferred — liq pref, participation, anti-dilution
      safe.ts                 # YC SAFE — post-money + pre-money + MFN
      convertibleNote.ts      # Convertible Debt — discount, cap, interest, maturity
      warrant.ts              # Warrants — strike, expiry, cashless exercise
      optionGrant.ts          # ESOP / EMI / CSOP — vesting, exercise, ISO/NSO
    conversion/
      mfnOrdering.ts          # MFN resolution before priced conversion
      safeToPreferred.ts      # SAFE -> Preferred conversion at priced round
      noteToPreferred.ts      # Note -> Preferred conversion
      warrantExercise.ts      # Warrant -> Common (or Preferred)
      optionExercise.ts       # Option -> Common
    antiDilution/
      fullRatchet.ts
      broadBasedWeightedAverage.ts
      narrowBasedWeightedAverage.ts
    waterfall/
      liquidationWaterfall.ts # 1x/2x/3x, participating vs non-participating, with cap
    captable/
      compute.ts              # main entrypoint: { transactions[], asOf } -> CapTable
      proForma.ts             # multi-scenario projection
      views.ts                # Basic / Fully Diluted / As Converted
    formulas/
      registry.ts             # formula registry, regional variants, versioning
      us-default.ts           # US Delaware C-Corp formulas
      ca-default.ts           # Canada CCPC formulas
      uk-default.ts           # UK EMI / SEIS / EIS formulas
      sg-default.ts           # Singapore VCC formulas
    types.ts
    index.ts
  test/
    golden-master/
      yc-safe-v1-2-postmoney.test.ts        # exact YC published examples
      yc-safe-v1-2-premoney.test.ts
      nvca-priced-round.test.ts             # NVCA model doc walkthrough
      carta-anti-dilution.test.ts           # Carta published scenario
      multi-round-chain.test.ts             # SAFE -> Seed -> A -> B with anti-dilution
    property/
      shares-conserve.test.ts               # property: total shares conserved across transactions
      ownership-sums-100.test.ts            # property: ownership always sums to 100% within tolerance
      mfn-monotonic.test.ts                 # property: MFN conversion never produces fewer shares than direct
    fixtures/
      novapay-ai.json                       # the demo company cap table
  package.json
  tsconfig.json
  README.md
```

## Test discipline
- **Golden-master tests** = the engine's outputs must match published references to the cent / share. Source URLs cited in each test file.
- **Property-based tests** (fast-check) = invariants that hold across any input.
- **Fuzz tests** for FX edge cases, rounding boundaries, zero-balance edge cases.
- **CI gate**: any PR that touches engine code MUST run all golden-master and property tests; failure blocks merge.

## Public API
```ts
import { computeCapTable, applyTransaction, evaluateFormula } from '@capavate/cap-table-engine';

const result = computeCapTable({
  companyId: 'novapay-ai',
  transactions: [...],
  asOf: '2026-05-08',
  view: 'fully-diluted',
  formulaRegion: 'US',
});

// result.holders[].ownershipPercent is decimal.js — never a number
// result.trace contains the audit chain
```
