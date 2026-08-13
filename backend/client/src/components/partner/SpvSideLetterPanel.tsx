/**
 * WAVE 32 · CP-SPV-30 · CAPABILITY 4 — the GP-facing side-letter surface.
 *
 * Backed by:
 *   GET    /api/partner/me/spv/:spvId/side-letters
 *   POST   /api/partner/me/spv/:spvId/side-letters
 *   DELETE /api/partner/me/spv/:spvId/side-letters/:id
 *
 * AN ENGINE WITH NO ROUTE, OR A COMPONENT MOUNTED NOWHERE, IS NOT SHIPPED.
 * Capability 2 shipped the economics; this panel is what makes per-LP terms
 * something a GP can actually create, see and revoke in the product. It is
 * mounted in `SpvDetailTabs.tsx` as the Side letters tab.
 *
 * RATES ARE FRACTIONS, ENTERED AS PERCENTS, CONVERTED ONCE, HERE. The wire
 * carries integer BILLIONTHS (20% -> 200_000_000). The conversion happens at
 * this single boundary and is stated on screen next to the field, so a GP can
 * see exactly what will be stored. The `n > 1 ? n/100 : n` guess is FORBIDDEN
 * anywhere in this path: it cannot tell 1% from 100%.
 *
 * INHERIT IS NOT ZERO. Leaving a rate blank means "this LP follows the fund
 * default"; typing 0 means "this LP pays no carry". Those are different facts
 * and the form keeps them distinct — a blank sends null, never 0.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatMinorOrUnavailable } from "@/lib/moneyDisplay";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const SCALE = 1_000_000_000;

interface SideLetter {
  id: string;
  investorId: string;
  carryFractionScaled: number | null;
  mgmtFeeFractionScaled: number | null;
  hurdleFractionScaled: number | null;
  minCheckMinor: number | null;
  currency: string;
  coInvestorVisibility: "inherit" | "own_only" | "co_investors";
  mfnClause: boolean;
  notes: string | null;
  documentRef: string | null;
  effectiveDate: string;
  status: "active" | "superseded" | "revoked";
  createdBy: string;
  createdAt: string;
}

/**
 * A percent string typed by a human -> integer billionths, or a refusal.
 *
 * Returns `undefined` for "blank" (inherit), a number for a real rate, and
 * `null` for input that cannot be read as a rate — the caller refuses on null
 * rather than guessing. Rounding is applied to the SCALED integer, so 12.345%
 * survives exactly rather than drifting through a float fraction.
 */
export function percentInputToScaled(raw: string): number | null | undefined {
  const t = raw.trim();
  if (t === "") return undefined;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * (SCALE / 100));
}

