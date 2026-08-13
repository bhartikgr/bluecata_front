/**
 * W-MFCRM — Managed Founders page (additive; DB-driven).
 *
 * Two surfaces on one route family:
 *   - /collective/partner/managed-founders          → list + dashboard widget
 *   - /collective/partner/managed-founders/:id       → engagement detail with the
 *     THREE CRM layers (Partner / General / Founder) as drill-down tabs.
 *
 * Every read hits the new /api/partner/me/mfcrm* endpoints (no mock/seed). The
 * server enforces per-partner isolation + capability gates; this page is a thin
 * DB-driven view and surfaces server errors rather than masking them.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { PartnerShell, PartnerEmptyState } from "@/components/partner/PartnerShell";
import { useRequirePartnerRole, type PartnerSubRole } from "@/lib/partner/useRequirePartnerRole";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
/* CP-MFC-12 — the ISO-4217 exponent table, shared with `formatMinor`, so the
 * write side (major → minor) can never disagree with the read side. */
import { currencyExponent } from "@/lib/currency";

interface Engagement {
  id: string;
  companyId: string;
  mode: "A" | "B";
  status: string;
  authorityArtifactRef: string | null;
  authorityExpiresAt: string | null;
  trialExpiresAt: string | null;
  chapterId: string | null;
  matterId: string | null;
  createdAt: string;
}

interface Dashboard {
  classified: boolean;
  partnerType: string | null;
  engagements: { total: number; active: number; modeA: number; modeB: number; lapsed: number };
  openCrossoverFlags: number;
  queuedPushes: number;
}

/**
 * WAVE 17 ORP-031 — shape returned by `GET /api/partner/me/mfcrm/handovers`
 * (`server/managedFounderRoutes.ts:185` → `managedFounderStore.listHandovers`),
 * which mirrors the `mf_handover` columns. No field here is invented.
 */
interface HandoverRow {
  id: string;
  engagementId: string;
  companyId: string;
  direction: "A_TO_B" | "B_TO_A";
  initiatorParty: "partner" | "founder";
  status: string;
  createdAt: string;
  confirmedAt: string | null;
}

interface LayerRow { id: string; contact_ref: string; layer: string; engagement_id: string | null; updated_at: string }

/** Shape returned by `managedFounderStore.listEvents` (server/managedFounderStore.ts:490) — camelCase, newest first. */
interface EngagementEvent {
  id: string;
  eventType: string;
  detail: Record<string, unknown> | null;
  actor: string | null;
  createdAt: string;
}

/**
 * WAVE 16 — ORP-031 (DEF-031, MFC-05 / MFC-06).
 *
 * WHAT WAS WRONG. `PARTNER_BUILT_VS_PROMISED.md:294` recorded it exactly: this
 * page's own empty state said *"Create an engagement for an attributed company to
 * begin managing it"*, and the page contained **0 `<Button>` and 0
 * `useMutation`** — the page told the partner to do something the page could not
 * do. VERIFIED AT SOURCE before writing a line: `POST
 * /api/partner/me/mfcrm/engagements` exists at `server/managedFounderRoutes.ts:83`,
 * `PATCH .../engagements/:id/mode` at `:130` and `POST .../engagements/:id/handover`
 * at `:152`, all three guarded by `requirePartnerAuth` +
 * `assertSubRole("managing_partner","associate","bd")`. So this is **WIRING, not
 * new server work** — no route, store method or migration was added for it.
 *
 * MFC-06 — THE INVISIBLE PREREQUISITE. Creation fails GATE 1 with
 * `CAPABILITY_UNCLASSIFIED` (`server/managedFounderStore.ts:373`) whenever the
 * partner's capability profile is unclassified, and Mode A additionally needs
 * `delegated_agency=true` plus an unexpired authority artifact (GATE 6, `:378-383`).
 * Those bits were invisible: the dashboard already returned `classified` and the
 * page never showed it. They are now rendered as an explicit, named prerequisite
 * panel BEFORE the form, and every gate code below is mapped to human copy so a
 * refusal explains itself instead of surfacing an enum.
 *
 * WHAT WAS STILL NOT FIXED BY THIS ITEM IN WAVE 16, stated rather than hidden:
 * the capability profile can only be set by an administrator
 * (`POST /api/admin/mfcrm/capability/:partnerId/seed` and `PATCH`) and there was
 * no admin client surface for either route. **WAVE 17 built it** —
 * `client/src/components/admin/MfcrmCapabilityPanel.tsx`, mounted on the admin
 * partner detail page (`client/src/pages/admin/PartnerDetail.tsx:509`). This page
 * still only makes the prerequisite VISIBLE and names who can grant it; it does
 * not grant it itself, and does not pretend to.
 */
const MFCRM_WRITE_ROLES: readonly PartnerSubRole[] = ["managing_partner", "associate", "bd"];

interface Capability {
  partnerId: string;
  partnerType: string | null;
  classified: boolean;
  delegatedAgency: boolean;
  advisoryCoseat: boolean;
  sourcesCapital: boolean;
  updatedAt: string | null;
}

/**
 * Server gate codes → human copy. Sources, each read at the line cited:
 *   CAPABILITY_UNCLASSIFIED / DELEGATED_AGENCY_REQUIRED / AUTHORITY_ARTIFACT_*
 *     — server/managedFounderStore.ts:373, :380, :381, :382
 *   COMPANY_ID_REQUIRED / COMPANY_NOT_FOUND_OR_NOT_ATTRIBUTED / INVALID_MODE
 *     — server/managedFounderRoutes.ts:92, :95, :44
 *   ENGAGEMENT_ALREADY_EXISTS — server/managedFounderStore.ts:436
 */
