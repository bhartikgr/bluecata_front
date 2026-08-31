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
import { apiRequest, ApiError } from "@/lib/queryClient";
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
/* WAVE 199 · ITEM B (R173.6) — the member price is stored with a MONTHLY cadence
   (`platform_fees → collective.member_subscription.standard = 24900 USD monthly`),
   and this page printed that cadence unconditionally. Whether a monthly cadence may
   be displayed is the admin's decision; this hook reads it live. */
/* WAVE 202 · ITEM A · R178.1 — the PER-PRICE hook replaces the platform-wide one
   on this surface. `useMonthlyDisplayAllowed` is NOT removed from the library and
   still serves the other three surfaces wave 199 gated; this page moves onto the
   scope-aware hook because the Collective membership is the price the owner
   specifically wants to control the period for. With no per-price choice recorded,
   the scope-aware hook returns the SAME answer as the platform-wide one, so this
   change is behaviour-identical until the owner chooses. */
import {
  useMonthlyDisplayAllowedForScope,
  usePricePeriodOffer,
  platformFeeScope,
} from "@/lib/priceDisplayPolicy";
import { MONEY_NOT_ON_RECORD } from "@/lib/currency"; /* WAVE 152 · G-C8 — one agreed absence wording (R111 Q13) */
/* WAVE 24 · ITEM 3a — a failed price fetch must not render a buyable card. */
import { LoadFailedRefusal } from "@/components/LoadFailedRefusal";
import { fmtLocaleDate } from "@/lib/format"; /* WAVE 87 · ITEM 1 */
import { describeFailure } from "@/lib/failureMessage";

// ----- Types --------------------------------------------------------------

interface FeatureFlagsResponse {
  COLLECTIVE_ENABLED?: boolean;
}

/** Shape of GET /api/collective/member-tier (resolveCanonicalMemberTier). */
interface MemberTierDTO {
  slug: string;
  key: string;
  /* WAVE 152 · ITEM G · G-C8 — nullable. The server reports an unconfigured
   * price as `null` rather than substituting a compiled-in amount (R95). */
  amountMinor: number | null;
  currency: string | null;
  billingPeriod: string | null;
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
  /* WAVE 152 · ITEM G · G-C8 (R111 Q13). An em dash reads as decoration; a member
   * looking at it cannot tell whether the price is free, still loading, or simply
   * not configured. Now that GET /api/collective/member-tier can report
   * `amountMinor: null` instead of the deleted compiled-in $249.00, the page says
   * which — in the platform's one agreed wording. */
  if (amountMinor === null || currency === null) return MONEY_NOT_ON_RECORD;
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

/* WAVE 87 · ITEM 1 — THIS LOCAL HELPER SHADOWED THE SAFE ONE.
   Twelve files define their own `fmtDate`/`formatIsoDate` whose body is the
   exact defect reviewer 1 reported: `new Date("2026-06-15")` parses as UTC
   midnight, so any local-time reader prints ONE DAY EARLY west of UTC (the
   owner is in New York). Only the BODY changes — every call site is untouched,
   so a timestamp renders byte-identically and nothing is restyled, while a
   date-only value now renders the day that was entered. */
function formatIsoDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return fmtLocaleDate(iso, undefined, undefined, iso);
  } catch {
    return iso;
  }
}

/* WAVE 152 · ITEM G · G-C8 — `| null` accepted. The server now reports an
   unconfigured price as `billingPeriod: null`, and a cadence that is not on
   record must not be silently relabelled; the callers suppress the suffix
   entirely in that case. */
