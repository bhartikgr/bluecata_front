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
import { OverdueCue, VoidCue } from "@/components/RedStateCue";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, ApiError } from "@/lib/queryClient";
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
  /* WAVE 183 · ITEM B FIX 2 — the two facts that were being reported as
     `tier_unavailable`. Added as NEW KEYS beside it; the `tier_unavailable`
     string above is untouched, byte-verbatim, and still renders for the genuine
     409 it was written for (R143.1 / ITEM C). */
  not_collective_member:
    "The missing fact is a Collective membership: Capavate holds no membership record for this account, so there is no tier to price against. Retrying will not change this \u2014 joining the Collective will.",
  missing_identity:
    "The missing fact is a signed-in session: this request was not authenticated, so no tier could be resolved for your account. Sign in again.",
  quote_unreachable:
    "Your membership tier could not be determined because Capavate could not be reached for this request.",
};

/**
 * WAVE 183 · ITEM B FIX 2 — WHICH FACT IS MISSING, RATHER THAN "PLEASE RETRY".
 *
 * `GET /api/collective/me/payment-quote` fails in three materially different
 * ways and the panel reported all of them with the single 409 sentence:
 *
 *   · 403 `not_collective_member` — this account has no membership record.
 *     PERMANENT for this account. Retrying is futile, and telling a
 *     non-member to "retry shortly" is the defect R154.2 reported: the page
 *     appears broken when in fact it is correctly refusing.
 *   · 409 `tier_unavailable`      — a member whose tier genuinely could not be
 *     resolved this instant. Actually transient. Keeps its original sentence.
 *   · 401 / transport             — no session, or no server.
 *
 * The owner's distinction, applied literally: name the missing fact when one is
 * missing, and keep the retry wording only where a retry can change the answer.
 */
function quoteErrorCopy(error: unknown): string {
  if (!(error instanceof ApiError)) return QUOTE_ERROR_COPY.quote_unreachable;
  const payload = error.payload as { error?: string } | null | undefined;
  const code =
    (payload && typeof payload === "object" ? payload.error : null) ?? error.code ?? null;
  if (code && QUOTE_ERROR_COPY[String(code)]) return QUOTE_ERROR_COPY[String(code)];
  if (error.status === 401) return QUOTE_ERROR_COPY.missing_identity;
  if (error.status === 403) return QUOTE_ERROR_COPY.not_collective_member;
  /* 409 and anything else genuinely transient keeps the original wording. */
  return QUOTE_ERROR_COPY.tier_unavailable;
}

/* WAVE 342 · ITEM 3 · W291 — THE NON-COLOUR CUE FOR THE RED BADGES.
   `overdue` and `void` are BOTH painted with the destructive variant by
   `statusVariant` below, and they mean opposite things: one is money still owed
   and late, the other is a charge that was cancelled and is NOT owed. A reader
   who does not perceive the colour got nothing from it, and a reader who does
   perceive it got the SAME red for both. Each now carries its own glyph and its
   own screen-reader word, in front of the status word the badge already shows.
   NO VARIANT AND NO CLASS IS CHANGED — the colour question is not settled here,
   because `statusVariant` is shared and re-colouring it is a restyle. What is
   settled is that the two states are now distinguishable without colour. */
function redBadgeCue(status: string) {
  if (status === "overdue") return <OverdueCue testId={`badge-cue-overdue`} />;
  if (status === "void") return <VoidCue testId={`badge-cue-void`} />;
  return null;
}

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
              {quoteErrorCopy(quoteQ.error)}
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
                    <Badge variant={statusVariant(e.status)}>{redBadgeCue(e.status)}{e.status}</Badge>
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
                    <Badge variant={statusVariant(inv.status)}>{redBadgeCue(inv.status)}{inv.status}</Badge>
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