const MF_ERROR_COPY: Record<string, string> = {
  CAPABILITY_UNCLASSIFIED:
    "Your firm's capability profile has not been classified yet, so engagements cannot be created. An administrator classifies the partner firm before this is available.",
  DELEGATED_AGENCY_REQUIRED:
    "Mode A (delegated agency) is not enabled for your firm. Choose Mode B (advisory co-seat), or ask an administrator to enable delegated agency.",
  AUTHORITY_ARTIFACT_REQUIRED:
    "Mode A requires a reference to the signed authority artifact that grants your firm delegated agency.",
  AUTHORITY_ARTIFACT_EXPIRED:
    "That authority artifact has expired. Provide a current artifact and expiry date, or create the engagement in Mode B.",
  COMPANY_ID_REQUIRED: "Enter the company this engagement is for.",
  COMPANY_NOT_FOUND_OR_NOT_ATTRIBUTED:
    "That company is not attributed to your firm, so it cannot be managed by you. Attribution is recorded when the company is added through your firm.",
  ENGAGEMENT_ALREADY_EXISTS: "This company already has an engagement. Open it from the list below.",
  INVALID_MODE: "Choose Mode A (delegated) or Mode B (co-seat).",
  HANDOVER_NOT_PENDING: "That hand-over is no longer pending.",
  ENGAGEMENT_NOT_FOUND: "That engagement no longer exists, or is not attributed to your firm.",
};

/**
 * A `<input type="date">` yields `YYYY-MM-DD`, which `Date.parse` reads as UTC
 * MIDNIGHT. The server's expiry check is `t <= Date.now()`
 * (server/managedFounderStore.ts:80), so sending the bare date would mark an
 * artifact that expires TODAY as already expired and refuse the operation with
 * AUTHORITY_ARTIFACT_EXPIRED. We therefore send the END of the chosen day.
 */
function expiryToIso(day: string): string | null {
  if (!day) return null;
  return `${day}T23:59:59.999Z`;
}

function mfErrorMessage(err: unknown): string {
  const code = err instanceof ApiError ? err.code : null;
  if (code && MF_ERROR_COPY[code]) return MF_ERROR_COPY[code];
  return (err as Error)?.message ?? "The request could not be completed.";
}

const LAYER_TABS = [
  { key: "partner", label: "Partner CRM" },
  { key: "general", label: "General CRM" },
  { key: "founder", label: "Founder CRM" },
] as const;

function ModeBadge({ mode }: { mode: "A" | "B" }) {
  return (
    <span
      className="inline-block rounded px-2 py-0.5 text-xs font-medium border border-[rgba(4,30,65,0.2)] bg-[rgba(4,30,65,0.05)] text-[var(--cv-color-navy)]"
      data-testid={`mf-mode-badge-${mode}`}
    >
      {mode === "A" ? "Mode A (delegated)" : "Mode B (co-seat)"}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const active = status === "ACTIVE";
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium border ${active ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}
      data-testid={`mf-status-badge-${status}`}
    >
      {status}
    </span>
  );
}

