/* ══════════════════════════════════════════════════════════════════════════════
 * WAVE 196 · ITEM A — THE ONE NORMALISER FOR A CAUGHT FAILURE.
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS, STATED AS THE DEFECT IT CLOSES.
 *
 * `client/src/lib/queryClient.ts` already sanitises every HTTP error: an
 * `ApiError`'s `message` is either the server's own human sentence (when it
 * passes `looksHuman` — non-empty, under 240 characters, containing a lowercase
 * letter) or a per-status friendly sentence. Wave 180 corrected the original
 * diagnosis and wave 192's sweep confirmed it independently: those hits are NOT
 * the leak.
 *
 * The leak is the two error classes thrown BEFORE `throwIfResNotOk` ever runs,
 * which therefore never meet the sanitiser at all:
 *
 *   1. a `fetch()` TypeError — the request never completed. The string is written
 *      by the browser, not by Capavate: "Failed to fetch" (Chrome/Edge),
 *      "Load failed" (Safari), "NetworkError when attempting to fetch resource."
 *      (Firefox). A GP on hotel wifi, behind a TLS-intercepting proxy, or hitting
 *      a cold server reads one of those three strings and nothing else.
 *   2. a body-parse SyntaxError — the response arrived but was not JSON, so
 *      `res.json()` throws. On live that is what a proxy or platform error page
 *      produces: `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
 *      R143.4 recorded two of these verbatim off a partner's screen —
 *      `Invite failed | Unexpected end of JSON input` and
 *      `LP commit failed | Expected property name or '}' in JSON at position 1`.
 *
 * ── WHAT THIS MODULE PROMISES, AND WHAT IT REFUSES TO PROMISE ────────────────
 *
 * Each returned sentence says three things and no more: WHAT failed in the
 * user's terms, WHETHER anything changed, and WHAT TO DO NEXT.
 *
 * IT DOES NOT INVENT A CAUSE. A `fetch()` rejection means no reply was received.
 * It does NOT mean the request never arrived: a connection can drop after the
 * server has already applied a write. So for a WRITE this module says the
 * outcome is unconfirmed and tells the reader to reload and look — it never says
 * "nothing was saved", because the code cannot know that. For a READ it may say
 * what you had is still there, because a read changes nothing and that IS
 * certain. The distinction is the whole reason `effect` is a required argument
 * rather than a default: a confidently wrong error message is worse than a vague
 * one, and the compiler now makes the caller state which kind of operation it is.
 *
 * ── NEVER A MACHINE VALUE ON A SCREEN (R143.5) ───────────────────────────────
 *
 * `isMachineFacing` rejects a message that is empty, over-long, has no lowercase
 * letter, or carries an ALL-CAPS underscore token (`SPV_NOT_FOUND`,
 * `SQLITE_CONSTRAINT`). Such a message is replaced by the caller's own fallback
 * sentence. The 240-character bound is deliberately the SAME bound
 * `queryClient.looksHuman` applies (queryClient.ts:60-64): R166.2 records a
 * refusal headline that was 244 characters and therefore could never appear on a
 * screen at all, so a second, looser gate here would re-open exactly that hole.
 *
 * ── EVERY CALL SITE KEEPS ITS OWN LITERAL (R143.1) ───────────────────────────
 *
 * `fallback` is passed in rather than defaulted so each call site keeps its
 * existing user-visible string as a live string literal in its own file. A
 * replaced text node reads to `npm run guard` and to `npm run drop:restyle` as a
 * REMOVED copy string; passing the literal through as an argument keeps it in the
 * source, inside the same `toast(...)` call, so `toastCopy` still fingerprints it.
 * ════════════════════════════════════════════════════════════════════════════ */

/** Whether the failed operation could have changed anything on the server.
 *
 *  `"read"` — a GET / query / preview. Nothing on the server changed, and the
 *  message may say so.
 *  `"write"` — a mutation. The outcome is UNCONFIRMED, and the message must say
 *  that instead of guessing. */
export type FailureEffect = "read" | "write";

/** The upper bound `queryClient.looksHuman` applies to a server message. Held
 *  here as a named constant so a test can assert the two agree. */
export const HUMAN_MESSAGE_MAX_LENGTH = 240;

/** An ALL-CAPS underscore token — `SPV_NOT_FOUND`, `SQLITE_CONSTRAINT`,
 *  `PARTNER_COMMISSION_RATE_UNRESOLVED`. Never allowed on a screen (R143.5). */
const MACHINE_TOKEN = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/;

