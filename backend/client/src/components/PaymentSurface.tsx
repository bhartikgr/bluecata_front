/**
 * Sprint 14 D2 — PaymentSurface frontend.
 *
 * Demo-mode surface for the Capavate payment flow. Backed by paymentStore
 * which uses Decimal.js with idempotent intent IDs; supported currencies are
 * USD, CAD, GBP, EUR, SGD, HKD, CNY. Coupon table: CP10 / FOUNDER20 /
 * COLLECTIVE5.
 *
 * UI states:
 *  - idle (form)
 *  - submitting
 *  - requires_3ds (challenge placeholder)
 *  - succeeded (Decimal.js receipt + reconcile)
 *  - failed (declined / network-error)
 *  - demo (Stripe placeholder banner)
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CreditCard, ShieldCheck, AlertOctagon, CheckCircle2, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useCapavateToast } from "./Toast";
import { InlineError } from "./InlineError";

const SUPPORTED_CURRENCIES = ["USD", "CAD", "GBP", "EUR", "SGD", "HKD", "CNY"] as const;
type Currency = (typeof SUPPORTED_CURRENCIES)[number];

export interface PaymentSurfaceProps {
  customerId: string;
  /** Default kind ("subscription" | "round_fee" | "advisory"...). */
  kind?: string;
  /** When true, show Stripe placeholder banner (no real network calls). */
  demoMode?: boolean;
}

interface PaymentEntry {
  id: string;
  state: "pending" | "succeeded" | "failed" | "requires_3ds" | "refunded" | "demo";
  amountCents: number;
  currency: Currency;
  netCents: number;
  discountCents: number;
  failureReason?: string;
}

