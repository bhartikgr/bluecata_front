/**
 * WAVE 197 / R169 — WHAT A USER LEARNS WHEN WE REFUSE TO SHOW THEM THE ERROR.
 *
 * Item A of R169 removes raw exception text from response bodies. That is only
 * half a fix. The owner's standing requirement is that the user must still
 * learn something TRUE: what failed in their terms, whether anything changed,
 * and what to do next. A sanitised message is not an excuse for a blank one.
 *
 * This module is NOT a second sanitiser. `sanitizeErrorMessage` in
 * `server/lib/sanitize.ts` remains the one and only sanitiser and this module
 * never inspects an error. It only authors the `fallback` sentence that the
 * sanitiser returns in place of withheld text. Two separate jobs, deliberately
 * kept in two places: deciding what is unsafe (sanitize.ts) and deciding what
 * to say instead (here).
 *
 * ── THE READ / WRITE DISTINCTION (wave 196's, kept) ────────────────────────
 *
 * A READ failure may say that nothing was changed, because reading changes
 * nothing. It may NOT say the thing being read is still there — the read may
 * have failed precisely because it is not.
 *
 * A WRITE failure must NEVER claim nothing changed. A 500 can be returned
 * after the row has already been written: the response is not proof of the
 * outcome. So write copy says the outcome could not be confirmed and tells the
 * user to look before retrying, which is the only instruction that is safe
 * whether the write landed or not.
 *
 * ── THE 240-CHARACTER GATE (R166.2) ───────────────────────────────────────
 *
 * `client/src/lib/queryClient.ts:60-65` only shows a server message when it is
 * non-empty, under 240 characters and contains a lowercase letter. A message
 * over that bound is silently replaced by a generic one — which has already
 * swallowed a refusal twice (waves 192 and 195). Every sentence here is built
 * through wave 195's `fitToGate`, reused rather than reinvented, so the gate is
 * satisfied structurally instead of by inspection.
 *
 * ── DIAGNOSTICS ───────────────────────────────────────────────────────────
 *
 * Every call site that uses this copy also logs the full raw error server-side
 * with `log.error`. The detail is relocated to the operator's log, not
 * destroyed. Nothing in this module logs, suppresses or swallows anything.
 */

import { fitToGate } from "./wave195CommitCurrencyDeclaration";

/**
 * A short noun phrase in the USER's terms for the thing that failed — never a
 * table, route, module or column. "your identity document", "the compliance
 * holds", "this event". Callers pass authored prose; nothing is derived from an
 * error or from a schema name.
 */
export type UserFacingSubject = string;

/**
 * READ failure copy.
 *
 * Says: we could not load X; nothing was changed by the attempt; try again /
 * ask an administrator. Deliberately does NOT assert that X still exists.
 */
export function readFailureMessage(subject: UserFacingSubject): string {
  return fitToGate(
    () =>
      `We could not load ${subject} just now. Nothing was changed by the attempt. ` +
      `Please try again in a moment, and if it keeps failing let an administrator ` +
      `know so they can check the server log.`,
  );
}

/**
 * WRITE failure copy.
 *
 * Says: the attempt to X did not complete; we cannot confirm whether it was
 * saved; reload and check before trying again. It never says "nothing was
 * saved", because a failure can land after the server applied the change.
 */
export function writeFailureMessage(subject: UserFacingSubject): string {
  return fitToGate(
    () =>
      `We could not complete ${subject}. We cannot confirm whether it was saved, ` +
      `so please reload and check before trying again. If it keeps failing let an ` +
      `administrator know so they can check the server log.`,
  );
}

/**
 * The two member-facing sites named by R169 Item A, spelled out rather than
 * assembled at the call site, so the exact sentence a Collective member sees is
 * reviewable in one place.
 *
 * `server/sprint20Wave2Routes.ts:244` — POST /api/collective/kyc-upload.
 * A WRITE. The upload inserts into a blob table and then does further work, so
 * the document may or may not have been stored when the failure surfaced.
 * Telling the member to check the list before re-uploading is the only safe
 * instruction: it is correct if the row landed and correct if it did not.
 */
export const KYC_UPLOAD_WRITE_FAILURE = fitToGate(
  () =>
    "We could not finish uploading your identity document. We cannot confirm " +
    "whether it was stored, so please reload this page and check your documents " +
    "before uploading it again. Nothing about your membership status has changed.",
);

/**
 * `server/sprint20Wave2Routes.ts:281` — GET /api/collective/kyc-document/:id.
 * A READ. It says the document could not be retrieved and that nothing was
 * changed. It does NOT say the document is still stored: the read may have
 * failed because it is not, and claiming otherwise would be exactly the kind of
 * comfortable untruth R169 exists to remove.
 */
export const KYC_DOCUMENT_READ_FAILURE = fitToGate(
  () =>
    "We could not retrieve this document just now. Nothing was changed by the " +
    "attempt. Please try again in a moment, and if it keeps failing let a " +
    "Collective administrator know so they can check the server log.",
);

/**
 * `server/lib/bridgeRuntime.ts:254` — POST /api/bridge/inbound. A machine
 * caller (HMAC-authenticated webhook), not a browser. It still must not receive
 * internal detail, and it still needs to know whether to retry. A bridge
 * handler failure may have applied part of its work, so this says the same
 * unconfirmed-outcome thing the human write copy says, in machine-caller terms.
 */
export const BRIDGE_INBOUND_FAILURE = fitToGate(
  () =>
    "The bridge accepted this request but the handler did not complete. The " +
    "outcome is unconfirmed, so re-send only after checking whether it was " +
    "applied. The full error is in the server log.",
);

/** Exported for the gate assertions in the wave 197 tests. */
export const WAVE197_AUTHORED_MESSAGES: readonly string[] = Object.freeze([
  KYC_UPLOAD_WRITE_FAILURE,
  KYC_DOCUMENT_READ_FAILURE,
  BRIDGE_INBOUND_FAILURE,
]);
