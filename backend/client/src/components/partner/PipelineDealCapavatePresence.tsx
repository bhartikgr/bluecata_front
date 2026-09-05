/**
 * NUMBERS BAND · WAVE D · W326 — ONE SYMPTOM, THREE CAUSES. THIS COMPONENT
 * ANSWERS, FOR EVERY PIPELINE CARD, THE ONE QUESTION THE BOARD NEVER ANSWERED:
 * IS THERE A CAPAVATE COMPANY BEHIND THIS DEAL, AND IF SO, WHY IS IT NOT IN
 * PORTFOLIO OR CLIENTS?
 *
 * THE SYMPTOM AS THE OWNER READ IT. Ten pipeline deals; several have no
 * counterpart in Portfolio or Clients, and the board gives a partner no way to
 * tell a deliberate pipeline-only deal from an orphaned card. Re-measured on
 * live: FIVE of the ten have no counterpart, not four (see NB_D_BUILD.md §1).
 * They are not one problem. They are three:
 *
 *  1. THREE ROWS HAVE NO `companyId` AT ALL. Two of them already say so, via
 *     the pre-existing "Add to Capavate first" link. ONE DOES NOT, because the
 *     visibility predicate tests for a live collective promotion FIRST, and a
 *     deal that has been published to the Collective takes the "Make Private"
 *     branch and never reaches the prompt. That deal is published to the
 *     Collective while having NO Capavate company — which contradicts the
 *     invariant written in that very block: "the company must be ON CAPAVATE
 *     (cap table + rounds operating) before it can be published." The predicate
 *     is the defect; this component supplies the branch it was missing.
 *
 *  2. TWO ROWS HAVE A `companyId` AND NO COUNTERPART. Those are legitimate
 *     pipeline-only deals and they are LEFT ALONE. What was missing was not a
 *     fix but a STATEMENT: the company genuinely exists on Capavate, it is
 *     simply not in Portfolio or Clients. Said out loud, a partner can tell it
 *     apart from an orphan at a glance.
 *
 *  3. ONE ROW WAS W327 AND WAS HANDLED IN WAVE B. Re-measured: it now HAS a
 *     counterpart in both Portfolio and Clients. NOT TOUCHED.
 *
 * WHY A COMPONENT AND NOT A ONE-LINE TERNARY. The distinction in cause 2 needs
 * the Portfolio and Clients company sets, which the pipeline board does not
 * fetch. Both queries are PAGE-LEVEL and react-query dedupes them by key, so
 * the whole board costs TWO extra requests in total, not two per card. Nothing
 * is fetched per row (contrast wave C, where a per-row fetch was refused).
 *
 * NOTHING IS INVENTED. Every sentence below is a restatement of a stored fact:
 * whether `companyId` is null, whether that id appears in the Portfolio list,
 * whether it appears in the Clients list. WHERE A FACT CANNOT BE READ THE
 * COMPONENT SAYS SO AND STOPS — it never downgrades an unread counterpart into
 * "no counterpart", because that would turn a failed lookup into an accusation
 * against a legitimate deal (R224.1, and rule 12: a truthful zero is not the
 * same thing as an uncomputable one).
 *
 * NO CURRENCY VALUE IS READ, CONVERTED, SUMMED OR SILENTLY DEFAULTED HERE, and
 * no ISO code is substituted for a missing one (rule 13).
 */
import { useQuery } from "@tanstack/react-query";

/* THE PROMPT THE DEFECTIVE PREDICATE SWALLOWED. Deliberately NOT the string
   "Add to Capavate first": that literal belongs to the pre-existing <a> in
   PartnerPipeline.tsx, is watched by w128_finding3_finding4, and is left exactly
   where it is. This is a second, differently-worded statement of the same
   requirement, appended as a sibling. */
export const PIPELINE_NO_CAPAVATE_COMPANY =
  "No Capavate company is on record for this deal, so it has no cap table or rounds here and it cannot have a Portfolio or Clients counterpart. This is an incomplete card, not a deliberate pipeline-only deal.";

