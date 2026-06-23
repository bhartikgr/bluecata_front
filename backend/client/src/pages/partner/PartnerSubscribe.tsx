/* v25.33 Consortium Partner Payment Model — DB-driven, no in-memory.
 * /collective/partner/subscribe — partner subscription checkout entry point.
 * Resolves the partner-subscription fee from the DB-driven fee catalogue via
 * POST /api/partner/me/subscribe (server runs resolvePartnerFee — no hardcoded
 * price) and shows the resolved amount/currency. The actual charge is completed
 * by the existing billing plan flow (checkoutPath returned by the server); no
 * bespoke payment logic is added here. Current subscription state is read from
 * GET /api/partner/me/subscription. apiRequest throws ApiError on non-2xx.
 */
import { useState } from "react";
import { formatMinor as formatMinorLib } from "@/lib/currency"; /* v25.38 currency sweep */
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { PartnerShell } from "@/components/partner/PartnerShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

type Subscription = {
  id: string;
  tierId: string;
  status: string;
  amountMinor: number;
  currency: string;
  billingCycle: string;
  currentPeriodEnd: string | null;
} | null;

type SubscriptionResponse = { subscription: Subscription; agreement: { version: string; url: string | null } };

type QuoteResponse = {
  ok: boolean;
  tier: string;
  cycle: string;
  amountMinor: number;
  currency: string;
  computedVia: string;
  checkoutPath: string;
};

function formatMinor(minor: number, ccy = "USD") {
  // v25.38 — delegate to shared ISO-4217-aware formatter (2-decimal parity).
  return formatMinorLib(minor, ccy, { locale: "en-US" });
}
function formatDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function PartnerSubscribe() {
  const role = useRequirePartnerRole();
  const { toast } = useToast();
  const [cycle, setCycle] = useState<"monthly" | "annual">("monthly");
  const [quote, setQuote] = useState<QuoteResponse | null>(null);

  const { data, isLoading, isError, error } = useQuery<SubscriptionResponse>({
    queryKey: ["/api/partner/me/subscription"],
    enabled: role.ready && !!role.identity,
    retry: false,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/subscription")).json(),
  });

  const quoteMut = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/partner/me/subscribe", { cycle });
      return (await r.json()) as QuoteResponse;
    },
    onSuccess: (j) => {
      if (!j.ok) throw new Error("quote_failed");
      setQuote(j);
    },
    onError: (e: any) => {
      // 409 → no schedule configured for this tier; surface a friendly note.
      const msg = e instanceof ApiError && e.status === 409
        ? "No partner subscription plan is configured for your tier yet."
        : e?.message || "Could not fetch a subscription quote.";
      toast({ title: "Subscription unavailable", description: msg, variant: "destructive" });
    },
  });

  if (!role.ready || !role.identity) return null;
  const me = role.identity;
  const isForbidden = isError && error instanceof ApiError && error.status === 403;
  const sub = data?.subscription ?? null;

  return (
    <PartnerShell title="Subscription" tier={me.tier} subRole={me.subRole} partnerName={me.identity.name}>
      {isForbidden && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" data-testid="partner-subscribe-forbidden">
          Subscription management is available to managing partners only.
        </div>
      )}

      {!isForbidden && (
        <>
          {isLoading && <div className="text-sm text-slate-500" data-testid="partner-subscribe-loading">Loading…</div>}

          {!isLoading && sub && (
            <Card className="p-6 max-w-xl mb-4" data-testid="partner-subscribe-current">
              <div className="text-xs uppercase tracking-wide text-slate-500">Active subscription</div>
              <div className="mt-1 text-lg font-semibold text-[#041e41]">{sub.tierId}</div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <dt className="text-slate-500">Amount</dt>
                <dd className="font-mono">{formatMinor(sub.amountMinor, sub.currency)} / {sub.billingCycle}</dd>
                <dt className="text-slate-500">Status</dt>
                <dd>{sub.status}</dd>
                <dt className="text-slate-500">Renews</dt>
                <dd>{formatDate(sub.currentPeriodEnd)}</dd>
              </dl>
            </Card>
          )}

          {!isLoading && !sub && (
            <Card className="p-6 max-w-xl" data-testid="partner-subscribe-checkout">
              <p className="text-sm text-slate-700 mb-4">
                Consortium partners on a subscription plan unlock the full partner workspace. Choose a billing
                cycle to see your tier-resolved price (set by the admin fee catalogue — never hardcoded).
              </p>
              <div className="flex gap-2 mb-4">
                <Button
                  variant={cycle === "monthly" ? "default" : "outline"}
                  onClick={() => { setCycle("monthly"); setQuote(null); }}
                  data-testid="button-cycle-monthly"
                >
                  Monthly
                </Button>
                <Button
                  variant={cycle === "annual" ? "default" : "outline"}
                  onClick={() => { setCycle("annual"); setQuote(null); }}
                  data-testid="button-cycle-annual"
                >
                  Annual
                </Button>
              </div>

              <Button
                onClick={() => quoteMut.mutate()}
                disabled={quoteMut.isPending}
                data-testid="button-get-quote"
              >
                Get {cycle} price
              </Button>

              {quote && (
                <div className="mt-4 rounded-md border border-[#041e41]/20 bg-slate-50 p-4" data-testid="partner-subscribe-quote">
                  <div className="text-2xl font-semibold text-[#041e41]">
                    {formatMinor(quote.amountMinor, quote.currency)}
                    <span className="text-sm font-normal text-slate-500"> / {quote.cycle}</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-1">Resolved via {quote.computedVia}.</div>
                  {quote.amountMinor === 0 ? (
                    <p className="mt-2 text-sm text-slate-600">
                      Your tier currently has a $0 subscription — there is nothing to pay.
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-slate-600">
                      Complete checkout through the standard billing flow to activate your subscription.
                    </p>
                  )}
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </PartnerShell>
  );
}
