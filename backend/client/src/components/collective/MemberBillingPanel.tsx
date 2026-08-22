/**
 * WAVE 17 — ORP-039 (DEF-039): collective member self-service billing.
 *
 * WHAT WAS WRONG. Three endpoints have shipped with ZERO client callers —
 * verified by grep over `client/src` before this file was written (no match for
 * `collective/me/payment-quote`, `collective/me/payment-entries` or
 * `collective/me/invoices` anywhere):
 *
 *   GET /api/collective/me/payment-quote    server/lib/collectiveMemberSelfServiceRoutes.ts:125
 *   GET /api/collective/me/payment-entries  :177
 *   GET /api/collective/me/invoices         :204
 *
 * All three are registered (`server/routes.ts:980` →
 * `registerCollectiveMemberSelfServiceRoutes`), all three are member-scoped by
 * session (`requireCollectiveMember` + `memberIdOf(req)`, never a client-supplied
 * id), and a member could see none of what they owed, had been invoiced for, or
 * had paid. So this item is **WIRING** — no route, store method or migration was
 * added for it.
 *
 * MONEY. Every amount from these endpoints is an INTEGER MINOR-UNIT value
 * (`amount_minor`, `total_minor`, `ResolvedCollectiveFee.amountMinor`). They are
 * rendered through `formatMinor` from `client/src/lib/currency.ts:102`, which uses
 * the currency's ISO-4217 exponent rather than a hardcoded `/100` — so a JPY line
 * is not silently divided by a hundred. Totals are summed **per currency** and
 * never across currencies; the server already groups `byCurrency` for exactly that
 * reason and this panel renders that grouping rather than re-deriving it.
 *
 * FAIL-CLOSED STATES ARE SHOWN, NOT HIDDEN. The quote endpoint answers 409
 * `tier_unavailable` when a member's tier cannot be determined (`:135`), and an
 * individual quote line can carry `resolved: null` with an `error` code such as
 * `no_schedule_configured` (`collectivePaymentResolver.ts:235`). Both are rendered
 * as explicit copy. Inventing a zero or a fallback price here would be exactly the
 * silent-degradation shape this project keeps paying for.
 *
 * NOT CLAIMED: nothing here charges anything. The quote endpoint is quote-only by
 * construction (`quoteOnly: true`, `note` at `:167`) and the copy says so.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import { formatMinor } from "@/lib/currency";
import { fmtDate } from "@/lib/format";

/** Mirrors `CollectiveQuoteLine` (server/lib/collectivePaymentResolver.ts:251). */
interface QuoteLine {
  feeKind: string;
  resolved: {
    amountMinor: number;
    currency: string;
    cadence: string;
    scheduleId: string;
    computedVia: string;
    chapterScope?: string;
  } | null;
  error: string | null;
}

interface QuoteResponse {
  ok: boolean;
  quoteOnly?: boolean;
  tier?: string;
  lines?: QuoteLine[];
  byCurrency?: Record<string, number>;
  error?: string;
  message?: string;
}

/** Mirrors the SELECT at server/lib/collectiveMemberSelfServiceRoutes.ts:181. */
interface PaymentEntry {
  id: string;
  entryKind: string;
  amountMinor: number;
  currency: string;
  status: string;
  invoiceId: string | null;
  description: string | null;
  period: string | null;
  createdAt: string;
  paidAt: string | null;
}

interface EntriesResponse {
  ok: boolean;
  entries?: PaymentEntry[];
  byCurrency?: Record<string, { pending: number; paid: number; invoiced: number }>;
  total?: number;
}

/** Mirrors the SELECT at server/lib/collectiveMemberSelfServiceRoutes.ts:208. */
interface InvoiceRow {
  id: string;
  number: string | null;
  status: string;
  totalMinor: number;
  currency: string;
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
  createdAt: string;
}

interface InvoicesResponse {
  ok: boolean;
  invoices?: InvoiceRow[];
  total?: number;
}

