/**
 * v25.0 Track 5 — E8: Admin Bridge History page.
 *
 * Route: /admin/bridge-history
 *
 * Calls GET /api/admin/bridge/history
 * Renders a table: timestamp, type, payload (collapsed JSON), processed_at.
 * Filter by type. Default limit 100.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { useState as useLocalState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────

interface BridgeHistoryEntry {
  eventId: string;
  eventType: string;
  aggregateId: string;
  aggregateKind: string;
  status: string;
  attempts: number;
  lastError: string | null;
  enqueuedAt: string;
  resolvedAt: string | null;
}

interface BridgeHistoryResp {
  total: number;
  limit: number;
  entries: BridgeHistoryEntry[];
}

// ── Collapsed JSON viewer ─────────────────────────────────────────────────

function CollapsibleJson({ data }: { data: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const json = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const preview = json.length > 80 ? json.slice(0, 80) + "…" : json;

  if (json.length <= 80) {
    return <code className="text-xs text-muted-foreground">{json}</code>;
  }

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {expanded ? "Collapse" : preview}
      </button>
      {expanded && (
        <pre className="mt-2 rounded bg-muted/50 p-2 text-xs overflow-x-auto max-h-48">{json}</pre>
      )}
    </div>
  );
}

// ── Status badge helpers ──────────────────────────────────────────────────

function statusVariant(s: string): "default" | "secondary" | "destructive" | "outline" {
  if (s === "delivered" || s === "resolved") return "default";
  if (s === "dead_letter" || s === "failed") return "destructive";
  if (s === "queued") return "secondary";
  return "outline";
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function AdminBridgeHistory() {
  const qc = useQueryClient();
  const [typeFilter, setTypeFilter] = useState("");
  const [limit, setLimit] = useState(100);

  const histQ = useQuery<BridgeHistoryResp>({
    queryKey: [`/api/admin/bridge/history?limit=${limit}`],
  });

  const entries = histQ.data?.entries ?? [];

  const filtered = typeFilter.trim()
    ? entries.filter((e) =>
        e.eventType.toLowerCase().includes(typeFilter.trim().toLowerCase())
      )
    : entries;

  const uniqueTypes = Array.from(new Set(entries.map((e) => e.eventType))).sort();

  return (
    <>
      <PageHeader
        title="Bridge Event History"
        description="Resolved bridge events (circular buffer, last 1000). Filter by event type."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => qc.invalidateQueries({ queryKey: [`/api/admin/bridge/history?limit=${limit}`] })}
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
        }
      />
      <PageBody>
        {/* ── Controls ─────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-3 mb-5">
          <Input
            placeholder="Filter by event type…"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="w-64"
          />
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value={50}>Last 50</option>
            <option value={100}>Last 100</option>
            <option value={250}>Last 250</option>
            <option value={500}>Last 500</option>
            <option value={1000}>Last 1000</option>
          </select>
        </div>

        {/* ── Type Quick-Filter Pills ───────────────────────────────── */}
        {uniqueTypes.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            <Button
              variant={typeFilter === "" ? "default" : "outline"}
              size="sm"
              className="h-6 text-xs"
              onClick={() => setTypeFilter("")}
            >
              All ({entries.length})
            </Button>
            {uniqueTypes.map((t) => (
              <Button
                key={t}
                variant={typeFilter === t ? "default" : "outline"}
                size="sm"
                className="h-6 text-xs"
                onClick={() => setTypeFilter(typeFilter === t ? "" : t)}
              >
                {t} ({entries.filter((e) => e.eventType === t).length})
              </Button>
            ))}
          </div>
        )}

        {/* ── Table ────────────────────────────────────────────────── */}
        {histQ.isPending && (
          <p className="text-sm text-muted-foreground">Loading bridge history…</p>
        )}

        {histQ.isError && (
          <div className="rounded-md bg-destructive/10 text-destructive p-4 text-sm">
            Failed to load bridge history. Is the server running?
          </div>
        )}

        {histQ.isSuccess && filtered.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {typeFilter ? `No events matching "${typeFilter}".` : "No resolved bridge events found."}
          </p>
        )}

        {histQ.isSuccess && filtered.length > 0 && (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Timestamp</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Type</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Aggregate</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Attempts</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Processed At</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e) => (
                    <tr key={e.eventId} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {e.enqueuedAt ? new Date(e.enqueuedAt).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{e.eventType}</code>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-xs">
                          <span className="text-muted-foreground">{e.aggregateKind}/</span>
                          <span className="font-mono">{e.aggregateId}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={statusVariant(e.status)} className="text-xs">
                          {e.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-muted-foreground">
                        {e.attempts}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {e.resolvedAt ? new Date(e.resolvedAt).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        {e.lastError ? (
                          <CollapsibleJson data={e.lastError} />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t bg-muted/20 text-xs text-muted-foreground">
              Showing {filtered.length} of {histQ.data?.total ?? entries.length} events
              {histQ.data?.limit && ` (limit: ${histQ.data.limit})`}
            </div>
          </Card>
        )}
      </PageBody>
    </>
  );
}
