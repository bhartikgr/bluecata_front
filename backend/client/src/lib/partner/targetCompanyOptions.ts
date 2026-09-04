/**
 * WAVE C · ITEM 8b — THE SPV WIZARD'S TARGET COMPANY, FROM LISTS THAT ALREADY EXIST.
 *
 * ── THE DEFECT THIS REMOVES ─────────────────────────────────────────────────
 * The owner asked that creating an SPV for one of his clients be "seamless and
 * connected with the overall Pipeline, Portfolio Company, SPV sections". The SPV
 * wizard's target-company field was a free-text box whose own placeholder told the
 * partner to go and fetch an internal reference code out of a browser address bar
 * (`spv-w-target-company`). WAVE 106 recorded the missing picker as an open item
 * and it stayed open. This module is the arithmetic of closing it.
 *
 * ── WHY THESE TWO LISTS AND NOT SOME OTHER SET ──────────────────────────────
 * This is the part that had to be MEASURED rather than assumed, because offering a
 * company the server will refuse would be worse than the free-text box: the
 * partner would pick a real-looking option and get a 404 they could not explain.
 *
 * `POST /api/partner/me/spv` — the endpoint this wizard actually posts to — gates
 * `targetCompanyId` through `partnerHasCompanyRelationship`
 * (`server/lib/partnerCompanyLinkGate.ts`), which accepts a company on ANY of six
 * independent proofs:
 *
 *   1. a live partner-owned portfolio row        ← `GET /api/partner/me/portfolio`
 *   2. a live, non-revoked attribution           ← `GET /api/partner/me/clients`
 *   3. a consortium sponsor link
 *   4. a partner pipeline deal
 *   5. a live partner deal promotion
 *   6. an existing partner-sponsored SPV target
 *
 * The two endpoints this module merges are proofs 1 and 2. They are therefore a
 * PROPER SUBSET of what the gate accepts: every option offered will pass, which is
 * the only reason it is honest to offer them.
 *
 * ── AND WHY THE FREE-TEXT BOX MUST STAY ─────────────────────────────────────
 * Proofs 3 to 6 are NOT covered by these two endpoints. A company known to the
 * partner only through a pipeline deal is one the server WILL accept and this
 * picker CANNOT list. So the free-text input beside the dropdown is not defensive
 * habit — it is the only route to a genuinely valid value the list cannot hold.
 * It is KEPT, not replaced (R195.5, and the owner's "I'd rather add than delete").
 *
 * ── NO LIST IS CREATED HERE, AND NOTHING IS DERIVED ─────────────────────────
 * This module invents no company, no name and no identifier. It merges two server
 * responses, de-duplicates by company id, and orders them. It is deliberately
 * JSX-free so it can be run and asserted directly rather than through a render.
 */

/** One row as `GET /api/partner/me/clients` and `/portfolio` both return it. */
export interface TargetCompanySource {
  companyId: string;
  /** Optional because the two endpoints spell it differently: `PortfolioRow` has
   *  `companyName: string | null` and `ClientRow` has `companyName?: string | null`.
   *  Accepting both means neither caller has to reshape its rows first. */
  companyName?: string | null;
}

/** A company the partner may attribute an SPV to, with where we learned of it. */
export interface TargetCompanyChoice {
  companyId: string;
  companyName: string | null;
  /** Which of the partner's own surfaces this company was found on. Both is normal. */
  onClients: boolean;
  onPortfolio: boolean;
}

/**
 * Merge the partner's Clients and Portfolio lists into one de-duplicated set.
 *
 * De-duplication is BY COMPANY ID and it matters: after one "Add Portfolio
 * Company" action the same company legitimately appears on both lists, and
 * offering it twice would make the partner think there were two of it — the exact
 * confusion the owner reported when he asked what the difference between these
 * sections was.
 *
 * `onClients` / `onPortfolio` are retained rather than collapsed so the caller can
 * tell the reader WHERE a company is already known, instead of asserting a single
 * relationship that may not be the whole truth.
 *
 * Ordering: by company name, case-insensitively, with unnamed companies last and
 * then by id. Stable and independent of the order the two responses arrived in, so
 * the dropdown does not reshuffle between loads.
 *
 * A row with a blank or non-string `companyId` is DROPPED, not repaired. An
 * unusable identifier is not a company, and passing it on would put an option in
 * the list that cannot be submitted.
 */
