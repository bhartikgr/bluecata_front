/**
 * W3-B / C-5 — Accredited-investor self-certification clause + version
 * (CONFIGURABLE, NON-sacred).
 *
 * Single source of truth for the self-certification text, criteria list, and
 * version an individual reads and signs when they join the Collective as a
 * member (and any time they re-certify from settings). Both the client capture
 * surface and the server capture route import from here so the wording +
 * version never drift.
 *
 * Counsel's final copy can replace ACCREDITATION_CLAUSE_TEXT / criteria and bump
 * ACCREDITATION_CLAUSE_VERSION with NO code surgery — bumping the version tag
 * forces a fresh self-certification (12-month validity, note 3 in the draft).
 *
 * Intentionally dependency-free (no node:crypto) so it is safe to import from
 * the browser bundle. Any hashing lives server-side in investorComplianceRoutes.
 *
 * Seeded verbatim from capavate_work/ACCREDITATION_CLAUSE_DRAFT.md (approved
 * placeholder). NOT legal advice — pending external counsel finalization.
 */

/**
 * WAVE 215 — VERSION LADDER, NOT A REWRITE.
 *
 * `ACCRED-v0.2` is competent work and survives verbatim below: its one-of-N
 * criteria structure, its total-loss and illiquidity acknowledgement, its
 * twelve-month validity, its duty to notify and its express reliance are all
 * kept. `ACCRED-v0.3` is the SAME document with surgical corrections (draft
 * `build_log/legal/drafts/07_ACCREDITED_INVESTOR_SELF_CERTIFICATION_v3.md`):
 *   1. the declaration is selected BY JURISDICTION, and the single worldwide
 *      "I qualify under the laws of my home jurisdiction" catch-all is gone;
 *   2. the UK figures are corrected to £100,000 / £250,000 (S.I. 2024/301);
 *   3. no figure is asserted that Capavate's own regulatory research does not
 *      support — the criterion is stated without a number and flagged instead.
 *
 * v0.2's version tag, criteria and text are RETAINED (R195.5) so every existing
 * row remains readable and provable. Nothing here is deleted.
 *
 * HONEST LABEL — READ BEFORE BELIEVING THE OLD COMMENT BELOW. Bumping this tag
 * does NOT force a fresh self-certification. `hasAccreditedDeclaration()` and
 * `getAccreditationGateStatus()` in `server/investorComplianceRoutes.ts` compare
 * only the signature AGE against `ACCREDITATION_VALIDITY_DAYS`; neither compares
 * `clause_version` to anything. A version bump changes what NEW signers see and
 * surfaces a non-blocking "your declaration is on an older version" prompt. It
 * does not expire anyone, and it does not re-paper the void UK statements that
 * draft 07 change 3 requires to be re-papered. That gap is escalated in
 * `build_log/wave215/W215_FOR_THE_OWNER.md` rather than silently patched, because
 * the gate predicate is read by the concurrent partner money-event work.
 */
export const ACCREDITATION_CLAUSE_VERSION_V0_2 = "ACCRED-v0.2";
export const ACCREDITATION_CLAUSE_VERSION_V0_3 = "ACCRED-v0.3";

/** Version tag recorded on every self-certification. Bump to force re-signature. */
export const ACCREDITATION_CLAUSE_VERSION = ACCREDITATION_CLAUSE_VERSION_V0_3;

/** Self-certification validity window (drives when a re-attestation is prompted). */
export const ACCREDITATION_VALIDITY_DAYS = 365;

/**
 * Confidence in a threshold figure, carried on the criterion itself so the
 * surface can show it and no reader has to guess. R-ASSERT applies to legal
 * thresholds exactly as it does to money: a figure the platform cannot support
 * is not shown as a figure.
 *
 *  - `verified`         — the figure appears in the "Verified:" list at §14
 *                         Conflict 3 of `build_log/legal/REGULATORY_PERIMETER_RESEARCH.md`,
 *                         or in a primary source directly cited there.
 *  - `counsel_ratified` — no primary-source verification in that research, but
 *                         counsel draft 07 expressly keeps the wording (its
 *                         change 13 keeps the US criteria unchanged).
 *  - `unverified`       — the research does not support a figure. NO NUMBER IS
 *                         STATED. The criterion names the test only.
 */
export type ThresholdConfidence = "verified" | "counsel_ratified" | "unverified";

