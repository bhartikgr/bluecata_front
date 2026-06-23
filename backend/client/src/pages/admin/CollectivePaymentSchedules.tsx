/* v25.34 Collective Payment Model — DB-driven, no in-memory.
 * /admin/collective-payment-schedules — admin UI for the Collective fee
 * catalogue. Reads + writes collective_payment_schedules ONLY via
 * /api/admin/collective-payments/schedules (DB-direct). Every fee amount/
 * currency shown here comes from the DB; nothing is hardcoded. Parallel to the
 * v25.33 PartnerFeeSchedules page; touches no Avi write path.
 */
import { useState } from "react";
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
import { formatMinor, toMinor } from "@/lib/currency";
import { useToast } from "@/hooks/use-toast";

interface ScheduleRow {
  id: string;
  scope_kind: string;
  member_id: string | null;
  tier: string | null;
  chapter_id: string | null;
  fee_kind: string;
  amount_minor: number;
  currency: string;
  cadence: string;
  effective_from: string;
  effective_to: string | null;
}

const FEE_KINDS = [
  { value: "membership_dues", label: "Membership Dues" },
  { value: "event_fee", label: "Event Fee" },
  { value: "sponsorship_fee", label: "Sponsorship Fee" },
  { value: "chapter_dues", label: "Chapter Dues" },
  { value: "late_fee", label: "Late Fee" },
];
const SCOPES = [
  { value: "platform", label: "Platform default (all members)" },
  { value: "tier", label: "Per-tier default" },
  { value: "member", label: "Per-member override" },
];
const TIERS = ["basic", "standard", "premium"];
const CADENCES = ["one_time", "monthly", "quarterly", "annual"];

// v25.37 (BLOCKER B-Currency): delegate to the shared ISO 4217-aware
// formatMinor so JPY/KRW (0-decimal) and BHD/JOD/KWD (3-decimal) render with
// the correct number of fraction digits instead of a hardcoded `/ 100`. This
// is the single high-impact client surface migrated in v25.37; the remaining
// inline formatters are catalogued for the v25.38 sweep. UI look/feel is
// unchanged for the common 2-decimal currencies (USD/EUR/…).
function fmtMoney(minor: number, currency = "USD"): string {
  return formatMinor(minor, currency);
}

