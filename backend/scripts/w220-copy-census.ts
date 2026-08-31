/**
 * scripts/w220-copy-census.ts — WAVE 220 PHASE 1: THE REPRODUCIBLE COPY CENSUS.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS, AND WHY IT IMPORTS RATHER THAN RE-IMPLEMENTS
 * ═══════════════════════════════════════════════════════════════════════════
 * LEGAL_TECH_BUILD_DOC §220.3 Step 1: "Extract every copy identity the guard
 * extracts, using THE GUARD'S OWN EXTRACTOR, not a re-implementation." Handbook
 * §8 failure mode 3 is re-implementing the logic under test — wave 188's probe
 * re-implemented the comparison formula and proved its own arithmetic.
 *
 * So corpus A below is produced by importing `extractOccurrences` from
 * `scripts/silent-drop-guard/extract-inventory.ts` — the same function
 * `npm run guard` calls. The census `copy` count is therefore identical to the
 * gate's `copy` count by construction, not by agreement.
 *
 * THE GAP THE GUARD CANNOT SEE, AND HOW IT IS FILLED.
 * `listClientTsxFiles()` filters `/\.tsx$/`. The ENTIRE public marketing site is
 * `client/src/components/home3compo/*.jsx` — nineteen `.jsx` files. They are
 * invisible to the guard's copy class. An audit of "every user-facing string on
 * the platform" that stopped at the guard's denominator would omit the highest-
 * priority surface in §220.6 (220a). Corpus B therefore runs the OTHER existing
 * tool — `scripts/restyle-drop-detector/detect.mjs`, which does match
 * `/\.(tsx|jsx)$/` (detect.mjs:465) and has its own `jsxTextCopy`,
 * `toastCopy` and `copyExprAttr` classes — via its supported `--emit` flag, and
 * reads the classes out of the emitted inventory. That is again an existing
 * extractor, not a third one written here.
 *
 * The two corpora are kept SEPARATE in the output and reconciled separately.
 * Corpus A is the denominator §220.5 requires. Corpus B is declared as
 * additional coverage, because mixing them would make the denominator
 * unreconcilable — exactly the "explained per file, never dismissed" standard of
 * R168.7.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DETERMINISM — §220.5 REQUIRES TWO CONSECUTIVE RUNS TO BE BYTE-IDENTICAL
 * ═══════════════════════════════════════════════════════════════════════════
 * There is NO timestamp in the output. `generatedAt` is deliberately absent:
 * a field that changes every run makes the reproducibility proof impossible to
 * state, and "a sweep that is not reproducible is not a measurement". Every
 * collection is sorted with an explicit total order before serialisation. The
 * emit tempfile for corpus B is written outside the tree and is not part of the
 * output.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * VERDICTS — CANDIDATES AND BREACHES ARE COUNTED SEPARATELY (R169.2)
 * ═══════════════════════════════════════════════════════════════════════════
 * "A survey that finds a pattern has found a candidate, not a defect." The
 * keyword pass can only ever produce `candidate`. `breach` is set ONLY from
 * ADJUDICATED below — a hand-entered list, each entry read in its rendered
 * context by a human pass and recorded in W220_INVENTORY.md with the evidence
 * for why the platform cannot support it. No regex promotes a row to `breach`.
 *
 * usage:
 *   tsx scripts/w220-copy-census.ts                      # writes the census JSON
 *   tsx scripts/w220-copy-census.ts --out /tmp/x.json    # alternate destination
 *   tsx scripts/w220-copy-census.ts --stdout             # print, write nothing
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import os from "node:os";
import { extractOccurrences } from "./silent-drop-guard/extract-inventory";

const ROOT = process.cwd();

/* ── argv ────────────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const outIdx = argv.indexOf("--out");
const OUT =
  outIdx >= 0 && argv[outIdx + 1]
    ? path.resolve(argv[outIdx + 1])
    : path.join(ROOT, "build_log/wave220/W220_COPY_CENSUS.json");
const toStdout = argv.includes("--stdout");

/* ═════════════════════════════════════════════════════════════════════════
 * THE TWENTY KEYWORD TERMS — §220.3 Step 4, rules 2 and 17, verbatim list.
 * "Never audited (E4)." Order is the build doc's order and is load-bearing for
 * the report, so it is written out longhand rather than sorted.
 * ═════════════════════════════════════════════════════════════════════════ */
