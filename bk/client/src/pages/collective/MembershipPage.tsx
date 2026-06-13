/**
 * v18 Phase B — Capavate Collective: Membership tier subscription page.
 *
 * Responsibilities:
 *   - Render the three-tier pricing catalog (basic / standard / premium)
 *   - "Subscribe" button \u2192 POST /checkout, redirect to Stripe Checkout
 *   - "Manage subscription" button (when user has an active membership)
 *     \u2192 POST /portal, redirect to the Stripe Customer Portal
 *   - Disabled "Contact admin" state for tiers whose price id env var is
 *     unset (server reports `available: false` per tier)
 *   - Hidden when COLLECTIVE_ENABLED feature flag is off
 *
 * No mock data, no TODOs, no stubs \u2014 every action hits a real endpoint.
 */

import { useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useCollectiveStream } from "@/lib/sseClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, AlertCircle, ExternalLink } from "lucide-react";
/* v25.12 NH1 + NH2 — toast errors on checkout / portal failures. */
import { useToast } from "@/hooks/use-toast";

// ----- Types --------------------------------------------------------------

interface FeatureFlagsResponse {
  COLLECTIVE_ENABLED?: boolean;
}

interface TierDTO {
  tier: "basic" | "standard" | "premium";
  label: string;
  blurb: string;
  entitlements: string[];
  membershipRole: "member" | "dsc_member" | "chapter_admin";
  available: boolean;
  priceId: string | null;
  unitAmount: number | null;
  currency: string | null;
  interval: string | null;
  nickname: string | null;
}

interface TiersResponse {
  ok: boolean;
  stripeConfigured: boolean;
  tiers: TierDTO[];
}

interface BillingDTO {
  id: string;
  tier: "basic" | "standard" | "premium";
  status: "pending" | "active" | "past_due" | "cancelled" | "expired";
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
}

interface MeResponse {
  ok: boolean;
  chapterId: string;
  membership: BillingDTO | null;
}

interface MeChaptersResponse {
  chapters: Array<{ id: string; name?: string; role?: string }>;
}

// ----- Helpers ------------------------------------------------------------

function formatMoney(unitAmount: number | null, currency: string | null): string {
  if (unitAmount === null || currency === null) return "\u2014";
  const dollars = unitAmount / 100;
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

function statusBadgeVariant(
  status: BillingDTO["status"],
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "active":
      return "default";
    case "pending":
      return "secondary";
    case "past_due":
      return "destructive";
    case "cancelled":
    case "expired":
      return "outline";
  }
}

// ----- Component ----------------------------------------------------------

