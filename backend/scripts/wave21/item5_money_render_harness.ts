/**
 * WAVE 21 · ITEM 5 falsification harness.
 *
 * Review A: "Every money test must include a JPY fixture (exponent 0) and a
 * three-exponent currency — a hardcoded /100 passes every USD test, which is
 * exactly why this survived."
 *
 * So every behavioural fixture below is run for FOUR exponents, and each one
 * carries the value a hardcoded /100 would have produced. If any surface
 * regresses to /100, the JPY or KWD row prints the /100 answer and the
 * assertion names it.
 *
 *   JPY  exponent 0   12345 minor  = ¥12,345      (/100 would say ¥123)
 *   USD  exponent 2   12345 minor  = $123.45      (/100 agrees — hence useless alone)
 *   KWD  exponent 3   12345 minor  = KWD 12.345   (/100 would say 123.45)
 *   CLF  exponent 4   12345 minor  = CLF 1.2345   (/100 would say 123.45)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { formatMinor, currencyExponent, toMinor } from "../../client/src/lib/currency";
import { minorToMajorString, formatMinorOrUnavailable, MONEY_UNAVAILABLE } from "../../client/src/lib/moneyDisplay";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string, extra?: unknown): void {
  if (cond) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${extra === undefined ? "" : "  -> " + JSON.stringify(extra)}`);
  }
}
/** Source with comments stripped — WAVE 21 comments quote the defective code
 *  they replaced, so grepping raw source produces false positives. */
function code(rel: string): string {
  return fs
    .readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    // <code>...</code> is rendered documentation, never executed. One such
    // block legitimately QUOTES a server-side `Math.round(amountMinor / 100)`
    // that this wave did not change (it lives in adminPlatformFeesRoutes.ts,
    // outside the client). Stripping the tag keeps the scan honest without
    // pretending the server quirk is fixed — it is reported instead.
    .replace(/<code>[\s\S]*?<\/code>/g, "");
}
function has(rel: string, needle: string): boolean {
  return code(rel).includes(needle);
}

console.log("\nA. the exponent table itself");
ok(currencyExponent("JPY") === 0, "A — JPY exponent is 0");
ok(currencyExponent("USD") === 2, "A — USD exponent is 2");
ok(currencyExponent("KWD") === 3, "A — KWD exponent is 3");
ok(currencyExponent("CLF") === 4, "A — CLF exponent is 4");
ok(currencyExponent("ZZZ") === 2, "A — an unknown code falls back to 2, not a crash");

console.log("\nB. minorToMajorString — the /100 replacement");
const MINOR = 12345;
ok(minorToMajorString(MINOR, "JPY") === "12345", "B — JPY 12345 minor is 12345 major, NOT 123.45", minorToMajorString(MINOR, "JPY"));
ok(minorToMajorString(MINOR, "USD") === "123.45", "B — USD 12345 minor is 123.45", minorToMajorString(MINOR, "USD"));
ok(minorToMajorString(MINOR, "KWD") === "12.345", "B — KWD 12345 minor is 12.345, NOT 123.45", minorToMajorString(MINOR, "KWD"));
ok(minorToMajorString(MINOR, "CLF") === "1.2345", "B — CLF 12345 minor is 1.2345", minorToMajorString(MINOR, "CLF"));
ok(minorToMajorString(null, "USD") === "" && minorToMajorString(undefined, "JPY") === "", "B — absent amounts render empty, never 0");
// The control that makes this section meaningful at all:
ok(minorToMajorString(MINOR, "JPY") !== (MINOR / 100).toFixed(2), "B CONTROL — the JPY answer DIFFERS from the /100 answer");
ok(minorToMajorString(MINOR, "USD") === (MINOR / 100).toFixed(2), "B CONTROL — the USD answer AGREES with /100, which is why USD-only tests never caught this");

/* COVERAGE GAP found by mutation M4 (2026-08-11): sections B and C exercised
   minorToMajorString and toMinor but never asserted formatMinor's RENDERED
   digits, so pinning minimum/maximumFractionDigits back to a hardcoded 2 was
   MISSED. That mutation gets the magnitude right and the convention wrong —
   "¥12,345.00" — which is precisely the kind of half-correct output a
   USD-only test can never see. */
