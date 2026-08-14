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
