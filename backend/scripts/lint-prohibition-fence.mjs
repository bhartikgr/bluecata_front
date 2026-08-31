#!/usr/bin/env node
/**
 * scripts/lint-prohibition-fence.mjs — WAVE 220 · THE PROHIBITED-COPY FENCE.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS. Read this before adding a term to the baseline.
 * ═══════════════════════════════════════════════════════════════════════════
 * LEGAL_TECH_BUILD_DOC §220.3 Step 5: "It fails the build on a new prohibited
 * string." Handbook §11: "PREFER A CONSTRAINT TO A PROHIBITION — a rule the
 * tooling refuses cannot be reintroduced by a future wave or a careless brief."
 *
 * Wave 220's audit is a snapshot. Waves 227 and 228 each had to withdraw claims
 * that a previous wave had written in good faith, and wave 220's own inventory
 * found the phrase "Verified accreditation per regional regulation" had survived
 * for months on a founder's screen. A report cannot stop the next one being
 * typed. This fence can.
 *
 * IT IS A RATCHET, NOT A CLEANER. The baseline below enumerates every hit that
 * exists in the tree today, per file, with a justification for each. The fence
 * is GREEN on that baseline and RED the moment any file's count for any term
 * rises, or any new file acquires a term. It therefore cannot be satisfied by
 * deleting copy (that only lowers counts, and deletion is separately forbidden
 * by R195.5) and cannot be silenced by an allow-list of terms — only by an
 * enumerated, justified, per-file entry that a reviewer can see in a diff.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * COMMENT STRIPPING, AND THE ONE PLACE IT MUST NOT HAPPEN
 * ═══════════════════════════════════════════════════════════════════════════
 * Every wave that greps this tree is required to strip comments before drawing a
 * conclusion, because the headers in this codebase quote the defects they fixed
 * — "Was: 'Verified accreditation per regional regulation ...'" appears verbatim
 * inside a comment in founder/Collective.tsx. A fence that counted those would be
 * red on the very notes that record the corrections.
 *
 * So comments ARE stripped, and the stripper is self-verified: `--selftest`
 * asserts on a fixture that a term inside `//`, `/* *\/` and JSX `{/* *\/}` is
 * removed and the same term outside them survives.
 *
 * STRING LITERALS ARE NOT STRIPPED, AND THAT IS DELIBERATE AND STATED. The
 * content under audit IS string literals; a "safe" stripper that removed them
 * would remove the entire subject of the measurement. This is the case the
 * standing grep rule names explicitly: "where the content IS string literals, do
 * not strip literals — say so." This is the saying-so.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IS AND IS NOT A PROHIBITED TERM
 * ═══════════════════════════════════════════════════════════════════════════
 * The census (`scripts/w220-copy-census.ts`) screens the build doc's nineteen
 * keyword terms, several of which are innocuous English — `top`, `quality`,
 * `featured`. Those belong in a census, which reports candidates, and NOT in a
 * fence, which fails a build. The fence carries only phrases that assert a check,
 * a screening, an independent verification or a guarantee: strings that cannot be
 * true of this platform in any context, so that a hit needs no context read.
 *
 * `sanctions screened` and `sanctions screening` are carried because §A10 /
 * wave 222 depends on this fence holding that phrase out of the tree.
 *
 * usage:
 *   node scripts/lint-prohibition-fence.mjs                 # gate: exit 1 on any new hit
 *   node scripts/lint-prohibition-fence.mjs --census        # print every hit, pass or fail
 *   node scripts/lint-prohibition-fence.mjs --json
 *   node scripts/lint-prohibition-fence.mjs --emit-baseline # rewrite the baseline (deliberate act)
 *   node scripts/lint-prohibition-fence.mjs --selftest      # prove the comment stripper
 *   node scripts/lint-prohibition-fence.mjs --dir path      # extra scan root (used by the red proof)
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const BASELINE_PATH = path.join(ROOT, "scripts/lint/w220_prohibition_baseline.json");

/* ── argv ────────────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const census = argv.includes("--census");
const emit = argv.includes("--emit-baseline");
const selftest = argv.includes("--selftest");
const extraDirs = [];
for (let i = 0; i < argv.length; i++) if (argv[i] === "--dir") extraDirs.push(argv[i + 1]);

/* ═════════════════════════════════════════════════════════════════════════
 * THE PROHIBITED TERMS.
 *
 * Each is a phrase that asserts something Capavate does not do. `why` is
 * printed with every finding so the failure message teaches rather than blocks.
 * ═════════════════════════════════════════════════════════════════════════ */
