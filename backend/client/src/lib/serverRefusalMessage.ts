/**
 * WAVE 69 · R58 — READ THE SERVER'S OWN SENTENCE, NOT THE BOUNDARY'S SUBSTITUTE.
 *
 * WHY THIS MODULE EXISTS, MEASURED NOT ASSUMED.
 * `client/src/lib/queryClient.ts:60-65` accepts the server's `message` only when
 * it "looks human", and one clause of that test is `serverMessage.length < 240`.
 * Every refusal this platform writes is LONGER than that:
 *
 *   validateMaturityMonths(20260707)                 543 chars
 *   validateExpiryYears(20260707)                    526 chars
 *   validateValuationCap(0)                          426 chars
 *   validateStrikePrice(0)                           424 chars
 *   PARTNER_COMMISSION_RATE_UNRESOLVED (409)         431 chars
 *
 * So `ApiError.message` is silently replaced by a generic sentence
 * ("Some of the information was invalid. Please review and try again." /
 *  "That action conflicts with the current state. Refresh and try again.")
 * while the real text survives untouched on `ApiError.payload.message`.
 *
 * CONSEQUENCE, AND THE REASON THIS IS A SHARED FUNCTION RATHER THAN A LOCAL
 * IDIOM: the obvious patch — `description: err.message` — renders the GENERIC
 * sentence and would let a wave report "the refusal is now visible" while the
 * founder still never sees the words. Every consumer must read the payload.
 * `RoundNew.tsx:675-702` already reads `err.payload` twice for other codes;
 * this is the same idiom, named once.
 *
 * THIS MODULE DOES NOT FIX `queryClient.ts`. The 240-char gate is the tree-wide
 * 4xx fallback for ~15 `ApiError` consumers and changing it is out of scope
 * (Wave 69 OQ-3). This reads around it.
 */
import { ApiError } from "@/lib/queryClient";
/* WAVE 170 · R77 — the shared copy map, imported (not merely re-exported at the
   foot of this file) because `partnerActionRefusalText` below CALLS it. */
import {
  spvSubscriptionRefusalCopy as spvSubscriptionRefusalCopyShared,
  spvSubscriptionRefusalHeadline as spvSubscriptionRefusalHeadlineShared,
} from "@shared/spvSubscriptionRefusalCopy";

/**
 * The server's OWN refusal sentence, un-truncated, or `null` when there is none.
 *
 * Returns `null` — never a fabricated apology — when the error is not an
 * `ApiError`, or when the body carried no `message`. Callers keep their existing
 * fallback copy for that case; nothing is invented here.
 */
