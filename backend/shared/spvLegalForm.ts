/**
 * WAVE 179 · ITEM B · R151.3 — THE OPTIONAL LEGAL-FORM FIELD.
 *
 * ══ WHY THIS EXISTS ═════════════════════════════════════════════════════════
 * Wave 175 researched the investor tax document for all sixteen recorded SPV
 * jurisdictions and found that in SEVEN of them the answer does not depend on the
 * jurisdiction at all — it depends on the vehicle's LEGAL FORM. Capavate recorded
 * the jurisdiction and nothing else, so for those seven the platform states BOTH
 * branches and chooses neither (`SPV_TAX_DOCUMENT_VEHICLE_FORM_NOTICE`,
 * `shared/spvEngine.ts`). That was the honest answer available at the time and
 * wave 175 §6 referred the field to the owner. R151.3 is that decision.
 *
 * ══ THE FOUR HARD CONSTRAINTS, AND HOW THIS FILE MEETS EACH ═════════════════
 *
 * 1 · THE FIELD IS OPTIONAL AND DEFAULTS TO NOT STATED. There is no default value
 *     anywhere in this file. "Not stated" is `null`, it is what every vehicle has
 *     until a human types something, and `SPV_LEGAL_FORM_NOT_STATED_LABEL` is how
 *     it reads on screen.
 *
 * 2 · WHEN NOT STATED, WAVE 175'S WORDING MUST RENDER BYTE-IDENTICALLY TO TODAY.
 *     Nothing in `shared/spvEngine.ts` is edited by this wave — not one character
 *     of `vehicleFormConditional`, `SPV_TAX_DOCUMENT_VEHICLE_FORM_NOTICE`,
 *     `entityTreatment` or any source list. This file only ADDS a second, separate
 *     table that is consulted exclusively when a form has been stated.
 *
 * 3 · THE PLATFORM NEVER INFERS THE LEGAL FORM. Not from the jurisdiction, not
 *     from the vehicle's name, not from its type, not from its terms, not from a
 *     sibling vehicle. `resolveSpvLegalForm` is a VALIDATOR, not a resolver of
 *     convenience: given a value it either recognises it for that jurisdiction or
 *     returns `null`. There is no branch in this file that can produce a form code
 *     from anything other than a caller-supplied string, which is why the grep in
 *     `W179_TESTS.md` can be exhaustive.
 *
 * 4 · NO VEHICLE IS BACKFILLED. Migration 0214 adds a nullable column with no
 *     `DEFAULT` and runs no `UPDATE`.
 *
 * ══ WHERE THE VALUES COME FROM — NOTHING IS INVENTED ════════════════════════
 * Every legal form below is named in the wave-175 research already in the tree:
 * `SPV_JURISDICTION_TAX_DOCUMENT` in `shared/spvEngine.ts`, in the
 * `entityTreatment` and `vehicleFormConditional` fields of the seven entries whose
 * `vehicleFormDependent` is `true`. Each resolved statement below is one branch of
 * that same sourced sentence, restated as an assertion instead of an alternative.
 * No jurisdiction gains a form the research did not name, and the NINE
 * jurisdictions wave 175 found were NOT form-dependent offer NO options at all —
 * an empty list, not a guessed one.
 *
 * ══ WHY THE CODES ARE NAMESPACED BY JURISDICTION ════════════════════════════
 * "Limited partnership" means one thing in Singapore and a different thing in
 * Guernsey, and the tax consequence differs. A namespaced code makes leakage
 * structurally impossible: a stored value resolves only when its prefix matches
 * the vehicle's OWN recorded jurisdiction, so a Guernsey form can never be read as
 * a Singapore one even if the column somehow held it.
 *
 * The citations are NOT duplicated here. The resolved statement is rendered
 * alongside the jurisdiction's own `sources` list from `shared/spvEngine.ts`, so
 * one source of citation truth serves both the hedged and the resolved case.
 */
import type { SpvJurisdiction } from "./spvEngine";

/**
 * Every legal form the wave-175 research names, and no others.
 *
 * Grouped by jurisdiction for readability; the grouping carries no behaviour —
 * `SPV_LEGAL_FORM_OPTIONS_BY_JURISDICTION` below is the only thing that decides
 * which forms a given vehicle may be given.
 */
