/**
 * v19 Phase C — Hash-chain audit verification UI.
 *
 * Lets a chapter admin (or platform admin) pick any hash-chained table,
 * optionally a date range, and run the verifier. Shows per-row status
 * green/red, the "broken at row id" pointer (if any), and a download
 * button for the full result JSON.
 *
 * Endpoints used:
 *   GET /api/admin/audit/verifiable-tables
 *   GET /api/admin/audit/verify-chain?table=X&chapter_id=Y&from=ts&to=ts
 *   GET /api/admin/audit/verify-all?chapter_id=Y
 *   GET /api/admin/audit/verification-history?table=X&chapter_id=Y
 */
import { useEffect, useMemo, useState } from "react";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck, AlertTriangle, Download, RefreshCw } from "lucide-react";
import { serverRefusalText } from "@/lib/serverRefusalMessage"; /* WAVE 73 · ITEM 1 */

interface ChainVerifyResult {
  table: string;
  total_rows: number;
  verified: number;
  broken_at_row_id: string | null;
  broken_at_index: number | null;
  first_bad_field_hint: string | null;
  last_known_good_hash: string | null;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  details?: Array<{ id: string; ok: boolean; reason?: string }>;
}

interface VerifiableTable {
  name: string;
  hashCol: string;
  prevHashCol: string;
  hasChapterId: boolean;
  hasInsertRecompute: boolean;
}

interface HistoryRow {
  id: string;
  tenantId: string;
  chapterId: string | null;
  tableName: string;
  verifiedCount: number;
  brokenCount: number;
  brokenFirstId: string | null;
  totalRows: number;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" });
  /* WAVE 73 · ITEM 1 · R58 — THE WORST OF THE FIVE: THE BODY WAS NEVER READ AT ALL.
     This wrapper threw the literal `http_500` and discarded the entire response,
     on the page an admin opens when the AUDIT CHAIN may be broken — where the
     server's explanation is the whole point of looking. Now the server's own
     `message` is what the caller (and the page's error banner) receives; when a
     body carries no explanation, `HTTP <status>` still reaches the screen. */
  if (!r.ok) throw new Error(await serverRefusalText(r));
  return (await r.json()) as T;
}

/* WAVE 95 · ITEM 1 · R84 — one pinned anchor, as recorded and as served by
   GET /api/admin/audit-chain-health. */
interface AuditChainAnchor {
  tenantId: string;
  anchorRowId: string;
  anchorHash: string;
  effectiveAt: string;
  reason: string;
  createdAt: string;
  preAnchorNotProvable: number;
  /* R85 · read-time provenance. See server/adminPlatformStore.ts's
     `classifyAnchorProvenance`. Optional on the wire so an older server that
     does not send them cannot blank the panel — and note the DEFAULT below is
     the CONSERVATIVE one: absent means "we cannot show a human authorised it". */
  provenance?: "operator_authorised" | "migration_artefact";
  citesR84?: boolean;
  hasReAnchorLedgerRow?: boolean;
}

/* WAVE 95 · ITEM 1 · R84 condition 3 — THE HONESTY PANEL.
 *
 * This is the point of choosing remediation A over deleting anything, so it is
 * written to be impossible to misread. It is PERMANENT: it renders whenever an
 * anchor exists, whether or not there is an open incident, so the narrowing of
 * the platform's claim is never quietly forgotten once the red banner goes away.
 *
 * NO WORDING HERE MAY IMPLY THE EARLIER RECORD WAS VERIFIED. It says the
 * opposite, in the shortest words available: NOT PROVABLE. Nothing was deleted,
 * and it says that too, because the reason this is honest rather than a cover-up
 * is that the unprovable record is still sitting there to be read. */
