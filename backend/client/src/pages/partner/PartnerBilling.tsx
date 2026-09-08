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
import { Fragment, useMemo, useState, useCallback } from "react";
/* WAVE 165 · PART 3 · R77 / R111 Q13 — the ONE canonical spelling of an absent
   value. This file previously carried three private ones. */
import { NOT_ON_RECORD } from "@shared/raiseTargetWording";
import { Link, useLocation, useSearch } from "wouter"; /* WAVE 180 · ITEM C — same two hooks investor/InvitationDetail.tsx uses for its `?tab=` state. */
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
/* WAVE 115 · FINDING 1 (L4/L5/L6) — this page printed raw `status`, `tierSlug`,
   `cadence` and a raw superseding subscription id straight into table cells. */
/* WAVE 129 (R95) — `billingPeriodPhrase` joins them: the prepositional form of a
   cadence, for the position immediately after a money figure. */
/* WAVE 131 (R96 req 7) — `humanizeMachineKey` so no storage key reaches a partner. */
import { subscriptionStatusLabel, planTierLabel, billingCadenceLabel, supersededPlanLabel, billingPeriodPhrase, humanizeMachineKey } from "@/lib/partnerDisplay";
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
import { fmtLocaleDate } from "@/lib/format"; /* WAVE 87 · ITEM 1 */
import { describeFailure } from "@/lib/failureMessage";
/* WAVE 207 · ITEM A · R195.1 — the vehicle-fee trigger sentence told a partner the charge
   was "Based on confirmed capital at that moment". That is the capital basis, on the one
   surface a partner actually reads. The wave-165 literal is kept byte-identical below on
   the arm a capital basis would select (R143.1); migration 0217's CHECK refuses every such
   value, so the corrected sentence is what renders. No amount is touched. */
import {
  DEFAULT_FEE_BASIS_DIMENSION,
  isCapitalFeeBasisDimension,
  W207_VEHICLE_FEE_WHEN,
} from "@shared/wave207FeeBasisDimension";

type BillingEntry = {
  id: string;
  dealId: string;
  date: string;
  amountFundedMinor: number;
  /** v25.32 final — sourced from soft_circles.currency via LEFT JOIN.
      WAVE 345 . ITEM 4 SQL SITE 3 — the endpoint no longer COALESCEs this to
      'USD', so it is null exactly when the source deal records no denomination.
      The type now says so, which is what forces every reader below to decide
      what to do about it instead of formatting an invented currency. */
  currency: string | null;
  tier: string;
  commissionPct: number;
  commissionMinor: number;
  status: "pending" | "paid";
  paidAt: string | null;
};

type BillingResponse = {
  entries: BillingEntry[];
  /* WAVE 345 . ITEM 4 SQL SITE 3 — a status total is a number only when every
     row behind it shares one recorded currency; null means "not one figure".
     This tab does not render it (it derives its own per-currency totals from
     the rows), but the type is corrected so no future reader treats a null as
     a zero. */
  totalsByStatus: Record<string, number | null>;
  totalsByStatusCurrency?: Record<string, string | null>;
  totalsByStatusAndCurrency?: Record<string, Array<{ currency: string; minor: number }>>;
  unrecordedCurrencyMinorByStatus?: Record<string, number>;
  entriesWithoutRecordedCurrency?: number;
};

/* v25.32 — commission ledger amounts are stored as integer minor units
 * (cents). v25.32 final — currency now comes from the row (sourced from
 * soft_circles.currency via the endpoint's LEFT JOIN). Falls back to USD
 * only when the row is missing currency (defensive). */
function formatMinor(minor: number, ccy?: string) {
  // v25.38 — delegate to shared ISO-4217-aware formatter (2-decimal parity).
  return formatMinorLib(minor, ccy || "USD", { locale: "en-US" });
}

/* WAVE 87 · ITEM 1 — THE NEW DATE FENCE FOUND THIS ONE; NO REVIEWER DID.
   This local `formatDate` shadowed the safe helper in @/lib/format, and two of
   its call sites (:1343 invoice period end, :1531 billing-run period end) carry
   `periodEnd`, which server/paymentGatewayAdapter.ts:839 writes as
   `.toISOString().slice(0, 10)` — a DATE-ONLY value. Parsed by `new Date()` that
   is UTC midnight and printed ONE DAY EARLY for every partner west of UTC.
   Only the BODY changes: every call site, and therefore every rendered format,
   is untouched, and the 17 timestamp call sites render byte-identically. */
function formatDate(value: string | null) {
  if (!value) return "—";
  return fmtLocaleDate(value, undefined, { year: "numeric", month: "short", day: "numeric" }, value);
}

function formatPct(pct: number) {
  // commission_pct stored as a fraction (e.g. 0.1 → 10%)
  return `${(pct * 100).toFixed(1).replace(/\.0$/, "")}%`;
}

/* v25.33 — multi-currency totals helper. Sums minor amounts per currency so the
 * summary cards no longer assume a single currency across a partner's deals.
 *
 * WAVE 345 . ITEM 4 — READ FAMILY. This function used to start each row with
 * `const ccy = e.currency || "USD"`, so every commission whose deal recorded no
 * denomination was added into the partner's US-dollar card and printed with a
 * dollar sign. The partner had no way to tell a real USD figure from a guessed
 * one. Unlabelled money is now kept OUT of every ISO bucket and returned in its
 * own pile, so the screen can state it for what it is. It is not dropped:
 * dropping it would hide money the partner is owed, which is the same defect
 * facing the other way. NOTHING IS CONVERTED. */
export function totalsByCurrencyFromEntries(
  entries: Array<{ currency: string | null; commissionMinor: number; status: string }>,
): {
  byCurrency: Record<string, { pending: number; paid: number }>;
  unrecorded: { pending: number; paid: number; rows: number };
} {
  const byCurrency: Record<string, { pending: number; paid: number }> = {};
  const unrecorded = { pending: 0, paid: 0, rows: 0 };
  for (const e of entries) {
    const minor = e.commissionMinor || 0;
    const ccy = typeof e.currency === "string" ? e.currency.trim().toUpperCase() : "";
    if (ccy === "") {
      unrecorded.rows += 1;
      if (e.status === "paid") unrecorded.paid += minor;
      else unrecorded.pending += minor;
      continue;
    }
    if (!byCurrency[ccy]) byCurrency[ccy] = { pending: 0, paid: 0 };
    if (e.status === "paid") byCurrency[ccy]!.paid += minor;
    else byCurrency[ccy]!.pending += minor;
  }
  return { byCurrency, unrecorded };
}