export const SPV_LEGAL_FORMS = [
  /* Singapore — IRAS. `shared/spvEngine.ts` singapore entry. */
  "singapore_limited_partnership",
  "singapore_variable_capital_company",
  /* Ireland — Revenue Commissioners. ireland entry. */
  "ireland_investment_limited_partnership",
  "ireland_regulated_fund",
  /* Australia — ATO. australia entry. */
  "australia_ordinary_partnership",
  "australia_corporate_limited_partnership",
  "australia_amit",
  /* United Arab Emirates — FTA. uae entry. */
  "uae_unincorporated_partnership",
  "uae_unincorporated_partnership_taxable_election",
  "uae_incorporated_partnership",
  /* Jersey — Revenue Jersey. jersey entry. */
  "jersey_partnership",
  "jersey_llc",
  "jersey_company",
  /* Guernsey — Guernsey Revenue Service. guernsey entry. */
  "guernsey_limited_partnership",
  "guernsey_company",
  "guernsey_collective_investment_vehicle",
  /* Luxembourg — Administration des contributions directes. luxembourg entry. */
  "luxembourg_limited_partnership",
  "luxembourg_corporate_vehicle",
] as const;

export type SpvLegalForm = (typeof SPV_LEGAL_FORMS)[number];

/**
 * How each form reads on screen and in a picker. Plain names, in the words the
 * researched guidance uses, never a code.
 */
export const SPV_LEGAL_FORM_LABELS: Record<SpvLegalForm, string> = {
  singapore_limited_partnership: "Limited partnership",
  singapore_variable_capital_company: "Variable capital company (VCC)",
  ireland_investment_limited_partnership: "Investment limited partnership (ILP)",
  ireland_regulated_fund: "Regulated fund, such as an ICAV",
  australia_ordinary_partnership: "Ordinary partnership",
  australia_corporate_limited_partnership: "Corporate limited partnership (Division 5A)",
  australia_amit: "Attribution managed investment trust (AMIT)",
  uae_unincorporated_partnership: "Unincorporated partnership",
  uae_unincorporated_partnership_taxable_election:
    "Unincorporated partnership that has elected to be a taxable person",
  uae_incorporated_partnership: "Incorporated partnership",
  jersey_partnership: "Partnership",
  jersey_llc: "Limited liability company",
  jersey_company: "Company",
  guernsey_limited_partnership: "Private-equity limited partnership",
  guernsey_company: "Company",
  guernsey_collective_investment_vehicle: "Collective investment vehicle",
  luxembourg_limited_partnership: "Common or special limited partnership (SCS / SCSp)",
  luxembourg_corporate_vehicle: "Corporate vehicle",
};

/**
 * WHICH FORMS MAY BE OFFERED FOR WHICH JURISDICTION — the whole of the platform's
 * knowledge, in one exhaustive table.
 *
 * The nine jurisdictions with an EMPTY list are empty on purpose: wave 175 found
 * their tax treatment does not turn on the vehicle's legal form, so it sourced no
 * forms for them and this wave offers none. Per R151.3, where a form cannot be
 * sourced for a jurisdiction, no option is offered for it — an empty picker is
 * the correct answer, not a fabricated one.
 *
 * `Record<SpvJurisdiction, …>` deliberately: adding a seventeenth jurisdiction to
 * `SPV_JURISDICTIONS` will fail the type-check here until someone decides, in
 * writing, which forms it has. That is the point.
 */
export const SPV_LEGAL_FORM_OPTIONS_BY_JURISDICTION: Record<
  SpvJurisdiction,
  readonly SpvLegalForm[]
> = {
  /* ── The seven that are legal-form dependent (wave 175). ─────────────────── */
  singapore: ["singapore_limited_partnership", "singapore_variable_capital_company"],
  ireland: ["ireland_investment_limited_partnership", "ireland_regulated_fund"],
  australia: [
    "australia_ordinary_partnership",
    "australia_corporate_limited_partnership",
    "australia_amit",
  ],
  uae: [
    "uae_unincorporated_partnership",
    "uae_unincorporated_partnership_taxable_election",
    "uae_incorporated_partnership",
  ],
  jersey: ["jersey_partnership", "jersey_llc", "jersey_company"],
  guernsey: [
    "guernsey_limited_partnership",
    "guernsey_company",
    "guernsey_collective_investment_vehicle",
  ],
  luxembourg: ["luxembourg_limited_partnership", "luxembourg_corporate_vehicle"],
  /* ── The nine that are NOT. No options, by ruling. ───────────────────────── */
  delaware: [],
  canadian_lp: [],
  united_kingdom: [],
  mauritius: [],
  hong_kong: [],
  cayman: [],
  bvi: [],
  netherlands: [],
  other: [],
};

