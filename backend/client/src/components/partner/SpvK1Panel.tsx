/**
 * WAVE 32 · CP-SPV-30 · CAPABILITY 3 — the GP-facing K-1 surface.
 *
 * Backed by:
 *   GET  /api/partner/me/spv/:spvId/k1?taxYear=YYYY   live derivation
 *   GET  /api/partner/me/spv/:spvId/k1/stored         persisted statements
 *   POST /api/partner/me/spv/:spvId/k1/generate       write drafts
 *   POST /api/partner/me/spv/:spvId/k1/:k1Id/issue    issue a draft to an LP
 *
 * AN ENGINE WITH NO ROUTE, OR A COMPONENT MOUNTED NOWHERE, IS NOT SHIPPED.
 * This panel is mounted in `SpvDetailTabs.tsx` as the K-1 tab.
 *
 * THE RENDERING RULE, WHICH IS STRICTER HERE THAN ANYWHERE ELSE. This screen
 * shows figures that will be filed with a tax authority. A box the server could
 * not derive renders as "Not derivable" WITH THE SERVER'S OWN SENTENCE
 * explaining why — never `$0.00`, never a bare dash. A zero on a K-1 is a
 * factual assertion ("this partner contributed nothing"); absence of data is
 * not that assertion, and printing one for the other in front of a fund
 * administrator is the failure mode this whole capability exists to prevent.
 *
 * MONEY VIA `formatMinorOrUnavailable`, never `minor / 100` — dividing by 100
 * misstates JPY (ISO-4217 exponent 0) by a factor of a hundred.
 *
 * OWNERSHIP IS A FRACTION on the wire (0.25 = 25%) and is multiplied by 100
 * HERE, at the render boundary, and nowhere else.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatMinorOrUnavailable } from "@/lib/moneyDisplay";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/* ── wire types (mirror server/lib/spvK1.ts) ──────────────────────────────── */

interface K1Refusal {
  field: string;
  code: string;
  copy: string;
}

interface K1Statement {
  id?: string;
  investorId: string;
  taxYear: number;
  currency: string;
  beginningCapitalMinor: number | null;
  contributionsMinor: number | null;
  distributionsMinor: number | null;
  allocatedIncomeMinor: number | null;
  carryAllocatedMinor: number | null;
  endingCapitalMinor: number | null;
  ownershipFraction: number | null;
  refusals: K1Refusal[];
  sourceIds: string[];
  status?: "draft" | "issued" | "superseded";
  generatedAt?: string;
  issuedAt?: string | null;
}

/* ── a single box: a real figure, or a refusal with its reason ────────────── */

function Box({
  label,
  minor,
  currency,
  refusal,
  testid,
}: {
  label: string;
  minor: number | null;
  currency: string;
  refusal: K1Refusal | undefined;
  testid: string;
}) {
  return (
    <div className="rounded-md p-2" style={{ border: "1px solid rgba(4,30,65,0.14)" }} data-testid={testid}>
      <div className="text-[11px] uppercase tracking-wide text-[var(--cv-color-text-muted)]">{label}</div>
      {minor === null ? (
        <>
          <div className="text-sm font-medium" style={{ color: "#8a5a06" }} data-testid={`${testid}-refused`}>
            Not derivable
          </div>
          {/* The server's sentence, printed verbatim. One sentence, one source:
              the UI never invents tax language of its own. */}
          <div className="text-[11px] mt-1 leading-relaxed" style={{ color: "#8a5a06" }}>
            {refusal?.copy ?? "This figure could not be derived from recorded data, so it is left blank."}
          </div>
        </>
      ) : (
        <div className="text-sm font-semibold" data-testid={`${testid}-value`}>
          {formatMinorOrUnavailable(minor, currency)}
        </div>
      )}
    </div>
  );
}

