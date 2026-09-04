import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { PartnerShell, PartnerEmptyState } from "@/components/partner/PartnerShell";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { apiRequest } from "@/lib/queryClient";
import { attributionSourceLabel, formatDateOnly } from "@/lib/partnerDisplay";
import {
  PARTNER_CLIENT_STAGES,
  PARTNER_CLIENT_STAGE_LABELS,
  PARTNER_CLIENT_DEFAULT_STAGE,
  type PartnerClientStage,
} from "@shared/crmStages";
import AttributionProvenancePanel from "@/components/partner/AttributionProvenancePanel";

interface ClientRow { id: string; companyId: string; companyName?: string | null; attributionSource: string; attributedAt: string }

/* v25.49 Phase-3A — small brand-navy stage badge. Uses the capavate.com scoped
 * tokens (navy text on a faint navy tint) applied by the partner subtree. */
function StageBadge({ stage, unreadReason }: { stage: PartnerClientStage | null; unreadReason: "failed" | "pending" | null }) {
  /* ════════════════════════════════════════════════════════════════════
     WAVE 282 — A STAGE THAT WAS NOT READ IS NOT A STAGE.
     ════════════════════════════════════════════════════════════════════
     Every row on this page printed "Prospect" whenever the stage query failed
     or had not answered yet, because the caller defaulted an absent value.
     The badge now REFUSES to render a label it was not given, and the two
     unread cases carry DIFFERENT sentences: "could not be read" is false while
     a request is still in flight, so the pending case says so instead. Handled
     here, as an early return inside this component, so the table cell keeps
     exactly one child of exactly this element type and no sibling position on
     the page moves. */
  if (stage === null) {
    return (
      <span
        className="inline-block rounded px-2 py-0.5 text-xs font-medium border border-amber-300 bg-amber-50 text-amber-900"
        data-testid={unreadReason === "failed" ? "client-stage-unavailable" : "client-stage-pending"}
      >
        {unreadReason === "failed" ? "stage could not be read" : "stage not read yet"}
      </span>
    );
  }
  return (
    <span
      className="inline-block rounded px-2 py-0.5 text-xs font-medium border border-[rgba(4,30,65,0.2)] bg-[rgba(4,30,65,0.05)] text-[var(--cv-color-navy)]"
      data-testid={`client-stage-badge-${stage}`}
    >
      {PARTNER_CLIENT_STAGE_LABELS[stage]}
    </span>
  );
}