/** One selectable eligibility criterion. `region` is a short display tag. */
export interface AccreditationCriterion {
  id: string;
  region: string;
  label: string;
  /** v0.3 — the jurisdiction this criterion belongs to. Absent on v0.2 criteria. */
  jurisdiction?: AccreditationJurisdictionCode;
  /** v0.3 — how much the platform can stand behind any figure in `label`. */
  confidence?: ThresholdConfidence;
  /** v0.3 — shown next to an unverified criterion; names who must close the gap. */
  counselNote?: string;
  /** v0.3 — the authority the wording rests on. */
  source?: string;
}

/**
 * The nine jurisdictions the platform offers a declaration for. Ported from
 * `client/src/components/AccreditationForm.tsx`'s `ACCREDITATION_JURISDICTIONS`
 * — that component had the better jurisdiction model and the working path had
 * the better store, so the DATA moved to the store's side, not the reverse.
 */
export const ACCREDITATION_JURISDICTION_CODES = [
  "US",
  "CA",
  "UK",
  "EU",
  "SG",
  "HK",
  "IN",
  "JP",
  "AU",
] as const;

export type AccreditationJurisdictionCode = (typeof ACCREDITATION_JURISDICTION_CODES)[number];

export interface AccreditationJurisdictionDef {
  code: AccreditationJurisdictionCode;
  /** Country / bloc name, for the selector and for matching legacy free text. */
  name: string;
  /** Regime label, e.g. "UK — FCA HNW / self-certified sophisticated". */
  label: string;
  /** Extra names that should resolve to this code when reading legacy rows. */
  aliases: readonly string[];
}

export const ACCREDITATION_JURISDICTIONS_V0_3: readonly AccreditationJurisdictionDef[] = [
  { code: "US", name: "United States", label: "United States — Regulation D, Rule 501(a)", aliases: ["us", "usa", "u.s.", "u.s.a.", "united states of america", "america"] },
  { code: "CA", name: "Canada", label: "Canada — NI 45-106 accredited investor", aliases: ["ca", "can"] },
  { code: "UK", name: "United Kingdom", label: "United Kingdom — FCA high net worth / self-certified sophisticated", aliases: ["uk", "gb", "great britain", "england", "scotland", "wales", "northern ireland", "britain"] },
  { code: "EU", name: "European Economic Area", label: "European Economic Area — MiFID II professional client", aliases: ["eu", "eea", "europe", "european union"] },
  { code: "SG", name: "Singapore", label: "Singapore — SFA accredited investor", aliases: ["sg", "sgp"] },
  { code: "HK", name: "Hong Kong", label: "Hong Kong — SFO professional investor", aliases: ["hk", "hong kong sar", "hksar"] },
  { code: "IN", name: "India", label: "India — accredited investor", aliases: ["in", "ind"] },
  { code: "JP", name: "Japan", label: "Japan — FIEA professional investor", aliases: ["jp", "jpn"] },
  { code: "AU", name: "Australia", label: "Australia — Corporations Act s708 sophisticated / professional", aliases: ["au", "aus"] },
];

/**
 * Resolve a code, a country name or a legacy free-text jurisdiction string to one
 * of the nine codes. Returns `null` when it resolves to nothing — and `null` is
 * NEVER treated as a jurisdiction downstream (§5.7); it means "not recorded".
 */
export function resolveJurisdictionCode(raw: unknown): AccreditationJurisdictionCode | null {
  if (typeof raw !== "string") return null;
  const needle = raw.trim().toLowerCase();
  if (!needle) return null;
  for (const j of ACCREDITATION_JURISDICTIONS_V0_3) {
    if (needle === j.code.toLowerCase()) return j.code;
    if (needle === j.name.toLowerCase()) return j.code;
    if (j.aliases.includes(needle)) return j.code;
  }
  return null;
}

/**
 * Eligibility criteria — the investor checks all that apply. Server validates
 * that every submitted id is a known criterion for the served clause version.
 */
