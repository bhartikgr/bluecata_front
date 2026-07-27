/**
 * Client detail — read-only deep dive on a single attributed company, PLUS the
 * separate Partner Clients CRM controls (durable stage + activity timeline).
 * The company snapshot is still fetched read-only via the existing engine API;
 * this page never mutates engine/cap-table state. The only writes here go to
 * the parallel partner-clients CRM (stage transition / timeline note).
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useRoute } from "wouter";
import { PartnerShell } from "@/components/partner/PartnerShell";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { formatMinor } from "@/lib/currency";
import {
  PARTNER_CLIENT_STAGES,
  PARTNER_CLIENT_STAGE_LABELS,
  PARTNER_CLIENT_DEFAULT_STAGE,
  type PartnerClientStage,
} from "@shared/crmStages";

interface CrmActivity {
  id: string;
  activityType: string;
  body: string | null;
  actorUserId: string | null;
  occurredAt: string;
}
interface CrmData {
  companyId: string;
  stage: PartnerClientStage;
  /** w-partner F3 — designated partner-team member owning this client. */
  leadUserId: string | null;
  activity: CrmActivity[];
}
interface TeamMember {
  userId: string;
  name: string;
  email: string | null;
  subRole: string;
}

/* w-partner F3 — assigning the lead is a managing_partner/associate decision,
   matching the server guard on PATCH …/client-crm/:companyId/lead. */
const LEAD_ASSIGN_ROLES = ["managing_partner", "associate"];
const LEAD_NONE = "__none__";

