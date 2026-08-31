/**
 * GROUP F1 — Partner CRM (person-level) full-parity UI.
 *
 * Headless no longer: this page fronts the EXISTING `partner_crm_contacts`
 * table + CP-008 hash chain via the `/api/partner/me/crm/contacts` surface
 * (server/partnerWorkspaceV19Store.ts). List + filter, Rule #13 create
 * (first + last both required), and a detail drawer showing the read-only,
 * partner-scoped cross-module connections (SPV LP, cap-table, portfolio,
 * Collective, client). All writes are signed-agreement-gated server-side.
 *
 * w-partner F6 — the detail pane is no longer read-only. PATCH
 * /api/partner/me/crm/contacts/:id already existed (partnerWorkspaceV19Store.ts:2045,
 * crmMeUpdateSchema) but had no UI, so a contact could be created and starred
 * but never corrected. FOLLOW-ON (no server change needed, UI not built here):
 * the per-contact notes endpoint (partnerWorkspaceV19Store.ts:2116) and the
 * task endpoints (:2133, :2156) are still unwired — noted, not removed.
 */
import { useEffect, useMemo, useState } from "react";
/* WAVE 115 · FINDING 1 sweep — a row must not be identified by a raw storage key. */
import { partyReferenceLabel, humanizeMachineKey } from "@/lib/partnerDisplay"; /* WAVE 124 · FINDING 1 — `humanizeMachineKey` added to the import this file ALREADY had. Reviewer C (C-24) measured three treatments of one identifier in one panel; there is now one. */
import { useCollectiveStream } from "@/lib/sseClient"; /* WAVE 18 / XT-7 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PartnerShell, PartnerEmptyState } from "@/components/partner/PartnerShell";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatMinor } from "@/lib/currency";
import PartnerCsvDownloadButton from "@/components/partner/PartnerCsvDownloadButton"; /* WAVE 179 · ITEM C · R151.2 */
import { describeFailure } from "@/lib/failureMessage";

/* w-partner F6 — the editable subset of crmMeUpdateSchema, mapped to the
   snake_case keys the server validates. Only CHANGED keys are sent, so an
   untouched field can never be overwritten and a partially-valid form cannot
   400 the whole record (the F2-b failure mode). */
// w-partner CODE-REVIEW M2: `required` fields reject the empty string in
// crmMeUpdateSchema (first_name/last_name .min(1), email .email()). Clearing one
// would 400 the whole PATCH with an opaque message — the exact F2-b failure mode.
// We mark them so the client blocks the clear with a named error instead, and we
// also surface the server's field-level `details` if a 400 slips through.
const EDITABLE_FIELDS = [
  { key: "first_name", label: "First name", required: true, from: (c: CrmContact) => c.firstName ?? "" },
  { key: "last_name", label: "Last name", required: true, from: (c: CrmContact) => c.lastName ?? "" },
  { key: "email", label: "Email", required: true, from: (c: CrmContact) => c.email ?? "" },
  { key: "role", label: "Role", required: false, from: (c: CrmContact) => c.role ?? "" },
  { key: "org", label: "Organization", required: false, from: (c: CrmContact) => c.org ?? "" },
  { key: "stage", label: "Stage", required: false, from: (c: CrmContact) => c.stage ?? "" },
  { key: "notes", label: "Notes", required: false, from: (c: CrmContact) => c.notes ?? "" },
] as const;

/** Render a server INVALID_BODY 400's field-level issues, mirroring the portfolio
 *  dialog's describeSaveError so a rejected contact edit names the offending field
 *  rather than showing an opaque message (M2). */
function describeContactSaveError(e: Error): string {
  // apiRequest throws ApiError with the parsed body on `.payload` (queryClient.ts);
  // e.message is a human sentence, NOT JSON — so read the payload, mirroring
  // PartnerPortfolioProfileDialog.describeSaveError. The contact route answers a 400
  // as { error:"INVALID_BODY", details: zodError.flatten() } → { fieldErrors }.
  const payload = (e as { payload?: unknown }).payload;
  const flat = (payload as { details?: { fieldErrors?: Record<string, string[]> } } | undefined)
    ?.details?.fieldErrors;
  if (flat && typeof flat === "object") {
    const parts = Object.entries(flat)
      .filter(([, v]) => Array.isArray(v) && v.length > 0)
      .map(([k, v]) => `${k}: ${v[0]}`);
    if (parts.length > 0) return parts.join("; ");
  }
  /* WAVE 197 #47 — WRITE. Only the RAW TAIL of this helper is wrapped. The
     field-error branch above builds authored validation prose and is left
     exactly as it is; that branch is the part that was already correct. */
  return describeFailure(e, "write");
}