/* ── THE INTERNAL-DETAIL BACKSTOP ────────────────────────────────────────────
 * Found while writing this wave's rendered-DOM test, not assumed: a 500 whose
 * body is `{ message: "<raw exception text>" }` passes `queryClient.looksHuman`
 * (non-empty, under 240 characters, has a lowercase letter) and is therefore
 * carried on `ApiError.message` and rendered verbatim. Several server handlers do
 * exactly that — `return res.status(500).json({ …, message: (err as Error).message })`
 * — and at least one of them is reachable by an ordinary authenticated member,
 * not only an admin. The full list is in W196_BUILD.md under "FOR THE OWNER".
 *
 * Fixing those handlers is a SERVER change this wave was not asked to make, and
 * two other waves are editing server routes concurrently. This pattern is the
 * CLIENT-side backstop for the same exposure: text carrying an unmistakable
 * internal artefact — a stack frame, a filesystem path, a SQL fragment, a bare
 * `Error:` prefix — is treated as machine-facing and replaced by the call site's
 * own sentence, whatever status carried it.
 *
 * IT IS NOT A SUBSTITUTE FOR THE SERVER FIX. A short, human-looking exception
 * message with no such artefact ("boom") still passes, because nothing in the
 * text distinguishes it from a legitimate one-line server refusal, and
 * suppressing every short message would throw away real refusals a GP needs. */
const LEAKY_TEXT =
  /(\bat\s+\S+:\d+:\d+)|(\/(?:home|var|usr|etc|opt|root|tmp|app)\/)|([A-Za-z]:\\)|\b(?:no such (?:table|column)|constraint failed|SQLITE[_A-Z]*|syntax error near|SELECT\s+\S+\s+FROM|INSERT\s+INTO|UPDATE\s+\S+\s+SET|DELETE\s+FROM)\b|\.(?:ts|tsx|js|mjs|sql):\d+|^\s*(?:Error|TypeError|RangeError|ReferenceError):/i;

/* ── WAVE 197 / R169 — THREE FAMILIES `LEAKY_TEXT` LET THROUGH ───────────────
 *
 * Found by RENDERING, not by reading: wave 197's rendered-DOM test
 * (`client/src/lib/__tests__/w197_no_internal_detail_rendered.test.tsx`) put real
 * driver sentences through `describeFailure` and searched the resulting DOM. Three
 * got all the way to the screen:
 *
 *   1. `table collective_kyc_blobs has no column named payload`
 *      `LEAKY_TEXT` matches `no such table|no such column`. SQLite's OTHER
 *      schema complaint uses neither wording, and it names a table AND a column.
 *      This is the exact sentence the KYC upload route emitted before wave 197.
 *
 *   2. `SELECT user_id, mime, ext FROM collective_kyc_blobs WHERE id = ?`
 *      `LEAKY_TEXT` matches `SELECT\s+\S+\s+FROM` — ONE whitespace-free token
 *      between the keywords. Any real multi-column projection has commas and
 *      spaces, so the pattern caught `SELECT * FROM` and missed every actual
 *      query the platform runs.
 *
 *   3. `better-sqlite3: database connection is not open`
 *      A driver package name with no SQL, no path and no stack frame in it.
 *
 * WHY A SECOND CONSTANT RATHER THAN AN EDIT TO THE FIRST. R143.1: add beside,
 * do not replace. `LEAKY_TEXT` above is left BYTE-IDENTICAL so that wave 196's
 * own test keeps testing wave 196's regex, and a future reviewer can see exactly
 * which families each wave was responsible for. `isMachineFacing` consults both.
 *
 * This is a BACKSTOP and wave 196's caveat still stands in full: a short,
 * human-looking exception message with no unmistakable artefact still passes,
 * because nothing in the text distinguishes it from a real one-line refusal. The
 * server-side fix in `server/lib/sanitize.ts` is the primary defence; this is the
 * second line, and the two lists were deliberately kept in agreement. */
const LEAKY_TEXT_WAVE197 =
  /(?:^|[^A-Za-z0-9_])[a-z][a-z0-9]*(?:_[a-z0-9]+)+(?:[^A-Za-z0-9_]|$)|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\bhas no column named\b|\bSELECT\b[\s\S]{0,200}?\bFROM\b|\b(?:node_modules|better-sqlite3|drizzle)\b|\bPRAGMA\b|\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX|VIEW|TRIGGER)\b|\b(?:UNIQUE|FOREIGN KEY|NOT NULL|CHECK)\s+constraint\b|\bECONN(?:REFUSED|RESET|ABORTED)\b|\bENOENT\b|\bEACCES\b|\bETIMEDOUT\b|\bEPIPE\b|\bcannot find module\b|\brequire is not defined\b|\bcannot read propert(?:y|ies) of\b/i;

/** Browser-authored `fetch()` rejection text, all three engines. */
const NETWORK_TEXT =
  /failed to fetch|load failed|networkerror|network request failed|connection (was )?(closed|reset)|err_internet_disconnected/i;

