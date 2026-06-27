/* v25.39 — Admin Partner Commission-Rate editor (DB-driven, no in-memory).
 * /admin/commission-rates — 5-row table editor for partner-tier commission
 * rates. Reads + writes ONLY via /api/admin/partner/commission-rates (DB-direct).
 * Every rate shown comes from the DB (or, when no DB row exists yet, the
 * literal-mirror fallback reported by the resolver with source="default").
 * Nothing is hardcoded. Look-and-feel mirrors PartnerFeeSchedules.tsx exactly.
 *
 * Display contract: rates are stored as fractions (0.025) and shown/edited as
 * percentages (2.5%). Save is per-row; a "modified" indicator shows until save.
 */
import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface CommissionRateRow {
  tier: string;
  rate: number;
  updatedAt: string | null;
  updatedBy: string | null;
  source: "db" | "default";
}
interface CommissionRatesResponse {
  ok: boolean;
  rates: CommissionRateRow[];
}

// Display the rate as a percentage string with up to 2 decimals (no trailing
// zeros): 0.025 -> "2.5", 0.02 -> "2".
function ratePct(rate: number): string {
  return String(Number((rate * 100).toFixed(4)));
}

/* v25.40 FIX-9 (admin P2 #2): client-side numeric validation for the commission
 * rate editor (display percent). Mirrors the AdminApplicationFee round-3
 * normalization. Rejects non-numeric / NaN / Infinity / negative / >100 input
 * and round-trips precision via toFixed(4) so the persisted value matches what
 * the resolver expects. Returns the normalized DISPLAY-PERCENT number on success
 * or throws with a stable error code on invalid input. */
function parseRatePct(raw: string): number {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") throw new Error("rate_required");
  const pct = Number(trimmed);
  if (!Number.isFinite(pct)) throw new Error("rate_not_numeric");
  if (pct < 0) throw new Error("rate_negative");
  if (pct > 100) throw new Error("rate_out_of_range");
  // Round-trip precision: normalize to 4 decimals then back to a number so we
  // never persist floating-point noise (e.g. 2.50000001).
  return parseFloat(pct.toFixed(4));
}

export default function AdminCommissionRates() {
  const { toast } = useToast();
  // Per-tier draft of the percentage input.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery<CommissionRatesResponse>({
    queryKey: ["/api/admin/partner/commission-rates"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/partner/commission-rates")).json(),
    retry: false,
  });

  const rows = data?.rates ?? [];

  // Seed drafts from the server rates once loaded (only for tiers not yet edited).
  useEffect(() => {
    if (!rows.length) return;
    setDrafts((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        if (next[r.tier] === undefined) next[r.tier] = ratePct(r.rate);
      }
      return next;
    });
  }, [rows]);

  const saveMut = useMutation({
    mutationFn: async (tier: string) => {
      // v25.40 FIX-9: validate + normalize before computing the stored fraction.
      const pct = parseRatePct(drafts[tier] ?? "");
      const rate = parseFloat((pct / 100).toFixed(6));
      const r = await apiRequest("PUT", `/api/admin/partner/commission-rates/${tier}`, { rate });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "update_failed");
      return j;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partner/commission-rates"] });
      toast({ title: "Commission rate updated" });
    },
    onError: (e: any) => toast({ title: "Update failed", description: e?.message, variant: "destructive" }),
  });

  function isModified(r: CommissionRateRow): boolean {
    const draft = drafts[r.tier];
    return draft !== undefined && draft.trim() !== ratePct(r.rate);
  }

  return (
    <>
      <PageHeader title="Partner Commission Rates" description="Admin-configurable consortium-partner commission rates per tier. Rates are DB-driven; Avi's literal table remains the ultimate fallback. Enter each rate as a percentage (e.g. 2.5 = 2.5%); it is stored as the fraction 0.025." />
      <PageBody>
        <Card>
          <CardHeader><CardTitle className="text-base">Commission rates ({rows.length})</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground" data-testid="text-rates-loading">Loading commission rates…</p>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="empty-commission-rates">No commission rates available.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tier</TableHead><TableHead>Rate (%)</TableHead><TableHead>Source</TableHead>
                    <TableHead>Updated</TableHead><TableHead>By</TableHead><TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.tier} data-testid={`row-rate-${r.tier}`}>
                      <TableCell className="font-medium">{r.tier}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          className="w-28"
                          value={drafts[r.tier] ?? ""}
                          onChange={(e) => setDrafts((d) => ({ ...d, [r.tier]: e.target.value }))}
                          data-testid={`input-rate-${r.tier}`}
                        />
                      </TableCell>
                      <TableCell>
                        {r.source === "db"
                          ? <Badge variant="secondary">db</Badge>
                          : <span className="text-muted-foreground">default</span>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.updatedAt ? new Date(r.updatedAt + "Z").toLocaleDateString() : "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.updatedBy || "—"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => saveMut.mutate(r.tier)}
                            disabled={saveMut.isPending || !isModified(r)}
                            data-testid={`button-save-rate-${r.tier}`}
                          >
                            Save
                          </Button>
                          {isModified(r) && <span className="text-xs text-amber-700" data-testid={`text-modified-${r.tier}`}>modified</span>}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
