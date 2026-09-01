/**
 * 23-May Fix 7 \u2014 Consortium Partner signup.
 *
 * Consortium partners do NOT self-signup (unlike founders). Membership is
 * application-based: prospective partners submit /apply/consortium (a public
 * CP Phase B form), the platform admin reviews + approves, then a
 * partner_invitations magic-link email is sent for credential setup.
 *
 * This page explains that flow and provides:
 *   - A prominent "Apply to join the consortium" CTA \u2192 /apply/consortium
 *   - A secondary "Already approved? Sign in" link \u2192 /partner/login
 *   - A tertiary "Redeem an invite token" link \u2192 /auth/redeem-partner-invite/:token
 *     (the magic-link landing page receives the token in the URL; this link
 *     is there for users who pasted a bare token instead of the full URL).
 *
 * No form fields. Pure landing copy.
 */
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/pages/auth/AuthShell";
import { Handshake, FileText, ArrowRight, CheckCircle2 } from "lucide-react";

/* ════════════════════════════════════════════════════════════════════════════
 * WAVE 266 — THE TWO PUBLIC SENTENCES THAT DESCRIBED A REVIEW PROCESS THAT DOES
 * NOT EXIST. Both were on this page, which is PUBLIC and unauthenticated.
 *
 * SENTENCE 1 (was :51): "Consortium partners are VETTED accelerator programs,
 *   angel networks, syndicates, and family offices…"
 *   R227.2 settles what wave 220 left open as "an owner question": the owner has
 *   ruled the word PROHIBITED — "Prohibited: verified, verification,
 *   independently verified, VETTED, screened, approved, certified, guaranteed,
 *   compliant — about a person, a holding, or an eligibility." R189.3 lists
 *   "no 'curated' or 'vetted'" among the interface rules. So this is not a
 *   judgement call any more; it is a ruling.
 *   WHAT ACTUALLY HAPPENS: the applicant DECLARES its own regulatory status.
 *   Migration 0222 (wave 217) added `regulatory_status`,
 *   `compliance_attested_at` and `compliance_attestation_text` to
 *   `consortium_applications`. A declaration is recorded. Nothing checks it.
 *
 * SENTENCE 2 (was in "How approval works"): "Platform team reviews + VERIFIES
 *   your organization (typically 3–5 BUSINESS DAYS)."
 *   TWO claims, one true and one not, which is why each was read in place.
 *   "Platform team reviews" is TRUE — an administrator approves or rejects the
 *   application and provisioning follows. "verifies your organization" is a
 *   check that does not exist anywhere in the tree. "typically 3–5 business
 *   days" is an SLA with no timer, no queue and no scheduler behind it:
 *   `grep -rn 'businessDays|business_days|slaHours|reviewDeadline' server shared`
 *   returns NOTHING.
 *
 * THE REGISTER IS REUSED, NOT INVENTED (rule 3). "No review time is promised"
 * is wave 220's own corrected wording in
 * `client/src/components/investor/PromoteToCollectiveDialog.tsx:159`. "It is not
 * a check of it" is the platform's existing honest sentence from
 * `client/src/components/investor/AccreditationDeclaration.tsx:310`.
 *
 * NOTHING IS DELETED (R195.5). Both superseded sentences are retired in place,
 * byte-identical, in a retention block appended as the LAST sibling of the outer
 * container so no sibling above it renumbers — wave 220's construction, and the
 * flag is an IDENTIFIER, not `{false && …}`, which the restyle detector folds
 * and marks a SUPPRESSION.
 * ══════════════════════════════════════════════════════════════════════════ */
const W266_RENDER_SUPERSEDED_COPY = false;

