/**
 * WAVE 21 · ITEM 6 falsification harness — hardcoded/placeholder business
 * content that reaches a user.
 *
 * Three sinks Review A named, and one behavioural check each where the defect
 * was behavioural rather than textual.
 */
import * as fs from "node:fs";
import { composeDiscussBody as compose } from "../../client/src/components/investor/DiscussWithCapTableDialog";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

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
/** Source with comments stripped: the WAVE 21 comments quote the placeholder
 *  text they removed, so a raw grep would report the fix as the defect. */
function code(rel: string): string {
  return fs
    .readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}
function once(label: string, rel: string, needle: string): void {
  const n = code(rel).split(needle).length - 1;
  ok(n === 1, `${label} — \`${needle}\` occurs exactly once`, { occurrences: n });
}

const FEEHUB = "client/src/pages/admin/FeeHub.tsx";
const DISCUSS = "client/src/components/investor/DiscussWithCapTableDialog.tsx";
const DETAILS = "client/src/pages/CompanyDetails.tsx";

console.log("\nA. FeeHub no longer hardcodes prices while claiming nothing is hardcoded");
ok(!code(FEEHUB).includes("$499"), "A — the hardcoded $499/mo example is gone");
ok(!code(FEEHUB).includes("catalyst 2%"), "A — the hardcoded 2% commission example is gone");
ok(!code(FEEHUB).includes("builder 3%"), "A — the hardcoded 3% commission example is gone");
ok(!/\$\s?\d[\d,]*(\.\d+)?\s*\/\s*mo/.test(code(FEEHUB)), "A — no hardcoded per-month price of ANY value remains");
ok(code(FEEHUB).includes("nothing is hardcoded"), "A — the DB-driven claim is retained (and is now true)");
// CONTROL: the page must still explain the tiers, not have been gutted.
ok(code(FEEHUB).includes("Catalyst, Builder, Amplifier, Nexus, Founding Member"),
   "A CONTROL — the tier NAMES (which are not prices) are still documented");
ok(code(FEEHUB).includes("Commission Rates"), "A CONTROL — the Commission Rates entry still exists");

console.log("\nB. no 'TBD' is composed into an outbound message body");
ok(!code(DISCUSS).includes('"TBD"'), "B — the literal TBD placeholder is gone");
ok(!code(DISCUSS).includes("top buyer ${topBuyer"), "B — the unconditional 'top buyer' clause is gone");
once("B", DISCUSS, "export function composeDiscussBody(");
ok(code(DISCUSS).split("composeDiscussBody(companyName, topBuyer, maScore)").length - 1 === 2,
   "B — BOTH the initial body and the re-open reset use the same composer (they drifted apart before)");
{
  /* Behavioural. An earlier draft evaluated the function source with
     `new Function`, which cannot parse TypeScript annotations — it threw, and a
     thrown harness is a harness that checked nothing. Imported instead, which
     also proves the composer is genuinely the one the component uses. */
  const withBuyer = compose("Acme", "Globex", 72);
  const noBuyer = compose("Acme", null, 72);
  const blankBuyer = compose("Acme", "   ", 72);
  ok(withBuyer.includes("top buyer Globex"), "B — a known buyer IS reported", withBuyer);
  ok(!noBuyer.includes("TBD") && !noBuyer.includes("top buyer"), "B — an unknown buyer is OMITTED, not asserted as TBD", noBuyer);
  ok(!blankBuyer.includes("top buyer"), "B — a whitespace-only buyer is also omitted", blankBuyer);
  ok(noBuyer.includes("Acme") && noBuyer.includes("72/100"), "B CONTROL — the rest of the message survives", noBuyer);
  ok(!noBuyer.includes("—  —") && !noBuyer.includes(" ,"), "B CONTROL — no dangling punctuation from the removed clause", noBuyer);
}

console.log("\nC. the empty co-member card says so instead of rendering nothing");
ok(code(DETAILS).includes("co-members-not-in-this-view"), "C — an explicit empty-state element exists");
ok(code(DETAILS).includes("not loaded in this shared company view"), "C — the copy states WHY the list is empty");
ok(code(DETAILS).includes("Open this company from your investor dashboard"), "C — the copy states where the data IS available");
once("C", DETAILS, "const coMembersLoadedInThisView = false;");
/* COVERAGE GAP found by mutation M7 (2026-08-11): asserting the empty-state
   ELEMENT exists says nothing about whether it can ever render. Replacing the
   guard with `{false && (` left the markup in the file and was MISSED. The
   guard is now pinned, and the flag is proven to be the one that drives it. */
once("C", DETAILS, "{!coMembersLoadedInThisView && (");
ok(!/\{\s*false\s*&&\s*\(/.test(code(DETAILS)), "C — no dead `{false && (` guard suppresses the empty state");
{
  const src = code(DETAILS);
  const guard = src.indexOf("{!coMembersLoadedInThisView && (");
  const el = src.indexOf("co-members-not-in-this-view");
  ok(guard >= 0 && el > guard && el - guard < 400,
     "C — the live guard immediately precedes the empty-state element (it gates THAT element)", { guard, el });
}
ok(code(DETAILS).includes("{coMembers.map(m =>"), "C CONTROL — the real list rendering is retained for when it is wired");
ok(code(DETAILS).includes('data-testid="section-co-members"'), "C CONTROL — the section testid is unchanged");
// The old state: a comment said "Coming Soon" but nothing rendered it.
ok(!/Coming Soon|Coming soon/.test(code(DETAILS)),
   "C — 'Coming Soon' no longer exists as a comment-only promise with no UI");

console.log(`\nassertions: ${pass} passed, ${fail} failed`);
console.log(`ITEM6 HARNESS: ${fail === 0 ? "OK" : "FAIL"}`);
process.exit(fail === 0 ? 0 : 1);
