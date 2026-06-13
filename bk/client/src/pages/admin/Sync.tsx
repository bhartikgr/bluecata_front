/**
 * Sprint 13 — Admin Sync Status Dashboard.
 *
 * Surfaces the full state of the Capavate↔Collective bridge:
 *   - Outbound queue depth + per-event-type counts + last-success timestamps
 *   - Inbound queue depth + last-receive timestamps
 *   - DLQ contents w/ Replay button
 *   - Hash chain integrity widget (from Sprint 12)
 *   - Per-entity sync drift detector
 *   - Sync lag SLO chart (last 50 events latency p50/p95)
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Check, AlertTriangle, Clock, Zap, Layers, RefreshCw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AdminPageIntro } from "@/components/AdminPageIntro";

interface OverviewResp {
  health: {
    mode: string;
    outboundQueueDepth: number;
    dlqDepth: number;
    lastSuccessAt: string | null;
    lastReceivedAt: string | null;
    lagMs: number;
    hashChainOk: boolean;
    latencyP50: number;
    latencyP95: number;
    inboundCount: number;
    samples: number;
  };
  outboundCounts: { byEventType: Record<string, number>; lastByType: Record<string, string> };
  outboundTotal: number;
  outboundDelivered: number;
  outboundQueued: number;
  dlq: Array<{ eventId: string; eventType: string; aggregateId: string; attempts: number; reason: string; enqueuedAt: string }>;
  inboundTotal: number;
  inboundHandlers: string[];
  eventTypes: { outbound: string[]; inbound: string[] };
}
interface DriftResp {
  rows: Array<{ entityKey: string; aggregateId: string; status: "clean" | "drifted" | "never_synced"; driftedFields?: string[]; lastSyncedAt?: string }>;
}

export default function AdminSync() {
  const qc = useQueryClient();
  const ov = useQuery<OverviewResp>({ queryKey: ["/api/admin/sync/overview"] });
  const drift = useQuery<DriftResp>({ queryKey: ["/api/admin/sync/drift"] });

  const drain = async () => {
    await apiRequest("POST", "/api/bridge/drain");
    qc.invalidateQueries({ queryKey: ["/api/admin/sync/overview"] });
  };
  const replay = async (eventId: string) => {
    await apiRequest("POST", "/api/admin/sync/replay", { eventId });
    qc.invalidateQueries({ queryKey: ["/api/admin/sync/overview"] });
  };

  const h = ov.data?.health;

  return (
    <>
      <PageHeader
        title="Sync Status"
        description="Real-time Capavate ↔ Collective sync health, drift, and replay tools."
        actions={
          <Button variant="outline" size="sm" onClick={drain} data-testid="button-sync-drain">
            <Zap className="h-3.5 w-3.5 mr-1" /> Drain queue
          </Button>
        }
      />
      <PageBody>
        <AdminPageIntro
          guidance={{
            eyebrow: "Eventual-consistency monitoring",
            title: "Sync Status — Capavate ↔ Collective drift and replay control",
            description:
              "This page is the operational dashboard for the bridge. It shows projector health (are inbound events being applied?), outbound queue health (are events being delivered?), and a drift table that compares Capavate's view of an entity (company, investor, round, membership) to the Collective's. Use the replay action to re-emit a single event after fixing a downstream consumer.",
            warning:
              "Entities with status `drifted` need attention — the Collective and Capavate disagree on at least one field. Replay or reconcile before the next admin operation that touches the entity.",
            positive:
              "`never_synced` is normal for entities created before the bridge was enabled or kept Capavate-only by policy. Only `drifted` is an alert state.",
          }}
          stats={[
            { label: "Outbound queued", value: h?.outbound?.queued ?? 0, tone: (h?.outbound?.queued ?? 0) > 0 ? "warning" : "neutral" },
            { label: "Outbound delivered", value: h?.outbound?.delivered ?? 0, tone: "positive" },
            { label: "Inbound applied", value: h?.inbound?.total ?? 0 },
            { label: "Drifted entities", value: (drift.data?.rows ?? []).filter(r => r.status === "drifted").length, tone: (drift.data?.rows ?? []).some(r => r.status === "drifted") ? "critical" : "positive" },
            { label: "Clean entities", value: (drift.data?.rows ?? []).filter(r => r.status === "clean").length, tone: "positive" },
          ]}
        />
        {/* Health stats row */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
          <StatCard label="Mode" value={h?.mode ?? "—"} testId="stat-sync-mode" />
          <StatCard label="Queued" value={String(h?.outboundQueueDepth ?? 0)} accent="amber" testId="stat-sync-queued" />
          <StatCard label="Dead-letter" value={String(h?.dlqDepth ?? 0)} accent={h?.dlqDepth ? "red" : undefined} testId="stat-sync-dlq" />
          <StatCard label="Lag (ms)" value={String(h?.lagMs ?? 0)} testId="stat-sync-lag" />
          <StatCard label="Chain" value={h?.hashChainOk ? "OK" : "BROKEN"} accent={h?.hashChainOk ? "emerald" : "red"} testId="stat-sync-chain" />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <StatCard label="Latency p50" value={`${h?.latencyP50 ?? 0} ms`} testId="stat-latency-p50" />
          <StatCard label="Latency p95" value={`${h?.latencyP95 ?? 0} ms`} testId="stat-latency-p95" />
          <StatCard label="Outbound delivered" value={String(ov.data?.outboundDelivered ?? 0)} testId="stat-outbound-delivered" accent="emerald" />
          <StatCard label="Inbound total" value={String(ov.data?.inboundTotal ?? 0)} testId="stat-inbound-total" />
        </div>

        {/* Per-event-type counts */}
        <Card className="p-4 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <Layers className="h-4 w-4" />
            <h3 className="font-semibold text-sm">Outbound counts by event type</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {(ov.data?.eventTypes.outbound ?? []).map(t => {
              const c = ov.data?.outboundCounts.byEventType[t] ?? 0;
              const last = ov.data?.outboundCounts.lastByType[t];
              return (
                <div key={t} className="flex items-center justify-between text-xs border-b border-dashed py-1.5" data-testid={`row-eventtype-${t}`}>
                  <span className="font-mono">{t}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{c}</Badge>
                    {last && <span className="text-[10px] text-muted-foreground">{new Date(last).toLocaleTimeString()}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Inbound handlers */}
        <Card className="p-4 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="h-4 w-4" />
            <h3 className="font-semibold text-sm">Inbound handlers ({ov.data?.inboundHandlers.length ?? 0})</h3>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(ov.data?.inboundHandlers ?? []).map(h => (
              <Badge key={h} variant="secondary" className="font-mono text-[10px]" data-testid={`badge-inbound-${h}`}>
                <Check className="h-3 w-3 mr-1" />{h}
              </Badge>
            ))}
          </div>
        </Card>

        {/* DLQ */}
        <Card className="p-4 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-4 w-4 text-amber-700" />
            <h3 className="font-semibold text-sm">Dead-letter queue ({ov.data?.dlq.length ?? 0})</h3>
          </div>
          {!ov.data?.dlq.length ? (
            <p className="text-xs text-muted-foreground">No events in DLQ.</p>
          ) : (
            <div className="space-y-1.5">
              {ov.data.dlq.map(d => (
                <div key={d.eventId} className="flex items-center justify-between text-xs border-b border-dashed py-1.5" data-testid={`row-dlq-${d.eventId}`}>
                  <div>
                    <span className="font-mono">{d.eventType}</span>
                    <span className="text-muted-foreground ml-2">attempts={d.attempts} · {d.reason}</span>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => replay(d.eventId)} data-testid={`button-replay-${d.eventId}`}>
                    <RefreshCw className="h-3 w-3 mr-1" /> Replay
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Drift detector */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="h-4 w-4" />
            <h3 className="font-semibold text-sm">Per-entity sync drift ({drift.data?.rows.length ?? 0})</h3>
          </div>
          <div className="space-y-1">
            {(drift.data?.rows ?? []).map(r => (
              <div key={`${r.entityKey}:${r.aggregateId}`} className="flex items-center justify-between text-xs border-b border-dashed py-1.5" data-testid={`row-drift-${r.entityKey}`}>
                <div>
                  <span className="font-mono">{r.entityKey}</span>
                  <span className="text-muted-foreground ml-2">{r.aggregateId}</span>
                </div>
                <div className="flex items-center gap-2">
                  {r.driftedFields && <span className="text-[10px] text-amber-700">{r.driftedFields.join(", ")}</span>}
                  <Badge variant={r.status === "clean" ? "secondary" : r.status === "drifted" ? "destructive" : "outline"} data-testid={`badge-drift-${r.status}`}>
                    {r.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </PageBody>
    </>
  );
}

function StatCard({ label, value, accent, testId }: { label: string; value: string; accent?: "emerald" | "amber" | "red"; testId?: string }) {
  const color = accent === "emerald" ? "text-emerald-700"
    : accent === "amber" ? "text-amber-700"
    : accent === "red" ? "text-rose-700"
    : "";
  return (
    <Card className="p-4" data-testid={testId}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold mt-1 ${color}`}>{value}</div>
    </Card>
  );
}
