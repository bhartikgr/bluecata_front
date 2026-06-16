/**
 * /admin/telemetry — M&A-grade telemetry capture pool.
 *
 * Top KPIs · Funnel · Cohort benchmarks · Event explorer · Signal pool.
 */
import { useMemo, useState } from "react";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Stat } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
 Activity, BarChart3, ShieldCheck, AlertTriangle, Database,
 Search, Filter, Sparkles, TrendingUp, AlertCircle, Flame,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { ApiRound } from "@/lib/types";
import type { ApiSecurity } from "@/lib/engineDemo";
import {
 defaultTelemetryStore, ALL_EVENT_TYPES, defaultBenchmarkStore, useSprint3,
} from "@/lib/sprint3";
import { funnelDropoff } from "@capavate/telemetry";
import { AdminPageIntro } from "@/components/AdminPageIntro";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const SECTORS = ["fintech", "saas", "deeptech", "marketplace", "biotech"];
const STAGES = ["pre_seed", "seed", "series_a", "series_b"];
const REGIONS = ["US", "UK", "CA", "SG", "HK", "CN", "IN", "JP", "AU", "EU"];

export default function AdminTelemetry() {
 // Trigger re-renders on telemetry tick
 useSprint3((s) => s.telemetryTick);
 const events = defaultTelemetryStore.list();

 const stats = useMemo(() => {
 const today = new Date(); today.setHours(0, 0, 0, 0);
 const weekAgo = new Date(today.getTime() - 7 * 24 * 3600 * 1000);
 const eventsToday = events.filter((e) => new Date(e.timestamp) >= today).length;
 const eventsThisWeek = events.filter((e) => new Date(e.timestamp) >= weekAgo).length;
 const chain = defaultTelemetryStore.verifyChain();
 return { eventsToday, eventsThisWeek, total: events.length, chain };
 }, [events]);

 const funnel = useMemo(() => funnelDropoff(events), [events]);

 // Event explorer state
 const [filterType, setFilterType] = useState<string>("__all__");
 const [filterCompany, setFilterCompany] = useState<string>("__all__");
 const [search, setSearch] = useState("");
 const [openEventId, setOpenEventId] = useState<string | null>(null);

 const companies = useMemo(() => {
 const set = new Set(events.map((e) => e.companyId));
 return Array.from(set);
 }, [events]);

 const filteredEvents = useMemo(() => {
 return events.filter((e) => {
 if (filterType !== "__all__" && e.type !== filterType) return false;
 if (filterCompany !== "__all__" && e.companyId !== filterCompany) return false;
 if (search) {
 const hay = JSON.stringify(e).toLowerCase();
 if (!hay.includes(search.toLowerCase())) return false;
 }
 return true;
 });
 }, [events, filterType, filterCompany, search]);

 // Cohort benchmarks state
 const [bSector, setBSector] = useState("fintech");
 const [bStage, setBStage] = useState("seed");
 const [bRegion, setBRegion] = useState("US");
 const benchmarks = defaultBenchmarkStore.getCohortBenchmarks({ sector: bSector, stage: bStage, region: bRegion });

 const allCohorts = defaultBenchmarkStore.listCohorts();

 // Sprint 5 — M&A intelligence widgets data
 const roundsQ = useQuery<ApiRound[]>({ queryKey: ["/api/rounds"] });
 // Pick the first company id from the loaded rounds for the securities pull;
 // if no rounds (fresh tenant), the securities query is disabled and we render empty state.
 const selectedCompanyId = roundsQ.data?.[0]?.companyId ?? "";
 const securitiesQ = useQuery<ApiSecurity[]>({
  queryKey: ["/api/companies", selectedCompanyId, "securities"],
  queryFn: async () => {
   const res = await fetch(`/api/companies/${selectedCompanyId}/securities`);
   if (!res.ok) return [] as ApiSecurity[];
   return res.json();
  },
  enabled: Boolean(selectedCompanyId),
 });

 return (
 <>
 <PageHeader
 title="Telemetry"
 description="Every cap-table action, every round event, every reconciliation — captured immutably with hash chain. Powers M&A intelligence, lifecycle analytics, and benchmark cohorts."
 breadcrumbs={[{ label: "Admin" }, { label: "Telemetry" }]}
 actions={
 stats.chain.valid
 ? <Badge className="bg-emerald-100 text-emerald-900 border-0"><ShieldCheck className="h-3 w-3 mr-1" />Hash chain unbroken</Badge>
 : <Badge className="bg-rose-100 text-rose-900 border-0"><AlertTriangle className="h-3 w-3 mr-1" />Broken at #{stats.chain.brokenAt}</Badge>
 }
 />
 <PageBody>
 <AdminPageIntro
 guidance={{
 eyebrow: "Operational intelligence",
 title: "Telemetry — every action captured immutably, every signal queryable",
 description:
 "Every cap-table change, round-state transition, soft-circle, signing event, and reconciliation outcome is captured into a tamper-evident, hash-chained event log. This page surfaces operational health (events/day, chain integrity), founder fundraising funnel conversion, cohort benchmarks (sector × stage × region), live M&A intelligence widgets, and a raw event explorer for forensic investigation.",
 warning:
 "If the hash chain breaks (status shows 'Broken at #N'), the event store has been tampered with or corrupted. Treat as a P0 incident: freeze writes, snapshot, escalate to security. Do NOT close any rounds while the chain is broken.",
 positive:
 "Cohort benchmarks anonymise telemetry by sector × stage × region (k-anonymity ≥ 5) to give founders honest peer comparisons without ever exposing a single company's identity.",
 }}
 stats={[
 { label: "Events today", value: stats.eventsToday },
 { label: "This week", value: stats.eventsThisWeek },
 { label: "All-time", value: stats.total },
 { label: "Hash chain", value: stats.chain.valid ? "Unbroken" : `Broken @ ${stats.chain.brokenAt}`, tone: stats.chain.valid ? "positive" : "critical" },
 { label: "Cohorts", value: allCohorts.length, hint: "Active benchmark sets" },
 ]}
 />
 <Tabs defaultValue="funnel" className="w-full">
 <TabsList className="mb-4">
 <TabsTrigger value="funnel" data-testid="tab-tel-funnel"><BarChart3 className="h-3.5 w-3.5 mr-1.5" />Funnel & cohorts</TabsTrigger>
 <TabsTrigger value="intelligence" data-testid="tab-tel-intel"><TrendingUp className="h-3.5 w-3.5 mr-1.5" />M&A intelligence</TabsTrigger>
 <TabsTrigger value="signals" data-testid="tab-tel-signals"><Flame className="h-3.5 w-3.5 mr-1.5" />Signal pool</TabsTrigger>
 <TabsTrigger value="explorer" data-testid="tab-tel-explorer"><Filter className="h-3.5 w-3.5 mr-1.5" />Event explorer</TabsTrigger>
 </TabsList>
 <TabsContent value="funnel">
 <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
 {/* Funnel */}
 <Card>
 <CardHeader className="pb-3">
 <CardTitle className="text-base flex items-center gap-2"><BarChart3 className="h-4 w-4 text-[hsl(327_77%_30%)]" />Round funnel — all-time</CardTitle>
 </CardHeader>
 <CardContent>
 <Funnel f={funnel} />
 </CardContent>
 </Card>

 {/* Cohort benchmarks */}
 <Card>
 <CardHeader className="pb-3">
 <CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4 text-[hsl(327_77%_30%)]" />Cohort benchmarks</CardTitle>
 </CardHeader>
 <CardContent>
 <div className="flex gap-2 mb-3 flex-wrap">
 <Select value={bSector} onValueChange={setBSector}><SelectTrigger className="w-[140px]" data-testid="select-sector"><SelectValue /></SelectTrigger><SelectContent>{SECTORS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
 <Select value={bStage} onValueChange={setBStage}><SelectTrigger className="w-[140px]" data-testid="select-stage"><SelectValue /></SelectTrigger><SelectContent>{STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
 <Select value={bRegion} onValueChange={setBRegion}><SelectTrigger className="w-[120px]" data-testid="select-region"><SelectValue /></SelectTrigger><SelectContent>{REGIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
 </div>
 {benchmarks ? (
 <div className="text-xs space-y-2" data-testid="cohort-benchmarks">
 <div className="flex justify-between"><span className="text-muted-foreground">Cohort size</span><span className="font-mono tabular-nums">{benchmarks.count} closed rounds</span></div>
 <PercentileRow label="Round duration (days)" p={benchmarks.durationDays} fmt={(v) => v.toFixed(0)} />
 <PercentileRow label="Pre-money valuation ($)" p={benchmarks.preMoneyValuation} fmt={(v) => `$${(v / 1e6).toFixed(1)}M`} />
 <PercentileRow label="Soft-circle conv. rate" p={benchmarks.softCircleConversionRate} fmt={(v) => `${(v * 100).toFixed(0)}%`} />
 <PercentileRow label="Lead investor cheque" p={benchmarks.leadInvestorChequeSize} fmt={(v) => `$${(v / 1e6).toFixed(2)}M`} />
 <PercentileRow label="Total round size ($)" p={benchmarks.totalRoundSize} fmt={(v) => `$${(v / 1e6).toFixed(1)}M`} />
 <PercentileRow label="Time to close (days)" p={benchmarks.timeToCloseDays} fmt={(v) => v.toFixed(0)} />
 </div>
 ) : (
 <div className="text-sm text-muted-foreground italic py-6 text-center border border-dashed border-border rounded-md">No data yet for this cohort. Closed rounds add organically.</div>
 )}
 </CardContent>
 </Card>
 </div>
 </TabsContent>
 <TabsContent value="intelligence">
 {/* Sprint 5 — M&A intelligence widgets */}
 <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
 <ValuationStepUpWidget rounds={roundsQ.data ?? []} />
 <InvestorConcentrationWidget securities={securitiesQ.data ?? []} />
 <BurnVsRaiseWidget />
 </div>
 </TabsContent>
 <TabsContent value="signals">
 {/* Signal pool */}
 <Card>
 <CardHeader className="pb-3">
 <CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4 text-[hsl(327_77%_30%)]" />M&A intelligence signal pool</CardTitle>
 </CardHeader>
 <CardContent>
 <p className="text-xs text-muted-foreground mb-3">Cohorts populated by sector × stage × region. Sparse cohorts are flagged so platform admins know where to recruit more activity.</p>
 <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
 {allCohorts.map(({ cohort, count }) => {
 const sparse = count < 5;
 return (
 <div key={`${cohort.sector}-${cohort.stage}-${cohort.region}`}
 className={`rounded-md border p-3 text-xs ${sparse ? "border-amber-300 bg-amber-50 " : "border-border bg-card"}`}
 data-testid={`cohort-${cohort.sector}-${cohort.stage}-${cohort.region}`}>
 <div className="font-medium capitalize">{cohort.sector}</div>
 <div className="text-muted-foreground">{cohort.stage} · {cohort.region}</div>
 <div className="mt-1.5 flex items-center justify-between">
 <span className="font-mono tabular-nums text-sm">{count}</span>
 {sparse && <Badge className="bg-amber-200 text-amber-900 border-0 text-[10px]">needs more data</Badge>}
 </div>
 </div>
 );
 })}
 </div>
 </CardContent>
 </Card>

 </TabsContent>
 <TabsContent value="explorer">
 {/* Event explorer */}
 <Card>
 <CardHeader className="pb-3">
 <CardTitle className="text-base flex items-center gap-2"><Filter className="h-4 w-4 text-[hsl(327_77%_30%)]" />Event explorer</CardTitle>
 </CardHeader>
 <CardContent className="px-0">
 <div className="px-6 mb-3 flex flex-wrap gap-2 items-center">
 <div className="relative">
 <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
 <Input placeholder="Search events…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-9 w-[260px]" data-testid="input-event-search" />
 </div>
 <Select value={filterType} onValueChange={setFilterType}>
 <SelectTrigger className="w-[220px] h-9" data-testid="select-event-type"><SelectValue placeholder="Type" /></SelectTrigger>
 <SelectContent>
 <SelectItem value="__all__">All types</SelectItem>
 {ALL_EVENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
 </SelectContent>
 </Select>
 <Select value={filterCompany} onValueChange={setFilterCompany}>
 <SelectTrigger className="w-[200px] h-9" data-testid="select-event-company"><SelectValue placeholder="Company" /></SelectTrigger>
 <SelectContent>
 <SelectItem value="__all__">All companies</SelectItem>
 {companies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
 </SelectContent>
 </Select>
 <span className="text-xs text-muted-foreground ml-auto">{filteredEvents.length} of {events.length}</span>
 </div>
 <div className="max-h-[60vh] overflow-y-auto">
 <table className="w-full text-sm" data-testid="table-events">
 <thead>
 <tr className="text-xs uppercase text-muted-foreground border-b border-border">
 <th className="text-left font-medium px-6 py-2.5">Time</th>
 <th className="text-left font-medium px-3 py-2.5">Type</th>
 <th className="text-left font-medium px-3 py-2.5">Company</th>
 <th className="text-left font-medium px-3 py-2.5">Actor</th>
 <th className="text-left font-medium px-3 py-2.5">Hash</th>
 </tr>
 </thead>
 <tbody>
 {filteredEvents.slice(-200).reverse().map((e) => {
 const open = openEventId === e.id;
 return (
 <>
 <tr key={e.id} className="border-b border-border/60 hover:bg-secondary/40 cursor-pointer" onClick={() => setOpenEventId(open ? null : e.id)} data-testid={`row-event-${e.id}`}>
 <td className="px-6 py-2.5 text-xs text-muted-foreground">{new Date(e.timestamp).toLocaleString()}</td>
 <td className="px-3 py-2.5 font-mono text-xs">{e.type}</td>
 <td className="px-3 py-2.5 text-xs">{e.companyId}</td>
 <td className="px-3 py-2.5 text-xs">{e.actorId} <span className="text-muted-foreground">({e.actorRole})</span></td>
 <td className="px-3 py-2.5 font-mono text-[10px] text-muted-foreground">{e.hash.slice(0, 14)}…</td>
 </tr>
 {open && (
 <tr key={`${e.id}-detail`} className="bg-secondary/30 border-b border-border/60">
 <td colSpan={5} className="px-6 py-3">
 <pre className="text-[10px] font-mono whitespace-pre-wrap break-all bg-card border border-border rounded-md p-3 overflow-x-auto">
{JSON.stringify(e, null, 2)}
 </pre>
 </td>
 </tr>
 )}
 </>
 );
 })}
 {filteredEvents.length === 0 && (
 <tr><td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">No events match these filters.</td></tr>
 )}
 </tbody>
 </table>
 </div>
 </CardContent>
 </Card>
 </TabsContent>
 </Tabs>
 </PageBody>
 </>
 );
}

function Funnel({ f }: { f: ReturnType<typeof funnelDropoff> }) {
 const steps = [
 { label: "Invited", value: f.invited, rate: 1 },
 { label: "Viewed", value: f.viewed, rate: f.rates.viewRate },
 { label: "Soft-circled", value: f.softCircled, rate: f.rates.circleRate },
 { label: "Signed", value: f.signed, rate: f.rates.signRate },
 { label: "Funded", value: f.funded, rate: f.rates.fundRate },
 ];
 const max = Math.max(...steps.map((s) => s.value), 1);
 return (
 <div className="space-y-2.5">
 {steps.map((s, i) => (
 <div key={s.label} className="flex items-center gap-3">
 <div className="w-24 text-xs text-muted-foreground">{s.label}</div>
 <div className="flex-1 h-7 rounded-md bg-secondary overflow-hidden relative">
 <div className="h-full bg-[hsl(327_77%_30%)] transition-all" style={{ width: `${(s.value / max) * 100}%` }} />
 <div className="absolute inset-0 flex items-center px-3 text-xs font-medium">
 <span className="font-mono tabular-nums">{s.value.toLocaleString()}</span>
 {i > 0 && <span className="ml-2 text-muted-foreground">{(s.rate * 100).toFixed(0)}% conv.</span>}
 </div>
 </div>
 </div>
 ))}
 </div>
 );
}

function PercentileRow({ label, p, fmt }: { label: string; p: { p25: number; p50: number; p75: number; p90: number }; fmt: (v: number) => string }) {
 return (
 <div className="border-b border-border/60 pb-1.5">
 <div className="text-muted-foreground mb-0.5">{label}</div>
 <div className="grid grid-cols-4 gap-2 font-mono tabular-nums">
 <div><span className="text-muted-foreground text-[10px]">p25 </span>{fmt(p.p25)}</div>
 <div><span className="text-muted-foreground text-[10px]">p50 </span>{fmt(p.p50)}</div>
 <div><span className="text-muted-foreground text-[10px]">p75 </span>{fmt(p.p75)}</div>
 <div><span className="text-muted-foreground text-[10px]">p90 </span>{fmt(p.p90)}</div>
 </div>
 </div>
 );
}

/* ----- Sprint 5 \u2014 M&A intelligence widgets ----- */

function ValuationStepUpWidget({ rounds }: { rounds: ApiRound[] }) {
 const closedRounds = rounds
 .filter((r) => r.state === "closed" || r.state === "soft_circle_open" || r.state === "signing_open")
 .sort((a, b) => (a.closeDate ?? "").localeCompare(b.closeDate ?? ""));
 const stepUps: { from: string; to: string; ratio: number }[] = [];
 for (let i = 1; i < closedRounds.length; i++) {
 const prev = closedRounds[i - 1];
 const cur = closedRounds[i];
 if (prev.postMoney && cur.preMoney) {
 stepUps.push({
 from: prev.name,
 to: cur.name,
 ratio: cur.preMoney / prev.postMoney - 1,
 });
 }
 }
 const median = stepUps.length === 0 ? 0 : [...stepUps].sort((a, b) => a.ratio - b.ratio)[Math.floor(stepUps.length / 2)].ratio;
 return (
 <Card data-testid="card-valuation-stepup">
 <CardHeader className="pb-2">
 <CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4 text-emerald-600" />Valuation step-up</CardTitle>
 </CardHeader>
 <CardContent>
 <div className="text-2xl font-mono tabular-nums font-semibold mb-2">
 {stepUps.length === 0 ? "—" : `${(median * 100).toFixed(0)}%`}
 </div>
 <p className="text-[11px] text-muted-foreground mb-2">Median step-up across {stepUps.length} round transitions. Bessemer benchmark for healthy markups: ≥ 50%.</p>
 <ul className="space-y-1 text-[11px]">
 {stepUps.map((s, i) => (
 <li key={i} className="flex justify-between border-b border-border/40 pb-1" data-testid={`stepup-row-${i}`}>
 <span className="text-muted-foreground truncate max-w-[140px]">{s.to}</span>
 <span className={`font-mono ${s.ratio >= 0.5 ? "text-emerald-600" : s.ratio >= 0 ? "text-amber-600" : "text-rose-600"}`}>{(s.ratio * 100).toFixed(0)}%</span>
 </li>
 ))}
 {stepUps.length === 0 && <li className="text-muted-foreground italic">Need at least 2 rounds with valuations.</li>}
 </ul>
 </CardContent>
 </Card>
 );
}

function InvestorConcentrationWidget({ securities }: { securities: ApiSecurity[] }) {
 // Compute % ownership per holder by summing shares (FD basis where possible).
 const totals = new Map<string, number>();
 for (const s of securities) {
 const shares = s.shares ?? 0;
 totals.set(s.holderName, (totals.get(s.holderName) ?? 0) + shares);
 }
 const grand = Array.from(totals.values()).reduce((a, b) => a + b, 0);
 const ranked = Array.from(totals.entries())
 .filter(([, v]) => v > 0)
 .map(([name, sh]) => ({ name, pct: grand === 0 ? 0 : (sh / grand) * 100 }))
 .sort((a, b) => b.pct - a.pct)
 .slice(0, 5);
 const top = ranked[0];
 const concentrationFlag = top && top.pct > 25;
 return (
 <Card data-testid="card-concentration">
 <CardHeader className="pb-2">
 <CardTitle className="text-sm flex items-center gap-2"><AlertCircle className={`h-4 w-4 ${concentrationFlag ? "text-rose-600" : "text-amber-600"}`} />Investor concentration risk</CardTitle>
 </CardHeader>
 <CardContent>
 <div className="text-2xl font-mono tabular-nums font-semibold mb-2">
 {top ? `${top.pct.toFixed(1)}%` : "—"}
 </div>
 <p className="text-[11px] text-muted-foreground mb-2">
 Top holder concentration. {concentrationFlag ? <span className="text-rose-600 font-medium">⚠ &gt;25% — single-investor risk flagged for M&amp;A diligence.</span> : "Below 25% — healthy diversification."}
 </p>
 <ul className="space-y-1 text-[11px]">
 {ranked.map((r, i) => (
 <li key={i} className="flex items-center gap-2" data-testid={`conc-row-${i}`}>
 <span className="w-3 text-muted-foreground">{i + 1}.</span>
 <span className="flex-1 truncate">{r.name}</span>
 <span className="font-mono">{r.pct.toFixed(1)}%</span>
 <div className="h-1.5 w-12 rounded-full bg-secondary overflow-hidden">
 <div className={`h-full ${r.pct > 25 ? "bg-rose-500" : r.pct > 10 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, r.pct * 2)}%` }} />
 </div>
 </li>
 ))}
 </ul>
 </CardContent>
 </Card>
 );
}

function BurnVsRaiseWidget() {
 // Sprint 5 \u2014 derived signal across the seeded cohort. Synthetic correlation
 // computed from the benchmark store (round duration vs total raise size).
 const cohorts = defaultBenchmarkStore.listCohorts();
 const points = cohorts
 .map((c) => {
 const b = defaultBenchmarkStore.getCohortBenchmarks(c.cohort);
 if (!b || b.count < 3) return null;
 return { cohortLabel: `${c.cohort.sector}/${c.cohort.stage}`, days: b.timeToCloseDays.p50, raise: b.totalRoundSize.p50 };
 })
 .filter(Boolean) as { cohortLabel: string; days: number; raise: number }[];
 // Compute Pearson correlation
 let r = 0;
 if (points.length > 2) {
 const n = points.length;
 const mx = points.reduce((s, p) => s + p.days, 0) / n;
 const my = points.reduce((s, p) => s + p.raise, 0) / n;
 const num = points.reduce((s, p) => s + (p.days - mx) * (p.raise - my), 0);
 const dx = Math.sqrt(points.reduce((s, p) => s + (p.days - mx) ** 2, 0));
 const dy = Math.sqrt(points.reduce((s, p) => s + (p.raise - my) ** 2, 0));
 r = dx === 0 || dy === 0 ? 0 : num / (dx * dy);
 }
 return (
 <Card data-testid="card-burn-raise">
 <CardHeader className="pb-2">
 <CardTitle className="text-sm flex items-center gap-2"><Flame className="h-4 w-4 text-[hsl(38_92%_50%)]" />Burn vs raise correlation</CardTitle>
 </CardHeader>
 <CardContent>
 <div className="text-2xl font-mono tabular-nums font-semibold mb-2">
 {points.length < 3 ? "—" : `r = ${r.toFixed(2)}`}
 </div>
 <p className="text-[11px] text-muted-foreground mb-2">
 Pearson correlation between time-to-close (days) and total round size (USD) across {points.length} cohorts. Negative = faster closes correlate with smaller rounds (efficient capital).
 </p>
 <ul className="space-y-1 text-[11px]">
 {points.slice(0, 5).map((p, i) => (
 <li key={i} className="flex justify-between border-b border-border/40 pb-1" data-testid={`burn-row-${i}`}>
 <span className="text-muted-foreground">{p.cohortLabel}</span>
 <span className="font-mono">{p.days.toFixed(0)}d / ${(p.raise / 1e6).toFixed(1)}M</span>
 </li>
 ))}
 {points.length === 0 && <li className="text-muted-foreground italic">Need ≥3 cohorts with sufficient data.</li>}
 </ul>
 </CardContent>
 </Card>
 );
}