function periodLabel(billingPeriod: string | undefined | null): string {
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

/* WAVE 199 · ITEM B · R173.6 — THE ONE PLACE THAT DECIDES WHETHER A CADENCE MAY BE
   PRINTED BESIDE THIS PAGE'S PRICE.

   THE OWNER'S WORDS: "The platform is annual and/or fixed only. Therefore there
   really should not be a displayed as monthly."

   The member price on record is `24900 USD monthly`, so the honest options are to
   print the recorded cadence, to print no cadence, or to invent one. Inventing is out:
   `partner_pricing_model_config.forbid_x12_derivation = 1` forbids turning a monthly
   figure into an annual one, and R156.2 forbids a compiled-in cadence. So this returns
   the suffix ONLY when the recorded cadence is one the admin actually offers, and the
   empty string otherwise. It never suppresses the AMOUNT — the caller renders that
   either way, so a member is never shown a page with no price.

   It also closes a smaller defect it sits next to. `periodLabel`'s `default` branch
   answers `"month"` for a cadence that is absent or unrecognised, which is an INVENTED
   monthly cadence. This function can never reach that branch: an unrecognised cadence
   is not an offered cadence, so it yields no suffix at all. `periodLabel` itself is
   left byte-for-byte alone for the callers that handle absence their own way. */
function cadenceSuffix(
  billingPeriod: string | undefined | null,
  monthlyDisplayAllowed: boolean,
): string {
  const raw = String(billingPeriod ?? "").trim();
  if (!raw) return "";
  if (raw === "monthly") return monthlyDisplayAllowed ? ` / ${periodLabel(raw)}` : "";
  if (raw === "yearly" || raw === "annual") return ` / ${periodLabel(raw)}`;
  return "";
}

function statusBadgeVariant(
  status: BillingDTO["status"],
): "positive" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "active":
      /* WAVE 101 - "default" is the brand red, so an ACTIVE membership was the
         same colour as `past_due` below.  Colour only. */
      return "positive";
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

/* ═══════════════════════════════════════════════════════════════════════════
   WAVE 183 · ITEM B FIX 2 — STATED FACTS FOR THE MEMBERSHIP PRICING SURFACE.

   R154.6 is explicit that the four pricing fields are LOAD FAILURES, not unset
   prices. The price is real: `platform_fees` holds
   `collective.member_subscription.standard = 24900 USD monthly`. So the copy
   below never speculates about the price. It names the one fact that was
   actually missing on the failing request, and — the owner's distinction — it
   only asks the reader to retry when retrying can change the answer.
   ═══════════════════════════════════════════════════════════════════════════ */

/** The 403 from `requireCollectiveMember` on the OPTIONAL admin catalog. The
 *  canonical price is unaffected, so this states a limitation, not a failure. */
const MEMBERSHIP_CATALOG_UNREADABLE_COPY =
  "The price above is the current published membership price held by Capavate. A chapter-specific package list also exists for members, and this account cannot read it yet — joining does not change the price shown here.";

/** 401 on the canonical tier route: the session, not the price, is missing. */
const MEMBERSHIP_TIER_SIGNED_OUT_COPY =
  "The missing fact is a signed-in session: this request was not authenticated, so no price could be looked up for your account. Sign in again — retrying this page will not change it.";

/** 409/404 on the canonical tier route: the platform genuinely holds no price
 *  record. This is the "which fact is missing" case the owner asked for, and it
 *  deliberately does NOT print a number in place of the absent one. */
const MEMBERSHIP_TIER_NO_RECORD_COPY =
  "The missing fact is a published price: Capavate holds no active membership price record for this chapter, so there is no figure to show. Capavate will not display a placeholder or a zero for a price it does not hold. An administrator must publish the membership price before this page can state one.";

/**
 * Turn a failed canonical-tier request into a STATED FACT, or `null` when the
 * failure genuinely is transient and the existing copy is already right.
 *
 * Passed into `LoadFailedRefusal`'s optional `detail` slot, which renders as an
 * ADDITIONAL SIBLING: both of that component's existing sentences still appear
 * byte-verbatim in every case (R143.1).
 */
function membershipPricingDetail(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  if (error.status === 401) return MEMBERSHIP_TIER_SIGNED_OUT_COPY;
  if (error.status === 404 || error.status === 409) return MEMBERSHIP_TIER_NO_RECORD_COPY;
  return null;
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
  /* WAVE 199 · ITEM B (R173.6). Fail-closed while unknown: the amount below is
     rendered either way, so nothing on this page can end up priceless. */

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
      /* WAVE 197 #36 — WRITE (activation). */
      toast({ variant: "destructive", title: "Activation pending", description: describeFailure(e, "write") }),
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
      /* WAVE 197 #37 — WRITE (checkout session). */
      toast({ variant: "destructive", title: "Checkout failed", description: describeFailure(e, "write") }),
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
      /* WAVE 197 #38 — WRITE (portal session creation). */
      toast({ variant: "destructive", title: "Could not open billing portal", description: describeFailure(e, "write") }),
  });

  /* WAVE 202 · ITEM A · R178.1 — THE OWNER'S PER-PRICE CHOICE FOR THIS PRICE.
     THE OWNER'S WORDS: "the admin area pricing section should allow me to choose
     between annual and/or monthly pricing. Whatever I choose should be dynamically
     displayed in the frontend."

     Wave 199 asked one platform-wide question here. This asks about THIS price. The
     scope is derived from the key the server actually served (`tierQ.data.key`),
     never spelled out in this file, so a renamed or re-pointed canonical membership
     row cannot leave the page consulting a scope that no longer exists — and no
     pricing identifier is compiled in to decide what a screen shows (R156.2).

     Before the tier loads the scope is the empty string, which no recorded choice
     can match, so the hook returns the platform-wide answer. That is the fail-closed
     answer and is exactly what wave 199 rendered. These two hooks sit ABOVE the
     `!collectiveOn` early return so their call order is unconditional.

     PLACEMENT: this is an ADDED pair of statements. No existing statement, literal or
     JSX node was moved, reworded or removed. */
  const memberTierScopeKey = platformFeeScope(tierQ.data?.key ?? "");
  const monthlyDisplayAllowed = useMonthlyDisplayAllowedForScope(memberTierScopeKey);
  const memberTierPeriodOffer = usePricePeriodOffer(memberTierScopeKey);

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
        {/* WAVE 199 · ITEM B (R173.6) — THE CADENCE SENTENCE IS NOT DELETED AND NOT
            REWORDED (R143.1). It is shown while the admin offers monthly, and a
            STATIC SIBLING below carries the part of it that is true regardless of
            cadence. Both literals stay in the source, so neither is dropped from the
            copy inventory. */}
        {monthlyDisplayAllowed && (
        <p className="text-muted-foreground">
          One membership, billed monthly and renewing automatically until you cancel.
        </p>
        )}
        {!monthlyDisplayAllowed && (
        <p className="text-muted-foreground" data-testid="w199-membership-renewal-note">
          One membership, renewing automatically until you cancel. The billing period is the one an administrator has configured.
        </p>
        )}
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
                  {/* WAVE 152 · ITEM G · G-C8 — "Not on record / month" would be
                      nonsense, so the cadence is suppressed when there is no
                      amount to attach it to. */}
                  {/* WAVE 199 · ITEM B (R173.6) — the AMOUNT is unconditional; only
                      the cadence suffix is withheld when the recorded cadence is
                      monthly and the admin does not offer monthly. Suppressing the
                      figure as well would take a fact away from a member who is
                      being charged it. No cadence is ever substituted and no annual
                      equivalent is derived (forbid_x12_derivation). */}
                  {tier && tier.amountMinor !== null
                    ? `${formatMoneyMinor(tier.amountMinor, tier.currency)}${cadenceSuffix(tier.billingPeriod, monthlyDisplayAllowed)}`
                    : MONEY_NOT_ON_RECORD}
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
            {/* WAVE 202 · ITEM A · R178.1 + R143.4 — WHEN AN ANNUAL PRICE IS OFFERED
                BUT NONE EXISTS, SAY SO.

                The Collective membership is on record as a monthly amount with NO
                annual price anywhere in any store. If the owner chooses to offer
                annual for this price before he sets one, the honest answer is this
                sentence — not $0.00 ("Capavate will not show a zero total for a
                figure it does not hold", R143.4) and not the monthly amount times
                twelve (`forbid_x12_derivation = 1`, R156.1/R156.2). The amount above
                is unaffected either way, so this page can never end up priceless.

                ADDED as a new sibling <p> AFTER the closing </dl>. `p` is not a
                PANEL_TAG and no <dd>, <dt> or grid cell is added, moved or
                renumbered (R143.1; wave 182 — a new cell renumbers its siblings). */}
            {memberTierPeriodOffer !== null &&
              memberTierPeriodOffer.annualOffered &&
              memberTierPeriodOffer.annualAmountMinor === null && (
                <p
                  className="mt-3 text-xs leading-snug text-muted-foreground"
                  data-testid="text-membership-annual-not-set"
                >
                  An annual price for Collective membership has not been set yet, so
                  only the amount above is shown. Capavate will not work an annual
                  figure out from the monthly one.
                </p>
              )}
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
      {/* WAVE 183 · ITEM B FIX 2 — WHY THE PAGE COULD NOT STATE A PRICE.

          The comment above is right about the danger it was written for and the
          conditions it produced were too wide, so it suppressed a price the
          platform DOES hold. Two queries feed this card and they are not equals:

            · `tierQ`  → GET /api/collective/member-tier — open to any
                         authenticated user, answers 200, and resolves the real
                         figure from `platform_fees` in the database via
                         `resolveCanonicalMemberTier()`. This is the price.
            · `catalogQ` → GET /api/collective/membership/tiers — sits behind
                         `requireCollectiveMember`, so for a user who is not yet
                         a Collective member it answers **403**, by design and
                         permanently. It is the OPTIONAL admin-authored override.

          `tierQ.isError || catalogQ.isError` therefore blanked the price for
          exactly the population the page exists to sell to: prospective members.
          The card that "sells a product billed monthly and renewing
          automatically until you cancel" could not name its own price, and the
          reason had nothing to do with the price.

          THE FIX narrows the conditions to the query that actually carries the
          figure. `catalogQ` failing no longer suppresses anything; it only means
          no admin override was readable, which is stated as a sibling note
          below. BOTH refusal branches and BOTH testids are kept — the first is
          still what renders when the real price source fails, which is the case
          the wave-24 comment was defending against, and the second still covers
          a paused query. Nothing here fabricates: if `tierQ` cannot answer, the
          page still refuses to show a number. */}
      {useAdminCatalog ? null : tierQ.isError ? (
        <LoadFailedRefusal
          what="membership pricing"
          onRetry={() => {
            void tierQ.refetch();
            void catalogQ.refetch();
          }}
          isRetrying={tierQ.isFetching || catalogQ.isFetching}
          testId="membership-pricing-load-failed"
          detail={membershipPricingDetail(tierQ.error)}
        />
      ) : tierQ.isLoading ? (
        <Skeleton className="h-80 w-full" />
      ) : !tierQ.isSuccess ? (
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
            <p className="text-2xl font-bold" data-testid="membership-tier-price">
              {formatMoneyMinor(tier?.amountMinor ?? null, tier?.currency ?? null)}
              {/* WAVE 152 · ITEM G · G-C8 — the cadence span is kept as a STATIC
                  sibling and empties its own text, rather than being swapped for
                  a conditional element, so the panel/copy shape the drop gate
                  counts is unchanged. */}
              <span className="text-sm font-normal text-muted-foreground">
                {tier && tier.amountMinor !== null ? cadenceSuffix(tier.billingPeriod, monthlyDisplayAllowed) : ""}
              </span>
            </p>
            <p className="text-sm text-muted-foreground">
              Full access to the Capavate Collective.
            </p>
            {/* WAVE 183 · ITEM B FIX 2 — a STATIC SIBLING that names the one
                thing the page could not read, instead of the whole card
                disappearing because of it. The price above is the canonical
                database figure and is correct either way; this only discloses
                that an admin-authored package list, if one exists, was not
                readable on this request. */}
            {catalogQ.isError && (
              <p
                className="text-xs text-muted-foreground"
                data-testid="membership-catalog-unavailable-note"
              >
                {MEMBERSHIP_CATALOG_UNREADABLE_COPY}
              </p>
            )}
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
