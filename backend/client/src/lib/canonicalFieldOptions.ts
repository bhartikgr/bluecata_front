/**
 * WAVE A2 · ITEMS 5a / 5b / 7a — CANONICAL DROPDOWNS THAT CANNOT DROP A VALUE.
 *
 * The owner asked for dropdowns on Sector, Stage, HQ-country, SPV-template
 * Jurisdiction and SPV-template Currency, and said he believed the lists already
 * existed in the platform. They do. This module creates NO list. It contains only
 * the arithmetic of turning an existing canonical list plus the value currently on
 * the record into a set of `<option>`s, and it is deliberately JSX-free.
 *
 * WHY THIS EXISTS AT ALL — THE ONE FAILURE MODE IT REMOVES.
 *
 * A native `<select value={x}>` whose option set does not contain `x` does not
 * render `x`. The browser selects the FIRST option instead, React's controlled
 * value silently disagrees with the DOM, and the next submit writes that first
 * option to the database. The user sees a definite-looking answer they never gave.
 * For a partner who typed "Deep-Sea Robotics" into a free-text Sector box before
 * this wave, a naive dropdown would show "Fintech" and eventually store it.
 * R195.5 and R242 forbid exactly that.
 *
 * THE REMEDY IS STRUCTURAL, NOT DEFENSIVE. `canonicalSelectOptions` guarantees
 * that the value on the record is ALWAYS one of the returned option values — if it
 * is not in the canonical list, it is returned as its own extra option, clearly
 * marked as being off-list and kept as entered. The call site can therefore write
 * `value={theStateItself}` and there is no arrangement of stored data for which the
 * select is unable to represent what is on the record. Nothing is coerced, nothing
 * is dropped, and the marked option tells the reader that the value is the
 * partner's own words rather than a Capavate standard term.
 *
 * The free-text input next to each dropdown is KEPT, not replaced. It is the entry
 * path for anything the standard list does not cover, and it is what makes the
 * off-list option reachable for a value nobody has typed yet.
 */

/** The leading option: the field is genuinely unanswered. Never a real value. */
export const CANONICAL_NOT_SPECIFIED_LABEL = "Not specified";

/**
 * Suffix on the option that carries a value the canonical list does not contain.
 * Marked, per R242 — the reader must be able to tell a Capavate standard term from
 * a partner's own words, and neither may be silently converted into the other.
 */
export const CANONICAL_OFF_LIST_SUFFIX = " — kept as entered; not in Capavate's standard list";

/** Hint rendered under each dropdown, pointing at the free-text field beneath it. */
export const CANONICAL_FREE_TEXT_HINT =
  "Not in the list? Type it in the box below and Capavate keeps exactly what you type.";

export interface CanonicalOption {
  value: string;
  label: string;
}

/** True when `value` is a real answer that the canonical list does not contain. */
export function isOffCanonicalList(
  value: string | null | undefined,
  canonical: readonly string[],
): boolean {
  const v = typeof value === "string" ? value : "";
  if (v === "") return false;
  return !canonical.includes(v);
}

/**
 * Build the option set for a canonical dropdown.
 *
 * Order is deliberate and stable:
 *   1. "Not specified" (value `""`) — so absence is expressible and is not a value.
 *   2. the value on the record, IF the canonical list does not contain it, marked.
 *   3. the canonical list, in its own order (its order is the source of truth's).
 *
 * `labelFor` lets a caller render a machine key with its human label without this
 * module needing to know any vocabulary. It is applied ONLY to canonical members;
 * an off-list value is never passed through it, because a label table has nothing
 * true to say about a value it does not contain.
 */
