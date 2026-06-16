/**
 * v25.27 — Founder subscription gate page (FULLY DATA-DRIVEN).
 *
 * PRE-v25.27 BUG (Avi found 16-Jun-2026):
 * --------------------------------------
 * This page shipped a hardcoded `PLANS` array (Free/Pro/Scale/Enterprise with
 * fixed prices $0/$2,988/$9,000/$24,000) and submitted `tierId:
 * "founder_capavate_annual"` regardless of selection. Every founder was
 * charged $840 even though the UI showed up to $24,000.
 *
 * v25.27 FIX:
 * -----------
 * Per the standing rule "Pricing plans are determined from the Admin area —
 * never hardcoded", this page now:
 *
 *   1. Fetches the live tier catalog from `GET /api/billing/tiers` which
 *      reads from the admin-editable, DB-backed `pricingModelStore`.
 *   2. Renders each tier card from the server response (price, name, features
 *      all come from the admin's published configuration).
 *   3. Submits the EXACT tier id (or slug) the founder selected — no rewriting.
 *   4. Shows an empty-state UI if the admin hasn't published any tiers yet.
 *
 * Source code contains ZERO pricing numbers, ZERO feature lists, ZERO tier names.
 *
 * Airwallex hosted-checkout flow is unchanged from v24.2: card data never
 * touches Capavate.
 */
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2, Lock, CreditCard, ShieldCheck, Sparkles,
  Building2, ExternalLink, LogOut, AlertTriangle,
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

/* ---------- BillingTier — shape returned by GET /api/billing/tiers ----------
 * v25.27: this is what the server returns from `pricingTiersStore.listTiers()`,
 * which reads from the admin-editable `pricingModelStore`. */
interface BillingTier {
  id: string;
  slug: string;
  name: string;
  monthlyPriceCents: number;
  annualPriceCents: number;
  currency: string;
  status: "live" | "draft" | "preview" | "deprecated";
  billingCycle?: "monthly" | "annual" | "biennial" | "one_time" | "perpetual";
}

