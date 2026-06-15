/**
 * Sprint 12 — Admin: Bridge & Outbox.
 *
 * Visualizes the Capavate↔Collective bridge:
 *  - 11 outbound event types (audit §13.2)
 *  - 4 inbound event types (audit §13.3)
 *  - Outbox state (queued/delivered/dead-letter), retry/drain, HMAC + envelope.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Network, Check, AlertTriangle, Clock, Zap, ShieldCheck } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AdminPageIntro } from "@/components/AdminPageIntro";

type OutboxResp = {
  total: number; delivered: number; queued: number; deadLettered: number;
  eventTypes: string[];
  entries: Array<{
    eventId: string; eventType: string; aggregateId: string; aggregateKind: string;
    occurredAt: string; status: string; attempts: number; lastError: string | null;
    receivedAck: boolean; priorHash: string; hash: string; hmac: string;
  }>;
};
type InboxResp = {
  total: number; eventTypes: string[];
  entries: Array<{
    eventId: string; eventType: string; aggregateId: string; aggregateKind: string;
    occurredAt: string; payload: Record<string, unknown>;
  }>;
};

export default function AdminBridge() {
  const qc = useQueryClient();
  const [aggregateId, setAggregateId] = useState("");
  const out = useQuery<OutboxResp>({ queryKey: ["/api/admin/bridge/outbox"] });
  const inb = useQuery<InboxResp>({ queryKey: ["/api/admin/bridge/inbox"] });
  const verify = useQuery<{ ok: boolean; brokenAt: number; totalLinks: number }>({ queryKey: ["/api/admin/bridge/verify-chain"] });

  const drain = async () => {
    await apiRequest("POST", "/api/admin/bridge/drain");
    qc.invalidateQueries({ queryKey: ["/api/admin/bridge/outbox"] });
    qc.invalidateQueries({ queryKey: ["/api/admin/bridge/verify-chain"] });
  };
  const emit = async (eventType: string) => {
    if (!aggregateId.trim()) return;
    await apiRequest("POST", "/api/admin/bridge/emit", { eventType, aggregateId: aggregateId.trim(), aggregateKind: "company", payload: { manual: true } });
    qc.invalidateQueries({ queryKey: ["/api/admin/bridge/outbox"] });
    qc.invalidateQueries({ queryKey: ["/api/admin/bridge/verify-chain"] });
  };

  return (
    <>
      <PageHeader
        title="Bridge & Outbox"
        description="Capavate ↔ Collective event bridge. HMAC-SHA256 signed envelopes, idempotent delivery, dead-letter on max retry."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={drain} data-testid="button-drain-outbox">
              <Zap className="h-3.5 w-3.5 mr-1" /> Drain queue
            </Button>
          </>
        }
      />
      <PageBody>
        <AdminPageIntro
          guidance={{
            eyebrow: "Cross-system messaging",
            title: "Bridge & Outbox — the Capavate ↔ Collective event spine",
            description:
              "All cross-system state changes flow through this hash-chained outbox. Every event is HMAC-SHA256 signed, retried with exponential backoff, and idempotent on the consumer side. Use this page to monitor delivery health, verify the chain, drain the queue manually after an incident, and inspect inbound events the Collective has pushed back to Capavate.",
            warning:
              "Dead-lettered events indicate the Collective endpoint refused delivery 5+ times. Investigate before draining; manually emitting an event from here bypasses the standard producer flow and should be used only for replay scenarios.",
            positive:
              "The HMAC envelope means a tampered event is rejected on the consumer side; the priorHash chain means a missing or reordered event is detectable.",
          }}
          stats={[
            { label: "Outbox total", value: out.data?.total ?? 0 },
            { label: "Delivered", value: out.data?.delivered ?? 0, tone: "positive" },
            { label: "Queued", value: out.data?.queued ?? 0, tone: (out.data?.queued ?? 0) > 0 ? "warning" : "neutral" },
            { label: "Dead-lettered", value: out.data?.deadLettered ?? 0, tone: (out.data?.deadLettered ?? 0) > 0 ? "critical" : "neutral" },
            { label: "Chain", value: verify.data?.ok ? "✓ unbroken" : `✗ broken @ ${verify.data?.brokenAt ?? "?"}`, tone: verify.data?.ok ? "positive" : "critical" },
          ]}
        />
        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <Card className="p-4" data-testid="stat-outbound-total">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Outbox total</div>
            <div className="text-xl font-semibold mt-1">{out.data?.total ?? 0}</div>
          </Card>
          <Card className="p-4" data-testid="stat-outbound-delivered">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Delivered</div>
            <div className="text-xl font-semibold mt-1 text-emerald-700">{out.data?.delivered ?? 0}</div>
          </Card>
          <Card className="p-4" data-testid="stat-outbound-queued">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Queued</div>
            <div className="text-xl font-semibold mt-1 text-amber-700">{out.data?.queued ?? 0}</div>
          </Card>
          <Card className="p-4" data-testid="stat-outbound-deadletter">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Dead-letter</div>
            <div className="text-xl font-semibold mt-1 text-rose-700">{out.data?.deadLettered ?? 0}</div>
          </Card>
        </div>

        {/* Chain integrity */}
        <Card className="p-4 mb-5" data-testid="card-chain-integrity">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-emerald-600" />
            <div className="flex-1">
              <div className="text-sm font-semibold">Audit chain verification</div>
              <div className="text-xs text-muted-foreground">priorHash → hash linkage across {verify.data?.totalLinks ?? 0} outbox entries</div>
            </div>
            <Badge
              data-testid="badge-chain-status"
              className={verify.data?.ok ? "bg-emerald-100 text-emerald-800 border-0" : "bg-rose-100 text-rose-800 border-0"}
            >
              {verify.data?.ok ? "INTACT" : `BROKEN AT #${verify.data?.brokenAt}`}
            </Badge>
          </div>
        </Card>

        {/* Event type catalog */}
        <Card className="p-4 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <Network className="h-4 w-4" />
            <h3 className="text-sm font-semibold">Outbound event types · Capavate → Collective</h3>
            <Badge variant="outline" className="ml-auto text-[10px]" data-testid="badge-outbound-count">
              {out.data?.eventTypes.length ?? 0} types
            </Badge>
          </div>
          <div className="mb-3 flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Aggregate ID:</span>
            <Input
              value={aggregateId}
              onChange={e => setAggregateId(e.target.value)}
              placeholder="e.g. co_<id>"
              className="h-7 text-xs max-w-[260px]"
              data-testid="input-bridge-aggregate-id"
            />
            {!aggregateId.trim() && (
              <span className="text-muted-foreground italic">Enter an aggregate ID to enable manual emit.</span>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
            {(out.data?.eventTypes ?? []).map(t => (
              <button
                key={t}
                onClick={() => emit(t)}
                disabled={!aggregateId.trim()}
                data-testid={`button-emit-${t.replace(/\./g, "-")}`}
                className="flex items-center gap-2 px-3 py-2 border border-border rounded text-left hover:bg-accent/30 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Zap className="h-3 w-3 text-muted-foreground" />
                <span className="font-mono">{t}</span>
              </button>
            ))}
          </div>
        </Card>

        <Card className="p-4 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <Network className="h-4 w-4 rotate-180" />
            <h3 className="text-sm font-semibold">Inbound event types · Collective → Capavate</h3>
            <Badge variant="outline" className="ml-auto text-[10px]" data-testid="badge-inbound-count">
              {inb.data?.eventTypes.length ?? 0} types
            </Badge>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            {(inb.data?.eventTypes ?? []).map(t => (
              <div key={t} className="px-3 py-2 border border-border rounded font-mono" data-testid={`tag-inbound-${t.replace(/\./g, "-")}`}>
                {t}
              </div>
            ))}
          </div>
        </Card>

        {/* Outbox table */}
        <Card className="overflow-hidden mb-5">
          <div className="px-4 py-3 border-b border-border bg-card/50">
            <h3 className="text-sm font-semibold">Outbox · most recent</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Event ID</th>
                  <th className="px-3 py-2 text-left font-medium">Type</th>
                  <th className="px-3 py-2 text-left font-medium">Aggregate</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">HMAC</th>
                  <th className="px-3 py-2 text-left font-medium">Hash</th>
                </tr>
              </thead>
              <tbody>
                {(out.data?.entries ?? []).slice().reverse().slice(0, 30).map(e => (
                  <tr key={e.eventId} data-testid={`row-event-${e.eventId}`} className="border-t border-border">
                    <td className="px-3 py-1.5 font-mono">{e.eventId.slice(0, 16)}…</td>
                    <td className="px-3 py-1.5 font-mono text-[11px]">{e.eventType}</td>
                    <td className="px-3 py-1.5">{e.aggregateKind}/{e.aggregateId}</td>
                    <td className="px-3 py-1.5">
                      <Badge
                        data-testid={`status-${e.eventId}`}
                        className={
                          e.status === "delivered" ? "bg-emerald-100 text-emerald-800 border-0" :
                          e.status === "queued" ? "bg-amber-100 text-amber-800 border-0" :
                          e.status === "dead_letter" ? "bg-rose-100 text-rose-800 border-0" :
                          "bg-muted text-foreground border-0"
                        }
                      >
                        {e.status === "delivered" && <Check className="h-2.5 w-2.5 mr-0.5" />}
                        {e.status === "queued" && <Clock className="h-2.5 w-2.5 mr-0.5" />}
                        {e.status === "dead_letter" && <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />}
                        {e.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[10px]">{e.hmac}</td>
                    <td className="px-3 py-1.5 font-mono text-[10px]">{e.hash.slice(0, 12)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Inbox table */}
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-card/50">
            <h3 className="text-sm font-semibold">Inbox · Collective → Capavate</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Event</th>
                  <th className="px-3 py-2 text-left font-medium">Type</th>
                  <th className="px-3 py-2 text-left font-medium">Payload</th>
                </tr>
              </thead>
              <tbody>
                {(inb.data?.entries ?? []).map(e => (
                  <tr key={e.eventId} data-testid={`row-inbound-${e.eventId}`} className="border-t border-border">
                    <td className="px-3 py-1.5 font-mono">{e.eventId.slice(0, 16)}…</td>
                    <td className="px-3 py-1.5 font-mono text-[11px]">{e.eventType}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{JSON.stringify(e.payload).slice(0, 80)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </PageBody>
    </>
  );
}
