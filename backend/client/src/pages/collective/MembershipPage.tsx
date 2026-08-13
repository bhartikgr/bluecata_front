/**
 * v25.47 APD-019 / APD-032(B) — Collective Membership page.
 * W4 — dynamic admin catalog support.
 *
 * This page now consumes GET /api/collective/membership/tiers. When an admin has
 * published one or more subscription packages the response carries source:"admin"
 * and the page renders the dynamic package cards, posting `package_id` to
 * POST /api/collective/membership/checkout. When no admin package is live the
 * response carries source:"env_fallback" and the page renders the SINGLE canonical
 * tier card whose price is read DB-direct from GET /api/collective/member-tier
 * (never hardcoded), posting the legacy `tier:"standard"`. The Airwallex checkout
 * mechanics are UNCHANGED in both cases (server resolves either shape to the same
 * createCollectiveIntent path).
 *
 * Preserved data-testids (relied on by e2e + Avi alignment):
 *   collective-membership-page, current-membership-card,
 *   manage-subscription-btn, tier-card-standard, subscribe-btn-standard.
 *
 * No mock data, no TODOs, no stubs — every action hits a real endpoint.
 */

import { useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useCollectiveStream } from "@/lib/sseClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
/* WAVE 17 ORP-039 — member-facing fees, charges and invoices. */
import { MemberBillingPanel } from "@/components/collective/MemberBillingPanel";
import { minorToMajorString } from "@/lib/moneyDisplay";
/* WAVE 24 · ITEM 3a — a failed price fetch must not render a buyable card. */
import { LoadFailedRefusal } from "@/components/LoadFailedRefusal";

// ----- Types --------------------------------------------------------------

interface FeatureFlagsResponse {
  COLLECTIVE_ENABLED?: boolean;
}

/** Shape of GET /api/collective/member-tier (resolveCanonicalMemberTier). */
interface MemberTierDTO {
  slug: string;
  key: string;
  amountMinor: number;
  currency: string;
  billingPeriod: string;
  fromDb: boolean;
}

