/**
 * v25.49 Phase-4 — CANONICAL SPV Engine shared DTOs + enums.
 *
 * One engine, many CONTEXTS. An SPV is ALWAYS owned by the sponsoring
 * Consortium Partner as GP; Collective / Capavate / Partner are entry points
 * and visibility scopes over the SAME store (mirrors the Messages/Posts
 * one-store-many-contexts pattern). A Fund is simply an SPV with
 * spvType = "fund".
 *
 * These types live in shared/ so client wizard + server store + tests all
 * speak the same vocabulary with zero client↔server runtime imports. Money is
 * always integer minor units + an ISO-4217 currency string — never floats.
 */

/* ── enums ─────────────────────────────────────────────────────────────── */

/* v25.50.0 Phase 4 (spec 3c) — extended ADDITIVELY. The wizard surfaces five
 * GP-facing choices; the first three enum values pre-date this wave and are
 * left untouched so existing rows/tests keep validating. */
export const SPV_TYPES = ["spv", "fund", "syndicate", "multi_asset", "rolling_fund"] as const;
export type SpvType = (typeof SPV_TYPES)[number];

/** GP-facing labels + one-line help for the SPV Type dropdown (spec 3c). */
export const SPV_TYPE_LABELS: Record<SpvType, string> = {
  spv: "SPV: Single Deal",
  multi_asset: "SPV: Multi-Asset / Deal-by-Deal",
  syndicate: "Syndicate",
  fund: "Fund",
  rolling_fund: "Rolling Fund",
};
/* ══════════════════════════════════════════════════════════════════════════════
 * WAVE 169 · R77 — THE LAUNCH CONTROL AND ITS CONFIRMATION NAME THE VEHICLE.
 * ══════════════════════════════════════════════════════════════════════════════
 * A GP who selected "Fund" pressed a button reading "Launch SPV" and was then told
 * "SPV launched". Both are DRIVEN by the selected type here rather than branched
 * per type in the component, for the same reason the labels and help text above
 * live here: one table, five types, and a new type cannot be added without a
 * reviewer seeing that its wording is missing.
 *
 * `spv` and `multi_asset` keep "Launch SPV" / "SPV launched" verbatim — both ARE
 * special-purpose vehicles (see `SPV_TYPE_LABELS`), so their existing wording was
 * never wrong and is not churned. Sentence case follows the platform's own
 * convention for the other three.
 * ═══════════════════════════════════════════════════════════════════════════ */
export const SPV_LAUNCH_BUTTON_LABELS: Record<SpvType, string> = {
  spv: "Launch SPV",
  multi_asset: "Launch SPV",
  syndicate: "Launch syndicate",
  fund: "Launch fund",
  rolling_fund: "Launch rolling fund",
};
export const SPV_LAUNCHED_TOAST_TITLES: Record<SpvType, string> = {
  spv: "SPV launched",
  multi_asset: "SPV launched",
  syndicate: "Syndicate launched",
  fund: "Fund launched",
  rolling_fund: "Rolling fund launched",
};

/** The launch control's label for `spvType`, falling back to the single-deal
 *  wording for an unrecognised value — never a blank button. */
export function spvLaunchButtonLabel(spvType?: string | null): string {
  const key = typeof spvType === "string" ? spvType.trim() : "";
  return (SPV_LAUNCH_BUTTON_LABELS as Record<string, string>)[key] ?? SPV_LAUNCH_BUTTON_LABELS.spv;
}

/** The confirmation title for `spvType`, same fallback and same reason. */
export function spvLaunchedToastTitle(spvType?: string | null): string {
  const key = typeof spvType === "string" ? spvType.trim() : "";
  return (SPV_LAUNCHED_TOAST_TITLES as Record<string, string>)[key] ?? SPV_LAUNCHED_TOAST_TITLES.spv;
}

export const SPV_TYPE_HELP: Record<SpvType, string> = {
  spv: "One vehicle, one company. The classic single-asset SPV.",
  multi_asset: "One vehicle that invests in several companies, deal-by-deal, as opportunities arise.",
  syndicate: "A lead + backers co-investing per deal, typically with carry to the lead.",
  fund: "A committed-capital fund deploying across a portfolio under a single mandate.",
  rolling_fund: "A subscription-style fund that raises and deploys in recurring quarterly cycles.",
};

/**
 * WAVE 3C / J-1 — the strict legal-entity jurisdiction enum, WIDENED from the
 * original four members to cover the whole 15-country ontology that already
 * lived below at SPV_TOP_JURISDICTION_COUNTRIES / SPV_JURISDICTION_ENTITY_
 * STRUCTURES.
 *
 * WHY: the four-member enum was the downstream choke point that defeated the
 * ontology. Every country that was not US / Cayman / BVI / Canada was coerced
 * to "delaware" (client deriveEngineJurisdiction, server canonicalJurisdiction
 * fallbacks), which made a Dutch B.V. or a Mauritius GBC render US securities
 * copy (Form D, blue-sky, 3(c)(1), EIN). Widening the enum is the ONLY way to
 * keep the country a non-US GP chose all the way down to the compliance UI.
 *
 * The first four members are UNCHANGED in value and order so every existing
 * row, fixture and test keeps validating. "other" is an explicit escape hatch
 * for a free-text / unmapped country: it is a REAL value meaning "we do not
 * know this jurisdiction", which is strictly better than silently claiming
 * Delaware.
 */
export const SPV_JURISDICTIONS = [
  /* pre-existing four — DO NOT reorder or rename (persisted values) */
  "delaware", "cayman", "bvi", "canadian_lp",
  /* WAVE 3C / J-1 — additive, one per remaining ontology country */
  "united_kingdom", "singapore", "luxembourg", "ireland", "hong_kong",
  "uae", "jersey", "guernsey", "netherlands", "mauritius", "australia",
  /* explicit "we do not know" — never silently a US jurisdiction */
  "other",
] as const;
export type SpvJurisdiction = (typeof SPV_JURISDICTIONS)[number];
export const SPV_JURISDICTION_UNKNOWN: SpvJurisdiction = "other";

export const SPV_STATUSES = [
  "draft", "open", "closed", "deployed", "distributing", "wound_down",
] as const;
export type SpvStatus = (typeof SPV_STATUSES)[number];

/** Distribution scope controls discovery/subscribe, INDEPENDENT of the mandate.
 *  `collective_only` is FIRST-CLASS: such SPVs must NOT appear on core Capavate
 *  investor surfaces. */
export const SPV_DISTRIBUTION_SCOPES = [
  "private", "collective_only", "network", "invite_only",
] as const;
export type SpvDistributionScope = (typeof SPV_DISTRIBUTION_SCOPES)[number];
export const SPV_DEFAULT_SCOPE: SpvDistributionScope = "private";

/** Carry basis — GP MUST choose explicitly at creation (no default). */
export const SPV_CARRY_BASES = ["per_deployment", "whole_spv"] as const;
export type SpvCarryBasis = (typeof SPV_CARRY_BASES)[number];

/**
 * LP co-investor visibility (Phase-4B / Ozan decision #5) — a per-SPV toggle
 * the GP chooses. own_only (default): each LP sees ONLY their own position.
 * co_investors: LPs can see co-investors' identities + commitments (a
 * transparent club-deal model). The founder/target NEVER sees the LP roster
 * in either mode (Private Investor contract, enforced server-side).
 */
export const SPV_LP_VISIBILITIES = ["own_only", "co_investors"] as const;
export type SpvLpVisibility = (typeof SPV_LP_VISIBILITIES)[number];
export const SPV_DEFAULT_LP_VISIBILITY: SpvLpVisibility = "own_only";

/* v25.50.0 Phase 4 (spec 3d) — extended ADDITIVELY (open/deal_specific pre-date
 * this wave). */
export const SPV_MANDATE_MODES = ["deal_specific", "open", "thesis_lp_approval", "sector_restricted"] as const;
export type SpvMandateMode = (typeof SPV_MANDATE_MODES)[number];

/** GP-facing labels + help for the Mandate mode dropdown (spec 3d). */
export const SPV_MANDATE_MODE_LABELS: Record<SpvMandateMode, string> = {
  deal_specific: "Deal-Specific (Single Asset)",
  open: "Open / Thesis-Driven (Blind Pool)",
  thesis_lp_approval: "Thesis with LP Approval",
  sector_restricted: "Sector / Stage-Restricted",
};
export const SPV_MANDATE_MODE_HELP: Record<SpvMandateMode, string> = {
  deal_specific: "The vehicle targets one specific, pre-identified company. LPs know exactly what they're funding.",
  open: "A blind pool: LPs back your thesis and you deploy at your discretion within the stated scope.",
  thesis_lp_approval: "You source under a thesis, but each deployment is put to LPs for approval before it closes.",
  sector_restricted: "A blind pool constrained to specific sectors and/or stages defined in the mandate rules.",
};

/** Spec 3b — curated TOP 10 global SPV jurisdictions (proper names, no
 * abbreviations). A country jurisdiction, DISTINCT from the legal-entity
 * `SPV_JURISDICTIONS` enum the engine still uses. Free-text "Other" is handled
 * separately by the wizard. */
export const SPV_TOP_JURISDICTION_COUNTRIES: readonly string[] = [
  "United States",
  "Cayman Islands",
  "British Virgin Islands",
  "United Kingdom",
  "Singapore",
  "Luxembourg",
  "Ireland",
  "Canada",
  "Hong Kong",
  "United Arab Emirates",
  // 2a — expanded 10→15 (existing 10 first, then the additive five per
  // JURISDICTION_ENTITY_MAP.md). Free-text "Other" is handled by the wizard.
  "Jersey",
  "Guernsey",
  "Netherlands",
  "Mauritius",
  "Australia",
] as const;

/** 2a — dependent Legal-entity-structure options per jurisdiction country
 *  (JURISDICTION_ENTITY_MAP.md). The wizard drives this dropdown off the
 *  selected `jurisdictionCountry`, resets the value to the list's first option
 *  on country change, and every list ends with "Other (specify)" so a GP can
 *  always type a bespoke structure. This is PURELY additive display metadata:
 *  the chosen structure is captured on `terms.legalEntityStructure` and the
 *  engine's strict `SPV_JURISDICTIONS` enum is left completely untouched
 *  (rule #8 — no enum change, no migration). Keyed by the exact country label
 *  above; the "Other" jurisdiction is free-form for BOTH fields. */
