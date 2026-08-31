/* v25.33 Consortium Partner Payment Model — DB-driven, no in-memory.
 * /admin/partner-fees — admin UI for the partner fee catalogue. Reads + writes
 * partner_fee_schedules ONLY via /api/admin/partner-fees (DB-direct). Every fee
 * amount/currency/band shown here comes from the DB; nothing is hardcoded.
 */
import { useState } from "react";
import {
  decimalStringToMinor,
  formatMinor,
  moneyInputRefusalMessage,
} from "@/lib/currency"; /* v25.38 currency sweep; W159 exact-decimal parser (no parseFloat) */
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
import { labelFor, FEE_KIND_LABELS } from "@/lib/collectiveLabels"; /* W3.6 */
/* WAVE 207 · ITEM A · R195.1 — the header's final sentence said a vehicle fee is decided
   by stepped size bands, i.e. by capital. The original sentence is preserved verbatim on
   the capital arm below (R143.1); migration 0217's CHECK refuses every value that selects
   it, so the corrected sentence is the one that renders. The bands themselves stay. */
import {
  DEFAULT_FEE_BASIS_DIMENSION,
  isCapitalFeeBasisDimension,
} from "@shared/wave207FeeBasisDimension";

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
      /* WAVE 158 · R119 sweep — the same blank-price hazard as
         CollectivePaymentSchedules: `parseFloat(form.amountMajor || "0")` made an
         untouched amount box into a saved 0. Blank is now refused in a plain
         sentence. The currency-aware `toMinor` below is untouched. */
      const typedAmount = String(form.amountMajor ?? "").trim();
      if (typedAmount === "") {
        throw new Error(
          "Enter the amount for this fee schedule. Nothing was created — a blank amount is not read as zero.",
        );
      }
      /* WAVE 159 · R126.5 — `parseFloat` accepted "125abc" as 125 and rounded
         sub-unit amounts (10.005 USD -> 1001) instead of refusing them. The
         exact-decimal parser refuses both; scaling stays currency-aware. */
      let amountMinor: number;
      try {
        amountMinor = decimalStringToMinor(typedAmount, currency);
      } catch (err) {
        throw new Error(`${moneyInputRefusalMessage(err, currency)} Nothing was created.`);
      }
      if (amountMinor < 0) {
        throw new Error(
          "An amount cannot be negative. Enter the amount to charge, for example 1500.00. Nothing was created.",
        );
      }
      const body: Record<string, unknown> = {
        feeKind: form.feeKind,
        tier: form.tier || null,
        amountMinor,
        currency,
      };
      if (form.feeKind === "spv_deployment") {
        /* W159 — the size bands are money too, and they were parsed the loose
           way. Same exact-decimal parser, same plain refusal. */
        let bandMin: number | null = null;
        let bandMax: number | null = null;
        try {
          bandMin = form.sizeBandMinMajor
            ? decimalStringToMinor(form.sizeBandMinMajor, currency, "smallest SPV size")
            : null;
          bandMax = form.sizeBandMaxMajor
            ? decimalStringToMinor(form.sizeBandMaxMajor, currency, "largest SPV size")
            : null;
        } catch (err) {
          throw new Error(`${moneyInputRefusalMessage(err, currency)} Nothing was created.`);
        }
        if (bandMin !== null && bandMin < 0) {
          throw new Error("The smallest SPV size cannot be negative. Nothing was created.");
        }
        if (bandMax !== null && bandMax < 0) {
          throw new Error("The largest SPV size cannot be negative. Nothing was created.");
        }
        body.sizeBandMin = bandMin;
        body.sizeBandMax = bandMax;
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
      {/* WAVE 207 · ITEM A — see the import note above. */}
      {/* WAVE 207 · ITEM A · R143.1 — TWO SIBLING HEADERS, NOT ONE CONDITIONAL STRING.
          A ternary INSIDE the `description` attribute was tried first and broke the
          silent-drop guard: the extractor only records an attribute as copy when its
          value is a plain literal, so wrapping it in an expression made the wave-131
          sentence VANISH from the inventory — a silent drop, even though the bytes were
          still in the file. Appending a static sibling keeps the original literal in the
          inventory and adds the corrected one beside it. The corrected string is spelled
          out here for the same reason (a concatenation is an expression); the sweep test
          asserts it still equals the shared W207 constants, so the two cannot drift. */}
      {isCapitalFeeBasisDimension(DEFAULT_FEE_BASIS_DIMENSION) ? (
        <PageHeader title="Partner Fee Schedules" description="Optional OVERRIDES for consortium-partner fees. The BASE subscription price is set per tier on 'Partner Subscription Tiers' (Consortium Partners → Commission & tier pricing) and is what the public /consortium/pricing page advertises AND charges. Rows here only OVERRIDE that base for specific tiers or (via a partner's detail page) individual partners — e.g. to grant a partner an individual discount. Precedence: per-partner override → per-tier default → platform default (tier = —). If no override exists, the tier base price applies. SPV deployment fees use stepped size bands." />
      ) : (
        <PageHeader title="Partner Fee Schedules" description="Optional OVERRIDES for consortium-partner fees. The BASE subscription price is set per tier on 'Partner Subscription Tiers' (Consortium Partners → Commission & tier pricing) and is what the public /consortium/pricing page advertises AND charges. Rows here only OVERRIDE that base for specific tiers or (via a partner's detail page) individual partners — e.g. to grant a partner an individual discount. Precedence: per-partner override → per-tier default → platform default (tier = —). If no override exists, the tier base price applies. A flat amount for the vehicle. Any future banding may only count investors, jurisdictions, documents or duration — never capital, so the amount cannot follow the size of the raise. Vehicle fees may use stepped bands, and those bands never read capital." />
      )}
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
                      <TableCell className="font-medium">{labelFor(FEE_KIND_LABELS, r.fee_kind)}</TableCell>
                      <TableCell>{r.tier ? <Badge variant="secondary">{labelFor({}, r.tier)}</Badge> : <span className="text-muted-foreground">Platform</span>}</TableCell>
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
