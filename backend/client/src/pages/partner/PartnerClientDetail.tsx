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
/* WAVE 87 · ITEM 1 — a DATE-ONLY value must not be parsed by `new Date()`:
   `new Date("2026-06-15")` is UTC midnight, which prints ONE DAY EARLY in every
   zone west of UTC (the owner is in New York). `fmtLocaleDate` keeps the exact
   rendered format of the call it replaces and removes only the shift.
   Shape evidence for each field is in build_log/wave87/W87_DATE_CENSUS.md §2. */
import { fmtLocaleDate } from "@/lib/format";
import {
  PARTNER_CLIENT_STAGES,
  PARTNER_CLIENT_STAGE_LABELS,
  PARTNER_CLIENT_DEFAULT_STAGE,
  type PartnerClientStage,
} from "@shared/crmStages";
/* WAVE 179 · ITEM A · R151.1 — the jurisdiction vocabulary is the canonical engine's
   own, so this panel cannot offer a jurisdiction the vehicle table cannot record. */
import { SPV_JURISDICTIONS, SPV_JURISDICTION_LABELS } from "@shared/spvEngine";
/* WAVE 179 · ITEM B · R151.3 — the OPTIONAL legal form. Options come from the
   wave-175 research per jurisdiction and are EMPTY for the nine jurisdictions whose
   tax treatment does not depend on legal form. */
import {
  spvLegalFormOptions,
  SPV_LEGAL_FORM_LABELS,
  SPV_LEGAL_FORM_NOT_STATED_LABEL,
  SPV_LEGAL_FORM_OPTIONAL_HINT,
  SPV_LEGAL_FORM_NOT_OFFERED_NOTICE,
  SPV_LEGAL_FORM_FIELD_LABEL,
  SPV_LEGAL_FORM_UNSTATED_SENTINEL,
} from "@shared/spvLegalForm";
import { describeFailure } from "@/lib/failureMessage";

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
  /** WAVE 282 — whether `stage` above was READ or DEFAULTED. Optional so a
   *  server that predates this field is treated as "read", not as failed. */
  stagesAvailable?: boolean;
}
interface TeamMember {
  userId: string;
  name: string;
  email: string | null;
  subRole: string;
}

/* WAVE 30 ENGINE 1 — partner_crm_contact_client_scope. A firm-wide CRM contact
   (Layer 1) scoped onto THIS client engagement (Layer 2). The engine's DDL has
   existed since migration 0134 with no reader, no writer and no surface; this
   card is the surface. */
interface ClientScope {
  id: string;
  partnerCrmContactId: string;
  scopedByUserId: string;
  scopedAt: string;
  contactName: string;
  contactEmail: string;
  contactRole: string;
  contactOrg: string;
}
interface ScopableContact {
  id: string;
  name: string;
  email: string;
  role: string;
  org: string;
}
interface ClientScopeData {
  companyId: string;
  scopes: ClientScope[];
  availableContacts: ScopableContact[];
}

/* Scoping a contact onto a client is a pipeline-editing act, so it carries the
   same three sub-roles the server gate asserts on POST/DELETE
   /api/partner/me/crm-client-scope. Declared to MATCH the server, not to replace
   it — the server refuses a viewer regardless of what this constant says. */
const SCOPE_WRITE_ROLES = ["managing_partner", "associate", "bd"];
const SCOPE_PICK_NONE = "__pick__";

/* w-partner F3 — assigning the lead is a managing_partner/associate decision,
   matching the server guard on PATCH …/client-crm/:companyId/lead. */
const LEAD_ASSIGN_ROLES = ["managing_partner", "associate"];
const LEAD_NONE = "__none__";