export function serverRefusalMessage(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const p = err.payload as { message?: unknown } | null | undefined;
  return typeof p?.message === "string" && p.message.length > 0 ? p.message : null;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * WAVE 73 · ITEM 1 — THE SAME JOB, FOR THE SURFACES THAT NEVER WENT THROUGH
 * `queryClient` AT ALL.
 * ══════════════════════════════════════════════════════════════════════════════
 * Wave 69 fixed the `ApiError` consumers. It bypassed the OTHER half of the
 * platform: screens with their OWN hand-rolled `fetch` wrapper, which never
 * construct an `ApiError` and so cannot use `serverRefusalMessage` above. Five
 * of them read `j.error` — an enum code — and THREW THE SERVER'S SENTENCE AWAY:
 *
 *   client/src/pages/admin/ConsortiumApplicationsPage.tsx  `fetchJson`
 *   client/src/pages/partner/OnboardingChecklistPage.tsx   `fetchJson`
 *   client/src/pages/settings/PrivacyPage.tsx              `postJson`
 *   client/src/pages/admin/AuditChainVerifyPage.tsx        `getJson` (body dropped entirely)
 *   client/src/pages/founder/Subscribe.tsx                 the reactivate branch
 *
 * Measured example. `server/consortiumApplyStore.ts:2162-2174` answers a refused
 * partner approval with a 409 whose `message` is 393 characters and names the
 * ruling, the rollback and the fix. An admin saw:
 *
 *     HTTP 409: partner_approval_invoice_refused
 *
 * THESE FUNCTIONS LIVE HERE, IN THE MODULE WAVE 69 CREATED, ON PURPOSE. Two
 * authorities for one job is the defect this project keeps paying for: a second
 * module would be a second place for the next agent to fix half of.
 * ════════════════════════════════════════════════════════════════════════════ */

/** A parsed JSON error body, or `null` when the body is not one. */
type ServerErrorBody = { message?: unknown; error?: unknown; reason?: unknown; detail?: unknown };

/**
 * The server's own sentence out of an already-parsed response BODY, or `null`.
 *
 * `message` only. `error` is an enum code and `reason` is an internal string;
 * neither is an explanation, and inventing one here is what R58 forbids.
 */
export function serverRefusalMessageFromBody(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const m = (body as ServerErrorBody).message;
  return typeof m === "string" && m.trim().length > 0 ? m : null;
}

/**
 * Turn a FAILED `Response` into the text a person should read.
 *
 * Order, and the reason for it:
 *  1. the server's `message` — the sentence it actually wrote — with the enum
 *     code APPENDED (not substituted) so the admin-visible code an operator may
 *     have been quoting in a ticket is still on the screen (R44: ADD);
 *  2. failing that, the existing `HTTP <status>: <code>` shape, BYTE-FOR-BYTE as
 *     each caller built it before, so a body that carries no explanation loses
 *     nothing;
 *  3. failing even that, `HTTP <status>` alone.
 *
 * NOTHING IS INVENTED. There is no apology text in here, no "please try again",
 * and no default sentence: when the server explained nothing, the caller's old
 * string is what renders.
 *
 * The `Response` is READ ONCE, here, so a caller cannot burn the stream twice.
 */
export async function serverRefusalText(res: Response): Promise<string> {
  const raw = await res.text().catch(() => "");
  let body: unknown = null;
  try {
    body = JSON.parse(raw) as unknown;
  } catch {
    /* Not JSON — fall through to the text below. */
  }
  const message = serverRefusalMessageFromBody(body);
  const code =
    body && typeof body === "object" && typeof (body as ServerErrorBody).error === "string"
      ? ((body as ServerErrorBody).error as string)
      : "";
  if (message) return code ? `${message} (refusal code: ${code})` : message;
  const detail = code || raw.trim().slice(0, 200);
  return `HTTP ${res.status}${detail ? `: ${detail}` : ""}`;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * WAVE 161-162 · BATCH 3 · R77 — COPY BEFORE THE THROW. MOVED, NOT COPIED.
 * ══════════════════════════════════════════════════════════════════════════════
 * Wave 161 wrote this map HERE, and that was the right place for it right up to
 * the moment wave 162 had to make the SERVER answer with the sentence. This
 * module cannot be imported by server code: it imports `ApiError` from
 * `@/lib/queryClient` above, which drags `@tanstack/react-query` in with it.
 *
 * So the sentences MOVED to `shared/spvSubscriptionRefusalCopy.ts`, which both
 * halves of the tree already import, and are re-exported here UNCHANGED. Every
 * existing consumer of `SPV_SUBSCRIPTION_REFUSAL_COPY` and
 * `spvSubscriptionRefusalCopy` keeps working against the same names with the same
 * strings; nothing was rewritten and no sentence was dropped.
 *
 * A COPY would have been the easy edit and the wrong one: two authorities for one
 * refusal sentence is how the server and the screen end up saying different
 * things about the same refusal.
 *
 * `SPV_SUBSCRIPTION_REFUSAL_HEADLINE` is re-exported too — that is the shorter
 * form the server puts in the response `message`, and it exists because
 * `queryClient.ts:60-65` discards any server message of 240 characters or more.
 * The reasoning is written out in full in the shared module.
 * ════════════════════════════════════════════════════════════════════════════ */
export {
  SPV_SUBSCRIPTION_REFUSAL_CODES,
  SPV_SUBSCRIPTION_REFUSAL_COPY,
  SPV_SUBSCRIPTION_REFUSAL_HEADLINE,
  SPV_SUBSCRIPTION_REFUSAL_HEADLINE_MAX_CHARS,
  spvSubscriptionRefusalCopy,
  spvSubscriptionRefusalHeadline,
  spvSubscriptionRefusalHeadlinesOverLimit,
} from "@shared/spvSubscriptionRefusalCopy";
export type { SpvSubscriptionRefusalCode } from "@shared/spvSubscriptionRefusalCopy";

/* ══════════════════════════════════════════════════════════════════════════════
 * WAVE 170 · BATCH 4 ITEM B · R77 / R111 Q13 — WHAT A GP READS WHEN A GP ACTION
 * FAILS, INCLUDING THE FAILURES NOBODY WROTE WORDS FOR.
 * ══════════════════════════════════════════════════════════════════════════════
 * FIVE CHANNELS ON ONE SCREEN. `client/src/pages/partner/PartnerSpvDetail.tsx`
 * had `description: e.message` in five `onError` handlers — LP invite, LP commit,
 * capital call, distribution, add-to-CRM. Waves 162/164/166 attached plain
 * language to the codes THEY introduced, and those sentences arrive on
 * `payload.message`; `e.message` carried them only by luck of the 240-character
 * `looksHuman` gate in `queryClient.ts:60-65`. Two things went wrong for
 * everything else, and they are DIFFERENT defects:
 *
 *  (1) A NON-`ApiError` throw inside `mutationFn` renders its `.message`
 *      VERBATIM. `res.json()` on a truncated body gives
 *      "Unexpected end of JSON input"; a helper throwing a bare code puts
 *      LP_IDENTITY_PERSIST_FAILED on screen in front of a paying client. That is
 *      the R77 breach, and it is proven in the rendered DOM by
 *      `wave170_raw_error_dom.test.tsx` (fail-before recorded).
 *
 *  (2) An `ApiError` whose body carries NO `message` — the unmapped tail of
 *      `err()` in `server/spvEngineRoutes.ts`, and the whole of the legacy
 *      capital-call adapter (`{ error: "CAPITAL_CALL_FAILED" }`,
 *      `{ error: "INVALID_BODY", details }`) — renders the boundary's GENERIC
 *      substitute: "Something went wrong on our side. Please try again." No next
 *      step, and nothing the owner can trace. R77 asks for a plain sentence that
 *      NAMES THE NEXT STEP; a generic apology is not one.
 *
 * SO THE RESOLUTION ORDER BELOW IS THE POINT, not the fallback string:
 *
 *   1. `payload.message` — the server's own sentence. This is what keeps wave
 *      164's cap-split disclosure and wave 166's offline-confirmation refusal
 *      reaching the GP EXACTLY as they do today, as ONE sentence. Nothing is
 *      appended to it: a second sentence of our own beside the server's would be
 *      two messages competing to explain one refusal.
 *   2. `payload.guidance` — the unabridged form, when there is no headline.
 *   3. the shared copy map, by `payload.error` and by the head before `:`, which
 *      is how INVALID_SUBSCRIPTION_STATUS and friends carry their diagnosis — so
 *      a code that HAS copy cannot arrive naked even if a route forgot to attach
 *      it.
 *   4. `e.message`, but ONLY when it reads as a sentence a person wrote. This is
 *      what preserves `commitMut`'s client-side money refusal
 *      (`parseWholeUnits`, e.g. "Commitment amount cannot be negative. Enter the
 *      amount as a positive figure in USD."), which is a real refusal a GP must
 *      keep seeing and which arrives as a NON-`ApiError` throw.
 *   5. otherwise a plain sentence naming the next step, plus the opaque
 *      reference the server minted (`incidentCode`, wave 148's ESG-XXXXXXXX
 *      pattern, now SPV-XXXXXXXX), or the words "Not on record" when there is no
 *      reference — never a dash, never a zero, never the raw code (R111 Q13).
 *
 * WHY IT LIVES IN THIS MODULE. Wave 73's note above says it plainly: two
 * authorities for one job is the defect this project keeps paying for. This is
 * the module that already owns "what does the user read when the server
 * refuses", and it already re-exports the shared copy map, so the sentence and
 * the fallback are decided in one place.
 * ════════════════════════════════════════════════════════════════════════════ */

/** R111 Q13 — the words for a value that is not on record. Never a dash or 0. */
export const PARTNER_ACTION_REFERENCE_NOT_ON_RECORD = "Not on record";

/**
 * The plain sentence for a refusal with no words of its own. It NAMES THE NEXT
 * STEP (R77): nothing changed, try again, and if it refuses again quote the
 * reference. The reference is appended by `partnerActionRefusalText`.
 */
export const PARTNER_ACTION_REFUSAL_FALLBACK =
  "We could not complete that action, and nothing was changed. Try it once more, and if it is refused again quote this reference to support so the refusal can be traced:";

/**
 * Does this string read as a sentence a PERSON wrote, rather than something our
 * own machinery threw?
 *
 * Every clause is here because a real string failed it, and the R77 clause is
 * the load-bearing one: a message containing an ALL_CAPS_UNDERSCORE token is an
 * internal identifier no matter how much prose surrounds it.
 */
export function isPlainRefusalSentence(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const t = value.trim();
  if (t.length < 12 || t.length > 2000) return false;
  if (!/[a-z]/.test(t)) return false;                             // "EXCEEDS_CAP"
  if (!/\s/.test(t)) return false;                                // one token is never a sentence
  if (!/[.!?]$/.test(t)) return false;                            // "Failed to fetch"
  if (/^[A-Z][A-Z0-9_]*(?::|$)/.test(t)) return false;            // code, or code:diagnosis
  if (/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/.test(t)) return false;  // R77 — embedded code
  if (/^[A-Za-z]*Error\b/.test(t)) return false;                  // "SyntaxError: Unexpected token"
  if (/\bat\s+\S+:\d+/.test(t)) return false;                     // a stack frame
  return true;
}

/** The opaque, R77-safe reference the server minted for THIS occurrence. */
function referenceFromPayload(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const c = (payload as { incidentCode?: unknown }).incidentCode;
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
  }
  return PARTNER_ACTION_REFERENCE_NOT_ON_RECORD;
}

/**
 * The text to show a partner when one of their actions is refused. NEVER an
 * internal code, NEVER an empty string, NEVER a bare dash.
 *
 * See the block above for the resolution order and the reason for each step.
 */
export function partnerActionRefusalText(err: unknown): string {
  if (err instanceof ApiError) {
    const p = (err.payload ?? null) as
      | { message?: unknown; guidance?: unknown; error?: unknown }
      | null;
    /* 1 + 2 — the server's own words, unmodified and un-truncated. */
    if (isPlainRefusalSentence(p?.message)) return String(p!.message).trim();
    if (isPlainRefusalSentence(p?.guidance)) return String(p!.guidance).trim();
    /* 3 — the shared copy map, exact code then the head before `:`. */
    const code =
      typeof p?.error === "string" && p.error.length > 0
        ? p.error
        : typeof err.code === "string" && err.code
          ? err.code
          : "";
    if (code) {
      const exact = spvSubscriptionRefusalHeadlineShared(code) ?? spvSubscriptionRefusalCopyShared(code);
      if (isPlainRefusalSentence(exact)) return String(exact).trim();
      const head = code.split(":")[0] ?? "";
      if (head && head !== code) {
        const byHead = spvSubscriptionRefusalHeadlineShared(head) ?? spvSubscriptionRefusalCopyShared(head);
        if (isPlainRefusalSentence(byHead)) return String(byHead).trim();
      }
    }
    /* 4/5 — `e.message` here is the boundary's own generic substitute (the real
       sentence, if there was one, was returned above), so it explains nothing on
       its own. The plain sentence below names the next step and carries the
       traceable reference beside it. */
    return `${PARTNER_ACTION_REFUSAL_FALLBACK} ${referenceFromPayload(err.payload)}`;
  }
  /* A NON-`ApiError` throw. Its `.message` is whatever threw — our own
     client-side money refusal (keep it) or an internal string (never show it). */
  if (err instanceof Error && isPlainRefusalSentence(err.message)) return err.message.trim();
  if (isPlainRefusalSentence(err)) return String(err).trim();
  return `${PARTNER_ACTION_REFUSAL_FALLBACK} ${PARTNER_ACTION_REFERENCE_NOT_ON_RECORD}`;
}
