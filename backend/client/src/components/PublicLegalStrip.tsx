/**
 * WAVE 210 — INTERCEPTION FOR THE FROZEN MARKETING FOOTER. READ THIS BEFORE
 * ASSUMING THE PUBLIC FOOTER WAS FIXED IN PLACE. IT WAS NOT, AND IT COULD NOT BE.
 *
 * `client/src/components/home3compo/Footer3.jsx` is the public marketing footer,
 * mounted at `client/src/pages/home/Home.tsx`. It carries two real defects:
 *
 *   1. Its "Terms" link points at `https://capavate.com/privacy-policy`, so a
 *      visitor clicking Terms on the public home page is served the Privacy
 *      Policy. There has never been a working public Terms link on that page.
 *   2. Its copyright line reads "Blueprint Catalyst Ltd." — the misspelled party
 *      name, which owner ruling A8 corrects to "BluePrint Catalyst Limited".
 *
 * `Footer3.jsx` IS A BASE ENTRY IN THE ENFORCED 48-ENTRY SACRED LIST. Editing it
 * fails `npm run sacred`, and a tenth waiver is not available to be sought. So
 * the correction is made from the non-sacred layer that mounts it — handbook
 * §2.4 — by appending this strip beneath the frozen footer.
 *
 * WHAT THIS DOES NOT DO, STATED PLAINLY BECAUSE IT MATTERS. It does not remove
 * the frozen footer's mislabelled "Terms" anchor and it does not correct the
 * frozen copyright line. Both are still on the page. This strip adds the first
 * correct public path to the Terms of Service and names the party correctly
 * beneath them. The remaining defect needs an owner-ratified change to a frozen
 * file and is reported as unfixed rather than quietly counted as done.
 */
import { ADOPTED_LEGAL_DOCS } from "@/lib/legalDocsV2";
import {
  ADOPTED_LEGAL_CORPUS_VERSION,
  REGISTERED_PARTY_NAME,
} from "@shared/wave210LegalCorpusVersion";

export function PublicLegalStrip() {
  return (
    <div
      className="px-6 py-4 border-t border-border text-[11px] text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1"
      data-testid="public-legal-strip"
    >
      <span data-testid="public-legal-entity">
        Capavate is operated by {REGISTERED_PARTY_NAME}, incorporated in Hong Kong.
      </span>
      <span data-testid="public-legal-version">
        Published legal documents, version {ADOPTED_LEGAL_CORPUS_VERSION}:
      </span>
      {ADOPTED_LEGAL_DOCS.map((doc) => (
        <a
          key={doc.id}
          className="underline hover:text-foreground"
          href={doc.id === "terms" ? "/terms-of-service" : doc.id === "privacy" ? "/privacy-policy" : `/legal/${doc.id}`}
          data-testid={`public-legal-link-${doc.id}`}
        >
          {doc.title}
        </a>
      ))}
    </div>
  );
}