/* ══ WAVE 179 · ITEM A · R151.1 — "CREATE SPV FOR THIS MANAGED CLIENT" ═══════
   R149.4 recorded that a GP looking at a managed client had no way to start a
   vehicle for them. Wave 178 established that the BACKEND already persists
   `spv.target_company_id` end-to-end, so this is a missing affordance and not a
   missing capability — and this panel is deliberately NOT a second wizard.

   It posts to the SAME endpoint the existing SPV list screen posts to,
   `POST /api/partner/me/spvs` (`PartnerSpvs.tsx:146`), which shims through the
   canonical engine so no vehicle is ever created outside it. The one difference is
   that `targetCompanyId` is not typed by the user: it is THIS PAGE'S company, taken
   from the route, so the vehicle is pre-associated by construction and a GP cannot
   fat-finger another company's identifier.

   The five-step wizard (`PartnerSpvEngine.tsx`) is untouched and is still the place
   to configure fees, mandate and terms; a link to it is offered below rather than
   its contents being copied here.

   The server route is `assertSubRole("managing_partner")`, so anyone else could only
   ever be refused 403. Nothing is hidden: the panel renders, the submit is disabled
   and the REASON is a plain sentence — the same treatment `PartnerSpvs.tsx` gives
   the same gate. */
const SPV_CREATE_ROLES = ["managing_partner"];

interface ClientSpv {
  id: string;
  name: string;
  spvType: string;
  status: string;
  jurisdiction: string;
  currency: string;
  targetRaiseMinor: number | null;
  targetCompanyId: string | null;
  createdAt: string;
}

/** The vintage the server's `isNumber(vintage)` guard expects, as a string. */
function currentVintageYear(): string {
  return String(new Date().getFullYear());
}

