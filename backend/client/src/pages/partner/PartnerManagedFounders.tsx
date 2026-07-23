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
import { useQuery } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { PartnerShell, PartnerEmptyState } from "@/components/partner/PartnerShell";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { apiRequest } from "@/lib/queryClient";

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

interface LayerRow { id: string; contact_ref: string; layer: string; engagement_id: string | null; updated_at: string }

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