/**
 * THE RESOLVED STATEMENT — one branch of wave 175's own conditional, asserted.
 *
 * Read these against `vehicleFormConditional` and `entityTreatment` for the same
 * jurisdiction in `shared/spvEngine.ts`: every clause here appears there. What
 * changes is only that one branch is now stated as this vehicle's position instead
 * of being offered as one of several possibilities, which is the entire point of
 * the field. Nothing is added, no rate is computed, no filing is advised.
 *
 * The Luxembourg entries KEEP THE REVERSE-HYBRID CAVEAT in both branches, because
 * wave 175 records that it depends on the vehicle's INVESTOR BASE and not on its
 * legal form. Stating the legal form therefore does not dispose of it, and
 * dropping it because a form was stated would be a false resolution.
 */
export const SPV_LEGAL_FORM_RESOLVED_TREATMENT: Record<SpvLegalForm, string> = {
  singapore_limited_partnership:
    "This vehicle's legal form is recorded as a limited partnership, which is not liable to tax at entity level in Singapore; each partner is taxed on their own share. There is no investor slip: the precedent partner informs the partners of their share of the partnership's income.",
  singapore_variable_capital_company:
    "This vehicle's legal form is recorded as a variable capital company, which is treated as a company for Singapore income tax purposes and so is taxed at entity level rather than in the partners' hands.",
  ireland_investment_limited_partnership:
    "This vehicle's legal form is recorded as an investment limited partnership, which is tax-transparent in Ireland; the partners self-assess and no investor form is issued.",
  ireland_regulated_fund:
    "This vehicle's legal form is recorded as a regulated fund, such as an Irish collective asset-management vehicle. It is taxed under gross roll-up: the fund itself deducts exit tax on a chargeable event rather than the investors self-assessing.",
  australia_ordinary_partnership:
    "This vehicle's legal form is recorded as an ordinary partnership, which is tax-transparent in Australia; each partner receives a statement of distribution completed at item 53 of the Partnership tax return showing their share of income and credits.",
  australia_corporate_limited_partnership:
    "This vehicle's legal form is recorded as a corporate limited partnership, which is treated as a company for income tax purposes under Division 5A of Part III of the Income Tax Assessment Act 1936; its distributions are treated as dividends rather than as partnership allocations.",
  australia_amit:
    "This vehicle's legal form is recorded as an attribution managed investment trust, which attributes amounts to its members and gives each member an Attribution Managed Investment Trust member annual (AMMA) statement.",
  uae_unincorporated_partnership:
    "This vehicle's legal form is recorded as an unincorporated partnership that has NOT elected to be a taxable person, so it is fiscally transparent by default and is not itself a taxable person. Transparency is routed through the authorised partner's annual declaration to the Federal Tax Authority rather than through any investor form.",
  uae_unincorporated_partnership_taxable_election:
    "This vehicle's legal form is recorded as an unincorporated partnership that HAS elected to be treated as a taxable person, so it is taxed as an entity rather than transparently.",
  uae_incorporated_partnership:
    "This vehicle's legal form is recorded as an incorporated partnership, which is taxed at entity level in the United Arab Emirates.",
  jersey_partnership:
    "This vehicle's legal form is recorded as a partnership, which Jersey treats as tax-transparent; from 2022 all profits are taxed and collected at the individual partner's own tax file, irrespective of partnership type. Partners' shares are reported to Revenue Jersey in the Combined Partnership Notification, not certified to the partner.",
  jersey_llc:
    "This vehicle's legal form is recorded as a Jersey limited liability company, which is also treated as tax-transparent, so partners are taxed on their own share.",
  jersey_company:
    "This vehicle's legal form is recorded as a Jersey company, which is taxed at entity level rather than transparently.",
  guernsey_limited_partnership:
    "This vehicle's legal form is recorded as a private-equity limited partnership, which is transparent for Guernsey income tax; resident partners are taxed on their share.",
  guernsey_company:
    "This vehicle's legal form is recorded as a company, which is taxed at entity level in Guernsey at a zero per cent standard rate unless a higher-rate activity applies.",
  guernsey_collective_investment_vehicle:
    "This vehicle's legal form is recorded as a collective investment vehicle, which may apply for exemption and be treated as non-resident for Guernsey income tax.",
  luxembourg_limited_partnership:
    "This vehicle's legal form is recorded as a common or special limited partnership, which is not taxable as such in Luxembourg; its partners are taxed on their share. The reverse-hybrid rule can still displace that transparency and tax the partnership itself on some investors' allocable income — that depends on the investor base rather than on the legal form, so recording the form does not settle it.",
  luxembourg_corporate_vehicle:
    "This vehicle's legal form is recorded as a corporate vehicle, which is taxed at entity level in Luxembourg. The reverse-hybrid rule concerns partnerships and depends on the investor base rather than on the legal form.",
};

