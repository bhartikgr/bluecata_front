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
/* WAVE 213 · ITEM C.3 — link + verbatim quote of the signed agreement clause, in
   place of "ask your Capavate contact". Same shared module the publish panel uses,
   so there is one quotation mechanism rather than two. */
import {
  PUBLISH_CLAUSE_AGREEMENT_HEADING,
  PUBLISH_CLAUSE_AGREEMENT_LINK_LABEL,
  PUBLISH_CLAUSE_AGREEMENT_PATH,
  consortiumAgreementSection,
} from "@shared/wave213PublishGoverningClause";

interface LockNoticeResponse {
  key: string;
  supplied: boolean;
  /** Verbatim owner text, or null. Never a placeholder. */
  text: string | null;
  /** Server-authored sentence: the text itself when supplied, the not-supplied notice otherwise. */
  copy: string;
  /**
   * WAVE 126 / FINDING 1 — the client-facing form of the same sentence. This is
   * what this panel renders. `copy` is still in the payload because the admin
   * lock register wants it, but a paying client's screen must not be told whose
   * wording is outstanding or what a future release will do.
   */
  clientCopy: string;
  setAt: string | null;
}

export default function Lock1NoticePanel() {
  const q = useQuery<LockNoticeResponse>({
    queryKey: ["/api/partner/me/pipeline/lock-notice"],
    queryFn: async () =>
      (await apiRequest("GET", "/api/partner/me/pipeline/lock-notice")).json(),
    retry: false,
  });

  /* WAVE 213 · ITEM C.3 — derived once. `null` means the section could not be
     located in the signed text; it is never rendered and never compared as text. */
  const agreementConfidentialitySection = consortiumAgreementSection();

  return (
    <div className="rounded border p-4 space-y-3" data-testid="lock1-notice-panel">
      <div>
        <h3 className="font-medium" data-testid="lock1-notice-title">
          {/* WAVE 126 / FINDING 1 — "LOCK 1" is our own internal register's
              numbering and means nothing to a client. The subject of the rule
              stays, and stays as "soft-circle", which is this ladder's own
              vocabulary (R91: soft-circle and soft-circled are DIFFERENT
              ladders and are not harmonised). */}
          Soft-circle provenance
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
          {/* Server-authored, printed verbatim — the CLIENT-facing sentence
              (WAVE 126 / FINDING 1). Still one server-owned string, still no
              client-side fallback, so the two cannot drift. */}
          {q.data.clientCopy}
        </div>
      )}
      {/* ══════════════════════════════════════════════════════════════════════
          WAVE 213 · ITEM C — THE ONE GENUINELY WITHHELD TERM IN THE TREE.
          ══════════════════════════════════════════════════════════════════════
          The sentence above (`server/lib/lock1Provenance.ts`, rendered on the
          not-supplied branch) ends "ask your Capavate contact and it will be
          issued to you". A sweep of 1,059 non-test source files found it to be the
          only user-facing string in the product that defers a TERM rather than
          stating it; the other thirteen matches were operational instructions,
          scope statements, or read-failure refusals.

          THE SENTENCE IS NOT DELETED, NOT EDITED AND NOT UN-RENDERED. R195.5:
          nothing is deleted — suppress, gate or refuse, but retain the mechanism.
          Spec 213.2: the withholding sentence is retained in source. And
          `wave33_pipe10_lock1` pins that this component renders
          `{q.data.clientCopy}` with no `||` and no `??` fallback, which stays
          true: what follows is an APPENDED SIBLING of the branch, not a change to
          the expression, so R143.1 cannot score a replaced text node.

          Item C.3 — the term it defers genuinely lives in the Consortium Partner
          Agreement, which is competent, signed, enforced fail-closed and must not
          be modified. So the fix is to LINK to it and QUOTE the relevant clause,
          NOT to restate it in new words that could diverge from the signed text.
          The quote is sliced out of CONSORTIUM_AGREEMENT_TEXT at runtime, so it
          cannot diverge. It renders unconditionally — not only on the not-supplied
          branch — because the confidentiality clause governs a partner-sourced
          soft circle whether or not an administrator has typed a bespoke notice.

          `null` from the slice means the section could not be located, and it is
          never rendered as an empty quote under a heading. */}
      {agreementConfidentialitySection !== null && (
        <div className="text-xs mt-2 pt-2 border-t border-[var(--cv-color-border)]" data-testid="lock1-agreement-clause-block">
          <div className="font-medium" data-testid="lock1-agreement-clause-heading">{PUBLISH_CLAUSE_AGREEMENT_HEADING}</div>
          <div className="whitespace-pre-line" data-testid="lock1-agreement-clause-quote">{agreementConfidentialitySection}</div>
          <a href={PUBLISH_CLAUSE_AGREEMENT_PATH} className="underline block mt-1" data-testid="lock1-agreement-clause-link">{PUBLISH_CLAUSE_AGREEMENT_LINK_LABEL}</a>
        </div>
      )}
    </div>
  );
}
