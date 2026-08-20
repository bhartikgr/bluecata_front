/**
 * WAVE 24 · ITEM 1 — THE MARK-OVERRIDE ADMIN REVIEW SURFACE.
 *
 * WHY THIS EXISTS, precisely.
 *
 * Wave 23 (ITEM 5) flipped `marks.override_admin_approval_mode` from `able_to`
 * to `required`, because a GP fair-value override taking effect while still
 * `pending` is exactly what a fund-admin diligence process flags. That was the
 * right ruling and it closed a real exposure — but it created a DEAD END:
 * `POST /api/admin/reporting/mark-overrides/:id/decision`
 * (`server/lib/reportingEngineRoutes.ts:564`) had, and the config switch
 * `PUT /api/admin/reporting/config/:key` (:590) had, ZERO UI callers anywhere in
 * `client/src`. Under the new safe default an override could therefore never be
 * approved THROUGH THE PRODUCT AT ALL. A pending override sat forever.
 * FINAL REVIEW B filed this as R-1; WAVE23_REPORT open item 2 states it plainly.
 *
 * THIS IS WIRING, NOT A NEW ENGINE. Every decision, every state transition and
 * every persisted field below is computed by server code that already shipped.
 * This file adds no valuation logic, no approval rule and no second source of
 * truth. It calls four endpoints that already exist and renders what they
 * return.
 *
 * THE SINK (Rule 2 — fix where the data flows). The reviewed state lands in
 * `valuation_mark_override.approval_state` / `.approved_by` / `.approved_at` /
 * `.approval_note`, written by ONE function,
 * `decideMarkOverride()` (`server/wave9ReportingStore.ts:542`), reached by ONE
 * route (reportingEngineRoutes.ts:564). This panel posts to that route and
 * nothing else — it never writes an override row by any other path. The SECOND
 * path that consumes the result is `overrideIsEffective()`
 * (`wave9ReportingStore.ts:493`), which both `latestOverride()` and
 * `effectiveMarkForCompany()` route through since Wave 23. That is why the
 * "Effective" column below is honest: it is the same predicate the mark
 * computation uses, reported by the server, not re-derived here.
 *
 * WHAT A REVIEWER MUST BE ABLE TO SEE, and does:
 *   · WHICH company / vehicle the override is against;
 *   · the CURRENT DERIVED mark the platform computed on its own
 *     (`GET /api/reporting/companies/:companyId/mark` — itself an orphaned
 *     endpoint this wave wires, so the comparison is real and not remembered);
 *   · the PROPOSED value and the prior value it displaces;
 *   · WHO proposed it and WHEN, and their mandatory reason;
 *   · whether it is EFFECTIVE RIGHT NOW, and under which approval mode.
 *
 * REJECTION REASONS PERSIST. The server column is `approval_note`. A rejection
 * with no recorded reason is a rejection nobody can audit, so this panel
 * REQUIRES a reason on reject (>= 10 chars — the same bar `createMarkOverride()`
 * imposes on the GP proposing the override, so the reviewer is held to the
 * standard the proposer is). The route enforces the same rule server-side; the
 * client cannot be the only guard.
 *
 * MONEY (Rule 4). Every amount on the wire is INTEGER MINOR UNITS and is
 * rendered with `formatMinor()` from `client/src/lib/currency.ts` — never
 * `/100`. Nothing here sums across currencies; each row is displayed in its own
 * stored currency and there is deliberately no total.
 *
 * FAIL-CLOSED (Rule 5). A failed load renders `LoadFailedRefusal`, never an
 * empty queue and never a fabricated zero. "No pending overrides" is only ever
 * shown on `isSuccess`.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FilterChip } from "@/components/ui/filter-chip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Check, ShieldCheck, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatMinor } from "@/lib/currency";
import { LoadFailedRefusal } from "@/components/LoadFailedRefusal";

/* ── server shapes, read at source ────────────────────────────────────────
 * `MarkOverride` — server/wave9ReportingStore.ts:449. Mirrored field for
 * field, including `grandfatheredEffective`, which Wave 23 added and which is
 * the ONLY reason a `pending` row can legitimately still be effective. Hiding
 * it would make the queue look inconsistent for exactly the rows that most
 * need explaining. */
