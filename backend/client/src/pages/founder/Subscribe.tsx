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
import { useLocation, Redirect } from "wouter";
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
import capavateLogoUrl from "@/assets/capavate-logo.png";

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
  /** v25.43 F12 — DB-backed plan description from pricing_models.description. */
  description?: string;
}

/* ---------- Helpers ---------- */

/** v25.28 — lazy-load Airwallex Components SDK from their official CDN.
 *
 * We don't want every page in the app to ship the SDK. This injects the script
 * tag on demand the first time the founder clicks "Continue to Airwallex".
 * Idempotent: returns the same Promise on subsequent calls. */
let _airwallexSdkPromise: Promise<void> | null = null;
function loadAirwallexSDK(): Promise<void> {
  if (_airwallexSdkPromise) return _airwallexSdkPromise;
  if (typeof window !== "undefined" && (window as any).AirwallexComponentsSDK?.init) {
    _airwallexSdkPromise = Promise.resolve();
    return _airwallexSdkPromise;
  }
  _airwallexSdkPromise = new Promise<void>((resolve, reject) => {
    if (typeof document === "undefined") return reject(new Error("no_document"));
    const existing = document.getElementById("airwallex-sdk") as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("airwallex_sdk_load_error")));
      if ((window as any).AirwallexComponentsSDK?.init) resolve();
      return;
    }
    const s = document.createElement("script");
    s.id = "airwallex-sdk";
    s.async = true;
    s.src = "https://static.airwallex.com/components/sdk/v1/index.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("airwallex_sdk_load_error"));
    document.head.appendChild(s);
  });
  return _airwallexSdkPromise;
}

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
          ? "border-[hsl(0_100%_40%)] bg-[hsl(0_100%_40%)]/5"
          : "border-border hover:border-[hsl(0_100%_40%)]/40"
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-[hsl(0_100%_40%)]" />
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
      {/* v25.43 F12 — render the admin-configured plan description beneath the
          price line. When the tier has no description we render nothing (clean
          empty state, no placeholder copy). */}
      {tier.description && tier.description.trim().length > 0 && (
        <p className="text-xs text-muted-foreground mt-1" data-testid={`plan-description-${tier.slug}`}>
          {tier.description}
        </p>
      )}
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
              This platform intentionally ships with no source-baked prices —
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

  /* v25.43 R3-8 — Subscribe gate (evaluated below, after all hooks, to honour
   * the Rules of Hooks). Per Ozan's QA (EDITS-version2-CAPAVATE.pptx, slide 1):
   * "If the user does not have a registered company, GO DIRECTLY to the Add
   * Company page. No need to show this page at all." */
  const companies = entCtx?.founder?.companies ?? [];
  const noCompany = !!entCtx && companies.length === 0;

  /* v25.45 ROUND 2 (BLOCKER 2) — self-serve workspace revival. The archived
   * dashboard banner links here as /founder/subscribe?reactivate=1. When that
   * flag is present we (a) render "Reactivate {companyName}" instead of "Choose
   * your plan", (b) show a reactivation notice, (c) pre-select the founder's
   * last_active_plan, and (d) on successful payment call
   * POST /api/founder/workspace/reactivate to clear the archive flags before
   * routing to the dashboard. */
  const isReactivate = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("reactivate") === "1";

  const { data: archiveState } = useQuery<{
    ok: boolean; companyName: string | null; lastActivePlan: string | null; archiveStatus: string;
  }>({
    queryKey: ["/api/founder/workspace/archive-state", companyId],
    queryFn: async () =>
      (await apiRequest("GET", `/api/founder/workspace/archive-state?companyId=${companyId}`)).json(),
    retry: false,
    enabled: isReactivate && !!companyId,
  });
  const reactivateCompanyName = archiveState?.companyName ?? "";
  const lastActivePlan = archiveState?.lastActivePlan ?? "";

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

  /* v25.45 ROUND 2 (BLOCKER 2) — in the reactivate flow, pre-select the
   * founder's last_active_plan (matched by tier id OR slug) once both the tier
   * list and the archive-state have loaded. */
  useEffect(() => {
    if (!isReactivate || !lastActivePlan || tiers.length === 0) return;
    const match = tiers.find(
      (t) => t.id === lastActivePlan || t.slug === lastActivePlan,
    );
    if (match) setSelectedTierId(match.id);
  }, [isReactivate, lastActivePlan, tiers]);

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
    onSuccess: async (data) => {
      /* v25.28 — Airwallex.js redirectToCheckout integration.
       *
       * BEFORE v25.28: the server returned a fabricated `hostedPaymentPageUrl`
       * like `https://checkout.airwallex.com/checkout?...` which doesn't exist.
       * The browser landed on a blank page, the PaymentIntent stayed in
       * "Created" status forever, and no card was ever charged.
       *
       * AFTER v25.28: the server returns `data.airwallex = { intent_id,
       * client_secret, currency, successUrl, env }`. We load Airwallex's
       * official Components SDK from their CDN, init it, and call
       * payments.redirectToCheckout(...) which takes the user to the REAL
       * Airwallex-hosted checkout page where they enter a card and pay.
       *
       * Reference: https://www.airwallex.com/docs/payments/get-started/quickstart
       */
      if (data?.airwallex?.intent_id && data?.airwallex?.client_secret) {
        try {
          legalConsentRef.current?.recordConsent().catch(() => null);
          await loadAirwallexSDK();
          // window.AirwallexComponentsSDK is provided by the CDN script.
          const sdk = (window as any).AirwallexComponentsSDK;
          if (!sdk?.init) throw new Error("AirwallexComponentsSDK not available after load");
          const { payments } = await sdk.init({
            env: data.airwallex.env || "demo",
            enabledElements: ["payments"],
          });
          payments.redirectToCheckout({
            env: data.airwallex.env || "demo",
            mode: "payment",
            currency: data.airwallex.currency,
            intent_id: data.airwallex.intent_id,
            client_secret: data.airwallex.client_secret,
            successUrl: data.airwallex.successUrl,
          });
          return;
        } catch (sdkErr: any) {
          toast({
            title: "Payment redirect failed",
            description: sdkErr?.message ?? "Could not redirect to Airwallex. Please try again.",
            variant: "destructive",
          });
          return;
        }
      }
      /* v25.28 stub-mode fallback — server still emits hostedPaymentPageUrl in
       * stub mode pointing at our own BillingReturn page. */
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
        legalConsentRef.current?.recordConsent().catch(() => null);
        // v25.45 ROUND 2 (BLOCKER 2) — on successful payment in the reactivate
        // flow, clear the archive flags BEFORE routing to the dashboard so the
        // archived banner does not reappear. Failure to reactivate surfaces a
        // toast and keeps the founder on the page to retry.
        if (isReactivate && companyId) {
          try {
            const rr = await apiRequest("POST", "/api/founder/workspace/reactivate", { companyId });
            const rj = await rr.json();
            if (!rj?.ok) throw new Error(rj?.error ?? "reactivate_failed");
            queryClient.invalidateQueries({ queryKey: ["/api/founder/workspace/archive-state"] });
            queryClient.invalidateQueries({ queryKey: ["/api/founder/workspace/archive-status"] });
            toast({ title: "Workspace reactivated", description: "Welcome back — your workspace is active again." });
            navigate("/founder/dashboard");
            return;
          } catch (reErr: any) {
            toast({
              title: "Reactivation failed",
              description: reErr?.message ?? "Payment succeeded but we could not reactivate the workspace. Please retry.",
              variant: "destructive",
            });
            return;
          }
        }
        toast({ title: "Subscribed!", description: "Your subscription is now active." });
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

  /* v25.43 R3-8 — a company-less founder must NEVER see the "Choose your plan"
   * UI. This guards stale tabs, direct URL navigation, and bookmarked
   * /founder/subscribe URLs by redirecting to the company-creation onboarding
   * step. Placed after all hooks so hook order stays stable across renders. */
  if (noCompany) {
    return <Redirect to="/company-profile?onboarding=1" />;
  }

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
          {/* v25.43 F10 — replaced the text-only "Capavate" wordmark with the
              actual brand logo image. The flex wrapper carries layout semantics
              (centred, gap, bottom margin) so it stays. */}
          <div className="flex items-center justify-center gap-2 mb-3">
            <Sparkles className="h-6 w-6 text-[hsl(0_100%_40%)]" />
            <img src={capavateLogoUrl} alt="Capavate" className="h-7 w-auto" data-testid="subscribe-logo" />
          </div>
          <h1 className="text-xl font-semibold mb-2" data-testid="subscribe-header">
            {isReactivate
              ? `Reactivate ${reactivateCompanyName || "your workspace"}`
              : "Choose your plan"}
          </h1>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Start managing your cap table, fundraising, and investor relations. Annual billing — cancel any time.
          </p>
          {isReactivate && (
            <div
              className="mt-3 mx-auto max-w-md px-3 py-2 rounded-md border border-[#cc0001]/30 bg-[#cc0001]/5 text-[12px] text-[#cc0001]"
              data-testid="reactivate-notice"
            >
              Reactivating your archived workspace. Your previous plan will be restored on successful payment.
            </div>
          )}
          {subData?.subscription && (
            <div className="inline-flex items-center gap-2 mt-2 px-3 py-1 bg-sky-50 border border-sky-200 rounded-full text-[11px] text-sky-700">
              Current plan: <strong>{subData.subscription.plan.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</strong>
              &nbsp;·&nbsp;Status: {subData.subscription.status}
            </div>
          )}
          <div className="inline-flex items-center gap-1.5 mt-3 px-3 py-1 bg-[hsl(0_100%_40%)]/10 rounded-full border border-[hsl(0_100%_40%)]/20 ml-2">
            <Lock className="h-3 w-3 text-[hsl(0_100%_40%)]" />
            <span className="text-[11px] font-medium text-[hsl(0_100%_40%)]">Annual billing</span>
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
                      className="w-full bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white"
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
                          You'll be redirected to our payment provider (Airwallex) to enter your card securely. Card details never touch our servers.
                        </div>
                      </div>
                      {/* v25.43 F11 — 1px border on the legal-agreement checkbox
                          (the consent group just above "Continue to Airwallex")
                          to lift its contrast off the card background. This is
                          the checkbox, NOT the Airwallex hosted-checkout callout
                          above it. */}
                      <div className="border border-slate-300 rounded-md p-2" data-testid="legal-consent-wrapper">
                        <LegalConsentCheckbox
                          ref={legalConsentRef}
                          docs={["terms", "privacy"]}
                          context="new_company"
                          required
                          onCheckedChange={setLegalChecked}
                        />
                      </div>
                      <Button
                        type="button"
                        className="w-full bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white"
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
                      <ShieldCheck className="h-3 w-3 text-emerald-600" />Encrypted payment processing
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