export const SPV_JURISDICTION_ENTITY_STRUCTURES: Record<string, string[]> = {
  "United States": ["Delaware LLC", "Delaware LP", "Delaware Series LLC", "Delaware C-Corp", "Other (specify)"],
  "Cayman Islands": ["Exempted Company", "Exempted Limited Partnership (ELP)", "Segregated Portfolio Company (SPC)", "LLC", "Other (specify)"],
  "British Virgin Islands": ["BVI Business Company", "Limited Partnership", "Segregated Portfolio Company", "Other (specify)"],
  "United Kingdom": ["Private Limited Company (Ltd)", "Limited Partnership (LP)", "Limited Liability Partnership (LLP)", "Scottish Limited Partnership", "Other (specify)"],
  "Singapore": ["Private Limited Company (Pte Ltd)", "Variable Capital Company (VCC)", "Limited Partnership", "Other (specify)"],
  "Luxembourg": ["Reserved Alternative Investment Fund (RAIF)", "Special Limited Partnership (SCSp)", "Private Limited Company (S.à r.l.)", "SICAV-SIF", "Other (specify)"],
  "Ireland": ["Irish Collective Asset-management Vehicle (ICAV)", "Investment Limited Partnership (ILP)", "Private Limited Company (LTD)", "Other (specify)"],
  "Canada": ["Limited Partnership", "Corporation (Inc.)", "Ontario LP", "Other (specify)"],
  "Hong Kong": ["Private Limited Company", "Limited Partnership Fund (LPF)", "Open-ended Fund Company (OFC)", "Other (specify)"],
  "United Arab Emirates": ["ADGM Special Purpose Vehicle", "DIFC Special Purpose Company", "ADGM Investment Company", "Free Zone Company", "Other (specify)"],
  "Jersey": ["Private Limited Company", "Limited Partnership", "Incorporated Cell Company", "Other (specify)"],
  "Guernsey": ["Protected Cell Company (PCC)", "Limited Partnership", "Private Limited Company", "Other (specify)"],
  "Netherlands": ["Besloten Vennootschap (B.V.)", "Cooperative (Coöperatie)", "Limited Partnership (CV)", "Other (specify)"],
  "Mauritius": ["Global Business Company (GBC)", "Authorised Company", "Limited Partnership", "Other (specify)"],
  "Australia": ["Proprietary Limited Company (Pty Ltd)", "Unit Trust", "Limited Partnership", "Other (specify)"],
};

/* ── WAVE 3C / J-1 — country ⇄ jurisdiction-enum bridge ─────────────────── *
 *
 * This is the missing join between the 15-country ontology above and the
 * (now widened) SPV_JURISDICTIONS enum. It is declared as an EXHAUSTIVE
 * Record<SpvJurisdiction, …>: adding a member to the enum without adding a
 * country label here is a COMPILE ERROR, not a silent fall-through.
 */

/** Ontology country label for each enum member. `other` has none by design. */
export const SPV_JURISDICTION_COUNTRY: Record<SpvJurisdiction, string | null> = {
  delaware: "United States",
  cayman: "Cayman Islands",
  bvi: "British Virgin Islands",
  canadian_lp: "Canada",
  united_kingdom: "United Kingdom",
  singapore: "Singapore",
  luxembourg: "Luxembourg",
  ireland: "Ireland",
  hong_kong: "Hong Kong",
  uae: "United Arab Emirates",
  jersey: "Jersey",
  guernsey: "Guernsey",
  netherlands: "Netherlands",
  mauritius: "Mauritius",
  australia: "Australia",
  other: null,
};

/** Short GP-facing label for each enum member (used wherever the raw value
 *  would otherwise leak into the UI, e.g. the SPV accordion row). */
export const SPV_JURISDICTION_LABELS: Record<SpvJurisdiction, string> = {
  delaware: "United States (Delaware)",
  cayman: "Cayman Islands",
  bvi: "British Virgin Islands",
  canadian_lp: "Canada",
  united_kingdom: "United Kingdom",
  singapore: "Singapore",
  luxembourg: "Luxembourg",
  ireland: "Ireland",
  hong_kong: "Hong Kong",
  uae: "United Arab Emirates",
  jersey: "Jersey",
  guernsey: "Guernsey",
  netherlands: "Netherlands",
  mauritius: "Mauritius",
  australia: "Australia",
  other: "Other / not specified",
};

/** Reverse index, lower-cased country label → enum member. Built from
 *  SPV_JURISDICTION_COUNTRY so the two can never drift. */
const COUNTRY_TO_JURISDICTION: Record<string, SpvJurisdiction> = (() => {
  const out: Record<string, SpvJurisdiction> = {};
  for (const code of SPV_JURISDICTIONS) {
    const country = SPV_JURISDICTION_COUNTRY[code];
    if (country) out[country.toLowerCase()] = code;
  }
  return out;
})();

/** Common spellings/abbreviations a legacy free-text row may carry. Kept
 *  deliberately SMALL and unambiguous — anything not listed resolves to
 *  "other", never to a guessed country. */
const JURISDICTION_ALIASES: Record<string, SpvJurisdiction> = {
  "us": "delaware",
  "u.s.": "delaware",
  "usa": "delaware",
  "u.s.a.": "delaware",
  "united states of america": "delaware",
  "delaware, usa": "delaware",
  "state of delaware": "delaware",
  "state of delaware, usa": "delaware",
  "uk": "united_kingdom",
  "u.k.": "united_kingdom",
  "great britain": "united_kingdom",
  "england": "united_kingdom",
  "cayman": "cayman",
  "bvi": "bvi",
  "uae": "uae",
  "u.a.e.": "uae",
  "the netherlands": "netherlands",
  "holland": "netherlands",
  "hong kong sar": "hong_kong",
  "canadian lp": "canadian_lp",
};

/**
 * WAVE 3C / J-1 — resolve ANY jurisdiction-ish string to a member of the
 * widened enum. Accepts an enum member ("netherlands"), an ontology country
 * label ("Netherlands"), or one of the small alias set above. Anything else —
 * including empty/null — resolves to "other", NEVER to "delaware".
 *
 * This function replaces the four hard-coded `case` arms plus the
 * `default: return "delaware"` in PartnerSpvEngine.deriveEngineJurisdiction
 * and is the single place the coercion policy is expressed.
 */
/**
 * WAVE 40 / F-3 — THE ONE PLACE THE DISPLAY JURISDICTION IS DECIDED.
 *
 * The live audit found "Asian Biotech" showing `British Virgin Islands` on the
 * SPV Engine list card and `United States (Delaware)` on its own detail page.
 * Both surfaces read the SAME stored row (the list via GET
 * /api/partner/me/spv, the standalone page via GET /api/partner/me/spvs/:id,
 * both served from spvEngineStore), so this was never a data-fetch difference:
 * it was FIELD PRECEDENCE implemented twice, differently.
 *
 *   • PartnerSpvEngine.jurisdictionLabelFor  → terms.jurisdictionCountry, then
 *                                              the `jurisdiction` enum column
 *   • SpvDetailTabs                          → same country-first order
 *   • PartnerSpvDetail.jurisdictionLabel     → the enum COLUMN ONLY
 *
 * A vehicle whose column still says "delaware" while the GP typed "British
 * Virgin Islands" in the wizard therefore reads two different domiciles on two
 * screens. The column is the legacy coerced value; `terms.jurisdictionCountry`
 * is what the GP actually chose, so country-first is the correct order — and it
 * is now expressed ONCE, here, and called by all three surfaces.
 *
 * NOT ALL SPVs ARE US-BASED, and nothing in this function may pretend
 * otherwise: there is no "delaware" fallback on any path. An unmappable
 * free-text country is returned AS TYPED rather than flattened, and a row with
 * neither value resolves to "Other / not specified".
 *
 * The stale column itself is a DATA defect, not a rendering one; it is repaired
 * by scripts/backfill_spv_jurisdiction.ts, which has to be run against
 * production. This function makes every surface agree in the meantime instead of
 * showing a US domicile for a BVI vehicle.
 */
export function spvJurisdictionDisplay(source: {
  jurisdiction?: string | null;
  terms?: unknown;
}): { code: SpvJurisdiction; label: string } {
  const country = (source.terms as { jurisdictionCountry?: unknown } | null | undefined)
    ?.jurisdictionCountry;
  const countryText = typeof country === "string" ? country.trim() : "";
  const code = resolveSpvJurisdiction(countryText || source.jurisdiction);
  if (code === SPV_JURISDICTION_UNKNOWN && countryText) return { code, label: countryText };
  return { code, label: SPV_JURISDICTION_LABELS[code] };
}

export function resolveSpvJurisdiction(input: string | null | undefined): SpvJurisdiction {
  const raw = String(input ?? "").trim();
  if (!raw) return SPV_JURISDICTION_UNKNOWN;
  const key = raw.toLowerCase();
  if (isSpvJurisdiction(key)) return key;
  const exact = COUNTRY_TO_JURISDICTION[key] ?? JURISDICTION_ALIASES[key];
  if (exact) return exact;
  return resolveCommaQualified(key);
}

/**
 * WAVE 6 — the second of the two jurisdiction gaps carried into this wave:
 * `"Ontario, Canada"` resolved to `"other"` because the tables are exact-match
 * only, and Ontario is a province the ontology does not (and should not) list.
 *
 * WHY NOT SUBSTRING MATCHING. The obvious fix — `key.includes("canada")` — is
 * the wrong tool and was refused deliberately. Substring matching over this
 * table produces real false positives: `"Guernsey"` contains `"guernsey"` but
 * `"New Jersey"` contains `"jersey"`, and a US state would silently become a
 * Crown Dependency; `"British Virgin Islands"` contains neither `"uk"` nor
 * `"us"` but `"Mauritius"` does contain `"us"`. Mis-resolving a jurisdiction is
 * exactly the failure this project spent two waves removing, so the fix is
 * STRUCTURAL instead.
 *
 * THE RULE. A free-text jurisdiction is treated as a comma-separated address,
 * outermost-last (`"Ontario, Canada"`, `"Grand Cayman, Cayman Islands"`,
 * `"Delaware, USA"`). Each component is trimmed and resolved with the SAME
 * exact-match tables — no fuzzy matching anywhere. Then:
 *
 *   • zero components resolve                → "other"
 *   • all resolving components AGREE         → that jurisdiction
 *   • resolving components DISAGREE          → "other"
 *
 * The disagreement rule is the important half. `"Delaware, Cayman Islands"` is
 * a contradictory row a human must look at; guessing one of the two would be
 * inventing a legal domicile. It resolves to `"other"`, which is honest and is
 * what the neutral counsel-referral content is for.
 *
 * Components that resolve to nothing (`"ontario"`, `"grand cayman"`, a street)
 * are simply ignored — they are not evidence for or against anything, so they
 * cannot outvote a component that did resolve.
 */
function resolveCommaQualified(lowerKey: string): SpvJurisdiction {
  if (!lowerKey.includes(",")) return SPV_JURISDICTION_UNKNOWN;
  let found: SpvJurisdiction | null = null;
  for (const part of lowerKey.split(",")) {
    const p = part.trim();
    if (!p) continue;
    const hit = isSpvJurisdiction(p)
      ? p
      : COUNTRY_TO_JURISDICTION[p] ?? JURISDICTION_ALIASES[p] ?? null;
    if (!hit || hit === SPV_JURISDICTION_UNKNOWN) continue;
    // Contradictory components: refuse to pick a winner.
    if (found && found !== hit) return SPV_JURISDICTION_UNKNOWN;
    found = hit;
  }
  return found ?? SPV_JURISDICTION_UNKNOWN;
}

