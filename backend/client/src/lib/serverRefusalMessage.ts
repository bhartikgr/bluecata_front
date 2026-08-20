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
