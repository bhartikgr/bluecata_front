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
 *
 * WAVE NB-A — THE FOUR SUMMARY TILES NO LONGER READ THE SPINE.
 * They read the four surfaces themselves, on every load, so they cannot disagree
 * with the pages they summarise and there is nothing about them to "repair". The
 * spine and its presence rows still back the per-company table below the tiles —
 * the dated history is the one thing only they hold — so reconcile keeps a real,
 * narrower purpose: adding history entries that were never recorded, and the
 * panel copy was re-framed to claim only that. Two further rules hold here: a
 * surface the server could not read arrives as `null` and must render as a stated
 * read-failure rather than a `0` nobody computed, and the tiles must say on
 * screen that they count COMPANIES, not deals or records — both are asserted by
 * `__tests__/nb_a_relationship_tiles_dom.test.tsx`.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PartnerShell, PartnerEmptyState } from "@/components/partner/PartnerShell";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { apiRequest } from "@/lib/queryClient";
import { fmtLocaleDate } from "@/lib/format"; /* WAVE 87 · ITEM 1 */

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
  /* WAVE NB-A — a surface the server could not read arrives as `null`, and null
     is NOT zero. `0` means "counted, and there are none"; `null` means "not
     counted". The tile must render those two differently or it is asserting a
     figure nobody measured. */
  breakdown: Record<PcrSurface, number | null>;
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

/* WAVE NB-A — a truthful zero and an uncomputed one must not look the same.
   The server sends a number when it counted the surface and `null` when it could
   not read it. Never print "0" for the second case. */
function countText(v: number | null | undefined): string {
  return typeof v === "number" ? String(v) : "Not counted";
}

function isUncounted(v: number | null | undefined): boolean {
  return typeof v !== "number";
}

/* WAVE 87 · ITEM 1 — THIS LOCAL HELPER SHADOWED THE SAFE ONE.
   Twelve files define their own `fmtDate`/`formatIsoDate` whose body is the
   exact defect reviewer 1 reported: `new Date("2026-06-15")` parses as UTC
   midnight, so any local-time reader prints ONE DAY EARLY west of UTC (the
   owner is in New York). Only the BODY changes — every call site is untouched,
   so a timestamp renders byte-identically and nothing is restyled, while a
   date-only value now renders the day that was entered. */
function fmtDate(v: string | null): string {
  if (!v) return "—";
  return fmtLocaleDate(v);
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
              <div className="text-2xl font-semibold">{countText(data.breakdown?.[s])}</div>
              {isUncounted(data.breakdown?.[s]) && (
                <div
                  className="mt-1 text-xs text-[var(--cv-color-text-muted)]"
                  data-testid={`relationships-count-${s}-unreadable`}
                >
                  This surface could not be read just now, so no figure is shown. Nothing has been
                  lost; try again shortly.
                </div>
              )}
            </div>
          ))}
          <div
            key="nb-a-basis"
            className="col-span-2 text-xs text-[var(--cv-color-text-muted)] sm:col-span-4"
            data-testid="relationships-breakdown-basis"
          >
            Each figure counts companies, not deals or records, and is read from your Managed
            Founder CRM, pipeline, clients and portfolio every time this page loads — so it always
            matches those screens. A company you have several deals with counts once, and a deal
            with no Capavate company behind it is not a company relationship and is not counted.
          </div>
        </div>
      )}

      {!q.isLoading && !q.isError && (
        <div
          className="mb-4 rounded-md border border-[var(--cv-color-border)] bg-[var(--cv-color-surface-2)] p-3 text-sm"
          data-testid="relationships-reconcile-panel"
        >
          {/* WAVE NB-A — this panel used to offer itself as the repair for the
              figures. It never was one, and the figures no longer need repairing:
              they are counted from the four surfaces on every load. What reconcile
              genuinely does is add company entries and their dated history that
              were never recorded, and the copy now says only that. It is stated as
              a rule ("it only ever adds") rather than as a reassurance, because it
              is a property of the code and not a promise. */}
          <div className="text-[var(--cv-color-text-muted)]">
            The figures above are counted from your Managed Founder CRM, pipeline, clients and
            portfolio each time this page loads. The table below adds one more thing: the dated
            record of when each company joined or left each of them. If a company you work with is
            missing from that table, reconcile adds the entries that were never recorded. Reconcile
            only ever adds — it cannot remove or change a company, deal, client or portfolio
            record, and it cannot make any figure smaller.
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