export default function CollectivePaymentSchedules() {
  const { toast } = useToast();
  const [feeKindFilter, setFeeKindFilter] = useState("__all__");
  const [showCreate, setShowCreate] = useState(false);

  const [form, setForm] = useState({
    scopeKind: "platform", feeKind: "membership_dues", tier: "basic",
    memberId: "", chapterId: "", amountMajor: "", currency: "USD", cadence: "annual",
  });

  const qs = new URLSearchParams();
  if (feeKindFilter !== "__all__") qs.set("feeKind", feeKindFilter);
  qs.set("includeExpired", "false");

  const { data, isLoading } = useQuery<{ ok: boolean; schedules: ScheduleRow[]; total: number }>({
    queryKey: ["/api/admin/collective-payments/schedules", feeKindFilter],
    queryFn: async () => (await apiRequest("GET", `/api/admin/collective-payments/schedules?${qs.toString()}`)).json(),
    retry: false,
  });

  const createMut = useMutation({
    mutationFn: async () => {
      // v25.37 (BLOCKER B-Currency, round-2 fix per GPT-5.5): delegate to the
      // shared ISO 4217-aware toMinor() instead of hardcoded `* 100`. The
      // previous hardcode persisted 100x-too-large amount_minor for JPY/KRW
      // (0-decimal) and 10x-too-small for BHD/JOD/KWD/OMR/TND (3-decimal),
      // which then displayed via formatMinor as wrong prices. Reject non-finite
      // or negative input before POST so the server only ever sees a valid
      // integer minor-unit amount.
      const amountMajor = parseFloat(form.amountMajor || "0");
      if (!Number.isFinite(amountMajor) || amountMajor < 0) {
        throw new Error("invalid_amount");
      }
      const currency = (form.currency || "USD").toUpperCase();
      const amountMinor = toMinor(amountMajor, currency);
      const body: Record<string, unknown> = {
        scopeKind: form.scopeKind,
        feeKind: form.feeKind,
        amountMinor,
        currency,
        cadence: form.cadence,
        chapterId: form.chapterId || null,
      };
      if (form.scopeKind === "tier") body.tier = form.tier;
      if (form.scopeKind === "member") body.memberId = form.memberId;
      const r = await apiRequest("POST", "/api/admin/collective-payments/schedules", body);
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "create_failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/collective-payments/schedules", feeKindFilter] });
      setShowCreate(false);
      toast({ title: "Schedule created" });
    },
    onError: (e: any) => toast({ title: "Create failed", description: e?.message, variant: "destructive" }),
  });

  const expireMut = useMutation({
    mutationFn: async (id: string) => {
      const r = await apiRequest("DELETE", `/api/admin/collective-payments/schedules/${id}`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "expire_failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/collective-payments/schedules", feeKindFilter] });
      toast({ title: "Schedule expired" });
    },
    onError: (e: any) => toast({ title: "Action failed", description: e?.message, variant: "destructive" }),
  });

  const rows = data?.schedules ?? [];

  return (
    <>
      <PageHeader title="Collective Payment Schedules" description="Admin-configurable Collective fee catalogue. Platform defaults apply to all members; per-tier rows override them; per-member rows take highest precedence. Quote-only — no charges are made automatically." />
      <PageBody>
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <Select value={feeKindFilter} onValueChange={setFeeKindFilter}>
            <SelectTrigger className="w-64" data-testid="select-cps-fee-kind-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All fee kinds</SelectItem>
              {FEE_KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={() => setShowCreate((s) => !s)} data-testid="button-new-cps">
            <Plus className="h-4 w-4 mr-2" /> New schedule
          </Button>
        </div>

        {showCreate && (
          <Card className="mb-4 border-2 border-[#cc0001]/40" data-testid="card-create-cps">
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><DollarSign className="h-4 w-4" /> Create payment schedule</CardTitle></CardHeader>
            <CardContent className="grid md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Scope</Label>
                <Select value={form.scopeKind} onValueChange={(v) => setForm((f) => ({ ...f, scopeKind: v }))}>
                  <SelectTrigger data-testid="select-cps-scope"><SelectValue /></SelectTrigger>
                  <SelectContent>{SCOPES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Fee kind</Label>
                <Select value={form.feeKind} onValueChange={(v) => setForm((f) => ({ ...f, feeKind: v }))}>
                  <SelectTrigger data-testid="select-cps-kind"><SelectValue /></SelectTrigger>
                  <SelectContent>{FEE_KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Cadence</Label>
                <Select value={form.cadence} onValueChange={(v) => setForm((f) => ({ ...f, cadence: v }))}>
                  <SelectTrigger data-testid="select-cps-cadence"><SelectValue /></SelectTrigger>
                  <SelectContent>{CADENCES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {form.scopeKind === "tier" && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Tier</Label>
                  <Select value={form.tier} onValueChange={(v) => setForm((f) => ({ ...f, tier: v }))}>
                    <SelectTrigger data-testid="select-cps-tier"><SelectValue /></SelectTrigger>
                    <SelectContent>{TIERS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
              {form.scopeKind === "member" && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Member ID</Label>
                  <Input value={form.memberId} onChange={(e) => setForm((f) => ({ ...f, memberId: e.target.value }))} placeholder="member user id" data-testid="input-cps-member" />
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs">Amount (major units)</Label>
                <Input type="number" min="0" step="0.01" value={form.amountMajor} onChange={(e) => setForm((f) => ({ ...f, amountMajor: e.target.value }))} placeholder="0.00" data-testid="input-cps-amount" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Currency</Label>
                <Input value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))} data-testid="input-cps-currency" />
              </div>
              <div className="md:col-span-3 flex gap-2">
                <Button onClick={() => createMut.mutate()} disabled={createMut.isPending} data-testid="button-save-cps">Save</Button>
                <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle className="text-base">Active schedules ({data?.total ?? 0})</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground" data-testid="text-cps-loading">Loading catalogue…</p>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="empty-cps">No active schedules for this filter. Use “New schedule” to add one — the seeded $0 platform defaults keep the resolver from failing on a fresh deploy.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fee kind</TableHead><TableHead>Scope</TableHead><TableHead>Amount</TableHead>
                    <TableHead>Cadence</TableHead><TableHead>Effective from</TableHead><TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id} data-testid={`row-cps-${r.id}`}>
                      <TableCell className="font-medium">{r.fee_kind}</TableCell>
                      <TableCell>
                        {r.scope_kind === "platform"
                          ? <span className="text-muted-foreground">platform</span>
                          : <Badge variant="secondary">{r.scope_kind === "tier" ? r.tier : `member:${(r.member_id || "").slice(0, 8)}`}</Badge>}
                      </TableCell>
                      <TableCell>{fmtMoney(r.amount_minor, r.currency)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.cadence}</TableCell>
                      <TableCell className="text-xs">{new Date(r.effective_from).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => expireMut.mutate(r.id)} data-testid={`button-expire-cps-${r.id}`}>
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
