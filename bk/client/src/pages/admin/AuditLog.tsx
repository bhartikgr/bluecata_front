import { useMemo, useState } from "react";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, AlertTriangle, GitCompareArrows, Stamp } from "lucide-react";
import { useAdminStore } from "@/lib/adminStore";
import { defaultTelemetryStore, useSprint3 } from "@/lib/sprint3";
import { Button } from "@/components/ui/button";
import { AdminPageIntro } from "@/components/AdminPageIntro";

type FilterMode = "all" | "signoff" | "reconciliation" | "divergence";

type Row = {
 id: string;
 ts: string;
 actor: string;
 action: string;
 target: string;
 prevHash: string;
 hash: string;
 source: "admin" | "telemetry";
 category: "signoff" | "reconciliation" | "divergence" | "other";
 payload?: unknown;
};

export default function AdminAuditLog() {
 const { auditLog } = useAdminStore();
 useSprint3((s) => s.telemetryTick); // re-render on new telemetry
 const telemetryEvents = defaultTelemetryStore.list();
 const [filter, setFilter] = useState<FilterMode>("all");

 const adminVerification = useMemo(() => {
 let valid = true;
 let firstBreakAt: string | null = null;
 for (let i = 1; i < auditLog.length; i++) {
 const prev = auditLog[i - 1];
 const cur = auditLog[i];
 if (cur.prevHash !== prev.hash) {
 valid = false;
 firstBreakAt = cur.id;
 break;
 }
 }
 return { valid, firstBreakAt, length: auditLog.length };
 }, [auditLog]);

 const telemetryVerification = useMemo(() => defaultTelemetryStore.verifyChain(), [telemetryEvents]);

 const rows: Row[] = useMemo(() => {
 const all: Row[] = auditLog.map((e) => ({
 id: e.id, ts: e.ts, actor: e.actor, action: e.action, target: e.target,
 prevHash: e.prevHash, hash: e.hash, source: "admin",
 category: "other",
 }));
 for (const e of telemetryEvents) {
 const cat: Row["category"] =
 e.type.startsWith("signoff.") ? "signoff" :
 e.type === "reconciliation.divergence_detected" ? "divergence" :
 e.type.startsWith("reconciliation.") ? "reconciliation" : "other";
 all.push({
 id: e.id,
 ts: e.timestamp,
 actor: e.actorId,
 action: e.type,
 target: e.companyId + (e.roundId ? ` / ${e.roundId}` : ""),
 prevHash: e.prevHash,
 hash: e.hash,
 source: "telemetry",
 category: cat,
 payload: e,
 });
 }
 return all.sort((a, b) => a.ts.localeCompare(b.ts));
 }, [auditLog, telemetryEvents]);

 const filtered = useMemo(() => {
 if (filter === "all") return rows;
 return rows.filter((r) => r.category === filter);
 }, [rows, filter]);

 // Sign-off chains: each round_close has [primaryHash, referenceHash, founder + admin signoff].
 // We surface this human-readably by walking signoff.granted events.
 const signoffChains = useMemo(() => {
 const closes = telemetryEvents.filter((e) => e.type === "round.closed");
 const chains: Array<{
 roundId: string; companyId: string; closedAt: string;
 primaryHash: string; referenceHash: string;
 founder?: { actorId: string; ts: string; identityHash: string };
 admin?: { actorId: string; ts: string; identityHash: string };
 }> = [];
 for (const c of closes) {
 const p: any = (c as any).payload;
 const founder = telemetryEvents.find((e) =>
 e.type === "signoff.granted"
 && (e as any).payload.roundId === p.roundId
 && (e as any).payload.signerRole === "founder",
 );
 const admin = telemetryEvents.find((e) =>
 e.type === "signoff.granted"
 && (e as any).payload.roundId === p.roundId
 && (e as any).payload.signerRole === "admin",
 );
 chains.push({
 roundId: p.roundId, companyId: c.companyId, closedAt: c.timestamp,
 primaryHash: p.primaryHash, referenceHash: p.referenceHash,
 founder: founder ? { actorId: founder.actorId, ts: founder.timestamp, identityHash: (founder as any).payload.identityHash } : undefined,
 admin: admin ? { actorId: admin.actorId, ts: admin.timestamp, identityHash: (admin as any).payload.identityHash } : undefined,
 });
 }
 return chains;
 }, [telemetryEvents]);

 return (
 <>
 <PageHeader
 title="Audit log"
 description="Hash-chained admin audit log + telemetry event log unified. Sign-offs, reconciliations, divergences, every formula publish — all immutable, all queryable."
 breadcrumbs={[{ label: "Admin" }, { label: "Audit log" }]}
 actions={
 <div className="flex items-center gap-2">
 {adminVerification.valid
 ? <Badge className="bg-emerald-100 text-emerald-900 border-0"><ShieldCheck className="h-3 w-3 mr-1" />Admin chain · {adminVerification.length}</Badge>
 : <Badge className="bg-rose-100 text-rose-900 border-0"><AlertTriangle className="h-3 w-3 mr-1" />Admin chain broken at {adminVerification.firstBreakAt}</Badge>}
 {telemetryVerification.valid
 ? <Badge className="bg-emerald-100 text-emerald-900 border-0"><ShieldCheck className="h-3 w-3 mr-1" />Telemetry chain · {telemetryVerification.length}</Badge>
 : <Badge className="bg-rose-100 text-rose-900 border-0"><AlertTriangle className="h-3 w-3 mr-1" />Telemetry chain broken at #{telemetryVerification.brokenAt}</Badge>}
 </div>
 }
 />
 <PageBody>
 <AdminPageIntro
 guidance={{
 eyebrow: "Forensic record",
 title: "Audit log — every privileged action, hash-chained and immutable",
 description:
 "Two parallel append-only chains: the admin chain captures every admin/ops action (formula publishes, policy changes, force-logouts, role escalations) and the telemetry chain captures every system-level cap-table event (reconciliations, sign-offs, divergences). Each entry is linked to the previous via SHA-256 so any retroactive edit instantly breaks the chain and is detectable.",
 warning:
 "If either chain shows 'broken at #N', stop all admin writes immediately and escalate to security. A broken chain is a P0 incident under SOC 2 CC7.2 (system monitoring) — it means an entry was retroactively altered, deleted, or the store was tampered.",
 positive:
 "This page is the authoritative record for M&A diligence and regulatory inquiry. Every founder + admin sign-off on a round close is permanently retained with identity hash, hash chain link, and dual-engine reconciliation signatures.",
 }}
 stats={[
 { label: "Admin chain", value: adminVerification.valid ? `✓ ${adminVerification.length}` : `✗ broken @ ${adminVerification.firstBreakAt}`, tone: adminVerification.valid ? "positive" : "critical" },
 { label: "Telemetry chain", value: telemetryVerification.valid ? `✓ ${telemetryVerification.length}` : `✗ broken @ ${telemetryVerification.brokenAt}`, tone: telemetryVerification.valid ? "positive" : "critical" },
 { label: "Sign-off chains", value: signoffChains.length, hint: "Founder + admin" },
 { label: "Entries shown", value: filtered.length, hint: `Filter: ${filter}` },
 ]}
 />
 {/* Sign-off chain summary */}
 {signoffChains.length > 0 && (
 <Card className="mb-4">
 <CardContent className="py-4">
 <div className="text-sm font-medium mb-2 flex items-center gap-2"><Stamp className="h-4 w-4 text-[hsl(327_77%_30%)]" />Sign-off chains</div>
 <div className="space-y-2 text-xs">
 {signoffChains.map((c) => (
 <div key={c.roundId} className="border-l-2 border-[hsl(327_77%_30%)] pl-3 py-1" data-testid={`signoff-chain-${c.roundId}`}>
 <div>Round <span className="font-mono">{c.roundId}</span> at <span className="font-mono">{c.companyId}</span> closed on <span className="font-mono">{new Date(c.closedAt).toLocaleString()}</span>.</div>
 <div className="text-muted-foreground mt-0.5">
 Founder: {c.founder ? <>{c.founder.actorId} <span className="font-mono">({c.founder.identityHash})</span> at {new Date(c.founder.ts).toLocaleString()}</> : <span className="italic">missing</span>}
 {" · "}
 Admin: {c.admin ? <>{c.admin.actorId} <span className="font-mono">({c.admin.identityHash})</span> at {new Date(c.admin.ts).toLocaleString()}</> : <span className="italic">missing</span>}
 </div>
 <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">Primary: {c.primaryHash.slice(0, 20)}… · Reference: {c.referenceHash.slice(0, 20)}…</div>
 </div>
 ))}
 </div>
 </CardContent>
 </Card>
 )}

 {/* Filter chips */}
 <div className="flex items-center gap-2 mb-3">
 <span className="text-xs text-muted-foreground mr-1">Filter:</span>
 {(["all", "signoff", "reconciliation", "divergence"] as FilterMode[]).map((f) => (
 <Button key={f} size="sm" variant={filter === f ? "default" : "outline"}
 className={filter === f ? "bg-[hsl(327_77%_30%)] hover:bg-[hsl(327_77%_25%)] h-7" : "h-7"}
 onClick={() => setFilter(f)} data-testid={`filter-${f}`}>
 {f === "all" ? "All" : f === "signoff" ? "Sign-off" : f === "reconciliation" ? "Reconciliation" : "Divergence"}
 </Button>
 ))}
 <span className="text-xs text-muted-foreground ml-auto">{filtered.length} entries</span>
 </div>

 <Card>
 <CardContent className="px-0 max-h-[60vh] overflow-y-auto">
 <table className="w-full text-sm" data-testid="table-audit-log">
 <thead>
 <tr className="text-xs uppercase text-muted-foreground border-b border-border">
 <th className="text-left font-medium px-6 py-2.5">Time</th>
 <th className="text-left font-medium px-3 py-2.5">Source</th>
 <th className="text-left font-medium px-3 py-2.5">Actor</th>
 <th className="text-left font-medium px-3 py-2.5">Action</th>
 <th className="text-left font-medium px-3 py-2.5">Target</th>
 <th className="text-left font-medium px-3 py-2.5">Hash</th>
 </tr>
 </thead>
 <tbody>
 {[...filtered].reverse().map((e) => (
 <tr key={`${e.source}-${e.id}`} className="border-b border-border/60 hover:bg-secondary/40" data-testid={`row-audit-${e.id}`}>
 <td className="px-6 py-3 text-xs text-muted-foreground">{new Date(e.ts).toLocaleString()}</td>
 <td className="px-3 py-3">
 <Badge variant="outline" className={`text-[10px] ${e.source === "telemetry" ? "border-[hsl(327_77%_30%)] text-[hsl(327_77%_30%)]" : ""}`}>
 {e.source === "telemetry" ? <><GitCompareArrows className="h-2.5 w-2.5 mr-1" />telemetry</> : "admin"}
 </Badge>
 </td>
 <td className="px-3 py-3 text-xs">{e.actor}</td>
 <td className="px-3 py-3 font-mono text-xs">{e.action}</td>
 <td className="px-3 py-3 text-muted-foreground text-xs">{e.target}</td>
 <td className="px-3 py-3 font-mono text-[10px]">{e.hash.slice(0, 14)}…</td>
 </tr>
 ))}
 </tbody>
 </table>
 </CardContent>
 </Card>
 </PageBody>
 </>
 );
}
