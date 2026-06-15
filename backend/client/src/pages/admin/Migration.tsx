/**
 * Sprint 13 — Admin Migration Runner.
 *
 * Mock migration: walks seed data; produces a per-entity dry-run report.
 * Commit fires bridge events to sync to Collective. Idempotent + cursor-resumable.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Database, Play, CheckCircle, RotateCcw, FileUp } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AdminPageIntro } from "@/components/AdminPageIntro";

interface DryRunResp {
  rows: Array<{ entityKey: string; wouldAdd: number; wouldUpdate: number; wouldSkip: number; errors: Array<{ aggregateId: string; reason: string }>; fieldsMapped: string[] }>;
}
interface CommitResp {
  rows: Array<{ entityKey: string; added: number; updated: number; skipped: number; bridgeEventsEmitted: number }>;
  totalAdded: number;
  totalEvents: number;
}
interface MappingResp {
  mapping: Array<{ entityKey: string; fields: Array<{ source: string; canonical: string }> }>;
}

export default function AdminMigration() {
  const qc = useQueryClient();
  const dry = useQuery<DryRunResp>({ queryKey: ["/api/admin/migration/dry-run"] });
  const map = useQuery<MappingResp>({ queryKey: ["/api/admin/migration/mapping"] });
  const [commit, setCommit] = useState<CommitResp | null>(null);
  const [busy, setBusy] = useState(false);

  const runCommit = async () => {
    setBusy(true);
    const r = await apiRequest("POST", "/api/admin/migration/commit");
    const j = await r.json();
    setCommit(j);
    setBusy(false);
    qc.invalidateQueries({ queryKey: ["/api/admin/migration/dry-run"] });
    qc.invalidateQueries({ queryKey: ["/api/admin/sync/overview"] });
  };
  const reset = async () => {
    await apiRequest("POST", "/api/admin/migration/reset-cursor");
    setCommit(null);
    qc.invalidateQueries({ queryKey: ["/api/admin/migration/dry-run"] });
  };

  return (
    <>
      <PageHeader
        title="Migration"
        description="Mock migration mode: walks seed data, produces a per-entity dry-run report, then commits and fires bridge events."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={reset} data-testid="button-migration-reset">
              <RotateCcw className="h-3.5 w-3.5 mr-1" /> Reset cursor
            </Button>
            <Button size="sm" onClick={runCommit} disabled={busy} data-testid="button-migration-commit">
              <Play className="h-3.5 w-3.5 mr-1" /> {busy ? "Committing…" : "Commit migration"}
            </Button>
          </>
        }
      />
      <PageBody>
        <AdminPageIntro
          guidance={{
            eyebrow: "Tenant onboarding & data import",
            title: "Migration — controlled bulk ingest with dry-run before commit",
            description:
              "Walks a Capavate export (in preview mode: seed data) and produces a per-entity dry-run report: how many new records would be added, updated, or skipped, and how many bridge events would be emitted to the Collective. The dry-run is non-destructive. Only `Commit migration` actually writes — and the commit emits one bridge event per new entity so the Collective stays in sync from day one.",
            warning:
              "`Reset cursor` discards the migration's progress marker — use only after a failed commit, never on a successful run. Re-committing without reset is idempotent (skipped rows stay skipped), but a reset followed by commit will re-emit bridge events and may duplicate downstream consumers if they aren't idempotent.",
            positive:
              "Field mapping is canonicalised before commit (legal_name → legalName, etc.) using the registered mapping table. Mappings are versioned and shown below for full auditability.",
          }}
          stats={[
            { label: "Dry-run rows", value: dry.data?.rows?.length ?? 0 },
            { label: "Would add", value: dry.data?.rows?.reduce((n, r) => n + (r.wouldAdd ?? 0), 0) ?? 0, tone: "positive" },
            { label: "Would update", value: dry.data?.rows?.reduce((n, r) => n + (r.wouldUpdate ?? 0), 0) ?? 0 },
            { label: "Would skip", value: dry.data?.rows?.reduce((n, r) => n + (r.wouldSkip ?? 0), 0) ?? 0 },
            { label: "Mappings", value: map.data?.mapping?.length ?? 0, hint: "Entity types" },
          ]}
        />
        {/* Upload (mock — preview-mode in-memory blob only) */}
        <Card className="p-4 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <FileUp className="h-4 w-4" />
            <h3 className="font-semibold text-sm">Upload export</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Preview mode simulates against seed data. In live mode, upload a Capavate export ZIP. File contents stay in memory.
          </p>
          <input type="file" disabled className="text-xs" data-testid="input-migration-upload" />
        </Card>

        {/* Dry-run table */}
        <Card className="p-4 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <Database className="h-4 w-4" />
            <h3 className="font-semibold text-sm">Dry-run preview ({dry.data?.rows.length ?? 0} entities)</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b">
                  <th className="py-1.5 pr-3">Entity</th>
                  <th className="py-1.5 pr-3">Would add</th>
                  <th className="py-1.5 pr-3">Would update</th>
                  <th className="py-1.5 pr-3">Would skip</th>
                  <th className="py-1.5 pr-3">Fields mapped</th>
                  <th className="py-1.5">Errors</th>
                </tr>
              </thead>
              <tbody>
                {(dry.data?.rows ?? []).map(r => (
                  <tr key={r.entityKey} className="border-b border-dashed" data-testid={`row-migration-${r.entityKey}`}>
                    <td className="py-1.5 pr-3 font-mono">{r.entityKey}</td>
                    <td className="py-1.5 pr-3 text-emerald-700">{r.wouldAdd}</td>
                    <td className="py-1.5 pr-3 text-amber-700">{r.wouldUpdate}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground">{r.wouldSkip}</td>
                    <td className="py-1.5 pr-3"><Badge variant="outline">{r.fieldsMapped.length}</Badge></td>
                    <td className="py-1.5">{r.errors.length ? <span className="text-rose-700">{r.errors.length}</span> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Commit results */}
        {commit && (
          <Card className="p-4 mb-5" data-testid="card-migration-results">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle className="h-4 w-4 text-emerald-700" />
              <h3 className="font-semibold text-sm">Commit complete — {commit.totalAdded} rows, {commit.totalEvents} bridge events</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
              {commit.rows.map(r => (
                <div key={r.entityKey} className="flex items-center justify-between text-xs border-b border-dashed py-1.5">
                  <span className="font-mono">{r.entityKey}</span>
                  <div className="flex gap-2">
                    <Badge variant="secondary">+{r.added}</Badge>
                    <Badge variant="outline">~{r.updated}</Badge>
                    <Badge variant="outline">skip {r.skipped}</Badge>
                    <Badge>events {r.bridgeEventsEmitted}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Field mapping preview */}
        <Card className="p-4">
          <h3 className="font-semibold text-sm mb-3">Field mapping (source → canonical)</h3>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {(map.data?.mapping ?? []).map(m => (
              <div key={m.entityKey} className="border-b border-dashed pb-2">
                <div className="text-xs font-mono mb-1">{m.entityKey}</div>
                <div className="flex flex-wrap gap-1">
                  {m.fields.map(f => (
                    <span key={f.source} className="text-[10px] font-mono px-1.5 py-0.5 bg-muted rounded">{f.source} → {f.canonical}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </PageBody>
    </>
  );
}
