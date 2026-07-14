/**
 * Team management page — managing_partner only can invite/remove.
 * Tier seat limit enforced server-side; UI shows seat utilization banner.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PartnerShell } from "@/components/partner/PartnerShell";
import { useRequirePartnerRole, isManagingPartner } from "@/lib/partner/useRequirePartnerRole";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
/* v25.12 NH6 — surface invite + remove failures (seat limit, network, etc). */
import { useToast } from "@/hooks/use-toast";
/* v25.56 GROUP-D — client-side guard so a raw synthetic id can never render. */
import { safePersonDisplayName } from "@/lib/personName"; /* W3.2 — name slot must never render email/opaque id */
/* 2a — display/CRM titles (distinct from the 5 permission tiers). */
import { PARTNER_TITLES } from "@shared/partnerTitles";

/* v25.50 Phase 7 (7b) — comprehensive, properly-labeled positions list. The 5
   canonical values are enforced server-side (invite endpoint); this maps each to
   a human-readable label + short description so the picker is self-explanatory. */
const POSITIONS: Array<{ value: string; label: string; hint: string }> = [
  { value: "managing_partner", label: "Managing Partner", hint: "Full control — invite/remove, billing, deals" },
  { value: "associate", label: "Associate", hint: "Deal execution — pipeline, notes, SPVs" },
  { value: "bd", label: "Business Development", hint: "Sourcing & outreach — pipeline, notes" },
  { value: "analyst", label: "Analyst", hint: "Read + supporting analysis" },
  { value: "viewer", label: "Viewer", hint: "Read-only access" },
];
const POSITION_LABELS: Record<string, string> = Object.fromEntries(POSITIONS.map((p) => [p.value, p.label]));
const positionLabel = (v: string) => POSITION_LABELS[v] ?? v;

/* 2a — the professional TITLES shown in the picker (18 per the QA slide). These
   are display/CRM metadata only; the ACCESS LEVEL below (the 5 permission tiers)
   is what the server enforces. Default title mirrors the default access level. */
const DEFAULT_TITLE = "Viewer";

type TeamMember = {
  id: string;
  userId: string;
  subRole: string;
  status: string;
  joinedAt: string;
  name: string | null;
  email: string | null;
  mobile: string | null;
  contactEmail: string | null;
  positionNote: string | null;
  /* 2a — display title (presentational); null when unset. */
  title: string | null;
};

