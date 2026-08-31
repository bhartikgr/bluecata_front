/**
 * WAVE 190 · ITEM B · R152 — A GATE THAT CANNOT FIND ITS ROW MUST REFUSE.
 *
 * THE DEFECT THIS MODULE EXISTS TO CLOSE. `engineAddCommitment`
 * (server/spvEngineStore.ts) runs two gates — the wave 182 close gate
 * `assertSpvOpenToNewCapital` and the wave 189 attestation gate
 * `assertSpvAttestedForNewCapital` — and it ran BOTH of them inside
 * `if (canonical) { … }`, with no `else`. When `spvEngineStore.getSpv()` returned
 * `null` the function fell straight through to `spvFundStore.addCommitment` and
 * the commitment was WRITTEN, unchecked, and reported back as `201 { ok: true }`.
 *
 * That is a fail-open gate on a capital commitment, and on a platform that
 * records limited-partner capital it is worse than having no gate at all: no gate
 * is an absence a reader can see, whereas this reported success. A vehicle whose
 * general partner has told its limited partners it is closed, or a draft vehicle
 * nobody has attested, could take a commitment purely because a lookup missed.
 *
 * WHY THE FAIL-OPEN WAS WRITTEN, AND WHY THAT REASONING WAS HALF-RIGHT. Wave 182
 * recorded it deliberately: "this adapter family serves ids that may exist only
 * in the legacy mirror, and refusing every such write would break commitments on
 * vehicles that were never closed and cannot be, on the strength of a lookup miss
 * rather than a close." The concern is real. There genuinely IS a legitimate
 * absence, and this module names it precisely rather than leaving a blanket open
 * path standing in for it:
 *
 *   LEGITIMATE ABSENCE — THE ID IS LEGACY-SPELLED. A legacy partner SPV is
 *   mirrored into the canonical engine under a DERIVED id,
 *   `spv_mig_${sha256(legacyId).slice(0,24)}` (`_migId`,
 *   `migrateLegacyPartnerSpvAndFunds`, `shadowPersistPartnerSpvToEngine`), while
 *   the legacy cache can keep the original `pspv_*` id
 *   (`shadowPersistFromLegacy`'s `_overrideId`, server/spvFundStore.ts:1442-1489).
 *   So a route holding a legacy id asks `getSpv(partnerId, "pspv_…")`, the
 *   canonical row is filed under `spv_mig_…`, and the lookup misses even though
 *   the canonical row EXISTS and is perfectly gateable.
 *
 * THE ANSWER IS TO RESOLVE HARDER, NOT TO GIVE UP. That absence is an id-spelling
 * problem, and it has a deterministic answer: try the derived id. Only when BOTH
 * spellings miss is the row genuinely unresolved — and at that point the platform
 * knows nothing about the vehicle's close state or its attestation, so it must
 * refuse and say which fact it could not establish. Two other absences are never
 * legitimate and were always meant to be refusals:
 *
 *   NOT LEGITIMATE — CROSS-PARTNER. `getSpv` returns `null` when
 *   `sponsorPartnerId !== partnerId`. That is a tenancy miss, already documented
 *   in that function as "fail-closed: no cross-partner leak", and failing OPEN
 *   after it is a direct contradiction of the comment above it.
 *
 *   NOT LEGITIMATE — COLD OR FAILED HYDRATION. `spvById` is a RAM Map filled by
 *   `hydrateSpvEngineStore()`. If hydration has not run or failed, EVERY lookup
 *   misses and every gate on this path silently disappears. A platform that
 *   forgets its vehicles must not therefore accept capital into them.
 *
 * WHAT THIS DOES NOT TOUCH — SETTLEMENT. Wave 182's lesson, restated because it
 * is the easiest thing to get wrong here: block new CAPACITY, never block
 * SETTLING capital already committed. `engineTransitionCommitment` and
 * `PATCH /api/partner/me/spvs/:id/commitments/:commitmentId` confirm funds on an
 * EXISTING commitment, write no commitment amount, and do not resolve through
 * this module at all. Confirming funds keeps working whatever the canonical row
 * says, including when it cannot be found.
 *
 * MONEY. Nothing here touches an amount. No arithmetic, no scaling, no
 * formatting, no `Number()` / `parseInt` / `parseFloat`, and no currency: this
 * module decides only WHETHER a commitment may proceed, never for how much or in
 * what denomination.
 */

