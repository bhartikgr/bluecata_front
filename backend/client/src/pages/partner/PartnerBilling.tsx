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
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { PartnerShell, PartnerEmptyState } from "@/components/partner/PartnerShell";
import { Card } from "@/components/ui/card";

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
  return new Intl.NumberFormat("en-US", { style: "currency", currency: ccy || "USD" }).format(minor / 100);
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

export default function PartnerBilling() {
  const role = useRequirePartnerRole();

  const { data, isLoading, isError, error } = useQuery<BillingResponse>({
    queryKey: ["/api/partner/me/billing"],
    enabled: role.ready && !!role.identity,
    retry: false,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/billing")).json(),
  });

  if (!role.ready || !role.identity) return null;
  const me = role.identity;

  // apiRequest() throws ApiError on non-2xx; the billing endpoint is gated to
  // managing_partner. Surface a 403 as an access-scoped note, not an error.
  const isForbidden = isError && error instanceof ApiError && error.status === 403;

  const entries = data?.entries ?? [];
  const totals = data?.totalsByStatus ?? {};
  const pendingTotal = totals["pending"] ?? 0;
  const paidTotal = totals["paid"] ?? 0;

  return (
    <PartnerShell title="Billing" tier={me.tier} subRole={me.subRole} partnerName={me.identity.name}>
      {/* Path 1 explainer — partners earn commissions, they are not billed a subscription. */}
      <div
        className="mb-4 rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900"
        data-testid="partner-billing-explainer"
      >
        <p className="font-medium">Consortium Partners earn commissions on referred founders.</p>
        <p className="mt-1">
          Subscription billing for Partners is not currently enabled — there is nothing for you to pay.
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
          {/* Totals summary */}
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="partner-billing-totals">
            <Card className="p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500">Pending commission</div>
              <div className="mt-1 font-mono text-lg" data-testid="partner-billing-total-pending">
                {formatMinor(pendingTotal)}
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500">Paid commission</div>
              <div className="mt-1 font-mono text-lg" data-testid="partner-billing-total-paid">
                {formatMinor(paidTotal)}
              </div>
            </Card>
          </div>

          {isLoading && (
            <div className="text-sm text-slate-500" data-testid="partner-billing-loading">
              Loading…
            </div>
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
    </PartnerShell>
  );
}
