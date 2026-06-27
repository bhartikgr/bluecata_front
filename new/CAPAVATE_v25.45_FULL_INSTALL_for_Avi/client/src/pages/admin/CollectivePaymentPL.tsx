/* v25.34 Collective Payment Model — DB-driven, no in-memory.
 * /admin/collective-payment-pl — Collective profit & loss view. Aggregates
 * collective_payment_entries DB-direct via GET /api/admin/collective-payments/pl.
 * Totals are grouped BY CURRENCY (multi-currency aware — improves on v25.33's
 * single-currency PL, which the verifiers flagged). "Mark paid" reconciles a
 * single entry via POST /api/admin/collective-payments/pl/:entryId/mark-paid.
 * Quote-only model: these are owed-amount ledger rows, not card charges.
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
  memberId: string;
  chapterId: string | null;
  entryKind: string | null;
  amountMinor: number | null;
  currency: string;
  status: string;
  scheduleId: string | null;
  invoiceId: string | null;
  computedVia: string | null;
  description: string | null;
  period: string | null;
  createdAt: string | null;
  paidAt: string | null;
}
interface PLResponse {
  ok: boolean;
  entries: PLEntry[];
  byCurrency: Record<string, { pending: number; paid: number; invoiced: number; all: number }>;
  total: number;
}

const STATUS_FILTERS = [
  { value: "all", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "invoiced", label: "Invoiced" },
  { value: "paid", label: "Paid" },
];

const ENTRY_KIND_LABELS: Record<string, string> = {
  membership_dues: "Membership dues",
  event_fee: "Event fee",
  sponsorship_fee: "Sponsorship fee",
  chapter_dues: "Chapter dues",
  late_fee: "Late fee",
};

function fmtMoney(minor: number | null, currency = "USD"): string {
  // v25.38 — delegate to shared ISO-4217-aware formatter (2-decimal parity).
  return formatMinor(minor ?? 0, currency, { locale: "en-US" });
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(); } catch { return "—"; }
}

export default function CollectivePaymentPL() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("all");
  const [memberFilter, setMemberFilter] = useState("");

  const qs = new URLSearchParams();
  if (statusFilter !== "all") qs.set("status", statusFilter);
  if (memberFilter.trim()) qs.set("memberId", memberFilter.trim());

  const { data, isLoading } = useQuery<PLResponse>({
    queryKey: ["/api/admin/collective-payments/pl", statusFilter, memberFilter],
    queryFn: async () => (await apiRequest("GET", `/api/admin/collective-payments/pl?${qs.toString()}`)).json(),
    retry: false,
  });

  const markPaidMut = useMutation({
    mutationFn: async (entryId: string) => {
      const r = await apiRequest("POST", `/api/admin/collective-payments/pl/${entryId}/mark-paid`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "mark_paid_failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/collective-payments/pl", statusFilter, memberFilter] });
      toast({ title: "Entry marked paid" });
    },
    onError: (e: any) => toast({ title: "Action failed", description: e?.message, variant: "destructive" }),
  });

  const entries = data?.entries ?? [];
  const byCurrency = data?.byCurrency ?? {};
  const currencies = Object.keys(byCurrency);

  return (
    <>
      <PageHeader title="Collective P&L" description="Collective payment ledger aggregated from collective_payment_entries. Totals are grouped per currency. Quote-only — these are owed amounts the admin reconciles, not automatic card charges." />
      <PageBody>
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-48" data-testid="select-cpl-status"><SelectValue /></SelectTrigger>
            <SelectContent>{STATUS_FILTERS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
          </Select>
          <Input className="w-64" value={memberFilter} onChange={(e) => setMemberFilter(e.target.value)} placeholder="Filter by member ID" data-testid="input-cpl-member" />
        </div>

        {/* Multi-currency totals — one card per currency present. */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
          {currencies.length === 0 ? (
            <Card data-testid="card-cpl-totals-empty"><CardContent className="py-4 text-sm text-muted-foreground">No ledger entries yet.</CardContent></Card>
          ) : currencies.map((cur) => (
            <Card key={cur} data-testid={`card-cpl-total-${cur}`}>
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="h-4 w-4" /> {cur}</CardTitle></CardHeader>
              <CardContent className="text-xs space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Pending</span><span className="font-medium">{fmtMoney(byCurrency[cur].pending, cur)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Invoiced</span><span className="font-medium">{fmtMoney(byCurrency[cur].invoiced, cur)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Paid</span><span className="font-medium">{fmtMoney(byCurrency[cur].paid, cur)}</span></div>
                <div className="flex justify-between border-t pt-1"><span className="text-muted-foreground">All</span><span className="font-semibold">{fmtMoney(byCurrency[cur].all, cur)}</span></div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Ledger entries ({data?.total ?? 0})</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground" data-testid="text-cpl-loading">Loading ledger…</p>
            ) : entries.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="empty-cpl">No ledger entries for this filter. Entries are created when fees are resolved for members.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Member</TableHead><TableHead>Kind</TableHead><TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead><TableHead>Via</TableHead><TableHead>Created</TableHead><TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((e) => (
                    <TableRow key={e.id} data-testid={`row-cpl-${e.id}`}>
                      <TableCell className="font-mono text-xs">{(e.memberId || "").slice(0, 12)}</TableCell>
                      <TableCell>{ENTRY_KIND_LABELS[e.entryKind || ""] || e.entryKind}</TableCell>
                      <TableCell>{fmtMoney(e.amountMinor, e.currency)}</TableCell>
                      <TableCell>
                        <Badge variant={e.status === "paid" ? "default" : "secondary"}>{e.status}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{e.computedVia || "—"}</TableCell>
                      <TableCell className="text-xs">{fmtDate(e.createdAt)}</TableCell>
                      <TableCell>
                        {e.status !== "paid" && (
                          <Button variant="ghost" size="sm" onClick={() => markPaidMut.mutate(e.id)} disabled={markPaidMut.isPending} data-testid={`button-mark-paid-${e.id}`}>
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 mr-1" /> Mark paid
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
