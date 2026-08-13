/**
 * WAVE 33 · CP-PIPE-10 — the LOCK 1 notice on the pipeline surface.
 *
 * THE HARD CONSTRAINT OF THIS FILE: it contains NO LOCK WORDING.
 *
 * LOCK 1 has two parts. Part A (the co-write discipline on soft-circle
 * provenance) is enforced server-side at the write sink. Part B — the verbatim
 * LOCK 1 wording — is OQ-5: it lives in the owner's LOCK register and was never
 * captured into anything this build can read. `platform_lock_text.text` ships
 * NULL by design.
 *
 * So this panel renders one of exactly two things, and both come from the
 * server:
 *
 *   supplied === true   → the owner's text, printed byte for byte.
 *   supplied === false  → the server's explicit NOT-SUPPLIED notice.
 *
 * There is no third branch, no default string, no placeholder, no "coming
 * soon", and no paraphrase. A fabricated legal lock wording in front of an
 * investment bank is far worse than a visible gap, and a gap rendered as
 * silence is worse than either, because an unsatisfied lock then looks
 * satisfied — the failure mode this whole build keeps finding.
 *
 * Note what is deliberately NOT here: a `text ?? "..."` fallback. The unsupplied
 * sentence is authored once, on the server, in `lock1Provenance.ts`. If it were
 * also written here the two could drift, and the client copy would be a second
 * source of truth for the wording of a legal notice.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface LockNoticeResponse {
  key: string;
  supplied: boolean;
  /** Verbatim owner text, or null. Never a placeholder. */
  text: string | null;
  /** Server-authored sentence: the text itself when supplied, the not-supplied notice otherwise. */
  copy: string;
  setAt: string | null;
}

export default function Lock1NoticePanel() {
  const q = useQuery<LockNoticeResponse>({
    queryKey: ["/api/partner/me/pipeline/lock-notice"],
    queryFn: async () =>
      (await apiRequest("GET", "/api/partner/me/pipeline/lock-notice")).json(),
    retry: false,
  });

  return (
    <div className="rounded border p-4 space-y-3" data-testid="lock1-notice-panel">
      <div>
        <h3 className="font-medium" data-testid="lock1-notice-title">
          LOCK 1 — soft-circle provenance
        </h3>
        <p className="text-xs text-[var(--cv-color-text-muted)]" data-testid="lock1-notice-intro">
          A partner-sourced soft circle records the sourcing partner and the attribution behind it
          together, as one write. Neither can be recorded without the other.
        </p>
      </div>

      {q.isLoading ? (
        <div className="text-sm" data-testid="lock1-notice-loading">
          Reading the lock notice…
        </div>
      ) : q.error || !q.data ? (
        /* A read failure is NOT "not supplied". Saying the wording is
           outstanding when we simply could not read it would be a claim about
           the owner's register that this surface is in no position to make. */
        <div className="text-sm" data-testid="lock1-notice-unavailable">
          The lock notice could not be read. Nothing is shown in its place rather than a statement
          about this lock that may be wrong.
        </div>
      ) : q.data.supplied ? (
        <div className="space-y-1">
          <div
            className="text-sm whitespace-pre-wrap"
            data-testid="lock1-notice-text"
          >
            {/* The owner's text, verbatim. Nothing is prepended, appended or
                reformatted around it; `whitespace-pre-wrap` preserves the
                line breaks the owner wrote. */}
            {q.data.text}
          </div>
          <div className="text-xs text-[var(--cv-color-text-faint)]" data-testid="lock1-notice-supplied-at">
            {q.data.setAt
              ? `Wording supplied ${q.data.setAt}.`
              : "Wording supplied; the date it was recorded is not available."}
          </div>
        </div>
      ) : (
        <div
          className="text-sm border-l-2 border-[var(--cv-color-border)] pl-3"
          data-testid="lock1-notice-not-supplied"
        >
          {/* Server-authored, printed verbatim. This is the visible gap, and it
              is deliberate. */}
          {q.data.copy}
        </div>
      )}
    </div>
  );
}
