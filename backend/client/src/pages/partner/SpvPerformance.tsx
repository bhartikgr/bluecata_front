/**
 * WAVE 10 — EN-1 / EN-2 UI surface: SPV performance, cash flows and marks.
 *
 * WHY THIS PAGE EXISTS AT ALL.
 *   The standing owner rule is that functionality which exists must be
 *   reflected in the UI. WAVE 9 built a complete reporting engine and gave it
 *   no route; WAVE 10 gave it routes. Routes with no screen would only move the
 *   same problem one layer up — a GP cannot curl an endpoint to see whether
 *   their fund is up.
 *
 * WHAT IT REFUSES TO DO, WHICH IS THE MORE IMPORTANT HALF.
 *
 *   1. IT NEVER PRINTS A NUMBER THE ENGINE DID NOT RETURN. `computeFundMetrics`
 *      returns a STATUS (`NOT_APPLICABLE`, `UNMARKED`, `INSUFFICIENT_DATA`)
 *      instead of a value whenever the value would be a guess. Every one of
 *      those statuses is rendered as its own sentence. TVPI on an unmarked
 *      vehicle shows "no current mark", not 1.00x — because 1.00x is a claim
 *      that the investment is worth exactly what was paid, which nobody has
 *      established.
 *
 *   2. IT DOES NOT COMPUTE. There is no arithmetic on this page beyond
 *      formatting. Money arrives in integer minor units and is formatted; IRR
 *      arrives as a FRACTION and goes through `formatFractionAsPercent`. There
 *      is deliberately no `n > 1 ? n / 100 : n` anywhere — that heuristic
 *      silently mangles any rate above 100%, which is exactly what a good early
 *      SPV produces.
 *
 *   3. IT SHOWS THE CHAIN VERIFICATION RESULT INCLUDING FAILURE, and shows
 *      "unchained rows" separately rather than folding them into a green tick.
 *      A ledger integrity panel that can only say OK is decoration.
 *
 * Q9 is honoured for the history chart: monthly points, and the series is only
 * described as a trend at three or more points. The server states the rule
 * (`chartable`, `minPointsForChart`) so this page cannot disagree with it.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { formatMinor } from "@/lib/currency";
import { formatFractionAsPercent } from "@/lib/percentDisplay";
import { AppCard } from "@/components/ui/app-card";
import { Button } from "@/components/ui/button";
import { PartnerEmptyState } from "@/components/partner/PartnerShell";
import { FilterChip } from "@/components/ui/filter-chip";

/* ---------------------------------------------------------------------- */

type MetricValue =
  | { status: "OK"; value: number }
  | { status: string; value?: null }
  | number
  | null;

/* ── WAVE 15 response shapes ───────────────────────────────────────────── */

type FootnotesResponse = {
  ok?: boolean;
  footnotes?: Array<{ key: string; text: string }>;
  configRead?: Record<string, unknown>;
  sublineTreatment?: string;
  valuationDateRequired?: boolean;
};

type CarryAccrual = {
  spvId: string;
  asOfDate: string;
  basis: string;
  convention: string;
  contributedMinor: number;
  distributedMinor: number;
  hurdleOwedMinor: number;
  hurdleMet: boolean;
  carryMinor: number;
  catchUpMinor: number;
  lpNetMinor: number;
  currency: string;
  /* FRACTIONS on the wire. Displayed only via formatFractionAsPercent. */
  carryRateFraction: number;
  hurdleRateFraction: number;
  catchUpRateFraction: number;
  hurdleKind: string;
  componentCount: number;
};

type CarryResponse = { ok?: boolean; persisted?: boolean; accrual?: CarryAccrual };

type AccrualsResponse = {
  ok?: boolean;
  accruals?: Array<{
    id: string;
    asOfDate: string;
    basis: string;
    carryMinor: number;
    lpNetMinor: number;
    currency: string;
    computedBy: string;
  }>;
};

type OverridesResponse = {
  ok?: boolean;
  approvalMode?: string;
  overrides?: Array<{
    id: string;
    priorFairValueMinor: number | null;
    fairValueMinor: number;
    currency: string | null;
    reason: string;
    approvalState: string | null;
    overriddenAt: string | null;
  }>;
};

type CashflowRow = {
  id: string;
  lpId: string | null;
  txnType: string;
  valueDate: string;
  amountMinor: number;
  currency: string;
  isRecallable: boolean;
  sourceKind: string;
  sourceRef: string | null;
  chainSeq: number | null;
  currHash: string | null;
};