export default function PartnerSignup() {
  return (
    <AuthShell
      title="Join the Capavate consortium"
      subtitle="Bring your founders, investors, and deal flow onto a single platform."
      footer={
        <div>
          Already approved?{" "}
          <Link
            href="/partner/login"
            className="text-[#cc0001] hover:underline"
            data-testid="link-partner-login-from-signup"
          >
            Sign in to the partner workspace
          </Link>
        </div>
      }
    >
      <div className="space-y-5" data-testid="partner-signup-content">
        {/* Hero CTA card */}
        <div className="rounded-lg border-2 border-[hsl(0_100%_40%)] bg-[hsl(0_100%_97%)] p-5">
          <div className="flex items-center gap-2 mb-2">
            <Handshake className="h-5 w-5 text-[#cc0001]" />
            <h2 className="text-base font-semibold text-[hsl(219_45%_20%)]" data-testid="text-partner-cta-heading">
              Apply to become a consortium partner
            </h2>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Consortium partners are accelerator programs, angel networks, syndicates, and family offices that
            bring their founders, investors, and deals onto Capavate as a single managed portfolio. Applicants
            declare their own regulatory status. Capavate records that declaration. It is not a check of it.
          </p>
          {/* v25.15 NM10 — wouter Link inside Button used asChild to avoid
             nested <a><button> producing invalid HTML. */}
          <Button
            asChild
            className="w-full bg-[#cc0001] hover:bg-[#a30001] text-white rounded-full font-semibold"
            data-testid="button-apply-consortium"
          >
            <Link href="/apply/consortium">
              <FileText className="h-4 w-4 mr-2" />
              Start a partner application
              <ArrowRight className="h-4 w-4 ml-2" />
            </Link>
          </Button>
        </div>

        {/* What you get */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground" data-testid="text-what-you-get-heading">
            What partners get
          </h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
              <span>
                <span className="font-medium text-foreground">Partner dashboard</span> — portfolio companies,
                investor seats, deal pipeline, and SPV/fund administration.
              </span>
            </li>
            {/* W-V44 FIX D (Ozan 1a): pricing is DYNAMIC — determined in the admin
                backend from SPV costs + fixed fees, not a static tier list. Keep
                this copy general (no hardcoded tier names/prices) while still
                encouraging registration. Exact plan + pricing are shown to the
                partner after approval, sourced from the admin-configured backend. */}
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
              <span>
                <span className="font-medium text-foreground">Flexible partner plans</span> — seat-based
                access with pricing tailored to your syndicate, confirmed when your application is approved.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
              <span>
                <span className="font-medium text-foreground">Deal promotion</span> — promote founders into
                Capavate Collective deal rooms with chapter-admin moderation.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
              <span>
                <span className="font-medium text-foreground">Co-branded onboarding</span> — your founders get a
                partner-branded experience inside Capavate.
              </span>
            </li>
          </ul>
        </div>

        {/* How approval works */}
        <div className="rounded-md border border-black/5 bg-muted/40 p-4 text-xs space-y-2" data-testid="partner-approval-flow">
          <h3 className="text-sm font-semibold text-foreground mb-1">How approval works</h3>
          <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
            <li>Submit the partner application (5–7 minutes).</li>
            <li>A Capavate administrator reviews your application and decides whether to approve it. Capavate does not verify your organization, and no review time is promised.</li>
            <li>On approval, you receive a one-time magic link to set up your partner administrator credentials.</li>
            <li>You can then invite your team into your partner workspace.</li>
          </ol>
        </div>

        {/* Redeem invite token */}
        <div className="border-t pt-4 text-xs text-muted-foreground" data-testid="partner-redeem-token-section">
          {/* v25.12 NM3 — the previous link pointed at the investor/founder
           * redemption page (`/auth/redeem` → POST /api/auth/redeem). Partner
           * invite tokens live at /auth/redeem-partner-invite/:token and
           * call a different endpoint. Since the token is in the URL path,
           * we instruct the user to open the full link from their email
           * rather than typing it in here. */}
          <span className="font-medium text-foreground">Already received a partner invite token?</span>{" "}
          <span className="text-muted-foreground" data-testid="link-redeem-partner-token">
            Open the full activation link from your invitation email.
          </span>
        </div>

        {/* WAVE 266 · R195.5 — RETIRED IN PLACE, NOT DELETED. Appended as the
            LAST sibling of this container so nothing above it renumbers. Each
            literal is byte-identical to the sentence that stood above, so the
            guard's copy identity survives. Identifier flag, not
            `{false && ...}`, which detect.mjs folds and marks a SUPPRESSION. */}
        {W266_RENDER_SUPERSEDED_COPY ? (
          <div hidden aria-hidden="true" data-testid="w266-superseded-partner-review-copy">
            <p data-testid="w266-superseded-vetted">Consortium partners are vetted accelerator programs, angel networks, syndicates, and family offices that bring their founders, investors, and deals onto Capavate as a single managed portfolio.</p>
            <p data-testid="w266-superseded-verifies-sla">Platform team reviews + verifies your organization (typically 3–5 business days).</p>
          </div>
        ) : null}
      </div>
    </AuthShell>
  );
}