/** Integer billionths -> a percent label. The ONLY place ×100 happens. */
function scaledToPercentLabel(scaled: number | null): string {
  if (scaled === null) return "Fund default";
  return `${((scaled / SCALE) * 100).toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

export function SpvSideLetterPanel({ spvId, canWrite }: { spvId: string; canWrite: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [investorId, setInvestorId] = useState("");
  const [carryPct, setCarryPct] = useState("");
  const [mgmtPct, setMgmtPct] = useState("");
  const [hurdlePct, setHurdlePct] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const listQ = useQuery<{ sideLetters: SideLetter[] }>({
    queryKey: ["/api/partner/me/spv", spvId, "side-letters"],
    queryFn: () => apiRequest("GET", `/api/partner/me/spv/${spvId}/side-letters`).then((r) => r.json()),
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ["/api/partner/me/spv", spvId, "side-letters"] });
    // A letter changes future distributions, so the distribution view is stale.
    qc.invalidateQueries({ queryKey: ["/api/partner/me/spv", spvId, "distributions"] });
  }

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiRequest("POST", `/api/partner/me/spv/${spvId}/side-letters`, body).then((r) => r.json()),
    onSuccess: () => {
      toast({
        title: "Side letter recorded",
        description: "It supersedes any prior active letter for this partner and applies to distributions recorded from now on.",
      });
      setInvestorId(""); setCarryPct(""); setMgmtPct(""); setHurdlePct(""); setEffectiveDate(""); setNotes("");
      setFormError(null);
      refresh();
    },
    onError: (e: any) => toast({ title: "Could not record side letter", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const revoke = useMutation({
    mutationFn: (id: string) =>
      apiRequest("DELETE", `/api/partner/me/spv/${spvId}/side-letters/${id}`).then((r) => r.json()),
    onSuccess: () => {
      toast({ title: "Side letter revoked", description: "This partner reverts to the fund's default terms." });
      refresh();
    },
    onError: (e: any) => toast({ title: "Could not revoke", description: String(e?.message ?? e), variant: "destructive" }),
  });

  function submit() {
    const carry = percentInputToScaled(carryPct);
    const mgmt = percentInputToScaled(mgmtPct);
    const hurdle = percentInputToScaled(hurdlePct);
    if (carry === null || mgmt === null || hurdle === null) {
      setFormError("Rates must be a percentage between 0 and 100. The entry is refused rather than interpreted — a rate that cannot be read is not guessed at.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
      setFormError("An effective date (YYYY-MM-DD) is required. A letter with no date cannot be placed in a distribution's timeline.");
      return;
    }
    if (!investorId.trim()) {
      setFormError("A partner on this vehicle's committed register is required.");
      return;
    }
    setFormError(null);
    create.mutate({
      investorId: investorId.trim(),
      // undefined -> the key is omitted -> the server stores NULL = inherit.
      carryFractionScaled: carry,
      mgmtFeeFractionScaled: mgmt,
      hurdleFractionScaled: hurdle,
      effectiveDate,
      notes: notes.trim() || null,
    });
  }

  const letters = listQ.data?.sideLetters ?? [];

  return (
    <div data-testid="spv-side-letter-panel">
      <div className="text-xs mb-3 leading-relaxed text-[var(--cv-color-text-muted)]" data-testid="spv-side-letter-policy">
        A side letter records terms negotiated with one partner that override the fund's defaults. A blank rate means the
        partner follows the fund default; entering 0% means the partner pays nothing — these are different terms and are
        stored differently. A rate above the vehicle's carry cap is refused, not trimmed to fit. Recording a letter
        supersedes that partner's prior active letter, and the superseded letter is kept for the record.
      </div>

      {canWrite && (
        <div className="rounded-md p-3 mb-4" style={{ border: "1px solid rgba(4,30,65,0.18)" }} data-testid="spv-side-letter-form">
          <div className="font-medium text-sm mb-2">Record a side letter</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <div>
              <Label htmlFor="sl-investor" className="text-xs">Partner (investor id)</Label>
              <Input id="sl-investor" data-testid="spv-side-letter-investor" value={investorId} onChange={(e) => setInvestorId(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="sl-carry" className="text-xs">Carried interest %</Label>
              <Input id="sl-carry" data-testid="spv-side-letter-carry" value={carryPct} onChange={(e) => setCarryPct(e.target.value)} placeholder="blank = fund default" />
            </div>
            <div>
              <Label htmlFor="sl-mgmt" className="text-xs">Management fee %</Label>
              <Input id="sl-mgmt" data-testid="spv-side-letter-mgmt" value={mgmtPct} onChange={(e) => setMgmtPct(e.target.value)} placeholder="blank = fund default" />
            </div>
            <div>
              <Label htmlFor="sl-hurdle" className="text-xs">Hurdle %</Label>
              <Input id="sl-hurdle" data-testid="spv-side-letter-hurdle" value={hurdlePct} onChange={(e) => setHurdlePct(e.target.value)} placeholder="blank = fund default" />
            </div>
            <div>
              <Label htmlFor="sl-date" className="text-xs">Effective date</Label>
              <Input id="sl-date" data-testid="spv-side-letter-date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} placeholder="YYYY-MM-DD" />
            </div>
            <div>
              <Label htmlFor="sl-notes" className="text-xs">Notes</Label>
              <Input id="sl-notes" data-testid="spv-side-letter-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <div className="text-[11px] mt-2 text-[var(--cv-color-text-muted)]">
            Rates are stored as exact integer billionths of a fraction — 20% is stored as 200,000,000, not as 0.2 — so a
            rate never drifts through a floating-point round trip.
          </div>
          {formError && (
            <div className="text-xs mt-2 leading-relaxed" style={{ color: "#9b1c1c" }} data-testid="spv-side-letter-form-error">
              {formError}
            </div>
          )}
          <div className="mt-2">
            <Button size="sm" data-testid="spv-side-letter-submit" disabled={create.isPending} onClick={submit}>
              {create.isPending ? "Recording…" : "Record side letter"}
            </Button>
          </div>
        </div>
      )}

      <div className="font-medium text-sm mb-1">Side letters on this vehicle</div>
      {listQ.isLoading ? (
        <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="spv-side-letter-loading">Loading…</div>
      ) : listQ.isError ? (
        <div className="text-sm" data-testid="spv-side-letter-error">
          Side letters are unavailable because the service could not be reached. Nothing is listed rather than an
          incomplete list that could be read as "this partner has no letter".
        </div>
      ) : letters.length === 0 ? (
        <div className="text-sm" data-testid="spv-side-letter-empty">
          No side letters have been recorded. Every partner on this vehicle is on the fund's default terms.
        </div>
      ) : (
        <div>
          {letters.map((l) => (
            <div
              key={l.id}
              className="rounded-md p-2 mb-2 text-sm"
              style={{ border: "1px solid rgba(4,30,65,0.14)" }}
              data-testid="spv-side-letter-row"
            >
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="font-medium" data-testid="spv-side-letter-row-investor">{l.investorId}</span>
                <span
                  className="inline-block rounded px-1.5 py-0.5 text-[11px] font-medium"
                  style={
                    l.status === "active"
                      ? { background: "rgba(16,122,87,0.12)", color: "#0b6b4f" }
                      : { background: "rgba(120,120,120,0.14)", color: "#4a4a4a" }
                  }
                  data-testid={`spv-side-letter-status-${l.status}`}
                >
                  {l.status === "active" ? "Active" : l.status === "revoked" ? "Revoked" : "Superseded"}
                </span>
                <span className="text-xs text-[var(--cv-color-text-muted)]">effective {l.effectiveDate}</span>
              </div>
              <div className="text-xs mt-1 text-[var(--cv-color-text-muted)]" data-testid="spv-side-letter-row-terms">
                Carry {scaledToPercentLabel(l.carryFractionScaled)} · Management fee{" "}
                {scaledToPercentLabel(l.mgmtFeeFractionScaled)} · Hurdle {scaledToPercentLabel(l.hurdleFractionScaled)}
                {l.minCheckMinor !== null && ` · Minimum check ${formatMinorOrUnavailable(l.minCheckMinor, l.currency)}`}
                {l.mfnClause && " · Most-favoured-nation"}
              </div>
              {l.notes && <div className="text-xs mt-1" data-testid="spv-side-letter-row-notes">{l.notes}</div>}
              {canWrite && l.status === "active" && (
                <div className="mt-1">
                  <Button size="sm" variant="outline" data-testid="spv-side-letter-revoke" onClick={() => revoke.mutate(l.id)}>
                    Revoke
                  </Button>
                  <span className="text-[11px] ml-2 text-[var(--cv-color-text-muted)]">
                    Revoking returns this partner to the fund's default terms for future distributions. Distributions
                    already recorded are unchanged.
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