/* ── WAVE 3C / J-3 — jurisdiction-conditional compliance content ────────── *
 *
 * CONTENT POLICY (deliberate, and the reason this table is small):
 *   • US-specific items (Form D, blue-sky notices, the 3(c)(1) ~100 soft cap,
 *     Tax ID / EIN) appear for "delaware" ONLY.
 *   • Cayman and BVI carry the entity-identifier wording Capavate has already
 *     shipped and reviewed ("Registered number" / "Company number").
 *   • EVERY other jurisdiction gets a NEUTRAL checklist plus an explicit
 *     "we do not hold verified requirements for this jurisdiction" notice.
 *     We do NOT invent foreign securities filings. Showing nothing and saying
 *     so is correct; inventing an AIFMD/VCC/GBC filing would be worse than the
 *     bug we are fixing.
 */

export interface SpvJurisdictionCompliance {
  /** the resolved enum member this content belongs to */
  code: SpvJurisdiction;
  /** GP-facing jurisdiction label */
  label: string;
  /** true only for the United States */
  isUnitedStates: boolean;
  /** formation-checklist entity/tax identifier line */
  formationIdItem: string;
  /** regulatory-filings checklist */
  filings: readonly string[];
  /** false ⇒ `filings` is the generic placeholder, show GENERIC_NOTICE */
  filingsAreJurisdictionSpecific: boolean;
  /** soft investor-count threshold, or null where we assert none */
  investorCountLimit: number | null;
  /** the sentence rendered next to the investor count */
  investorCountNote: string;
}

/** Shown verbatim whenever `filingsAreJurisdictionSpecific` is false. */
export const SPV_JURISDICTION_GENERIC_NOTICE =
  "Capavate does not hold verified filing requirements for this jurisdiction, so the list below is generic. Confirm what actually applies with local counsel.";

const GENERIC_FILINGS: readonly string[] = [
  "Check local regulatory notice requirements with your counsel",
];
const GENERIC_FORMATION_ID = "Local entity registration / tax identification number obtained";
const GENERIC_COUNT_NOTE =
  "Capavate does not hold a verified investor-count threshold for this jurisdiction. Confirm any limit with local counsel.";

/** Non-US default block, parameterised only by label. */
function genericCompliance(code: SpvJurisdiction, formationIdItem = GENERIC_FORMATION_ID): SpvJurisdictionCompliance {
  return {
    code,
    label: SPV_JURISDICTION_LABELS[code],
    isUnitedStates: false,
    formationIdItem,
    filings: GENERIC_FILINGS,
    filingsAreJurisdictionSpecific: false,
    investorCountLimit: null,
    investorCountNote: GENERIC_COUNT_NOTE,
  };
}

/** EXHAUSTIVE over SpvJurisdiction — a new enum member without content here
 *  fails the build rather than silently rendering someone else's law. */
export const SPV_JURISDICTION_COMPLIANCE: Record<SpvJurisdiction, SpvJurisdictionCompliance> = {
  delaware: {
    code: "delaware",
    label: SPV_JURISDICTION_LABELS.delaware,
    isUnitedStates: true,
    formationIdItem: "Tax ID / EIN obtained",
    filings: [
      "Form D filed with the SEC (if applicable)",
      "Blue-sky / state notice filings (if applicable)",
    ],
    filingsAreJurisdictionSpecific: true,
    investorCountLimit: 100,
    investorCountNote: "US 3(c)(1) funds commonly cap at ~100 investors.",
  },
  cayman: genericCompliance("cayman", "Registered number obtained"),
  bvi: genericCompliance("bvi", "Company number obtained"),
  canadian_lp: genericCompliance("canadian_lp"),
  united_kingdom: genericCompliance("united_kingdom"),
  singapore: genericCompliance("singapore"),
  luxembourg: genericCompliance("luxembourg"),
  ireland: genericCompliance("ireland"),
  hong_kong: genericCompliance("hong_kong"),
  uae: genericCompliance("uae"),
  jersey: genericCompliance("jersey"),
  guernsey: genericCompliance("guernsey"),
  netherlands: genericCompliance("netherlands"),
  mauritius: genericCompliance("mauritius"),
  australia: genericCompliance("australia"),
  other: genericCompliance("other"),
};

/** Resolve any jurisdiction-ish string straight to its compliance content. */
export function spvJurisdictionCompliance(input: string | null | undefined): SpvJurisdictionCompliance {
  return SPV_JURISDICTION_COMPLIANCE[resolveSpvJurisdiction(input)];
}

/** Formation checklist (D1) for a jurisdiction. Only the identifier line is
 *  jurisdiction-dependent; the first three steps are universal. */
export function spvFormationChecklist(input: string | null | undefined): string[] {
  return [
    "Legal entity filed / registered",
    "Registered agent appointed",
    "Bank account opened",
    spvJurisdictionCompliance(input).formationIdItem,
  ];
}

/** Filings checklist (D7) for a jurisdiction. */
export function spvFilingsChecklist(input: string | null | undefined): string[] {
  return [...spvJurisdictionCompliance(input).filings];
}

/* ── WAVE 174 · R142 / R144.3 — WHICH TAX DOCUMENT AN LP SHOULD EXPECT ───── *
 *
 * Owner, verbatim: "With regard to taxes, remember that this is an
 * international platform. Maybe we can first focus on high level guidance for
 * US, Canadian, and MAYBE Hong Kong and Singapore GP/LPs?"
 *
 * A Schedule K-1 is a US FEDERAL form (Form 1065). It is not "the" tax document
 * of this platform, and until this wave the platform behaved as though it were:
 * the K-1 machinery reads no jurisdiction at all, and an LP-facing label
 * hardcoded the US pair "1099 / K-1" for LPs in all sixteen jurisdictions.
 *
 * WAVE 174 left this table DELIBERATELY ALMOST EMPTY — two entries `onRecord`,
 * fourteen "Not on record" — because R142.2.5 says a wrong tax document name is
 * worse than a missing one and only two form names had been stated.
 *
 * ── WAVE 175 · SUPERSEDES THAT, ON RESEARCH ───────────────────────────────
 *
 * Every one of the fifteen real jurisdictions has now been researched against
 * its own tax authority, and the answer is NOT "thirteen unknowns":
 *
 *  FIVE have a real statutory investor document — `delaware` (Schedule K-1,
 *  Form 1065), `canadian_lp` (T5013), `united_kingdom` (Partnership Statement
 *  SA800(PS)), `mauritius` (a statement in an approved form) and `australia`
 *  (statement of distribution, or an AMMA statement for an attribution managed
 *  investment trust).
 *
 *  TEN have NO standard statutory investor tax form, and that is an ESTABLISHED
 *  ABSENCE carried by a cited source, not missing data. They therefore say so
 *  POSITIVELY (`recordStatus: "no_standard_form"`) and say what the investor
 *  receives instead. Describing those as "Not on record" would misreport a
 *  researched finding as a gap in Capavate's records.
 *
 *  SEVEN are VEHICLE-FORM DEPENDENT — Singapore, Ireland, Australia, the United
 *  Arab Emirates, Jersey, Guernsey and Luxembourg. In those the treatment turns
 *  on the vehicle's LEGAL FORM (limited partnership vs variable capital company
 *  vs corporate limited partnership vs company), and Capavate records
 *  `spv.jurisdiction` but does NOT record legal form. A single answer would be
 *  confidently wrong, so those entries state the CONDITIONAL and assert nothing.
 *  The missing legal-form field is recorded as an owner decision; it was NOT
 *  invented here.
 *
 *  `other` still renders "Not on record" — the jurisdiction itself is unrecorded
 *  so the question is unanswerable by design, which is a different answer from
 *  an established absence and is kept distinct from it.
 *
 * No form name and no form number is guessed anywhere (R142.2.5). Where the
 * research could not establish a form NUMBER for a document that does exist
 * (Mauritius, Australia) the number renders "Not established" (R111 Q13).
 * Every entry carries its SOURCES so the platform can show where a statement
 * comes from.
 *
 * EXHAUSTIVE over SpvJurisdiction, like SPV_JURISDICTION_COUNTRY,
 * SPV_JURISDICTION_LABELS and SPV_JURISDICTION_COMPLIANCE before it: adding a
 * member to the enum without describing it here is a COMPILE ERROR, so a new
 * jurisdiction cannot silently inherit somebody else's tax form.
 *
 * NOT HERE, BY RULING: no computed tax figures, no filing guidance, no tax
 * advice, and no default. "Not on record" is a real answer; a defaulted K-1 is
 * not, and neither is silence.
 */

export interface SpvJurisdictionTaxDocument {
  code: SpvJurisdiction;
  /** Reused from SPV_JURISDICTION_LABELS so the two cannot drift. */
  jurisdictionLabel: string;
  /** The real form name, or null when no such form exists / none is held. */
  documentName: string | null;
  /** Who issues or receives it. Null whenever `documentName` is null. */
  authority: string | null;
  /** True ONLY where a real statutory investor document exists. */
  onRecord: boolean;
  /* ── WAVE 175 · researched fields. Every one of them is carried by a cited
       source in `sources` below; nothing here is inferred from a neighbouring
       jurisdiction and nothing is guessed (R142.2.5). ───────────────────── */
  /** The full statutory name of the document, when one exists. */
  documentLongName: string | null;
  /** The official form number. NULL where the research could not establish
   *  one, which renders SPV_TAX_DOCUMENT_FORM_NUMBER_NOT_ESTABLISHED rather
   *  than a guessed number (R111 Q13 / R142.2.5). */
  formNumber: string | null;
  /** The revenue authority GOVERNING the jurisdiction. This is NOT the same
   *  field as `authority`, which names the issuer/recipient of a document that
   *  exists. Null only where the jurisdiction genuinely has no revenue
   *  administration (Cayman Islands, British Virgin Islands). */
  taxAuthority: string | null;
  /** Plain-language entity tax treatment. Always populated. */
  entityTreatment: string;
  /** TRUE where the correct answer depends on the vehicle's LEGAL FORM rather
   *  than on its jurisdiction. Capavate records `spv.jurisdiction` and does NOT
   *  record legal form, so for these the platform states the conditional
   *  instead of asserting one treatment. */
  vehicleFormDependent: boolean;
  /** The conditional wording. Non-null exactly when `vehicleFormDependent`. */
  vehicleFormConditional: string | null;
  /** Other documents an investor may receive. May be empty, never null. */
  additionalDocuments: readonly string[];
  /** What the investor receives INSTEAD of a statutory form. Non-null exactly
   *  when `recordStatus === "no_standard_form"`. */
  investorReceivesInstead: string | null;
  /** The POSITIVE, sourced statement of why no form exists — an established
   *  absence, not missing data. Non-null exactly when `recordStatus ===
   *  "no_standard_form"`. */
  noStandardFormExplanation: string | null;
  /** Three-way, because "no such form exists" and "we do not know" are
   *  different answers and conflating them is its own dishonesty. */
  recordStatus: SpvTaxDocumentRecordStatus;
  /** Where the statement comes from. An investor-grade platform cites. At
   *  least one for every real jurisdiction; empty ONLY for `other`, which has
   *  no jurisdiction to cite. */
  sources: readonly SpvTaxDocumentSource[];
}

