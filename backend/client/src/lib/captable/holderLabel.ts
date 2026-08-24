/**
 * WAVE 108 · FINDING 3 — ONE resolver for "what do we call this holder?".
 *
 * Extracted from `client/src/pages/founder/CapTable.tsx` in Wave 108 because the
 * page rendered holder names in TWO places and only one of them was guarded: the
 * member-intelligence cards printed `holderName` raw, so a row whose stored name
 * is an internal id showed `u_redeemed_1782888492403` to the founder as if it
 * were a person's name. Both callers now go through this function.
 *
 * The contract, unchanged from the page:
 *   · a real stored name is returned VERBATIM with kind "name" — this function
 *     never edits customer data and never fabricates a name;
 *   · anything id-shaped (or missing) returns a DESCRIPTION of the record with
 *     kind "description", so the caller can render it so that a reader cannot
 *     mistake it for a name;
 *   · the id itself is never returned. R77: it stays available to machines as a
 *     `data-*` value, which is explicitly allowed — this rule is about what a
 *     human reads.
 */
import { describeRawActor, looksLikeRawKey } from "@/lib/actorLabel";

export function resolveHolderLabel(
  holderName: unknown,
  investorId?: unknown,
): { readonly text: string; readonly kind: "name" | "description" } {
  const name = String(holderName ?? "").trim();
  if (name && !looksLikeRawKey(name)) return { text: name, kind: "name" };
  const id = String(investorId ?? name ?? "").trim();
  if (/^u_redeemed_/.test(id)) return { text: "Redeemed holder", kind: "description" };
  if (id) {
    const described = describeRawActor(id);
    if (described && !looksLikeRawKey(described)) return { text: described, kind: "description" };
  }
  return { text: "Holder (name not recorded)", kind: "description" };
}
