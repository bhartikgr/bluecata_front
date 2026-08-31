#!/usr/bin/env node
/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 220 · THE ADVERSARIAL DISARM HARNESS.
 * ══════════════════════════════════════════════════════════════════════════════
 * A test that passes proves nothing until you have watched it FAIL for the right
 * reason. Eighteen consecutive waves have found something real by disarming
 * their own proofs. This harness does that mechanically.
 *
 * FOR EACH MUTATION:
 *   1. count occurrences of the search text in the file
 *   2. HARD ABORT unless the count is EXACTLY ONE. A mutation that applies
 *      zero times proves nothing and would be reported as a pass; a mutation
 *      that applies twice is not the mutation described. Either way the run
 *      stops, loudly, rather than producing a reassuring transcript.
 *   3. apply it, run the wave-220 suite, READ THE EXIT CODE — never the summary
 *      line. R212.3: a suite printed "26 passed" while exiting rc=1.
 *   4. restore from the in-memory original and verify the restore is
 *      BYTE-IDENTICAL by sha256. The tree is not a git repository, so the
 *      restore has to be proved, not assumed.
 *
 * EXPECTATION is declared per mutation:
 *   "RED"  — the suite MUST fail. A GREEN result here is a finding: it means
 *            the proof does not depend on the thing it claims to prove.
 *
 * TWO FAMILIES OF MUTATION, deliberately:
 *   DISARM — undo a fix (put the false claim back). Proves the test notices a
 *            regression.
 *   ATTACK — inject a NEW false claim the wave never wrote, including actively
 *            trying to get the word "verified" rendered to a user about
 *            accreditation. Proves the test is a fence, not a snapshot of one
 *            particular edit.
 *
 * Usage: node scripts/w220-disarm-harness.mjs [--only <substring>]
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const SUITE = "client/src/components/__tests__/w220_class_a_copy.test.tsx";
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

const COLLECTIVE = "client/src/pages/founder/Collective.tsx";
const APPLY = "client/src/pages/investor/ApplyToCollective.tsx";
const PROMOTE = "client/src/components/investor/PromoteToCollectiveDialog.tsx";
const SPVTABS = "client/src/components/partner/SpvDetailTabs.tsx";
const COMPANY = "client/src/pages/CompanyDetails.tsx";
const ACCFORM = "client/src/components/AccreditationForm.tsx";
const SPVENGINE = "shared/spvEngine.ts";
const SPVEDU = "client/src/lib/spvEducation.ts";