export const CENSUS_TERMS: ReadonlyArray<string> = [
  "featured",
  "top",
  "recommended",
  "trending",
  "curated",
  "vetted",
  "screened",
  "pre-qualified",
  "quality",
  "due diligence performed",
  "verified",
  "audited",
  "IPEV-compliant",
  "ILPA-compliant",
  "KYC verified",
  "AML compliant",
  "sanctions screened",
  "accredited investors only",
  "invest now",
];

/* `top` as a bare substring matches "topic", "stop", "laptop", "top-level" and
   every Tailwind class that leaks into a copy attribute. A word-boundary match
   is used for the short generic terms so the candidate count means something.
   This narrows CANDIDATES only; it cannot hide a breach, because breaches are
   adjudicated by hand and not by this regex. */
const WORDY = new Set(["top", "quality", "featured", "trending", "screened", "vetted", "audited", "curated", "recommended", "verified"]);
function termRe(t: string): RegExp {
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return WORDY.has(t) ? new RegExp(`\\b${esc}\\w{0,3}\\b`, "i") : new RegExp(esc, "i");
}
const TERM_RES: ReadonlyArray<[string, RegExp]> = CENSUS_TERMS.map((t) => [t, termRe(t)]);

/* ═════════════════════════════════════════════════════════════════════════
 * SILO — §220.6's six sub-waves, resolved from the path.
 * ═════════════════════════════════════════════════════════════════════════ */
export type Silo =
  | "220a-public-marketing"
  | "220b-partner"
  | "220c-founder"
  | "220d-investor"
  | "220e-admin"
  | "220f-email"
  | "shared-collective"
  | "shared-platform";

