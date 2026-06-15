/**
 * v23.4.11 Phase 1 (B-201) — Round-wizard "Upgrade to Pro" interstitial.
 *
 * Bug B-201: a Free-plan founder navigating to /founder/rounds/new was SILENTLY
 * redirected to /founder/subscribe with no explanation, and the header active
 * company snapped back to the auto-created Workspace. That is a UX trap — real
 * founders read it as "the app is broken".
 *
 * This component replaces the silent redirect with an explicit, explained gate:
 * it tells the founder WHY rounds are gated, WHICH company is on which plan,
 * and offers two clear CTAs (Upgrade / Back to dashboard). It never redirects
 * on its own — the user stays on /founder/rounds/new until they choose.
 *
 * The plan value this receives is the human label produced by the server
 * billing layer ("Founder Free" / "Founder Pro" / "Founder Scale"). The paid
 * check is done by the caller (RoundNew) — this component only renders the
 * gate UI. Marker for v23.4.11 acceptance grep: `button-upgrade-active-company`.
 */
import { useLocation } from "wouter";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lock, ArrowRight, ArrowLeft } from "lucide-react";

export interface UpgradeToProInterstitialProps {
  /** Human plan label from the active company's billing, e.g. "Founder Free". */
  currentPlan: string;
  /** Display name of the active company (so the founder knows WHICH one). */
  companyName: string;
}

export default function UpgradeToProInterstitial({
  currentPlan,
  companyName,
}: UpgradeToProInterstitialProps) {
  const [, navigate] = useLocation();
  const safeCompanyName = (companyName ?? "").trim() || "your company";
  const safePlanLabel = (currentPlan ?? "").trim() || "Free";

  return (
    <>
      <PageHeader
        title="New round"
        description="Funding rounds are a Pro-plan feature."
        breadcrumbs={[
          { href: "/founder/dashboard", label: "Workspace" },
          { href: "/founder/rounds", label: "Rounds" },
          { label: "New" },
        ]}
      />
      <PageBody>
        <div
          className="max-w-xl mx-auto mt-12"
          data-testid="round-upgrade-interstitial"
        >
          <Card className="border-[hsl(184_98%_22%)]/30">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-[hsl(184_98%_22%)]/10 flex items-center justify-center shrink-0">
                  <Lock className="h-5 w-5 text-[hsl(184_98%_22%)]" />
                </div>
                <CardTitle className="text-xl">Rounds require the Pro plan</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <p className="text-muted-foreground">
                Your &lsquo;<strong>{safeCompanyName}</strong>&rsquo; is on the{" "}
                <strong>{safePlanLabel}</strong> plan. Upgrade to Pro to create
                rounds, manage cap tables with full features, and use term-sheet
                automation.
              </p>

              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white"
                  onClick={() => navigate("/founder/subscribe")}
                  data-testid="button-upgrade-active-company"
                >
                  Upgrade {safeCompanyName} to Pro
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  onClick={() => navigate("/founder/dashboard")}
                  data-testid="button-back-to-dashboard"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to dashboard
                </Button>
              </div>

              <p className="text-sm text-muted-foreground border-t pt-4">
                If your company is already on Pro, try switching companies in the
                top-bar menu — your auto-created Workspace may still be on Free.
              </p>
            </CardContent>
          </Card>
        </div>
      </PageBody>
    </>
  );
}

/**
 * Shared plan-tier helper. Accepts either the server "code" form
 * (founder_pro / founder_free) or the human label ("Founder Pro"). Returns
 * true when the plan grants paid round-management features.
 */
export function isPaidFounderPlan(plan: string | null | undefined): boolean {
  const p = (plan ?? "").toLowerCase().trim();
  if (!p) return false;
  // Free tiers (code + label) are the only non-paid states.
  if (p === "founder_free" || p === "free" || p === "founder free") return false;
  // Anything explicitly Pro / Scale / Enterprise (code or label) is paid.
  return (
    p.includes("pro") ||
    p.includes("scale") ||
    p.includes("enterprise")
  );
}
