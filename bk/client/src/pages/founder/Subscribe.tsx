/**
 * Sprint 28 Wave 8 — Founder subscription gate page (polished).
 *
 * - Loads pending subscription from GET /api/founder/subscription
 * - Plan selector: founder_free / founder_pro (default) / founder_scale / founder_enterprise
 *   with monthly-equivalent muted text under annual price
 * - v24.2 Airwallex wiring: paid plans no longer collect a card in-app. The
 *   "Continue to Airwallex" button mints a real PaymentIntent via
 *   POST /api/billing/plan and redirects to the Airwallex hosted page.
 *   Card data never touches Capavate (PCI-DSS).
 * - Free path unchanged: POST /api/founder/subscription/activate-free, then
 *   invalidate plan surfaces and navigate to /founder/dashboard.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2, Lock, CreditCard, ShieldCheck, Sparkles,
  Building2, Zap, Star, Crown, ExternalLink, LogOut,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useEntitlement } from "@/lib/entitlement";
import { useRef } from "react";
import { LegalConsentCheckbox, type LegalConsentCheckboxRef } from "@/components/LegalConsentCheckbox";

/* ---------- Types ---------- */
interface Subscription {
  companyId: string;
  status: string;
  plan: string;
  annualAmountMinor: number;
  currency: string;
  renewsOn: string;
  cardLast4: string | null;
  trialEndsOn?: string;
}

/* ---------- Plan catalogue ---------- */
const PLANS = [
  {
    key: "founder_free",
    label: "Founder Free",
    annualMinor: 0,
    currency: "USD",
    icon: Building2,
    color: "text-slate-600",
    features: ["Cap table (read-only)", "1 dataroom", "5 investors in CRM", "Community access"],
  },
  {
    key: "founder_pro",
    label: "Founder Pro",
    annualMinor: 298_800,
    currency: "USD",
    icon: Zap,
    color: "text-sky-600",
    features: ["Full cap table", "Unlimited datarooms", "Unlimited CRM", "Investor reports", "Collective access", "Priority support"],
    recommended: true,
  },
  {
    key: "founder_scale",
    label: "Founder Scale",
    annualMinor: 900_000,
    currency: "USD",
    icon: Star,
    color: "text-purple-600",
    features: ["Everything in Pro", "Multi-company", "Advanced analytics", "Custom integrations", "Dedicated CSM"],
  },
  {
    key: "founder_enterprise",
    label: "Founder Enterprise",
    annualMinor: 2_400_000,
    currency: "USD",
    icon: Crown,
    color: "text-amber-600",
    features: ["Everything in Scale", "SLA guarantee", "Custom contract", "Onboarding package", "White-glove support"],
  },
];

