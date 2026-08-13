/**
 * WAVE 14 — CP-SUB-17: THE CHECKOUT RETURN PAGE THAT DID NOT EXIST.
 *
 * THE DEFECT. `startPartnerCheckout` (server/lib/partnerSubscriptionStore.ts:447)
 * builds the gateway's `returnUrl` as
 *     `<origin>/collective/partner/billing/return?paymentIntentId=…`
 * and hands it to the hosted payment page. Nothing in client/src/App.tsx served
 * that path. A partner who completed payment was redirected back into the app
 * and landed on an unmatched route — money gone, no confirmation, no instruction.
 * That is the "stranded partner" this item names.
 *
 * WHAT THIS PAGE DOES *NOT* DO. It does not activate anything. Activation is the
 * webhook's job (and, in stub mode, the checkout call's). A return page that
 * activated on GET would let a browser reload mint entitlement — so this page is
 * a pure read of `GET /api/partner/me/checkout/status`, which is itself a pure
 * read.
 *
 * THE HONEST-UNKNOWN RULE. If the reference does not yet match a subscription,
 * the state is `pending_unmatched` and the copy says so — plus "do not pay
 * again". It does NOT say the payment failed. Telling a partner who paid that
 * they did not is worse than telling them we do not know yet. The retry button
 * is rendered ONLY when the server reports `safeToRetry`, which is true only for
 * genuinely `failed` or `cancelled` attempts.
 */
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { formatMinor } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { AppCard } from "@/components/ui/app-card";
import { PartnerShell } from "@/components/partner/PartnerShell";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";

type CheckoutStatus = {
  ok: boolean;
  state: "active" | "awaiting_confirmation" | "pending_unmatched" | "failed" | string;
  subscription:
    | {
        id: string;
        /* Mirrors `PartnerSubscriptionRow` / mapRow
           (server/lib/partnerSubscriptionStore.ts:171) — verified at source. The
           promotion field is `discountCode`; the cadence field is `cycle` in
           THIS store (partnerBillingStore's mapper calls it `cadence`), which is
           exactly why both were checked rather than assumed. */
        tierSlug: string;
        cycle: string;
        status: string;
        amountMinor: number;
        currency: string;
        discountCode: string | null;
        discountMinor: number;
        priceDerivation: string | null;
        activatedAt: string | null;
        currentPeriodEnd: string | null;
      }
    | null;
  reference: { paymentIntentId: string | null; merchantOrderId: string | null };
  message?: string;
  safeToRetry: boolean;
  events?: Array<{ id: string; eventName: string; emittedAt: string }>;
};

/** Copy per state. Every string is deliberate; see the header note on honesty. */
const STATE_COPY: Record<string, { heading: string; tone: "good" | "wait" | "bad"; body: string }> = {
  active: {
    heading: "Payment confirmed — your plan is active",
    tone: "good",
    body: "We have matched your payment and activated your subscription. The details below are read live from your billing record.",
  },
  awaiting_confirmation: {
    heading: "Payment received — awaiting confirmation",
    tone: "wait",
    body:
      "Your subscription record exists and is waiting for the payment processor's final confirmation. This normally takes seconds. You do not need to do anything, and you must not pay again.",
  },
  pending_unmatched: {
    heading: "We have not matched this payment yet",
    tone: "wait",
    body:
      "We could not yet link this payment reference to a subscription. If you completed payment, it is safe to close this page — confirmation will appear on your Billing page. Do not pay again.",
  },
  failed: {
    heading: "This payment attempt did not complete",
    tone: "bad",
    body: "The processor reported that this attempt failed, so nothing was charged for it. You can safely start checkout again.",
  },
  cancelled: {
    heading: "Checkout was cancelled",
    tone: "bad",
    body: "This checkout was cancelled before payment. Nothing was charged. You can start again when you are ready.",
  },
};

const TONE_CLASS: Record<string, string> = {
  good: "border-emerald-500 bg-emerald-500/10",
  wait: "border-amber-500 bg-amber-500/10",
  bad: "border-destructive bg-destructive/10",
};