/**
 * WAVE 175 — one citation for one jurisdiction's guidance.
 *
 * `label` is a human source name, never a bare URL, so the rendered sentence
 * still reads if the link is stripped.
 */
export interface SpvTaxDocumentSource {
  label: string;
  url: string;
}

/**
 * WAVE 175 — three answers, not two.
 *
 *  `on_record`        a real statutory investor document exists and is named.
 *  `no_standard_form` ESTABLISHED ABSENCE: the research shows this jurisdiction
 *                     issues no investor tax form. This is a positive finding
 *                     and is stated as one; it is NOT missing data.
 *  `not_on_record`    the jurisdiction itself is unrecorded (`other`), so the
 *                     question is unanswerable by design.
 */
export type SpvTaxDocumentRecordStatus = "on_record" | "no_standard_form" | "not_on_record";

/** Rendered verbatim in place of a form name the platform does not hold. */
export const SPV_TAX_DOCUMENT_NOT_ON_RECORD = "Not on record";

/** R77 plain language. Shown wherever a tax document is named or withheld. */
export const SPV_TAX_DOCUMENT_INFORMATIONAL_NOTICE =
  "This tells you which tax document to expect. It is information, not tax advice. Capavate does not work out your tax and does not file anything for you. Check your own position with your tax adviser.";

/** R77 plain language. Shown instead of a guessed form name. */
export const SPV_TAX_DOCUMENT_NOT_ON_RECORD_NOTICE =
  "Capavate does not hold a confirmed tax document name for this jurisdiction, so it is not showing one. Naming the wrong form would be worse than naming none. Ask your general partner which document you will receive.";

/**
 * WAVE 175 · R111 Q13 — rendered where a document genuinely exists but the
 * research could not establish an official form NUMBER for it (Mauritius: "a
 * statement in an approved form"; Australia: named by item number, not by a
 * standalone form number). Never a guessed number.
 */
export const SPV_TAX_DOCUMENT_FORM_NUMBER_NOT_ESTABLISHED = "Not established";

/**
 * WAVE 175 — the headline for an ESTABLISHED ABSENCE. Ten of the fifteen real
 * jurisdictions issue no investor tax form at all, and each of those is
 * source-backed. Saying "Not on record" there would misdescribe a researched
 * finding as a gap in Capavate's data, so it says what is true instead.
 */
export const SPV_TAX_DOCUMENT_NO_STANDARD_FORM_LABEL = "No standard investor tax form";

/** R77 plain language for the established-absence case. */
export const SPV_TAX_DOCUMENT_NO_STANDARD_FORM_NOTICE =
  "This is a known position, not missing information: this jurisdiction does not issue an investor tax form. What you receive instead is shown above.";

/**
 * WAVE 175 — THE FINDING THAT CHANGED THE DESIGN.
 *
 * Tax treatment is VEHICLE-specific rather than jurisdiction-specific in seven
 * of the fifteen jurisdictions. Capavate records the jurisdiction and does NOT
 * record the vehicle's legal form, so a single answer would be confidently
 * wrong for those. An honest conditional beats a confident wrong answer, so
 * both cases are stated and neither is asserted.
 */
export const SPV_TAX_DOCUMENT_VEHICLE_FORM_NOTICE =
  "The answer depends on this vehicle's legal form. Capavate records the jurisdiction but does not record the legal form, so it is showing you both cases rather than choosing one. Confirm which applies with your administrator.";

/** WAVE 175 — the label above the citations. Every statement is attributable. */
export const SPV_TAX_DOCUMENT_SOURCES_LABEL = "Where this comes from";

/**
 * R77 plain language. The portfolio-COMPANY tax card offers a "1099 / K-1"
 * package to every LP regardless of jurisdiction. That screen is a DIRECT
 * company holding, so no `spv.jurisdiction` is in scope there and the label
 * cannot be resolved from the vehicle. Per R143.1 the original literal is kept
 * verbatim and this sentence is appended as a static sibling, which fixes the
 * jurisdictional error (the LP is now told plainly that these are US forms and
 * may not be theirs) without dropping a user-facing string.
 */
export const SPV_TAX_DOCUMENT_US_FEDERAL_PACKAGE_CLARIFIER =
  "Form 1099 and Schedule K-1 are United States federal forms. If your holding is not a United States one, these are not your forms. Ask your general partner which document you will receive.";

/**
 * WAVE 175 · R145.3.3 — the GP-side half of the defect.
 *
 * The K-1 generation tab produces statements labelled "Schedule K-1", a US
 * federal form, for a vehicle in ANY jurisdiction. The generation machinery
 * itself is correct for US vehicles and is deliberately untouched; what was
 * wrong was the SURFACE presenting a US form as a non-US vehicle's output
 * without saying so. This sentence is rendered on that surface, driven by the
 * vehicle's own recorded jurisdiction.
 */
export const SPV_TAX_DOCUMENT_GP_US_FORM_NOT_THIS_VEHICLE_NOTICE =
  "A Schedule K-1 is a United States federal form. It is not this vehicle's investor tax document, so anything generated on this tab is an internal working figure for this vehicle and must not be issued to a partner as their jurisdiction's tax document.";

/** WAVE 175 — shown on the GP tab when the vehicle's jurisdiction is unrecorded. */
export const SPV_TAX_DOCUMENT_GP_JURISDICTION_UNKNOWN_NOTICE =
  "This vehicle's jurisdiction is not on record, so Capavate cannot say whether a United States federal form is the right output here. Confirm the vehicle's jurisdiction before issuing anything generated on this tab to a partner.";

/** The honest "we do not hold this" block, parameterised only by the code.
 *  Used for `other` ONLY: an unrecorded jurisdiction cannot have a form. */
function taxDocumentNotOnRecord(code: SpvJurisdiction): SpvJurisdictionTaxDocument {
  return {
    code,
    jurisdictionLabel: SPV_JURISDICTION_LABELS[code],
    documentName: null,
    authority: null,
    onRecord: false,
    documentLongName: null,
    formNumber: null,
    taxAuthority: null,
    entityTreatment:
      "Not on record. The vehicle's jurisdiction itself is not recorded, so no tax treatment can be stated for it.",
    vehicleFormDependent: false,
    vehicleFormConditional: null,
    additionalDocuments: [],
    investorReceivesInstead: null,
    noStandardFormExplanation: null,
    recordStatus: "not_on_record",
    sources: [],
  };
}