/* ---------- Helpers ---------- */
// v24.2 Airwallex wiring: in-app card collection (BIN sniff, Luhn, expiry
// validation, 3DS placeholder) was REMOVED. Card data is now collected on the
// Airwallex hosted payment page, so none of that client-side card logic is
// needed here anymore.
function fmtMoney(minor: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toFixed(0)}`;
  }
}

/* ---------- Plan card ---------- */
function PlanCard({ plan, selected, onSelect }: { plan: typeof PLANS[0]; selected: boolean; onSelect: () => void }) {
  const Icon = plan.icon;
  const monthlyMinor = plan.annualMinor > 0 ? Math.round(plan.annualMinor / 12) : 0;
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={`plan-card-${plan.key}`}
      className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
        selected
          ? "border-[hsl(184_98%_22%)] bg-[hsl(184_98%_22%)]/5"
          : "border-border hover:border-[hsl(184_98%_22%)]/40"
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon className={`h-5 w-5 ${plan.color}`} />
          <div>
            <div className="font-semibold text-sm">{plan.label}</div>
            {plan.recommended && (
              <Badge className="text-[9px] bg-[hsl(184_98%_22%)] text-white border-0 mt-0.5">Recommended</Badge>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold font-mono tabular-nums">
            {plan.annualMinor === 0 ? "Free" : fmtMoney(plan.annualMinor, plan.currency)}
          </div>
          {plan.annualMinor > 0 ? (
            <>
              <div className="text-[10px] text-muted-foreground">/ year</div>
              <div className="text-[10px] text-muted-foreground">
                ({fmtMoney(monthlyMinor, plan.currency)}/mo)
              </div>
            </>
          ) : null}
        </div>
      </div>
      <ul className="space-y-1 mt-2">
        {plan.features.map(f => (
          <li key={f} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />{f}
          </li>
        ))}
      </ul>
    </button>
  );
}

/* ---------- Main component ---------- */
export default function FounderSubscribe() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data: entCtx } = useEntitlement();
  // Patch v4: no demo fallback. Subscribe page guards on empty companyId.
  const companyId = entCtx?.founder?.activeCompanyId ?? "";

  const [selectedPlan, setSelectedPlan] = useState("founder_pro");

  const { data: subData } = useQuery<{ ok: boolean; subscription: Subscription }>({
    queryKey: ["/api/founder/subscription", companyId],
    queryFn: async () => (await apiRequest("GET", `/api/founder/subscription?companyId=${companyId}`)).json(),
    retry: false,
  });

  // v24.2 Airwallex wiring — the paid path no longer collects a card in-app.
  // It mints a real Airwallex PaymentIntent via POST /api/billing/plan and
  // redirects to the Airwallex hosted payment page (card data never touches
  // Capavate). The free path is unchanged (no card, no charge).
  const checkoutMut = useMutation({
    mutationFn: async () => {
      if (selectedPlan === "founder_free") {
        const res = await apiRequest("POST", "/api/founder/subscription/activate-free", {});
        return res.json();
      }
      // v25.25 Avi-3 guard — prevent silent 400 "tierId + companyId required"
      // when the active company is still loading or unset.
      if (!companyId) {
        const e = new Error("COMPANY_NOT_READY");
        (e as Error & { code?: string }).code = "COMPANY_NOT_READY";
        throw e;
      }
      // The single Capavate commercial tier is annual ($840/yr/company). Paid
      // plan keys all map to that tier for the hosted-checkout PaymentIntent.
      const res = await apiRequest("POST", "/api/billing/plan", {
        tierId: "founder_capavate_annual",
        companyId,
        billingCycle: "annual",
      });
      return res.json();
    },
    onSuccess: (data) => {
      if (data?.hostedPaymentPageUrl) {
        // Record legal consent before leaving for the hosted page.
        legalConsentRef.current?.recordConsent().catch(() => null);
        window.location.href = data.hostedPaymentPageUrl;
        return;
      }
      if (data.ok) {
        // v23.4.11 Phase 2 (B-202) — invalidate EVERY surface that renders the
        // plan, not just the subscription query. The company-switcher badge and
        // the round-wizard plan gate both read /api/founder/active-company and
        // /api/founder/companies; without these invalidations the badge stayed
        // "FREE" after a successful upgrade even though the server had persisted
        // founder_pro. Also refresh /api/auth/me which carries the entitlement
        // context used by RequireActiveSubscription.
        queryClient.invalidateQueries({ queryKey: ["/api/founder/subscription"] });
        queryClient.invalidateQueries({ queryKey: ["/api/founder/active-company"] });
        queryClient.invalidateQueries({ queryKey: ["/api/founder/companies"] });
        queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
        toast({ title: "Subscribed!", description: "Your subscription is now active." });
        // Record legal consent after successful subscription
        legalConsentRef.current?.recordConsent().catch(() => null);
        navigate("/founder/dashboard");
      } else {
        toast({ title: "Payment failed", description: data.error ?? "Please try again.", variant: "destructive" });
      }
    },
    onError: (e: any) => {
      const code = e?.code ?? "";
      if (code === "COMPANY_NOT_READY") {
        // v25.25 Avi-3 — actionable error when active company isn't loaded.
        toast({
          title: "Complete company setup first",
          description:
            "Your active company isn't loaded yet. Refresh the page, or finish company onboarding before subscribing.",
          variant: "destructive",
        });
      } else if (code === "gateway_not_configured" || e?.message?.includes("gateway_not_configured")) {
        toast({ title: "Payment gateway not configured", description: "Contact your administrator to enable payments.", variant: "destructive" });
      } else {
        toast({ title: "Payment failed", description: e?.message ?? "Please try again.", variant: "destructive" });
      }
    },
  });

  const selectedPlanObj = PLANS.find(p => p.key === selectedPlan)!;
  const isFree = selectedPlan === "founder_free";
  const legalConsentRef = useRef<LegalConsentCheckboxRef>(null);
  const [legalChecked, setLegalChecked] = useState(false);

  return (
    <div className="min-h-screen bg-[hsl(210_20%_98%)] flex items-start justify-center py-12 px-4">
      <div className="w-full max-w-4xl">
        {/* v23.8 C3/W-6 (BUG-014) — a founder who lands on the subscription
            gate must be able to leave without subscribing. Without this they
            were trapped on this page with no way to sign out. */}
        <div className="flex justify-end mb-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="button-subscribe-signout"
            onClick={async () => {
              try {
                await apiRequest("POST", "/api/auth/logout");
              } catch { /* non-fatal — cookie cleared server-side on next probe */ }
              await queryClient.resetQueries();
              window.location.href = "/login";
            }}
          >
            <LogOut className="h-3.5 w-3.5 mr-1.5" /> Sign out
          </Button>
        </div>
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Sparkles className="h-6 w-6 text-[hsl(184_98%_22%)]" />
            <span className="text-lg font-semibold text-[hsl(184_98%_22%)]">Capavate</span>
          </div>
          <h1 className="text-xl font-semibold mb-2">Choose your plan</h1>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Start managing your cap table, fundraising, and investor relations. Annual billing — cancel any time.
          </p>
          {subData?.subscription && (
            <div className="inline-flex items-center gap-2 mt-2 px-3 py-1 bg-sky-50 border border-sky-200 rounded-full text-[11px] text-sky-700">
              Current plan: <strong>{subData.subscription.plan.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</strong>
              &nbsp;·&nbsp;Status: {subData.subscription.status}
            </div>
          )}
          {/* Annual billing lock chip */}
          <div className="inline-flex items-center gap-1.5 mt-3 px-3 py-1 bg-[hsl(184_98%_22%)]/10 rounded-full border border-[hsl(184_98%_22%)]/20 ml-2">
            <Lock className="h-3 w-3 text-[hsl(184_98%_22%)]" />
            <span className="text-[11px] font-medium text-[hsl(184_98%_22%)]">Annual billing</span>
          </div>
        </div>

        <div className="grid lg:grid-cols-5 gap-6">
          {/* Plan selector (3/5) */}
          <div className="lg:col-span-3 space-y-3">
            <h2 className="text-sm font-semibold mb-3">Select a plan</h2>
            {PLANS.map(plan => (
              <PlanCard
                key={plan.key}
                plan={plan}
                selected={selectedPlan === plan.key}
                onSelect={() => setSelectedPlan(plan.key)}
              />
            ))}
          </div>

          {/* Payment form (2/5) */}
          <div className="lg:col-span-2">
            <Card className="sticky top-6">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <CreditCard className="h-4 w-4" />
                  {isFree ? "Activate free plan" : "Payment details"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {/* Order summary */}
                <div className="bg-muted/40 rounded-lg p-3 mb-4 space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{selectedPlanObj.label}</span>
                    <span className="font-semibold">{isFree ? "Free" : fmtMoney(selectedPlanObj.annualMinor, selectedPlanObj.currency)}</span>
                  </div>
                  {!isFree && (
                    <>
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>Billed annually</span>
                        <span>{fmtMoney(Math.round(selectedPlanObj.annualMinor / 12), selectedPlanObj.currency)}/mo equivalent</span>
                      </div>
                    </>
                  )}
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>Tax</span>
                    <span>$0.00</span>
                  </div>
                  <div className="border-t pt-1 mt-1 flex items-center justify-between text-sm font-semibold">
                    <span>Total due today</span>
                    <span>{isFree ? "Free" : fmtMoney(selectedPlanObj.annualMinor, selectedPlanObj.currency)}</span>
                  </div>
                </div>

                {isFree ? (
                  <Button
                    className="w-full bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_17%)] text-white"
                    onClick={() => checkoutMut.mutate()}
                    disabled={checkoutMut.isPending}
                    data-testid="button-activate-free"
                  >
                    Activate free plan
                  </Button>
                ) : (
                  // v24.2 Airwallex wiring — no in-app card form. Card details
                  // are collected on the Airwallex hosted page (PCI-DSS: card
                  // data never touches Capavate). The button mints a real
                  // PaymentIntent and redirects the founder to checkout.
                  <div className="space-y-3">
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900 flex items-start gap-2" data-testid="banner-hosted-checkout">
                      <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
                      <div>
                        You’ll be redirected to our payment provider (Airwallex)
                        to enter your card securely. Card details never touch
                        Capavate servers.
                      </div>
                    </div>
                    <LegalConsentCheckbox
                      ref={legalConsentRef}
                      docs={["terms", "privacy"]}
                      context="new_company"
                      required
                      onCheckedChange={setLegalChecked}
                    />
                    <Button
                      type="button"
                      className="w-full bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_17%)] text-white"
                      disabled={checkoutMut.isPending || !legalChecked}
                      onClick={() => checkoutMut.mutate()}
                      data-testid="button-subscribe"
                    >
                      {checkoutMut.isPending ? "Redirecting…" : (
                        <>Continue to Airwallex <ExternalLink className="h-3.5 w-3.5 ml-1.5" /></>
                      )}
                    </Button>
                  </div>
                )}

                {/* Trust signals */}
                <div className="mt-3 pt-3 border-t space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <ShieldCheck className="h-3 w-3 text-emerald-600" />256-bit SSL encryption
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <CheckCircle2 className="h-3 w-3 text-emerald-600" />Cancel any time
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <Lock className="h-3 w-3 text-emerald-600" />Annual billing · No hidden fees
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
