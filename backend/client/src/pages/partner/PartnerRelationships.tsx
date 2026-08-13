/**
 * WAVE 30 · ENGINE 2 — Relationship Map (`partner_company_relationship` spine).
 *
 * Migration 0136 (Wave C-2.h) created the spine and `pcr_surface_presence`,
 * backfilled them once, and stopped. Verified at source before this page was
 * written: zero readers, zero writers, zero routes, zero UI tree-wide. This page
 * is the spine's first surface.
 *
 * WHAT IT ANSWERS: the platform tracks a partner↔company relationship in four
 * separate places (Managed Founder CRM, deal pipeline, client attributions,
 * portfolio) with nothing joining them. Until now a partner could not ask "what
 * is our FULL relationship with this company?" without checking four screens.
 * This is that one screen.
 *
 * The "Reconcile" action is not a refresh button. Because 0136's backfill was
 * one-shot and no forward-write helper was ever built, every surface row created
 * between that migration and Wave 30 is missing from the spine. Reconcile is the
 * repair path for exactly that gap, and the panel says so rather than leaving the
 * partner to guess.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PartnerShell, PartnerEmptyState } from "@/components/partner/PartnerShell";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { apiRequest } from "@/lib/queryClient";

type PcrSurface = "mfc" | "pipeline" | "clients" | "portfolio";

interface PresenceRow {
  id: string;
  surface: PcrSurface;
  rowId: string;
  addedAt: string;
  removedAt: string | null;
}

interface RelationshipRow {
  id: string;
  partnerId: string;
  companyId: string;
  companyName: string | null;
  createdAt: string;
  updatedAt: string;
  activeSurfaces: PcrSurface[];
  pastSurfaces: PcrSurface[];
  presence: PresenceRow[];
}

interface RelationshipsResponse {
  relationships: RelationshipRow[];
  breakdown: Record<PcrSurface, number>;
  surfaceLabels: Record<PcrSurface, string>;
}

const SURFACE_ORDER: PcrSurface[] = ["mfc", "pipeline", "clients", "portfolio"];

/* Mirrors the server's PCR_SURFACE_LABELS. The server also SENDS the labels, and
   the render prefers the server copy — this is only the fallback for a cached or
   partial response, so the two cannot silently disagree on screen. */
const FALLBACK_LABELS: Record<PcrSurface, string> = {
  mfc: "Managed Founder CRM",
  pipeline: "Deal pipeline",
  clients: "Client (attributed)",
  portfolio: "Portfolio",
};

/** Roles allowed to trigger reconcile — mirrors the server's assertSubRole list. */
const RECONCILE_ROLES = ["managing_partner", "associate", "bd"];

