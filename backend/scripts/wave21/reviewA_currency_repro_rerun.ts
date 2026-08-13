/**
 * WAVE 21 — Review A's own `currency_repro.js`, re-run against the FIXED code
 * paths instead of against hand-written `Intl` calls.
 *
 * The reviewer's script demonstrated the arithmetic in the abstract. This
 * version drives the same two fixtures through the actual production helpers
 * the three sinks now use, so the output is evidence about this build.
 *
 * Run: npx tsx scripts/wave21/reviewA_currency_repro_rerun.ts
 */
import {
  addToBucket,
  bucketsToArray,
  singleCurrencyScalar,
  assertPersistableScalar,
  type CurrencyBuckets,
} from "../../server/lib/currencyScalar";
import { formatMinor } from "../../server/lib/currency";

// --- reviewer fixture 1: JPY 12345 minor units.
const jpyMinor = 12345;
console.log("JPY hardcoded /100 (the DEFECT):", jpyMinor / 100);
console.log("JPY via formatMinor (the FIX):  ", formatMinor(jpyMinor, "JPY"));

// --- reviewer fixture 2: 100 USD-cents + 100 JPY.
const b: CurrencyBuckets = {};
addToBucket(b, "USD", 100);
addToBucket(b, "JPY", 100);

const scalar = singleCurrencyScalar(b);
console.log("single scalar for the mixed set:", JSON.stringify(scalar));
console.log(
  "actual independent values:",
  bucketsToArray(b).map((x) => `${x.currency}=${formatMinor(x.minor, x.currency)}`).join("  "),
);

// --- durable write is refused, not written wrong.
try {
  assertPersistableScalar(scalar, "reviewA repro: monthly snapshot");
  console.log("PERSIST: allowed  <-- WRONG, the fix is not in place");
  process.exit(1);
} catch (e) {
  console.log("PERSIST: refused —", (e as Error).message.split("—")[1]?.trim());
}

// Decisive: the old output was `mixed minor sum mislabeled USD: $2.00`.
const fabricated = formatMinor(200, "USD");
const emitted = scalar.available ? formatMinor(scalar.minor, scalar.currency) : "(unavailable)";
console.log(`old output "${fabricated}" vs new output "${emitted}"`);
process.exit(emitted === fabricated ? 1 : 0);