/** Body-parse failure text, across V8/JSC/SpiderMonkey wordings. */
const PARSE_TEXT =
  /is not valid json|unexpected token|unexpected end of json|json at position|json parse error|unexpected character/i;

/**
 * TRUE when this text must not be shown to a person: absent, over the same
 * 240-character bound the sanitiser uses, no lowercase letter at all, or holding
 * an ALL-CAPS underscore code.
 */
export function isMachineFacing(text: unknown): boolean {
  if (typeof text !== "string") return true;
  const t = text.trim();
  if (t.length === 0) return true;
  if (t.length >= HUMAN_MESSAGE_MAX_LENGTH) return true;
  if (!/[a-z]/.test(t)) return true;
  if (MACHINE_TOKEN.test(t)) return true;
  if (LEAKY_TEXT.test(t)) return true;
  /* WAVE 197 — the three families wave 196's list missed, added beside it. */
  if (LEAKY_TEXT_WAVE197.test(t)) return true;
  return false;
}

/** The four sentences. Exported so a test can assert each one passes the
 *  human-readability gate, and so no call site can reword one of them locally. */
export const FAILURE_COPY = {
  /** A query could not complete because the request never got a reply. */
  unreachableRead:
    "Capavate could not reach the server, so this could not be loaded. This is a loading failure, not an empty list — what you had is still there, and nothing has been changed. Check your connection and try again.",
  /** A mutation got no reply. Whether it was applied is genuinely unknown. */
  unreachableWrite:
    "Capavate could not reach the server, so it cannot confirm whether this was saved. Nothing else has been changed. Reload the page to see the current state before trying again.",
  /** A query got a reply that was not readable data. */
  unreadableRead:
    "The server sent a reply Capavate could not read, so this could not be loaded. This is a loading failure, not an empty list — what you had is still there, and nothing has been changed. Try again in a moment.",
  /** A mutation got an unreadable reply. Outcome genuinely unknown. */
  unreadableWrite:
    "The server sent a reply Capavate could not read, so it cannot confirm whether this was saved. Nothing else has been changed. Reload the page to see the current state before trying again.",
  /* ── THE "NO EXPLANATION" PAIR ──────────────────────────────────────────────
   * Used when a failure IS reported but its text cannot be shown — empty, over
   * the 240-character bound, an ALL-CAPS code, or carrying internal detail.
   *
   * POST-BUILD REVIEW PASS (a) ADDED THESE, having found a hole this wave had
   * just created: most call sites originally fell back to `e.message`, so passing
   * that expression through as `fallback` meant a machine-facing message was
   * refused by the guard and then returned anyway, as the fallback. These two
   * sentences are the honest thing to say instead — and note what they do NOT
   * say: they do not guess at a cause, because at this point the code genuinely
   * has none it can state. */
  unstatedRead:
    "Capavate could not load this, and it did not receive an explanation it can show you. This is a loading failure, not an empty list — what you had is still there. Try again in a moment.",
  unstatedWrite:
    "Capavate could not complete this, and it did not receive an explanation it can show you. Nothing else has been changed. Reload the page to see the current state before trying again.",
} as const;

/* ══════════════════════════════════════════════════════════════════════════════
 * WAVE 203 · ITEM C — STATE ONLY WHAT IS CERTAIN (R178.7).
 * ══════════════════════════════════════════════════════════════════════════════
 * THE DEFECT, IN ONE SENTENCE: the three READ sentences above end the clause
 * "not an empty list" with "— what you had is still there". A read can fail
 * PRECISELY BECAUSE THE RECORD IS GONE. So on ~28 screens the platform asserted
 * a fact about server state that a failed read cannot hold. Wave 196's own
 * header argued the opposite ("For a READ it may say what you had is still
 * there, because a read changes nothing and that IS certain") — and that
 * reasoning is exactly one step short: a read changing nothing is certain; what
 * the server currently holds is not, and the sentence claimed the second.
 *
 * WHAT THE NEW WORDING SAYS, AND WHAT IT REFUSES TO SAY:
 *   ✓ loading failed
 *   ✓ this is NOT the same as an empty result
 *   ✓ the error itself changed nothing
 *   ✗ it does NOT claim the underlying data still exists — it says that what is
 *     on the server is unknown until the load succeeds, which is the weakest and
 *     therefore the only honest statement available here.
 *
 * ── WHY A NEW CONST AND NOT AN EDIT ABOVE (R143.1) ───────────────────────────
 * A replaced text node scores as a REMOVED copy string to `npm run guard` and to
 * `npm run drop:restyle`, and this wording reaches 28 live screens. The three
 * originals are therefore left BYTE-IDENTICAL in `FAILURE_COPY` and the honest
 * sentences are ADDED BESIDE them, exactly as wave 197 added
 * `LEAKY_TEXT_WAVE197` beside `LEAKY_TEXT`. NO ALLOW-LIST ENTRY WAS ADDED
 * ANYWHERE. `describeFailure` below reads from this object for reads.
 *
 * A SEPARATE OBJECT rather than three more keys inside `FAILURE_COPY`, because
 * `wave196_failure_message.test.ts` iterates `Object.entries(FAILURE_COPY)` and
 * pins its length at 6; keeping that pin true is worth more than one object.
 *
 * ── THE WRITE SENTENCES ARE UNTOUCHED, ON PURPOSE ────────────────────────────
 * Wave 196's read/write distinction is the one thing here that must survive: a
 * connection can drop AFTER the server applied a write, so a write failure must
 * never claim nothing changed. Only the read wording changes in this wave.
 *
 * ── THE 240-CHARACTER GATE ───────────────────────────────────────────────────
 * All three are under `HUMAN_MESSAGE_MAX_LENGTH`, contain a lowercase letter,
 * carry no ALL-CAPS underscore token and match none of the LEAKY_TEXT families,
 * i.e. `isMachineFacing` returns false for each. This limit has silently
 * swallowed messages before, so it is asserted mechanically in
 * `client/src/lib/__tests__/w203_honest_read_failure.test.ts`, not eyeballed.
 * ════════════════════════════════════════════════════════════════════════════ */