export default function PartnerClientDetail() {
  const role = useRequirePartnerRole();
  const [, params] = useRoute("/collective/partner/clients/:id");
  const id = params?.id ?? "";
  const qc = useQueryClient();
  const { toast } = useToast();
  const [note, setNote] = useState("");

  /* v25.12 NM4 — canonical queryKey convention (`["/api/partner/me/clients", id]`). */
  const q = useQuery({
    queryKey: ["/api/partner/me/clients", id],
    enabled: role.ready && !!id,
    queryFn: async () => (await apiRequest("GET", `/api/partner/me/clients/${id}`)).json(),
  });

  /* v25.49 Phase-3A — separate partner-clients CRM: durable stage + timeline. */
  const crmQ = useQuery<CrmData>({
    queryKey: ["/api/partner/me/client-crm", id],
    enabled: role.ready && !!id,
    queryFn: async () => (await apiRequest("GET", `/api/partner/me/client-crm/${id}`)).json(),
  });

  const setStage = useMutation({
    mutationFn: async (stage: PartnerClientStage) =>
      (await apiRequest("PATCH", `/api/partner/me/client-crm/${id}`, { stage })).json(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/partner/me/client-crm", id] }),
    onError: (e: Error) => toast({ variant: "destructive", title: "Could not update stage", description: e.message }),
  });

  /* w-partner F3 — roster for the lead picker. The server rejects anyone who is
     not an ACTIVE member of this partner, and this endpoint already returns
     exactly that set, so the options and the validation agree. */
  const teamQ = useQuery<{ members: TeamMember[] }>({
    queryKey: ["/api/partner/me/team"],
    enabled: role.ready,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/team")).json(),
  });

  const setLead = useMutation({
    mutationFn: async (leadUserId: string | null) =>
      (await apiRequest("PATCH", `/api/partner/me/client-crm/${id}/lead`, { leadUserId })).json(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/partner/me/client-crm", id] }),
    onError: (e: Error) => toast({ variant: "destructive", title: "Could not assign lead", description: e.message }),
  });

  const addNote = useMutation({
    mutationFn: async (body: string) =>
      (await apiRequest("POST", `/api/partner/me/client-crm/${id}/activity`, { body })).json(),
    onSuccess: () => {
      setNote("");
      qc.invalidateQueries({ queryKey: ["/api/partner/me/client-crm", id] });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Could not add note", description: e.message }),
  });

  if (!role.ready || !role.identity) return null;
  const canWrite = role.identity.subRole !== "viewer";
  const canAssignLead = LEAD_ASSIGN_ROLES.includes(role.identity.subRole);
  const stage = crmQ.data?.stage ?? PARTNER_CLIENT_DEFAULT_STAGE;
  const leadUserId = crmQ.data?.leadUserId ?? null;
  const teamMembers = teamQ.data?.members ?? [];
  const activity = crmQ.data?.activity ?? [];
  const snapshot = q.data?.snapshot;
  /* v25.49 Phase-3A — honest cap-table state. The partner surface has no
     ownership ledger read scope; instead we surface the real read-only company
     financials the engine already returns (valuation / last raise), so the card
     shows genuine data instead of a heading with nothing under it. */
  const hasFinancials =
    !!snapshot &&
    (snapshot.valuationMinor != null || snapshot.lastRaiseAmount != null || snapshot.lastRaiseDate != null);

  return (
    <PartnerShell title="Client" tier={role.identity.tier} subRole={role.identity.subRole} partnerName={role.identity.identity.name}>
      <div className="text-xs text-[var(--cv-color-text-muted)] mb-3" data-testid="client-id">{id}</div>
      {/* v25.15 NM13b — explicit loading + error UI. */}
      {q.isLoading && (
        <div className="text-sm text-[var(--cv-color-text-muted)] mb-3" data-testid="client-detail-loading">Loading…</div>
      )}
      {q.isError && (
        <div
          className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"
          data-testid="client-detail-error"
        >
          Client not found or not attributed to your firm.
        </div>
      )}
      {q.data && !q.isError && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card data-testid="client-overview">
            <CardHeader><CardTitle className="text-sm">Overview</CardTitle></CardHeader>
            <CardContent>
              <div className="text-xs space-y-1">
                <div>Sector: <span className="text-[var(--cv-color-text-muted)]">{snapshot?.sector ?? "—"}</span></div>
                <div>Company stage: <span className="text-[var(--cv-color-text-muted)]">{snapshot?.stage ?? "—"}</span></div>
                <div>Attribution: <span className="text-[var(--cv-color-text-muted)]">{q.data.attribution?.attributionSource ?? "—"}</span></div>
              </div>
            </CardContent>
          </Card>

          {/* v25.49 Phase-3A — CRM stage control (separate partner-clients engine). */}
          <Card data-testid="client-crm-stage">
            <CardHeader><CardTitle className="text-sm">CRM stage</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <select
                  value={stage}
                  disabled={!canWrite || setStage.isPending}
                  onChange={(e) => setStage.mutate(e.target.value as PartnerClientStage)}
                  className="rounded-md border border-[var(--cv-color-border)] px-3 py-2 text-sm disabled:opacity-60"
                  data-testid="client-crm-stage-select"
                >
                  {PARTNER_CLIENT_STAGES.map((s) => (
                    <option key={s} value={s}>{PARTNER_CLIENT_STAGE_LABELS[s]}</option>
                  ))}
                </select>
                {setStage.isPending && <span className="text-xs text-[var(--cv-color-text-muted)]">Saving…</span>}
              </div>
              {!canWrite && (
                <div className="text-xs text-[var(--cv-color-text-muted)] mt-2">Your role has read-only access to the CRM stage.</div>
              )}
            </CardContent>
          </Card>

          {/* w-partner F3 — designated lead. Additive card; the stage control
             above is unchanged. */}
          <Card data-testid="client-crm-lead">
            <CardHeader><CardTitle className="text-sm">Designated lead</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <select
                  value={leadUserId ?? LEAD_NONE}
                  disabled={!canAssignLead || setLead.isPending || teamQ.isLoading}
                  onChange={(e) =>
                    setLead.mutate(e.target.value === LEAD_NONE ? null : e.target.value)
                  }
                  className="rounded-md border border-[var(--cv-color-border)] px-3 py-2 text-sm disabled:opacity-60"
                  data-testid="client-crm-lead-select"
                >
                  <option value={LEAD_NONE}>— No lead assigned —</option>
                  {teamMembers.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name}{m.email ? ` (${m.email})` : ""}
                    </option>
                  ))}
                </select>
                {setLead.isPending && <span className="text-xs text-[var(--cv-color-text-muted)]">Saving…</span>}
              </div>
              {!canAssignLead && (
                <div className="text-xs text-[var(--cv-color-text-muted)] mt-2" data-testid="client-crm-lead-readonly">
                  Only a managing partner or associate can assign the client lead.
                </div>
              )}
            </CardContent>
          </Card>

          {/* v25.49 Phase-3A — honest cap-table card: show the real read-only
             financials the engine returns, or an explicit "not available" state
             instead of a heading with no data under it. */}
          <Card data-testid="client-captable">
            <CardHeader><CardTitle className="text-sm">Company financials (read-only)</CardTitle></CardHeader>
            <CardContent>
              {hasFinancials ? (
                <div className="text-xs space-y-1" data-testid="client-captable-data">
                  <div>Valuation: <span className="text-[var(--cv-color-text-muted)]">{snapshot?.valuationMinor != null ? formatMinor(snapshot.valuationMinor, "USD", { locale: "en-US" }) + " USD" : "—"}</span></div>
                  <div>Last raise: <span className="text-[var(--cv-color-text-muted)]">{snapshot?.lastRaiseAmount != null ? formatMinor(snapshot.lastRaiseAmount, "USD", { locale: "en-US" }) + " USD" : "—"}</span></div>
                  <div>Last raise date: <span className="text-[var(--cv-color-text-muted)]">{snapshot?.lastRaiseDate ? new Date(snapshot.lastRaiseDate).toLocaleDateString() : "—"}</span></div>
                  <div className="text-[var(--cv-color-text-faint)] pt-1">Detailed cap table is editable only by the founder in Capavate's frozen engine.</div>
                </div>
              ) : (
                <div className="text-xs text-[var(--cv-color-text-muted)]" data-testid="client-captable-empty">
                  No read-only financials are shared for this company yet. Cap-table detail is available to the founder inside Capavate's engine.
                </div>
              )}
            </CardContent>
          </Card>

          {/* v25.49 Phase-3A — activity timeline (stage changes + notes). */}
          <Card className="md:col-span-2" data-testid="client-activity">
            <CardHeader><CardTitle className="text-sm">Activity timeline</CardTitle></CardHeader>
            <CardContent>
              {canWrite && (
                <div className="flex gap-2 mb-3">
                  <Input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Add a timeline note…"
                    className="max-w-md"
                    data-testid="client-activity-note-input"
                  />
                  <Button
                    disabled={!note.trim() || addNote.isPending}
                    onClick={() => addNote.mutate(note.trim())}
                    data-testid="client-activity-add"
                  >
                    Add
                  </Button>
                </div>
              )}
              {activity.length === 0 && <div className="text-xs text-[var(--cv-color-text-muted)]" data-testid="client-activity-empty">No activity yet.</div>}
              <ul className="text-xs space-y-2" data-testid="client-activity-list">
                {activity.map((a) => (
                  <li key={a.id} className="border-b pb-1" data-testid={`client-activity-${a.id}`}>
                    <span className="text-[var(--cv-color-text-faint)] mr-2">{a.occurredAt ? new Date(a.occurredAt).toLocaleString() : "—"}</span>
                    <span className="text-[var(--cv-color-navy)] font-medium mr-2">{a.activityType}</span>
                    <span className="text-[var(--cv-color-text-secondary)]">{a.body}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card className="md:col-span-2" data-testid="client-notes">
            <CardHeader><CardTitle className="text-sm">Notes</CardTitle></CardHeader>
            <CardContent>
              {(!q.data.notes || q.data.notes.length === 0) && <div className="text-xs text-[var(--cv-color-text-muted)]">No notes for this client yet.</div>}
              <ul className="text-xs space-y-2">
                {(q.data.notes ?? []).map((n: { id: string; title: string; body: string }) => (
                  <li key={n.id} className="border-b pb-1">
                    <div className="font-medium">{n.title}</div>
                    <div className="text-[var(--cv-color-text-secondary)]">{n.body}</div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}
    </PartnerShell>
  );
}