interface CrmNote { id: string; body: string; createdAt: string; authorId: string | null }
interface CrmTask {
  id: string;
  title: string;
  priority: "low" | "medium" | "high";
  status: "open" | "done";
  due: string | null;
  createdAt: string;
  completedAt: string | null;
}
interface CrmContact {
  id: string;
  email: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  org: string;
  stage: string | null;
  companyId: string | null;
  notes: string;
  tags: string[];
  noteLog: CrmNote[];
  tasks: CrmTask[];
  starred: boolean;
  sourceKind: string | null;
  sourceRef: string | null;
  lastContactAt: string | null;
  createdAt: string;
  updatedAt: string;
}
interface CrmConnections {
  resolvedUserId: string | null;
  spvLpMemberships: Array<{ spvId: string; spvName: string; status: string; amountMinor: number }>;
  capTableHoldings: Array<{ companyId: string; ownershipPct: number }>;
  portfolio: Array<{ id: string; companyId: string; displayName: string; stage: string }>;
  collectiveMembership: { userId: string; chapterId: string; role: string; status: string } | null;
  client: { companyId: string; stage: string; lastActivityAt: string | null } | null;
}

/* WAVE 171 — A CONTACT CAN NOW BE LINKED TO A VEHICLE.
   `CrmConnections` above is untouched, and so is the panel that renders it. What
   it derives are POSITIONS: an `spvLpMemberships` row exists because the person
   holds a commitment, a `capTableHoldings` row because they hold shares. Useful,
   and unable to express the thing a partner needs first — "I know this person in
   connection with this vehicle" — before any money exists.

   A LINK IS NOT A COMMITMENT. There is deliberately no amount on this type, no
   currency and no status, so nothing on this screen can render a link as capital
   even by accident. Note what `relationship` is NOT: not a subscription state and
   not a commitment state. `prospective_lp` is the partner's own note about their
   own pipeline and is never joined to `spv_commitments.status`. */
interface CrmContactLink {
  id: string;
  targetKind: "spv" | "company";
  targetId: string;
  targetName: string;
  relationship: string;
  note: string;
  createdAt: string;
}
interface CrmLinkTargets {
  spvs: Array<{ id: string; name: string }>;
  companies: Array<{ id: string; name: string }>;
}

/* WAVE 21 ITEM 5: hardcoded /100 AND a hardcoded USD label. The currency
   is now a parameter so a non-USD caller cannot be silently mislabelled. */
function money(minor: number, currency = "USD"): string {
  return formatMinor(minor, currency);
}