export default function PartnerClients() {
  const role = useRequirePartnerRole();
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<"all" | PartnerClientStage>("all");

  const q = useQuery<{ clients: ClientRow[] }>({
    queryKey: ["/api/partner/me/clients"],
    enabled: role.ready,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/clients")).json(),
  });
  /* v25.49 Phase-3A — per-client CRM stage index (separate partner-clients
   * engine). Best-effort: if it fails, rows fall back to the default stage.
   * WAVE 282 — THE SENTENCE ABOVE DESCRIBES THE DEFECT, NOT THE BEHAVIOUR. It
   * is kept because it records what this page did for four waves. Falling back
   * to the default stage is exactly what printed "Prospect" for every managed
   * client on a failed read. Rows now fall back to NOTHING and say so. */
  const crmQ = useQuery<{ stages: Record<string, PartnerClientStage>; stagesAvailable?: boolean }>({
    queryKey: ["/api/partner/me/client-crm-index"],
    enabled: role.ready,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/client-crm-index")).json(),
  });

  /* WAVE 282 — THREE STATES, NOT TWO. `crmQ.data` is `undefined` both when the
     request FAILED and while it is still PENDING, and the old `?? DEFAULT`
     collapsed both into a confident "Prospect". The server now states
     availability explicitly; the comparison is `=== false` and never a
     falsiness test, so a server that predates this field (deploy skew, the
     key simply absent) renders exactly as it does today rather than showing
     every client as unreadable. */
  const stageReadFailed = crmQ.isError || crmQ.data?.stagesAvailable === false;
  const stagesReady = !stageReadFailed && crmQ.data != null;
  const stageUnreadReason: "failed" | "pending" | null = stageReadFailed ? "failed" : stagesReady ? null : "pending";
  const stages = crmQ.data?.stages ?? {};
  /* Returns `null` — never a default — when the index was not read. The
     default stage constant is still imported and still used by the server as
     the durable default for a company that HAS been read and has no row. */
  const stageOf = (companyId: string): PartnerClientStage | null =>
    stagesReady ? (stages[companyId] ?? PARTNER_CLIENT_DEFAULT_STAGE) : null;

  const filtered = useMemo(() => {
    const rows = q.data?.clients ?? [];
    const needle = search.trim().toLowerCase();
    return rows.filter((c) => {
      const matchesSearch =
        !needle ||
        c.companyId.toLowerCase().includes(needle) ||
        (c.companyName ?? "").toLowerCase().includes(needle) ||
        (c.attributionSource ?? "").toLowerCase().includes(needle);
      /* WAVE 282 — when no stage was read the filter cannot honestly include or
         exclude a row on stage, so it does not try: the control is disabled
         below and `stageFilter` stays "all". */
      const matchesStage = stageFilter === "all" || (stagesReady && stageOf(c.companyId) === stageFilter);
      return matchesSearch && matchesStage;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, search, stageFilter, stages, stagesReady]);

  if (!role.ready || !role.identity) return null;
  const data = q.data;
  const hasClients = !!data && data.clients.length > 0;

  return (
    <PartnerShell title="Clients" tier={role.identity.tier} subRole={role.identity.subRole} partnerName={role.identity.identity.name}>
      {q.isLoading && <div className="text-[var(--cv-color-text-muted)]" data-testid="clients-loading">Loading…</div>}
      {/* v25.14 NM2 — explicit error branch; previously a fetch failure
         rendered a permanently blank page body. */}
      {q.isError && (
        <div
          className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"
          data-testid="clients-error"
        >
          Could not load clients. Please refresh and try again.
        </div>
      )}
      {!q.isLoading && !q.isError && data && data.clients.length === 0 && (
        <PartnerEmptyState
          title="No attributed companies yet"
          description="Ask Capavate admin to attribute companies to your partner record, or sign up companies with your referral code."
        />
      )}

      {/* v25.49 Phase-3A — list search + stage filter. Only shown when there is
         at least one client so the empty state stays clean. */}
      {!q.isError && hasClients && (
        <div className="flex flex-wrap gap-2 mb-4">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search company or source…"
            className="max-w-xs flex-1 rounded-md border border-[var(--cv-color-border)] px-3 py-2 text-sm"
            data-testid="clients-search"
          />
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value as "all" | PartnerClientStage)}
            className="rounded-md border border-[var(--cv-color-border)] px-3 py-2 text-sm"
            data-testid="clients-stage-filter"
            /* WAVE 282 — disabled, never unmounted: removing the control would
               be a silent drop, and offering it while no stage is known would
               let a filter silently empty the table on data nobody has. */
            disabled={!stagesReady}
          >
            <option value="all">All stages</option>
            {PARTNER_CLIENT_STAGES.map((s) => (
              <option key={s} value={s}>{PARTNER_CLIENT_STAGE_LABELS[s]}</option>
            ))}
          </select>
        </div>
      )}

      {!q.isError && hasClients && (
        <div className="bg-white rounded-lg border border-[var(--cv-color-border)] overflow-hidden">
          <table className="w-full text-sm" data-testid="clients-table">
            <thead className="bg-[var(--cv-color-surface-2)]">
              <tr>
                <th className="text-left p-3">Company</th>
                <th className="text-left p-3">Stage</th>
                <th className="text-left p-3">Source</th>
                <th className="text-left p-3">Attributed</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr data-testid="clients-no-match">
                  <td className="p-3 text-[var(--cv-color-text-muted)]" colSpan={5}>No clients match your filters.</td>
                </tr>
              )}
              {filtered.map((c) => (
                <tr key={c.id} className="border-t" data-testid={`client-row-${c.id}`}>
                  {/* w-partner F1(d) — prefer the joined name; the id remains
                      the fallback so a company with no record still renders. */}
                  {/* WAVE 106 - FINDING 4.5: when only the code is known it is
                      now LABELLED as a reference rather than printed bare as if
                      it were the company's name. */}
                  <td className="p-3 font-medium">{c.companyName || `Company reference ${c.companyId}`}</td>
                  <td className="p-3"><StageBadge stage={stageOf(c.companyId)} unreadReason={stageUnreadReason} /></td>
                  {/* WAVE 106 - FINDING 4.5: this printed the storage code for
                      the attribution source (e.g. `partner_claim`). */}
                  <td className="p-3 text-[var(--cv-color-text-muted)]">{attributionSourceLabel(c.attributionSource)}</td>
                  {/* v25.16 NM5 — guard null attributedAt to avoid "Invalid Date". */}
                  <td className="p-3 text-[var(--cv-color-text-muted)]">{formatDateOnly(c.attributedAt)}</td>
                  <td className="p-3 text-right">
                    {/* v25.13 NM6 — wouter Link renders its own <a>; nesting a literal <a> produced invalid HTML (<a><a>). */}
                    <Link
                      href={`/collective/partner/clients/${c.companyId}`}
                      className="text-[var(--cv-color-primary)] hover:underline"
                      data-testid={`client-view-${c.companyId}`}
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* ═══════════════════════════════════════════════════════════════════
          WAVE 282 — PLACED HERE, NOT AT THE END, AND THE REASON IS A TEST.
          ═══════════════════════════════════════════════════════════════════
          Guard rule 5 says append a new panel LAST. This one is not last, and
          that is deliberate: `wave33_pipe06_provenance.test.ts:463` (U6) reads
          this file and asserts that NOTHING follows `<AttributionProvenancePanel />`
          before `</PartnerShell>`. That test was written to stop the provenance
          panel being inserted mid-list, and it is not weakened here to make room
          for this wave. So this block goes immediately ABOVE the provenance
          panel — still after every element it explains, still an append to the
          table region, and it costs the provenance panel one position in the
          sibling order rather than costing that test its meaning. The drop
          detector and the guard were both re-run on this exact placement.

          It explains, once and in one place, what the badges in the Stage
          column are saying when they are not stages. */}
      {stageReadFailed && (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" data-testid="clients-stage-read-failed">
          The client pipeline stages could not be read, so no stage is shown for any company on this page and the stage filter is switched off. This is a stated failure, not a pipeline in which every company is at the first stage. Everything else on this page — the companies, their sources and their attribution dates — was read normally and is unaffected.
        </div>
      )}
      {/* WAVE 33 / CP-PIPE-06 — APPENDED as the LAST sibling inside the shell,
          never inserted mid-list (insertion renumbers a sibling's positional
          path and the guard reads that as a drop). The table above shows
          `attributionSource` as a bare string; it cannot say whether a row is
          missing the person or the date behind it, and there was no way at all
          to ask whether a company is already claimed. */}
      <AttributionProvenancePanel />
    </PartnerShell>
  );
}
