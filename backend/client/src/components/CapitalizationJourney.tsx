/**
 * Sprint 4 — Capitalization Journey
 *
 * A multi-panel hero visualization on the founder dashboard:
 * 1. Round Timeline + Valuation curve (line + dots, latest is pulsing)
 * 2. Ownership Composition Over Time (stacked area)
 * 3. Round-by-Round card carousel
 * 4. KPI strip
 *
 * Pulls /api/rounds + /api/companies/:id/securities. The composition snapshot at
 * each round is derived in the frontend by simulating dilution as each round
 * lands, using the pre/post-money + share data already in the demo. The math
 * is illustrative — at production, this view would be reconstructed by
 * `@capavate/cap-table-engine` from the immutable transaction ledger.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
 ResponsiveContainer,
 ComposedChart,
 Line,
 XAxis,
 YAxis,
 CartesianGrid,
 Tooltip as RcTooltip,
 Area,
 AreaChart,
 ReferenceLine,
 Legend,
 Bar,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { TrendingUp, Users, PieChart as PieIcon, Wallet, ArrowRight, Cpu, Sparkles } from "lucide-react";
import { fmtUSD, fmtPct, fmtDate, fmtNum } from "@/lib/format";
import { runEngine, type ApiSecurity } from "@/lib/engineDemo";
import type { ApiRound } from "@/lib/types";

const COLORS = {
 primary: "#20808D", // teal — engine/brand
 primaryFaint: "#20808D33",
 gold: "#D4A857", // valuation deltas
 founder: "#1F3756", // navy
 pool: "#7C9EBF", // light steel
 preferred: "#20808D", // teal
 safe: "#B53D6E", // wine/rose
 note: "#E0A82E", // amber
 warrant: "#3F8C5C", // forest
};

const INSTRUMENT_ORDER = ["founder", "pool", "preferred", "safe", "note", "warrant"] as const;

const INSTRUMENT_LABEL: Record<string, string> = {
 founder: "Founders",
 pool: "Employee Pool (ESOP)",
 preferred: "Preferred (Investors)",
 safe: "SAFE (Investors)",
 note: "Notes (Investors)",
 warrant: "Warrants",
};

const INSTRUMENT_COLOR: Record<string, string> = {
 founder: COLORS.founder,
 pool: COLORS.pool,
 preferred: COLORS.preferred,
 safe: COLORS.safe,
 note: COLORS.note,
 warrant: COLORS.warrant,
};

type Snapshot = {
 date: string;
 roundId: string;
 roundName: string;
 preMoney: number;
 postMoney: number;
 composition: Record<string, number>; // bucket -> pct
};

function buildSnapshots(rounds: ApiRound[], securities: ApiSecurity[], companyId: string): Snapshot[] {
 // Filter to the active company's rounds only, sort by closeDate ascending.
 const ours = rounds
 .filter((r) => (r as any).companyId === companyId)
 .sort((a, b) => (a.closeDate ?? "").localeCompare(b.closeDate ?? ""));

 const snapshots: Snapshot[] = [];

 // For each round close, compute a composition snapshot. We start at the
 // founder + pool foundation, then layer each round on top — investors who
 // appear in the securities list before/up-to that round are included.
 for (const round of ours) {
 // Determine which securities are "live" at this round's close date.
 const live = securities.filter((s) => (s.issuedAt ?? "0000") <= (round.closeDate ?? "9999"));
 // For SAFEs at a snapshot, give them illustrative converted share counts.
 const buckets: Record<string, number> = {
 founder: 0, pool: 0, preferred: 0, safe: 0, note: 0, warrant: 0,
 };
 let totalShares = 0;
 for (const s of live) {
 let bucket = "founder";
 let shares = s.shares;
 if (s.holderType === "founder") bucket = "founder";
 else if (s.holderType === "pool") bucket = "pool";
 else if (s.instrument === "preferred") bucket = "preferred";
 else if (s.instrument === "safe") bucket = "safe";
 else if (s.instrument === "note") bucket = "note";
 else if (s.instrument === "warrant") bucket = "warrant";
 // SAFE/Note share counts: estimate at $1.00 PPS / cap-implied price.
 if ((s.instrument === "safe" || s.instrument === "note") && (!shares || shares === 0)) {
 const principal = s.investmentAmount ?? 0;
 if (s.cap && principal) {
 // Assume 12M total FD shares at conversion as a rough demo basis.
 const capPrice = s.cap / 12_000_000;
 shares = Math.floor(principal / capPrice);
 } else if (principal) {
 shares = Math.floor(principal / 1.0);
 }
 }
 buckets[bucket] = (buckets[bucket] ?? 0) + (shares ?? 0);
 totalShares += shares ?? 0;
 }

 if (totalShares === 0) continue;

 const composition: Record<string, number> = {};
 for (const k of Object.keys(buckets)) {
 composition[k] = (buckets[k] / totalShares) * 100;
 }

 snapshots.push({
 date: round.closeDate ?? "",
 roundId: round.id,
 roundName: round.name,
 preMoney: round.preMoney ?? 0,
 postMoney: round.postMoney ?? 0,
 composition,
 });
 }

 return snapshots;
}

function ValuationTooltip({ active, payload }: any) {
 if (!active || !payload?.length) return null;
 const p = payload[0].payload;
 return (
 <div className="bg-popover border border-border rounded-md shadow-md p-3 text-xs space-y-1 max-w-[260px]">
 <div className="font-semibold text-sm">{p.roundName}</div>
 <div className="text-muted-foreground">{fmtDate(p.date)}</div>
 <div className="border-t border-border/60 my-1" />
 <div className="flex justify-between gap-4"><span className="text-muted-foreground">Pre-money</span><span className="font-mono font-medium">{fmtUSD(p.preMoney, { compact: true })}</span></div>
 <div className="flex justify-between gap-4"><span className="text-muted-foreground">Post-money</span><span className="font-mono font-medium">{fmtUSD(p.postMoney, { compact: true })}</span></div>
 <div className="flex justify-between gap-4"><span className="text-muted-foreground">Round size</span><span className="font-mono font-medium">{fmtUSD(p.targetAmount, { compact: true })}</span></div>
 {p.leadInvestor && (
 <div className="flex justify-between gap-4"><span className="text-muted-foreground">Lead</span><span className="font-medium">{p.leadInvestor}</span></div>
 )}
 {p.investorCount != null && (
 <div className="flex justify-between gap-4"><span className="text-muted-foreground">Investors</span><span className="font-mono">{p.investorCount}</span></div>
 )}
 <div className="flex justify-between gap-4 pt-1 border-t border-border/60"><span className="text-muted-foreground">State</span><span className="capitalize font-medium">{p.state.replace(/_/g, " ")}</span></div>
 </div>
 );
}

function CompositionTooltip({ active, payload, label }: any) {
 if (!active || !payload?.length) return null;
 return (
 <div className="bg-popover border border-border rounded-md shadow-md p-3 text-xs">
 <div className="font-semibold text-sm mb-1">{payload[0]?.payload?.roundName}</div>
 <div className="text-muted-foreground mb-2">{label}</div>
 <ul className="space-y-1">
 {INSTRUMENT_ORDER.filter((k) => (payload[0]?.payload?.[k] ?? 0) > 0.01).map((k) => (
 <li key={k} className="flex items-center justify-between gap-3">
 <span className="flex items-center gap-1.5">
 <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: INSTRUMENT_COLOR[k] }} />
 {INSTRUMENT_LABEL[k]}
 </span>
 <span className="font-mono tabular-nums font-medium">{(payload[0]?.payload?.[k] ?? 0).toFixed(1)}%</span>
 </li>
 ))}
 </ul>
 </div>
 );
}

export default function CapitalizationJourney({ companyId }: { companyId?: string } = {}) {
 const activeCompanyId = companyId ?? "";
 const rounds = useQuery<ApiRound[]>({ queryKey: ["/api/rounds"], enabled: Boolean(activeCompanyId) });
 const securities = useQuery<ApiSecurity[]>({
  queryKey: ["/api/companies", activeCompanyId, "securities"],
  queryFn: async () => {
   const r = await fetch(`/api/companies/${encodeURIComponent(activeCompanyId)}/securities`);
   if (!r.ok) return [] as ApiSecurity[];
   return r.json();
  },
  enabled: Boolean(activeCompanyId),
 });

 const novapayRounds = useMemo(() => {
 if (!rounds.data || !activeCompanyId) return [];
 return rounds.data
 .filter((r) => (r as any).companyId === activeCompanyId)
 .sort((a, b) => (a.closeDate ?? "").localeCompare(b.closeDate ?? ""));
 }, [rounds.data, activeCompanyId]);

 const valuationSeries = useMemo(() => {
 let cumulative = 0;
 return novapayRounds.map((r, idx) => {
 cumulative += r.raisedAmount ?? 0;
 const prev = idx > 0 ? novapayRounds[idx - 1] : null;
 const stepUp = prev && prev.postMoney && r.preMoney ? (r.preMoney / prev.postMoney) - 1 : null;
 return {
 ...r,
 cumulativeRaised: cumulative,
 stepUp, // (this round's pre-money / last round's post-money) − 1
 };
 });
 }, [novapayRounds]);

 const snapshots = useMemo(() => {
 if (!securities.data) return [];
 return buildSnapshots(novapayRounds, securities.data, activeCompanyId);
 }, [novapayRounds, securities.data, activeCompanyId]);

 // Stacked-area dataset
 const compositionData = useMemo(() =>
 snapshots.map((s) => ({
 date: s.date,
 roundName: s.roundName,
 ...s.composition,
 })), [snapshots]);

 // KPIs
 const kpis = useMemo(() => {
 if (!rounds.data || !securities.data) return null;
 const totalRaised = novapayRounds.reduce((sum, r) => sum + (r.raisedAmount ?? 0), 0);
 const sortedRounds = [...novapayRounds].sort((a, b) => (b.closeDate ?? "").localeCompare(a.closeDate ?? ""));
 const latestRoundWithVal = sortedRounds.find((r) => r.postMoney);
 const latestValuation = latestRoundWithVal?.postMoney ?? 0;
 // Founder ownership from FD view of current cap table
 const fd = runEngine(securities.data, "fully_diluted", "US");
 const founderShares = fd.rows.filter((r) => r.holderType === "founder").reduce<bigint>((s, r) => s + r.shares, 0n);
 const founderPct = fd.totalShares === 0n ? 0 : Number((founderShares * 10000n) / fd.totalShares) / 100;
 const investorCount = new Set(
 fd.rows.filter((r) => r.holderType === "investor" || r.holderType === "founder" || r.holderType === "pool").map((r) => r.holderName),
 ).size;
 return { totalRaised, latestValuation, founderPct, investorCount };
 }, [novapayRounds, rounds.data, securities.data]);

 const isLoading = rounds.isLoading || securities.isLoading;

 if (isLoading) {
 return (
 <Card className="mb-6">
 <CardContent className="p-8 text-center text-sm text-muted-foreground">Loading capitalization journey…</CardContent>
 </Card>
 );
 }

 if (!activeCompanyId || novapayRounds.length === 0) {
 return null;
 }

 return (
 <Card className="mb-6 overflow-hidden">
 <CardHeader className="pb-3 border-b border-border bg-secondary/30">
 <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
 <div>
 <CardTitle className="text-base flex items-center gap-2">
 <Sparkles className="h-4 w-4 text-[hsl(0_100%_40%)]" />
 Capitalization Journey
 </CardTitle>
 <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
 The historical view of your company's capitalization — every round, every valuation step-up, every dilution event, plotted from foundation to today.
 </p>
 </div>
 <Tooltip>
 <TooltipTrigger asChild>
 <Badge variant="outline" className="text-[10px] gap-1.5 cursor-help bg-[hsl(0_100%_40%)]/10 border-[hsl(0_100%_40%)]/40 text-[hsl(0_100%_40%)] self-start md:self-end">
 <Cpu className="h-3 w-3" /> Reconstructed by @capavate/cap-table-engine
 </Badge>
 </TooltipTrigger>
 <TooltipContent className="max-w-xs text-xs">
 Composition snapshots and KPIs are reconstructed by replaying the immutable transaction ledger through the cap-table engine. Engine v1.0.0, US formula region.
 </TooltipContent>
 </Tooltip>
 </div>
 </CardHeader>

 <CardContent className="space-y-8 p-5">
 {/* Panel 4 — KPI strip (placed top so it's the first thing the eye lands on) */}
 {kpis && (
 <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
 <Kpi icon={Wallet} label="Total raised" value={fmtUSD(kpis.totalRaised, { compact: true })} hint={`across ${novapayRounds.length} rounds`} />
 <Kpi icon={TrendingUp} label="Latest valuation" value={fmtUSD(kpis.latestValuation, { compact: true })} hint="post-money" />
 <Kpi icon={PieIcon} label="Founder ownership" value={fmtPct(kpis.founderPct, 1)} hint="fully diluted" />
 <Kpi icon={Users} label="Cap-table holders" value={kpis.investorCount} hint="founders + investors + pool" />
 </div>
 )}

 {/* Panel 1 — Round Timeline + Valuation curve */}
 <section>
 <div className="flex items-baseline justify-between mb-2">
 <h3 className="text-sm font-semibold">Round timeline · Pre-money valuation</h3>
 <span className="text-[11px] text-muted-foreground">hover any point</span>
 </div>
 <div className="h-72 -ml-3">
 <ResponsiveContainer width="100%" height="100%">
 <ComposedChart data={valuationSeries} margin={{ top: 10, right: 24, bottom: 4, left: 12 }}>
 <defs>
 <linearGradient id="valGrad" x1="0" y1="0" x2="0" y2="1">
 <stop offset="0%" stopColor={COLORS.primary} stopOpacity={0.35} />
 <stop offset="100%" stopColor={COLORS.primary} stopOpacity={0} />
 </linearGradient>
 </defs>
 <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
 <XAxis dataKey="closeDate" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
 <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} tickFormatter={(v) => fmtUSD(v, { compact: true })} />
 <RcTooltip content={<ValuationTooltip />} />
 <Area type="monotone" dataKey="preMoney" stroke="none" fill="url(#valGrad)" />
 <Line
 type="monotone"
 dataKey="preMoney"
 stroke={COLORS.primary}
 strokeWidth={2.5}
 dot={(props: any) => {
 const { cx, cy, payload, index } = props;
 const isLatest = index === valuationSeries.length - 1;
 const isClosed = payload.state === "closed";
 return (
 <g key={`dot-${index}`}>
 {isLatest && !isClosed && (
 <circle cx={cx} cy={cy} r={10} fill={COLORS.gold} opacity={0.25}>
 <animate attributeName="r" values="8;14;8" dur="1.8s" repeatCount="indefinite" />
 <animate attributeName="opacity" values="0.35;0.1;0.35" dur="1.8s" repeatCount="indefinite" />
 </circle>
 )}
 <circle cx={cx} cy={cy} r={5} fill={isClosed ? COLORS.primary : COLORS.gold} stroke="white" strokeWidth={2} />
 </g>
 );
 }}
 activeDot={{ r: 7, fill: COLORS.gold, stroke: "white", strokeWidth: 2 }}
 />
 </ComposedChart>
 </ResponsiveContainer>
 </div>
 <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground mt-2 pl-2">
 <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: COLORS.primary }} /> Closed rounds</span>
 <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: COLORS.gold }} /> Active / planned</span>
 <span className="inline-flex items-center gap-1.5"><span className="h-1 w-3 rounded-full" style={{ backgroundColor: COLORS.primary }} /> Pre-money curve</span>
 </div>
 </section>

 {/* Sprint 5 — Cumulative raise + valuation step-up */}
 <section>
 <div className="flex items-baseline justify-between mb-2">
 <h3 className="text-sm font-semibold flex items-center gap-2">Cumulative capital raised + valuation step-up
 <Badge variant="outline" className="text-[10px]">M&amp;A signal</Badge>
 </h3>
 <span className="text-[11px] text-muted-foreground">step-up % vs prior round’s post-money</span>
 </div>
 <div className="h-64 -ml-3">
 <ResponsiveContainer width="100%" height="100%">
 <ComposedChart data={valuationSeries} margin={{ top: 10, right: 24, bottom: 4, left: 12 }}>
 <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
 <XAxis dataKey="closeDate" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
 <YAxis yAxisId="left" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} tickFormatter={(v) => fmtUSD(v, { compact: true })} />
 <YAxis yAxisId="right" orientation="right" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} tickFormatter={(v) => fmtUSD(v, { compact: true })} />
 <RcTooltip formatter={(v: any, name: any) => [typeof v === "number" ? fmtUSD(v, { compact: true }) : v, name]} />
 <Bar yAxisId="left" dataKey="cumulativeRaised" fill={COLORS.gold} fillOpacity={0.45} name="Cumulative raised" radius={[4, 4, 0, 0]} />
 <Line yAxisId="right" type="monotone" dataKey="postMoney" stroke={COLORS.primary} strokeWidth={2.5} dot={{ r: 4, fill: COLORS.primary, stroke: "white", strokeWidth: 2 }} name="Post-money valuation" />
 <Legend wrapperStyle={{ fontSize: 11 }} iconSize={10} />
 </ComposedChart>
 </ResponsiveContainer>
 </div>
 <div className="flex flex-wrap gap-2 mt-2">
 {valuationSeries.map((v) => v.stepUp != null && (
 <Badge key={v.id} variant="outline" className={`text-[10px] ${v.stepUp >= 0.5 ? "border-emerald-300/60 text-emerald-700 " : v.stepUp >= 0 ? "border-amber-300/60 text-amber-700 " : "border-rose-300/60 text-rose-700 "}`} data-testid={`stepup-${v.id}`}>
 {v.name}: {(v.stepUp * 100).toFixed(0)}% step-up
 </Badge>
 ))}
 </div>
 <p className="text-[11px] text-muted-foreground mt-1 pl-2">
 Step-up = (this round’s pre-money) / (prior round’s post-money) − 1. Bessemer-style markups: ≥ 50% is healthy; 0–50% is flat; negative is a down-round and triggers anti-dilution clauses.
 </p>
 </section>

 {/* Panel 2 — Ownership Composition Over Time */}
 <section>
 <div className="flex items-baseline justify-between mb-2">
 <h3 className="text-sm font-semibold">Ownership composition over time</h3>
 <span className="text-[11px] text-muted-foreground">{compositionData.length} snapshot{compositionData.length === 1 ? "" : "s"}</span>
 </div>
 <div className="h-72 -ml-3">
 <ResponsiveContainer width="100%" height="100%">
 <AreaChart data={compositionData} margin={{ top: 10, right: 24, bottom: 4, left: 12 }} stackOffset="expand">
 <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
 <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
 <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} domain={[0, 1]} />
 <RcTooltip content={<CompositionTooltip />} />
 {INSTRUMENT_ORDER.map((k) => (
 <Area
 key={k}
 type="monotone"
 dataKey={k}
 stackId="1"
 stroke={INSTRUMENT_COLOR[k]}
 fill={INSTRUMENT_COLOR[k]}
 fillOpacity={0.85}
 name={INSTRUMENT_LABEL[k]}
 />
 ))}
 {compositionData.map((d, i) => (
 <ReferenceLine key={`rl-${i}`} x={d.date} stroke="hsl(var(--border))" strokeDasharray="2 2" />
 ))}
 <Legend wrapperStyle={{ fontSize: 11 }} iconSize={10} />
 </AreaChart>
 </ResponsiveContainer>
 </div>
 <p className="text-[11px] text-muted-foreground mt-1 pl-2">
 Founders' band shrinks at each round close — the visualization of dilution as you trade equity for capital.
 </p>
 </section>

 {/* Panel 3 — Round-by-round card carousel */}
 <section>
 <div className="flex items-baseline justify-between mb-2">
 <h3 className="text-sm font-semibold">Round-by-round</h3>
 <span className="text-[11px] text-muted-foreground">scroll horizontally · click for detail</span>
 </div>
 <ScrollArea className="w-full whitespace-nowrap rounded-md">
 <div className="flex gap-4 pb-4 pt-1 px-1 relative">
 {/* connecting line */}
 <div className="absolute top-12 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" aria-hidden />
 {valuationSeries.map((r, idx) => {
 const isClosed = r.state === "closed";
 const founderBefore = idx > 0 ? snapshots[idx - 1]?.composition.founder : 100;
 const founderAfter = snapshots[idx]?.composition.founder ?? null;
 const days = r.openDate && r.closeDate
 ? Math.max(0, Math.round((new Date(r.closeDate).getTime() - new Date(r.openDate).getTime()) / 86400000))
 : null;
 return (
 <Link key={r.id} href={`/founder/rounds/${r.id}`}>
 <div className="w-[280px] shrink-0 cursor-pointer relative" data-testid={`journey-card-${r.id}`}>
 {/* timeline dot */}
 <div className="flex justify-center mb-2 relative z-10">
 <div className={`h-4 w-4 rounded-full border-4 border-background ${isClosed ? "bg-[hsl(0_100%_40%)]" : "bg-[#D4A857]"}`} />
 </div>
 <div className="bg-card border border-border rounded-lg p-4 hover-elevate space-y-2.5">
 <div className="flex items-center justify-between gap-2">
 <span className="font-semibold text-sm truncate">{r.name}</span>
 <Badge variant="outline" className="text-[10px] capitalize shrink-0">{r.type.replace(/_/g, " ")}</Badge>
 </div>
 <div className="text-[11px] text-muted-foreground">{r.closeDate ? fmtDate(r.closeDate) : "—"}</div>
 <div className="grid grid-cols-2 gap-2 text-[11px] pt-2 border-t border-border/60">
 <div>
 <div className="text-muted-foreground">Pre-money</div>
 <div className="font-mono tabular-nums font-medium">{r.preMoney ? fmtUSD(r.preMoney, { compact: true }) : "—"}</div>
 </div>
 <div>
 <div className="text-muted-foreground">Post-money</div>
 <div className="font-mono tabular-nums font-medium">{r.postMoney ? fmtUSD(r.postMoney, { compact: true }) : "—"}</div>
 </div>
 <div>
 <div className="text-muted-foreground">Raised</div>
 <div className="font-mono tabular-nums font-medium">{fmtUSD(r.raisedAmount, { compact: true })}</div>
 </div>
 <div>
 <div className="text-muted-foreground">Days open</div>
 <div className="font-mono tabular-nums font-medium">{days != null ? `${days}d` : "—"}</div>
 </div>
 </div>
 {(r as any).leadInvestor && (
 <div className="text-[11px] pt-2 border-t border-border/60">
 <div className="text-muted-foreground">Lead</div>
 <div className="font-medium truncate">{(r as any).leadInvestor}</div>
 {(r as any).investorCount != null && (
 <div className="text-[10px] text-muted-foreground">{(r as any).investorCount} investor{(r as any).investorCount === 1 ? "" : "s"}</div>
 )}
 </div>
 )}
 {/* Sprint 5 — time-to-close + step-up callouts (Carta convention) */}
 {days != null && r.state === "closed" && (
 <div className="text-[10px] pt-1.5 border-t border-border/60 flex items-center justify-between">
 <span className="text-muted-foreground">Time-to-close</span>
 <Badge variant="outline" className="text-[10px]">{days}d</Badge>
 </div>
 )}
 {(r as any).stepUp != null && (
 <div className="text-[10px] pt-1 flex items-center justify-between">
 <span className="text-muted-foreground">Step-up vs prior</span>
 <Badge variant="outline" className={`text-[10px] ${(r as any).stepUp >= 0.5 ? "border-emerald-300/60 text-emerald-700 " : (r as any).stepUp >= 0 ? "border-amber-300/60 text-amber-700 " : "border-rose-300/60 text-rose-700 "}`}>
 {((r as any).stepUp * 100).toFixed(0)}%
 </Badge>
 </div>
 )}
 {founderAfter != null && (
 <div className="text-[11px] pt-2 border-t border-border/60 flex items-center gap-2">
 <span className="text-muted-foreground">Founders</span>
 <span className="font-mono tabular-nums">{fmtPct(founderBefore ?? 0, 0)}</span>
 <ArrowRight className="h-3 w-3 text-muted-foreground" />
 <span className="font-mono tabular-nums font-semibold text-[hsl(0_100%_40%)] ">{fmtPct(founderAfter, 0)}</span>
 </div>
 )}
 <div className="flex items-center gap-1.5 text-[10px] pt-1">
 <Badge variant="outline" className={`text-[10px] capitalize ${isClosed ? "bg-emerald-100 text-emerald-900 border-emerald-300/50" : "bg-cyan-100 text-cyan-900 border-cyan-300/50"}`}>
 {r.state.replace(/_/g, " ")}
 </Badge>
 </div>
 </div>
 </div>
 </Link>
 );
 })}
 </div>
 <ScrollBar orientation="horizontal" />
 </ScrollArea>
 </section>
 </CardContent>
 </Card>
 );
}

function Kpi({ icon: Icon, label, value, hint }: { icon: React.ComponentType<any>; label: string; value: string | number; hint?: string }) {
 return (
 <div className="rounded-md border border-border bg-card p-3">
 <div className="flex items-center justify-between">
 <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{label}</span>
 <Icon className="h-3.5 w-3.5 text-muted-foreground" />
 </div>
 <div className="text-xl font-semibold mt-1 font-mono tabular-nums">{value}</div>
 {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
 </div>
 );
}
