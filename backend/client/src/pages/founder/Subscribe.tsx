/**
 * Sprint 28 Wave 8 — Founder subscription gate page (polished).
 *
 * - Loads pending subscription from GET /api/founder/subscription
 * - Plan selector: founder_free / founder_pro (default) / founder_scale / founder_enterprise
 *   with monthly-equivalent muted text under annual price
 * - Card brand auto-detected via BIN sniff (Visa / MC / Amex)
 * - Luhn check on submit
 * - Expiry future-date validation
 * - Billing zip required
 * - Inline validation toasts
 * - 3DS required → <RequiresThreeDS> card
 * - Success → invalidate /api/founder/subscription, toast "Subscribed", navigate to /founder/dashboard
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  CheckCircle2, Lock, CreditCard, ShieldCheck, Sparkles,
  Building2, Zap, Star, Crown, ExternalLink,
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

/* ---------- BIN sniff for card brand ---------- */
function detectCardBrand(cardNumber: string): "visa" | "mastercard" | "amex" | "unknown" {
  const digits = cardNumber.replace(/\D/g, "");
  if (/^4/.test(digits)) return "visa";
  if (/^5[1-5]/.test(digits) || /^2[2-7]/.test(digits)) return "mastercard";
  if (/^3[47]/.test(digits)) return "amex";
  return "unknown";
}

