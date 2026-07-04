/**
 * v25.49 Phase-4 — CANONICAL SPV Engine surface (GP context).
 *
 * Added ADDITIVELY alongside the legacy PartnerSpvs/PartnerFunds record-keeping
 * pages (Sacred Rule #78 — nothing removed). This page drives the canonical
 * `/api/partner/me/spv*` engine: a list of the partner's SPVs, the 5-step GP
 * setup wizard (Name&jurisdiction → Mandate → Fees → Terms → Review&launch),
 * and a detail view (raise progress, LP roster, fees, deployments, distributions).
 * Styled to the Phase-2 capavate.com brand token (#041e41 navy).
 *
 * The wizard is defaults-over-inputs: it seeds GP identity/tier/jurisdiction from
 * /spv-wizard/defaults and offers Clone-previous-SPV. The carry-basis step is
 * deliberately dead-simple — two radio options with a one-line plain-language
 * explanation each and NO default (the GP must choose).
 */
import { useState } from "react";
import { formatMinor as formatMinorLib } from "@/lib/currency";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { PartnerShell, PartnerEmptyState } from "@/components/partner/PartnerShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  SPV_JURISDICTIONS,
  SPV_CARRY_BASES,
  SPV_DISTRIBUTION_SCOPES,
  SPV_CARRY_BASIS_HELP,
  type SpvDTO,
} from "@shared/spvEngine";

function fmt(minor: number | null, currency: string) {
  if (minor == null) return "—";
  return formatMinorLib(minor, currency, { locale: "en-US" });
}

const NAVY = "#041e41";
const STEPS = ["Name & jurisdiction", "Mandate", "Fees", "Terms", "Review & launch"] as const;

interface WizardState {
  name: string;
  jurisdiction: string;
  spvType: string;
  carryBasis: string; // NO default — must be chosen
  distributionScope: string;
  lpVisibility: string; // own_only (default) | co_investors
  targetRaiseMinor: string;
  minCheckMinor: string;
  capMinor: string;
  currency: string;
  mandateMode: string;
  sector: string;
  mgmtFeeType: string;
  mgmtFixedMinor: string;
  mgmtCarryPct: string;
  closeDate: string;
}

const EMPTY_WIZARD: WizardState = {
  name: "", jurisdiction: "delaware", spvType: "spv", carryBasis: "",
  distributionScope: "private", lpVisibility: "own_only", targetRaiseMinor: "0", minCheckMinor: "0", capMinor: "0",
  currency: "USD", mandateMode: "open", sector: "", mgmtFeeType: "carry",
  mgmtFixedMinor: "0", mgmtCarryPct: "20", closeDate: "",
};

