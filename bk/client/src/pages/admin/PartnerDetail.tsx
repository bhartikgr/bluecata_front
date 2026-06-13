/**
 * v25.0 Track 5 — E7: Admin Partner Detail page.
 *
 * Route: /admin/partners/:id
 *
 * Calls GET /api/admin/partners/:id and
 *        GET /api/admin/partners/:id/workspace/audit
 * Renders: partner summary + team members + notes + tasks + workspace audit.
 */

import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Building2, Users, FileText, CheckSquare, FolderOpen } from "lucide-react";
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

// ── Page ──────────────────────────────────────────────────────────────────

export default function AdminPartnerDetail() {
  const params = useParams<{ id: string }>();
  const partnerId = params?.id ?? "";

  const partnerQ = useQuery<PartnerDetailResp>({
    queryKey: [`/api/admin/partners/${partnerId}`],
    enabled: !!partnerId,
  });

  const auditQ = useQuery<WorkspaceAuditResp>({
    queryKey: [`/api/admin/partners/${partnerId}/workspace/audit`],
    enabled: !!partnerId,
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
      <PageHeader
        title={partnerQ.isPending ? "Loading partner…" : name}
        description={partner?.email ?? ""}
        actions={
          <Link href="/admin/partners">
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
        {auditQ.isPending && (
          <p className="text-sm text-muted-foreground">Loading workspace data…</p>
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