/** How "no value" reads on screen. Not a default value — the absence of one. */
export const SPV_LEGAL_FORM_NOT_STATED_LABEL = "Not stated";

/**
 * R77 plain language, shown beside the picker. It says three true things: the
 * field is optional, nothing is assumed if it is left alone, and what stating it
 * actually buys.
 */
export const SPV_LEGAL_FORM_OPTIONAL_HINT =
  "Optional. Capavate never works this out for you — if you leave it unstated it stays unstated, and the tax panel keeps showing every case that could apply. State it and the panel narrows to the one that applies to this vehicle.";

/**
 * Shown where a jurisdiction has no options. This is an established finding, not
 * a gap: wave 175 found these jurisdictions' treatment does not turn on the
 * vehicle's legal form, so there is nothing for the field to resolve.
 */
export const SPV_LEGAL_FORM_NOT_OFFERED_NOTICE =
  "For this jurisdiction the tax document does not depend on the vehicle's legal form, so there is nothing to state here.";

/** The label above the picker. */
export const SPV_LEGAL_FORM_FIELD_LABEL = "Legal form";

/**
 * The `<select>` value that means NOT STATED.
 *
 * A `<select>` cannot carry `null` as an option value, and the empty string is a
 * value a browser can also produce for "no selection", so the unstated case gets an
 * explicit sentinel that could never collide with a real legal-form code (every one
 * of those is namespaced `jurisdiction.form`). It is translated to `null` at the one
 * place each screen builds its request body, and NEVER sent to the server.
 *
 * Shared, so the two creation surfaces and the settings surface cannot each invent
 * their own spelling of "not stated".
 */
export const SPV_LEGAL_FORM_UNSTATED_SENTINEL = "__legal_form_not_stated__";

/**
 * VALIDATE a caller-supplied legal form against a jurisdiction. Returns the form
 * ONLY when the jurisdiction genuinely offers it; returns `null` for everything
 * else — unknown strings, non-strings, blanks, and forms belonging to a different
 * jurisdiction.
 *
 * READ THIS AS THE NO-INFERENCE GUARANTEE. There is exactly one way for this
 * function to return a non-null value: the caller passed that exact code and the
 * jurisdiction's own option list contains it. It does not fall back to a
 * jurisdiction's first option, it does not match on substrings of a vehicle name,
 * and it has no notion of a "most likely" form. A vehicle whose column is NULL
 * comes back `null` here and every surface then renders wave 175's unstated
 * wording, unchanged.
 */
export function resolveSpvLegalForm(
  jurisdiction: string | null | undefined,
  value: unknown,
): SpvLegalForm | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (typeof jurisdiction !== "string" || jurisdiction.trim() === "") return null;
  const options = SPV_LEGAL_FORM_OPTIONS_BY_JURISDICTION[jurisdiction as SpvJurisdiction];
  if (!options) return null;
  return (options as readonly string[]).includes(trimmed) ? (trimmed as SpvLegalForm) : null;
}

/** Which forms a picker may offer for this jurisdiction. Empty is a real answer. */
export function spvLegalFormOptions(
  jurisdiction: string | null | undefined,
): readonly SpvLegalForm[] {
  if (typeof jurisdiction !== "string") return [];
  return SPV_LEGAL_FORM_OPTIONS_BY_JURISDICTION[jurisdiction as SpvJurisdiction] ?? [];
}

/**
 * The resolved sentence for a (jurisdiction, value) pair, or `null` when the pair
 * does not resolve. `null` is the signal every surface uses to keep rendering
 * wave 175's conditional wording exactly as it renders today.
 */
export function spvLegalFormResolvedTreatment(
  jurisdiction: string | null | undefined,
  value: unknown,
): string | null {
  const form = resolveSpvLegalForm(jurisdiction, value);
  return form ? SPV_LEGAL_FORM_RESOLVED_TREATMENT[form] : null;
}
