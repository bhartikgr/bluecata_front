/**
 * v25.32 A3 — Consortium Partner Billing page (Path 1).
 *
 * Consortium Partners do NOT pay subscription billing. Instead they EARN
 * commissions on referred/funded deals. This page explains that model and
 * renders the partner's commission ledger sourced live from
 * `GET /api/partner/me/billing` (which reads partner_billing_entries from
 * SQLite via rawDb() in server/partnerConsortiumRoutes.ts — never in-memory).
 *
 * NOTE: the billing endpoint is gated to the `managing_partner` subrole on
 * the server (requirePartnerSubrole). For other subroles apiRequest() throws
 * an ApiError(403); we catch it and render an access-scoped explanation
 * rather than a hard error.
 *
 * v25.33 — extended to FOUR tabs (Subscription / Referral Commissions / SPV
 * Fees / Tax Forms). The Referral Commissions tab is the original v25.32
 * content, UNCHANGED — it still consumes Avi's GET /api/partner/me/billing.
 * The three new tabs consume the additive v25.33 self-service endpoints
 * (GET /api/partner/me/subscription, /spv-fees, /tax-forms). All reads are
 * DB-direct; nothing is hardcoded. Totals are now multi-currency aware.
 */
import { Fragment, useState } from "react";
import { Link } from "wouter";
import { formatMinor as formatMinorLib } from "@/lib/currency"; /* v25.38 currency sweep */
import { formatMinorOrUnavailable, minorToMajorString } from "@/lib/moneyDisplay"; /* WAVE 21 ITEM 2 + ITEM 5 */
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, ApiError } from "@/lib/queryClient";
/* WAVE 69 · V-3 (R58) — `ApiError.message` is replaced with a generic sentence by
   `queryClient.ts:63` for anything ≥ 240 chars, and this refusal is 431. The real
   text lives on `ApiError.payload.message`. */
import { serverRefusalMessage } from "@/lib/serverRefusalMessage";
/* WAVE 16 / CP-BRG-07 — a stored FRACTION becomes a displayed percent in ONE
 * place only. The forbidden "guess the unit from the magnitude" normaliser is
 * NOT used here (it is spelled out in server/lib/wave16FeeAggregateWiring.ts,
 * which is the fence that rejects it — that fence deliberately does not strip
 * comments, so this comment must not spell the pattern either). */
import { formatFractionAsPercent } from "@/lib/percentDisplay";
/* WAVE 16 / CP-BRG-07 + ORP-052 — the partner surface subscribes to the
 * already-mounted, already-authorised `/api/stream` (CP-034). */
import { useCollectiveStream } from "@/lib/sseClient";
import { Button } from "@/components/ui/button";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { PartnerShell, PartnerEmptyState } from "@/components/partner/PartnerShell";
// v25.46 BLOCKER FIX #4 (Tier 9 #73) — billing surfaces consume the canonical
// AppCard primitive; the tab strip uses canonical FilterChip pills instead of
// shadcn Tabs. All widgets, data-testids, and data wiring preserved.
import { AppCard } from "@/components/ui/app-card";
import { FilterChip } from "@/components/ui/filter-chip";

type BillingEntry = {
  id: string;
  dealId: string;
  date: string;
  amountFundedMinor: number;
  /** v25.32 final — sourced from soft_circles.currency via LEFT JOIN. */
  currency: string;
  tier: string;
  commissionPct: number;
  commissionMinor: number;
  status: "pending" | "paid";
  paidAt: string | null;
};

type BillingResponse = {
  entries: BillingEntry[];
  totalsByStatus: Record<string, number>;
};

/* v25.32 — commission ledger amounts are stored as integer minor units
 * (cents). v25.32 final — currency now comes from the row (sourced from
 * soft_circles.currency via the endpoint's LEFT JOIN). Falls back to USD
 * only when the row is missing currency (defensive). */
