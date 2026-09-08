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
import { Link, useLocation } from "wouter";
/* WAVE 341 · W335 — see client/src/lib/legalShellScope.ts for the measurement.
   Inside CollectiveShell these links pointed at the BARE public legal routes,
   which AppRouter wraps in AppShell — so a Consortium Partner following them
   landed in the FOUNDER workspace sidebar. The links now carry the shell scope
   the visitor is already in. Outside the two Collective scopes the scope is the
   empty string and the href is byte-for-byte what it was. */
import { legalScopeForLocation, legalHref, LEGAL_PUBLIC_PATHS } from "@/lib/legalShellScope";
/* WAVE 210 — this component is already mounted inside AppShell and
 * CollectiveShell, i.e. on every authenticated page in every silo. That makes it
 * the honest "next login" surface for the legal-consolidation notice, and it
 * means the notice needed no edit to either shell — both of which other waves are
 * concurrently working in. Nothing existing below is changed: the notice and the
 * party-name line are APPENDED as the last children of the same <footer>. */
import { LegalUpdateNotice } from "@/components/LegalUpdateNotice";
import { REGISTERED_PARTY_NAME } from "@shared/wave210LegalCorpusVersion";

export function LegalFooterLinks({ className = "" }: { className?: string }) {
  const [location] = useLocation();
  const scope = legalScopeForLocation(location);
  return (
    <footer
      className={`px-6 py-4 border-t border-border text-[11px] text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 ${className}`}
      data-testid="legal-footer-links"
    >
      <span>© {new Date().getFullYear()} Capavate</span>
      <Link href={legalHref(scope, LEGAL_PUBLIC_PATHS.terms)} className="underline hover:text-foreground" data-testid="link-terms-of-service">
        Terms of Service
      </Link>
      <Link href={legalHref(scope, LEGAL_PUBLIC_PATHS.privacy)} className="underline hover:text-foreground" data-testid="link-privacy-policy">
        Privacy Policy
      </Link>
      {/* WAVE 210 — the operating entity, named where the copyright line is. The
          footer previously named no legal person at all. */}
      <span data-testid="legal-footer-entity">Operated by {REGISTERED_PARTY_NAME}, incorporated in Hong Kong</span>
      {/* WAVE 210 — non-blocking consolidation notice. Renders nothing unless the
          signed-in user's consent trail predates the published version. */}
      <div className="w-full" data-testid="legal-footer-update-slot">
        <LegalUpdateNotice />
      </div>
    </footer>
  );
}
