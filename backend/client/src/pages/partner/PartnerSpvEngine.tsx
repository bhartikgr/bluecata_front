/**
 * v25.49 Phase-4 — CANONICAL SPV Engine surface (GP context).
 * v25.50.0 Phase 4 (spec 3a–3o) — wizard overhaul: marketing copy, country
 * jurisdiction dropdown (+ Other), 5 SPV types & 4 mandate modes with help,
 * mandatory mandate description, sector multi-select bound to the canonical
 * COLLECTIVE_SECTORS_45 + sub-sector, currency-aware amount labels + currency
 * dropdowns, relabelled distribution scopes, carry-basis moved into the Terms
 * step, an optional terms-doc link, and a full Review & launch step with
 * per-section edit affordances.
 *
 * Added ADDITIVELY alongside the legacy PartnerSpvs/PartnerFunds record-keeping
 * pages (Sacred Rule #78 — nothing removed). New descriptive fields are stored
 * on the SPV's existing `terms` JSON blob (mandateDescription, subSector,
 * jurisdictionCountry, jurisdictionOther, termsDocRef) — the store already
 * round-trips `terms_json`, so no schema churn is required.
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
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { COLLECTIVE_SECTORS_45 } from "@shared/schema";
import { buildCurrencyOptions } from "@/lib/currencyOptions";
import {
  SPV_JURISDICTIONS,
  SPV_CARRY_BASES,
  SPV_CARRY_BASIS_HELP,
  SPV_TYPES,
  SPV_TYPE_LABELS,
  SPV_TYPE_HELP,
  SPV_MANDATE_MODES,
  SPV_MANDATE_MODE_LABELS,
  SPV_MANDATE_MODE_HELP,
  SPV_TOP_JURISDICTION_COUNTRIES,
  SPV_JURISDICTION_ENTITY_STRUCTURES,
  SPV_DISTRIBUTION_SCOPE_WIZARD_OPTIONS,
  type SpvDTO,
} from "@shared/spvEngine";

function fmt(minor: number | null, currency: string) {
  if (minor == null) return "—";
  return formatMinorLib(minor, currency, { locale: "en-US" });
}

const NAVY = "var(--cv-color-navy)";
const STEPS = ["Name & jurisdiction", "Mandate", "Fees", "Terms", "Review & launch"] as const;
const CURRENCY_OPTIONS = buildCurrencyOptions();
const MANDATE_DESCRIPTION_MAX = 1200;

interface WizardState {
  name: string;
  jurisdiction: string;          // legal-entity enum (engine-required)
  jurisdictionCountry: string;   // 3b — country jurisdiction (top-15 or "__other__")
  jurisdictionOther: string;     // 3b — free text when "Other"
  legalEntityStructure: string;  // 2a — dependent on jurisdictionCountry; stored on terms.legalEntityStructure
  legalEntityStructureOther: string; // 2a — free text when structure is "Other (specify)" or country is Other
  spvType: string;
  carryBasis: string;            // NO default — must be chosen (now in Terms step)
  distributionScope: string;
  lpVisibility: string;          // own_only (default) | co_investors
  targetRaiseMinor: string;
  minCheckMinor: string;
  capMinor: string;
  currency: string;
  mandateMode: string;
  mandateDescription: string;    // 3e — mandatory
  sectors: string[];             // 3f — multi-select (COLLECTIVE_SECTORS_45)
  subSector: string;             // 3f — optional free text
  mgmtFeeType: string;
  mgmtFixedMinor: string;
  mgmtCarryPct: string;
  feeCurrency: string;           // 3g — fixed/hybrid fee currency
  termsDocRef: string;           // 3m — optional terms doc link/ref
  closeDate: string;
}

const OTHER = "__other__";

const EMPTY_WIZARD: WizardState = {
  name: "", jurisdiction: "delaware", jurisdictionCountry: "United States", jurisdictionOther: "",
  legalEntityStructure: SPV_JURISDICTION_ENTITY_STRUCTURES["United States"][0],
  legalEntityStructureOther: "",
  spvType: "spv", carryBasis: "", distributionScope: "network", lpVisibility: "own_only",
  targetRaiseMinor: "0", minCheckMinor: "0", capMinor: "0", currency: "USD",
  mandateMode: "deal_specific", mandateDescription: "", sectors: [], subSector: "",
  mgmtFeeType: "carry", mgmtFixedMinor: "0", mgmtCarryPct: "20", feeCurrency: "USD",
  termsDocRef: "", closeDate: "",
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

  // 3p-b — push a launched SPV into (or out of) the Collective deal pipeline by
  // flipping its distribution scope. Discovery + fail-closed visibility are
  // enforced server-side by listVisibleForContext (private/invite_only are never
  // broadcast; network/collective_only surface on /api/collective/spvs). The
  // standard per-SPV Collective deployment fee (consortium.spv_deployment_fee)
  // is resolved at deployment time by spvDeploymentStore — no client math.
  const setScope = useMutation({
    mutationFn: async (v: { id: string; distributionScope: string }) =>
      (await apiRequest("PATCH", `/api/partner/me/spv/${v.id}`, { distributionScope: v.distributionScope })).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/partner/me/spv"] });
      toast({ title: "Distribution scope updated" });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Could not update scope", description: e.message }),
  });

  const create = useMutation({
    mutationFn: async () => {
      // Descriptive fields ride on the SPV's `terms` JSON blob (round-tripped by
      // the store as terms_json) — no schema churn required.
      const jurisdictionCountry = w.jurisdictionCountry === OTHER ? w.jurisdictionOther.trim() : w.jurisdictionCountry;
      // 2a — resolve the dependent legal-entity structure ADDITIVELY (the strict
      // `jurisdiction` enum stays untouched). Free-text when the country is
      // "Other" or the chosen structure is "Other (specify)".
      const legalEntityStructure =
        w.jurisdictionCountry === OTHER || w.legalEntityStructure === "Other (specify)"
          ? w.legalEntityStructureOther.trim()
          : w.legalEntityStructure;
      const terms = {
        mandateDescription: w.mandateDescription.trim(),
        subSector: w.subSector.trim() || null,
        jurisdictionCountry: jurisdictionCountry || null,
        jurisdictionOther: w.jurisdictionCountry === OTHER ? w.jurisdictionOther.trim() : null,
        legalEntityStructure: legalEntityStructure || null,
        termsDocRef: w.termsDocRef.trim() || null,
      };
      const spvRes = await apiRequest("POST", "/api/partner/me/spv", {
        name: w.name, jurisdiction: w.jurisdiction, spvType: w.spvType,
        carryBasis: w.carryBasis, distributionScope: w.distributionScope,
        lpVisibility: w.lpVisibility,
        targetRaiseMinor: parseInt(w.targetRaiseMinor || "0", 10),
        minCheckMinor: parseInt(w.minCheckMinor || "0", 10),
        capMinor: parseInt(w.capMinor || "0", 10),
        currency: w.currency, closeDate: w.closeDate || null, status: "open",
        terms,
      });
      const { spv } = await spvRes.json();
      await apiRequest("PUT", `/api/partner/me/spv/${spv.id}/mandate`, {
        mode: w.mandateMode,
        sector: w.sectors,
        ruleTree: w.sectors.length
          ? { op: "and", rules: [{ field: "sector", op: "in", value: w.sectors }] }
          : { op: "and", rules: [{ field: "company_id", op: "in", value: [] }] },
      });
      if (w.mgmtFeeType) {
        await apiRequest("POST", `/api/partner/me/spv/${spv.id}/fees`, {
          layer: "management", feeType: w.mgmtFeeType,
          fixedAmountMinor: w.mgmtFeeType !== "carry" ? parseInt(w.mgmtFixedMinor || "0", 10) : undefined,
          carryPct: w.mgmtFeeType !== "fixed" ? Number(w.mgmtCarryPct) / 100 : undefined,
          // 3g — fixed/hybrid fees carry their own currency selection.
          currency: w.mgmtFeeType !== "carry" ? w.feeCurrency : undefined,
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

  const jurisdictionCountryValid = w.jurisdictionCountry === OTHER ? !!w.jurisdictionOther.trim() : !!w.jurisdictionCountry;
  // 2a — entity-structure options for the currently selected country. Empty for
  // the free-text "Other" jurisdiction (the engine's strict enum is separate).
  const entityStructureOptions = w.jurisdictionCountry === OTHER ? [] : (SPV_JURISDICTION_ENTITY_STRUCTURES[w.jurisdictionCountry] ?? []);
  const entityStructureIsFreeText = w.jurisdictionCountry === OTHER || w.legalEntityStructure === "Other (specify)";
  // 2a — on country change, RESET the entity structure to the new list's first
  // option (or clear for the free-text "Other" jurisdiction).
  const onJurisdictionCountryChange = (country: string) =>
    setW((prev) => ({
      ...prev,
      jurisdictionCountry: country,
      legalEntityStructure: country === OTHER ? "" : (SPV_JURISDICTION_ENTITY_STRUCTURES[country]?.[0] ?? ""),
      legalEntityStructureOther: "",
    }));
  const canAdvance = (): boolean => {
    if (step === 0) return !!w.name.trim() && !!w.jurisdiction && jurisdictionCountryValid;
    if (step === 1) return !!w.mandateMode && !!w.mandateDescription.trim(); // 3e mandatory
    if (step === 2) return !!w.mgmtFeeType;
    if (step === 3) return !!w.carryBasis && !!w.distributionScope; // 3o carry basis moved here
    return true;
  };
  const toggleSector = (s: string) =>
    setW((prev) => ({ ...prev, sectors: prev.sectors.includes(s) ? prev.sectors.filter((x) => x !== s) : [...prev.sectors, s] }));

  const amountLabel = (base: string) => `${base} (${w.currency})`;
  const juruDisplay = w.jurisdictionCountry === OTHER ? (w.jurisdictionOther || "Other") : w.jurisdictionCountry;
  const legalEntityDisplay = entityStructureIsFreeText ? w.legalEntityStructureOther : w.legalEntityStructure;
  // B2 — a short per-SPV-type reminder shown on the Review step.
  const SPV_TYPE_REVIEW_NOTE: Record<string, string> = {
    syndicate: "Syndicate: a lead + backers co-invest per deal — carry typically accrues to the lead.",
    rolling_fund: "Rolling Fund: raises and deploys in recurring quarterly cycles rather than a single close.",
  };

  return (
    <PartnerShell title="SPV Engine" tier={me.tier} subRole={me.subRole} partnerName={me.identity.name}>
      {/* 3a — marketing copy */}
      <div className="mb-4 rounded-lg p-4" style={{ background: "rgba(4,30,65,0.05)", border: `1px solid rgba(4,30,65,0.2)`, color: NAVY }} data-testid="spv-engine-intro">
        <div className="font-semibold text-base mb-1">Launch and run your own investment vehicles</div>
        <p className="text-sm">
          The SPV Engine lets your firm spin up special-purpose vehicles, syndicates, and funds — you are always the GP.
          Define the mandate, set your fees and carry, invite LPs, and deploy capital into companies with a single
          cap-table line written through Capavate’s ledger. Vehicles you launch can stay private, go invite-only, or be
          discoverable across the Collective network. Legacy SPV/Fund records have been migrated in and appear below.
        </p>
      </div>

      {canWrite && !wizardOpen && (
        <Button data-testid="spv-engine-new" onClick={() => { setWizardOpen(true); setStep(0); }} style={{ background: NAVY }}>
          Create SPV
        </Button>
      )}

      {wizardOpen && (
        <Card className="p-4 my-4 space-y-4" data-testid="spv-wizard">
          <div className="flex gap-2 text-xs flex-wrap" data-testid="spv-wizard-steps">
            {STEPS.map((label, i) => (
              <button
                type="button"
                key={label}
                onClick={() => setStep(i)}
                className="px-2 py-1 rounded"
                style={{ background: i === step ? NAVY : "rgba(4,30,65,0.08)", color: i === step ? "#fff" : NAVY }}
                data-testid={`spv-wizard-step-tab-${i}`}
              >
                {i + 1}. {label}
              </button>
            ))}
          </div>

          {step === 0 && (
            <div className="space-y-3" data-testid="spv-wizard-step-0">
              <div><Label>SPV name *</Label><Input data-testid="spv-w-name" value={w.name} onChange={(e) => setW({ ...w, name: e.target.value })} /></div>
              {/* B1 — inline error so the GP knows WHY Next is disabled */}
              {!w.name.trim() && (
                <div className="text-xs text-rose-600" data-testid="spv-w-name-error">
                  An SPV name is required before you can continue.
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  {/* 3c — SPV type: 5 choices w/ help */}
                  <Label>SPV type</Label>
                  <select data-testid="spv-w-type" className="w-full border rounded h-9 px-2" value={w.spvType} onChange={(e) => setW({ ...w, spvType: e.target.value })}>
                    {SPV_TYPES.map((t) => <option key={t} value={t}>{SPV_TYPE_LABELS[t]}</option>)}
                  </select>
                  <div className="text-xs text-[var(--cv-color-text-muted)] mt-1">{SPV_TYPE_HELP[w.spvType as keyof typeof SPV_TYPE_HELP]}</div>
                </div>
                <div>
                  {/* 3b — country jurisdiction dropdown (top-15) + Other, MANDATORY */}
                  <Label>Jurisdiction (country) *</Label>
                  <select data-testid="spv-w-jurisdiction-country" className="w-full border rounded h-9 px-2" value={w.jurisdictionCountry} onChange={(e) => onJurisdictionCountryChange(e.target.value)}>
                    {SPV_TOP_JURISDICTION_COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    <option value={OTHER}>Other jurisdiction…</option>
                  </select>
                  {w.jurisdictionCountry === OTHER && (
                    <Input className="mt-2" data-testid="spv-w-jurisdiction-other" placeholder="Enter jurisdiction" value={w.jurisdictionOther} onChange={(e) => setW({ ...w, jurisdictionOther: e.target.value })} />
                  )}
                  {/* B1 — inline error for the mandatory country jurisdiction */}
                  {!jurisdictionCountryValid && (
                    <div className="text-xs text-rose-600 mt-1" data-testid="spv-w-jurisdiction-country-error">
                      A jurisdiction is required before you can continue.
                    </div>
                  )}
                </div>
              </div>
              {/* 2a — dependent Legal entity structure, driven by the selected
                  country. Stored ADDITIVELY on terms.legalEntityStructure. */}
              <div>
                <Label>Legal entity structure</Label>
                {entityStructureOptions.length > 0 ? (
                  <select data-testid="spv-w-legal-entity-structure" className="w-full border rounded h-9 px-2" value={w.legalEntityStructure} onChange={(e) => setW({ ...w, legalEntityStructure: e.target.value, legalEntityStructureOther: "" })}>
                    {entityStructureOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : null}
                {entityStructureIsFreeText && (
                  <Input
                    className="mt-2"
                    data-testid="spv-w-legal-entity-structure-other"
                    placeholder="Specify the legal entity structure"
                    value={w.legalEntityStructureOther}
                    onChange={(e) => setW({ ...w, legalEntityStructureOther: e.target.value })}
                  />
                )}
              </div>
              {/* Engine legal-entity type — the strict SPV_JURISDICTIONS enum the
                  store still validates (kept separate per spec 3b / rule #8). */}
              <div>
                <Label>Engine legal-entity type</Label>
                <select data-testid="spv-w-jurisdiction" className="w-full border rounded h-9 px-2" value={w.jurisdiction} onChange={(e) => setW({ ...w, jurisdiction: e.target.value })}>
                  {SPV_JURISDICTIONS.map((j) => <option key={j} value={j}>{j}</option>)}
                </select>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3" data-testid="spv-wizard-step-1">
              <div>
                {/* 3d — mandate mode: 4 choices w/ help */}
                <Label>Mandate mode</Label>
                <select data-testid="spv-w-mode" className="w-full border rounded h-9 px-2" value={w.mandateMode} onChange={(e) => setW({ ...w, mandateMode: e.target.value })}>
                  {SPV_MANDATE_MODES.map((m) => <option key={m} value={m}>{SPV_MANDATE_MODE_LABELS[m]}</option>)}
                </select>
                <div className="text-xs text-[var(--cv-color-text-muted)] mt-1">{SPV_MANDATE_MODE_HELP[w.mandateMode as keyof typeof SPV_MANDATE_MODE_HELP]}</div>
              </div>
              {/* 3e — mandate description, mandatory, max 1200 */}
              <div>
                <Label>Description of mandate *</Label>
                <Textarea
                  data-testid="spv-w-mandate-desc"
                  rows={4}
                  maxLength={MANDATE_DESCRIPTION_MAX}
                  value={w.mandateDescription}
                  onChange={(e) => setW({ ...w, mandateDescription: e.target.value.slice(0, MANDATE_DESCRIPTION_MAX) })}
                  placeholder="Describe what this vehicle will invest in, the thesis, and any restrictions…"
                />
                <div className="text-[10px] text-[var(--cv-color-text-faint)] text-right">{w.mandateDescription.length}/{MANDATE_DESCRIPTION_MAX}</div>
                {/* W2-E — inline error so the user knows WHY Next is disabled */}
                {!w.mandateDescription.trim() && (
                  <div className="text-xs text-rose-600 mt-1" data-testid="spv-w-mandate-desc-error">
                    A description of the mandate is required before you can continue.
                  </div>
                )}
              </div>
              {/* 3f — sectors multi-select from COLLECTIVE_SECTORS_45 + sub-sector */}
              <div>
                <Label>Sectors</Label>
                <div className="flex flex-wrap gap-1 mt-1 max-h-40 overflow-auto border rounded p-2" data-testid="spv-w-sectors">
                  {COLLECTIVE_SECTORS_45.map((s) => (
                    <button
                      type="button"
                      key={s}
                      onClick={() => toggleSector(s)}
                      data-testid={`spv-w-sector-${s}`}
                      className="text-[11px] rounded-full px-2 py-0.5 border"
                      style={w.sectors.includes(s) ? { background: NAVY, color: "#fff", borderColor: NAVY } : {}}
                    >{s}</button>
                  ))}
                </div>
              </div>
              <div><Label>Sub-sector (optional)</Label><Input data-testid="spv-w-subsector" value={w.subSector} onChange={(e) => setW({ ...w, subSector: e.target.value })} placeholder="e.g. embedded payments" /></div>
              <p className="text-xs text-[var(--cv-color-text-muted)]">Only active, paid Capavate companies with a valid M&amp;A profile and an open round can ever match — eligibility is fail-closed.</p>
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
              {w.mgmtFeeType !== "carry" && (
                <div className="grid grid-cols-2 gap-3">
                  {/* 3h/3i — clear currency-unit label instead of raw "minor" */}
                  <div><Label>{amountLabel("Fixed fee amount")}</Label><Input data-testid="spv-w-fixed" type="number" value={w.mgmtFixedMinor} onChange={(e) => setW({ ...w, mgmtFixedMinor: e.target.value })} /></div>
                  {/* 3g — fee currency selector for fixed/hybrid */}
                  <div>
                    <Label>Fee currency</Label>
                    <select data-testid="spv-w-fee-currency" className="w-full border rounded h-9 px-2" value={w.feeCurrency} onChange={(e) => setW({ ...w, feeCurrency: e.target.value })}>
                      {CURRENCY_OPTIONS.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
                    </select>
                  </div>
                </div>
              )}
              {w.mgmtFeeType !== "fixed" && <div><Label>Carry %</Label><Input data-testid="spv-w-carrypct" type="number" value={w.mgmtCarryPct} onChange={(e) => setW({ ...w, mgmtCarryPct: e.target.value })} /></div>}
              <p className="text-xs text-[var(--cv-color-text-muted)]">The platform fee layer is set by Capavate and is read-only to you.</p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3" data-testid="spv-wizard-step-3">
              <div className="grid grid-cols-2 gap-3">
                {/* 3h/3i — amounts labelled with the selected currency, stored as minor */}
                <div><Label>{amountLabel("Target raise")}</Label><Input data-testid="spv-w-target" type="number" value={w.targetRaiseMinor} onChange={(e) => setW({ ...w, targetRaiseMinor: e.target.value })} /></div>
                <div><Label>{amountLabel("Min check")}</Label><Input data-testid="spv-w-mincheck" type="number" value={w.minCheckMinor} onChange={(e) => setW({ ...w, minCheckMinor: e.target.value })} /></div>
                <div><Label>{amountLabel("Cap")}</Label><Input data-testid="spv-w-cap" type="number" value={w.capMinor} onChange={(e) => setW({ ...w, capMinor: e.target.value })} /></div>
                {/* 3k/3l — currency dropdown instead of free text */}
                <div>
                  <Label>Currency</Label>
                  <select data-testid="spv-w-currency" className="w-full border rounded h-9 px-2" value={w.currency} onChange={(e) => setW({ ...w, currency: e.target.value })}>
                    {CURRENCY_OPTIONS.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
                  </select>
                </div>
              </div>
              {/* 3j — relabelled distribution scopes */}
              <div>
                <Label>Distribution scope</Label>
                <select data-testid="spv-w-scope" className="w-full border rounded h-9 px-2" value={w.distributionScope} onChange={(e) => setW({ ...w, distributionScope: e.target.value })}>
                  {SPV_DISTRIBUTION_SCOPE_WIZARD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <div className="text-xs text-[var(--cv-color-text-muted)] mt-1">{SPV_DISTRIBUTION_SCOPE_WIZARD_OPTIONS.find((o) => o.value === w.distributionScope)?.help}</div>
              </div>
              {/* 3n — co-investor visibility toggle */}
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
                  <div className="text-xs text-[var(--cv-color-text-muted)]">Off = each investor sees only their own position. On = a transparent club deal where LPs see each other's names &amp; commitments. The founder never sees the investor list either way.</div>
                </div>
              </div>
              {/* 3o — carry basis moved into Terms, fuller descriptions */}
              <div>
                <Label>Carry basis — choose one (required)</Label>
                <div className="space-y-2 mt-1">
                  {SPV_CARRY_BASES.map((cb) => (
                    <label key={cb} className="flex gap-2 items-start p-2 border rounded cursor-pointer" data-testid={`spv-w-carrybasis-${cb}`} style={{ borderColor: w.carryBasis === cb ? NAVY : undefined }}>
                      <input type="radio" name="carryBasis" checked={w.carryBasis === cb} onChange={() => setW({ ...w, carryBasis: cb })} />
                      <span><span className="font-medium">{cb === "per_deployment" ? "Per deployment" : "Whole SPV"}</span><br /><span className="text-xs text-[var(--cv-color-text-muted)]">{SPV_CARRY_BASIS_HELP[cb]}</span></span>
                    </label>
                  ))}
                </div>
                {/* W2-E — inline error so the user knows WHY Next/Launch is disabled */}
                {!w.carryBasis && (
                  <div className="text-xs text-rose-600 mt-1" data-testid="spv-w-carrybasis-error">
                    Choose a carry basis to continue.
                  </div>
                )}
              </div>
              {/* 3m — optional terms document link/ref */}
              <div><Label>Terms document link (optional)</Label><Input data-testid="spv-w-terms-doc" value={w.termsDocRef} onChange={(e) => setW({ ...w, termsDocRef: e.target.value })} placeholder="https://… or a stored document reference" /></div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3 text-sm" data-testid="spv-wizard-step-4">
              <div className="font-medium text-base">Review &amp; launch</div>
              <ReviewRow label="Name" value={w.name || "(unnamed)"} onEdit={() => setStep(0)} />
              <ReviewRow label="SPV type" value={SPV_TYPE_LABELS[w.spvType as keyof typeof SPV_TYPE_LABELS]} onEdit={() => setStep(0)} />
              <ReviewRow label="Jurisdiction (country)" value={juruDisplay} onEdit={() => setStep(0)} />
              <ReviewRow label="Legal entity structure" value={legalEntityDisplay || "—"} onEdit={() => setStep(0)} />
              <ReviewRow label="Engine legal-entity type" value={w.jurisdiction} onEdit={() => setStep(0)} />
              <ReviewRow label="Mandate mode" value={SPV_MANDATE_MODE_LABELS[w.mandateMode as keyof typeof SPV_MANDATE_MODE_LABELS]} onEdit={() => setStep(1)} />
              <ReviewRow label="Mandate" value={w.mandateDescription || "—"} onEdit={() => setStep(1)} />
              {/* B2 — friendlier empty-sectors copy instead of a bare em-dash */}
              <ReviewRow label="Sectors" value={w.sectors.length ? w.sectors.join(", ") : "None / No sectors selected"} onEdit={() => setStep(1)} />
              {w.subSector && <ReviewRow label="Sub-sector" value={w.subSector} onEdit={() => setStep(1)} />}
              <ReviewRow
                label="Management fee"
                value={w.mgmtFeeType === "carry" ? `Carry ${w.mgmtCarryPct}%` : w.mgmtFeeType === "fixed" ? `${fmt(parseInt(w.mgmtFixedMinor || "0", 10), w.feeCurrency)} fixed` : `${fmt(parseInt(w.mgmtFixedMinor || "0", 10), w.feeCurrency)} + ${w.mgmtCarryPct}% carry`}
                onEdit={() => setStep(2)}
              />
              <ReviewRow label="Target raise" value={fmt(parseInt(w.targetRaiseMinor || "0", 10), w.currency)} onEdit={() => setStep(3)} />
              <ReviewRow label="Distribution scope" value={SPV_DISTRIBUTION_SCOPE_WIZARD_OPTIONS.find((o) => o.value === w.distributionScope)?.label ?? w.distributionScope} onEdit={() => setStep(3)} />
              <ReviewRow label="Co-investor visibility" value={w.lpVisibility === "co_investors" ? "On (club deal)" : "Off (own only)"} onEdit={() => setStep(3)} />
              <ReviewRow label="Carry basis" value={w.carryBasis ? (w.carryBasis === "per_deployment" ? "Per deployment" : "Whole SPV") : "— (required)"} onEdit={() => setStep(3)} />
              {w.termsDocRef && <ReviewRow label="Terms doc" value={w.termsDocRef} onEdit={() => setStep(3)} />}
              {/* B2 — per-SPV-type helper note (Syndicate, Rolling Fund) */}
              {SPV_TYPE_REVIEW_NOTE[w.spvType] && (
                <div className="text-xs text-[var(--cv-color-text-muted)] rounded p-2" style={{ background: "rgba(4,30,65,0.05)" }} data-testid="spv-review-type-note">
                  {SPV_TYPE_REVIEW_NOTE[w.spvType]}
                </div>
              )}
              {!w.carryBasis && <div className="text-xs text-rose-600">Choose a carry basis in the Terms step before launching.</div>}
            </div>
          )}

          <div className="flex justify-between pt-2">
            <Button variant="outline" data-testid="spv-wizard-back" onClick={() => (step === 0 ? setWizardOpen(false) : setStep(step - 1))}>
              {step === 0 ? "Cancel" : "Back"}
            </Button>
            {step < STEPS.length - 1 ? (
              <Button data-testid="spv-wizard-next" disabled={!canAdvance()} onClick={() => setStep(step + 1)} style={{ background: NAVY }}>Next</Button>
            ) : (
              <Button data-testid="spv-wizard-launch" disabled={!w.carryBasis || create.isPending} onClick={() => create.mutate()} style={{ background: NAVY }}>
                {create.isPending ? "Launching…" : "Launch SPV"}
              </Button>
            )}
          </div>
        </Card>
      )}

      {list.isLoading && <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="spv-engine-loading">Loading…</div>}
      {!list.isLoading && spvs.length === 0 && (
        <PartnerEmptyState title="No SPVs yet" description="Create your first SPV with the 5-step wizard." />
      )}

      {spvs.length > 0 && (
        <div className="space-y-2 mt-4" data-testid="spv-engine-list">
          {spvs.map((s) => (
            <Card key={s.id} className="p-3 cursor-pointer hover:bg-[var(--cv-color-surface-2)]" data-testid={`spv-row-${s.id}`} onClick={() => setSelectedId(s.id === selectedId ? null : s.id)}>
              <div className="flex justify-between items-center">
                <div>
                  <div className="font-medium">{s.name} {s.migratedFrom && <span className="text-[10px] px-1 rounded" style={{ background: "rgba(4,30,65,0.1)", color: NAVY }}>migrated</span>}</div>
                  <div className="text-xs text-[var(--cv-color-text-muted)]">{(SPV_TYPE_LABELS as Record<string, string>)[s.spvType] ?? s.spvType} · {s.status} · {s.distributionScope} · carry {s.carryBasis}</div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right font-mono">{fmt(s.targetRaiseMinor, s.currency)}</div>
                  {canWrite && (
                    <Button
                      variant="outline"
                      data-testid={`spv-publish-toggle-${s.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        const onCollective = s.distributionScope === "network" || s.distributionScope === "collective_only";
                        setScope.mutate({ id: s.id, distributionScope: onCollective ? "private" : "network" });
                      }}
                      disabled={setScope.isPending}
                    >
                      {s.distributionScope === "network" || s.distributionScope === "collective_only" ? "Make private" : "Publish to Collective"}
                    </Button>
                  )}
                </div>
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

function ReviewRow({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return (
    <div className="flex justify-between items-start gap-3 border-b pb-1" data-testid={`spv-review-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
      <div className="text-[var(--cv-color-text-muted)] min-w-[140px]">{label}</div>
      <div className="flex-1 break-words">{value}</div>
      <button type="button" className="text-xs underline text-[color:var(--cv-color-primary)]" onClick={onEdit}>Edit</button>
    </div>
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
        {fees.length === 0 ? <div className="text-xs text-[var(--cv-color-text-faint)]">none</div> : fees.map((f, i) => (
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
        {register.length === 0 ? <div className="text-xs text-[var(--cv-color-text-faint)]">no LPs yet</div> : register.map((r) => (
          <div key={r.investorId} className="text-xs">{r.investorId}: {fmt(r.commitmentMinor, currency)} ({(r.ownershipPct * 100).toFixed(1)}%)</div>
        ))}
      </div>
      <div data-testid="spv-detail-deployments">
        <div className="font-medium">Deployments</div>
        {deployments.length === 0 ? <div className="text-xs text-[var(--cv-color-text-faint)]">none</div> : deployments.map((d, i) => (
          <div key={i} className="text-xs">{d.companyId}: {fmt(d.amountMinor, currency)} · {d.status}</div>
        ))}
      </div>
      <div data-testid="spv-detail-distributions" className="col-span-2">
        <div className="font-medium">Distributions</div>
        {distributions.length === 0 ? <div className="text-xs text-[var(--cv-color-text-faint)]">none</div> : distributions.map((d, i) => (
          <div key={i} className="text-xs">{d.event}: gross {fmt(d.grossProceedsMinor, currency)} · GP carry {fmt(d.gpCarryMinor, currency)} · platform carry {fmt(d.platformCarryMinor, currency)}</div>
        ))}
      </div>
    </div>
  );
}
