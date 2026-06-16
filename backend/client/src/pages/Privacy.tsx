/* v25.26 — Privacy Policy stub page.
 *
 * Previously, capavate.com/privacy-policy returned the SPA fallback,
 * rendering the founder login screen (REG-NEW-103). Combined with
 * consortium PII collection on /apply/consortium, this was a real
 * legal exposure (GDPR/PIPEDA).
 *
 * Interim stub — real policy content should replace the body when ready.
 */
import { Card, CardContent } from "@/components/ui/card";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <a href="/" className="text-xl font-semibold tracking-tight">Capavate</a>
          <a href="/" className="text-sm text-muted-foreground hover:text-foreground">← Home</a>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12 max-w-3xl">
        <h1 className="text-3xl font-semibold mb-2">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: 15 June 2026</p>

        <Card>
          <CardContent className="prose prose-sm max-w-none py-6 space-y-4">
            <p>
              This Privacy Policy explains what personal data Capavate (capavate.com) collects, how we use it,
              who we share it with, and the choices you have. It applies to the Consortium Partners and Collective
              surfaces of the platform.
            </p>

            <h2 className="text-xl font-semibold mt-6">1. Data we collect</h2>
            <ul className="list-disc pl-6">
              <li><strong>Account data</strong> — name, email, password hash, role, organization affiliation.</li>
              <li><strong>Application data</strong> — for consortium/collective applicants: organization name,
                contact details, jurisdiction, partner type, AUM range (if disclosed), portfolio context,
                referral source.</li>
              <li><strong>Business data</strong> — for founders/investors: company information, round terms, cap-table
                entries, soft circles, deal-related uploads.</li>
              <li><strong>Usage data</strong> — IP address, browser/device info, log timestamps, pages viewed.
                Used for security, abuse prevention, and product analytics.</li>
              <li><strong>Communications</strong> — emails sent through the platform are logged for delivery
                reliability and audit.</li>
            </ul>

            <h2 className="text-xl font-semibold mt-6">2. How we use it</h2>
            <p>
              To operate the platform (auth, profile, application review, cap-table management, payments, bridge
              syncs to Collective), to improve the product, to communicate with you about your account, and to
              comply with legal obligations.
            </p>

            <h2 className="text-xl font-semibold mt-6">3. Who we share it with</h2>
            <ul className="list-disc pl-6">
              <li><strong>Other users of the platform</strong> — limited fields disclosed to founders, investors,
                or partners with whom you have a relationship (e.g., your soft-circle commit visible to the
                founder of the round you committed to).</li>
              <li><strong>Service providers</strong> — Airwallex (payments), AWS S3 (file storage), Gmail SMTP
                (transactional email), Drizzle/SQLite (database operations on Capavate-controlled
                infrastructure).</li>
              <li><strong>Legal authorities</strong> — when required by law or to protect rights and safety.</li>
            </ul>
            <p>We do NOT sell your personal data.</p>

            <h2 className="text-xl font-semibold mt-6">4. Where data is stored</h2>
            <p>
              Application data is stored on Capavate-controlled servers. Uploaded files are stored in AWS S3
              (ap-south-1). Transactional emails are delivered via Gmail SMTP.
            </p>

            <h2 className="text-xl font-semibold mt-6">5. Your rights</h2>
            <p>
              Depending on your jurisdiction (including under GDPR and PIPEDA), you may have the right to access,
              correct, export, or delete your personal data, and to object to or restrict certain processing. To
              exercise these rights, email <a className="underline" href="mailto:privacy@capavate.com">privacy@capavate.com</a>.
            </p>

            <h2 className="text-xl font-semibold mt-6">6. Retention</h2>
            <p>
              We retain personal data only as long as needed to operate the platform, fulfill legal obligations,
              resolve disputes, and enforce agreements. Application data is retained for the lifecycle of the
              application plus a reasonable period thereafter.
            </p>

            <h2 className="text-xl font-semibold mt-6">7. Security</h2>
            <p>
              Capavate uses industry-standard safeguards (HTTPS everywhere, hashed passwords, scoped access tokens,
              secure session cookies). No system is perfectly secure; you are responsible for using a strong
              password and protecting your account.
            </p>

            <h2 className="text-xl font-semibold mt-6">8. Cookies</h2>
            <p>
              We use cookies for authenticated sessions (e.g., <code>__Host-cap_uid</code>) and rotation of CSRF
              tokens. We do not use third-party tracking cookies for advertising.
            </p>

            <h2 className="text-xl font-semibold mt-6">9. Changes</h2>
            <p>
              We may update this Privacy Policy. Material changes will be communicated in-app or by email.
            </p>

            <h2 className="text-xl font-semibold mt-6">10. Contact</h2>
            <p>
              Privacy questions or data-access requests:
              <a className="underline" href="mailto:privacy@capavate.com">privacy@capavate.com</a>.
            </p>

            <p className="text-xs text-muted-foreground mt-8">
              This is an interim version of Capavate’s Privacy Policy for the private-beta period. A final
              policy with full legal review will replace this content prior to general availability.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
