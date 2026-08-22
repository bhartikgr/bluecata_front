/**
 * WAVE 24 · ITEM 2 — EN-2's company-level mark: compute and freeze.
 *
 *   · `GET  /api/reporting/companies/:companyId/mark`         (reportingEngineRoutes.ts:455)
 *   · `POST /api/reporting/companies/:companyId/mark/persist` (:477)
 *
 * Both pinned by FINAL REVIEW B (R-1) with zero client callers; re-verified at
 * source — the only client hits for "mark" are
 * `client/src/pages/partner/SpvPerformance.tsx:325`, which reads the
 * VEHICLE-level `/api/reporting/mark-overrides` list. Nothing anywhere in
 * `client/src` computed or froze a COMPANY mark. Genuinely orphaned.
 *
 * A CORRECTION TO THE REVIEW'S FRAMING, verified rather than assumed. Review B
 * lists these under "admin endpoints", but both are `requireAuth`, not
 * `requireAdmin` (:455, :477). I have not widened or narrowed either guard —
 * this panel simply renders on an admin page because that is where the company
 * record already lives. The endpoints remain exactly as authored.
 *
 * THE SINK (Rule 2), named precisely. `POST .../mark/persist` writes ONE row to
 * `valuation_event` via `persistValuationEvent()`. It does NOT write a mark, a
 * price or a cap-table figure, and it does not mutate the round it derives
 * from — it FREEZES the mark that is effective right now as an auditable
 * event. That distinction is stated on screen, because "persist" reads like
 * "make this the price" and it is not.
 *
 * THE SECOND PATH, hunted and found. The value being frozen comes from
 * `effectiveMarkForCompany()` (server/wave9ReportingStore.ts:317) — the SAME
 * function Wave 23 discovered was bypassing the approval gate entirely, and
 * repointed through `overrideIsEffective()`. That is why this panel shows the
 * DERIVED mark and the EFFECTIVE mark as two separate figures: when they differ,
 * a GP override is moving the number, and the reviewer should see that before
 * freezing anything. The panel also surfaces `overrideApprovalMode` from the
 * same response, so a freeze made while overrides are effective-on-write is
 * visibly a different act from one made under `required`.
 *
 * MONEY (Rule 4). `fairValueMinor` is INTEGER MINOR UNITS on the wire. The
 * input takes major units and converts ONCE, at the edge, exponent-aware, and
 * REFUSES anything that would need rounding — for JPY (ISO 4217 exponent 0) a
 * fractional amount is not a JPY amount and is rejected rather than floored.
 * Display is `formatMinor()`, never `/100`. Nothing is summed here at all, so
 * no cross-currency total can exist. NOTE `pricePerShare` on the derived mark
 * is MAJOR units and carries no currency (server/wave9ReportingStore.ts:231),
 * so it is deliberately NOT passed through `formatMinor` — doing so would read
 * a share price as minor units and display it 100x too small.
 *
 * FAIL-CLOSED (Rule 5). A load failure renders `LoadFailedRefusal`. "No priced
 * round" is rendered as the explicit server reason `NO_PRICED_ROUND`, never as
 * a $0 mark and never as a blank that reads as zero.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Gauge } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatMinor, currencyExponent } from "@/lib/currency";
import { majorToMinorExact } from "@/lib/moneyInput";
import { LoadFailedRefusal } from "@/components/LoadFailedRefusal";

/* `DerivedMark` — server/wave9ReportingStore.ts:231. */
type DerivedMark = {
  companyId: string;
  pricePerShare: number;
  valuationDate: string;
  roundId: string;
  roundName: string;
  ageDays: number;
  badge: string;
  method: string;
  source: string;
  overrideId?: string;
  overrideReason?: string;
} | null;

type MarkResponse = {
  ok: boolean;
  companyId: string;
  derived: DerivedMark;
  effective: DerivedMark;
  thresholds: { staleWarnDays: number | null; staleExpiredDays: number | null; autoDerive: boolean | null };
  overrideApprovalMode: "able_to" | "required";
  reason: string | null;
};

