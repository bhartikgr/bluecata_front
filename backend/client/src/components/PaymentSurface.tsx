/**
 * PaymentSurface — Airwallex hosted-checkout entry point.
 *
 * v24.2 Airwallex wiring
 * ----------------------
 * This surface previously rendered an in-app amount/coupon "charge" form that
 * posted to a demo /api/payments/charge endpoint and printed a fake receipt.
 * That was misleading: it implied Capavate processed the payment itself. Per
 * the billing design intent (PCI-DSS scope is limited — card data NEVER touches
 * Capavate servers), payment details must be collected on the Airwallex hosted
 * payment page, NOT here.
 *
 * The surface now:
 *   1. Calls POST /api/billing/plan to mint a real Airwallex PaymentIntent.
 *   2. Redirects the browser to the returned `hostedPaymentPageUrl`.
 *   3. Surfaces a clear, honest error if the gateway is not configured.
 *
 * It does NOT collect a card number, expiry, or CVC. There is no demo charge.
 */
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CreditCard, ShieldCheck, Loader2, ArrowRight } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useCapavateToast } from "./Toast";
import { InlineError } from "./InlineError";
import { useState } from "react";

export interface PaymentSurfaceProps {
  customerId: string;
  /** Tier the founder is purchasing (required to mint a PaymentIntent). */
  tierId?: string;
  /** Company the subscription is for. */
  companyId?: string;
  /** Billing cycle. Defaults to annual (the single default Capavate tier). */
  billingCycle?: "monthly" | "annual";
  /** Default kind ("subscription" | "round_fee" | "advisory"...). Display-only. */
  kind?: string;
}

export function PaymentSurface({
  customerId,
  tierId = "founder_capavate_annual",
  companyId,
  billingCycle = "annual",
}: PaymentSurfaceProps) {
  const toast = useCapavateToast();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const checkout = useMutation({
    mutationFn: async () => {
      // v25.25 Avi-3 guard — either companyId or customerId must be present;
      // an empty string would otherwise trigger the server's generic 400
      // "tierId + companyId required". This mirrors the Settings switchPlanMut
      // guard so the founder gets a clear actionable toast instead.
      const effectiveCompanyId = companyId ?? customerId;
      if (!effectiveCompanyId) {
        const e = new Error("COMPANY_NOT_READY");
        (e as Error & { code?: string }).code = "COMPANY_NOT_READY";
        throw e;
      }
      const res = await apiRequest("POST", "/api/billing/plan", {
        tierId,
        companyId: effectiveCompanyId,
        billingCycle,
      });
      return (await res.json()) as { ok: boolean; hostedPaymentPageUrl?: string };
    },
    onSuccess: (data) => {
      if (data?.hostedPaymentPageUrl) {
        // Hand off to Airwallex for actual, PCI-compliant card collection.
        window.location.href = data.hostedPaymentPageUrl;
        return;
      }
      setErrorMsg("Could not start checkout. Please try again.");
    },
    onError: (err: any) => {
      const code = err?.code ?? "";
      if (code === "COMPANY_NOT_READY") {
        // v25.25 Avi-3 — actionable error when companyId is unset.
        const msg =
          "Your active company isn't loaded yet. Refresh the page, or finish company onboarding before purchasing.";
        setErrorMsg(msg);
        toast.error({ title: "Complete company setup first", description: msg });
      } else if (code === "gateway_not_configured" || err?.message?.includes("gateway_not_configured")) {
        const msg = "Payment gateway is not configured. Contact your administrator.";
        setErrorMsg(msg);
        toast.error({ title: "Payment gateway not configured", description: msg });
      } else if (code === "gateway_network_error" || err?.message?.includes("gateway_network_error") || err?.message?.includes("unreachable")) {
        // v24.4.2 Bug G — surface clear error when AIRWALLEX_REAL_NETWORK=1 but
        // credentials are stale or the network is unreachable.
        const msg = err?.message ?? "Airwallex gateway is unreachable. Check credentials and AIRWALLEX_API_BASE.";
        setErrorMsg(msg);
        toast.error({ title: "Gateway unreachable", description: msg });
      } else {
        const msg = err?.message ?? "Could not reach the payment gateway.";
        setErrorMsg(msg);
        toast.error({ title: "Checkout failed", description: msg });
      }
    },
  });

  return (
    <Card data-testid="card-payment-surface">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <CreditCard className="h-4 w-4" /> Payment
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">
          You’ll be redirected to our payment provider (Airwallex) to enter your
          card securely. Card details never touch Capavate servers.
        </p>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900 mb-4 flex items-start gap-2" data-testid="banner-hosted-checkout">
          <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <strong>Secure hosted checkout.</strong> Payment is processed by
            Airwallex on their PCI-DSS compliant page. We never see or store
            your full card number.
          </div>
        </div>

        {errorMsg && (
          <div className="mb-3" data-testid="payment-surface-error">
            <InlineError message={errorMsg} />
          </div>
        )}

        <Button
          onClick={() => { setErrorMsg(null); checkout.mutate(); }}
          disabled={checkout.isPending}
          className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white w-full"
          data-testid="button-continue-to-airwallex"
        >
          {checkout.isPending ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Redirecting…</>
          ) : (
            <>Continue to Airwallex <ArrowRight className="h-4 w-4 ml-2" /></>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
