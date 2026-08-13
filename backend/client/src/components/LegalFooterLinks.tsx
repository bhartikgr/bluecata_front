/* client/src/components/LegalFooterLinks.tsx
 *
 * WAVE 8 — ORP-047 / DEF-047. "Link the terms-of-service page."
 *
 * VERIFIED CLAIM (the audit cited App.tsx:565; the route is actually at :571 in
 * this tree — the line drifted, the finding did not). Both `/terms` and
 * `/terms-of-service` are routed to `LegalTermsPage`, and `/privacy` and
 * `/privacy-policy` to `LegalPrivacyPage`, yet a tree-wide grep for
 * `href="/terms` and `href="/privacy` returns NOTHING. The only way a user
 * could reach the legal copy at all was the consent drawer
 * (`LegalConsentCheckbox` → `useLegalDrawer().openDrawer(docId)`), which is
 * mounted on signup/redeem flows only. An existing user who wanted to re-read
 * the Terms after signing up had no path to them.
 *
 * EXISTS-VS-MISSING: the pages and their routes EXIST. This is WIRING — a
 * persistent, reachable link, nothing more. No new page, no new route.
 *
 * SINK: rendered inside `AppShell` (the authenticated shell every founder,
 * investor and admin page renders inside) and `CollectiveShell`, so the link is
 * on the actual navigation path rather than parked in a component nobody
 * mounts — the recurring failure mode this wave was told to avoid.
 */
import { Link } from "wouter";

export function LegalFooterLinks({ className = "" }: { className?: string }) {
  return (
    <footer
      className={`px-6 py-4 border-t border-border text-[11px] text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 ${className}`}
      data-testid="legal-footer-links"
    >
      <span>© {new Date().getFullYear()} Capavate</span>
      <Link href="/terms-of-service" className="underline hover:text-foreground" data-testid="link-terms-of-service">
        Terms of Service
      </Link>
      <Link href="/privacy-policy" className="underline hover:text-foreground" data-testid="link-privacy-policy">
        Privacy Policy
      </Link>
    </footer>
  );
}
