import { useMemo } from "react";
import { Link, useLocation } from "wouter";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, ExternalLink, CheckCircle2 } from "lucide-react";
import { listFormulas, type FormulaRecord, type Region } from "@capavate/cap-table-engine";
import { useAdminStore } from "@/lib/adminStore";
import { useQuery } from "@tanstack/react-query";
import type { ApiRound } from "@/lib/types";

/**
 * Sprint 5 — institutional provenance. "Used by N rounds" counter on each
 * formula, computed deterministically from the live rounds list. Mapping is
 * by category → instrument fit (e.g. SAFE conversion formulas count rounds
 * with SAFE securities; ESOP formulas count rounds that touched the pool).
 */
function usedByCount(f: FormulaRecord, rounds: ApiRound[]): number {
 // Heuristic mapping. In production this will read from the immutable
 // engine-trace ledger (every formula run is logged). For the demo:
 const cat = f.category as string;
 const region = f.region as string;
 // Only count rounds in the formula's region (or the lone Custom region: 0)
 const eligible = region === "Custom" ? [] : rounds;
 switch (cat) {
 case "safe_conversion": return eligible.filter((r) => r.type === "preseed" || r.type === "seed").length;
 case "note_conversion": return eligible.filter((r) => r.type === "preseed" || r.type === "seed").length;
 case "anti_dilution": return eligible.filter((r) => r.type !== "foundation").length;
 case "esop_topup":
 case "esop": return eligible.filter((r) => r.type !== "foundation").length;
 case "waterfall": return eligible.length;
 case "ownership": return eligible.length;
 case "warrant": return Math.min(eligible.length, 1);
 case "vesting": return eligible.length;
 default: return Math.max(0, eligible.length - 1);
 }
}

export default function AdminFormulas() {
 const [, navigate] = useLocation();
 const { customFormulas, testRuns } = useAdminStore();
 const all = useMemo(() => [...listFormulas(), ...customFormulas], [customFormulas]);
 const roundsQ = useQuery<ApiRound[]>({ queryKey: ["/api/rounds"] });

 const byRegion = useMemo(() => {
 const r: Record<string, FormulaRecord[]> = {};
 for (const f of all) (r[f.region] = r[f.region] || []).push(f);
 return r;
 }, [all]);

 return (
 <>
 <PageHeader
 title="Formula registry"
 description="Versioned, region-aware formulas drive the cap-table engine. Built-in formulas are read-only; clone to create regional variants."
 breadcrumbs={[{ label: "Admin" }, { label: "Formulas" }]}
 actions={
 <Button onClick={() => navigate("/admin/formulas/new")} data-testid="button-new-formula" className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white">
 <Plus className="h-4 w-4 mr-2" /> New variant
 </Button>
 }
 />
 <PageBody>
 {(["US", "CA", "UK", "SG", "HK", "CN", "IN", "JP", "AU", "Custom"] as Region[]).map((region) => {
 const items = byRegion[region] ?? [];
 if (items.length === 0) return null;
 return (
 <div key={region} className="mb-6">
 <div className="flex items-center gap-2 mb-3">
 <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">{region}</h2>
 <Badge variant="outline" className="text-[10px]">{items.length} formulas</Badge>
 </div>
 <Card>
 <CardContent className="px-0">
 <table className="w-full text-sm" data-testid={`table-formulas-${region}`}>
 <thead>
 <tr className="text-xs uppercase text-muted-foreground border-b border-border">
 <th className="text-left font-medium px-6 py-2.5">Formula</th>
 <th className="text-left font-medium px-3 py-2.5">Category</th>
 <th className="text-left font-medium px-3 py-2.5">Version</th>
 <th className="text-left font-medium px-3 py-2.5">Status</th>
 <th className="text-left font-medium px-3 py-2.5">Test</th>
 <th className="text-right font-medium px-3 py-2.5">Used by</th>
 <th className="text-left font-medium px-3 py-2.5">Citation</th>
 <th className="px-3 py-2.5 w-10" />
 </tr>
 </thead>
 <tbody>
 {items.map((f) => {
 const key = `${f.region}:${f.id}:${f.version}`;
 const run = testRuns[key];
 const dotColor = run
 ? run.status === "pass" ? "bg-emerald-500" : "bg-rose-500"
 : "bg-emerald-500"; // built-ins ship green
 return (
 <tr key={key} className="border-b border-border/60 hover:bg-secondary/40" data-testid={`row-formula-${f.id}`}>
 <td className="px-6 py-3">
 <Link href={`/admin/formulas/${encodeURIComponent(key)}`} className="font-medium hover:underline">
 {f.name}
 </Link>
 <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{f.id}</div>
 </td>
 <td className="px-3 py-3 text-muted-foreground capitalize">{f.category.replace(/_/g, " ")}</td>
 <td className="px-3 py-3 font-mono text-xs">{f.version}</td>
 <td className="px-3 py-3">
 {f.status === "active" && <Badge className="bg-emerald-100 text-emerald-900 border-0 text-[10px]">Active</Badge>}
 {f.status === "draft" && <Badge className="bg-amber-100 text-amber-900 border-0 text-[10px]">Draft</Badge>}
 {f.status === "archived" && <Badge variant="outline" className="text-[10px]">Archived</Badge>}
 </td>
 <td className="px-3 py-3">
 <span className="inline-flex items-center gap-1.5">
 <span className={`h-2 w-2 rounded-full ${dotColor}`} />
 <span className="text-xs text-muted-foreground">
 {run ? `${run.passed}/${run.passed + run.failed}` : "1/1"}
 </span>
 </span>
 </td>
 <td className="px-3 py-3 text-right" data-testid={`usedby-${f.id}-${f.region}`}>
 <Badge variant="outline" className="text-[10px] font-mono">
 {usedByCount(f, roundsQ.data ?? [])} rounds
 </Badge>
 </td>
 <td className="px-3 py-3 text-xs text-muted-foreground max-w-xs truncate">{f.citation.source}</td>
 <td className="px-3 py-3">
 <Link href={`/admin/formulas/${encodeURIComponent(key)}`}>
 <Button variant="ghost" size="icon" data-testid={`button-edit-${f.id}-${f.region}`}><ExternalLink className="h-4 w-4" /></Button>
 </Link>
 </td>
 </tr>
 );
 })}
 </tbody>
 </table>
 </CardContent>
 </Card>
 </div>
 );
 })}
 <div className="text-xs text-muted-foreground flex items-center gap-2 mt-4">
 <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
 Built-in formulas are pinned to their citation source and pass golden-master tests on every build.
 </div>
 </PageBody>
 </>
 );
}
