/**
 * /admin/reconciliation — engine vs reference engine drift dashboard.
 *
 * Top KPIs · Live runner · History table · Drift detail.
 */
import { useEffect, useMemo, useState } from "react";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Stat } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
 GitCompareArrows, ShieldCheck, AlertTriangle, RefreshCw, Activity, Building2, Clock,
} from "lucide-react";
import { useSprint3, runReconciliation, buildDemoComputeOpts } from "@/lib/sprint3";
import { AdminPageIntro } from "@/components/AdminPageIntro";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { apiRequest } from "@/lib/queryClient";

/* v25.29 C8 — the hardcoded 3-entry COMPANIES list (co-acme/co-fluxform/
   co-helio) has been removed. We now fetch the real company list from
   /api/admin/companies (the same endpoint the Companies admin tab uses).
   The hardcoded list previously meant every admin instance, regardless of
   tenant, saw the same demo names — which was confusing and prevented
   reconciliation against real founder-created companies. */
type ReconCompany = { id: string; name: string };

export default function AdminReconciliation() {
 const reconciliations = useSprint3((s) => s.reconciliations);
 const [companies, setCompanies] = useState<ReconCompany[]>([]);
 const [companyId, setCompanyId] = useState<string>("");

 /* v25.29 C8 — fetch the admin company list once on mount. If the API
    call fails (e.g. on a fresh local dev environment), we fall back to
    the legacy demo company list so the page still renders something
    usable for the dual-engine smoke test. */
 useEffect(() => {
   let cancelled = false;
   const fetchCompanies = async () => {
     try {
       const res = await apiRequest("GET", "/api/admin/companies");
       const data: any = await res.json();
       /* v25.29 C8 — /api/admin/companies returns { rows: [...] } (NOT items).
          Accept both shapes defensively in case the contract evolves. */
       const sourceRows: any[] = Array.isArray(data?.rows)
         ? data.rows
         : Array.isArray(data?.items)
           ? data.items
           : [];
       const rows: ReconCompany[] = sourceRows.map((r: any) => ({
         id: String(r.id),
         name: String(r.name ?? r.legalName ?? r.id),
       }));
       if (!cancelled && rows.length > 0) {
         setCompanies(rows);
         setCompanyId((prev) => prev || rows[0].id);
       } else if (!cancelled) {
         /* DB is empty; offer demo placeholders so the page is not blank. */
         const fallback: ReconCompany[] = [
           { id: "co-acme", name: "Acme Capital (demo)" },
           { id: "co-fluxform", name: "Fluxform Labs (demo)" },
           { id: "co-helio", name: "Helio Sciences (demo)" },
         ];
         setCompanies(fallback);
         setCompanyId((prev) => prev || fallback[0].id);
       }
     } catch {
       if (!cancelled) {
         const fallback: ReconCompany[] = [
           { id: "co-acme", name: "Acme Capital (demo)" },
           { id: "co-fluxform", name: "Fluxform Labs (demo)" },
           { id: "co-helio", name: "Helio Sciences (demo)" },
         ];
         setCompanies(fallback);
         setCompanyId((prev) => prev || fallback[0].id);
       }
     }
   };
   void fetchCompanies();
   return () => { cancelled = true; };
 }, []);
 const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

 const stats = useMemo(() => {
 const today = new Date();
 today.setHours(0, 0, 0, 0);
 const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 3600 * 1000);
 const todays = reconciliations.filter((r) => new Date(r.asOf) >= today).length;
 const last30 = reconciliations.filter((r) => new Date(r.asOf) >= thirtyDaysAgo);
 const divergences = last30.filter((r) => r.status === "divergence").length;
 const last = reconciliations[reconciliations.length - 1];
 return { todays, total: reconciliations.length, divergences, last };
 }, [reconciliations]);

 const selectedRun = reconciliations.find((r) => r.runId === selectedRunId);

 function handleRun() {
 if (!companyId) return;
 const opts = buildDemoComputeOpts(companyId);
 const r = runReconciliation(opts, { actorId: "admin-platform", actorRole: "admin", companyId, ipAddress: "10.0.0.1" });
 setSelectedRunId(r.runId);
 }

 return (
 <>
 <PageHeader
 title="Reconciliation"
 description="Belt-and-suspenders cap-table accuracy. Primary engine (decimal.js) vs reference engine (BigInt scaled fixed-point). Match required to close any round."
 breadcrumbs={[{ label: "Admin" }, { label: "Reconciliation" }]}
 actions={
 <Badge className="bg-[hsl(0_100%_40%)] text-white border-0">
 Dual-engine gate
 </Badge>
 }
 />
 <PageBody>
 <AdminPageIntro
 guidance={{
 eyebrow: "Cap-table integrity",
 title: "Reconciliation — dual-engine accuracy gate before any round closes",
 description:
 "Capavate runs every cap-table calculation through two independent engines: the primary uses decimal.js (38-digit precision) and the reference uses BigInt scaled fixed-point arithmetic. Both must produce the same SHA-256 signature for a round to close. Divergences are surfaced here with per-holder × instrument diff rows so counsel and ops can resolve the root cause before money moves.",
 warning:
 "A divergence on any active round blocks the close-gate platform-wide. Investigate immediately — typical root causes: stale formula version in cache, race on a concurrent issuance, rounding mode mismatch on a custom security.",
 positive:
 "99%+ reconciliation success rate is the platform SLA. Every run, including the hash signatures of both engines, is permanently retained in the Audit Log for M&A diligence and SOC 2 evidence.",
 }}
 stats={[
 { label: "Last run", value: stats.last ? new Date(stats.last.asOf).toLocaleDateString() : "—", hint: stats.last ? `${stats.last.runDurationMs}ms· ${stats.last.status}` : "Never run" },
 { label: "Runs today", value: stats.todays, hint: "Across all tenants" },
 { label: "Divergences (30d)", value: stats.divergences, hint: "Investigate immediately", tone: stats.divergences > 0 ? "critical" : "positive" },
 { label: "Total runs", value: stats.total, hint: "All-time captured" },
 ]}
 />
 <Tabs defaultValue="runner" className="w-full">
 <TabsList className="mb-4">
 <TabsTrigger value="runner" data-testid="tab-recon-runner"><RefreshCw className="h-3.5 w-3.5 mr-1.5" />Live runner</TabsTrigger>
 <TabsTrigger value="history" data-testid="tab-recon-history"><Activity className="h-3.5 w-3.5 mr-1.5" />History ({stats.total})</TabsTrigger>
 <TabsTrigger value="detail" data-testid="tab-recon-detail" disabled={!selectedRun}><GitCompareArrows className="h-3.5 w-3.5 mr-1.5" />Drift detail</TabsTrigger>
 </TabsList>
 <TabsContent value="runner">
 <Card>
 <CardHeader className="pb-3">
 <CardTitle className="text-base flex items-center gap-2">
 <GitCompareArrows className="h-4 w-4 text-[hsl(0_100%_40%)]" />
 Live reconciliation runner
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="flex items-end gap-3 mb-4 flex-wrap">
 <div>
 <label className="text-xs text-muted-foreground block mb-1">Company</label>
 <Select value={companyId} onValueChange={setCompanyId} disabled={companies.length === 0}>
 <SelectTrigger className="w-[260px]" data-testid="select-recon-company">
 <SelectValue placeholder={companies.length === 0 ? "Loading companies…" : undefined} />
 </SelectTrigger>
 <SelectContent>
 {companies.map((c) => (
 <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 <Button onClick={handleRun} disabled={!companyId} className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)]" data-testid="button-run-reconciliation">
 <RefreshCw className="h-4 w-4 mr-2" />
 Run reconciliation now
 </Button>
 </div>
 {selectedRun ? <ReconciliationResultPanel result={selectedRun} /> : (
 <div className="text-sm text-muted-foreground border border-dashed border-border rounded-md p-6 text-center">
 Click <span className="font-medium">Run reconciliation now</span> to compute the cap table with both engines and compare.
 </div>
 )}
 </CardContent>
 </Card>
 </TabsContent>
 <TabsContent value="history">
 <Card>
 <CardHeader className="pb-3">
 <CardTitle className="text-base">Run history</CardTitle>
 </CardHeader>
 <CardContent className="px-0 max-h-[60vh] overflow-y-auto">
 <table className="w-full text-sm" data-testid="table-reconciliation-history">
 <thead>
 <tr className="text-xs uppercase text-muted-foreground border-b border-border">
 <th className="text-left font-medium px-6 py-2.5">Run ID</th>
 <th className="text-left font-medium px-3 py-2.5">As of</th>
 <th className="text-left font-medium px-3 py-2.5">Duration</th>
 <th className="text-left font-medium px-3 py-2.5">Status</th>
 <th className="text-left font-medium px-3 py-2.5">Primary hash</th>
 <th className="text-left font-medium px-3 py-2.5">Reference hash</th>
 <th className="text-left font-medium px-3 py-2.5">Diffs</th>
 </tr>
 </thead>
 <tbody>
 {reconciliations.length === 0 && (
 <tr><td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">No reconciliations yet — run one above.</td></tr>
 )}
 {[...reconciliations].reverse().map((r) => (
 <tr key={r.runId}
 className={`border-b border-border/60 hover:bg-secondary/40 cursor-pointer ${selectedRunId === r.runId ? "bg-secondary/40" : ""}`}
 onClick={() => setSelectedRunId(r.runId)}
 data-testid={`row-recon-${r.runId}`}>
 <td className="px-6 py-3 font-mono text-xs">{r.runId.slice(0, 24)}</td>
 <td className="px-3 py-3 text-muted-foreground text-xs">{new Date(r.asOf).toLocaleString()}</td>
 <td className="px-3 py-3 text-xs">{r.runDurationMs}ms</td>
 <td className="px-3 py-3">
 {r.status === "match"
 ? <Badge className="bg-emerald-100 text-emerald-900 border-0"><ShieldCheck className="h-3 w-3 mr-1" />Match</Badge>
 : <Badge className="bg-rose-100 text-rose-900 border-0"><AlertTriangle className="h-3 w-3 mr-1" />Divergence</Badge>}
 </td>
 <td className="px-3 py-3 font-mono text-[10px] text-muted-foreground">{r.primaryHash.slice(0, 14)}…</td>
 <td className="px-3 py-3 font-mono text-[10px] text-muted-foreground">{r.referenceHash.slice(0, 14)}…</td>
 <td className="px-3 py-3 text-xs">{r.diffs.length}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </CardContent>
 </Card>
 </TabsContent>
 <TabsContent value="detail">
 {selectedRun ? (
 <Card>
 <CardHeader className="pb-3">
 <CardTitle className="text-base">Drift detail — {selectedRun.runId.slice(0, 16)}…</CardTitle>
 </CardHeader>
 <CardContent>
 <ReconciliationResultPanel result={selectedRun} />
 </CardContent>
 </Card>
 ) : (
 <div className="text-sm text-muted-foreground p-6 text-center">Select a row in History to see drift detail.</div>
 )}
 </TabsContent>
 </Tabs>
 </PageBody>
 </>
 );
}

function ReconciliationResultPanel({ result }: { result: ReturnType<typeof useSprint3.getState>["reconciliations"][number] }) {
 const matched = result.status === "match";
 return (
 <div data-testid={`panel-recon-${result.runId}`}>
 <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
 <SignaturePanel label="Primary engine" hash={result.primaryHash} total={result.primaryTotal} />
 <SignaturePanel label="Reference engine" hash={result.referenceHash} total={result.referenceTotal} />
 <div className={`rounded-md border p-4 ${matched ? "border-emerald-300 bg-emerald-50 " : "border-rose-300 bg-rose-50 "}`}>
 <div className="text-xs uppercase text-muted-foreground mb-1.5">Status</div>
 <div className="flex items-center gap-2">
 {matched
 ? <><ShieldCheck className="h-5 w-5 text-emerald-700 " /><span className="text-base font-semibold text-emerald-900 ">Match — both engines agree</span></>
 : <><AlertTriangle className="h-5 w-5 text-rose-700 " /><span className="text-base font-semibold text-rose-900 ">Divergence — close blocked</span></>}
 </div>
 <div className="mt-2 text-xs text-muted-foreground flex items-center gap-2"><Clock className="h-3 w-3" />{result.runDurationMs}ms · {result.formulaIdsUsed.length} formulas</div>
 </div>
 </div>

 {result.diffs.length > 0 && (
 <div className="border border-rose-300 rounded-md bg-rose-50 p-4">
 <div className="text-sm font-medium text-rose-900 mb-2">Holder × instrument diffs</div>
 <table className="w-full text-xs" data-testid="table-recon-diffs">
 <thead className="text-muted-foreground">
 <tr><th className="text-left py-1.5 px-2">Holder</th><th className="text-left py-1.5 px-2">Instrument</th><th className="text-left py-1.5 px-2">Series</th><th className="text-right py-1.5 px-2">Primary shares</th><th className="text-right py-1.5 px-2">Reference shares</th><th className="text-right py-1.5 px-2">Δ</th></tr>
 </thead>
 <tbody>
 {result.diffs.map((d) => (
 <tr key={d.key} className="border-t border-rose-200 ">
 <td className="py-1.5 px-2 font-medium">{d.holderId}</td>
 <td className="py-1.5 px-2">{d.kind}</td>
 <td className="py-1.5 px-2">{d.series ?? "—"}</td>
 <td className="py-1.5 px-2 text-right font-mono tabular-nums">{d.primaryShares}</td>
 <td className="py-1.5 px-2 text-right font-mono tabular-nums">{d.referenceShares}</td>
 <td className="py-1.5 px-2 text-right font-mono tabular-nums text-rose-700 ">{d.shareDelta}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}
 </div>
 );
}

function SignaturePanel({ label, hash, total }: { label: string; hash: string; total: string }) {
 return (
 <div className="rounded-md border border-border bg-card p-4">
 <div className="text-xs uppercase text-muted-foreground mb-1.5">{label}</div>
 <div className="text-xs text-muted-foreground">Total shares</div>
 <div className="font-mono tabular-nums text-base font-semibold mb-2">{Number(total).toLocaleString()}</div>
 <div className="text-xs text-muted-foreground">Hash</div>
 <div className="font-mono text-[10px] break-all leading-snug">{hash}</div>
 </div>
 );
}
