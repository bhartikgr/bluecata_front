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
import { useState, useId } from "react";
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
import {
  SPV_MANDATE_MODES,
  SPV_MANDATE_MODE_LABELS,
  SPV_MANDATE_MODE_HELP,
  SPV_FEE_TYPES,
  SPV_DOC_TYPES,
  SPV_INVESTOR_PERSONAS,
} from "@shared/spvEngine";

/* Wave C v2 helper — STRICT integer parse. Rejects empty, negatives,
 * exponent notation ("1e7" → NaN), decimals, and non-numeric strings.
 * Returns a finite non-negative integer or throws. */
function parseMinor(v: string): number {
  const s = (v ?? "").trim();
  if (!s) throw new Error("Enter an amount in minor units (integer)");
  if (!/^\d+$/.test(s)) throw new Error("Amount must be a whole number of minor units (no decimals, no scientific notation)");
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("Amount is out of range");
  return n;
}

/* Wave C v2 helper — STRICT percentage parse. Accepts 0–100 with up to 4
 * decimal places. Returns a fraction 0–1. Empty throws. */
function parsePercent(v: string): number {
  const s = (v ?? "").trim();
  if (!s) throw new Error("Enter a percentage between 0 and 100");
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(s)) throw new Error("Percentage must be between 0 and 100 (up to 4 decimal places)");
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error("Percentage must be between 0 and 100");
  return n / 100;
}

/* Wave C v2 helper — friendly translation of common backend error codes to
 * GP-facing English. Backend routes return {error: "CODE"} — without this
 * table every failure would render as a generic "Some of the information
 * was invalid" toast. */
const SPV_ERROR_TRANSLATIONS: Record<string, string> = {
  SPV_NOT_FOUND: "This SPV no longer exists. Refresh the page.",
  INVALID_MANDATE_MODE: "Please pick a mandate mode from the dropdown.",
  INVALID_FEE_LAYER: "Fee layer must be Management (Platform is Capavate-admin only).",
  INVALID_FEE_TYPE: "Fee type must be Fixed, Carry, or Hybrid.",
  PLATFORM_FEE_ADMIN_ONLY: "Platform-layer fees are set by Capavate and can't be added here.",
  FEE_AMOUNT_REQUIRED: "Enter a fixed amount for this fee type.",
  FEE_CARRY_REQUIRED: "Enter a carry percentage for this fee type.",
  STORAGE_KEY_REQUIRED: "Storage key required — upload the file first, then paste the returned key.",
  TRANSFER_PARTIES_REQUIRED: "Both from- and to-investor IDs are required.",
  INVALID_AMOUNT: "Amount must be greater than zero (minor units).",
  INVALID_GROSS: "Gross proceeds must be a non-negative number.",
  EVENT_REQUIRED: "Please pick an event type.",
  DISTRIBUTION_BASIS_REQUIRED: "Cost basis is required for every distribution (never assumed).",
  INVESTOR_ID_REQUIRED: "Investor ID required.",
  COMPANY_AND_ROUND_REQUIRED: "Both company ID and company round ID are required.",
  INSTRUMENT_NOT_IN_ROUND: "The selected round has no instrument configured. Fix the round first.",
  FEES_UNPAID: "Fixed fees for this SPV are unpaid — settle them before deploying capital.",
  ROUND_NOT_ELIGIBLE: "This company or round is not eligible under the SPV's mandate.",
  ROUND_UNDERFUNDED: "The round doesn't have enough capacity for this deployment amount.",
  MANDATE_MISMATCH: "This company doesn't match the SPV's mandate. Update the mandate first or pick a different company.",
  INVESTOR_NOT_IN_PARTNER_TENANT: "That investor is already associated with a different partner and can't be subscribed here. Use an investor from your own workspace or contact the platform admin.",
  INVESTOR_TENANT_CHECK_FAILED: "Couldn't verify the investor's tenant — the safety check failed closed. Try again in a moment.",
  BELOW_MIN_CHECK: "Commitment is below the SPV's minimum check size.",
  EXCEEDS_CAP: "Adding this commitment would push the SPV over its cap.",
  ALREADY_SUBSCRIBED: "That investor already has an active subscription in this SPV.",
  INVALID_COMMITMENT: "Commitment must be greater than zero.",
};

function spvErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code;
  const msg = (err as { message?: string })?.message ?? "Something went wrong.";
  if (code && SPV_ERROR_TRANSLATIONS[code]) return SPV_ERROR_TRANSLATIONS[code];
  return msg;
}

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
        {canWrite && <MandatePanel spvId={spvId} mandate={detail.mandate ?? null} onChanged={onChanged} />}
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
        {canWrite && <FeePanel spvId={spvId} currency={currency} onChanged={onChanged} />}
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

        {canWrite && <SubscribePanel spvId={spvId} currency={currency} onChanged={onChanged} />}

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
          <DeployPanel spvId={spvId} currency={currency} onChanged={onChanged} />
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
        {canWrite && <RecordDistributionPanel spvId={spvId} currency={currency} onChanged={onChanged} />}
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
        {canWrite && <DocumentPanel spvId={spvId} onChanged={onChanged} />}
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
        {canWrite && <TransferPanel spvId={spvId} currency={currency} onChanged={onChanged} />}
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
        {canWrite && spv.status !== "wound_down" && <WindDownPanel spvId={spvId} onChanged={onChanged} />}
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
      // Wave C v3 hardening (GPT-5 v2 finding): use parseMinor to reject
      // exponent notation ("1e7" → 1 under-submit) and non-integer input.
      const j = await (
        await apiRequest("POST", `/api/partner/me/spv/${spvId}/subscriptions/${encodeURIComponent(row.investorId)}/confirm-funds`, {
          receivedMinor: parseMinor(received),
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
      // Wave C v3 hardening (GPT-5 v2 finding): use parseMinor to reject
      // exponent notation and non-integer input on the gross proceeds field.
      const body: Record<string, unknown> = { grossProceedsMinor: parseMinor(gross) };
      if (hurdle.trim()) body.hurdleRatePct = parsePercent(hurdle) * 100; // hurdleRatePct expected as %.
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

/* ═══════════════════════════════════════════════════════════════════════════
 * Wave C v2 — Unblock existing SPV UI (8 flows)
 *
 * Blockers fixed vs v1:
 *   • C2 Mandate: SPV_MANDATE_MODES (deal_specific/open/thesis_lp_approval/
 *     sector_restricted) from @shared/spvEngine — no more invented values.
 *     Panel now exposes companyIds, checkMinMinor, checkMaxMinor (no silent
 *     drop). ruleTree default uses key `rules` (not `clauses`) per MandateNode.
 *   • C3 Fee: SPV_FEE_TYPES (fixed/carry/hybrid). Adds layer selector
 *     defaulted to management; platform is displayed but disabled.
 *   • C4 Document: SPV_DOC_TYPES (formation/operating_agreement/subscription/
 *     formd/blue_sky/kyc/tax). Adds storageBackend + sizeBytes.
 *   • C1 Deploy: instrument selector removed (server sources instrument from
 *     the round, never trusted from client).
 *   • C6 RecordDistribution: cost basis is REQUIRED per DISTRIBUTION_BASIS_
 *     REQUIRED — panel no longer treats it as optional.
 *   • C8 Subscribe: SPV_INVESTOR_PERSONAS (collective/capavate/partner).
 *   • Numeric parsing: strict integer parser rejects "1e7", "1.5", empty.
 *   • Error toasts: spvErrorMessage() reads err.code and translates.
 *   • Accessibility: every Input carries id; every Label has htmlFor.
 *
 * All panels remain gated on canWrite (never render for read-only viewers).
 * ═══════════════════════════════════════════════════════════════════════════ */

/* useId helper is imported from react at the top of the file; if we don't
 * already have it, use useId() inline. */

/* C1 v2 — Deploy capital into a company (unblocks the disabled button). */
function DeployPanel({ spvId, currency, onChanged }: { spvId: string; currency: string; onChanged: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [companyId, setCompanyId] = useState("");
  const [companyRoundId, setCompanyRoundId] = useState("");
  const [amount, setAmount] = useState("");
  const [eligibility, setEligibility] = useState<{ eligible: boolean; reasons: string[] } | null>(null);
  const id = useId();

  const checkElig = useMutation({
    mutationFn: async () => {
      const cid = companyId.trim();
      if (!cid) throw new Error("Enter a company ID first");
      const j = await (await apiRequest("GET", `/api/partner/me/spv/${spvId}/eligibility/${encodeURIComponent(cid)}`)).json();
      return j as { eligible: boolean; reasons: string[] };
    },
    onSuccess: (r) => setEligibility(r),
    onError: (e: Error) => toast({ variant: "destructive", title: "Eligibility check failed", description: spvErrorMessage(e) }),
  });

  const deploy = useMutation({
    mutationFn: async () => {
      const cid = companyId.trim();
      const rid = companyRoundId.trim();
      if (!cid) throw new Error("Company ID required");
      if (!rid) throw new Error("Company round ID required");
      const amt = parseMinor(amount);
      if (amt <= 0) throw new Error("Amount must be greater than zero");
      await (await apiRequest("POST", `/api/partner/me/spv/${spvId}/deployments`, {
        companyId: cid,
        companyRoundId: rid,
        amountMinor: amt,
        currency,
      })).json();
    },
    onSuccess: () => {
      toast({ title: "Capital deployed", description: `${fmt(parseMinor(amount), currency)} allocated.` });
      setOpen(false);
      setCompanyId(""); setCompanyRoundId(""); setAmount(""); setEligibility(null);
      onChanged();
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Deploy failed", description: spvErrorMessage(e) }),
  });

  return (
    <div className="mt-3 border-t pt-3" data-testid="spv-deploy-affordance">
      {!open ? (
        <>
          <Button size="sm" variant="outline" data-testid="spv-deploy-action" onClick={() => setOpen(true)} title="Deploy capital into a company">
            Deploy capital
          </Button>
          <div className="text-[10px] text-[var(--cv-color-text-faint)] mt-1">
            Deploying links a company <span className="font-medium">and</span> commits an allocation amount. Eligibility is checked; the instrument comes from the selected round (not the client). Linking a target above does not move any money.
          </div>
        </>
      ) : (
        <div className="space-y-2" data-testid="spv-deploy-panel">
          <div className="font-medium text-sm">Deploy capital</div>
          <div>
            <Label htmlFor={`${id}-companyId`} className="text-[10px]">Company ID</Label>
            <Input id={`${id}-companyId`} value={companyId} onChange={(e) => { setCompanyId(e.target.value); setEligibility(null); }} data-testid="spv-deploy-company-id" placeholder="cmp_…" />
          </div>
          <div>
            <Label htmlFor={`${id}-roundId`} className="text-[10px]">Company round ID</Label>
            <Input id={`${id}-roundId`} value={companyRoundId} onChange={(e) => setCompanyRoundId(e.target.value)} data-testid="spv-deploy-round-id" placeholder="rnd_…" />
            <div className="text-[10px] text-[var(--cv-color-text-faint)]">Instrument is sourced from this round automatically.</div>
          </div>
          <div>
            <Label htmlFor={`${id}-amount`} className="text-[10px]">Amount ({currency}, minor units \u2014 whole integer only)</Label>
            <Input id={`${id}-amount`} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" pattern="[0-9]*" data-testid="spv-deploy-amount" placeholder="e.g. 5000000 = $50,000" />
            {amount && /^\d+$/.test(amount) && <div className="text-[10px] text-[var(--cv-color-text-faint)]">≈ {fmt(Number(amount), currency)}</div>}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => checkElig.mutate()} disabled={checkElig.isPending || !companyId.trim()} data-testid="spv-deploy-check-eligibility">
              {checkElig.isPending ? "Checking…" : "Check eligibility"}
            </Button>
            <Button size="sm" onClick={() => deploy.mutate()} disabled={deploy.isPending} data-testid="spv-deploy-submit">
              {deploy.isPending ? "Deploying…" : "Deploy"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setEligibility(null); }} data-testid="spv-deploy-cancel">Cancel</Button>
          </div>
          {eligibility && (
            <div
              className={`text-xs rounded p-2 ${eligibility.eligible ? "text-emerald-800" : "text-amber-900"}`}
              style={eligibility.eligible ? { background: "rgba(16,185,129,0.1)" } : { background: "rgba(245,158,11,0.1)" }}
              data-testid="spv-deploy-eligibility"
            >
              {eligibility.eligible ? "✓ Eligible per your SPV mandate." : `Not eligible: ${eligibility.reasons.join("; ") || "no reason given"}. The deploy call will fail closed unless you update the mandate.`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* C2 v2 — Update SPV mandate. Uses canonical SPV_MANDATE_MODES enum;
 *          exposes companyIds/checkMin/checkMax (no more silent drops). */
function MandatePanel({ spvId, mandate, onChanged }: { spvId: string; mandate: { mode?: string; sector?: string[]; geography?: string[]; stage?: string[]; companyIds?: string[]; checkMinMinor?: number | null; checkMaxMinor?: number | null; ruleTree?: unknown } | null; onChanged: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<string>((mandate?.mode as string) ?? SPV_MANDATE_MODES[0]);
  const [sector, setSector] = useState((mandate?.sector ?? []).join(", "));
  const [geography, setGeography] = useState((mandate?.geography ?? []).join(", "));
  const [stage, setStage] = useState((mandate?.stage ?? []).join(", "));
  const [companyIds, setCompanyIds] = useState((mandate?.companyIds ?? []).join(", "));
  const [checkMin, setCheckMin] = useState(mandate?.checkMinMinor != null ? String(mandate.checkMinMinor) : "");
  const [checkMax, setCheckMax] = useState(mandate?.checkMaxMinor != null ? String(mandate.checkMaxMinor) : "");
  const id = useId();

  const save = useMutation({
    mutationFn: async () => {
      // Preserve the existing rule tree if the caller has one; else use a
      // valid empty tree keyed by `rules` (NOT `clauses`, which fails schema).
      const ruleTree = mandate?.ruleTree ?? { op: "and", rules: [] };
      const body: Record<string, unknown> = {
        mode,
        ruleTree,
        sector: sector.split(",").map((s) => s.trim()).filter(Boolean),
        geography: geography.split(",").map((s) => s.trim()).filter(Boolean),
        stage: stage.split(",").map((s) => s.trim()).filter(Boolean),
        companyIds: companyIds.split(",").map((s) => s.trim()).filter(Boolean),
      };
      if (checkMin.trim()) body.checkMinMinor = parseMinor(checkMin);
      if (checkMax.trim()) body.checkMaxMinor = parseMinor(checkMax);
      await (await apiRequest("PUT", `/api/partner/me/spv/${spvId}/mandate`, body)).json();
    },
    onSuccess: () => {
      toast({ title: "Mandate updated" });
      setOpen(false);
      onChanged();
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Could not update mandate", description: spvErrorMessage(e) }),
  });

  return (
    <div className="mt-3 border-t pt-3" data-testid="spv-mandate-edit">
      {!open ? (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="spv-mandate-edit-open">Edit mandate</Button>
      ) : (
        <div className="space-y-2" data-testid="spv-mandate-edit-panel">
          <div className="font-medium text-sm">Update mandate</div>
          <div>
            <Label htmlFor={`${id}-mode`} className="text-[10px]">Mode</Label>
            <select id={`${id}-mode`} className="w-full text-xs border rounded px-2 py-1" value={mode} onChange={(e) => setMode(e.target.value)} data-testid="spv-mandate-mode">
              {SPV_MANDATE_MODES.map((m) => (
                <option key={m} value={m}>{SPV_MANDATE_MODE_LABELS[m as keyof typeof SPV_MANDATE_MODE_LABELS]}</option>
              ))}
            </select>
            <div className="text-[10px] text-[var(--cv-color-text-faint)]">{SPV_MANDATE_MODE_HELP[mode as keyof typeof SPV_MANDATE_MODE_HELP]}</div>
          </div>
          <div>
            <Label htmlFor={`${id}-sector`} className="text-[10px]">Sectors (comma-separated)</Label>
            <Input id={`${id}-sector`} value={sector} onChange={(e) => setSector(e.target.value)} data-testid="spv-mandate-sector" placeholder="fintech, ai, saas" />
          </div>
          <div>
            <Label htmlFor={`${id}-geo`} className="text-[10px]">Geography</Label>
            <Input id={`${id}-geo`} value={geography} onChange={(e) => setGeography(e.target.value)} data-testid="spv-mandate-geography" placeholder="US, EU, MENA" />
          </div>
          <div>
            <Label htmlFor={`${id}-stage`} className="text-[10px]">Stage</Label>
            <Input id={`${id}-stage`} value={stage} onChange={(e) => setStage(e.target.value)} data-testid="spv-mandate-stage" placeholder="seed, series-a" />
          </div>
          <div>
            <Label htmlFor={`${id}-companyIds`} className="text-[10px]">Allowlisted companies (comma-separated IDs, optional)</Label>
            <Input id={`${id}-companyIds`} value={companyIds} onChange={(e) => setCompanyIds(e.target.value)} data-testid="spv-mandate-company-ids" placeholder="cmp_abc, cmp_xyz" />
            <div className="text-[10px] text-[var(--cv-color-text-faint)]">Only companies listed here are eligible when mode is Deal-Specific or Sector-Restricted.</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor={`${id}-checkMin`} className="text-[10px]">Min check (minor units)</Label>
              <Input id={`${id}-checkMin`} value={checkMin} onChange={(e) => setCheckMin(e.target.value)} inputMode="numeric" pattern="[0-9]*" data-testid="spv-mandate-check-min" placeholder="optional" />
            </div>
            <div>
              <Label htmlFor={`${id}-checkMax`} className="text-[10px]">Max check (minor units)</Label>
              <Input id={`${id}-checkMax`} value={checkMax} onChange={(e) => setCheckMax(e.target.value)} inputMode="numeric" pattern="[0-9]*" data-testid="spv-mandate-check-max" placeholder="optional" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending} data-testid="spv-mandate-submit">
              {save.isPending ? "Saving…" : "Save mandate"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} data-testid="spv-mandate-cancel">Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* C3 v2 — Add a GP fee. Uses canonical SPV_FEE_TYPES enum. */
function FeePanel({ spvId, currency, onChanged }: { spvId: string; currency: string; onChanged: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [feeType, setFeeType] = useState<string>(SPV_FEE_TYPES[0]);
  const [fixed, setFixed] = useState("");
  const [carry, setCarry] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const id = useId();

  const showFixed = feeType === "fixed" || feeType === "hybrid";
  const showCarry = feeType === "carry" || feeType === "hybrid";

  const submit = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        layer: "management",
        feeType,
        currency,
      };
      if (showFixed) {
        if (!fixed.trim()) throw new Error(feeType === "fixed" ? "Fixed amount required for a fixed fee" : "Fixed amount required for a hybrid fee");
        body.fixedAmountMinor = parseMinor(fixed);
      }
      if (showCarry) {
        if (!carry.trim()) throw new Error(feeType === "carry" ? "Carry % required for a carry fee" : "Carry % required for a hybrid fee");
        body.carryPct = parsePercent(carry);
      }
      if (effectiveDate.trim()) body.effectiveDate = effectiveDate.trim();
      await (await apiRequest("POST", `/api/partner/me/spv/${spvId}/fees`, body)).json();
    },
    onSuccess: () => {
      toast({ title: "Fee added" });
      setOpen(false);
      setFixed(""); setCarry(""); setEffectiveDate("");
      onChanged();
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Could not add fee", description: spvErrorMessage(e) }),
  });

  const feeTypeLabels: Record<string, string> = { fixed: "Fixed amount", carry: "Carry (performance %)", hybrid: "Hybrid (fixed + carry)" };

  return (
    <div className="mt-3 border-t pt-3" data-testid="spv-fee-add">
      {!open ? (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="spv-fee-add-open">Add GP fee</Button>
      ) : (
        <div className="space-y-2" data-testid="spv-fee-add-panel">
          <div className="font-medium text-sm">Add GP fee (Management layer)</div>
          <div className="text-[10px] text-[var(--cv-color-text-faint)]">
            Platform-layer fees are set by Capavate and cannot be added here.
          </div>
          <div>
            <Label htmlFor={`${id}-feeType`} className="text-[10px]">Fee type</Label>
            <select id={`${id}-feeType`} className="w-full text-xs border rounded px-2 py-1" value={feeType} onChange={(e) => setFeeType(e.target.value)} data-testid="spv-fee-type">
              {SPV_FEE_TYPES.map((t) => <option key={t} value={t}>{feeTypeLabels[t] ?? t}</option>)}
            </select>
          </div>
          {showFixed && (
            <div>
              <Label htmlFor={`${id}-fixed`} className="text-[10px]">Fixed amount ({currency}, minor units)</Label>
              <Input id={`${id}-fixed`} value={fixed} onChange={(e) => setFixed(e.target.value)} inputMode="numeric" pattern="[0-9]*" data-testid="spv-fee-fixed" />
              {fixed && /^\d+$/.test(fixed) && <div className="text-[10px] text-[var(--cv-color-text-faint)]">≈ {fmt(Number(fixed), currency)}</div>}
            </div>
          )}
          {showCarry && (
            <div>
              <Label htmlFor={`${id}-carry`} className="text-[10px]">Carry / performance % (0–100)</Label>
              <Input id={`${id}-carry`} value={carry} onChange={(e) => setCarry(e.target.value)} inputMode="decimal" data-testid="spv-fee-carry" placeholder="e.g. 20" />
            </div>
          )}
          <div>
            <Label htmlFor={`${id}-eff`} className="text-[10px]">Effective date (optional)</Label>
            <Input id={`${id}-eff`} value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} type="date" data-testid="spv-fee-effective" />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => submit.mutate()} disabled={submit.isPending} data-testid="spv-fee-submit">
              {submit.isPending ? "Adding…" : "Add fee"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} data-testid="spv-fee-cancel">Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* C4 v2 — Register a document. Uses canonical SPV_DOC_TYPES enum;
 *          exposes storageBackend + sizeBytes (no more silent drops). */
function DocumentPanel({ spvId, onChanged }: { spvId: string; onChanged: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [docType, setDocType] = useState<string>(SPV_DOC_TYPES[0]);
  const [title, setTitle] = useState("");
  const [storageKey, setStorageKey] = useState("");
  const [storageBackend, setStorageBackend] = useState("s3");
  const [contentType, setContentType] = useState("application/pdf");
  const [sizeBytes, setSizeBytes] = useState("");
  const [expiry, setExpiry] = useState("");
  const id = useId();

  const submit = useMutation({
    mutationFn: async () => {
      if (!storageKey.trim()) throw new Error("Storage key required (upload the file first, then paste the returned key)");
      const body: Record<string, unknown> = {
        docType,
        title: title.trim() || undefined,
        storageKey: storageKey.trim(),
        storageBackend: storageBackend.trim() || undefined,
        contentType: contentType.trim() || undefined,
      };
      if (sizeBytes.trim()) body.sizeBytes = parseMinor(sizeBytes);
      if (expiry.trim()) body.expiry = expiry.trim();
      await (await apiRequest("POST", `/api/partner/me/spv/${spvId}/documents`, body)).json();
    },
    onSuccess: () => {
      toast({ title: "Document registered" });
      setOpen(false);
      setTitle(""); setStorageKey(""); setSizeBytes(""); setExpiry("");
      onChanged();
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Could not register document", description: spvErrorMessage(e) }),
  });

  const docTypeLabels: Record<string, string> = {
    formation: "Formation",
    operating_agreement: "Operating agreement",
    subscription: "Subscription agreement",
    formd: "Form D",
    blue_sky: "Blue-sky filing",
    kyc: "KYC package",
    tax: "Tax (K-1 / other)",
  };

  return (
    <div className="mt-3 border-t pt-3" data-testid="spv-document-add">
      {!open ? (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="spv-document-add-open">Register document</Button>
      ) : (
        <div className="space-y-2" data-testid="spv-document-add-panel">
          <div className="font-medium text-sm">Register document</div>
          <div>
            <Label htmlFor={`${id}-type`} className="text-[10px]">Type</Label>
            <select id={`${id}-type`} className="w-full text-xs border rounded px-2 py-1" value={docType} onChange={(e) => setDocType(e.target.value)} data-testid="spv-document-type">
              {SPV_DOC_TYPES.map((t) => <option key={t} value={t}>{docTypeLabels[t] ?? t}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor={`${id}-title`} className="text-[10px]">Title (optional)</Label>
            <Input id={`${id}-title`} value={title} onChange={(e) => setTitle(e.target.value)} data-testid="spv-document-title" placeholder="Q3 2026 Report" />
          </div>
          <div>
            <Label htmlFor={`${id}-storageKey`} className="text-[10px]">Storage key</Label>
            <Input id={`${id}-storageKey`} value={storageKey} onChange={(e) => setStorageKey(e.target.value)} data-testid="spv-document-storage-key" placeholder="documents/spv-xxx/file.pdf" />
            <div className="text-[10px] text-[var(--cv-color-text-faint)]">The storage key returned after you upload the file.</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor={`${id}-backend`} className="text-[10px]">Storage backend</Label>
              <select id={`${id}-backend`} className="w-full text-xs border rounded px-2 py-1" value={storageBackend} onChange={(e) => setStorageBackend(e.target.value)} data-testid="spv-document-storage-backend">
                <option value="s3">S3</option>
                <option value="gcs">GCS</option>
                <option value="azure">Azure Blob</option>
                <option value="local">Local</option>
              </select>
            </div>
            <div>
              <Label htmlFor={`${id}-ct`} className="text-[10px]">Content type</Label>
              <Input id={`${id}-ct`} value={contentType} onChange={(e) => setContentType(e.target.value)} data-testid="spv-document-content-type" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor={`${id}-size`} className="text-[10px]">Size (bytes, optional)</Label>
              <Input id={`${id}-size`} value={sizeBytes} onChange={(e) => setSizeBytes(e.target.value)} inputMode="numeric" pattern="[0-9]*" data-testid="spv-document-size-bytes" />
            </div>
            <div>
              <Label htmlFor={`${id}-expiry`} className="text-[10px]">Expiry (optional)</Label>
              <Input id={`${id}-expiry`} value={expiry} onChange={(e) => setExpiry(e.target.value)} type="date" data-testid="spv-document-expiry" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => submit.mutate()} disabled={submit.isPending} data-testid="spv-document-submit">
              {submit.isPending ? "Registering…" : "Register"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} data-testid="spv-document-cancel">Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* C5 v2 — Record a secondary transfer (MODEL only — no money movement). */
function TransferPanel({ spvId, currency, onChanged }: { spvId: string; currency: string; onChanged: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState("");
  const [unitsPct, setUnitsPct] = useState("");
  const id = useId();

  const submit = useMutation({
    mutationFn: async () => {
      const f = fromId.trim(); const t = toId.trim();
      if (!f || !t) throw new Error("Both investor IDs are required");
      if (f === t) throw new Error("From and To investors must differ");
      const body: Record<string, unknown> = {
        fromInvestorId: f,
        toInvestorId: t,
        currency,
      };
      if (amount.trim()) body.amountMinor = parseMinor(amount);
      if (unitsPct.trim()) body.unitsPct = parsePercent(unitsPct);
      if (!body.amountMinor && !body.unitsPct) throw new Error("Enter an amount OR a units percentage");
      await (await apiRequest("POST", `/api/partner/me/spv/${spvId}/transfers`, body)).json();
    },
    onSuccess: () => {
      toast({ title: "Transfer recorded", description: "Model only — no money has moved." });
      setOpen(false);
      setFromId(""); setToId(""); setAmount(""); setUnitsPct("");
      onChanged();
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Could not record transfer", description: spvErrorMessage(e) }),
  });

  return (
    <div className="mt-3 border-t pt-3" data-testid="spv-transfer-add">
      {!open ? (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="spv-transfer-add-open">Record transfer</Button>
      ) : (
        <div className="space-y-2" data-testid="spv-transfer-add-panel">
          <div className="font-medium text-sm">Record secondary transfer</div>
          <div className="text-[10px] text-[var(--cv-color-text-faint)]">Model-only. No cash moves; this updates the ownership register once approved by the GP.</div>
          <div>
            <Label htmlFor={`${id}-from`} className="text-[10px]">From investor ID</Label>
            <Input id={`${id}-from`} value={fromId} onChange={(e) => setFromId(e.target.value)} data-testid="spv-transfer-from" />
          </div>
          <div>
            <Label htmlFor={`${id}-to`} className="text-[10px]">To investor ID</Label>
            <Input id={`${id}-to`} value={toId} onChange={(e) => setToId(e.target.value)} data-testid="spv-transfer-to" />
          </div>
          <div>
            <Label htmlFor={`${id}-amt`} className="text-[10px]">Amount ({currency}, minor units)</Label>
            <Input id={`${id}-amt`} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" pattern="[0-9]*" data-testid="spv-transfer-amount" placeholder="or leave blank and use % below" />
          </div>
          <div>
            <Label htmlFor={`${id}-pct`} className="text-[10px]">Units % (0–100)</Label>
            <Input id={`${id}-pct`} value={unitsPct} onChange={(e) => setUnitsPct(e.target.value)} inputMode="decimal" data-testid="spv-transfer-units-pct" placeholder="e.g. 50 = half the LP's holdings" />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => submit.mutate()} disabled={submit.isPending} data-testid="spv-transfer-submit">
              {submit.isPending ? "Recording…" : "Record"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} data-testid="spv-transfer-cancel">Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* C6 v2 — Record a real distribution. Cost basis is REQUIRED (server rule). */
function RecordDistributionPanel({ spvId, currency, onChanged }: { spvId: string; currency: string; onChanged: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [event, setEvent] = useState("exit");
  const [gross, setGross] = useState("");
  const [costBasis, setCostBasis] = useState("");
  const [outcome, setOutcome] = useState<"succeeded" | "failed">("succeeded");
  const id = useId();

  const submit = useMutation({
    mutationFn: async () => {
      const g = parseMinor(gross);
      const cb = parseMinor(costBasis); // REQUIRED — server rejects if missing.
      const body: Record<string, unknown> = {
        event: event.trim() || "exit",
        grossProceedsMinor: g,
        costBasisMinor: cb,
        currency,
        collectionOutcome: outcome,
      };
      await (await apiRequest("POST", `/api/partner/me/spv/${spvId}/distributions`, body)).json();
    },
    onSuccess: () => {
      toast({ title: "Distribution recorded" });
      setOpen(false);
      setGross(""); setCostBasis("");
      onChanged();
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Could not record distribution", description: spvErrorMessage(e) }),
  });

  return (
    <div className="mt-3 border-t pt-3" data-testid="spv-distribution-record">
      {!open ? (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="spv-distribution-record-open">Record distribution</Button>
      ) : (
        <div className="space-y-2" data-testid="spv-distribution-record-panel">
          <div className="font-medium text-sm">Record distribution</div>
          <div className="text-[10px] text-[var(--cv-color-text-faint)]">Writes to the ledger. The waterfall computes LP / GP / platform splits automatically. Cost basis is required for accurate carry — never assumed.</div>
          <div>
            <Label htmlFor={`${id}-event`} className="text-[10px]">Event type</Label>
            <select id={`${id}-event`} className="w-full text-xs border rounded px-2 py-1" value={event} onChange={(e) => setEvent(e.target.value)} data-testid="spv-distribution-event">
              <option value="exit">Full exit</option>
              <option value="partial_exit">Partial exit</option>
              <option value="dividend">Dividend</option>
              <option value="tender">Tender / secondary</option>
              <option value="return_of_capital">Return of capital</option>
            </select>
          </div>
          <div>
            <Label htmlFor={`${id}-gross`} className="text-[10px]">Gross proceeds ({currency}, minor units)</Label>
            <Input id={`${id}-gross`} value={gross} onChange={(e) => setGross(e.target.value)} inputMode="numeric" pattern="[0-9]*" data-testid="spv-distribution-gross" />
            {gross && /^\d+$/.test(gross) && <div className="text-[10px] text-[var(--cv-color-text-faint)]">≈ {fmt(Number(gross), currency)}</div>}
          </div>
          <div>
            <Label htmlFor={`${id}-cb`} className="text-[10px]">Cost basis <span className="text-red-700">(required)</span> — minor units</Label>
            <Input id={`${id}-cb`} value={costBasis} onChange={(e) => setCostBasis(e.target.value)} inputMode="numeric" pattern="[0-9]*" data-testid="spv-distribution-cost-basis" />
            {costBasis && /^\d+$/.test(costBasis) && <div className="text-[10px] text-[var(--cv-color-text-faint)]">≈ {fmt(Number(costBasis), currency)}</div>}
            <div className="text-[10px] text-[var(--cv-color-text-faint)]">The total capital originally deployed (used to compute profit for carry).</div>
          </div>
          <div>
            <Label htmlFor={`${id}-outcome`} className="text-[10px]">Collection outcome</Label>
            <select id={`${id}-outcome`} className="w-full text-xs border rounded px-2 py-1" value={outcome} onChange={(e) => setOutcome(e.target.value as "succeeded" | "failed")} data-testid="spv-distribution-outcome">
              <option value="succeeded">Collected</option>
              <option value="failed">Failed / uncollected</option>
            </select>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => submit.mutate()} disabled={submit.isPending} data-testid="spv-distribution-submit">
              {submit.isPending ? "Recording…" : "Record"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} data-testid="spv-distribution-cancel">Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* C7 v2 — Wind down the SPV (managing_partner only). Two-step confirmation. */
function WindDownPanel({ spvId, onChanged }: { spvId: string; onChanged: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const CONFIRM_PHRASE = "WIND DOWN";
  const id = useId();

  const submit = useMutation({
    mutationFn: async () => {
      if (confirm.trim() !== CONFIRM_PHRASE) throw new Error(`Type "${CONFIRM_PHRASE}" to confirm`);
      await (await apiRequest("POST", `/api/partner/me/spv/${spvId}/wind-down`, {})).json();
    },
    onSuccess: () => {
      toast({ title: "SPV wound down", description: "The SPV is now archived. No further changes." });
      setOpen(false);
      setConfirm("");
      onChanged();
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Could not wind down", description: spvErrorMessage(e) }),
  });

  return (
    <div className="mt-3 border-t pt-3" data-testid="spv-winddown-action">
      {!open ? (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="spv-winddown-open">Wind down SPV</Button>
      ) : (
        <div className="space-y-2" data-testid="spv-winddown-panel">
          <div className="font-medium text-sm text-amber-900">Wind down SPV</div>
          <div
            className="text-xs rounded p-2 text-amber-900"
            style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)" }}
          >
            This archives the SPV. Reports remain viewable, but no further capital calls, distributions, or transfers can be recorded. Only a Managing Partner can perform this action.
          </div>
          <div>
            <Label htmlFor={`${id}-confirm`} className="text-[10px]">Type <span className="font-mono font-medium">{CONFIRM_PHRASE}</span> to confirm</Label>
            <Input id={`${id}-confirm`} value={confirm} onChange={(e) => setConfirm(e.target.value)} data-testid="spv-winddown-confirm" />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => submit.mutate()} disabled={submit.isPending || confirm.trim() !== CONFIRM_PHRASE} data-testid="spv-winddown-submit">
              {submit.isPending ? "Winding down…" : "Wind down"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setConfirm(""); }} data-testid="spv-winddown-cancel">Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* C8 v2 — Add a subscription. Uses SPV_INVESTOR_PERSONAS enum. */
function SubscribePanel({ spvId, currency, onChanged }: { spvId: string; currency: string; onChanged: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [investorId, setInvestorId] = useState("");
  const [commitment, setCommitment] = useState("");
  const [persona, setPersona] = useState<string>(SPV_INVESTOR_PERSONAS[0]);
  const id = useId();

  const submit = useMutation({
    mutationFn: async () => {
      const iid = investorId.trim();
      if (!iid) throw new Error("Investor ID required");
      const amt = parseMinor(commitment);
      if (amt <= 0) throw new Error("Commitment must be greater than zero");
      await (await apiRequest("POST", `/api/partner/me/spv/${spvId}/subscriptions`, {
        investorId: iid,
        commitmentMinor: amt,
        currency,
        investorPersona: persona,
      })).json();
    },
    onSuccess: () => {
      toast({ title: "Subscription added" });
      setOpen(false);
      setInvestorId(""); setCommitment("");
      onChanged();
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Could not add subscription", description: spvErrorMessage(e) }),
  });

  const personaLabels: Record<string, string> = {
    collective: "Collective member (Capavate-managed)",
    capavate: "Direct Capavate investor",
    partner: "Partner-network investor",
  };

  return (
    <div className="mt-3 border-t pt-3" data-testid="spv-subscription-add">
      {!open ? (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="spv-subscription-add-open">Add LP subscription</Button>
      ) : (
        <div className="space-y-2" data-testid="spv-subscription-add-panel">
          <div className="font-medium text-sm">Add LP subscription</div>
          <div className="text-[10px] text-[var(--cv-color-text-faint)]">Creates a subscription in "review" state. The LP then signs, funds, and is confirmed.</div>
          <div>
            <Label htmlFor={`${id}-inv`} className="text-[10px]">Investor ID</Label>
            <Input id={`${id}-inv`} value={investorId} onChange={(e) => setInvestorId(e.target.value)} data-testid="spv-subscription-investor-id" placeholder="inv_…" />
          </div>
          <div>
            <Label htmlFor={`${id}-commit`} className="text-[10px]">Commitment ({currency}, minor units)</Label>
            <Input id={`${id}-commit`} value={commitment} onChange={(e) => setCommitment(e.target.value)} inputMode="numeric" pattern="[0-9]*" data-testid="spv-subscription-commitment" />
            {commitment && /^\d+$/.test(commitment) && <div className="text-[10px] text-[var(--cv-color-text-faint)]">≈ {fmt(Number(commitment), currency)}</div>}
          </div>
          <div>
            <Label htmlFor={`${id}-persona`} className="text-[10px]">Investor persona</Label>
            <select id={`${id}-persona`} className="w-full text-xs border rounded px-2 py-1" value={persona} onChange={(e) => setPersona(e.target.value)} data-testid="spv-subscription-persona">
              {SPV_INVESTOR_PERSONAS.map((p) => <option key={p} value={p}>{personaLabels[p] ?? p}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => submit.mutate()} disabled={submit.isPending} data-testid="spv-subscription-submit">
              {submit.isPending ? "Adding…" : "Add subscription"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} data-testid="spv-subscription-cancel">Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