type CashflowResponse = {
  ok: boolean;
  chainInstalled: boolean;
  flows: CashflowRow[];
  total: number;
};

type VerifyResponse = {
  ok: boolean;
  verification: {
    ok: boolean;
    checked: number;
    unchained: number;
    breaks: Array<{ id: string; chainSeq: number | null; reason: string }>;
  };
};

type MetricsResponse = {
  ok: boolean;
  asOfDate: string;
  flowCount: number;
  marksStale: boolean;
  valuation: { fairValueMinor: number; valuationDate: string; method: string; source: string } | null;
  metrics: Record<string, any>;
};

type SnapshotsResponse = {
  ok: boolean;
  points: Array<Record<string, any>>;
  total: number;
  chartable: boolean;
  minPointsForChart: number;
};

/* ----------------------------------------------------------------------
 * Rendering a metric that may legitimately have no value.
 *
 * THIS FUNCTION IS THE POINT OF THE PAGE. The engine distinguishes "we
 * computed 0" from "we cannot compute this", and if the UI collapses those two
 * into the same glyph then all the care taken in the engine was wasted.
 * -------------------------------------------------------------------- */
const STATUS_COPY: Record<string, string> = {
  UNMARKED: "No current mark",
  NOT_APPLICABLE: "Not applicable",
  INSUFFICIENT_DATA: "Not enough history",
  NO_COMMITMENT: "No commitment recorded",
  DIVIDE_BY_ZERO: "No contributions yet",
};

function unwrap(m: MetricValue): { value: number | null; status: string | null } {
  if (m === null || m === undefined) return { value: null, status: "UNAVAILABLE" };
  if (typeof m === "number") return { value: m, status: null };
  if (typeof m === "object" && "status" in m) {
    if (m.status === "OK" && typeof (m as any).value === "number") {
      return { value: (m as any).value as number, status: null };
    }
    return { value: null, status: String(m.status) };
  }
  return { value: null, status: "UNAVAILABLE" };
}