function fmtDate(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

export default function PartnerRelationships() {
  const role = useRequirePartnerRole();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const q = useQuery<RelationshipsResponse>({
    queryKey: ["/api/partner/me/relationships"],
    enabled: role.ready,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/relationships")).json(),
  });

  const reconcile = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/partner/me/relationships/reconcile", {})).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/partner/me/relationships"] });
    },
  });

  const labels = q.data?.surfaceLabels ?? FALLBACK_LABELS;

  const filtered = useMemo(() => {
    const rows = q.data?.relationships ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (r) =>
        (r.companyName ?? "").toLowerCase().includes(needle) ||
        r.companyId.toLowerCase().includes(needle),
    );
  }, [q.data, search]);

  if (!role.ready || !role.identity) return null;
  const data = q.data;
  const hasRows = !!data && data.relationships.length > 0;
  const canReconcile = RECONCILE_ROLES.includes(role.identity.subRole);

  return (
    <PartnerShell
      title="Relationship Map"
      tier={role.identity.tier}
      subRole={role.identity.subRole}
      partnerName={role.identity.identity.name}
    >
      {q.isLoading && (
        <div className="text-[var(--cv-color-text-muted)]" data-testid="relationships-loading">
          Loading…
        </div>
      )}

      {q.isError && (
        <div
          className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"
          data-testid="relationships-error"
        >
          Could not load your relationship map. Please refresh and try again.
        </div>
      )}

      {!q.isLoading && !q.isError && data && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="relationships-breakdown">
          {SURFACE_ORDER.map((s) => (
            <div
              key={s}
              className="rounded-lg border border-[var(--cv-color-border)] bg-white p-3"
              data-testid={`relationships-count-${s}`}
            >
              <div className="text-xs text-[var(--cv-color-text-muted)]">{labels[s]}</div>
              {/* An explicit 0, never a blank — a blank reads as "unknown". */}
              <div className="text-2xl font-semibold">{data.breakdown?.[s] ?? 0}</div>
            </div>
          ))}
        </div>
      )}

      {!q.isLoading && !q.isError && (
        <div
          className="mb-4 rounded-md border border-[var(--cv-color-border)] bg-[var(--cv-color-surface-2)] p-3 text-sm"
          data-testid="relationships-reconcile-panel"
        >
          <div className="text-[var(--cv-color-text-muted)]">
            The relationship map is built from your Managed Founder CRM, pipeline, clients and
            portfolio. If a company is missing, reconcile rebuilds the map from those four surfaces.
          </div>
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              disabled={!canReconcile || reconcile.isPending}
              onClick={() => reconcile.mutate()}
              className="rounded border border-[var(--cv-color-border)] bg-white px-3 py-1.5 text-xs font-medium hover:bg-[var(--cv-color-surface-2)] disabled:opacity-50"
              data-testid="relationships-reconcile-button"
            >
              {reconcile.isPending ? "Reconciling…" : "Reconcile relationship map"}
            </button>
            {!canReconcile && (
              /* A rendered refusal, not a silently dead button. */
              <span className="text-xs text-[var(--cv-color-text-muted)]" data-testid="relationships-reconcile-denied">
                Your role cannot reconcile the map.
              </span>
            )}
            {reconcile.isSuccess && !reconcile.isPending && (
              <span className="text-xs text-emerald-700" data-testid="relationships-reconcile-result">
                Scanned {(reconcile.data as any)?.scanned ?? 0} rows · added{" "}
                {(reconcile.data as any)?.relationshipsCreated ?? 0} relationships.
              </span>
            )}
            {reconcile.isError && (
              <span className="text-xs text-rose-700" data-testid="relationships-reconcile-error">
                Reconcile failed. Please try again.
              </span>
            )}
          </div>
        </div>
      )}

      {!q.isLoading && !q.isError && data && !hasRows && (
        <PartnerEmptyState
          title="No company relationships yet"
          description="Companies you engage through the Managed Founder CRM, your pipeline, client attributions or your portfolio will appear here as a single relationship each."
        />
      )}

      {!q.isError && hasRows && (
        <div className="mb-4 flex flex-wrap gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search company…"
            className="max-w-xs flex-1 rounded-md border border-[var(--cv-color-border)] px-3 py-2 text-sm"
            data-testid="relationships-search"
          />
        </div>
      )}

      {!q.isError && hasRows && (
        <div className="overflow-hidden rounded-lg border border-[var(--cv-color-border)] bg-white">
          <table className="w-full text-sm" data-testid="relationships-table">
            <thead className="bg-[var(--cv-color-surface-2)]">
              <tr>
                <th className="p-3 text-left">Company</th>
                <th className="p-3 text-left">On these surfaces</th>
                <th className="p-3 text-left">Previously</th>
                <th className="p-3 text-left">Last change</th>
                <th className="p-3 text-right">History</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr data-testid="relationships-no-match">
                  <td className="p-3 text-[var(--cv-color-text-muted)]" colSpan={5}>
                    No companies match your search.
                  </td>
                </tr>
              )}
              {filtered.map((r) => (
                <>
                  <tr key={r.id} className="border-t" data-testid={`relationship-row-${r.companyId}`}>
                    <td className="p-3 font-medium">{r.companyName ?? r.companyId}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {r.activeSurfaces.length === 0 && (
                          <span className="text-xs text-[var(--cv-color-text-muted)]">None currently</span>
                        )}
                        {r.activeSurfaces.map((s) => (
                          <span
                            key={s}
                            className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800"
                            data-testid={`relationship-${r.companyId}-active-${s}`}
                          >
                            {labels[s]}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {r.pastSurfaces.length === 0 && (
                          <span className="text-xs text-[var(--cv-color-text-muted)]">—</span>
                        )}
                        {r.pastSurfaces.map((s) => (
                          <span
                            key={s}
                            className="rounded-full bg-[var(--cv-color-surface-2)] px-2 py-0.5 text-xs text-[var(--cv-color-text-muted)]"
                            data-testid={`relationship-${r.companyId}-past-${s}`}
                          >
                            {labels[s]}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="p-3 text-[var(--cv-color-text-muted)]">{fmtDate(r.updatedAt)}</td>
                    <td className="p-3 text-right">
                      <button
                        type="button"
                        onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                        className="rounded border px-2 py-1 text-xs hover:bg-[var(--cv-color-surface-2)]"
                        data-testid={`relationship-toggle-${r.companyId}`}
                      >
                        {expanded === r.id ? "Hide" : `Show (${r.presence.length})`}
                      </button>
                    </td>
                  </tr>
                  {expanded === r.id && (
                    <tr className="border-t bg-[var(--cv-color-surface-2)]" data-testid={`relationship-history-${r.companyId}`}>
                      <td className="p-3" colSpan={5}>
                        {/* pcr_surface_presence is append-only, so this really is
                            the full history — nothing was ever deleted from it. */}
                        <ul className="space-y-1 text-xs">
                          {r.presence.map((p) => (
                            <li key={p.id} data-testid={`relationship-presence-${p.id}`}>
                              <span className="font-medium">{labels[p.surface]}</span>
                              {" · added "}
                              {fmtDate(p.addedAt)}
                              {p.removedAt ? ` · removed ${fmtDate(p.removedAt)}` : " · still active"}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PartnerShell>
  );
}