interface BillingDTO {
  id: string;
  tier: string;
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

interface MembershipDetailDTO {
  id: string | null;
  tier: string | null;
  priceId: string | null;
  status: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  paymentDate: string | null;
  cancelAtPeriodEnd: boolean;
}

interface MembershipDetailResponse {
  ok: boolean;
  membership: MembershipDetailDTO | null;
}

interface MeChaptersResponse {
  chapters: Array<{ id: string; name?: string; role?: string }>;
}

// ----- Helpers ------------------------------------------------------------

function formatMoneyMinor(amountMinor: number | null, currency: string | null): string {
  if (amountMinor === null || currency === null) return "—";
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

function formatIsoDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

function periodLabel(billingPeriod: string | undefined): string {
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
    default:
      return "outline";
  }
}

const MEMBER_ENTITLEMENTS = [
  "Full Collective member access",
  "Deal flow, soft circles, and screening events",
  "Member directory and connections",
  "Monthly meetings and recaps",
];

// ----- Component ----------------------------------------------------------

export default function MembershipPage(): JSX.Element | null {
  const qc = useQueryClient();
  const { toast } = useToast();

  // 1) Feature flag — hide entirely when COLLECTIVE_ENABLED is off.
  const flagsQ = useQuery<FeatureFlagsResponse>({
    queryKey: ["/api/feature-flags"],
    queryFn: async () => (await apiRequest("GET", "/api/feature-flags")).json(),
  });
  const collectiveOn = flagsQ.data?.COLLECTIVE_ENABLED === true;

  // 2) Active chapter — default to the user's first chapter.
  const meChaptersQ = useQuery<MeChaptersResponse>({
    queryKey: ["/api/me/chapters"],
    queryFn: async () => (await apiRequest("GET", "/api/me/chapters")).json(),
    enabled: collectiveOn,
  });
  const activeChapterId = useMemo(() => {
    return meChaptersQ.data?.chapters?.[0]?.id ?? "chap_keiretsu_canada";
  }, [meChaptersQ.data]);

  // 3) The single canonical member tier (DB-direct price). Kept as the compat
  //    fallback source when no live admin package exists.
  const tierQ = useQuery<MemberTierDTO>({
    queryKey: ["/api/collective/member-tier"],
    queryFn: async () => (await apiRequest("GET", "/api/collective/member-tier")).json(),
    enabled: collectiveOn,
  });

  // 3b) W4 — dynamic admin catalog. When source === "admin", the member page
  //     renders the admin-authored packages and checkout posts `package_id`.
  //     When source === "env_fallback", the single canonical tier above is used.
  const catalogQ = useQuery<{ ok: boolean; source: "admin" | "env_fallback"; tiers: Array<{ packageId?: string; slug: string; label: string; description?: string; unitAmount: number | null; currency: string | null; interval: string | null; available: boolean }> }>({
    queryKey: ["/api/collective/membership/tiers"],
    queryFn: async () => (await apiRequest("GET", "/api/collective/membership/tiers")).json(),
    enabled: collectiveOn,
  });
  const adminCatalog = catalogQ.data?.source === "admin" ? (catalogQ.data.tiers ?? []) : [];
  const useAdminCatalog = adminCatalog.length > 0;

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

  // 4b) Enriched billing detail (payment date / period bounds).
  const detailQ = useQuery<MembershipDetailResponse>({
    queryKey: ["/api/collective/membership/detail", activeChapterId],
    queryFn: async () =>
      (
        await apiRequest(
          "GET",
          `/api/collective/membership/detail?chapter_id=${encodeURIComponent(activeChapterId)}`,
        )
      ).json(),
    enabled: collectiveOn && !!activeChapterId,
  });

  useCollectiveStream({
    chapterId: activeChapterId,
    topics: ["billing"],
    enabled: collectiveOn && !!activeChapterId,
    onMessage: () => {
      qc.invalidateQueries({ queryKey: ["/api/collective/membership/me", activeChapterId] });
      qc.invalidateQueries({ queryKey: ["/api/collective/membership/detail", activeChapterId] });
    },
  });

  // 5) On the success redirect from Airwallex's hosted payment page, verify the
  // intent synchronously so the user activates even if the webhook never lands.
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
    onError: (e: Error) =>
      toast({ variant: "destructive", title: "Activation pending", description: e.message }),
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
      const url = new URL(window.location.href);
      url.searchParams.delete("status");
      url.searchParams.delete("intent_id");
      window.history.replaceState({}, "", url.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 6) Checkout mutation — POST and follow the hosted payment page URL.
  //    W4: when a live admin catalog is active, post `package_id`; otherwise
  //    post the legacy `tier: "standard"`. The server resolves either to the
  //    SAME unchanged Airwallex createCollectiveIntent path.
  const checkoutMut = useMutation({
    mutationFn: async (pkgId?: string): Promise<{
      checkout_url?: string | null;
      hostedPaymentPageUrl?: string | null;
    }> => {
      const chosen = pkgId ?? adminCatalog.find((t) => t.available && t.packageId)?.packageId;
      const resp = await apiRequest("POST", "/api/collective/membership/checkout", {
        ...(useAdminCatalog && chosen ? { package_id: chosen } : { tier: "standard" }),
        chapter_id: activeChapterId,
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
      const targetUrl = data.hostedPaymentPageUrl ?? data.checkout_url;
      if (targetUrl && typeof window !== "undefined") {
        window.location.href = targetUrl;
      }
    },
    onError: (e: Error) =>
      toast({ variant: "destructive", title: "Checkout failed", description: e.message }),
  });

  // 7) Portal mutation — POST and follow portal_url.
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
    onError: (e: Error) =>
      toast({ variant: "destructive", title: "Could not open billing portal", description: e.message }),
  });

  if (!collectiveOn) return null;

  const current = meQ.data?.membership ?? null;
  const hasActive =
    current !== null && (current.status === "active" || current.status === "past_due");
  const detail = detailQ.data?.membership ?? null;
  const tier = tierQ.data ?? null;
  const isCurrent = hasActive && current?.status === "active";

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl" data-testid="collective-membership-page">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Collective Membership</h1>
        <p className="text-muted-foreground">
          One membership, billed monthly and renewing automatically until you cancel.
        </p>
      </div>

      {current && (
        <Card className="mb-8" data-testid="current-membership-card">
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="flex items-center gap-3 text-lg">
                Your current membership
                <Badge variant={statusBadgeVariant(current.status)}>{current.status}</Badge>
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground capitalize">
                Collective membership
                {current.cancelAtPeriodEnd && (
                  <span className="ml-2 text-amber-600">— cancels at period end</span>
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
                {portalMut.isPending ? "Opening…" : "Manage subscription"}
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <dl
              className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3"
              data-testid="membership-billing-detail"
            >
              <div>
                <dt className="text-muted-foreground">Amount</dt>
                <dd className="font-medium" data-testid="membership-amount">
                  {tier
                    ? `${formatMoneyMinor(tier.amountMinor, tier.currency)} / ${periodLabel(tier.billingPeriod)}`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Plan</dt>
                <dd className="font-medium capitalize" data-testid="membership-plan">
                  Collective membership
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Status</dt>
                <dd className="font-medium capitalize" data-testid="membership-status">
                  {current.status}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Payment date</dt>
                <dd className="font-medium" data-testid="membership-payment-date">
                  {formatIsoDate(detail?.paymentDate ?? null)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {current.cancelAtPeriodEnd ? "Expires" : "Renews / valid until"}
                </dt>
                <dd className="font-medium" data-testid="membership-expiry">
                  {formatIsoDate(detail?.currentPeriodEnd ?? null)}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      )}

      {/* W4 — dynamic admin catalog (rendered only when a live admin package exists). */}
      {useAdminCatalog && (
        <div className="grid gap-4 md:grid-cols-3" data-testid="dynamic-catalog">
          {adminCatalog.map((p) => (
            <Card key={p.packageId ?? p.slug} data-testid={`package-card-${p.slug}`}>
              <CardHeader>
                <CardTitle>{p.label}</CardTitle>
                <p className="text-2xl font-bold">
                  {formatMoneyMinor(p.unitAmount, p.currency)}
                  <span className="text-sm font-normal text-muted-foreground"> / {periodLabel(p.interval ?? undefined)}</span>
                </p>
                {p.description && <p className="text-sm text-muted-foreground">{p.description}</p>}
              </CardHeader>
              <CardContent className="space-y-4">
                <Button
                  className="w-full"
                  onClick={() => checkoutMut.mutate(p.packageId)}
                  /* WAVE 24 · ITEM 3a, second path. Same defect one branch over:
                     an admin package whose `unitAmount`/`currency` is null also
                     renders "—" through `formatMoneyMinor`, and its Subscribe
                     button was live. A package with no stated price cannot be
                     bought. */
                  disabled={
                    checkoutMut.isPending ||
                    !p.available ||
                    !p.packageId ||
                    p.unitAmount === null ||
                    p.currency === null
                  }
                  data-testid={`subscribe-btn-${p.slug}`}
                >
                  {checkoutMut.isPending
                    ? "Redirecting…"
                    : p.unitAmount === null || p.currency === null
                      ? "Price unavailable"
                      : p.available
                        ? "Subscribe"
                        : "Unavailable"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* WAVE 24 · ITEM 3a (FINAL REVIEW B, E-1). This block had NO `isError`
          branch. When the price fetch failed, `formatMoneyMinor(null, null)`
          returned "—" and the card rendered anyway with a LIVE Subscribe
          button: a user could start a recurring charge against a price the
          page could not state. A price that failed to load is not a price.
          Gated on `isSuccess` and not on `!isLoading && !isError`, because a
          PAUSED query (offline) is neither — the exact caveat in
          LoadFailedRefusal's own header. */}
      {useAdminCatalog ? null : tierQ.isError || catalogQ.isError ? (
        <LoadFailedRefusal
          what="membership pricing"
          onRetry={() => {
            void tierQ.refetch();
            void catalogQ.refetch();
          }}
          isRetrying={tierQ.isFetching || catalogQ.isFetching}
          testId="membership-pricing-load-failed"
        />
      ) : tierQ.isLoading || catalogQ.isLoading ? (
        <Skeleton className="h-80 w-full" />
      ) : !tierQ.isSuccess || !catalogQ.isSuccess ? (
        <LoadFailedRefusal
          what="membership pricing"
          onRetry={() => {
            void tierQ.refetch();
            void catalogQ.refetch();
          }}
          isRetrying={tierQ.isFetching || catalogQ.isFetching}
          testId="membership-pricing-unavailable"
        />
      ) : (
        <Card
          className={isCurrent ? "border-primary" : ""}
          data-testid="tier-card-standard"
        >
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Collective Membership</span>
              {isCurrent && <Badge>Current</Badge>}
            </CardTitle>
            <p className="text-2xl font-bold">
              {formatMoneyMinor(tier?.amountMinor ?? null, tier?.currency ?? null)}
              <span className="text-sm font-normal text-muted-foreground">
                {" "}
                / {periodLabel(tier?.billingPeriod)}
              </span>
            </p>
            <p className="text-sm text-muted-foreground">
              Full access to the Capavate Collective.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-2 text-sm">
              {MEMBER_ENTITLEMENTS.map((e) => (
                <li key={e} className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-600 shrink-0" />
                  <span>{e}</span>
                </li>
              ))}
            </ul>
            <Button
              className="w-full"
              onClick={() => checkoutMut.mutate(undefined)}
              disabled={checkoutMut.isPending || (isCurrent && !current?.cancelAtPeriodEnd)}
              data-testid="subscribe-btn-standard"
            >
              {checkoutMut.isPending
                ? "Redirecting…"
                : isCurrent
                  ? "Subscribed"
                  : "Subscribe"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* WAVE 17 ORP-039 — self-service billing. The three
          /api/collective/me/* billing reads had zero client callers; they are
          rendered here as a sibling CARD (additive to the guard fingerprint,
          never appended inside an existing node). */}
      <MemberBillingPanel />
    </div>
  );
}