export const ACCREDITATION_CRITERIA_V0_2: AccreditationCriterion[] = [
  {
    id: "us_income",
    region: "US",
    label:
      "My individual income exceeded US$200,000 (or US$300,000 jointly with my spouse or spousal equivalent) in each of the two most recent years, and I reasonably expect the same for the current year.",
  },
  {
    id: "us_net_worth",
    region: "US",
    label:
      "My individual or joint net worth exceeds US$1,000,000, excluding the value of my primary residence.",
  },
  {
    id: "us_license",
    region: "US",
    label: "I hold, in good standing, a Series 7, Series 65, or Series 82 license.",
  },
  {
    id: "us_insider",
    region: "US",
    label: "I am a director, executive officer, or general partner of the issuer.",
  },
  {
    id: "us_entity",
    region: "US",
    label:
      "I am investing through an entity in which all equity owners are accredited investors, or an entity with assets exceeding US$5,000,000 not formed for the purpose of this investment.",
  },
  {
    id: "intl_equivalent",
    region: "INTL",
    label:
      "I qualify as a high-net-worth, sophisticated, professional, or accredited investor under the laws of my home jurisdiction (e.g. UK certified high-net-worth or self-certified sophisticated investor; EU/UK MiFID “professional client”; Canada NI 45-106 “accredited investor”; or the equivalent standard applicable to me), and the monetary thresholds I rely on are met in my local currency as of today.",
  },
];

/**
 * ════════════════════════════════════════════════════════════════════════════
 * WAVE 215 — RETAINED SUPERSEDED FIGURES (R143.1, R195.5).
 * ════════════════════════════════════════════════════════════════════════════
 * Every threshold figure this wave removed from a rendered criterion is kept
 * here, named, dated and reasoned. Nothing is silently dropped. NONE of these
 * is rendered to an investor: a superseded or unsupported figure shown as a
 * live criterion is worse than no figure at all.
 *
 * The UK entry is the one that mattered most. `AccreditationForm.tsx` carried
 * "£170K income or £430K net assets (PS22/10)" as a LIVE criterion. Those
 * figures were reduced with effect from 27 March 2024 by S.I. 2024/301 — "the
 * annual income condition has been reduced from £170,000 or more to £100,000 or
 * more, and the net assets condition has been reduced from £430,000 or more to
 * £250,000 or more" — and the transitional alternative ceased to have any effect
 * after 30 January 2025 ("After 30th January 2025, paragraphs (1) to (4) have no
 * effect for any purpose"). Any UK self-certification made on the old figures is
 * therefore VOID, not merely stale.
 *   https://www.legislation.gov.uk/uksi/2024/301/made
 */
export const SUPERSEDED_UK_THRESHOLD_PS22_10 = "£170K income or £430K net assets (PS22/10)";

/**
 * Figures removed because Capavate's own regulatory research does not support
 * them, keyed by the criterion they used to sit on. `reason` quotes the
 * research. R-ASSERT: the platform does not assert a legal threshold it cannot
 * support, exactly as it does not assert a money amount it cannot support.
 */
export const UNSUPPORTED_THRESHOLD_FIGURES_REMOVED_W215: readonly {
  jurisdiction: AccreditationJurisdictionCode;
  figure: string;
  reason: string;
}[] = [
  {
    jurisdiction: "AU",
    figure: "A$2.5M net assets or A$250K gross income for last 2 yrs (s708(8)(c))",
    reason:
      "REGULATORY_PERIMETER_RESEARCH.md §6.6: \"The specific dollar figures in the regulations were not verified — see §15.\" Draft 07 C6 repeats the [UNVERIFIED] marking. The s708(8)(c) route turns on a qualified accountant's certificate dated no more than 6 months before the offer, which IS verified; the regulation figures are not.",
  },
  {
    jurisdiction: "CA",
    figure: "C$200K individual / C$300K combined; net financial assets > C$1M before tax",
    reason:
      "REGULATORY_PERIMETER_RESEARCH.md §6.2: \"NI 45-106's accredited-investor definition and the specific Canadian advertising restrictions were not verified from primary sources in this research.\" Draft 07 C7 marks Canada \"[FOR COUNSEL — NOT YET DRAFTABLE.]\"",
  },
  {
    jurisdiction: "EU",
    figure: "Two of: €500K portfolio, 10 trades/qtr, 1 yr finance role",
    reason:
      "The research verifies only MiFID II Annex II Section I(1)–(4) (per-se professional) via ECSPR Art 2(1)(j). Annex II Section II — the ELECTIVE criteria these figures come from — is never quoted, and the EU row of the §6.7 table is marked \"unverified\".",
  },
  {
    jurisdiction: "IN",
    figure: "Net worth ≥ ₹7.5cr; investment ≥ ₹75L; body corporate net worth ≥ ₹50cr",
    reason:
      "India does not appear anywhere in REGULATORY_PERIMETER_RESEARCH.md — not in the §6.7 cross-jurisdiction table, not in the §14 Conflict 3 \"Verified:\" list, and not in §15. There is no research behind any Indian figure.",
  },
  {
    jurisdiction: "JP",
    figure: "Securities ≥ ¥1bn; net assets ≥ ¥300M; financial assets ≥ ¥300M; 1 yr account",
    reason:
      "Japan does not appear anywhere in REGULATORY_PERIMETER_RESEARCH.md. Same position as India: no research behind any Japanese figure.",
  },
  {
    jurisdiction: "SG",
    figure: "Net financial assets > S$1M",
    reason:
      "The research's verified Singapore limbs are net personal assets > S$2m (primary residence capped at S$1m of that), income ≥ S$300,000, and corporation net assets > S$10m. A separate \"net financial assets > S$1m\" limb is not among them.",
  },
];

