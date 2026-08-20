/**
 * WAVE 24 · ITEM 2 — THE THREE ORPHANED ADMIN PARTNER-BILLING ENDPOINTS.
 *
 * FINAL REVIEW B (R-1) pinned three writes/reads in
 * `server/lib/wave14MoneyRoutes.ts` with zero UI callers anywhere in
 * `client/src`. I re-verified all three at source before writing a line of this
 * file, because sixteen times in this build a citation was misleading while the
 * real defect sat elsewhere:
 *
 *   · `POST /api/admin/partner-billing/invoices`         (:662) — CP-COM-02
 *   · `POST /api/admin/partner-billing/commission-split` (:722) — CP-COM-04
 *   · `GET  /api/admin/partner-billing/money-events`     (:820) — CP-SUB-15
 *
 * All three confirmed orphaned:
 *   grep -rn "partner-billing/invoices\|commission-split" client/src \
 *     --include=*.tsx --include=*.ts | grep -v __tests__   → 0 hits
 *   grep -rn "money-events" client/src ... → only PartnerBilling.tsx:1376,
 *     which is the PARTNER-side `/api/partner/me/money-events`, a different
 *     route with a different guard. The ADMIN variant, which can read ANY
 *     subject, had no caller.
 *
 * WHY IT IS ONE PANEL AND NOT THREE PAGES. These are the three halves of one
 * job — mint the invoice, check the split that feeds a commission line, then
 * read back the events the write emitted. Re-fragmenting the admin surface is
 * what lost RS-1 and RS-2 in July, so this mounts as ONE NEW TAB on the
 * existing `/admin/partner-billing-ops` page beside Tier Prices, Promotions,
 * Reconcile, SPV Fees and Decisions.
 *
 * THE SINKS (Rule 2), named per endpoint:
 *   · invoice mint → `partner_invoice` + `partner_invoice_line` via
 *     `createInvoice()` / `addInvoiceLine()`. The invoice TOTAL is maintained by
 *     DB triggers (`trg_pinvl_after_insert/update/delete`, migration 0153) from
 *     the lines — this panel therefore NEVER sends a total, and never computes
 *     one. `assertInvoiceConserved()` runs server-side before the response and
 *     the panel renders the returned `lineSumMinor` beside the stored total so
 *     conservation is SHOWN, not trusted. A SECOND path to this sink exists —
 *     `addInvoiceLine()` is also reachable from the SPV fee chain — which is
 *     precisely why the total is trigger-derived and not written here.
 *   · commission split → NO SINK. It is a pure calculator; it writes nothing.
 *     Said plainly on screen, so nobody reads the result as a booked allocation.
 *   · money events → read-only over `partner_money_event`.
 *
 * MONEY (Rule 4). Integer minor units end to end. Amounts are entered in major
 * units and converted ONCE at the edge by `majorToMinorExact()`, which REFUSES
 * anything that would need rounding and is EXPONENT-AWARE: a JPY amount (ISO
 * 4217 exponent 0) must not be multiplied by 100. Display is always
 * `formatMinor()` from `client/src/lib/currency.ts`, never `/100`. Line amounts
 * are summed ONLY within a single invoice, which by construction has ONE
 * currency; nothing on this panel sums across currencies, and the money-events
 * list deliberately shows no total at all because its rows can span subjects
 * and currencies.
 *
 * FAIL-CLOSED (Rule 5). `LoadFailedRefusal` on read failure. No fabricated
 * zero, and no empty state that is really a 500.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AppCard } from "@/components/ui/app-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatMinor, currencyExponent } from "@/lib/currency";
import { majorToMinorExact } from "@/lib/moneyInput";
import { LoadFailedRefusal } from "@/components/LoadFailedRefusal";

/* `EntryKind` — server/lib/partnerBillingStore.ts:847, and `BILLING_ENTRY_KINDS`
   at :877. Copied EXACTLY; the route rejects anything outside this set with
   BAD_ENTRY_KIND, so a drifted client list would produce a 400 the user cannot
   explain. */