export default function PartnerContacts() {
  const role = useRequirePartnerRole();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [starredOnly, setStarredOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [org, setOrg] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const listQ = useQuery<{ contacts: CrmContact[]; count: number }>({
    queryKey: ["/api/partner/me/crm/contacts"],
    enabled: role.ready,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/crm/contacts")).json(),
  });

  const detailQ = useQuery<{
    contact: CrmContact;
    connections: CrmConnections;
    /* WAVE 171 — OPTIONAL on purpose. A server that has not been redeployed yet
       omits it, and this screen must then render the connections panel exactly as
       it did before rather than crashing on `undefined.map`. */
    links?: CrmContactLink[];
  }>({
    queryKey: ["/api/partner/me/crm/contacts", selectedId],
    enabled: role.ready && !!selectedId,
    queryFn: async () =>
      (await apiRequest("GET", `/api/partner/me/crm/contacts/${selectedId}`)).json(),
  });

  /* ── WAVE 18 / XT-7 — SUBSCRIBE THIS PAGE TO THE `crm` SSE TOPIC ──────────
   *
   * WIRING, not a build, and nothing on the server side is touched — which
   * matters here, because the publisher lives in
   * server/partnerWorkspaceV19Store.ts and owner ruling A-23 puts that file's
   * ROUTES out of bounds this wave. Listening to a topic a live route already
   * publishes on adds no second door: no endpoint, no store function and no
   * table is added or changed by this block.
   *
   *   • PUBLISHER — ssePublish(partnerId, "crm", …) on every contact write:
   *     partnerWorkspaceV19Store.ts:721 (update/star/delete mutations, typed by
   *     `mutation`) and :814 (`crm.created`), plus :1506, :1676, :1733 where a
   *     pipeline write touches a contact.
   *   • TRANSPORT — `crm` is in SSE_TOPICS (sseHub.ts:49) and PARTNER_TOPICS
   *     (collectiveSseRoutes.ts:71): partner team members only.
   *   • SUBSCRIBER — none, until now. A CRM is a MULTI-SEAT surface by
   *     definition (partner_team_members), so two people working the same
   *     contact list is the normal case, and each was seeing a snapshot frozen
   *     at their last manual reload. This is also the surface where a stale read
   *     is worst: the contact rows carry an append-only hash chain
   *     (prevHash/currHash), and a PATCH composed against a stale row is how a
   *     lost update happens.
   *
   * The frame carries `contactId` and a mutation type — never contact fields —
   * so the response is a refetch of the server's projection, never a local
   * patch from the frame.
   */
  const [liveCrmEvents, setLiveCrmEvents] = useState(0);
  useCollectiveStream({
    chapterId: "",
    scope: "partner",
    path: "/api/stream",
    topics: ["crm"],
    enabled: role.ready,
    onMessage: (topic, payload) => {
      if (topic !== "crm") return;
      const frame = payload as { contactId?: unknown } | null;
      const contactId = typeof frame?.contactId === "string" ? frame.contactId : null;
      qc.invalidateQueries({ queryKey: ["/api/partner/me/crm/contacts"] });
      if (contactId) qc.invalidateQueries({ queryKey: ["/api/partner/me/crm/contacts", contactId] });
      setLiveCrmEvents((n) => n + 1);
    },
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/partner/me/crm/contacts", {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim() || undefined,
        org: org.trim() || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      setFirstName("");
      setLastName("");
      setEmail("");
      setOrg("");
      setCreateError(null);
      qc.invalidateQueries({ queryKey: ["/api/partner/me/crm/contacts"] });
    },
    onError: (err: any) => {
      setCreateError(err?.message ?? "Could not create contact.");
    },
  });

  /* w-partner F6 — edit buffer, re-seeded whenever a different contact loads.
     `baseline` is what the server last returned; the diff against it is what
     gets PATCHed. */
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [baseline, setBaseline] = useState<Record<string, string>>({});
  const detailContact = detailQ.data?.contact;
  useEffect(() => {
    if (!detailContact) return;
    const seed: Record<string, string> = {};
    for (const f of EDITABLE_FIELDS) seed[f.key] = f.from(detailContact);
    setEdit(seed);
    setBaseline(seed);
  }, [detailContact]);

  const changedKeys = useMemo(
    () => EDITABLE_FIELDS.filter((f) => (edit[f.key] ?? "") !== (baseline[f.key] ?? "")).map((f) => f.key),
    [edit, baseline],
  );

  const updateMut = useMutation({
    mutationFn: async () => {
      // M2: block clearing a required field client-side with a named error rather
      // than letting the empty string 400 the whole PATCH opaquely.
      const cleared = changedKeys.filter((k) => {
        const meta = EDITABLE_FIELDS.find((f) => f.key === k);
        return meta?.required && !(edit[k] ?? "").trim();
      });
      if (cleared.length > 0) {
        const labels = cleared
          .map((k) => EDITABLE_FIELDS.find((f) => f.key === k)?.label ?? k)
          .join(", ");
        throw new Error(`${labels} cannot be empty`);
      }
      const patch: Record<string, string | null> = {};
      for (const k of changedKeys) {
        const v = (edit[k] ?? "").trim();
        // `stage` is the only nullable field in the schema; clearing it means
        // null, whereas clearing a plain string field means the empty string.
        patch[k] = k === "stage" && !v ? null : v;
      }
      return (await apiRequest("PATCH", `/api/partner/me/crm/contacts/${selectedId}`, patch)).json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/partner/me/crm/contacts"] });
      if (selectedId) qc.invalidateQueries({ queryKey: ["/api/partner/me/crm/contacts", selectedId] });
      toast({ title: "Contact updated" });
    },
    onError: (e: Error) =>
      toast({ variant: "destructive", title: "Could not update contact", description: describeContactSaveError(e) }),
  });

  const starMut = useMutation({
    mutationFn: async ({ id, starred }: { id: string; starred: boolean }) => {
      await apiRequest("POST", `/api/partner/me/crm/contacts/${id}/star`, { starred });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/partner/me/crm/contacts"] });
      if (selectedId) qc.invalidateQueries({ queryKey: ["/api/partner/me/crm/contacts", selectedId] });
    },
  });

  const filtered = useMemo(() => {
    const rows = listQ.data?.contacts ?? [];
    const needle = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (starredOnly && !r.starred) return false;
      if (!needle) return true;
      return (
        r.name.toLowerCase().includes(needle) ||
        (r.email ?? "").toLowerCase().includes(needle) ||
        (r.org ?? "").toLowerCase().includes(needle)
      );
    });
  }, [listQ.data, search, starredOnly]);

  if (!role.ready || !role.identity) return null;
  const canCreate = firstName.trim().length > 0 && lastName.trim().length > 0;
  const hasRows = (listQ.data?.contacts.length ?? 0) > 0;

  return (
    <PartnerShell
      title="Contacts"
      tier={role.identity.tier}
      subRole={role.identity.subRole}
      partnerName={role.identity.identity.name}
    >
      {/* WAVE 18 / XT-7 — SIBLING element, added above the existing grid rather
          than as text inside an existing node. Shown only after a frame has been
          applied: proof of liveness, not an assertion of it. */}
      {liveCrmEvents > 0 && (
        <div className="mb-4 text-xs text-[var(--cv-color-text-muted)]" data-testid="contacts-live-note">
          Refreshed from a live CRM update.
        </div>
      )}
      {/* WAVE 179 · ITEM C · R151.2 — export THIS firm's contacts. A STATIC SIBLING
          above the existing grid; nothing already on this page is touched. The
          server calls `listCrmContactsForPartner`, the same partner-scoped read that
          feeds the list below, in the same order, so the file is this page. */}
      <div className="mb-4 flex items-center gap-2" data-testid="contacts-export">
        <PartnerCsvDownloadButton
          url="/api/partner/me/crm/contacts.csv"
          filename="crm-contacts.csv"
          testid="contacts-export-button"
        />
        <span className="text-xs text-[var(--cv-color-text-muted)]" data-testid="contacts-export-note">
          Your firm's contacts only. Search and filters on this page are not applied — the file is the full list.
        </span>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {/* Rule #13 create — first AND last required */}
          <div
            className="mb-4 rounded-lg border border-[var(--cv-color-border)] bg-white p-4"
            data-testid="contacts-create"
          >
            <div className="mb-2 text-sm font-medium text-[var(--cv-color-text-secondary)]">Add a contact</div>
            <div className="flex flex-wrap gap-2">
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First name"
                className="min-w-[8rem] flex-1 rounded-md border border-[var(--cv-color-border)] px-3 py-2 text-sm"
                data-testid="contacts-first-name"
              />
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Last name"
                className="min-w-[8rem] flex-1 rounded-md border border-[var(--cv-color-border)] px-3 py-2 text-sm"
                data-testid="contacts-last-name"
              />
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email (optional)"
                className="min-w-[10rem] flex-1 rounded-md border border-[var(--cv-color-border)] px-3 py-2 text-sm"
                data-testid="contacts-email"
              />
              <input
                value={org}
                onChange={(e) => setOrg(e.target.value)}
                placeholder="Organization (optional)"
                className="min-w-[10rem] flex-1 rounded-md border border-[var(--cv-color-border)] px-3 py-2 text-sm"
                data-testid="contacts-org"
              />
              <button
                type="button"
                disabled={!canCreate || createMut.isPending}
                onClick={() => createMut.mutate()}
                className="rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                style={{ background: "var(--cv-accent, #1a1a2e)" }}
                data-testid="contacts-create-submit"
              >
                {createMut.isPending ? "Adding…" : "Add"}
              </button>
            </div>
            {!canCreate && (firstName.length > 0 || lastName.length > 0) && (
              <div className="mt-2 text-xs text-amber-700" data-testid="contacts-rule13-hint">
                First and last name are both required.
              </div>
            )}
            {createError && (
              <div className="mt-2 text-xs text-rose-700" data-testid="contacts-create-error">
                {createError}
              </div>
            )}
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, org…"
              className="max-w-xs flex-1 rounded-md border border-[var(--cv-color-border)] px-3 py-2 text-sm"
              data-testid="contacts-search"
            />
            <label className="flex items-center gap-2 text-sm text-[var(--cv-color-text-secondary)]">
              <input
                type="checkbox"
                checked={starredOnly}
                onChange={(e) => setStarredOnly(e.target.checked)}
                data-testid="contacts-starred-filter"
              />
              Starred only
            </label>
          </div>

          {listQ.isLoading && (
            <div className="text-[var(--cv-color-text-muted)]" data-testid="contacts-loading">Loading…</div>
          )}
          {listQ.isError && (
            <div
              className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"
              data-testid="contacts-error"
            >
              Could not load your contacts. Please refresh and try again.
            </div>
          )}
          {!listQ.isLoading && !listQ.isError && !hasRows && (
            <PartnerEmptyState
              title="No contacts yet"
              description="Add a contact above, or import LPs from an SPV using ‘Add to CRM’."
            />
          )}

          {!listQ.isError && hasRows && (
            <div className="overflow-hidden rounded-lg border border-[var(--cv-color-border)] bg-white">
              <table className="w-full text-sm" data-testid="contacts-table">
                <thead className="bg-[var(--cv-color-surface-2)]">
                  <tr>
                    <th className="p-3 text-left">Name</th>
                    <th className="p-3 text-left">Email</th>
                    <th className="p-3 text-left">Org</th>
                    <th className="p-3 text-left">Stage</th>
                    <th className="p-3 text-left"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr data-testid="contacts-no-match">
                      <td className="p-3 text-[var(--cv-color-text-muted)]" colSpan={5}>No contacts match your filters.</td>
                    </tr>
                  )}
                  {filtered.map((r) => (
                    <tr
                      key={r.id}
                      className="cursor-pointer border-t hover:bg-[var(--cv-color-surface-2)]"
                      onClick={() => setSelectedId(r.id)}
                      data-testid={`contacts-row-${r.id}`}
                    >
                      <td className="p-3 font-medium">{r.name}</td>
                      <td className="p-3 text-[var(--cv-color-text-muted)]">{r.email || "—"}</td>
                      <td className="p-3 text-[var(--cv-color-text-muted)]">{r.org || "—"}</td>
                      {/* WAVE 124 · FINDING 1 — the contacts table printed the raw CRM
                          stage key. Sentence-cased through the shared fallback. The
                          vocabulary is NOT remapped onto any other ladder: per R91 the
                          partner, founder and investor ladders are genuinely different
                          and merging them would need an owner ruling. */}
                      <td className="p-3 text-[var(--cv-color-text-muted)]">{humanizeMachineKey(r.stage, "—")}</td>
                      <td className="p-3 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            starMut.mutate({ id: r.id, starred: !r.starred });
                          }}
                          className="text-lg"
                          title={r.starred ? "Unstar" : "Star"}
                          data-testid={`contacts-star-${r.id}`}
                        >
                          {r.starred ? "★" : "☆"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Detail + connections panel */}
        <div className="lg:col-span-1">
          {!selectedId && (
            <div
              className="rounded-lg border border-dashed border-[var(--cv-color-border)] p-6 text-sm text-[var(--cv-color-text-muted)]"
              data-testid="contacts-detail-empty"
            >
              Select a contact to see its details and cross-module connections.
            </div>
          )}
          {selectedId && detailQ.isLoading && (
            <div className="text-[var(--cv-color-text-muted)]" data-testid="contacts-detail-loading">Loading…</div>
          )}
          {selectedId && detailQ.data && (
            <div
              className="rounded-lg border border-[var(--cv-color-border)] bg-white p-4"
              data-testid="contacts-detail"
            >
              <div className="mb-3 flex items-start justify-between">
                <div>
                  <div className="text-base font-semibold">{detailQ.data.contact.name}</div>
                  <div className="text-sm text-[var(--cv-color-text-muted)]">{detailQ.data.contact.email || "No email"}</div>
                  {detailQ.data.contact.org && (
                    <div className="text-sm text-[var(--cv-color-text-muted)]">{detailQ.data.contact.org}</div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="text-[var(--cv-color-text-faint)] hover:text-[var(--cv-color-text-secondary)]"
                  data-testid="contacts-detail-close"
                >
                  ✕
                </button>
              </div>

              {/* w-partner F6 — editable fields with an EXPLICIT Save. Nothing
                  autosaves, and only changed keys are sent. */}
              <div className="space-y-2 border-t pt-3" data-testid="contacts-edit">
                <div className="text-xs font-medium uppercase tracking-wide text-[var(--cv-color-text-faint)]">
                  Edit contact
                </div>
                {EDITABLE_FIELDS.map((f) => (
                  <label key={f.key} className="block">
                    <span className="text-xs text-[var(--cv-color-text-muted)]">{f.label}</span>
                    <input
                      value={edit[f.key] ?? ""}
                      onChange={(e) => setEdit((prev) => ({ ...prev, [f.key]: e.target.value }))}
                      className="mt-0.5 w-full rounded-md border border-[var(--cv-color-border)] px-2 py-1 text-sm"
                      data-testid={`contacts-edit-${f.key}`}
                    />
                  </label>
                ))}
                <button
                  type="button"
                  disabled={changedKeys.length === 0 || updateMut.isPending}
                  onClick={() => updateMut.mutate()}
                  className="rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  style={{ background: "var(--cv-accent, #1a1a2e)" }}
                  data-testid="contacts-edit-save"
                >
                  {updateMut.isPending ? "Saving…" : "Save changes"}
                </button>
              </div>

              <ConnectionsPanel connections={detailQ.data.connections} />

              {/* WAVE 171 — STATIC SIBLING, appended beside the panel above and
                  never wrapped around it. The connections panel renders on the
                  same terms it always did. */}
              <ContactLinksPanel contactId={detailQ.data.contact.id} links={detailQ.data.links ?? []} />
            </div>
          )}
        </div>
      </div>
    </PartnerShell>
  );
}

/* ══ WAVE 171 · RELATIONSHIP LINKS ══════════════════════════════════════
   The control the CRM did not have: link a contact to an SPV this partner
   sponsors, or to a company attributed to them.

   The picker is populated by the SERVER (`/api/partner/me/crm/link-targets`), so
   the fence is not a client-side filter over a wider list — a vehicle belonging
   to another partner never reaches this component at all, and posting a forged id
   is refused server-side against the same fence.

   NO MONEY IS RENDERED ANYWHERE IN THIS PANEL and `money()` is not called from
   it. The heading says what a link is and, just as importantly, what it is not,
   because a partner who reads "linked to Fund II" could otherwise reasonably
   assume they had recorded a commitment. */
const LINK_RELATIONSHIP_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "prospective_lp", label: "Prospective LP" },
  { value: "introducer", label: "Introducer" },
  { value: "adviser", label: "Adviser" },
  { value: "other", label: "Other" },
];

function ContactLinksPanel({ contactId, links }: { contactId: string; links: CrmContactLink[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [kind, setKind] = useState<"spv" | "company">("spv");
  const [targetId, setTargetId] = useState<string>("");
  const [relationship, setRelationship] = useState<string>("prospective_lp");
  const [note, setNote] = useState<string>("");
  const [linkError, setLinkError] = useState<string | null>(null);

  const targetsQ = useQuery<CrmLinkTargets>({
    queryKey: ["/api/partner/me/crm/link-targets"],
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/crm/link-targets")).json(),
  });

  /* Hoisted per the guard's shape rule: the option list is derived here, not
     branched inside JSX. An unreadable or empty fence yields an EMPTY array, and
     the panel then says so in words rather than offering an empty picker. */
  const options = useMemo<Array<{ id: string; name: string }>>(() => {
    const d = targetsQ.data;
    if (!d) return [];
    return kind === "spv" ? (d.spvs ?? []) : (d.companies ?? []);
  }, [targetsQ.data, kind]);

  const spvLinks = useMemo(() => links.filter((l) => l.targetKind === "spv"), [links]);
  const companyLinks = useMemo(() => links.filter((l) => l.targetKind === "company"), [links]);

  const createMut = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("POST", `/api/partner/me/crm/contacts/${contactId}/links`, {
          target_kind: kind,
          target_id: targetId,
          relationship,
          note,
        })
      ).json(),
    onSuccess: () => {
      setTargetId("");
      setNote("");
      setLinkError(null);
      void qc.invalidateQueries({ queryKey: ["/api/partner/me/crm/contacts", contactId] });
      toast({ title: "Link added" });
    },
    /* The SERVER'S OWN SENTENCE, not an invented one (R58/R77). */
    /* WAVE 197 #44 — WRITE, and R58/R77 still holds: `describeFailure` RETURNS
       the server's own sentence when the server actually stated one. It only
       substitutes copy when the text is a browser exception or carries
       internal detail — cases where there is no server sentence to respect. */
    onError: (e: unknown) => setLinkError(describeFailure(e, "write")),
  });

  const removeMut = useMutation({
    mutationFn: async (linkId: string) =>
      (await apiRequest("DELETE", `/api/partner/me/crm/contacts/${contactId}/links/${linkId}`)).json(),
    onSuccess: () => {
      setLinkError(null);
      void qc.invalidateQueries({ queryKey: ["/api/partner/me/crm/contacts", contactId] });
    },
    /* WAVE 197 #45 — WRITE (remove link). Same banner as #44. */
    onError: (e: unknown) => setLinkError(describeFailure(e, "write")),
  });

  return (
    <div className="space-y-3 border-t pt-3" data-testid="contacts-links">
      <div className="text-xs font-medium uppercase tracking-wide text-[var(--cv-color-text-faint)]">
        Relationship links
      </div>
      {/* THE SENTENCE THAT STOPS A LINK BEING READ AS A COMMITMENT. */}
      <div className="text-xs text-[var(--cv-color-text-muted)]" data-testid="contacts-links-disclaimer">
        A link records who you know in connection with a vehicle or company. It is not a subscription, an
        invitation or a commitment, and it does not reserve or allocate any amount. Commitments appear under
        Connections above, once they exist.
      </div>

      <ConnGroup label="Linked vehicles" count={spvLinks.length}>
        {spvLinks.map((l) => (
          <li key={l.id} className="flex justify-between gap-2" data-testid={`link-spv-${l.targetId}`}>
            <span>
              {l.targetName} · {humanizeMachineKey(l.relationship)}
            </span>
            <button
              type="button"
              className="text-xs underline text-[var(--cv-color-text-muted)]"
              onClick={() => removeMut.mutate(l.id)}
              data-testid={`link-remove-${l.id}`}
            >
              Remove
            </button>
          </li>
        ))}
      </ConnGroup>

      <ConnGroup label="Linked companies" count={companyLinks.length}>
        {companyLinks.map((l) => (
          <li key={l.id} className="flex justify-between gap-2" data-testid={`link-company-${l.targetId}`}>
            <span>
              {l.targetName} · {humanizeMachineKey(l.relationship)}
            </span>
            <button
              type="button"
              className="text-xs underline text-[var(--cv-color-text-muted)]"
              onClick={() => removeMut.mutate(l.id)}
              data-testid={`link-remove-${l.id}`}
            >
              Remove
            </button>
          </li>
        ))}
      </ConnGroup>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value === "company" ? "company" : "spv");
            setTargetId("");
          }}
          className="rounded-md border px-2 py-1 text-sm"
          data-testid="link-kind"
          aria-label="What to link to"
        >
          <option value="spv">SPV you sponsor</option>
          <option value="company">Portfolio company</option>
        </select>
        <select
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          className="rounded-md border px-2 py-1 text-sm"
          data-testid="link-target"
          aria-label="Which vehicle or company"
        >
          <option value="">Select…</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <select
          value={relationship}
          onChange={(e) => setRelationship(e.target.value)}
          className="rounded-md border px-2 py-1 text-sm"
          data-testid="link-relationship"
          aria-label="Relationship"
        >
          {LINK_RELATIONSHIP_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          className="rounded-md border px-2 py-1 text-sm"
          data-testid="link-note"
          aria-label="Note about this link"
        />
        <button
          type="button"
          disabled={!targetId || createMut.isPending}
          onClick={() => createMut.mutate()}
          className="rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          style={{ background: "var(--cv-accent, #1a1a2e)" }}
          data-testid="link-add"
        >
          {createMut.isPending ? "Linking…" : "Add link"}
        </button>
      </div>

      {/* An empty fence is stated, never left as a silently empty picker. */}
      {targetsQ.isSuccess && options.length === 0 && (
        <div className="text-xs text-[var(--cv-color-text-faint)]" data-testid="link-no-targets">
          {kind === "spv"
            ? "You do not sponsor any active SPVs yet, so there is nothing to link to."
            : "No companies are attributed to your organisation yet, so there is nothing to link to."}
        </div>
      )}

      {linkError && (
        <div className="text-xs text-red-700" data-testid="link-error">
          {linkError}
        </div>
      )}
    </div>
  );
}

