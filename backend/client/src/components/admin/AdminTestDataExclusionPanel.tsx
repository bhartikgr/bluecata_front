/**
 * WAVE 230D — THE ADMIN CLIENT CONTROL FOR TEST-DATA EXCLUSION.
 *
 * Wave 230 built the engine, wave 230B built the routes, and neither shipped a
 * screen. R230.3 records that no test/demo/archive control exists anywhere in
 * the admin, so until this panel existed the owner could only change a mark by
 * running a script. This is that control, and it is the whole of it: set, unset,
 * and view what is currently excluded.
 *
 * WHAT IS DELIBERATE HERE:
 *
 * 1. PER-RECORD, NEVER PER-TENANT (R230.6). Every button in this file addresses
 *    ONE row by its own table + id. There is no "mark this tenant" control and
 *    no company-wide sweep, because a round named "QA Note Round" sits inside
 *    BluePrint Catalyst Limited, the owner's real operating company.
 *
 * 2. PROBABLE IS RENDERED SEPARATELY AND FIRST (R230.2). The server returns two
 *    arrays; this panel keeps them two. Kestrel Holdings Ltd and Live Audit
 *    Client Ltd reach the owner as a QUESTION, in their own amber block, never
 *    mixed into the unambiguous list.
 *
 * 3. NOTHING AUTO-MARKS. Every mark is one click on one record. The proposals
 *    list proposes; it does not apply.
 *
 * 4. null IS A DASH, NEVER A ZERO (R224.1). `total`, `excluded` and `kept` are
 *    `number | null` from the server and a null is NOT DETERMINED. A zero here
 *    would read as "nothing is excluded", which is an absence rendering as
 *    reassurance.
 *
 * 5. MONEY IS NEVER CONVERTED AND NEVER PARSED. The before/after figures arrive
 *    as EXACT DECIMAL STRINGS of minor units and are rendered as those strings
 *    beside their own currency code. There is no Number(), parseInt, parseFloat
 *    or arithmetic of any kind in this file, no exponent is assumed, and no
 *    currency is summed with another. `undetermined` renders a dash.
 *
 * 6. NOTHING IS HIDDEN IRREVERSIBLY. The excluded list is the un-hide surface:
 *    every excluded record is one click from being restored, with when, why and
 *    by whom shown beside it.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";

const WAVE230_BASE = "/api/admin/test-data";

type W230Table =
  | "companies"
  | "rounds"
  | "spvs"
  | "subscriptions"
  | "consortium_applications"
  | "collective_apps";

interface W230Counts {
  table: W230Table;
  total: number | null;
  excluded: number | null;
  kept: number | null;
  installed: boolean;
}

interface W230Signal {
  rule: string;
  field: string;
  value: string;
  note: string;
}

interface W230Verdict {
  table: W230Table;
  id: string;
  label: string | null;
  confidence: "CERTAIN" | "PROBABLE" | "AMBIGUOUS";
  proposeExclude: boolean;
  needsOwnerConfirmation: boolean;
  evidence: W230Signal[];
  counterEvidence: W230Signal[];
}

interface W230Excluded {
  table: W230Table;
  id: string;
  label: string | null;
  excludedAt: string;
  reason: string | null;
  excludedBy: string | null;
}

interface W230CurrencyImpact {
  currency: string;
  beforeMinor: string;
  afterMinor: string;
  excludedMinor: string;
  excludedCount: number;
  keptCount: number;
}

/** A count that was not determined renders as a dash. Never as 0. */
function countText(n: number | null): string {
  return typeof n === "number" ? String(n) : "—";
}

