/* v25.39 — Admin Application-Fee editor (DB-driven, no in-memory).
 * /admin/application-fee — single-row config editor for the collective founder
 * application fee. Reads + writes ONLY via /api/admin/collective/application-fee
 * (DB-direct). The amount/currency shown here comes from the DB; nothing is
 * hardcoded. Look-and-feel mirrors PartnerFeeSchedules.tsx exactly (PageHeader/
 * PageBody/Card/Input/Label/Button + apiRequest/queryClient/useToast).
 *
 * v25.39 round-2 (per GPT-5.5 concern #4): the founder-facing display uses
 * `fmtUSD(amountMinor)` (no /100) — i.e., the DB column historically named
 * `amount_minor` actually stores the LITERAL displayed amount (2500 -> $2,500),
 * matching the v25.37 hardcoded literal that this resolver replaced. To stay
 * consistent with the founder page and the v25.38 resolver's documented
 * "displayed value is identical to v25.37" contract, this admin UI now
 * displays and edits the same literal value the founder page renders (no
 * /100 or *100 conversion). The column name is preserved for API-shape
 * consistency but is treated as an opaque integer here.
 */
import { useEffect, useState } from "react";
import { fmtUSD } from "@/lib/format";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DollarSign } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ApplicationFeeConfig {
  ok: boolean;
  amountMinor: number;
  currency: string;
  updatedAt: string | null;
  updatedBy: string | null;
  source: "db" | "default";
}

export default function AdminApplicationFee() {
  const { toast } = useToast();
  const [amountMajor, setAmountMajor] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [dirty, setDirty] = useState(false);

  const { data, isLoading } = useQuery<ApplicationFeeConfig>({
    queryKey: ["/api/admin/collective/application-fee"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/collective/application-fee")).json(),
    retry: false,
  });

  // v25.39 round-2 (per GPT-5.5 concern #4): seed the editor with the DB value
  // DIRECTLY (no /100). The founder page renders this integer via
  // `fmtUSD(amountMinor)` which produces e.g. `$2,500` for the value 2500. To
  // prevent the admin/founder unit mismatch, the editor stores the literal
  // integer too.
  useEffect(() => {
    if (data && !dirty) {
      setAmountMajor(String(data.amountMinor));
      setCurrency(data.currency || "USD");
    }
  }, [data, dirty]);

  // v25.39 round-3 (per GPT-5.5 concern A) + round-4 (post-trim feedback):
  // strict whole-number validator. The regex is applied to the input STRING
  // AS-TYPED (no trim) so any whitespace, sign, decimal, or exponent input
  // (`1.5`, `1e3`, ` 5 `, `-5`, `abc`, `05`) is rejected. `parseInt` would
  // have silently truncated; this returns null instead.
  function parseWholeAmount(s: string): number | null {
    const raw = s ?? "";
    if (!/^(0|[1-9]\d*)$/.test(raw)) return null;
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n < 0) return null;
    return n;
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      // v25.39 round-2 (per GPT-5.5 concern #4) + round-3 (concern A): save the
      // literal integer the founder page will display via `fmtUSD`. Validate
      // via the strict whole-number regex so invalid input (1.5, 1e3, "abc")
      // is rejected client-side before reaching the server.
      const parsed = parseWholeAmount(amountMajor);
      if (parsed === null) {
        throw new Error("Amount must be a non-negative whole number (e.g. 2500).");
      }
      const amountMinor = parsed;
      const r = await apiRequest("PUT", "/api/admin/collective/application-fee", {
        amountMinor,
        currency: currency || "USD",
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "update_failed");
      return j;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/collective/application-fee"] });
      // Keep the public founder-facing query honest too.
      queryClient.invalidateQueries({ queryKey: ["/api/collective/application-fee"] });
      setDirty(false);
      toast({ title: "Application fee updated" });
    },
    onError: (e: any) => toast({ title: "Update failed", description: e?.message, variant: "destructive" }),
  });

  return (
    <>
      <PageHeader title="Collective Application Fee" description="Admin-configurable founder application fee for the Collective. The amount is DB-driven and shown to founders exactly as entered here (e.g. 2500 -> $2,500). Whole-number values only." />
      <PageBody>
        <Card>
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><DollarSign className="h-4 w-4" /> Application fee</CardTitle></CardHeader>
          <CardContent className="grid md:grid-cols-3 gap-4">
            {isLoading ? (
              <p className="md:col-span-3 text-sm text-muted-foreground" data-testid="text-fee-loading">Loading application fee…</p>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">Amount (displayed to founders)</Label>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={amountMajor}
                    onChange={(e) => { setAmountMajor(e.target.value); setDirty(true); }}
                    placeholder="e.g. 2500"
                    data-testid="input-application-fee-amount"
                  />
                  <div className="text-[10px] text-muted-foreground">
                    {/* v25.39 round-3 (per GPT-5.5 concern A): preview uses
                        the SAME strict whole-number validation as save, so
                        `1.5`/`1e3`/"abc" show "—" instead of misleading $1. */}
                    Founders see: <span className="font-medium" data-testid="text-fee-preview">{(() => {
                      const p = parseWholeAmount(amountMajor);
                      return p === null ? "—" : fmtUSD(p);
                    })()}</span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Currency</Label>
                  <Input
                    value={currency}
                    onChange={(e) => { setCurrency(e.target.value.toUpperCase()); setDirty(true); }}
                    data-testid="input-application-fee-currency"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Current (live)</Label>
                  <div className="h-9 flex items-center text-sm font-medium" data-testid="text-current-fee">
                    {data ? fmtUSD(data.amountMinor) : "—"}
                  </div>
                </div>
                <div className="md:col-span-3 flex items-center gap-3">
                  <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !dirty} data-testid="button-save-application-fee">Save</Button>
                  {dirty && <span className="text-xs text-amber-700" data-testid="text-fee-modified">Modified — not yet saved</span>}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {data && (
          <Card className="mt-4">
            <CardHeader><CardTitle className="text-base">Audit trail</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-1">
              <div data-testid="text-fee-source">Source: <span className="font-medium">{data.source}</span></div>
              <div data-testid="text-fee-updated-at">Last updated: <span className="font-medium">{data.updatedAt ? new Date(data.updatedAt + "Z").toLocaleString() : "—"}</span></div>
              <div data-testid="text-fee-updated-by">Updated by: <span className="font-medium">{data.updatedBy || "—"}</span></div>
            </CardContent>
          </Card>
        )}
      </PageBody>
    </>
  );
}