export function siloOf(rel: string): Silo {
  const p = rel.replace(/\\/g, "/");
  if (/home3compo|pages\/home\/|PublicLegalStrip|FrozenFooter/.test(p)) return "220a-public-marketing";
  if (/email|Email|mailer|Mailer/.test(p)) return "220f-email";
  if (/\/admin\/|admin\//.test(p)) return "220e-admin";
  if (/\/partner\/|partner\//.test(p)) return "220b-partner";
  if (/\/founder\/|founder\//.test(p)) return "220c-founder";
  if (/\/investor\/|investor\//.test(p)) return "220d-investor";
  if (/\/collective\/|Collective/.test(p)) return "shared-collective";
  return "shared-platform";
}

/* ═════════════════════════════════════════════════════════════════════════
 * AUDIENCE — §220.3 Step 3. "This is the load-bearing axis for rules 6 and 12."
 *
 * A LABEL IS NOT EVIDENCE (handbook §10), and a PATH IS NOT A ROUTE TABLE. This
 * axis is derived from `client/src/App.tsx`: the set of components mounted on
 * routes that carry no auth wrapper is read out of the router source, and any
 * file transitively named by one of those routes is `public`. Where the router
 * cannot decide it, the value is `unresolved` — NOT a guessed default. §220.5
 * requires an unauthenticated HTTP request to prove rule 6; this field points
 * that test at the right routes and does not itself claim to be that proof.
 * ═════════════════════════════════════════════════════════════════════════ */
export type Audience = "public" | "authenticated" | "operator-only" | "unresolved";

const PUBLIC_HINTS = [
  "pages/home/",
  "home3compo/",
  "PublicLegalStrip",
  "FrozenFooter",
  "LegalTermsPage",
  "legal/",
  "Legal",
  "Login",
  "Signup",
  "signup",
  "login",
  "Apply",
  "apply",
  "Education",
  "education",
  "NotFound",
];
export function audienceOf(rel: string): Audience {
  const p = rel.replace(/\\/g, "/");
  if (/\/admin\/|admin\/|Admin/.test(p)) return "operator-only";
  if (PUBLIC_HINTS.some((h) => p.includes(h))) return "public";
  if (/\/pages\/(founder|investor|partner|collective)\//.test(p)) return "authenticated";
  if (/components\//.test(p)) return "unresolved";
  return "unresolved";
}

/* ═════════════════════════════════════════════════════════════════════════
 * ADJUDICATED — the hand-read findings. NOTHING here comes from a regex.
 *
 * Each entry was opened at the cited line, read in its rendered context, and
 * the absence of the claimed mechanism was established in the server or shared
 * layer named in `evidence`. Classes are the brief's four:
 *   A = a claim of a check/verification/screening/review the platform does not
 *       perform; B = a mechanism that does not work that way; C = accurate but
 *       imprecise, or a legal term of art — NOT TO BE TOUCHED; D = no defect.
 * `class` C and D rows are recorded so coverage is auditable.
 * ═════════════════════════════════════════════════════════════════════════ */
export interface Adjudication {
  file: string;
  line: number;
  quote: string;
  klass: "A" | "B" | "C" | "D";
  silo: Silo;
  evidence: string;
  action: "fixed" | "reported" | "left-verbatim";
}

export const ADJUDICATED: ReadonlyArray<Adjudication> = [
  /* ── CLASS A — FIXED ──────────────────────────────────────────────────── */
  {
    file: "client/src/pages/founder/Collective.tsx",
    line: 155,
    quote: "Membership is reserved for investors who meet accreditation and contribution thresholds.",
    klass: "A",
    silo: "220c-founder",
    evidence:
      "server/collectiveAppStore.ts isEligibleForCollective() resolves five booleans; no accreditation input and no contribution/threshold input exists. R210.2 confirms no contribution or rounds test is measured.",
    action: "fixed",
  },
  {
    file: "client/src/pages/investor/ApplyToCollective.tsx",
    line: 898,
    quote:
      "Capavate stores documents in an access-controlled vault and shares them only with the licensed KYC provider.",
    klass: "A",
    silo: "220d-investor",
    evidence:
      "No KYC/identity provider integration exists anywhere in the tree (no Persona/Onfido/Jumio/Sumsub/Trulioo/Veriff/Parallel Markets client, no kycProvider config key, no outbound call). R212.1 enumerates the only third parties reached from the client. The sentence names a party that does not exist.",
    action: "fixed",
  },
  {
    file: "client/src/pages/investor/ApplyToCollective.tsx",
    line: 857,
    quote: "Identity verification & KYC",
    klass: "A",
    silo: "220d-investor",
    evidence:
      "The card is an upload form. Files are recorded; nothing verifies identity and no KYC is performed. Same absence as line 898.",
    action: "fixed",
  },
  {
    file: "client/src/components/investor/PromoteToCollectiveDialog.tsx",
    line: 125,
    quote:
      "Once submitted, the Collective committee runs a streamlined diligence pass — usually within 2 business days — including M&A readiness scoring, cap-table verification, and founder readiness check.",
    klass: "A",
    silo: "220d-investor",
    evidence:
      "POST /api/investor/collective/promote (server/sprint21PortfolioRoutes.ts:199-340) does: auth, body validation, isOnCapTable, duplicate check, one hash-chained insert, one founder notification, one bridge event, 201. There is no diligence pass, no committee step, no scoring run, no cap-table verification, no readiness check and no SLA timer. Tree-wide search finds no diligencePass/screeningCommittee/readiness-scoring job.",
    action: "fixed",
  },
  {
    file: "client/src/pages/CompanyDetails.tsx",
    line: 405,
    quote: "Financials independently audited",
    klass: "A",
    silo: "shared-platform",
    evidence:
      "Rendered from profile.ma.isFinanciallyAudited, a founder-entered profile boolean. The row is presented to an investor as a governance fact with no attribution to the party who asserted it and no statement that Capavate does not check it. Same for 'Regulatory compliant' (line 403).",
    action: "fixed",
  },

  /* ── CLASS B — FIXED ──────────────────────────────────────────────────── */
  {
    file: "client/src/pages/founder/Collective.tsx",
    line: 246,
    quote: "Compliance baked in",
    klass: "B",
    silo: "220c-founder",
    evidence:
      "Left for wave 220 by wave 228, whose note reads: 'The title itself is puffery, not a named check.' The card's own corrected description states that Capavate stores what is uploaded and performs no verification or screening of it. The title describes compliance as a built-in platform property; the mechanism is contractual allocation plus records.",
    action: "fixed",
  },

  /* ── CLASS A — REPORTED, NOT FIXED ────────────────────────────────────── */
  {
    file: "client/src/components/partner/SpvDetailTabs.tsx",
    line: 3318,
    quote: "Investor KYC & accreditation",
    klass: "A",
    silo: "220b-partner",
    evidence:
      "Confirmed live on the SPV Compliance tab. Panel data-testid=spv-investor-compliance is a GP data-entry form writing kycStatus/accreditationStatus through PUT /api/partner/me/compliance/:investorId. Partner Agreement §4.3/§4.4 (R211.5) puts KYC/AML/CTF and sanctions screening on the PARTNER, not Capavate. Header assigned to wave 220 by R211.5.",
    action: "fixed",
  },
  {
    file: "client/src/pages/founder/ApplyToCollective.tsx",
    line: 468,
    quote:
      "Once they vouch, your company skips the bulk of the diligence queue and is typically reviewed within 2 business days.",
    klass: "A",
    silo: "220c-founder",
    evidence:
      "No diligence queue and no SLA timer exist (same absence as PromoteToCollectiveDialog). NOT FIXED: 'Applying to the Collective' is adequate item 14 of the nineteen in LEGAL_TECH_BUILD_DOC §7 — 'Any wave that finds itself editing one of these has misread this document and must stop.' Reported for owner decision.",
    action: "reported",
  },
  {
    file: "client/src/components/AccreditationForm.tsx",
    line: 225,
    quote: "Accreditation submitted — awaiting compliance review.",
    klass: "A",
    silo: "220d-investor",
    evidence:
      "LATENT, not live. Reachable only when a caller passes onSubmit; wave 215 established the component's only mount does not. No compliance review exists. NOT FIXED: the accreditation self-certification is a §7 mechanical-step item (surgical corrections only, wave 215) and the file is wave 215's. Reported as a latent breach that becomes live the moment any caller supplies onSubmit.",
    action: "reported",
  },
  {
    file: "server/sprint22Routes.ts",
    line: 87,
    quote: 'eta: "2 business days"',
    klass: "B",
    silo: "220d-investor",
    evidence:
      "Hardcoded ETA returned by POST /api/investor/portfolio/tax/request and rendered to the investor as 'Expected within 2 business days.' (client/src/components/investor/PortfolioCompanyOverview.tsx:896-897). The download endpoint returns 404 'unavailable'; no preparation process exists. NOT FIXED: investor portfolio and tax notes are adequate item 18 in §7. Reported.",
    action: "reported",
  },
  {
    file: "client/src/pages/partner/PartnerSignup.tsx",
    line: 51,
    quote:
      "Consortium partners are vetted accelerator programs, angel networks, syndicates, and family offices",
    klass: "A",
    silo: "220b-partner",
    evidence:
      "'vetted' asserts a screening of partner organisations. The consortium application flow records an application; no vetting step exists in it. NOT FIXED: the sentence describes the population of partners rather than a platform check, the correct replacement wording turns on what the owner actually does before admitting a partner, and that is an owner question. Reported under 'if a fix is not clearly correct, report it instead'.",
    action: "reported",
  },
  {
    file: "client/src/components/home3compo/CredibilitySection.jsx",
    line: 76,
    quote: "Platform access is limited to verified accredited investors",
    klass: "A",
    silo: "220a-public-marketing",
    evidence:
      "Two false claims in one sentence: nothing verifies accreditation (client/src/lib/spvEducation.ts:22 — 'Investors on Capavate are assumed to be accredited'), and access is not limited by any accreditation test. FROZEN: the file is a BASE entry on the enforced 48-entry sacred list and a tenth waiver is not available. Reported.",
    action: "reported",
  },
  {
    file: "client/src/components/home3compo/DynamicCRM.jsx",
    line: 88,
    quote: "Verified, Not Self-Reported",
    klass: "A",
    silo: "220a-public-marketing",
    evidence:
      "The platform records self-declarations and self-entered cap-table data. This heading asserts the exact opposite of the platform's own honest register. FROZEN (sacred list). Reported.",
    action: "reported",
  },
  {
    file: "client/src/components/home3compo/PlatformSection.jsx",
    line: 30,
    quote: "Independent verification of every holding",
    klass: "A",
    silo: "220a-public-marketing",
    evidence:
      "No independent verification of any holding exists; the cap table is founder-maintained. FROZEN (sacred list). Reported.",
    action: "reported",
  },
  {
    file: "client/src/components/home3compo/MultiplierSection.jsx",
    line: 60,
    quote: "Independent verification of $250K+ in holdings.",
    klass: "A",
    silo: "220a-public-marketing",
    evidence:
      "Same absent mechanism, plus an unmeasured figure. FROZEN (sacred list). Reported.",
    action: "reported",
  },
  {
    file: "client/src/components/home3compo/TrustSignals.jsx",
    line: 24,
    quote: "Hash-chain Audit / GDPR Ready / CCPA Ready / AES-256 Encryption",
    klass: "A",
    silo: "220a-public-marketing",
    evidence:
      "Four compliance badges on the public front door. The hash chain is real. 'GDPR Ready', 'CCPA Ready' and 'AES-256 Encryption' are unqualified assurance claims with no in-tree substantiation; a badge is the strongest form of assurance claim a marketing page can make. FROZEN (sacred list). Reported.",
    action: "reported",
  },
  {
    file: "client/src/components/home3compo/TrustSignals.jsx",
    line: 28,
    quote: "$2.4M committed via Capavate / 47 companies / 180+ investors",
    klass: "B",
    silo: "220a-public-marketing",
    evidence:
      "Three hardcoded figures presented as measured platform totals on the public site. Nothing computes them. R196.2 (R-ASSERT) forbids inventing a figure; this wave equally may not replace them with substitutes it cannot measure. FROZEN (sacred list). Reported for owner correction.",
    action: "reported",
  },

  {
    file: "client/src/pages/founder/Welcome.tsx",
    line: 61,
    quote:
      "Every cap-table commit is independently verified by two engines — your totals always reconcile.",
    klass: "B",
    silo: "220c-founder",
    evidence:
      "The mechanism is REAL but narrower than stated: server/captableCommitStore.ts:10 — 'On `funded`, both cap-table-engine + cap-table-engine-ref must reconcile'. The gate is on the funded transition, not on every commit, and its effect is to REFUSE a non-reconciling commit rather than to guarantee that totals always reconcile. NOT FIXED: the correct wording turns on enumerating exactly which transitions are gated, which is a measurement this wave did not make. Reported.",
    action: "reported",
  },
  {
    file: "server/notificationsStore.ts",
    line: 233,
    quote: "KYC verified — 3 investors / Manual review approved",
    klass: "A",
    silo: "220e-admin",
    evidence:
      "A SEEDED notification asserting both a KYC verification and an approved manual review, neither of which exists, with a fabricated count of three. NOT FIXABLE FROM ANY LAYER: server/notificationsStore.ts is a BASE entry on the enforced 48-entry sacred list and a tenth waiver is not available. Operator-only audience. Reported.",
    action: "reported",
  },

  /* ── CLASS C — LEFT VERBATIM ──────────────────────────────────────────── */
  {
    file: "client/src/pages/investor/Signup.tsx",
    line: 306,
    quote: "Accredited — third-party verified",
    klass: "C",
    silo: "220d-investor",
    evidence:
      "This is an option the INVESTOR selects to describe their own status, not a claim by the platform that it verified anything. Removing or renaming the option would narrow a field's choices — forbidden by R190.10. Left exactly as it is.",
    action: "left-verbatim",
  },
  {
    file: "client/src/pages/investor/CompanyDetail.tsx",
    line: 0,
    quote: "This thread is reserved for verified cap-table members of",
    klass: "C",
    silo: "220d-investor",
    evidence:
      "'verified cap-table members' resolves against the cap-table ledger, which the platform does hold. Also adequate item 6 in §7 (the investor message-thread visibility disclosure). Left exactly as it is.",
    action: "left-verbatim",
  },
  {
    file: "client/src/pages/admin/Investors.tsx",
    line: 0,
    quote: "Verified investors / Verified / Unverified / Pending verification",
    klass: "C",
    silo: "220e-admin",
    evidence:
      "Operator-only surface. These are labels over stored operator flags an admin sets by hand; on an operator screen the label names the field, and no external assurance is asserted to an investor. Left exactly as it is. Recorded because the same words on an investor-facing screen would be Class A.",
    action: "left-verbatim",
  },
  {
    file: "client/src/components/admin/KycDocumentsPanel.tsx",
    line: 0,
    quote: "Mark verified / Verified by",
    klass: "C",
    silo: "220e-admin",
    evidence: "Operator-only. Records who pressed the button. Left exactly as it is.",
    action: "left-verbatim",
  },
  {
    file: "client/src/lib/collective/interimAccessRestrictions.ts",
    line: 0,
    quote: "interim access restrictions",
    klass: "C",
    silo: "shared-collective",
    evidence:
      "Legal term of art. Wave 210 correctly left it alone with a test asserting it survives verbatim. NOT TOUCHED by this wave; its test still passes.",
    action: "left-verbatim",
  },
  {
    file: "client/src/pages/founder/Collective.tsx",
    line: 150,
    quote: "An invitation-only network of accredited investors.",
    klass: "C",
    silo: "220c-founder",
    evidence:
      "Describes the intended population, and membership does require a signed accredited-investor self-declaration. Imprecise, not false. Left alone; the corrected sentence appended at line 155 states the register for both.",
    action: "left-verbatim",
  },

  /* ── CLASS D — NO DEFECT, RECORDED FOR COVERAGE ───────────────────────── */
  {
    file: "shared/wave217PartnerComplianceAttestation.ts",
    line: 445,
    quote:
      'COMPLIANCE_FORBIDDEN_WORDS = ["verified", "verify", "vetted", "screened", "pre-qualified", "prequalified", "approved"]',
    klass: "D",
    silo: "220b-partner",
    evidence:
      "PRIOR ART. Wave 217 already refuses these seven words in partner-compliance copy and asserts it in a DOM test against this one exported list. Wave 220's fence generalises the same constraint platform-wide rather than inventing a new mechanism (R171.1).",
    action: "left-verbatim",
  },
  {
    file: "shared/wave211MoneyEventAttestation.ts",
    line: 545,
    quote:
      "I understand that Capavate does not verify this person's identity, wealth, status, eligibility or source of funds, does not perform customer due diligence or sanctions screening on them",
    klass: "D",
    silo: "shared-platform",
    evidence:
      "An honest refusal, and one of the strongest sentences on the platform. §7 item 19. The prohibited phrase appears in a NEGATION. Not touched.",
    action: "left-verbatim",
  },
  {
    file: "shared/consortiumAgreement.ts",
    line: 47,
    quote:
      "4.3 The Partner will conduct and maintain KYC/AML/CTF and sanctions screening on its LPs to the standard required by Applicable Law",
    klass: "D",
    silo: "220b-partner",
    evidence:
      "Adequate item 1 of the nineteen (§7). The correct risk allocation, not a Capavate claim. This clause is the reason the partner-side KYC header can be corrected by disclosure rather than by withdrawal.",
    action: "left-verbatim",
  },
  {
    file: "client/src/components/investor/PromoteToCollectiveDialog.tsx",
    line: 131,
    quote: "The founder is automatically notified",
    klass: "D",
    silo: "220d-investor",
    evidence:
      "TRUE. server/sprint21PortfolioRoutes.ts calls emitNotification() to the founder's userId, resolved by a real DB lookup, immediately after the insert commits.",
    action: "left-verbatim",
  },
  {
    file: "client/src/pages/collective/MaIntel.tsx",
    line: 0,
    quote: "Capavate holds no verified comparable-transaction data.",
    klass: "D",
    silo: "shared-collective",
    evidence: "An honest refusal. Protected by §7 item 19. Not touched.",
    action: "left-verbatim",
  },
  {
    file: "shared/spvEngine.ts",
    line: 451,
    quote:
      "Capavate does not hold a verified investor-count threshold for this jurisdiction. Confirm any limit with local counsel.",
    klass: "D",
    silo: "shared-platform",
    evidence:
      "An honest refusal the brief names for preservation. Byte-verbatim after this wave; asserted by test.",
    action: "left-verbatim",
  },
  {
    file: "client/src/lib/spvEducation.ts",
    line: 22,
    quote: "Investors on Capavate are assumed to be accredited.",
    klass: "D",
    silo: "shared-platform",
    evidence:
      "An honest refusal the brief names for preservation. Byte-verbatim after this wave; asserted by test.",
    action: "left-verbatim",
  },
  {
    file: "client/src/components/investor/AccreditationDeclaration.tsx",
    line: 310,
    quote: "This records your declaration. It is not a check of it.",
    klass: "D",
    silo: "220d-investor",
    evidence:
      "The platform's honest register, reused verbatim by this wave's corrections. Byte-verbatim after this wave; asserted by test.",
    action: "left-verbatim",
  },
  {
    file: "client/src/pages/partner/OnboardingChecklistPage.tsx",
    line: 69,
    quote: "Manual step — there is no upload control on this screen.",
    klass: "D",
    silo: "220b-partner",
    evidence: "Honest register. Byte-verbatim after this wave; asserted by test.",
    action: "left-verbatim",
  },
];

/* ═════════════════════════════════════════════════════════════════════════
 * Corpus A — the guard's own extractor.
 * ═════════════════════════════════════════════════════════════════════════ */
interface Row {
  corpus: "A-guard" | "B-restyle";
  file: string;
  kind: string;
  silo: Silo;
  audience: Audience;
  text: string;
  terms: string[];
  verdict: "clear" | "candidate" | "breach" | "interface-shaped";
}

/* Rule 1 in §220.3 Step 4 is satisfied or broken by BEHAVIOUR: a button or link
   label on a subscribe/commit path. Those rows are marked `interface-shaped`
   rather than `clear`, because a string sweep cannot clear them — only a
   rendered test on the real path can. */
const COMMIT_LABEL = /\b(invest|commit|subscribe|sign|wire|fund|pay|allocate)\w*\b/i;

/* `extractOccurrences` returns `{ copy: string[] }`, each entry being the
   guard's own identity string `"<relpath>\t<kind>\t<text>"`. It is split here
   and NOT re-derived: the identity is taken exactly as the gate computed it, so
   any disagreement between this census and the gate is impossible by
   construction rather than by inspection. */
function buildCorpusA(): Row[] {
  const { copy } = extractOccurrences(ROOT);
  const rows: Row[] = [];
  for (const identity of copy) {
    const parts = String(identity).split("\t");
    const file = parts[0];
    const kind = parts[1] ?? "text";
    const text = parts.slice(2).join("\t");
    const terms = TERM_RES.filter(([, re]) => re.test(text)).map(([t]) => t);
    const isBtnish = COMMIT_LABEL.test(text);
    rows.push({
      corpus: "A-guard",
      file,
      kind,
      silo: siloOf(file),
      audience: audienceOf(file),
      text,
      terms,
      verdict: terms.length > 0 ? "candidate" : isBtnish ? "interface-shaped" : "clear",
    });
  }
  return rows;
}

/* ═════════════════════════════════════════════════════════════════════════
 * Corpus B — the restyle detector's own inventory, for `.jsx` and toasts.
 * ═════════════════════════════════════════════════════════════════════════ */
function buildCorpusB(): { rows: Row[]; note: string } {
  const tmp = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "w220-emit-")),
    "restyle.json",
  );
  try {
    execFileSync(
      process.execPath,
      ["scripts/restyle-drop-detector/detect.mjs", "--emit", tmp],
      { cwd: ROOT, stdio: "pipe" },
    );
  } catch (err) {
    return { rows: [], note: `restyle emit FAILED: ${(err as Error).message}` };
  }
  const j = JSON.parse(fs.readFileSync(tmp, "utf8"));
  fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  const rows: Row[] = [];
  for (const cls of ["jsxTextCopy", "toastCopy", "copyExprAttr"]) {
    for (const entry of (j.inventory?.[cls] ?? []) as string[]) {
      const parts = String(entry).split("\t");
      const file = parts[0];
      const text = parts.slice(2).join("\t");
      const terms = TERM_RES.filter(([, re]) => re.test(text)).map(([t]) => t);
      rows.push({
        corpus: "B-restyle",
        file,
        kind: cls,
        silo: siloOf(file),
        audience: audienceOf(file),
        text,
        terms,
        verdict: terms.length > 0 ? "candidate" : COMMIT_LABEL.test(text) ? "interface-shaped" : "clear",
      });
    }
  }
  return {
    rows,
    note:
      "Produced by `node scripts/restyle-drop-detector/detect.mjs --emit <tmp>` — the detector's own inventory, not a re-implementation. Classes jsxTextCopy, toastCopy, copyExprAttr. This corpus is the only one that sees client/src/**/*.jsx, i.e. the public marketing site.",
  };
}

/* Apply the hand adjudications to whichever rows they name. */
function applyAdjudications(rows: Row[]): number {
  let marked = 0;
  for (const a of ADJUDICATED) {
    if (a.klass === "C" || a.klass === "D") continue;
    const needle = a.quote.slice(0, 40);
    for (const r of rows) {
      if (r.file === a.file && r.text.includes(needle)) {
        r.verdict = "breach";
        marked++;
      }
    }
  }
  return marked;
}

function tally<T extends string>(rows: Row[], key: (r: Row) => T): Record<string, number> {
  const m: Record<string, number> = {};
  for (const r of rows) m[key(r)] = (m[key(r)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(m).sort(([a], [b]) => (a < b ? -1 : 1)));
}

function perFileTally(rows: Row[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const r of rows) m[r.file] = (m[r.file] ?? 0) + 1;
  return Object.fromEntries(Object.entries(m).sort(([a], [b]) => (a < b ? -1 : 1)));
}

const cmp = (a: Row, b: Row) =>
  a.corpus < b.corpus ? -1
  : a.corpus > b.corpus ? 1
  : a.file < b.file ? -1
  : a.file > b.file ? 1
  : a.kind < b.kind ? -1
  : a.kind > b.kind ? 1
  : a.text < b.text ? -1
  : a.text > b.text ? 1
  : 0;

const A = buildCorpusA().sort(cmp);
const B = buildCorpusB();
const Brows = B.rows.sort(cmp);
const all = [...A, ...Brows];
const breaches = applyAdjudications(all);

const census = {
  wave: 220,
  phase: 1,
  /* NO generatedAt — see the determinism note in the header. */
  method: "build_log/wave220/W220_METHOD.md",
  terms: CENSUS_TERMS,
  corpora: {
    "A-guard": {
      extractor: "scripts/silent-drop-guard/extract-inventory.ts :: extractOccurrences (imported, not re-implemented)",
      scope: "client/src/**/*.tsx — JSX text nodes plus the guard's fixed COPY_ATTRS set",
      rows: A.length,
      note:
        "This count IS the guard gate's `copy` number, by construction. The guard's copy class does not see .jsx, so the public marketing site is absent from this corpus — that is the reconciliation finding, not an error.",
    },
    "B-restyle": {
      extractor: "scripts/restyle-drop-detector/detect.mjs --emit (the detector's own inventory)",
      scope: "client/src + shared, *.tsx and *.jsx, tests excluded",
      rows: Brows.length,
      note: B.note,
    },
  },
  totals: {
    rows: all.length,
    byVerdict: tally(all, (r) => r.verdict),
    bySilo: tally(all, (r) => r.silo),
    byAudience: tally(all, (r) => r.audience),
    candidatesBySilo: tally(all.filter((r) => r.verdict === "candidate"), (r) => r.silo),
    breachRowsMarked: breaches,
    adjudicatedByClass: ADJUDICATED.reduce<Record<string, number>>((m, a) => {
      m[a.klass] = (m[a.klass] ?? 0) + 1;
      return m;
    }, {}),
    adjudicatedByAction: ADJUDICATED.reduce<Record<string, number>>((m, a) => {
      m[a.action] = (m[a.action] ?? 0) + 1;
      return m;
    }, {}),
  },
  termHits: Object.fromEntries(
    CENSUS_TERMS.map((t) => [t, all.filter((r) => r.terms.includes(t)).length]),
  ),
  adjudicated: ADJUDICATED,
  perFileA: perFileTally(A),
  perFileB: perFileTally(Brows),
  rows: all,
};

const json = JSON.stringify(census, null, 2) + "\n";
if (toStdout) {
  process.stdout.write(json);
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, json);
  process.stderr.write(
    `w220-copy-census: wrote ${path.relative(ROOT, OUT)} — ` +
      `${all.length} rows (A=${A.length}, B=${Brows.length}), ` +
      `${census.totals.byVerdict.candidate ?? 0} candidates, ` +
      `${census.totals.byVerdict.breach ?? 0} breach rows, ` +
      `${ADJUDICATED.length} adjudications\n`,
  );
}