export default function PartnerTeam() {
  const role = useRequirePartnerRole();
  const q = useQuery<{ members: TeamMember[]; invitations: Array<{ id: string; invitedEmail: string; subRole: string; title?: string | null; expiresAt: string; redeemedAt: string | null }>; meta?: { duplicateSeatCount?: number } }>({
    queryKey: ["/api/partner/me/team"],
    enabled: role.ready,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/team")).json(),
  });
  const [email, setEmail] = useState("");
  const [subRole, setSubRole] = useState<string>("viewer");
  /* 2a — the chosen display title (from PARTNER_TITLES), separate from subRole. */
  const [title, setTitle] = useState<string>(DEFAULT_TITLE);

  /* v25.12 NH6 — toast helper. */
  const { toast } = useToast();
  const onErr = (label: string) => (e: Error) =>
    toast({ variant: "destructive", title: `${label} failed`, description: e.message });

  /* v25.23 NH-R — the server returns a one-time `plainToken` on invite create.
     We surface it inline (with copy-to-clipboard) for 60s, then clear it. This
     is the ONLY time the raw token is ever shown. */
  const [issuedToken, setIssuedToken] = useState<{ email: string; plainToken: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const tokenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearIssuedToken = () => {
    if (tokenTimerRef.current) {
      clearTimeout(tokenTimerRef.current);
      tokenTimerRef.current = null;
    }
    setIssuedToken(null);
    setCopied(false);
  };
  // Clean up the timer if the component unmounts while a token is showing.
  useEffect(() => () => { if (tokenTimerRef.current) clearTimeout(tokenTimerRef.current); }, []);

  const inviteMut = useMutation({
    /* v25.33 — apiRequest() throws ApiError on non-2xx, so the prior `if (!res.ok)`
       guard (here and in removeMut below) was unreachable dead code. The thrown
       ApiError reaches onError unchanged, preserving the failure toast. */
    mutationFn: async (): Promise<{ invitation: { invitedEmail: string }; plainToken: string }> => {
      const res = await apiRequest("POST", "/api/partner/me/team/invitations", { email, subRole, title });
      return res.json();
    },
    onSuccess: (data) => {
      setEmail("");
      queryClient.invalidateQueries({ queryKey: ["/api/partner/me/team"] });
      // v25.23 NH-R — capture + surface the one-time plainToken.
      if (data?.plainToken) {
        setCopied(false);
        setIssuedToken({ email: data.invitation?.invitedEmail ?? "", plainToken: data.plainToken });
        if (tokenTimerRef.current) clearTimeout(tokenTimerRef.current);
        tokenTimerRef.current = setTimeout(() => clearIssuedToken(), 60_000);
      }
    },
    onError: onErr("Invite"),
  });
  const removeMut = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest("DELETE", `/api/partner/me/team/${userId}`);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/partner/me/team"] }),
    onError: onErr("Remove member"),
  });

  /* v25.50 Phase 7 (7c) — edit a member's partner-local contact info. */
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [editMobile, setEditMobile] = useState("");
  const [editContactEmail, setEditContactEmail] = useState("");
  const [editPositionNote, setEditPositionNote] = useState("");
  const openEdit = (m: TeamMember) => {
    setEditing(m);
    setEditMobile(m.mobile ?? "");
    setEditContactEmail(m.contactEmail ?? "");
    setEditPositionNote(m.positionNote ?? "");
  };
  const contactMut = useMutation({
    mutationFn: async () => {
      if (!editing) throw new Error("No member selected");
      const res = await apiRequest("PATCH", `/api/partner/me/team/${editing.userId}/contact`, {
        mobile: editMobile,
        contactEmail: editContactEmail,
        positionNote: editPositionNote,
      });
      return res.json();
    },
    onSuccess: () => {
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["/api/partner/me/team"] });
      toast({ title: "Contact updated" });
    },
    onError: onErr("Update contact"),
  });

  const copyToken = async () => {
    if (!issuedToken) return;
    const redeemUrl = `${window.location.origin}/auth/redeem-partner-invite/${issuedToken.plainToken}`;
    try {
      await navigator.clipboard.writeText(redeemUrl);
      setCopied(true);
    } catch {
      toast({ variant: "destructive", title: "Copy failed", description: "Select and copy the link manually." });
    }
  };

  if (!role.ready || !role.identity) return null;
  const canInvite = isManagingPartner(role.identity.subRole);
  /* v25.16 NL4 — capture self id so we don't render Remove on the current user. */
  const selfUserId = role.identity.identity.userId;
  const activeCount = (q.data?.members ?? []).filter((m) => m.status === "active").length;
  const pendingCount = (q.data?.invitations ?? []).filter((i) => !i.redeemedAt).length;
  /* v25.23 NL-U — count active managing_partners in the rendered list. The
     destructive controls on the SOLE managing_partner must be disabled so the
     workspace is never orphaned (mirrors server FINDING-08 LAST_MANAGING_PARTNER
     guard). `status === "active"` is the rendered equivalent of `!deletedAt`. */
  const managingPartnerCount = (q.data?.members ?? []).filter(
    (m) => m.subRole === "managing_partner" && m.status === "active",
  ).length;
  const LAST_MP_TOOLTIP =
    "Workspace requires at least one managing partner — promote another member first.";

  return (
    <PartnerShell title="Team" tier={role.identity.tier} subRole={role.identity.subRole} partnerName={role.identity.identity.name}>
      <div className="mb-4 text-sm text-[var(--cv-color-text-secondary)]" data-testid="seat-banner">
        {activeCount} active seats + {pendingCount} pending invitations
      </div>
      {/* W3.5 — admin-only note when duplicate historical seats were collapsed
          server-side; the roster below always shows one row per member. */}
      {canInvite && (q.data?.meta?.duplicateSeatCount ?? 0) > 0 && (
        <div
          className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
          data-testid="duplicate-seat-warning"
        >
          Duplicate historical seats hidden; cleanup required.
        </div>
      )}
      {/* v25.15 NM3b — explicit error + loading branches. */}
      {q.isLoading && <div className="text-sm text-[var(--cv-color-text-muted)] mb-2" data-testid="team-loading">Loading…</div>}
      {q.isError && (
        <div
          className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 mb-4"
          data-testid="team-error"
        >
          Could not load team. Please refresh and try again.
        </div>
      )}
      {canInvite && (
        <div className="flex flex-wrap gap-2 mb-6 bg-white p-3 rounded border items-end" data-testid="invite-form">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase text-[var(--cv-color-text-muted)]">Email</label>
            <Input data-testid="invite-email" placeholder="member@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className="max-w-xs" />
          </div>
          {/* 2a — TITLE (display/CRM): the QA professional titles. Presentational
              only; does NOT grant permissions. */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase text-[var(--cv-color-text-muted)]">Title</label>
            <select data-testid="invite-title" value={title} onChange={(e) => setTitle(e.target.value)} className="border rounded px-2 h-9 text-sm">
              {PARTNER_TITLES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          {/* Access level = the 5 permission tiers the server enforces. */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase text-[var(--cv-color-text-muted)]">Access level</label>
            <select data-testid="invite-role" value={subRole} onChange={(e) => setSubRole(e.target.value)} className="border rounded px-2 h-9 text-sm" title={POSITIONS.find((p) => p.value === subRole)?.hint}>
              {POSITIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <Button data-testid="invite-btn" disabled={!email || inviteMut.isPending} onClick={() => inviteMut.mutate()}>
            {inviteMut.isPending ? "Inviting…" : "Invite"}
          </Button>
        </div>
      )}
      {/* v25.23 NH-R — one-time invite-link surface. The raw token is shown ONCE
         on issuance; after copy/dismiss or 60s it is cleared from state and is
         unrecoverable. Without this, the inviter had no way to send the link. */}
      {issuedToken && (
        <div
          className="mb-6 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
          data-testid="invite-token-banner"
        >
          <div className="font-medium mb-1">Invite link for {issuedToken.email || "new member"}</div>
          <div className="text-xs text-amber-800 mb-2">
            This link is shown <strong>only once</strong> and disappears in 60 seconds. Copy it now and send it to the
            invitee — it cannot be retrieved again.
          </div>
          <div className="flex gap-2 items-center">
            <Input
              readOnly
              value={`${window.location.origin}/auth/redeem-partner-invite/${issuedToken.plainToken}`}
              data-testid="invite-token-link"
              className="max-w-lg font-mono text-xs bg-white"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button size="sm" data-testid="invite-token-copy" onClick={copyToken}>
              {copied ? "Copied✓" : "Copy link"}
            </Button>
            <Button size="sm" variant="outline" data-testid="invite-token-dismiss" onClick={clearIssuedToken}>
              Dismiss
            </Button>
          </div>
        </div>
      )}
      <div className="bg-white rounded-lg border overflow-hidden mb-6">
        <div className="px-3 py-2 text-xs uppercase text-[var(--cv-color-text-muted)] bg-[var(--cv-color-surface-2)]">Members</div>
        <table className="w-full text-sm" data-testid="members-table">
          <thead className="bg-[var(--cv-color-surface-2)]"><tr><th className="p-2 text-left">Member</th><th className="p-2 text-left">Contact</th><th className="p-2 text-left">Title</th><th className="p-2 text-left">Access</th><th className="p-2 text-left">Status</th><th className="p-2"></th></tr></thead>
          <tbody>
            {(q.data?.members ?? []).map((m) => (
              <tr key={m.id} className="border-t" data-testid={`member-${m.userId}`}>
                <td className="p-2">
                  {/* v25.50 Phase 7 (7a) — real name/email from users JOIN.
                     W3.2 — the NAME slot renders m.name (or "Pending member"); it
                     must never fall back to email. safePersonDisplayName is a
                     defensive client-side guard in case a future payload
                     regresses and puts an email/opaque id in `name`. Email stays
                     in its own separate line below. */}
                  <div className="font-medium text-[var(--cv-color-text)]">{safePersonDisplayName(m.name, "Pending member")}</div>
                  {m.email && <div className="text-xs text-[var(--cv-color-text-muted)]">{m.email}</div>}
                </td>
                <td className="p-2 text-xs text-[var(--cv-color-text-muted)]">
                  {m.mobile && <div>{m.mobile}</div>}
                  {m.contactEmail && <div>{m.contactEmail}</div>}
                  {m.positionNote && <div className="italic">{m.positionNote}</div>}
                  {!m.mobile && !m.contactEmail && !m.positionNote && <span className="text-[var(--cv-color-text-faint)]">No contact info</span>}
                </td>
                {/* 2a — Title (display/CRM) then Access (permission tier). */}
                <td className="p-2 text-[var(--cv-color-text-muted)]" data-testid={`member-title-${m.userId}`}>{m.title || <span className="text-[var(--cv-color-text-faint)]">—</span>}</td>
                <td className="p-2 text-[var(--cv-color-text-muted)]">{positionLabel(m.subRole)}</td>
                <td className="p-2 text-[var(--cv-color-text-muted)]">{m.status}</td>
                <td className="p-2 text-right whitespace-nowrap">
                  {/* v25.50 Phase 7 (7c) — managing_partner may edit contact info. */}
                  {canInvite && m.status === "active" && (
                    <button
                      data-testid={`edit-contact-${m.userId}`}
                      className="text-[var(--cv-color-text-secondary)] text-xs mr-3 hover:text-[var(--cv-color-text)]"
                      onClick={() => openEdit(m)}
                    >
                      Edit
                    </button>
                  )}
                  {/* v25.16 NL4 — hide Remove on self to prevent workspace lock-out.
                     v25.16 NL3 — disable while a delete is in flight.
                     v25.23 NL-U — disable Remove on the SOLE active managing_partner
                     so the workspace is never orphaned; show an explanatory tooltip. */}
                  {canInvite && m.status === "active" && m.userId !== selfUserId && (() => {
                    const isLastManagingPartner =
                      m.subRole === "managing_partner" && managingPartnerCount <= 1;
                    return (
                      <button
                        data-testid={`remove-${m.userId}`}
                        className="text-red-600 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={removeMut.isPending || isLastManagingPartner}
                        title={isLastManagingPartner ? LAST_MP_TOOLTIP : undefined}
                        data-disabled-reason={isLastManagingPartner ? "last_managing_partner" : undefined}
                        onClick={() => { if (!isLastManagingPartner) removeMut.mutate(m.userId); }}
                      >
                        Remove
                      </button>
                    );
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="px-3 py-2 text-xs uppercase text-[var(--cv-color-text-muted)] bg-[var(--cv-color-surface-2)]">Pending invitations</div>
        <table className="w-full text-sm" data-testid="invitations-table">
          <thead className="bg-[var(--cv-color-surface-2)]"><tr><th className="p-2 text-left">Email</th><th className="p-2 text-left">Title</th><th className="p-2 text-left">Access</th><th className="p-2 text-left">Expires</th></tr></thead>
          <tbody>
            {(q.data?.invitations ?? []).filter((i) => !i.redeemedAt).map((i) => (
              <tr key={i.id} className="border-t" data-testid={`invite-${i.id}`}>
                <td className="p-2">{i.invitedEmail}</td>
                <td className="p-2 text-[var(--cv-color-text-muted)]">{i.title || <span className="text-[var(--cv-color-text-faint)]">—</span>}</td>
                <td className="p-2 text-[var(--cv-color-text-muted)]">{positionLabel(i.subRole)}</td>
                {/* v25.16 NM7 — guard against null expiresAt. */}
                <td className="p-2 text-[var(--cv-color-text-muted)]">{i.expiresAt ? new Date(i.expiresAt).toLocaleDateString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* v25.50 Phase 7 (7c) — contact edit dialog (managing_partner only). */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" data-testid="edit-contact-dialog">
          <div className="bg-white rounded-lg border shadow-lg w-full max-w-md p-5">
            <div className="text-base font-semibold text-[var(--cv-color-text)] mb-1">Edit contact</div>
            <div className="text-xs text-[var(--cv-color-text-muted)] mb-4">{editing.name || editing.userId}</div>
            <label className="block text-xs text-[var(--cv-color-text-secondary)] mb-1">Mobile</label>
            <Input data-testid="edit-mobile" value={editMobile} onChange={(e) => setEditMobile(e.target.value)} placeholder="+1 555 000 0000" className="mb-3" />
            <label className="block text-xs text-[var(--cv-color-text-secondary)] mb-1">Contact email</label>
            <Input data-testid="edit-contact-email" value={editContactEmail} onChange={(e) => setEditContactEmail(e.target.value)} placeholder="name@example.com" className="mb-3" />
            <label className="block text-xs text-[var(--cv-color-text-secondary)] mb-1">Position note</label>
            <Input data-testid="edit-position-note" value={editPositionNote} onChange={(e) => setEditPositionNote(e.target.value)} placeholder="e.g. Head of Deal Flow" className="mb-4" />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" data-testid="edit-contact-cancel" onClick={() => setEditing(null)}>Cancel</Button>
              <Button size="sm" data-testid="edit-contact-save" disabled={contactMut.isPending} onClick={() => contactMut.mutate()}>
                {contactMut.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </PartnerShell>
  );
}