type PersistResponse = { ok: boolean; valuationEventId?: string; mark?: DerivedMark; error?: string; message?: string };

/* JPY is in this list permanently: an ISO-4217 exponent-0 currency is the only
   thing that catches a hardcoded `/100`, here and in the harness. */
const CURRENCIES = ["USD", "EUR", "GBP", "JPY"] as const;

/* WAVE 24 — the ONE shared parser (client/src/lib/moneyInput.ts). No
   `allowNegative` here: the persist route refuses a negative fair value
   (FAIR_VALUE_REQUIRED, reportingEngineRoutes.ts:489), so the control refuses
   exactly what the server refuses. */

function MarkFacts({ m, label, testId }: { m: DerivedMark; label: string; testId: string }) {
  if (!m) {
    return (
      <div data-testid={testId}>
        <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className="block text-xs text-muted-foreground">None on record.</span>
      </div>
    );
  }
  return (
    <div data-testid={testId}>
      <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      {/* MAJOR-unit price per share, no currency code on the wire — rendered as
          a bare number with an explicit unit label, never via formatMinor. */}
      <span className="block text-base font-semibold">{`${m.pricePerShare} / share`}</span>
      <span className="block text-[11px] text-muted-foreground">
        {`${m.roundName} · ${m.valuationDate} · ${m.ageDays}d old`}
      </span>
      <span className="block text-[11px] text-muted-foreground">{`${m.method} · ${m.source} · ${m.badge}`}</span>
      {m.overrideReason && (
        <span className="block text-[11px] text-amber-800">{`Override reason: ${m.overrideReason}`}</span>
      )}
    </div>
  );
}