function StatementCard({
  s,
  onIssue,
  canWrite,
}: {
  s: K1Statement;
  onIssue?: (id: string) => void;
  canWrite: boolean;
}) {
  const byField = new Map(s.refusals.map((r) => [r.field, r]));
  return (
    <div className="rounded-md p-3 mb-3" style={{ border: "1px solid rgba(4,30,65,0.18)" }} data-testid="spv-k1-statement">
      <div className="flex items-baseline gap-3 flex-wrap mb-2">
        <div className="font-medium text-sm" data-testid="spv-k1-investor">{s.investorId}</div>
        <div className="text-xs text-[var(--cv-color-text-muted)]">Tax year {s.taxYear}</div>
        {s.status && (
          <span
            className="inline-block rounded px-1.5 py-0.5 text-[11px] font-medium"
            style={
              s.status === "issued"
                ? { background: "rgba(16,122,87,0.12)", color: "#0b6b4f" }
                : s.status === "superseded"
                  ? { background: "rgba(120,120,120,0.14)", color: "#4a4a4a" }
                  : { background: "rgba(180,120,10,0.14)", color: "#8a5a06" }
            }
            data-testid={`spv-k1-status-${s.status}`}
          >
            {s.status === "issued" ? "Issued" : s.status === "superseded" ? "Superseded" : "Draft"}
          </span>
        )}
        <div className="text-xs text-[var(--cv-color-text-muted)]" data-testid="spv-k1-ownership">
          {s.ownershipFraction === null
            ? "Ownership not derivable"
            : `${(s.ownershipFraction * 100).toFixed(4)}% of committed capital`}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <Box label="Beginning capital" minor={s.beginningCapitalMinor} currency={s.currency}
             refusal={byField.get("beginningCapitalMinor")} testid="spv-k1-box-beginning" />
        <Box label="Capital contributed" minor={s.contributionsMinor} currency={s.currency}
             refusal={byField.get("contributionsMinor")} testid="spv-k1-box-contributions" />
        <Box label="Allocated income" minor={s.allocatedIncomeMinor} currency={s.currency}
             refusal={byField.get("allocatedIncomeMinor")} testid="spv-k1-box-income" />
        <Box label="Carried interest allocated" minor={s.carryAllocatedMinor} currency={s.currency}
             refusal={byField.get("carryAllocatedMinor")} testid="spv-k1-box-carry" />
        <Box label="Distributions" minor={s.distributionsMinor} currency={s.currency}
             refusal={byField.get("distributionsMinor")} testid="spv-k1-box-distributions" />
        <Box label="Ending capital" minor={s.endingCapitalMinor} currency={s.currency}
             refusal={byField.get("endingCapitalMinor")} testid="spv-k1-box-ending" />
      </div>

      <div className="text-[11px] mt-2 text-[var(--cv-color-text-muted)]" data-testid="spv-k1-sources">
        {s.sourceIds.length === 0
          ? "No distribution events were recorded for this partner in this tax year."
          : `Derived from ${s.sourceIds.length} recorded distribution${s.sourceIds.length === 1 ? "" : "s"}.`}
      </div>

      {canWrite && s.status === "draft" && s.id && onIssue && (
        <div className="mt-2">
          <Button size="sm" variant="outline" data-testid="spv-k1-issue" onClick={() => onIssue(s.id!)}>
            Issue to partner
          </Button>
          <span className="text-[11px] ml-2 text-[var(--cv-color-text-muted)]">
            Issuing makes this statement visible to the partner. Drafts are never shown to them.
          </span>
        </div>
      )}
    </div>
  );
}

/* ── panel ────────────────────────────────────────────────────────────────── */