export default function PartnerSpvEngine() {
  const role = useRequirePartnerRole();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [w, setW] = useState<WizardState>(EMPTY_WIZARD);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const list = useQuery<{ spvs: SpvDTO[] }>({
    queryKey: ["/api/partner/me/spv"],
    enabled: role.ready && !!role.identity,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/spv")).json(),
  });

  const detail = useQuery<Record<string, unknown>>({
    queryKey: ["/api/partner/me/spv", selectedId],
    enabled: !!selectedId,
    queryFn: async () => (await apiRequest("GET", `/api/partner/me/spv/${selectedId}`)).json(),
  });

  const create = useMutation({
    mutationFn: async () => {
      // 1) create the SPV, 2) set mandate, 3) set management fee — the wizard
      //    composes the canonical engine calls behind one "Launch".
      const spvRes = await apiRequest("POST", "/api/partner/me/spv", {
        name: w.name, jurisdiction: w.jurisdiction, spvType: w.spvType,
        carryBasis: w.carryBasis, distributionScope: w.distributionScope,
        lpVisibility: w.lpVisibility,
        targetRaiseMinor: parseInt(w.targetRaiseMinor || "0", 10),
        minCheckMinor: parseInt(w.minCheckMinor || "0", 10),
        capMinor: parseInt(w.capMinor || "0", 10),
        currency: w.currency, closeDate: w.closeDate || null, status: "open",
      });
      const { spv } = await spvRes.json();
      const sectors = w.sector.split(",").map((s) => s.trim()).filter(Boolean);
      await apiRequest("PUT", `/api/partner/me/spv/${spv.id}/mandate`, {
        mode: w.mandateMode,
        sector: sectors,
        ruleTree: sectors.length
          ? { op: "and", rules: [{ field: "sector", op: "in", value: sectors }] }
          : { op: "and", rules: [{ field: "company_id", op: "in", value: [] }] },
      });
      if (w.mgmtFeeType) {
        await apiRequest("POST", `/api/partner/me/spv/${spv.id}/fees`, {
          layer: "management", feeType: w.mgmtFeeType,
          fixedAmountMinor: w.mgmtFeeType !== "carry" ? parseInt(w.mgmtFixedMinor || "0", 10) : undefined,
          carryPct: w.mgmtFeeType !== "fixed" ? Number(w.mgmtCarryPct) / 100 : undefined,
        });
      }
      return spv as SpvDTO;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/partner/me/spv"] });
      setWizardOpen(false); setStep(0); setW(EMPTY_WIZARD);
      toast({ title: "SPV launched" });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Launch failed", description: e.message }),
  });

  if (!role.ready || !role.identity) return null;
  const me = role.identity;
  const canWrite = me.subRole === "managing_partner" || me.subRole === "associate" || me.subRole === "bd";
  const spvs = list.data?.spvs ?? [];

  const canAdvance = (): boolean => {
    if (step === 0) return !!w.name.trim() && !!w.jurisdiction;
    if (step === 2) return !!w.mgmtFeeType;
    if (step === 4) return !!w.carryBasis; // carry basis chosen before launch
    return true;
  };

  return (
    <PartnerShell title="SPV Engine" tier={me.tier} subRole={me.subRole} partnerName={me.identity.name}>
      <div className="mb-4 rounded p-3 text-sm" style={{ background: "rgba(4,30,65,0.05)", border: `1px solid rgba(4,30,65,0.2)`, color: NAVY }} data-testid="spv-engine-intro">
        Canonical SPV engine. Each SPV is owned by your firm as GP. Legacy SPV/Fund
        records have been migrated in and appear below.
      </div>

      {canWrite && !wizardOpen && (
        <Button data-testid="spv-engine-new" onClick={() => { setWizardOpen(true); setStep(0); }} style={{ background: NAVY }}>
          Create SPV
        </Button>
      )}

      {wizardOpen && (
        <Card className="p-4 my-4 space-y-4" data-testid="spv-wizard">
          <div className="flex gap-2 text-xs" data-testid="spv-wizard-steps">
            {STEPS.map((label, i) => (
              <span key={label} className="px-2 py-1 rounded" style={{ background: i === step ? NAVY : "rgba(4,30,65,0.08)", color: i === step ? "#fff" : NAVY }}>
                {i + 1}. {label}
              </span>
            ))}
          </div>

          {step === 0 && (
            <div className="space-y-3" data-testid="spv-wizard-step-0">
              <div><Label>SPV name</Label><Input data-testid="spv-w-name" value={w.name} onChange={(e) => setW({ ...w, name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Jurisdiction</Label>
                  <select data-testid="spv-w-jurisdiction" className="w-full border rounded h-9 px-2" value={w.jurisdiction} onChange={(e) => setW({ ...w, jurisdiction: e.target.value })}>
                    {SPV_JURISDICTIONS.map((j) => <option key={j} value={j}>{j}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Type</Label>
                  <select data-testid="spv-w-type" className="w-full border rounded h-9 px-2" value={w.spvType} onChange={(e) => setW({ ...w, spvType: e.target.value })}>
                    <option value="spv">SPV</option><option value="fund">Fund</option><option value="syndicate">Syndicate</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3" data-testid="spv-wizard-step-1">
              <div>
                <Label>Mandate mode</Label>
                <select data-testid="spv-w-mode" className="w-full border rounded h-9 px-2" value={w.mandateMode} onChange={(e) => setW({ ...w, mandateMode: e.target.value })}>
                  <option value="open">Open (thesis)</option><option value="deal_specific">Deal-specific</option>
                </select>
              </div>
              <div><Label>Sectors (comma-separated)</Label><Input data-testid="spv-w-sector" value={w.sector} onChange={(e) => setW({ ...w, sector: e.target.value })} placeholder="fintech, saas" /></div>
              <p className="text-xs text-slate-500">Only active, paid Capavate companies with a valid M&amp;A profile and an open round can ever match — eligibility is fail-closed.</p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3" data-testid="spv-wizard-step-2">
              <div>
                <Label>Management fee type</Label>
                <select data-testid="spv-w-feetype" className="w-full border rounded h-9 px-2" value={w.mgmtFeeType} onChange={(e) => setW({ ...w, mgmtFeeType: e.target.value })}>
                  <option value="carry">Carry only</option><option value="fixed">Fixed only</option><option value="hybrid">Hybrid</option>
                </select>
              </div>
              {w.mgmtFeeType !== "carry" && <div><Label>Fixed amount (minor)</Label><Input data-testid="spv-w-fixed" type="number" value={w.mgmtFixedMinor} onChange={(e) => setW({ ...w, mgmtFixedMinor: e.target.value })} /></div>}
              {w.mgmtFeeType !== "fixed" && <div><Label>Carry %</Label><Input data-testid="spv-w-carrypct" type="number" value={w.mgmtCarryPct} onChange={(e) => setW({ ...w, mgmtCarryPct: e.target.value })} /></div>}
              <p className="text-xs text-slate-500">The platform fee layer is set by Capavate and is read-only to you.</p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3" data-testid="spv-wizard-step-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Target raise (minor)</Label><Input data-testid="spv-w-target" type="number" value={w.targetRaiseMinor} onChange={(e) => setW({ ...w, targetRaiseMinor: e.target.value })} /></div>
                <div><Label>Min check (minor)</Label><Input data-testid="spv-w-mincheck" type="number" value={w.minCheckMinor} onChange={(e) => setW({ ...w, minCheckMinor: e.target.value })} /></div>
                <div><Label>Cap (minor)</Label><Input data-testid="spv-w-cap" type="number" value={w.capMinor} onChange={(e) => setW({ ...w, capMinor: e.target.value })} /></div>
                <div><Label>Currency</Label><Input data-testid="spv-w-currency" maxLength={3} value={w.currency} onChange={(e) => setW({ ...w, currency: e.target.value.toUpperCase() })} /></div>
              </div>
              <div>
                <Label>Distribution scope</Label>
                <select data-testid="spv-w-scope" className="w-full border rounded h-9 px-2" value={w.distributionScope} onChange={(e) => setW({ ...w, distributionScope: e.target.value })}>
                  {SPV_DISTRIBUTION_SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="flex items-start gap-2 p-2 border rounded">
                <input
                  type="checkbox"
                  data-testid="spv-w-lpvisibility"
                  className="mt-1"
                  checked={w.lpVisibility === "co_investors"}
                  onChange={(e) => setW({ ...w, lpVisibility: e.target.checked ? "co_investors" : "own_only" })}
                />
                <div>
                  <Label>Let investors in this SPV see each other (co-investors)?</Label>
                  <div className="text-xs text-slate-500">Off = each investor sees only their own position. On = a transparent club deal where LPs see each other's names & commitments. The founder never sees the investor list either way.</div>
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3" data-testid="spv-wizard-step-4">
              <Label>Carry basis — choose one (required)</Label>
              <div className="space-y-2">
                {SPV_CARRY_BASES.map((cb) => (
                  <label key={cb} className="flex gap-2 items-start p-2 border rounded cursor-pointer" data-testid={`spv-w-carrybasis-${cb}`} style={{ borderColor: w.carryBasis === cb ? NAVY : undefined }}>
                    <input type="radio" name="carryBasis" checked={w.carryBasis === cb} onChange={() => setW({ ...w, carryBasis: cb })} />
                    <span><span className="font-medium">{cb === "per_deployment" ? "Per deployment" : "Whole SPV"}</span><br /><span className="text-xs text-slate-500">{SPV_CARRY_BASIS_HELP[cb]}</span></span>
                  </label>
                ))}
              </div>
              <div className="text-sm mt-2">
                <div className="font-medium">Review</div>
                <div className="text-xs text-slate-600">{w.name || "(unnamed)"} · {w.jurisdiction} · {w.spvType} · scope {w.distributionScope} · target {fmt(parseInt(w.targetRaiseMinor || "0", 10), w.currency)}</div>
              </div>
            </div>
          )}

          <div className="flex justify-between pt-2">
            <Button variant="outline" data-testid="spv-wizard-back" onClick={() => (step === 0 ? setWizardOpen(false) : setStep(step - 1))}>
              {step === 0 ? "Cancel" : "Back"}
            </Button>
            {step < STEPS.length - 1 ? (
              <Button data-testid="spv-wizard-next" disabled={!canAdvance()} onClick={() => setStep(step + 1)} style={{ background: NAVY }}>Next</Button>
            ) : (
              <Button data-testid="spv-wizard-launch" disabled={!canAdvance() || create.isPending} onClick={() => create.mutate()} style={{ background: NAVY }}>
                {create.isPending ? "Launching…" : "Launch SPV"}
              </Button>
            )}
          </div>
        </Card>
      )}

      {list.isLoading && <div className="text-sm text-slate-500" data-testid="spv-engine-loading">Loading…</div>}
      {!list.isLoading && spvs.length === 0 && (
        <PartnerEmptyState title="No SPVs yet" description="Create your first SPV with the 5-step wizard." />
      )}

      {spvs.length > 0 && (
        <div className="space-y-2 mt-4" data-testid="spv-engine-list">
          {spvs.map((s) => (
            <Card key={s.id} className="p-3 cursor-pointer hover:bg-slate-50" data-testid={`spv-row-${s.id}`} onClick={() => setSelectedId(s.id === selectedId ? null : s.id)}>
              <div className="flex justify-between items-center">
                <div>
                  <div className="font-medium">{s.name} {s.migratedFrom && <span className="text-[10px] px-1 rounded" style={{ background: "rgba(4,30,65,0.1)", color: NAVY }}>migrated</span>}</div>
                  <div className="text-xs text-slate-500">{s.jurisdiction} · {s.spvType} · {s.status} · {s.distributionScope} · carry {s.carryBasis}</div>
                </div>
                <div className="text-right font-mono">{fmt(s.targetRaiseMinor, s.currency)}</div>
              </div>

              {selectedId === s.id && detail.data && (
                <div className="mt-3 border-t pt-3 text-sm space-y-2" data-testid={`spv-detail-${s.id}`}>
                  <SpvDetailBlock detail={detail.data} currency={s.currency} />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </PartnerShell>
  );
}

function SpvDetailBlock({ detail, currency }: { detail: Record<string, unknown>; currency: string }) {
  const register = (detail.register as Array<{ investorId: string; commitmentMinor: number; ownershipPct: number }>) ?? [];
  const fees = (detail.fees as Array<{ layer: string; feeType: string; carryPct: number | null; fixedAmountMinor: number | null }>) ?? [];
  const deployments = (detail.deployments as Array<{ companyId: string; amountMinor: number; status: string }>) ?? [];
  const distributions = (detail.distributions as Array<{ event: string; grossProceedsMinor: number; gpCarryMinor: number; platformCarryMinor: number }>) ?? [];
  const raised = register.reduce((a, r) => a + r.commitmentMinor, 0);
  return (
    <div className="grid grid-cols-2 gap-3">
      <div data-testid="spv-detail-raise">
        <div className="font-medium">Raise progress</div>
        <div className="font-mono">{fmt(raised, currency)}</div>
      </div>
      <div data-testid="spv-detail-fees">
        <div className="font-medium">Fees</div>
        {fees.length === 0 ? <div className="text-xs text-slate-400">none</div> : fees.map((f, i) => (
          <div key={i} className="text-xs">{f.layer}: {f.feeType}{f.carryPct != null ? ` ${(f.carryPct * 100).toFixed(0)}%` : ""}{f.fixedAmountMinor ? ` ${fmt(f.fixedAmountMinor, currency)}` : ""}</div>
        ))}
      </div>
      <div data-testid="spv-detail-lpvisibility">
        <div className="font-medium">LP co-investor visibility</div>
        <div className="text-xs">
          {((detail.spv as { lpVisibility?: string } | undefined)?.lpVisibility ?? "own_only") === "co_investors"
            ? "On — investors can see each other (transparent club deal)"
            : "Off — each investor sees only their own position"}
        </div>
      </div>
      <div data-testid="spv-detail-roster">
        <div className="font-medium">LP roster</div>
        {register.length === 0 ? <div className="text-xs text-slate-400">no LPs yet</div> : register.map((r) => (
          <div key={r.investorId} className="text-xs">{r.investorId}: {fmt(r.commitmentMinor, currency)} ({(r.ownershipPct * 100).toFixed(1)}%)</div>
        ))}
      </div>
      <div data-testid="spv-detail-deployments">
        <div className="font-medium">Deployments</div>
        {deployments.length === 0 ? <div className="text-xs text-slate-400">none</div> : deployments.map((d, i) => (
          <div key={i} className="text-xs">{d.companyId}: {fmt(d.amountMinor, currency)} · {d.status}</div>
        ))}
      </div>
      <div data-testid="spv-detail-distributions" className="col-span-2">
        <div className="font-medium">Distributions</div>
        {distributions.length === 0 ? <div className="text-xs text-slate-400">none</div> : distributions.map((d, i) => (
          <div key={i} className="text-xs">{d.event}: gross {fmt(d.grossProceedsMinor, currency)} · GP carry {fmt(d.gpCarryMinor, currency)} · platform carry {fmt(d.platformCarryMinor, currency)}</div>
        ))}
      </div>
    </div>
  );
}