/** @type {Array<{id:string,kind:"DISARM"|"ATTACK",file:string,find:string,replace:string,expect:"RED",why:string}>} */
const MUTATIONS = [
  /* ── DISARM: put each withdrawn claim back exactly as it was ────────────── */
  {
    id: "D1 · A1 hero thresholds",
    kind: "DISARM",
    file: COLLECTIVE,
    find:
      "like-minded peers and curated deal flow. Membership requires a signed\n" +
      "              accredited-investor declaration: Capavate records your declaration, it does not check\n" +
      "              it, and it does not perform any verification on your behalf. No contribution\n" +
      "              threshold is measured or required. Companies do",
    replace:
      "like-minded peers and curated deal flow. Membership is reserved for investors who\n" +
      "              meet accreditation and contribution thresholds. Companies do",
    expect: "RED",
    why: "restores the eligibility claim the platform never tests",
  },
  {
    id: "D2 · A2 licensed KYC provider",
    kind: "DISARM",
    file: APPLY,
    find:
      "          Files are encrypted in transit. Capavate stores documents in an access-controlled vault.\n" +
      "          Capavate records what you upload; it does not check it, and it does not perform identity\n" +
      "          verification or KYC screening on your behalf. No verification provider is integrated with\n" +
      "          this platform, so nothing here is sent to one.",
    replace:
      "          Files are encrypted in transit. Capavate stores documents in an access-controlled vault and shares\n" +
      "          them only with the licensed KYC provider.",
    expect: "RED",
    why: "restores a named third party that does not exist",
  },
  {
    id: "D3 · A3 identity-verification heading",
    kind: "DISARM",
    file: APPLY,
    find: '<CardTitle className="text-lg">Identity documents</CardTitle>',
    replace: '<CardTitle className="text-lg">Identity verification & KYC</CardTitle>',
    expect: "RED",
    why: "restores a heading claiming a verification step",
  },
  {
    id: "D4 · A4 committee diligence pass",
    kind: "DISARM",
    file: PROMOTE,
    find:
      "            Once submitted, your nomination is recorded and the founder is\n" +
      "            notified. Capavate checks that you appear on this company's cap table\n" +
      "            at that moment. No committee reviews your nomination, no M&A\n" +
      "            readiness score is computed, no check is performed on the founder,\n" +
      "            and no review time is promised.",
    replace:
      "            Once submitted, the Collective committee runs a streamlined diligence\n" +
      "            pass — usually within 2 business days — including M&A readiness\n" +
      "            scoring, cap-table verification, and founder readiness check.",
    expect: "RED",
    why: "restores four named checks and an SLA, none of which exist",
  },
  {
    id: "D5 · A6 SPV attribution sibling removed",
    kind: "DISARM",
    file: SPVTABS,
    find: 'data-testid="spv-investor-compliance-attribution"',
    replace: 'data-testid="spv-investor-compliance-attribution-DISARMED"',
    expect: "RED",
    why: "renames the appended disclosure so the header is unattributed again",
  },
  {
    id: "D6 · A5 governance attribution removed",
    kind: "DISARM",
    file: COMPANY,
    find:
      "Every row above is stated by the company on its own profile. Capavate records what the company states and does not check any of it.",
    replace: "This scorecard summarises the company's governance posture.",
    expect: "RED",
    why: "removes the attribution, so founder self-assessment reads as a finding again",
  },

  /* ── DISARM: delete a retained literal (R195.5) ─────────────────────────── */
  {
    id: "D7 · R195.5 retained literal deleted",
    kind: "DISARM",
    file: COLLECTIVE,
    find:
      '<div data-testid="w220-superseded-hero-thresholds">The Capavate Collective is a global community of accredited investors engaging with like-minded peers and curated deal flow. Membership is reserved for investors who meet accreditation and contribution thresholds. Companies do</div>',
    replace: '<div data-testid="w220-superseded-hero-thresholds">removed</div>',
    expect: "RED",
    why: "R195.5 forbids deletion; the retention test must notice one going missing",
  },
  {
    /* FIRST WRITTEN as `{false && (`, which does not close with `) : null}` and
       therefore broke the parse: the suite went red with "no tests", i.e. red for
       the wrong reason, proving nothing. Rewritten as the SYNTACTICALLY VALID
       suppression `{false ? (`, which the original R-5 assertion did not catch at
       all. That gap was real and R-5 now fences every literal-false form. This
       is the finding of the 19th consecutive wave to disarm its own proofs. */
    id: "D8 · R210.4 identifier flag swapped for a literal-false suppression",
    kind: "DISARM",
    file: PROMOTE,
    find: "        {W220_RENDER_SUPERSEDED_COPY ? (",
    replace: "        {false ? (",
    expect: "RED",
    why: "a SUPPRESSION reads as a deletion to the restyle detector; must be caught in ANY syntactic form",
  },

  /* ── DISARM: damage an honest sentence the brief ordered preserved ──────── */
  {
    id: "D9 · honest sentence damaged (GENERIC_COUNT_NOTE)",
    kind: "DISARM",
    file: SPVENGINE,
    find: "Capavate does not hold a verified investor-count threshold for this jurisdiction.",
    replace: "Capavate holds a verified investor-count threshold for this jurisdiction.",
    expect: "RED",
    why: "THE headline honest sentence, confirmed live. A sweep that damaged it must be caught.",
  },
  {
    id: "D10 · honest sentence damaged (spvEducation accreditation)",
    kind: "DISARM",
    file: SPVEDU,
    find: "Investors on Capavate are assumed to be accredited.",
    replace: "Investors on Capavate are verified as accredited.",
    expect: "RED",
    why: "the second sentence confirmed live; also smuggles 'verified' about accreditation",
  },
  {
    id: "D11 · honest register softened (AccreditationForm)",
    kind: "DISARM",
    file: ACCFORM,
    find: "Capavate records your declaration; it does not check it, and it does",
    replace: "Capavate reviews your declaration; it does",
    expect: "RED",
    why: "§7 item 19 forbids softening a refusal sentence",
  },

  /* ── ATTACK: get the word "verified" rendered about accreditation ───────── */
  {
    id: 'A1 · ATTACK: render "verified" about accreditation on the founder page',
    kind: "ATTACK",
    file: COLLECTIVE,
    find: "              An invitation-only network of accredited investors.",
    replace:
      "              An invitation-only network of accredited investors. Accreditation is verified by Capavate.",
    expect: "RED",
    why: 'the brief: "actively try to get the word verified rendered to a user about accreditation"',
  },
  {
    id: 'A2 · ATTACK: render an unnegated "verification" claim on the identity step',
    kind: "ATTACK",
    file: APPLY,
    find: '<CardTitle className="text-lg">Identity documents</CardTitle>',
    replace:
      '<CardTitle className="text-lg">Identity documents</CardTitle>\n      <div>Identity verification is included as a baseline.</div>',
    expect: "RED",
    why: "a Class A claim the wave never wrote, injected fresh",
  },
  {
    id: "A3 · ATTACK: re-introduce a business-day SLA on the promote dialog",
    kind: "ATTACK",
    file: PROMOTE,
    find: "            and no review time is promised.",
    replace: "            and a decision follows within 2 business days.",
    expect: "RED",
    why: "an SLA nothing measures, injected fresh",
  },
  {
    id: "A4 · ATTACK: name a KYC vendor on the identity step",
    kind: "ATTACK",
    file: APPLY,
    find: "          this platform, so nothing here is sent to one.",
    replace: "          this platform. Documents are checked by Onfido.",
    expect: "RED",
    why: "names a vendor that does not exist anywhere in the tree",
  },
  {
    id: "A5 · ATTACK: restrict something (R190.10) by hiding an upload control",
    kind: "ATTACK",
    file: APPLY,
    find: '          testid="upload-poa"',
    replace: '          testid="upload-poa-HIDDEN"',
    expect: "RED",
    why: "R190.10 — the suite must notice a field disappearing, not only a sentence changing",
  },
  {
    id: "A6 · ATTACK: hide a governance row (R190.10 / R195.5)",
    kind: "ATTACK",
    file: COMPANY,
    find: ' <GovRow label="Financials independently audited" v={profile.ma.isFinanciallyAudited} positive />\n',
    replace: "",
    expect: "RED",
    why: "a row removed rather than attributed is a restriction and a deletion",
  },
];

