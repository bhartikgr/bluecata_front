/* W-CT (2026-07-14) — read-only cap-table snapshots panel.
 *
 * Renders two read-only surfaces on the founder cap-table page:
 *   1. PENDING / PROJECTED — positions for rounds still active/live, shown with
 *      a clear banner that the FINAL cap table is set at round close (these
 *      figures are illustrative until then).
 *   2. PREVIOUS — the last COMMITTED round snapshot (ASK ACT.1 Option A).
 *      Hidden entirely when no prior committed round exists.
 *
 * Consumes ONLY the additive read endpoint GET /api/companies/:id/captable/snapshots.
 * No writes, no engine mutation — the money core is untouched.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Info, Clock, ChevronDown, ChevronRight } from "lucide-react";

interface SnapshotPosition {
  id: string;
  holderName: string;
  instrument: string;
  shares: number;
  investmentAmount: number;
  roundId: string | null;
}
interface SnapshotsResponse {
  ok: boolean;
  pending: { hasPending: boolean; roundIds: string[]; positions: SnapshotPosition[] };
  previous: {
    hasPrevious: boolean; roundId: string | null; roundName: string | null;
    committedAt: string | null; positions: SnapshotPosition[];
  };
}

function fmtMoney(sym: string, n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  return `${sym}${Math.round(n).toLocaleString()}`;
}
function fmtShares(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  return Math.round(n).toLocaleString();
}

function PositionRows({ positions, sym }: { positions: SnapshotPosition[]; sym: string }) {
  if (positions.length === 0) {
    return <p className="text-xs text-muted-foreground px-1 py-2">No positions in this snapshot.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground border-b border-border">
            <th className="text-left font-medium px-2 py-1.5">Holder</th>
            <th className="text-left font-medium px-2 py-1.5">Instrument</th>
            <th className="text-right font-medium px-2 py-1.5">Shares</th>
            <th className="text-right font-medium px-2 py-1.5">Invested</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <tr key={p.id} className="border-b border-border/50" data-testid={`snapshot-row-${p.id}`}>
              <td className="px-2 py-1.5">{p.holderName}</td>
              <td className="px-2 py-1.5"><Badge variant="secondary" className="text-[10px]">{p.instrument}</Badge></td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums">{fmtShares(p.shares)}</td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums">{fmtMoney(sym, p.investmentAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function CapTableSnapshots({ companyId, sym = "$" }: { companyId: string; sym?: string }) {
  const [showPrevious, setShowPrevious] = useState(false);

  const q = useQuery<SnapshotsResponse>({
    queryKey: ["/api/companies", companyId, "captable", "snapshots"],
    queryFn: async () =>
      (await apiRequest("GET", `/api/companies/${encodeURIComponent(companyId)}/captable/snapshots`)).json(),
    enabled: Boolean(companyId),
    retry: false,
  });

  // Loading — keep quiet (skeleton-free) so it doesn't compete with the main table.
  if (q.isLoading) {
    return (
      <Card className="mb-4" data-testid="snapshots-loading">
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Loading projected &amp; previous cap tables…</p>
        </CardContent>
      </Card>
    );
  }
  // Error — non-fatal; offer retry, never block the main cap table.
  if (q.isError || (q.data && !q.data.ok)) {
    return (
      <Card className="mb-4" data-testid="snapshots-error">
        <CardContent className="p-4 flex items-center justify-between gap-3">
          <p className="text-xs text-rose-600">Couldn’t load projected / previous cap tables.</p>
          <Button variant="outline" size="sm" onClick={() => q.refetch()} data-testid="snapshots-retry">Retry</Button>
        </CardContent>
        {/* WAVE 60 · A-5 (OWNER RULING R51 — APPEND ONLY). R44 was applied to the
            sentence above and it did NOT meet the bar for a REPLACE: it is true
            when it renders, it names the thing that failed, and it already
            offers a working Retry. So it, its <p>, its <Button> and both
            data-testids are BYTE-IDENTICAL, and this is one appended sentence
            distinguishing a load failure from an empty list. Appended as the
            LAST child of <Card> (a second CardContent, not a third item spliced
            into the justify-between row above) so no existing container ordinal
            shifts — see the WAVE 55b 18-panel incident. Allowlist stays 43. */}
        <CardContent className="px-4 pb-4 pt-0" data-testid="snapshots-error-note">
          <p className="text-xs text-muted-foreground">Nothing has been changed — this is a loading failure, not an empty list.</p>
        </CardContent>
      </Card>
    );
  }

  const pending = q.data?.pending;
  const previous = q.data?.previous;
  const hasPending = Boolean(pending?.hasPending);
  const hasPrevious = Boolean(previous?.hasPrevious);

  // Nothing to add beyond the live table — render nothing (empty state is the
  // absence of both a pending round and a prior committed snapshot).
  if (!hasPending && !hasPrevious) {
    return null;
  }

  return (
    <div className="mb-4 space-y-4" data-testid="captable-snapshots">
      {/* PENDING / PROJECTED */}
      {hasPending && (
        <Card data-testid="snapshot-pending">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              Projected cap table
              <Badge variant="outline" className="text-[10px]">pending round</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-start gap-2 p-3 rounded-md bg-secondary/40 border border-border text-xs text-muted-foreground" data-testid="snapshot-pending-banner">
              <Info className="h-3.5 w-3.5 mt-0.5 text-[hsl(0_100%_40%)] shrink-0" />
              <span>
                These positions are <span className="font-medium text-foreground">projected and illustrative</span> while the
                round is open. The <span className="font-medium text-foreground">final cap table is set when the round closes</span> and
                the engine commits the reconciled positions to the immutable ledger.
              </span>
            </div>
            <PositionRows positions={pending!.positions} sym={sym} />
          </CardContent>
        </Card>
      )}

      {/* PREVIOUS — last committed snapshot (Option A). Hidden when none. */}
      {hasPrevious && (
        <Card data-testid="snapshot-previous">
          <CardHeader className="pb-2">
            <button
              type="button"
              className="flex items-center gap-2 text-left w-full"
              onClick={() => setShowPrevious((s) => !s)}
              data-testid="snapshot-previous-toggle"
            >
              {showPrevious ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <CardTitle className="text-sm flex items-center gap-2">
                Previous cap table
                {previous!.roundName && <Badge variant="secondary" className="text-[10px]">{previous!.roundName}</Badge>}
              </CardTitle>
              {previous!.committedAt && (
                <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Clock className="h-3 w-3" /> committed {previous!.committedAt.slice(0, 10)}
                </span>
              )}
            </button>
          </CardHeader>
          {showPrevious && (
            <CardContent className="space-y-3">
              <div className="text-xs text-muted-foreground">
                The last committed round snapshot from the immutable ledger — a read-only historical view.
              </div>
              <PositionRows positions={previous!.positions} sym={sym} />
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
