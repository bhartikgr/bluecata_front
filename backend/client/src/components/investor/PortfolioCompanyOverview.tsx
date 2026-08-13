/**
 * Sprint 21 Wave C — C2: PortfolioCompanyOverview
 *
 * Per-company detail view shown on the Portfolio page after the company
 * switcher. Takes `companyId` prop and renders:
 *  - Per-company KPIs
 *  - "Updates from founder" feed (/api/investor/companies/:id/updates)
 *  - Mark history chart (/api/investor/portfolio/:id/marks)
 *  - Pro-rata calculator (scoped to active company)
 *  - Anti-dilution calculator (scoped to active company)
 *  - Tax / 1099 button
 *  - "View company detail" CTA
 *  - "Promote to Capavate Collective" button + dialog (C3)
 *  - Promotion status badge
 */
import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRealtimeSync, subscribeToMutation } from "@/lib/realtimeSync";
import { Link } from "wouter";
import {
  ArrowUpRight,
  Calculator,
  Briefcase,
  Sparkles,
  CheckCircle2,
  FileText,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";

import { fmtUSD, fmtPct } from "@/lib/format";
/* WAVE 31 · W31-A1 — exponent-aware money rendering for the mark chart. */
import { formatMinorOrUnavailable } from "@/lib/moneyDisplay";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PromoteToCollectiveDialog } from "./PromoteToCollectiveDialog";
import { broadBasedWeightedAverage } from "@/pages/investor/Portfolio";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type Position = {
  id: string;
  companyId: string;
  company: string;
  sector: string;
  stage: string;
  role: string;
  instrument: string;
  series: string;
  shares: number;
  ownershipPct: number;
  invested: number;
  currentValue: number;
  vintageYear: number;
  lastRoundLabel: string;
  lastRoundDate: string;
  maFlag: { strength: "low" | "medium" | "high"; note: string } | null;
  logoColor: string;
};

type FounderUpdate = {
  id: string;
  title: string;
  period: string;
  sentAt: string | null;
  template: string;
};

type PromotionStatus = {
  id: string;
  companyId: string;
  submittedAt: string;
  rationale: string;
} | null;

/* WAVE 31 · W31-A1 — the real `valuation_event` shape.
 *
 * WAS: `{ holdingId: string; marks: Array<{ month: number; value: number }> }`
 * — a shape that existed only to describe a hardcoded `[]`. `value` was a bare
 * number with no currency beside it and `month` was an array index, so the
 * chart could not have rendered a real, dated, denominated mark even if the
 * server had sent one.
 *
 * `fairValueMinor` is INTEGER MINOR UNITS and never travels without its
 * `currency`. `unavailableReason` distinguishes "nothing recorded" from "we
 * refuse to plot this", which an empty array cannot. */
type MarkPoint = {
  id: string;
  valuationDate: string;
  fairValueMinor: number;
  currency: string;
  method: string;
  source: string;
  isExternal: boolean;
  overrideId: string | null;
  overrideReason: string | null;
  originalFairValueMinor: number | null;
  /* WAVE 36 · ROW 10 — both produced by the SERVER
     (server/lib/investorMarkHistory.ts) from `badgeForAge()` against the
     DB-driven `marks.stale_warn_days` / `marks.stale_expired_days`. The
     thresholds are NOT hardcoded here: 180/365 are today's configured values,
     not laws, and a copy of them in this file would go silently wrong the day
     the owner changes the config. */
  ageDays?: number;
  badge?: "fresh" | "stale" | "expired" | "unmarked" | "gp_override";
};