/* ── runner ───────────────────────────────────────────────────────────────── */
function runSuite() {
  const r = spawnSync("npx", ["vitest", "run", SUITE], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
    maxBuffer: 64 * 1024 * 1024,
  });
  /* THE EXIT CODE IS THE VERDICT. The summary line is not consulted for the
     verdict; it is only reported alongside, so a divergence between the two is
     visible rather than hidden. */
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const summary = (out.match(/Tests\s+.*$/m) ?? ["(no summary line printed)"])[0].trim();
  /* A run that collected NO TESTS is red for the wrong reason: a broken parse,
     not a caught regression. Reporting that as a satisfied expectation would be
     the single easiest way for this harness to lie, so it is surfaced. */
  const collapsed = summary.replace(/\u001b\[[0-9;]*m/g, "");
  return {
    rc: r.status,
    summary,
    divergent: r.status !== 0 && /\bTests\s+\d+ passed\b/.test(collapsed) && !/failed/.test(collapsed),
    noTests: /no tests/i.test(collapsed) || !/\d+ (?:passed|failed)/.test(collapsed),
  };
}

function abort(msg) {
  console.error(`\nHARD ABORT — ${msg}\n`);
  process.exit(2);
}

const selected = MUTATIONS.filter((m) => !only || m.id.includes(only));
console.log(`W220 DISARM HARNESS — ${selected.length} mutation(s), suite: ${SUITE}\n`);