export function CompanyMarkPanel({ companyId }: { companyId: string }) {
  const { toast } = useToast();
  const [currency, setCurrency] = useState<string>("USD");
  const [fairValueMajor, setFairValueMajor] = useState("");
  const [persisted, setPersisted] = useState<PersistResponse | null>(null);

  const q = useQuery<MarkResponse>({
    queryKey: ["/api/reporting/companies", companyId, "mark"],
    queryFn: async () =>
      (await apiRequest("GET", `/api/reporting/companies/${encodeURIComponent(companyId)}/mark`)).json(),
    enabled: companyId !== "",
    retry: false,
  });

  const fairValueMinor = majorToMinorExact(fairValueMajor, currency);

  const mut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/reporting/companies/${encodeURIComponent(companyId)}/mark/persist`, {
        fairValueMinor,
        currency,
      });
      return (await res.json()) as PersistResponse;
    },
    onSuccess: (d) => {
      if (!d?.ok) {
        toast({
          title: "Not frozen",
          description:
            d?.error === "NO_MARK_TO_PERSIST"
              ? "This company has no priced round and no effective override, so there is no mark to freeze."
              : (d?.message ?? d?.error ?? "The server refused this valuation event."),
          variant: "destructive",
        });
        return;
      }
      setPersisted(d);
      setFairValueMajor("");
      queryClient.invalidateQueries({ queryKey: ["/api/reporting/companies", companyId, "mark"] });
      toast({ title: "Valuation event recorded" });
    },
    onError: (e: unknown) =>
      toast({ title: "Could not record the valuation event", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
  });

  const d = q.data ?? null;
  /* Effective ≠ derived means an override is moving the reported number. Worth
     seeing BEFORE freezing, not after. Compared on the fields that identify the
     mark, not on object identity. */
  const overrideInPlay =
    !!d?.derived && !!d?.effective && (d.derived.pricePerShare !== d.effective.pricePerShare || d.derived.source !== d.effective.source);

  return (
    <Card className="lg:col-span-2" data-testid="card-company-mark">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Gauge className="h-4 w-4" /> Valuation mark
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {q.isError ? (
          <LoadFailedRefusal
            what="this company's valuation mark"
            onRetry={() => q.refetch()}
            isRetrying={q.isFetching}
            testId="company-mark-load-failed"
          />
        ) : !q.isSuccess ? (
          <span className="block text-xs text-muted-foreground" data-testid="text-company-mark-loading">
            Loading the valuation mark…
          </span>
        ) : (
          <>
            {!d?.derived && !d?.effective ? (
              <span className="block text-xs text-muted-foreground" data-testid="text-company-mark-none">
                {d?.reason === "NO_PRICED_ROUND"
                  ? "No priced round on record. Marks auto-derive from the last PRICED round, so a company whose only rounds are SAFEs has no mark — that is the correct answer, not a zero."
                  : "No valuation mark on record."}
              </span>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                <MarkFacts m={d?.derived ?? null} label="Derived by the platform" testId="company-mark-derived" />
                <MarkFacts m={d?.effective ?? null} label="Effective right now" testId="company-mark-effective" />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {/* WAVE 101 - both branches were red: the GOVERNED setting ("approval
   required") was indistinguishable from the ungoverned one.  Only the
   governed branch moves; the ungoverned branch stays destructive. */}
              <Badge variant={d?.overrideApprovalMode === "required" ? "positive" : "destructive"} data-testid="badge-company-mark-approval-mode">
                {`Override approval: ${d?.overrideApprovalMode ?? "unknown"}`}
              </Badge>
              {overrideInPlay && (
                <Badge variant="outline" data-testid="badge-company-mark-override-in-play">
                  A GP override is moving this mark
                </Badge>
              )}
            </div>

            <span className="block text-[11px] text-muted-foreground" data-testid="text-company-mark-thresholds">
              {`Stale warning at ${d?.thresholds?.staleWarnDays ?? "N/A"}d · expired at ${d?.thresholds?.staleExpiredDays ?? "N/A"}d · auto-derive ${
                d?.thresholds?.autoDerive === null || d?.thresholds?.autoDerive === undefined ? "N/A" : String(d.thresholds.autoDerive)
              }`}
            </span>

            {/* ── freeze ── */}
            <div className="space-y-2 border-t pt-3">
              <span className="block text-xs text-muted-foreground" data-testid="text-company-mark-persist-explainer">
                Freezing records ONE auditable valuation event at the effective mark&rsquo;s date and method. It does
                not change the mark, the round it derives from, or any cap-table figure.
              </span>
              <div className="grid items-end gap-3 md:grid-cols-3">
                <div>
                  <Label className="text-xs">Currency</Label>
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger data-testid="select-company-mark-currency"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((c) => (
                        <SelectItem key={c} value={c} data-testid={`option-company-mark-currency-${c}`}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">{`Fair value (${currency})`}</Label>
                  <Input
                    value={fairValueMajor}
                    onChange={(e) => setFairValueMajor(e.target.value)}
                    data-testid="input-company-mark-fair-value"
                  />
                </div>
                <div>
                  <Button
                    size="sm"
                    className="h-8 text-xs"
                    disabled={fairValueMinor === undefined || mut.isPending}
                    onClick={() => mut.mutate()}
                    data-testid="button-persist-company-mark"
                  >
                    {mut.isPending ? "Freezing…" : "Freeze this mark"}
                  </Button>
                </div>
              </div>
              {fairValueMajor.trim() !== "" && fairValueMinor === undefined && (
                <span className="block text-xs text-rose-700" data-testid="text-company-mark-value-invalid">
                  {currencyExponent(currency) === 0
                    ? `${currency} has no minor unit — enter a whole, non-negative number.`
                    : `Enter a non-negative amount with at most ${currencyExponent(currency)} decimal places. An amount that had to be rounded is an amount nobody authorised.`}
                </span>
              )}
              {fairValueMinor !== undefined && (
                <span className="block text-xs text-muted-foreground" data-testid="text-company-mark-value-preview">
                  {`Will be recorded as ${formatMinor(fairValueMinor, currency)}.`}
                </span>
              )}
              {persisted?.ok && (
                <span className="block text-xs" data-testid="text-company-mark-persisted">
                  {`Recorded valuation event ${persisted.valuationEventId ?? "—"}.`}
                </span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default CompanyMarkPanel;
