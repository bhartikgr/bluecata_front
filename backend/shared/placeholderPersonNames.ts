/**
 * WAVE 190 · ITEM C — A PLACEHOLDER IS NOT A PERSON'S NAME, ON EITHER SIDE.
 *
 * THE DEFECT THIS MODULE EXISTS TO CLOSE. The owner's real account
 * (`ozan@capavate.com`) rendered the avatar initials "NC", because a stored
 * display name of `"New contact"` was treated as a person and initialled. The
 * display guard that exists to catch exactly this — `safeInitials` /
 * `isPlaceholderToken` in `client/src/lib/investorLabels.ts` — held a set of six
 * literals (`new`, `new user`, `user`, `investor`, `—`, `-`) that did not include
 * `"new contact"`, which is the literal the CRM surfaces actually produce.
 *
 * THAT IS TWO DEFECTS, AND FIXING ONLY THE DISPLAY WOULD LEAVE THE WORSE ONE. A
 * screen that stops printing "NC" still has a database row asserting that a real
 * person is named "New contact". So the same set is enforced on the WRITE side
 * too, and it lives in `shared/` for one reason: a copy on the client and a copy
 * on the server is how the two drift, and the drift is silent — the display
 * hides a name the writer still accepts, which is precisely the state this wave
 * found the platform in.
 *
 * WHAT COUNTS AS A PLACEHOLDER. Only exact literals, compared case-insensitively
 * and after trimming. NOT a substring or prefix test, and that restraint is
 * load-bearing: `"Newton"` starts with "new", `"Newman Contact Partners"` contains
 * "contact", and a real person named `"Newt Contactos"` must be able to exist.
 * Refusing a genuine name is a different injustice from accepting a fake one, and
 * this platform is not entitled to either.
 *
 * WHAT THIS MODULE DOES NOT DO.
 *   - It does not MUTATE or repair existing rows. R156.4 reserves the test-data
 *     cleanup to the owner, and silently rewriting a stored name — even an
 *     obviously fake one — is not a display fix, it is an unrequested migration.
 *     Affected rows are reported to the owner instead.
 *   - It does not reject an ABSENT name. That is a different question, already
 *     answered elsewhere (`crmBodyHasIdentity` in server/founderCrmStore.ts, and
 *     the zod refinements on the partner CRM create schemas). This module answers
 *     only "is this submitted string a placeholder pretending to be a name".
 *   - It touches no money, no currency and no amount.
 */

/**
 * THE CANONICAL SET. Lower-case, trimmed, exact-match literals.
 *
 * The first six are the set that `client/src/lib/investorLabels.ts` has enforced
 * on the display side since BUG-01/02/21, preserved EXACTLY so no name that used
 * to be caught stops being caught.
 *
 * `"new contact"` and `"new contact data"` are the wave 190 additions. They are
 * not invented: `"New contact"` is the literal fallback that
 * `composeCrmContactName` passes on both partner CRM create paths
 * (`server/partnerWorkspaceV19Store.ts`), and it is the string that reached the
 * owner's account and rendered as "NC".
 */
export const PLACEHOLDER_PERSON_NAMES: readonly string[] = [
  "new",
  "new user",
  "user",
  "investor",
  "—",
  "-",
  "new contact",
  "new contact data",
];

const PLACEHOLDER_SET = new Set(PLACEHOLDER_PERSON_NAMES);

/**
 * True when `v` is one of the placeholder literals — trimmed, case-insensitive,
 * EXACT match. See the header for why this is not a substring test.
 *
 * Non-strings, `null` and `undefined` answer `false`: absence is not a
 * placeholder, and conflating the two would make this predicate the wrong tool
 * for the "no name supplied" question that other code already answers.
 */
export function isPlaceholderPersonName(v: unknown): boolean {
  if (typeof v !== "string") return false;
  return PLACEHOLDER_SET.has(v.trim().toLowerCase());
}

/**
 * True when any of the supplied name parts is a placeholder, or when joining the
 * supplied parts produces one. Both are needed: a client can submit
 * `{"name": "New contact"}` OR `{"first_name": "New", "last_name": "Contact"}`,
 * and the second spells the same fake name through two fields that are each
 * individually innocuous — `"Contact"` alone is a real surname.
 */
export function submittedNameIsPlaceholder(
  parts: readonly (string | null | undefined)[],
): boolean {
  const present = parts
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter((p) => p.length > 0);
  if (present.some((p) => isPlaceholderPersonName(p))) return true;
  if (present.length > 1 && isPlaceholderPersonName(present.join(" "))) return true;
  return false;
}

/** The machine code for the write refusal. Route mappers key on it; it is NEVER
 *  the text a person reads. */
export const PLACEHOLDER_NAME_REFUSED_CODE = "crm_contact_placeholder_name";

/**
 * The words. Names the fact — the submitted value is the platform's own
 * placeholder text, not a name — and says what to do. Deliberately does not
 * scold: a user pasting the field's own prompt into the field is a reasonable
 * mistake, and the platform accepting it was the actual error.
 */
export const PLACEHOLDER_NAME_REFUSED_MESSAGE =
  "Capavate did not save this contact, because the name supplied is the placeholder text this platform uses for a contact that has no name yet, not a person's name. Stored as a name it would later be shown, and initialled, as though it were a real person. Please enter the contact's actual name.";
