import { useState, useMemo } from "react";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Save, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AdminPageIntro } from "@/components/AdminPageIntro";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

const POLICY_DEFS: { key: keyof Defaults; label: string; help: string; default: number }[] = [
  { key: "founderDashboardTenureDays", label: "Founder dashboard tenure (days)", help: "Days a founder remains in the active workspace after last login before archival is offered.", default: 180 },
  { key: "archivalRetentionDays", label: "Archival retention (days)", help: "Soft-archive retention before permanent deletion. Must comply with regional data laws.", default: 3650 },
  { key: "governanceMetricsCadenceDays", label: "Governance metrics cadence (days)", help: "Cadence for board metrics digest delivery.", default: 30 },
  { key: "softCircleExpiryDays", label: "Soft circle expiry (days)", help: "Days before a soft-circle indication of interest auto-lapses.", default: 14 },
  { key: "invitationExpiryDays", label: "Invitation expiry (days)", help: "Days before an investor invitation auto-expires.", default: 21 },
];

type Defaults = {
  founderDashboardTenureDays: number;
  archivalRetentionDays: number;
  governanceMetricsCadenceDays: number;
  softCircleExpiryDays: number;
  invitationExpiryDays: number;
};

const DEFAULT_POLICIES: Defaults = {
  founderDashboardTenureDays: 180,
  archivalRetentionDays: 3650,
  governanceMetricsCadenceDays: 30,
  softCircleExpiryDays: 14,
  invitationExpiryDays: 21,
};

export default function AdminLifecyclePolicies() {
  /* v25.31.1 Wave A #10 — pure durable read. The legacy client-only
     `useAdminStore().auditLog` fallback has been removed. The "Edits (30d)"
     stat is computed from the durable audit_log table only (via
     /api/admin/audit-log?eventType=lifecycle_policy.changed). If the query
     is loading we show 0 with a "Loading…" hint; if it errors we surface
     "Audit log unavailable". No process-local or client-cached state is
     consulted. */
  const { toast } = useToast();
  const [draft, setDraft] = useState<Defaults>(DEFAULT_POLICIES);

  // Load live policies from server
  const policiesQ = useQuery<{ ok: boolean; policies: Defaults }>({
    queryKey: ["/api/admin/lifecycle-policies"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/lifecycle-policies")).json(),
    onSuccess: (data) => setDraft(data.policies),
  } as any);

  /* v25.31.1 Wave A #10 — durable "Edits (30d)" query (DB-only). */
  type AuditRow = { ts: string; eventType?: string; action?: string };
  const auditQ = useQuery<{ count: number; items: AuditRow[] }>({
    queryKey: ["/api/admin/audit-log", { eventType: "lifecycle_policy.changed" }],
    queryFn: async () =>
      (
        await apiRequest(
          "GET",
          "/api/admin/audit-log?eventType=lifecycle_policy.changed",
        )
      ).json(),
  } as any);

  const savedPolicies = policiesQ.data?.policies ?? DEFAULT_POLICIES;

  const saveMut = useMutation({
    mutationFn: async (values: Defaults) =>
      (await apiRequest("PATCH", "/api/admin/lifecycle-policies", values)).json(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/lifecycle-policies"] });
      toast({ title: "Policies saved", description: "Propagated to Capavate + queued for Collective sync via outbox." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // v25.31.1 — dynamic analytics. DB-only "Edits (30d)" — no client-side
  // fallback. If the durable audit_log query is loading we show 0; if it
  // errors the hint text surfaces the error state.
  const stats = useMemo(() => {
    const now = Date.now();
    const thirtyDays = 30 * 24 * 3600 * 1000;
    const serverItems: AuditRow[] = auditQ.data?.items ?? [];
    const recentChanges = serverItems.filter((a) => {
      const kind = a.eventType ?? a.action;
      return kind === "lifecycle_policy.changed" && now - new Date(a.ts).getTime() < thirtyDays;
    }).length;
    const driftCount = POLICY_DEFS.reduce(
      (n, p) => (savedPolicies[p.key] !== p.default ? n + 1 : n),
      0,
    );
    const dirty = POLICY_DEFS.reduce(
      (n, p) => (draft[p.key] !== savedPolicies[p.key] ? n + 1 : n),
      0,
    );
    return { recentChanges, driftCount, dirty };
  }, [auditQ.data, savedPolicies, draft]);

  function resetDefaults() {
    setDraft(DEFAULT_POLICIES);
    toast({ title: "Reset to defaults" });
  }

  const editsHint = auditQ.isError
    ? "Audit log unavailable"
    : auditQ.isLoading
      ? "Loading…"
      : "From the audit log";
  const editsTone: "positive" | "neutral" | "warning" = auditQ.isError
    ? "warning"
    : stats.recentChanges > 0
      ? "positive"
      : "neutral";

  return (
    <>
      <PageHeader
        title="Lifecycle policies"
        description="Tenant-wide thresholds. Saving emits a lifecycle_policy.changed event to the Collective outbox for propagation."
        breadcrumbs={[{ label: "Admin" }, { label: "Lifecycle policies" }]}
        actions={
          <>
            <Button variant="outline" onClick={resetDefaults} data-testid="button-reset" disabled={saveMut.isPending}><RotateCcw className="h-4 w-4 mr-2" /> Reset</Button>
            <Button onClick={() => saveMut.mutate(draft)} data-testid="button-save" disabled={saveMut.isPending} className="bg-[hsl(327_77%_30%)] hover:bg-[hsl(327_77%_24%)] text-white"><Save className="h-4 w-4 mr-2" /> {saveMut.isPending ? "Saving…" : "Save"}</Button>
          </>
        }
      />
      <PageBody>
        <AdminPageIntro
          guidance={{
            eyebrow: "Platform governance",
            title: "Lifecycle policies — the tenant-wide rules every flow obeys",
            description:
              "Set thresholds that govern how founder workspaces age out, when investor invitations expire, how long archived data is retained, and the cadence of board metrics digests. Each save emits a `lifecycle_policy.changed` event to the Collective outbox so the rule propagates platform-wide within minutes.",
            warning:
              "Lowering retention (archivalRetentionDays) below your regional minimum can violate data protection law (GDPR ↑ 5y for fiduciary records, SEC 17a-4 ↑ 6y for broker-dealer comms). Reset to defaults if unsure.",
            positive:
              "Every change is hash-chained into the Audit Log with the actor email and JSON payload. You can roll back at any time by re-applying a previous value.",
          }}
          stats={[
            { label: "Active policies", value: POLICY_DEFS.length, hint: "Tenant-wide rules" },
            { label: "Edits (30d)", value: stats.recentChanges, hint: editsHint, tone: editsTone },
            { label: "Drift from defaults", value: stats.driftCount, hint: "Policies overridden", tone: stats.driftCount > 0 ? "warning" : "neutral" },
            { label: "Unsaved on this page", value: stats.dirty, hint: "Click Save to apply", tone: stats.dirty > 0 ? "warning" : "neutral" },
          ]}
        />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {POLICY_DEFS.map((p) => (
            <Card key={p.key}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{p.label}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Threshold</Label>
                <Input
                  type="number"
                  value={draft[p.key]}
                  onChange={(e) => setDraft({ ...draft, [p.key]: parseInt(e.target.value) || 0 })}
                  data-testid={`input-${p.key}`}
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">{p.help}</p>
                <p className="text-[10px] text-muted-foreground">Default: {p.default}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </PageBody>
    </>
  );
}
