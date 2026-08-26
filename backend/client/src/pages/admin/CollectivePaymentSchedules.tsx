/* v25.34 Collective Payment Model — DB-driven, no in-memory.
 * /admin/collective-payment-schedules — admin UI for the Collective fee
 * catalogue. Reads + writes collective_payment_schedules ONLY via
 * /api/admin/collective-payments/schedules (DB-direct). Every fee amount/
 * currency shown here comes from the DB; nothing is hardcoded. Parallel to the
 * v25.33 PartnerFeeSchedules page; touches no Avi write path.
 */
import { useMemo, useState } from "react";
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
import {
  decimalStringToMinor,
  formatMinor,
  moneyInputRefusalMessage,
} from "@/lib/currency";
import { useToast } from "@/hooks/use-toast";
import { labelFor, FEE_KIND_LABELS, CADENCE_LABELS } from "@/lib/collectiveLabels"; /* W3.6 */

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
  /* WAVE 152 columns (migration 0200). A zero price is only a price if somebody
     attested to it; otherwise it is an unknown, and R111 Q13 says an unknown
     reads "Not on record" — never "$0.00". */
  intentional_zero?: number | null;
  intentional_zero_reason?: string | null;
}

/** R111 Q13 — the honest answer when the platform does not know the price. */
const NOT_ON_RECORD = "Not on record";

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
    /* WAVE 158 · R119 — a zero price has to be said out loud. */
    intentionalZero: false, intentionalZeroReason: "",
  });

  const qs = new URLSearchParams();
  if (feeKindFilter !== "__all__") qs.set("feeKind", feeKindFilter);
  qs.set("includeExpired", "false");

  const { data, isLoading, isError, refetch, isFetching } = useQuery<{ ok: boolean; schedules: ScheduleRow[]; total: number }>({
    queryKey: ["/api/admin/collective-payments/schedules", feeKindFilter],
    queryFn: async () => (await apiRequest("GET", `/api/admin/collective-payments/schedules?${qs.toString()}`)).json(),
    retry: false,
  });

  const createMut = useMutation({
    mutationFn: async () => {
      /* ══ WAVE 158 · R119 — THE BLANK-PRICE HAZARD, REMOVED ════════════════
         What stood here was `parseFloat(form.amountMajor || "0")`. An untouched
         amount box therefore became a real, audited $0.00 price and the page said
         "Schedule created" — the likely origin of the five $0.00 rows verified
         live (R120.4). `parseFloat` is gone: there is now NO arithmetic on money
         in this file at all.

         The typed decimal STRING is sent as `amountMajor` and scaled on the
         server by `decimalStringToMinor` (server/lib/money.ts), which is ISO-4217
         exponent-aware — JPY/KRW at 0 decimals and BHD/KWD at 3 stay correct, and
         a half-unit is refused rather than rounded. That is the same
         currency-aware behaviour the v25.37 fix installed via `toMinor`; it is NOT
         a regression to `* 100`.

         WAVE 159 · R126.5 — the PREVIEW below now runs that same exact-decimal
         parser on the client (`decimalStringToMinor` in `@/lib/currency`), so the
         screen can no longer promise a stored value the server would refuse. */
      const typed = form.amountMajor.trim();
      const currency = (form.currency || "USD").toUpperCase();
      if (typed === "") {
        throw new Error(
          "Enter the amount for this schedule. Nothing was created — a blank amount is not read as zero. If this fee really is free, tick “This fee is free of charge” and write why.",
        );
      }
      if (!/^\d+(\.\d+)?$/.test(typed)) {
        throw new Error(
          "That amount could not be read. Enter it in the usual way, for example 1500 or 1500.00. Nothing was created.",
        );
      }
      if (form.intentionalZero && form.intentionalZeroReason.trim() === "") {
        throw new Error(
          "Write why this fee is free of charge. Nothing was created — a zero price with no reason cannot be told apart from a mistake.",
        );
      }
      const body: Record<string, unknown> = {
        scopeKind: form.scopeKind,
        feeKind: form.feeKind,
        amountMajor: typed,
        currency,
        cadence: form.cadence,
        chapterId: form.chapterId || null,
        intentionalZero: form.intentionalZero,
        intentionalZeroReason: form.intentionalZeroReason.trim(),
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
    onError: (e: any) => toast({ title: "Nothing was created", description: e?.message, variant: "destructive" }),
  });

  const expireMut = useMutation({
    mutationFn: async (id: string) => {
      /* WAVE 158 · R120.2 — THE CONFIRM NOW DESCRIBES THE DATA.
         It used to say "This cannot be undone", which was inaccurate: the server
         only sets `effective_to` (server/lib/collectivePaymentAdminRoutes.ts) and
         there is no `DELETE FROM collective_payment_schedules` anywhere. The row
         is retained — that retention is what protects historical receipts, which
         is also why R120.3 forbids an in-place amount edit here. Cancelling is a
         no-op, unchanged. */
      if (typeof window !== "undefined" && !window.confirm("End this fee schedule? It stops applying to new charges from now on. The record is kept for history and is not deleted.")) {
        throw new Error("cancelled");
      }
      const r = await apiRequest("DELETE", `/api/admin/collective-payments/schedules/${id}`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "expire_failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/collective-payments/schedules", feeKindFilter] });
      toast({
        title: "Schedule ended",
        description: "The record is kept for history. It no longer applies to new charges.",
      });
    },
    onError: (e: any) => {
      if (e?.message === "cancelled") return; // user declined the confirm — silent no-op
      toast({ title: "Action failed", description: e?.message, variant: "destructive" });
    },
  });

  const rawRows = data?.schedules ?? [];

  /* WAVE 158 · R119 / R111 Q13 — the amount cell is computed HERE, not decided
     inside the JSX, so the table keeps one static shape (the drop gate trips when
     sibling JSX is replaced by a conditional) and so the "unattested zero" rule
     lives in exactly one place. */
  const rows = useMemo(
    () =>
      rawRows.map((r) => {
        const attested = Number(r.intentional_zero ?? 0) === 1;
        const isZero = Number(r.amount_minor) === 0;
        return {
          ...r,
          /* Three distinct readings, never merged:
               a real price        → the formatted amount;
               a DELIBERATE zero   → said to be free, with the reason given;
               an UNEXPLAINED zero → "Not on record" (R111 Q13), never "$0.00",
                                     because nobody attested that it is free. */
          amountText: !isZero
            ? fmtMoney(r.amount_minor, r.currency)
            : attested
              ? `Free of charge — ${String(r.intentional_zero_reason ?? "").trim() || NOT_ON_RECORD}`
              : NOT_ON_RECORD,
        };
      }),
    [rawRows],
  );

  /* The operator sees the stored amount BEFORE committing.
     WAVE 159 · R126.5 — this preview used `toMinor(Number(typed), currency)`, so
     it PROMISED "$10.01" for a typed `10.005` that the server then refused. The
     preview now runs the SAME exact-decimal parser as the write paths, so what it
     shows is what will be stored — or it says plainly that the amount cannot be
     stored at all. Currency-aware scaling is unchanged; no return to `* 100`. */
  const amountPreview = useMemo(() => {
    const typed = form.amountMajor.trim();
    const currency = (form.currency || "USD").toUpperCase();
    if (typed === "") return "No amount entered yet. A blank amount is refused, not treated as zero.";
    try {
      const minor = decimalStringToMinor(typed, currency);
      if (minor < 0) return "An amount cannot be negative.";
      return `Will be stored as ${formatMinor(minor, currency)}.`;
    } catch (err) {
      return moneyInputRefusalMessage(err, currency);
    }
  }, [form.amountMajor, form.currency]);

  return (
    <>
      <PageHeader
        title="Collective Payment Schedules"
        breadcrumbs={[{ href: "/admin/dashboard", label: "Admin" }, { label: "Collective Payment Schedules" }]}
        description="Admin-configurable Collective fee catalogue. Platform defaults apply to all members; per-tier rows override them; per-member rows take highest precedence. Quote-only — no charges are made automatically."
      />
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
                <p className="text-xs text-muted-foreground" data-testid="text-cps-amount-preview">{amountPreview}</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Currency</Label>
                <Input value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))} data-testid="input-cps-currency" />
              </div>
              {/* WAVE 158 · R119 — an intentional zero, said out loud and recorded. */}
              <div className="space-y-1.5 md:col-span-3">
                <label className="flex items-center gap-2 text-xs" htmlFor="cps-free">
                  <input
                    id="cps-free"
                    type="checkbox"
                    checked={form.intentionalZero}
                    onChange={(e) => setForm((f) => ({ ...f, intentionalZero: e.target.checked }))}
                    data-testid="checkbox-cps-free"
                  />
                  <span>This fee is free of charge (a price of zero, on purpose)</span>
                </label>
                <Input
                  value={form.intentionalZeroReason}
                  onChange={(e) => setForm((f) => ({ ...f, intentionalZeroReason: e.target.value }))}
                  placeholder="Why is it free? Required for a zero price, and kept on the record."
                  data-testid="input-cps-free-reason"
                />
                <p className="text-xs text-muted-foreground">
                  A zero amount is only saved when this is ticked and a reason is written. Otherwise the
                  schedule is refused, so a blank box can never become a real $0.00 price.
                </p>
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
            ) : isError || (data && !data.ok) ? (
              <div className="flex flex-col items-start gap-2" data-testid="error-cps">
                <p className="text-sm text-rose-600">Couldn’t load the fee catalogue.</p>
                <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} data-testid="button-retry-cps">
                  {isFetching ? "Retrying…" : "Retry"}
                </Button>
              </div>
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
                      <TableCell className="font-medium">{labelFor(FEE_KIND_LABELS, r.fee_kind)}</TableCell>
                      <TableCell>
                        {r.scope_kind === "platform"
                          ? <span className="text-muted-foreground">Platform</span>
                          : <Badge variant="secondary">{r.scope_kind === "tier" ? labelFor({}, r.tier ?? undefined) : `Member: ${(r.member_id || "").slice(0, 8)}`}</Badge>}
                      </TableCell>
                      <TableCell>{r.amountText}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{labelFor(CADENCE_LABELS, r.cadence)}</TableCell>
                      <TableCell className="text-xs">{new Date(r.effective_from).toLocaleDateString()}</TableCell>
                      <TableCell>
                        {/* WAVE 158 · R120.2 — the unlabelled red trash can said
                            "delete" to every operator who saw it, while the server
                            only ends the schedule. It is now labelled for what it
                            does, in words, with an aria-label for screen readers. */}
                        <Button variant="ghost" size="sm" onClick={() => expireMut.mutate(r.id)} aria-label={`End schedule ${labelFor(FEE_KIND_LABELS, r.fee_kind)}`} title="Ends the schedule. The record is kept for history." data-testid={`button-expire-cps-${r.id}`}>
                          <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                          <span className="ml-1.5 text-xs">End schedule</span>
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