export default function MembershipPage(): JSX.Element | null {
  const qc = useQueryClient();

  // 1) Feature flag \u2014 hide entirely when COLLECTIVE_ENABLED is off.
  const flagsQ = useQuery<FeatureFlagsResponse>({
    queryKey: ["/api/feature-flags"],
    queryFn: async () => (await apiRequest("GET", "/api/feature-flags")).json(),
  });
  const collectiveOn = flagsQ.data?.COLLECTIVE_ENABLED === true;

  // 2) Active chapter \u2014 default to the user's first chapter.
  const meChaptersQ = useQuery<MeChaptersResponse>({
    queryKey: ["/api/me/chapters"],
    queryFn: async () => (await apiRequest("GET", "/api/me/chapters")).json(),
    enabled: collectiveOn,
  });
  const activeChapterId = useMemo(() => {
    return meChaptersQ.data?.chapters?.[0]?.id ?? "chap_keiretsu_canada";
  }, [meChaptersQ.data]);

  // 3) Tier catalog (5-minute server cache; refetch on focus).
  const tiersQ = useQuery<TiersResponse>({
    queryKey: ["/api/collective/membership/tiers"],
    queryFn: async () =>
      (await apiRequest("GET", "/api/collective/membership/tiers")).json(),
    enabled: collectiveOn,
  });

  // 4) Current membership for the active chapter.
  const meQ = useQuery<MeResponse>({
    queryKey: ["/api/collective/membership/me", activeChapterId],
    queryFn: async () =>
      (
        await apiRequest(
          "GET",
          `/api/collective/membership/me?chapter_id=${encodeURIComponent(activeChapterId)}`,
        )
      ).json(),
    enabled: collectiveOn && !!activeChapterId,
  });

  // v18 Phase D — SSE realtime: invalidate `me` membership query on every
  // `billing` topic frame for this chapter. Polling refetch is the background
  // fallback when SSE never connects.
  useCollectiveStream({
    chapterId: activeChapterId,
    topics: ["billing"],
    enabled: collectiveOn && !!activeChapterId,
    onMessage: () => {
      qc.invalidateQueries({
        queryKey: ["/api/collective/membership/me", activeChapterId],
      });
    },
  });

  // 5) Checkout mutation \u2014 POST and follow checkout_url.
  // v25.6: response shape is now Airwallex-shaped. The legacy `checkout_url`
  // field is preserved for back-compat, but new payments return
  // `hostedPaymentPageUrl` (Airwallex hosted page). 3DS challenge: the hosted
  // page handles 3DS itself (Airwallex SCA flow) and redirects back here on
  // success/failure. PCI scope stays out of Capavate because card data never
  // touches our origin.
  /* v25.12 NH1 + NH2 — toast helper. */
  const { toast } = useToast();

  /* v25.22 NC-7 fix — on the success redirect from Airwallex's hosted
   * payment page, synchronously verify the intent so the user is activated
   * even if the webhook never lands. Without this the user pays but stays
   * in `pending` until webhook arrival (which may take minutes, or fail
   * entirely). The new `/api/collective/membership/verify` endpoint
   * verifies the intent against Airwallex AND drives the billing state
   * machine. We strip the query params on success so a refresh doesn't
   * re-trigger. Ref guard prevents double-fire under React StrictMode. */
  const verifyMut = useMutation({
    mutationFn: async (intentId: string): Promise<{ ok: boolean; idempotent?: boolean }> => {
      const resp = await apiRequest("POST", "/api/collective/membership/verify", {
        intent_id: intentId,
      });
      return resp.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/collective/membership/me"] });
      toast({ title: "Membership activated", description: "You're in. Welcome." });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Activation pending", description: e.message }),
  });
  const didVerifyRef = useRef(false);
  useEffect(() => {
    if (didVerifyRef.current) return;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const status = params.get("status");
    const intentId = params.get("intent_id");
    if (status === "success" && intentId && intentId !== "{PAYMENT_INTENT_ID}") {
      didVerifyRef.current = true;
      verifyMut.mutate(intentId);
      // Strip query params so a refresh doesn't re-trigger.
      const url = new URL(window.location.href);
      url.searchParams.delete("status");
      url.searchParams.delete("intent_id");
      window.history.replaceState({}, "", url.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkoutMut = useMutation({
    mutationFn: async (tier: TierDTO["tier"]): Promise<{
      checkout_url?: string | null;
      hostedPaymentPageUrl?: string | null;
      paymentIntentId?: string;
      clientSecret?: string;
      gateway?: string;
    }> => {
      const resp = await apiRequest("POST", "/api/collective/membership/checkout", {
        tier,
        chapter_id: activeChapterId,
        /* v25.22 NC-7 fix — ask Airwallex to include the intent_id on the
         * success redirect so the client can call the new
         * /api/collective/membership/verify endpoint to drive activation
         * synchronously rather than waiting for the webhook. */
        success_url:
          typeof window !== "undefined"
            ? `${window.location.origin}/collective/membership?status=success&intent_id={PAYMENT_INTENT_ID}`
            : undefined,
        cancel_url:
          typeof window !== "undefined"
            ? `${window.location.origin}/collective/membership?status=cancelled`
            : undefined,
      });
      return resp.json();
    },
    onSuccess: (data) => {
      // v25.6: prefer Airwallex `hostedPaymentPageUrl`; fall back to legacy
      // `checkout_url`. The hosted page handles 3DS internally.
      const targetUrl = data.hostedPaymentPageUrl ?? data.checkout_url;
      if (targetUrl && typeof window !== "undefined") {
        window.location.href = targetUrl;
      }
    },
    /* v25.12 NH1 — surface checkout errors so user knows what to retry. */
    onError: (e: Error) => toast({ variant: "destructive", title: "Checkout failed", description: e.message }),
  });

  // 6) Portal mutation \u2014 POST and follow portal_url.
  const portalMut = useMutation({
    mutationFn: async (): Promise<{ portal_url?: string }> => {
      const resp = await apiRequest("POST", "/api/collective/membership/portal", {
        chapter_id: activeChapterId,
        return_url:
          typeof window !== "undefined"
            ? `${window.location.origin}/collective/membership`
            : undefined,
      });
      return resp.json();
    },
    onSuccess: (data) => {
      if (data.portal_url && typeof window !== "undefined") {
        window.location.href = data.portal_url;
      }
    },
    /* v25.12 NH2 — surface portal errors. */
    onError: (e: Error) => toast({ variant: "destructive", title: "Could not open billing portal", description: e.message }),
  });

  if (!collectiveOn) return null;

  const current = meQ.data?.membership ?? null;
  const hasActive =
    current !== null &&
    (current.status === "active" || current.status === "past_due");

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl" data-testid="collective-membership-page">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Collective Membership</h1>
        <p className="text-muted-foreground">
          Choose your tier. Memberships are billed annually and renew
          automatically until you cancel.
        </p>
      </div>

      {current && (
        <Card className="mb-8" data-testid="current-membership-card">
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="flex items-center gap-3 text-lg">
                Your current membership
                <Badge variant={statusBadgeVariant(current.status)}>
                  {current.status}
                </Badge>
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground capitalize">
                {current.tier} tier
                {current.cancelAtPeriodEnd && (
                  <span className="ml-2 text-amber-600">
                    \u2014 cancels at period end
                  </span>
                )}
              </p>
            </div>
            {hasActive && (
              <Button
                variant="outline"
                onClick={() => portalMut.mutate()}
                disabled={portalMut.isPending}
                data-testid="manage-subscription-btn"
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                {portalMut.isPending ? "Opening\u2026" : "Manage subscription"}
              </Button>
            )}
          </CardHeader>
        </Card>
      )}

      {tiersQ.isLoading ? (
        <div className="grid gap-6 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-80 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-3">
          {(tiersQ.data?.tiers ?? []).map((t) => {
            const isCurrent = current?.tier === t.tier && current.status === "active";
            return (
              <Card
                key={t.tier}
                className={isCurrent ? "border-primary" : ""}
                data-testid={`tier-card-${t.tier}`}
              >
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>{t.label}</span>
                    {isCurrent && <Badge>Current</Badge>}
                  </CardTitle>
                  <p className="text-2xl font-bold">
                    {formatMoney(t.unitAmount, t.currency)}
                    <span className="text-sm font-normal text-muted-foreground">
                      {" "}
                      / {t.interval ?? "year"}
                    </span>
                  </p>
                  <p className="text-sm text-muted-foreground">{t.blurb}</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ul className="space-y-2 text-sm">
                    {t.entitlements.map((e) => (
                      <li key={e} className="flex items-start gap-2">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-600 shrink-0" />
                        <span>{e}</span>
                      </li>
                    ))}
                  </ul>
                  {t.available ? (
                    <Button
                      className="w-full"
                      onClick={() => checkoutMut.mutate(t.tier)}
                      disabled={
                        checkoutMut.isPending ||
                        (isCurrent && !current?.cancelAtPeriodEnd)
                      }
                      data-testid={`subscribe-btn-${t.tier}`}
                    >
                      {checkoutMut.isPending
                        ? "Redirecting\u2026"
                        : isCurrent
                          ? "Subscribed"
                          : "Subscribe"}
                    </Button>
                  ) : (
                    <Button
                      className="w-full"
                      variant="outline"
                      disabled
                      data-testid={`unavailable-btn-${t.tier}`}
                    >
                      <AlertCircle className="mr-2 h-4 w-4" />
                      Contact admin
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {tiersQ.data && !tiersQ.data.stripeConfigured && (
        <p className="mt-6 text-sm text-muted-foreground">
          Stripe is not configured in this environment. Membership purchases
          are temporarily disabled \u2014 reach out to your chapter admin to
          arrange access.
        </p>
      )}
    </div>
  );
}
