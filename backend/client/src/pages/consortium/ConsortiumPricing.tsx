/**
 * v25.47 APD-020 — Consortium Partner pricing (PUBLIC, no auth).
 *
 * Renders the canonical 5-tier Consortium Partner taxonomy
 * (catalyst / builder / amplifier / nexus / founding_member) DB-driven from the
 * public GET /api/consortium/pricing endpoint. founding_member is invite-only.
 * Nothing is hardcoded — prices come straight from the resolved tier list.
 */
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Lock } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface PricingTier {
  slug: string;
  label: string;
  amountMinor: number;
  currency: string;
  billingPeriod: string;
  inviteOnly: boolean;
  fromDb: boolean;
}

interface PricingResponse {
  tiers: PricingTier[];
}

function formatMoneyMinor(amountMinor: number, currency: string): string {
  const dollars = amountMinor / 100;
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
                  </CardTitle>
                  <p className="text-2xl font-bold">
                    {t.inviteOnly && t.amountMinor === 0
                      ? "By invitation"
                      : formatMoneyMinor(t.amountMinor, t.currency)}
                    {!(t.inviteOnly && t.amountMinor === 0) && (
                      <span className="text-sm font-normal text-muted-foreground">
                        {" "}
                        / {periodLabel(t.billingPeriod)}
                      </span>
                    )}
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
      </div>
    </div>
  );
}