export default function PartnerClientDetail() {
  const role = useRequirePartnerRole();
  const [, params] = useRoute("/collective/partner/clients/:id");
  const id = params?.id ?? "";
  const qc = useQueryClient();
  const { toast } = useToast();
  const [note, setNote] = useState("");
  /* WAVE 30 ENGINE 1 — selection state for the "scope a contact" picker. */
  const [scopePick, setScopePick] = useState<string>(SCOPE_PICK_NONE);
  /* WAVE 178 · ITEM B — the server answers a repeat link with `201` on a real
     create and `200 { created: false }` when the contact was ALREADY scoped to
     this client (partnerCrmContactClientScopeRoutes.ts:149). Before this wave
     both looked identical on screen: the picker reset and nothing said why no new
     row appeared. A stated outcome is the point of R141/R144, so the idempotent
     case now says so in the panel. Cleared on the next successful create. */
  const [scopeAlreadyLinked, setScopeAlreadyLinked] = useState(false);
  /* WAVE 179 · ITEM A — the create-for-this-client form. `vintage` and the two
     sign-off fields are here because the server REQUIRES them
     (`partnerRoutes.ts` legacy create: `isNumber(vintage)`, then
     `SIGNOFF_LEGAL_NAME_REQUIRED` / `SIGNOFF_ATTESTATION_REQUIRED`); without them
     this panel could only ever 400. Each has a visible, editable control below —
     no value is smuggled into the payload as a hidden constant, and the assent is
     per-vehicle and never carried over to the next one. `targetCompanyId` is the
     ONE exception and it is not a smuggled value: it is the company this page is
     about, shown read-only in the panel. */
  const [spvForm, setSpvForm] = useState({
    spvName: "",
    jurisdiction: "delaware",
    currency: "USD",
    vintage: currentVintageYear(),
    legalForm: SPV_LEGAL_FORM_UNSTATED_SENTINEL,
    signoffLegalName: "",
    signoffAccepted: false,
  });
  const [spvFormOpen, setSpvFormOpen] = useState(false);

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
    onError: (e: Error) => toast({ variant: "destructive", title: "Could not update stage", description: describeFailure(e, "write") }),
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
    onError: (e: Error) => toast({ variant: "destructive", title: "Could not assign lead", description: describeFailure(e, "write") }),
  });

  /* WAVE 30 ENGINE 1 — contacts scoped to this client, plus the DB-driven
     roster of this partner's contacts not yet scoped to it. Both come from the
     server in one request; nothing here is a hardcoded or client-filtered list. */
  const scopeQ = useQuery<ClientScopeData>({
    queryKey: ["/api/partner/me/crm-client-scope/by-company", id],
    enabled: role.ready && !!id,
    queryFn: async () =>
      (await apiRequest("GET", `/api/partner/me/crm-client-scope/by-company/${id}`)).json(),
  });

  const addScope = useMutation({
    mutationFn: async (contactId: string) =>
      (
        await apiRequest("POST", "/api/partner/me/crm-client-scope", { contactId, companyId: id })
      ).json(),
    onSuccess: (result: { created?: boolean } | null) => {
      setScopePick(SCOPE_PICK_NONE);
      /* WAVE 178 · ITEM B — see the note on `scopeAlreadyLinked`. */
      setScopeAlreadyLinked(result?.created === false);
      qc.invalidateQueries({ queryKey: ["/api/partner/me/crm-client-scope/by-company", id] });
    },
    onError: (e: Error) =>
      toast({ variant: "destructive", title: "Could not scope contact", description: describeFailure(e, "write") }),
  });

  const removeScope = useMutation({
    mutationFn: async (scopeId: string) =>
      (await apiRequest("DELETE", `/api/partner/me/crm-client-scope/${scopeId}`)).json(),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["/api/partner/me/crm-client-scope/by-company", id] }),
    onError: (e: Error) =>
      toast({ variant: "destructive", title: "Could not remove contact", description: describeFailure(e, "write") }),
  });

  /* ══ WAVE 179 · ITEM A · R151.1 — THE READ-BACK ════════════════════════
     The vehicles listed below come from THIS query against persisted data, never
     from the create mutation's response. On success the mutation invalidates this
     key and says nothing itself, so what appears on screen has been through
     SQLite and back — which is what "prove it survives a refetch" means. */
  const spvsQ = useQuery<{ companyId: string; spvs: ClientSpv[] }>({
    queryKey: ["/api/partner/me/clients", id, "spvs"],
    enabled: role.ready && !!id,
    queryFn: async () => (await apiRequest("GET", `/api/partner/me/clients/${id}/spvs`)).json(),
  });

  const createSpvForClient = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("POST", "/api/partner/me/spvs", {
          spvName: spvForm.spvName.trim(),
          jurisdiction: spvForm.jurisdiction,
          vintage: parseInt(spvForm.vintage, 10) /* a four-digit calendar YEAR, not money */,
          status: "planned",
          currency: spvForm.currency,
          /* THE POINT OF THE WHOLE ITEM: the client is pre-associated. */
          targetCompanyId: id,
          /* WAVE 179 · ITEM B — OPTIONAL. The sentinel is translated to `null`, which
             the server stores as NOT STATED. It is never translated to a guess. */
          legalForm: spvForm.legalForm === SPV_LEGAL_FORM_UNSTATED_SENTINEL ? null : spvForm.legalForm,
          signoffLegalName: spvForm.signoffLegalName,
          signoffAccepted: spvForm.signoffAccepted,
        })
      ).json(),
    onSuccess: () => {
      setSpvForm({
        spvName: "",
        jurisdiction: "delaware",
        currency: "USD",
        vintage: currentVintageYear(),
        legalForm: SPV_LEGAL_FORM_UNSTATED_SENTINEL,
        signoffLegalName: "",
        signoffAccepted: false,
      });
      setSpvFormOpen(false);
      /* Read back from the database. Nothing optimistic is written into the list. */
      qc.invalidateQueries({ queryKey: ["/api/partner/me/clients", id, "spvs"] });
    },
    onError: (e: Error) =>
      toast({ variant: "destructive", title: "Could not create the vehicle", description: describeFailure(e, "write") }),
  });

  const addNote = useMutation({
    mutationFn: async (body: string) =>
      (await apiRequest("POST", `/api/partner/me/client-crm/${id}/activity`, { body })).json(),
    onSuccess: () => {
      setNote("");
      qc.invalidateQueries({ queryKey: ["/api/partner/me/client-crm", id] });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Could not add note", description: describeFailure(e, "write") }),
  });

  if (!role.ready || !role.identity) return null;
  const canWrite = role.identity.subRole !== "viewer";
  const canAssignLead = LEAD_ASSIGN_ROLES.includes(role.identity.subRole);
  /* ════════════════════════════════════════════════════════════════════════
     WAVE 282 — THE SECOND SURFACE. Same defect, same page family.
     ════════════════════════════════════════════════════════════════════════
     `crmQ.data?.stage ?? DEFAULT` put "Prospect" into the SELECT'S VALUE on a
     failed or pending read — worse than the badge on the list page, because a
     select showing a value invites a save of a stage nobody chose. The select
     keeps every option and is DISABLED rather than unmounted (removing it
     would be a silent drop of a real control), and the reason is stated as a
     sibling beneath it. */
  const stageReadFailed = crmQ.isError || crmQ.data?.stagesAvailable === false;
  const stageReady = !stageReadFailed && crmQ.data != null;
  const stage = crmQ.data?.stage ?? PARTNER_CLIENT_DEFAULT_STAGE;
  const leadUserId = crmQ.data?.leadUserId ?? null;
  const teamMembers = teamQ.data?.members ?? [];
  const activity = crmQ.data?.activity ?? [];
  const snapshot = q.data?.snapshot;
  /* WAVE 30 ENGINE 1 — scoped-contact state. */
  const canScope = SCOPE_WRITE_ROLES.includes(role.identity.subRole);
  const scopes = scopeQ.data?.scopes ?? [];
  const scopableContacts = scopeQ.data?.availableContacts ?? [];
  /* WAVE 179 · ITEM A — vehicles already attributed to this client, from the DB. */
  const canCreateSpv = SPV_CREATE_ROLES.includes(role.identity.subRole);
  const clientSpvs = spvsQ.data?.spvs ?? [];
  /* WAVE 179 · ITEM B — which legal forms this jurisdiction actually has. Empty for
     the nine jurisdictions wave 175 found are not legal-form dependent; the picker is
     then not offered at all and the reason is stated. */
  const spvLegalFormChoices = spvLegalFormOptions(spvForm.jurisdiction);
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
                  value={stageReady ? stage : ""}
                  disabled={!canWrite || setStage.isPending || !stageReady}
                  onChange={(e) => setStage.mutate(e.target.value as PartnerClientStage)}
                  className="rounded-md border border-[var(--cv-color-border)] px-3 py-2 text-sm disabled:opacity-60"
                  data-testid="client-crm-stage-select"
                >
                  {PARTNER_CLIENT_STAGES.map((s) => (
                    <option key={s} value={s}>{PARTNER_CLIENT_STAGE_LABELS[s]}</option>
                  ))}
                  {/* WAVE 282 — appended LAST inside the list, so no existing
                      option's position moves. A controlled <select> whose value
                      matches no option would otherwise silently snap to the
                      first one, which is the fabrication all over again. */}
                  {!stageReady && <option value="">{stageReadFailed ? "stage could not be read" : "stage not read yet"}</option>}
                </select>
                {setStage.isPending && <span className="text-xs text-[var(--cv-color-text-muted)]">Saving…</span>}
              </div>
              {!canWrite && (
                <div className="text-xs text-[var(--cv-color-text-muted)] mt-2">Your role has read-only access to the CRM stage.</div>
              )}
              {/* WAVE 282 — appended after the existing read-only note, never
                  in place of it; the two can be true at the same time. */}
              {stageReadFailed && (
                <div className="text-xs text-amber-900 mt-2" data-testid="client-crm-stage-unavailable">
                  This client's CRM stage could not be read, so none is shown and the stage cannot be changed here until it can be read again. No stage has been lost: whatever was last saved is still in the database, and this page is refusing to guess at it rather than showing you the first stage in the list.
                </div>
              )}
              {!stageReadFailed && !stageReady && (
                <div className="text-xs text-[var(--cv-color-text-muted)] mt-2" data-testid="client-crm-stage-pending">
                  This client's CRM stage has not been read yet.
                </div>
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
                  <div>Last raise date: <span className="text-[var(--cv-color-text-muted)]">{snapshot?.lastRaiseDate ? fmtLocaleDate(snapshot.lastRaiseDate) : "—"}</span></div>
                  <div className="text-[var(--cv-color-text-faint)] pt-1">Detailed cap table is editable only by the founder in Capavate's frozen engine.</div>
                </div>
              ) : (
                <div className="text-xs text-[var(--cv-color-text-muted)]" data-testid="client-captable-empty">
                  No read-only financials are shared for this company yet. Cap-table detail is available to the founder inside Capavate's engine.
                </div>
              )}
            </CardContent>
          </Card>

          {/* WAVE 30 ENGINE 1 — client-scoped sub-CRM
              (partner_crm_contact_client_scope). Which people from the firm's
              Layer-1 CRM are contacts ON this specific client engagement.
              Additive card; every card above it is unchanged. */}

          {/* ══ WAVE 179 · ITEM A · R151.1 — VEHICLES FOR THIS CLIENT ══════════
              ADDITIVE CARD. No card above or below it is altered and no existing
              literal is reworded (R143.1). */}
          <Card className="md:col-span-2" data-testid="client-spvs">
            <CardHeader><CardTitle className="text-sm">Vehicles for this client</CardTitle></CardHeader>
            <CardContent>
              {canCreateSpv ? (
                <div className="mb-3">
                  <Button
                    onClick={() => setSpvFormOpen((v) => !v)}
                    data-testid="client-spv-create-toggle"
                  >
                    Create SPV for this client
                  </Button>
                </div>
              ) : (
                <div
                  className="text-xs text-[var(--cv-color-text-muted)] mb-3"
                  data-testid="client-spv-create-readonly"
                >
                  Recording a vehicle requires a managing partner. Ask a managing partner at your firm to complete the sign-off, or ask them to change your role.
                </div>
              )}

              {canCreateSpv && spvFormOpen && (
                <div className="mb-4 space-y-2" data-testid="client-spv-create-form">
                  {/* The association is FIXED by this page and shown, not typed. */}
                  <div
                    className="text-xs text-[var(--cv-color-text-muted)]"
                    data-testid="client-spv-create-target"
                  >
                    This vehicle will be recorded as investing in this client: {id}
                  </div>
                  <Input
                    value={spvForm.spvName}
                    onChange={(e) => setSpvForm((f) => ({ ...f, spvName: e.target.value }))}
                    placeholder="Vehicle name"
                    className="max-w-md"
                    data-testid="client-spv-name"
                  />
                  <div className="flex flex-wrap gap-2">
                    <select
                      value={spvForm.jurisdiction}
                      onChange={(e) =>
                        setSpvForm((f) => ({
                          ...f,
                          jurisdiction: e.target.value,
                          /* WAVE 179 · ITEM B — changing the jurisdiction CLEARS the legal
                             form back to not stated. It does NOT translate it into the
                             new jurisdiction's nearest equivalent: that would be the
                             platform inferring a legal form, which R151.3 forbids. */
                          legalForm: SPV_LEGAL_FORM_UNSTATED_SENTINEL,
                        }))
                      }
                      className="rounded-md border border-[var(--cv-color-border)] px-3 py-2 text-sm"
                      data-testid="client-spv-jurisdiction"
                    >
                      {SPV_JURISDICTIONS.map((j) => (
                        <option key={j} value={j}>{SPV_JURISDICTION_LABELS[j]}</option>
                      ))}
                    </select>
                    <Input
                      value={spvForm.currency}
                      onChange={(e) => setSpvForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))}
                      placeholder="Currency, e.g. USD"
                      className="max-w-[10rem]"
                      data-testid="client-spv-currency"
                    />
                    <Input
                      value={spvForm.vintage}
                      onChange={(e) => setSpvForm((f) => ({ ...f, vintage: e.target.value }))}
                      placeholder="Vintage year"
                      className="max-w-[10rem]"
                      data-testid="client-spv-vintage"
                    />
                  </div>

                  {/* ══ WAVE 179 · ITEM B · R151.3 — the OPTIONAL legal form ═════ */}
                  {spvLegalFormChoices.length > 0 ? (
                    <div className="space-y-1" data-testid="client-spv-legal-form-field">
                      <div className="text-xs text-[var(--cv-color-text-secondary)]">
                        {SPV_LEGAL_FORM_FIELD_LABEL}
                      </div>
                      <select
                        value={spvForm.legalForm}
                        onChange={(e) => setSpvForm((f) => ({ ...f, legalForm: e.target.value }))}
                        className="rounded-md border border-[var(--cv-color-border)] px-3 py-2 text-sm"
                        data-testid="client-spv-legal-form"
                      >
                        <option value={SPV_LEGAL_FORM_UNSTATED_SENTINEL}>{SPV_LEGAL_FORM_NOT_STATED_LABEL}</option>
                        {spvLegalFormChoices.map((lf) => (
                          <option key={lf} value={lf}>{SPV_LEGAL_FORM_LABELS[lf]}</option>
                        ))}
                      </select>
                      <div className="text-xs text-[var(--cv-color-text-muted)]" data-testid="client-spv-legal-form-hint">
                        {SPV_LEGAL_FORM_OPTIONAL_HINT}
                      </div>
                    </div>
                  ) : (
                    <div
                      className="text-xs text-[var(--cv-color-text-muted)]"
                      data-testid="client-spv-legal-form-not-offered"
                    >
                      {SPV_LEGAL_FORM_NOT_OFFERED_NOTICE}
                    </div>
                  )}

                  {/* The sign-off gate is SATISFIED here, never weakened: these two are
                      what the server records as a durable authorization before the
                      vehicle exists. */}
                  <Input
                    value={spvForm.signoffLegalName}
                    onChange={(e) => setSpvForm((f) => ({ ...f, signoffLegalName: e.target.value }))}
                    placeholder="Your full legal name"
                    className="max-w-md"
                    data-testid="client-spv-signoff-name"
                  />
                  <label className="flex items-start gap-2 text-xs" data-testid="client-spv-signoff-label">
                    <input
                      type="checkbox"
                      checked={spvForm.signoffAccepted}
                      onChange={(e) => setSpvForm((f) => ({ ...f, signoffAccepted: e.target.checked }))}
                      data-testid="client-spv-signoff-accept"
                    />
                    <span>
                      I am authorised to record this vehicle for my firm, and I accept the launch attestation.
                    </span>
                  </label>
                  <div className="flex items-center gap-2">
                    <Button
                      disabled={
                        !spvForm.spvName.trim() ||
                        !spvForm.signoffLegalName.trim() ||
                        !spvForm.signoffAccepted ||
                        createSpvForClient.isPending
                      }
                      onClick={() => createSpvForClient.mutate()}
                      data-testid="client-spv-create-submit"
                    >
                      Create vehicle
                    </Button>
                    {createSpvForClient.isPending && (
                      <span className="text-xs text-[var(--cv-color-text-muted)]">Creating…</span>
                    )}
                  </div>
                  <div className="text-xs text-[var(--cv-color-text-muted)]" data-testid="client-spv-create-wizard-note">
                    This records the vehicle and links it to this client. Fees, mandate and terms are configured in the full SPV engine at Collective → Partner → SPV engine.
                  </div>
                </div>
              )}

              {spvsQ.isLoading && (
                <div className="text-xs text-[var(--cv-color-text-muted)]" data-testid="client-spvs-loading">Loading…</div>
              )}
              {!spvsQ.isLoading && clientSpvs.length === 0 && (
                <div className="text-xs text-[var(--cv-color-text-muted)]" data-testid="client-spvs-empty">
                  No vehicles are recorded against this client yet.
                </div>
              )}
              <ul className="text-xs space-y-2" data-testid="client-spvs-list">
                {clientSpvs.map((s) => (
                  <li key={s.id} className="border-b pb-1" data-testid={`client-spv-${s.id}`}>
                    <span className="font-medium text-[var(--cv-color-navy)] mr-2">{s.name}</span>
                    <span className="text-[var(--cv-color-text-secondary)] mr-2">{s.status}</span>
                    <span className="text-[var(--cv-color-text-faint)]">
                      {[s.jurisdiction, s.currency].filter(Boolean).join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
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
          <Card className="md:col-span-2" data-testid="client-scoped-contacts">
            <CardHeader>
              <CardTitle className="text-sm">Contacts on this client</CardTitle>
            </CardHeader>
            <CardContent>
              {canScope && (
                <div className="flex gap-2 mb-3">
                  <select
                    value={scopePick}
                    disabled={addScope.isPending || scopeQ.isLoading}
                    onChange={(e) => setScopePick(e.target.value)}
                    className="rounded-md border border-[var(--cv-color-border)] px-3 py-2 text-sm disabled:opacity-60"
                    data-testid="client-scope-contact-select"
                  >
                    <option value={SCOPE_PICK_NONE}>— Choose a CRM contact —</option>
                    {scopableContacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}{c.email ? ` (${c.email})` : ""}
                      </option>
                    ))}
                  </select>
                  <Button
                    disabled={scopePick === SCOPE_PICK_NONE || addScope.isPending}
                    onClick={() => addScope.mutate(scopePick)}
                    data-testid="client-scope-add"
                  >
                    Add to client
                  </Button>
                </div>
              )}
              {/* WAVE 178 · ITEM B — ADDITIVE. No literal above or below was
                  reworded (R143.1); this states the one outcome the panel used to
                  swallow silently. */}
              {scopeAlreadyLinked && (
                <div
                  className="text-xs text-[var(--cv-color-text-muted)] mb-2"
                  data-testid="client-scope-already-linked"
                >
                  That contact was already linked to this client, so nothing changed. It is listed below.
                </div>
              )}
              {!canScope && (
                <div
                  className="text-xs text-[var(--cv-color-text-muted)] mb-2"
                  data-testid="client-scope-readonly"
                >
                  Your role has read-only access to this client's contact scope.
                </div>
              )}
              {canScope && scopableContacts.length === 0 && !scopeQ.isLoading && (
                <div
                  className="text-xs text-[var(--cv-color-text-muted)] mb-2"
                  data-testid="client-scope-no-candidates"
                >
                  Every contact in your firm's CRM is already on this client.
                </div>
              )}
              {scopes.length === 0 && (
                <div
                  className="text-xs text-[var(--cv-color-text-muted)]"
                  data-testid="client-scope-empty"
                >
                  No CRM contacts are scoped to this client yet.
                </div>
              )}
              <ul className="text-xs space-y-2" data-testid="client-scope-list">
                {scopes.map((s) => (
                  <li
                    key={s.id}
                    className="border-b pb-1 flex items-center justify-between gap-2"
                    data-testid={`client-scope-${s.id}`}
                  >
                    <span>
                      <span className="font-medium text-[var(--cv-color-navy)] mr-2">{s.contactName}</span>
                      <span className="text-[var(--cv-color-text-secondary)] mr-2">{s.contactEmail}</span>
                      <span className="text-[var(--cv-color-text-faint)]">
                        {[s.contactRole, s.contactOrg].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </span>
                    {canScope && (
                      <Button
                        variant="ghost"
                        disabled={removeScope.isPending}
                        onClick={() => removeScope.mutate(s.id)}
                        data-testid={`client-scope-remove-${s.id}`}
                      >
                        Remove
                      </Button>
                    )}
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
