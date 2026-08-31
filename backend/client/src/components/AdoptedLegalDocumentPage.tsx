/**
 * WAVE 210 — THE PUBLIC PAGE THAT SERVES THE ADOPTED LEGAL CORPUS.
 *
 * This is the component `/terms-of-service` and `/privacy-policy` now render.
 * Before this wave those URLs served two 116-line pages dated 15 June 2026 which
 * named no legal entity, carried no version, and described themselves in their
 * own source as "an interim stub" — while the consent record written at signup
 * attested to five complete documents dated 17 March 2026 that had no URL at
 * all. A user read one document and their consent record named another.
 *
 * TWO THINGS THIS PAGE DOES THAT THE OLD ONE COULD NOT:
 *   1. It NAMES ITS VERSION on the page, in the same string the consent row
 *      records. That is the whole point of the wave, so it is rendered, not
 *      merely available — `data-testid="legal-doc-version"`.
 *   2. It names the party: BluePrint Catalyst Limited, the registered name.
 *
 * IT MAKES NO CLAIM ABOUT LEGAL REVIEW. The owner has knowingly accepted the
 * risk of publishing before Hong Kong counsel review (R190.11). His acceptance
 * of that risk does not convert a draft into reviewed advice, so nothing here
 * says or implies these documents have been reviewed — and nothing here promises
 * a future review either, which is what the retired interim sentence did.
 */
import { MarkdownBlock } from "@/components/LegalDrawer";
import { Card, CardContent } from "@/components/ui/card";
import { ADOPTED_LEGAL_DOCS, findAdoptedLegalDoc } from "@/lib/legalDocsV2";
import { ADOPTED_LEGAL_CORPUS_VERSION, REGISTERED_PARTY_NAME } from "@shared/wave210LegalCorpusVersion";

export function AdoptedLegalDocumentPage({ docId }: { docId: string }) {
  const doc = findAdoptedLegalDoc(docId);

  /* A missing id is a routing mistake, not a user's mistake, and a legal URL
   * must not render a blank page. We say what happened and offer the list. */
  if (!doc) {
    return (
      <div className="min-h-screen bg-background" data-testid="page-legal-not-found">
        <main className="container mx-auto px-4 py-12 max-w-3xl">
          <h1 className="text-2xl font-semibold mb-2">Document not found</h1>
          <p className="text-sm text-muted-foreground mb-6">
            We could not find a legal document with that name. The documents we publish are listed below.
          </p>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            {ADOPTED_LEGAL_DOCS.map((d) => (
              <li key={d.id}>
                <a className="underline" href={`/legal/${d.id}`} data-testid={`link-legal-doc-${d.id}`}>
                  {d.title}
                </a>
              </li>
            ))}
          </ul>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background" data-testid={`page-legal-${doc.id}`}>
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <a href="/" className="text-xl font-semibold tracking-tight">Capavate</a>
          <a href="/" className="text-sm text-muted-foreground hover:text-foreground">← Home</a>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12 max-w-3xl">
        <h1 className="text-3xl font-semibold mb-2" data-testid="legal-doc-title">{doc.title}</h1>

        {/* THE VERSION IDENTITY, ON THE PAGE. This is the string a consent record
            names. If these two ever disagree the platform is back in the state
            this wave was built to end, so it is rendered where anyone can see it
            and asserted by a test that also reads the recorded row. */}
        <p className="text-sm text-muted-foreground mb-1" data-testid="legal-doc-version">
          Version {ADOPTED_LEGAL_CORPUS_VERSION} · Last updated {doc.lastUpdated}
        </p>
        <p className="text-sm text-muted-foreground mb-8" data-testid="legal-doc-entity">
          Issued by {REGISTERED_PARTY_NAME} · Incorporated in Hong Kong
        </p>

        <Card>
          <CardContent className="prose prose-sm max-w-none py-6 space-y-4">
            <MarkdownBlock body={doc.body} />
          </CardContent>
        </Card>

        {/* The other published documents. Before this wave the Cookie policy, the
            Acceptable Use policy and the Disclaimer existed in the corpus but no
            URL reached any of them. */}
        <nav className="mt-8" aria-label="Other legal documents" data-testid="nav-other-legal-docs">
          <div className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">
            Other legal documents
          </div>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            {ADOPTED_LEGAL_DOCS.filter((d) => d.id !== doc.id).map((d) => (
              <li key={d.id}>
                <a className="underline" href={`/legal/${d.id}`} data-testid={`link-other-legal-${d.id}`}>
                  {d.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </main>
    </div>
  );
}
