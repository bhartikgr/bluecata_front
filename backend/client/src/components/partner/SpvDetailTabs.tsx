/* W-FIX1f — SPV-UI-1 / SPV-EDU-1 / SPV-COMPLIANCE.
 *
 * A tabbed SPV detail surface that exposes the engine's built-but-hidden
 * capabilities (Documents · Transfers · Wind-down · Compliance) alongside the
 * existing Overview/Fees/LPs/Deployments/Distributions data — each tab carries
 * plain-language educational copy from SPV_EDU (SPV Plan v2 §3).
 *
 * FRICTIONLESS: every compliance item here is voluntary/educational and NEVER
 * blocks. The ONE exception is D6, a jurisdiction-aware investor-count WARNING
 * that still never blocks. No money moves here — funds confirmation, closes and
 * distribution previews call the additive W-FIX1e engine endpoints; the LP's
 * authoritative seat remains the sacred commitFunded ledger line.
 *
 * Tabs use `defaultValue` (uncontrolled) so the first click always registers
 * (avoids the controlled-derived-value first-interaction no-op, O7).
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatMinor as formatMinorLib } from "@/lib/currency";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  SPV_EDU,
  investorCountAwareness,
  formationChecklist,
  filingsChecklist,
  WIND_DOWN_CHECKLIST,
} from "@/lib/spvEducation";

function fmt(minor: number | null | undefined, currency: string) {
  if (minor == null) return "—";
  return formatMinorLib(minor, currency, { locale: "en-US" });
}

/* Educational callout shown at the top of each tab. */
function Edu({ children, testid }: { children: React.ReactNode; testid?: string }) {
  return (
    <div
      className="mb-3 rounded-md p-3 text-xs leading-relaxed"
      style={{ background: "rgba(4,30,65,0.05)", border: "1px solid rgba(4,30,65,0.15)", color: "var(--cv-color-navy)" }}
      data-testid={testid}
    >
      {children}
    </div>
  );
}

type Sub = { investorId: string; commitmentMinor: number; status: string };
type RegisterRow = { investorId: string; commitmentMinor: number; ownershipPct: number };
type Fee = { layer: string; feeType: string; carryPct: number | null; fixedAmountMinor: number | null };
type Deployment = { companyId: string; amountMinor: number; status: string };
type Distribution = { event: string; grossProceedsMinor: number; gpCarryMinor: number; platformCarryMinor: number };
type Doc = { id?: string; docType?: string; title?: string; createdAt?: string };
type Transfer = { id?: string; fromInvestorId?: string; toInvestorId?: string; status?: string };
type CapitalAccount = { investorId: string; contributedMinor: number; confirmedMinor: number; distributedMinor: number };
type CloseSummary = {
  confirmedCount: number;
  confirmedMinor: number;
  targetMinor: number | null;
  underTarget: boolean;
  shortfallMinor: number;
  suggestedTargetMinor: number;
  note: string;
};

export interface SpvDetail {
  spv?: { status?: string; jurisdiction?: string; lpVisibility?: string; closeDate?: string | null; targetRaiseMinor?: number | null; targetCompanyId?: string | null };
  mandate?: { mode?: string; sector?: string[]; geography?: string[]; stage?: string[] } | null;
  fees?: Fee[];
  subscriptions?: Sub[];
  register?: RegisterRow[];
  deployments?: Deployment[];
  distributions?: Distribution[];
  documents?: Doc[];
  transfers?: Transfer[];
  capitalAccounts?: CapitalAccount[];
  closeSummary?: CloseSummary;
  // D3/SPV-BUG-5 — DB-driven effective fee summary. Carry %s are fractions
  // (0.2 = 20%); platformCarryPct is the admin-set platform layer (read-only).
  feeSummary?: {
    commitmentMinor: number;
    managementFeeMinor: number;
    platformFeeMinor: number;
    netDeployedMinor: number;
    currency: string;
    managementCarryPct: number | null;
    platformCarryPct: number | null;
  } | null;
}

const CHECK_ITEM = "flex items-start gap-2 text-xs py-1";