console.log("\nB2. formatMinor renders the currency's own number of digits");
{
  const digits = (s: string) => (s.split(".")[1] ?? "").replace(/[^0-9]/g, "").length;
  const jpy = formatMinor(12345, "JPY");
  const usd = formatMinor(12345, "USD");
  const kwd = formatMinor(12345, "KWD");
  const clf = formatMinor(12345, "CLF");
  ok(digits(jpy) === 0, "B2 — JPY renders with 0 fraction digits", jpy);
  ok(digits(usd) === 2, "B2 — USD renders with 2 fraction digits", usd);
  ok(digits(kwd) === 3, "B2 — KWD renders with 3 fraction digits", kwd);
  ok(digits(clf) === 4, "B2 — CLF renders with 4 fraction digits", clf);
  ok(/12,?345/.test(jpy), "B2 — JPY shows 12,345 whole yen, not 123", jpy);
  ok(/12[.,]345/.test(kwd) && !/123[.,]45/.test(kwd), "B2 — KWD shows 12.345, not 123.45", kwd);
  ok(digits(jpy) !== digits(usd) && digits(kwd) !== digits(usd), "B2 CONTROL — digit counts genuinely differ by currency");
}

console.log("\nC. formatMinor round-trip with toMinor");
for (const cur of ["JPY", "USD", "KWD", "CLF"]) {
  const major = Number(minorToMajorString(MINOR, cur));
  ok(toMinor(major, cur) === MINOR, `C — ${cur} minor->major->minor round-trips exactly`, { cur, major, back: toMinor(major, cur) });
}
ok(toMinor(1, "JPY") === 1, "C — 1 JPY major is 1 minor, not 100");
ok(toMinor(1, "KWD") === 1000, "C — 1 KWD major is 1000 minor");

console.log("\nD. unavailable rendering never fabricates a number");
ok(formatMinorOrUnavailable(null, "USD") === MONEY_UNAVAILABLE, "D — a null amount renders the marker, not $0.00");
ok(formatMinorOrUnavailable(0, null) === MONEY_UNAVAILABLE, "D — a known amount with an unknown currency renders the marker");
ok(formatMinorOrUnavailable(0, "JPY") === formatMinor(0, "JPY"), "D — a genuine zero still renders as zero");

console.log("\nE. every site Review A named no longer divides by 100");
const SITES: Array<[string, string]> = [
  ["client/src/pages/consortium/ConsortiumPricing.tsx", "formatMoneyMinor"],
  ["client/src/pages/collective/MembershipPage.tsx", "formatMoneyMinor"],
  ["client/src/pages/collective/CollectiveMembership.tsx", "annualAmountMinor"],
  ["client/src/pages/founder/Subscribe.tsx", "fmtMoney"],
  ["client/src/pages/founder/Settings.tsx", "amountMinor"],
  ["client/src/pages/partner/PartnerContacts.tsx", "function money"],
  ["client/src/pages/partner/PartnerBilling.tsx", "formatMinor"],
  ["client/src/pages/admin/AdminPlatformFees.tsx", "minorToMajor"],
  ["client/src/pages/admin/AdminPartnerBillingOps.tsx", "minorToMajorInput"],
  ["client/src/pages/admin/AdminFeesConsolidated.tsx", "minorToMajor"],
  ["client/src/pages/admin/InvestorDetail.tsx", "formatMinorUsd"],
  ["client/src/pages/admin/Companies.tsx", "fmtMoney"],
  ["client/src/pages/admin/Investors.tsx", "formatMinorUsd"],
];
for (const [rel, marker] of SITES) {
  const src = code(rel);
  const divs = (src.match(/(?:Minor|Cents|minor|cents|amount|price|dollars|major)\s*(?:\?\?\s*0\s*\)?)?\s*\/\s*100\b/g) || []);
  ok(divs.length === 0, `E — ${rel.replace("client/src/pages/", "")} has no money /100`, divs);
  ok(src.includes(marker), `E — ${rel.replace("client/src/pages/", "")} still contains its money formatter (${marker})`);
}