export function PaymentSurface({ customerId, kind = "subscription", demoMode = true }: PaymentSurfaceProps) {
  const toast = useCapavateToast();
  const [amount, setAmount] = useState("99.00");
  const [currency, setCurrency] = useState<Currency>("USD");
  const [coupon, setCoupon] = useState("");
  const [intentId, setIntentId] = useState(() => `pi_${Math.random().toString(36).slice(2, 10)}`);
  const [result, setResult] = useState<PaymentEntry | null>(null);

  const charge = useMutation({
    mutationFn: async () => {
      const amountCents = Math.round(parseFloat(amount) * 100);
      if (!Number.isFinite(amountCents) || amountCents <= 0) throw new Error("Invalid amount");
      const res = await apiRequest("POST", "/api/payments/charge", {
        intentId,
        customerId,
        kind,
        amountCents,
        currency,
        couponCode: coupon || undefined,
        demoMode,
      });
      return (await res.json()) as PaymentEntry;
    },
    onSuccess: (entry) => {
      setResult(entry);
      if (entry.state === "succeeded" || entry.state === "demo") {
        toast.success({
          title: "Payment processed",
          description: `${(entry.netCents / 100).toFixed(2)} ${entry.currency} · receipt ${entry.id.slice(0, 8)}…`,
        });
      } else if (entry.state === "requires_3ds") {
        toast.info({ title: "3DS challenge required", description: "Demo: tap continue to simulate authentication." });
      } else if (entry.state === "failed") {
        toast.error({ title: "Payment failed", description: entry.failureReason ?? "Card declined" });
      }
    },
    onError: (err: any) => {
      toast.error({ title: "Network error", description: err?.message ?? "Could not reach payment processor" });
    },
  });

  const reset = () => {
    setIntentId(`pi_${Math.random().toString(36).slice(2, 10)}`);
    setResult(null);
  };

  return (
    <Card data-testid="card-payment-surface">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <CreditCard className="h-4 w-4" /> Payment surface
          {demoMode && <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-800 bg-amber-50">Demo</Badge>}
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">
          Decimal.js precision. 7 currencies. Idempotent on <code className="font-mono">intentId</code>. Coupons: CP10, FOUNDER20, COLLECTIVE5.
        </p>
      </CardHeader>
      <CardContent>
        {/* v23.4.7 Phase 8 / BUG 016 — the customer-facing banner now reads in
         * business language. The Stripe / state=demo tech detail is gated
         * behind import.meta.env.DEV so it ONLY renders in local development.
         */}
        {demoMode && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 mb-4 flex items-start gap-2" data-testid="banner-demo-mode">
            <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <strong>Payment processing is in private beta.</strong> Your
              company workspace is fully functional; payment activation will
              be enabled once your billing relationship is confirmed.
              {import.meta.env.DEV && (
                <span
                  className="block mt-1 text-amber-700 italic"
                  data-testid="banner-demo-dev-detail"
                >
                  Dev note: Stripe placeholder — no real charge will be made.
                  All ledger entries are tagged{" "}
                  <code className="font-mono">state=demo</code>.
                </span>
              )}
            </div>
          </div>
        )}

        {!result && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Label className="text-xs" htmlFor="pay-amount">Amount</Label>
                <Input
                  id="pay-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  data-testid="input-amount"
                />
              </div>
              <div>
                <Label className="text-xs">Currency</Label>
                <Select value={currency} onValueChange={(v) => setCurrency(v as Currency)}>
                  <SelectTrigger data-testid="select-currency"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs" htmlFor="pay-coupon">Coupon (optional)</Label>
              <Input
                id="pay-coupon"
                value={coupon}
                onChange={(e) => setCoupon(e.target.value.toUpperCase())}
                placeholder="CP10 / FOUNDER20 / COLLECTIVE5"
                data-testid="input-coupon"
              />
            </div>
            <Button
              onClick={() => charge.mutate()}
              disabled={charge.isPending}
              className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white w-full"
              data-testid="button-pay"
            >
              {charge.isPending ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Processing…</>) : (<><CreditCard className="h-4 w-4 mr-2" /> Pay {amount} {currency}</>)}
            </Button>
          </div>
        )}

        {result && (result.state === "succeeded" || result.state === "demo") && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm" data-testid="receipt-success">
            <div className="flex items-center gap-2 text-emerald-800 font-semibold mb-2">
              <CheckCircle2 className="h-4 w-4" /> Payment {result.state === "demo" ? "simulated" : "succeeded"}
            </div>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <dt className="text-muted-foreground">Receipt</dt><dd className="font-mono">{result.id}</dd>
              <dt className="text-muted-foreground">Gross</dt><dd className="font-mono">{(result.amountCents / 100).toFixed(2)} {result.currency}</dd>
              <dt className="text-muted-foreground">Discount</dt><dd className="font-mono">{(result.discountCents / 100).toFixed(2)} {result.currency}</dd>
              <dt className="text-muted-foreground">Net charged</dt><dd className="font-mono font-semibold">{(result.netCents / 100).toFixed(2)} {result.currency}</dd>
            </dl>
            <Button variant="outline" size="sm" className="mt-3" onClick={reset} data-testid="button-new-payment">New payment</Button>
          </div>
        )}

        {result && result.state === "requires_3ds" && (
          <div className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm" data-testid="receipt-3ds">
            <div className="flex items-center gap-2 text-blue-800 font-semibold mb-2">
              <ShieldCheck className="h-4 w-4" /> 3D Secure required
            </div>
            <p className="text-xs text-blue-900">Issuer requires step-up authentication. In demo mode this would open the bank challenge sheet.</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={reset} data-testid="button-cancel-3ds">Cancel</Button>
          </div>
        )}

        {result && result.state === "failed" && (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm" data-testid="receipt-failed">
            <div className="flex items-center gap-2 text-rose-800 font-semibold mb-2">
              <AlertOctagon className="h-4 w-4" /> Payment declined
            </div>
            <InlineError message={result.failureReason ?? "Card declined"} />
            <Button variant="outline" size="sm" className="mt-3" onClick={reset} data-testid="button-retry">Try again</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