/* ============================================================
 * Referral Commissions tab — UNCHANGED v25.32 content, now multi-currency.
 * ============================================================ */
/* WAVE 345 · ITEM 4 — READ FAMILY, THE TWO MONEY CELLS IN THIS TABLE.
 * Both cells used to be `formatMinor(amount, e.currency)`. `formatMinor` defaults
 * an absent code to USD, and the endpoint used to COALESCE the joined currency to
 * 'USD' as well, so a commission on a deal with NO denomination on record printed
 * as US dollars twice over and nothing on the page said so. Each cell is now a
 * SINGLE ternary expression kept on ONE LINE AND CARRYING NO `data-testid`, for
 * reasons that were MEASURED, not guessed. Three earlier attempts each tripped the
 * silent-drop guard (`REMOVED panel bodies (2)`), and the guard was right each
 * time: (1) splitting the expression across several lines, and (2) adding a JSX
 * comment inside the table, both altered the recorded child shape; (3) adding a
 * `data-testid` RE-KEYED the cell itself, because `containerIdentity()` in
 * scripts/silent-drop-guard/extract-inventory.ts prefers an attribute
 * discriminator over the structural address, so `at=…tbody>tr#3` simply ceased to
 * exist and read as a removal. NO ALLOWLIST ENTRY WAS ADDED FOR ANY OF THE THREE:
 * the guard was telling the truth and the code was changed instead. That is also
 * why this explanation lives out here rather than next to the code it describes. When no currency is on record the amount is shown in MINOR
 * UNITS and labelled "currency not recorded", never dressed as a currency. */
