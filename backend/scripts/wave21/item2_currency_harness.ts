/**
 * WAVE 21 · ITEM 2 falsification harness — no cross-currency summation.
 *
 * Run:  npx tsx scripts/wave21/item2_currency_harness.ts
 * Exits non-zero on any failed assertion.
 *
 * Every money assertion below includes a JPY fixture (ISO-4217 exponent 0) and
 * a three-exponent fixture (KWD, exponent 3), because the whole class of bug
 * Review A found survives any all-USD test suite.
 *
 * The three production sinks are exercised through the *shared* contract
 * (`server/lib/currencyScalar.ts`) plus direct structural assertions on the
 * route/store source, because the three call sites require a full Express +
 * SQLite fixture that this wave is not permitted to build against the sacred
 * `connection.ts`. Structural assertions are byte-level (anchor must occur
 * exactly once), so a revert cannot slip past them.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  addToBucket,
  bucketsToArray,
  scaleBuckets,
  scaleScalar,
  singleCurrencyScalar,
  assertPersistableScalar,
  type CurrencyBuckets,
} from "../../server/lib/currencyScalar";
import { formatMinor, currencyExponent } from "../../server/lib/currency";

const ROOT = join(import.meta.dirname, "..", "..");
let failed = 0;
function check(name: string, cond: boolean, detail: string) {
  if (cond) console.log(`PASS  ${name}  ${detail}`);
  else { failed += 1; console.log(`FAIL  ${name}  ${detail}`); }
}
function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}
/**
 * CODE ONLY. The WAVE 21 comments deliberately QUOTE the defective
 * expressions they replaced ("WAS: `pendingMinor += amt`"), so a raw text
 * search would find the defect in its own obituary and report a false
 * failure — or, worse, a future revert could hide inside a comment. Strip
 * block and line comments before asserting.
 */