export const PROHIBITED = [
  { term: "invest now",                why: "Rule 1 — an arranging-shaped call to action. The safe formulation is \"Continue to {Partner}'s subscription process\"." },
  { term: "sanctions screened",        why: "§A10 / wave 222 — no sanctions screening exists. Carried here so it cannot be reintroduced." },
  { term: "sanctions screening",       why: "§A10 / wave 222 — no sanctions screening exists." },
  { term: "kyc verified",              why: "No KYC is performed. Documents are stored and never screened." },
  { term: "verified kyc",              why: "No KYC is performed." },
  { term: "kyc sweep",                 why: "Withdrawn by wave 228; no sweep of any kind runs." },
  { term: "aml compliant",             why: "No AML process exists; the Partner Agreement puts AML on the Partner." },
  { term: "aml compliance check",      why: "No AML process exists." },
  { term: "verified accreditation",    why: "Accreditation is a self-declaration. Capavate records it and does not check it." },
  { term: "accreditation verified",    why: "Accreditation is a self-declaration." },
  { term: "accreditation re-verification", why: "Withdrawn by wave 228; nothing re-verifies an accreditation." },
  { term: "verified accredited",       why: "Accreditation is a self-declaration; \"verified accredited investors\" asserts both a check and a restriction." },
  { term: "third-party verified",      why: "No third-party verification integration exists in this tree." },
  { term: "licensed kyc provider",     why: "No KYC provider is integrated. Naming one is a data-protection representation as well as a compliance claim." },
  { term: "independently verified",    why: "Nothing on the platform is independently verified." },
  { term: "independent verification",  why: "Nothing on the platform is independently verified." },
  { term: "due diligence performed",   why: "Rule 17 — no diligence is performed by Capavate." },
  { term: "diligence pass",            why: "No diligence pass runs on any submission." },
  { term: "pre-qualified",             why: "Nothing is pre-qualified." },
  { term: "ipev-compliant",            why: "No IPEV conformance has been established." },
  { term: "ilpa-compliant",            why: "No ILPA conformance has been established." },
  { term: "awaiting compliance review",why: "There is no compliance review. A form told investors this while writing nothing at all." },
  { term: "compliance review",         why: "There is no compliance review step anywhere on the platform." },
  { term: "guaranteed return",         why: "Rule 12 — a performance guarantee." },
  { term: "verified, not self-reported", why: "The platform records self-declarations. This asserts the exact opposite." },
];

/* ── scan scope ──────────────────────────────────────────────────────────── */
const SCOPES = ["client/src", "shared", "server"];
const SKIP_DIR = new Set(["node_modules", "public", "dist", "build", ".git", "coverage", "__snapshots__"]);
const EXT = /\.(tsx|ts|jsx|js|mjs)$/;
const IS_TEST = (rel) => /(^|\/)__tests__(\/|$)|\.test\.|\.spec\.|(^|\/)e2e(\/|$)|(^|\/)tests(\/|$)/.test(rel);
/* The fence itself, the census, and the baseline enumerate these phrases by
   definition. Excluding exactly these three paths — by exact path, not by
   pattern — keeps the fence from reporting itself. */