/**
 * ════════════════════════════════════════════════════════════════════════════
 * `ACCRED-v0.3` — PER-JURISDICTION CRITERIA.
 * ════════════════════════════════════════════════════════════════════════════
 * Ported from `AccreditationForm.tsx`'s `PATHWAYS`, then audited criterion by
 * criterion against `build_log/legal/REGULATORY_PERIMETER_RESEARCH.md` and
 * `build_log/legal/drafts/07_ACCREDITED_INVESTOR_SELF_CERTIFICATION_v3.md`.
 *
 * THERE IS NO CROSS-JURISDICTION CRITERION HERE, AND THERE MUST NEVER BE ONE.
 * The research's own drafting consequence, §14 Conflict 3: "there is no such
 * thing as a global 'I am a sophisticated investor' checkbox." Draft 07's first
 * change is the removal of exactly that catch-all. Five of the surveyed regimes
 * are mutually incompatible, and the DIFC professional-client promotion
 * exemption excludes individuals altogether — so a blanket tick is not merely
 * imprecise, it is unusable as evidence anywhere.
 *
 * NO CURRENCY IS CONVERTED OR NORMALISED (R156.1). Each threshold stays in the
 * currency its own regulator wrote it in. Nothing here is arithmetic: these are
 * display strings and selection ids.
 */
export const ACCREDITATION_JURISDICTION_CRITERIA: Record<
  AccreditationJurisdictionCode,
  AccreditationCriterion[]
