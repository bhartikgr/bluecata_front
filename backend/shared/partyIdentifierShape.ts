/**
 * NUMBERS BAND · WAVE E (W328) — IS THIS TOKEN AN IDENTIFIER, OR IS IT A NAME?
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THE DEFECT THIS EXISTS FOR. `spv_subscription.investor_id` for one live LP
 * literally holds the string `"Mark Invest Partners"` — a firm's name stored in
 * an id column. `resolveDisplayName` (server/lib/displayNameResolver.ts) looks
 * that string up in `users`, in the credential store and in the user-context
 * personas, misses in all three because it is not a user id, and its
 * `humanizeFallback` then substitutes the placeholder `"Pending member"`. The
 * platform DISCARDED A NAME THAT WAS SITTING IN THE FIELD IT HAD JUST READ.
 *
 * WHAT THIS MODULE IS. One definition, shared by client and server, of the
 * question "does this token look like one of this tree's storage identifiers?"
 * The prefix list is the SAME nine `partyReferenceLabel`
 * (client/src/lib/partnerDisplay.ts:129) already enumerates. It is declared here
 * rather than duplicated as a second regex, and
 * `shared/__tests__/nb_e_prefix_set_has_one_definition.test.ts` asserts this list
 * is byte-identical to the alternation inside `partyReferenceLabel`'s source, so
 * the two cannot drift apart. `partyReferenceLabel` itself is NOT edited — it has
 * 15 production consumers and 32 call sites, and editing it to import from here
 * would be restructuring a working function to make a different function easier.
 *
 * WHAT THIS MODULE IS NOT. It is not a privacy control. It answers a question
 * about the SHAPE of a string and nothing about who may read it. The privacy
 * control for a vehicle's limited partners is `spv.lpVisibility`, enforced in
 * `spvEngineStore.lpRosterForViewer`, and this wave does not touch it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE ACCEPTANCE RULE, AND WHY IT LEANS THE WAY IT DOES
 * ═══════════════════════════════════════════════════════════════════════════
 * A false NEGATIVE here costs a real name being shown as the existing
 * placeholder — the behaviour that already ships. A false POSITIVE would print a
 * raw storage token to a customer as though it were a person's name, which is
 * the exact class of defect wave 115 and wave B spent two waves removing. So the
 * rule refuses everything it cannot vouch for:
 *
 *   1. non-empty after trimming;
 *   2. does not begin with any of the nine known identifier prefixes;
 *   3. contains NO underscore — every identifier shape in this tree is
 *      underscore-separated, so an underscore is evidence of a key, not a name;
 *   4. contains at least one internal space — a bare single token
 *      (`E60238E18FD2`, `abc123`) is not proven to be a name and is therefore
 *      not asserted to be one;
 *   5. is not absurdly long (a runaway blob is not a name).
 *
 * DECLARED LIMIT, NOT PAPERED OVER: a genuine one-word LP name ("Blackstone")
 * fails rule 4 and still renders the existing placeholder. That is a knowingly
 * accepted false negative, reported to the owner, and it is the safe direction.
 * NOTHING IS FABRICATED and NOTHING IS DERIVED: the value returned is the stored
 * string with surrounding whitespace removed, and nothing else.
 */

/**
 * The nine storage-id prefixes this tree mints. Byte-identical, in order, to the
 * alternation in `partyReferenceLabel`. ONE DEFINITION — see the test named in
 * the header if you are about to add a tenth.
 */
export const PARTY_IDENTIFIER_PREFIXES = [
  "u_",
  "ac_",
  "co_",
  "ext_",
  "spvlp_",
  "spv_",
  "round_",
  "inv_",
  "mp_",
] as const;

/** The longest a value may be and still be treated as a human-readable name. */
export const PARTY_DISPLAY_NAME_MAX_LENGTH = 200;

/** True when the value begins with one of this tree's known storage prefixes. */
export function looksLikePartyIdentifier(value: string | null | undefined): boolean {
  const raw = String(value ?? "").trim();
  if (!raw) return false;
  return PARTY_IDENTIFIER_PREFIXES.some((p) => raw.startsWith(p));
}

/**
 * The stored value, when it is demonstrably a readable name rather than an
 * identifier — otherwise `null`, so the caller falls through to its own existing
 * floor. Returns the trimmed stored string verbatim; it never rewrites, expands,
 * title-cases or otherwise invents any part of it.
 */
export function displayNameFromNonIdentifier(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (raw.length > PARTY_DISPLAY_NAME_MAX_LENGTH) return null;
  if (looksLikePartyIdentifier(raw)) return null;
  if (raw.includes("_")) return null;
  if (!/\s/.test(raw)) return null;
  return raw;
}
