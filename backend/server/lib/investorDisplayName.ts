/**
 * NUMBERS BAND · WAVE E (W328) — THE ONE NAME CHAIN FOR A SUBSCRIPTION'S LP.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS FILE EXISTS AT ALL. Two GP-facing screens read the same subscription
 * row and disagreed about who the LP is: the LP Roster printed the placeholder
 * `"Pending member"` while the Fund Register printed
 * `"Reference MARK INVEST PARTNERS"`. They disagreed because each ran its own
 * one-line derivation. Rather than write a THIRD derivation for this wave, the
 * chain is declared once, here, and both screens call it.
 *
 * NO NEW RESOLVER IS WRITTEN (wave B's precedent). `resolveDisplayName` /
 * `resolveDisplayNames` in `server/lib/displayNameResolver.ts` remain the ONLY
 * identity resolver on the platform, and that file is not modified by this wave —
 * it is a server function reached by 23 test files, and its guarantee that a raw
 * `u_…` id can never be returned as a name is correct and must keep firing.
 *
 * WHAT CHANGED IS ONE TERM IN THE CHAIN, NOT THE FALLBACK'S EXISTENCE:
 *
 *     resolved name  ??  LP-invite register name  ??  the stored value when it
 *     is demonstrably NOT an identifier  ??  (caller's own existing floor)
 *
 * The third term is the fix. `humanizeFallback` still fires — for the case it
 * was written for, where there is genuinely nothing to show — but it can no
 * longer swallow a readable name that arrived in its own argument, because that
 * name is taken before the caller ever reaches the placeholder.
 *
 * ORDER IS DELIBERATE AND UNCHANGED ABOVE THE NEW TERM. A resolved platform
 * identity still wins; the name a GP actually typed into the LP invite register
 * still beats the raw stored token. The new term is inserted BELOW both and
 * ABOVE the placeholder, so nothing that previously produced a name can be
 * displaced by it.
 *
 * THIS FILE DECIDES NOTHING ABOUT ENTITLEMENT. It answers "what is this LP
 * called", never "who may see it". `spv.lpVisibility` is the control that
 * answers the second question, it is enforced in
 * `spvEngineStore.lpRosterForViewer`, and no line of this wave reads or writes
 * it. Both callers below are GP-only, partner-scoped routes over the GP's own
 * vehicle.
 *
 * NO MONEY, NO CURRENCY, NO WRITE. Nothing here reads an amount, a currency or a
 * status, and nothing here writes anything at all.
 */
import { resolveDisplayNames } from "./displayNameResolver";
import { lpIdentitiesByInvestorId, lpInviteDisplayName } from "../spvLpInviteStore";
import { displayNameFromNonIdentifier } from "../../shared/partyIdentifierShape";

/**
 * The chain, as a pure function of values the caller already holds. Returns
 * `null` when no honest name exists, so each caller keeps its OWN floor —
 * `"Pending member"` on the LP Roster, `partyReferenceLabel(...)` on the Fund
 * Register. This function never invents a floor of its own.
 */