/** EXHAUSTIVE over SpvJurisdiction — see the block comment above. */
export const SPV_JURISDICTION_TAX_DOCUMENT: Record<SpvJurisdiction, SpvJurisdictionTaxDocument> = {
  /* ── FIVE JURISDICTIONS WITH A REAL STATUTORY INVESTOR DOCUMENT ───────── */

  /* United States. Internal Revenue Service. */
  delaware: {
    code: "delaware",
    jurisdictionLabel: SPV_JURISDICTION_LABELS.delaware,
    documentName: "Schedule K-1",
    authority: "US Internal Revenue Service",
    onRecord: true,
    documentLongName:
      "Schedule K-1 (Form 1065), Partner's Share of Income, Deductions, Credits, etc. The partnership files a copy with the tax authority and gives one to each partner.",
    formNumber: "Schedule K-1 (Form 1065)",
    taxAuthority: "Internal Revenue Service",
    entityTreatment:
      "Tax-transparent: the partnership itself is generally not subject to income tax, and each partner is taxed on their share whether or not it is distributed.",
    vehicleFormDependent: false,
    vehicleFormConditional: null,
    additionalDocuments: [
      "Schedule K-3 (Form 1065), for items of international tax relevance",
      "Form 1042-S, issued to a foreign partner for United States source income subject to withholding",
    ],
    investorReceivesInstead: null,
    noStandardFormExplanation: null,
    recordStatus: "on_record",
    sources: [
      { label: "Internal Revenue Service — Partner's Instructions for Schedule K-1 (Form 1065)", url: "https://www.irs.gov/instructions/i1065sk1" },
      { label: "Internal Revenue Service — Instructions for Schedule K-3 (Form 1065)", url: "https://www.irs.gov/instructions/i1065sk3" },
      { label: "Internal Revenue Service — About Form 1042-S", url: "https://www.irs.gov/forms-pubs/about-form-1042-s" },
    ],
  },

  /* Canada. Canada Revenue Agency. */
  canadian_lp: {
    code: "canadian_lp",
    jurisdictionLabel: SPV_JURISDICTION_LABELS.canadian_lp,
    documentName: "T5013",
    authority: "Canada Revenue Agency",
    onRecord: true,
    documentLongName:
      "T5013, Statement of Partnership Income — an information slip issued by the authorised member of the partnership reporting each partner's share of income for the fiscal period.",
    formNumber: "T5013",
    taxAuthority: "Canada Revenue Agency",
    entityTreatment:
      "Tax-transparent: a partnership does not pay income tax on its income and does not file an income tax return; each partner reports their share.",
    vehicleFormDependent: false,
    vehicleFormConditional: null,
    additionalDocuments: [
      "NR4, Statement of Amounts Paid or Credited to Non-Residents of Canada, for a non-resident partner",
    ],
    investorReceivesInstead: null,
    noStandardFormExplanation: null,
    recordStatus: "on_record",
    sources: [
      { label: "Canada Revenue Agency — T5013, Statement of Partnership Income", url: "https://www.canada.ca/en/revenue-agency/services/forms-publications/forms/t5013.html" },
      { label: "Canada Revenue Agency — Reporting partnership income", url: "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/sole-proprietorships-partnerships/t5013-partnership-information-return-filing-requirements/reporting-partnership-income.html" },
      { label: "Canada Revenue Agency — NR4", url: "https://www.canada.ca/en/revenue-agency/services/forms-publications/forms/nr4.html" },
    ],
  },

  /* United Kingdom. HM Revenue & Customs. */
  united_kingdom: {
    code: "united_kingdom",
    jurisdictionLabel: SPV_JURISDICTION_LABELS.united_kingdom,
    documentName: "Partnership Statement SA800(PS)",
    authority: "HM Revenue & Customs",
    onRecord: true,
    documentLongName:
      "The Partnership Statement, form SA800(PS), part of the SA800 Partnership Tax Return. It allocates income, losses and tax credits to each partner, and each partner needs a copy of their own allocation to complete their personal return.",
    formNumber: "SA800(PS)",
    taxAuthority: "HM Revenue & Customs",
    entityTreatment:
      "Tax-transparent: the partnership has no tax liability of its own. The partnership return exists to establish the profits on which the partners are taxed.",
    vehicleFormDependent: false,
    vehicleFormConditional: null,
    additionalDocuments: [
      "The partnership statement is drawn up on a different basis for corporate partners and for non-resident partners, so those allocations differ",
      "No separate United Kingdom withholding certificate for a limited partner was established",
    ],
    investorReceivesInstead: null,
    noStandardFormExplanation: null,
    recordStatus: "on_record",
    sources: [
      { label: "HM Revenue & Customs — Partnership Statement SA800(PS)", url: "https://assets.publishing.service.gov.uk/media/67e3e048e8428b01705de027/SA800PS_2025.pdf" },
      { label: "HM Revenue & Customs — Partnership Manual PM138000", url: "https://www.gov.uk/hmrc-internal-manuals/partnership-manual/pm138000" },
    ],
  },

  /* Mauritius. Mauritius Revenue Authority. */
  mauritius: {
    code: "mauritius",
    jurisdictionLabel: SPV_JURISDICTION_LABELS.mauritius,
    documentName: "Statement of share of net income and tax deducted",
    authority: "Mauritius Revenue Authority",
    onRecord: true,
    documentLongName:
      "A statement in an approved form given to each associate, showing that associate's share of net income or loss and the amount of tax deducted at source, for inclusion in the associate's own annual return of income.",
    /* The authority describes it only as "a statement in an approved form", so
       there is no form number to state and none is invented. */
    formNumber: null,
    taxAuthority: "Mauritius Revenue Authority",
    entityTreatment:
      "Tax-transparent for a resident société: the société is not liable to tax on its own income and the associates are liable on their respective shares whether or not distributed. A company vehicle is taxed at entity level.",
    vehicleFormDependent: false,
    vehicleFormConditional: null,
    additionalDocuments: [
      "The société's own return is I.T. Form 6, and the statement doubles as the record of tax deducted at source",
      "A non-resident société liable to tax as a company, or a global business licence société that opts to be liable, files I.T. Form 3 instead",
    ],
    investorReceivesInstead: null,
    noStandardFormExplanation: null,
    recordStatus: "on_record",
    sources: [
      { label: "Mauritius Revenue Authority — Return of Société", url: "https://www.mra.mu/index.php/eservices1/corporate/societe" },
      { label: "Mauritius Revenue Authority — I.T. Form 6", url: "https://www.mra.mu/download/Soc06_210808.pdf" },
      { label: "Mauritius Revenue Authority — Corporate Taxation", url: "https://www.mra.mu/index.php/taxes-duties/corporate-taxation" },
    ],
  },

  /* Australia. Australian Taxation Office. A document EXISTS, and WHICH one
     depends on the vehicle's legal form — including the Division 5A corporate
     limited partnership case, which is taxed as a company. */
  australia: {
    code: "australia",
    jurisdictionLabel: SPV_JURISDICTION_LABELS.australia,
    documentName: "Statement of distribution",
    authority: "Australian Taxation Office",
    onRecord: true,
    documentLongName:
      "For a partnership, the statement of distribution completed for each partner at item 53 of the Partnership tax return, showing their share of income and credits. For a managed fund structured as an attribution managed investment trust, the Attribution Managed Investment Trust member annual (AMMA) statement, which must be given to each member within three months after the end of the income year.",
    /* Named by name and by item number, not by a standalone form number. */
    formNumber: null,
    taxAuthority: "Australian Taxation Office",
    entityTreatment:
      "An ordinary partnership does not pay tax on its income and the partners report their share. A corporate limited partnership is treated as a company for income tax purposes under Division 5A of Part III of the Income Tax Assessment Act 1936. An attribution managed investment trust attributes amounts to its members.",
    vehicleFormDependent: true,
    vehicleFormConditional:
      "Depends on this vehicle's legal form. An ordinary partnership is tax-transparent and gives each partner a statement of distribution. A corporate limited partnership is treated as a company for income tax purposes under Division 5A of Part III of the Income Tax Assessment Act 1936, and its distributions are treated as dividends rather than partnership allocations. An attribution managed investment trust instead gives each member an Attribution Managed Investment Trust member annual (AMMA) statement. Confirm with your administrator.",
    additionalDocuments: [
      "The fund also lodges an annual investment income report with the tax authority, mirroring the member information",
      "A revised member annual statement can be issued up to four years after the end of the income year",
    ],
    investorReceivesInstead: null,
    noStandardFormExplanation: null,
    recordStatus: "on_record",
    sources: [
      { label: "Australian Taxation Office — Statement of distribution, item 53", url: "https://www.ato.gov.au/forms-and-instructions/partnership-tax-return-2022-instructions/instructions-for-completing-the-tax-return/statement-of-distribution-item-53" },
      { label: "Australian Taxation Office — AMIT reporting requirements", url: "https://www.ato.gov.au/businesses-and-organisations/trusts/specific-rules-for-some-trusts/managed-investment-trusts/managed-investment-trusts-overview/attribution-managed-investment-trusts/amit-reporting-requirements" },
      { label: "Australian Taxation Office — TD 2022/5, corporate limited partnerships", url: "https://www.ato.gov.au/law/view/print?DocID=TXD/TD20225/NAT/ATO/00001&PiT=99991231235958" },
    ],
  },

  /* ── TEN JURISDICTIONS WITH NO STANDARD INVESTOR TAX FORM ─────────────────
       Each is an ESTABLISHED ABSENCE carried by the sources listed on it, not
       an absence of data. Each says what the investor receives instead. ──── */

  /* Hong Kong — the partnership itself is taxed, IN THE PARTNERSHIP'S NAME. */
  hong_kong: {
    code: "hong_kong",
    jurisdictionLabel: SPV_JURISDICTION_LABELS.hong_kong,
    documentName: null,
    authority: null,
    onRecord: false,
    documentLongName: null,
    formNumber: null,
    taxAuthority: "Inland Revenue Department",
    entityTreatment:
      "Taxed at entity level: assessable profits are computed as a single amount and profits tax is charged in the partnership's own name, subject to the unified funds exemption for a qualifying fund.",
    vehicleFormDependent: false,
    vehicleFormConditional: null,
    additionalDocuments: [],
    investorReceivesInstead:
      "The vehicle's audited financial statements, together with capital-account and allocation information from the manager.",
    noStandardFormExplanation:
      "Hong Kong issues no investor tax slip because it taxes the partnership itself, in the partnership's own name: the precedent partner files the profits tax return and the tax is charged on the partnership rather than allocated to partners on a statutory form. The fund-exemption guidance prescribes no investor reporting form either.",
    recordStatus: "no_standard_form",
    sources: [
      { label: "Inland Revenue Department — A Guide to Profits Tax for Unincorporated Businesses", url: "https://www.ird.gov.hk/eng/pdf/pam58e.pdf" },
      { label: "Inland Revenue Department — Departmental Interpretation and Practice Notes No. 61", url: "https://www.ird.gov.hk/eng/pdf/dipn61.pdf" },
    ],
  },

  /* Singapore — inform-the-partners duty only. LEGAL-FORM DEPENDENT. */
  singapore: {
    code: "singapore",
    jurisdictionLabel: SPV_JURISDICTION_LABELS.singapore,
    documentName: null,
    authority: null,
    onRecord: false,
    documentLongName: null,
    formNumber: null,
    taxAuthority: "Inland Revenue Authority of Singapore",
    entityTreatment:
      "A limited partnership is not liable to tax at entity level and each partner is taxed on their share. A variable capital company is treated as a company for income tax purposes and so is taxed at entity level.",
    vehicleFormDependent: true,
    vehicleFormConditional:
      "Depends on this vehicle's legal form — a limited partnership is normally tax-transparent, so you are taxed on your own share, whereas a variable capital company is taxed as a company at entity level. Confirm with your administrator.",
    additionalDocuments: [],
    investorReceivesInstead:
      "An allocation notice from the precedent partner stating your share of the partnership's income, which may then be pre-filled into your own return.",
    noStandardFormExplanation:
      "Singapore prescribes no investor slip. The only requirement is that the precedent partner inform all the partners of their share of the partnership's income; the partnership itself files the partnership return.",
    recordStatus: "no_standard_form",
    sources: [
      { label: "Inland Revenue Authority of Singapore — Responsibilities of precedent partners", url: "https://www.iras.gov.sg/taxes/individual-income-tax/self-employed-and-partnerships/tax-obligations-of-partnerships/responsibilities-of-precedent-partners" },
      { label: "Inland Revenue Authority of Singapore — Types of partnerships", url: "https://www.iras.gov.sg/taxes/individual-income-tax/self-employed-and-partnerships/tax-obligations-of-partnerships/types-of-partnerships" },
      { label: "Inland Revenue Authority of Singapore — Tax framework for variable capital companies", url: "https://www.iras.gov.sg/media/docs/default-source/e-tax/etaxguides_cit_tax_framework_for_vcc.pdf" },
    ],
  },

  /* Cayman Islands — no direct taxes at all, so no revenue administration. */
  cayman: {
    code: "cayman",
    jurisdictionLabel: SPV_JURISDICTION_LABELS.cayman,
    documentName: null,
    authority: null,
    onRecord: false,
    documentLongName: null,
    formNumber: null,
    taxAuthority: null,
    entityTreatment:
      "Tax-neutral: there is no income, corporation or capital gains tax at entity level.",
    vehicleFormDependent: false,
    vehicleFormConditional: null,
    additionalDocuments: [],
    investorReceivesInstead:
      "Audited financial statements, a capital-account or partner allocation statement, and distribution notices.",
    noStandardFormExplanation:
      "There are no direct taxes in the Cayman Islands, so there is no domestic investor tax form to issue. The Tax Information Authority is expressly not a tax administration or revenue agency; its role, with the Department for International Tax Cooperation, is cross-border information exchange only.",
    recordStatus: "no_standard_form",
    sources: [
      { label: "Cayman Islands Government — Our Finance and Economy", url: "https://gov.ky/economy" },
      { label: "Department for International Tax Cooperation — frequently asked questions", url: "https://www.ditc.ky/news-updates/faqs/" },
    ],
  },

  /* British Virgin Islands — no corporate income or capital gains tax. */
  bvi: {
    code: "bvi",
    jurisdictionLabel: SPV_JURISDICTION_LABELS.bvi,
    documentName: null,
    authority: null,
    onRecord: false,
    documentLongName: null,
    formNumber: null,
    taxAuthority: null,
    entityTreatment:
      "Tax-neutral: no corporate income or capital gains tax is levied at entity level.",
    vehicleFormDependent: false,
    vehicleFormConditional: null,
    additionalDocuments: [],
    investorReceivesInstead:
      "Audited financial statements together with partner allocation and distribution reporting.",
    noStandardFormExplanation:
      "The British Virgin Islands levies no corporate income or capital gains tax, so no investor tax form exists. The Inland Revenue Department administers payroll and similar taxes, and the International Tax Authority acts only as the competent authority for cross-border information reporting.",
    recordStatus: "no_standard_form",
    sources: [
      { label: "British Virgin Islands Financial Services Commission — tax structure", url: "https://www.bvifsc.vg/faq/what-tax-structure-bvi" },
      { label: "Government of the Virgin Islands — Inland Revenue Department", url: "https://bvi.gov.vg/departments/inland-revenue-department-0" },
    ],
  },

  /* Luxembourg — transparent, but the reverse-hybrid rule can displace it. */
  luxembourg: {
    code: "luxembourg",
    jurisdictionLabel: SPV_JURISDICTION_LABELS.luxembourg,
    documentName: null,
    authority: null,
    onRecord: false,
    documentLongName: null,
    formNumber: null,
    taxAuthority: "Administration des contributions directes",
    entityTreatment:
      "A common or special limited partnership is not taxable as such and its partners are taxed on their share. The reverse-hybrid rule can displace that transparency and tax the partnership itself on some investors' allocable income.",
    vehicleFormDependent: true,
    vehicleFormConditional:
      "Depends on this vehicle's legal form and on its investor base. A common or special limited partnership is normally not taxable as such, so partners are taxed on their share; a corporate vehicle is taxed at entity level; and the reverse-hybrid rule can make the partnership itself taxable on some investors' allocable income. Confirm with your administrator.",
    additionalDocuments: [],
    investorReceivesInstead:
      "The annual accounts or annual report, plus a manager-prepared tax reporting package or allocation statement.",
    noStandardFormExplanation:
      "Neither the tax administration's transparency guidance nor the government business portal identifies any partner or investor statement, certificate or numbered form for a Luxembourg limited partnership fund. The partnership's own return, with its investor annex, is filed with the authorities rather than issued to investors.",
    recordStatus: "no_standard_form",
    sources: [
      { label: "Administration des contributions directes — transparence fiscale", url: "https://impotsdirects.public.lu/fr/az/t/transparence.html" },
      { label: "Guichet.lu — special limited partnership", url: "https://guichet.public.lu/en/entreprises/creation-developpement/forme-juridique/entreprise-individuelle-societe-personnes/scsp.html" },
    ],
  },

  /* Ireland — transparent partnership vs gross roll-up regulated fund. */
  ireland: {
    code: "ireland",
    jurisdictionLabel: SPV_JURISDICTION_LABELS.ireland,
    documentName: null,
    authority: null,
    onRecord: false,
    documentLongName: null,
    formNumber: null,
    taxAuthority: "Office of the Revenue Commissioners",
    entityTreatment:
      "An investment limited partnership authorised on or after 13 February 2013 is tax-transparent and its partners self-assess. A regulated investment undertaking is generally exempt at fund level under gross roll-up, with exit tax deducted by the fund on a chargeable event.",
    vehicleFormDependent: true,
    vehicleFormConditional:
      "Depends on this vehicle's legal form — an investment limited partnership is normally tax-transparent and its partners self-assess, with no investor form issued, whereas a regulated fund such as an Irish collective asset-management vehicle is taxed under gross roll-up and the fund itself deducts exit tax on a chargeable event. Confirm with your administrator.",
    additionalDocuments: [
      "A non-resident declaration held by the fund before a chargeable event removes the need to deduct exit tax",
    ],
    investorReceivesInstead:
      "The manager's allocation information for a partnership. For a regulated gross roll-up fund, exit tax is instead deducted at source by the fund.",
    noStandardFormExplanation:
      "There is no investor tax form for an investment limited partnership: the partnership's annual statement is filed with the revenue authority, not issued to the partners, who return their own income under self-assessment.",
    recordStatus: "no_standard_form",
    sources: [
      { label: "Revenue Commissioners — Investment limited partnerships", url: "https://www.revenue.ie/en/companies-and-charities/financial-services/collective-investment-vehicles/investment-limited-partnerships.aspx" },
      { label: "Revenue Commissioners — Tax and Duty Manual Part 27-01a-04", url: "https://www.revenue.ie/en/tax-professionals/tdm/income-tax-capital-gains-tax-corporation-tax/part-27/27-01a-04.pdf" },
      { label: "Revenue Commissioners — Funds", url: "https://www.revenue.ie/en/companies-and-charities/financial-services/collective-investment-vehicles/funds.aspx" },
    ],
  },

  /* United Arab Emirates — transparency via the authorised partner's annual
     declaration; an OPAQUE ELECTION is available. */
  uae: {
    code: "uae",
    jurisdictionLabel: SPV_JURISDICTION_LABELS.uae,
    documentName: null,
    authority: null,
    onRecord: false,
    documentLongName: null,
    formNumber: null,
    taxAuthority: "Federal Tax Authority",
    entityTreatment:
      "An unincorporated partnership is fiscally transparent by default and is not itself a taxable person, but it may elect to be treated as a taxable person and so become opaque. An incorporated partnership is taxed at entity level, and a qualifying investment fund can be exempt.",
    vehicleFormDependent: true,
    vehicleFormConditional:
      "Depends on this vehicle's legal form and on an election it may have made — an unincorporated partnership is fiscally transparent by default, but it can elect to be treated as a taxable person and be taxed as an entity, and an incorporated partnership is taxed at entity level. Confirm with your administrator.",
    additionalDocuments: [
      "Withholding tax on relevant non-resident state-sourced income is currently at a zero rate, so no investor withholding certificate arises",
    ],
    investorReceivesInstead:
      "The fund's financial statements, with net income available for distribution split into the authority's income categories.",
    noStandardFormExplanation:
      "The United Arab Emirates prescribes no investor tax form. Transparency is routed instead through an annual declaration made by the authorised partner to the Federal Tax Authority, within nine months of the financial year end, setting out each partner's distributive share. No form number is published for that declaration.",
    recordStatus: "no_standard_form",
    sources: [
      { label: "Federal Tax Authority — Corporate Tax Guide: Taxation of Partnerships", url: "https://tax.gov.ae/Datafolder/Files/Guides/CT/CT%20Guide%20-%20Partnerships%20-%2004%2003%202024%20-%20for%20publishing.pdf" },
      { label: "Federal Tax Authority — Corporate Tax Guide: Investment Funds and Investment Managers", url: "https://tax.gov.ae/Datafolder/Files/Guides/CT/CT%20Guide%20-%20Investment%20Funds%20and%20Managers%2006%2005%202024.pdf" },
    ],
  },

  /* Jersey — reported to the authority, not to the investor. */
  jersey: {
    code: "jersey",
    jurisdictionLabel: SPV_JURISDICTION_LABELS.jersey,
    documentName: null,
    authority: null,
    onRecord: false,
    documentLongName: null,
    formNumber: null,
    taxAuthority: "Revenue Jersey",
    entityTreatment:
      "Tax-transparent for a partnership: from 2022 all profits are taxed and collected at the individual partner's own tax file, irrespective of partnership type, and a Jersey limited liability company is also treated as transparent. A Jersey company is taxed at entity level.",
    vehicleFormDependent: true,
    vehicleFormConditional:
      "Depends on this vehicle's legal form — a Jersey partnership and a Jersey limited liability company are treated as tax-transparent, so partners are taxed on their own share, whereas a Jersey company is taxed at entity level. Confirm with your administrator.",
    additionalDocuments: [],
    investorReceivesInstead:
      "A partnership profit-share statement or the accounts, which may be attached to the partnership's notification but are not obligatory, plus your own return.",
    noStandardFormExplanation:
      "Jersey prescribes no investor certificate. Each partner's name, tax identification number and taxable profit share are reported to Revenue Jersey in the online Combined Partnership Notification completed by the responsible partner, and partners then declare their share on their own personal return.",
    recordStatus: "no_standard_form",
    sources: [
      { label: "Revenue Jersey — Partnership income and tax", url: "https://www.gov.je/TaxesMoney/IncomeTax/PartnershipTaxInformation/pages/partnershipincome.aspx" },
      { label: "Revenue Jersey — Combined Partnership Notification guidance", url: "https://www.gov.je/TaxesMoney/IncomeTax/PartnershipTaxInformation/pages/guidancecombinednotificationpartnerships.aspx" },
    ],
  },

  /* Guernsey — no investor statement identified at all. */
  guernsey: {
    code: "guernsey",
    jurisdictionLabel: SPV_JURISDICTION_LABELS.guernsey,
    documentName: null,
    authority: null,
    onRecord: false,
    documentLongName: null,
    formNumber: null,
    taxAuthority: "Guernsey Revenue Service",
    entityTreatment:
      "A private-equity limited partnership is transparent for Guernsey income tax and resident partners are taxed on their share. A company vehicle is taxed at entity level but at a zero per cent standard rate, with higher rates for specified activities, and a collective investment vehicle may apply for exemption.",
    vehicleFormDependent: true,
    vehicleFormConditional:
      "Depends on this vehicle's legal form — a private-equity limited partnership is transparent for Guernsey income tax, whereas a company vehicle is taxed at entity level at a zero per cent standard rate unless a higher-rate activity applies, and a collective investment vehicle may instead be exempt and treated as non-resident. Confirm with your administrator.",
    additionalDocuments: [
      "The filings that do exist are entity-level: the annual exemption application for a collective investment vehicle, and a company's quarterly distribution reporter return",
    ],
    investorReceivesInstead:
      "The fund's accounts. Whether tax must be deducted from a distribution turns on which members are Guernsey-resident, not on any certificate given to the investor.",
    noStandardFormExplanation:
      "Neither the Revenue Service's partnership and company guidance nor its exempt-bodies guidance identifies any statement issued to a partner, member or investor showing their share of income or tax deducted.",
    recordStatus: "no_standard_form",
    sources: [
      { label: "Guernsey Revenue Service — Statement of Practice M44", url: "https://www.gov.gg/CHttpHandler.ashx?id=189614&p=0" },
      { label: "Guernsey Revenue Service — Companies", url: "https://gov.gg/RevenueService/Companies" },
      { label: "Guernsey Revenue Service — Exempt bodies", url: "https://www.gov.gg/CHttpHandler.ashx?id=2175&p=0" },
    ],
  },

  /* Netherlands — the limited partnership ceased to be independently liable to
     corporate income tax on 1 January 2025. */
  netherlands: {
    code: "netherlands",
    jurisdictionLabel: SPV_JURISDICTION_LABELS.netherlands,
    documentName: null,
    authority: null,
    onRecord: false,
    documentLongName: null,
    formNumber: null,
    taxAuthority: "Belastingdienst",
    entityTreatment:
      "Tax-transparent: since 1 January 2025 a limited partnership is no longer independently liable for corporate income tax, unless it is liable under some other rule. A corporate vehicle remains taxed at entity level.",
    vehicleFormDependent: false,
    vehicleFormConditional: null,
    additionalDocuments: [
      "For a corporate vehicle, dividend tax of 15 per cent is generally withheld by the distributing company and reported by the recipient, who may offset, reclaim or be exempt from it; the form number of the dividend note was not established",
    ],
    investorReceivesInstead:
      "A contractual profit-share statement from the manager; investors report their own share of the profit.",
    noStandardFormExplanation:
      "The Netherlands tax administration identifies no statutory partner statement for a limited partnership, and since 1 January 2025 the limited partnership is no longer independently subject to corporate income tax, so investors report their own profit share.",
    recordStatus: "no_standard_form",
    sources: [
      { label: "Belastingdienst — corporate income tax and the limited partnership", url: "https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/winst/vennootschapsbelasting/belastingplicht_en_aangifte/vennootschapsbelasting-en-commanditaire-vennootschap" },
      { label: "business.gov.nl — limited partnership", url: "https://business.gov.nl/running-your-business/legal-forms-and-governance/limited-partnership/" },
    ],
  },

  /* ── THE EXPLICIT UNKNOWN ─────────────────────────────────────────────────
       `other` means the jurisdiction ITSELF is unrecorded, so "which form
       applies?" is unanswerable by design. It is NOT an established absence
       and must never be described as one. */
  other: taxDocumentNotOnRecord("other"),
};

