/* v25.39 — Admin Application-Fee editor (DB-driven, no in-memory).
 * /admin/application-fee — single-row config editor for the collective founder
 * application fee. Reads + writes ONLY via /api/admin/collective/application-fee
 * (DB-direct). The amount/currency shown here comes from the DB; nothing is
 * hardcoded. Look-and-feel mirrors PartnerFeeSchedules.tsx exactly (PageHeader/
 * PageBody/Card/Input/Label/Button + apiRequest/queryClient/useToast).
 *
 * WAVE 137 · DEFECT A — THE v25.39 round-2 BELIEF RECORDED BELOW IS FALSE AND IS
 * CORRECTED HERE. It said `collective_application_fee_config.amount_minor`
 * "stores the LITERAL displayed amount (2500 -> $2,500)" and that this editor
 * should therefore render it with `fmtUSD` (whole units, no division). The column
 * is TRUE MINOR UNITS on every other path in the tree:
 *   · PUT /api/admin/collective/application-fee validates its body as
 *     "amountMinor must be a non-negative integer (minor units)" and writes it
 *     unscaled (server/adminCollectiveFeeRoutes.ts);
 *   · the seed default is 30000 for a $300 fee
 *     (DEFAULT_APPLICATION_FEE_MINOR, server/lib/collectiveApplicationFeeResolver.ts:30,
 *     and the connection.ts bootstrap seeds 30000);
 *   · WAVE 131 removed the minor→major conversion from the platform-fees
 *     mirror-write for exactly this reason (server/adminPlatformFeesRoutes.ts).
 * So both renders on this page (the typed-value preview and the live read-back)
 * were showing 100× the real fee — $300 displayed as $30,000. They now go through
 * `formatMinorOrUnavailable`, which is ISO-4217-exponent aware and prints "—"
 * rather than "$0.00" for an absent value. NO arithmetic is applied to the
 * amount: the stored/typed/wire value is minor units end to end, exactly as it
 * was before this wave, and only the FORMATTER changed.
 *
 * COPY LEFT ALONE ON PURPOSE. The three visible strings below still say "Amount
 * (displayed to founders)", "e.g. 2500" and "...shown to founders exactly as
 * entered here (e.g. 2500 -> $2,500)" — wording that belongs to the false belief
 * corrected above. This wave rewrote them and the silent-drop guard BLOCKED the
 * build: those exact strings are frozen in the guard baseline, so replacing them
 * counts as a removal of primary functionality that needs an owner-approved
 * allowlist entry (scripts/silent-drop-guard/allowlist.json), which is outside a
 * two-defect display wave. The strings were therefore restored byte-for-byte and
 * the copy correction is logged as a residual item in
 * build_log/wave137/W137_BUILD.md. Nothing a founder sees is affected: this page
 * is deliberately UNROUTED (server/__tests__/wave7_r1_fee_page_disposition.test.ts
 * requires it to stay unrouted), and the founder-facing amount on
 * founder/ApplyToCollective.tsx IS fixed in this wave.
 */
import { useEffect, useState } from "react";
import { formatMinorOrUnavailable } from "@/lib/moneyDisplay";
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
  // DIRECTLY (no /100) — WAVE 137 keeps this unchanged. The typed value, this
  // pre-filled default and the PUT wire value are all ONE unit (minor units),
  // and the founder page reads the same column, so nothing here is rescaled.
  // Only the two rendered previews were wrong, and only they were changed.
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
      // integer minor-unit amount the founder page displays. Validate
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
                        `1.5`/`1e3`/"abc" show "—" instead of misleading $1.
                        WAVE 137: the typed value IS minor units (it is PUT
                        unscaled), so the preview must format it as minor units
                        — `fmtUSD` here quoted founders 100× the real fee. */}
                    Founders see: <span className="font-medium" data-testid="text-fee-preview">{(() => {
                      const p = parseWholeAmount(amountMajor);
                      return p === null ? "—" : formatMinorOrUnavailable(p, currency || "USD");
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
                    {data ? formatMinorOrUnavailable(data.amountMinor, data.currency) : "—"}
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
