/**
 * v25.44 Surface 13 — /ma-intel M&A Intelligence page (INSTITUTIONAL-GRADE).
 *
 * Three tabs:
 *   1. Pipeline           — Kanban 3-column board (active / outbound / inbound)
 *   2. Comparable Exits   — sortable table + CSV export (no private fields)
 *   3. Sector Benchmarks  — heatmap grid with k-anonymity floor (n<5 → "—")
 *
 * All data is privacy-gated server-side (default opt-OUT of Collective-wide
 * aggregation). Narrative is never present in aggregate responses. Each tab
 * carries a methodology footer.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Handshake, Download } from "lucide-react";

/* ---- types ---- */
interface PipelineRow {
  companyId: string;
  companyName: string;
  sector: string | null;
  region: string | null;
  maScore: number;
  acquirerFitScore: number;
  topBuyer: { name: string; rationale: string } | null;
  growthRate: number;
  revenueMultipleRange: { low: number; high: number };
  scoreBucket: "red" | "amber" | "gray";
}
interface PipelineResponse {
  asOfDate: string;
  buckets: {
    active_negotiation: PipelineRow[];
    outbound: PipelineRow[];
    inbound: PipelineRow[];
    none: { count: number };
  };
}
interface CompRow {
  target: string;
  acquirer: string;
  date: string;
  valuationUsd: number;
  revenueMultiple: number | null;
  sector: string;
  region: string;
  sourceAttribution: string;
}
interface CompsResponse {
  asOfDate: string;
  totalRecords: number;
  exits: CompRow[];
}
interface BenchmarkSector {
  sector: string;
  n: number;
  status: "OK" | "INSUFFICIENT_DATA";
  medians: Record<string, number> | null;
}
interface BenchmarksResponse {
  asOfDate: string;
  sectors: BenchmarkSector[];
}

function bucketBadge(bucket: string): string {
  if (bucket === "red") return "bg-[#cc0001] text-white";
  if (bucket === "amber") return "bg-amber-500 text-white";
  return "bg-slate-300 text-slate-700";
}

const BENCHMARK_COLUMNS: Array<{ key: string; label: string }> = [
  { key: "maScore", label: "M&A Score" },
  { key: "acquirerFitScore", label: "Acquirer Fit" },
  { key: "productMarketFit", label: "PMF" },
  { key: "technologyDifferentiation", label: "Tech Diff" },
  { key: "customerConcentration", label: "Cust. Conc." },
  { key: "growthRate", label: "Growth" },
  { key: "marketShare", label: "Mkt Share" },
  { key: "managementTeamStrength", label: "Mgmt" },
  { key: "revenueMultipleLow", label: "Rev × Low" },
  { key: "revenueMultipleHigh", label: "Rev × High" },
];

function Methodology({ text }: { text: string }) {
  return (
    <p className="text-[11px] text-slate-400 mt-4 border-t border-slate-100 pt-3" data-testid="ma-methodology">
      {text}
    </p>
  );
}