/**
 * Resolve any jurisdiction-ish string straight to its tax-document content.
 * Unresolvable input lands on `other` via `resolveSpvJurisdiction`, which is
 * NOT on record — so a bad or empty stored value can never yield a K-1.
 */
export function spvJurisdictionTaxDocument(input: string | null | undefined): SpvJurisdictionTaxDocument {
  return SPV_JURISDICTION_TAX_DOCUMENT[resolveSpvJurisdiction(input)];
}

/** WAVE 175 — the five jurisdictions with a real statutory investor document.
 *  DERIVED, so it cannot drift from the table. */
export const SPV_TAX_DOCUMENT_ON_RECORD_JURISDICTIONS: readonly SpvJurisdiction[] =
  SPV_JURISDICTIONS.filter((code) => SPV_JURISDICTION_TAX_DOCUMENT[code].recordStatus === "on_record");

/** Every jurisdiction that does NOT name a form. DERIVED, so it cannot drift
 *  from the table above. Comprises the ten established absences plus `other`. */
export const SPV_TAX_DOCUMENT_NOT_ON_RECORD_JURISDICTIONS: readonly SpvJurisdiction[] =
  SPV_JURISDICTIONS.filter((code) => !SPV_JURISDICTION_TAX_DOCUMENT[code].onRecord);

