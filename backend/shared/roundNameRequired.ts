/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 244 — THE ONE PLACE THAT DECIDES WHETHER A ROUND NAME IS MISSING.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS MODULE EXISTS. The wizard's step 1 did not mark the round name
 * required and surfaced nothing, so a founder could fill in five steps and only
 * discover the problem when the server refused the create. Wave 244 surfaces it
 * at step 1. The brief is explicit that the client must NOT get a second,
 * independent copy of the rule that could drift from the server's — so the
 * predicate lives here once and both sides import it.
 *
 * ── WHAT THE FIRST DRAFT OF THIS MODULE GOT WRONG, AND HOW IT WAS CAUGHT ──────
 *
 * The first version of this file was written after reading only ONE of the
 * server's two round-name checks. That draft named
 * `ROUND_NAME_REQUIRED_MESSAGE = "Please enter a round name."` — the sentence in
 * `server/routes.ts`'s `ROUND_NAME_REQUIRED` catch-branch. A test that drove the
 * REAL route over a REAL socket then returned something else entirely, and the
 * two layers turned out to be these:
 *
 *   LAYER 1 · `server/routes.ts` (the required-field block added in v24.1 Bug B):
 *       if (!body.name || String(body.name).trim().length === 0)
 *           fieldErrors.name = "Round name is required.";
 *       → 400 { error: "validation_failed", fieldErrors: { name: … } }
 *     This is the check a founder ACTUALLY hits. It runs before the store is
 *     called, and the `fieldErrors` envelope is the shape the create wizard
 *     already consumes for per-field highlighting.
 *
 *   LAYER 2 · `server/roundsStore.ts` `createRound()`:
 *       if (roundNameIsMissing(input.name)) throw ROUND_NAME_REQUIRED_CODE
 *       → 400 { error: "ROUND_NAME_REQUIRED", message: "Please enter a round name." }
 *     Reachable only by direct callers of the store. Over HTTP it is shadowed:
 *     layer 1 refuses an empty name first, and for an ABSENT name the route
 *     substitutes a default before the store ever sees it (see the note below).
 *
 * So `ROUND_NAME_REQUIRED_MESSAGE` is the LAYER 1 sentence — the one the API
 * really returns to the wizard — because showing the founder a sentence the
 * platform would never send them would be a fabricated claim about behaviour.
 * Both sentences are exported so neither layer is hidden.
 *
 * ── A DEFECT FOUND WHILE DOING THIS, DELIBERATELY NOT FIXED HERE ──────────────
 *
 * `server/routes.ts` calls the store with
 * `name: String(body.name ?? "Untitled round")`. An API caller who OMITS `name`
 * entirely is refused by layer 1, so the substitution is currently unreachable
 * through that route — but the fallback literal is still there, and any future
 * caller that bypasses layer 1 would silently create a round called "Untitled
 * round" rather than being refused. That is a real latent defect, it is OUTSIDE
 * wave 244's scope (the wave is about step 1 of the wizard), and changing it
 * would change server behaviour that no ruling has authorised. It is reported to
 * the owner in `W244_FOR_THE_OWNER.md` instead of being quietly altered.
 *
 * ── WHY THE LITERALS IN `server/routes.ts` WERE NOT REPLACED ──────────────────
 *
 * This module supplies the PREDICATE to `server/routes.ts` and
 * `server/roundsStore.ts`, so the trim semantics cannot drift. It deliberately
 * does NOT replace the two human sentences in `server/routes.ts`: rewriting live
 * error strings is exactly the sort of edit the silent-drop guard is there to
 * catch, and this wave has no business editing an error-mapping layer. Alignment
 * of the sentences is held instead by
 * `server/__tests__/w244_round_name_required_shared_rule.test.ts`, which drives
 * the real registrar over a real socket and asserts the response body is
 * byte-identical to the constants below. If anyone edits either side, that test
 * goes red. A fence whose installation is unproved is not a fence; this one is
 * proved.
 *
 * THIS MODULE MAKES NO JUDGEMENT ABOUT UNIQUENESS. Duplicate detection stays
 * where it is (`roundNameExistsForCompany`), because it needs the database and
 * cannot be a pure predicate.
 *
 * NOTHING HERE BLOCKS ANYONE. The predicate reports; it does not gate. The
 * wizard's step navigation is untouched — see R221.6 protected work: non-linear
 * wizard tabs preserving typed data.
 */

/**
 * The sentence shown to the founder beside the field at step 1.
 *
 * Byte-identical to `fieldErrors.name` in the 400 `validation_failed` body that
 * `server/routes.ts` returns for an empty round name — LAYER 1 above, the check
 * a founder actually reaches.
 */
export const ROUND_NAME_REQUIRED_MESSAGE = "Round name is required.";

/** The `error` code on the LAYER 1 envelope the create wizard already consumes. */
export const ROUND_NAME_REQUIRED_VALIDATION_CODE = "validation_failed";

/**
 * The typed error code `createRound()` throws — LAYER 2 above. Kept so the store
 * and the route's catch-branch agree on one spelling of the code.
 */
export const ROUND_NAME_REQUIRED_CODE = "ROUND_NAME_REQUIRED";

/**
 * The sentence `server/routes.ts` returns when LAYER 2's throw is what surfaced.
 * Exported so the parity test can pin it too, rather than leaving one of the two
 * layers unfenced.
 */
export const ROUND_NAME_REQUIRED_STORE_MESSAGE = "Please enter a round name.";

/**
 * TRUE when a round name is absent for the purposes of creating a round.
 *
 * The trim is the whole point and it is the server's own long-standing
 * semantics — `"   "` is missing, not present — at BOTH layers:
 * `!body.name || String(body.name).trim().length === 0` in `server/routes.ts`
 * and `(input.name ?? "").trim()` in `server/roundsStore.ts`. Both now call
 * this. It is the only definition of "missing round name" on the platform.
 */
export function roundNameIsMissing(raw: unknown): boolean {
  return String(raw ?? "").trim().length === 0;
}