type MarkHistory = {
  companyId: string;
  holdingId: string | null;
  currency: string | null;
  marks: MarkPoint[];
  /* WAVE 36 · ROW 10 — the thresholds the badges were decided by, so the
     tooltip can SAY what "stale" means instead of asserting it. */
  markThresholds?: { staleWarnDays: number; staleExpiredDays: number } | null;
  unavailableReason:
    | "NO_MARKS_RECORDED"
    | "MARKS_SPAN_CURRENCIES"
    | "MARKS_UNAVAILABLE"
    | null;
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * WAVE 16 — XT-C4 (ENGINE_REGISTRY C-4 / OPN-018). `positionIrr()` USED TO LIVE
 * HERE and it was RP-3, the fabrication Wave 9 deleted from the server:
 *
 *     const years = Math.max(1, new Date().getFullYear() - p.vintageYear);
 *     const m = p.currentValue / Math.max(1, p.invested);
 *     return (Math.pow(m, 1 / years) - 1) * 100;   // labelled "IRR"
 *
 * That is a hold-period CAGR of a single mark, not an internal rate of return.
 * It cannot be one: it has no dated cash flows, so a follow-on cheque, a
 * secondary, a distribution and a bridge all move it in the wrong direction, and
 * a position marked flat for four years reports 0.0% "IRR" as confidently as a
 * real solve would.
 *
 * Wave 9 (RP-3) removed exactly this arithmetic from
 * `server/portfolioAnalyticsStore.ts` and replaced it with XIRR (ACT/365F,
 * bracket + Brent) from `@capavate/math-fns`, SUPPRESSED with a `MetricStatus`
 * whenever there are no marks. THE CLIENT COPY SURVIVED — a SECOND PATH to the
 * same fabrication, rendered to investors at `/investor/portfolio`
 * (`client/src/App.tsx:787`). The XT-C4 fence found it; see
 * `scripts/lint/fundMetricsWinnerFence.ts` rule R1/RP-3-positionIrr.
 *
 * WHY THIS SURFACE SHOWS NO NUMBER RATHER THAN A DIFFERENT ONE: the strip's only
 * input is `GET /api/investor/portfolio2` (`server/routes.ts:2818`), a per-position
 * payload with `invested`, `currentValue` and `vintageYear` and NO cash-flow
 * dates. Per-company IRR has no canonical producer yet — `computePortfolioAnalyticsFor`
 * reports IRR at PORTFOLIO level only (`server/portfolioAnalyticsStore.ts:112-128`),
 * and per-position dated flows are EN-1's ledger. So the card stays, labelled,
 * with an explicit suppression instead of a fabricated figure. A blank is not a
 * failure; a fabricated IRR in front of an investment bank is.
 */
export const IRR_SUPPRESSED_DISPLAY = "—";
export const IRR_SUPPRESSED_REASON =
  "IRR needs dated cash flows, which this position payload does not carry. It is suppressed rather than approximated.";

function moic(p: Position): number {
  return p.invested > 0 ? p.currentValue / p.invested : 0;
}

function instrumentLabel(instrument: string): string {
  const map: Record<string, string> = {
    preferred: "Preferred",
    common: "Common",
    safe: "SAFE",
    note: "Note",
  };
  return map[instrument.toLowerCase()] ?? instrument;
}

/* ------------------------------------------------------------------ */
/* KvCard                                                              */
/* ------------------------------------------------------------------ */

function KvCard({
  label,
  value,
  hint,
  testid,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  testid: string;
  accent?: boolean;
}) {
  return (
    <Card data-testid={testid} className={accent ? "border-primary" : ""}>
      <CardContent className="p-4">
        <div className="text-[11px] text-muted-foreground uppercase tracking-wide">
          {label}
        </div>
        <div
          className={`text-lg font-semibold tabular-nums mt-0.5 ${accent ? "text-primary" : ""}`}
        >
          {value}
        </div>
        {hint && (
          <div className="text-[10px] text-muted-foreground">{hint}</div>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Per-company KPI strip                                               */
/* ------------------------------------------------------------------ */

function CompanyKpiStrip({ position: p }: { position: Position }) {
  const m = moic(p);

  return (
    <>
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
      <KvCard
        label="Invested"
        value={fmtUSD(p.invested, { compact: true })}
        testid="kpi-co-invested"
      />
      <KvCard
        label="Current mark"
        value={fmtUSD(p.currentValue, { compact: true })}
        hint={`${m >= 1 ? "+" : ""}${fmtUSD(p.currentValue - p.invested, { compact: true })} unrealised`}
        testid="kpi-co-mark"
        accent
      />
      <KvCard
        label="Ownership"
        value={fmtPct(p.ownershipPct, 2)}
        testid="kpi-co-ownership"
      />
      <KvCard
        label="Position type"
        value={instrumentLabel(p.instrument)}
        hint={p.series}
        testid="kpi-co-instrument"
      />
      <KvCard
        label="Vintage"
        value={String(p.vintageYear)}
        testid="kpi-co-vintage"
      />
      <KvCard
        label="IRR"
        value={IRR_SUPPRESSED_DISPLAY}
        hint={p.lastRoundLabel}
        testid="kpi-co-irr"
      />
    </div>
    {/* XT-C4 — a SIBLING element, deliberately not appended inside the card's
        existing text node: the silent-drop guard reads an edit inside a text node
        as one removal plus one addition. */}
    <div
      className="text-[10px] text-muted-foreground mt-2"
      data-testid="note-co-irr-suppressed"
    >
      {IRR_SUPPRESSED_REASON}
    </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Founder updates feed                                                */
/* ------------------------------------------------------------------ */

function FounderUpdatesFeed({ companyId }: { companyId: string }) {
  const updates = useQuery<FounderUpdate[]>({
    queryKey: ["/api/investor/companies", companyId, "updates"],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/investor/companies/${companyId}/updates`,
      );
      return res.json();
    },
    enabled: !!companyId,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="w-4 h-4" /> Updates from founder
        </CardTitle>
      </CardHeader>
      <CardContent>
        {updates.isLoading && (
          <div className="text-sm text-muted-foreground">Loading updates…</div>
        )}
        {!updates.isLoading && (updates.data ?? []).length === 0 && (
          <div className="text-sm text-muted-foreground">
            No updates yet. Founder reports sent to you will appear here.
          </div>
        )}
        <div className="space-y-2">
          {(updates.data ?? []).map((u) => (
            <div
              key={u.id}
              className="p-3 rounded-md border border-border hover:bg-slate-50"
              data-testid={`update-${u.id}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">{u.title}</span>
                <Badge variant="outline" className="text-[10px]">
                  {u.template.replace("_", " ")}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {u.period}
                {u.sentAt && (
                  <> · Sent {new Date(u.sentAt).toLocaleDateString()}</>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Mark history chart                                                  */
/* ------------------------------------------------------------------ */

function MarkHistoryChart({ companyId }: { companyId: string }) {
  const marksQ = useQuery<MarkHistory>({
    queryKey: ["/api/investor/portfolio", companyId, "marks"],
    enabled: !!companyId,
  });

  const marks = marksQ.data?.marks ?? [];
  const currency = marksQ.data?.currency ?? null;
  const reason = marksQ.data?.unavailableReason ?? null;

  /* Rule 5 — the axis and the tooltip render through `formatMinor` with the
   * currency the SERVER sent. The previous chart called `fmtUSD` on every
   * point, which stamps a dollar sign on a figure that may be neither dollars
   * nor 2-decimal: a ¥900,000 mark (JPY, exponent 0) rendered as "$9,000.00",
   * wrong by 100× and mislabelled. `formatMinorOrUnavailable` also refuses to
   * print "$0.00" for an absent number. */
  const fmtAxis = (minor: number) =>
    formatMinorOrUnavailable(minor, currency, { placeholder: "—" });

  /* WAVE 36 · ROW 10 — the tooltip. The chart used the default Recharts
     tooltip, which shows the value and the date and nothing else, so a mark
     four years old and a GP's manual restatement carried exactly the same
     visual authority as a fresh priced-round NAV. `MarkPoint` has always
     carried `overrideId` / `overrideReason` / `originalFairValueMinor`, and
     now also the SERVER's `badge` and `ageDays`; the tooltip was simply
     throwing them away. Nothing here recomputes staleness — the thresholds are
     DB-driven and the verdict is the server's. */
  const thresholds = marksQ.data?.markThresholds ?? null;
  const byDate = new Map(marks.map((m) => [m.valuationDate, m]));

  const badgeCopy = (m: MarkPoint): { label: string; explain: string } | null => {
    if (m.badge === "expired") {
      return {
        label: "Expired",
        explain: thresholds
          ? `${m.ageDays} days old — at or past the ${thresholds.staleExpiredDays}-day expiry the platform is configured with.`
          : `${m.ageDays ?? "?"} days old — past the configured expiry.`,
      };
    }
    if (m.badge === "stale") {
      return {
        label: "Stale",
        explain: thresholds
          ? `${m.ageDays} days old — at or past the ${thresholds.staleWarnDays}-day staleness threshold the platform is configured with.`
          : `${m.ageDays ?? "?"} days old — past the configured staleness threshold.`,
      };
    }
    if (m.badge === "unmarked") {
      /* The server could not read the thresholds. It says so rather than
         calling the mark fresh, and so does this. */
      return { label: "Age not assessed", explain: "The staleness thresholds could not be read, so this mark has not been assessed." };
    }
    return null;
  };

  function MarkTooltip({ active, label }: { active?: boolean; label?: string | number }) {
    if (!active) return null;
    const m = byDate.get(String(label ?? ""));
    if (!m) return null;
    const badge = badgeCopy(m);
    return (
      <div className="rounded-md border border-border bg-white p-2 text-xs shadow-sm" data-testid="mark-history-tooltip">
        <div className="font-medium" data-testid="mark-history-tooltip-value">{fmtAxis(m.fairValueMinor)}</div>
        <div className="text-muted-foreground">{m.valuationDate}</div>

        {badge && (
          <div className="mt-1" data-testid="mark-history-tooltip-staleness">
            <Badge variant="outline" className="text-[10px]">{badge.label}</Badge>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{badge.explain}</div>
          </div>
        )}

        {m.overrideId && (
          <div className="mt-1" data-testid="mark-history-tooltip-override">
            <Badge variant="outline" className="text-[10px]">GP override</Badge>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              This figure was set manually by the GP, not derived from a priced round.
              {m.overrideReason ? ` Reason: ${m.overrideReason}` : " No reason was recorded."}
            </div>
            {m.originalFairValueMinor != null && (
              /* What the valuation event itself said, so the reader can see the
                 size of the restatement rather than only its result. */
              <div className="text-[11px] text-muted-foreground" data-testid="mark-history-tooltip-override-original">
                Originally {fmtAxis(m.originalFairValueMinor)}.
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Mark history</CardTitle>
      </CardHeader>
      <CardContent>
        {reason === "MARKS_SPAN_CURRENCIES" ? (
          /* NOT an empty state. Marks EXIST; they are denominated in more than
           * one currency, so no single comparable series can be drawn and none
           * is invented. A line chart is an implicit comparison of its points,
           * so plotting ¥ beside $ would be a lie told by the y-axis — and it
           * would look entirely normal, which is what makes it dangerous. The
           * refusal is RENDERED (rule 5: nulls not zeros, with a rendered
           * refusal), never swallowed. */
          <div
            className="h-32 flex items-center justify-center text-center text-sm text-muted-foreground border border-dashed border-border rounded-md px-4"
            data-testid="mark-history-mixed-currency"
          >
            Marks for this company are recorded in more than one currency. No
            combined series is shown, because comparing them would require an
            exchange rate this platform does not hold.
          </div>
        ) : reason === "MARKS_UNAVAILABLE" ? (
          <div
            className="h-32 flex items-center justify-center text-center text-sm text-muted-foreground border border-dashed border-border rounded-md px-4"
            data-testid="mark-history-unavailable"
          >
            Mark history is temporarily unavailable.
          </div>
        ) : marks.length === 0 ? (
          <div className="h-32 flex items-center justify-center text-sm text-muted-foreground border border-dashed border-border rounded-md">
            No mark history yet. Historical mark data appears here once recorded
            by the founder.
          </div>
        ) : (
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={marks.map((m) => ({
                  month: m.valuationDate,
                  value: m.fairValueMinor,
                }))}
              >
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis
                  tickFormatter={(v) => fmtAxis(v as number)}
                  tick={{ fontSize: 10 }}
                />
                {/* WAVE 36 · ROW 10 — the custom tooltip replaces a formatter
                    that could only ever render the bare number. */}
                <RTooltip content={<MarkTooltip />} />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="hsl(0 100% 40%)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Pro-rata calculator (scoped to single company)                      */
/* ------------------------------------------------------------------ */

function ProRataCard({ position: p }: { position: Position }) {
  const [newPreMoneyM, setNewPreMoneyM] = useState<number>(40);
  const [newRoundM, setNewRoundM] = useState<number>(8);

  const result = useMemo(() => {
    // Sprint 20 defect 36 fix: normalize ownershipPct (0-100) to fraction ONCE.
    const ownershipFrac = p.ownershipPct / 100;
    const newPostMoney = newPreMoneyM + newRoundM;
    const newSharesIssuedFrac = newRoundM / newPostMoney;
    const ownershipAfterNoFollowOnFrac = ownershipFrac * (1 - newSharesIssuedFrac);
    const proRataCheckUsd = Math.max(0, ownershipFrac * newRoundM * 1_000_000);
    return {
      newPostMoney,
      dilutionPct: newSharesIssuedFrac * 100,
      ownershipAfterNoFollowOnPct: ownershipAfterNoFollowOnFrac * 100,
      proRataCheckUsd,
      pricePerShareImplied:
        p.shares > 0
          ? (newPostMoney * 1_000_000 * ownershipFrac) / p.shares
          : null,
    };
  }, [p, newPreMoneyM, newRoundM]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Calculator className="w-4 h-4" /> Pro-rata calculator
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label>New pre-money ($M)</Label>
            <Input
              type="number"
              min={1}
              value={newPreMoneyM}
              onChange={(e) => setNewPreMoneyM(Number(e.target.value) || 0)}
              data-testid="input-co-pre-money"
            />
          </div>
          <div>
            <Label>New round size ($M)</Label>
            <Input
              type="number"
              min={1}
              value={newRoundM}
              onChange={(e) => setNewRoundM(Number(e.target.value) || 0)}
              data-testid="input-co-round-size"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KvCard
            label="Current ownership"
            value={fmtPct(p.ownershipPct, 2)}
            testid="kv-co-current-own"
          />
          <KvCard
            label="Post-money"
            value={`$${result.newPostMoney.toLocaleString("en-US")}M`}
            testid="kv-co-post"
          />
          <KvCard
            label="Dilution if no follow-on"
            value={fmtPct(result.dilutionPct, 2)}
            testid="kv-co-dilution"
          />
          <KvCard
            label="Pro-rata check to hold"
            value={fmtUSD(result.proRataCheckUsd, { compact: true })}
            hint={`Approx. ${fmtUSD(result.proRataCheckUsd)}`}
            testid="kv-co-check"
            accent
          />
        </div>

        <p className="text-xs text-muted-foreground">
          Math:{" "}
          <code>proRataCheck = (ownership / 100) × roundSize × 1,000,000</code>
          . Ownership normalised to fraction space; result displayed in dollars.
        </p>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Anti-dilution calculator (scoped to single company)                */
/* ------------------------------------------------------------------ */

function AntiDilutionCard({ position: p }: { position: Position }) {
  void p; // reserved — used to pre-fill defaults if desired

  const [cpOld, setCpOld] = useState<number>(1.0);
  const [cso, setCso] = useState<number>(10_000_000);
  const [ccp, setCcp] = useState<number>(500_000);
  const [ncm, setNcm] = useState<number>(2_000_000);

  const cpNew = useMemo(
    () => broadBasedWeightedAverage({ cpOld, cso, ccp, ncm }),
    [cpOld, cso, ccp, ncm],
  );
  const adjustmentPct = cpOld > 0 ? ((cpNew - cpOld) / cpOld) * 100 : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Calculator className="w-4 h-4" /> Anti-dilution calculator
          <span className="text-xs font-normal text-muted-foreground ml-2">
            Broad-based weighted average
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Formula:{" "}
          <code>CP_new = CP_old × (CSO + CCP) / (CSO + NCM / CP_old)</code>
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <Label>CP_old</Label>
            <Input
              type="number"
              min={0.01}
              step={0.01}
              value={cpOld}
              onChange={(e) => setCpOld(Number(e.target.value))}
              className="mt-1"
              data-testid="input-co-cp-old"
            />
          </div>
          <div>
            <Label>CSO (common shares)</Label>
            <Input
              type="number"
              min={1}
              value={cso}
              onChange={(e) => setCso(Number(e.target.value))}
              className="mt-1"
              data-testid="input-co-cso"
            />
          </div>
          <div>
            <Label>CCP (new shares)</Label>
            <Input
              type="number"
              min={0}
              value={ccp}
              onChange={(e) => setCcp(Number(e.target.value))}
              className="mt-1"
              data-testid="input-co-ccp"
            />
          </div>
          <div>
            <Label>NCM (new consideration $)</Label>
            <Input
              type="number"
              min={0}
              value={ncm}
              onChange={(e) => setNcm(Number(e.target.value))}
              className="mt-1"
              data-testid="input-co-ncm"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <KvCard
            label="CP_old"
            value={`$${cpOld.toFixed(4)}`}
            testid="kv-co-cp-old"
          />
          <KvCard
            label="CP_new (adjusted)"
            value={`$${cpNew.toFixed(4)}`}
            testid="kv-co-cp-new"
            accent
          />
          <KvCard
            label="Adjustment"
            value={`${adjustmentPct >= 0 ? "+" : ""}${adjustmentPct.toFixed(2)}%`}
            testid="kv-co-adjustment"
          />
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Tax card                                                            */
/* ------------------------------------------------------------------ */

function TaxCard({ companyId }: { companyId: string }) {
  const { toast } = useToast();
  const taxQ = useQuery<{ available: boolean; message: string; downloadUrl?: string }>({
    queryKey: ["/api/investor/portfolio/tax", companyId],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/investor/portfolio/tax/download?companyId=${encodeURIComponent(companyId)}`,
      );
      return res.json();
    },
    retry: false,
  });

  // DEF-012: Use mutation for tax request instead of toast-only
  const taxRequestMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/investor/portfolio/tax/request", {
        companyId,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: (data: { requested: boolean; eta?: string }) => {
      toast({
        title: "Tax export requested",
        description: data.eta
          ? `Expected within ${data.eta}.`
          : "We’ll notify you when documents are ready.",
      });
    },
    onError: (e: Error) => {
      toast({
        title: "Request failed",
        description: e.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Briefcase className="w-4 h-4" /> Tax &amp; 1099 documents
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {taxQ.isLoading && (
          <div className="text-sm text-muted-foreground">
            Checking tax document availability…
          </div>
        )}
        {!taxQ.isLoading && taxQ.data && !taxQ.data.available && (
          <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900/40 px-4 py-3">
            <div className="text-sm font-medium text-amber-900 dark:text-amber-200">
              Tax exports not yet available
            </div>
            <div className="text-xs text-amber-800/80 dark:text-amber-200/80 mt-1">
              {taxQ.data.message}
            </div>
          </div>
        )}
        {/* DEF-013: Append companyId to download URL */}
        {!taxQ.isLoading && taxQ.data?.available && (
          <a
            href={`${taxQ.data.downloadUrl ?? "/api/investor/portfolio/tax/download"}?companyId=${encodeURIComponent(companyId)}`}
            download
            className="inline-flex items-center gap-2 text-sm font-medium underline underline-offset-4"
            data-testid="link-co-tax-download"
          >
            Download 1099 / K-1 package
          </a>
        )}
        <Button
          variant="outline"
          data-testid="button-co-tax-request"
          disabled={taxRequestMut.isPending}
          onClick={() => taxRequestMut.mutate()}
        >
          {taxRequestMut.isPending ? "Requesting…" : "Request tax documents"}
        </Button>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Promotion status badge                                              */
/* ------------------------------------------------------------------ */

function PromotionBadge({ promotedAt }: { promotedAt: string }) {
  return (
    <Badge
      className="bg-primary/10 text-primary border-primary/30"
      variant="outline"
      data-testid="badge-promoted"
    >
      <CheckCircle2 className="w-3 h-3 mr-1" />
      Promoted on {new Date(promotedAt).toLocaleDateString()}
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/* Main PortfolioCompanyOverview                                       */
/* ------------------------------------------------------------------ */

interface PortfolioCompanyOverviewProps {
  companyId: string;
}

export function PortfolioCompanyOverview({
  companyId,
}: PortfolioCompanyOverviewProps) {
  useRealtimeSync();

  // DEF-047: Subscribe to collective_nomination events to refresh promotion badge in realtime
  useEffect(() => {
    return subscribeToMutation("collective_nomination", () => {
      queryClient.invalidateQueries({ queryKey: ["/api/investor/companies", companyId, "promotion-status"] });
    });
  }, [companyId]);
  const [promoteOpen, setPromoteOpen] = useState(false);

  // Load all positions to find the active one
  const positions = useQuery<Position[]>({
    queryKey: ["/api/investor/portfolio2"],
  });

  // Promotion status query
  const promotionStatus = useQuery<PromotionStatus>({
    queryKey: ["/api/investor/companies", companyId, "promotion-status"],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/investor/companies/${companyId}/promotion-status`,
      );
      return res.json();
    },
    enabled: !!companyId,
  });

  const position = (positions.data ?? []).find(
    (p) => p.companyId === companyId,
  );

  if (positions.isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-32 rounded-lg bg-muted animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (!position) {
    return (
      <Card>
        <CardContent className="pt-12 pb-12 text-center text-sm text-muted-foreground">
          Company data not found.
        </CardContent>
      </Card>
    );
  }

  const alreadyPromoted = !!promotionStatus.data;
  const promotedAt = promotionStatus.data?.submittedAt ?? null;

  return (
    <div className="space-y-6" data-testid="portfolio-company-overview">
      {/* Header row: company name + action buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{position.company}</h2>
          <p className="text-sm text-muted-foreground">
            {position.sector} · {position.stage}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {alreadyPromoted && promotedAt && (
            <PromotionBadge promotedAt={promotedAt} />
          )}

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    className="bg-primary hover:bg-primary/90"
                    onClick={() => !alreadyPromoted && setPromoteOpen(true)}
                    disabled={alreadyPromoted}
                    data-testid="button-promote-open"
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    Promote to Capavate Collective
                  </Button>
                </span>
              </TooltipTrigger>
              {alreadyPromoted && promotedAt && (
                <TooltipContent>
                  You already promoted this company on{" "}
                  {new Date(promotedAt).toLocaleDateString()}
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>

          <Button variant="outline" data-testid="button-view-company-detail" asChild>
            <Link href={`/investor/companies/${position.companyId}`}>
              View company detail{" "}
              <ArrowUpRight className="w-4 h-4 ml-1" />
            </Link>
          </Button>
        </div>
      </div>

      {/* Per-company KPIs */}
      <CompanyKpiStrip position={position} />

      {/* Two-column layout for updates + marks */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <FounderUpdatesFeed companyId={companyId} />
        <MarkHistoryChart companyId={companyId} />
      </div>

      {/* Calculators */}
      <ProRataCard position={position} />
      <AntiDilutionCard position={position} />

      {/* Tax */}
      <TaxCard companyId={companyId} />

      {/* Promote dialog */}
      <PromoteToCollectiveDialog
        companyId={companyId}
        companyName={position.company}
        open={promoteOpen}
        onOpenChange={setPromoteOpen}
      />
    </div>
  );
}