function formatMinor(minor: number, ccy?: string) {
  // v25.38 — delegate to shared ISO-4217-aware formatter (2-decimal parity).
  return formatMinorLib(minor, ccy || "USD", { locale: "en-US" });
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatPct(pct: number) {
  // commission_pct stored as a fraction (e.g. 0.1 → 10%)
  return `${(pct * 100).toFixed(1).replace(/\.0$/, "")}%`;
}

/* v25.33 — multi-currency totals helper. Sums minor amounts per currency so the
 * summary cards no longer assume a single currency across a partner's deals. */
function totalsByCurrencyFromEntries(
  entries: Array<{ currency: string; commissionMinor: number; status: string }>,
): Record<string, { pending: number; paid: number }> {
  const out: Record<string, { pending: number; paid: number }> = {};
  for (const e of entries) {
    const ccy = e.currency || "USD";
    if (!out[ccy]) out[ccy] = { pending: 0, paid: 0 };
    if (e.status === "paid") out[ccy].paid += e.commissionMinor || 0;
    else out[ccy].pending += e.commissionMinor || 0;
  }
  return out;
}

/* ============================================================
 * Referral Commissions tab — UNCHANGED v25.32 content, now multi-currency.
 * ============================================================ */
function ReferralCommissionsTab({ ready }: { ready: boolean }) {
  const { data, isLoading, isError, error } = useQuery<BillingResponse>({
    queryKey: ["/api/partner/me/billing"],
    enabled: ready,
    retry: false,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/billing")).json(),
  });

  const isForbidden = isError && error instanceof ApiError && error.status === 403;
  /* ═══════════════════════════════════════════════════════════════
     WAVE 69 · V-3 (R58 row 3) — A 409 IS NOT A TRANSIENT FAILURE.
     ═══════════════════════════════════════════════════════════════
     Only `403` was ever inspected here, so `commissionPctOrRefuse()`'s 409
     (`server/partnerConsortiumRoutes.ts:144-162`) fell into the generic branch
     below and the partner was told to "refresh and try again" — advice that can
     NEVER work, because a missing tier commission rate is not transient.

     `error.code` survives the boundary intact and is the correct thing to branch
     on; `error.message` does NOT (the 431-character sentence is ≥ 240 chars, so
     `queryClient.ts:63` replaces it). The reason is read off the payload. */
  const planUnresolved =
    isError &&
    error instanceof ApiError &&
    error.status === 409 &&
    error.code === "PARTNER_COMMISSION_RATE_UNRESOLVED";
  const planUnresolvedReason = planUnresolved ? serverRefusalMessage(error) : null;
  const entries = data?.entries ?? [];
  // v25.33 — derive per-currency totals from the rows (not the single-currency
  // totalsByStatus map) so multi-currency partners see correct summaries.
  const totals = totalsByCurrencyFromEntries(entries);
  const currencies = Object.keys(totals);

  return (
    <>
      {/* Path 1 explainer — partners earn commissions, they are not billed a subscription. */}
      <div
        className="mb-4 rounded-md border border-[rgba(4,30,65,0.2)] bg-[rgba(4,30,65,0.05)] p-4 text-sm text-[var(--cv-color-navy)]"
        data-testid="partner-billing-explainer"
      >
        <p className="font-medium">Consortium Partners earn commissions on referred founders.</p>
        <p className="mt-1">
          The ledger below tracks commissions accrued on deals you have funded, along with their payout
          status.
        </p>
      </div>

      {isForbidden && (
        <div
          className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
          data-testid="partner-billing-forbidden"
        >
          Commission ledger details are visible to managing partners only. Please contact your managing
          partner for payout details.
        </div>
      )}

      {/* WAVE 69 · V-3 — CONDITION NARROWED, COPY UNTOUCHED (R44). "Could not load
          your commission ledger. Please refresh and try again." is TRUE for the
          transient failures it was written for (a 500, a dropped connection) and
          stays on screen for them, byte-identical. It is false ONLY for this one
          409, and the remedy for "true in general, false in one branch" is to ADD
          the branch — not to replace the general copy. No allowlist entry. */}
      {!isForbidden && !planUnresolved && isError && (
        <div
          className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"
          data-testid="partner-billing-error"
        >
          Could not load your commission ledger. Please refresh and try again.
        </div>
      )}

      {/* WAVE 69 · V-3 — THE SERVER'S OWN SENTENCE, RENDERED, NOT PARAPHRASED.
          It already names the tier, the exact admin path, the endpoint, and states
          that nothing has been charged, paid or recorded and no default rate has
          been assumed. The route file's own comment records that the admin path was
          verified in the tree, and warns that naming the wrong tab sends the admin
          to a screen that cannot fix it — so it is NOT restated here. One
          authority, imported. The fallback below is used only if the body carried
          no message; it invents no path and no rate. */}
      {planUnresolved && (
        <div
          className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
          role="alert"
          data-testid="partner-billing-rate-unresolved"
        >
          {planUnresolvedReason ??
            "Your commission figures cannot be computed: no commission rate is configured for your tier. Nothing has been charged, paid or recorded, and no default rate has been assumed. Refreshing will not help — an administrator has to configure the rate for your tier."}
        </div>
      )}

      {!isForbidden && !isError && (
        <>
          {/* Totals summary — v25.33 multi-currency aware (one pair of cards per currency). */}
          <div className="mb-4 space-y-3" data-testid="partner-billing-totals">
            {currencies.length === 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <AppCard className="p-4">
                  <div className="text-xs uppercase tracking-wide text-[var(--cv-color-text-muted)]">Pending commission</div>
                  <div className="mt-1 font-mono text-lg" data-testid="partner-billing-total-pending">{formatMinor(0)}</div>
                </AppCard>
                <AppCard className="p-4">
                  <div className="text-xs uppercase tracking-wide text-[var(--cv-color-text-muted)]">Paid commission</div>
                  <div className="mt-1 font-mono text-lg" data-testid="partner-billing-total-paid">{formatMinor(0)}</div>
                </AppCard>
              </div>
            ) : (
              currencies.map((ccy) => (
                <div key={ccy} className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid={`partner-billing-totals-${ccy}`}>
                  <AppCard className="p-4">
                    <div className="text-xs uppercase tracking-wide text-[var(--cv-color-text-muted)]">Pending commission ({ccy})</div>
                    <div className="mt-1 font-mono text-lg" data-testid={`partner-billing-total-pending-${ccy}`}>
                      {formatMinor(totals[ccy].pending, ccy)}
                    </div>
                  </AppCard>
                  <AppCard className="p-4">
                    <div className="text-xs uppercase tracking-wide text-[var(--cv-color-text-muted)]">Paid commission ({ccy})</div>
                    <div className="mt-1 font-mono text-lg" data-testid={`partner-billing-total-paid-${ccy}`}>
                      {formatMinor(totals[ccy].paid, ccy)}
                    </div>
                  </AppCard>
                </div>
              ))
            )}
          </div>

          {isLoading && (
            <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="partner-billing-loading">Loading…</div>
          )}

          {!isLoading && entries.length === 0 && (
            <PartnerEmptyState
              title="No commissions yet"
              description="Commission entries appear here once a deal you referred is funded."
            />
          )}

          {!isLoading && entries.length > 0 && (
            <AppCard className="overflow-hidden" data-testid="partner-billing-table">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-[var(--cv-color-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--cv-color-text-muted)]">
                    <tr>
                      <th className="px-4 py-2">Deal</th>
                      <th className="px-4 py-2">Date</th>
                      <th className="px-4 py-2 text-right">Funded</th>
                      <th className="px-4 py-2 text-right">Rate</th>
                      <th className="px-4 py-2 text-right">Commission</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2">Paid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => (
                      <tr key={e.id} className="border-b last:border-0" data-testid={`partner-billing-row-${e.id}`}>
                        <td className="px-4 py-2 font-mono text-xs">{e.dealId}</td>
                        <td className="px-4 py-2">{formatDate(e.date)}</td>
                        <td className="px-4 py-2 text-right font-mono">{formatMinor(e.amountFundedMinor, e.currency)}</td>
                        <td className="px-4 py-2 text-right">{formatPct(e.commissionPct)}</td>
                        <td className="px-4 py-2 text-right font-mono">{formatMinor(e.commissionMinor, e.currency)}</td>
                        <td className="px-4 py-2">
                          <span
                            className={
                              e.status === "paid"
                                ? "inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800"
                                : "inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
                            }
                          >
                            {e.status}
                          </span>
                        </td>
                        <td className="px-4 py-2">{formatDate(e.paidAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </AppCard>
          )}
        </>
      )}
    </>
  );
}

/* ============================================================
 * Subscription tab (v25.33) — GET /api/partner/me/subscription.
 * ============================================================ */
type Subscription = {
  id: string; tierId: string; status: string; amountMinor: number;
  currency: string; billingCycle: string; currentPeriodEnd: string | null;
} | null;

/* v25.50 Phase 7 (9a) — the standalone /subscribe page was deleted; its
   tier-quote + checkout flow is merged here into the Subscription tab. */
type SubscribeQuote = {
  tier: string; cycle: string; amountMinor: number; currency: string;
  checkoutPath: string; computedVia?: string;
  /* WAVE 11 / EN-6 — the quote now says HOW to reach checkout, because the old
     `checkoutPath` was navigated to with a GET and the target is POST-only. */
  checkoutMethod?: string;
  legacyCheckoutPath?: string;
  activeSubscription?: { id: string; tierSlug: string; cycle: string; status: string; currentPeriodEnd: string | null } | null;
};

/* WAVE 11 — the lifecycle the server now reports alongside the legacy row. */
type PartnerSubscriptionRow = {
  id: string; tierSlug: string; cycle: string; status: string;
  amountMinor: number; currency: string;
  currentPeriodEnd: string | null; graceUntil: string | null;
};
type LifecycleEvent = {
  id: string; eventKind: string; fromStatus: string | null; toStatus: string | null;
  amountMinor: number | null; currency: string | null; createdAt: string;
};
type EnforcementBlock = {
  configKey: string; graceDays: number; configMissing: boolean;
  subscriptions: Array<{
    id: string; status: string; currentPeriodEnd: string | null;
    graceUntil: string | null; projectedGraceUntil: string | null; projectedNextAction: string;
  }>;
} | null;
type CheckoutResult = {
  subscriptionId: string; status: string; gatewayStatus: string;
  amountMinor: number; currency: string;
  hostedPaymentPageUrl: string; returnUrl: string; stubMode: boolean;
  currentPeriodEnd: string | null;
};
type PlanChangePreviewT = {
  changeKind: string; fromTier: string; toTier: string; fromCycle: string; toCycle: string;
  currency: string; periodDays: number; remainingDays: number;
  unusedCreditMinor: number; newChargeMinor: number; netDueMinor: number; explanation: string;
};

function SubscriptionTab({ ready }: { ready: boolean }) {
  const { data, isLoading, isError, error, refetch } = useQuery<{
    subscription: Subscription;
    /* WAVE 11 — additive keys on the SAME endpoint. */
    partnerSubscription?: PartnerSubscriptionRow | null;
    partnerSubscriptionEvents?: LifecycleEvent[];
    enforcement?: EnforcementBlock;
    lifecycleUnavailable?: string | null;
  }>({
    queryKey: ["/api/partner/me/subscription"],
    enabled: ready,
    retry: false,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/subscription")).json(),
  });
  const isForbidden = isError && error instanceof ApiError && error.status === 403;
  const sub = data?.subscription ?? null;

  /* Merged quote flow (was PartnerSubscribe). POST resolves the DB-driven price
     for the partner's tier + chosen cycle; no price is ever hardcoded. */
  const [cycle, setCycle] = useState<"monthly" | "annual">("monthly");
  const [quote, setQuote] = useState<SubscribeQuote | null>(null);
  const quoteMut = useMutation({
    mutationFn: async (): Promise<SubscribeQuote> =>
      (await apiRequest("POST", "/api/partner/me/subscribe", { cycle })).json(),
    onSuccess: (q) => setQuote(q),
  });

  /* ── WAVE 11 / EN-6 — the checkout POST ───────────────────────────────────
     The anchor below is KEPT (removing it would be a genuine functionality
     drop, and the silent-drop guard would rightly say so). It is now backed by
     a real POST: onClick preventDefaults, mints the payment intent, and only
     then navigates to the hosted payment page the gateway returned. If the POST
     fails the partner sees WHY instead of landing on a 403 from a founder-only
     route. */
  const [checkout, setCheckout] = useState<CheckoutResult | null>(null);
  const checkoutMut = useMutation({
    mutationFn: async (): Promise<CheckoutResult> =>
      (await apiRequest("POST", "/api/partner/me/checkout", { cycle })).json(),
    onSuccess: (r) => {
      setCheckout(r);
      void refetch();
      if (r.hostedPaymentPageUrl) window.location.assign(r.hostedPaymentPageUrl);
    },
  });

  /* ── WAVE 11 / EN-7 — plan change preview + apply ─────────────────────── */
  const [changePreview, setChangePreview] = useState<PlanChangePreviewT | null>(null);
  const previewMut = useMutation({
    mutationFn: async (target: { toTier?: string; toCycle?: "monthly" | "annual" }) =>
      (await apiRequest("POST", "/api/partner/me/subscription/change/preview", target)).json() as Promise<{ preview: PlanChangePreviewT }>,
    onSuccess: (r) => setChangePreview(r.preview),
  });
  const applyChangeMut = useMutation({
    mutationFn: async (target: { toTier?: string; toCycle?: "monthly" | "annual" }) =>
      (await apiRequest("POST", "/api/partner/me/subscription/change", target)).json(),
    onSuccess: () => {
      setChangePreview(null);
      void refetch();
    },
  });
  const cancelMut = useMutation({
    mutationFn: async (immediate: boolean) =>
      (await apiRequest("POST", "/api/partner/me/subscription/cancel", { immediate })).json(),
    onSuccess: () => void refetch(),
  });
  const lifecycle = data?.partnerSubscription ?? null;
  const lifecycleEvents = data?.partnerSubscriptionEvents ?? [];
  const enforcement = data?.enforcement ?? null;

  if (isForbidden) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" data-testid="partner-subscription-forbidden">
        Subscription details are visible to managing partners only.
      </div>
    );
  }
  if (isLoading) return <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="partner-subscription-loading">Loading…</div>;
  if (isError) return <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">Could not load subscription.</div>;

  return (
    <div className="space-y-4">
      {sub ? (
        <AppCard className="p-6 max-w-xl" data-testid="partner-subscription-card">
          <div className="text-xs uppercase tracking-wide text-[var(--cv-color-text-muted)]">Active subscription</div>
          <div className="mt-1 text-lg font-semibold text-[var(--cv-color-navy)]">{sub.tierId}</div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <dt className="text-[var(--cv-color-text-muted)]">Amount</dt>
            <dd className="font-mono">{formatMinor(sub.amountMinor, sub.currency)} / {sub.billingCycle}</dd>
            <dt className="text-[var(--cv-color-text-muted)]">Status</dt>
            <dd>{sub.status}</dd>
            <dt className="text-[var(--cv-color-text-muted)]">Renews</dt>
            <dd>{formatDate(sub.currentPeriodEnd)}</dd>
          </dl>
        </AppCard>
      ) : (
        <PartnerEmptyState
          title="You're not subscribed yet"
          description="You don't have an active subscription on file, so nothing is being billed right now. The quote below shows the price for your tier — that's what you'd pay if you start a subscription. Choose a billing cycle, get your quote, and check out when you're ready."
        />
      )}

      {/* ════════════════════════════════════════════════════════════════
          WAVE 11 / EN-6 + EN-7 + EN-8 — the subscription LIFECYCLE.

          "Existing functionality must be reflected in the UI." The engines
          added this wave write status transitions, prorated plan changes and
          grace/suspension decisions. All of that was invisible until here.
          These panels are ADDITIVE — the legacy `Active subscription` card
          above is untouched and still reads the sacred store's row.
          ════════════════════════════════════════════════════════════════ */}
      {lifecycle && (
        <AppCard className="p-6 max-w-xl" data-testid="partner-subscription-lifecycle">
          <div className="text-xs uppercase tracking-wide text-[var(--cv-color-text-muted)]">
            Subscription lifecycle
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <dt className="text-[var(--cv-color-text-muted)]">Plan</dt>
            <dd className="font-mono">
              {lifecycle.tierSlug} / {lifecycle.cycle}
            </dd>
            <dt className="text-[var(--cv-color-text-muted)]">Charged</dt>
            <dd className="font-mono" data-testid="lifecycle-amount">
              {formatMinor(lifecycle.amountMinor, lifecycle.currency)}
            </dd>
            <dt className="text-[var(--cv-color-text-muted)]">Status</dt>
            <dd data-testid="lifecycle-status">{lifecycle.status}</dd>
            <dt className="text-[var(--cv-color-text-muted)]">Period ends</dt>
            <dd>{formatDate(lifecycle.currentPeriodEnd)}</dd>
            {lifecycle.graceUntil && (
              <>
                <dt className="text-[var(--cv-color-text-muted)]">Grace until</dt>
                <dd data-testid="lifecycle-grace-until">{formatDate(lifecycle.graceUntil)}</dd>
              </>
            )}
          </dl>

          {/* EN-8 — what the enforcement sweep will do next, stated plainly.
              This is REPORTING ONLY: suspension changes billing status, never
              navigation, permissions or access. */}
          {enforcement && (
            <div className="mt-4 rounded-md border border-[var(--cv-color-border)] p-3 text-xs" data-testid="partner-enforcement-projection">
              <div className="font-medium text-[var(--cv-color-navy)]">Non-payment policy</div>
              {enforcement.configMissing ? (
                <div className="mt-1 text-amber-800" data-testid="enforcement-config-missing">
                  The grace-period policy ({enforcement.configKey}) is not set to a usable value, so
                  no automatic suspension will run. Contact your Capavate administrator.
                </div>
              ) : (
                <div className="mt-1 text-[var(--cv-color-text-muted)]">
                  Grace period after expiry: <span className="font-mono">{enforcement.graceDays}</span> day(s).
                </div>
              )}
              {enforcement.subscriptions.map((e) => (
                <div key={e.id} className="mt-1 text-[var(--cv-color-text-muted)]" data-testid="enforcement-next-action">
                  {e.projectedNextAction}
                </div>
              ))}
            </div>
          )}

          {/* EN-7 — plan change with a prorated credit, previewed before it is
              applied. The net can be NEGATIVE: that is a credit owed to the
              partner and it is shown as one, never hidden. */}
          <div className="mt-4" data-testid="partner-plan-change">
            <div className="text-xs font-medium text-[var(--cv-color-navy)]">Change plan</div>
            <div className="mt-2 flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                data-testid="plan-change-preview-btn"
                disabled={previewMut.isPending}
                onClick={() =>
                  previewMut.mutate({ toCycle: lifecycle.cycle === "annual" ? "monthly" : "annual" })
                }
              >
                {previewMut.isPending
                  ? "Calculating…"
                  : `Preview switch to ${lifecycle.cycle === "annual" ? "monthly" : "annual"}`}
              </Button>
              <Button
                size="sm"
                variant="outline"
                data-testid="subscription-cancel-btn"
                disabled={cancelMut.isPending}
                onClick={() => cancelMut.mutate(false)}
              >
                {cancelMut.isPending ? "Working…" : "Cancel at period end"}
              </Button>
            </div>
            {previewMut.isError && (
              <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900" data-testid="plan-change-error">
                {previewMut.error instanceof Error ? previewMut.error.message : "Could not price this change."}
              </div>
            )}
            {changePreview && (
              <div className="mt-2 rounded-md border border-[var(--cv-color-border)] p-3 text-xs" data-testid="plan-change-preview">
                <div className="font-mono">
                  {changePreview.fromTier}/{changePreview.fromCycle} → {changePreview.toTier}/
                  {changePreview.toCycle}
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-1">
                  <dt className="text-[var(--cv-color-text-muted)]">Unused credit</dt>
                  <dd className="font-mono" data-testid="plan-change-credit">
                    {formatMinor(changePreview.unusedCreditMinor, changePreview.currency)}
                  </dd>
                  <dt className="text-[var(--cv-color-text-muted)]">New charge (remainder)</dt>
                  <dd className="font-mono" data-testid="plan-change-charge">
                    {formatMinor(changePreview.newChargeMinor, changePreview.currency)}
                  </dd>
                  <dt className="text-[var(--cv-color-text-muted)]">
                    {changePreview.netDueMinor >= 0 ? "Net due now" : "Net credit to you"}
                  </dt>
                  <dd className="font-mono" data-testid="plan-change-net">
                    {formatMinor(Math.abs(changePreview.netDueMinor), changePreview.currency)}
                  </dd>
                </dl>
                <div className="mt-2 text-[var(--cv-color-text-muted)]" data-testid="plan-change-explanation">
                  {changePreview.explanation}
                </div>
                <Button
                  size="sm"
                  className="mt-3"
                  data-testid="plan-change-apply-btn"
                  disabled={applyChangeMut.isPending}
                  onClick={() =>
                    applyChangeMut.mutate({
                      toTier: changePreview.toTier,
                      toCycle: changePreview.toCycle as "monthly" | "annual",
                    })
                  }
                >
                  {applyChangeMut.isPending ? "Applying…" : "Confirm plan change"}
                </Button>
              </div>
            )}
          </div>

          {/* The append-only audit, surfaced. Every transition above was
              written to partner_subscription_event; a lifecycle the partner
              cannot inspect is a lifecycle they cannot dispute. */}
          {lifecycleEvents.length > 0 && (
            <div className="mt-4" data-testid="partner-subscription-events">
              <div className="text-xs font-medium text-[var(--cv-color-navy)]">Billing history</div>
              <ul className="mt-2 space-y-1 text-xs text-[var(--cv-color-text-muted)]">
                {lifecycleEvents.slice(-8).reverse().map((e) => (
                  <li key={e.id} className="flex justify-between gap-3">
                    <span className="font-mono">{e.eventKind}</span>
                    <span>
                      {e.fromStatus ? `${e.fromStatus} → ` : ""}
                      {e.toStatus ?? "—"}
                    </span>
                    <span>{formatDate(e.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </AppCard>
      )}

      {data?.lifecycleUnavailable && (
        <div
          className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
          data-testid="partner-lifecycle-unavailable"
        >
          Subscription lifecycle data could not be read: {data.lifecycleUnavailable}
        </div>
      )}

      {/* Merged tier-quote + checkout flow (9a). */}
      <AppCard className="p-6 max-w-xl" data-testid="partner-subscribe-quote">
        <div className="text-xs uppercase tracking-wide text-[var(--cv-color-text-muted)]">Subscription tier quote</div>
        <div className="mt-1 text-xs text-[var(--cv-color-text-muted)]">
          This is your tier's price (including any individual discount applied to your account). It is a
          quote only — you are not charged until you complete checkout.
        </div>
        <div className="mt-3 flex items-center gap-2">
          <select
            data-testid="subscribe-cycle"
            value={cycle}
            onChange={(e) => { setCycle(e.target.value as "monthly" | "annual"); setQuote(null); }}
            className="border rounded px-2 py-1 text-sm"
          >
            <option value="monthly">Monthly</option>
            <option value="annual">Annual</option>
          </select>
          <Button size="sm" data-testid="subscribe-quote-btn" disabled={quoteMut.isPending} onClick={() => quoteMut.mutate()}>
            {quoteMut.isPending ? "Resolving…" : "Get quote"}
          </Button>
        </div>
        {quoteMut.isError && (
          <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900" data-testid="subscribe-quote-error">
            {quoteMut.error instanceof Error ? quoteMut.error.message : "Could not resolve a price for this tier."}
          </div>
        )}
        {/* W-V44 FIX N7 (revised per deciding review B2) — a quote can resolve
            without throwing yet carry no usable amount (no price configured for
            the chosen cycle), which previously rendered NOTHING (silent failure).
            BUT an explicit per-partner $0 override is a LEGITIMATE quote (the
            server returns computedVia === "partner_override" with amountMinor 0),
            so $0 must render a real quote + checkout, NOT the "no price" warning.
            A valid quote = a numeric amount >= 0 (>0, OR exactly 0 via override). */}
        {(() => {
          if (!quote) return null;
          const amt = quote.amountMinor;
          const isNumeric = typeof amt === "number" && Number.isFinite(amt);
          const isExplicitFreeOverride =
            isNumeric && amt === 0 && quote.computedVia === "partner_override";
          const isValidQuote = isNumeric && (amt > 0 || isExplicitFreeOverride);
          if (isValidQuote) {
            return (
              <div className="mt-3 text-sm" data-testid="subscribe-quote-result">
                <div className="font-mono text-lg text-[var(--cv-color-navy)]">
                  {formatMinor(amt, quote.currency)} / {quote.cycle}
                </div>
                <div className="mt-1 text-xs text-[var(--cv-color-text-muted)]">Tier: {quote.tier}</div>
                {/* WAVE 11 / EN-6 — the element, its testid, its Button and its
                    copy are all PRESERVED; only the behaviour is fixed. The href
                    is a real fallback target (the hosted payment page once we
                    have one), and the click POSTs to the partner-scoped checkout
                    instead of GET-navigating to a POST-only founder route. */}
                <a
                  href={checkout?.hostedPaymentPageUrl ?? quote.checkoutPath}
                  data-testid="subscribe-checkout-link"
                  onClick={(e) => {
                    if (checkout?.hostedPaymentPageUrl) return; /* already minted — follow it */
                    e.preventDefault();
                    if (!checkoutMut.isPending) checkoutMut.mutate();
                  }}
                >
                  {/* The LABEL stays literal. Making it conditional replaced the
                      copy string "Proceed to checkout" with an expression, and
                      the silent-drop guard correctly reported it as REMOVED —
                      a partner scanning for that button would have found a
                      different one. The pending state is shown beside it. */}
                  <Button size="sm" className="mt-3" disabled={checkoutMut.isPending}>
                    Proceed to checkout
                  </Button>
                </a>
                {checkoutMut.isPending && (
                  <div
                    className="mt-2 text-xs text-[var(--cv-color-text-muted)]"
                    data-testid="subscribe-checkout-pending"
                  >
                    Starting checkout…
                  </div>
                )}
                {checkoutMut.isError && (
                  <div
                    className="mt-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900"
                    data-testid="subscribe-checkout-error"
                  >
                    {checkoutMut.error instanceof Error
                      ? checkoutMut.error.message
                      : "Checkout could not be started."}
                  </div>
                )}
                {checkout && (
                  <div className="mt-2 text-xs text-[var(--cv-color-text-muted)]" data-testid="subscribe-checkout-started">
                    Payment started ({checkout.gatewayStatus}) for {formatMinor(checkout.amountMinor, checkout.currency)}
                    {checkout.stubMode ? " — the payment provider is in test mode, so the subscription was activated immediately." : "."}
                  </div>
                )}
              </div>
            );
          }
          return (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900" data-testid="subscribe-quote-none">
              No {cycle} price is currently configured for your tier. Try the other billing
              cycle, or contact your Capavate administrator to set this tier&rsquo;s {cycle} price.
            </div>
          );
        })()}
      </AppCard>
    </div>
  );
}

/* ============================================================
 * SPV Fees tab (v25.33) — GET /api/partner/me/spv-fees. Multi-currency totals.
 * ============================================================ */
type SpvFeeEntry = {
  id: string; entryKind: string; spvFundId: string | null; spvName: string | null;
  dealRef: string | null; feeMinor: number; computedVia: string | null;
  status: string; paidAt: string | null; createdAt: string; currency: string;
};
type SpvFeesResponse = { entries: SpvFeeEntry[]; totalsByCurrency: Record<string, { pending: number; paid: number }> };

const SPV_KIND_LABELS: Record<string, string> = {
  spv_deployment_fee: "Deployment",
  spv_management_fee: "Management",
  spv_closing_bonus: "Closing bonus",
};

function SpvFeesTab({ ready }: { ready: boolean }) {
  const { data, isLoading, isError, error } = useQuery<SpvFeesResponse>({
    queryKey: ["/api/partner/me/spv-fees"],
    enabled: ready,
    retry: false,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/spv-fees")).json(),
  });
  const isForbidden = isError && error instanceof ApiError && error.status === 403;
  const entries = data?.entries ?? [];
  const totals = data?.totalsByCurrency ?? {};
  const currencies = Object.keys(totals);

  if (isForbidden) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" data-testid="partner-spvfees-forbidden">
        SPV fee details are visible to managing partners only.
      </div>
    );
  }
  if (isError) return <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">Could not load SPV fees.</div>;

  return (
    <>
      {currencies.length > 0 && (
        <div className="mb-4 space-y-3" data-testid="partner-spvfees-totals">
          {currencies.map((ccy) => (
            <div key={ccy} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <AppCard className="p-4">
                <div className="text-xs uppercase tracking-wide text-[var(--cv-color-text-muted)]">Pending SPV fees ({ccy})</div>
                <div className="mt-1 font-mono text-lg">{formatMinor(totals[ccy].pending, ccy)}</div>
              </AppCard>
              <AppCard className="p-4">
                <div className="text-xs uppercase tracking-wide text-[var(--cv-color-text-muted)]">Paid SPV fees ({ccy})</div>
                <div className="mt-1 font-mono text-lg">{formatMinor(totals[ccy].paid, ccy)}</div>
              </AppCard>
            </div>
          ))}
        </div>
      )}

      {isLoading && <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="partner-spvfees-loading">Loading…</div>}

      {!isLoading && entries.length === 0 && (
        <PartnerEmptyState
          title="No SPV fees yet"
          description="SPV deployment and management fees appear here as the SPVs you source are deployed."
        />
      )}

      {!isLoading && entries.length > 0 && (
        <AppCard className="overflow-hidden" data-testid="partner-spvfees-table">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-[var(--cv-color-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--cv-color-text-muted)]">
                <tr>
                  <th className="px-4 py-2">SPV</th>
                  <th className="px-4 py-2">Kind</th>
                  <th className="px-4 py-2 text-right">Fee</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Created</th>
                  <th className="px-4 py-2">Paid</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-b last:border-0" data-testid={`partner-spvfees-row-${e.id}`}>
                    <td className="px-4 py-2 font-medium">{e.spvName || e.spvFundId || e.dealRef || "—"}</td>
                    <td className="px-4 py-2">{SPV_KIND_LABELS[e.entryKind] || e.entryKind}</td>
                    <td className="px-4 py-2 text-right font-mono">{formatMinor(e.feeMinor, e.currency)}</td>
                    <td className="px-4 py-2">
                      <span
                        className={
                          e.status === "paid"
                            ? "inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800"
                            : "inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
                        }
                      >
                        {e.status}
                      </span>
                    </td>
                    <td className="px-4 py-2">{formatDate(e.createdAt)}</td>
                    <td className="px-4 py-2">{formatDate(e.paidAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AppCard>
      )}
    </>
  );
}

/* ============================================================
 * Tax Forms tab (v25.33) — GET /api/partner/me/tax-forms (read-only summary).
 * Full submission flow lives on the dedicated /collective/partner/tax-form page.
 * v25.50 REVISE R2 (item 4) — this tab is an INTENTIONAL quick-view mirror of the
 * dedicated /tax-form page (per QA deck slide 8, which shows Billing WITH a Tax
 * Forms tab). It is NOT a duplicate to remove — keep both surfaces (Rule #78).
 * ============================================================ */
type TaxForm = {
  id: string; formType: string; jurisdiction: string;
  collectedAt: string; expiresAt: string | null; documentUrl: string | null;
};

function TaxFormsTab({ ready }: { ready: boolean }) {
  const { data, isLoading, isError, error } = useQuery<{ forms: TaxForm[] }>({
    queryKey: ["/api/partner/me/tax-forms"],
    enabled: ready,
    retry: false,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/tax-forms")).json(),
  });
  const isForbidden = isError && error instanceof ApiError && error.status === 403;
  const forms = data?.forms ?? [];

  if (isForbidden) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" data-testid="partner-taxforms-forbidden">
        Tax form details are visible to managing partners only.
      </div>
    );
  }
  if (isError) return <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">Could not load tax forms.</div>;

  return (
    <>
      <div className="mb-4 text-sm text-[var(--cv-color-text-secondary)]">
        Submit or update a tax form on the{" "}
        <Link href="/collective/partner/tax-form" className="text-[var(--cv-color-primary)] hover:underline">Tax Forms page</Link>.
      </div>
      {isLoading && <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="partner-taxforms-loading">Loading…</div>}
      {!isLoading && forms.length === 0 && (
        <PartnerEmptyState
          title="No tax forms on file"
          description="A W-9, W-8BEN, or T4A is required before commission or SPV-fee payouts can be remitted."
        />
      )}
      {!isLoading && forms.length > 0 && (
        <AppCard className="overflow-hidden" data-testid="partner-taxforms-table">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-[var(--cv-color-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--cv-color-text-muted)]">
                <tr>
                  <th className="px-4 py-2">Form</th>
                  <th className="px-4 py-2">Jurisdiction</th>
                  <th className="px-4 py-2">Collected</th>
                  <th className="px-4 py-2">Expires</th>
                </tr>
              </thead>
              <tbody>
                {forms.map((tf) => (
                  <tr key={tf.id} className="border-b last:border-0" data-testid={`partner-taxforms-row-${tf.id}`}>
                    <td className="px-4 py-2 font-medium">{tf.formType}</td>
                    <td className="px-4 py-2">{tf.jurisdiction}</td>
                    <td className="px-4 py-2">{formatDate(tf.collectedAt)}</td>
                    <td className="px-4 py-2">{formatDate(tf.expiresAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AppCard>
      )}
    </>
  );
}

/* ============================================================
 * Invoices tab (v25.50 Phase 7, spec 8) — a consolidated, downloadable invoice
 * view DERIVED from the partner's existing DB-backed ledgers (referral
 * commissions + SPV fees). No new table/migration: this is a read-only rollup
 * of rows the server already returns. CSV export is client-side (Blob), so no
 * new endpoint is introduced. Auth mirrors the source endpoints (managing_partner).
 * ============================================================ */
type InvoiceLine = { id: string; date: string; kind: string; reference: string; amountMinor: number; currency: string; status: string };

function InvoicesTab({ ready }: { ready: boolean }) {
  const billing = useQuery<BillingResponse>({
    queryKey: ["/api/partner/me/billing"],
    enabled: ready, retry: false,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/billing")).json(),
  });
  const spvFees = useQuery<SpvFeesResponse>({
    queryKey: ["/api/partner/me/spv-fees"],
    enabled: ready, retry: false,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/spv-fees")).json(),
  });

  const isForbidden =
    (billing.isError && billing.error instanceof ApiError && billing.error.status === 403) ||
    (spvFees.isError && spvFees.error instanceof ApiError && spvFees.error.status === 403);

  /* ══════════════════════════════════════════════════════════════════
     WAVE 73 · ITEM 3 (finishes WAVE 69 · V-3) — THIS TAB TOLD THE PARTNER THERE
     WERE NO LINE ITEMS WHEN THE READ HAD BEEN REFUSED.
     ══════════════════════════════════════════════════════════════════
     Wave 69 treated ONE of the eight partner billing tabs. On this one the same
     409 from `commissionPctOrRefuse()` left `billing.data` undefined, `lines`
     empty, and the tab rendered

         "No invoice line items yet"

     — which is not merely generic copy, it is a FALSE STATEMENT: there are no
     rows because the server refused to compute them, not because none exist.
     So the empty state is NARROWED (it still renders, byte-identical, whenever
     the read genuinely succeeded and returned nothing) and the server's own
     sentence is APPENDED as a new sibling at the end of the tab.

     Branching on `error.code`, not `error.message`: the 431-character sentence is
     over `queryClient`'s 240-character gate, so `message` here is the generic
     substitute. The text is read off the payload through Wave 69's module. */
  const commissionRefused =
    billing.isError &&
    billing.error instanceof ApiError &&
    billing.error.status === 409 &&
    billing.error.code === "PARTNER_COMMISSION_RATE_UNRESOLVED";
  const commissionRefusedReason = commissionRefused ? serverRefusalMessage(billing.error) : null;

  const lines: InvoiceLine[] = [
    ...(billing.data?.entries ?? []).map((e) => ({
      id: e.id, date: e.date, kind: "Referral commission", reference: e.dealId,
      amountMinor: e.commissionMinor, currency: e.currency, status: e.status,
    })),
    ...(spvFees.data?.entries ?? []).map((e) => ({
      id: e.id, date: e.createdAt, kind: SPV_KIND_LABELS[e.entryKind] || e.entryKind,
      reference: e.spvName || e.spvFundId || e.dealRef || "—", amountMinor: e.feeMinor,
      currency: e.currency, status: e.status,
    })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));

  const downloadCsv = () => {
    const header = ["Date", "Kind", "Reference", "Amount", "Currency", "Status"];
    const rows = lines.map((l) => [
      formatDate(l.date), l.kind, l.reference,
      /* WAVE 21 · ITEM 5 (REVIEW A, was :896). This CSV divided EVERY amount by
         100 regardless of `l.currency`, so a ¥12,345 line exported as 123.45.
         `minorToMajorString` uses the row's own ISO-4217 exponent. */
      minorToMajorString(l.amountMinor, l.currency), l.currency, l.status,
    ]);
    const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `partner-invoices-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isForbidden) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" data-testid="partner-invoices-forbidden">
        Invoice details are visible to managing partners only.
      </div>
    );
  }

  const isLoading = billing.isLoading || spvFees.isLoading;

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <div className="text-sm text-[var(--cv-color-text-secondary)]">
          A consolidated view of your commission and SPV-fee line items.
        </div>
        <Button size="sm" variant="outline" data-testid="invoices-download-csv" disabled={lines.length === 0} onClick={downloadCsv}>
          Download CSV
        </Button>
      </div>
      {isLoading && <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="partner-invoices-loading">Loading…</div>}
      {/* WAVE 73 · ITEM 3 — CONDITION NARROWED, COPY UNTOUCHED (R44). The empty
          state is true when the read SUCCEEDED and returned nothing, and it still
          renders for that, word for word. */}
      {!isLoading && lines.length === 0 && !commissionRefused && (
        <PartnerEmptyState
          title="No invoice line items yet"
          description="Commission and SPV-fee entries appear here as deals are funded and SPVs deployed."
        />
      )}
      {!isLoading && lines.length > 0 && (
        <AppCard className="overflow-hidden" data-testid="partner-invoices-table">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-[var(--cv-color-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--cv-color-text-muted)]">
                <tr>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Kind</th>
                  <th className="px-4 py-2">Reference</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className="border-b last:border-0" data-testid={`partner-invoices-row-${l.id}`}>
                    <td className="px-4 py-2">{formatDate(l.date)}</td>
                    <td className="px-4 py-2">{l.kind}</td>
                    <td className="px-4 py-2 font-mono text-xs">{l.reference}</td>
                    <td className="px-4 py-2 text-right font-mono">{formatMinor(l.amountMinor, l.currency)}</td>
                    <td className="px-4 py-2">{l.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AppCard>
      )}
      {/* WAVE 73 · ITEM 3 — APPENDED AT THE END as a new sibling (the guard's
          ordinal trap: inserting at the head of a container reads as a mass
          removal). Nothing above is moved, removed or re-nested. */}
      {commissionRefused && (
        <div
          className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
          role="alert"
          data-testid="partner-invoices-rate-unresolved"
        >
          {commissionRefusedReason ??
            "Your commission line items cannot be computed: no commission rate is configured for your tier. Nothing has been charged, paid or recorded, and no default rate has been assumed. This is not an empty ledger — an administrator has to configure the rate for your tier."}
        </div>
      )}
    </>
  );
}


/* ═════════════════════════════════════════════════════════════════════════
 * WAVE 14 — CP-SUB-09 / CP-COM-02 / CP-COM-04 / CP-COM-05.
 *
 * The `Invoices` tab above is a DERIVED view: it stitches commission entries
 * and SPV-fee entries into a pseudo-ledger client-side. That is useful and is
 * left EXACTLY as it was. It is not, however, the consolidated invoice the
 * server can now issue — `partner_invoice` + `partner_invoice_line`, whose cent
 * conservation is enforced by database triggers and re-checked on read.
 *
 * So this is a SECOND, additive tab rather than a rewrite of the first: the two
 * answer different questions ("what have I earned/owed line by line" vs "what
 * invoices has the platform issued me"), and collapsing them would drop one.
 *
 * CONSERVATION IS SHOWN, NOT HIDDEN. If the server reports `conserved: false`
 * the row is rendered with its delta and a warning instead of being omitted —
 * an invoice that does not add up is the single most important thing a partner
 * could need to see on this page.
 * ═══════════════════════════════════════════════════════════════════════ */

type IssuedInvoiceLine = {
  id: string;
  entryKind: string;
  description: string;
  amountMinor: number;
  settlementState: string;
  sourceRef: string | null;
};

/* Mirrors `Invoice` (server/lib/partnerBillingStore.ts:854) plus the four fields
   the route computes. There is deliberately NO `createdAt`: the engine's mapper
   does not project it, so the table falls back to `issuedAt` rather than
   rendering `undefined` through a date formatter. */
type IssuedInvoice = {
  id: string;
  partnerId: string;
  invoiceNumber: string;
  status: "draft" | "issued" | "paid" | "void" | "uncollectible";
  currency: string;
  totalMinor: number;
  periodStart: string | null;
  periodEnd: string | null;
  issuedAt: string | null;
  paidAt: string | null;
  lines: IssuedInvoiceLine[];
  conserved: boolean;
  lineSumMinor: number;
  deltaMinor: number;
  entryKinds: string[];
  pendingMinor: number;
  paidMinor: number;
};

type IssuedInvoicesResponse = {
  ok: boolean;
  invoices: IssuedInvoice[];
  total: number;
  entryKinds: string[];
};

/* WAVE 21 · ITEM 2 (REVIEW A CRITICAL, was :1089-1109) — the server no longer
   returns a cross-currency sum, so these scalars are `number | null` and
   `currency` is `string | null`. `byCurrency` is authoritative. */
type MinorByCurrency = { currency: string; pendingMinor: number; paidMinor: number };
type CommissionSummaryResponse = {
  ok: boolean;
  /** null when the partner's lines span more than one currency. */
  pendingMinor: number | null;
  paidMinor: number | null;
  totalMinor: number | null;
  /** null when mixed — never a fabricated "USD". */
  currency: string | null;
  /** True when the partner's invoice lines span more than one currency. */
  mixed: boolean;
  currencies?: string[];
  byCurrency?: MinorByCurrency[];
  totalByCurrency?: Array<{ currency: string; totalMinor: number }>;
  byKind: Record<string, {
    pendingMinor: number | null;
    paidMinor: number | null;
    byCurrency?: MinorByCurrency[];
  }>;
  commissionOnly: { pendingMinor: number; paidMinor: number };
  entryKinds: string[];
};

/** CP-COM-05 — labels for the five schema-defined entry kinds. */
const ENTRY_KIND_LABELS: Record<string, string> = {
  subscription: "Subscription",
  commission: "Referral commission",
  spv_fee: "SPV fee",
  adjustment: "Adjustment",
  refund: "Refund",
};

function IssuedInvoicesTab({ ready }: { ready: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const invoices = useQuery<IssuedInvoicesResponse>({
    queryKey: ["/api/partner/me/invoices"],
    enabled: ready,
    retry: false,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/invoices")).json(),
  });
  const summary = useQuery<CommissionSummaryResponse>({
    queryKey: ["/api/partner/me/commission-summary"],
    enabled: ready,
    retry: false,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/commission-summary")).json(),
  });

  if (invoices.isError && invoices.error instanceof ApiError && invoices.error.status === 403) {
    return (
      <PartnerEmptyState
        title="Issued invoices are scoped to the managing partner"
        description="Your subrole can view commissions but not the platform's issued invoices. Ask your managing partner for access."
      />
    );
  }
  if (invoices.isLoading) {
    return <div className="text-sm text-muted-foreground" data-testid="partner-issued-invoices-loading">Loading issued invoices…</div>;
  }

  const rows = invoices.data?.invoices ?? [];
  const unconserved = rows.filter((r) => !r.conserved);

  return (
    <>
      {/* CP-COM-04 — pending vs paid, split by entry kind, from the server's
          own allocator-backed split. No client arithmetic on money here. */}
      <AppCard title="Commission position" data-testid="partner-commission-summary">
        {summary.isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : summary.data ? (
          <div className="space-y-3">
            {summary.data.mixed ? (
              /* WAVE 21 · ITEM 2. WAS: this branch rendered an amber warning and
                 then rendered the three USD cards ANYWAY, from server totals
                 that had summed JPY minor units into a "USD" figure. A warning
                 does not make invalid arithmetic valid. The single-scalar cards
                 are now REPLACED (not annotated) by a per-currency table. */
              <div className="space-y-2" data-testid="partner-commission-mixed-currency">
                <div className="rounded-md border border-amber-500 bg-amber-500/10 p-2 text-xs">
                  Your invoice lines span {(summary.data.currencies ?? []).join(", ") || "more than one currency"}.
                  A single combined total is <strong>not available</strong>: amounts in different currencies cannot be
                  added, and no FX conversion is configured on this platform. Each currency is shown separately below.
                </div>
                <table className="w-full text-sm" data-testid="table-partner-commission-by-currency">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2">Currency</th>
                      <th className="px-3 py-2 text-right">Pending</th>
                      <th className="px-3 py-2 text-right">Paid</th>
                      <th className="px-3 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(summary.data.byCurrency ?? []).map((c) => (
                      <tr className="border-b last:border-0" key={c.currency} data-testid={`partner-commission-currency-${c.currency}`}>
                        <td className="px-3 py-2 font-medium">{c.currency}</td>
                        <td className="px-3 py-2 text-right font-mono">{formatMinor(c.pendingMinor, c.currency)}</td>
                        <td className="px-3 py-2 text-right font-mono">{formatMinor(c.paidMinor, c.currency)}</td>
                        <td className="px-3 py-2 text-right font-mono">{formatMinor(c.pendingMinor + c.paidMinor, c.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-md border p-3" data-testid="partner-commission-pending">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Pending</div>
                  <div className="mt-1 font-mono text-lg">{formatMinorOrUnavailable(summary.data.pendingMinor, summary.data.currency)}</div>
                </div>
                <div className="rounded-md border p-3" data-testid="partner-commission-paid">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Paid</div>
                  <div className="mt-1 font-mono text-lg">{formatMinorOrUnavailable(summary.data.paidMinor, summary.data.currency)}</div>
                </div>
                <div className="rounded-md border p-3" data-testid="partner-commission-total">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Total</div>
                  <div className="mt-1 font-mono text-lg">{formatMinorOrUnavailable(summary.data.totalMinor, summary.data.currency)}</div>
                </div>
              </div>
            )}
            <table className="w-full text-sm" data-testid="table-partner-commission-by-kind">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2">Entry kind</th>
                  <th className="px-3 py-2 text-right">Pending</th>
                  <th className="px-3 py-2 text-right">Paid</th>
                </tr>
              </thead>
              <tbody>
                {(summary.data.entryKinds ?? []).map((kind) => {
                  const v = summary.data?.byKind?.[kind];
                  const per = v?.byCurrency ?? [];
                  /* WAVE 21 · ITEM 2 — when a kind spans currencies its scalars
                     are null; show each currency on its own line rather than a
                     sum stamped with one currency code. */
                  if (per.length > 1) {
                    return (
                      <tr className="border-b last:border-0" key={kind} data-testid={`partner-commission-kind-${kind}`}>
                        <td className="px-3 py-2">{ENTRY_KIND_LABELS[kind] ?? kind}</td>
                        <td className="px-3 py-2 text-right font-mono" colSpan={2}>
                          {per.map((c) => (
                            <div key={c.currency}>
                              {c.currency}: {formatMinor(c.pendingMinor, c.currency)} pending · {formatMinor(c.paidMinor, c.currency)} paid
                            </div>
                          ))}
                        </td>
                      </tr>
                    );
                  }
                  const cur = per[0]?.currency ?? summary.data?.currency ?? null;
                  const pend = per.length === 1 ? per[0]!.pendingMinor : (v?.pendingMinor ?? 0);
                  const paid = per.length === 1 ? per[0]!.paidMinor : (v?.paidMinor ?? 0);
                  return (
                    <tr className="border-b last:border-0" key={kind} data-testid={`partner-commission-kind-${kind}`}>
                      <td className="px-3 py-2">{ENTRY_KIND_LABELS[kind] ?? kind}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatMinorOrUnavailable(pend, cur)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatMinorOrUnavailable(paid, cur)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground" data-testid="partner-commission-only-note">
              Referral commission lines alone: {formatMinorOrUnavailable(summary.data.commissionOnly.pendingMinor, summary.data.currency)} pending
              · {formatMinorOrUnavailable(summary.data.commissionOnly.paidMinor, summary.data.currency)} paid. Waived and failed lines are
              excluded from both totals and remain visible on the invoice itself.
            </p>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">Commission position unavailable.</div>
        )}
      </AppCard>

      {unconserved.length > 0 && (
        /* A non-conserving invoice is a data-integrity fact the partner is
           entitled to see. It is never hidden and never silently corrected. */
        <div
          className="mt-4 rounded-md border border-destructive bg-destructive/10 p-3 text-sm"
          data-testid="partner-invoice-conservation-warning"
        >
          <strong>{unconserved.length}</strong> invoice{unconserved.length === 1 ? "" : "s"} do not reconcile against their
          line items. These are shown below with the exact discrepancy. Please contact platform support before paying —
          do not attempt to reconcile them yourself.
        </div>
      )}

      <div className="mt-4">
        <AppCard title={`Issued invoices (${rows.length})`} data-testid="partner-issued-invoices">
          {rows.length === 0 ? (
            <PartnerEmptyState
              title="No issued invoices yet"
              description="Consolidated invoices appear here once the platform issues one. Your line-by-line commission and SPV-fee activity is on the Invoices tab."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-partner-issued-invoices">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2">Invoice</th>
                    <th className="px-4 py-2">Period</th>
                    <th className="px-4 py-2">Contents</th>
                    <th className="px-4 py-2 text-right">Total</th>
                    <th className="px-4 py-2 text-right">Outstanding</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((inv) => (
                    /* Fragment with a key: an invoice renders TWO sibling rows
                       (summary + expanded lines), so the key belongs on the
                       fragment, not on one of the rows. */
                    <Fragment key={inv.id}>
                      <tr
                        className={`border-b last:border-0 ${inv.conserved ? "" : "bg-destructive/5"}`}
                        data-testid={`partner-issued-invoice-row-${inv.id}`}
                      >
                        <td className="px-4 py-2 font-mono text-xs">{inv.invoiceNumber}</td>
                        <td className="px-4 py-2">
                          {inv.periodStart
                            ? `${formatDate(inv.periodStart)} → ${formatDate(inv.periodEnd)}`
                            : formatDate(inv.issuedAt)}
                        </td>
                        <td className="px-4 py-2 text-xs">
                          {(inv.entryKinds ?? []).map((k) => ENTRY_KIND_LABELS[k] ?? k).join(" · ") || "—"}
                        </td>
                        <td className="px-4 py-2 text-right font-mono">{formatMinor(inv.totalMinor, inv.currency)}</td>
                        <td className="px-4 py-2 text-right font-mono">{formatMinor(inv.pendingMinor, inv.currency)}</td>
                        <td className="px-4 py-2">
                          {inv.conserved ? (
                            inv.status
                          ) : (
                            <span className="text-destructive" data-testid={`partner-invoice-unconserved-${inv.id}`}>
                              {inv.status} — off by {formatMinor(inv.deltaMinor, inv.currency)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setOpenId(openId === inv.id ? null : inv.id)}
                            data-testid={`button-partner-invoice-lines-${inv.id}`}
                          >
                            {openId === inv.id ? "Hide lines" : `${inv.lines.length} lines`}
                          </Button>
                        </td>
                      </tr>
                      {openId === inv.id && (
                        <tr className="border-b bg-muted/30">
                          <td className="px-4 py-3" colSpan={7}>
                            <table className="w-full text-xs" data-testid={`table-partner-invoice-lines-${inv.id}`}>
                              <thead>
                                <tr className="text-left uppercase tracking-wide text-muted-foreground">
                                  <th className="px-2 py-1">Kind</th>
                                  <th className="px-2 py-1">Description</th>
                                  <th className="px-2 py-1">Source</th>
                                  <th className="px-2 py-1 text-right">Amount</th>
                                  <th className="px-2 py-1">Settlement</th>
                                </tr>
                              </thead>
                              <tbody>
                                {inv.lines.map((l) => (
                                  <tr key={l.id} data-testid={`partner-invoice-line-${l.id}`}>
                                    <td className="px-2 py-1">{ENTRY_KIND_LABELS[l.entryKind] ?? l.entryKind}</td>
                                    <td className="px-2 py-1">{l.description}</td>
                                    <td className="px-2 py-1 font-mono">{l.sourceRef ?? "—"}</td>
                                    <td className="px-2 py-1 text-right font-mono">{formatMinor(l.amountMinor, inv.currency)}</td>
                                    <td className="px-2 py-1">{l.settlementState}</td>
                                  </tr>
                                ))}
                                <tr className="border-t font-medium">
                                  <td className="px-2 py-1" colSpan={3}>
                                    Lines sum
                                  </td>
                                  <td className="px-2 py-1 text-right font-mono">{formatMinor(inv.lineSumMinor, inv.currency)}</td>
                                  <td className="px-2 py-1">
                                    {inv.conserved ? "reconciles" : `≠ invoice total (${formatMinor(inv.deltaMinor, inv.currency)})`}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AppCard>
      </div>
    </>
  );
}

/* ── CP-SUB-11 + CP-SUB-15 + CP-PROMO-23 — history and money-event timeline ── */

/* Mirrors `PartnerSubscription` as returned by listSubscriptions / mapSub
   (server/lib/partnerBillingStore.ts:699) — field names verified at source, not
   guessed: the cadence field is `cadence` (not `cycle`), the promotion field is
   `discountCode` (not `promotionCode`), and the period fields are
   `periodStart`/`periodEnd`. */
type SubscriptionHistoryRow = {
  id: string;
  partnerId: string;
  tierSlug: string;
  cadence: string;
  status: string;
  amountMinor: number;
  listAmountMinor: number;
  discountMinor: number;
  currency: string;
  priceDerivation: string;
  discountCode: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  grandfatheredFrom: string | null;
  supersededBy: string | null;
  supersededReason: string | null;
  createdAt: string;
};

type MoneyEventRow = {
  id: string;
  eventName: string;
  subjectKind: string;
  subjectId: string;
  payload: unknown;
  emittedAt: string;
};

function SubscriptionHistoryTab({ ready }: { ready: boolean }) {
  const history = useQuery<{ ok: boolean; subscriptions: SubscriptionHistoryRow[]; superseded: SubscriptionHistoryRow[]; total: number }>({
    queryKey: ["/api/partner/me/subscription-history"],
    enabled: ready,
    retry: false,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/subscription-history")).json(),
  });
  const events = useQuery<{ ok: boolean; events: MoneyEventRow[]; total: number }>({
    queryKey: ["/api/partner/me/money-events"],
    enabled: ready,
    retry: false,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/money-events")).json(),
  });

  if (history.isError && history.error instanceof ApiError && history.error.status === 403) {
    return (
      <PartnerEmptyState
        title="Subscription history is scoped to the managing partner"
        description="Your subrole cannot view subscription and money-event history for this partner."
      />
    );
  }

  const rows = history.data?.subscriptions ?? [];

  return (
    <>
      <AppCard title={`Subscription history (${rows.length})`} data-testid="partner-subscription-history">
        {history.isLoading ? (
          <div className="text-sm text-muted-foreground">Loading history…</div>
        ) : rows.length === 0 ? (
          <PartnerEmptyState
            title="No subscription records"
            description="Consortium Partners earn commissions rather than paying subscriptions, so this is expected unless a plan was purchased."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="table-partner-subscription-history">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2">Tier</th>
                  <th className="px-4 py-2">Cadence</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2 text-right">List</th>
                  <th className="px-4 py-2 text-right">Discount</th>
                  <th className="px-4 py-2 text-right">Charged</th>
                  <th className="px-4 py-2">Price basis</th>
                  <th className="px-4 py-2">Period start</th>
                  <th className="px-4 py-2">Period end</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr className="border-b last:border-0" key={r.id} data-testid={`partner-subscription-history-row-${r.id}`}>
                    <td className="px-4 py-2">{r.tierSlug}</td>
                    <td className="px-4 py-2">{r.cadence}</td>
                    <td className="px-4 py-2">
                      {r.status}
                      {/* CP-PROMO-19 — a superseded plan is SHOWN, with what replaced
                          it. Hiding it would make supersession look like deletion. */}
                      {r.supersededBy && (
                        <span className="ml-1 text-xs text-muted-foreground" data-testid={`partner-subscription-superseded-${r.id}`}>
                          (replaced by {r.supersededBy}
                          {r.supersededReason ? ` — ${r.supersededReason}` : ""})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right font-mono">{formatMinor(r.listAmountMinor, r.currency)}</td>
                    <td className="px-4 py-2 text-right font-mono">
                      {r.discountMinor ? `−${formatMinor(r.discountMinor, r.currency)}` : "—"}
                      {r.discountCode ? <span className="ml-1 text-xs text-muted-foreground">{r.discountCode}</span> : null}
                    </td>
                    <td className="px-4 py-2 text-right font-mono">{formatMinor(r.amountMinor, r.currency)}</td>
                    <td className="px-4 py-2 text-xs">{r.priceDerivation}</td>
                    <td className="px-4 py-2">{formatDate(r.periodStart)}</td>
                    <td className="px-4 py-2">{formatDate(r.periodEnd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AppCard>

      <div className="mt-4">
        <AppCard title={`Money activity (${events.data?.total ?? 0})`} data-testid="partner-money-events">
          {events.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading activity…</div>
          ) : (events.data?.events ?? []).length === 0 ? (
            <PartnerEmptyState
              title="No money events recorded"
              description="Subscription, promotion and invoice events appear here as they are emitted."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-partner-money-events">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2">When</th>
                    <th className="px-4 py-2">Event</th>
                    <th className="px-4 py-2">Subject</th>
                    <th className="px-4 py-2">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {(events.data?.events ?? []).map((e) => (
                    <tr className="border-b last:border-0" key={e.id} data-testid={`partner-money-event-row-${e.id}`}>
                      <td className="px-4 py-2 whitespace-nowrap">{formatDate(e.emittedAt)}</td>
                      <td className="px-4 py-2 font-mono text-xs">{e.eventName}</td>
                      <td className="px-4 py-2 text-xs">
                        {e.subjectKind} <span className="font-mono">{e.subjectId}</span>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                        {typeof e.payload === "object" && e.payload !== null
                          ? Object.entries(e.payload as Record<string, unknown>)
                              .map(([k, v]) => `${k}=${String(v)}`)
                              .join(" ")
                          : String(e.payload ?? "")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AppCard>
      </div>
    </>
  );
}

/* ============================================================
 * WAVE 16 — CP-BRG-07: the partner-facing consumer of the feeSchedule
 * aggregate. Until this existed the aggregate route and its SSE publish had NO
 * CLIENT CONSUMER, so by the owner's rule the item was NOT shipped: an engine
 * with no route is not shipped, and a route with no reader is not shipped
 * either.
 *
 * WHY THIS TAB AND NOT A NEW PAGE. `SpvFeesTab` above is the only partner
 * surface that already reads fee data, and it reads the LEDGER (what was
 * charged). The aggregate answers the different question "what am I charged,
 * and by which precedence leg" — the PRICE LIST, not the history. Putting it
 * beside the ledger is what lets a partner reconcile the two.
 *
 * MONEY. Amounts arrive as integer minor units and are rendered with the same
 * `formatMinor` this page already uses. The commission rate arrives as
 * `rateFraction` (a FRACTION) and is rendered through
 * `formatFractionAsPercent` from `@/lib/percentDisplay`. Nothing in this file
 * multiplies a rate by 100, and the forbidden magnitude-sniffing normaliser is
 * absent — which `server/__tests__/wave16_fee_aggregate_wiring.test.ts` proves
 * by pointing the SAME fence at a fixture that contains it.
 *
 * FAIL-CLOSED RENDER. A line with `ok: false` renders its ERROR CODE, never a
 * zero and never a dash that could be mistaken for "free". A zero price is a
 * real price and a partner reading it would believe it.
 *
 * REALTIME. Subscribes to the existing partner-scoped `partner-workspace`
 * topic through `/api/stream` (ORP-052: the CP-034 canonical stream, which is
 * auth-gated rather than Collective-flag-gated, so a partner is never blocked
 * by a flag that has nothing to do with them). The SSE frame carries only the
 * REVISION; the tab compares it with the revision it already holds and
 * refetches the ROUTE when they differ, so the stream can never become a
 * second source of truth for a price.
 * ============================================================ */
type FeeAggregateLine = {
  feeKind: string;
  ok: boolean;
  amountMinor: number | null;
  currency: string | null;
  computedVia: string | null;
  feeScheduleId: string | null;
  error: string | null;
};
type FeeAggregate = {
  partnerId: string;
  tier: string | null;
  tierError: string | null;
  commission: { rateFraction: number | null; via: string | null; error: string | null };
  lines: FeeAggregateLine[];
  spvFeeSchedules: Array<Record<string, unknown>>;
  computedAt: string;
  revision: string;
};
type FeeAggregateResponse = {
  ok: boolean;
  aggregate: FeeAggregate;
  sseTopic: string;
  sseScope: string;
};

/* Labels for the three fee kinds the aggregate reports. Presentation only —
 * the KEYS come from the server's AGGREGATE_FEE_KINDS, and an unmapped kind
 * falls back to its raw key rather than being dropped from the table. */
const AGG_FEE_KIND_LABELS: Record<string, string> = {
  subscription_monthly: "Subscription — monthly",
  subscription_annual: "Subscription — annual",
  spv_deployment: "SPV deployment",
};

/* How a value was arrived at. Rendered verbatim next to the amount so a partner
 * can see WHY they are charged what they are charged. */
const AGG_VIA_LABELS: Record<string, string> = {
  partner_override: "Negotiated for you",
  tier_default: "Your tier's rate",
  platform_default: "Platform default",
  db: "Configured rate",
  default: "Fallback rate",
};

function FeeScheduleTab({ ready }: { ready: boolean }) {
  const { data, isLoading, isError, error, refetch } = useQuery<FeeAggregateResponse>({
    queryKey: ["/api/partner/fee-schedule/aggregate"],
    enabled: ready,
    retry: false,
    queryFn: async () => (await apiRequest("GET", "/api/partner/fee-schedule/aggregate")).json(),
  });

  const agg = data?.aggregate;
  /* The scope comes from the SERVER's response, not from a client-side guess,
   * so the tab can only ever listen on the scope the publisher publishes to. */
  const sseScope = data?.sseScope ?? "";
  const heldRevision = agg?.revision ?? "";

  useCollectiveStream({
    chapterId: sseScope,
    topics: ["partner-workspace"],
    path: "/api/stream",
    enabled: ready && !!sseScope,
    onMessage: (_topic, payload) => {
      const frame = payload as { kind?: unknown; revision?: unknown } | null;
      if (!frame || frame.kind !== "feeSchedule.changed") return;
      /* Revision equality means the price list did not move, so a redundant
       * refetch is skipped. An absent revision refetches, because "unknown"
       * must not be treated as "unchanged". */
      if (typeof frame.revision === "string" && frame.revision === heldRevision) return;
      void refetch();
    },
  });

  const isForbidden = isError && error instanceof ApiError && error.status === 403;
  if (isForbidden) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" data-testid="partner-feeschedule-forbidden">
        Your effective fee schedule is visible to managing partners only.
      </div>
    );
  }
  if (isError) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900" data-testid="partner-feeschedule-error">
        Could not load your fee schedule.
      </div>
    );
  }
  if (isLoading || !agg) {
    return (
      <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="partner-feeschedule-loading">
        Loading…
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="partner-feeschedule-summary">
        <AppCard className="p-4">
          <div className="text-xs uppercase tracking-wide text-[var(--cv-color-text-muted)]">Billing tier</div>
          {agg.tier ? (
            <div className="mt-1 font-mono text-lg" data-testid="partner-feeschedule-tier">{agg.tier}</div>
          ) : (
            <div className="mt-1 text-sm text-rose-700" data-testid="partner-feeschedule-tier-error">
              Not resolved — {agg.tierError ?? "PARTNER_TIER_UNRESOLVED"}
            </div>
          )}
        </AppCard>
        <AppCard className="p-4">
          <div className="text-xs uppercase tracking-wide text-[var(--cv-color-text-muted)]">Commission rate</div>
          {agg.commission.error ? (
            <div className="mt-1 text-sm text-rose-700" data-testid="partner-feeschedule-commission-error">
              Not resolved — {agg.commission.error}
            </div>
          ) : (
            <div className="mt-1 font-mono text-lg" data-testid="partner-feeschedule-commission">
              {formatFractionAsPercent(agg.commission.rateFraction)}
            </div>
          )}
          {agg.commission.via && !agg.commission.error && (
            <div className="mt-1 text-xs text-[var(--cv-color-text-muted)]" data-testid="partner-feeschedule-commission-via">
              {AGG_VIA_LABELS[agg.commission.via] ?? agg.commission.via}
            </div>
          )}
        </AppCard>
      </div>

      <AppCard className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="partner-feeschedule-table">
            <thead className="bg-[var(--cv-color-surface-muted)] text-left text-xs uppercase tracking-wide text-[var(--cv-color-text-muted)]">
              <tr>
                <th className="px-4 py-2">Fee</th>
                <th className="px-4 py-2">Amount</th>
                <th className="px-4 py-2">Source</th>
              </tr>
            </thead>
            <tbody>
              {agg.lines.map((line) => (
                <tr className="border-b last:border-0" key={line.feeKind} data-testid={`partner-feeschedule-row-${line.feeKind}`}>
                  <td className="px-4 py-2 whitespace-nowrap">{AGG_FEE_KIND_LABELS[line.feeKind] ?? line.feeKind}</td>
                  <td className="px-4 py-2 font-mono whitespace-nowrap">
                    {line.ok && line.amountMinor !== null ? (
                      formatMinor(line.amountMinor, line.currency ?? undefined)
                    ) : (
                      /* NEVER a 0 and never a bare dash: the resolver's own
                       * error code is shown so the partner and an admin are
                       * looking at the same fact. */
                      <span className="text-rose-700" data-testid={`partner-feeschedule-unresolved-${line.feeKind}`}>
                        Unresolved
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-[var(--cv-color-text-muted)]">
                    {line.ok
                      ? (line.computedVia ? (AGG_VIA_LABELS[line.computedVia] ?? line.computedVia) : "—")
                      : (line.error ?? "unresolved")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AppCard>

      <div className="mt-3 text-xs text-[var(--cv-color-text-muted)]" data-testid="partner-feeschedule-revision">
        Revision {agg.revision} · computed {formatDate(agg.computedAt)}
      </div>
    </>
  );
}

type BillingTab = "subscription" | "referral" | "spv-fees" | "invoices" | "issued" | "history" | "tax-forms" | "fee-schedule";

export default function PartnerBilling() {
  const role = useRequirePartnerRole();
  // v25.46 #4: tab selection state (shadcn Tabs handled this internally; the
  // canonical FilterChip strip is controlled, so we own the active-tab state).
  // Default tab is "referral" — unchanged from the prior shadcn defaultValue.
  const [tab, setTab] = useState<BillingTab>("referral");
  if (!role.ready || !role.identity) return null;
  const me = role.identity;
  const ready = role.ready && !!role.identity;

  return (
    <PartnerShell title="Billing" tier={me.tier} subRole={me.subRole} partnerName={me.identity.name}>
      {/* Canonical FilterChip tab strip (replaces shadcn TabsList/TabsTrigger).
          data-testids preserved: partner-billing-tabs + tab-* per tab. */}
      <div className="flex flex-wrap gap-2" data-testid="partner-billing-tabs" role="tablist">
        <FilterChip active={tab === "subscription"} onClick={() => setTab("subscription")} data-testid="tab-subscription">Subscription</FilterChip>
        <FilterChip active={tab === "referral"} onClick={() => setTab("referral")} data-testid="tab-referral">Referral Commissions</FilterChip>
        <FilterChip active={tab === "spv-fees"} onClick={() => setTab("spv-fees")} data-testid="tab-spv-fees">SPV Fees</FilterChip>
        <FilterChip active={tab === "invoices"} onClick={() => setTab("invoices")} data-testid="tab-invoices">Invoices</FilterChip>
        <FilterChip active={tab === "tax-forms"} onClick={() => setTab("tax-forms")} data-testid="tab-tax-forms">Tax Forms</FilterChip>
        {/* WAVE 14 — additive tabs for the now-routed money engine. Appended
            after the existing chips so no existing fingerprint moves. */}
        <FilterChip active={tab === "issued"} onClick={() => setTab("issued")} data-testid="tab-issued">Issued Invoices</FilterChip>
        <FilterChip active={tab === "history"} onClick={() => setTab("history")} data-testid="tab-history">Plan History</FilterChip>
        {/* WAVE 16 / CP-BRG-07 — additive SIBLING chip. Appended last so no
            existing chip fingerprint moves and no existing text node is edited. */}
        <FilterChip active={tab === "fee-schedule"} onClick={() => setTab("fee-schedule")} data-testid="tab-fee-schedule">Fee Schedule</FilterChip>
      </div>

      {/* Tab panels — only the active panel mounts (parity with shadcn TabsContent). */}
      <div className="mt-4">
        {tab === "subscription" && <SubscriptionTab ready={ready} />}
        {tab === "referral" && <ReferralCommissionsTab ready={ready} />}
        {tab === "spv-fees" && <SpvFeesTab ready={ready} />}
        {tab === "invoices" && <InvoicesTab ready={ready} />}
        {tab === "tax-forms" && <TaxFormsTab ready={ready} />}
        {tab === "issued" && <IssuedInvoicesTab ready={ready} />}
        {tab === "history" && <SubscriptionHistoryTab ready={ready} />}
        {tab === "fee-schedule" && <FeeScheduleTab ready={ready} />}
      </div>
    </PartnerShell>
  );
}
