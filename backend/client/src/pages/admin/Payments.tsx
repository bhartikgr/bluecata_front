/**
 * /admin/payments — v25.32 P1h
 *
 * Unified admin payment-ledger view. Reads ONLY from the durable
 * `payment_ledger` SQLite table via GET /api/admin/payments (DB-only — no
 * in-memory state). Simple paginated table with state + since filters.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Receipt, RefreshCw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface AdminPaymentRow {
  id: string;
  intentId: string;
  customerId: string;
  amount: number;
  currency: string;
  state: string;
  kind: string;
  ts: string;
  /* v25.32 A4 — subscription context sourced DB-direct from
   * payment_ledger.entry_json + capavate_subscriptions (null when unknown). */
  plan?: string | null;
  periodEnd?: string | null;
  paymentDate?: string | null;
}

interface AdminPaymentsResponse {
  ok: boolean;
  items: AdminPaymentRow[];
  total: number;
  limit: number;
  offset: number;
}

const STATE_TONE: Record<string, { bg: string; text: string }> = {
  succeeded:     { bg: "bg-emerald-100", text: "text-emerald-900" },
  pending:       { bg: "bg-amber-100",   text: "text-amber-900" },
  requires_3ds:  { bg: "bg-sky-100",     text: "text-sky-900" },
  failed:        { bg: "bg-rose-100",    text: "text-rose-800" },
  refunded:      { bg: "bg-slate-100",   text: "text-slate-700" },
};

function fmtMoney(minor: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toFixed(2)}`;
  }
}
function fmtDate(iso: string): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

const PAGE_SIZE = 100;

export default function AdminPayments() {
  const [stateFilter, setStateFilter] = useState<string>("__all__");
  const [since, setSince] = useState<string>("");
  const [offset, setOffset] = useState(0);

  const qs = new URLSearchParams();
  qs.set("limit", String(PAGE_SIZE));
  qs.set("offset", String(offset));
  if (stateFilter !== "__all__") qs.set("state", stateFilter);
  if (since) qs.set("since", new Date(since).toISOString());

  const { data, isLoading, refetch, isFetching } = useQuery<AdminPaymentsResponse>({
    queryKey: ["/api/admin/payments", stateFilter, since, offset],
    queryFn: async () => (await apiRequest("GET", `/api/admin/payments?${qs.toString()}`)).json(),
    retry: false,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + PAGE_SIZE, total);

  return (
    <>
      <PageHeader
        title="Payments"
        description="Unified payment ledger across all gateways. Read-only, sourced from the durable payment_ledger table."
        breadcrumbs={[{ label: "Admin" }, { label: "Payments" }]}
      />
      <PageBody>
        <Card data-testid="card-admin-payments">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2 justify-between">
              <span className="flex items-center gap-2"><Receipt className="h-4 w-4" />Payment ledger</span>
              <Button size="sm" variant="outline" onClick={() => refetch()} className="h-7" data-testid="button-refresh-payments">
                <RefreshCw className="h-3 w-3 mr-1" />Refresh
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Filters */}
            <div className="flex flex-wrap items-end gap-3 mb-4">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">State</label>
                <Select value={stateFilter} onValueChange={(v) => { setStateFilter(v); setOffset(0); }}>
                  <SelectTrigger className="h-8 w-40" data-testid="select-payment-state">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All states</SelectItem>
                    <SelectItem value="succeeded">Succeeded</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="requires_3ds">Requires 3DS</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                    <SelectItem value="refunded">Refunded</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Since</label>
                <Input
                  type="date"
                  value={since}
                  onChange={(e) => { setSince(e.target.value); setOffset(0); }}
                  className="h-8 w-40"
                  data-testid="input-payment-since"
                />
              </div>
            </div>

            <Table data-testid="table-admin-payments">
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Intent</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Kind</TableHead>
                  {/* v25.32 A4 — plan + period end + payment date */}
                  <TableHead>Plan</TableHead>
                  <TableHead>Period end</TableHead>
                  <TableHead>Payment date</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={10} className="text-center py-6"><div className="h-4 w-32 bg-muted animate-pulse rounded mx-auto" /></TableCell></TableRow>
                ) : items.length === 0 ? (
                  /* v25.32 burndown — item 62: richer, filter-aware empty state.
                     The prior copy was a flat "No payments found." which gave an
                     admin no signal about WHY the ledger looked empty (genuinely
                     no payments yet vs. an active state/since filter excluding
                     everything). Distinguish the two cases and offer a one-click
                     "Clear filters" path. Presentational only — no new data
                     source or in-memory state. Source: Payments.tsx:160. */
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground py-10" data-testid="empty-admin-payments">
                      {(stateFilter !== "__all__" || since) ? (
                        <div className="flex flex-col items-center gap-2">
                          <Receipt className="h-6 w-6 opacity-40" />
                          <div className="text-sm font-medium">No payments match the current filters</div>
                          <div className="text-xs">
                            {stateFilter !== "__all__" ? <>State <span className="font-mono">{stateFilter}</span></> : null}
                            {stateFilter !== "__all__" && since ? " · " : null}
                            {since ? <>Since <span className="font-mono">{since}</span></> : null}
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 mt-1"
                            data-testid="button-clear-payment-filters"
                            onClick={() => { setStateFilter("__all__"); setSince(""); setOffset(0); }}
                          >
                            Clear filters
                          </Button>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-2">
                          <Receipt className="h-6 w-6 opacity-40" />
                          <div className="text-sm font-medium">No payments recorded yet</div>
                          <div className="text-xs max-w-md">
                            Payments appear here once a gateway webhook lands and writes to the durable
                            <span className="font-mono"> payment_ledger</span> table. If you expected
                            entries, verify the gateway is configured and webhooks are reaching the server.
                          </div>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((p) => {
                    const tone = STATE_TONE[p.state] ?? { bg: "bg-slate-100", text: "text-slate-700" };
                    return (
                      <TableRow key={p.id} data-testid={`row-payment-${p.id}`}>
                        <TableCell className="font-mono text-[11px]">{p.id}</TableCell>
                        <TableCell className="font-mono text-[11px]">{p.intentId}</TableCell>
                        <TableCell className="text-[11px]">{p.customerId}</TableCell>
                        <TableCell className="text-right font-mono text-[12px]">{fmtMoney(p.amount, p.currency)}</TableCell>
                        <TableCell><Badge className={`text-[10px] border-0 ${tone.bg} ${tone.text}`}>{p.state}</Badge></TableCell>
                        <TableCell className="text-[11px]">{p.kind}</TableCell>
                        {/* v25.32 A4 — plan/period end/payment date; em-dash when DB has no value (never synthesized). */}
                        <TableCell className="text-[11px]" data-testid={`cell-payment-plan-${p.id}`}>{p.plan ?? "—"}</TableCell>
                        <TableCell className="text-[11px]" data-testid={`cell-payment-period-end-${p.id}`}>{p.periodEnd ? fmtDate(p.periodEnd) : "—"}</TableCell>
                        <TableCell className="text-[11px]" data-testid={`cell-payment-payment-date-${p.id}`}>{p.paymentDate ? fmtDate(p.paymentDate) : "—"}</TableCell>
                        <TableCell className="text-[11px]">{fmtDate(p.ts)}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground">
              <span data-testid="text-payments-range">
                {total === 0 ? "0 results" : `${pageStart}–${pageEnd} of ${total}`}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7"
                  disabled={offset === 0 || isFetching}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  data-testid="button-payments-prev"
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7"
                  disabled={pageEnd >= total || isFetching}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                  data-testid="button-payments-next"
                >
                  Next
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
