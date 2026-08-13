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
import { Button } from "@/components/ui/button";

export function LoadFailedRefusal({
  what,
  onRetry,
  testId,
  isRetrying = false,
}: {
  /** Plural noun for the thing that failed to load, e.g. "your contacts". */
  what: string;
  /** Re-issues the request. Pass the query's own `refetch`. */
  onRetry: () => void;
  /** Stable hook for tests and the guard inventory. */
  testId: string;
  /** Disables the retry while a refetch is already in flight. */
  isRetrying?: boolean;
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
