import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, AlertTriangle, GitCompareArrows, Stamp } from "lucide-react";
import { defaultTelemetryStore, useSprint3 } from "@/lib/sprint3";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { AdminPageIntro } from "@/components/AdminPageIntro";
import { safeActorLabel, safeTargetLabel } from "@/lib/actorLabel";

type FilterMode = "all" | "signoff" | "reconciliation" | "divergence";

/*
 * v25.41 Q3 (Avi answer = A): the admin audit log is now DB-BACKED.
 *
 * Previously the admin chain rows came from `useAdminStore()` — a browser-side
 * in-memory Zustand store that only contained actions taken in the CURRENT
 * tab's session, so the page never showed the durable, hash-chained admin
 * audit events written server-side since v25.38. Per Avi's unifying directive
 * ("nothing in memory; every module's page is dynamic and fetches from the
 * record table"), the admin rows are now read from the existing DB-backed
 * endpoint GET /api/admin/audit-log. The telemetry chain (defaultTelemetryStore)
 * remains a separate cap-table event log and is untouched.
 *
 * DB row shape (server/adminPlatformStore.ts AuditEntry):
 *   { id, ts, actor, entity, eventType, payload, priorHash, hash, tenantId }
 */

// DB audit row as returned by GET /api/admin/audit-log.
type DbAuditRow = {
  id: string;
  ts: string;
  actor: string;
  entity: string;
  eventType: string;
  payload?: Record<string, unknown>;
  priorHash: string;
  hash: string;
  tenantId?: string;
  /* WAVE 93 · ITEM 1 — resolved identity labels, added at the SOURCE
     (server/adminPlatformStore.ts, GET /api/admin/audit-log). `actor` and
     `entity` are unchanged and remain the machine-readable values (R77). */
  actorLabel?: string | null;
  actorKind?: string | null;
  actorBound?: boolean;
  entityLabel?: string | null;
};

type AuditLogResponse = {
  count: number;
  total: number;
  limit: number;
  offset: number;
  items: DbAuditRow[];
  fallback?: boolean;
  /* WAVE 181 — the server now states the window and order it applied, so the
     page can no longer describe a filter it did not actually run. */
  order?: "asc" | "desc";
  rangeFrom?: string | null;
  rangeToExclusive?: string | null;
  rangeBasis?: string;
  rangeRejected?: string[];
};

// v25.41 round-3 (per GPT-5.5 re-verify): the server verifier returns a
// per-tenant chain summary. We use the all-tenants endpoint and surface
// per-tenant integrity to the admin.
/* WAVE 186 · R159.1 — GET /api/admin/audit-write-health (server/adminPlatformStore.ts,
   getAuditWriteHealth()). Reports whether the ledger is still ACCEPTING rows, which
   is a different question from whether the rows it already has are intact. */
type AuditWriteHealthResponse = {
  ok: boolean;
  health?: {
    ok: boolean;
    status: "healthy" | "stale" | "failing" | "unreadable";
    newestRowAt: string | null;
    newestRowAgeSeconds: number | null;
    newestRowAction: string | null;
    rowsTotal: number | null;
    writesOkSinceBoot: number;
    writeFailuresSinceBoot: number;
    lastWriteOkAt: string | null;
    staleAfterHours: number;
    readError: string | null;
  };
};

type VerifyResponse = {
  ok: boolean;
  brokenAt: number;
  totalLinks: number;
  scope: string;
  perTenant?: Array<{ tenantId: string; ok: boolean; brokenAt: number; totalLinks: number }>;
  /** v25.41 round-3 R3: present when the server returns 503 because it
   * cannot read the durable audit table. UI MUST treat this as a fail-
   * closed state and NOT render a green admin-chain badge. */
  error?: string;
};

type Row = {
  id: string;
  ts: string;
  actor: string;
  action: string;
  target: string;
  prevHash: string;
  hash: string;
  source: "admin" | "telemetry";
  category: "signoff" | "reconciliation" | "divergence" | "other";
  payload?: unknown;
  /* WAVE 93 · ITEM 1 — see DbAuditRow. */
  actorLabel?: string | null;
  targetLabel?: string | null;
};