> = {
  /* ── United States ────────────────────────────────────────────────────────
     Kept verbatim from v0.2. Draft 07 change 13: "The existing US criteria are
     kept unchanged | They are correct as drafted". Marked counsel_ratified and
     NOT verified, because the perimeter research never verifies Rule 501(a)'s
     natural-person thresholds. The $200,000/$1,000,000 pair the research DOES
     verify is the Rule 506(c) minimum-investment safe harbour — a different
     quantity that happens to share a number, and mistaking one for the other is
     precisely the trap R-ASSERT exists to stop. */
  US: [
    {
      id: "us_income",
      region: "US",
      jurisdiction: "US",
      confidence: "counsel_ratified",
      source: "Draft 07 §C1 (Rule 501(a); SEC Rule 506(b) guidance)",
      label:
        "My individual income exceeded US$200,000 (or US$300,000 jointly with my spouse or spousal equivalent) in each of the two most recent years, and I reasonably expect the same for the current year.",
    },
    {
      id: "us_net_worth",
      region: "US",
      jurisdiction: "US",
      confidence: "counsel_ratified",
      source: "Draft 07 §C1 (Rule 501(a))",
      label:
        "My individual or joint net worth exceeds US$1,000,000, excluding the value of my primary residence.",
    },
    {
      id: "us_license",
      region: "US",
      jurisdiction: "US",
      confidence: "counsel_ratified",
      source: "Draft 07 §C1 (Rule 501(a))",
      label: "I hold, in good standing, a Series 7, Series 65, or Series 82 license.",
    },
    {
      id: "us_insider",
      region: "US",
      jurisdiction: "US",
      confidence: "counsel_ratified",
      source: "Draft 07 §C1 (Rule 501(a))",
      label: "I am a director, executive officer, or general partner of the issuer.",
    },
    {
      id: "us_entity",
      region: "US",
      jurisdiction: "US",
      confidence: "counsel_ratified",
      source: "Draft 07 §C1 (Rule 501(a))",
      label:
        "I am investing through an entity in which all equity owners are accredited investors, or an entity with assets exceeding US$5,000,000 not formed for the purpose of this investment.",
    },
  ],

  /* ── United Kingdom — THE CORRECTION THIS WAVE EXISTS FOR ─────────────────
     £100,000 income / £250,000 net assets, per S.I. 2024/301 in force
     27 March 2024, as reflected in the FCA's own statement forms (COBS 4
     Annex 2R / Annex 4R). The superseded £170,000/£430,000 pair is retained,
     unrendered, in SUPERSEDED_UK_THRESHOLD_PS22_10 above. */
  UK: [
    {
      id: "uk_hnw_income",
      region: "UK",
      jurisdiction: "UK",
      confidence: "verified",
      source: "S.I. 2024/301; FCA COBS 4 Annex 2R (high net worth investor statement)",
      label:
        "In the last financial year I had an annual income of £100,000 or more. Income does not include any one-off pension withdrawals.",
    },
    {
      id: "uk_hnw_net_assets",
      region: "UK",
      jurisdiction: "UK",
      confidence: "verified",
      source: "S.I. 2024/301; FCA COBS 4 Annex 2R",
      label:
        "In the last financial year I had net assets of £250,000 or more. Net assets do not include my home (primary residence), my pension or any pension withdrawals, or any rights under qualifying contracts of insurance.",
    },
    {
      id: "uk_self_certified_sophisticated",
      region: "UK",
      jurisdiction: "UK",
      confidence: "verified",
      source: "S.I. 2024/301; FPO Art 50A; FCA COBS 4 Annex 4R",
      label:
        "In the last two years I have done at least one of: worked in private equity or in the provision of finance for small and medium enterprises; been the director of a company with an annual turnover of at least £1 million; made two or more investments in an unlisted company; or been a member of a network or syndicate of business angels for more than six months.",
    },
    {
      id: "uk_professional_client",
      region: "UK",
      jurisdiction: "UK",
      confidence: "unverified",
      counselNote:
        "UK counsel to confirm the professional-client criteria and their evidence requirements. No figure is stated because none could be confirmed from a primary source.",
      source: "No primary source in REGULATORY_PERIMETER_RESEARCH.md",
      label:
        "I have been categorised by an authorised firm as a professional client, either per se or on an elective basis.",
    },
  ],

  /* ── Canada — no figure is stated, on purpose ─────────────────────────── */
  CA: [
    {
      id: "ca_accredited_investor",
      region: "CA",
      jurisdiction: "CA",
      confidence: "unverified",
      counselNote:
        "Canadian counsel must confirm the NI 45-106 tests and figures before this criterion is relied on. Draft 07 §C7 marks Canada not yet draftable.",
      source: "NI 45-106 — definition not confirmed from a primary source in Capavate's research",
      label:
        "I meet the accredited-investor definition in National Instrument 45-106 that applies to me. (No threshold is stated here: the figures are unverified in Capavate's regulatory research.)",
    },
    {
      id: "ca_permitted_client",
      region: "CA",
      jurisdiction: "CA",
      confidence: "unverified",
      counselNote: "Canadian counsel to confirm the NI 31-103 permitted-client tests.",
      source: "NI 31-103 — no primary source in Capavate's research",
      label: "I am a permitted client within the meaning of National Instrument 31-103.",
    },
  ],

  /* ── European Economic Area ───────────────────────────────────────────── */
  EU: [
    {
      id: "eu_professional_per_se",
      region: "EU",
      jurisdiction: "EU",
      confidence: "verified",
      source: "MiFID II Annex II Section I(1)–(4), via ECSPR Art 2(1)(j)",
      label:
        "I am a per-se professional client within MiFID II Annex II Section I(1) to (4) — for example a credit institution, another authorised or regulated financial firm, or a large undertaking meeting that Section's tests.",
    },
    {
      id: "eu_professional_elective",
      region: "EU",
      jurisdiction: "EU",
      confidence: "unverified",
      counselNote:
        "EU counsel to confirm the elective professional-client criteria. No figure is stated because MiFID II Annex II Section II was not read from a primary source in Capavate's research. Separately, whether a pooled vehicle engages the EU fund-management regime is flagged there as the highest-priority EU question.",
      source: "MiFID II Annex II Section II — not read from a primary source in Capavate's research",
      label:
        "I have been assessed by an authorised firm and treated as an elective professional client under MiFID II Annex II Section II. (No threshold is stated here: the elective criteria are unverified in Capavate's regulatory research.)",
    },
  ],

  /* ── Singapore ────────────────────────────────────────────────────────── */
  SG: [
    {
      id: "sg_net_personal_assets",
      region: "SG",
      jurisdiction: "SG",
      confidence: "verified",
      source: "MAS consultation annex reproducing the accredited-investor provisions",
      label:
        "My net personal assets are more than S$2 million, counting the estimated fair market value of my primary residence (less any outstanding amount on a credit facility secured on it) for no more than S$1 million of that total.",
    },
    {
      id: "sg_income",
      region: "SG",
      jurisdiction: "SG",
      confidence: "verified",
      source: "MAS consultation annex",
      label: "My income in the preceding 12 months was at least S$300,000.",
    },
    {
      id: "sg_entity_net_assets",
      region: "SG",
      jurisdiction: "SG",
      confidence: "verified",
      source: "MAS consultation annex",
      label: "I am declaring for an entity whose net assets are more than S$10 million.",
    },
    {
      id: "sg_net_financial_assets",
      region: "SG",
      jurisdiction: "SG",
      confidence: "unverified",
      counselNote:
        "Singapore counsel to confirm this limb and its figure. Capavate's research read the Singapore provisions only from a MAS consultation annex, not the live statute.",
      source: "Not among the Singapore limbs Capavate's research could source",
      label:
        "I meet the net-financial-assets limb of the Singapore accredited-investor definition that applies to me. (No threshold is stated here: this limb's figure is unverified in Capavate's regulatory research.)",
    },
  ],

  /* ── Hong Kong — a PORTFOLIO test, not a net-worth test ───────────────── */
  HK: [
    {
      id: "hk_individual_portfolio",
      region: "HK",
      jurisdiction: "HK",
      confidence: "verified",
      source: "SFC FAQs on Part IV of the SFO; Securities and Futures (Professional Investor) Rules",
      label:
        "I hold a portfolio of not less than HK$8 million, or its foreign-currency equivalent. For this purpose a portfolio means securities, money held by a custodian, or certificates of deposit issued by an authorised financial institution or a bank regulated outside Hong Kong — it does not include real estate, private business interests or pensions.",
    },
    {
      id: "hk_entity_portfolio_or_assets",
      region: "HK",
      jurisdiction: "HK",
      confidence: "verified",
      source: "SFC FAQs on Part IV of the SFO",
      label:
        "I am declaring for a corporation or partnership that holds a portfolio of not less than HK$8 million, or total assets of not less than HK$40 million.",
    },
  ],

  /* ── Australia ────────────────────────────────────────────────────────── */
  AU: [
    {
      id: "au_minimum_subscription",
      region: "AU",
      jurisdiction: "AU",
      confidence: "verified",
      source: "Corporations Act 2001 (Cth) s708(8)(a)–(b)",
      label:
        "The minimum amount payable by me for this investment is at least A$500,000, or that amount together with amounts I have already paid for securities of the same class totals at least A$500,000. Amounts paid out of money lent by the person offering the securities, or an associate, do not count.",
    },
    {
      id: "au_accountant_certificate",
      region: "AU",
      jurisdiction: "AU",
      confidence: "unverified",
      counselNote:
        "The 6-month certificate requirement is confirmed from the statute; the net-asset and gross-income figures set by the regulations are not, and Australian counsel must confirm them. The certificate must be valid at the date of EACH offer, which is shorter than the UK's 12 months — Capavate does not yet re-check it per offer.",
      source: "Corporations Act 2001 (Cth) s708(8)(c) — regulation figures unsourced",
      label:
        "I hold a certificate from a qualified accountant, given no more than 6 months before this offer is made, stating that I have the net assets or the gross income specified in the regulations. (No figure is stated here: the regulation figures are unverified in Capavate's regulatory research.)",
    },
    {
      id: "au_professional_gross_assets",
      region: "AU",
      jurisdiction: "AU",
      confidence: "verified",
      source: "Corporations Act 2001 (Cth) s708(11)",
      label: "I have or control gross assets of at least A$10 million.",
    },
  ],

  /* ── India — NOT RESEARCHED. No figure is invented. ───────────────────── */
  IN: [
    {
      id: "in_accredited_individual",
      region: "IN",
      jurisdiction: "IN",
      confidence: "unverified",
      counselNote:
        "Indian counsel must state the applicable test and its figures. India was not covered at all by Capavate's regulatory research, so nothing here rests on a source.",
      source: "India is absent from REGULATORY_PERIMETER_RESEARCH.md",
      label:
        "I am an accredited investor as an individual under the Indian accredited-investor framework that applies to me. (No threshold is stated here: India was not covered by Capavate's regulatory research.)",
    },
    {
      id: "in_accredited_body_corporate",
      region: "IN",
      jurisdiction: "IN",
      confidence: "unverified",
      counselNote: "Indian counsel must state the applicable test and its figures.",
      source: "India is absent from REGULATORY_PERIMETER_RESEARCH.md",
      label:
        "I am declaring for a body corporate that is an accredited investor under the Indian framework that applies to it. (No threshold is stated here: India was not covered by Capavate's regulatory research.)",
    },
  ],

  /* ── Japan — NOT RESEARCHED. No figure is invented. ──────────────────── */
  JP: [
    {
      id: "jp_qualified_institutional_investor",
      region: "JP",
      jurisdiction: "JP",
      confidence: "unverified",
      counselNote:
        "Japanese counsel must state the applicable test and its figures. Japan was not covered at all by Capavate's regulatory research.",
      source: "Japan is absent from REGULATORY_PERIMETER_RESEARCH.md",
      label:
        "I am a qualified institutional investor within the meaning of the Financial Instruments and Exchange Act. (No threshold is stated here: Japan was not covered by Capavate's regulatory research.)",
    },
    {
      id: "jp_professional_investor",
      region: "JP",
      jurisdiction: "JP",
      confidence: "unverified",
      counselNote: "Japanese counsel must state the applicable test and its figures.",
      source: "Japan is absent from REGULATORY_PERIMETER_RESEARCH.md",
      label:
        "I have been treated as a professional investor under the Financial Instruments and Exchange Act. (No threshold is stated here: Japan was not covered by Capavate's regulatory research.)",
    },
  ],
};