export function canonicalSelectOptions(
  value: string | null | undefined,
  canonical: readonly string[],
  opts?: {
    notSpecifiedLabel?: string;
    labelFor?: (member: string) => string;
    offListSuffix?: string;
    /**
     * Omit the leading "Not specified" option. Used where blank is NOT a
     * truthful answer because some layer below would substitute a value for it.
     * `server/spvTemplateStore.ts`'s `normaliseCurrency` turns a blank currency
     * into "USD", so offering blank on an SPV-template currency dropdown would
     * be offering a route into a silent US-dollar default (R262). A required
     * field with no honest empty state does not get an empty option.
     */
    omitNotSpecified?: boolean;
  },
): CanonicalOption[] {
  const v = typeof value === "string" ? value : "";
  const out: CanonicalOption[] = opts?.omitNotSpecified
    ? []
    : [{ value: "", label: opts?.notSpecifiedLabel ?? CANONICAL_NOT_SPECIFIED_LABEL }];
  if (isOffCanonicalList(v, canonical)) {
    out.push({ value: v, label: `${v}${opts?.offListSuffix ?? CANONICAL_OFF_LIST_SUFFIX}` });
  }
  for (const m of canonical) {
    out.push({ value: m, label: opts?.labelFor ? opts.labelFor(m) : m });
  }
  return out;
}

/**
 * ITEM 5b — the HQ field is ONE free-text column (`companies.hq`) holding city and
 * country together, and it is NOT display-only: it is a grouping key in
 * `components/collective/RegionalKpiRollup.tsx`, a `LIKE` filter in
 * `server/adminV25Store.ts`, and an input to `deriveCurrencyFromRegion` in
 * `pages/founder/Settings.tsx`. `companies` has no country column.
 *
 * So the country dropdown edits the TRAILING SEGMENT of that one string, and it
 * writes the country's FULL NAME rather than its ISO alpha-2 code. Two measured
 * reasons, both about not corrupting data that already exists:
 *
 *   • the same ", XX" slot already holds US STATE codes in shipped rows
 *     ("San Francisco, CA", "Boston, MA" — server/lib/seedDemoData.ts), so an ISO
 *     country code there would be genuinely ambiguous: CA is both California and
 *     Canada.
 *   • `deriveCurrencyFromRegion` ends with `/, ?[a-z]{2}$/ -> "USD"`. Any value
 *     ending in a two-letter segment therefore derives US DOLLARS. Writing "Canada"
 *     matches its `\bcanada\b` rule and derives CAD; writing "CA" would have
 *     derived USD for a Canadian company. Full names avoid MANUFACTURING new
 *     silent-USD defaults, which R262 forbids.
 *
 * The split is lossless in both directions. A trailing segment is treated as the
 * country ONLY if it exactly equals a member of the supplied country-name list;
 * otherwise the whole stored string is the "city" part and is preserved verbatim,
 * so "San Francisco, CA" plus a chosen country becomes
 * "San Francisco, CA, United States" and no character of the original is lost.
 */
export function hqCountryPart(hq: string | null | undefined, countryNames: readonly string[]): string {
  const s = typeof hq === "string" ? hq.trim() : "";
  if (s === "") return "";
  if (countryNames.includes(s)) return s;
  const i = s.lastIndexOf(",");
  if (i < 0) return "";
  const tail = s.slice(i + 1).trim();
  return countryNames.includes(tail) ? tail : "";
}

export function hqCityPart(hq: string | null | undefined, countryNames: readonly string[]): string {
  const s = typeof hq === "string" ? hq.trim() : "";
  if (s === "") return "";
  const country = hqCountryPart(s, countryNames);
  if (country === "") return s;
  if (country === s) return "";
  return s.slice(0, s.length - country.length).replace(/\s*,\s*$/, "").trim();
}

export function composeHq(city: string, country: string): string {
  const c = city.trim();
  const k = country.trim();
  if (c === "" && k === "") return "";
  if (c === "") return k;
  if (k === "") return c;
  return `${c}, ${k}`;
}

/**
 * Shared class string for these native selects. A native `<select>` is used on
 * purpose: it is keyboard-operable and screen-reader-announced with no extra code,
 * it participates in the form exactly as the input beside it does, and it is what
 * `pages/partner/PartnerClientDetail.tsx` already uses for its jurisdiction list.
 */
export const CANONICAL_SELECT_CLASS =
  "w-full border rounded h-9 px-2 text-sm bg-background";