export default function AdminAuditLog() {
  useSprint3((s) => s.telemetryTick); // re-render on new telemetry
  const telemetryEvents = defaultTelemetryStore.list();
  const [filter, setFilter] = useState<FilterMode>("all");

  // v25.41 round-3 (per GPT-5.5 re-verify): DB-backed admin audit log with
  // SERVER-SIDE pagination + filtering. The client no longer scans an
  // unbounded in-memory mirror; the server filters at the DB layer and
  // returns total + page items. Avi's unifying directive: dynamic, DB-driven.
  const [entityPrefix, setEntityPrefix] = useState("");
  const [eventTypeFilter, setEventTypeFilter] = useState("");
  const [actorFilter, setActorFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [pageSize, setPageSize] = useState(100);
  const [pageOffset, setPageOffset] = useState(0);

  // Build query string from active filters. Entity is sent as a server-side
  // prefix wildcard (e.g. `co_*`) so the DB does the filtering.
  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    const ep = entityPrefix.trim();
    if (ep) params.set("entity", ep.endsWith("*") ? ep : `${ep}*`);
    if (eventTypeFilter.trim()) params.set("eventType", eventTypeFilter.trim());
    if (actorFilter.trim()) params.set("actor", actorFilter.trim());
    /* ═══════════════════════════════════════════════════════════════════════
     * WAVE 181 · R148.3 item 2 — THE DATE RANGE NOW REACHES THE DATABASE.
     * ═══════════════════════════════════════════════════════════════════════
     * Before this wave `from`/`to` were NOT in this param set (nor in the deps
     * array below) and were applied further down in a client-side useMemo —
     * i.e. to the ONE PAGE already fetched. Combined with the server's old
     * `ORDER BY created_at ASC`, page 1 was the OLDEST 100 of 1314 rows, so a
     * range covering the last three days matched nothing while the server's
     * unranged `total` still read 1314. That is the literal origin of the
     * reported "No audit entries match the current filters — 0 of 1314 total",
     * and of "the newest entry in the whole log is 26 May 2026" (which was
     * really the newest entry on page 1). The writer was never broken.
     * Sending the range to the server makes it reduce the set BEFORE
     * pagination, so `total` and the rows on screen finally count the same set. */
    if (fromDate.trim()) params.set("from", fromDate.trim());
    if (toDate.trim()) params.set("to", toDate.trim());
    params.set("limit", String(pageSize));
    params.set("offset", String(pageOffset));
    return params.toString();
  }, [entityPrefix, eventTypeFilter, actorFilter, fromDate, toDate, pageSize, pageOffset]);

  const { data: auditResp } = useQuery<AuditLogResponse>({
    queryKey: ["/api/admin/audit-log", queryParams],
    queryFn: async () =>
      (await apiRequest("GET", `/api/admin/audit-log?${queryParams}`)).json(),
  });
  const dbAudit: DbAuditRow[] = auditResp?.items ?? [];
  const dbTotal: number = auditResp?.total ?? 0;

  // v25.41 round-3: the SERVER verifies the hash chain per tenantId (the
  // scope used at write time). The page no longer re-walks priorHash in the
  // browser, which was wrong because mixed-tenant rows on one page do NOT
  // form a single chain.
  //
  // v25.41 round-3 R3 (per GPT-5.5): tolerate the 503 "verifier unavailable"
  // shape WITHOUT treating it as a valid chain. We resolve the response even
  // on non-OK status so we can distinguish "chain broken" from "verifier
  // could not run" and render an explicit warning.
  const { data: verifyResp, isError: verifyIsError } = useQuery<VerifyResponse>({
    queryKey: ["/api/admin/audit-log/verify"],
    queryFn: async () => {
      const resp = await apiRequest("GET", "/api/admin/audit-log/verify");
      return resp.json();
    },
    staleTime: 60_000,
    retry: false,
  });
  const adminVerification = useMemo(() => {
    const length = verifyResp?.totalLinks ?? 0;
    // FAIL CLOSED on verifier unavailability or network/DB error:
    //   - query errored → unavailable
    //   - server returned error sentinel (or scope === 'unavailable') → unavailable
    //   - chain broken → invalid
    //   - otherwise → valid (ok === true)
    const unavailable = verifyIsError || !!verifyResp?.error || verifyResp?.scope === "unavailable";
    const valid = !unavailable && (verifyResp?.ok === true);
    const firstBreakAt = unavailable
      ? "verification unavailable"
      : !valid && verifyResp?.perTenant
        ? (verifyResp.perTenant.find((t) => !t.ok)?.tenantId ?? "unknown")
        : null;
    return { valid, unavailable, firstBreakAt, length };
  }, [verifyResp, verifyIsError]);

  /* ══ WAVE 186 · ITEM B · R159.1 — "IS THE LEDGER STILL RECORDING?" ══════════
   * The two chain badges on this page answer "is the history I already have
   * internally consistent?" — and a ledger that has stopped accepting rows
   * answers that with a confident YES forever. That is precisely how three
   * months of unrecorded activity went unnoticed on the live server: nothing on
   * any screen reported the age of the newest entry or a failed write.
   *
   * `GET /api/admin/audit-write-health` is a pure read (it never appends, so
   * checking cannot pollute what it measures). `retry: false` and the failure
   * branch below matter: an unanswerable health question must render as UNKNOWN,
   * never fall back to a comforting default. */
  const { data: writeHealthResp, isError: writeHealthIsError } = useQuery<AuditWriteHealthResponse>({
    queryKey: ["/api/admin/audit-write-health"],
    queryFn: async () => {
      const resp = await apiRequest("GET", "/api/admin/audit-write-health");
      return resp.json();
    },
    staleTime: 30_000,
    retry: false,
  });

  const writeHealth = useMemo(() => {
    const h = writeHealthResp?.health;
    if (writeHealthIsError || !h) {
      return {
        statusLabel: "unknown — health check unavailable",
        newestLabel: "unknown",
        failuresLabel: "unknown",
        tone: "warning" as const,
        warning:
          "The audit-write health check could not be reached, so whether this ledger is still recording is UNKNOWN. Do not read this as healthy.",
      };
    }
    const ageSeconds = h.newestRowAgeSeconds;
    /* Coarse, honest units. Age is displayed, never used for arithmetic on any
       money value. */
    const ageText =
      ageSeconds === null
        ? "no entries at all"
        : ageSeconds < 3600
          ? `${Math.floor(ageSeconds / 60)} min ago`
          : ageSeconds < 172800
            ? `${Math.floor(ageSeconds / 3600)} h ago`
            : `${Math.floor(ageSeconds / 86400)} days ago`;
    const newestLabel = h.newestRowAt ? `${h.newestRowAt} (${ageText})` : "no entries at all";
    if (h.status === "failing") {
      return {
        statusLabel: "FAILING — writes are being lost",
        newestLabel,
        failuresLabel: String(h.writeFailuresSinceBoot),
        tone: "critical" as const,
        warning:
          "Audit writes are FAILING on this server right now. Actions are still completing, but they are not being recorded. Treat this as a P0: check that the database named by DATABASE_URL is writable by the server process, then re-check this card.",
      };
    }
    if (h.status === "unreadable") {
      return {
        statusLabel: "unknown — ledger could not be read",
        newestLabel,
        failuresLabel: String(h.writeFailuresSinceBoot),
        tone: "warning" as const,
        warning:
          "The audit ledger could not be read, so whether it is still recording is UNKNOWN. Do not read this as healthy.",
      };
    }
    if (h.status === "stale") {
      return {
        statusLabel: `no new entries for over ${h.staleAfterHours} h`,
        newestLabel,
        failuresLabel: String(h.writeFailuresSinceBoot),
        tone: "warning" as const,
        warning:
          "Nothing has been recorded for longer than expected. If privileged actions have happened since the entry above, they are not in this ledger. Confirm the database is writable before relying on this period of the log.",
      };
    }
    return {
      statusLabel: "recording",
      newestLabel,
      failuresLabel: String(h.writeFailuresSinceBoot),
      tone: "positive" as const,
      warning: null as string | null,
    };
  }, [writeHealthResp, writeHealthIsError]);

  const telemetryVerification = useMemo(() => defaultTelemetryStore.verifyChain(), [telemetryEvents]);

  const rows: Row[] = useMemo(() => {
    const all: Row[] = dbAudit.map((e) => ({
      id: e.id, ts: e.ts, actor: e.actor, action: e.eventType, target: e.entity,
      prevHash: e.priorHash, hash: e.hash, source: "admin",
      category: "other",
      payload: e.payload,
      /* WAVE 93 · ITEM 1 — carry the server's resolved labels through. */
      actorLabel: e.actorLabel ?? null,
      targetLabel: e.entityLabel ?? null,
    }));
    for (const e of telemetryEvents) {
      const cat: Row["category"] =
        e.type.startsWith("signoff.") ? "signoff" :
        e.type === "reconciliation.divergence_detected" ? "divergence" :
        e.type.startsWith("reconciliation.") ? "reconciliation" : "other";
      all.push({
        id: e.id,
        ts: e.timestamp,
        actor: e.actorId,
        action: e.type,
        target: e.companyId + (e.roundId ? ` / ${e.roundId}` : ""),
        prevHash: e.prevHash,
        hash: e.hash,
        source: "telemetry",
        category: cat,
        payload: e,
      });
    }
    /* WAVE 181 — NEWEST FIRST. The server now returns the newest page; sorting
       ascending here would put the most recent action at the bottom of a 100-row
       scroll box and reinstate the illusion that nothing recent was audited.
       Telemetry rows are merged in and must be ordered the same way. */
    return all.sort((a, b) => b.ts.localeCompare(a.ts));
  }, [dbAudit, telemetryEvents]);

  const filtered = useMemo(() => {
    // v25.41 round-3: the server already filtered entity/actor/eventType.
    // Only `category` (signoff/recon/divergence — synthesized from telemetry
    // rows) still needs client-side application.
    //
    // WAVE 181: the date range IS now a server-side SQL filter (see
    // queryParams). This second pass is retained ONLY because the merged
    // telemetry rows come from the browser store and never passed through that
    // SQL. It is a no-op for the DB rows the server already ranged. Note
    // `new Date("YYYY-MM-DD")` parses as UTC midnight, which matches the
    // server's UTC day boundaries exactly — the two passes cannot disagree.
    let out = filter === "all" ? rows : rows.filter((r) => r.category === filter);
    const fromTs = fromDate ? new Date(fromDate).getTime() : null;
    const toTs = toDate ? new Date(toDate).getTime() + 24 * 60 * 60 * 1000 : null;
    if (fromTs !== null || toTs !== null) {
      out = out.filter((r) => {
        const t = new Date(r.ts).getTime();
        if (fromTs !== null && t < fromTs) return false;
        if (toTs !== null && t >= toTs) return false;
        return true;
      });
    }
    return out;
  }, [rows, filter, fromDate, toDate]);

  // Distinct event types for the Select (derived from the live DB rows).
  const eventTypeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of dbAudit) set.add(r.eventType);
    return Array.from(set).sort();
  }, [dbAudit]);

  // Sign-off chains: each round_close has [primaryHash, referenceHash, founder + admin signoff].
  // We surface this human-readably by walking signoff.granted events.
  const signoffChains = useMemo(() => {
    const closes = telemetryEvents.filter((e) => e.type === "round.closed");
    const chains: Array<{
      roundId: string; companyId: string; closedAt: string;
      primaryHash: string; referenceHash: string;
      founder?: { actorId: string; ts: string; identityHash: string };
      admin?: { actorId: string; ts: string; identityHash: string };
    }> = [];
    for (const c of closes) {
      const p: any = (c as any).payload;
      const founder = telemetryEvents.find((e) =>
        e.type === "signoff.granted"
        && (e as any).payload.roundId === p.roundId
        && (e as any).payload.signerRole === "founder",
      );
      const admin = telemetryEvents.find((e) =>
        e.type === "signoff.granted"
        && (e as any).payload.roundId === p.roundId
        && (e as any).payload.signerRole === "admin",
      );
      chains.push({
        roundId: p.roundId, companyId: c.companyId, closedAt: c.timestamp,
        primaryHash: p.primaryHash, referenceHash: p.referenceHash,
        founder: founder ? { actorId: founder.actorId, ts: founder.timestamp, identityHash: (founder as any).payload.identityHash } : undefined,
        admin: admin ? { actorId: admin.actorId, ts: admin.timestamp, identityHash: (admin as any).payload.identityHash } : undefined,
      });
    }
    return chains;
  }, [telemetryEvents]);

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Hash-chained admin audit log + telemetry event log unified. Sign-offs, reconciliations, divergences, every formula publish — all immutable, all queryable."
        breadcrumbs={[{ label: "Admin" }, { label: "Audit log" }]}
        actions={
          <div className="flex items-center gap-2">
            {/* v25.41 round-3 R3 (per GPT-5.5): three states — valid (green),
             * unavailable (amber, fail-closed), broken (red). The previous
             * draft conflated unavailable with valid; SOC 2 CC7.2 requires we
             * surface verifier-down distinct from chain-ok. */}
            {adminVerification.unavailable
              ? <Badge className="bg-amber-100 text-amber-900 border-0" data-testid="admin-chain-unavailable"><AlertTriangle className="h-3 w-3 mr-1" />Admin chain verification unavailable</Badge>
              : adminVerification.valid
                ? <Badge className="bg-emerald-100 text-emerald-900 border-0"><ShieldCheck className="h-3 w-3 mr-1" />Admin chain · {adminVerification.length}</Badge>
                : <Badge className="bg-rose-100 text-rose-900 border-0"><AlertTriangle className="h-3 w-3 mr-1" />Admin chain broken at {adminVerification.firstBreakAt}</Badge>}
            {telemetryVerification.valid
              ? <Badge className="bg-emerald-100 text-emerald-900 border-0"><ShieldCheck className="h-3 w-3 mr-1" />Telemetry chain · {telemetryVerification.length}</Badge>
              : <Badge className="bg-rose-100 text-rose-900 border-0"><AlertTriangle className="h-3 w-3 mr-1" />Telemetry chain broken at #{telemetryVerification.brokenAt}</Badge>}
          </div>
        }
      />
      <PageBody>
        <AdminPageIntro
          guidance={{
            eyebrow: "Forensic record",
            title: "Audit log — every privileged action, hash-chained and immutable",
            description:
              "Two parallel append-only chains: the admin chain captures every admin/ops action (formula publishes, policy changes, force-logouts, role escalations) and the telemetry chain captures every system-level cap-table event (reconciliations, sign-offs, divergences). Each entry is linked to the previous via SHA-256 so any retroactive edit instantly breaks the chain and is detectable.",
            warning:
              "If either chain shows 'broken at #N', stop all admin writes immediately and escalate to security. A broken chain is a P0 incident under SOC 2 CC7.2 (system monitoring) — it means an entry was retroactively altered, deleted, or the store was tampered.",
            positive:
              "This page is the authoritative record for M&A diligence and regulatory inquiry. Every founder + admin sign-off on a round close is permanently retained with identity hash, hash chain link, and dual-engine reconciliation signatures.",
          }}
          stats={[
            { label: "Admin chain", value: adminVerification.unavailable ? "⚠ verification unavailable" : adminVerification.valid ? `✓ ${adminVerification.length}` : `✗ broken @ ${adminVerification.firstBreakAt}`, tone: adminVerification.unavailable ? "warning" : adminVerification.valid ? "positive" : "critical" },
            { label: "Telemetry chain", value: telemetryVerification.valid ? `✓ ${telemetryVerification.length}` : `✗ broken @ ${telemetryVerification.brokenAt}`, tone: telemetryVerification.valid ? "positive" : "critical" },
            { label: "Sign-off chains", value: signoffChains.length, hint: "Founder + admin" },
            { label: "Entries shown", value: filtered.length, hint: `Filter: ${filter}` },
          ]}
        />
        {/* Sign-off chain summary */}
        {signoffChains.length > 0 && (
          <Card className="mb-4">
            <CardContent className="py-4">
              <div className="text-sm font-medium mb-2 flex items-center gap-2"><Stamp className="h-4 w-4 text-[hsl(0_100%_40%)]" />Sign-off chains</div>
              <div className="space-y-2 text-xs">
                {signoffChains.map((c) => (
                  <div key={c.roundId} className="border-l-2 border-[hsl(0_100%_40%)] pl-3 py-1" data-testid={`signoff-chain-${c.roundId}`}>
                    <div>Round <span className="font-mono">{c.roundId}</span> at <span className="font-mono">{c.companyId}</span> closed on <span className="font-mono">{new Date(c.closedAt).toLocaleString()}</span>.</div>
                    <div className="text-muted-foreground mt-0.5">
                      {/* WAVE 93 · ITEM 1 — `{c.founder.actorId}` was printed straight into
                          the page (reviewer 3, DP-10 `:297`). Described now; the id stays
                          as a machine-readable attribute (R77). */}
                      Founder: {c.founder ? <>{safeActorLabel(null, c.founder.actorId)} <span className="font-mono">({c.founder.identityHash})</span> at {new Date(c.founder.ts).toLocaleString()}</> : <span className="italic">missing</span>}
                      {" · "}
                      Admin: {c.admin ? <>{safeActorLabel(null, c.admin.actorId)} <span className="font-mono">({c.admin.identityHash})</span> at {new Date(c.admin.ts).toLocaleString()}</> : <span className="italic">missing</span>}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">Primary: {c.primaryHash.slice(0, 20)}… · Reference: {c.referenceHash.slice(0, 20)}…</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* v25.41 Q3 — DB-row filters (entity prefix, event type, actor, date range). */}
        <Card className="mb-3">
          <CardContent className="py-3 flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Entity prefix</span>
              <Input value={entityPrefix} onChange={(e) => setEntityPrefix(e.target.value)}
                placeholder="e.g. co_ or partner_" className="w-44 h-8" data-testid="filter-entity-prefix" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Event type</span>
              <Select value={eventTypeFilter || "__all__"} onValueChange={(v) => setEventTypeFilter(v === "__all__" ? "" : v)}>
                <SelectTrigger className="w-56 h-8" data-testid="filter-event-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All event types</SelectItem>
                  {eventTypeOptions.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Actor</span>
              <Input value={actorFilter} onChange={(e) => setActorFilter(e.target.value)}
                placeholder="actor id" className="w-40 h-8" data-testid="filter-actor" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">From</span>
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
                className="w-40 h-8" data-testid="filter-from-date" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">To</span>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
                className="w-40 h-8" data-testid="filter-to-date" />
            </div>
            <Button variant="outline" size="sm" className="h-8"
              onClick={() => { setEntityPrefix(""); setEventTypeFilter(""); setActorFilter(""); setFromDate(""); setToDate(""); setPageOffset(0); }}
              data-testid="filter-clear">
              Clear
            </Button>
          </CardContent>
        </Card>

        {/* Filter chips */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs text-muted-foreground mr-1">Filter:</span>
          {(["all", "signoff", "reconciliation", "divergence"] as FilterMode[]).map((f) => (
            <Button key={f} size="sm" variant={filter === f ? "default" : "outline"}
              className={filter === f ? "bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] h-7" : "h-7"}
              onClick={() => setFilter(f)} data-testid={`filter-${f}`}>
              {f === "all" ? "All" : f === "signoff" ? "Sign-off" : f === "reconciliation" ? "Reconciliation" : "Divergence"}
            </Button>
          ))}
          <span className="text-xs text-muted-foreground ml-auto flex items-center gap-2">
            {/* v25.41 round-3: surface server-side total + current-page count. */}
            <span data-testid="audit-total-server">DB total: {dbTotal}</span>
            <span>·</span>
            <span data-testid="audit-page-count">{filtered.length} on this page</span>
          </span>
        </div>

        {/* v25.41 round-3: server-pagination controls. */}
        <div className="flex items-center gap-2 mb-3 text-xs">
          <Button size="sm" variant="outline" className="h-7"
            disabled={pageOffset <= 0}
            onClick={() => setPageOffset(Math.max(0, pageOffset - pageSize))}
            data-testid="audit-prev-page">
            ← Prev
          </Button>
          <Button size="sm" variant="outline" className="h-7"
            disabled={pageOffset + pageSize >= dbTotal}
            onClick={() => setPageOffset(pageOffset + pageSize)}
            data-testid="audit-next-page">
            Next →
          </Button>
          <span className="text-muted-foreground">
            Showing {dbTotal === 0 ? 0 : pageOffset + 1}–{Math.min(pageOffset + pageSize, dbTotal)} of {dbTotal}
          </span>
          {/* WAVE 181 — STATIC SIBLING (R143.1: nothing above is replaced).
              The page must say out loud how it ordered and bounded the rows.
              An admin who cannot tell "no such entries" from "not on this page"
              will read the second as the first, which is exactly what happened
              in R148.3 item 2. */}
          <span className="text-muted-foreground" data-testid="audit-order-basis">
            Newest first · date range applied in SQL on UTC day boundaries before paging
          </span>
          {auditResp?.rangeRejected && auditResp.rangeRejected.length > 0 ? (
            <span className="text-rose-700" data-testid="audit-range-rejected">
              Date filter ignored — unparseable value
            </span>
          ) : null}
          <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPageOffset(0); }}>
            <SelectTrigger className="w-24 h-7" data-testid="audit-page-size"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[50, 100, 250, 500].map((n) => <SelectItem key={n} value={String(n)}>{n}/pg</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardContent className="px-0 max-h-[60vh] overflow-y-auto">
            <table className="w-full text-sm" data-testid="table-audit-log">
              <thead>
                <tr className="text-xs uppercase text-muted-foreground border-b border-border">
                  <th className="text-left font-medium px-6 py-2.5">Time</th>
                  <th className="text-left font-medium px-3 py-2.5">Source</th>
                  <th className="text-left font-medium px-3 py-2.5">Actor</th>
                  <th className="text-left font-medium px-3 py-2.5">Action</th>
                  <th className="text-left font-medium px-3 py-2.5">Target</th>
                  <th className="text-left font-medium px-3 py-2.5">Hash</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr data-testid="row-audit-empty">
                    <td colSpan={6} className="px-6 py-8 text-center text-sm text-muted-foreground">
                      {/* v25.41 round-2 (per GPT-5.5): explicit empty state. */}
                      No audit entries match the current filters.
                    </td>
                  </tr>
                )}
                {/* WAVE 93 · ITEM 1 — reviewer 3's DP-10, closed. The Actor and Target
                    cells below printed `e.actor` / `e.target` verbatim, so every one of
                    the 45 measured unbound actor shapes reached an operator as a raw
                    key. Each id is kept as a machine-readable attribute (R77) so
                    filtering and correlation still work. */}
                {/* WAVE 203 · ITEM A — R178.5, verbatim: "Newest first."

                    THE DEFECT WAS HERE, AND ONLY HERE. `filtered` arrives
                    descending (the sort at :329, wave 181) on top of a
                    descending server page (`ORDER BY created_at DESC, id DESC`,
                    adminPlatformStore.ts:3127, wave 181). The `.reverse()` that
                    used to sit on this line flipped it back to ASCENDING at
                    paint time, so the oldest row on the page rendered first and
                    the newest row rendered last — while the badge 42 lines above
                    (`audit-order-basis`) said "Newest first". A healthy ledger
                    therefore read as a silent one.

                    NOT TOUCHED, DELIBERATELY: the hash chain. Its order is the
                    server pair AUDIT_CHAIN_ORDER_SQL_ASC/DESC, consumed by the
                    writer's tip read, by AUDIT_CHAIN_SELECT_SQL and by
                    verifyTenantAuditChain. This line is a browser-side <tbody>
                    map: it changes the order rows PAINT, not the order they are
                    fetched, hashed or verified in. Chain verification depends on
                    sequence, not on display order. */}
                {[...filtered].map((e) => (
                  <tr key={`${e.source}-${e.id}`} className="border-b border-border/60 hover:bg-secondary/40" data-testid={`row-audit-${e.id}`}>
                    <td className="px-6 py-3 text-xs text-muted-foreground">{new Date(e.ts).toLocaleString()}</td>
                    <td className="px-3 py-3">
                      <Badge variant="outline" className={`text-[10px] ${e.source === "telemetry" ? "border-[hsl(0_100%_40%)] text-[hsl(0_100%_40%)]" : ""}`}>
                        {e.source === "telemetry" ? <><GitCompareArrows className="h-2.5 w-2.5 mr-1" />telemetry</> : "admin"}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-xs" data-actor-id={e.actor}>{safeActorLabel(e.actorLabel, e.actor)}</td>
                    <td className="px-3 py-3 font-mono text-xs">{e.action}</td>
                    <td className="px-3 py-3 text-muted-foreground text-xs" data-target-id={e.target}>{safeTargetLabel(e.targetLabel, e.target)}</td>
                    <td className="px-3 py-3 font-mono text-[10px]">{e.hash.slice(0, 14)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
        {/* WAVE 186 · R159.1 — ledger-write health. A STATIC SIBLING card: no
            existing element, text node or table cell on this page is altered. */}
        <Card className="mb-4" data-testid="card-audit-write-health">
          <CardContent className="py-4">
            <div className="text-sm font-medium mb-1 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[hsl(0_100%_40%)]" />
              <span data-testid="audit-write-health-title">Is this ledger still recording?</span>
            </div>
            <p className="text-xs text-muted-foreground mb-2" data-testid="audit-write-health-explainer">
              The chain badges above prove that the entries already written have not been altered. They stay green even when nothing new is being written. This card answers the separate question.
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span data-testid="audit-write-health-status">Recording status: {writeHealth.statusLabel}</span>
              <span data-testid="audit-write-health-newest">Newest entry: {writeHealth.newestLabel}</span>
              <span data-testid="audit-write-health-failures">Failed writes since restart: {writeHealth.failuresLabel}</span>
            </div>
            {writeHealth.warning !== null && (
              <p className="text-xs text-rose-700 mt-2" data-testid="audit-write-health-warning">{writeHealth.warning}</p>
            )}
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
