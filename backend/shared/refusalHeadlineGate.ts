/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 198 · ITEM C · R166.2 — THE ONE PLACE THAT KEEPS A REFUSAL SHORT ENOUGH
 * TO BE READ.
 * ══════════════════════════════════════════════════════════════════════════════
 * `client/src/lib/queryClient.ts` shows a server-supplied message on screen only
 * when it is STRICTLY under 240 characters and contains a lower-case letter.
 * Anything else is discarded and replaced by a generic "something went wrong".
 * So a refusal that runs long has not partly fired — it has NOT FIRED. The
 * founder is told nothing, and the platform looks broken rather than careful.
 *
 * THIS CLASS HAS NOW BITTEN FOUR TIMES: wave 192's 244-character headline (four
 * characters over); wave 195's first draft at 247; wave 193's own unbounded
 * interpolated headline, found by wave 194 — inside the wave whose job was to fix
 * silent truncation; and, found by wave 198's sweep, a refusal in
 * `shared/roundGovernanceTerms.ts` that is 480+ characters at its SHORTEST, so it
 * has never once reached a screen.
 *
 * Wave 195 built `fitToGate()` as the structural answer and wave 197 exported it.
 * The problem this module solves is LAYERING, not logic: `fitToGate` lives in
 * `server/lib/wave195CommitCurrencyDeclaration.ts`, which imports the database.
 * Three of the headlines wave 198 must bound live in `shared/`, and at least one
 * of those files (`shared/spvClosedToNewCapital.ts`) is imported by the CLIENT —
 * so importing wave 195's module there would drag `getDb`/`rawDb` into the browser
 * bundle. This module is therefore the dependency-free home the helper needed:
 * same bodies, same budgets, importable from server, shared and client alike.
 *
 * ON THE DUPLICATION, WHICH IS DELIBERATE AND TEMPORARY. Wave 195's file still
 * carries its own copy of these two functions. It is NOT edited here, because
 * wave 197 is concurrently working in that file and reverting or colliding with a
 * live wave is worse than a duplicate. The duplication is recorded in
 * `build_log/wave198/W198_BUILD.md` as a one-line follow-up for a wave that owns
 * that file, and a wave-198 test asserts that BOTH implementations return
 * identical output over a shared input table — so the copy cannot drift silently
 * in the meantime. This is a move with a pending cleanup, not a fifth bespoke trim.
 *
 * NOTHING HERE IS COPY. These functions choose HOW MUCH of a caller's sentence to
 * assemble; they never author a sentence, never name a currency (R156.2) and never
 * alter a literal. Callers keep their own words byte-for-byte (R143.1).
 */

/**
 * The client's gate, as a number rather than a comment. `< 240`, strictly:
 * 239 characters is the maximum that reaches a screen.
 */
export const LOOKS_HUMAN_MAX_LENGTH = 240;

/**
 * The default progressively tighter identifier budgets `fitToGate()` falls back
 * through. These are wave 195's MEASURED values, unchanged: its first draft used
 * 48 with slightly longer prose and came out at 247 characters — wave 192's
 * failure reproduced exactly inside a wave written to avoid it.
 */
export const DEFAULT_ID_FRAGMENT_BUDGETS: readonly number[] = [32, 24, 16, 8, 0];

/**
 * Budgets for sentences whose interpolation is a HUMAN-CHOSEN NAME rather than a
 * machine identifier — an SPV's name, a fund's name.
 *
 * WHY A SECOND LADDER AND NOT JUST A BIGGER FIRST NUMBER. A 32-character ceiling
 * is right for a `rev_…`-style id, which carries no meaning worth reading in full.
 * It is wrong for a vehicle's name: a legitimate 50-character SPV name fits under
 * the gate comfortably today and must NOT start arriving truncated, because that
 * would be this wave degrading messages it was sent to repair. `fitToGate` returns
 * the FIRST candidate that fits and `boundedFragment` is a no-op when the input is
 * already within budget, so a wide first rung means normal names render exactly as
 * they do today and only a pathological name is tightened.
 */
export const NAME_FRAGMENT_BUDGETS: readonly number[] = [160, 96, 48, 32, 16, 0];

/**
 * Bound an untrusted fragment so an absurd identifier or name cannot push a
 * message over the gate and get silently swallowed on the client.
 *
 * Newlines and tabs are folded to spaces first: the gate counts characters, but a
 * message carrying raw newlines also renders wrongly wherever it lands.
 */
export function boundedFragment(raw: string, budget: number): string {
  const s = String(raw ?? "").replace(/[\r\n\t]+/g, " ").trim();
  if (s.length === 0) return "(none given)";
  if (budget <= 0) return "(omitted, too long)";
  if (s.length <= budget) return s;
  return `${s.slice(0, budget - 1)}\u2026`;
}

/**
 * BUILD A REFUSAL THAT ACTUALLY REACHES A SCREEN.
 *
 * Assembles the caller's message at the widest fragment budget that still lands
 * under the client's limit, tightening the INTERPOLATION rather than letting it
 * push the whole sentence over the edge. The final budget of 0 omits the fragment
 * entirely, so even a pathological input yields a short, readable sentence.
 *
 * If even that is too long — which means the caller's FIXED prose is itself over
 * the gate, and wave 198's sweep found exactly that case — the result is hard
 * truncated. A truncated sentence a founder can read beats a complete one the
 * client throws away.
 *
 * `budgets` lets a caller pick a ladder suited to what it interpolates; omit it
 * for wave 195's measured default.
 */
export function fitToGate(
  build: (idBudget: number) => string,
  budgets: readonly number[] = DEFAULT_ID_FRAGMENT_BUDGETS,
): string {
  for (let i = 0; i < budgets.length; i += 1) {
    const candidate = build(budgets[i]);
    if (candidate.length < LOOKS_HUMAN_MAX_LENGTH) return candidate;
  }
  return build(budgets.length > 0 ? budgets[budgets.length - 1] : 0).slice(0, LOOKS_HUMAN_MAX_LENGTH - 1);
}
