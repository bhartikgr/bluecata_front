/**
 * W-CAP (2026-07-17) — Interim (pro-forma) cap-table view.
 *
 * Read-only projection of committed + funded-queue + confirmed soft-circle
 * positions, color-coded and badged, NEVER blended into committed ownership.
 * Additive: this component is mounted alongside (not instead of) the existing
 * committed cap-table view. Founder surface gets Commit CTAs; investor surface
 * is strictly read-only (`readOnly`).
 *
 * Backend: GET /api/companies/:id/captable/interim (three typed arrays +
 * per-kind subtotals). Commit CTAs wire to the EXISTING commit-funded /
 * commit-funded-batch / soft-circle wire-funded endpoints — no new commit
 * logic is introduced here and the sacred money ledger is untouched.
 */
import { useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Info } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { fmtNum } from "@/lib/format";

type InterimKind = "committed" | "funded" | "soft_circle";
type InterimRow = {
  investorId: string;
  holderName: string;
  roundId: string;
  amount: number;
  currency: string;
  shares: number;
  kind: InterimKind;
  invitationId?: string | null;
  softCircleId?: string | null;
  status?: string | null;
};
type Subtotal = { count: number; amount: number; shares: number };
type InterimResp = {
  companyId: string;
  committed: InterimRow[];
  funded: InterimRow[];
  soft_circle: InterimRow[];
  subtotals: { committed: Subtotal; funded: Subtotal; soft_circle: Subtotal };
};

const KIND_META: Record<InterimKind, { label: string; badgeClass: string; dot: string }> = {
  // WCAG: badges carry text labels; colour is not the sole signal.
  committed: { label: "Committed", badgeClass: "bg-emerald-100 text-emerald-900 border-emerald-300", dot: "bg-emerald-500" },
  funded: { label: "Funded (not committed)", badgeClass: "bg-amber-100 text-amber-900 border-amber-300", dot: "bg-amber-500" },
  soft_circle: { label: "Soft-circle (confirmed)", badgeClass: "bg-sky-100 text-sky-900 border-sky-300", dot: "bg-sky-500" },
};

function fmtMoney(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD", maximumFractionDigits: 0 }).format(n || 0);
  } catch {
    return `${currency || "USD"} ${Math.round(n || 0).toLocaleString()}`;
  }
}

export function CapTableInterim({ companyId, readOnly = false }: { companyId: string; readOnly?: boolean }) {
  const { toast } = useToast();
  const interimQ = useQuery<InterimResp>({
    queryKey: ["/api/companies", companyId, "captable", "interim"],
    queryFn: async () => (await apiRequest("GET", `/api/companies/${encodeURIComponent(companyId)}/captable/interim`)).json(),
    enabled: Boolean(companyId),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "captable", "interim"] });
    queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "securities"] });
  };

  const commitOne = useMutation({
    mutationFn: async (r: InterimRow) =>
      (await apiRequest("POST", "/api/founder/captable/commit-funded", {
        invitationId: r.invitationId,
        roundId: r.roundId,
        companyId,
        investorId: r.investorId,
        amount: String(r.amount),
        currency: r.currency,
        shares: String(r.shares),
        fromState: "funded",
      })).json(),
    onSuccess: () => { toast({ title: "Position committed", description: "The funded position is now on the committed cap table." }); invalidate(); },
    onError: (e: Error) => toast({ title: "Commit failed", description: e.message, variant: "destructive" }),
  });

  const commitAll = useMutation({
    mutationFn: async (roundIds: string[]) => {
      const results = [];
      for (const roundId of roundIds) {
        results.push(await (await apiRequest("POST", "/api/founder/captable/commit-funded-batch", { companyId, roundId })).json());
      }
      return results;
    },
    onSuccess: () => { toast({ title: "Funded positions committed", description: "All funded positions were committed." }); invalidate(); },
    onError: (e: Error) => toast({ title: "Batch commit failed", description: e.message, variant: "destructive" }),
  });

  const wireFund = useMutation({
    mutationFn: async (r: InterimRow) =>
      (await apiRequest("POST", `/api/founder/rounds/${encodeURIComponent(r.roundId)}/soft-circle/${encodeURIComponent(r.softCircleId ?? "")}/wire-funded`, {})).json(),
    onSuccess: () => { toast({ title: "Marked wire-funded", description: "The soft-circle is now in the funded queue." }); invalidate(); },
    onError: (e: Error) => toast({ title: "Wire-fund failed", description: e.message, variant: "destructive" }),
  });

  const data = interimQ.data;
  const fundedRoundIds = useMemo(
    () => Array.from(new Set((data?.funded ?? []).map((r) => r.roundId).filter(Boolean))),
    [data?.funded],
  );

  if (interimQ.isLoading) {
    return <div className="text-sm text-muted-foreground py-12 text-center" data-testid="interim-loading">Loading interim view…</div>;
  }

  return (
    <div className="space-y-4" data-testid="captable-interim">
      {/* Pro-forma banner */}
      <div className="flex items-start gap-2 p-3 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-900" data-testid="interim-banner">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          <span className="font-semibold">Interim / pro-forma view — NOT the final fully-diluted cap table.</span>{" "}
          Funded and soft-circle positions are not yet issued. Committed ownership % is unaffected by anything shown below.
        </span>
      </div>

      <InterimSection
        kind="committed"
        rows={data?.committed ?? []}
        subtotal={data?.subtotals.committed}
      />
      <InterimSection
        kind="funded"
        rows={data?.funded ?? []}
        subtotal={data?.subtotals.funded}
        action={
          !readOnly && (data?.funded?.length ?? 0) > 0 ? (
            <Button
              size="sm"
              variant="outline"
              disabled={commitAll.isPending || fundedRoundIds.length === 0}
              onClick={() => commitAll.mutate(fundedRoundIds)}
              data-testid="button-commit-all-funded"
            >
              {commitAll.isPending ? "Committing…" : "Commit all funded"}
            </Button>
          ) : null
        }
        rowAction={
          !readOnly
            ? (r: InterimRow) => (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px]"
                  disabled={commitOne.isPending}
                  onClick={() => commitOne.mutate(r)}
                  data-testid={`button-commit-now-${r.invitationId ?? r.investorId}`}
                >
                  Commit now
                </Button>
              )
            : undefined
        }
      />
      <InterimSection
        kind="soft_circle"
        rows={data?.soft_circle ?? []}
        subtotal={data?.subtotals.soft_circle}
        rowAction={
          !readOnly
            ? (r: InterimRow) => (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px]"
                  disabled={wireFund.isPending || r.status !== "confirmed"}
                  onClick={() => wireFund.mutate(r)}
                  data-testid={`button-wire-funded-${r.softCircleId ?? r.investorId}`}
                >
                  Mark wire-funded
                </Button>
              )
            : undefined
        }
      />
    </div>
  );
}