function ConnectionsPanel({ connections }: { connections: CrmConnections }) {
  const c = connections;
  return (
    <div className="space-y-3 border-t pt-3" data-testid="contacts-connections">
      <div className="text-xs font-medium uppercase tracking-wide text-[var(--cv-color-text-faint)]">
        Connections
      </div>

      <ConnGroup label="SPV LP memberships" count={c.spvLpMemberships.length}>
        {c.spvLpMemberships.map((s) => (
          <li key={s.spvId} className="flex justify-between" data-testid={`conn-spv-${s.spvId}`}>
            <span>{s.spvName}</span>
            <span className="text-[var(--cv-color-text-muted)]">{money(s.amountMinor)} · {humanizeMachineKey(s.status)}</span>
          </li>
        ))}
      </ConnGroup>

      <ConnGroup label="Cap-table holdings" count={c.capTableHoldings.length}>
        {c.capTableHoldings.map((h) => (
          <li key={h.companyId} className="flex justify-between" data-testid={`conn-cap-${h.companyId}`}>
            <span>{partyReferenceLabel(h.companyId)}</span>
            <span className="text-[var(--cv-color-text-muted)]">{h.ownershipPct.toFixed(2)}%</span>
          </li>
        ))}
      </ConnGroup>

      <ConnGroup label="Portfolio" count={c.portfolio.length}>
        {c.portfolio.map((p) => (
          <li key={p.id} className="flex justify-between" data-testid={`conn-portfolio-${p.companyId}`}>
            <span>{p.displayName || partyReferenceLabel(p.companyId)}</span>
            <span className="text-[var(--cv-color-text-muted)]">{humanizeMachineKey(p.stage)}</span>
          </li>
        ))}
      </ConnGroup>

      <div data-testid="conn-collective">
        <div className="text-sm font-medium text-[var(--cv-color-text-secondary)]">Collective</div>
        {c.collectiveMembership ? (
          <div className="text-sm text-[var(--cv-color-text-muted)]">
            {humanizeMachineKey(c.collectiveMembership.role)} · {humanizeMachineKey(c.collectiveMembership.status)}
          </div>
        ) : (
          <div className="text-sm text-[var(--cv-color-text-faint)]">Not a member</div>
        )}
      </div>

      <div data-testid="conn-client">
        <div className="text-sm font-medium text-[var(--cv-color-text-secondary)]">Client</div>
        {c.client ? (
          <div className="text-sm text-[var(--cv-color-text-muted)]">
            {partyReferenceLabel(c.client.companyId)} · {humanizeMachineKey(c.client.stage)}
          </div>
        ) : (
          <div className="text-sm text-[var(--cv-color-text-faint)]">Not a client</div>
        )}
      </div>
    </div>
  );
}

function ConnGroup({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-sm font-medium text-[var(--cv-color-text-secondary)]">
        {label} <span className="text-[var(--cv-color-text-faint)]">({count})</span>
      </div>
      {count === 0 ? (
        <div className="text-sm text-[var(--cv-color-text-faint)]">None</div>
      ) : (
        <ul className="mt-1 space-y-1 text-sm">{children}</ul>
      )}
    </div>
  );
}