export const W203_HONEST_READ_COPY = {
  unreachableRead:
    "Capavate could not reach the server, so this could not be loaded. This is a loading failure, not an empty list, and nothing has been changed. What is on the server is unknown until this loads — check your connection and try again.",
  unreadableRead:
    "The server sent a reply Capavate could not read, so this could not be loaded. This is a loading failure, not an empty list, and nothing has been changed. What is on the server is unknown until this loads — try again in a moment.",
  unstatedRead:
    "Capavate could not load this, and it did not receive an explanation it can show you. This is a loading failure, not an empty list, and nothing has been changed. What is on the server is unknown until this loads — try again.",
} as const;

/** What kind of failure this is, for callers that need to branch as well as
 *  print (and for tests that need to assert the classification directly). */
export type FailureKind = "unreachable" | "unreadable" | "reported" | "unstated";

/** Classify a caught value WITHOUT deciding what to print. Split out so the
 *  classification can be tested on its own and cannot drift from the copy. */
export function classifyFailure(e: unknown): FailureKind {
  if (e instanceof Error) {
    const text = typeof e.message === "string" ? e.message : "";
    /* `name` first: a real `TypeError` from `fetch()` is unambiguous and does not
       depend on matching a browser's wording. The text test is the fallback for
       an error that crossed a boundary and lost its prototype. */
    if (e.name === "TypeError" || NETWORK_TEXT.test(text)) return "unreachable";
    if (e.name === "SyntaxError" || PARSE_TEXT.test(text)) return "unreadable";
    if (!isMachineFacing(text)) return "reported";
    return "unstated";
  }
  return "unstated";
}

/**
 * The one expression every caught failure should be rendered through.
 *
 * - An `ApiError` (or any Error carrying a human sentence) is returned as-is:
 *   `throwIfResNotOk` already curated it, and rewriting it here would throw away
 *   the server's own, more specific, refusal.
 * - A `fetch()` TypeError or a body-parse SyntaxError becomes one of the four
 *   stated sentences above, chosen by `effect`.
 * - Anything else — a non-`Error` throw, an empty message, a machine code —
 *   becomes the caller's own `fallback` literal.
 *
 * NOTE ON ORDERING: the network/parse test runs BEFORE the "is it human?" test,
 * because "Failed to fetch" and "Load failed" both READ as human sentences while
 * telling a GP nothing about their own money.
 */
export function describeFailure(e: unknown, effect: FailureEffect, fallback?: string): string {
  /* `fallback` is OPTIONAL, and omitting it is the CORRECT choice at a site whose
     previous fallback was the raw `e.message`: handing that expression back would
     re-admit exactly the text `isMachineFacing` just refused. */
  /* WAVE 203 · ITEM C — the READ branches now read from `W203_HONEST_READ_COPY`.
     The WRITE branches are unchanged and still read from `FAILURE_COPY`. */
  const stated =
    fallback ?? (effect === "read" ? W203_HONEST_READ_COPY.unstatedRead : FAILURE_COPY.unstatedWrite);
  const kind = classifyFailure(e);
  if (kind === "unreachable") {
    return effect === "read" ? W203_HONEST_READ_COPY.unreachableRead : FAILURE_COPY.unreachableWrite;
  }
  if (kind === "unreadable") {
    return effect === "read" ? W203_HONEST_READ_COPY.unreadableRead : FAILURE_COPY.unreadableWrite;
  }
  if (kind === "reported" && e instanceof Error) return e.message.trim();
  return stated;
}
