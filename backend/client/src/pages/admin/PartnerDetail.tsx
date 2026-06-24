/**
 * v25.0 Track 5 — E7: Admin Partner Detail page.
 *
 * Route: /admin/partners/:id
 *
 * Calls GET /api/admin/partners/:id and
 *        GET /api/admin/partners/:id/workspace/audit
 * Renders: partner summary + team members + notes + tasks + workspace audit.
 */

import { useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
/* v25.12 NL4 — explicit queryFn for the two queries below. */
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input"; /* v25.41 Bug-3 — admin SPV create form */
import { Label } from "@/components/ui/label"; /* v25.41 Bug-3 */
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"; /* v25.41 Bug-3 */
import { useToast } from "@/hooks/use-toast"; /* v25.41 Bug-3 */
import { ArrowLeft, Building2, Users, FileText, CheckSquare, FolderOpen, Layers, Plus } from "lucide-react";
import { Link } from "wouter";

// ── Types ─────────────────────────────────────────────────────────────────

interface PartnerContact {
  id: string;
  kind: string;
  legalName?: string;
  displayName?: string;
  email?: string;
  status?: string;
  tier?: string;
  region?: string;
  partnerType?: string;
}

interface PartnerDetailResp {
  partner: PartnerContact;
}

interface WorkspaceAuditResp {
  ok: boolean;
  partnerId: string;
  partnerStatus: string;
  auditedAt: string;
  teamMembers: Array<{
    id: string;
    sub_role?: string;
    user_id?: string;
    status?: string;
    joined_at?: string;
  }>;
  notes: Array<{
    id: string;
    content?: string;
    text?: string;
    createdAt?: string;
    created_at?: string;
  }>;
  tasks: Array<{
    id: string;
    title?: string;
    status?: string;
    dueDate?: string;
    due_date?: string;
  }>;
  files: Array<{
    id: string;
    name?: string;
    sizeBytes?: number;
    uploadedAt?: string;
  }>;
}

/* v25.41 Bug-3 — admin-created SPV row (subset of PartnerSpv surfaced to admin). */
interface AdminPartnerSpv {
  id: string;
  spvName: string;
  jurisdiction: string;
  vintage: number;
  currency: string;
  status: string;
  recordedAt?: string;
}
interface AdminPartnerSpvsResp {
  ok: boolean;
  spvs: AdminPartnerSpv[];
  total: number;
}

const SPV_STATUSES = ["planned", "open", "closed", "wound_down"] as const;

// ── Page ──────────────────────────────────────────────────────────────────

export default function AdminPartnerDetail() {
  const params = useParams<{ id: string }>();
  const partnerId = params?.id ?? "";
  const { toast } = useToast();

  /* v25.41 Bug-3 — admin SPV creation. DB-driven: the SPV list below is
     fetched live from GET /api/admin/partners/:id/spvs and the create form
     POSTs to the new admin endpoint, which delegates to the existing
     partnerSpvStore.create. Nothing is hardcoded; nothing is held in browser
     memory beyond the transient form draft. */
  const [spvForm, setSpvForm] = useState({
    spvName: "",
    jurisdiction: "",
    vintage: String(new Date().getFullYear()),
    currency: "USD",
    status: "planned" as (typeof SPV_STATUSES)[number],
  });

  const spvsQ = useQuery<AdminPartnerSpvsResp>({
    queryKey: [`/api/admin/partners/${partnerId}/spvs`],
    enabled: !!partnerId,
    queryFn: async () => (await apiRequest("GET", `/api/admin/partners/${partnerId}/spvs`)).json(),
  });

  const createSpvMut = useMutation({
    mutationFn: async () => {
      const vintage = parseInt(spvForm.vintage, 10);
      if (!spvForm.spvName.trim()) throw new Error("SPV name is required");
      if (!spvForm.jurisdiction.trim()) throw new Error("Jurisdiction is required");
      if (!Number.isInteger(vintage)) throw new Error("Vintage must be a year");
      const currency = (spvForm.currency || "USD").trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Currency must be a 3-letter ISO code");
      const r = await apiRequest("POST", `/api/admin/partners/${partnerId}/spvs`, {
        spvName: spvForm.spvName.trim(),
        jurisdiction: spvForm.jurisdiction.trim(),
        vintage,
        currency,
        status: spvForm.status,
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "create_failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/admin/partners/${partnerId}/spvs`] });
      setSpvForm((f) => ({ ...f, spvName: "", jurisdiction: "" }));
      toast({ title: "SPV created" });
    },
    onError: (e: any) => toast({ title: "Create SPV failed", description: e?.message, variant: "destructive" }),
  });

  const partnerQ = useQuery<PartnerDetailResp>({
    /* v25.12 NL4 — explicit queryFn. */
    queryKey: [`/api/admin/partners/${partnerId}`],
    enabled: !!partnerId,
    queryFn: async () => (await apiRequest("GET", `/api/admin/partners/${partnerId}`)).json(),
  });

  const auditQ = useQuery<WorkspaceAuditResp>({
    /* v25.12 NL4 — explicit queryFn. */
    queryKey: [`/api/admin/partners/${partnerId}/workspace/audit`],
    enabled: !!partnerId,
    queryFn: async () => (await apiRequest("GET", `/api/admin/partners/${partnerId}/workspace/audit`)).json(),
  });

  const partner = partnerQ.data?.partner;
  const audit = auditQ.data;

  const name = partner?.displayName || partner?.legalName || partnerId;

  const statusColor = (s?: string) => {
    if (!s) return "secondary";
    if (s === "active") return "default" as const;
    if (s === "archived") return "secondary" as const;
    if (s === "suspended") return "destructive" as const;
    return "secondary" as const;
  };

  return (
    <>
      {/* v25.14 NM11 — /admin/partners is not a registered route in App.tsx.
         Send the back button to the consortium applications page (the admin's
         actual entry point for managing partners) instead of the AdminNotFound
         404 catch-all. */}
      <PageHeader
        title={partnerQ.isPending ? "Loading partner…" : name}
        description={partner?.email ?? ""}
        actions={
          <Link href="/admin/consortium-applications">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to Partners
            </Button>
          </Link>
        }
      />
      <PageBody>
        {partnerQ.isError && (
          <div className="rounded-md bg-destructive/10 text-destructive p-4 text-sm">
            Partner not found or access denied.
          </div>
        )}

        {/* ── Partner Summary ─────────────────────────────────────── */}
        {partner && (
          <Card className="p-5 mb-6">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
                <Building2 className="h-6 w-6 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-semibold truncate">{name}</h2>
                  <Badge variant={statusColor(partner.status)}>{partner.status ?? "unknown"}</Badge>
                  {partner.tier && <Badge variant="outline">{partner.tier}</Badge>}
                  {partner.partnerType && <Badge variant="outline">{partner.partnerType}</Badge>}
                </div>
                <div className="mt-1 text-sm text-muted-foreground space-y-0.5">
                  {partner.email && <p>Email: {partner.email}</p>}
                  {partner.region && <p>Region: {partner.region}</p>}
                  <p className="font-mono text-xs text-muted-foreground/60">ID: {partner.id}</p>
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* ── Workspace Audit Sections ─────────────────────────────── */}
        {/* v25.41 Bug-3 - SPV creation + list (admin parity for partner self-service) */}
        {partner && (
          <Card className="p-5 mb-6" data-testid="admin-partner-spvs">
            <div className="flex items-center gap-2 mb-4">
              <Layers className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-semibold text-sm">
                SPVs ({spvsQ.data?.total ?? 0})
              </h3>
            </div>

            {/* Create form */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 mb-4">
              <div className="space-y-1">
                <Label htmlFor="spv-name" className="text-xs">SPV Name</Label>
                <Input
                  id="spv-name"
                  data-testid="input-spv-name"
                  value={spvForm.spvName}
                  onChange={(e) => setSpvForm((f) => ({ ...f, spvName: e.target.value }))}
                  placeholder="Acme SPV I"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="spv-jurisdiction" className="text-xs">Jurisdiction</Label>
                <Input
                  id="spv-jurisdiction"
                  data-testid="input-spv-jurisdiction"
                  value={spvForm.jurisdiction}
                  onChange={(e) => setSpvForm((f) => ({ ...f, jurisdiction: e.target.value }))}
                  placeholder="Delaware"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="spv-vintage" className="text-xs">Vintage</Label>
                <Input
                  id="spv-vintage"
                  data-testid="input-spv-vintage"
                  inputMode="numeric"
                  value={spvForm.vintage}
                  onChange={(e) => setSpvForm((f) => ({ ...f, vintage: e.target.value }))}
                  placeholder="2026"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="spv-currency" className="text-xs">Currency</Label>
                <Input
                  id="spv-currency"
                  data-testid="input-spv-currency"
                  value={spvForm.currency}
                  onChange={(e) => setSpvForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))}
                  placeholder="USD"
                  maxLength={3}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <Select
                  value={spvForm.status}
                  onValueChange={(v) => setSpvForm((f) => ({ ...f, status: v as (typeof SPV_STATUSES)[number] }))}
                >
                  <SelectTrigger data-testid="select-spv-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SPV_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end mb-4">
              <Button
                size="sm"
                data-testid="button-create-spv"
                onClick={() => createSpvMut.mutate()}
                disabled={createSpvMut.isPending}
              >
                <Plus className="h-4 w-4 mr-1" />
                {createSpvMut.isPending ? "Creating..." : "Create SPV"}
              </Button>
            </div>

            {/* List */}
            {spvsQ.isError && (
              <div className="rounded-md bg-destructive/10 text-destructive p-3 text-sm" data-testid="spv-list-error">
                Could not load SPVs.
              </div>
            )}
            {spvsQ.data && spvsQ.data.spvs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No SPVs yet.</p>
            ) : spvsQ.data ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="spv-table">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="text-left pb-2 pr-4 font-medium">Name</th>
                      <th className="text-left pb-2 pr-4 font-medium">Jurisdiction</th>
                      <th className="text-left pb-2 pr-4 font-medium">Vintage</th>
                      <th className="text-left pb-2 pr-4 font-medium">Currency</th>
                      <th className="text-left pb-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {spvsQ.data.spvs.map((s) => (
                      <tr key={s.id} className="border-b last:border-0" data-testid={`spv-row-${s.id}`}>
                        <td className="py-2 pr-4">{s.spvName}</td>
                        <td className="py-2 pr-4">{s.jurisdiction}</td>
                        <td className="py-2 pr-4">{s.vintage}</td>
                        <td className="py-2 pr-4">{s.currency}</td>
                        <td className="py-2">
                          <Badge variant="outline" className="text-xs">{s.status}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </Card>
        )}

        {auditQ.isPending && (
          <p className="text-sm text-muted-foreground">Loading workspace data…</p>
        )}

        {/* v25.16 NH4 — explicit error branch; previously a failure silently
           rendered an empty page below the partner summary. */}
        {auditQ.isError && (
          <div
            className="rounded-md bg-destructive/10 text-destructive p-4 text-sm"
            data-testid="partner-audit-error"
          >
            Could not load workspace audit data.{" "}
            {(auditQ.error as Error | undefined)?.message ?? ""}
          </div>
        )}

        {audit && (
          <div className="grid gap-6">
            {/* Team Members */}
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <Users className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold text-sm">Team Members ({audit.teamMembers.length})</h3>
              </div>
              {audit.teamMembers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No team members.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left pb-2 pr-4 font-medium">User ID</th>
                        <th className="text-left pb-2 pr-4 font-medium">Role</th>
                        <th className="text-left pb-2 pr-4 font-medium">Status</th>
                        <th className="text-left pb-2 font-medium">Joined</th>
                      </tr>
                    </thead>
                    <tbody>
                      {audit.teamMembers.map((m) => (
                        <tr key={m.id} className="border-b last:border-0">
                          <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">{m.user_id ?? m.id}</td>
                          <td className="py-2 pr-4">{m.sub_role ?? "—"}</td>
                          <td className="py-2 pr-4">
                            <Badge variant={m.status === "active" ? "default" : "secondary"} className="text-xs">
                              {m.status ?? "unknown"}
                            </Badge>
                          </td>
                          <td className="py-2 text-muted-foreground text-xs">
                            {m.joined_at ? new Date(m.joined_at).toLocaleDateString() : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {/* Notes */}
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold text-sm">Notes ({audit.notes.length})</h3>
              </div>
              {audit.notes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No notes.</p>
              ) : (
                <div className="space-y-3">
                  {audit.notes.map((n) => (
                    <div key={n.id} className="rounded-md bg-muted/40 p-3 text-sm">
                      <p>{n.content ?? n.text ?? "(empty)"}</p>
                      {(n.createdAt || n.created_at) && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {new Date(n.createdAt ?? n.created_at ?? "").toLocaleString()}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Tasks */}
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <CheckSquare className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold text-sm">Tasks ({audit.tasks.length})</h3>
              </div>
              {audit.tasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tasks.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left pb-2 pr-4 font-medium">Title</th>
                        <th className="text-left pb-2 pr-4 font-medium">Status</th>
                        <th className="text-left pb-2 font-medium">Due</th>
                      </tr>
                    </thead>
                    <tbody>
                      {audit.tasks.map((t) => (
                        <tr key={t.id} className="border-b last:border-0">
                          <td className="py-2 pr-4">{t.title ?? "—"}</td>
                          <td className="py-2 pr-4">
                            <Badge variant="outline" className="text-xs">{t.status ?? "—"}</Badge>
                          </td>
                          <td className="py-2 text-muted-foreground text-xs">
                            {(t.dueDate || t.due_date) ? new Date(t.dueDate ?? t.due_date ?? "").toLocaleDateString() : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {/* Files */}
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <FolderOpen className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold text-sm">Files ({audit.files.length})</h3>
              </div>
              {audit.files.length === 0 ? (
                <p className="text-sm text-muted-foreground">No files.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left pb-2 pr-4 font-medium">Name</th>
                        <th className="text-left pb-2 pr-4 font-medium">Size</th>
                        <th className="text-left pb-2 font-medium">Uploaded</th>
                      </tr>
                    </thead>
                    <tbody>
                      {audit.files.map((f) => (
                        <tr key={f.id} className="border-b last:border-0">
                          <td className="py-2 pr-4">{f.name ?? f.id}</td>
                          <td className="py-2 pr-4 text-muted-foreground text-xs">
                            {f.sizeBytes != null ? `${(f.sizeBytes / 1024).toFixed(1)} KB` : "—"}
                          </td>
                          <td className="py-2 text-muted-foreground text-xs">
                            {f.uploadedAt ? new Date(f.uploadedAt).toLocaleDateString() : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {/* Audit Meta */}
            <p className="text-xs text-muted-foreground text-right">
              Workspace audited at {new Date(audit.auditedAt).toLocaleString()}
            </p>
          </div>
        )}
      </PageBody>
    </>
  );
}