export function SpvDetailTabs({
  spvId,
  detail,
  currency,
  canWrite,
  onChanged,
}: {
  spvId: string;
  detail: SpvDetail;
  currency: string;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const register = detail.register ?? [];
  const subs = detail.subscriptions ?? [];
  const fees = detail.fees ?? [];
  const deployments = detail.deployments ?? [];
  const distributions = detail.distributions ?? [];
  const documents = detail.documents ?? [];
  const transfers = detail.transfers ?? [];
  const capitalAccounts = detail.capitalAccounts ?? [];
  const closeSummary = detail.closeSummary;
  const spv = detail.spv ?? {};
  const raised = register.reduce((a, r) => a + r.commitmentMinor, 0);
  const jurisdiction = spv.jurisdiction ?? null;

  // D6 — jurisdiction-aware, NON-BLOCKING investor-count awareness.
  const lpCount = subs.filter((s) => s.status !== "withdrawn").length;
  const awareness = investorCountAwareness(jurisdiction);
  const nearLimit = awareness.limit != null && lpCount >= Math.floor(awareness.limit * 0.8);
  const overLimit = awareness.limit != null && lpCount > awareness.limit;

  return (
    <Tabs defaultValue="overview" className="w-full" data-testid={`spv-tabs-${spvId}`}>
      <TabsList className="flex flex-wrap h-auto">
        <TabsTrigger value="overview" data-testid="spv-tab-overview">Overview</TabsTrigger>
        <TabsTrigger value="mandate" data-testid="spv-tab-mandate">Mandate</TabsTrigger>
        <TabsTrigger value="fees" data-testid="spv-tab-fees">Fees</TabsTrigger>
        <TabsTrigger value="lps" data-testid="spv-tab-lps">LPs</TabsTrigger>
        <TabsTrigger value="deployments" data-testid="spv-tab-deployments">Deployments</TabsTrigger>
        <TabsTrigger value="distributions" data-testid="spv-tab-distributions">Distributions</TabsTrigger>
        <TabsTrigger value="documents" data-testid="spv-tab-documents">Documents</TabsTrigger>
        <TabsTrigger value="transfers" data-testid="spv-tab-transfers">Transfers</TabsTrigger>
        <TabsTrigger value="close" data-testid="spv-tab-close">Close</TabsTrigger>
        <TabsTrigger value="winddown" data-testid="spv-tab-winddown">Wind-down</TabsTrigger>
        <TabsTrigger value="compliance" data-testid="spv-tab-compliance">Compliance</TabsTrigger>
      </TabsList>

      {/* ── Overview ─────────────────────────────────────────────────────── */}
      <TabsContent value="overview">
        {/* A8 — persistent acting-on-behalf / single-line-of-record context. */}
        <div
          className="mb-3 rounded-md p-3 text-xs leading-relaxed"
          style={{ background: "rgba(4,30,65,0.08)", border: "1px solid rgba(4,30,65,0.25)", color: "var(--cv-color-navy)" }}
          data-testid="spv-acting-on-behalf-banner"
        >
          <span className="font-medium">Acting on behalf{spv.targetCompanyId ? ` of ${spv.targetCompanyId}` : ""}. </span>
          {SPV_EDU.actingOnBehalf}
        </div>
        <Edu testid="spv-edu-overview">{SPV_EDU.whatIsAnSpv}</Edu>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div data-testid="spv-detail-raise">
            <div className="font-medium">Raise progress</div>
            <div className="font-mono">{fmt(raised, currency)}{spv.targetRaiseMinor ? ` / ${fmt(spv.targetRaiseMinor, currency)} target` : ""}</div>
          </div>
          <div data-testid="spv-detail-status">
            <div className="font-medium">Status</div>
            <div className="text-xs">{spv.status ?? "—"}</div>
          </div>
          <div data-testid="spv-detail-lpvisibility">
            <div className="font-medium">LP co-investor visibility</div>
            <div className="text-xs">
              {(spv.lpVisibility ?? "own_only") === "co_investors"
                ? "On — investors can see each other (transparent club deal)"
                : "Off — each investor sees only their own position"}
            </div>
          </div>
          <div data-testid="spv-detail-lpcount">
            <div className="font-medium">Investors</div>
            <div className="text-xs">{lpCount}</div>
          </div>
        </div>
      </TabsContent>

      {/* ── Mandate ──────────────────────────────────────────────────────── */}
      <TabsContent value="mandate">
        <Edu testid="spv-edu-mandate">{SPV_EDU.mandate}</Edu>
        <div className="text-sm space-y-1" data-testid="spv-detail-mandate">
          <div><span className="font-medium">Mode:</span> {detail.mandate?.mode ?? "—"}</div>
          <div><span className="font-medium">Sectors:</span> {detail.mandate?.sector?.length ? detail.mandate.sector.join(", ") : "None selected"}</div>
          <div><span className="font-medium">Geography:</span> {detail.mandate?.geography?.length ? detail.mandate.geography.join(", ") : "Any"}</div>
          <div><span className="font-medium">Stage:</span> {detail.mandate?.stage?.length ? detail.mandate.stage.join(", ") : "Any"}</div>
        </div>
      </TabsContent>

      {/* ── Fees ─────────────────────────────────────────────────────────── */}
      <TabsContent value="fees">
        <Edu testid="spv-edu-fees">{SPV_EDU.fees}</Edu>
        <div data-testid="spv-detail-fees" className="text-sm space-y-1">
          {fees.length === 0 ? (
            <div className="text-xs text-[var(--cv-color-text-faint)]">none</div>
          ) : (
            fees.map((f, i) => (
              <div key={i} className="text-xs">
                {f.layer}: {f.feeType}{f.carryPct != null ? ` ${(f.carryPct * 100).toFixed(0)}%` : ""}{f.fixedAmountMinor ? ` ${fmt(f.fixedAmountMinor, currency)}` : ""}
                {f.layer === "platform" ? " (set by Capavate — read-only to you)" : ""}
              </div>
            ))
          )}
          {/* D3/SPV-BUG-5 — platform carry % read-only, pulled live from the
              admin-set fee config (DB-driven, never hardcoded). Shown wherever
              carry appears; falls back to the transparency note when unset. */}
          {detail.feeSummary?.platformCarryPct != null ? (
            <div className="mt-1 text-xs" data-testid="spv-detail-platform-carry">
              <span className="font-medium">Platform carry:</span> {(detail.feeSummary.platformCarryPct * 100).toFixed(1)}%
              <span className="text-[10px] text-[var(--cv-color-text-faint)]"> (set by Capavate — read-only to you)</span>
            </div>
          ) : (
            <div className="text-[10px] text-[var(--cv-color-text-faint)]" data-testid="spv-detail-platform-carry-note">The platform fee layer is set by Capavate and shown here when applied.</div>
          )}
        </div>
      </TabsContent>

      {/* ── LPs / Subscriptions + funds confirmation + capital accounts (D10) ── */}
      <TabsContent value="lps">
        <Edu testid="spv-edu-confirm">{SPV_EDU.confirmingInvestments}</Edu>
        <div data-testid="spv-detail-roster" className="space-y-2">
          {register.length === 0 ? (
            <div className="text-xs text-[var(--cv-color-text-faint)]">no LPs yet</div>
          ) : (
            register.map((r) => (
              <LpRow key={r.investorId} spvId={spvId} row={r} currency={currency} canWrite={canWrite} onChanged={onChanged} />
            ))
          )}
        </div>

        {/* D10 — minimal capital accounts. */}
        <div className="mt-4" data-testid="spv-detail-capital-accounts">
          <div className="font-medium text-sm mb-1">Capital accounts</div>
          <Edu testid="spv-edu-capital-accounts">{SPV_EDU.capitalAccounts}</Edu>
          {capitalAccounts.length === 0 ? (
            <div className="text-xs text-[var(--cv-color-text-faint)]">not yet reported</div>
          ) : (
            <div className="text-xs">
              <div className="grid grid-cols-4 gap-2 font-medium border-b pb-1">
                <div>Investor</div><div>Contributed</div><div>Confirmed</div><div>Distributed</div>
              </div>
              {capitalAccounts.map((c) => (
                <div key={c.investorId} className="grid grid-cols-4 gap-2 py-0.5" data-testid={`spv-cap-acct-${c.investorId}`}>
                  <div className="truncate">{c.investorId}</div>
                  <div className="font-mono">{fmt(c.contributedMinor, currency)}</div>
                  <div className="font-mono">{fmt(c.confirmedMinor, currency)}</div>
                  <div className="font-mono">{fmt(c.distributedMinor, currency)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </TabsContent>

      {/* ── Deployments ──────────────────────────────────────────────────── */}
      <TabsContent value="deployments">
        <Edu testid="spv-edu-deploying">{SPV_EDU.deploying}</Edu>

        {/* D2 — the OPTIONAL target company linked at creation. This is a
            reference link only: it never carries an allocation amount and
            never blocks activation (an SPV can launch with no target). */}
        <div className="mb-3 rounded-md border p-2 text-xs" data-testid="spv-detail-target-company">
          {spv.targetCompanyId ? (
            <>
              <span className="font-medium">Target company: </span>
              <span data-testid="spv-detail-target-company-id">{spv.targetCompanyId}</span>
              <div className="text-[10px] text-[var(--cv-color-text-faint)] mt-0.5">Linked for reference — no allocation is committed until you deploy below.</div>
            </>
          ) : (
            <span className="text-[var(--cv-color-text-faint)]">No target company linked — optional, you can deploy into any eligible company below.</span>
          )}
        </div>

        <div data-testid="spv-detail-deployments" className="text-sm space-y-1">
          {deployments.length === 0 ? (
            <div className="text-xs text-[var(--cv-color-text-faint)]">none</div>
          ) : (
            deployments.map((d, i) => (
              <div key={i} className="text-xs">{d.companyId}: {fmt(d.amountMinor, currency)} · {d.status}</div>
            ))
          )}
        </div>

        {/* D2 — Deploy affordance. Deploying commits a real allocation (amount
            required, fail-closed eligibility) so it is a deliberate, separate
            step from linking a target — it never happens automatically. */}
        {canWrite && (
          <div className="mt-3 border-t pt-3" data-testid="spv-deploy-affordance">
            <Button size="sm" variant="outline" disabled data-testid="spv-deploy-action" title="Deploy capital into a company">
              Deploy capital
            </Button>
            <div className="text-[10px] text-[var(--cv-color-text-faint)] mt-1">
              Deploying links a company <span className="font-medium">and</span> commits an allocation amount (eligibility is checked and fails closed). Linking a target company above does not move any money.
            </div>
          </div>
        )}
      </TabsContent>

      {/* ── Distributions + offline preview (SPV-CORE-2) ─────────────────── */}
      <TabsContent value="distributions">
        <Edu testid="spv-edu-distributions">{SPV_EDU.distributions}</Edu>
        <div data-testid="spv-detail-distributions" className="text-sm space-y-1">
          {distributions.length === 0 ? (
            <div className="text-xs text-[var(--cv-color-text-faint)]">none</div>
          ) : (
            distributions.map((d, i) => (
              <div key={i} className="text-xs">{d.event}: gross {fmt(d.grossProceedsMinor, currency)} · GP carry {fmt(d.gpCarryMinor, currency)} · platform carry {fmt(d.platformCarryMinor, currency)}</div>
            ))
          )}
        </div>
        {canWrite && <DistributionPreview spvId={spvId} currency={currency} />}
      </TabsContent>

      {/* ── Documents ────────────────────────────────────────────────────── */}
      <TabsContent value="documents">
        <Edu testid="spv-edu-reporting">{SPV_EDU.reporting}</Edu>
        <div data-testid="spv-detail-documents" className="text-sm space-y-1">
          {documents.length === 0 ? (
            <div className="text-xs text-[var(--cv-color-text-faint)]">no documents yet</div>
          ) : (
            documents.map((d, i) => (
              <div key={d.id ?? i} className="text-xs">{d.title ?? d.docType ?? "document"}{d.createdAt ? ` · ${new Date(d.createdAt).toLocaleDateString()}` : ""}</div>
            ))
          )}
        </div>
      </TabsContent>

      {/* ── Transfers (D12) ──────────────────────────────────────────────── */}
      <TabsContent value="transfers">
        <Edu testid="spv-edu-transfers">{SPV_EDU.transfers}</Edu>
        <div data-testid="spv-detail-transfers" className="text-sm space-y-1">
          {transfers.length === 0 ? (
            <div className="text-xs text-[var(--cv-color-text-faint)]">no transfers</div>
          ) : (
            transfers.map((t, i) => (
              <div key={t.id ?? i} className="text-xs">{t.fromInvestorId} → {t.toInvestorId} · {t.status}</div>
            ))
          )}
        </div>
      </TabsContent>

      {/* ── Close / rolling close (SPV-CORE-3) ───────────────────────────── */}
      <TabsContent value="close">
        <Edu testid="spv-edu-closing">{SPV_EDU.closing}</Edu>
        <ClosePanel spvId={spvId} spvStatus={spv.status ?? ""} currency={currency} summary={closeSummary} canWrite={canWrite} onChanged={onChanged} />
      </TabsContent>

      {/* ── Wind-down (D13 voluntary checklist) ──────────────────────────── */}
      <TabsContent value="winddown">
        <Edu testid="spv-edu-winddown">{SPV_EDU.windDown}</Edu>
        <VoluntaryChecklist items={[...WIND_DOWN_CHECKLIST]} testid="spv-winddown-checklist" />
      </TabsContent>

      {/* ── Compliance (D5 accreditation · D6 count · D7 filings · D1 formation) ── */}
      <TabsContent value="compliance">
        {/* D6 — jurisdiction-aware NON-BLOCKING investor-count warning. */}
        <div className="mb-3" data-testid="spv-compliance-investor-count">
          <div className="font-medium text-sm">Investor count</div>
          <Edu testid="spv-edu-investor-count">{SPV_EDU.investorCount}</Edu>
          {awareness.limit == null ? (
            <div className="text-xs text-[var(--cv-color-text-muted)]">{awareness.label} Current: {lpCount}.</div>
          ) : (
            <div
              className={`text-xs rounded-md p-2 ${overLimit || nearLimit ? "text-amber-900" : "text-[var(--cv-color-text-muted)]"}`}
              style={overLimit || nearLimit ? { background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)" } : {}}
              data-testid="spv-compliance-count-warning"
            >
              {lpCount} of ~{awareness.limit} investors. {awareness.label}
              {overLimit ? " You are over the common threshold — this is informational and does not block anything." : nearLimit ? " You are approaching the threshold — informational only, never blocks." : ""}
            </div>
          )}
        </div>

        {/* D5 — accreditation self-declaration (assumed accredited; LPs self-declare). */}
        <div className="mb-3" data-testid="spv-compliance-accreditation">
          <div className="font-medium text-sm">Accreditation</div>
          <Edu testid="spv-edu-accreditation">{SPV_EDU.accreditation}</Edu>
        </div>

        {/* D7 — voluntary filings checklist. */}
        <div className="mb-3" data-testid="spv-compliance-filings">
          <div className="font-medium text-sm">Regulatory filings (voluntary)</div>
          <Edu testid="spv-edu-filings">{SPV_EDU.filings}</Edu>
          <VoluntaryChecklist items={filingsChecklist(jurisdiction)} testid="spv-filings-checklist" />
        </div>

        {/* D1 — voluntary formation checklist. */}
        <div data-testid="spv-compliance-formation">
          <div className="font-medium text-sm">Formation checklist (voluntary)</div>
          <Edu testid="spv-edu-formation">{SPV_EDU.nameJurisdiction}</Edu>
          <VoluntaryChecklist items={formationChecklist(jurisdiction)} testid="spv-formation-checklist" />
        </div>
      </TabsContent>
    </Tabs>
  );
}

/* Per-LP row with the SPV-CORE-1 "Confirm funds received" affordance. A
 * mismatch is surfaced educationally and NEVER blocks. */
function LpRow({
  spvId,
  row,
  currency,
  canWrite,
  onChanged,
}: {
  spvId: string;
  row: RegisterRow;
  currency: string;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [received, setReceived] = useState(String(row.commitmentMinor));
  const [reference, setReference] = useState("");
  const [result, setResult] = useState<{ status: string; deltaMinor: number; note: string } | null>(null);

  const confirm = useMutation({
    mutationFn: async () => {
      const j = await (
        await apiRequest("POST", `/api/partner/me/spv/${spvId}/subscriptions/${encodeURIComponent(row.investorId)}/confirm-funds`, {
          receivedMinor: parseInt(received || "0", 10),
          reference: reference.trim() || null,
        })
      ).json();
      return j.confirmation as { status: string; deltaMinor: number; note: string };
    },
    onSuccess: (c) => {
      setResult(c);
      toast({ title: c.status === "matched" ? "Funds confirmed" : "Funds confirmed with a note" });
      onChanged();
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Could not confirm funds", description: e.message }),
  });

  return (
    <div className="text-xs border rounded p-2" data-testid={`spv-lp-row-${row.investorId}`}>
      <div className="flex justify-between items-center gap-2">
        <span className="truncate">{row.investorId}: {fmt(row.commitmentMinor, currency)} ({(row.ownershipPct * 100).toFixed(1)}%)</span>
        {canWrite && (
          <Button variant="outline" size="sm" data-testid={`spv-confirm-funds-open-${row.investorId}`} onClick={() => setOpen((o) => !o)}>
            {open ? "Cancel" : "Confirm funds"}
          </Button>
        )}
      </div>
      {open && (
        <div className="mt-2 space-y-2" data-testid={`spv-confirm-funds-panel-${row.investorId}`}>
          <div>
            <Label className="text-[10px]">Amount received (minor units)</Label>
            <Input value={received} onChange={(e) => setReceived(e.target.value)} type="number" data-testid={`spv-confirm-received-${row.investorId}`} />
          </div>
          <div>
            <Label className="text-[10px]">Wire reference (optional)</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} data-testid={`spv-confirm-reference-${row.investorId}`} />
          </div>
          <Button size="sm" disabled={confirm.isPending} onClick={() => confirm.mutate()} data-testid={`spv-confirm-submit-${row.investorId}`}>
            {confirm.isPending ? "Confirming…" : "Record confirmation"}
          </Button>
          {result && (
            <div
              className={`rounded p-2 ${result.status === "matched" ? "text-emerald-800" : "text-amber-900"}`}
              style={result.status === "matched" ? { background: "rgba(16,185,129,0.1)" } : { background: "rgba(245,158,11,0.1)" }}
              data-testid={`spv-confirm-result-${row.investorId}`}
            >
              {result.note}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* SPV-CORE-2 — offline distribution preview (no persist, no money movement). */
function DistributionPreview({ spvId, currency }: { spvId: string; currency: string }) {
  const { toast } = useToast();
  const [gross, setGross] = useState("");
  const [hurdle, setHurdle] = useState("");
  const [split, setSplit] = useState<{ tiers: { tier: string; amountMinor: number }[]; lpTotalMinor: number; gpTotalMinor: number; tiered: boolean } | null>(null);

  const preview = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { grossProceedsMinor: parseInt(gross || "0", 10) };
      if (hurdle.trim()) body.hurdleRatePct = Number(hurdle);
      const j = await (await apiRequest("POST", `/api/partner/me/spv/${spvId}/distributions/preview`, body)).json();
      return j.split;
    },
    onSuccess: (s) => setSplit(s),
    onError: (e: Error) => toast({ variant: "destructive", title: "Preview failed", description: e.message }),
  });

  return (
    <div className="mt-3 border-t pt-3" data-testid="spv-distribution-preview">
      <div className="font-medium text-sm mb-1">Distribution preview (offline)</div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px]">Gross proceeds (minor)</Label>
          <Input value={gross} onChange={(e) => setGross(e.target.value)} type="number" data-testid="spv-preview-gross" />
        </div>
        <div>
          <Label className="text-[10px]">Hurdle % (optional)</Label>
          <Input value={hurdle} onChange={(e) => setHurdle(e.target.value)} type="number" placeholder="e.g. 8" data-testid="spv-preview-hurdle" />
        </div>
      </div>
      <Button size="sm" className="mt-2" disabled={preview.isPending || !gross.trim()} onClick={() => preview.mutate()} data-testid="spv-preview-run">
        {preview.isPending ? "Computing…" : "Preview split"}
      </Button>
      {split && (
        <div className="mt-2 text-xs space-y-0.5" data-testid="spv-preview-result">
          {split.tiers.map((t, i) => (
            <div key={i} className="flex justify-between"><span>{t.tier.replace(/_/g, " ")}</span><span className="font-mono">{fmt(t.amountMinor, currency)}</span></div>
          ))}
          <div className="flex justify-between border-t pt-1 font-medium"><span>LP total</span><span className="font-mono">{fmt(split.lpTotalMinor, currency)}</span></div>
          <div className="flex justify-between font-medium"><span>GP total</span><span className="font-mono">{fmt(split.gpTotalMinor, currency)}</span></div>
          <div className="text-[10px] text-[var(--cv-color-text-faint)]">{split.tiered ? "Tiered waterfall (preferred return + GP catch-up engaged)." : "Simple waterfall (return of capital, then carry)."} This is a preview only — no money moves.</div>
        </div>
      )}
    </div>
  );
}

/* SPV-CORE-3 — close summary + close/reopen. Under-target NEVER blocks. */
function ClosePanel({
  spvId,
  spvStatus,
  currency,
  summary,
  canWrite,
  onChanged,
}: {
  spvId: string;
  spvStatus: string;
  currency: string;
  summary: CloseSummary | undefined;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [setTargetToRaised, setSetTargetToRaised] = useState(false);

  const close = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/partner/me/spv/${spvId}/close`, { setTargetToRaised })).json(),
    onSuccess: () => {
      toast({ title: "Closed to new LPs" });
      onChanged();
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Could not close", description: e.message }),
  });

  const reopen = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/partner/me/spv/${spvId}/reopen`, { windowDays: 30 })).json(),
    onSuccess: () => {
      toast({ title: "Reopened for a rolling close" });
      onChanged();
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Could not reopen", description: e.message }),
  });

  const isClosed = spvStatus === "closed";

  return (
    <div data-testid="spv-close-panel" className="text-sm space-y-2">
      {summary && (
        <div className="text-xs space-y-1" data-testid="spv-close-summary">
          <div>{summary.confirmedCount} committed LP(s) · {fmt(summary.confirmedMinor, currency)} confirmed{summary.targetMinor != null ? ` of ${fmt(summary.targetMinor, currency)} target` : ""}</div>
          <div
            className={summary.underTarget ? "rounded p-2 text-amber-900" : "text-[var(--cv-color-text-muted)]"}
            style={summary.underTarget ? { background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)" } : {}}
          >
            {summary.note}
          </div>
        </div>
      )}
      {canWrite && !isClosed && (
        <div className="space-y-2">
          {summary?.underTarget && (
            <label className="flex items-center gap-2 text-xs" data-testid="spv-close-set-target">
              <input type="checkbox" checked={setTargetToRaised} onChange={(e) => setSetTargetToRaised(e.target.checked)} />
              <span>Set target to the confirmed amount raised ({fmt(summary.suggestedTargetMinor, currency)})</span>
            </label>
          )}
          <Button size="sm" disabled={close.isPending} onClick={() => close.mutate()} data-testid="spv-close-submit">
            {close.isPending ? "Closing…" : "Close to new LPs"}
          </Button>
        </div>
      )}
      {canWrite && isClosed && (
        <Button size="sm" variant="outline" disabled={reopen.isPending} onClick={() => reopen.mutate()} data-testid="spv-reopen-submit">
          {reopen.isPending ? "Reopening…" : "Reopen for a rolling close"}
        </Button>
      )}
    </div>
  );
}

/* Voluntary, educational checklist — local check state only; NEVER persisted as
 * a gate and NEVER blocks. */
function VoluntaryChecklist({ items, testid }: { items: string[]; testid: string }) {
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  return (
    <div data-testid={testid}>
      {items.map((item, i) => (
        <label key={i} className={CHECK_ITEM}>
          <input type="checkbox" checked={!!checked[i]} onChange={(e) => setChecked((p) => ({ ...p, [i]: e.target.checked }))} className="mt-0.5" />
          <span>{item}</span>
        </label>
      ))}
      <div className="text-[10px] text-[var(--cv-color-text-faint)] mt-1">Voluntary — for your guidance only. None of these steps block your SPV.</div>
    </div>
  );
}