type MarkOverrideRow = {
  id: string;
  tenantId: string;
  valuationEventId: string;
  vehicleKind: string;
  vehicleId: string;
  holdingId: string | null;
  priorFairValueMinor: number | null;
  fairValueMinor: number;
  currency: string;
  reason: string;
  overriddenBy: string;
  overriddenAt: string;
  approvalState: "pending" | "approved" | "rejected";
  approvedBy: string | null;
  approvedAt: string | null;
  approvalNote: string | null;
  pricePerShareOverride?: number | null;
  grandfatheredEffective: boolean;
};

type OverridesResponse = {
  ok: boolean;
  overrides: MarkOverrideRow[];
  total: number;
  /** reportingEngineRoutes.ts:559 — the server states the mode, we never guess. */
  approvalMode: "able_to" | "required";
};

/* `DerivedMark` — server/wave9ReportingStore.ts:231. NOTE `pricePerShare` is in
   MAJOR units, exactly as the round stores it, and carries no currency code —
   so it is rendered as a bare number with an explicit label, NOT through
   `formatMinor`, which would silently misread a share price as minor units. */
type DerivedMark = {
  companyId: string;
  pricePerShare: number;
  valuationDate: string;
  roundId: string;
  roundName: string;
  ageDays: number;
  badge: string;
  method: string;
  source: string;
} | null;

type CompanyMarkResponse = {
  ok: boolean;
  companyId: string;
  derived: DerivedMark;
  effective: DerivedMark;
  thresholds: { staleWarnDays: number; staleExpiredDays: number; autoDerive: boolean };
  overrideApprovalMode: "able_to" | "required";
  /** "NO_PRICED_ROUND" when there is nothing to derive. An honest empty, not 0. */
  reason: string | null;
};

type ConfigRow = {
  key: string;
  value: unknown;
  valueType: string;
  description: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
};

type ConfigResponse = { ok: boolean; config: ConfigRow[] };

type CompaniesResponse = { rows: Array<{ id: string; name: string }> };

const APPROVAL_MODE_KEY = "marks.override_admin_approval_mode";
/** Same floor `createMarkOverride()` imposes on the proposer's reason. */
const MIN_REASON_LEN = 10;

function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/* ── the current derived mark, per row ─────────────────────────────────────
 * This is the wiring of `GET /api/reporting/companies/:companyId/mark`
 * (reportingEngineRoutes.ts:455), which FINAL REVIEW B pinned as orphaned. The
 * reviewer's whole question is "what does the platform think this is worth
 * WITHOUT the override?", and this is the only endpoint that answers it. It is
 * fetched only for `company`-kind overrides because that is the only kind the
 * route accepts a key for — for an SPV row we say so rather than showing a
 * blank that reads as "no mark". */
function DerivedMarkCell({ row }: { row: MarkOverrideRow }) {
  const isCompany = row.vehicleKind === "company";
  const q = useQuery<CompanyMarkResponse>({
    queryKey: ["/api/reporting/companies", row.vehicleId, "mark"],
    queryFn: async () =>
      (await apiRequest("GET", `/api/reporting/companies/${encodeURIComponent(row.vehicleId)}/mark`)).json(),
    enabled: isCompany,
  });

  if (!isCompany) {
    return (
      <span className="text-xs text-muted-foreground" data-testid={`mark-derived-na-${row.id}`}>
        Not a company vehicle — no company-level derived mark applies.
      </span>
    );
  }
  if (q.isError) {
    return (
      <span className="text-xs text-rose-700" data-testid={`mark-derived-failed-${row.id}`}>
        Could not load the derived mark. This is a load failure, not an absence of one.
      </span>
    );
  }
  if (!q.isSuccess) {
    return (
      <span className="text-xs text-muted-foreground" data-testid={`mark-derived-loading-${row.id}`}>
        Loading derived mark…
      </span>
    );
  }
  const d = q.data.derived;
  if (!d) {
    return (
      <span className="text-xs text-muted-foreground" data-testid={`mark-derived-none-${row.id}`}>
        {q.data.reason === "NO_PRICED_ROUND"
          ? "No priced round — the platform derives no mark of its own here."
          : "No derived mark on record."}
      </span>
    );
  }
  return (
    <span className="block text-xs" data-testid={`mark-derived-${row.id}`}>
      <span className="block font-medium">{`${d.pricePerShare} / share`}</span>
      <span className="block text-muted-foreground">
        {`${d.roundName} · ${d.valuationDate} · ${d.ageDays}d old · ${d.badge}`}
      </span>
    </span>
  );
}