/**
 * The served criteria for the CURRENT clause version — every jurisdiction's
 * criteria, flattened. Deliberately contains NO cross-jurisdiction criterion.
 */
export const ACCREDITATION_CRITERIA: AccreditationCriterion[] =
  ACCREDITATION_JURISDICTION_CODES.flatMap((code) => ACCREDITATION_JURISDICTION_CRITERIA[code]);

/**
 * Criteria as they were when a given clause version was signed, so an existing
 * row's ids always resolve to the labels the investor actually read. Without
 * this a v0.2 row's `intl_equivalent` would render as a bare unresolved id.
 */
export function criteriaForVersion(version: string): AccreditationCriterion[] {
  if (version === ACCREDITATION_CLAUSE_VERSION_V0_2) return ACCREDITATION_CRITERIA_V0_2;
  return ACCREDITATION_CRITERIA;
}

/**
 * Every criterion id the platform has ever served, across all versions. The
 * capture route validates against THIS union rather than the current set, so a
 * legacy row can still be read back and re-affirmed. Being accepted here does
 * NOT make an id selectable: only `ACCREDITATION_CRITERIA` is served.
 */
export const ALL_KNOWN_CRITERION_IDS: readonly string[] = Array.from(
  new Set([
    ...ACCREDITATION_CRITERIA_V0_2.map((c) => c.id),
    ...ACCREDITATION_CRITERIA.map((c) => c.id),
  ]),
);

