/* v25.33 Consortium Partner Payment Model — DB-driven, no in-memory.
 * /admin/partner-pl — partner profit & loss view. Aggregates partner_billing_entries
 * DB-direct via GET /api/admin/partner-pl (referral commissions + SPV deployment
 * fees + any other entry kinds). Totals by status and per-entry rows are computed
 * server-side from the database; the page renders them verbatim. "Mark paid"
 * reconciles a single entry via POST /api/admin/partner-pl/:entryId/mark-paid.
 */
import { useState } from "react";
import { formatMinor } from "@/lib/currency"; /* v25.38 currency sweep */
import { useQuery, useMutation } from "@tanstack/react-query";
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
import { BarChart3, CheckCircle2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface PLEntry {
  id: string;
  partnerId: string;
  partnerName: string | null;
  dealRef: string | null;
  entryKind: string | null;
  amountFundedMinor: number | null;
  commissionPct: number | null;
  commissionMinor: number | null;
  status: string;
  paidAt: string | null;
  createdAt: string | null;
  spvFundId: string | null;
  computedVia: string | null;
}
interface PLResponse {
  ok: boolean;
  entries: PLEntry[];
  totals: { pending: number; paid: number; all: number };
  total: number;
}

const STATUS_FILTERS = [
  { value: "all", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "paid", label: "Paid" },
];

const ENTRY_KIND_LABELS: Record<string, string> = {
  referral_commission: "Referral commission",
  spv_deployment_fee: "SPV deployment fee",
  spv_management_fee: "SPV mgmt fee",
  spv_closing_bonus: "SPV closing bonus",
  subscription_charge: "Subscription",
};

function fmtMoney(minor: number | null, currency = "USD"): string {
  // v25.38 — delegate to shared ISO-4217-aware formatter (2-decimal parity).
  return formatMinor(minor ?? 0, currency, { locale: "en-US" });
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(); } catch { return "—"; }
}
function kindLabel(k: string | null): string {
  if (!k) return "—";
  return ENTRY_KIND_LABELS[k] || k;
}

export default function PartnerPL() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("all");
  const [partnerId, setPartnerId] = useState("");

  const qs = new URLSearchParams();
  if (statusFilter !== "all") qs.set("status", statusFilter);
  if (partnerId.trim()) qs.set("partnerId", partnerId.trim());

  const { data, isLoading, error } = useQuery<PLResponse>({
    queryKey: ["/api/admin/partner-pl", statusFilter, partnerId.trim()],
    queryFn: async () => (await apiRequest("GET", `/api/admin/partner-pl?${qs.toString()}`)).json(),
    retry: false,
  });

  const markPaidMut = useMutation({
    mutationFn: async (entryId: string) => {
      const r = await apiRequest("POST", `/api/admin/partner-pl/${entryId}/mark-paid`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "mark_paid_failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partner-pl", statusFilter, partnerId.trim()] });
      toast({ title: "Entry marked paid" });
    },
    onError: (e: any) => toast({ title: "Mark paid failed", description: e?.message, variant: "destructive" }),
  });

  const entries = data?.entries ?? [];
  const totals = data?.totals ?? { pending: 0, paid: 0, all: 0 };

  return (
    <>
      <PageHeader
        title="Partner P&L"
        description="Profit & loss across all consortium-partner billing entries — referral commissions and SPV deployment fees alike. Every amount is the database commission_minor for that entry. Use “Mark paid” to reconcile a pending entry."
      />
      <PageBody>
        {/* Totals cards (DB-computed) */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <Card data-testid="card-total-all">
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Total billable</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-semibold text-[#041e41]">{fmtMoney(totals.all)}</p></CardContent>
          </Card>
          <Card data-testid="card-total-pending">
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Pending</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-semibold text-amber-600">{fmtMoney(totals.pending)}</p></CardContent>
          </Card>
          <Card data-testid="card-total-paid">
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Paid</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-semibold text-emerald-600">{fmtMoney(totals.paid)}</p></CardContent>
          </Card>
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <Input
            value={partnerId}
            onChange={(e) => setPartnerId(e.target.value)}
            placeholder="Filter by partner id (optional)…"
            className="w-72"
            data-testid="input-pl-partner-id"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-48" data-testid="select-pl-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-[#041e41]" /> Billing entries ({data?.total ?? 0})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground" data-testid="text-pl-loading">Loading partner P&L…</p>
            ) : error ? (
              <p className="text-sm text-rose-600" data-testid="text-pl-error">Could not load partner P&L. Please retry.</p>
            ) : entries.length === 0 ? (
              <div className="text-center py-10" data-testid="empty-pl">
                <BarChart3 className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground">
                  No billing entries for this filter. Referral commissions and SPV deployment fees appear here as deals close.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Partner</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Deal / SPV</TableHead>
                    <TableHead className="text-right">Funded</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Billable</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((e) => (
                    <TableRow key={e.id} data-testid={`row-pl-${e.id}`}>
                      <TableCell className="font-medium">{e.partnerName || e.partnerId}</TableCell>
                      <TableCell><Badge variant="outline">{kindLabel(e.entryKind)}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{e.dealRef || e.spvFundId || "—"}</TableCell>
                      <TableCell className="text-right text-xs">{e.amountFundedMinor ? fmtMoney(e.amountFundedMinor) : "—"}</TableCell>
                      <TableCell className="text-right text-xs">
                        {e.commissionPct ? `${e.commissionPct}%` : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right font-medium">{fmtMoney(e.commissionMinor)}</TableCell>
                      <TableCell>
                        <Badge variant={e.status === "paid" ? "default" : "secondary"}>{e.status}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">{fmtDate(e.createdAt)}</TableCell>
                      <TableCell>
                        {e.status === "pending" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => markPaidMut.mutate(e.id)}
                            disabled={markPaidMut.isPending}
                            data-testid={`button-mark-paid-${e.id}`}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1 text-emerald-600" /> Mark paid
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
