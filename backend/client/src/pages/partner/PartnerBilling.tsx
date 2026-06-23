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
import { Link } from "wouter";
import { formatMinor as formatMinorLib } from "@/lib/currency"; /* v25.38 currency sweep */
import { useQuery } from "@tanstack/react-query";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { PartnerShell, PartnerEmptyState } from "@/components/partner/PartnerShell";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
  const entries = data?.entries ?? [];
  // v25.33 — derive per-currency totals from the rows (not the single-currency
  // totalsByStatus map) so multi-currency partners see correct summaries.
  const totals = totalsByCurrencyFromEntries(entries);
  const currencies = Object.keys(totals);

  return (
    <>
      {/* Path 1 explainer — partners earn commissions, they are not billed a subscription. */}
      <div
        className="mb-4 rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900"
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

      {!isForbidden && isError && (
        <div
          className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"
          data-testid="partner-billing-error"
        >
          Could not load your commission ledger. Please refresh and try again.
        </div>
      )}

      {!isForbidden && !isError && (
        <>
          {/* Totals summary — v25.33 multi-currency aware (one pair of cards per currency). */}
          <div className="mb-4 space-y-3" data-testid="partner-billing-totals">
            {currencies.length === 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Card className="p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Pending commission</div>
                  <div className="mt-1 font-mono text-lg" data-testid="partner-billing-total-pending">{formatMinor(0)}</div>
                </Card>
                <Card className="p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Paid commission</div>
                  <div className="mt-1 font-mono text-lg" data-testid="partner-billing-total-paid">{formatMinor(0)}</div>
                </Card>
              </div>
            ) : (
              currencies.map((ccy) => (
                <div key={ccy} className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid={`partner-billing-totals-${ccy}`}>
                  <Card className="p-4">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Pending commission ({ccy})</div>
                    <div className="mt-1 font-mono text-lg" data-testid={`partner-billing-total-pending-${ccy}`}>
                      {formatMinor(totals[ccy].pending, ccy)}
                    </div>
                  </Card>
                  <Card className="p-4">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Paid commission ({ccy})</div>
                    <div className="mt-1 font-mono text-lg" data-testid={`partner-billing-total-paid-${ccy}`}>
                      {formatMinor(totals[ccy].paid, ccy)}
                    </div>
                  </Card>
                </div>
              ))
            )}
          </div>

          {isLoading && (
            <div className="text-sm text-slate-500" data-testid="partner-billing-loading">Loading…</div>
          )}

          {!isLoading && entries.length === 0 && (
            <PartnerEmptyState
              title="No commissions yet"
              description="Commission entries appear here once a deal you referred is funded."
            />
          )}

          {!isLoading && entries.length > 0 && (
            <Card className="overflow-hidden" data-testid="partner-billing-table">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
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
            </Card>
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

function SubscriptionTab({ ready }: { ready: boolean }) {
  const { data, isLoading, isError, error } = useQuery<{ subscription: Subscription }>({
    queryKey: ["/api/partner/me/subscription"],
    enabled: ready,
    retry: false,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/subscription")).json(),
  });
  const isForbidden = isError && error instanceof ApiError && error.status === 403;
  const sub = data?.subscription ?? null;

  if (isForbidden) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" data-testid="partner-subscription-forbidden">
        Subscription details are visible to managing partners only.
      </div>
    );
  }
  if (isLoading) return <div className="text-sm text-slate-500" data-testid="partner-subscription-loading">Loading…</div>;
  if (isError) return <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">Could not load subscription.</div>;

  if (!sub) {
    return (
      <PartnerEmptyState
        title="No active subscription"
        description="Consortium partners are not billed a subscription by default. Visit Subscribe to view tier-resolved pricing."
        cta={<Link href="/collective/partner/subscribe" className="text-[#cc0001] hover:underline text-sm">Go to Subscribe →</Link>}
      />
    );
  }

  return (
    <Card className="p-6 max-w-xl" data-testid="partner-subscription-card">
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
              <Card className="p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">Pending SPV fees ({ccy})</div>
                <div className="mt-1 font-mono text-lg">{formatMinor(totals[ccy].pending, ccy)}</div>
              </Card>
              <Card className="p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">Paid SPV fees ({ccy})</div>
                <div className="mt-1 font-mono text-lg">{formatMinor(totals[ccy].paid, ccy)}</div>
              </Card>
            </div>
          ))}
        </div>
      )}

      {isLoading && <div className="text-sm text-slate-500" data-testid="partner-spvfees-loading">Loading…</div>}

      {!isLoading && entries.length === 0 && (
        <PartnerEmptyState
          title="No SPV fees yet"
          description="SPV deployment and management fees appear here as the SPVs you source are deployed."
        />
      )}

      {!isLoading && entries.length > 0 && (
        <Card className="overflow-hidden" data-testid="partner-spvfees-table">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
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
        </Card>
      )}
    </>
  );
}

/* ============================================================
 * Tax Forms tab (v25.33) — GET /api/partner/me/tax-forms (read-only summary).
 * Full submission flow lives on the dedicated /collective/partner/tax-form page.
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
      <div className="mb-4 text-sm text-slate-600">
        Submit or update a tax form on the{" "}
        <Link href="/collective/partner/tax-form" className="text-[#cc0001] hover:underline">Tax Forms page</Link>.
      </div>
      {isLoading && <div className="text-sm text-slate-500" data-testid="partner-taxforms-loading">Loading…</div>}
      {!isLoading && forms.length === 0 && (
        <PartnerEmptyState
          title="No tax forms on file"
          description="A W-9, W-8BEN, or T4A is required before commission or SPV-fee payouts can be remitted."
        />
      )}
      {!isLoading && forms.length > 0 && (
        <Card className="overflow-hidden" data-testid="partner-taxforms-table">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
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
        </Card>
      )}
    </>
  );
}

export default function PartnerBilling() {
  const role = useRequirePartnerRole();
  if (!role.ready || !role.identity) return null;
  const me = role.identity;
  const ready = role.ready && !!role.identity;

  return (
    <PartnerShell title="Billing" tier={me.tier} subRole={me.subRole} partnerName={me.identity.name}>
      <Tabs defaultValue="referral" className="w-full">
        <TabsList data-testid="partner-billing-tabs">
          <TabsTrigger value="subscription" data-testid="tab-subscription">Subscription</TabsTrigger>
          <TabsTrigger value="referral" data-testid="tab-referral">Referral Commissions</TabsTrigger>
          <TabsTrigger value="spv-fees" data-testid="tab-spv-fees">SPV Fees</TabsTrigger>
          <TabsTrigger value="tax-forms" data-testid="tab-tax-forms">Tax Forms</TabsTrigger>
        </TabsList>

        <TabsContent value="subscription" className="mt-4">
          <SubscriptionTab ready={ready} />
        </TabsContent>
        <TabsContent value="referral" className="mt-4">
          <ReferralCommissionsTab ready={ready} />
        </TabsContent>
        <TabsContent value="spv-fees" className="mt-4">
          <SpvFeesTab ready={ready} />
        </TabsContent>
        <TabsContent value="tax-forms" className="mt-4">
          <TaxFormsTab ready={ready} />
        </TabsContent>
      </Tabs>
    </PartnerShell>
  );
}
