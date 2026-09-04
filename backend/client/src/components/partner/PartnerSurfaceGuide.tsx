/**
 * WAVE C · ITEMS 10a + 8b — "WHAT IS THE DIFFERENCE BETWEEN THESE SECTIONS?"
 *
 * ── THE OWNER'S QUESTION, AND WHY THE ANSWER IS NOT A MERGE ─────────────────
 * The owner asked, on the Portfolio page: *"What is the difference between this
 * section and 'Clients' and 'Add Portfolio Company'?"* and, on a client page:
 * *"How is this connected with the SPVs section? … make sure there are no
 * overlaps."*
 *
 * That was investigated in the database rather than in the code comments, and the
 * answer is that THERE IS NO OVERLAP TO REMOVE. Each surface reads a different
 * table:
 *
 *   Clients                → `partner_attributions`        (+ `consortium_links`)
 *   Pipeline               → `partner_deal_pipeline`
 *   Portfolio              → `partner_portfolio_company`
 *   SPVs                   → `spv`
 *
 * Four tables, no column shared as a store. What the owner saw is that ONE action
 * — Add Portfolio Company — writes into all of them in a single rollback-protected
 * sequence (`server/partnerPortfolioCompanyRoutes.ts`), so after one create the
 * same company name appears in three lists. That is one act with three
 * consequences, not three copies of one record.
 *
 * So the defect is not duplication. **The defect is that nothing on any of these
 * screens said so.** This component is that missing sentence, and nothing more. No
 * surface is merged, moved, renamed or deleted (R195.5, and the owner's standing
 * *"I'd rather add than delete"*).
 *
 * ── WHY IT IS ONE COMPONENT AND NOT FOUR BLOCKS OF PROSE ────────────────────
 * The owner has to learn ONE mental model, so the four screens must describe
 * themselves in the same shape and the same voice. A shared frame guarantees that;
 * four hand-written paragraphs drift apart at the first edit.
 *
 * The WORDS, however, stay at each call site as literal JSX. That is deliberate:
 * the silent-drop guard fingerprints copy per file, so keeping each screen's
 * sentence in that screen's own file means the guard can attribute it, and a future
 * wave that changes one screen's wording cannot silently change the other three.
 *
 * ── THE RULE FOR THE LINKS, WHICH IS THE PART THAT COULD HAVE LIED ──────────
 * A link offered here must correspond to a relationship that ACTUALLY EXISTS in
 * the data. Section-to-section links qualify: the create handler named above
 * genuinely writes the attribution, the pipeline deal and the portfolio profile,
 * so "this is where these companies came from" is a true statement about every
 * row, not a guess about one.
 *
 * What this component must NEVER be used for is a link that depends on a
 * particular row's key being present — a client's SPVs, or a pipeline deal's
 * company. Those keys are nullable (`spv.target_company_id`,
 * `partner_deal_pipeline.company_id`), so such a link has to be rendered per row,
 * only when that row's key is actually set, and only from a read that filters on
 * it. `GET /api/partner/me/clients/:id/spvs` is that read and
 * `PartnerClientDetail` is where it belongs. It is intentionally not here.
 *
 * ── ACCESSIBILITY AND COLOUR ────────────────────────────────────────────────
 * This block carries NO colour encoding: no hue here means anything, so there is
 * no meaning a colour-blind reader can miss.
 *
 * Partner pages render inside `CollectiveShell`, which sets `data-product="partner"`
 * on its root, so `styles/ledger-partner.css` token values are the ones in force
 * here — NOT the warmer fallbacks in `capavate-tokens.css`. That was checked, not
 * assumed, because the fallback `--cv-color-text-muted` (#7a7874) FAILS AA on this
 * surface at 4.41:1 while the partner-scoped value (#5F6B7E) passes. The measured
 * ratios on `--cv-color-surface-2` (#F1F4F8) are asserted in
 * `wc10a_surface_guide_contrast.test.ts`.
 *
 * The body sentence uses `--cv-color-text` rather than the muted token, so the
 * part the owner actually has to READ carries the highest available contrast; the
 * muted token is used only for the trailing explanatory clause.
 *
 * The section links are underlined and semibold as well as coloured, so colour is
 * never the only thing marking them as links.
 */
import type { ReactNode } from "react";
import { Link } from "wouter";

export interface PartnerSurfaceRelation {
  /** The visible link text. The section's own name, as the sidebar spells it. */
  label: string;
  /** An in-app partner route. */
  href: string;
  /** One clause saying what the relationship IS. Never a count, never a promise. */
  why: string;
  /** Stable test hook. */
  testId: string;
}

/**
 * `title` and `children` are the screen's own words. `relations` are the other
 * sections it is genuinely connected to.
 *
 * Rendered as a plain `<section>` so it is a landmark for a screen reader and is
 * announced by its heading rather than being an anonymous div.
 */
export function PartnerSurfaceGuide({
  title,
  children,
  relations,
  testId,
}: {
  title: string;
  children: ReactNode;
  relations: readonly PartnerSurfaceRelation[];
  testId: string;
}) {
  return (
    <section
      data-testid={testId}
      aria-label={title}
      className="mt-8 rounded-lg border border-[var(--cv-color-border)] bg-[var(--cv-color-surface-2)] px-5 py-4"
    >
      <h2 className="text-sm font-semibold text-[var(--cv-color-text)]">{title}</h2>
      <div className="mt-2 text-sm text-[var(--cv-color-text)]" data-testid={`${testId}-body`}>
        {children}
      </div>
      {relations.length > 0 && (
        <ul className="mt-3 space-y-1.5" data-testid={`${testId}-relations`}>
          {relations.map((r) => (
            <li key={r.href} className="text-sm text-[var(--cv-color-text-muted)]">
              <Link
                href={r.href}
                className="font-medium text-[var(--cv-color-primary)] underline underline-offset-2"
                data-testid={r.testId}
              >
                {r.label}
              </Link>
              <span> — {r.why}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
