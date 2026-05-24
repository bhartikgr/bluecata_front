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
import { Handshake, FileText, KeyRound, ArrowRight, CheckCircle2 } from "lucide-react";

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
            className="text-[hsl(184_98%_22%)] hover:underline"
            data-testid="link-partner-login-from-signup"
          >
            Sign in to the partner workspace
          </Link>
        </div>
      }
    >
      <div className="space-y-5" data-testid="partner-signup-content">
        {/* Hero CTA card */}
        <div className="rounded-lg border-2 border-[hsl(184_98%_22%)] bg-[hsl(184_98%_97%)] p-5">
          <div className="flex items-center gap-2 mb-2">
            <Handshake className="h-5 w-5 text-[hsl(184_98%_22%)]" />
            <h2 className="text-base font-semibold text-[hsl(219_45%_20%)]" data-testid="text-partner-cta-heading">
              Apply to become a consortium partner
            </h2>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Consortium partners are vetted accelerator programs, angel networks, syndicates, and family offices that
            bring their founders, investors, and deals onto Capavate as a single managed portfolio.
          </p>
          <Link href="/apply/consortium">
            <Button
              className="w-full bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_17%)] text-white"
              data-testid="button-apply-consortium"
            >
              <FileText className="h-4 w-4 mr-2" />
              Start a partner application
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </Link>
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
                <span className="font-medium text-foreground">Partner dashboard</span> \u2014 portfolio companies,
                investor seats, deal pipeline, and SPV/fund administration.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
              <span>
                <span className="font-medium text-foreground">Tiered seat plans</span> \u2014 from Catalyst (5 seats)
                to Builder, Anchor, and Architect tiers.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
              <span>
                <span className="font-medium text-foreground">Deal promotion</span> \u2014 promote founders into
                Capavate Collective deal rooms with chapter-admin moderation.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
              <span>
                <span className="font-medium text-foreground">Co-branded onboarding</span> \u2014 your founders get a
                partner-branded experience inside Capavate.
              </span>
            </li>
          </ul>
        </div>

        {/* How approval works */}
        <div className="rounded-md border border-black/5 bg-muted/40 p-4 text-xs space-y-2" data-testid="partner-approval-flow">
          <h3 className="text-sm font-semibold text-foreground mb-1">How approval works</h3>
          <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
            <li>Submit the partner application (5\u20137 minutes).</li>
            <li>Platform team reviews + verifies your organization (typically 3\u20135 business days).</li>
            <li>On approval, you receive a one-time magic link to set up your partner administrator credentials.</li>
            <li>You can then invite your team into your partner workspace.</li>
          </ol>
        </div>

        {/* Redeem invite token */}
        <div className="border-t pt-4 text-xs text-muted-foreground" data-testid="partner-redeem-token-section">
          <span className="font-medium text-foreground">Already received a partner invite token?</span>{" "}
          <Link
            href="/auth/redeem"
            className="text-[hsl(184_98%_22%)] hover:underline inline-flex items-center gap-1"
            data-testid="link-redeem-partner-token"
          >
            <KeyRound className="h-3 w-3" />
            Redeem your token
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}