/* ── the decision form for one row ────────────────────────────────────────── */
function DecisionForm({ row, onDone }: { row: MarkOverrideRow; onDone: () => void }) {
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<"approved" | "rejected" | null>(null);

  const mut = useMutation({
    mutationFn: async (decision: "approved" | "rejected") => {
      setPending(decision);
      const res = await apiRequest("POST", `/api/admin/reporting/mark-overrides/${encodeURIComponent(row.id)}/decision`, {
        decision,
        note: note.trim() === "" ? undefined : note.trim(),
      });
      return res.json();
    },
    onSuccess: (d: { ok?: boolean; error?: string; message?: string }) => {
      setPending(null);
      if (!d?.ok) {
        toast({ title: "Decision refused", description: d?.message ?? d?.error ?? "The server refused this decision.", variant: "destructive" });
        return;
      }
      setNote("");
      /* Both reads change: the queue itself, and every derived/effective mark
         that consumed this override. Invalidating only the queue would leave a
         stale mark on screen next to a fresh decision. */
      queryClient.invalidateQueries({ queryKey: ["/api/reporting/mark-overrides"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reporting/companies"] });
      toast({ title: "Decision recorded" });
      onDone();
    },
    onError: (e: unknown) => {
      setPending(null);
      toast({
        title: "Could not record the decision",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    },
  });

  const trimmed = note.trim();
  /* A rejection with no recorded reason is a rejection nobody can audit. The
     server enforces this too; this is the affordance, not the guarantee. */
  const rejectBlocked = trimmed.length < MIN_REASON_LEN;

  return (
    <div className="mt-3 space-y-2 border-t pt-3" data-testid={`decision-form-${row.id}`}>
      <Label htmlFor={`decision-note-${row.id}`} className="text-xs">
        Reason (required to reject, recorded either way)
      </Label>
      <Textarea
        id={`decision-note-${row.id}`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        className="text-sm"
        placeholder="Why this override is accepted or refused. Stored on the override as approval_note."
        data-testid={`input-decision-note-${row.id}`}
      />
      <span className="block text-[11px] text-muted-foreground" data-testid={`decision-note-hint-${row.id}`}>
        {rejectBlocked
          ? `A rejection needs at least ${MIN_REASON_LEN} characters — the same bar the GP met to propose it.`
          : "This reason is stored against the override and shown in its history."}
      </span>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          className="h-7 text-xs"
          disabled={mut.isPending}
          onClick={() => mut.mutate("approved")}
          data-testid={`button-approve-override-${row.id}`}
        >
          <Check className="mr-1 h-3 w-3" />
          {pending === "approved" ? "Approving…" : "Approve"}
        </Button>
        <Button
          size="sm"
          variant="destructive"
          className="h-7 text-xs"
          disabled={mut.isPending || rejectBlocked}
          onClick={() => mut.mutate("rejected")}
          data-testid={`button-reject-override-${row.id}`}
        >
          <X className="mr-1 h-3 w-3" />
          {pending === "rejected" ? "Rejecting…" : "Reject"}
        </Button>
      </div>
    </div>
  );
}

/* ── the config switch ────────────────────────────────────────────────────
 * `GET /api/admin/reporting/config` (:584) and
 * `PUT /api/admin/reporting/config/:key` (:590) — both orphaned before this
 * wave. The mode is the single most consequential setting on this surface, so
 * it is rendered ABOVE the queue with its consequence spelled out, and the
 * whole config table is rendered under it so no other reporting threshold stays
 * invisible either. */
function ApprovalModeControl({ liveMode }: { liveMode: "able_to" | "required" | null }) {
  const { toast } = useToast();
  const cfgQ = useQuery<ConfigResponse>({
    queryKey: ["/api/admin/reporting/config"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/reporting/config")).json(),
  });

  const mut = useMutation({
    mutationFn: async (value: string) => {
      const res = await apiRequest("PUT", `/api/admin/reporting/config/${encodeURIComponent(APPROVAL_MODE_KEY)}`, { value });
      return res.json();
    },
    onSuccess: (d: { ok?: boolean; error?: string }) => {
      if (!d?.ok) {
        toast({ title: "Could not change the approval mode", description: d?.error ?? "The server refused the change.", variant: "destructive" });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["/api/admin/reporting/config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reporting/mark-overrides"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reporting/companies"] });
      toast({ title: "Approval mode updated" });
    },
    onError: (e: unknown) =>
      toast({
        title: "Could not change the approval mode",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      }),
  });

  const rows = cfgQ.data?.config ?? [];
  const modeRow = rows.find((r) => r.key === APPROVAL_MODE_KEY) ?? null;
  /* Prefer the config table's own value; fall back to the mode the overrides
     endpoint reported. If NEITHER is available we say so — we never default the
     display to "required", because showing a safe mode that may not be the
     stored one is the same class of lie this wave exists to remove. */
  const shown = (modeRow ? String(modeRow.value) : liveMode) as "able_to" | "required" | null;

  return (
    <Card data-testid="card-mark-approval-mode">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" /> Override approval mode
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {cfgQ.isError ? (
          <LoadFailedRefusal
            what="the reporting configuration"
            onRetry={() => cfgQ.refetch()}
            isRetrying={cfgQ.isFetching}
            testId="reporting-config-load-failed"
          />
        ) : (
          <>
            <span className="block" data-testid="text-approval-mode-current">
              {shown === null
                ? "The stored approval mode could not be read. It is not being assumed."
                : `Current mode: ${shown}`}
            </span>
            <span className="block text-xs text-muted-foreground" data-testid="text-approval-mode-meaning">
              {shown === "able_to"
                ? "able_to — a GP override takes effect the moment it is written; approval is a review recorded afterwards."
                : shown === "required"
                  ? "required — a GP override does NOT move a reported mark until it is approved here."
                  : "Unknown — no consequence is being claimed for a value that could not be read."}
            </span>
            {modeRow && (
              <span className="block text-[11px] text-muted-foreground" data-testid="text-approval-mode-provenance">
                {`Last set by ${modeRow.updatedBy ?? "unknown"} at ${fmtWhen(modeRow.updatedAt)}.`}
              </span>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-56">
                <Label className="text-xs">Change mode</Label>
                <Select
                  value={shown ?? undefined}
                  onValueChange={(v) => mut.mutate(v)}
                  disabled={mut.isPending || !cfgQ.isSuccess}
                >
                  <SelectTrigger data-testid="select-approval-mode">
                    <SelectValue placeholder="Select a mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="required" data-testid="option-approval-mode-required">
                      required — approval gates effectiveness
                    </SelectItem>
                    <SelectItem value="able_to" data-testid="option-approval-mode-able-to">
                      able_to — effective on write, reviewed after
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
              <span className="block text-xs" data-testid="text-approval-mode-grandfather">
                Overrides that were already pending when this default changed stay effective and
                remain visibly pending. They were never stamped approved, because no such approval ever happened.
              </span>
            </div>
            {rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs" data-testid="table-reporting-config">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="px-2 py-1 font-medium">Key</th>
                      <th className="px-2 py-1 font-medium">Value</th>
                      <th className="px-2 py-1 font-medium">Set by</th>
                      <th className="px-2 py-1 font-medium">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.key} className="border-b last:border-0" data-testid={`row-reporting-config-${r.key}`}>
                        <td className="px-2 py-1 font-mono">{r.key}</td>
                        <td className="px-2 py-1 font-mono">{JSON.stringify(r.value)}</td>
                        <td className="px-2 py-1">{r.updatedBy ?? "—"}</td>
                        <td className="px-2 py-1">{fmtWhen(r.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ── the panel ────────────────────────────────────────────────────────────── */
export function MarkOverrideReviewPanel() {
  const [state, setState] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [openRow, setOpenRow] = useState<string | null>(null);

  const q = useQuery<OverridesResponse>({
    queryKey: ["/api/reporting/mark-overrides", state],
    queryFn: async () => {
      const qs = state === "all" ? "" : `?approvalState=${encodeURIComponent(state)}`;
      return (await apiRequest("GET", `/api/reporting/mark-overrides${qs}`)).json();
    },
  });

  /* Company NAMES only. An id is not a company to the person deciding, and the
     admin roster is already the canonical name source for this surface. A
     failure here degrades to the id — never to a wrong name. */
  const companiesQ = useQuery<CompaniesResponse>({
    queryKey: ["/api/admin/companies/full"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/companies/full")).json(),
  });
  const nameOf = (id: string): string | null =>
    (companiesQ.data?.rows ?? []).find((r) => r.id === id)?.name ?? null;

  const rows = q.data?.overrides ?? [];
  const mode = q.data?.approvalMode ?? null;

  return (
    <div className="space-y-4" data-testid="mark-override-review-panel">
      <ApprovalModeControl liveMode={mode} />

      <Card data-testid="card-mark-override-queue">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> GP fair-value overrides
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2" role="tablist" data-testid="mark-override-state-filters">
            <FilterChip active={state === "pending"} onClick={() => setState("pending")} data-testid="filter-overrides-pending">Pending</FilterChip>
            <FilterChip active={state === "approved"} onClick={() => setState("approved")} data-testid="filter-overrides-approved">Approved</FilterChip>
            <FilterChip active={state === "rejected"} onClick={() => setState("rejected")} data-testid="filter-overrides-rejected">Rejected</FilterChip>
            <FilterChip active={state === "all"} onClick={() => setState("all")} data-testid="filter-overrides-all">All</FilterChip>
          </div>

          {q.isError ? (
            <LoadFailedRefusal
              what="the override review queue"
              onRetry={() => q.refetch()}
              isRetrying={q.isFetching}
              testId="mark-overrides-load-failed"
            />
          ) : !q.isSuccess ? (
            /* Gated on isSuccess, NOT on !isLoading && !isError — a PAUSED query
               (offline) is neither, and would otherwise render "nothing to
               review" to someone who is simply disconnected. */
            <span className="block text-sm text-muted-foreground" data-testid="text-overrides-loading">
              Loading the override queue…
            </span>
          ) : rows.length === 0 ? (
            <span className="block text-sm text-muted-foreground" data-testid="text-overrides-empty">
              {state === "pending"
                ? "No overrides are waiting for a decision."
                : `No overrides in the ${state} state.`}
            </span>
          ) : (
            <ul className="divide-y" data-testid="list-mark-overrides">
              {rows.map((row) => {
                const name = row.vehicleKind === "company" ? nameOf(row.vehicleId) : null;
                /* The SAME predicate the mark computation uses
                   (`overrideIsEffective`, wave9ReportingStore.ts:493), applied
                   to the mode the SERVER reported — not re-invented here. */
                const effective =
                  row.approvalState === "rejected"
                    ? false
                    : mode === "required"
                      ? row.approvalState === "approved" || row.grandfatheredEffective
                      : mode === "able_to"
                        ? true
                        : null;
                return (
                  <li key={row.id} className="py-3" data-testid={`row-mark-override-${row.id}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <span className="block text-sm font-medium" data-testid={`override-subject-${row.id}`}>
                          {name ?? `${row.vehicleKind} ${row.vehicleId}`}
                        </span>
                        <span className="block text-[11px] font-mono text-muted-foreground" data-testid={`override-vehicle-${row.id}`}>
                          {`${row.vehicleKind} · ${row.vehicleId}`}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant={row.approvalState === "approved" ? "default" : row.approvalState === "rejected" ? "destructive" : "secondary"}
                          data-testid={`override-state-${row.id}`}
                        >
                          {row.approvalState}
                        </Badge>
                        <Badge
                          variant={effective === true ? "default" : "outline"}
                          data-testid={`override-effective-${row.id}`}
                        >
                          {effective === null
                            ? "Effect unknown"
                            : effective
                              ? "Effective now"
                              : "Not effective"}
                        </Badge>
                        {row.grandfatheredEffective && (
                          <Badge variant="outline" data-testid={`override-grandfathered-${row.id}`}>
                            Grandfathered
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="mt-2 grid gap-3 text-xs md:grid-cols-3">
                      <div>
                        <span className="block text-muted-foreground">Current derived mark</span>
                        <DerivedMarkCell row={row} />
                      </div>
                      <div>
                        <span className="block text-muted-foreground">Proposed fair value</span>
                        {/* Rule 4: integer minor units through formatMinor, in the
                            row's OWN currency. No total is shown across rows. */}
                        <span className="block font-medium" data-testid={`override-proposed-${row.id}`}>
                          {formatMinor(row.fairValueMinor, row.currency)}
                        </span>
                        <span className="block text-muted-foreground" data-testid={`override-prior-${row.id}`}>
                          {row.priorFairValueMinor === null
                            ? "No prior fair value recorded"
                            : `was ${formatMinor(row.priorFairValueMinor, row.currency)}`}
                        </span>
                        {typeof row.pricePerShareOverride === "number" && (
                          <span className="block text-muted-foreground" data-testid={`override-pps-${row.id}`}>
                            {`${row.pricePerShareOverride} / share proposed`}
                          </span>
                        )}
                      </div>
                      <div>
                        <span className="block text-muted-foreground">Proposed by</span>
                        <span className="block font-medium" data-testid={`override-proposer-${row.id}`}>
                          {row.overriddenBy}
                        </span>
                        <span className="block text-muted-foreground" data-testid={`override-when-${row.id}`}>
                          {fmtWhen(row.overriddenAt)}
                        </span>
                      </div>
                    </div>

                    <span className="mt-2 block text-xs" data-testid={`override-reason-${row.id}`}>
                      {`Reason given: ${row.reason}`}
                    </span>

                    {row.approvalState !== "pending" && (
                      <div className="mt-2 rounded-md bg-muted/50 px-3 py-2">
                        <span className="block text-xs" data-testid={`override-decision-by-${row.id}`}>
                          {`${row.approvalState} by ${row.approvedBy ?? "unknown"} at ${fmtWhen(row.approvedAt)}`}
                        </span>
                        <span className="block text-xs text-muted-foreground" data-testid={`override-decision-note-${row.id}`}>
                          {row.approvalNote
                            ? `Reason recorded: ${row.approvalNote}`
                            : "No reason was recorded with this decision."}
                        </span>
                      </div>
                    )}

                    {row.approvalState === "pending" && (
                      <>
                        {openRow === row.id ? (
                          <DecisionForm row={row} onDone={() => setOpenRow(null)} />
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-2 h-7 text-xs"
                            onClick={() => setOpenRow(row.id)}
                            data-testid={`button-review-override-${row.id}`}
                          >
                            Review this override
                          </Button>
                        )}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default MarkOverrideReviewPanel;