/** The machine code. Carried as the thrown `Error.message` so the route error
 *  mapper can key on it by exact string — it is NEVER what a person reads. The
 *  route serves `refusalHeadline` / `refusalGuidance` as the visible words, so no
 *  ALL-CAPS underscore code reaches a screen. */
export const SPV_CANONICAL_ROW_UNRESOLVED_CODE = "SPV_CANONICAL_ROW_UNRESOLVED";

/**
 * WHICH FACT COULD NOT BE ESTABLISHED. Carried machine-readably alongside the
 * words so a caller can tell the two apart without parsing prose:
 *
 *  - `unresolved_after_legacy_id_derivation` — the id was looked up as given AND
 *    as its derived canonical `spv_mig_*` spelling, and neither exists for this
 *    partner. The vehicle's close state and attestation are both unknown.
 */
export type SpvCanonicalResolutionFailure = "unresolved_after_legacy_id_derivation";

/** The name to print when the vehicle has none recorded. Never a blank quote and
 *  never an internal identifier — a general partner reading a refusal should not
 *  have to recognise a database id. Mirrors `SPV_CLOSED_UNNAMED_VEHICLE`. */
export const SPV_UNRESOLVED_UNNAMED_VEHICLE = "this vehicle";

/* WAVE 198 · ITEM C · R166.2 — the ONE length discipline for refusal headlines.
   Dependency-free by design: this module is reachable from the client. */
import { fitToGate, boundedFragment, NAME_FRAGMENT_BUDGETS } from "./refusalHeadlineGate";

function vehicleName(name: string | null | undefined): string {
  const trimmed = String(name ?? "").trim();
  return trimmed.length > 0 ? trimmed : SPV_UNRESOLVED_UNNAMED_VEHICLE;
}

/**
 * The SHORT form, sized to survive `client/src/lib/queryClient.ts`'s 240-char
 * `looksHuman` gate — anything longer is silently replaced by a generic sentence,
 * which would put the platform back to refusing without saying why.
 *
 * It names the missing FACT (the vehicle's record in the canonical register), not
 * the mechanism, because the reader is a general partner and not an engineer.
 *
 * ── WAVE 198 · ITEM C · R166.2 — IT WAS NOT ACTUALLY SIZED TO SURVIVE IT ───────
 * The paragraph above was WRONG, and wave 198's sweep measured it: the fixed prose
 * is 143 characters, so ANY vehicle name longer than 96 characters pushes the
 * sentence past the gate and the general partner is shown a generic "something
 * went wrong" instead of the named missing fact. Measured worst case with a
 * 120-character name: 263 characters. The comment asserting safety is exactly why
 * this was never caught by review.
 *
 * The prose is unchanged, byte-for-byte (R143.1). Only the NAME is now bounded,
 * through the shared `fitToGate` rather than a bespoke trim — and on the wide
 * `NAME_FRAGMENT_BUDGETS` ladder, so a normal vehicle name still renders in full.
 */
export function spvUnresolvedForCommitmentHeadline(
  spvName: string | null | undefined,
): string {
  return fitToGate(
    (b) =>
      `Capavate did not record this commitment, because it could not find ${boundedFragment(vehicleName(spvName), b)} in the register that says whether the vehicle is still open to new capital.`,
    NAME_FRAGMENT_BUDGETS,
  );
}

/**
 * The UNABRIDGED form. States what was checked, what could not be established,
 * and what to do — and states plainly that no capital was recorded, so nobody
 * has to wonder whether a refused commitment half-landed.
 */
export function spvUnresolvedForCommitmentSentence(args: {
  spvName: string | null | undefined;
}): string {
  const name = vehicleName(args.spvName);
  return [
    `Capavate did not record this commitment. Before recording capital it checks two facts about ${name}: whether the vehicle is still open to new limited partners, and whether its terms have been attested.`,
    `Both facts live on the vehicle's record in the canonical register, and that record could not be found for this vehicle under either the identifier used here or the identifier it would carry after migration.`,
    `Rather than record capital against a vehicle it cannot verify is open, Capavate has declined. No commitment was created and no committed figure changed.`,
    `Confirming funds already received on an existing commitment is unaffected and still works.`,
    `Ask your Capavate contact to check that this vehicle is present in the canonical register; once it is, this commitment can be recorded normally.`,
  ].join(" ");
}