/**
 * Ids that exist ONLY in a superseded version. `intl_equivalent` is the global
 * catch-all tick this wave closed: it is readable and re-affirmable by an
 * investor who already signed it, and it can never be freshly selected.
 */
export const SUPERSEDED_ONLY_CRITERION_IDS: readonly string[] = ACCREDITATION_CRITERIA_V0_2.filter(
  (c) => !ACCREDITATION_CRITERIA.some((cur) => cur.id === c.id),
).map((c) => c.id);

/**
 * The viewable, read-only self-certification body shown before the investor
 * checks criteria and types their full legal name. Placeholder DRAFT (see
 * version tag) — pending external counsel finalization.
 */
export const ACCREDITATION_CLAUSE_TEXT_V0_2 = `# Accredited / Eligible Investor Self-Certification (ACCRED-v0.2)

By signing below with my full legal name, I certify that I qualify as an accredited, sophisticated, or otherwise eligible investor under the laws of my jurisdiction, on the basis of at least ONE of the criteria I have checked above (US Regulation D, Rule 501(a), or my home-jurisdiction equivalent).

I further acknowledge and agree that:
1. Private investments are high-risk and illiquid, and I may lose my entire investment; they are not registered with or approved by any securities regulator.
2. The information in this certification is true and accurate as of the date signed, and I will promptly notify Capavate if it ceases to be true.
3. This self-certification is valid for twelve (12) months from the date signed, after which I may be asked to re-certify.
4. Capavate and issuers may rely on this certification, and Capavate may request additional documentation or third-party verification where applicable law requires it.`;