/** Fee-kind enum → human label. Keys mirror `quoteAllCollectiveFees` (:262-268). */
const FEE_KIND_LABEL: Record<string, string> = {
  membership_dues: "Membership dues",
  event_fee: "Event fee",
  sponsorship_fee: "Sponsorship fee",
  chapter_dues: "Chapter dues",
  late_fee: "Late fee",
};

/** Resolver failure codes → human copy. `no_schedule_configured` is the
 *  fail-closed path at collectivePaymentResolver.ts:235. */
const QUOTE_ERROR_COPY: Record<string, string> = {
  no_schedule_configured: "No fee schedule is configured for this charge yet.",
  resolve_failed: "This charge could not be priced right now.",
  tier_unavailable: "Your membership tier could not be determined right now. Please retry shortly.",
};

function statusVariant(status: string): "positive" | "secondary" | "destructive" | "outline" {
  /* WAVE 101 - `paid` returned "default", which is the brand red: a settled
     charge was painted the same colour as `overdue`/`void` below.  Colour
     only; the returned STATE and every label are unchanged. */
  if (status === "paid") return "positive";
  if (status === "invoiced") return "secondary";
  if (status === "overdue" || status === "void") return "destructive";
  return "outline";
}

export function MemberBillingPanel() {
  const quoteQ = useQuery<QuoteResponse>({
    queryKey: ["/api/collective/me/payment-quote"],
    queryFn: async () => (await apiRequest("GET", "/api/collective/me/payment-quote")).json(),
    /* A 409 tier_unavailable is a real answer to render, not a crash. */
    retry: false,
  });
  const entriesQ = useQuery<EntriesResponse>({
    queryKey: ["/api/collective/me/payment-entries"],
    queryFn: async () => (await apiRequest("GET", "/api/collective/me/payment-entries")).json(),
    retry: false,
  });
  const invoicesQ = useQuery<InvoicesResponse>({
    queryKey: ["/api/collective/me/invoices"],
    queryFn: async () => (await apiRequest("GET", "/api/collective/me/invoices")).json(),
    retry: false,
  });

  const quote = quoteQ.data;
  const entries = entriesQ.data?.entries ?? [];
  const entryTotals = entriesQ.data?.byCurrency ?? {};
  const invoices = invoicesQ.data?.invoices ?? [];

  return (
    <Card className="mb-8" data-testid="member-billing-panel">
      <CardHeader>
        <CardTitle className="text-lg">Your fees, invoices and payments</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* ── Quote ─────────────────────────────────────────────── */}
        <div data-testid="member-billing-quote">
          <div className="text-sm font-semibold">Current fee schedule</div>
          <div className="text-xs text-[var(--cv-color-text-muted)]">
            Quote only. Nothing is charged by viewing this.
          </div>
          {quoteQ.isLoading && <Skeleton className="h-16 w-full mt-2" />}
          {quoteQ.isError && (
            <div className="mt-2 text-sm text-amber-900" data-testid="member-billing-quote-error">
              {QUOTE_ERROR_COPY.tier_unavailable}
            </div>
          )}
          {quote?.ok === false && (
            <div className="mt-2 text-sm text-amber-900" data-testid="member-billing-quote-refused">
              {QUOTE_ERROR_COPY[String(quote.error)] ?? quote.message ?? "This quote is unavailable right now."}
            </div>
          )}
          {quote?.ok && (
            <>
              {quote.tier && (
                <div className="mt-2 text-xs" data-testid="member-billing-tier">
                  Tier: <span className="font-medium">{quote.tier}</span>
                </div>
              )}
              <ul className="mt-2 space-y-1">
                {(quote.lines ?? []).map((l) => (
                  <li
                    key={l.feeKind}
                    className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
                    data-testid={`member-billing-quote-line-${l.feeKind}`}
                  >
                    <span>{FEE_KIND_LABEL[l.feeKind] ?? l.feeKind}</span>
                    {l.resolved ? (
                      <span className="font-medium">
                        {formatMinor(l.resolved.amountMinor, l.resolved.currency)}
                        <span className="ml-2 text-xs text-[var(--cv-color-text-muted)]">
                          {l.resolved.cadence}
                        </span>
                      </span>
                    ) : (
                      <span className="text-xs text-amber-900">
                        {QUOTE_ERROR_COPY[String(l.error)] ?? "Not priced."}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {Object.keys(quote.byCurrency ?? {}).length > 0 && (
                <div className="mt-2 text-xs" data-testid="member-billing-quote-totals">
                  {Object.entries(quote.byCurrency ?? {}).map(([cur, minor]) => (
                    <span key={cur} className="mr-3">
                      Total {cur}: <span className="font-medium">{formatMinor(minor, cur)}</span>
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Ledger entries ────────────────────────────────────── */}
        <div data-testid="member-billing-entries">
          <div className="text-sm font-semibold">Charges on your account</div>
          {entriesQ.isLoading && <Skeleton className="h-16 w-full mt-2" />}
          {!entriesQ.isLoading && entries.length === 0 && (
            <div className="mt-1 text-xs text-[var(--cv-color-text-muted)]" data-testid="member-billing-entries-empty">
              You have no charges on record.
            </div>
          )}
          {entries.length > 0 && (
            <ul className="mt-2 space-y-1">
              {entries.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
                  data-testid={`member-billing-entry-${e.id}`}
                >
                  <span>
                    {e.description || FEE_KIND_LABEL[e.entryKind] || e.entryKind}
                    <span className="ml-2 text-xs text-[var(--cv-color-text-muted)]">
                      {e.period ? `${e.period} · ` : ""}
                      {fmtDate(e.createdAt)}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge variant={statusVariant(e.status)}>{e.status}</Badge>
                    <span className="font-medium">{formatMinor(e.amountMinor, e.currency)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {Object.keys(entryTotals).length > 0 && (
            <div className="mt-2 text-xs" data-testid="member-billing-entry-totals">
              {Object.entries(entryTotals).map(([cur, t]) => (
                <div key={cur}>
                  {cur}: pending <span className="font-medium">{formatMinor(t.pending, cur)}</span>
                  {" · invoiced "}<span className="font-medium">{formatMinor(t.invoiced, cur)}</span>
                  {" · paid "}<span className="font-medium">{formatMinor(t.paid, cur)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Invoices ──────────────────────────────────────────── */}
        <div data-testid="member-billing-invoices">
          <div className="text-sm font-semibold">Your invoices</div>
          {invoicesQ.isLoading && <Skeleton className="h-16 w-full mt-2" />}
          {!invoicesQ.isLoading && invoices.length === 0 && (
            <div className="mt-1 text-xs text-[var(--cv-color-text-muted)]" data-testid="member-billing-invoices-empty">
              No invoices have been issued to you.
            </div>
          )}
          {invoices.length > 0 && (
            <ul className="mt-2 space-y-1">
              {invoices.map((inv) => (
                <li
                  key={inv.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
                  data-testid={`member-billing-invoice-${inv.id}`}
                >
                  <span>
                    {inv.number ? `Invoice ${inv.number}` : "Invoice"}
                    <span className="ml-2 text-xs text-[var(--cv-color-text-muted)]">
                      {inv.issuedAt ? `issued ${fmtDate(inv.issuedAt)}` : `created ${fmtDate(inv.createdAt)}`}
                      {inv.dueAt ? ` · due ${fmtDate(inv.dueAt)}` : ""}
                      {inv.paidAt ? ` · paid ${fmtDate(inv.paidAt)}` : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge variant={statusVariant(inv.status)}>{inv.status}</Badge>
                    <span className="font-medium">{formatMinor(inv.totalMinor, inv.currency)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
