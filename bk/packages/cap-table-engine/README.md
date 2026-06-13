# @capavate/cap-table-engine

Production-grade cap-table math engine.

- BigInt for share counts. `decimal.js` (38-digit) for prices/percentages. **No `number`** for any value that affects ownership.
- Six instruments: Common, Preferred, SAFE, Convertible Note, Warrant, Option.
- Conversions: SAFE → Preferred (post-money + pre-money + MFN), Note → Preferred (cap + discount + interest), Option/Warrant exercise (cash + cashless).
- Anti-dilution: Full-Ratchet, Broad-Based WA, Narrow-Based WA.
- Liquidation waterfall: 1×/2×/3× preferences, participating + cap, multi-class stacking.
- ESOP top-up: pre-money vs post-money.
- Three views: Basic / Fully Diluted / As Converted.
- Regional formula registry: US / CA / UK / SG with citations.
- Every result carries an audit `trace` array with formula id, version, region, inputs, outputs, and a SHA-256 of the formula definition.

## Test discipline

- Golden-master tests pinned to YC SAFE primer, NVCA model docs, Carta blog scenarios.
- Property-based tests with `fast-check`: ownership sums to 100%, MFN never reduces shares, anti-dilution monotonic.

```
npm test
```

## API

```ts
import { computeCapTable } from "@capavate/cap-table-engine";

const result = computeCapTable({
  companyId: "novapay",
  asOf: "2026-05-08",
  view: "fully_diluted",
  formulaRegion: "US",
  holders: [...],
  transactions: [...],
});
```