export default function PartnerCheckoutReturn() {
  const role = useRequirePartnerRole();
  const [location] = useLocation();
  /* The gateway appends the reference as a query string on the return URL, so it
     is read from the live URL rather than from any client-held state — the
     partner may return in a NEW tab, where no in-app state survives. */
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const paymentIntentId = params.get("paymentIntentId") ?? "";
  const merchantOrderId = params.get("merchantOrderId") ?? "";
  const hasReference = !!(paymentIntentId || merchantOrderId);

  const qs = new URLSearchParams();
  if (paymentIntentId) qs.set("paymentIntentId", paymentIntentId);
  if (merchantOrderId) qs.set("merchantOrderId", merchantOrderId);

  const status = useQuery<CheckoutStatus>({
    queryKey: ["/api/partner/me/checkout/status", paymentIntentId, merchantOrderId],
    enabled: !!role.ready && !!role.identity && hasReference,
    retry: false,
    /* An unmatched reference usually means a webhook is still in flight, so the
       page polls — but only while unmatched or awaiting, and only every 4s. It
       stops entirely once the state is terminal, so a forgotten tab does not
       poll the money API forever. */
    refetchInterval: (q) => {
      const s = (q.state.data as CheckoutStatus | undefined)?.state;
      return s === "pending_unmatched" || s === "awaiting_confirmation" ? 4000 : false;
    },
    queryFn: async () => (await apiRequest("GET", `/api/partner/me/checkout/status?${qs.toString()}`)).json(),
  });

  /* Announce the outcome to assistive tech once it is known: this page is
     reached by redirect, so a screen-reader user gets no navigation cue. */
  const [announced, setAnnounced] = useState("");
  useEffect(() => {
    if (status.data?.state) setAnnounced(STATE_COPY[status.data.state]?.heading ?? status.data.state);
  }, [status.data?.state]);

  if (!role.ready || !role.identity) return null;
  const me = role.identity;

  const copy = status.data ? (STATE_COPY[status.data.state] ?? {
    heading: `Checkout status: ${status.data.state}`,
    tone: "wait" as const,
    body: "Your payment is in a state we do not have specific guidance for. Your Billing page holds the authoritative record.",
  }) : null;

  return (
    <PartnerShell title="Checkout" tier={me.tier} subRole={me.subRole} partnerName={me.identity.name}>
      <div className="sr-only" role="status" aria-live="polite" data-testid="partner-checkout-return-announce">
        {announced}
      </div>

      {!hasReference ? (
        /* No reference at all: the partner reached this URL directly. Say so
           plainly instead of showing a spinner that never resolves. */
        <AppCard title="No payment reference" data-testid="partner-checkout-return-no-reference">
          <p className="text-sm text-muted-foreground">
            This page confirms the result of a checkout and needs the payment reference the processor adds to the return
            link. Open your Billing page for the authoritative record of your plan.
          </p>
          <div className="mt-3">
            <Link href="/collective/partner/billing">
              <Button data-testid="button-checkout-return-billing">Go to Billing</Button>
            </Link>
          </div>
        </AppCard>
      ) : status.isLoading ? (
        <AppCard title="Checking your payment" data-testid="partner-checkout-return-loading">
          <p className="text-sm text-muted-foreground">Confirming with the payment processor…</p>
        </AppCard>
      ) : status.isError ? (
        <AppCard title="We could not read your checkout status" data-testid="partner-checkout-return-error">
          {/* An error reading STATUS is not evidence about the PAYMENT. The copy
              is careful not to imply either outcome. */}
          <p className="text-sm">
            {status.error instanceof ApiError && status.error.status === 403
              ? "Your account is not linked to an active partner workspace, so we cannot look up this payment."
              : "We could not reach the billing service to confirm this payment. This does not mean your payment failed."}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Do not pay again. Open your Billing page in a few moments, or contact support with the reference below.
          </p>
          <p className="mt-2 font-mono text-xs" data-testid="partner-checkout-return-reference-error">
            {paymentIntentId || merchantOrderId}
          </p>
          <div className="mt-3 flex gap-2">
            <Button variant="outline" onClick={() => status.refetch()} data-testid="button-checkout-return-retry-status">
              Check again
            </Button>
            <Link href="/collective/partner/billing">
              <Button data-testid="button-checkout-return-billing-error">Go to Billing</Button>
            </Link>
          </div>
        </AppCard>
      ) : (
        <>
          <div
            className={`rounded-md border p-4 ${TONE_CLASS[copy?.tone ?? "wait"]}`}
            data-testid={`partner-checkout-return-state-${status.data?.state}`}
          >
            <h2 className="text-base font-semibold" data-testid="partner-checkout-return-heading">
              {copy?.heading}
            </h2>
            <p className="mt-1 text-sm">{status.data?.message ?? copy?.body}</p>
            <p className="mt-2 font-mono text-xs opacity-70" data-testid="partner-checkout-return-reference">
              {status.data?.reference.paymentIntentId ?? status.data?.reference.merchantOrderId ?? "—"}
            </p>
          </div>

          {status.data?.subscription && (
            <div className="mt-4">
              <AppCard title="What you purchased" data-testid="partner-checkout-return-subscription">
                <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">Tier</dt>
                    <dd data-testid="checkout-return-tier">{status.data.subscription.tierSlug}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">Billing cycle</dt>
                    <dd data-testid="checkout-return-cycle">{status.data.subscription.cycle}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">Amount charged</dt>
                    {/* Integer minor units, formatted by the shared ISO-4217
                        formatter. No arithmetic on money in this component. */}
                    <dd className="font-mono" data-testid="checkout-return-amount">
                      {formatMinor(status.data.subscription.amountMinor, status.data.subscription.currency)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">Discount applied</dt>
                    <dd className="font-mono" data-testid="checkout-return-discount">
                      {status.data.subscription.discountMinor
                        ? `−${formatMinor(status.data.subscription.discountMinor, status.data.subscription.currency)}${
                            status.data.subscription.discountCode ? ` (${status.data.subscription.discountCode})` : ""
                          }`
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">Record status</dt>
                    <dd data-testid="checkout-return-status">{status.data.subscription.status}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">Renews / ends</dt>
                    <dd data-testid="checkout-return-period-end">
                      {status.data.subscription.currentPeriodEnd
                        ? new Date(status.data.subscription.currentPeriodEnd).toLocaleDateString()
                        : "—"}
                    </dd>
                  </div>
                </dl>
              </AppCard>
            </div>
          )}

          {(status.data?.events ?? []).length > 0 && (
            <div className="mt-4">
              <AppCard title="Payment timeline" data-testid="partner-checkout-return-events">
                <ul className="space-y-1 text-sm">
                  {(status.data?.events ?? []).map((e) => (
                    <li key={e.id} className="flex gap-3" data-testid={`checkout-return-event-${e.id}`}>
                      <span className="whitespace-nowrap text-muted-foreground">
                        {new Date(e.emittedAt).toLocaleString()}
                      </span>
                      <span className="font-mono text-xs">{e.eventName}</span>
                    </li>
                  ))}
                </ul>
              </AppCard>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/collective/partner/billing">
              <Button data-testid="button-checkout-return-to-billing">Go to Billing</Button>
            </Link>
            {/* Rendered ONLY when the server says retrying is safe. */}
            {status.data?.safeToRetry && (
              <Link href="/collective/partner/billing">
                <Button variant="outline" data-testid="button-checkout-return-start-again">
                  Start checkout again
                </Button>
              </Link>
            )}
            {(status.data?.state === "pending_unmatched" || status.data?.state === "awaiting_confirmation") && (
              <Button variant="ghost" onClick={() => status.refetch()} data-testid="button-checkout-return-refresh">
                Check now
              </Button>
            )}
          </div>
          <p className="mt-3 text-xs text-muted-foreground" data-testid="partner-checkout-return-path">
            Return path: {location}
          </p>
        </>
      )}
    </PartnerShell>
  );
}