/**
 * `ACCRED-v0.3` — v0.2 VERSIONED FORWARD, NOT REWRITTEN.
 *
 * Paragraphs 1 to 4 of v0.2 are carried over word for word: the total-loss and
 * illiquidity warning, the truth-and-notify duty, the twelve-month validity and
 * the reliance clause were all correct and are not touched. Exactly four things
 * change, each one a defect this wave was asked to correct:
 *
 *   • the opening sentence is bound to ONE named jurisdiction and to criteria
 *     drawn only from that jurisdiction, replacing v0.2's "the laws of my
 *     jurisdiction … or my home-jurisdiction equivalent" catch-all;
 *   • new paragraph 5 states in plain words that this is a declaration Capavate
 *     RECORDS, and that Capavate does not verify it and does not perform any
 *     verification on the investor's behalf;
 *   • new paragraph 6 discloses that some criteria are marked as awaiting
 *     confirmation by local counsel, and that a criterion marked that way names
 *     the test without stating a threshold figure;
 *   • new paragraph 7 records what Capavate stores as evidence, so the investor
 *     knows before signing that the time, the network address and the exact
 *     wording shown are retained.
 *
 * The word "verified" is used in this text ONLY inside the sentence that denies
 * that Capavate verifies anything.
 */
export const ACCREDITATION_CLAUSE_TEXT_V0_3 = `# Accredited / Eligible Investor Self-Certification (ACCRED-v0.3)

By signing below with my full legal name, I declare that I qualify as an accredited, sophisticated, professional, or otherwise eligible investor under the law of the single jurisdiction I have selected above, on the basis of at least ONE of the criteria I have checked for that jurisdiction. I understand that each jurisdiction sets its own test, that these tests are not interchangeable, and that I am not making any declaration about any jurisdiction other than the one I selected.

I further acknowledge and agree that:
1. Private investments are high-risk and illiquid, and I may lose my entire investment; they are not registered with or approved by any securities regulator.
2. The information in this declaration is true and accurate as of the date signed, and I will promptly notify Capavate if it ceases to be true.
3. This self-certification is valid for twelve (12) months from the date signed, after which I may be asked to re-certify. My own jurisdiction may impose a shorter period, and where it does, that shorter period governs.
4. Capavate and issuers may rely on this declaration, and Capavate may request additional documentation or third-party verification where applicable law requires it.
5. This is my declaration about myself. Capavate records it; Capavate does not confirm it, does not assess whether it is correct, and does not perform any verification on my behalf. Where the law requires an issuer to take reasonable steps to confirm an investor's status, that obligation rests with the issuer and with me, not with Capavate.
6. Some criteria are shown as awaiting confirmation by local counsel. A criterion marked that way states the test it relies on without stating a threshold figure, because Capavate will not state a figure it cannot support from a primary source. If I am relying on such a criterion, I am relying on my own understanding of my own law, or on my own advisers.
7. To make this declaration provable later, Capavate records the name I type, the date and time its own server observes, the network address its own server observes, my browser identification, the jurisdiction and criteria I selected, and the exact wording of this document as it was shown to me.`;

/** The clause body for the current version. Always matches ACCREDITATION_CLAUSE_VERSION. */
export const ACCREDITATION_CLAUSE_TEXT = ACCREDITATION_CLAUSE_TEXT_V0_3;

/**
 * The exact wording a given version showed, so a stored declaration can be
 * re-displayed as signed. A version this build does not know returns `null`
 * rather than the current text — showing today's words as though they were the
 * words someone signed is the specific failure R187.3 exists to prevent.
 */
export function clauseTextForVersion(version: string): string | null {
  if (version === ACCREDITATION_CLAUSE_VERSION_V0_2) return ACCREDITATION_CLAUSE_TEXT_V0_2;
  if (version === ACCREDITATION_CLAUSE_VERSION_V0_3) return ACCREDITATION_CLAUSE_TEXT_V0_3;
  return null;
}

/** The explicit acknowledgment the investor ticks before signing. */
export const ACCREDITATION_CLAUSE_ACK =
  "I have read, understood, and agree to the above certification, and I am signing it with my full legal name.";