/* Baseline: the suite must be GREEN before anything is mutated. Without this the
   whole run is meaningless — every "RED as expected" could be a pre-existing
   failure. */
const base = runSuite();
console.log(`BASELINE  rc=${base.rc}  ${base.summary}`);
if (base.rc !== 0) abort(`the suite is not green before mutation (rc=${base.rc}). Fix that first.`);
if (base.divergent) abort('the runner printed "passed" while exiting non-zero (inert-proof mechanism 7).');
console.log("");

const results = [];
for (const m of selected) {
  const abs = path.join(ROOT, m.file);
  const original = fs.readFileSync(abs, "utf8");
  const originalSha = sha(original);

  /* MUTATION MUST APPLY EXACTLY ONCE. */
  let count = 0;
  let idx = original.indexOf(m.find);
  while (idx !== -1) {
    count += 1;
    idx = original.indexOf(m.find, idx + 1);
  }
  if (count !== 1) {
    abort(
      `mutation "${m.id}" matched ${count} time(s) in ${m.file}, not exactly once. ` +
        `A mutation that does not apply exactly once proves nothing, and a harness that ` +
        `reported it as a pass would be lying.`,
    );
  }

  fs.writeFileSync(abs, original.replace(m.find, m.replace));
  let res;
  try {
    res = runSuite();
  } finally {
    fs.writeFileSync(abs, original);
    const restoredSha = sha(fs.readFileSync(abs, "utf8"));
    if (restoredSha !== originalSha) {
      abort(`restore of ${m.file} is NOT byte-identical (${originalSha} -> ${restoredSha}).`);
    }
  }

  const verdict = res.rc !== 0 ? (res.noTests ? "RED-NO-TESTS" : "RED") : "GREEN";
  const ok = verdict === m.expect;
  if (res.noTests) {
    abort(
      `mutation "${m.id}" made the suite collect NO TESTS (rc=${res.rc}). That is red for the ` +
        `wrong reason — a broken parse, not a caught regression — and must never be counted ` +
        `as a satisfied expectation. Rewrite the mutation so the file still parses.`,
    );
  }
  results.push({ ...m, rc: res.rc, verdict, ok, summary: res.summary, divergent: res.divergent });
  console.log(
    `${ok ? "OK  " : "!!! "} ${m.kind}  ${m.id}\n` +
      `       expect=${m.expect}  got=${verdict}  rc=${res.rc}  (${res.summary})\n` +
      `       why: ${m.why}` +
      (res.divergent ? `\n       DIVERGENCE: printed "passed" while exiting ${res.rc} — mechanism 7.` : "") +
      (ok ? "" : `\n       *** GREEN DISARM — INVESTIGATE. The proof does not depend on what it claims to prove.`),
  );
}

const bad = results.filter((r) => !r.ok);
console.log(
  `\nDISARM SUMMARY: ${results.length - bad.length}/${results.length} behaved as expected` +
    ` (${results.filter((r) => r.kind === "DISARM").length} disarms, ${results.filter((r) => r.kind === "ATTACK").length} attacks).`,
);
if (bad.length) {
  console.log("\nUNEXPECTED RESULTS — each of these is a finding, not a formality:");
  for (const b of bad) console.log(`  ${b.id}: expected ${b.expect}, got ${b.verdict} (rc=${b.rc})`);
  process.exit(1);
}
console.log("Every mutation applied exactly once, every restore was byte-identical, every verdict read from the EXIT CODE.");
process.exit(0);