function InterimSection({
  kind,
  rows,
  subtotal,
  action,
  rowAction,
}: {
  kind: InterimKind;
  rows: InterimRow[];
  subtotal?: Subtotal;
  action?: React.ReactNode;
  rowAction?: (r: InterimRow) => React.ReactNode;
}) {
  const meta = KIND_META[kind];
  return (
    <Card data-testid={`interim-section-${kind}`}>
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${meta.dot}`} aria-hidden />
          <CardTitle className="text-base">{meta.label}</CardTitle>
          <Badge variant="outline" className={`text-[10px] ${meta.badgeClass}`}>{meta.label}</Badge>
        </div>
        {action}
      </CardHeader>
      <CardContent className="px-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs" data-testid={`interim-table-${kind}`}>
            <thead>
              <tr className="text-[10px] uppercase text-muted-foreground border-b border-border">
                <th className="text-left font-medium px-4 py-2">Holder</th>
                <th className="text-left font-medium px-2 py-2">Round</th>
                <th className="text-right font-medium px-2 py-2">Amount</th>
                <th className="text-right font-medium px-2 py-2">Shares</th>
                <th className="text-left font-medium px-2 py-2">Status</th>
                {rowAction && <th className="text-right font-medium px-4 py-2">Action</th>}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={rowAction ? 6 : 5} className="px-4 py-6 text-center text-muted-foreground">No {meta.label.toLowerCase()} positions.</td></tr>
              ) : (
                rows.map((r, i) => (
                  <tr key={`${kind}-${r.invitationId ?? r.softCircleId ?? r.investorId}-${i}`} className="border-b border-border/60 hover:bg-secondary/40" data-testid={`interim-row-${kind}-${i}`}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium flex items-center gap-1.5">
                        <span className={`h-2 w-2 rounded-full ${meta.dot}`} aria-hidden />
                        {r.holderName}
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-muted-foreground truncate max-w-[140px]">{r.roundId || "—"}</td>
                    <td className="px-2 py-2.5 text-right font-mono tabular-nums">{fmtMoney(r.amount, r.currency)}</td>
                    <td className="px-2 py-2.5 text-right font-mono tabular-nums">{r.shares ? fmtNum(r.shares) : "—"}</td>
                    <td className="px-2 py-2.5">
                      <Badge variant="outline" className={`text-[10px] ${meta.badgeClass}`}>{meta.label}</Badge>
                    </td>
                    {rowAction && <td className="px-4 py-2.5 text-right">{rowAction(r)}</td>}
                  </tr>
                ))
              )}
              {subtotal && (
                <tr className="font-semibold bg-secondary/50">
                  <td className="px-4 py-2.5" colSpan={2}>Subtotal · {subtotal.count} position{subtotal.count === 1 ? "" : "s"}</td>
                  <td className="px-2 py-2.5 text-right font-mono tabular-nums">{fmtMoney(subtotal.amount, rows[0]?.currency ?? "USD")}</td>
                  <td className="px-2 py-2.5 text-right font-mono tabular-nums">{subtotal.shares ? fmtNum(subtotal.shares) : "—"}</td>
                  <td colSpan={rowAction ? 2 : 1} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export default CapTableInterim;
