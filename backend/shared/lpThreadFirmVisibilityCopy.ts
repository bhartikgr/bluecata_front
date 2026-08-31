/**
 * WAVE 189 · ITEM B · R159.6 clause 3 — THE COPY THE LP READS.
 * ══════════════════════════════════════════════════════════════════════════════
 * Owner: *"Team-visible. Go with your recommendation and global investor grade best
 * practice."* The recommendation the owner adopted was explicit that the DISCLOSURE
 * is what makes the widening investor-grade — *"without it this is a privacy change
 * made silently."*
 *
 * WHY THE COPY LIVES IN `shared/` AND NOT BESIDE EITHER SIDE.
 * The server enforces the fence; the client states the fence to the investor. If each
 * side held its own wording they would drift, and the drift would be invisible: the
 * LP would be reading a promise the server had stopped keeping. One module, imported
 * by both, makes that impossible — and it lets a single test assert that the sentence
 * shown on screen is the sentence the rule is written against.
 *
 * PLAIN LANGUAGE, AND A FACT RATHER THAN A REASSURANCE. It states who can read the
 * thread, states the LIMIT on that reach in the same breath, and does not ask the LP
 * to accept anything or imply they had a choice. It names no individual, because the
 * whole point of the ruling is that the record does not belong to an individual.
 *
 * THESE ARE STATIC LITERALS (R143.1). Nothing is assembled from fragments at render
 * time, so the copy inventory sees one stable string per surface.
 */

/** The headline. Short enough to read at a glance, and it is the point of the notice. */
export const LP_THREAD_FIRM_VISIBILITY_HEADLINE =
  "This conversation is visible to the firm, not just one person";

/**
 * The body. Four facts, in this order and deliberately so:
 *   1. WHAT the thread is — part of the firm's record.
 *   2. WHO can read it — active members of that firm's team.
 *   3. WHY, in the investor's own interest — continuity when someone is away or leaves.
 *   4. THE LIMIT, stated as three explicit refusals, because a widening that names
 *      no boundary reads as unbounded.
 * The last sentence closes the obvious follow-up question: what happens when someone
 * leaves the team.
 */
export const LP_THREAD_FIRM_VISIBILITY_BODY =
  "Your messages here are part of the record held by the partner firm you are dealing with. Active members of that firm's team can read this conversation, so your questions can still be answered if the person you have been speaking to is away or leaves. Nobody outside that firm can read it: not another partner firm, not a founder, and not another investor. Anyone who has left the firm's team loses access.";

/**
 * Used when the firm's registered name is unavailable, which is the COMMON case:
 * `partner_organizations` is empty on every database inspected and no server path
 * writes it, so a name is the exception rather than the rule. The fallback is a
 * stated phrase — never a blank, and never an invented organisation name.
 */
export const LP_THREAD_FIRM_VISIBILITY_UNNAMED_FIRM = "the partner firm you are dealing with";