function LedgerProvenancePanel({ anchors }: { anchors: AuditChainAnchor[] }) {
  if (anchors.length === 0) return null;
  return (
    <Card className="mb-4 border-2" data-testid="ledger-provenance-panel">
      <CardContent className="p-6 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          <h2 className="font-semibold">Ledger provenance — what this platform can and cannot prove</h2>
        </div>
        {anchors.map((a) => {
          /* R85 · the CONSERVATIVE default. An anchor is only presented as an
             authorised action when the server says so explicitly. An absent
             field, an unknown value, or a partial signal all read as "not shown
             to be an operator action" — the platform never upgrades itself. */
          const authorised = a.provenance === "operator_authorised";
          const citesButUnrecorded = !authorised && a.citesR84 === true && a.hasReAnchorLedgerRow === false;
          return (
          <div key={a.tenantId} className="rounded border p-3 space-y-2" data-testid={`ledger-anchor-${a.tenantId}`}>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" data-testid={`ledger-anchor-badge-${a.tenantId}`}>
                {authorised ? "anchored by an operator" : "anchored automatically by a migration"}
              </Badge>
              <span className="font-mono text-sm">{a.tenantId}</span>
            </div>
            {authorised ? (
              <p className="text-sm" data-testid={`ledger-anchor-statement-${a.tenantId}`}>
                This ledger was re-anchored on {a.effectiveAt} by an operator, who stated a reason,
                and the action is recorded in the ledger itself. Every record written after the
                anchor point is checked against it and verifies. The {a.preAnchorNotProvable} record(s)
                written before the anchor point are still here and still readable — nothing was
                deleted — but the platform <strong>cannot prove they are unaltered</strong>, and it
                does not claim to. They are <strong>not provable</strong>.
              </p>
            ) : (
              /* R85 · THE HONEST STATEMENT FOR A NON-R84 ANCHOR. Same standard as
                 R84 condition 3, which Wave 95 met with the permanent "cannot be
                 proven unaltered" panel: say the thing that is true, in the
                 shortest words available, and do not imply an action nobody
                 took. THE OPERATOR BRANCH'S OPENING SENTENCE IS NOT REPEATED
                 HERE, because nobody re-anchored this ledger — and
                 wave102_r85_anchor_provenance.test.ts §7 asserts that phrase
                 occurs EXACTLY ONCE in this file, inside the branch above,
                 where it is true. */
              <p className="text-sm" data-testid={`ledger-anchor-statement-${a.tenantId}`}>
                This anchor was <strong>created automatically by a database migration, not by an
                operator</strong>. <strong>No intent was recorded</strong>, because no human took
                this action and none was asked for. It is not an authorised re-anchoring and the
                platform does not present it as one. Records written after the anchor point are
                checked against it and verify. The {a.preAnchorNotProvable} record(s) written
                before it are still here and still readable — nothing was deleted — but the
                platform <strong>cannot prove they are unaltered</strong>, and it does not claim
                to. They are <strong>not provable</strong>.
              </p>
            )}
            {citesButUnrecorded ? (
              /* The PARTIAL state, stated rather than folded into either bucket:
                 the reason cites the ruling but the in-ledger record of the
                 action is absent. `appendAdminAudit` is deliberately fail-OPEN
                 (see `isAuditWriteFailure`), so this is reachable and must not
                 read as either a clean operator action or a migration artefact. */
              /* R77 / R44 · the ruling IDENTIFIER was in this sentence and the
                 internal-language fence caught it, correctly. An operator does
                 not need a ruling number; they need to know what is and is not
                 established. The identifier stays in the code comments and in the
                 machine-readable `reason` string; the sentence states the
                 BEHAVIOUR. */
              <p className="text-sm" data-testid={`ledger-anchor-partial-${a.tenantId}`}>
                Its stated reason claims this was an authorised re-anchoring, but <strong>the
                matching record of the action is missing from the ledger</strong>. The platform
                therefore cannot show this anchor was authorised, and treats it as unproven rather
                than assuming it was.
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground" data-testid={`ledger-anchor-record-${a.tenantId}`}>
              {a.reason}
            </p>
            <p className="text-xs text-muted-foreground" data-testid={`ledger-anchor-evidence-${a.tenantId}`}>
              How this was determined, at read time, from records already on file — nothing was
              written and no migration was added. The stated reason claims an authorised
              re-anchoring: <strong>{a.citesR84 === true ? "yes" : "no"}</strong>. A matching record
              of the action exists in the ledger, chained from this anchor&apos;s hash:{" "}
              <strong>{a.hasReAnchorLedgerRow === true ? "yes" : "no"}</strong>. Both are required.
            </p>
            <p className="text-xs text-muted-foreground">
              This ledger is anchored once. If it stops verifying from here on, that is a new
              integrity incident to investigate — not something to anchor again.
            </p>
          </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export default function AuditChainVerifyPage(): JSX.Element {
  const [tables, setTables] = useState<VerifiableTable[]>([]);
  const [selectedTable, setSelectedTable] = useState<string>("");
  const [chapterId, setChapterId] = useState<string>("");
  const [fromTs, setFromTs] = useState<string>("");
  const [toTs, setToTs] = useState<string>("");
  const [running, setRunning] = useState<boolean>(false);
  const [result, setResult] = useState<ChainVerifyResult | null>(null);
  const [allResults, setAllResults] = useState<ChainVerifyResult[] | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  // W-V44 (banner) — audit-chain-health incident state + resolve control.
  interface HealthRow { key: string; status: string; detail: string | null; updatedAt: string | null; }
  const [health, setHealth] = useState<{ rows: HealthRow[]; incident: boolean } | null>(null);
  const [resolvingKey, setResolvingKey] = useState<string | null>(null);
  const [resolveMsg, setResolveMsg] = useState<string | null>(null);
  // WAVE 95 · ITEM 1 · R84 — the re-anchor control and the permanent provenance
  // statement. SEPARATE from "Resolve incident" on purpose; the reasoning is in
  // the endpoint comment in server/adminPlatformStore.ts and in
  // build_log/wave95/W95_REANCHOR.md. Resolve asserts "I looked and it is clean".
  // Re-anchor asserts "record that a provable history begins here, and that what
  // came before is NOT provable". Two different claims, two different controls.
  const [anchors, setAnchors] = useState<AuditChainAnchor[]>([]);
  const [anchorIntent, setAnchorIntent] = useState<Record<string, string>>({});
  const [anchoringKey, setAnchoringKey] = useState<string | null>(null);

  const loadHealth = async () => {
    try {
      const data = await getJson<{ ok: boolean; rows: HealthRow[]; incident: boolean; anchors?: AuditChainAnchor[] }>("/api/admin/audit-chain-health");
      setHealth({ rows: data.rows ?? [], incident: !!data.incident });
      setAnchors(data.anchors ?? []);
    } catch (err) {
      // Non-fatal: leave health null (card hidden) but surface in console.
      setHealth(null);
      setAnchors([]);
    }
  };
  useEffect(() => { void loadHealth(); }, []);

  const reAnchor = async (key: string) => {
    const intent = (anchorIntent[key] ?? "").trim();
    if (!intent) {
      setResolveMsg("Type why this ledger is being re-anchored. The reason is recorded permanently and cannot be edited afterwards.");
      return;
    }
    if (!window.confirm(
      "Re-anchor this ledger?\n\n" +
      "This is recorded permanently against your name, with your reason, and it happens once. " +
      "From the anchor point onwards the ledger is provable. The records written BEFORE it are kept " +
      "and stay readable, but the platform will state that it CANNOT prove they are unaltered.\n\n" +
      "Nothing is deleted. If the ledger still does not verify with the anchor in place, nothing at " +
      "all is written and the alarm stays on.",
    )) return;
    setAnchoringKey(key);
    setResolveMsg(null);
    try {
      const r = await fetch("/api/admin/audit-chain/re-anchor", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, intent }),
      });
      const j = await r.json();
      if (r.ok && j.anchored) {
        setResolveMsg(
          `\u201c${key}\u201d is now anchored. ${j.postAnchorVerified} record(s) after the anchor point verify against it. ` +
          `${j.preAnchorNotProvable} record(s) written before it are kept and readable, but are NOT provable \u2014 the platform does not claim they are. ` +
          (j.incidentCleared
            ? "The chain re-verified clean, so the incident is closed and the red banner will clear."
            : "The chain did NOT re-verify clean, so the incident stays open and the red banner stays on."),
        );
      } else {
        setResolveMsg(`Could not re-anchor \u201c${key}\u201d: ${j.message ?? j.error ?? "unknown error"}`);
      }
      await loadHealth();
    } catch (err) {
      setResolveMsg(`Could not re-anchor \u201c${key}\u201d: ${(err as Error).message}`);
    } finally {
      setAnchoringKey(null);
    }
  };

  const resolveIncident = async (key: string) => {
    setResolvingKey(key);
    setResolveMsg(null);
    try {
      const r = await fetch("/api/admin/audit-chain-health/resolve", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, note: "Resolved from Audit Chain Verify page after re-verification." }),
      });
      const j = await r.json();
      if (r.ok && j.cleared) {
        setResolveMsg(`Incident “${key}” resolved — the chain re-verified clean (${j.totalLinks} links). The P0 banner will clear.`);
        await loadHealth();
      } else if (r.status === 409) {
        setResolveMsg(`Could not resolve “${key}”: ${j.message ?? "the audit chain is not clean."} The incident stays until the break is investigated.`);
      } else {
        setResolveMsg(`Could not resolve “${key}”: ${j.error ?? j.message ?? "unknown error"}.`);
      }
    } catch (err) {
      setResolveMsg(`Could not resolve “${key}”: ${(err as Error).message}`);
    } finally {
      setResolvingKey(null);
    }
  };

  // Bootstrap: load supported tables.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getJson<{
          ok: boolean;
          catalog: VerifiableTable[];
        }>("/api/admin/audit/verifiable-tables");
        if (!cancelled) {
          setTables(data.catalog ?? []);
          if (data.catalog?.length && !selectedTable) {
            setSelectedTable(data.catalog[0].name);
          }
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load history when table or chapter changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const qs = new URLSearchParams();
        if (selectedTable) qs.set("table", selectedTable);
        if (chapterId) qs.set("chapter_id", chapterId);
        qs.set("limit", "50");
        const data = await getJson<{ ok: boolean; rows: HistoryRow[] }>(
          `/api/admin/audit/verification-history?${qs.toString()}`,
        );
        if (!cancelled) setHistory(data.rows ?? []);
      } catch {
        if (!cancelled) setHistory([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedTable, chapterId]);

  const runOne = async (): Promise<void> => {
    setRunning(true);
    setError(null);
    setResult(null);
    setAllResults(null);
    try {
      const qs = new URLSearchParams();
      qs.set("table", selectedTable);
      if (chapterId) qs.set("chapter_id", chapterId);
      if (fromTs) qs.set("from", fromTs);
      if (toTs) qs.set("to", toTs);
      qs.set("with_details", "1");
      const data = await getJson<{ ok: boolean; result: ChainVerifyResult }>(
        `/api/admin/audit/verify-chain?${qs.toString()}`,
      );
      setResult(data.result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const runAll = async (): Promise<void> => {
    setRunning(true);
    setError(null);
    setResult(null);
    setAllResults(null);
    try {
      const qs = new URLSearchParams();
      if (chapterId) qs.set("chapter_id", chapterId);
      const data = await getJson<{ ok: boolean; results: ChainVerifyResult[] }>(
        `/api/admin/audit/verify-all?${qs.toString()}`,
      );
      setAllResults(data.results);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const downloadJson = (): void => {
    if (!result && !allResults) return;
    const blob = new Blob(
      [JSON.stringify(result ?? allResults, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chain_verify_${selectedTable || "all"}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const summary = useMemo(() => {
    if (allResults) {
      const broken = allResults.filter((r) => r.broken_at_row_id !== null);
      return {
        ok: broken.length === 0,
        text: `${allResults.length - broken.length}/${allResults.length} tables verified`,
        broken: broken.map((b) => b.table),
      };
    }
    if (result) {
      return {
        ok: result.broken_at_row_id === null,
        text:
          result.broken_at_row_id === null
            ? `All ${result.verified}/${result.total_rows} rows verified`
            : `Broken at row ${result.broken_at_row_id} (index ${result.broken_at_index})`,
        broken: [],
      };
    }
    return null;
  }, [result, allResults]);

  return (
    <>
      <PageHeader title="Hash-chain audit verification" />
      <PageBody>
        {/* W-V44 (banner) — audit-chain-health incidents + admin resolve control.
            This is what drives the red P0 banner. Resolving an incident RE-VERIFIES
            the chain and only clears it if genuinely clean (DB-driven, honest). */}
        <LedgerProvenancePanel anchors={anchors} />
        {health && (
          <Card className="mb-4 border-2" style={{ borderColor: health.incident ? "#cc0001" : "#16a34a" }}>
            <CardContent className="p-6 space-y-3">
              <div className="flex items-center gap-2">
                {health.incident
                  ? <AlertTriangle className="h-5 w-5 text-red-600" />
                  : <ShieldCheck className="h-5 w-5 text-emerald-600" />}
                <h2 className="font-semibold">Audit chain health {health.incident ? "— incident(s) open" : "— all clear"}</h2>
              </div>
              <p className="text-xs text-muted-foreground">
                This panel drives the platform-wide red P0 banner. An incident row here means a
                tenant&rsquo;s hash-chain health was flagged. &ldquo;Resolve incident&rdquo; re-verifies that
                tenant&rsquo;s chain live and clears the incident ONLY if it is genuinely clean — a real
                break is never hidden. Clearing the last open incident removes the banner everywhere.
              </p>
              {health.rows.length === 0 && (
                <p className="text-sm text-muted-foreground" data-testid="health-empty">No audit-chain-health rows on file.</p>
              )}
              {health.rows.map((h) => {
                const isIncident = String(h.status).toLowerCase() !== "ok";
                return (
                  <div key={h.key} className="flex items-start justify-between gap-3 rounded border p-3" data-testid={`health-row-${h.key}`}>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant={isIncident ? "destructive" : "secondary"}>{h.status}</Badge>
                        <span className="font-mono text-sm">{h.key}</span>
                      </div>
                      {h.detail && <p className="mt-1 text-xs text-muted-foreground break-words">{h.detail}</p>}
                      {h.updatedAt && <p className="mt-0.5 text-[11px] text-muted-foreground">Updated {h.updatedAt}</p>}
                    </div>
                    {isIncident && (
                      <div className="flex items-start gap-3">
                        {/* W-V44 — UNCHANGED. "Resolve incident" still means "I looked
                            and it is clean", still re-verifies live, and still refuses
                            with 409 while the break is real. WAVE 95 deliberately did
                            NOT turn this button into the re-anchor action. */}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={resolvingKey === h.key}
                          onClick={() => resolveIncident(h.key)}
                          data-testid={`resolve-${h.key}`}
                        >
                          {resolvingKey === h.key ? "Verifying…" : "Resolve incident"}
                        </Button>
                        {/* WAVE 95 · ITEM 1 · R84 — the re-anchor action. Offered only
                            for a ledger that has NEVER been anchored: a second anchor is
                            refused by the server, and a break after an anchor is a real
                            incident rather than something to anchor again. The intent
                            box is not optional; the server refuses a blank one. */}
                        {!anchors.some((a) => a.tenantId === h.key) && (
                          <div className="flex flex-col gap-1 min-w-[240px]" data-testid={`reanchor-block-${h.key}`}>
                            <Input
                              value={anchorIntent[h.key] ?? ""}
                              onChange={(e) => setAnchorIntent((st) => ({ ...st, [h.key]: e.target.value }))}
                              placeholder="Why is this ledger being re-anchored?"
                              data-testid={`reanchor-intent-${h.key}`}
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={anchoringKey === h.key}
                              onClick={() => reAnchor(h.key)}
                              data-testid={`reanchor-${h.key}`}
                            >
                              {anchoringKey === h.key ? "Anchoring…" : "Re-anchor this ledger"}
                            </Button>
                            <p className="text-[11px] text-muted-foreground">
                              Records the point from which this ledger is provable. Everything written
                              before it is kept, and is stated as not provable. Nothing is deleted, and
                              this happens once.
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {resolveMsg && (
                <div className="text-sm rounded border border-border bg-muted/40 p-2" data-testid="resolve-msg">{resolveMsg}</div>
              )}
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
              <h2 className="font-semibold">Verifier</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <Label htmlFor="table-select">Table</Label>
                <select
                  id="table-select"
                  className="w-full border rounded px-2 py-1 text-sm"
                  value={selectedTable}
                  onChange={(e) => setSelectedTable(e.target.value)}
                  data-testid="audit-chain-table-select"
                >
                  {tables.map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name}
                      {t.hasInsertRecompute ? " ✓recompute" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="chapter-id">Chapter ID</Label>
                <Input
                  id="chapter-id"
                  value={chapterId}
                  onChange={(e) => setChapterId(e.target.value)}
                  placeholder="chap_keiretsu_canada"
                />
              </div>
              <div>
                <Label htmlFor="from-ts">From (ISO)</Label>
                <Input
                  id="from-ts"
                  value={fromTs}
                  onChange={(e) => setFromTs(e.target.value)}
                  placeholder="2026-01-01T00:00:00.000Z"
                />
              </div>
              <div>
                <Label htmlFor="to-ts">To (ISO)</Label>
                <Input
                  id="to-ts"
                  value={toTs}
                  onChange={(e) => setToTs(e.target.value)}
                  placeholder="2026-12-31T23:59:59.999Z"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={runOne}
                disabled={running || !selectedTable}
                data-testid="audit-chain-run-one"
              >
                {running ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4 mr-2" />
                )}
                Run verification
              </Button>
              <Button
                variant="outline"
                onClick={runAll}
                disabled={running}
                data-testid="audit-chain-run-all"
              >
                Verify all tables
              </Button>
              {(result || allResults) && (
                <Button
                  variant="outline"
                  onClick={downloadJson}
                  data-testid="audit-chain-download"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download JSON
                </Button>
              )}
            </div>

            {error && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
                <AlertTriangle className="h-4 w-4 inline mr-1" />
                {error}
              </div>
            )}

            {summary && (
              <div
                className={`p-3 rounded border ${
                  summary.ok
                    ? "bg-emerald-50 border-emerald-300 text-emerald-900"
                    : "bg-red-50 border-red-300 text-red-900"
                }`}
                data-testid="audit-chain-summary"
              >
                <div className="font-medium">{summary.text}</div>
                {!summary.ok && summary.broken.length > 0 && (
                  <div className="text-sm mt-1">
                    Broken tables: {summary.broken.join(", ")}
                  </div>
                )}
              </div>
            )}

            {allResults && (
              <div className="overflow-auto">
                <table className="text-sm w-full">
                  <thead className="text-left text-xs text-slate-600 bg-slate-50">
                    <tr>
                      <th className="p-1">Table</th>
                      <th className="p-1">Total rows</th>
                      <th className="p-1">Verified</th>
                      <th className="p-1">Status</th>
                      <th className="p-1">Duration ms</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allResults.map((r) => (
                      <tr key={r.table} className="border-t">
                        <td className="p-1 font-mono">{r.table}</td>
                        <td className="p-1">{r.total_rows}</td>
                        <td className="p-1">{r.verified}</td>
                        <td className="p-1">
                          {r.broken_at_row_id ? (
                            <Badge variant="destructive">broken</Badge>
                          ) : (
                            <Badge variant="positive">ok</Badge>
                          )}
                        </td>
                        <td className="p-1">{r.duration_ms}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {result && result.details && (
              <details className="text-xs">
                <summary className="cursor-pointer">
                  Per-row details ({result.details.length})
                </summary>
                <div className="max-h-64 overflow-auto mt-2 font-mono">
                  {result.details.map((d, i) => (
                    <div
                      key={d.id}
                      className={d.ok ? "text-emerald-700" : "text-red-700"}
                    >
                      [{i}] {d.id} {d.ok ? "✓" : `✗ ${d.reason ?? ""}`}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardContent className="p-6">
            <h2 className="font-semibold mb-2">Verification history</h2>
            {history.length === 0 ? (
              <div className="text-sm text-slate-500">
                No past verifications recorded.
              </div>
            ) : (
              <div className="overflow-auto">
                <table className="text-sm w-full">
                  <thead className="text-left text-xs text-slate-600 bg-slate-50">
                    <tr>
                      <th className="p-1">Started</th>
                      <th className="p-1">Table</th>
                      <th className="p-1">Chapter</th>
                      <th className="p-1">Verified</th>
                      <th className="p-1">Broken</th>
                      <th className="p-1">Duration ms</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.id} className="border-t">
                        <td className="p-1">{h.startedAt}</td>
                        <td className="p-1 font-mono">{h.tableName}</td>
                        <td className="p-1 font-mono">{h.chapterId ?? "-"}</td>
                        <td className="p-1">{h.verifiedCount}</td>
                        <td className="p-1">
                          {h.brokenCount > 0 ? (
                            <Badge variant="destructive">{h.brokenCount}</Badge>
                          ) : (
                            <span>0</span>
                          )}
                        </td>
                        <td className="p-1">{h.durationMs}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