console.log("\nF. the fixed surfaces route through the exponent-aware helpers");
ok(has("client/src/pages/admin/InvestorDetail.tsx", "minorToMajorString(minor, currency)"), "F — InvestorDetail uses its currency argument instead of discarding it");
ok(has("client/src/pages/admin/Investors.tsx", "minorToMajorString(minor, currency)"), "F — Investors uses its currency argument");
ok(has("client/src/pages/admin/Companies.tsx", "minorToMajorString(minor, currency)"), "F — Companies uses its currency argument");
/* SACRED-BLOCKED. client/src/pages/founder/Billing.tsx is one of the 47 sacred
   files. The ITEM 5 fix was written, tripped sacred_check.sh, and was REVERTED
   to the byte-identical original. The file still contains the /100 defect. The
   exact patch is recorded in WAVE21_REPORT.md and needs an owner waiver.
   Asserting the file is UNTOUCHED is the honest check here — a harness that
   quietly stopped testing this surface would be the tenth "passed while
   checking nothing". */
ok(code("client/src/pages/founder/Billing.tsx").includes("format(minor / 100)"),
   "F — founder/Billing STILL has the /100 defect (SACRED: reverted, patch reported, waiver required)");
ok(!has("client/src/pages/founder/Billing.tsx", 'from "@/lib/currency"'),
   "F — no stray import was left behind in the reverted sacred file");
ok(has("client/src/pages/founder/Subscribe.tsx", "formatMinor(minor, currency"), "F — founder/Subscribe delegates to formatMinor");
ok(has("client/src/pages/partner/PartnerContacts.tsx", 'function money(minor: number, currency = "USD")'), "F — PartnerContacts takes a currency instead of hardcoding USD");
ok(!code("client/src/pages/partner/PartnerContacts.tsx").includes('currency: "USD"'), "F — PartnerContacts no longer hardcodes a USD label");

console.log("\nG. parse partners scale by the SAME exponent as the display side");
ok(has("client/src/pages/admin/AdminFeesConsolidated.tsx", "toMinor(Number(raw), currency)"), "G — AdminFeesConsolidated parse uses toMinor");
ok(has("client/src/pages/admin/AdminPlatformFees.tsx", "toMinor(Number(raw), currency)"), "G — AdminPlatformFees parse uses toMinor");
ok(has("client/src/pages/admin/AdminPartnerBillingOps.tsx", "toMinor(Number(raw), currency)"), "G — AdminPartnerBillingOps parse uses toMinor");
for (const rel of [
  "client/src/pages/admin/AdminFeesConsolidated.tsx",
  "client/src/pages/admin/AdminPlatformFees.tsx",
  "client/src/pages/admin/AdminPartnerBillingOps.tsx",
]) {
  ok(!code(rel).includes("Math.round(Number(raw) * 100)"), `G — ${rel.split("/").pop()} has no hardcoded x100 parse`);
}
ok(!code("client/src/pages/admin/AdminFeesConsolidated.tsx").includes("\\d{1,2})?$/.test(raw)"), "G — the 2-decimal input guard is gone (it rejected KWD and accepted fractional JPY)");
ok(!code("client/src/pages/admin/AdminPlatformFees.tsx").includes("\\d{1,2})?$/.test(raw)"), "G — AdminPlatformFees 2-decimal input guard is gone");

console.log("\nH. the shared library was not weakened to make the above pass");
ok(has("client/src/lib/currency.ts", "Math.pow(10, exp)"), "H — formatMinor still scales by the exponent");
ok(!code("client/src/lib/currency.ts").includes("/ 100"), "H — currency.ts itself contains no /100");
ok(!code("client/src/lib/moneyDisplay.ts").includes("/ 100"), "H — moneyDisplay.ts contains no /100");
ok(currencyExponent("JPY") !== currencyExponent("USD"), "H CONTROL — the exponent table is not a constant function");

console.log(`\nassertions: ${pass} passed, ${fail} failed`);
console.log(`ITEM5 HARNESS: ${fail === 0 ? "OK" : "FAIL"}`);
process.exit(fail === 0 ? 0 : 1);