const SELF = new Set([
  "scripts/lint-prohibition-fence.mjs",
  "scripts/w220-copy-census.ts",
  "scripts/lint/w220_prohibition_baseline.json",
]);

function walk(dir, out = []) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) walk(p, out); }
    else if (EXT.test(e.name)) out.push(p);
  }
  return out;
}

/* ═════════════════════════════════════════════════════════════════════════
 * THE COMMENT STRIPPER.
 *
 * Replaces comment bytes with spaces rather than removing them, so line and
 * column numbers survive and a reported line number is the real one. String
 * literals are NOT touched — see the header.
 * ═════════════════════════════════════════════════════════════════════════ */
export function stripComments(src) {
  const out = src.split("");
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") { out[i] = " "; i++; }
    } else if (c === "/" && d === "*") {
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] !== "\n") out[i] = " "; i++; }
      if (i < n) { out[i] = " "; out[i + 1] = " "; i += 2; }
    } else {
      i++;
    }
  }
  return out.join("");
}

function runSelftest() {
  const fixture = [
    'const live = "sanctions screened";',
    '// a comment saying sanctions screened',
    '/* a block saying sanctions screened */',
    '{/* a jsx comment saying sanctions screened */}',
    'const live2 = `kyc verified`;',
  ].join("\n");
  const stripped = stripComments(fixture);
  const lines = stripped.split("\n");
  const checks = [
    ["line 1 literal survives", /sanctions screened/.test(lines[0])],
    ["line 2 // comment stripped", !/sanctions screened/.test(lines[1])],
    ["line 3 block comment stripped", !/sanctions screened/.test(lines[2])],
    ["line 4 jsx comment stripped", !/sanctions screened/.test(lines[3])],
    ["line 5 literal survives", /kyc verified/.test(lines[4])],
    ["line count preserved", stripped.split("\n").length === fixture.split("\n").length],
    ["byte length preserved", stripped.length === fixture.length],
  ];
  let bad = 0;
  for (const [name, ok] of checks) { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) bad++; }
  console.log(bad === 0 ? "SELFTEST OK — the stripper stripped, and literals survived." : `SELFTEST FAILED: ${bad}`);
  process.exit(bad === 0 ? 0 : 1);
}
if (selftest) runSelftest();

/* ── scan ────────────────────────────────────────────────────────────────── */
const files = [];
for (const s of SCOPES) files.push(...walk(path.join(ROOT, s)));
for (const d of extraDirs) if (d) files.push(...walk(path.resolve(d)));

const hits = [];
for (const f of files) {
  const rel = path.relative(ROOT, f).replace(/\\/g, "/");
  if (SELF.has(rel) || IS_TEST(rel)) continue;
  let src;
  try { src = fs.readFileSync(f, "utf8"); } catch { continue; }
  const stripped = stripComments(src);
  const lines = stripped.split("\n");
  for (let li = 0; li < lines.length; li++) {
    const lower = lines[li].toLowerCase();
    for (const p of PROHIBITED) {
      let from = 0, at;
      while ((at = lower.indexOf(p.term, from)) !== -1) {
        hits.push({ file: rel, line: li + 1, term: p.term, why: p.why, text: lines[li].trim().slice(0, 200) });
        from = at + p.term.length;
      }
    }
  }
}
hits.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || (a.term < b.term ? -1 : 1)));

/* ── baseline ────────────────────────────────────────────────────────────── */
const countsNow = {};
for (const h of hits) {
  const k = `${h.file}::${h.term}`;
  countsNow[k] = (countsNow[k] ?? 0) + 1;
}

/* Per-file justification for every baseline family. A baseline entry with no
   justification here is itself a failure — an unexplained allowance is the thing
   this fence exists to prevent. */