/** WAVE 175 — the ten ESTABLISHED ABSENCES: a researched "no such form exists",
 *  which is a different answer from `other`'s "we do not know". DERIVED. */
export const SPV_TAX_DOCUMENT_NO_STANDARD_FORM_JURISDICTIONS: readonly SpvJurisdiction[] =
  SPV_JURISDICTIONS.filter(
    (code) => SPV_JURISDICTION_TAX_DOCUMENT[code].recordStatus === "no_standard_form",
  );

/**
 * WAVE 175 — the jurisdictions whose answer depends on the vehicle's LEGAL
 * FORM, which Capavate does not record. For each of these the platform states
 * the conditional rather than asserting one treatment. DERIVED.
 */
export const SPV_TAX_DOCUMENT_VEHICLE_FORM_DEPENDENT_JURISDICTIONS: readonly SpvJurisdiction[] =
  SPV_JURISDICTIONS.filter((code) => SPV_JURISDICTION_TAX_DOCUMENT[code].vehicleFormDependent);

/**
 * WAVE 175 — the remaining OPEN OWNER DECISION, redefined by the research.
 *
 * Wave 174 exported this as "jurisdictions whose form name the owner must still
 * confirm". The research has now established every one of those, so that list
 * is closed. What is NOT closed is the platform GAP the research exposed: the
 * vehicle's legal form is not a recorded field, so for these jurisdictions the
 * platform can only state a conditional. Confirming them requires a schema
 * decision by the owner, not a form name. DERIVED from the table, so this list
 * cannot drift from what is actually rendered.
 */
export const SPV_TAX_DOCUMENT_PENDING_OWNER_DECISION: readonly SpvJurisdiction[] =
  SPV_TAX_DOCUMENT_VEHICLE_FORM_DEPENDENT_JURISDICTIONS;

/** Spec 3j — GP-facing distribution-scope labels (relabelled EXACTLY as the
 * spec requires) mapped to the existing SPV_DISTRIBUTION_SCOPES values. These
 * three are the only choices the wizard offers; enforcement is server-side
 * (Phase 5). */
export const SPV_DISTRIBUTION_SCOPE_WIZARD_OPTIONS: ReadonlyArray<{ value: SpvDistributionScope; label: string; help: string }> = [
  { value: "network", label: "Network (Collective)", help: "Discoverable across the Capavate Collective network of members." },
  { value: "invite_only", label: "Network (Invite Only)", help: "Visible only to investors you explicitly invite." },
  { value: "private", label: "Private", help: "Not discoverable anywhere — you manage the LP list entirely off-platform." },
];

export const SPV_FEE_LAYERS = ["management", "platform"] as const;
export type SpvFeeLayer = (typeof SPV_FEE_LAYERS)[number];

export const SPV_FEE_TYPES = ["fixed", "carry", "hybrid"] as const;
export type SpvFeeType = (typeof SPV_FEE_TYPES)[number];

/** Unified investment flow shared across all 3 LP personas. */
export const SPV_SUBSCRIPTION_STATUSES = [
  "review", "soft_circled", "founder_confirmed", "wire_funded", "committed", "withdrawn",
] as const;
export type SpvSubscriptionStatus = (typeof SPV_SUBSCRIPTION_STATUSES)[number];

export const SPV_INVESTOR_PERSONAS = ["collective", "capavate", "partner"] as const;
export type SpvInvestorPersona = (typeof SPV_INVESTOR_PERSONAS)[number];

export const SPV_DEPLOYMENT_STATUSES = [
  "pending", "founder_confirmed", "docs_sent", "wired", "deployed",
] as const;
export type SpvDeploymentStatus = (typeof SPV_DEPLOYMENT_STATUSES)[number];

export const SPV_DOC_TYPES = [
  "formation", "operating_agreement", "subscription", "formd", "blue_sky", "kyc", "tax",
] as const;
export type SpvDocType = (typeof SPV_DOC_TYPES)[number];

/**
 * WAVE 23 · ITEM 6 (FINAL REVIEW B) — JURISDICTION-FILTERED DOCUMENT TYPES.
 *
 * THE LEAK. `SPV_DOC_TYPES` is the raw, unfiltered enum, and the document
 * registration dropdown rendered all seven entries for every vehicle. A Cayman
 * or Singapore SPV was therefore offered **Form D** (a US SEC Regulation D
 * notice) and **Blue-sky filing** (a US state securities notice). Six
 * `"delaware"` write-site fallbacks were closed earlier in this build and the
 * compliance CONTENT is already conditional on `isUnitedStates` — this dropdown
 * was the one surface still leaking US law onto non-US vehicles.
 *
 * THE RULE, and its limit. `formd` and `blue_sky` are US-only and are offered
 * only where the ontology says `isUnitedStates`. The remaining five types
 * (formation, operating agreement, subscription, KYC, tax) are jurisdiction-
 * NEUTRAL: every vehicle in every jurisdiction has a formation document and a
 * subscription agreement. **No foreign document types are invented.** The
 * ontology holds no verified filing list for any non-US jurisdiction
 * (`genericCompliance()` sets `filingsAreJurisdictionSpecific: false`), so
 * where we do not know, the honest answer is the neutral set — not a plausible-
 * looking "CIMA notification" or "MAS Form 1" that nobody verified. That is the
 * same ruling `SPV_JURISDICTION_GENERIC_NOTICE` already states in prose.
 *
 * `other` (the explicit we-do-not-know) is NOT United States and therefore gets
 * the neutral set, which is the fail-closed direction: a vehicle whose domicile
 * we could not resolve is never offered a US-specific filing.
 *
 * THIS IS A DISPLAY FILTER, NOT A NARROWING OF THE PERSISTED ENUM.
 * `SPV_DOC_TYPES` and `SpvDocType` are unchanged, so existing rows of every
 * type still read back, and a document registered before this filter existed is
 * never orphaned.
 */
export const SPV_US_ONLY_DOC_TYPES: readonly SpvDocType[] = ["formd", "blue_sky"];

/** The document types offered for a vehicle in the given jurisdiction. Accepts
 *  the same free-text a GP may have typed; resolution goes through
 *  `resolveSpvJurisdiction()` / the ontology, never a string comparison. */
export function spvDocTypesForJurisdiction(
  input: string | null | undefined,
): readonly SpvDocType[] {
  if (spvJurisdictionCompliance(input).isUnitedStates) return SPV_DOC_TYPES;
  return SPV_DOC_TYPES.filter((t) => !SPV_US_ONLY_DOC_TYPES.includes(t));
}

/** True when a document type is offerable for a jurisdiction. Exported so a
 *  write path can ask the same question the dropdown asks. */
export function isSpvDocTypeAllowedForJurisdiction(
  docType: string,
  input: string | null | undefined,
): boolean {
  return (spvDocTypesForJurisdiction(input) as readonly string[]).includes(docType);
}

export const SPV_TRANSFER_STATUSES = [
  "proposed", "compliance_recheck", "gp_approved", "settled", "rejected",
] as const;
export type SpvTransferStatus = (typeof SPV_TRANSFER_STATUSES)[number];

/* Compliance gate vocab (reusable, investor-level). */
export const KYC_STATUSES = ["none", "pending", "verified", "expired", "manual_review"] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];
export const ACCREDITATION_STATUSES = ["none", "self_certified", "verified", "manual_review"] as const;
export type AccreditationStatus = (typeof ACCREDITATION_STATUSES)[number];

/* ── mandate rule tree (composable AND/OR) ─────────────────────────────── */

export type MandateLeafField = "geography" | "sector" | "company_id" | "stage" | "check_size";
export type MandateLeafOp = "in" | "eq" | "gte" | "lte";

export interface MandateLeaf {
  field: MandateLeafField;
  op: MandateLeafOp;
  value: string | number | string[];
}
export interface MandateNode {
  op: "and" | "or";
  rules: Array<MandateLeaf | MandateNode>;
}
export type MandateRuleTree = MandateNode;