function code(rel: string): string {
  return src(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}
/** Anchor must occur EXACTLY ONCE — a check that matches nothing is vacuous. */
function anchorOnce(name: string, rel: string, needle: string) {
  const n = code(rel).split(needle).length - 1;
  check(name, n === 1, `occurrences=${n} in ${rel} (code, comments stripped)`);
}
function absent(name: string, rel: string, needle: string) {
  const n = code(rel).split(needle).length - 1;
  check(name, n === 0, `occurrences=${n} in ${rel} (code, must be 0)`);
}

/* ============================================================ A. exponents */
check("A:JPY-exponent-0", currencyExponent("JPY") === 0, `exp=${currencyExponent("JPY")}`);
check("A:KWD-exponent-3", currencyExponent("KWD") === 3, `exp=${currencyExponent("KWD")}`);
check("A:USD-exponent-2", currencyExponent("USD") === 2, `exp=${currencyExponent("USD")}`);
check(
  "A:JPY-12345-not-123.45",
  !formatMinor(12345, "JPY").includes("123.45") && formatMinor(12345, "JPY").includes("12,345"),
  formatMinor(12345, "JPY"),
);
check("A:KWD-12345-is-12.345", formatMinor(12345, "KWD").includes("12.345"), formatMinor(12345, "KWD"));

/* ================================================ B. the shared contract */
// The reviewer's exact fixture: 100 USD-cents + 100 JPY.
const mixed: CurrencyBuckets = {};
addToBucket(mixed, "USD", 100);
addToBucket(mixed, "JPY", 100);
addToBucket(mixed, "KWD", 12345);

const s = singleCurrencyScalar(mixed);
check("B:mixed-not-available", s.available === false, JSON.stringify(s));
check(
  "B:mixed-reason-is-fx",
  !s.available && s.reason === "needs_fx_conversion",
  !s.available ? s.reason : "available!",
);
check(
  "B:mixed-currency-is-null-not-USD",
  !s.available && s.currency === null,
  JSON.stringify(s),
);
check("B:mixed-minor-is-null-not-200", !s.available && s.minor === null, JSON.stringify(s));
check(
  "B:mixed-lists-all-currencies",
  !s.available && s.currencies.join(",") === "JPY,KWD,USD",
  !s.available ? s.currencies.join(",") : "",
);
// No total anywhere equals the naive cross-currency sum.
const naive = 100 + 100 + 12345;
check(
  "B:no-field-equals-naive-sum",
  !JSON.stringify(s).includes(String(naive)),
  `naiveSum=${naive} payload=${JSON.stringify(s)}`,
);

// Single currency still collapses to a real number — the fix must not blind us.
const oneJpy: CurrencyBuckets = {};
addToBucket(oneJpy, "JPY", 12345);
const s1 = singleCurrencyScalar(oneJpy);
check(
  "B:single-JPY-available",
  s1.available && s1.currency === "JPY" && s1.minor === 12345,
  JSON.stringify(s1),
);

// Derived figures inherit unavailability (this is Review A's line 178).
const commission = scaleScalar(s, 0.05);
check("B:commission-from-mixed-unavailable", commission.available === false, JSON.stringify(commission));
const commissionOne = scaleScalar(s1, 0.05);
check(
  "B:commission-from-single-JPY-real",
  commissionOne.available && commissionOne.currency === "JPY" && commissionOne.minor === 617,
  JSON.stringify(commissionOne),
);

// Per-currency commission is applied inside each currency independently.
const perCur = scaleBuckets(mixed, 0.05);
check(
  "B:commission-per-currency",
  perCur.USD === 5 && perCur.JPY === 5 && perCur.KWD === 617,
  JSON.stringify(perCur),
);
check(
  "B:buckets-array-sorted-and-complete",
  JSON.stringify(bucketsToArray(mixed)) ===
    JSON.stringify([
      { currency: "JPY", minor: 100 },
      { currency: "KWD", minor: 12345 },
      { currency: "USD", minor: 100 },
    ]),
  JSON.stringify(bucketsToArray(mixed)),
);

// Durable-write guard throws rather than persisting invented money.
let threw = false;
let msg = "";
try { assertPersistableScalar(s, "harness"); } catch (e) { threw = true; msg = String(e); }
check("B:persist-guard-throws-on-mixed", threw, msg.slice(0, 120));
check(
  "B:persist-guard-names-currencies",
  msg.includes("JPY") && msg.includes("USD"),
  msg.slice(0, 160),
);

/* ============================== C. sink 1 — partnerConsortiumRoutes.ts */
const CONSORT = "server/partnerConsortiumRoutes.ts";
absent("C:no-totalCommitted-plusequals", CONSORT, "totalCommittedMinor += r.amount_minor");
absent("C:no-totalFunded-plusequals", CONSORT, "totalFundedMinor    += r.amount_minor");
absent("C:no-month-committed-plusequals", CONSORT, "monthMap[month].committedMinor += r.amount_minor");
absent("C:no-tier-committed-plusequals", CONSORT, "tierEntry.committedMinor += r.amount_minor");
absent("C:no-commission-from-mixed-total", CONSORT, "Math.floor(totalFundedMinor * pct)");
anchorOnce("C:committed-buckets-exist", CONSORT, "const committedBuckets: CurrencyBuckets = {};");
anchorOnce("C:funded-buckets-exist", CONSORT, "const fundedBuckets: CurrencyBuckets = {};");
anchorOnce("C:scalar-via-helper", CONSORT, "singleCurrencyScalar(committedBuckets, \"USD\")");
anchorOnce("C:commission-via-scaleScalar", CONSORT, "scaleScalar(totalFunded, pct)");
anchorOnce("C:emits-unavailable-reason", CONSORT, "totalsUnavailableReason");

/* =============================== D. sink 2 — partnerBillingStore.ts */
const STORE = "server/lib/partnerBillingStore.ts";
absent("D:no-pending-plusequals", STORE, "pendingMinor += amt");
absent("D:no-paid-plusequals", STORE, "paidMinor += amt");
absent(
  "D:no-USD-fallback-over-mixed",
  STORE,
  'currency: currencies.size === 1 ? Array.from(currencies)[0] : "USD"',
);
anchorOnce("D:currency-null-when-mixed", STORE, "currency: oneCurrency ? soleCurrency : null,");
anchorOnce("D:byCurrency-returned", STORE, "byCurrency,");
anchorOnce("D:pending-scalar", STORE, "const pending: MoneyScalar = oneCurrency");

/* ============================== E. sink 3 — reportingEngineRoutes.ts */
const REPORT = "server/lib/reportingEngineRoutes.ts";
absent("E:no-first-row-currency-persist", REPORT, 'currency: rows[0]?.currency ?? "USD"');
anchorOnce("E:snapshot-blocked", REPORT, "CROSS_CURRENCY_SNAPSHOT_BLOCKED");
anchorOnce("E:snapshot-409", REPORT, "error: \"CROSS_CURRENCY_SNAPSHOT_BLOCKED\",");
anchorOnce("E:metrics-unavailable", REPORT, "metricsUnavailable: {");
/* COVERAGE GAP found by mutation M11 (2026-08-11): the harness asserted the
   `metricsUnavailable` object existed but never asserted its machine-readable
   `reason`, so a mutation blanking the reason went undetected. A client that
   cannot distinguish "needs FX" from "no data" cannot render the right thing. */
anchorOnce("E:metrics-reason-is-fx", REPORT, 'reason: "needs_fx_conversion",');
anchorOnce("E:metrics-lists-currencies", REPORT, "currencies: metricCurrencies,");
anchorOnce("E:currency-set-helper", REPORT, "function currencySetOf(");

/* ================================= F. sink 4 — PartnerBilling.tsx (UI) */
const UI = "client/src/pages/partner/PartnerBilling.tsx";
// The old code showed a warning and then rendered the invalid cards anyway.
absent(
  "F:no-mixed-then-render-cards",
  UI,
  "{summary.data.mixed && (",
);
anchorOnce("F:mixed-branch-replaces-cards", UI, "{summary.data.mixed ? (");
anchorOnce("F:per-currency-table", UI, 'data-testid="table-partner-commission-by-currency"');
anchorOnce("F:uses-unavailable-formatter", UI, 'import { formatMinorOrUnavailable, minorToMajorString } from "@/lib/moneyDisplay"');
absent("F:no-hardcoded-div-100-in-csv", UI, "(l.amountMinor / 100).toFixed(2)");
anchorOnce("F:csv-uses-exponent-aware", UI, "minorToMajorString(l.amountMinor, l.currency)");

/* ==================== G. wave14MoneyRoutes total no longer a mixed sum */
const W14 = "server/lib/wave14MoneyRoutes.ts";
absent("G:no-mixed-totalMinor", W14, "totalMinor: position.pendingMinor + position.paidMinor");
anchorOnce("G:total-inherits-availability", W14, "position.pending.available && position.paid.available");

console.log(failed === 0 ? "ITEM2 HARNESS: OK" : `ITEM2 HARNESS: ${failed} FAILURES`);
process.exit(failed === 0 ? 0 : 1);