export const JUSTIFICATIONS = {
  "client/src/components/home3compo/": "FROZEN — every file in this directory is on the enforced 48-entry sacred list and a tenth waiver is not available to be sought. Wave 220 reports these hits as unfixed Class A/B findings in W220_INVENTORY.md and W220_FOR_THE_OWNER.md. They cannot be corrected from this layer.",
  "client/src/pages/founder/Collective.tsx": "RETIRED IN PLACE, NOT DELETED (R195.5). The three superseded claims are retained as unreachable JSX behind the identifier flag W228_RENDER_SUPERSEDED_COPY so neither gate reads wave 228's correction as a silent copy drop. Wave 220 adds a second such block behind W220_RENDER_SUPERSEDED_COPY. The source hits are intentional; nothing renders.",
  "client/src/components/AccreditationForm.tsx": "LATENT, reported not fixed. The 'awaiting compliance review' toast is reachable only when a caller passes onSubmit, which the component's only mount does not do (wave 215). The accreditation self-certification is a §7 mechanical-step item and its text is not rewritten by this wave.",
  "client/src/pages/investor/Signup.tsx": "Class C — 'Accredited — third-party verified' is an option the INVESTOR selects about their own status. Removing it would narrow a field's choices, forbidden by R190.10.",
  "client/src/pages/admin/": "Operator-only surface. Labels over stored operator flags. No external assurance is asserted to an investor. Recorded so that the same words appearing on an investor-facing file would be a NEW file:term pair and fail.",
  "client/src/pages/investor/Profile.tsx": "Wave 227's retired 'Verified' badge copy, retained in place behind an identifier flag for the same R195.5 reason.",
  "client/src/lib/legalDocs.ts": "Legal document corpus. Contains the adopted texts; their wording is an owner and counsel matter and no wave may edit an adopted legal document's body.",
  "server/": "Server-side message and policy strings. Where these are honest refusals they are protected by §7 item 19; where they are findings they are reported in W220_INVENTORY.md.",
  "client/src/pages/CompanyDetails.tsx": "Founder-entered governance booleans. Wave 220 appends an attribution line rather than editing the labels.",
  "client/src/pages/investor/ApplyToCollective.tsx": "Wave 220 retires the 'licensed KYC provider' sentence and the 'Identity verification & KYC' header in place behind an identifier flag; the source hits remain by design.",
  "client/src/components/investor/PromoteToCollectiveDialog.tsx": "Wave 220 retires the diligence-pass sentence in place behind an identifier flag; the source hit remains by design.",
  "client/src/components/partner/SpvDetailTabs.tsx": "Wave 220 appends a disclosure sibling under the 'Investor KYC & accreditation' header and does not touch the header literal (R143.1).",
  "client/src/pages/founder/Welcome.tsx": "Class B, REPORTED NOT FIXED. 'Every cap-table commit is independently verified by two engines' overstates the scope of a mechanism that is REAL: server/captableCommitStore.ts:10 gates the `funded` transition on cap-table-engine and cap-table-engine-ref reconciling. The word is accurate for that transition; 'every commit' and 'always reconcile' are not. The correction turns on enumerating exactly which transitions are gated, so it is reported for the owner rather than guessed at.",
  "shared/consortiumAgreement.ts": "ADEQUATE ITEM 1 of the nineteen (LEGAL_TECH_BUILD_DOC §7). Clause 4.3 places KYC/AML/CTF and sanctions screening on the PARTNER — 'precisely the risk allocation your requirement needs'. This is the correct allocation, not a Capavate claim. NOT TO BE TOUCHED.",
  "shared/wave211MoneyEventAttestation.ts": "An HONEST REFUSAL, protected by §7 item 19: 'Capavate does not verify this person's identity, wealth, status, eligibility or source of funds, does not perform customer due diligence or sanctions screening on them'. The phrase appears in a NEGATION. The fence is a count ratchet, not a semantic reader; enumerating negated uses in the baseline is how it stays green without being taught to guess at polarity.",
  "shared/wave217PartnerComplianceAttestation.ts": "PRIOR ART, Class D. This is wave 217's own COMPLIANCE_FORBIDDEN_WORDS list — the platform already refuses 'verified', 'verify', 'vetted', 'screened', 'pre-qualified', 'prequalified', 'approved' in partner-compliance copy, asserted by its DOM test against that one exported list. This fence generalises the same idea platform-wide.",
  "client/src/lib/legalDocsV2.ts": "Adopted legal document corpus, v2. Same reason as legalDocs.ts.",
};