export function AdminTestDataExclusionPanel() {
  const [tableFilter, setTableFilter] = useState<string>("");
  const [busyKey, setBusyKey] = useState<string>("");
  const [lastResult, setLastResult] = useState<string>("");

  const countsQ = useQuery<{ ok: boolean; counts: W230Counts[] }>({
    queryKey: [`${WAVE230_BASE}/counts`],
    queryFn: async () => (await apiRequest("GET", `${WAVE230_BASE}/counts`)).json(),
  });
  const excludedQ = useQuery<{ ok: boolean; records: W230Excluded[] }>({
    queryKey: [`${WAVE230_BASE}/excluded`, tableFilter],
    queryFn: async () =>
      (
        await apiRequest(
          "GET",
          tableFilter ? `${WAVE230_BASE}/excluded?table=${tableFilter}` : `${WAVE230_BASE}/excluded`,
        )
      ).json(),
  });
  const proposalsQ = useQuery<{
    ok: boolean;
    certain: W230Verdict[];
    needsOwnerConfirmation: W230Verdict[];
    keptCount: number;
    totalClassified: number;
  }>({
    queryKey: [`${WAVE230_BASE}/proposals`, tableFilter],
    queryFn: async () =>
      (
        await apiRequest(
          "GET",
          tableFilter ? `${WAVE230_BASE}/proposals?table=${tableFilter}` : `${WAVE230_BASE}/proposals`,
        )
      ).json(),
  });
  const revenueQ = useQuery<{
    ok: boolean;
    installed: boolean;
    undetermined: boolean;
    unreadable: number;
    byCurrency: W230CurrencyImpact[];
  }>({
    queryKey: [`${WAVE230_BASE}/revenue-impact`],
    queryFn: async () => (await apiRequest("GET", `${WAVE230_BASE}/revenue-impact`)).json(),
  });

  /* One record, one explicit decision. `excluded` is passed through as a strict
     boolean; the server refuses anything else rather than coercing it. */
  async function setMark(table: W230Table, id: string, excluded: boolean, reason: string | null) {
    const key = `${table}:${id}`;
    setBusyKey(key);
    try {
      const res = await apiRequest("POST", `${WAVE230_BASE}/mark`, { table, id, excluded, reason });
      const body = (await res.json()) as { ok?: boolean; excluded?: boolean; error?: string };
      /* Report what the DATABASE now says, read back by the server through the
         same reader the display surfaces use — never what was requested. */
      setLastResult(
        body.ok
          ? `${table} ${id} — the database now reports excluded = ${String(body.excluded)}`
          : `${table} ${id} — refused: ${String(body.error)}`,
      );
    } catch (err) {
      setLastResult(`${table} ${id} — request failed: ${String((err as Error).message)}`);
    }
    setBusyKey("");
    await countsQ.refetch();
    await excludedQ.refetch();
    await proposalsQ.refetch();
    await revenueQ.refetch();
  }

  const proposals = proposalsQ.data;
  const revenue = revenueQ.data;

  return (
    <Card className="p-4 mt-4" data-testid="card-w230-test-data-exclusion">
      <div className="text-sm font-semibold flex items-center gap-2" data-testid="w230-panel-title">
        Test-data exclusion
        <Badge variant="outline" data-testid="w230-panel-badge">Reversible · per record · nothing is deleted</Badge>
      </div>
      <div className="text-xs text-muted-foreground mt-1" data-testid="w230-panel-explainer">
        Marking a record excludes it from company lists, dashboards, counts, the partner portfolio and the reported
        revenue figure. The record itself is untouched and stays in the database. Unmarking restores it everywhere in
        one click. Nothing on this screen deletes anything.
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="w230-table-filter">
        <span className="text-xs text-muted-foreground">Show</span>
        <select
          className="text-xs border border-border rounded px-2 py-1 bg-background"
          value={tableFilter}
          onChange={(e) => setTableFilter(e.target.value)}
          data-testid="select-w230-table"
        >
          <option value="">All record types</option>
          <option value="companies">Companies</option>
          <option value="rounds">Rounds</option>
          <option value="spvs">SPVs</option>
          <option value="subscriptions">Subscriptions</option>
          <option value="consortium_applications">Consortium applications</option>
          <option value="collective_apps">Collective applications</option>
        </select>
      </div>

      {/* Counts. A null is NOT DETERMINED and renders as a dash. */}
      <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2" data-testid="w230-counts">
        {(countsQ.data?.counts ?? []).map((c) => (
          <div key={c.table} className="border border-border rounded p-2" data-testid={`w230-count-${c.table}`}>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{c.table}</div>
            <div className="text-xs mt-0.5">
              Excluded {countText(c.excluded)} of {countText(c.total)} · kept {countText(c.kept)}
            </div>
            {!c.installed && (
              <div className="text-[10px] text-slate-600" data-testid={`w230-count-notinstalled-${c.table}`}>
                Not determined on this database — the exclusion columns are not installed here, so nothing is excluded.
              </div>
            )}
          </div>
        ))}
      </div>

      {/* PROBABLE, first and separate. These are a question for the owner. */}
      <div className="mt-4 border border-amber-300 bg-amber-50 rounded p-3" data-testid="w230-needs-confirmation">
        <div className="text-xs font-semibold text-amber-900" data-testid="w230-needs-confirmation-title">
          Needs your confirmation before anything is excluded
        </div>
        <div className="text-[11px] text-amber-900 mt-0.5" data-testid="w230-needs-confirmation-note">
          These records look like test data but nothing in them says so. They could be real clients. They are NOT
          excluded and nothing here has been applied — each one is your decision.
        </div>
        <ul className="mt-2 space-y-1" data-testid="w230-needs-confirmation-list">
          {(proposals?.needsOwnerConfirmation ?? []).map((v) => (
            <li
              key={`${v.table}:${v.id}`}
              className="text-xs flex flex-wrap items-center gap-2"
              data-testid={`w230-probable-${v.table}-${v.id}`}
            >
              <span className="font-medium">{v.label ?? v.id}</span>
              <span className="text-muted-foreground font-mono text-[10px]">{v.table} · {v.id}</span>
              <Badge variant="outline" data-testid={`w230-probable-confidence-${v.id}`}>{v.confidence}</Badge>
              <span className="text-[10px] text-amber-900">
                {(v.evidence ?? []).map((s) => s.note).join(" · ")}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={busyKey === `${v.table}:${v.id}`}
                onClick={() => setMark(v.table, v.id, true, "owner confirmed probable test record")}
                data-testid={`button-w230-exclude-probable-${v.id}`}
              >
                Exclude this record
              </Button>
            </li>
          ))}
        </ul>
      </div>

      {/* CERTAIN — still one explicit click each. */}
      <div className="mt-4" data-testid="w230-certain">
        <div className="text-xs font-semibold" data-testid="w230-certain-title">
          Proposed as test data — unambiguous by name
        </div>
        <ul className="mt-1 space-y-1" data-testid="w230-certain-list">
          {(proposals?.certain ?? []).map((v) => (
            <li
              key={`${v.table}:${v.id}`}
              className="text-xs flex flex-wrap items-center gap-2"
              data-testid={`w230-certain-${v.table}-${v.id}`}
            >
              <span className="font-medium">{v.label ?? v.id}</span>
              <span className="text-muted-foreground font-mono text-[10px]">{v.table} · {v.id}</span>
              <Button
                size="sm"
                variant="outline"
                disabled={busyKey === `${v.table}:${v.id}`}
                onClick={() => setMark(v.table, v.id, true, "matched an unambiguous test-data rule")}
                data-testid={`button-w230-exclude-${v.id}`}
              >
                Exclude this record
              </Button>
            </li>
          ))}
        </ul>
        <div className="text-[10px] text-muted-foreground mt-1" data-testid="w230-certain-kept">
          Kept as real: {countText(proposals?.keptCount ?? null)} of {countText(proposals?.totalClassified ?? null)}{" "}
          classified. Anything the rules could not decide is KEPT.
        </div>
      </div>

      {/* The excluded-records view, which is also the un-hide control. */}
      <div className="mt-4" data-testid="w230-excluded">
        <div className="text-xs font-semibold" data-testid="w230-excluded-title">
          Currently excluded records
        </div>
        <ul className="mt-1 space-y-1" data-testid="w230-excluded-list">
          {(excludedQ.data?.records ?? []).map((r) => (
            <li
              key={`${r.table}:${r.id}`}
              className="text-xs flex flex-wrap items-center gap-2"
              data-testid={`w230-excluded-${r.table}-${r.id}`}
            >
              <span className="font-medium">{r.label ?? r.id}</span>
              <span className="text-muted-foreground font-mono text-[10px]">{r.table} · {r.id}</span>
              <span className="text-[10px] text-muted-foreground">
                Excluded {r.excludedAt} by {r.excludedBy ?? "—"} · {r.reason ?? "—"}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={busyKey === `${r.table}:${r.id}`}
                onClick={() => setMark(r.table, r.id, false, null)}
                data-testid={`button-w230-restore-${r.id}`}
              >
                Put this record back
              </Button>
            </li>
          ))}
        </ul>
        {(excludedQ.data?.records ?? []).length === 0 && (
          <div className="text-[10px] text-muted-foreground" data-testid="w230-excluded-empty">
            No records are excluded, so every figure on this platform is exactly what it was before this control existed.
          </div>
        )}
      </div>

      {/* Money: reported before and after, never adjusted silently (R228.2). */}
      <div className="mt-4 border border-border rounded p-3" data-testid="w230-revenue-impact">
        <div className="text-xs font-semibold" data-testid="w230-revenue-title">
          Reported revenue — before and after exclusion
        </div>
        {revenue?.undetermined && (
          <div className="text-xs text-slate-600 mt-1" data-testid="w230-revenue-undetermined">
            Not determined — the figures could not be read, so nothing is shown here and no figure has been adjusted.
          </div>
        )}
        {revenue && !revenue.undetermined && (
          <ul className="mt-1 space-y-1" data-testid="w230-revenue-list">
            {(revenue.byCurrency ?? []).map((c) => (
              <li key={c.currency} className="text-xs font-mono" data-testid={`w230-revenue-${c.currency}`}>
                {c.currency} — before {c.beforeMinor} minor units, after {c.afterMinor} minor units, removed{" "}
                {c.excludedMinor} minor units across {c.excludedCount} subscription(s); {c.keptCount} kept
              </li>
            ))}
          </ul>
        )}
        {revenue && revenue.unreadable > 0 && (
          <div className="text-[11px] text-amber-900 mt-1" data-testid="w230-revenue-unreadable">
            {revenue.unreadable} amount(s) could not be read, so the totals above are incomplete.
          </div>
        )}
        <div className="text-[10px] text-muted-foreground mt-1" data-testid="w230-revenue-basis">
          Figures are exact minor units of each currency, never converted between currencies and never added together.
        </div>
      </div>

      {lastResult !== "" && (
        <div className="text-[11px] mt-3 font-mono" data-testid="w230-last-result">
          {lastResult}
        </div>
      )}
    </Card>
  );
}

export default AdminTestDataExclusionPanel;
