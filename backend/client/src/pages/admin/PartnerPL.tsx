/* v25.33 Consortium Partner Payment Model — DB-driven, no in-memory.
 * /admin/partner-pl — partner profit & loss view. Aggregates partner_billing_entries
 * DB-direct via GET /api/admin/partner-pl (referral commissions + SPV deployment
 * fees + any other entry kinds). Totals by status and per-entry rows are computed
 * server-side from the database; the page renders them verbatim. "Mark paid"
 * reconciles a single entry via POST /api/admin/partner-pl/:entryId/mark-paid.
 */
import { useState } from "react";
import { formatMinor } from "@/lib/currency"; /* v25.38 currency sweep */
import { formatMinorOrUnavailable } from "@/lib/moneyDisplay"; /* WAVE 55 · R6 */
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
/* WAVE 3A (P-3) — shared fraction→percent display helper. */
import { formatFractionAsPercent } from "@/lib/percentDisplay";
import { fmtLocaleDate } from "@/lib/format"; /* WAVE 87 · ITEM 1 */

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
  /* WAVE 180 · ITEM A SITE 1 — each total is null when the entries in scope span
   * more than one currency. The producer no longer adds minor units across ISO
   * codes and no longer lets this page label the result USD by default. */
  totals: { pending: number | null; paid: number | null; all: number | null };
  totalsCurrency?: string | null;
  /* WAVE 180 · ITEM A SITE 1 — the label that belongs to EACH card's own figure.
   * `totalsCurrency` describes the "all" bucket only. The three buckets are
   * resolved independently by the producer, so on a mixed ledger "Paid" can be
   * entirely CAD while "Total billable" spans three currencies. Reading
   * `totalsCurrency || "USD"` for the Paid card is what would print CA$1,200.00
   * as $1,200.00. */
  totalsCurrencyByBucket?: { pending: string | null; paid: string | null; all: string | null };
  totalsAvailable?: boolean;
  totalsUnavailableReason?: "needs_fx_conversion" | "no_data" | null;
  totalsCurrencies?: string[];
  totalsByCurrency?: {
    all: Array<{ currency: string; minor: number }>;
    paid: Array<{ currency: string; minor: number }>;
    pending: Array<{ currency: string; minor: number }>;
  };
  entriesWithoutRecordedCurrency?: number;
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
  /* WAVE 55 · R6 — `minor ?? 0` printed "$0.00" for an amount nobody has
   * recorded. This is a dense P&L table, so the owner's ruling 55-Q1 gives
   * the compact dash. A GENUINE 0 still formats as "$0.00": the helper
   * refuses only for null/undefined/"" (isUnknownNumber), never for 0. */
  return formatMinorOrUnavailable(minor, currency, { locale: "en-US" });
}
/* WAVE 87 · ITEM 1 — THIS LOCAL HELPER SHADOWED THE SAFE ONE.
   Twelve files define their own `fmtDate`/`formatIsoDate` whose body is the
   exact defect reviewer 1 reported: `new Date("2026-06-15")` parses as UTC
   midnight, so any local-time reader prints ONE DAY EARLY west of UTC (the
   owner is in New York). Only the BODY changes — every call site is untouched,
   so a timestamp renders byte-identically and nothing is restyled, while a
   date-only value now renders the day that was entered. */
/* WAVE 180 · ITEM A SITE 1 — THE SCOPE SENTENCE FOR THE THREE TOTALS CARDS.
   Exported and pure so the rule is EXECUTED by a test rather than inferred from
   JSX. The owner's rule: wherever a total is shown, state what is included, what
   is excluded and in which currency; an unexplained total IS the defect. Where
   no single figure can be derived, name why — never a fabricated zero, never a
   bare blank. NO EXCHANGE RATE IS APPLIED; this platform holds none. */