const ENTRY_KINDS = ["subscription", "commission", "spv_fee", "adjustment", "refund"] as const;
type EntryKind = (typeof ENTRY_KINDS)[number];

const SETTLEMENT_STATES = ["pending", "paid", "waived", "failed"] as const;
type SettlementState = (typeof SETTLEMENT_STATES)[number];

/* Currencies offered on this panel. JPY is here deliberately and permanently:
   an exponent-0 currency is the only thing that catches a hardcoded `/100`,
   and both this panel and its harness use it. */
const CURRENCIES = ["USD", "EUR", "GBP", "JPY"] as const;

type InvoiceLineDto = {
  id: string;
  invoiceId: string;
  entryKind: EntryKind;
  description: string;
  amountMinor: number;
  settlementState: SettlementState;
  sourceRef: string | null;
  settledAt: string | null;
};

/* `Invoice` — server/lib/partnerBillingStore.ts. `totalMinor` is TRIGGER-
   MAINTAINED from the lines; it is displayed, never sent. */
type InvoiceDto = {
  id: string;
  partnerId: string;
  invoiceNumber: string;
  status: "draft" | "issued" | "paid" | "void" | "uncollectible";
  currency: string;
  totalMinor: number;
  periodStart: string | null;
  periodEnd: string | null;
  issuedAt: string | null;
  paidAt: string | null;
  lines: InvoiceLineDto[];
};

type MintResponse = { ok: boolean; invoice: InvoiceDto | null; lineSumMinor: number; error?: string; message?: string };
type SplitResponse = { ok: boolean; totalMinor: number; weightsMinor: number[]; shares: number[]; sum: number; conserved: boolean; error?: string; message?: string };
type MoneyEventsResponse = {
  ok: boolean;
  events: Array<{ id?: string; eventName: string; subjectKind?: string; subjectId?: string; payload: unknown; emittedAt: string }>;
  total: number;
  scope: Record<string, string>;
  error?: string;
  message?: string;
};
type PartnersResponse = { ok: boolean; partners: Array<{ id: string; name: string }>; total: number };

/**
 * Major-unit string → integer minor units, EXPONENT-AWARE and EXACT.
 *
 * Returns `undefined` for anything that is not a clean amount at the currency's
 * own precision. An amount that had to be rounded to be accepted is an amount
 * nobody authorised — and for JPY (exponent 0) "1000.50" is not a JPY amount at
 * all, so it is refused rather than silently floored.
 */
/* WAVE 24 — the private copy that lived here has been REPLACED by the shared
   `majorToMinorExact` in `client/src/lib/moneyInput.ts`, so the invoice, the
   commission basis and the company mark cannot drift apart on the JPY branch.
   `allowNegative` is passed because an adjustment or refund LINE is legitimately
   negative; a fair-value mark is not, and does not pass it. */
function parseAmount(raw: string, currency: string): number | undefined {
  return majorToMinorExact(raw, currency, { allowNegative: true });
}

type DraftLine = { entryKind: EntryKind; description: string; amountMajor: string; settlementState: SettlementState; sourceRef: string };

const EMPTY_LINE: DraftLine = { entryKind: "subscription", description: "", amountMajor: "", settlementState: "pending", sourceRef: "" };