/* Rendered ONLY when a deal with no Capavate company is nevertheless published
   to the Collective — the exact case the predicate pre-empted. This names the
   contradiction rather than quietly correcting it. */
export const PIPELINE_PUBLISHED_WITHOUT_COMPANY =
  "This deal is published to the Collective even though no Capavate company is on record for it. That is the reverse of the order this screen requires, so add the company on Capavate before relying on the published deal room.";

export const PIPELINE_ONLY_BY_DESIGN =
  "This deal is linked to a company that exists on Capavate. It is deliberately pipeline-only: the company is not in your Portfolio and not among your Clients, so no counterpart there is missing.";

export const PIPELINE_COUNTERPART_PRESENT =
  "This deal is linked to a company that exists on Capavate and that also appears in your Portfolio or Clients.";

export const PIPELINE_PRESENCE_UNREADABLE =
  "This deal is linked to a company on Capavate, but your Portfolio and Clients lists could not be read just now, so this card is not saying whether a counterpart exists. Treat it as unanswered, not as a missing counterpart.";

export const PIPELINE_ADD_COMPANY_LINK_TEXT = "Add this company on Capavate";

type CompanyRow = { companyId?: string | null };

export default function PipelineDealCapavatePresence({
  companyId,
  isPublishedToCollective,
  testid,
}: {
  companyId: string | null | undefined;
  isPublishedToCollective: boolean;
  testid: string;
}) {
  /* Page-level, deduped by key across every card on the board. */
  const portfolioQ = useQuery<{ portfolio?: CompanyRow[] }>({
    queryKey: ["/api/partner/me/portfolio"],
  });
  const clientsQ = useQuery<{ clients?: CompanyRow[] }>({
    queryKey: ["/api/partner/me/clients"],
  });

  if (!companyId) {
    /* CAUSE 1. Unconditional for every company-less deal, whatever the promo
       state — that is the whole predicate correction. */
    return (
      <div className="mt-2 text-[10px] leading-tight text-[var(--cv-color-text-muted)]" data-testid={`${testid}-no-company`}>
        <div data-testid={`${testid}-no-company-note`}>{PIPELINE_NO_CAPAVATE_COMPANY}</div>
        {isPublishedToCollective ? (
          <div data-testid={`${testid}-published-without-company`}>{PIPELINE_PUBLISHED_WITHOUT_COMPANY}</div>
        ) : null}
        <a
          href="/collective/partner/add-portfolio-company"
          className="underline text-[color:var(--cv-color-primary)]"
          data-testid={`${testid}-add-company-link`}
        >{PIPELINE_ADD_COMPANY_LINK_TEXT}</a>
      </div>
    );
  }

  /* CAUSES 2 and 3. A verdict is stated ONLY when both lists were actually
     read. `isSuccess` plus a real array is required: a resolved query with an
     unrecognised body must not be read as an empty list, or every legitimate
     deal would be relabelled an orphan by a payload change. */
  const portfolioRows = portfolioQ.isSuccess && Array.isArray(portfolioQ.data?.portfolio) ? portfolioQ.data!.portfolio! : null;
  const clientRows = clientsQ.isSuccess && Array.isArray(clientsQ.data?.clients) ? clientsQ.data!.clients! : null;

  let verdict = PIPELINE_PRESENCE_UNREADABLE;
  if (portfolioRows && clientRows) {
    const inPortfolio = portfolioRows.some((r) => r?.companyId === companyId);
    const inClients = clientRows.some((r) => r?.companyId === companyId);
    verdict = inPortfolio || inClients ? PIPELINE_COUNTERPART_PRESENT : PIPELINE_ONLY_BY_DESIGN;
  }

  return (
    <div className="mt-2 text-[10px] leading-tight text-[var(--cv-color-text-muted)]" data-testid={`${testid}-with-company`}>
      <div data-testid={`${testid}-presence-verdict`}>{verdict}</div>
    </div>
  );
}