export function plTotalsScope(
  entryCount: number,
  totalsCurrency: string | null | undefined,
  currencies: string[] | undefined,
  defaultedCount: number | undefined,
): string {
  const defaulted = defaultedCount ?? 0;
  const defaultedNote = defaulted > 0
    ? ` ${defaulted} of them ${defaulted === 1 ? "is" : "are"} not linked to an SPV, so no currency is recorded against ${defaulted === 1 ? "it" : "them"} and ${defaulted === 1 ? "it is" : "they are"} reported in USD, this platform's default.`
    : "";
  if (entryCount === 0) return "No billing entries in this filter, so there is nothing to total.";
  if (totalsCurrency) {
    return `All three totals cover every one of the ${entryCount} entries below and are stated in ${totalsCurrency}.${defaultedNote}`;
  }
  const list = (currencies ?? []).filter(Boolean);
  const named = list.length > 0 ? ` (${list.join(", ")})` : "";
  return `No combined total is shown. These ${entryCount} entries are recorded in more than one currency${named}, and this platform holds no exchange rate, as-of date or audit trail to convert them with. The per-currency figures below are the whole truth.${defaultedNote}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try { return fmtLocaleDate(iso); } catch { return "—"; }
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
  /* WAVE 180 · ITEM A SITE 1 — the absent-data default is null, not 0. A zero
     here was a fabricated figure standing in for "the request has not landed". */
  const totals = data?.totals ?? { pending: null, paid: null, all: null };
  const byCurrency = data?.totalsByCurrency;
  const totalsMixed = data?.totalsAvailable === false && data?.totalsUnavailableReason === "needs_fx_conversion";
  /* WAVE 180 · ITEM A SITE 1 — one card, one figure, one label, decided together.
     A card prints a number ONLY when its OWN bucket resolved to a single currency,
     and it prints that number in THAT currency. When its own bucket is mixed it
     says so instead. There is no `|| "USD"` fallback anywhere in this decision:
     an unlabelled figure would be the very defect this site was opened for. */
  const bucketCcy = data?.totalsCurrencyByBucket;
  const cardMoney = (minor: number | null, currency: string | null | undefined): string =>
    minor === null || !currency ? "Not one figure" : fmtMoney(minor, currency);
  const scopeText = plTotalsScope(
    data?.total ?? 0,
    data?.totalsCurrency ?? null,
    data?.totalsCurrencies,
    data?.entriesWithoutRecordedCurrency,
  );

  return (
    <>
      <PageHeader
        title="Partner P&L"
        /* WAVE 117 · FINDING 4 — was "Every amount is the database commission_minor
           for that entry": a storage column named to a human. The CLAIM that
           sentence makes is the one worth keeping — nothing on this page is
           recomputed, each figure is the recorded amount — so it is stated without
           the column name. */
        description="Profit & loss across all consortium-partner billing entries — referral commissions and SPV deployment fees alike. Every amount shown is the commission recorded for that entry, never a recalculated one. Use “Mark paid” to reconcile a pending entry."
      />
      <PageBody>
        {/* Totals cards (DB-computed) */}
        {/* WAVE 180 · ITEM A SITE 1 — the three cards keep their identities, their
            titles and their positions; only the currency handed to the formatter
            changed, from an implicit USD default to the currency the producer
            actually derived. The scope sentence and the per-currency panel are NEW
            SIBLINGS: no existing text node or attribute on this page was reworded,
            replaced or removed. */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <Card data-testid="card-total-all">
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Total billable</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-semibold text-[#041e41]">{cardMoney(totals.all, bucketCcy ? bucketCcy.all : data?.totalsCurrency)}</p></CardContent>
          </Card>
          <Card data-testid="card-total-pending">
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Pending</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-semibold text-amber-600">{cardMoney(totals.pending, bucketCcy ? bucketCcy.pending : data?.totalsCurrency)}</p></CardContent>
          </Card>
          <Card data-testid="card-total-paid">
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Paid</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-semibold text-emerald-600">{cardMoney(totals.paid, bucketCcy ? bucketCcy.paid : data?.totalsCurrency)}</p></CardContent>
          </Card>
        </div>
        {!isLoading && !error && (
          <p className="text-xs text-muted-foreground mb-4" data-testid="text-pl-totals-scope">{scopeText}</p>
        )}
        {totalsMixed && byCurrency && (
          <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3" data-testid="panel-pl-totals-by-currency">
            <p className="text-xs font-medium text-amber-900">Billable, pending and paid — per currency</p>
            <ul className="mt-1 space-y-0.5">
              {byCurrency.all.map((r) => {
                const pend = byCurrency.pending.find((x) => x.currency === r.currency);
                const paid = byCurrency.paid.find((x) => x.currency === r.currency);
                return (
                  <li key={r.currency} className="text-xs font-mono text-amber-900" data-testid={`text-pl-ccy-${r.currency}`}>
                    {r.currency}: {fmtMoney(r.minor, r.currency)} billable · {fmtMoney(pend?.minor ?? 0, r.currency)} pending · {fmtMoney(paid?.minor ?? 0, r.currency)} paid
                  </li>
                );
              })}
            </ul>
            <p className="mt-1 text-[11px] text-amber-800">These are not added together. Converting them would need an exchange rate, an as-of date and an audit trail, none of which this platform holds.</p>
          </div>
        )}

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
                        {/* WAVE 3A (P-3) — `partner_billing_entries.commission_pct`
                            is a REAL holding a FRACTION. Every writer proves it:
                            partnerConsortiumRoutes.ts:285-295 inserts the same
                            `pct` it multiplies by (`amount_minor * pct`),
                            resolved from COMMISSION_RATE (0.02–0.06) at :57-60;
                            spvDeploymentFee.ts:115 and partnerRevShare.ts:179
                            insert literal 0 for flat fees. Rendering the bare
                            value showed a 2% commission as "0.02%". Display-only
                            fix — the column is untouched. 0 keeps falling through
                            to "—" (flat-fee rows have no percentage). */}
                        {e.commissionPct ? formatFractionAsPercent(e.commissionPct, { digits: 2 }) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right font-medium">{fmtMoney(e.commissionMinor)}</TableCell>
                      <TableCell>
                        <Badge variant={e.status === "paid" ? "positive" : "secondary"}>{e.status}</Badge>
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