/* ---------- Detail view (engagement + 3 CRM-layer tabs) ---------- */
function ManagedFounderDetail({ engagementId, role }: { engagementId: string; role: ReturnType<typeof useRequirePartnerRole> }) {
  const [tab, setTab] = useState<(typeof LAYER_TABS)[number]["key"]>("partner");

  const engQ = useQuery<{ engagement: Engagement; trial: unknown }>({
    queryKey: [`/api/partner/me/mfcrm/engagements/${engagementId}`],
    enabled: role.ready,
    queryFn: async () => (await apiRequest("GET", `/api/partner/me/mfcrm/engagements/${engagementId}`)).json(),
  });

  const companyId = engQ.data?.engagement.companyId ?? "";

  /* ORP-031 — the engagement event log. `GET .../engagements/:id/events`
   * (server/managedFounderRoutes.ts:123) existed with NO client caller, so every
   * gate decision, mode change and hand-over recorded by `recordEvent`
   * (server/managedFounderStore.ts:459) was invisible to the partner it concerned. */
  const eventsQ = useQuery<{ events: EngagementEvent[] }>({
    queryKey: [`/api/partner/me/mfcrm/engagements/${engagementId}/events`],
    enabled: role.ready,
    queryFn: async () => (await apiRequest("GET", `/api/partner/me/mfcrm/engagements/${engagementId}/events`)).json(),
  });

  const layersQ = useQuery<{ layers: LayerRow[] }>({
    queryKey: [`/api/partner/me/mfcrm/layers/${companyId}`],
    enabled: role.ready && !!companyId,
    queryFn: async () => (await apiRequest("GET", `/api/partner/me/mfcrm/layers/${companyId}`)).json(),
  });

  if (!role.ready || !role.identity) return null;

  if (engQ.isLoading) return <div className="text-[var(--cv-color-text-muted)]" data-testid="mf-detail-loading">Loading…</div>;
  if (engQ.isError || !engQ.data) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900" data-testid="mf-detail-error">
        Could not load this engagement. It may not exist or may not be attributed to your partner.
      </div>
    );
  }

  const e = engQ.data.engagement;
  const layers = layersQ.data?.layers ?? [];
  const layerRows = layers.filter((l) => l.layer === tab);

  return (
    <div data-testid="mf-detail">
      <Link href="/collective/partner/managed-founders" className="text-sm text-[var(--cv-color-primary)] hover:underline" data-testid="mf-detail-back">← Back to Managed Founders</Link>

      <div className="mt-3 bg-white rounded-lg border border-[var(--cv-color-border)] p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">{e.companyId}</h2>
          <ModeBadge mode={e.mode} />
          <StatusBadge status={e.status} />
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          <div><dt className="text-[var(--cv-color-text-muted)]">Authority artifact</dt><dd>{e.authorityArtifactRef ?? "—"}</dd></div>
          <div><dt className="text-[var(--cv-color-text-muted)]">Authority expires</dt><dd>{e.authorityExpiresAt ? new Date(e.authorityExpiresAt).toLocaleDateString() : "—"}</dd></div>
          <div><dt className="text-[var(--cv-color-text-muted)]">Trial expires</dt><dd>{e.trialExpiresAt ? new Date(e.trialExpiresAt).toLocaleDateString() : "—"}</dd></div>
          <div><dt className="text-[var(--cv-color-text-muted)]">Chapter</dt><dd>{e.chapterId ?? "—"}</dd></div>
          <div><dt className="text-[var(--cv-color-text-muted)]">Matter</dt><dd>{e.matterId ?? "—"}</dd></div>
          <div><dt className="text-[var(--cv-color-text-muted)]">Created</dt><dd>{e.createdAt ? new Date(e.createdAt).toLocaleDateString() : "—"}</dd></div>
        </dl>
      </div>

      {/* ORP-031 — mode change (PATCH .../mode, server/managedFounderRoutes.ts:130)
          and hand-over initiate (POST .../handover, :152). Both routes existed with
          no caller: an engagement could be created but never moved. */}
      <EngagementActions engagement={e} subRole={role.identity.subRole} />

      {/* WAVE 20 / CP-MFC-12 — SPV-on-behalf. Both halves of the engine were
          live and orphaned: POST /api/partner/me/mfcrm/spv-on-behalf
          (server/managedFounderRoutes.ts:332) and GET (:367), backed by
          managedFounderStore.createSpvOnBehalf (:874) / listSpvOnBehalf (:937).
          A whole-client grep for "spv-on-behalf" returned ZERO callers, so the
          one money path a Mode-A firm has for standing up a vehicle for its
          founder existed only as an API. Mounted on the ENGAGEMENT DETAIL
          because GATE 3 is per-engagement, not per-partner
          (assertDelegatedWriteAuthority, :437): the same firm can be authorised
          for one founder and not another, so the control has to live where the
          engagement is. A sibling element, never text appended inside an
          existing node. */}
      <SpvOnBehalfPanel engagement={e} subRole={role.identity.subRole} />

      {/* 3 CRM layers as drill-down tabs */}
      <div className="mt-4">
        <div className="flex gap-1 border-b border-[var(--cv-color-border)]" role="tablist" data-testid="mf-layer-tabs">
          {LAYER_TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${tab === t.key ? "border-[var(--cv-color-primary)] text-[var(--cv-color-navy)]" : "border-transparent text-[var(--cv-color-text-muted)]"}`}
              data-testid={`mf-layer-tab-${t.key}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-b-lg border border-t-0 border-[var(--cv-color-border)] overflow-hidden">
          <table className="w-full text-sm" data-testid={`mf-layer-table-${tab}`}>
            <thead className="bg-[var(--cv-color-surface-2)]">
              <tr>
                <th className="text-left p-3">Contact</th>
                <th className="text-left p-3">Layer</th>
                <th className="text-left p-3">Updated</th>
              </tr>
            </thead>
            <tbody>
              {layerRows.length === 0 && (
                <tr data-testid="mf-layer-empty"><td className="p-3 text-[var(--cv-color-text-muted)]" colSpan={3}>No contacts in this layer yet.</td></tr>
              )}
              {layerRows.map((l) => (
                <tr key={l.id} className="border-t" data-testid={`mf-layer-row-${l.id}`}>
                  <td className="p-3 font-medium">{l.contact_ref}</td>
                  <td className="p-3 text-[var(--cv-color-text-muted)]">{l.layer}</td>
                  <td className="p-3 text-[var(--cv-color-text-muted)]">{l.updated_at ? new Date(l.updated_at).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ORP-031 — the event log, previously unread by any client. */}
      <div className="mt-4 bg-white rounded-lg border border-[var(--cv-color-border)] p-4" data-testid="mf-events">
        <h3 className="text-sm font-semibold">Engagement history</h3>
        {(eventsQ.data?.events.length ?? 0) === 0 ? (
          <div className="mt-2 text-sm text-[var(--cv-color-text-muted)]" data-testid="mf-events-empty">
            No recorded events for this engagement yet.
          </div>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {(eventsQ.data?.events ?? []).map((ev) => (
              <li key={ev.id} className="flex flex-wrap gap-2" data-testid={`mf-event-${ev.id}`}>
                <span className="text-[var(--cv-color-text-muted)]">
                  {ev.createdAt ? new Date(ev.createdAt).toLocaleString() : "—"}
                </span>
                <span className="font-medium">{ev.eventType}</span>
                {ev.actor && <span className="text-[var(--cv-color-text-muted)]">{ev.actor}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ---------- ORP-031: mode change + hand-over ---------- */

function EngagementActions({
  engagement,
  subRole,
}: {
  engagement: Engagement;
  subRole: PartnerSubRole;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const canWrite = MFCRM_WRITE_ROLES.includes(subRole);
  const targetMode: "A" | "B" = engagement.mode === "A" ? "B" : "A";
  const [artifactRef, setArtifactRef] = useState("");
  const [artifactExpiry, setArtifactExpiry] = useState("");
  const [handover, setHandover] = useState<{ id: string; status?: string } | null>(null);

  /* WAVE 17 ORP-031 — pending hand-overs now come from the SERVER, not from React
     state. Wave 16 wired initiate + confirm, but the id lived only in `handover`
     above, so a refresh, a second operator, or a founder-initiated hand-over left
     a durable `mf_handover` row with no way to confirm it. `GET
     /api/partner/me/mfcrm/handovers` (server/managedFounderRoutes.ts:185) is the
     listing that was missing. The local state is kept as the optimistic echo of
     the initiate response only. */
  const handoversQ = useQuery<{ handovers: HandoverRow[] }>({
    queryKey: ["/api/partner/me/mfcrm/handovers", engagement.id],
    queryFn: async () =>
      (await apiRequest("GET", `/api/partner/me/mfcrm/handovers?engagementId=${encodeURIComponent(engagement.id)}`)).json(),
  });
  const pendingHandovers: HandoverRow[] = (handoversQ.data?.handovers ?? []).filter(
    (h) => h.status === "initiated",
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: [`/api/partner/me/mfcrm/engagements/${engagement.id}`] });
    qc.invalidateQueries({ queryKey: [`/api/partner/me/mfcrm/engagements/${engagement.id}/events`] });
    qc.invalidateQueries({ queryKey: ["/api/partner/me/mfcrm/engagements"] });
    qc.invalidateQueries({ queryKey: ["/api/partner/me/mfcrm/dashboard"] });
    qc.invalidateQueries({ queryKey: ["/api/partner/me/mfcrm/handovers", engagement.id] });
  };

  const changeMode = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/partner/me/mfcrm/engagements/${engagement.id}/mode`, {
        mode: targetMode,
        authorityArtifactRef: targetMode === "A" ? artifactRef.trim() || null : null,
        authorityExpiresAt: targetMode === "A" ? expiryToIso(artifactExpiry) : null,
      });
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: `Engagement moved to Mode ${targetMode}` });
    },
    onError: (err) =>
      toast({ variant: "destructive", title: "Could not change the mode", description: mfErrorMessage(err) }),
  });

  const initiateHandover = useMutation({
    mutationFn: async (): Promise<{ handover: { id: string; status?: string } }> => {
      const res = await apiRequest("POST", `/api/partner/me/mfcrm/engagements/${engagement.id}/handover`, {
        direction: engagement.mode === "A" ? "A_TO_B" : "B_TO_A",
        initiatorParty: "partner",
        authorityArtifactRef: engagement.mode === "B" ? artifactRef.trim() || null : null,
        authorityExpiresAt: engagement.mode === "B" ? expiryToIso(artifactExpiry) : null,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setHandover(data.handover);
      invalidate();
      toast({ title: "Hand-over initiated", description: "It is pending confirmation." });
    },
    onError: (err) =>
      toast({ variant: "destructive", title: "Could not initiate the hand-over", description: mfErrorMessage(err) }),
  });

  const confirmHandover = useMutation({
    /* Takes the id explicitly so EVERY pending hand-over is confirmable, including
       ones this browser session did not initiate. Falls back to the session echo
       and then to the oldest pending row. */
    mutationFn: async (handoverId?: string) => {
      const id = handoverId ?? handover?.id ?? pendingHandovers[pendingHandovers.length - 1]?.id;
      if (!id) throw new Error("NO_PENDING_HANDOVER");
      const res = await apiRequest("POST", `/api/partner/me/mfcrm/handovers/${id}/confirm`, {});
      return res.json();
    },
    onSuccess: () => {
      setHandover(null);
      invalidate();
      toast({ title: "Hand-over confirmed" });
    },
    onError: (err) =>
      toast({ variant: "destructive", title: "Could not confirm the hand-over", description: mfErrorMessage(err) }),
  });

  return (
    <div className="mt-4 bg-white rounded-lg border border-[var(--cv-color-border)] p-4" data-testid="mf-actions">
      <h3 className="text-sm font-semibold">Change how this engagement is held</h3>
      {!canWrite && (
        <div className="mt-2 text-sm text-amber-900" data-testid="mf-actions-readonly">
          Your partner role is read-only for managed founders, so these actions are unavailable.
        </div>
      )}
      {canWrite && (
        <>
          {targetMode === "A" && (
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <Label htmlFor="mf-act-artifact">Authority artifact reference</Label>
                <Input
                  id="mf-act-artifact"
                  data-testid="mf-actions-artifact"
                  value={artifactRef}
                  onChange={(ev) => setArtifactRef(ev.target.value)}
                  placeholder="Required to move into Mode A"
                />
              </div>
              <div>
                <Label htmlFor="mf-act-expiry">Authority expires</Label>
                <Input
                  id="mf-act-expiry"
                  data-testid="mf-actions-expiry"
                  type="date"
                  value={artifactExpiry}
                  onChange={(ev) => setArtifactExpiry(ev.target.value)}
                />
              </div>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button
              data-testid="mf-actions-change-mode"
              disabled={changeMode.isPending || (targetMode === "A" && !artifactRef.trim())}
              onClick={() => changeMode.mutate()}
            >
              {changeMode.isPending ? "Changing…" : `Move to Mode ${targetMode}`}
            </Button>
            <Button
              variant="outline"
              data-testid="mf-actions-handover"
              disabled={initiateHandover.isPending}
              onClick={() => initiateHandover.mutate()}
            >
              {initiateHandover.isPending ? "Initiating…" : "Initiate hand-over"}
            </Button>
            {(handover || pendingHandovers.length > 0) && (
              <Button
                variant="outline"
                data-testid="mf-actions-handover-confirm"
                disabled={confirmHandover.isPending}
                onClick={() => confirmHandover.mutate(undefined)}
              >
                {confirmHandover.isPending ? "Confirming…" : "Confirm hand-over"}
              </Button>
            )}
          </div>
          {/* WAVE 17 ORP-031 — every pending hand-over on record, from the server,
              each individually confirmable. A sibling element (never appended text
              inside an existing node) so the drop guard reads it as an addition. */}
          {pendingHandovers.length > 0 && (
            <div className="mt-3 rounded-md border border-[var(--cv-color-border)] p-3" data-testid="mf-handovers-pending">
              <div className="text-xs font-semibold">Hand-overs awaiting confirmation</div>
              <ul className="mt-2 space-y-2">
                {pendingHandovers.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 text-xs" data-testid={`mf-handover-row-${h.id}`}>
                    <span>
                      {h.direction === "B_TO_A" ? "Mode B → Mode A" : "Mode A → Mode B"}
                      {" · initiated by the "}
                      {h.initiatorParty === "founder" ? "founder" : "partner firm"}
                      {h.createdAt ? ` · ${new Date(h.createdAt).toLocaleDateString()}` : ""}
                    </span>
                    <Button
                      variant="outline"
                      data-testid={`mf-handover-confirm-${h.id}`}
                      disabled={confirmHandover.isPending}
                      onClick={() => confirmHandover.mutate(h.id)}
                    >
                      Confirm
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-2 text-[11px] text-[var(--cv-color-text-muted)]">
            Moving into Mode A re-runs the delegated-agency entry check and needs a current authority artifact. Moving to Mode B is always permitted.
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- WAVE 20 / CP-MFC-12: SPV-on-behalf ---------- */

interface SpvOnBehalfRow {
  id: string;
  spv_id: string;
  company_id: string;
  engagement_id: string;
  created_at: string;
  curr_hash?: string | null;
}

/**
 * Every distinct reason GATE 3 refuses an SPV-on-behalf, in the partner's own
 * words. Read from `assertDelegatedWriteAuthority`
 * (server/managedFounderStore.ts:437-445) — each code below is thrown on the
 * line noted, so an unexplained 403 cannot reach the partner.
 *
 * These are AUTHORITY refusals, not faults. Every one is RENDERED as copy
 * naming the missing precondition; none is allowed to degrade into an empty
 * panel or a disabled button with no explanation.
 */
export const SPV_ON_BEHALF_GATE_COPY: Record<string, string> = {
  DELEGATED_AGENCY_REQUIRED:
    "Delegated agency is not enabled for your firm, so you cannot act on a founder's behalf. An administrator enables it on your capability profile. (:439)",
  SPV_WRITE_AUTHORITY_REQUIRED:
    "Your firm does not hold SPV write authority, which is required to stand up a vehicle on a founder's behalf. An administrator enables it on your capability profile.",
  ENGAGEMENT_NOT_ACTIVE:
    "This engagement is not active, so no vehicle can be created under it.",
  ENGAGEMENT_MODE_NOT_A:
    "This engagement is in Mode B (advisory co-seat). Creating a vehicle on the founder's behalf requires Mode A delegated authority for THIS engagement.",
  AUTHORITY_ARTIFACT_REQUIRED:
    "This engagement has no signed authority artifact on record. Record one before creating a vehicle on the founder's behalf.",
  AUTHORITY_ARTIFACT_EXPIRED:
    "The authority artifact for this engagement has expired. Record a current one before creating a vehicle on the founder's behalf.",
  ENGAGEMENT_NOT_FOUND:
    "That engagement no longer exists, or is not attributed to your firm.",
};

function spvOnBehalfError(err: unknown): string {
  const code = err instanceof ApiError ? err.code : null;
  if (code && SPV_ON_BEHALF_GATE_COPY[code]) return SPV_ON_BEHALF_GATE_COPY[code];
  if (code && MF_ERROR_COPY[code]) return MF_ERROR_COPY[code];
  const m = (err as Error)?.message;
  return m && m.trim() ? m : "The vehicle could not be created.";
}

/**
 * The client-side preconditions for GATE 3 that are knowable from the
 * ENGAGEMENT alone (mode, status, artifact presence and expiry). Used to explain
 * the block BEFORE the partner fills in a form that is certain to 403 — never
 * as the security boundary, which stays on the server and re-checks all of it
 * plus the two capability flags this cannot see.
 *
 * Expiry is compared the way the server compares it (`isExpired`,
 * server/managedFounderStore.ts:80 — `t <= Date.now()`), so the two agree on an
 * artifact expiring right now.
 */
export function localSpvOnBehalfBlockers(e: Engagement): string[] {
  const out: string[] = [];
  if (e.status !== "ACTIVE") out.push(SPV_ON_BEHALF_GATE_COPY.ENGAGEMENT_NOT_ACTIVE);
  if (e.mode !== "A") out.push(SPV_ON_BEHALF_GATE_COPY.ENGAGEMENT_MODE_NOT_A);
  if (!e.authorityArtifactRef || !e.authorityArtifactRef.trim()) {
    out.push(SPV_ON_BEHALF_GATE_COPY.AUTHORITY_ARTIFACT_REQUIRED);
  } else if (e.authorityExpiresAt) {
    const t = Date.parse(e.authorityExpiresAt);
    if (Number.isFinite(t) && t <= Date.now()) out.push(SPV_ON_BEHALF_GATE_COPY.AUTHORITY_ARTIFACT_EXPIRED);
  }
  return out;
}

export function SpvOnBehalfPanel({ engagement, subRole }: { engagement: Engagement; subRole: PartnerSubRole }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const canWrite = MFCRM_WRITE_ROLES.includes(subRole);

  const [name, setName] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [carryBasis, setCarryBasis] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [targetRaise, setTargetRaise] = useState("");

  const listQ = useQuery<{ spvOnBehalf: SpvOnBehalfRow[] }>({
    queryKey: ["/api/partner/me/mfcrm/spv-on-behalf", engagement.companyId],
    queryFn: async () =>
      (await apiRequest("GET", `/api/partner/me/mfcrm/spv-on-behalf?companyId=${encodeURIComponent(engagement.companyId)}`)).json(),
  });

  const createM = useMutation({
    mutationFn: async () => {
      /* Target raise is an OPTIONAL integer minor-unit amount. The major value
       * the operator types is scaled by the SELECTED currency's real ISO-4217
       * exponent, not by a hardcoded 100 — a hardcoded 100 would set a
       * ¥50,000,000 target to ¥5,000,000,000. An empty field sends null, which
       * the route already accepts (:356), rather than a fabricated 0 target. */
      const trimmed = targetRaise.trim();
      let targetRaiseMinor: number | null = null;
      if (trimmed) {
        const n = Number(trimmed);
        if (!Number.isFinite(n)) throw new Error("Enter a numeric target raise, or leave it blank.");
        targetRaiseMinor = Math.round(n * Math.pow(10, currencyExponent(currency)));
      }
      return (await apiRequest("POST", "/api/partner/me/mfcrm/spv-on-behalf", {
        companyId: engagement.companyId,
        engagementId: engagement.id,
        name,
        jurisdiction,
        carryBasis,
        currency: currency.toUpperCase(),
        targetRaiseMinor,
      })).json();
    },
    onSuccess: () => {
      setName(""); setJurisdiction(""); setCarryBasis(""); setTargetRaise("");
      qc.invalidateQueries({ queryKey: ["/api/partner/me/mfcrm/spv-on-behalf", engagement.companyId] });
      qc.invalidateQueries({ queryKey: [`/api/partner/me/mfcrm/engagements/${engagement.id}/events`] });
      toast({ title: "Vehicle created on the founder's behalf" });
    },
    onError: (err) => toast({ title: "Could not create the vehicle", description: spvOnBehalfError(err), variant: "destructive" }),
  });

  const blockers = localSpvOnBehalfBlockers(engagement);
  const rows = listQ.data?.spvOnBehalf ?? [];

  return (
    <div className="mt-3 bg-white rounded-lg border border-[var(--cv-color-border)] p-4" data-testid="mf-spv-on-behalf">
      <h3 className="text-sm font-semibold">SPV on behalf of this founder</h3>
      <p className="mt-0.5 text-xs text-[var(--cv-color-text-muted)]">
        Creates the vehicle, records an audit entry in the on-behalf chain, and queues the Collective push — in one transaction.
      </p>

      {/* Existing on-behalf vehicles. Loading, refusal and genuinely-empty are
          three DISTINCT rendered states; a failed read is never shown as
          "none yet", which would tell a firm with live vehicles it has none. */}
      <div className="mt-3">
        {listQ.isLoading && <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="mf-sob-loading">Loading…</div>}
        {listQ.isError && (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900" data-testid="mf-sob-error">
            Existing on-behalf vehicles could not be loaded, so this list may be incomplete.
            <span className="block mt-1" data-testid="mf-sob-error-message">{spvOnBehalfError(listQ.error)}</span>
          </div>
        )}
        {!listQ.isLoading && !listQ.isError && rows.length === 0 && (
          <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="mf-sob-empty">
            No vehicles have been created on this founder&apos;s behalf.
          </div>
        )}
        {!listQ.isError && rows.length > 0 && (
          <ul className="space-y-1 text-sm" data-testid="mf-sob-list">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--cv-color-border)] py-1.5" data-testid={`mf-sob-row-${r.id}`}>
                <Link href={`/collective/partner/spvs/${encodeURIComponent(r.spv_id)}`} className="underline" data-testid={`mf-sob-link-${r.id}`}>
                  {r.spv_id}
                </Link>
                <span className="text-xs text-[var(--cv-color-text-muted)]">
                  {r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* RULE 3 — the refusal is RENDERED. When this engagement cannot support an
          on-behalf vehicle the partner is told exactly which precondition fails,
          instead of being shown a form that always 403s. */}
      {blockers.length > 0 && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="mf-sob-blocked">
          <div className="font-medium">A vehicle cannot be created on this engagement yet.</div>
          <ul className="mt-1 list-disc pl-5">
            {blockers.map((b) => <li key={b} data-testid="mf-sob-blocker">{b}</li>)}
          </ul>
        </div>
      )}

      {!canWrite && (
        <div className="mt-3 text-sm text-[var(--cv-color-text-muted)]" data-testid="mf-sob-role">
          Your sub-role is read-only for this action. A managing partner, associate or BD user can create the vehicle.
        </div>
      )}

      {canWrite && blockers.length === 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-5" data-testid="mf-sob-form">
          <div><Label htmlFor="mf-sob-name">Vehicle name</Label><Input id="mf-sob-name" data-testid="mf-sob-name" value={name} onChange={(ev) => setName(ev.target.value)} /></div>
          <div><Label htmlFor="mf-sob-jur">Jurisdiction</Label><Input id="mf-sob-jur" data-testid="mf-sob-jurisdiction" value={jurisdiction} onChange={(ev) => setJurisdiction(ev.target.value)} /></div>
          <div><Label htmlFor="mf-sob-carry">Carry basis</Label><Input id="mf-sob-carry" data-testid="mf-sob-carry-basis" value={carryBasis} onChange={(ev) => setCarryBasis(ev.target.value)} /></div>
          <div><Label htmlFor="mf-sob-cur">Currency</Label><Input id="mf-sob-cur" data-testid="mf-sob-currency" value={currency} onChange={(ev) => setCurrency(ev.target.value)} /></div>
          <div><Label htmlFor="mf-sob-target">Target raise (optional)</Label><Input id="mf-sob-target" inputMode="decimal" data-testid="mf-sob-target-raise" value={targetRaise} onChange={(ev) => setTargetRaise(ev.target.value)} /></div>
          <div className="sm:col-span-5">
            <Button
              data-testid="mf-sob-submit"
              disabled={createM.isPending || !name.trim() || !jurisdiction.trim() || !carryBasis.trim()}
              onClick={() => createM.mutate()}
            >
              {createM.isPending ? "Creating…" : "Create vehicle on behalf"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- ORP-031 / MFC-05: Create an engagement ---------- */

/**
 * The create surface the empty state has been promising. Deliberately mounted on
 * the LIST view (not behind a route) so the promise and the control are in the
 * same place a partner reads them.
 */
function CreateEngagementPanel({
  capability,
  subRole,
}: {
  capability: Capability | null;
  subRole: PartnerSubRole;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [companyId, setCompanyId] = useState("");
  const [mode, setMode] = useState<"A" | "B">("B");
  const [artifactRef, setArtifactRef] = useState("");
  const [artifactExpiry, setArtifactExpiry] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [matterId, setMatterId] = useState("");

  /* Attributed companies. `/api/partner/me/portfolio` (server/partnerRoutes.ts:873)
   * is the closest existing list surface, offered as SUGGESTIONS only — it is not
   * the same set as `mf_attribution`, which is what the server actually checks
   * (`server/managedFounderRoutes.ts:31-33`). Presenting it as a closed dropdown
   * would silently hide legitimately attributable companies, so the field stays a
   * free text input with a datalist and the server's attribution refusal is shown
   * verbatim in human words. */
  const portfolioQ = useQuery<{ portfolio: Array<{ companyId: string; companyName: string | null }> }>({
    queryKey: ["/api/partner/me/portfolio"],
    enabled: open,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/portfolio")).json(),
  });

  const canWrite = MFCRM_WRITE_ROLES.includes(subRole);
  const classified = capability?.classified === true;
  const delegatedAgency = capability?.delegatedAgency === true;

  const create = useMutation({
    mutationFn: async (): Promise<{ engagement: Engagement }> => {
      const res = await apiRequest("POST", "/api/partner/me/mfcrm/engagements", {
        companyId: companyId.trim(),
        mode,
        authorityArtifactRef: mode === "A" ? artifactRef.trim() || null : null,
        authorityExpiresAt: mode === "A" ? expiryToIso(artifactExpiry) : null,
        chapterId: chapterId.trim() || null,
        matterId: matterId.trim() || null,
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/partner/me/mfcrm/engagements"] });
      qc.invalidateQueries({ queryKey: ["/api/partner/me/mfcrm/dashboard"] });
      setOpen(false);
      setCompanyId(""); setArtifactRef(""); setArtifactExpiry(""); setChapterId(""); setMatterId("");
      toast({ title: "Engagement created", description: "It is now listed below." });
    },
    onError: (err) =>
      toast({ variant: "destructive", title: "Could not create the engagement", description: mfErrorMessage(err) }),
  });

  const blockedReason = !canWrite
    ? "Your partner role is read-only for managed founders. A managing partner, associate or BD can create engagements."
    : capability === null
      ? null
      : !classified
        ? MF_ERROR_COPY.CAPABILITY_UNCLASSIFIED
        : null;

  return (
    <div className="mb-4" data-testid="mf-create-panel">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          data-testid="mf-create-open"
          disabled={blockedReason !== null}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Cancel" : "Create an engagement"}
        </Button>
        {capability && (
          <span className="text-xs text-[var(--cv-color-text-muted)]" data-testid="mf-capability-summary">
            Capability profile: {capability.partnerType ?? "unclassified"}
          </span>
        )}
      </div>

      {/* MFC-06 — the prerequisite, made visible. A SIBLING element, never text
          appended inside the button's own node. */}
      {blockedReason && (
        <div
          className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
          data-testid="mf-create-blocked"
        >
          {blockedReason}
        </div>
      )}

      {open && (
        <div className="mt-3 rounded-lg border border-[var(--cv-color-border)] bg-white p-4" data-testid="mf-create-form">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="mf-company">Company *</Label>
              <Input
                id="mf-company"
                data-testid="mf-create-company"
                list="mf-company-options"
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                placeholder="co_..."
              />
              <datalist id="mf-company-options">
                {(portfolioQ.data?.portfolio ?? []).map((p) => (
                  <option key={p.companyId} value={p.companyId}>
                    {p.companyName ?? p.companyId}
                  </option>
                ))}
              </datalist>
              <div className="mt-1 text-[11px] text-[var(--cv-color-text-muted)]">
                The company must be attributed to your firm.
              </div>
            </div>

            <div>
              <Label htmlFor="mf-mode">Engagement mode *</Label>
              <select
                id="mf-mode"
                data-testid="mf-create-mode"
                value={mode}
                onChange={(e) => setMode(e.target.value === "A" ? "A" : "B")}
                className="w-full rounded-md border border-[var(--cv-color-border)] px-3 py-2 text-sm"
              >
                <option value="B">Mode B — advisory co-seat</option>
                <option value="A">Mode A — delegated agency</option>
              </select>
              {mode === "A" && !delegatedAgency && (
                <div className="mt-1 text-[11px] text-amber-800" data-testid="mf-create-mode-a-warning">
                  {MF_ERROR_COPY.DELEGATED_AGENCY_REQUIRED}
                </div>
              )}
              {mode === "A" && delegatedAgency && (
                <div className="mt-1 text-[11px] text-[var(--cv-color-text-muted)]">
                  Mode A starts a 90-day trial and requires a current authority artifact.
                </div>
              )}
            </div>

            {mode === "A" && (
              <>
                <div>
                  <Label htmlFor="mf-artifact">Authority artifact reference *</Label>
                  <Input
                    id="mf-artifact"
                    data-testid="mf-create-artifact"
                    value={artifactRef}
                    onChange={(e) => setArtifactRef(e.target.value)}
                    placeholder="doc_... or an executed agreement reference"
                  />
                </div>
                <div>
                  <Label htmlFor="mf-artifact-expiry">Authority expires</Label>
                  <Input
                    id="mf-artifact-expiry"
                    data-testid="mf-create-artifact-expiry"
                    type="date"
                    value={artifactExpiry}
                    onChange={(e) => setArtifactExpiry(e.target.value)}
                  />
                </div>
              </>
            )}

            <div>
              <Label htmlFor="mf-chapter">Chapter (optional)</Label>
              <Input id="mf-chapter" data-testid="mf-create-chapter" value={chapterId} onChange={(e) => setChapterId(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="mf-matter">Matter (optional)</Label>
              <Input id="mf-matter" data-testid="mf-create-matter" value={matterId} onChange={(e) => setMatterId(e.target.value)} />
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <Button
              data-testid="mf-create-submit"
              disabled={create.isPending || !companyId.trim() || (mode === "A" && !artifactRef.trim())}
              onClick={() => create.mutate()}
            >
              {create.isPending ? "Creating…" : "Create engagement"}
            </Button>
            <Button variant="outline" data-testid="mf-create-cancel" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>

          {create.isError && (
            <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900" data-testid="mf-create-error">
              {mfErrorMessage(create.error)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- List view + dashboard widget ---------- */
export default function PartnerManagedFounders() {
  const role = useRequirePartnerRole();
  const [, params] = useRoute("/collective/partner/managed-founders/:id");
  const detailId = params?.id ?? "";
  const [search, setSearch] = useState("");

  const dashQ = useQuery<Dashboard>({
    queryKey: ["/api/partner/me/mfcrm/dashboard"],
    enabled: role.ready && !detailId,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/mfcrm/dashboard")).json(),
  });

  /* ORP-031 — the capability profile the server gates on. The endpoint already
   * existed (server/managedFounderRoutes.ts:65) and had no client caller. */
  const capQ = useQuery<{ capability: Capability }>({
    queryKey: ["/api/partner/me/mfcrm/capability"],
    enabled: role.ready,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/mfcrm/capability")).json(),
  });

  const listQ = useQuery<{ engagements: Engagement[] }>({
    queryKey: ["/api/partner/me/mfcrm/engagements"],
    enabled: role.ready && !detailId,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/mfcrm/engagements")).json(),
  });

  const filtered = useMemo(() => {
    const rows = listQ.data?.engagements ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((e) => e.companyId.toLowerCase().includes(needle) || e.id.toLowerCase().includes(needle));
  }, [listQ.data, search]);

  if (!role.ready || !role.identity) return null;

  return (
    <PartnerShell title="Managed Founders" tier={role.identity.tier} subRole={role.identity.subRole} partnerName={role.identity.identity.name}>
      {detailId ? (
        <ManagedFounderDetail engagementId={detailId} role={role} />
      ) : (
        <>
          {/* ORP-031 / MFC-05 — the create control the empty state promises. */}
          <CreateEngagementPanel
            capability={capQ.data?.capability ?? null}
            subRole={role.identity.subRole}
          />

          {/* Dashboard widget */}
          {dashQ.data && (
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="mf-dashboard-widget">
              <div className="rounded-lg border border-[var(--cv-color-border)] bg-white p-3">
                <div className="text-xs text-[var(--cv-color-text-muted)]">Engagements</div>
                <div className="text-xl font-semibold">{dashQ.data.engagements.total}</div>
              </div>
              <div className="rounded-lg border border-[var(--cv-color-border)] bg-white p-3">
                <div className="text-xs text-[var(--cv-color-text-muted)]">Active</div>
                <div className="text-xl font-semibold">{dashQ.data.engagements.active}</div>
              </div>
              <div className="rounded-lg border border-[var(--cv-color-border)] bg-white p-3">
                <div className="text-xs text-[var(--cv-color-text-muted)]">Open crossover flags</div>
                <div className="text-xl font-semibold">{dashQ.data.openCrossoverFlags}</div>
              </div>
              <div className="rounded-lg border border-[var(--cv-color-border)] bg-white p-3">
                <div className="text-xs text-[var(--cv-color-text-muted)]">Queued pushes</div>
                <div className="text-xl font-semibold">{dashQ.data.queuedPushes}</div>
              </div>
            </div>
          )}

          {listQ.isLoading && <div className="text-[var(--cv-color-text-muted)]" data-testid="mf-loading">Loading…</div>}
          {listQ.isError && (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900" data-testid="mf-error">
              Could not load managed founders. Please refresh and try again.
            </div>
          )}
          {!listQ.isLoading && !listQ.isError && (listQ.data?.engagements.length ?? 0) === 0 && (
            <PartnerEmptyState
              title="No managed-founder engagements yet"
              description="Create an engagement for an attributed company to begin managing it. Mode A grants delegated agency (requires a valid authority artifact); Mode B is an advisory co-seat."
            />
          )}

          {!listQ.isError && (listQ.data?.engagements.length ?? 0) > 0 && (
            <>
              <div className="mb-4 flex flex-wrap gap-2">
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search company or engagement…"
                  className="max-w-xs flex-1 rounded-md border border-[var(--cv-color-border)] px-3 py-2 text-sm"
                  data-testid="mf-search"
                />
              </div>
              <div className="bg-white rounded-lg border border-[var(--cv-color-border)] overflow-hidden">
                <table className="w-full text-sm" data-testid="mf-table">
                  <thead className="bg-[var(--cv-color-surface-2)]">
                    <tr>
                      <th className="text-left p-3">Company</th>
                      <th className="text-left p-3">Mode</th>
                      <th className="text-left p-3">Status</th>
                      <th className="text-left p-3">Created</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 && (
                      <tr data-testid="mf-no-match"><td className="p-3 text-[var(--cv-color-text-muted)]" colSpan={5}>No engagements match your search.</td></tr>
                    )}
                    {filtered.map((e) => (
                      <tr key={e.id} className="border-t" data-testid={`mf-row-${e.id}`}>
                        <td className="p-3 font-medium">{e.companyId}</td>
                        <td className="p-3"><ModeBadge mode={e.mode} /></td>
                        <td className="p-3"><StatusBadge status={e.status} /></td>
                        <td className="p-3 text-[var(--cv-color-text-muted)]">{e.createdAt ? new Date(e.createdAt).toLocaleDateString() : "—"}</td>
                        <td className="p-3 text-right">
                          <Link href={`/collective/partner/managed-founders/${e.id}`} className="text-[var(--cv-color-primary)] hover:underline" data-testid={`mf-view-${e.id}`}>
                            View
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </PartnerShell>
  );
}