export function SpvK1Panel({ spvId, canWrite }: { spvId: string; canWrite: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [taxYear, setTaxYear] = useState(String(new Date().getUTCFullYear() - 1));

  const yearNum = Number(taxYear);
  const yearValid = Number.isInteger(yearNum) && yearNum >= 1900 && yearNum <= 2999;

  const previewQ = useQuery<{ taxYear: number; statements: K1Statement[] }>({
    queryKey: ["/api/partner/me/spv", spvId, "k1", taxYear],
    queryFn: () => apiRequest("GET", `/api/partner/me/spv/${spvId}/k1?taxYear=${yearNum}`).then((r) => r.json()),
    enabled: yearValid,
  });
  const storedQ = useQuery<{ statements: K1Statement[] }>({
    queryKey: ["/api/partner/me/spv", spvId, "k1", "stored", taxYear],
    queryFn: () => apiRequest("GET", `/api/partner/me/spv/${spvId}/k1/stored?taxYear=${yearNum}`).then((r) => r.json()),
    enabled: yearValid,
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ["/api/partner/me/spv", spvId, "k1"] });
  }

  const generate = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/partner/me/spv/${spvId}/k1/generate`, { taxYear: yearNum }).then((r) => r.json()),
    onSuccess: () => {
      toast({
        title: "Draft statements generated",
        description: "One draft per committed partner. Figures that could not be derived are recorded as blank, not as zero.",
      });
      refresh();
    },
    onError: (e: any) => toast({ title: "Could not generate", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const issue = useMutation({
    mutationFn: (k1Id: string) =>
      apiRequest("POST", `/api/partner/me/spv/${spvId}/k1/${k1Id}/issue`).then((r) => r.json()),
    onSuccess: () => {
      toast({ title: "Statement issued", description: "The partner can now see this statement in their portfolio." });
      refresh();
    },
    onError: (e: any) => toast({ title: "Could not issue", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const preview = previewQ.data?.statements ?? [];
  const stored = storedQ.data?.statements ?? [];

  return (
    <div data-testid="spv-k1-panel">
      <div className="text-xs mb-3 leading-relaxed text-[var(--cv-color-text-muted)]" data-testid="spv-k1-policy">
        Schedule K-1 figures are derived only from recorded facts: confirmed capital receipts, recorded distributions and
        the committed register. A commitment is not a contribution, so a partner with no confirmed receipt shows a blank
        rather than their committed amount. Any figure that cannot be derived is left blank with its reason stated — it is
        never shown as zero. These statements are a reporting aid, not tax advice.
      </div>

      <div className="flex items-end gap-2 mb-4 flex-wrap">
        <div>
          <Label htmlFor="k1-year" className="text-xs">Tax year</Label>
          <Input
            id="k1-year"
            data-testid="spv-k1-year"
            value={taxYear}
            onChange={(e) => setTaxYear(e.target.value)}
            className="w-28"
          />
        </div>
        {canWrite && (
          <Button
            size="sm"
            data-testid="spv-k1-generate"
            disabled={!yearValid || generate.isPending}
            onClick={() => generate.mutate()}
          >
            {generate.isPending ? "Generating…" : "Generate drafts"}
          </Button>
        )}
        {!yearValid && (
          <div className="text-xs" style={{ color: "#8a5a06" }} data-testid="spv-k1-year-invalid">
            Enter a four-digit tax year. Nothing is derived against a guessed period.
          </div>
        )}
      </div>

      {/* ── live derivation ──────────────────────────────────────────────── */}
      <div className="mb-4">
        <div className="font-medium text-sm mb-1">Live derivation</div>
        {previewQ.isLoading ? (
          <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="spv-k1-loading">Deriving…</div>
        ) : previewQ.isError ? (
          <div className="text-sm" data-testid="spv-k1-error">
            Statements are unavailable because the reporting service could not be reached. Nothing is shown rather than
            figures that may be wrong.
          </div>
        ) : preview.length === 0 ? (
          <div className="text-sm" data-testid="spv-k1-empty">
            No committed partners are on this vehicle's register, so there is nothing to report for this tax year.
          </div>
        ) : (
          preview.map((s) => <StatementCard key={`p_${s.investorId}`} s={s} canWrite={false} />)
        )}
      </div>

      {/* ── persisted statements ─────────────────────────────────────────── */}
      <div>
        <div className="font-medium text-sm mb-1">Recorded statements</div>
        {stored.length === 0 ? (
          <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="spv-k1-stored-empty">
            No statements have been generated for this tax year yet.
          </div>
        ) : (
          stored.map((s) => (
            <StatementCard key={s.id} s={s} canWrite={canWrite} onIssue={(id) => issue.mutate(id)} />
          ))
        )}
      </div>
    </div>
  );
}