export function mergeTargetCompanyChoices(
  clients: readonly TargetCompanySource[] | null | undefined,
  portfolio: readonly TargetCompanySource[] | null | undefined,
): TargetCompanyChoice[] {
  const byId = new Map<string, TargetCompanyChoice>();

  const absorb = (rows: readonly TargetCompanySource[] | null | undefined, key: "onClients" | "onPortfolio") => {
    for (const r of rows ?? []) {
      const id = typeof r?.companyId === "string" ? r.companyId.trim() : "";
      if (id === "") continue;
      const name = typeof r?.companyName === "string" && r.companyName.trim() !== "" ? r.companyName : null;
      const seen = byId.get(id);
      if (seen) {
        seen[key] = true;
        // Prefer a real name over a null one; never overwrite a name with null.
        if (seen.companyName === null && name !== null) seen.companyName = name;
      } else {
        byId.set(id, { companyId: id, companyName: name, onClients: false, onPortfolio: false });
        byId.get(id)![key] = true;
      }
    }
  };

  absorb(clients, "onClients");
  absorb(portfolio, "onPortfolio");

  return [...byId.values()].sort((a, b) => {
    const an = a.companyName;
    const bn = b.companyName;
    if (an === null && bn !== null) return 1;
    if (bn === null && an !== null) return -1;
    if (an !== null && bn !== null) {
      const c = an.toLowerCase().localeCompare(bn.toLowerCase());
      if (c !== 0) return c;
    }
    return a.companyId.localeCompare(b.companyId);
  });
}

/**
 * The label for one option.
 *
 * Shows the company NAME, because that is what the partner knows the company by,
 * and appends the reference code because that code is what the field stores and
 * what every other Capavate surface shows. Neither is hidden from the other.
 *
 * When the server joined no name in, the code says so IN WORDS rather than
 * printing a bare identifier and letting it read as a name. `companyName` is
 * `string | null` on both endpoints — the join is `?? null` in
 * `server/partnerRoutes.ts` — so this branch is reachable and is not decoration.
 */
export const TARGET_COMPANY_UNNAMED_LABEL = "Name not on record";

export function targetCompanyOptionLabel(choice: TargetCompanyChoice): string {
  const name = choice.companyName ?? TARGET_COMPANY_UNNAMED_LABEL;
  return `${name} · ${choice.companyId}`;
}

/**
 * The hint under the dropdown. ONE function, so the sentence on the screen is
 * true in EVERY branch the query can be in rather than only in the loaded one.
 *
 * It deliberately states a RULE and never a count. A count would be false while
 * loading and false again the moment the partner adds a company in another tab.
 */
export function targetCompanyPickerHint(state: {
  isLoading: boolean;
  isError: boolean;
  choiceCount: number;
}): string {
  if (state.isLoading) {
    return "Loading the companies on your Clients and Portfolio lists. You can type a reference code in the box below instead.";
  }
  if (state.isError) {
    return "Your Clients and Portfolio lists could not be loaded, so this dropdown cannot show them. Type the company's reference code in the box below instead.";
  }
  if (state.choiceCount === 0) {
    return "No companies are on your Clients or Portfolio lists yet. Add one from Add Portfolio Company, or type a reference code in the box below.";
  }
  return "Companies on your Clients and Portfolio lists. For a company known to you only from a Pipeline deal, type its reference code in the box below.";
}

/**
 * Suffix for the option carrying a value the two lists do not contain.
 *
 * The generic `CANONICAL_OFF_LIST_SUFFIX` in `lib/canonicalFieldOptions.ts` says
 * "not in Capavate's standard list", which would be UNTRUE here: a pipeline-only
 * company is a perfectly standard Capavate company that merely is not on these two
 * lists. The distinction is the whole point of item 8b, so it gets its own words.
 */
export const TARGET_COMPANY_OFF_LIST_SUFFIX = " — entered by you; not on your Clients or Portfolio lists";