if (emit) {
  const baseline = {
    wave: 220,
    note:
      "ENUMERATED, JUSTIFIED BASELINE of prohibited-phrase hits present in the tree when the fence shipped. " +
      "The fence is a RATCHET: any count rising, or any new file:term pair, fails the build. " +
      "Lowering a count never fails — but deleting copy is forbidden by R195.5, so the honest way to lower one is " +
      "to retire the claim in place behind an identifier flag, which leaves the source hit and the baseline entry intact.",
    justifications: JUSTIFICATIONS,
    counts: Object.fromEntries(Object.entries(countsNow).sort(([a], [b]) => (a < b ? -1 : 1))),
  };
  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
  console.log(`prohibition-fence: wrote baseline with ${Object.keys(countsNow).length} file:term entries, ${hits.length} hits`);
  process.exit(0);
}

let baseline = null;
try { baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")); } catch { /* absent */ }

const failures = [];
if (baseline) {
  const base = baseline.counts ?? {};
  for (const [k, n] of Object.entries(countsNow)) {
    const allowed = base[k] ?? 0;
    if (n > allowed) {
      const [file, term] = k.split("::");
      const why = PROHIBITED.find((p) => p.term === term)?.why ?? "";
      failures.push({
        file, term, allowed, found: n,
        lines: hits.filter((h) => h.file === file && h.term === term).map((h) => h.line),
        why,
        kind: allowed === 0 ? "NEW file:term pair" : "count increased",
      });
    }
  }
  /* An unjustified baseline family is itself a failure. */
  for (const k of Object.keys(base)) {
    const file = k.split("::")[0];
    const covered = Object.keys(JUSTIFICATIONS).some((prefix) => file.startsWith(prefix));
    if (!covered) failures.push({ file, term: k.split("::")[1], allowed: base[k], found: base[k], why: "baseline entry has no justification in JUSTIFICATIONS", kind: "UNJUSTIFIED BASELINE ENTRY" });
  }
}

if (census) {
  for (const h of hits) console.log(`${h.file}:${h.line}\t${h.term}\t${h.text}`);
  console.log(`— ${hits.length} hit(s) across ${new Set(hits.map((h) => h.file)).size} file(s), ${Object.keys(countsNow).length} file:term pair(s)`);
}

if (asJson) {
  console.log(JSON.stringify({ hits: hits.length, pairs: Object.keys(countsNow).length, failures }, null, 2));
} else if (!census) {
  if (!baseline) {
    console.log("PROHIBITION FENCE: no baseline present — run with --emit-baseline once, deliberately.");
    process.exit(1);
  }
  if (failures.length === 0) {
    console.log(
      `PROHIBITION FENCE OK: ${hits.length} pre-existing hit(s) across ${Object.keys(countsNow).length} enumerated file:term pair(s); ` +
      `0 new, 0 increased, 0 unjustified.`,
    );
  } else {
    console.log(`PROHIBITION FENCE FAILED: ${failures.length} finding(s).\n`);
    for (const f of failures) {
      console.log(`  ${f.kind}: ${f.file}  term="${f.term}"  allowed=${f.allowed} found=${f.found}${f.lines ? ` lines=${f.lines.join(",")}` : ""}`);
      console.log(`    why prohibited: ${f.why}\n`);
    }
    console.log("A new prohibited phrase is not fixed by adding it to the baseline. Withdraw the claim, or make it true.");
  }
}

process.exit(failures.length === 0 ? 0 : 1);