/* ── invoice minting ──────────────────────────────────────────────────────── */
function InvoiceMintCard({ partners }: { partners: Array<{ id: string; name: string }> }) {
  const { toast } = useToast();
  const [partnerId, setPartnerId] = useState("");
  const [currency, setCurrency] = useState<string>("USD");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ ...EMPTY_LINE }]);
  const [minted, setMinted] = useState<MintResponse | null>(null);

  const parsed = lines.map((l) => parseAmount(l.amountMajor, currency));
  const badAmountIdx = parsed.findIndex((p) => p === undefined);
  const missingDescIdx = lines.findIndex((l) => l.description.trim() === "");
  /* Within ONE invoice, which has exactly ONE currency, so this sum is legal.
     It is a PREVIEW of what the DB trigger will compute; it is never sent. */
  const previewTotalMinor: number | null =
    badAmountIdx === -1 ? parsed.reduce<number>((s, n) => s + (n ?? 0), 0) : null;

  const canMint = partnerId !== "" && lines.length > 0 && badAmountIdx === -1 && missingDescIdx === -1;

  const mut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/partner-billing/invoices", {
        partnerId,
        currency,
        invoiceNumber: invoiceNumber.trim() === "" ? undefined : invoiceNumber.trim(),
        periodStart: periodStart.trim() === "" ? undefined : periodStart.trim(),
        periodEnd: periodEnd.trim() === "" ? undefined : periodEnd.trim(),
        lines: lines.map((l, i) => ({
          entryKind: l.entryKind,
          description: l.description.trim(),
          amountMinor: parsed[i],
          settlementState: l.settlementState,
          sourceRef: l.sourceRef.trim() === "" ? undefined : l.sourceRef.trim(),
        })),
      });
      return (await res.json()) as MintResponse;
    },
    onSuccess: (d) => {
      if (!d?.ok) {
        toast({ title: "Invoice refused", description: d?.message ?? d?.error ?? "The server refused this invoice.", variant: "destructive" });
        return;
      }
      setMinted(d);
      setLines([{ ...EMPTY_LINE }]);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partner-billing/money-events"] });
      toast({ title: "Invoice created" });
    },
    onError: (e: unknown) =>
      toast({ title: "Could not create the invoice", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
  });

  return (
    <AppCard title="Mint an invoice" data-testid="card-admin-invoice-mint">
      <div className="grid gap-3 md:grid-cols-4">
        <div>
          <Label className="text-xs">Partner</Label>
          <Select value={partnerId} onValueChange={setPartnerId}>
            <SelectTrigger data-testid="select-invoice-partner"><SelectValue placeholder="Choose a partner" /></SelectTrigger>
            <SelectContent>
              {partners.map((p) => (
                <SelectItem key={p.id} value={p.id} data-testid={`option-invoice-partner-${p.id}`}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Currency</Label>
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger data-testid="select-invoice-currency"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => (
                <SelectItem key={c} value={c} data-testid={`option-invoice-currency-${c}`}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Invoice number (optional)</Label>
          <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} data-testid="input-invoice-number" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Period start</Label>
            <Input value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} placeholder="YYYY-MM-DD" data-testid="input-invoice-period-start" />
          </div>
          <div>
            <Label className="text-xs">Period end</Label>
            <Input value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} placeholder="YYYY-MM-DD" data-testid="input-invoice-period-end" />
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-2" data-testid="invoice-line-editor">
        {lines.map((l, i) => (
          <div className="grid items-end gap-2 md:grid-cols-6" key={i} data-testid={`invoice-line-${i}`}>
            <div>
              <Label className="text-xs">Kind</Label>
              <Select
                value={l.entryKind}
                onValueChange={(v) => setLines((xs) => xs.map((x, j) => (j === i ? { ...x, entryKind: v as EntryKind } : x)))}
              >
                <SelectTrigger data-testid={`select-line-kind-${i}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ENTRY_KINDS.map((k) => (
                    <SelectItem key={k} value={k} data-testid={`option-line-kind-${i}-${k}`}>{k}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs">Description</Label>
              <Input
                value={l.description}
                onChange={(e) => setLines((xs) => xs.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
                data-testid={`input-line-description-${i}`}
              />
            </div>
            <div>
              <Label className="text-xs">{`Amount (${currency})`}</Label>
              <Input
                value={l.amountMajor}
                onChange={(e) => setLines((xs) => xs.map((x, j) => (j === i ? { ...x, amountMajor: e.target.value } : x)))}
                data-testid={`input-line-amount-${i}`}
              />
            </div>
            <div>
              <Label className="text-xs">Settlement</Label>
              <Select
                value={l.settlementState}
                onValueChange={(v) => setLines((xs) => xs.map((x, j) => (j === i ? { ...x, settlementState: v as SettlementState } : x)))}
              >
                <SelectTrigger data-testid={`select-line-settlement-${i}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SETTLEMENT_STATES.map((s) => (
                    <SelectItem key={s} value={s} data-testid={`option-line-settlement-${i}-${s}`}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                disabled={lines.length === 1}
                onClick={() => setLines((xs) => xs.filter((_, j) => j !== i))}
                data-testid={`button-remove-line-${i}`}
              >
                <Trash2 className="mr-1 h-3 w-3" /> Remove
              </Button>
            </div>
          </div>
        ))}
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setLines((xs) => [...xs, { ...EMPTY_LINE }])} data-testid="button-add-invoice-line">
          <Plus className="mr-1 h-3 w-3" /> Add line
        </Button>
      </div>

      <div className="mt-3 space-y-1 text-xs">
        {badAmountIdx !== -1 && (
          <span className="block text-rose-700" data-testid="text-invoice-amount-invalid">
            {currencyExponent(currency) === 0
              ? `Line ${badAmountIdx + 1}: ${currency} has no minor unit — enter a whole number.`
              : `Line ${badAmountIdx + 1}: enter an amount with at most ${currencyExponent(currency)} decimal places. An amount that had to be rounded is an amount nobody authorised.`}
          </span>
        )}
        {missingDescIdx !== -1 && (
          <span className="block text-rose-700" data-testid="text-invoice-description-missing">
            {`Line ${missingDescIdx + 1}: a description is required.`}
          </span>
        )}
        {previewTotalMinor !== null && (
          <span className="block text-muted-foreground" data-testid="text-invoice-preview-total">
            {`Lines total ${formatMinor(previewTotalMinor, currency)} — a preview only. The stored total is computed from the lines themselves and is never sent from this screen.`}
          </span>
        )}
      </div>

      <Button className="mt-3 h-8 text-xs" disabled={!canMint || mut.isPending} onClick={() => mut.mutate()} data-testid="button-mint-invoice">
        {mut.isPending ? "Creating…" : "Create invoice"}
      </Button>

      {minted?.invoice && (
        <div className="mt-4 rounded-md border bg-muted/40 p-3 text-xs" data-testid="invoice-mint-result">
          <span className="block font-medium" data-testid="text-minted-invoice-number">
            {`${minted.invoice.invoiceNumber} · ${minted.invoice.status}`}
          </span>
          <span className="block" data-testid="text-minted-invoice-total">
            {`Stored total ${formatMinor(minted.invoice.totalMinor, minted.invoice.currency)}`}
          </span>
          {/* CONSERVATION, SHOWN. The server asserted it; we render both figures
              so a reader can see the agreement rather than take it on faith. */}
          <span
            className={`block ${minted.invoice.totalMinor === minted.lineSumMinor ? "text-muted-foreground" : "text-rose-700"}`}
            data-testid="text-minted-invoice-conserved"
          >
            {minted.invoice.totalMinor === minted.lineSumMinor
              ? `Line sum ${formatMinor(minted.lineSumMinor, minted.invoice.currency)} — agrees with the stored total.`
              : `Line sum ${formatMinor(minted.lineSumMinor, minted.invoice.currency)} DISAGREES with the stored total.`}
          </span>
          <ul className="mt-2 space-y-0.5" data-testid="list-minted-invoice-lines">
            {minted.invoice.lines.map((ln) => (
              <li key={ln.id} data-testid={`minted-invoice-line-${ln.id}`}>
                {`${ln.entryKind} · ${ln.description} · ${formatMinor(ln.amountMinor, minted.invoice!.currency)} · ${ln.settlementState}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </AppCard>
  );
}

/* ── commission split calculator ──────────────────────────────────────────── */
function CommissionSplitCard() {
  const { toast } = useToast();
  const [currency, setCurrency] = useState<string>("USD");
  const [totalMajor, setTotalMajor] = useState("");
  const [weightsRaw, setWeightsRaw] = useState("");
  const [result, setResult] = useState<SplitResponse | null>(null);

  const totalMinor = parseAmount(totalMajor, currency);
  const weights = weightsRaw
    .split(/[,\s]+/)
    .map((w) => w.trim())
    .filter((w) => w !== "")
    .map((w) => Number(w));
  const weightsValid = weights.length > 0 && weights.every((w) => Number.isSafeInteger(w) && w >= 0);

  const mut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/partner-billing/commission-split", {
        totalMinor,
        weightsMinor: weights,
      });
      return (await res.json()) as SplitResponse;
    },
    onSuccess: (d) => {
      if (!d?.ok) {
        toast({ title: "Split refused", description: d?.message ?? d?.error ?? "The server refused this split.", variant: "destructive" });
        setResult(null);
        return;
      }
      setResult(d);
    },
    onError: (e: unknown) => {
      setResult(null);
      toast({ title: "Could not compute the split", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    },
  });

  return (
    <AppCard title="Commission split" data-testid="card-admin-commission-split">
      <span className="mb-3 block text-xs text-muted-foreground" data-testid="text-split-writes-nothing">
        This is a calculator. It books nothing, allocates nothing and writes no row — it asks the server&rsquo;s
        largest-remainder allocator what a total would split into, so the answer here and the answer a close
        writes are the same answer.
      </span>
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <Label className="text-xs">Currency</Label>
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger data-testid="select-split-currency"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => (
                <SelectItem key={c} value={c} data-testid={`option-split-currency-${c}`}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">{`Total to split (${currency})`}</Label>
          <Input value={totalMajor} onChange={(e) => setTotalMajor(e.target.value)} data-testid="input-split-total" />
        </div>
        <div>
          <Label className="text-xs">Weights (integers, comma separated)</Label>
          <Input value={weightsRaw} onChange={(e) => setWeightsRaw(e.target.value)} placeholder="1, 1, 2" data-testid="input-split-weights" />
        </div>
      </div>
      <div className="mt-2 space-y-1 text-xs">
        {totalMajor.trim() !== "" && totalMinor === undefined && (
          <span className="block text-rose-700" data-testid="text-split-total-invalid">
            {currencyExponent(currency) === 0
              ? `${currency} has no minor unit — enter a whole number.`
              : `Enter a total with at most ${currencyExponent(currency)} decimal places.`}
          </span>
        )}
        {weightsRaw.trim() !== "" && !weightsValid && (
          <span className="block text-rose-700" data-testid="text-split-weights-invalid">
            Weights must be non-negative whole numbers.
          </span>
        )}
      </div>
      <Button
        className="mt-3 h-8 text-xs"
        disabled={totalMinor === undefined || !weightsValid || mut.isPending}
        onClick={() => mut.mutate()}
        data-testid="button-compute-split"
      >
        {mut.isPending ? "Computing…" : "Compute split"}
      </Button>

      {result && (
        <div className="mt-3 rounded-md border bg-muted/40 p-3 text-xs" data-testid="split-result">
          <ul className="space-y-0.5" data-testid="list-split-shares">
            {result.shares.map((s, i) => (
              <li key={i} data-testid={`split-share-${i}`}>
                {`weight ${result.weightsMinor[i]} → ${formatMinor(s, currency)}`}
              </li>
            ))}
          </ul>
          {/* Same currency throughout a single split, so this sum is legal. It is
              the SERVER's `sum`, echoed — not recomputed here, because a client
              recomputation could agree with itself while disagreeing with the
              allocator that actually books the money. */}
          <span
            className={`mt-2 block ${result.conserved ? "text-muted-foreground" : "text-rose-700"}`}
            data-testid="text-split-conserved"
          >
            {result.conserved
              ? `Shares sum to ${formatMinor(result.sum, currency)} — exactly the total. No cent was created or lost.`
              : `Shares sum to ${formatMinor(result.sum, currency)}, which is NOT the total. Do not use this allocation.`}
          </span>
        </div>
      )}
    </AppCard>
  );
}

/* ── admin money-event ledger ─────────────────────────────────────────────── */
function AdminMoneyEventsCard({ partners }: { partners: Array<{ id: string; name: string }> }) {
  const [partnerId, setPartnerId] = useState("");

  /* The route REFUSES an unscoped dump (SCOPE_REQUIRED, wave14MoneyRoutes.ts:833)
     — so the query is disabled until a partner is chosen, rather than firing a
     request we know will 400. */
  const q = useQuery<MoneyEventsResponse>({
    queryKey: ["/api/admin/partner-billing/money-events", partnerId],
    queryFn: async () =>
      (await apiRequest("GET", `/api/admin/partner-billing/money-events?partnerId=${encodeURIComponent(partnerId)}`)).json(),
    enabled: partnerId !== "",
  });

  const events = q.data?.events ?? [];

  return (
    <AppCard title="Money events (any partner)" data-testid="card-admin-money-events">
      <div className="max-w-sm">
        <Label className="text-xs">Partner</Label>
        <Select value={partnerId} onValueChange={setPartnerId}>
          <SelectTrigger data-testid="select-money-events-partner"><SelectValue placeholder="Choose a partner" /></SelectTrigger>
          <SelectContent>
            {partners.map((p) => (
              <SelectItem key={p.id} value={p.id} data-testid={`option-money-events-partner-${p.id}`}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-3">
        {partnerId === "" ? (
          <span className="block text-xs text-muted-foreground" data-testid="text-money-events-unscoped">
            Choose a partner. An unscoped money-event dump is not offered by the API, so none is shown here.
          </span>
        ) : q.isError ? (
          <LoadFailedRefusal
            what="this partner's money events"
            onRetry={() => q.refetch()}
            isRetrying={q.isFetching}
            testId="admin-money-events-load-failed"
          />
        ) : !q.isSuccess ? (
          <span className="block text-xs text-muted-foreground" data-testid="text-money-events-loading">Loading money events…</span>
        ) : events.length === 0 ? (
          <span className="block text-xs text-muted-foreground" data-testid="text-money-events-empty">
            No money events are recorded for this partner.
          </span>
        ) : (
          <div className="overflow-x-auto">
            {/* NO TOTAL. These rows can span subjects and currencies, and summing
                across currencies is the exact defect four separate sites had. */}
            <table className="w-full text-xs" data-testid="table-admin-money-events">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-2 py-1 font-medium">When</th>
                  <th className="px-2 py-1 font-medium">Event</th>
                  <th className="px-2 py-1 font-medium">Subject</th>
                  <th className="px-2 py-1 font-medium">Payload</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr className="border-b last:border-0" key={e.id ?? `${e.eventName}-${i}`} data-testid={`admin-money-event-row-${e.id ?? i}`}>
                    <td className="whitespace-nowrap px-2 py-1">{e.emittedAt}</td>
                    <td className="px-2 py-1 font-mono">{e.eventName}</td>
                    <td className="px-2 py-1 font-mono">{`${e.subjectKind ?? "—"} ${e.subjectId ?? ""}`}</td>
                    <td className="px-2 py-1 font-mono text-muted-foreground">
                      {typeof e.payload === "object" && e.payload !== null
                        ? Object.entries(e.payload as Record<string, unknown>).map(([k, v]) => `${k}=${String(v)}`).join(" ")
                        : String(e.payload ?? "")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppCard>
  );
}

/* ── the tab ──────────────────────────────────────────────────────────────── */
export function AdminInvoicingOpsPanel() {
  /* The SAME roster read `client/src/pages/admin/Partners.tsx:88` already uses.
     Deliberately not a second partner-listing endpoint — a second path to the
     same read is precisely what this project keeps paying for. */
  const partnersQ = useQuery<PartnersResponse>({
    queryKey: ["/api/admin/partners", "invoicing-ops"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/partners")).json(),
    retry: false,
  });
  const partners = partnersQ.data?.partners ?? [];

  if (partnersQ.isError) {
    return (
      <LoadFailedRefusal
        what="the partner roster"
        onRetry={() => partnersQ.refetch()}
        isRetrying={partnersQ.isFetching}
        testId="invoicing-ops-partners-load-failed"
      />
    );
  }

  return (
    <div className="space-y-4" data-testid="admin-invoicing-ops-panel">
      <InvoiceMintCard partners={partners} />
      <CommissionSplitCard />
      <AdminMoneyEventsCard partners={partners} />
    </div>
  );
}

export default AdminInvoicingOpsPanel;
