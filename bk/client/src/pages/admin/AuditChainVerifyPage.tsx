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
  if (!r.ok) throw new Error(`http_${r.status}`);
  return (await r.json()) as T;
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
                            <Badge variant="default">ok</Badge>
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
