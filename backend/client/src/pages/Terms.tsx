/* v25.26 — Terms of Service stub page.
 *
 * Previously, capavate.com/terms returned the SPA fallback, which rendered
 * the founder login screen (REG-NEW-103). That meant applicants checking
 * the "I agree to Terms" link landed on a login page — broken UX AND a
 * potential legal exposure since the consortium apply form collects PII
 * with no published terms.
 *
 * This is an interim stub. The real ToS content should replace the body
 * here when ready. Keep the route registered in App.tsx.
 */
import { Card, CardContent } from "@/components/ui/card";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <a href="/" className="text-xl font-semibold tracking-tight">Capavate</a>
          <a href="/" className="text-sm text-muted-foreground hover:text-foreground">← Home</a>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12 max-w-3xl">
        <h1 className="text-3xl font-semibold mb-2">Terms of Service</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: 15 June 2026</p>

        <Card>
          <CardContent className="prose prose-sm max-w-none py-6 space-y-4">
            <p>
              <strong>Welcome to Capavate.</strong> These Terms govern your access to and use of the Capavate platform
              (capavate.com), including the Consortium Partners and Collective surfaces. By creating an account,
              submitting an application, or otherwise using the platform, you agree to these Terms.
            </p>

            <h2 className="text-xl font-semibold mt-6">1. The Service</h2>
            <p>
              Capavate is a software platform that helps founders, investors, and consortium partners coordinate
              private-market activity (rounds, cap tables, soft circles, partner workspaces, and Collective chapters).
              Capavate is not a broker-dealer and does not provide investment, legal, tax, or accounting advice.
            </p>

            <h2 className="text-xl font-semibold mt-6">2. Accounts</h2>
            <p>
              You are responsible for the accuracy of the information you submit, for safeguarding your credentials,
              and for activity on your account. You must be authorized to act on behalf of any organization you
              register.
            </p>

            <h2 className="text-xl font-semibold mt-6">3. Data you submit</h2>
            <p>
              Information you submit (organization details, contact information, financial figures, uploaded
              documents) is processed in accordance with our <a className="underline" href="/privacy-policy">Privacy Policy</a>.
              You retain ownership of your data; you grant Capavate a limited license to host and display it as
              necessary to operate the platform.
            </p>

            <h2 className="text-xl font-semibold mt-6">4. Consortium and Collective applications</h2>
            <p>
              Submitting an application does not guarantee acceptance. Capavate may review, approve, decline, or
              defer applications at its discretion. Approved partners and members are bound by additional
              chapter-specific or workspace-specific terms communicated at activation.
            </p>

            <h2 className="text-xl font-semibold mt-6">5. Acceptable use</h2>
            <p>
              You agree not to misuse the platform, including: attempting to access accounts you do not own,
              uploading malicious code, scraping at volume, or using the platform for any unlawful purpose.
            </p>

            <h2 className="text-xl font-semibold mt-6">6. Payments</h2>
            <p>
              Where applicable (subscription tiers, SPV fees), payments are processed by our payment provider
              (Airwallex). Fees and billing cycles are disclosed on the relevant checkout page. Refunds are subject
              to the policy displayed at point of sale.
            </p>

            <h2 className="text-xl font-semibold mt-6">7. Disclaimers</h2>
            <p>
              The platform is provided “as is.” Capavate disclaims all warranties to the maximum extent permitted by
              law. We do not guarantee deal outcomes, fundraising results, or any specific commercial result.
            </p>

            <h2 className="text-xl font-semibold mt-6">8. Limitation of liability</h2>
            <p>
              To the maximum extent permitted by law, Capavate’s aggregate liability arising out of or relating to
              the platform is limited to the fees paid by you to Capavate in the twelve months preceding the claim.
            </p>

            <h2 className="text-xl font-semibold mt-6">9. Termination</h2>
            <p>
              You may stop using the platform at any time. Capavate may suspend or terminate accounts for breach of
              these Terms or for legal/operational reasons, with notice where practicable.
            </p>

            <h2 className="text-xl font-semibold mt-6">10. Changes</h2>
            <p>
              We may update these Terms. Material changes will be communicated in-app or by email. Continued use
              after the effective date constitutes acceptance.
            </p>

            <h2 className="text-xl font-semibold mt-6">11. Contact</h2>
            <p>
              Questions about these Terms: <a className="underline" href="mailto:legal@capavate.com">legal@capavate.com</a>.
            </p>

            <p className="text-xs text-muted-foreground mt-8">
              This is an interim version of Capavate’s Terms of Service for the private-beta period. A final ToS
              with full legal review will replace this content prior to general availability.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
