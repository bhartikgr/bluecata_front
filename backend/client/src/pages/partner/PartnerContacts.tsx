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
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PartnerShell, PartnerEmptyState } from "@/components/partner/PartnerShell";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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
  return e.message;
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

function money(minor: number): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(minor / 100);
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

  const detailQ = useQuery<{ contact: CrmContact; connections: CrmConnections }>({
    queryKey: ["/api/partner/me/crm/contacts", selectedId],
    enabled: role.ready && !!selectedId,
    queryFn: async () =>
      (await apiRequest("GET", `/api/partner/me/crm/contacts/${selectedId}`)).json(),
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
                      <td className="p-3 text-[var(--cv-color-text-muted)]">{r.stage || "—"}</td>
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
            </div>
          )}
        </div>
      </div>
    </PartnerShell>
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
            <span className="text-[var(--cv-color-text-muted)]">{money(s.amountMinor)} · {s.status}</span>
          </li>
        ))}
      </ConnGroup>

      <ConnGroup label="Cap-table holdings" count={c.capTableHoldings.length}>
        {c.capTableHoldings.map((h) => (
          <li key={h.companyId} className="flex justify-between" data-testid={`conn-cap-${h.companyId}`}>
            <span>{h.companyId}</span>
            <span className="text-[var(--cv-color-text-muted)]">{h.ownershipPct.toFixed(2)}%</span>
          </li>
        ))}
      </ConnGroup>

      <ConnGroup label="Portfolio" count={c.portfolio.length}>
        {c.portfolio.map((p) => (
          <li key={p.id} className="flex justify-between" data-testid={`conn-portfolio-${p.companyId}`}>
            <span>{p.displayName || p.companyId}</span>
            <span className="text-[var(--cv-color-text-muted)]">{p.stage}</span>
          </li>
        ))}
      </ConnGroup>

      <div data-testid="conn-collective">
        <div className="text-sm font-medium text-[var(--cv-color-text-secondary)]">Collective</div>
        {c.collectiveMembership ? (
          <div className="text-sm text-[var(--cv-color-text-muted)]">
            {c.collectiveMembership.role} · {c.collectiveMembership.status}
          </div>
        ) : (
          <div className="text-sm text-[var(--cv-color-text-faint)]">Not a member</div>
        )}
      </div>

      <div data-testid="conn-client">
        <div className="text-sm font-medium text-[var(--cv-color-text-secondary)]">Client</div>
        {c.client ? (
          <div className="text-sm text-[var(--cv-color-text-muted)]">
            {c.client.companyId} · {c.client.stage}
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