export function investorRealDisplayName(args: {
  investorId: string;
  /* Already narrowed by the caller to "a name the resolver actually RESOLVED",
     never the resolver's placeholder — `resolveDisplayNames` always returns a
     renderable `name`, and when it resolved nothing that name is a placeholder.
     The pre-existing rule, unchanged and still applied at the call site. */
  resolvedName: string | null;
  identityName: string | null;
  /* ══ WAVE 338 — THE STORED DISPLAY NAME, IF THE DATABASE HAS ONE. ══════
     `spv_subscription.investor_display_name` (migration 0232) for this row, or
     `null`/absent when it is UNKNOWN — which is the case for every row whose
     `investor_id` was ambiguous, and for every row on a database that has not
     yet run 0232.

     OPTIONAL ON PURPOSE. A caller that does not hold the column may omit it
     entirely, and the chain then evaluates exactly as it did before this wave.
     That is what makes wave 338 additive on the READ side as well as in the
     schema.

     WHY IT SITS *HERE* IN THE ORDER — BELOW `identityName`, ABOVE THE HEURISTIC.
     Above the heuristic because a name actually recorded in a column that MEANS
     "name" is better evidence than a guess made by inspecting an id for spaces
     and underscores. Below `identityName` because the name a GP typed into the
     LP invite register is a live, editable, human-authored value, whereas the
     stored name is a one-time transcription of an old field — and wave 338 ships
     NO WRITER, so nothing can correct the stored value yet. Putting it any
     higher would let a stale transcription displace a name a GP had just typed.

     IT CANNOT MAKE ANY ROW WORSE. `??` reaches this term only when both terms
     above are null, and when it is itself null the chain falls through to the
     same `displayNameFromNonIdentifier(investorId)` that has always been the
     last term. A NULL row therefore renders precisely as it does today. */
  storedDisplayName?: string | null;
}): string | null {
  /* An empty or whitespace-only stored value is NOT a name. It is treated as
     UNKNOWN rather than as evidence, so a blank cell can never blank a screen
     that would otherwise have shown the heuristic's answer. */
  const stored =
    typeof args.storedDisplayName === "string" && args.storedDisplayName.trim() !== ""
      ? args.storedDisplayName.trim()
      : null;
  return (
    args.resolvedName ?? args.identityName ?? stored ?? displayNameFromNonIdentifier(args.investorId)
  );
}

/** The resolver answered with a real identity, or it answered with a placeholder
 *  that must not beat anything. Same narrowing the LP Roster builder applies. */
function resolvedNameOf(r: { name: string; resolved: boolean } | undefined): string | null {
  return r?.resolved ? r.name : null;
}

/**
 * The same chain for a caller that holds only investor ids — the Fund Register
 * route. It performs the two reads the LP Roster builder already performs
 * (`resolveDisplayNames` and the LP identity register) so that the two screens
 * cannot answer differently for the same row, which was the whole defect.
 *
 * Values are `string | null`: `null` means "no honest name", never a placeholder.
 */
export function investorDisplayNameMap(
  partnerId: string,
  spvId: string,
  investorIds: readonly string[],
  /* WAVE 338 — investorId → `spv_subscription.investor_display_name`, supplied by
     the caller because this function deliberately performs no store read of its
     own beyond the two identity reads it already did. OPTIONAL: omitted, every
     row is UNKNOWN and the chain is byte-for-byte the pre-wave chain. */
  storedDisplayNames?: ReadonlyMap<string, string | null>,
): Map<string, string | null> {
  const names = resolveDisplayNames(investorIds.map((id) => String(id ?? "").trim()));
  /* FAIL SOFT, NEVER FAIL LOUD ON A READ SURFACE. If the invite register cannot
     be read, the register name is simply unavailable and the chain falls to the
     stored value or to the caller's floor. An unreadable side table must not
     take a fund's register off the air. */
  let identities: Map<string, { email: string } & Record<string, unknown>> | null = null;
  try {
    identities = lpIdentitiesByInvestorId(partnerId, spvId) as unknown as Map<
      string,
      { email: string } & Record<string, unknown>
    >;
  } catch {
    identities = null;
  }
  const out = new Map<string, string | null>();
  for (const raw of investorIds) {
    const key = String(raw ?? "").trim();
    if (out.has(key)) continue;
    const identity = identities?.get(key);
    out.set(
      key,
      investorRealDisplayName({
        investorId: key,
        resolvedName: resolvedNameOf(names.get(key)),
        identityName: identity ? lpInviteDisplayName(identity as never) : null,
        /* WAVE 338 — `?? null` collapses "no map supplied" and "no entry for
           this id" onto the same value, because both mean UNKNOWN. */
        storedDisplayName: storedDisplayNames?.get(key) ?? null,
      }),
    );
  }
  return out;
}
