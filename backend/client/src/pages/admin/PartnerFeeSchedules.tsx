/* v25.33 Consortium Partner Payment Model — DB-driven, no in-memory.
 * /admin/partner-fees — admin UI for the partner fee catalogue. Reads + writes
 * partner_fee_schedules ONLY via /api/admin/partner-fees (DB-direct). Every fee
 * amount/currency/band shown here comes from the DB; nothing is hardcoded.
 */
import { useState } from "react";
import { formatMinor, toMinor } from "@/lib/currency"; /* v25.38 currency sweep; v25.40 FIX-4 toMinor */
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { DollarSign, Plus, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface FeeScheduleRow {
  id: string;
  tier: string | null;
  fee_kind: string;
  amount_minor: number;
  currency: string;
  size_band_min: number | null;
  size_band_max: number | null;
  effective_from: string;
  effective_to: string | null;
}

const FEE_KINDS = [
  { value: "subscription_monthly", label: "Subscription — Monthly" },
  { value: "subscription_annual", label: "Subscription — Annual" },
  { value: "spv_deployment", label: "SPV Deployment (banded)" },
  { value: "spv_management_per_lp_quarter", label: "SPV Mgmt / LP / Quarter" },
  { value: "spv_closing_bonus", label: "SPV Closing Bonus" },
];
const TIERS = ["", "catalyst", "builder", "amplifier", "nexus", "founding_member"];

function fmtMoney(minor: number, currency = "USD"): string {
  // v25.38 — delegate to shared ISO-4217-aware formatter (2-decimal parity).
  return formatMinor(minor, currency, { locale: "en-US" });
}
// v25.40 round-2 (per GPT-5.5): size-band display must use the SAME currency
// as the amount column (`r.currency`) so a JPY band doesn't render as USD.
// fmtMoney's `currency = "USD"` default was being relied on here; pass the
// row currency through.
function fmtBand(min: number | null, max: number | null, currency: string): string {
  if (min === null && max === null) return "—";
  const lo = min === null ? "0" : fmtMoney(min, currency);
  const hi = max === null ? "∞" : fmtMoney(max, currency);
  return `${lo} – ${hi}`;
}

export default function PartnerFeeSchedules() {
  const { toast } = useToast();
  const [feeKindFilter, setFeeKindFilter] = useState("__all__");
  const [showCreate, setShowCreate] = useState(false);

  const [form, setForm] = useState({
    feeKind: "subscription_monthly", tier: "", amountMajor: "", currency: "USD",
    sizeBandMinMajor: "", sizeBandMaxMajor: "",
  });

  const qs = new URLSearchParams();
  if (feeKindFilter !== "__all__") qs.set("feeKind", feeKindFilter);
  qs.set("includeExpired", "false");

  const { data, isLoading } = useQuery<{ ok: boolean; schedules: FeeScheduleRow[]; total: number }>({
    queryKey: ["/api/admin/partner-fees", feeKindFilter],
    queryFn: async () => (await apiRequest("GET", `/api/admin/partner-fees?${qs.toString()}`)).json(),
    retry: false,
  });

  const createMut = useMutation({
    mutationFn: async () => {
      // v25.40 FIX-4 (sync P1 #4): mirror CollectivePaymentSchedules — delegate to
      // the shared ISO 4217-aware toMinor() instead of hardcoded `* 100`, which
      // persisted 100x-too-large amount_minor for JPY/KRW (0-decimal) and
      // 10x-too-small for BHD (3-decimal). Uppercase + trim the currency first
      // (FIX-13) and reject non-finite/negative input before POST so the server
      // only ever sees a valid integer minor-unit amount in the correct currency.
      const currency = (form.currency || "USD").trim().toUpperCase();
      if (!currency) throw new Error("invalid_currency");
      const amountMajor = parseFloat(form.amountMajor || "0");
      if (!Number.isFinite(amountMajor) || amountMajor < 0) {
        throw new Error("invalid_amount");
      }
      const amountMinor = toMinor(amountMajor, currency);
      const body: Record<string, unknown> = {
        feeKind: form.feeKind,
        tier: form.tier || null,
        amountMinor,
        currency,
      };
      if (form.feeKind === "spv_deployment") {
        const bandMin = form.sizeBandMinMajor ? parseFloat(form.sizeBandMinMajor) : null;
        const bandMax = form.sizeBandMaxMajor ? parseFloat(form.sizeBandMaxMajor) : null;
        if (bandMin !== null && (!Number.isFinite(bandMin) || bandMin < 0)) throw new Error("invalid_band_min");
        if (bandMax !== null && (!Number.isFinite(bandMax) || bandMax < 0)) throw new Error("invalid_band_max");
        body.sizeBandMin = bandMin === null ? null : toMinor(bandMin, currency);
        body.sizeBandMax = bandMax === null ? null : toMinor(bandMax, currency);
      }
      const r = await apiRequest("POST", "/api/admin/partner-fees", body);
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "create_failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partner-fees", feeKindFilter] });
      setShowCreate(false);
      toast({ title: "Fee schedule created" });
    },
    onError: (e: any) => toast({ title: "Create failed", description: e?.message, variant: "destructive" }),
  });

  const expireMut = useMutation({
    mutationFn: async (id: string) => {
      const r = await apiRequest("DELETE", `/api/admin/partner-fees/${id}`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "expire_failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partner-fees", feeKindFilter] });
      toast({ title: "Fee schedule expired" });
    },
    onError: (e: any) => toast({ title: "Action failed", description: e?.message, variant: "destructive" }),
  });

  const rows = data?.schedules ?? [];

  return (
    <>
      <PageHeader title="Partner Fee Schedules" description="Admin-configurable consortium-partner fee catalogue. Platform defaults (tier = —) apply to all partners; per-tier rows override them. SPV deployment fees use stepped size bands." />
      <PageBody>
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <Select value={feeKindFilter} onValueChange={setFeeKindFilter}>
            <SelectTrigger className="w-64" data-testid="select-fee-kind-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All fee kinds</SelectItem>
              {FEE_KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={() => setShowCreate((s) => !s)} data-testid="button-new-fee-schedule">
            <Plus className="h-4 w-4 mr-2" /> New fee schedule
          </Button>
        </div>

        {showCreate && (
          <Card className="mb-4 border-2 border-[#cc0001]/40" data-testid="card-create-fee">
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><DollarSign className="h-4 w-4" /> Create fee schedule</CardTitle></CardHeader>
            <CardContent className="grid md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Fee kind</Label>
                <Select value={form.feeKind} onValueChange={(v) => setForm((f) => ({ ...f, feeKind: v }))}>
                  <SelectTrigger data-testid="select-new-fee-kind"><SelectValue /></SelectTrigger>
                  <SelectContent>{FEE_KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Tier (blank = platform default)</Label>
                <Select value={form.tier || "__platform__"} onValueChange={(v) => setForm((f) => ({ ...f, tier: v === "__platform__" ? "" : v }))}>
                  <SelectTrigger data-testid="select-new-fee-tier"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__platform__">Platform default (all tiers)</SelectItem>
                    {TIERS.filter(Boolean).map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Amount (major units)</Label>
                <Input type="number" min="0" step="0.01" value={form.amountMajor} onChange={(e) => setForm((f) => ({ ...f, amountMajor: e.target.value }))} placeholder="0.00" data-testid="input-new-fee-amount" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Currency</Label>
                <Input value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))} data-testid="input-new-fee-currency" />
              </div>
              {form.feeKind === "spv_deployment" && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Band min (major)</Label>
                    <Input type="number" min="0" step="0.01" value={form.sizeBandMinMajor} onChange={(e) => setForm((f) => ({ ...f, sizeBandMinMajor: e.target.value }))} placeholder="0" data-testid="input-new-fee-band-min" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Band max (major, blank = ∞)</Label>
                    <Input type="number" min="0" step="0.01" value={form.sizeBandMaxMajor} onChange={(e) => setForm((f) => ({ ...f, sizeBandMaxMajor: e.target.value }))} placeholder="(open-ended)" data-testid="input-new-fee-band-max" />
                  </div>
                </>
              )}
              <div className="md:col-span-3 flex gap-2">
                <Button onClick={() => createMut.mutate()} disabled={createMut.isPending} data-testid="button-save-fee-schedule">Save</Button>
                <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle className="text-base">Active fee schedules ({data?.total ?? 0})</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground" data-testid="text-fees-loading">Loading fee catalogue…</p>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="empty-fee-schedules">No active fee schedules for this filter. Use “New fee schedule” to add one — the seeded $0 platform defaults keep the resolver from failing on a fresh deploy.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fee kind</TableHead><TableHead>Tier</TableHead><TableHead>Amount</TableHead>
                    <TableHead>Size band</TableHead><TableHead>Effective from</TableHead><TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id} data-testid={`row-fee-${r.id}`}>
                      <TableCell className="font-medium">{r.fee_kind}</TableCell>
                      <TableCell>{r.tier ? <Badge variant="secondary">{r.tier}</Badge> : <span className="text-muted-foreground">platform</span>}</TableCell>
                      <TableCell>{fmtMoney(r.amount_minor, r.currency)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmtBand(r.size_band_min, r.size_band_max, r.currency)}</TableCell>
                      <TableCell className="text-xs">{new Date(r.effective_from).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => expireMut.mutate(r.id)} data-testid={`button-expire-fee-${r.id}`}>
                          <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                        </Button>
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