function MetricTile({
  label,
  metric,
  kind,
  hint,
}: {
  label: string;
  metric: MetricValue;
  kind: "multiple" | "percent";
  hint?: string;
}) {
  const { value, status } = unwrap(metric);
  const testid = `spv-metric-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <AppCard className="p-4" data-testid={testid}>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      {value === null ? (
        <>
          {/* An honest empty state, never a zero. */}
          <div className="mt-1 text-lg font-medium text-slate-400" data-testid={`${testid}-empty`}>
            {STATUS_COPY[status ?? ""] ?? "Unavailable"}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            This figure is withheld rather than estimated.
          </div>
        </>
      ) : (
        <div className="mt-1 text-2xl font-semibold text-[var(--cv-color-navy)]" data-testid={`${testid}-value`}>
          {kind === "multiple"
            ? `${value.toFixed(2)}x`
            : /* IRR is a FRACTION on the wire. formatFractionAsPercent is the
                 only permitted conversion; it handles rates above 100%
                 correctly, which the old `n > 1 ? n/100 : n` heuristic did not. */
              formatFractionAsPercent(value)}
        </div>
      )}
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </AppCard>
  );
}

/* ---------------------------------------------------------------------- */

export default function SpvPerformance({
  vehicleKind = "spv",
  vehicleId,
}: {
  vehicleKind?: string;
  vehicleId: string;
}) {
  const qc = useQueryClient();
  /* WAVE 15 adds three tabs to this page, each closing a "built but not shipped"
   * gap rather than adding new behaviour:
   *   footnotes  M-1d — packages/math-fns renderFootnotes had zero callers.
   *   carry      M-5  — accrued carry at an as-of date; spv_carry_accrual had no writer.
   *   marks      M-2b — the GP mark-override engine and its three routes existed
   *                     with zero client callers (grep mark-override client/src -> 0). */
  const [tab, setTab] = useState<
    "metrics" | "cashflows" | "integrity" | "history" | "footnotes" | "carry" | "marks"
  >("metrics");
  const [asOf, setAsOf] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [ovValue, setOvValue] = useState<string>("");
  const [ovReason, setOvReason] = useState<string>("");
  const [ovEventId, setOvEventId] = useState<string>("");

  const base = `/api/reporting/vehicles/${vehicleKind}/${encodeURIComponent(vehicleId)}`;

  const metricsQ = useQuery<MetricsResponse>({
    queryKey: [`${base}/metrics`],
    queryFn: async () => (await apiRequest("GET", `${base}/metrics`)).json(),
    retry: false,
  });

  const flowsQ = useQuery<CashflowResponse>({
    queryKey: [`${base}/cashflows`],
    queryFn: async () => (await apiRequest("GET", `${base}/cashflows`)).json(),
    retry: false,
  });

  const verifyQ = useQuery<VerifyResponse>({
    queryKey: [`${base}/cashflows/verify`],
    queryFn: async () => (await apiRequest("GET", `${base}/cashflows/verify`)).json(),
    enabled: tab === "integrity",
    retry: false,
  });

  const snapsQ = useQuery<SnapshotsResponse>({
    queryKey: [`${base}/snapshots`],
    queryFn: async () => (await apiRequest("GET", `${base}/snapshots`)).json(),
    enabled: tab === "history",
    retry: false,
  });

  /* ── M-1d ─────────────────────────────────────────────────────────────────
   * GET only. Rendering a report must never write one. */
  const footnotesQ = useQuery<FootnotesResponse>({
    queryKey: [`${base}/footnotes`, asOf],
    queryFn: async () => (await apiRequest("GET", `${base}/footnotes?asOf=${encodeURIComponent(asOf)}`)).json(),
    enabled: tab === "footnotes",
    retry: false,
  });

  /* ── M-5 ──────────────────────────────────────────────────────────────────
   * `carryBase` is the SPV-scoped route, not the generic vehicle route: carry
   * terms belong to an SPV, and asking for the accrual of a "company" would be
   * a category error rather than an empty answer. */
  const carryBase = `/api/reporting/spv/${encodeURIComponent(vehicleId)}`;

  const carryQ = useQuery<CarryResponse>({
    queryKey: [`${carryBase}/carry-accrual`, asOf],
    queryFn: async () =>
      (await apiRequest("GET", `${carryBase}/carry-accrual?asOf=${encodeURIComponent(asOf)}`)).json(),
    enabled: tab === "carry" && vehicleKind === "spv",
    retry: false,
  });

  const accrualsQ = useQuery<AccrualsResponse>({
    queryKey: [`${carryBase}/carry-accruals`],
    queryFn: async () => (await apiRequest("GET", `${carryBase}/carry-accruals`)).json(),
    enabled: tab === "carry" && vehicleKind === "spv",
    retry: false,
  });

  const persistCarryM = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `${carryBase}/carry-accrual`, { asOfDate: asOf })).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`${carryBase}/carry-accruals`] });
    },
  });

  /* ── M-2b ─────────────────────────────────────────────────────────────────
   * These three routes have existed since Wave 10 at
   * server/lib/reportingEngineRoutes.ts:406/436/445 with zero client callers.
   * Nothing new is built here; this is the missing consumer. */
  const overridesQ = useQuery<OverridesResponse>({
    queryKey: ["/api/reporting/mark-overrides"],
    queryFn: async () => (await apiRequest("GET", "/api/reporting/mark-overrides")).json(),
    enabled: tab === "marks",
    retry: false,
  });

  const overrideM = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("POST", `${base}/mark/override`, {
          valuationEventId: ovEventId.trim(),
          /* Integer minor units, parsed from a digits-only field. No decimal
             arithmetic and no rounding happens on the client. */
          fairValueMinor: Number.parseInt(ovValue.trim(), 10),
          currency: ccy,
          reason: ovReason.trim(),
          priorFairValueMinor: metricsQ.data?.valuation?.fairValueMinor ?? null,
        })
      ).json(),
    onSuccess: () => {
      setOvValue("");
      setOvReason("");
      qc.invalidateQueries({ queryKey: ["/api/reporting/mark-overrides"] });
      qc.invalidateQueries({ queryKey: [`${base}/metrics`] });
    },
  });

  const snapshotM = useMutation({
    mutationFn: async () => (await apiRequest("POST", `${base}/snapshot`, {})).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`${base}/snapshots`] });
    },
  });

  const m = metricsQ.data?.metrics ?? {};
  const flows = flowsQ.data?.flows ?? [];
  const ccy = flows[0]?.currency ?? "USD";

  return (
    /* A plain section, NOT PartnerShell. This panel is embedded inside an
       existing SPV detail page which already renders the partner chrome;
       nesting a second shell would duplicate the header and the identity
       badges. */
    <section className="space-y-4" data-testid="spv-performance-page">
      {/* ------------------------------------------------------------------
        * The staleness badge is Q5's, and it is shown at the TOP rather than
        * buried next to the mark, because a stale mark makes every multiple on
        * this page stale and the reader needs to know that before they read
        * them, not after.
        * ---------------------------------------------------------------- */}
      {metricsQ.data?.marksStale && (
        <div
          className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
          data-testid="spv-performance-stale-banner"
        >
          <span className="font-medium">Valuation is stale.</span>{" "}
          The most recent mark is dated {metricsQ.data?.valuation?.valuationDate ?? "—"} and has aged past
          the configured window. Multiples below rest on it.
        </div>
      )}

      {metricsQ.data && !metricsQ.data.valuation && (
        <div
          className="mb-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
          data-testid="spv-performance-unmarked-banner"
        >
          <span className="font-medium">This vehicle has no current valuation mark.</span>{" "}
          Realised measures (DPI, PIC) are shown; unrealised measures (TVPI, RVPI) are withheld rather
          than defaulted to cost.
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2" data-testid="spv-performance-tabs">
        <FilterChip active={tab === "metrics"} onClick={() => setTab("metrics")} data-testid="tab-metrics">
          Metrics
        </FilterChip>
        <FilterChip active={tab === "cashflows"} onClick={() => setTab("cashflows")} data-testid="tab-cashflows">
          Cash flows ({flowsQ.data?.total ?? 0})
        </FilterChip>
        <FilterChip active={tab === "integrity"} onClick={() => setTab("integrity")} data-testid="tab-integrity">
          Ledger integrity
        </FilterChip>
        <FilterChip active={tab === "history"} onClick={() => setTab("history")} data-testid="tab-history">
          History
        </FilterChip>
        <FilterChip active={tab === "footnotes"} onClick={() => setTab("footnotes")} data-testid="tab-footnotes">
          Footnotes
        </FilterChip>
        <FilterChip active={tab === "carry"} onClick={() => setTab("carry")} data-testid="tab-carry">
          Carry accrual
        </FilterChip>
        <FilterChip active={tab === "marks"} onClick={() => setTab("marks")} data-testid="tab-marks">
          Marks &amp; overrides
        </FilterChip>
      </div>

      {/* ---------------------------- METRICS ---------------------------- */}
      {tab === "metrics" && (
        <>
          {metricsQ.isLoading && <div className="text-sm text-slate-500">Loading performance…</div>}
          {metricsQ.isError && (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900" data-testid="spv-performance-error">
              Could not load performance for this vehicle.
            </div>
          )}
          {metricsQ.data && metricsQ.data.flowCount === 0 && (
            <PartnerEmptyState
              title="No cash flows recorded yet"
              description="Performance measures appear once the first capital call or distribution is recorded against this vehicle. Nothing is estimated in the meantime."
            />
          )}
          {metricsQ.data && metricsQ.data.flowCount > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <MetricTile label="Net IRR" metric={m.netIrr ?? m.irr ?? null} kind="percent" hint="Annualised where the holding period allows it." />
              <MetricTile label="Gross IRR" metric={m.grossIrr ?? null} kind="percent" hint="Requires fee-classified flows." />
              <MetricTile label="DPI" metric={m.dpi ?? null} kind="multiple" hint="Realised. Independent of any mark." />
              <MetricTile label="TVPI" metric={m.tvpi ?? null} kind="multiple" hint="Requires a current mark." />
              <MetricTile label="RVPI" metric={m.rvpi ?? null} kind="multiple" hint="Requires a current mark." />
              <MetricTile label="PIC" metric={m.pic ?? null} kind="multiple" hint="Paid-in over commitment." />
            </div>
          )}
        </>
      )}

      {/* --------------------------- CASH FLOWS -------------------------- */}
      {tab === "cashflows" && (
        <AppCard className="p-0" data-testid="spv-cashflows-card">
          {flowsQ.data && !flowsQ.data.chainInstalled && (
            <div className="border-b border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="spv-cashflows-unchained-warning">
              The append-only chain is not installed on this deployment. Rows below are
              readable but their integrity is not being enforced.
            </div>
          )}
          {flows.length === 0 ? (
            <PartnerEmptyState
              title="No cash flows"
              description="Capital calls and distributions are projected here automatically as they are recorded."
            />
          ) : (
            <table className="w-full text-sm" data-testid="spv-cashflows-table">
              <thead className="border-b bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="p-2">Seq</th>
                  <th className="p-2">Date</th>
                  <th className="p-2">Type</th>
                  <th className="p-2">LP</th>
                  <th className="p-2 text-right">Amount</th>
                  <th className="p-2">Source</th>
                </tr>
              </thead>
              <tbody>
                {flows.map((f) => (
                  <tr key={f.id} className="border-b last:border-0" data-testid={`spv-cashflow-row-${f.id}`}>
                    <td className="p-2 tabular-nums text-slate-500">{f.chainSeq ?? "—"}</td>
                    <td className="p-2 tabular-nums">{f.valueDate}</td>
                    <td className="p-2">
                      {f.txnType.replace(/_/g, " ")}
                      {f.isRecallable && (
                        <span className="ml-2 rounded bg-slate-100 px-1 text-xs text-slate-600">recallable</span>
                      )}
                    </td>
                    <td className="p-2 text-slate-600">{f.lpId ?? "vehicle-level"}</td>
                    {/* The sign is shown, not hidden behind a colour. A reader
                        must be able to tell a call from a distribution in a
                        printed statement. */}
                    <td className={`p-2 text-right tabular-nums ${f.amountMinor < 0 ? "text-rose-700" : "text-emerald-700"}`}>
                      {formatMinor(f.amountMinor, f.currency, { locale: "en-US" })}
                    </td>
                    <td className="p-2 text-xs text-slate-500">{f.sourceKind}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </AppCard>
      )}

      {/* -------------------------- INTEGRITY ---------------------------- */}
      {tab === "integrity" && (
        <AppCard className="p-4" data-testid="spv-integrity-card">
          {verifyQ.isLoading && <div className="text-sm text-slate-500">Verifying chain…</div>}
          {verifyQ.data && (
            <>
              <div
                className={`rounded-md p-3 text-sm ${
                  verifyQ.data.verification.ok
                    ? "border border-emerald-200 bg-emerald-50 text-emerald-900"
                    : "border border-rose-200 bg-rose-50 text-rose-900"
                }`}
                data-testid="spv-integrity-verdict"
              >
                {verifyQ.data.verification.ok
                  ? `Chain verified: ${verifyQ.data.verification.checked} row(s) recomputed and matched.`
                  : `Chain FAILED verification. ${verifyQ.data.verification.breaks.length} break(s) found.`}
              </div>
              {/* Unchained rows are reported separately and NEVER counted as
                  verified. Folding them into the green count is how an audit
                  panel starts lying. */}
              {verifyQ.data.verification.unchained > 0 && (
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="spv-integrity-unchained">
                  {verifyQ.data.verification.unchained} row(s) predate the hash chain and could not be
                  verified. They are excluded from the verified count above.
                </div>
              )}
              {verifyQ.data.verification.breaks.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm text-rose-800" data-testid="spv-integrity-breaks">
                  {verifyQ.data.verification.breaks.map((b) => (
                    <li key={b.id}>
                      seq {b.chainSeq ?? "—"} · {b.id} — {b.reason}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </AppCard>
      )}

      {/* --------------------------- HISTORY ----------------------------- */}
      {tab === "history" && (
        <AppCard className="p-4" data-testid="spv-history-card">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm text-slate-600">
              Monthly performance snapshots (Q9). One point per calendar month.
            </div>
            <Button
              size="sm"
              onClick={() => snapshotM.mutate()}
              disabled={snapshotM.isPending}
              data-testid="spv-history-snapshot-button"
            >
              {snapshotM.isPending ? "Recording…" : "Record this month"}
            </Button>
          </div>
          {snapsQ.data && snapsQ.data.total === 0 && (
            <PartnerEmptyState
              title="No snapshots yet"
              description="Snapshots accumulate one point per month. A trend line is drawn once there are at least three."
            />
          )}
          {snapsQ.data && snapsQ.data.total > 0 && !snapsQ.data.chartable && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700" data-testid="spv-history-insufficient">
              {snapsQ.data.total} of {snapsQ.data.minPointsForChart} points needed before a trend is
              shown. Two points is a line between two numbers, not a trend, so the figures are listed
              instead.
            </div>
          )}
          {snapsQ.data && snapsQ.data.total > 0 && (
            <table className="mt-3 w-full text-sm" data-testid="spv-history-table">
              <thead className="border-b text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="p-2">Month</th>
                  <th className="p-2 text-right">Contributed</th>
                  <th className="p-2 text-right">Distributed</th>
                  <th className="p-2 text-right">Residual value</th>
                </tr>
              </thead>
              <tbody>
                {snapsQ.data.points.map((p: any) => (
                  <tr key={p.id ?? p.periodStart} className="border-b last:border-0">
                    <td className="p-2 tabular-nums">{p.periodStart}</td>
                    <td className="p-2 text-right tabular-nums">
                      {formatMinor(p.contributedMinor ?? 0, p.currency ?? ccy, { locale: "en-US" })}
                    </td>
                    <td className="p-2 text-right tabular-nums">
                      {formatMinor(p.distributedMinor ?? 0, p.currency ?? ccy, { locale: "en-US" })}
                    </td>
                    <td className="p-2 text-right tabular-nums">
                      {p.residualValueMinor === null || p.residualValueMinor === undefined
                        ? "—"
                        : formatMinor(p.residualValueMinor, p.currency ?? ccy, { locale: "en-US" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </AppCard>
      )}

      {/* ---------------------------- FOOTNOTES (M-1d) -------------------- */}
      {tab === "footnotes" && (
        <AppCard className="p-4" data-testid="spv-footnotes-card">
          <div className="text-sm font-medium text-[var(--cv-color-navy)]">ILPA disclosure footnotes</div>
          <div className="mt-1 text-xs text-slate-500" data-testid="spv-footnotes-provenance">
            Every footnote is DERIVED from admin reporting config and this vehicle&rsquo;s own valuation
            record. There are no unconditional strings, so a vehicle with no mark does not get a footnote
            claiming a valuation source it does not have.
          </div>
          {footnotesQ.isLoading && <div className="mt-3 text-sm text-slate-500">Loading footnotes…</div>}
          {footnotesQ.isError && (
            <div
              className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900"
              data-testid="spv-footnotes-error"
            >
              <span className="font-medium block">Footnotes cannot be rendered.</span>
              <span className="block mt-1">
                A reporting config key is outside the renderer&rsquo;s domain, or this vehicle has a mark with
                no valuation date. The report is withheld rather than printed with a guessed disclosure —
                a wrong footnote is worse than a missing one.
              </span>
            </div>
          )}
          {footnotesQ.data?.footnotes && (
            <ol className="mt-3 space-y-2 text-sm" data-testid="spv-footnotes-list">
              {footnotesQ.data.footnotes.map((f) => (
                <li key={f.key} className="border-b border-slate-100 pb-2 last:border-0" data-testid={`spv-footnote-${f.key}`}>
                  {f.text}
                </li>
              ))}
            </ol>
          )}
          {footnotesQ.data?.sublineTreatment && (
            <div className="mt-3 text-xs text-slate-500" data-testid="spv-footnotes-subline-treatment">
              {`Subscription-line reporting treatment on file: ${footnotesQ.data.sublineTreatment}.`}
            </div>
          )}
          {footnotesQ.data?.configRead && (
            <div className="mt-2 text-xs text-slate-500" data-testid="spv-footnotes-config-read">
              {`Config keys read: ${Object.keys(footnotesQ.data.configRead).join(", ")}.`}
            </div>
          )}
        </AppCard>
      )}

      {/* -------------------------- CARRY ACCRUAL (M-5) ------------------- */}
      {tab === "carry" && (
        <AppCard className="p-4" data-testid="spv-carry-card">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-[var(--cv-color-navy)]">Accrued carry at an as-of date</div>
              <div className="mt-1 text-xs text-slate-500" data-testid="spv-carry-provenance">
                Computed in exact integer minor units through a four-tier waterfall. The GP share is
                TRUNCATED and every residual cent goes to the LP, so the three components always sum to
                the amount distributed — the database enforces that too.
              </div>
            </div>
            <div className="flex items-end gap-2">
              <label className="text-xs text-slate-500">
                As of
                <input
                  type="date"
                  value={asOf}
                  onChange={(e) => setAsOf(e.target.value)}
                  className="ml-2 rounded border border-slate-300 px-2 py-1 text-sm"
                  data-testid="spv-carry-asof-input"
                />
              </label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => persistCarryM.mutate()}
                disabled={persistCarryM.isPending || !carryQ.data?.accrual}
                data-testid="spv-carry-persist-button"
              >
                {persistCarryM.isPending ? "Recording…" : "Record this accrual"}
              </Button>
            </div>
          </div>
          <div className="mt-1 text-xs text-slate-500" data-testid="spv-carry-readonly-note">
            Viewing an accrual never writes one. Recording it is the explicit button above.
          </div>
          {carryQ.isLoading && <div className="mt-3 text-sm text-slate-500">Computing accrual…</div>}
          {carryQ.isError && (
            <div
              className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900"
              data-testid="spv-carry-error"
            >
              <span className="font-medium block">No accrual is shown.</span>
              <span className="block mt-1">
                Carry terms, a carry basis or the hurdle convention are not set for this vehicle. An
                accrual computed on assumed terms would be a number the GP could invoice against, so it
                is withheld until the terms exist.
              </span>
            </div>
          )}
          {carryQ.data?.accrual && (
            <>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-md border border-slate-200 p-3" data-testid="spv-carry-tile-carry">
                  <div className="text-xs uppercase text-slate-500">GP carry accrued</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums text-[var(--cv-color-navy)]">
                    {formatMinor(carryQ.data.accrual.carryMinor, carryQ.data.accrual.currency, { locale: "en-US" })}
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 p-3" data-testid="spv-carry-tile-catchup">
                  <div className="text-xs uppercase text-slate-500">Of which catch-up</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums text-[var(--cv-color-navy)]">
                    {formatMinor(carryQ.data.accrual.catchUpMinor, carryQ.data.accrual.currency, { locale: "en-US" })}
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 p-3" data-testid="spv-carry-tile-lpnet">
                  <div className="text-xs uppercase text-slate-500">LP net of carry</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums text-[var(--cv-color-navy)]">
                    {formatMinor(carryQ.data.accrual.lpNetMinor, carryQ.data.accrual.currency, { locale: "en-US" })}
                  </div>
                </div>
              </div>
              <div className="mt-3 space-y-1 text-xs text-slate-600">
                <div data-testid="spv-carry-terms">
                  {`Carry ${formatFractionAsPercent(carryQ.data.accrual.carryRateFraction)} · preferred return ${formatFractionAsPercent(
                    carryQ.data.accrual.hurdleRateFraction,
                  )} · catch-up ${formatFractionAsPercent(carryQ.data.accrual.catchUpRateFraction)} · ${
                    carryQ.data.accrual.hurdleKind
                  } hurdle`}
                </div>
                <div data-testid="spv-carry-basis">
                  {`Basis: ${carryQ.data.accrual.basis} · accrual convention: ${carryQ.data.accrual.convention} · ${carryQ.data.accrual.componentCount} component(s)`}
                </div>
                <div data-testid="spv-carry-hurdle">
                  {carryQ.data.accrual.hurdleMet
                    ? `Preferred return of ${formatMinor(carryQ.data.accrual.hurdleOwedMinor, carryQ.data.accrual.currency, { locale: "en-US" })} has been met; carry accrues above it.`
                    : `Preferred return of ${formatMinor(carryQ.data.accrual.hurdleOwedMinor, carryQ.data.accrual.currency, { locale: "en-US" })} is NOT yet met, so no carry has accrued.`}
                </div>
                <div data-testid="spv-carry-conservation">
                  {`Contributed ${formatMinor(carryQ.data.accrual.contributedMinor, carryQ.data.accrual.currency, { locale: "en-US" })} · distributed ${formatMinor(
                    carryQ.data.accrual.distributedMinor,
                    carryQ.data.accrual.currency,
                    { locale: "en-US" },
                  )} · carry + catch-up + LP net equals distributed exactly, to the cent.`}
                </div>
              </div>
            </>
          )}
          {accrualsQ.data?.accruals && accrualsQ.data.accruals.length > 0 && (
            <table className="mt-4 w-full text-sm" data-testid="spv-carry-history-table">
              <thead className="border-b text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="p-2">As of</th>
                  <th className="p-2">Basis</th>
                  <th className="p-2 text-right">Carry</th>
                  <th className="p-2 text-right">LP net</th>
                  <th className="p-2">Recorded by</th>
                </tr>
              </thead>
              <tbody>
                {accrualsQ.data.accruals.map((a) => (
                  <tr key={a.id} className="border-b last:border-0" data-testid={`spv-carry-history-${a.id}`}>
                    <td className="p-2 tabular-nums">{a.asOfDate}</td>
                    <td className="p-2">{a.basis}</td>
                    <td className="p-2 text-right tabular-nums">
                      {formatMinor(a.carryMinor, a.currency, { locale: "en-US" })}
                    </td>
                    <td className="p-2 text-right tabular-nums">
                      {formatMinor(a.lpNetMinor, a.currency, { locale: "en-US" })}
                    </td>
                    <td className="p-2 text-xs">{a.computedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </AppCard>
      )}

      {/* ----------------------- MARKS & OVERRIDES (M-2b) ---------------- */}
      {tab === "marks" && (
        <AppCard className="p-4" data-testid="spv-marks-card">
          <div className="text-sm font-medium text-[var(--cv-color-navy)]">GP mark override</div>
          <div className="mt-1 text-xs text-slate-500" data-testid="spv-marks-provenance">
            The override engine and its routes existed for some time with no screen, which meant a GP
            was <span className="font-medium">able to</span> override a mark only by calling the API. This
            is that screen. A reason of at least ten characters is mandatory and is stored with the
            override; the prior fair value is captured so the change is legible after the fact.
          </div>
          {overridesQ.data?.approvalMode && (
            <div className="mt-2 text-xs text-slate-600" data-testid="spv-marks-approval-mode">
              {overridesQ.data.approvalMode === "able_to"
                ? "Approval mode: an override takes effect immediately and is recorded for review afterwards."
                : `Approval mode: ${overridesQ.data.approvalMode} — an override is recorded and does NOT take effect until an admin approves it.`}
            </div>
          )}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-slate-500">
              Valuation event id
              <input
                value={ovEventId}
                onChange={(e) => setOvEventId(e.target.value)}
                /* The metrics payload does not carry the valuation event id, so
                   this field is entered rather than pre-filled. Guessing an id
                   would risk attaching an override to the wrong mark. */
                placeholder="valuation event id this override replaces"
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                data-testid="spv-marks-event-input"
              />
            </label>
            <label className="text-xs text-slate-500">
              {`Overridden fair value (minor units of ${ccy})`}
              <input
                value={ovValue}
                onChange={(e) => setOvValue(e.target.value)}
                inputMode="numeric"
                placeholder="e.g. 125000000 for 1,250,000.00"
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm tabular-nums"
                data-testid="spv-marks-value-input"
              />
            </label>
          </div>
          <div className="mt-1 text-xs text-slate-500" data-testid="spv-marks-minor-units-note">
            Entered and transmitted as integer minor units. The client performs no arithmetic on this
            figure and never rounds it.
          </div>
          <label className="mt-3 block text-xs text-slate-500">
            Reason (mandatory, at least 10 characters)
            <textarea
              value={ovReason}
              onChange={(e) => setOvReason(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
              data-testid="spv-marks-reason-input"
            />
          </label>
          <Button
            className="mt-3"
            size="sm"
            onClick={() => overrideM.mutate()}
            disabled={
              overrideM.isPending ||
              ovReason.trim().length < 10 ||
              !/^\d+$/.test(ovValue.trim()) ||
              !ovEventId.trim()
            }
            data-testid="spv-marks-submit-button"
          >
            {overrideM.isPending ? "Submitting…" : "Submit override"}
          </Button>
          {overrideM.isError && (
            <div className="mt-2 text-sm text-rose-900" data-testid="spv-marks-error">
              The override was rejected. A missing reason, a non-integer value or an unknown valuation
              event are all refused by the server; nothing was recorded.
            </div>
          )}
          {overridesQ.data?.overrides && overridesQ.data.overrides.length > 0 && (
            <table className="mt-4 w-full text-sm" data-testid="spv-marks-table">
              <thead className="border-b text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="p-2">When</th>
                  <th className="p-2 text-right">Prior</th>
                  <th className="p-2 text-right">Overridden to</th>
                  <th className="p-2">State</th>
                  <th className="p-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {overridesQ.data.overrides.map((o) => (
                  <tr key={o.id} className="border-b last:border-0" data-testid={`spv-marks-row-${o.id}`}>
                    <td className="p-2 tabular-nums text-xs">{o.overriddenAt ?? "—"}</td>
                    <td className="p-2 text-right tabular-nums">
                      {o.priorFairValueMinor === null || o.priorFairValueMinor === undefined
                        ? "—"
                        : formatMinor(o.priorFairValueMinor, o.currency ?? ccy, { locale: "en-US" })}
                    </td>
                    <td className="p-2 text-right tabular-nums">
                      {formatMinor(o.fairValueMinor, o.currency ?? ccy, { locale: "en-US" })}
                    </td>
                    <td className="p-2 text-xs">{o.approvalState ?? "—"}</td>
                    <td className="p-2 text-xs">{o.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {overridesQ.data?.overrides && overridesQ.data.overrides.length === 0 && (
            <div className="mt-3 text-sm text-slate-500" data-testid="spv-marks-empty">
              No mark overrides have been recorded.
            </div>
          )}
        </AppCard>
      )}
    </section>
  );
}