/* ── DTOs ──────────────────────────────────────────────────────────────── */

export interface SpvDTO {
  id: string;
  sponsorPartnerId: string;
  gpUserId: string | null;
  name: string;
  spvType: SpvType;
  jurisdiction: SpvJurisdiction;
  status: SpvStatus;
  distributionScope: SpvDistributionScope;
  targetRaiseMinor: number | null;
  minCheckMinor: number | null;
  capMinor: number | null;
  currency: string;
  carryBasis: SpvCarryBasis;
  lpVisibility: SpvLpVisibility;
  targetCompanyId: string | null;
  closeDate: string | null;
  terms: Record<string, unknown> | null;
  migratedFrom: string | null;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
  archivedAt: string | null;
  revisionHash: string;
}

export interface SpvMandateDTO {
  id: string;
  spvId: string;
  mode: SpvMandateMode;
  ruleTree: MandateRuleTree;
  geography: string[];
  sector: string[];
  companyIds: string[];
  stage: string[];
  checkMinMinor: number | null;
  checkMaxMinor: number | null;
  updatedAt: string;
  revisionHash: string;
}

export interface SpvFeeDTO {
  id: string;
  spvId: string;
  layer: SpvFeeLayer;
  feeType: SpvFeeType;
  fixedAmountMinor: number | null;
  carryPct: number | null;
  currency: string;
  effectiveDate: string;
  setBy: string | null;
  createdAt: string;
  revisionHash: string;
}

export interface SpvSubscriptionDTO {
  id: string;
  spvId: string;
  investorId: string;
  investorPersona: SpvInvestorPersona | null;
  commitmentMinor: number;
  wiredMinor: number;
  currency: string;
  status: SpvSubscriptionStatus;
  kycRef: string | null;
  accreditationRef: string | null;
  subscriptionDocRef: string | null;
  ownershipPct: number | null;
  createdAt: string;
  updatedAt: string;
  revisionHash: string;
}

export interface SpvDeploymentDTO {
  id: string;
  spvId: string;
  companyId: string;
  companyRoundId: string;
  instrument: string | null;
  amountMinor: number;
  currency: string;
  shares: string | null;
  capTableLedgerRef: string | null;
  status: SpvDeploymentStatus;
  founderConfirmedAt: string | null;
  wiredAt: string | null;
  // Blocker 2 (4D): REAL funding proof. `wirePaymentRef` MUST be supplied on the
  // `wired` transition and re-validated before the cap-table ledger commit; a
  // closing-doc ref is captured alongside as typed provenance. `wired` is not a
  // mere status flip — it asserts money actually moved.
  wirePaymentRef: string | null;
  closingDocRef: string | null;
  deployedAt: string | null;
  createdAt: string;
  updatedAt: string;
  revisionHash: string;
}

export interface SpvDistributionAllocation {
  investorId: string;
  grossMinor: number;
  carryMinor: number;
  netMinor: number;
}
export interface SpvDistributionDTO {
  id: string;
  spvId: string;
  event: string;
  /**
   * WAVE 6 / SC-3 — the tax/accounting classification of this distribution.
   *
   * `event` is free text describing WHAT happened ("Series B secondary").
   * `distributionType` is the constrained classification the GP is legally
   * making, and is the field the PLURAL legacy ledger has always carried
   * (`spv_distributions.distribution_type`, server/db/connection.ts:4438)
   * while the canonical SINGULAR ledger did not. Domain and semantics:
   * server/lib/spvDistributionType.ts. Optional on the type ONLY so that rows
   * hydrated from a database that has not yet run migration 0153 still parse;
   * every write path resolves it to a real member.
   */
  distributionType?: SpvDistributionTypeValue;
  grossProceedsMinor: number;
  currency: string;
  waterfall: Array<Record<string, unknown>>;
  allocations: SpvDistributionAllocation[];
  gpCarryMinor: number;
  platformCarryMinor: number;
  status: string;
  createdAt: string;
  createdBy: string | null;
  revisionHash: string;
}

/**
 * WAVE 6 / SC-3 — mirrors `SPV_DISTRIBUTION_TYPES` in
 * server/lib/spvDistributionType.ts. Declared here (and not imported) because
 * `shared/` must not depend on `server/`; the two are pinned equal by
 * server/__tests__/wave6_spv_distribution_type.test.ts.
 */
export const SPV_DISTRIBUTION_TYPE_VALUES = [
  "return_of_capital",
  "dividend",
  "exit",
  "other",
] as const;
export type SpvDistributionTypeValue = (typeof SPV_DISTRIBUTION_TYPE_VALUES)[number];

/** GP-facing labels. `other` is named for what it is, never as "Dividend". */
export const SPV_DISTRIBUTION_TYPE_DISPLAY: Record<SpvDistributionTypeValue, string> = {
  return_of_capital: "Return of Capital",
  dividend: "Dividend",
  exit: "Exit Proceeds",
  other: "Unclassified",
};

export interface SpvDocumentDTO {
  id: string;
  spvId: string;
  docType: SpvDocType;
  title: string | null;
  storageKey: string;
  storageBackend: string;
  contentType: string | null;
  sizeBytes: number | null;
  expiry: string | null;
  createdAt: string;
  createdBy: string | null;
}

export interface SpvTransferDTO {
  id: string;
  spvId: string;
  fromInvestorId: string;
  toInvestorId: string;
  unitsPct: number | null;
  amountMinor: number | null;
  currency: string;
  status: SpvTransferStatus;
  complianceRecheckRef: string | null;
  gpApproval: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvestorComplianceProfileDTO {
  investorId: string;
  kycStatus: KycStatus;
  kycVerifiedAt: string | null;
  kycExpiry: string | null;
  accreditationStatus: AccreditationStatus;
  accreditationCertifiedAt: string | null;
  jurisdiction: string | null;
  createdAt: string;
  updatedAt: string;
}

/* Plain-language fee breakdown shown to an investor at subscription time. */
export interface SpvFeeBreakdown {
  commitmentMinor: number;
  /* WAVE 26 / S-3 SECOND PATH — these are `null`, NOT `0`, when the fee table
     is not known to be loaded. Wave 5 fixed the FEES_UNPAID gate against a
     failed `spv_fee` hydration but left every fee-DERIVED computation reading
     the same empty map, so a read failure rendered a fee-free SPV: management
     0, platform 0, net deployed = the whole commitment. A fabricated $0 on a
     money surface is the exact shape the money rules forbid, so the amounts
     are withheld and `feesUnknown` says why. */
  managementFeeMinor: number | null;
  platformFeeMinor: number | null;
  netDeployedMinor: number | null;
  currency: string;
  managementCarryPct: number | null;
  platformCarryPct: number | null;
  /** TRUE when the `spv_fee` view is not trustworthy; every amount above is
   *  then `null` and MUST be rendered as a refusal, never as zero. */
  feesUnknown: boolean;
}

/* ── fee obligations (money-movement-safe fee timing, Phase-4C / Blocker 3) ──
 * A fee OBLIGATION is a concrete money-movement row (distinct from the SpvFeeDTO
 * fee CONFIG). FIXED portions of fixed/hybrid fees are accrued AT FUNDING and
 * MUST be paid (or admin-waived) before commitment/deployment. CARRY portions of
 * carry/hybrid fees are accrued AT DISTRIBUTION and collected with a recorded
 * payment ref (fail-closed on collection failure). */
export const SPV_FEE_OBLIGATION_PORTIONS = ["fixed", "carry"] as const;
export type SpvFeeObligationPortion = (typeof SPV_FEE_OBLIGATION_PORTIONS)[number];
export const SPV_FEE_OBLIGATION_TIMINGS = ["funding", "distribution"] as const;
export type SpvFeeObligationTiming = (typeof SPV_FEE_OBLIGATION_TIMINGS)[number];
export const SPV_FEE_OBLIGATION_STATES = ["pending", "paid", "waived", "failed"] as const;
export type SpvFeeObligationState = (typeof SPV_FEE_OBLIGATION_STATES)[number];

export interface SpvFeeObligationDTO {
  id: string;
  spvId: string;
  layer: SpvFeeLayer;
  portion: SpvFeeObligationPortion;
  timing: SpvFeeObligationTiming;
  amountMinor: number;
  currency: string;
  state: SpvFeeObligationState;
  paymentRef: string | null;
  distributionId: string | null;
  waivedBy: string | null;
  waivedReason: string | null;
  createdAt: string;
  updatedAt: string;
  revisionHash: string;
}

export function isSpvFeeObligationState(v: unknown): v is SpvFeeObligationState {
  return typeof v === "string" && (SPV_FEE_OBLIGATION_STATES as readonly string[]).includes(v);
}

/* ── type guards ───────────────────────────────────────────────────────── */

export function isSpvJurisdiction(v: unknown): v is SpvJurisdiction {
  return typeof v === "string" && (SPV_JURISDICTIONS as readonly string[]).includes(v);
}
export function isSpvCarryBasis(v: unknown): v is SpvCarryBasis {
  return typeof v === "string" && (SPV_CARRY_BASES as readonly string[]).includes(v);
}
export function isSpvDistributionScope(v: unknown): v is SpvDistributionScope {
  return typeof v === "string" && (SPV_DISTRIBUTION_SCOPES as readonly string[]).includes(v);
}
export function isSpvLpVisibility(v: unknown): v is SpvLpVisibility {
  return typeof v === "string" && (SPV_LP_VISIBILITIES as readonly string[]).includes(v);
}
export function isSpvType(v: unknown): v is SpvType {
  return typeof v === "string" && (SPV_TYPES as readonly string[]).includes(v);
}
/* Wave B2 (3b) — runtime guard for a lifecycle status, so a status PATCH (now
   exposed from the Partner pipeline) cannot persist an out-of-enum value. */
export function isSpvStatus(v: unknown): v is SpvStatus {
  return typeof v === "string" && (SPV_STATUSES as readonly string[]).includes(v);
}
export function isSpvMandateMode(v: unknown): v is SpvMandateMode {
  return typeof v === "string" && (SPV_MANDATE_MODES as readonly string[]).includes(v);
}
export function isSpvFeeLayer(v: unknown): v is SpvFeeLayer {
  return typeof v === "string" && (SPV_FEE_LAYERS as readonly string[]).includes(v);
}
export function isSpvFeeType(v: unknown): v is SpvFeeType {
  return typeof v === "string" && (SPV_FEE_TYPES as readonly string[]).includes(v);
}

/** Plain-language one-liners for the dead-simple carry-basis wizard step. */
export const SPV_CARRY_BASIS_HELP: Record<SpvCarryBasis, string> = {
  per_deployment:
    "Carry is calculated separately on each company you invest in — gains and losses are not netted across deals.",
  whole_spv:
    "Carry is calculated once on the SPV's total return — winners and losers are netted together before carry.",
};