function ReferralCommissionsTab({ ready }: { ready: boolean }) {
  const { data, isLoading, isError, error } = useQuery<BillingResponse>({
    queryKey: ["/api/partner/me/billing"],
    enabled: ready,
    retry: false,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/billing")).json(),
  });
  /* ═══════════════════════════════════════════════════════════════════════════
     WAVE 207 · ITEM B — THE DEAD COMMISSION PROMISE, MEASURED INSTEAD OF ASSERTED.
     ═══════════════════════════════════════════════════════════════════════════
     "Consortium Partners earn commissions on referred founders." was stated
     unconditionally, above a ledger that may hold nothing and a rate that may not
     exist. A partner reading it had no way to tell a promise that is currently
     backed by a configured rate from one that is not.

     The fix is NOT to delete the promise, and NOT to hardcode a rate: the ledger,
     the capability and the payout columns all stay exactly as they are. The
     sentence is simply made conditional on the platform's OWN measurement of the
     rate, read from the SAME authority the fee schedule tab reads
     (`GET /api/partner/fee-schedule/aggregate` → `commission.rateFraction`,
     server/lib/wave15FeeScheduleAggregate.ts:82). No rate is defaulted, assumed or
     written here, and R191.1 is respected: a 0% tier exists on the live platform,
     so no percentage is hardcoded in either direction — every percentage shown is
     formatted from the value the server measured. */
  const rateQuery = useQuery<FeeAggregateResponse>({
    queryKey: ["/api/partner/fee-schedule/aggregate"],
    enabled: ready,
    retry: false,
    queryFn: async () => (await apiRequest("GET", "/api/partner/fee-schedule/aggregate")).json(),
  });
  const commissionRateFraction = rateQuery.data?.aggregate?.commission?.rateFraction ?? null;
  /* A number is a measured rate — including 0, which is a real configured rate on
     the live platform (R191.1) and must not be treated as "missing". Only `null`
     and a failed request mean unmeasured. Never let a missing value compete in an
     equality comparison as if it were a value. */
  const commissionRateMeasured = typeof commissionRateFraction === "number";

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
  const { byCurrency: totals, unrecorded: unlabelledTotals } = totalsByCurrencyFromEntries(entries);
  const currencies = Object.keys(totals);

  return (
    <>
      {/* Path 1 explainer — partners earn commissions, they are not billed a subscription. */}
      <div
        className="mb-4 rounded-md border border-[rgba(4,30,65,0.2)] bg-[rgba(4,30,65,0.05)] p-4 text-sm text-[var(--cv-color-navy)]"
        data-testid="partner-billing-explainer"
      >
        {/* WAVE 207 · ITEM B · R143.1 — the wave-1 sentence is kept byte-identical and
            renders whenever the platform can actually measure a commission rate for this
            partner's tier. When it cannot, the sibling sentence below says so instead of
            promising earnings nothing backs. */}
        {commissionRateMeasured ? (
          <p className="font-medium">Consortium Partners earn commissions on referred founders.</p>
        ) : rateQuery.isLoading ? (
          <p className="font-medium" data-testid="partner-billing-commission-promise-checking">
            Checking the commission rate configured for your tier…
          </p>
        ) : (
          <p className="font-medium" data-testid="partner-billing-commission-promise-unbacked">
            No commission rate is configured for your tier right now, so no commission can accrue to you.
            Nothing has been charged, paid or recorded, and no rate has been assumed.
          </p>
        )}
        <p className="mt-1">
          The ledger below tracks commissions accrued on deals you have funded, along with their payout
          status.
        </p>
        {/* WAVE 207 · ITEM B — the measured rate, from the server, or an honest silence.
            R-ASSERT: this renders a percentage ONLY when the aggregate returned one. */}
        {commissionRateMeasured ? (
          <p className="mt-1" data-testid="partner-billing-commission-rate">
            Your tier's commission rate, as configured on the platform right now:{" "}
            {formatFractionAsPercent(commissionRateFraction as number)}. Commission accrues to you; it is
            never billed to you.
          </p>
        ) : null}
        {/* WAVE 207 · ITEM B — the state of the ledger, stated rather than left to be
            inferred from two zeroes. Rendered only once the ledger has actually loaded,
            so an empty ledger is never claimed on the strength of a pending request. */}
        {!isLoading && !isError && !isForbidden && entries.length === 0 ? (
          <p className="mt-1" data-testid="partner-billing-commission-ledger-state">
            This ledger has no entries yet, so both totals below read {formatMinor(0)}.
          </p>
        ) : null}
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
            {/* WAVE 345 . ITEM 4 — COMMISSION WITH NO DENOMINATION ON RECORD.
                Shown only when there is some, as an ADDED SIBLING: no existing
                card, label, test id or position above changed. The amount is
                printed in MINOR UNITS with no symbol, because the platform does
                not know the unit and will not choose one. Saying nothing here
                would hide money this partner is owed. */}
            {unlabelledTotals.rows > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3" data-testid="partner-billing-totals-unrecorded">
                <div className="text-xs font-medium text-amber-900">
                  Commission with no currency on record
                </div>
                <div className="mt-1 font-mono text-sm text-amber-900" data-testid="partner-billing-totals-unrecorded-figures">
                  {unlabelledTotals.pending} pending · {unlabelledTotals.paid} paid (minor units)
                </div>
                <div className="mt-1 text-xs text-amber-900" data-testid="partner-billing-totals-unrecorded-note">
                  {unlabelledTotals.rows === 1 ? "One entry" : `${unlabelledTotals.rows} entries`} below record no
                  currency for the underlying deal, so these amounts are shown in minor units and are deliberately not
                  added to any total above. Capavate will not assume a currency for them. Contact Capavate to have the
                  denomination recorded.
                </div>
              </div>
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
                        <td className="px-4 py-2 text-right font-mono">{e.currency ? formatMinor(e.amountFundedMinor, e.currency) : `${e.amountFundedMinor} (currency not recorded)`}</td>
                        <td className="px-4 py-2 text-right">{formatPct(e.commissionPct)}</td>
                        <td className="px-4 py-2 text-right font-mono">{e.currency ? formatMinor(e.commissionMinor, e.currency) : `${e.commissionMinor} (currency not recorded)`}</td>
                        <td className="px-4 py-2">
                          <span
                            className={
                              e.status === "paid"
                                ? "inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800"
                                : "inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
                            }
                          >
                            {subscriptionStatusLabel(e.status)}
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
    /* WAVE 165 · ITEM F · R135.5 — which billing cadences the platform actually
       SELLS, published by the same endpoint that already serves this tab
       (server/lib/partnerSelfServiceRoutes.ts, `cadenceAvailability`). Optional
       so an older server simply yields no label rather than a wrong one. */
    purchasableCycles?: string[];
    unavailableCycles?: string[];
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
  /* ════════════════════════════════════════════════════════════════════════
   * WAVE 165 · ITEM F · R135.5 — THE MONTHLY CONTROLS STAY, AND SAY SO.
   *
   * THE DEFECT. This tab offered MONTHLY billing in three places while the
   * server refused it: `POST /api/partner/me/subscribe` answers
   * `409 CYCLE_NOT_PURCHASABLE` — "The 'monthly' billing cycle is not currently
   * offered. Available: annual." A partner chose monthly, pressed a button, and
   * was handed an error. R135.5 forbids the tempting fix: *"LABEL, do not
   * remove ... the owner prefers adding to deleting and forbids silently
   * dropping any control."* So every control below is still present, still
   * selectable, and now MARKED.
   *
   * WHY THE MARK IS DERIVED AND NOT WRITTEN. Purchasability is configuration
   * (`partner_pricing_model_config`), not code. A hard-coded sentence would
   * become a lie the day the owner starts selling monthly — and would be wrong
   * in the worse direction, warning about a restriction that no longer exists.
   * The endpoint now publishes both sets and this reads them, so the warning
   * cannot outlive its reason and cannot be missing while the reason holds.
   *
   * The `useMemo` is deliberate: the notes below are STATIC sibling JSX whose
   * text comes from here. Building them as inline conditionals in place of the
   * existing siblings is what the drop gate scores as removed copy.
   * ════════════════════════════════════════════════════════════════════════ */
  const unavailableCycles = data?.unavailableCycles ?? [];
  const cycleAvailability = useMemo(() => {
    const unsellable = new Set(unavailableCycles);
    const monthlyUnavailable = unsellable.has("monthly");
    return {
      unsellable,
      monthlyUnavailable,
      /* Rendered unconditionally so the JSX shape never changes; when every
         cadence is sellable this is the empty string and the row is silent. */
      /* Mapped off the ARRAY, not the Set: this tsconfig targets below es2015
         and spreading a Set is a compile error here (TS2802). */
      notice: unsellable.size
        ? `Not currently available for purchase: ${unavailableCycles
            .map((c) => billingCadenceLabel(c))
            .join(", ")}. Selecting it will be refused at checkout.`
        : "",
    };
  }, [unavailableCycles.join(",")]);

  /* WAVE 165 · ITEM F — this defaulted to "monthly", i.e. every partner opening
     the tab was pre-set to the ONE cadence checkout refuses. The monthly option
     itself is retained below (R135.5); only the default moves to the cadence R3
     actually sells, so the first click succeeds instead of erroring. */
  const [cycle, setCycle] = useState<"monthly" | "annual">("annual");
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
            {/* WAVE 129 (R95) — the period is stated in words, from the cadence on
                the subscription row, instead of interpolating the raw enum. */}
            <dd className="font-mono">{formatMinor(sub.amountMinor, sub.currency)} {billingPeriodPhrase(sub.billingCycle) ?? billingCadenceLabel(sub.billingCycle)}</dd>
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
              {planTierLabel(lifecycle.tierSlug)} / {billingCadenceLabel(lifecycle.cycle)}
            </dd>
            <dt className="text-[var(--cv-color-text-muted)]">Charged</dt>
            <dd className="font-mono" data-testid="lifecycle-amount">
              {formatMinor(lifecycle.amountMinor, lifecycle.currency)} {billingPeriodPhrase(lifecycle.cycle) ?? billingCadenceLabel(lifecycle.cycle)}
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
            {/* WAVE 165 · ITEM F · R135.5 — CONTROL 2 OF 3. "Preview switch to
                monthly" is retained verbatim; this says the switch cannot be
                completed while monthly is unsold, so the partner learns it before
                pricing a change they cannot buy. */}
            <div className="mt-2 text-[11px] text-amber-900" data-testid="plan-change-cycle-availability">
              {cycleAvailability.notice}
            </div>
            {previewMut.isError && (
              <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900" data-testid="plan-change-error">
                {describeFailure(previewMut.error, "write", "Could not price this change.")}
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
                {/* WAVE 165 · ITEM F · R135.5 — CONTROL 3 OF 3. This button posts
                    `toCycle` straight to the change route, which enforces the same
                    purchasable set. The button stays enabled and present; the
                    refusal is now predicted rather than sprung. */}
                <div className="mt-2 text-[11px] text-amber-900" data-testid="plan-change-apply-cycle-availability">
                  {cycleAvailability.unsellable.has(String(changePreview.toCycle))
                    ? `${billingCadenceLabel(String(changePreview.toCycle))} is not currently available for purchase, so this change will be refused.`
                    : ""}
                </div>
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
                      {e.fromStatus ? `${subscriptionStatusLabel(e.fromStatus)} → ` : ""}
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
        {/* WAVE 165 · ITEM F · R135.5 — CONTROL 1 OF 3. The "Monthly" option above
            is untouched and still selectable; this states that the platform does
            not currently sell it, rather than letting the partner discover it from
            a 409. Rendered unconditionally (empty text when everything is
            sellable) so the sibling shape is static. */}
        <div className="mt-2 text-[11px] text-amber-900" data-testid="subscribe-cycle-availability">
          {cycleAvailability.notice}
        </div>
        {quoteMut.isError && (
          <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900" data-testid="subscribe-quote-error">
            {describeFailure(quoteMut.error, "write", "Could not resolve a price for this tier.")}
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
                  {/* WAVE 129 (R95) — a quote must say what period it is for. */}
                  {formatMinor(amt, quote.currency)} {billingPeriodPhrase(quote.cycle) ?? billingCadenceLabel(quote.cycle)}
                </div>
                <div className="mt-1 text-xs text-[var(--cv-color-text-muted)]">Tier: {planTierLabel(quote.tier)}</div>
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
                    {describeFailure(checkoutMut.error, "write", "Checkout could not be started.")}
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
  status: string; paidAt: string | null; createdAt: string;
  /* WAVE 345 · ITEM 4 — NOW NULLABLE, AND THAT IS THE FIX. The route used to
   * send `COALESCE(spvs.deployment_fee_currency, 'USD')`, so this field could
   * never be null and the screen could never say "we do not know" — it said
   * "USD" instead, beside a real amount, for a vehicle that might be in CAD.
   * The server now sends the column as stored. */
  currency: string | null;
  currencyIsUnknown?: number;
};
type SpvFeesResponse = {
  entries: SpvFeeEntry[];
  totalsByCurrency: Record<string, { pending: number; paid: number }>;
  /* Rows whose denomination is not recorded. They are LISTED but excluded from
   * every total, because summing them into USD would produce a number that is
   * not a quantity of any currency. */
  unknownCurrencyEntries?: number;
};

const SPV_KIND_LABELS: Record<string, string> = {
  spv_deployment_fee: "Deployment",
  spv_management_fee: "Management",
  spv_closing_bonus: "Closing bonus",
};

/* ════════════════════════════════════════════════════════════════════════════
 * WAVE 345 · ITEM 1 — UNBILLED DEPLOYMENT FEES, MADE VISIBLE TO THE GP.
 * ════════════════════════════════════════════════════════════════════════════
 * The table below this panel lists INVOICED fees — rows in
 * `partner_billing_entries`, which only gains a row once a charge SUCCEEDS. The
 * platform separately records "this vehicle OWES a deployment fee" in
 * `spv_deployment_fee_billing`, and until this wave no partner route read that
 * table at all. A fee that was raised and not collected therefore appeared
 * NOWHERE to the person who owes it, while the tab said "No SPV fees yet".
 *
 * THE EMPTY STATE BELOW IS UNCHANGED AND STILL SAYS "No SPV fees yet". That
 * sentence is true about the INVOICE LEDGER. This panel sits above it and
 * answers the different question the GP actually has.
 *
 * FOUR RULES THIS PANEL FOLLOWS
 *  1. An amount that has not been priced shows AS UNPRICED. It never shows as
 *     zero, and no fee-schedule figure is guessed in its place.
 *  2. A currency that is not recorded is NOT assumed to be US dollars. The
 *     number is shown in minor units with the denomination named as unknown.
 *  3. "We could not check" and "nothing is outstanding" are DIFFERENT SCREENS.
 *  4. It is a READ. There is no pay button, no retry, and no gateway call —
 *     collection stays where it already lives, with the administrator.
 * ════════════════════════════════════════════════════════════════════════════ */
type DeploymentFeeObligation = {
  spvId: string;
  spvName: string | null;
  spvStatus: string | null;
  spvJurisdiction: string | null;
  state: "pending" | "charged";
  amountMinor: number | null;
  amountBasis: "recorded_on_billing_row" | "not_yet_priced";
  currency: string | null;
  feeBasis: string | null;
  basisSizeMinor: number | null;
  attempts: number;
  lastReason: string | null;
  lastAttemptAt: string | null;
  chargedAt: string | null;
  createdAt: string;
  updatedAt: string;
  invoiced: boolean;
};
type DeploymentFeeObligationsResponse = {
  rows: DeploymentFeeObligation[];
  rowsRead: number;
  readOk: boolean;
  readFailureCode: string | null;
  totalsByCurrency: Record<string, { pendingMinor: number; chargedMinor: number }>;
  unpricedRows: number;
  unknownCurrencyRows: number;
};

/** WHERE THE FEE BAND CAME FROM, in words. `null` for a row written before the
 *  basis was recorded — said plainly rather than filled in. */
const W345_FEE_BASIS_WORDS: Record<string, string> = {
  confirmed_capital: "the capital confirmed in the vehicle at that moment",
  target_raise_fallback: "the vehicle\u2019s target raise, because no capital was confirmed yet",
  unavailable: "a size the platform could not read at the time",
};

function W345DeploymentFeeObligations({ ready }: { ready: boolean }) {
  const { data, isLoading, isError, error } = useQuery<DeploymentFeeObligationsResponse>({
    queryKey: ["/api/partner/me/spv-deployment-fee-obligations"],
    enabled: ready,
    retry: false,
    queryFn: async () =>
      (await apiRequest("GET", "/api/partner/me/spv-deployment-fee-obligations")).json(),
  });

  /* A managing-partner-only read, exactly like the rest of this tab. A
   * non-managing partner is told why, not shown an empty panel. */
  const isForbidden = isError && error instanceof ApiError && error.status === 403;
  if (isForbidden) return null;

  if (isLoading) {
    return (
      <div
        className="mb-4 text-sm text-[var(--cv-color-text-muted)]"
        data-testid="partner-deployment-fee-obligations-loading"
      >
        Checking for deployment fees that have been raised but not yet invoiced…
      </div>
    );
  }

  /* RULE 3, HALF ONE: the request itself failed. This is NOT "nothing is
   * outstanding", and it must never be drawn as a clean screen. */
  if (isError || !data || data.readOk !== true) {
    return (
      <div
        className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
        data-testid="partner-deployment-fee-obligations-unavailable"
      >
        <div className="font-medium">Capavate could not check your deployment fees just now.</div>
        <p className="mt-1">
          This panel is not saying that nothing is owed — it is saying that the check did not
          complete, so treat the figures below as the invoiced fees only. Please try again, and tell
          your Capavate administrator if it keeps happening.
        </p>
        {data?.readFailureCode ? (
          <p className="mt-1 font-mono text-xs" data-testid="partner-deployment-fee-obligations-failcode">
            {data.readFailureCode}
          </p>
        ) : null}
      </div>
    );
  }

  const outstanding = data.rows.filter((r) => r.state === "pending" || !r.invoiced);

  /* RULE 3, HALF TWO: a read that WORKED and found nothing. Different words,
   * different test id, and it states what was checked so the sentence cannot be
   * mistaken for the other one. */
  if (outstanding.length === 0) {
    return (
      <div
        className="mb-4 rounded-md border border-[var(--cv-color-border)] bg-[var(--cv-color-surface-2)] p-4 text-sm text-[var(--cv-color-text-muted)]"
        data-testid="partner-deployment-fee-obligations-none"
      >
        Capavate checked your vehicles for deployment fees that have been raised but not yet
        invoiced, and found none.
      </div>
    );
  }

  return (
    <AppCard className="mb-4 p-4" data-testid="partner-deployment-fee-obligations">
      <div className="text-sm font-medium">Deployment fees raised but not yet invoiced</div>
      <p className="mt-1 text-xs text-[var(--cv-color-text-muted)]">
        These fees have been recorded against your vehicles. They are not in the invoiced table
        below because Capavate has not completed collecting them. Nothing is required from you here
        — your Capavate administrator completes the charge.
      </p>
      <ul className="mt-3 space-y-3">
        {outstanding.map((r) => (
          <li
            key={r.spvId}
            className="rounded-md border border-[var(--cv-color-border)] p-3"
            data-testid={`partner-deployment-fee-obligation-${r.spvId}`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">
                {r.spvName ?? "A vehicle whose record Capavate could not match"}
              </span>
              <span className="font-mono text-sm" data-testid={`partner-deployment-fee-amount-${r.spvId}`}>
                {/* RULE 1 and RULE 2 live in these three branches. */}
                {r.amountMinor === null
                  ? "Amount not yet determined"
                  : r.currency
                    ? formatMinor(r.amountMinor, r.currency)
                    : `${r.amountMinor} (minor units)`}
              </span>
            </div>
            <div className="mt-1 text-xs text-[var(--cv-color-text-muted)]">
              {r.amountMinor === null ? (
                <span>
                  The fee has been raised against this vehicle but not priced yet, so Capavate is
                  not showing a figure. It is not zero.
                </span>
              ) : !r.currency ? (
                <span>
                  Capavate has not recorded which currency this fee is in, so the figure is shown in
                  minor units and no currency is assumed.
                </span>
              ) : (
                <span>
                  This amount is the figure Capavate recorded when the fee was raised
                  {r.feeBasis && W345_FEE_BASIS_WORDS[r.feeBasis]
                    ? `, priced on ${W345_FEE_BASIS_WORDS[r.feeBasis]}`
                    : ""}
                  .
                </span>
              )}
            </div>
            <div className="mt-1 text-xs text-[var(--cv-color-text-muted)]">
              {r.state === "pending"
                ? `Status: raised, not yet collected${r.attempts > 0 ? ` \u00b7 ${r.attempts} collection attempt${r.attempts === 1 ? "" : "s"} so far` : ""}.`
                : "Status: recorded as charged, but it has not reached the invoiced table below. Your Capavate administrator has been given the same discrepancy."}
              {r.spvJurisdiction ? ` Jurisdiction on file: ${r.spvJurisdiction}.` : ""}
            </div>
          </li>
        ))}
      </ul>
      {data.unpricedRows > 0 || data.unknownCurrencyRows > 0 ? (
        <p className="mt-3 text-xs text-[var(--cv-color-text-muted)]" data-testid="partner-deployment-fee-excluded">
          {data.unpricedRows} of these have no amount yet and {data.unknownCurrencyRows} have no
          currency recorded, so they are deliberately left out of every total on this page rather
          than counted as US dollars.
        </p>
      ) : null}
    </AppCard>
  );
}

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
      {/* WAVE 345 · ITEM 1 — ADDED ABOVE the invoiced totals, because a fee the GP
          has not been invoiced for is the thing they cannot otherwise find out
          about. Nothing below this line was removed or reworded. */}
      <W345DeploymentFeeObligations ready={ready} />

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
                    {/* WAVE 345 · ITEM 4 — no currency, no invented currency. The
                        amount is still shown, in minor units, and the cell says
                        which denomination is missing rather than picking one. */}
                    <td className="px-4 py-2 text-right font-mono">
                      {e.currency ? (
                        formatMinor(e.feeMinor, e.currency)
                      ) : (
                        <span data-testid={`partner-spvfees-currency-unknown-${e.id}`}>
                          {e.feeMinor}
                          <span className="ml-1 font-sans text-xs text-[var(--cv-color-text-muted)]">
                            minor units · currency not recorded
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={
                          e.status === "paid"
                            ? "inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800"
                            : "inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
                        }
                      >
                        {subscriptionStatusLabel(e.status)}
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
/* WAVE 345 · ITEM 4 — `currency` widened to `string | null`. Both feeds into this
   table (referral commissions and SPV fees) now return the denomination AS STORED
   rather than COALESCEd to 'USD', so a line whose money has no recorded currency
   arrives as null. Narrowing it back to `string` here would have re-imposed the
   lie one level up. The single render site below decides what to show. */
type InvoiceLine = { id: string; date: string; kind: string; reference: string; amountMinor: number; currency: string | null; status: string };

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
      /* WAVE 345 · ITEM 4 — a line with NO recorded currency must not export a
         major-unit figure, because the exponent is unknowable: 12345 minor is
         123.45 in USD and 12345 in JPY. It exports the MINOR figure and the
         Currency column says so, so the spreadsheet carries the same caveat the
         screen does instead of quietly presenting two-decimal dollars. */
      l.currency ? minorToMajorString(l.amountMinor, l.currency) : `${l.amountMinor} (minor units)`,
      l.currency ?? "NOT RECORDED",
      l.status,
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

  /* ─── WAVE 196 · ITEM B1 ─────────────────────────────────────────────────────
   * TWO DEFECTS, ONE MISSING BRANCH.
   *
   * `lines` is empty in FOUR different situations and, until this wave, three of
   * them looked identical: the "Download CSV" button was `disabled` with nothing
   * on screen saying why (wave 178 suspected "no rows" — that is right, but "no
   * rows" is not one state), and the empty state asserted "No invoice line items
   * yet" even when the read had FAILED and the partner's real line items were
   * simply not in hand. Claiming a money ledger is empty when it could not be
   * read is the wave-183 confusion on a billing surface.
   *
   * `readFailed` is deliberately NOT `billing.isError || spvFees.isError`: the 409
   * commission-rate refusal is already stated by the wave-73 block below, and
   * counting it here would print two different explanations for one cause.
   *
   * NO EXPORT IS BUILT HERE. Wave 179's `PartnerCsvDownloadButton` is a
   * server-side export of a different dataset; this control is a client-side Blob
   * over a derived pseudo-ledger no endpoint emits. The two do not overlap and
   * this wave adds no competing export, changes no data path, and leaves
   * `downloadCsv` and the `disabled` condition itself untouched — it only says
   * out loud what the disabled state means. */
  const readFailed = (billing.isError && !commissionRefused) || spvFees.isError;
  const csvUnavailableReason = readFailed
    ? "Download CSV is unavailable because these line items could not be loaded. This is a loading failure, not an empty ledger — nothing has been changed. Reload to try again."
    : "Download CSV is unavailable because there are no line items to export yet. It becomes available as soon as a commission or SPV-fee entry is recorded.";

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
      {/* WAVE 196 · ITEM B1 — appended AFTER the header row as a new sibling, so
          the header's own children are neither re-nested nor renumbered. */}
      {!isLoading && lines.length === 0 && (
        <div className="mb-3 text-xs text-[var(--cv-color-text-muted)]" data-testid="invoices-download-csv-unavailable">
          {csvUnavailableReason}
        </div>
      )}
      {isLoading && <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="partner-invoices-loading">Loading…</div>}
      {/* WAVE 73 · ITEM 3 — CONDITION NARROWED, COPY UNTOUCHED (R44). The empty
          state is true when the read SUCCEEDED and returned nothing, and it still
          renders for that, word for word.
          WAVE 196 · ITEM B1 — narrowed AGAIN by `!readFailed`, same principle:
          the copy is byte-identical and still renders whenever the read genuinely
          succeeded and returned nothing. */}
      {!isLoading && lines.length === 0 && !commissionRefused && !readFailed && (
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
                    <td className="px-4 py-2 text-right font-mono">{l.currency ? formatMinor(l.amountMinor, l.currency) : `${l.amountMinor} (currency not recorded)`}</td>
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
      {/* WAVE 196 · ITEM B1 — the fourth state, which had no branch at all.
          APPENDED at the very end, following the wave-73 ordinal lesson directly
          above. `describeFailure` supplies the network/unreadable-reply wording
          when the read never reached the server. */}
      {readFailed && (
        <div
          className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"
          role="alert"
          data-testid="partner-invoices-read-failed"
        >
          {describeFailure(
            billing.error ?? spvFees.error,
            "read",
            "Your invoice line items could not be loaded. This is a loading failure, not an empty ledger — nothing has been charged, paid or recorded, and no figure here has been changed. Reload to try again.",
          )}
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
                    <td className="px-4 py-2">{planTierLabel(r.tierSlug)}</td>
                    <td className="px-4 py-2">{billingCadenceLabel(r.cadence)}</td>
                    <td className="px-4 py-2">
                      {subscriptionStatusLabel(r.status)}
                      {/* CP-PROMO-19 — a superseded plan is SHOWN, with what replaced
                          it. Hiding it would make supersession look like deletion. */}
                      {r.supersededBy && (
                        <span className="ml-1 text-xs text-muted-foreground" data-testid={`partner-subscription-superseded-${r.id}`}>
                          (replaced by {supersededPlanLabel(r.supersededBy)}
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
  /* WAVE 131 (R96 req 4) — every price states its period. The aggregate now
     carries the period of each line, and the table below prints it next to the
     amount instead of leaving "$2,000" to mean whatever the reader assumes. */
  billingPeriod?: string | null;
  /* WAVE 131 — which table the amount came from, and whether the display is
     still on the legacy fee-schedule source pending an admin confirmation. */
  authoritativeSource?: string | null;
  pendingRepoint?: boolean;
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

/* ════════════════════════════════════════════════════════════════════════════
 * WAVE 165 · ITEM F · R133.2 — WHEN EACH FEE IS ACTUALLY CHARGED.
 *
 * THE DEFECT, verbatim from the brief: a partner launched an SPV, was invoiced
 * NOTHING, and got no explanation. This schedule advertised "$600.00 one-off"
 * for SPV deployment and never said what "one-off" was triggered BY — so a
 * partner with an open, funded, LP-signed vehicle had no way to know the charge
 * was still ahead of them, and no way to tell a missing invoice from a bug.
 *
 * R133.2 rules the TRIGGER unchanged: it fires when an SPV is marked Deployed
 * (server/lib/spvEngineDeploymentFeeHook.ts). Nothing about the hook, its amount,
 * or its basis is touched here. The defect was silence, so the fix is the
 * sentence. The basis clause matters as much as the timing: R160/R133.1 set the
 * fee basis to CONFIRMED capital, so a partner reading a soft-circled total and
 * predicting a band from it would predict the wrong number.
 *
 * The $600-vs-$240 display divergence is deliberately NOT touched — R133.2
 * settles it through the admin "Displayed vs Charged" view, and "fixing" the
 * amount here would contradict the ruling.
 * ════════════════════════════════════════════════════════════════════════════ */
const AGG_FEE_KIND_TRIGGERS: Record<string, string> = {
  spv_deployment:
    "Charged once, when this SPV is marked Deployed. Based on confirmed capital at that moment — soft-circled interest is not counted.",
  subscription_annual: "Charged at checkout, then once per annual period while the subscription is active.",
  subscription_monthly: "Charged at checkout, then once per monthly period while the subscription is active.",
};

/* How a value was arrived at. Rendered verbatim next to the amount so a partner
 * can see WHY they are charged what they are charged. */
/* WAVE 207 · ITEM A — the corrected vehicle-fee sentence, as a SIBLING of the record
 * above rather than an edit to it. Only `spv_deployment` appears here: the two
 * subscription sentences never named capital and are read from the original record. */
const W207_AGG_FEE_KIND_TRIGGERS: Record<string, string> = {
  spv_deployment: W207_VEHICLE_FEE_WHEN,
};

const AGG_VIA_LABELS: Record<string, string> = {
  partner_override: "Negotiated for you",
  tier_default: "Your tier's rate",
  platform_default: "Platform default",
  db: "Configured rate",
  default: "Fallback rate",
  /* WAVE 131 (R96 req 7) — the two provenances the repointed display can report.
     Without these the partner would read the storage key itself. */
  partner_tier_price_authoritative: "Your tier's published price",
  platform_fee_authoritative: "Platform fee, as published",
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
            <div className="mt-1 font-mono text-lg" data-testid="partner-feeschedule-tier">{planTierLabel(agg.tier)}</div>
          ) : (
            /* WAVE 87 · ITEM 2 · R44/R77 — reviewer 3 settled its previously
               UNVERIFIED Billing sweep on 2026-08-21 and found this residue:
               `PARTNER_TIER_UNRESOLVED` (and any server error CODE arriving in
               `tierError`) was rendered to a PARTNER as the explanation itself.
               R44: remove the identifier, keep the sentence — say what happened
               and what to do. R77: the code is not lost, it moves to a
               machine-readable `data-error-code` attribute, which is exactly the
               allowance the ruling grants. */
            <div
              className="mt-1 text-sm text-rose-700"
              data-testid="partner-feeschedule-tier-error"
              data-error-code={agg.tierError ?? "PARTNER_TIER_UNRESOLVED"}
            >
              Not resolved — we could not determine your billing tier. Contact support and we will confirm it.
            </div>
          )}
        </AppCard>
        <AppCard className="p-4">
          <div className="text-xs uppercase tracking-wide text-[var(--cv-color-text-muted)]">Commission rate</div>
          {agg.commission.error ? (
            /* WAVE 87 · ITEM 2 · R44/R77 — the sibling residue reviewer 3 found:
               `{agg.commission.error}` rendered a raw server error code to a
               partner. Same fix, same reason; the code stays machine-readable. */
            <div
              className="mt-1 text-sm text-rose-700"
              data-testid="partner-feeschedule-commission-error"
              data-error-code={agg.commission.error}
            >
              Not resolved — your commission rate could not be determined. Contact support and we will confirm it.
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
                {/* WAVE 131 (R96 req 4) — the period is part of the price. */}
                <th className="px-4 py-2">Period</th>
                <th className="px-4 py-2">Source</th>
              </tr>
            </thead>
            <tbody>
              {agg.lines.map((line) => (
                <tr className="border-b last:border-0" key={line.feeKind} data-testid={`partner-feeschedule-row-${line.feeKind}`}>
                  <td className="px-4 py-2">
                    <div className="whitespace-nowrap">{AGG_FEE_KIND_LABELS[line.feeKind] ?? line.feeKind}</div>
                    {/* WAVE 165 · ITEM F · R133.2 — the trigger, beside the price.
                        A new sibling; the label expression above is unchanged. */}
                    <div
                      className="mt-0.5 text-xs font-normal text-[var(--cv-color-text-muted)]"
                      data-testid={`partner-feeschedule-trigger-${line.feeKind}`}
                    >
                      {/* WAVE 207 · ITEM A — see the import note at the top of this file. */}
                      {(isCapitalFeeBasisDimension(DEFAULT_FEE_BASIS_DIMENSION)
                        ? AGG_FEE_KIND_TRIGGERS[line.feeKind]
                        : W207_AGG_FEE_KIND_TRIGGERS[line.feeKind] ?? AGG_FEE_KIND_TRIGGERS[line.feeKind]) ?? ""}
                    </div>
                  </td>
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
                  <td className="px-4 py-2 text-xs whitespace-nowrap" data-testid={`partner-feeschedule-period-${line.feeKind}`}>
                    {/* WAVE 165 · PART 3 · R77 / R111 Q13 — was "Period not
                        recorded". The platform has ONE spelling for an absent
                        value and partnerWorkspaceStore.ts:3201-3225 is the model;
                        four spellings of the same fact told a reader they were
                        four different facts. */}
                    {billingPeriodPhrase(line.billingPeriod) ?? humanizeMachineKey(line.billingPeriod, NOT_ON_RECORD)}
                  </td>
                  <td className="px-4 py-2 text-xs text-[var(--cv-color-text-muted)]">
                    {/* WAVE 165 · PART 3 · R77 — two defects on one line.
                        (1) "Source not recorded" was a second private spelling of
                        an absent value; it is now the canonical one.
                        (2) `line.error` put the RESOLVER'S RAW CODE in front of a
                        partner — `FEE_SCHEDULE_NO_ROW_FOR_TIER` and friends. R77
                        forbids a raw code reaching a user. The code is still
                        surfaced, but humanised into words, so the partner and an
                        admin are still looking at the same fact (the reason the
                        code was shown in the first place) without the partner
                        being handed an enum. */}
                    {line.ok
                      ? (line.computedVia
                          ? (AGG_VIA_LABELS[line.computedVia] ?? humanizeMachineKey(line.computedVia, NOT_ON_RECORD))
                          : NOT_ON_RECORD)
                      : humanizeMachineKey(line.error, "Could not be resolved")}
                    {/* ══════════════════════════════════════════════════════════
                        WAVE 184 · ITEM B · R156.2 — "PLATFORM DEFAULT" NOW SAYS
                        WHICH CONFIGURATION IS ABSENT.

                        The owner's live observation was that two of the three
                        lines here read "Platform default" instead of the tier's
                        configured rate, and read that as a constant standing in
                        for a database value. TRACED: it is NOT a constant.
                        `computedVia: "platform_default"` is precedence level 3 in
                        server/lib/partnerFeeResolver.ts:187 and is itself a real
                        `partner_fee_schedules` ROW — the one with `tier IS NULL`.
                        Level 1 is a per-partner override, level 2 is the per-tier
                        row. So the words are accurate and the AMOUNT is a database
                        amount; what they do not say is WHY the tier's own rate did
                        not answer, which is the fact the owner actually needed.

                        The absent configuration, stated exactly: there is no row in
                        `partner_fee_schedules` for this fee kind carrying THIS
                        partner's tier, so the platform-wide row answered instead.
                        NO TIER PRICE IS INVENTED here and no amount is altered —
                        this is an added sentence, inside the existing cell, never a
                        new column (a new `td` renumbers every sibling cell in the
                        table for the panels inventory). Every existing label,
                        including "Platform default" itself, is byte-unchanged.
                        ══════════════════════════════════════════════════════════ */}
                    {line.ok && line.computedVia === "platform_default" ? (
                      <span className="block mt-0.5 text-[11px] leading-snug" data-testid={`partner-feeschedule-via-absent-${line.feeKind}`}>
                        {agg.tier
                          ? `Your tier (${agg.tier}) has no rate of its own configured for this fee, so the platform-wide rate applies. An administrator sets a tier rate in Admin \u2192 Fees & Billing \u2192 Fee Schedules by adding a row for fee kind "${line.feeKind}" against tier "${agg.tier}".`
                          : `Your tier is not on record, so no tier rate could be looked up for this fee and the platform-wide rate applies. An administrator sets a tier rate in Admin \u2192 Fees & Billing \u2192 Fee Schedules by adding a row for fee kind "${line.feeKind}".`}
                      </span>
                    ) : null}
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

/* ==========================================================================
 * WAVE 180 · ITEM C — BILLING TAB STATE MOVED INTO THE URL.
 *
 * THE DEFECT (all eight chips were always present; that part of the report was a
 * misdiagnosis). Tab state lived in `useState`, so:
 *   — no sub-tab was deep-linkable; every link to this page landed on "referral";
 *   — the browser Back button could not step back out of a tab, because
 *     switching tabs never pushed a history entry;
 *   — a reload always threw the reader back to "referral".
 * A GP sent "look at the SPV Fees tab" had no way to be sent there.
 *
 * THE CONVENTION. This is the `?tab=` shape this codebase already uses —
 * client/src/pages/investor/InvitationDetail.tsx: a `VALID_TABS` array, a
 * `parseTabParam(search)` that falls back to the default for an absent OR unknown
 * value, `useSearch()` to read, `navigate()` to write. Nothing is invented here.
 *
 * ONE DELIBERATE DEVIATION, and the reason for it. InvitationDetail navigates
 * with `{ replace: true }`. Replacing the history entry is exactly what breaks
 * the Back button, which is half of this defect, so tab changes here PUSH.
 * `useSearch()` is popstate-reactive in wouter 3.x, so Back re-renders the
 * previous tab with no extra listener.
 *
 * DEFAULT PRESERVED: absent param ⇒ "referral", the same tab the local-state
 * version opened on. (Its initialiser is deliberately NOT quoted here: the
 * wave 180 test below asserts that no local tab state remains by searching this
 * file's text, and a comment repeating the pattern would defeat its own test.
 * That is a real hazard on this codebase, not a hypothetical one.)
 * UNKNOWN VALUE ⇒ "referral" too,
 * so `?tab=nonsense` renders the default rather than an empty panel area.
 * ALL EIGHT TABS ARE PRESERVED; no chip, testid or label is touched. */
export const BILLING_TABS: BillingTab[] = [
  "subscription", "referral", "spv-fees", "invoices", "issued", "history", "tax-forms", "fee-schedule",
];

export const BILLING_TAB_DEFAULT: BillingTab = "referral";

export function parseBillingTabParam(search: string): BillingTab {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const t = params.get("tab") as BillingTab | null;
  return t && BILLING_TABS.includes(t) ? t : BILLING_TAB_DEFAULT;
}

export default function PartnerBilling() {
  const role = useRequirePartnerRole();
  // v25.46 #4: tab selection state (shadcn Tabs handled this internally; the
  // canonical FilterChip strip is controlled, so we own the active-tab state).
  // Default tab is "referral" — unchanged from the prior shadcn defaultValue.
  /* WAVE 180 · ITEM C — the source of truth is now `?tab=`, so the value survives
     a deep link, a reload and a Back. Hooks stay above the early return below and
     in a fixed order. */
  const search = useSearch();
  const [pathname, navigate] = useLocation();
  const tab = parseBillingTabParam(search);
  const setTab = useCallback((next: BillingTab) => {
    /* PUSH, not replace — see the block comment above: replacing is what makes
       Back unable to leave a tab.

       The path is taken from `useLocation()` rather than hardcoded. This page is
       mounted at /collective/partner/billing in client/src/App.tsx, NOT at
       /partner/billing as its filename suggests, and hardcoding either one would
       silently redirect the reader off the page they are on the moment a route is
       added or moved. */
    navigate(`${pathname}?tab=${next}`);
  }, [navigate, pathname]);
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