/* ---- Tab 1: Pipeline ---- */
function PipelineTab() {
  const q = useQuery<PipelineResponse>({
    queryKey: ["/api/collective/ma-intel", "pipeline"],
    queryFn: async () => (await apiRequest("GET", "/api/collective/ma-intel?view=pipeline")).json(),
    staleTime: 30_000,
  });
  if (q.isLoading) return <Skeleton className="h-64 w-full" data-testid="ma-pipeline-loading" />;
  if (q.error) return <div className="text-sm text-red-700">Couldn't load pipeline.</div>;

  const b = q.data?.buckets;
  const total =
    (b?.active_negotiation.length ?? 0) + (b?.outbound.length ?? 0) + (b?.inbound.length ?? 0);
  if (total === 0) {
    return (
      <div className="text-center py-12 text-slate-500" data-testid="ma-pipeline-empty">
        <p className="text-sm max-w-md mx-auto">
          Companies in the Collective haven't opted into M&amp;A intelligence sharing yet. Encourage your
          portfolio companies to enable this in Company Profile → Step 4.
        </p>
      </div>
    );
  }
  const columns: Array<{ key: keyof NonNullable<typeof b>; title: string; rows: PipelineRow[] }> = [
    { key: "active_negotiation", title: "Active Negotiation", rows: b?.active_negotiation ?? [] },
    { key: "outbound", title: "Outbound", rows: b?.outbound ?? [] },
    { key: "inbound", title: "Inbound", rows: b?.inbound ?? [] },
  ];
  return (
    <div data-testid="ma-pipeline">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {columns.map((col) => (
          <div key={String(col.key)} data-testid={`ma-pipeline-col-${String(col.key)}`}>
            <h3 className="text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wide">
              {col.title} ({col.rows.length})
            </h3>
            <div className="space-y-2">
              {col.rows.map((r) => (
                <div
                  key={r.companyId}
                  className="rounded-md border border-slate-100 bg-white p-3 shadow-sm"
                  data-testid={`ma-pipeline-card-${r.companyId}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-800">{r.companyName}</span>
                    <Badge className={`text-[10px] px-1.5 py-0.5 ${bucketBadge(r.scoreBucket)}`}>{r.maScore}</Badge>
                  </div>
                  <p className="text-[11px] text-slate-400">{r.sector ?? "—"}</p>
                  {r.topBuyer && (
                    <p className="text-[11px] text-slate-500 mt-1 line-clamp-2">
                      <span className="font-medium">{r.topBuyer.name}:</span> {r.topBuyer.rationale}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <Methodology text="Pipeline includes only companies that opted into M&A intelligence sharing (Collective-wide opt-in, or chapter-shared within your chapter). The narrative readiness field is never shown in aggregate views." />
    </div>
  );
}

/* ---- Tab 2: Comparable Exits ---- */
function CompsTab() {
  const q = useQuery<CompsResponse>({
    queryKey: ["/api/collective/ma-intel", "comps"],
    queryFn: async () => (await apiRequest("GET", "/api/collective/ma-intel?view=comps")).json(),
    staleTime: 30_000,
  });
  const [sortKey, setSortKey] = useState<keyof CompRow>("date");
  const [sortDesc, setSortDesc] = useState(true);

  if (q.isLoading) return <Skeleton className="h-64 w-full" data-testid="ma-comps-loading" />;
  if (q.error) return <div className="text-sm text-red-700">Couldn't load comparable exits.</div>;

  const exits = [...(q.data?.exits ?? [])].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    let cmp = 0;
    if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
    else cmp = String(av).localeCompare(String(bv));
    return sortDesc ? -cmp : cmp;
  });

  function exportCsv() {
    // CSV does NOT include any private fields — only public comps + attribution.
    const header = ["Target", "Acquirer", "Date", "ValuationUSD", "RevenueMultiple", "Sector", "Region", "Source"];
    const lines = exits.map((e) =>
      [e.target, e.acquirer, e.date, e.valuationUsd, e.revenueMultiple ?? "", e.sector, e.region, e.sourceAttribution]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "comparable_exits.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function toggleSort(key: keyof CompRow) {
    if (sortKey === key) setSortDesc((d) => !d);
    else {
      setSortKey(key);
      setSortDesc(true);
    }
  }

  if (exits.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500" data-testid="ma-comps-empty">
        <p className="text-sm">No comparable exits available for your scope.</p>
      </div>
    );
  }

  const cols: Array<{ key: keyof CompRow; label: string }> = [
    { key: "target", label: "Target" },
    { key: "acquirer", label: "Acquirer" },
    { key: "date", label: "Date" },
    { key: "valuationUsd", label: "Valuation USD" },
    { key: "revenueMultiple", label: "Rev Multiple" },
    { key: "sector", label: "Sector" },
    { key: "sourceAttribution", label: "Source" },
  ];

  return (
    <div data-testid="ma-comps">
      <div className="flex justify-end mb-3">
        <Button size="sm" variant="outline" onClick={exportCsv} data-testid="ma-comps-export">
          <Download className="h-4 w-4 mr-1" /> Export CSV
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="ma-comps-table">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-slate-400 border-b">
              {cols.map((c) => (
                <th
                  key={String(c.key)}
                  className="py-2 px-2 text-left cursor-pointer select-none"
                  onClick={() => toggleSort(c.key)}
                  data-testid={`ma-comps-th-${String(c.key)}`}
                >
                  {c.label}
                  {sortKey === c.key ? (sortDesc ? " ▼" : " ▲") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {exits.map((e, idx) => (
              <tr key={idx} className="border-b border-slate-50" data-testid={`ma-comps-row-${idx}`}>
                <td className="py-2 px-2">{e.target}</td>
                <td className="py-2 px-2">{e.acquirer}</td>
                <td className="py-2 px-2">{e.date}</td>
                <td className="py-2 px-2 tabular-nums">${e.valuationUsd.toLocaleString()}</td>
                <td className="py-2 px-2 tabular-nums">{e.revenueMultiple != null ? `${e.revenueMultiple}×` : "—"}</td>
                <td className="py-2 px-2">{e.sector}</td>
                <td className="py-2 px-2 text-slate-500">{e.sourceAttribution}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Methodology text="Comparable exits are public market comps. Company attribution appears only where the company opted into Collective-wide sharing; otherwise the source is anonymized by sector. The CSV export contains no private fields." />
    </div>
  );
}

/* ---- Tab 3: Sector Benchmarks ---- */
function BenchmarksTab() {
  const q = useQuery<BenchmarksResponse>({
    queryKey: ["/api/collective/ma-intel", "benchmarks"],
    queryFn: async () => (await apiRequest("GET", "/api/collective/ma-intel?view=benchmarks")).json(),
    staleTime: 30_000,
  });
  if (q.isLoading) return <Skeleton className="h-64 w-full" data-testid="ma-benchmarks-loading" />;
  if (q.error) return <div className="text-sm text-red-700">Couldn't load sector benchmarks.</div>;

  const sectors = q.data?.sectors ?? [];
  if (sectors.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500" data-testid="ma-benchmarks-empty">
        <p className="text-sm">No sector benchmarks available for your scope.</p>
      </div>
    );
  }

  return (
    <div data-testid="ma-benchmarks">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="ma-benchmarks-table">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-slate-400 border-b">
              <th className="py-2 px-2 text-left">Sector</th>
              <th className="py-2 px-2 text-center">n</th>
              {BENCHMARK_COLUMNS.map((c) => (
                <th key={c.key} className="py-2 px-2 text-center">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sectors.map((s) => (
              <tr key={s.sector} className="border-b border-slate-50" data-testid={`ma-benchmarks-row-${s.sector}`}>
                <td className="py-2 px-2 font-medium text-slate-700">{s.sector}</td>
                <td className="py-2 px-2 text-center text-slate-500 tabular-nums">{s.n}</td>
                {BENCHMARK_COLUMNS.map((c) => (
                  <td key={c.key} className="py-2 px-2 text-center tabular-nums">
                    {s.status === "INSUFFICIENT_DATA" || !s.medians ? (
                      <span className="text-slate-300" title="Insufficient data (k-anonymity floor of 5)">
                        —
                      </span>
                    ) : (
                      s.medians[c.key]
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Methodology text="Sector medians require at least 5 opted-in companies per sector (k-anonymity floor) to prevent reverse-identification. Sectors with fewer than 5 companies show '—'. Only companies that opted into M&A intelligence sharing are included." />
    </div>
  );
}

export default function MaIntel() {
  return (
    <div className="p-6 max-w-7xl mx-auto" data-testid="page-ma-intel">
      <div className="flex items-center gap-2 mb-6">
        <Handshake className="h-6 w-6 text-[#cc0001]" />
        <h1 className="text-2xl font-semibold" style={{ color: "#041e41", fontFamily: "'Instrument Serif', serif" }}>
          M&amp;A Intelligence
        </h1>
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-slate-500">
            Institutional-grade aggregation · privacy-gated · k-anonymity floor of 5
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* v25.44 R3 — read ?view= from URL so deep links like
              /ma-intel?view=benchmarks open the right tab on first paint. */}
          <Tabs
            defaultValue={(() => {
              const v = new URLSearchParams(window.location.search).get("view");
              return v === "comps" || v === "benchmarks" ? v : "pipeline";
            })()}
          >
            <TabsList className="mb-4">
              <TabsTrigger value="pipeline" data-testid="ma-tab-pipeline">Pipeline</TabsTrigger>
              <TabsTrigger value="comps" data-testid="ma-tab-comps">Comparable Exits</TabsTrigger>
              <TabsTrigger value="benchmarks" data-testid="ma-tab-benchmarks">Sector Benchmarks</TabsTrigger>
            </TabsList>
            <TabsContent value="pipeline"><PipelineTab /></TabsContent>
            <TabsContent value="comps"><CompsTab /></TabsContent>
            <TabsContent value="benchmarks"><BenchmarksTab /></TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
