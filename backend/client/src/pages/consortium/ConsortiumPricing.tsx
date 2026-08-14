/**
 * v25.47 APD-020 — Consortium Partner pricing (PUBLIC, no auth).
 *
 * Renders the Consortium Partner tier taxonomy DB-driven from the public
 * GET /api/consortium/pricing endpoint.
 *
 * WAVE 46 / OWNER RULING R21, verbatim: "This should be 100% dynamic. Nothing
 * static or hard coded." This page renders WHATEVER THE DATABASE HOLDS:
 *   • the number of cards is `tiers.length` — five today, not five by contract;
 *   • every amount, currency and billing period is printed from the row;
 *   • archiving a tier removes its card, freezing one marks it not purchasable,
 *     adding one adds a card — all with NO CODE CHANGE;
 *   • an empty list renders an EXPLICIT REFUSAL (R6), never a blank grid.
 *
 * WHAT WAS REMOVED HERE (money literal on a price surface):
 *
 *     {t.inviteOnly && t.amountMinor === 0 ? "By invitation" : formatMoney(…)}
 *
 * A compiled-in `0` decided which WORDS a customer saw in place of a price. It
 * was also wrong in both directions: an invite-only tier that IS priced showed
 * its price with no invitation notice, and a genuinely free public tier would
 * have shown "$0 / year" while a genuinely free invite-only tier showed prose.
 * Invite-only is now communicated by the DB-driven `inviteOnly` badge alone, and
 * the amount is ALWAYS the amount in the row — including a real `0`, which R6
 * says renders as zero and means it. An unpriced tier never reaches this page:
 * `resolveConsortiumPricing` omits it rather than inventing an amount.
 */
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Lock } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { minorToMajorString } from "@/lib/moneyDisplay";

interface PricingTier {
  slug: string;
  label: string;
  amountMinor: number;
  currency: string;
  billingPeriod: string;
  inviteOnly: boolean;
  fromDb: boolean;
  /** DB lifecycle: 'active' | 'frozen' | 'archived'. Archived rows never ship. */
  lifecycleState?: string;
}

interface PricingResponse {
  tiers: PricingTier[];
  /** R6 — set by the server when NO priced row resolves. */
  unpriced?: boolean;
  message?: string;
}

function formatMoneyMinor(amountMinor: number, currency: string): string {
  /* WAVE 21 ITEM 5: hardcoded /100; the currency was already in scope. */
  const dollars = Number(minorToMajorString(amountMinor, currency));
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      maximumFractionDigits: 0,
    }).format(dollars);
  } catch {
    return `$${dollars.toFixed(0)} ${currency.toUpperCase()}`;
  }
}

function periodLabel(billingPeriod: string): string {
  switch (billingPeriod) {
    case "monthly":
      return "month";
    case "yearly":
    case "annual":
      return "year";
    default:
      return billingPeriod || "month";
  }
}

export default function ConsortiumPricing() {
  const { data, isLoading, error } = useQuery<PricingResponse>({
    queryKey: ["/api/consortium/pricing"],
    queryFn: async () => (await apiRequest("GET", "/api/consortium/pricing")).json(),
    retry: false,
  });

  const tiers = data?.tiers ?? [];

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <PageHeader
        title="Consortium Partner Pricing"
        subtitle="Become a Capavate Consortium Partner. Choose the tier that fits your network — pricing is published live from our platform."
      />
      <div className="mt-8">
        {isLoading ? (
          <p className="text-sm text-muted-foreground" data-testid="consortium-pricing-loading">
            Loading pricing…
          </p>
        ) : error ? (
          <p className="text-sm text-rose-600" data-testid="consortium-pricing-error">
            Could not load pricing. Please retry.
          </p>
        ) : (
          <div className="grid gap-6 md:grid-cols-3 lg:grid-cols-5" data-testid="consortium-pricing-grid">
            {tiers.map((t) => (
              <Card key={t.slug} data-testid={`pricing-card-${t.slug}`} className="flex flex-col">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between text-lg">
                    <span>{t.label}</span>
                    {t.inviteOnly && (
                      <Badge variant="secondary" className="gap-1">
                        <Lock className="h-3 w-3" /> Invite only
                      </Badge>
                    )}
                    {t.lifecycleState === "frozen" && (
                      <Badge variant="outline" data-testid={`pricing-frozen-${t.slug}`}>
                        Not currently purchasable
                      </Badge>
                    )}
                  </CardTitle>
                  <p className="text-2xl font-bold" data-testid={`pricing-amount-${t.slug}`}>
                    {formatMoneyMinor(t.amountMinor, t.currency)}
                    <span className="text-sm font-normal text-muted-foreground">
                      {" "}
                      / {periodLabel(t.billingPeriod)}
                    </span>
                  </p>
                </CardHeader>
                <CardContent className="mt-auto">
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-600 shrink-0" />
                      <span>Consortium partner workspace</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-600 shrink-0" />
                      <span>Deal attribution &amp; revenue share</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-600 shrink-0" />
                      <span>Member directory presence</span>
                    </li>
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        {!isLoading && !error && tiers.length === 0 && (
          <div
            className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
            data-testid="consortium-pricing-unpriced"
          >
            <p className="font-semibold">Pricing is not currently published.</p>
            <p className="mt-1">
              {data?.message ??
                "No partner tier pricing resolves from the database. Pricing is served live from our platform and there is no fallback price list, so nothing is advertised until a tier is priced."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