/* ---------- Helpers ---------- */
function fmtMoney(minor: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toFixed(0)}`;
  }
}

function isFreeTier(t: BillingTier): boolean {
  return t.annualPriceCents === 0 && t.monthlyPriceCents === 0;
}

/* ---------- Plan card (renders an admin-configured tier) ---------- */
function PlanCard({
  tier,
  selected,
  onSelect,
}: {
  tier: BillingTier;
  selected: boolean;
  onSelect: () => void;
}) {
  const monthlyMinor = tier.monthlyPriceCents > 0
    ? tier.monthlyPriceCents
    : tier.annualPriceCents > 0
    ? Math.round(tier.annualPriceCents / 12)
    : 0;
  const isFree = isFreeTier(tier);

  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={`plan-card-${tier.slug}`}
      className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
        selected
          ? "border-[hsl(184_98%_22%)] bg-[hsl(184_98%_22%)]/5"
          : "border-border hover:border-[hsl(184_98%_22%)]/40"
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-[hsl(184_98%_22%)]" />
          <div>
            <div className="font-semibold text-sm">{tier.name}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold font-mono tabular-nums">
            {isFree ? "Free" : fmtMoney(tier.annualPriceCents, tier.currency)}
          </div>
          {!isFree && (
            <>
              <div className="text-[10px] text-muted-foreground">/ year</div>
              <div className="text-[10px] text-muted-foreground">
                ({fmtMoney(monthlyMinor, tier.currency)}/mo)
              </div>
            </>
          )}
        </div>
      </div>
    </button>
  );
}

/* ---------- Empty state — admin hasn't published any tiers yet ---------- */
function NoTiersState() {
  return (
    <Card className="border-amber-200 bg-amber-50">
      <CardContent className="p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-sm mb-1 text-amber-900">
              Subscription plans are being configured
            </h3>
            <p className="text-xs text-amber-800 mb-3">
              No plans have been published yet. Your administrator needs to set
              prices in /admin/pricing-models before you can subscribe. Please
              check back shortly, or contact your administrator.
            </p>
            <p className="text-[11px] text-amber-700">
              Capavate intentionally ships with no source-baked prices —
              everything you see here is what your admin has configured.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- Main component ---------- */
export default function FounderSubscribe() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data: entCtx } = useEntitlement();
  const companyId = entCtx?.founder?.activeCompanyId ?? "";

  /* v25.27 — fetch the admin-configured tier list. */
  const {
    data: tiersData,
    isLoading: tiersLoading,
    error: tiersError,
  } = useQuery<{ ok: boolean; tiers: BillingTier[] } | BillingTier[]>({
    queryKey: ["/api/billing/tiers"],
    queryFn: async () => (await apiRequest("GET", "/api/billing/tiers")).json(),
    retry: 1,
  });

  /* Normalize: the existing /api/billing/tiers route returns a bare array;
   * we also support `{ ok, tiers }` shape in case server-side gets updated. */
  const tiers: BillingTier[] = Array.isArray(tiersData)
    ? tiersData
    : (tiersData?.tiers ?? []);

  const [selectedTierId, setSelectedTierId] = useState<string>("");

  /* Auto-select first non-free tier on first load (or first free tier if all are free). */
  useEffect(() => {
    if (!selectedTierId && tiers.length > 0) {
      const recommended = tiers.find((t) => !isFreeTier(t)) ?? tiers[0];
      setSelectedTierId(recommended.id);
    }
  }, [tiers, selectedTierId]);

  const selectedTier = tiers.find((t) => t.id === selectedTierId);

  const { data: subData } = useQuery<{ ok: boolean; subscription: Subscription }>({
    queryKey: ["/api/founder/subscription", companyId],
    queryFn: async () => (await apiRequest("GET", `/api/founder/subscription?companyId=${companyId}`)).json(),
    retry: false,
    enabled: !!companyId,
  });

  /* Airwallex hosted checkout mutation. */
  const checkoutMut = useMutation({
    mutationFn: async () => {
      if (!selectedTier) {
        const e = new Error("NO_TIER_SELECTED");
        (e as Error & { code?: string }).code = "NO_TIER_SELECTED";
        throw e;
      }

      if (isFreeTier(selectedTier)) {
        const res = await apiRequest("POST", "/api/founder/subscription/activate-free", {});
        return res.json();
      }

      if (!companyId) {
        const e = new Error("COMPANY_NOT_READY");
        (e as Error & { code?: string }).code = "COMPANY_NOT_READY";
        throw e;
      }

      /* v25.27 — send the exact tier id the admin has published; the server's
       * pricingTiersStore.getById() resolves it against pricingModelStore. */
      const res = await apiRequest("POST", "/api/billing/plan", {
        tierId: selectedTier.id,
        companyId,
        billingCycle: "annual",
      });
      return res.json();
    },
    onSuccess: (data) => {
      if (data?.hostedPaymentPageUrl) {
        legalConsentRef.current?.recordConsent().catch(() => null);
        window.location.href = data.hostedPaymentPageUrl;
        return;
      }
      if (data.ok) {
        queryClient.invalidateQueries({ queryKey: ["/api/founder/subscription"] });
        queryClient.invalidateQueries({ queryKey: ["/api/founder/active-company"] });
        queryClient.invalidateQueries({ queryKey: ["/api/founder/companies"] });
        queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
        toast({ title: "Subscribed!", description: "Your subscription is now active." });
        legalConsentRef.current?.recordConsent().catch(() => null);
        navigate("/founder/dashboard");
      } else {
        toast({ title: "Payment failed", description: data.error ?? "Please try again.", variant: "destructive" });
      }
    },
    onError: (e: any) => {
      const code = e?.code ?? "";
      if (code === "COMPANY_NOT_READY") {
        toast({
          title: "Complete company setup first",
          description: "Your active company isn't loaded yet. Refresh the page, or finish company onboarding before subscribing.",
          variant: "destructive",
        });
      } else if (code === "NO_TIER_SELECTED") {
        toast({ title: "Select a plan first", description: "Please select a subscription plan.", variant: "destructive" });
      } else if (code === "gateway_not_configured" || e?.message?.includes("gateway_not_configured")) {
        toast({ title: "Payment gateway not configured", description: "Contact your administrator to enable payments.", variant: "destructive" });
      } else {
        toast({ title: "Payment failed", description: e?.message ?? "Please try again.", variant: "destructive" });
      }
    },
  });

  const legalConsentRef = useRef<LegalConsentCheckboxRef>(null);
  const [legalChecked, setLegalChecked] = useState(false);

  const isFree = !!(selectedTier && isFreeTier(selectedTier));

  return (
    <div className="min-h-screen bg-[hsl(210_20%_98%)] flex items-start justify-center py-12 px-4">
      <div className="w-full max-w-4xl">
        {/* Sign out (v23.8 C3/W-6 BUG-014: don't trap a founder on the gate) */}
        <div className="flex justify-end mb-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="button-subscribe-signout"
            onClick={async () => {
              try {
                await apiRequest("POST", "/api/auth/logout");
              } catch { /* non-fatal */ }
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
              Current plan: <strong>{subData.subscription.plan.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</strong>
              &nbsp;·&nbsp;Status: {subData.subscription.status}
            </div>
          )}
          <div className="inline-flex items-center gap-1.5 mt-3 px-3 py-1 bg-[hsl(184_98%_22%)]/10 rounded-full border border-[hsl(184_98%_22%)]/20 ml-2">
            <Lock className="h-3 w-3 text-[hsl(184_98%_22%)]" />
            <span className="text-[11px] font-medium text-[hsl(184_98%_22%)]">Annual billing</span>
          </div>
        </div>

        {/* Loading state */}
        {tiersLoading && (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              Loading available plans…
            </CardContent>
          </Card>
        )}

        {/* Error state */}
        {!tiersLoading && tiersError && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="p-6 text-center text-sm text-red-800">
              Unable to load subscription plans. Please refresh the page or contact support.
            </CardContent>
          </Card>
        )}

        {/* Empty state — admin hasn't published any tiers */}
        {!tiersLoading && !tiersError && tiers.length === 0 && <NoTiersState />}

        {/* Main UI */}
        {!tiersLoading && !tiersError && tiers.length > 0 && (
          <div className="grid lg:grid-cols-5 gap-6">
            {/* Plan selector (3/5) */}
            <div className="lg:col-span-3 space-y-3">
              <h2 className="text-sm font-semibold mb-3">Select a plan</h2>
              {tiers.map((tier) => (
                <PlanCard
                  key={tier.id}
                  tier={tier}
                  selected={selectedTierId === tier.id}
                  onSelect={() => setSelectedTierId(tier.id)}
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
                  {selectedTier && (
                    <div className="bg-muted/40 rounded-lg p-3 mb-4 space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{selectedTier.name}</span>
                        <span className="font-semibold">
                          {isFree ? "Free" : fmtMoney(selectedTier.annualPriceCents, selectedTier.currency)}
                        </span>
                      </div>
                      {!isFree && (
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>Billed annually</span>
                          <span>
                            {fmtMoney(
                              selectedTier.monthlyPriceCents > 0
                                ? selectedTier.monthlyPriceCents
                                : Math.round(selectedTier.annualPriceCents / 12),
                              selectedTier.currency
                            )}
                            /mo equivalent
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>Tax</span>
                        <span>$0.00</span>
                      </div>
                      <div className="border-t pt-1 mt-1 flex items-center justify-between text-sm font-semibold">
                        <span>Total due today</span>
                        <span>
                          {isFree ? "Free" : fmtMoney(selectedTier.annualPriceCents, selectedTier.currency)}
                        </span>
                      </div>
                    </div>
                  )}

                  {isFree ? (
                    <Button
                      className="w-full bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_17%)] text-white"
                      onClick={() => checkoutMut.mutate()}
                      disabled={checkoutMut.isPending || !selectedTier}
                      data-testid="button-activate-free"
                    >
                      Activate free plan
                    </Button>
                  ) : (
                    <div className="space-y-3">
                      <div
                        className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900 flex items-start gap-2"
                        data-testid="banner-hosted-checkout"
                      >
                        <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
                        <div>
                          You'll be redirected to our payment provider (Airwallex) to enter your card securely. Card details never touch Capavate servers.
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
                        disabled={checkoutMut.isPending || !legalChecked || !selectedTier}
                        onClick={() => checkoutMut.mutate()}
                        data-testid="button-subscribe"
                      >
                        {checkoutMut.isPending ? "Redirecting…" : (
                          <>
                            Continue to Airwallex <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
                          </>
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
        )}
      </div>
    </div>
  );
}
