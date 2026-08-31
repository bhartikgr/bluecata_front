/**
 * WAVE 22 · ITEM 4 (REVIEW B F-4) — "a failed load is not an empty list".
 *
 * THE BUG CLASS. Nine non-partner pages rendered a friendly empty state on a
 * 403 / 429 / 500 — the investor CRM told a user with live contacts
 * "No contacts yet — Start building your investor network". A permission
 * failure or a server error was presented to the user as the FACT that they
 * have no data. Wave 18 fixed exactly this on the partner side (W-4,
 * `client/src/pages/partner/PartnerSpvEngine.tsx:912-941`); this component is
 * that same shape, extracted so the remaining pages share ONE implementation
 * instead of nine drifting copies.
 *
 * THE SHAPE (unchanged from W-4, deliberately):
 *   1. a SIBLING `role="alert"` block — never text spliced into an existing
 *      node, which the silent-drop guard reads as a removal plus an addition;
 *   2. a retry affordance wired to the query's own `refetch()`;
 *   3. copy that states NO count and NO money, and says in plain words that
 *      this is a loading failure and not an empty list.
 *
 * AND THE OTHER HALF, which is the half that actually gets forgotten: the
 * caller must re-gate its empty state on `isSuccess`, not merely on
 * `!isLoading && !isError`. A React Query that is PAUSED (the user is offline)
 * is neither loading, nor fetching, nor errored — so a `!isLoading && !isError`
 * gate still renders "No contacts yet" to someone who is simply disconnected.
 * Wave 18's own falsification run MISSED that mutation the first time; the
 * harness for this wave covers it explicitly.
 */
/* ===========================================================================
   WAVE 183 - ITEM C: THE GOOD COPY IS PRESERVED, AND A DIAGNOSIS IS ADDED
   BESIDE IT RATHER THAN OVER IT.

   Wave 183 found four surfaces telling users to retry a condition that retrying
   cannot change: a policy refusal (HTTP 403) classified as a transient load
   failure. The correct fix is to NAME THE MISSING FACT. The wrong fix - and the
   one this comment exists to forbid - is to reword the two sentences below.

   Owner ruling R143.1 is explicit, and this component is where it bites hardest:
   the two literals below are genuinely good copy, they must still appear for
   genuine transient failures, and a REPLACED text node scores in `npm run guard`
   as a REMOVED copy string. So `detail` renders as an ADDITIONAL SIBLING element
   AFTER both existing divs. Neither existing literal is touched, re-indented or
   re-wrapped by this wave, and `detail` is OPTIONAL, so every pre-existing call
   site renders byte-identical output to before.

   `detail` is for a STATED FACT ("no active Collective membership is on file for
   this account"), never for a restatement of the failure. If a surface does not
   know which fact is missing, it must pass nothing and let the honest transient
   copy stand alone. Nothing here is allow-listed in any guard.
   =========================================================================== */
import { Button } from "@/components/ui/button";

export function LoadFailedRefusal({
  what,
  onRetry,
  testId,
  isRetrying = false,
  detail,
}: {
  /** Plural noun for the thing that failed to load, e.g. "your contacts". */
  what: string;
  /** Re-issues the request. Pass the query's own `refetch`. */
  onRetry: () => void;
  /** Stable hook for tests and the guard inventory. */
  testId: string;
  /** Disables the retry while a refetch is already in flight. */
  isRetrying?: boolean;
  /** WAVE 183 - ITEM C. An optional STATED FACT, rendered as a NEW SIBLING
   *  below the two preserved literals. Omit it and this component behaves
   *  exactly as it did before wave 183. */
  detail?: string | null;
}) {
  return (
    <div
      className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"
      role="alert"
      data-testid={testId}
    >
      <div className="font-medium">We couldn&rsquo;t load {what}.</div>
      <div className="mt-0.5 text-xs">
        Nothing has been changed. This is a loading failure, not an empty list — what you had
        is still there.
      </div>
      {/* WAVE 183 - ITEM C. A SIBLING, not a splice. It sits between the
          preserved reassurance and the retry button so the reader gets: what
          failed, that nothing was lost, WHY, and then the action. */}
      {detail ? (
        <div className="mt-1.5 text-xs font-medium" data-testid={`${testId}-detail`}>
          {detail}
        </div>
      ) : null}
      <Button
        variant="outline"
        size="sm"
        className="mt-2 h-7 text-xs"
        data-testid={`${testId}-retry`}
        onClick={onRetry}
        disabled={isRetrying}
      >
        Try again
      </Button>
    </div>
  );
}

export default LoadFailedRefusal;