/* ---------- Luhn check ---------- */
function luhnCheck(cardNumber: string): boolean {
  const digits = cardNumber.replace(/\D/g, "");
  if (digits.length < 12) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/* ---------- Expiry future-date validation ---------- */
function isExpiryFuture(expiry: string): boolean {
  const match = expiry.match(/^(\d{2})\/(\d{2})$/);
  if (!match) return false;
  const month = parseInt(match[1], 10);
  const year = parseInt(match[2], 10) + 2000;
  if (month < 1 || month > 12) return false;
  const now = new Date();
  const expiryDate = new Date(year, month, 1); // first day of month after expiry
  return expiryDate > now;
}

/* ---------- Form schema with custom refinements ---------- */
const paymentSchema = z
  .object({
    cardholderName: z.string().min(2, "Cardholder name required"),
    cardNumber: z.string().min(12, "Card number required").max(19),
    expiry: z.string().regex(/^\d{2}\/\d{2}$/, "Format: MM/YY"),
    cvc: z.string().min(3, "CVC required").max(4),
    billingZip: z.string().min(3, "Billing zip required"),
  })
  .refine((data) => luhnCheck(data.cardNumber), {
    message: "Invalid card number (Luhn check failed)",
    path: ["cardNumber"],
  })
  .refine((data) => isExpiryFuture(data.expiry), {
    message: "Card has expired",
    path: ["expiry"],
  });

type PaymentFormValues = z.infer<typeof paymentSchema>;

/* ---------- Helpers ---------- */
function fmtMoney(minor: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toFixed(0)}`;
  }
}

function maskCard(value: string): string {
  return value.replace(/\D/g, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim();
}

const BRAND_COLORS: Record<string, string> = {
  visa: "text-blue-700",
  mastercard: "text-orange-600",
  amex: "text-emerald-700",
};
const BRAND_LABELS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "Amex",
  unknown: "",
};

/* ---------- RequiresThreeDS placeholder ---------- */
function RequiresThreeDS({ onCancel }: { onCancel: () => void }) {
  return (
    <Card className="border-amber-200 bg-amber-50" data-testid="card-3ds-required">
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-center gap-2 text-amber-800 font-semibold text-sm">
          <ShieldCheck className="h-4 w-4" />
          3DS verification required
        </div>
        <p className="text-xs text-amber-700">
          Your bank requires additional authentication to complete this payment.
          Click the button below to open the verification window.
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            className="bg-amber-700 hover:bg-amber-800 text-white"
            onClick={() => {
              // In production: opens the 3DS iframe/redirect URL from the gateway.
              window.alert("3DS redirect simulation — in production this opens your bank's authentication page.");
            }}
            data-testid="button-open-3ds"
          >
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" />Open verification
          </Button>
          <Button size="sm" variant="outline" onClick={onCancel} data-testid="button-cancel-3ds">
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
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
  const [requires3ds, setRequires3ds] = useState(false);
  const [cardBrand, setCardBrand] = useState<ReturnType<typeof detectCardBrand>>("unknown");

  const { data: subData } = useQuery<{ ok: boolean; subscription: Subscription }>({
    queryKey: ["/api/founder/subscription", companyId],
    queryFn: async () => (await apiRequest("GET", `/api/founder/subscription?companyId=${companyId}`)).json(),
    retry: false,
  });

  const form = useForm<PaymentFormValues>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      cardholderName: "",
      cardNumber: "",
      expiry: "",
      cvc: "",
      billingZip: "",
    },
  });

  const chargeMut = useMutation({
    mutationFn: async (values: PaymentFormValues) => {
      // Patch v6 — Free plan flow: route to /activate-free which auto-creates
      // a company if needed (fresh signups don't have one yet) and activates
      // a Founder Free subscription without requiring a card.
      if (selectedPlan === "founder_free") {
        const res = await apiRequest("POST", "/api/founder/subscription/activate-free", {});
        return res.json();
      }
      const cardLast4 = values.cardNumber.replace(/\s/g, "").slice(-4);
      const res = await apiRequest("POST", "/api/founder/subscription/charge", {
        companyId,
        pricingModelId: selectedPlan === "founder_pro" ? "pm_founder_pro_v1"
          : selectedPlan === "founder_free" ? "pm_founder_free_v1"
          : selectedPlan,
        plan: selectedPlan,
        paymentMethod: {
          tokenized: `tok_${cardLast4}`,
          cardLast4,
          cardholderName: values.cardholderName,
          billingZip: values.billingZip,
        },
      });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.requires3ds) {
        setRequires3ds(true);
        toast({ title: "Verification required", description: "Your bank requires 3D Secure authentication.", variant: "destructive" });
        return;
      }
      if (data.ok) {
        queryClient.invalidateQueries({ queryKey: ["/api/founder/subscription"] });
        toast({ title: "Subscribed!", description: "Your subscription is now active." });
        // Record legal consent after successful subscription
        legalConsentRef.current?.recordConsent().catch(() => null);
        navigate("/founder/dashboard");
      } else {
        toast({ title: "Payment failed", description: data.error ?? "Please try again.", variant: "destructive" });
      }
    },
    onError: (e: Error) => toast({ title: "Payment failed", description: e.message, variant: "destructive" }),
  });

  const selectedPlanObj = PLANS.find(p => p.key === selectedPlan)!;
  const isFree = selectedPlan === "founder_free";
  const legalConsentRef = useRef<LegalConsentCheckboxRef>(null);
  const [legalChecked, setLegalChecked] = useState(false);

  return (
    <div className="min-h-screen bg-[hsl(210_20%_98%)] flex items-start justify-center py-12 px-4">
      <div className="w-full max-w-4xl">
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

                {requires3ds ? (
                  <RequiresThreeDS onCancel={() => setRequires3ds(false)} />
                ) : isFree ? (
                  <Button
                    className="w-full bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_17%)] text-white"
                    onClick={() => chargeMut.mutate({
                      cardholderName: "Free",
                      cardNumber: "4111111111111111", // valid Luhn Visa test card
                      expiry: "12/99",
                      cvc: "000",
                      billingZip: "00000",
                    })}
                    disabled={chargeMut.isPending}
                    data-testid="button-activate-free"
                  >
                    Activate free plan
                  </Button>
                ) : (
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(
                      (v) => chargeMut.mutate(v),
                      (errors) => {
                        const first = Object.values(errors)[0];
                        if (first?.message) {
                          toast({ title: "Validation error", description: String(first.message), variant: "destructive" });
                        }
                      }
                    )} className="space-y-3">
                      <FormField control={form.control} name="cardholderName" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Cardholder name</FormLabel>
                          <FormControl>
                            <Input placeholder="Name on card" {...field} data-testid="input-cardholder-name" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="cardNumber" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">
                            Card number
                            {cardBrand !== "unknown" && (
                              <span className={`ml-2 text-[10px] font-semibold ${BRAND_COLORS[cardBrand] ?? ""}`}>
                                {BRAND_LABELS[cardBrand]}
                              </span>
                            )}
                          </FormLabel>
                          <FormControl>
                            <Input
                              placeholder="4242 4242 4242 4242"
                              {...field}
                              value={maskCard(field.value)}
                              onChange={e => {
                                const raw = e.target.value.replace(/\s/g, "");
                                field.onChange(raw);
                                setCardBrand(detectCardBrand(raw));
                              }}
                              data-testid="input-card-number"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <div className="grid grid-cols-2 gap-2">
                        <FormField control={form.control} name="expiry" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Expiry</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="MM/YY"
                                maxLength={5}
                                {...field}
                                onChange={e => {
                                  const v = e.target.value.replace(/\D/g, "");
                                  field.onChange(v.length > 2 ? `${v.slice(0, 2)}/${v.slice(2, 4)}` : v);
                                }}
                                data-testid="input-expiry"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name="cvc" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">CVC</FormLabel>
                            <FormControl>
                              <Input placeholder="•••" maxLength={4} type="password" {...field} data-testid="input-cvc" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                      <FormField control={form.control} name="billingZip" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Billing zip / postal code</FormLabel>
                          <FormControl>
                            <Input placeholder="94105" {...field} data-testid="input-billing-zip" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <LegalConsentCheckbox
                        ref={legalConsentRef}
                        docs={["terms", "privacy"]}
                        context="new_company"
                        required
                        onCheckedChange={setLegalChecked}
                      />
                      <Button
                        type="submit"
                        className="w-full bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_17%)] text-white"
                        disabled={chargeMut.isPending || !legalChecked}
                        data-testid="button-subscribe"
                      >
                        {chargeMut.isPending ? "Processing…" : `Subscribe — ${fmtMoney(selectedPlanObj.annualMinor, selectedPlanObj.currency)}/yr`}
                      </Button>
                    </form>
                  </Form>
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
