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
import { useCollectiveStream } from "@/lib/sseClient"; /* WAVE 18 / XT-7 */
import { formatMinor as formatMinorLib, toMinor } from "@/lib/currency";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter"; /* SC-2 (WAVE 2) — inbound link to the SPV detail route */
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { PartnerShell, PartnerEmptyState } from "@/components/partner/PartnerShell";
import { SpvDetailTabs, type SpvDetail } from "@/components/partner/SpvDetailTabs"; /* W-FIX1f SPV-UI-1 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { COLLECTIVE_SECTORS_45 } from "@shared/schema";
import { buildCurrencyOptions } from "@/lib/currencyOptions";
import { SPV_EDU } from "@/lib/spvEducation"; /* WAVE 8 / ORP-063 */
import { labelFor, CARRY_BASIS_LABELS, DISTRIBUTION_SCOPE_LABELS } from "@/lib/collectiveLabels"; /* W3.6 */
import {
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
  SPV_JURISDICTION_LABELS,
  resolveSpvJurisdiction,
  spvJurisdictionDisplay, /* WAVE 40 / F-3 — single jurisdiction precedence */
  type SpvDTO,
  type SpvJurisdiction,
} from "@shared/spvEngine";

/**
 * WAVE 3C / J-4 — the SPV accordion row never rendered the vehicle's
 * jurisdiction at all; it only existed on the standalone detail page. A GP
 * reviewing a list of vehicles could not tell a Delaware LLC from a Cayman
 * exempted company. Prefer the GP-entered `terms.jurisdictionCountry` (the
 * more specific value, and the one the enum is now reconciled against by
 * scripts/backfill_spv_jurisdiction.ts) and fall back to the enum column.
 */
/* WAVE 40 / F-3 — delegated to the shared resolver. This function's exact rules
   (country-first, free text shown as typed, no "delaware" fallback) were the
   CORRECT ones; they were just implemented only here, while PartnerSpvDetail read
   the enum column alone — which is why one vehicle read "British Virgin Islands"
   on this card and "United States (Delaware)" on its own page. The body moved
   verbatim into `spvJurisdictionDisplay()` (shared/spvEngine.ts) and all three
   SPV surfaces now call that, so the two reads cannot disagree again. */
function jurisdictionLabelFor(s: SpvDTO): string {
  return spvJurisdictionDisplay(s).label;
}

/**
 * WAVE 7B V-1 (DEF-085) — vintage year, read from the SAME `terms.vintage` key
 * both writers use: the admin create route
 * (server/lib/partnerFeeAdminRoutes.ts:391, always an integer) and, as of this
 * wave, the partner wizard above. Legacy rows written before either writer
 * existed carry nothing, so a missing value renders as an em-dash rather than
 * a guess. Tolerant of a string year for rows a hand-edit may have left behind.
 */
function spvVintageLabel(s: SpvDTO): string {
  const v = (s.terms as { vintage?: unknown } | null)?.vintage;
  if (typeof v === "number" && Number.isInteger(v)) return String(v);
  if (typeof v === "string" && /^\d{4}$/.test(v.trim())) return v.trim();
  return "\u2014";
}

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
  /* WAVE 7B V-1 (DEF-085) — vintage year. Stored on `terms.vintage`, which is
     the SAME key the admin create route already writes
     (server/lib/partnerFeeAdminRoutes.ts:391) and the SAME key the admin
     partner detail already reads (PartnerDetail.tsx:865). Deliberately NOT a
     new key: a second name for one concept is how this field got lost. */
  vintage: string;
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
  // D2 — optional mandate refinements (engine already supports these). All blank
  // by default and never required; sent only when provided.
  geography: string;             // comma-separated regions → mandate.geography[]
  stage: string;                 // comma-separated stages → mandate.stage[]
  checkMinMajor: string;         // optional min check (major units) → checkMinMinor
  checkMaxMajor: string;         // optional max check (major units) → checkMaxMinor
  targetCompanyId: string;       // SPV-BUG-4 — optional target company link (NO allocation)
  // D3 — optional waterfall inputs (blank default; feed the optional tiers).
  hurdleRatePct: string;         // optional preferred-return hurdle %
  gpCommitMajor: string;         // optional GP commitment (major units)
  termsDocRef: string;           // 3m — optional terms doc link/ref
  closeDate: string;
  // 1c — launch sign-off (typed full legal name + explicit attestation ack).
  signoffLegalName: string;
  signoffAccepted: boolean;
}

const OTHER = "__other__";

/** D2 — split an optional comma/newline list into a trimmed, de-duped array. */
function splitList(raw: string): string[] {
  return Array.from(
    new Set(
      raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean),
    ),
  );
}

/**
 * 1c — the versioned launch attestation text shown to the signer. Must match
 * server/spvLaunchSignoffStore.ts ATTESTATION_TEXT_V1 (the server records the
 * canonical text; this is the presentation copy for the same version). If the
 * server bumps the version, update this string to match.
 */
const ATTESTATION_TEXT_V1 =
  "I certify that I am authorized to launch this special-purpose vehicle on " +
  "behalf of this Consortium Partner. I confirm that the information entered " +
  "— including jurisdiction, legal structure, mandate, fees, carry, and terms " +
  "— is accurate and complete to the best of my knowledge. I understand this " +
  "action creates a recorded, timestamped commitment on the Capavate " +
  "platform, and I consent to the use of my electronic signature as the legal " +
  "equivalent of a handwritten signature under applicable e-signature law " +
  "(ESIGN/UETA).";

/**
 * 1e — Derive the strict engine legal-entity enum (SPV_JURISDICTIONS) from the
 * user-chosen country. The standalone "Engine legal-entity type" field was
 * redundant with "Jurisdiction (country)" + "Legal entity structure", so it is
 * removed from the UI and auto-derived here.
 *
 * WAVE 3C / J-1 — the four hard-coded `case` arms and the
 * `default: return "delaware"` are GONE. They collapsed all eleven remaining
 * ontology countries onto Delaware, which is what put SEC/Form-D copy on a
 * Dutch B.V. and a BVI company. The enum is now wide enough to hold every
 * ontology country, and `resolveSpvJurisdiction` (shared/spvEngine.ts) is the
 * single mapper: an unknown/free-text country resolves to the explicit
 * "other" member, never to a US jurisdiction. The store still accepts the
 * result because every value it can return is a valid enum member.
 */
function deriveEngineJurisdiction(country: string): string {
  return resolveSpvJurisdiction(country);
}

const EMPTY_WIZARD: WizardState = {
  name: "", jurisdiction: "delaware", jurisdictionCountry: "United States", jurisdictionOther: "",
  legalEntityStructure: SPV_JURISDICTION_ENTITY_STRUCTURES["United States"][0],
  legalEntityStructureOther: "",
  /* V-1 — defaults to the current year, exactly like the admin form
     (PartnerDetail.tsx:190). Editable; validated as a 4-digit year. */
  vintage: String(new Date().getFullYear()),
  spvType: "spv", carryBasis: "", distributionScope: "network", lpVisibility: "own_only",
  targetRaiseMinor: "0", minCheckMinor: "0", capMinor: "0", currency: "USD",
  mandateMode: "deal_specific", mandateDescription: "", sectors: [], subSector: "",
  mgmtFeeType: "carry", mgmtFixedMinor: "0", mgmtCarryPct: "20", feeCurrency: "USD",
  geography: "", stage: "", checkMinMajor: "", checkMaxMajor: "", targetCompanyId: "",
  hurdleRatePct: "", gpCommitMajor: "",
  termsDocRef: "", closeDate: "",
  signoffLegalName: "", signoffAccepted: false,
};

export default function PartnerSpvEngine() {
  const role = useRequirePartnerRole();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [w, setW] = useState<WizardState>(EMPTY_WIZARD);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /* WAVE 40 — which tab the NEXT mount of <SpvDetailTabs> should open on, and
     for which vehicle. Scoped by id on purpose: a request to land on "lps" for
     one SPV must not silently change where a different SPV's card opens. When
     the id does not match, `initialTab` is undefined and SpvDetailTabs keeps its
     own "overview" default — so the plain card click behaves exactly as before
     this wave. */
  const [selectedTab, setSelectedTab] = useState<{ id: string; tab: string } | null>(null);

  const list = useQuery<{ spvs: SpvDTO[] }>({
    queryKey: ["/api/partner/me/spv"],
    enabled: role.ready && !!role.identity,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/spv")).json(),
  });

  /* WAVE 8 / ORP-030 — GET /api/partner/me/spv-wizard/defaults
     (server/spvEngineRoutes.ts:140) existed, was partner-authenticated, and had
     ZERO client callers, so the wizard's whole reason for being
     "defaults-over-inputs" was dead: the GP could not clone a prior SPV's
     settings and never saw the server's own enum contract. WIRED (not built) —
     fetched only while the wizard is open. */
  const wizardDefaults = useQuery<{
    gp: { partnerId: string; gpUserId: string | null; name: string | null; tier: string | null };
    enums: Record<string, readonly string[]>;
    carryBasisHelp: Record<string, string>;
    clonableSpvs: Array<{ id: string; name: string; jurisdiction: string; carryBasis: string }>;
  }>({
    queryKey: ["/api/partner/me/spv-wizard/defaults"],
    enabled: wizardOpen && role.ready && !!role.identity,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/spv-wizard/defaults")).json(),
  });

  const detail = useQuery<Record<string, unknown>>({
    queryKey: ["/api/partner/me/spv", selectedId],
    enabled: !!selectedId,
    queryFn: async () => (await apiRequest("GET", `/api/partner/me/spv/${selectedId}`)).json(),
  });

  /* ── WAVE 18 / XT-7 — SUBSCRIBE THIS PAGE TO THE `spv` SSE TOPIC ──────────
   *
   * WIRING, not a build. Both halves were already shipped and already
   * authorised, and neither half had a counterpart:
   *
   *   • PUBLISHER — every SPV write publishes on the `spv` topic scoped to the
   *     partner: `ssePublish(ctx.partnerId, "spv", …)` at
   *     server/spvFundStore.ts:1571 (commitment.created), :1600
   *     (commitment.transitioned), :1648 (capital_call.recorded), :1709
   *     (distribution.recorded), :1763 (position.recorded), with the same five
   *     frames re-emitted by the legacy adapters at
   *     server/spvLegacyAdapters.ts:283,:316,:369,:421,:477.
   *   • TRANSPORT — `spv` is in SSE_TOPICS (server/lib/sseHub.ts:48) and in
   *     PARTNER_TOPICS (server/collectiveSseRoutes.ts:72), so a partner team
   *     member is authorised for it on GET /api/stream and nobody else is.
   *   • SUBSCRIBER — none. Zero client callers listened on `spv`, so a GP
   *     recording a capital call in one tab, or a co-GP on the same partner
   *     recording one at all, left this page showing figures that were simply
   *     out of date until a manual reload.
   *
   * WHY invalidate AND NOT patch state from the frame: the frames carry ids and
   * a type, never amounts. Money on this page is read from the server's own
   * projection. A frame is a hint that the projection moved, never a source of
   * numbers — so the response to one is a refetch, and a frame can never put a
   * figure on screen that the server did not produce.
   *
   * `scope: "partner"` — the partner id is resolved SERVER-side from the
   * session (server/collectiveSseRoutes.ts:157); this page never sends one and
   * cannot subscribe to another firm's vehicles.
   */
  const [liveSpvEvents, setLiveSpvEvents] = useState(0);
  useCollectiveStream({
    chapterId: "",
    scope: "partner",
    path: "/api/stream",
    topics: ["spv"],
    enabled: role.ready && !!role.identity,
    onMessage: (topic, payload) => {
      if (topic !== "spv") return;
      const frame = payload as { type?: unknown; spvId?: unknown } | null;
      /* A frame with no recognisable type is NOT treated as "nothing happened":
       * it still invalidates, because an unknown frame means the server changed
       * something this page cannot interpret, and stale-but-confident is the
       * failure mode being fixed here. */
      const spvId = typeof frame?.spvId === "string" ? frame.spvId : null;
      qc.invalidateQueries({ queryKey: ["/api/partner/me/spv"] });
      if (spvId) qc.invalidateQueries({ queryKey: ["/api/partner/me/spv", spvId] });
      setLiveSpvEvents((n) => n + 1);
    },
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
        /* WAVE 7B V-1 — vintage year on the SAME terms key the admin writer
           uses, so the admin SPV table (PartnerDetail.tsx:865, which already
           renders spvTermsValue(s.terms, "vintage")) picks up partner-created
           SPVs with no further change. This is a WIRE into an existing
           display, not a second display. Integer year or null — never a
           string, so the two writers agree on type. */
        vintage: /^\d{4}$/.test(w.vintage.trim()) ? Number(w.vintage.trim()) : null,
        termsDocRef: w.termsDocRef.trim() || null,
        // D3 — optional waterfall inputs persisted additively in the terms blob
        // (null when blank). hurdleRatePct feeds the optional distribution tiers;
        // gpCommitMinor records the GP's own commitment.
        hurdleRatePct: w.hurdleRatePct.trim() ? Number(w.hurdleRatePct) : null,
        gpCommitMinor: w.gpCommitMajor.trim() ? toMinor(parseFloat(w.gpCommitMajor) || 0, w.currency) : null,
      };
      const spvRes = await apiRequest("POST", "/api/partner/me/spv", {
        name: w.name, jurisdiction: w.jurisdiction, spvType: w.spvType,
        carryBasis: w.carryBasis, distributionScope: w.distributionScope,
        lpVisibility: w.lpVisibility,
        // SPV-BUG-4 (D2) — optional target-company LINK with NO allocation amount.
        // Sent only when the GP chose one; the engine stores it on the SPV.
        targetCompanyId: w.targetCompanyId.trim() || null,
        // W-FIX2 SPV-BUG-1 — the wizard fields hold entered DOLLARS (major units);
        // convert to MINOR units on write (currency-aware ×10^exp, e.g. ×100 for
        // USD) so a $500,000 target is stored as 50,000,000 minor and displays as
        // $500,000.00 (was stored raw → displayed 100x low as $5,000.00).
        targetRaiseMinor: toMinor(parseFloat(w.targetRaiseMinor || "0") || 0, w.currency),
        minCheckMinor: toMinor(parseFloat(w.minCheckMinor || "0") || 0, w.currency),
        capMinor: toMinor(parseFloat(w.capMinor || "0") || 0, w.currency),
        currency: w.currency, closeDate: w.closeDate || null, status: "open",
        terms,
        // 1c — launch sign-off recorded server-side before the SPV is created.
        signoffLegalName: w.signoffLegalName.trim(),
        signoffAccepted: w.signoffAccepted,
      });
      const { spv } = await spvRes.json();
      await apiRequest("PUT", `/api/partner/me/spv/${spv.id}/mandate`, {
        mode: w.mandateMode,
        sector: w.sectors,
        // D2 — optional mandate refinements; empty arrays / nulls when blank.
        geography: splitList(w.geography),
        stage: splitList(w.stage),
        checkMinMinor: w.checkMinMajor.trim() ? toMinor(parseFloat(w.checkMinMajor) || 0, w.currency) : null,
        checkMaxMinor: w.checkMaxMajor.trim() ? toMinor(parseFloat(w.checkMaxMajor) || 0, w.currency) : null,
        ruleTree: w.sectors.length
          ? { op: "and", rules: [{ field: "sector", op: "in", value: w.sectors }] }
          : { op: "and", rules: [{ field: "company_id", op: "in", value: [] }] },
      });
      if (w.mgmtFeeType) {
        await apiRequest("POST", `/api/partner/me/spv/${spv.id}/fees`, {
          layer: "management", feeType: w.mgmtFeeType,
          fixedAmountMinor: w.mgmtFeeType !== "carry" ? toMinor(parseFloat(w.mgmtFixedMinor || "0") || 0, w.feeCurrency) : undefined,
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
  /* V-1 — blank is allowed (the field is optional); anything else must be a
     4-digit year in a sane range. */
  const vintageValid =
    !w.vintage.trim() ||
    (/^\d{4}$/.test(w.vintage.trim()) &&
      Number(w.vintage.trim()) >= 1990 &&
      Number(w.vintage.trim()) <= new Date().getFullYear() + 10);

  const entityStructureIsFreeText = w.jurisdictionCountry === OTHER || w.legalEntityStructure === "Other (specify)";
  // 2a — on country change, RESET the entity structure to the new list's first
  // option (or clear for the free-text "Other" jurisdiction).
  const onJurisdictionCountryChange = (country: string) =>
    setW((prev) => ({
      ...prev,
      jurisdictionCountry: country,
      legalEntityStructure: country === OTHER ? "" : (SPV_JURISDICTION_ENTITY_STRUCTURES[country]?.[0] ?? ""),
      legalEntityStructureOther: "",
      // 1e — auto-derive the strict engine enum from the country (the standalone
      // "Engine legal-entity type" field was removed as redundant).
      jurisdiction: deriveEngineJurisdiction(country),
    }));
  const canAdvance = (): boolean => {
    /* V-1 — vintage is OPTIONAL but must be a plausible 4-digit year when
       given, so a typo cannot silently persist as null. */
    if (step === 0)
      return (
        !!w.name.trim() && !!w.jurisdiction && jurisdictionCountryValid && vintageValid
      );
    if (step === 1) return !!w.mandateMode && !!w.mandateDescription.trim(); // 3e mandatory
    if (step === 2) return !!w.mgmtFeeType && !!w.carryBasis; // S1 — carry basis co-located on Fees
    if (step === 3) return !!w.distributionScope;
    return true;
  };
  const toggleSector = (s: string) =>
    setW((prev) => ({ ...prev, sectors: prev.sectors.includes(s) ? prev.sectors.filter((x) => x !== s) : [...prev.sectors, s] }));
  // SPV-BUG-2 — switching the fee type must RESET the now-irrelevant dependent
  // fields to valid defaults. Previously the raw setW left stale values from the
  // other branch (e.g. an empty carry% after picking "fixed"), which failed the
  // step-2 submit guards and left Next disabled with no visible reason.
  const onFeeTypeChange = (feeType: string) =>
    setW((prev) => ({
      ...prev,
      mgmtFeeType: feeType,
      mgmtFixedMinor: feeType === "carry" ? "0" : (prev.mgmtFixedMinor || "0"),
      mgmtCarryPct: feeType === "fixed" ? "0" : (prev.mgmtCarryPct || "20"),
    }));

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

      {/* WAVE 18 / XT-7 — a SIBLING element (guard rule: never append text
          inside an existing text node). Rendered only once a frame has actually
          been applied, so it is evidence of liveness rather than a claim about
          it: the hook exposes no connection state, and asserting "Live" from
          silence is exactly the mistake this wave's rules forbid. */}
      {liveSpvEvents > 0 && (
        <div className="mb-4 text-xs text-[var(--cv-color-text-muted)]" data-testid="spv-engine-live-note">
          Refreshed from a live vehicle update.
        </div>
      )}

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
              {/* ORP-030 — clone a prior SPV's settings. `clonableSpvs` is the
                  server's own list from /spv-wizard/defaults; nothing is
                  hardcoded and no prior-SPV data is held client-side. */}
              <div data-testid="spv-w-clone">
                <Label>Start from a prior SPV (optional)</Label>
                <select
                  className="w-full border rounded h-9 px-2"
                  data-testid="spv-w-clone-select"
                  value=""
                  onChange={(e) => {
                    const src = (wizardDefaults.data?.clonableSpvs ?? []).find((c) => c.id === e.target.value);
                    if (!src) return;
                    setW((prev) => ({ ...prev, jurisdiction: src.jurisdiction, carryBasis: src.carryBasis }));
                    toast({ title: `Cloned settings from ${src.name}` });
                  }}
                >
                  <option value="">
                    {wizardDefaults.isLoading
                      ? "Loading your prior SPVs…"
                      : (wizardDefaults.data?.clonableSpvs?.length ?? 0) === 0
                        ? "No prior SPVs to clone from"
                        : "Choose an SPV to copy jurisdiction and carry basis from"}
                  </option>
                  {(wizardDefaults.data?.clonableSpvs ?? []).map((c) => (
                    <option key={c.id} value={c.id} data-testid={`spv-w-clone-option-${c.id}`}>{c.name}</option>
                  ))}
                </select>
                {wizardDefaults.data?.gp?.name ? (
                  <div className="text-[10px] text-[var(--cv-color-text-faint)] mt-1" data-testid="spv-w-gp-context">
                    You are launching this vehicle as GP: {wizardDefaults.data.gp.name}
                    {wizardDefaults.data.gp.tier ? ` (${wizardDefaults.data.gp.tier})` : ""}.
                  </div>
                ) : null}
              </div>
              <div><Label>SPV name *</Label><Input data-testid="spv-w-name" value={w.name} onChange={(e) => setW({ ...w, name: e.target.value })} /></div>
              {/* WAVE 7B V-1 (DEF-085) — vintage year. The admin create form has
                  always had this field; the PARTNER-facing wizard never did, so
                  every partner-created SPV carried no vintage and the admin
                  table's Vintage column rendered "—" for all of them. Same
                  `terms.vintage` key, same integer type, same default. */}
              <div data-testid="spv-w-vintage-field">
                <Label htmlFor="spv-w-vintage">Vintage year</Label>
                <Input
                  id="spv-w-vintage"
                  data-testid="spv-w-vintage"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="e.g. 2026"
                  value={w.vintage}
                  onChange={(e) => setW({ ...w, vintage: e.target.value })}
                />
                {!vintageValid && (
                  <div className="text-xs text-rose-600" data-testid="spv-w-vintage-error">
                    Vintage must be a 4-digit year between 1990 and {new Date().getFullYear() + 10}.
                  </div>
                )}
              </div>
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
              {/* 1e — the standalone "Engine legal-entity type" field was removed
                  as redundant with Jurisdiction (country) + Legal entity
                  structure. The strict engine enum is now auto-derived from the
                  chosen country (deriveEngineJurisdiction) and carried on a
                  hidden input so the value still submits and the existing
                  data-testid is preserved (anti-silent-drop / test parity). */}
              <input type="hidden" data-testid="spv-w-jurisdiction" value={w.jurisdiction} readOnly />
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

              {/* D2 — OPTIONAL mandate refinements the engine already supports.
                  All blank by default and never required; comma-separate multiple
                  values. They narrow which companies can ever match (fail-closed). */}
              <div className="grid grid-cols-2 gap-3" data-testid="spv-w-mandate-optional">
                <div><Label>Geography (optional)</Label><Input data-testid="spv-w-geography" value={w.geography} onChange={(e) => setW({ ...w, geography: e.target.value })} placeholder="e.g. United States, EU" /></div>
                <div><Label>Stage (optional)</Label><Input data-testid="spv-w-stage" value={w.stage} onChange={(e) => setW({ ...w, stage: e.target.value })} placeholder="e.g. seed, series_a" /></div>
                <div><Label>{amountLabel("Min check")} (optional)</Label><Input data-testid="spv-w-checkmin" type="number" value={w.checkMinMajor} onChange={(e) => setW({ ...w, checkMinMajor: e.target.value })} placeholder="e.g. 25000" /></div>
                <div><Label>{amountLabel("Max check")} (optional)</Label><Input data-testid="spv-w-checkmax" type="number" value={w.checkMaxMajor} onChange={(e) => setW({ ...w, checkMaxMajor: e.target.value })} placeholder="e.g. 250000" /></div>
              </div>

              {/* SPV-BUG-4 (D2) — OPTIONAL target-company link. Links a company to
                  the vehicle WITHOUT any allocation amount (deployment/allocation is
                  a separate, deliberate money-path step on the Deployments tab). */}
              <div>
                <Label>Target company (optional)</Label>
                <Input data-testid="spv-w-target-company" value={w.targetCompanyId} onChange={(e) => setW({ ...w, targetCompanyId: e.target.value })} placeholder="Company id to link (no allocation committed)" />
                <div className="text-[10px] text-[var(--cv-color-text-faint)]">Links a target company to this SPV for reference only — no capital is allocated or committed here.</div>
              </div>

              <p className="text-xs text-[var(--cv-color-text-muted)]">Only active, paid Capavate companies with a valid M&amp;A profile and an open round can ever match — eligibility is fail-closed.</p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3" data-testid="spv-wizard-step-2">
              <div>
                <Label>Management fee type</Label>
                <select data-testid="spv-w-feetype" className="w-full border rounded h-9 px-2" value={w.mgmtFeeType} onChange={(e) => onFeeTypeChange(e.target.value)}>
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

              {/* S1 — carry BASIS co-located beside carry % (moved off the Terms
                  step). Still required; the Next gate keys off it here now. */}
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
                {!w.carryBasis && (
                  <div className="text-xs text-rose-600 mt-1" data-testid="spv-w-carrybasis-error">
                    Choose a carry basis to continue.
                  </div>
                )}
              </div>

              {/* D3 — OPTIONAL waterfall inputs (blank by default, never required).
                  A hurdle (preferred return) and the GP's own commitment feed the
                  optional tiered distribution waterfall shown in the detail. */}
              <div className="grid grid-cols-2 gap-3" data-testid="spv-w-waterfall">
                <div>
                  <Label>Hurdle % (optional)</Label>
                  <Input data-testid="spv-w-hurdle" type="number" value={w.hurdleRatePct} onChange={(e) => setW({ ...w, hurdleRatePct: e.target.value })} placeholder="e.g. 8" />
                  <div className="text-[10px] text-[var(--cv-color-text-faint)]">Preferred return LPs receive before GP carry. Leave blank for a simple return-of-capital-then-carry waterfall.</div>
                </div>
                <div>
                  <Label>{amountLabel("GP commitment")} (optional)</Label>
                  <Input data-testid="spv-w-gpcommit" type="number" value={w.gpCommitMajor} onChange={(e) => setW({ ...w, gpCommitMajor: e.target.value })} placeholder="e.g. 50000" />
                  <div className="text-[10px] text-[var(--cv-color-text-faint)]">How much the GP invests alongside LPs (skin in the game). Optional.</div>
                </div>
              </div>

              {/* SPV-BUG-5 (D3) — platform fee is DB-driven & read-only to the GP.
                  The exact % appears on the SPV's Fees tab once Capavate applies it
                  (pulled live from config, never hardcoded here). */}
              <p className="text-xs text-[var(--cv-color-text-muted)]" data-testid="spv-w-platform-fee-note">The platform fee layer is set by Capavate and is read-only to you. Its exact percentage is shown on this SPV's Fees tab once applied.</p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3" data-testid="spv-wizard-step-3">
              {/* WAVE 8 / ORP-063 (DEF-063) — SPV_EDU.terms was authored for
                  exactly this step and was never rendered anywhere (18 keys
                  defined, 16 referenced). NOT deleted — rendered. */}
              <div className="rounded-md p-2 text-xs bg-[rgba(4,30,65,0.05)]" data-testid="spv-edu-terms">
                {SPV_EDU.terms}
              </div>
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
              {/* S1 — carry basis moved to the Fees step (co-located with carry %). */}
              {/* 3m — optional terms document link/ref */}
              <div><Label>Terms document link (optional)</Label><Input data-testid="spv-w-terms-doc" value={w.termsDocRef} onChange={(e) => setW({ ...w, termsDocRef: e.target.value })} placeholder="https://… or a stored document reference" /></div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3 text-sm" data-testid="spv-wizard-step-4">
              <div className="font-medium text-base">Review &amp; launch</div>
              {/* WAVE 8 / ORP-063 — the second orphaned key, SPV_EDU.reviewLaunch,
                  which explains that launching creates the SPV and moves NO
                  money. That reassurance was written and never shown. */}
              <div className="rounded-md p-2 text-xs bg-[rgba(4,30,65,0.05)]" data-testid="spv-edu-review-launch">
                {SPV_EDU.reviewLaunch}
              </div>
              <ReviewRow label="Name" value={w.name || "(unnamed)"} onEdit={() => setStep(0)} />
              <ReviewRow label="SPV type" value={SPV_TYPE_LABELS[w.spvType as keyof typeof SPV_TYPE_LABELS]} onEdit={() => setStep(0)} />
              <ReviewRow label="Jurisdiction (country)" value={juruDisplay} onEdit={() => setStep(0)} />
              {/* V-1 — shown on Review so it cannot be launched unnoticed. */}
              <ReviewRow label="Vintage year" value={w.vintage.trim() || "—"} onEdit={() => setStep(0)} />
              <ReviewRow label="Legal entity structure" value={legalEntityDisplay || "—"} onEdit={() => setStep(0)} />
              <ReviewRow label="Mandate mode" value={SPV_MANDATE_MODE_LABELS[w.mandateMode as keyof typeof SPV_MANDATE_MODE_LABELS]} onEdit={() => setStep(1)} />
              <ReviewRow label="Mandate" value={w.mandateDescription || "—"} onEdit={() => setStep(1)} />
              {/* B2 — friendlier empty-sectors copy instead of a bare em-dash */}
              <ReviewRow label="Sectors" value={w.sectors.length ? w.sectors.join(", ") : "None / No sectors selected"} onEdit={() => setStep(1)} />
              {w.subSector && <ReviewRow label="Sub-sector" value={w.subSector} onEdit={() => setStep(1)} />}
              <ReviewRow
                label="Management fee"
                value={w.mgmtFeeType === "carry" ? `Carry ${w.mgmtCarryPct}%` : w.mgmtFeeType === "fixed" ? `${fmt(toMinor(parseFloat(w.mgmtFixedMinor || "0") || 0, w.feeCurrency), w.feeCurrency)} fixed` : `${fmt(toMinor(parseFloat(w.mgmtFixedMinor || "0") || 0, w.feeCurrency), w.feeCurrency)} + ${w.mgmtCarryPct}% carry`}
                onEdit={() => setStep(2)}
              />
              <ReviewRow label="Target raise" value={fmt(toMinor(parseFloat(w.targetRaiseMinor || "0") || 0, w.currency), w.currency)} onEdit={() => setStep(3)} />
              <ReviewRow label="Distribution scope" value={SPV_DISTRIBUTION_SCOPE_WIZARD_OPTIONS.find((o) => o.value === w.distributionScope)?.label ?? w.distributionScope} onEdit={() => setStep(3)} />
              <ReviewRow label="Co-investor visibility" value={w.lpVisibility === "co_investors" ? "On (club deal)" : "Off (own only)"} onEdit={() => setStep(3)} />
              <ReviewRow label="Carry basis" value={w.carryBasis ? (w.carryBasis === "per_deployment" ? "Per deployment" : "Whole SPV") : "— (required)"} onEdit={() => setStep(2)} />
              {w.targetCompanyId.trim() && <ReviewRow label="Target company" value={w.targetCompanyId.trim()} onEdit={() => setStep(1)} />}
              {(w.hurdleRatePct.trim() || w.gpCommitMajor.trim()) && (
                <ReviewRow
                  label="Waterfall"
                  value={[w.hurdleRatePct.trim() ? `${w.hurdleRatePct}% hurdle` : null, w.gpCommitMajor.trim() ? `${fmt(toMinor(parseFloat(w.gpCommitMajor) || 0, w.currency), w.currency)} GP commit` : null].filter(Boolean).join(" · ")}
                  onEdit={() => setStep(2)}
                />
              )}
              {w.termsDocRef && <ReviewRow label="Terms doc" value={w.termsDocRef} onEdit={() => setStep(3)} />}
              {/* B2 — per-SPV-type helper note (Syndicate, Rolling Fund) */}
              {SPV_TYPE_REVIEW_NOTE[w.spvType] && (
                <div className="text-xs text-[var(--cv-color-text-muted)] rounded p-2" style={{ background: "rgba(4,30,65,0.05)" }} data-testid="spv-review-type-note">
                  {SPV_TYPE_REVIEW_NOTE[w.spvType]}
                </div>
              )}
              {!w.carryBasis && <div className="text-xs text-rose-600">Choose a carry basis in the Fees step before launching.</div>}

              {/* 1c — full launch sign-off: typed legal name + attestation ack +
                  timestamp, recorded durably server-side before the SPV is
                  created. Launch is gated on both being provided. */}
              <div className="mt-2 rounded-md border p-3 space-y-2" style={{ borderColor: NAVY, background: "rgba(4,30,65,0.04)" }} data-testid="spv-launch-signoff">
                <div className="font-medium">Authorized sign-off (required)</div>
                <div>
                  <Label>Full legal name *</Label>
                  <Input
                    data-testid="spv-signoff-legalname"
                    value={w.signoffLegalName}
                    onChange={(e) => setW({ ...w, signoffLegalName: e.target.value })}
                    placeholder="Type your full legal name"
                  />
                </div>
                <label className="flex items-start gap-2 cursor-pointer" htmlFor="spv-signoff-accept">
                  <input
                    id="spv-signoff-accept"
                    type="checkbox"
                    className="mt-1"
                    data-testid="spv-signoff-accept"
                    checked={w.signoffAccepted}
                    onChange={(e) => setW({ ...w, signoffAccepted: e.target.checked })}
                  />
                  <span className="text-xs text-[var(--cv-color-text-secondary)]">{ATTESTATION_TEXT_V1}</span>
                </label>
                {(!w.signoffLegalName.trim() || !w.signoffAccepted) && (
                  <div className="text-xs text-rose-600" data-testid="spv-signoff-error">
                    Type your full legal name and accept the attestation to launch.
                  </div>
                )}
                <div className="text-[10px] text-[var(--cv-color-text-faint)]">Your name, assent, and a UTC timestamp are recorded for audit (ESIGN/UETA).</div>
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
              <Button data-testid="spv-wizard-launch" disabled={!w.carryBasis || !w.signoffLegalName.trim() || !w.signoffAccepted || create.isPending} onClick={() => create.mutate()} style={{ background: NAVY }}>
                {create.isPending ? "Launching…" : "Launch SPV"}
              </Button>
            )}
          </div>
        </Card>
      )}

      {list.isLoading && <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="spv-engine-loading">Loading…</div>}
      {/* WAVE 18 W-4 — a FAILED load is not an empty portfolio.
          `spvs` is `list.data?.spvs ?? []`, so a 403 or a 500 left this page
          rendering "No SPVs yet · Create your first SPV" — a GP with live
          vehicles was told, in encouraging copy, that they had none, and
          invited to create a duplicate. The retired PartnerSpvs page already
          had the right shape (`PartnerSpvs.tsx:143`); the page that replaced it
          as canonical (Ozan decision #4, App.tsx:1406 redirect) did not. The
          refusal is now rendered as its own state, and the empty state is
          reached only when the fetch actually SUCCEEDED and returned nothing. */}
      {list.isError && (
        <div
          className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"
          role="alert"
          data-testid="spv-engine-error"
        >
          <div className="font-medium">We couldn&rsquo;t load your SPVs.</div>
          <div className="mt-0.5 text-xs">
            Nothing has been changed. This is a loading failure, not an empty portfolio —
            do not create a new SPV to work around it.
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mt-2 h-7 text-xs"
            data-testid="spv-engine-error-retry"
            onClick={() => list.refetch()}
          >
            Try again
          </Button>
        </div>
      )}
      {!list.isLoading && !list.isError && list.isSuccess && spvs.length === 0 && (
        <PartnerEmptyState title="No SPVs yet" description="Create your first SPV with the 5-step wizard." />
      )}

      {spvs.length > 0 && (
        <div className="space-y-2 mt-4" data-testid="spv-engine-list">
          {spvs.map((s) => (
            <Card
              key={s.id}
              className="p-3 cursor-pointer hover:bg-[var(--cv-color-surface-2)]"
              data-testid={`spv-row-${s.id}`}
              /* SPV-BUG-3 (F4 family) — the card was a bare <div> onClick, so a
                 plain first click was dropped (needed a raw pointer sequence).
                 Real button semantics (role + tabIndex + keyboard) make a single
                 normal click — and Enter/Space — open the detail reliably.

                 WAVE 40 / F-1 — `role="button" tabIndex={0}` ARE GONE FROM THIS
                 CARD, and must not come back. Two proven reasons:

                 1. KEYBOARD (reproduced in Chromium, both poles — see
                    build_log/WAVE40_REPORT.md). The card's own onKeyDown below
                    fires on Enter/Space BUBBLED FROM ANY DESCENDANT. Pressing
                    Enter on an SPV tab trigger therefore toggled `selectedId`
                    and UNMOUNTED the whole tab panel mid-activation: 16 tabs
                    present in source, 1 reachable by keyboard.
                 2. ARIA. A `role="button"` element has PRESENTATIONAL CHILDREN:
                    its entire subtree is flattened in the accessibility tree, so
                    the 16 `role="tab"` triggers, the publish Button and both
                    Links inside it do not exist for assistive technology.

                 The single-normal-click contract SPV-BUG-3 bought is preserved
                 twice over: the card keeps its onClick (click anywhere on the
                 card body still toggles), and the header now carries a REAL
                 <button data-testid=`spv-row-toggle-${s.id}`> — a native
                 control, focusable, Enter/Space-activated by the browser, with
                 aria-expanded/aria-controls on the element that actually owns
                 the disclosure. `scripts/reachability/reachability_gate.ts` rule
                 R3 fails the build if an interactive role is ever wrapped around
                 these controls again. */
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedId(s.id === selectedId ? null : s.id);
                }
              }}
              onClick={() => setSelectedId(s.id === selectedId ? null : s.id)}
            >
              <div className="flex justify-between items-center">
                <div>
                  <div className="font-medium">{s.name} {s.migratedFrom && <span className="text-[10px] px-1 rounded" style={{ background: "rgba(4,30,65,0.1)", color: NAVY }}>migrated</span>}</div>
                  <div className="text-xs text-[var(--cv-color-text-muted)]">{(SPV_TYPE_LABELS as Record<string, string>)[s.spvType] ?? s.spvType} · {s.status} · {labelFor(DISTRIBUTION_SCOPE_LABELS, s.distributionScope)} · Carry: {labelFor(CARRY_BASIS_LABELS, s.carryBasis)}</div>
                  {/* J-4 (WAVE 3C) — jurisdiction was rendered NOWHERE in this
                      accordion; it only appeared on the standalone detail page. */}
                  <div className="text-xs text-[var(--cv-color-text-muted)]" data-testid={`spv-row-jurisdiction-${s.id}`}>
                    Jurisdiction: {jurisdictionLabelFor(s)}
                  </div>
                  {/* WAVE 7B V-1 (DEF-085) — "captured nowhere, displayed
                      nowhere". Captured above in step 0; displayed here, on the
                      partner's own list, and (already) in the admin SPV table
                      which reads the same terms.vintage key. */}
                  <div className="text-xs text-[var(--cv-color-text-muted)]" data-testid={`spv-row-vintage-${s.id}`}>
                    Vintage: {spvVintageLabel(s)}
                  </div>
                  {/* SC-2 (WAVE 2) — the only inbound link to
                      /collective/partner/spvs/:id. That route has been declared in
                      client/src/App.tsx:1193-1195 all along, but no surface in the
                      app ever navigated to it, so the working LP invite form, LP
                      roster, jurisdiction panel, audit receipt and Record Capital
                      Call panel on PartnerSpvDetail were unreachable.
                      stopPropagation keeps the card's accordion toggle intact — the
                      card stays a click-to-expand control, this is an extra exit. */}
                  {/* WAVE 40 — OWNER RULING 2026-08-13: this link opens the
                      TABBED VIEW, landing on the LPs tab, which is where the LP
                      roster and capital-call controls actually live now.

                      `href` is deliberately KEPT pointing at the standalone page
                      even though the plain click is intercepted: a middle-click
                      or ⌘/Ctrl-click still opens that page in a new tab, and
                      wouter needs a real href to render a real anchor. The
                      standalone page is ALSO still reachable by a plain click,
                      via the explicit `spv-open-standalone-*` link appended
                      below — it holds 6 capabilities that exist nowhere else
                      (`python3 scripts/spv_two_surface_audit.py --check`), so it
                      must never lose its last inbound plain-click path. */}
                  <Link
                    href={`/collective/partner/spvs/${s.id}`}
                    className="text-xs underline text-[color:var(--cv-color-primary)] inline-block mt-1"
                    onClick={(e) => {
                      /* Modifier / non-primary clicks are the user asking for a
                         new tab or window — let the browser have them. */
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                      e.preventDefault();
                      e.stopPropagation();
                      setSelectedTab({ id: s.id, tab: "lps" });
                      setSelectedId(s.id);
                    }}
                    /* The card's onKeyDown calls preventDefault() on Enter, which
                       suppressed the browser's own activation of this link for a
                       keyboard user. Stop the event here so the link works by
                       keyboard as well as by mouse. */
                    onKeyDown={(e) => e.stopPropagation()}
                    data-testid={`spv-open-detail-${s.id}`}
                  >
                    Open LP roster &amp; capital calls →
                  </Link>
                  {/* WAVE 7B W-3 — SIBLING OF SC-2, and the recurring failure
                      mode caught live.

                      Ozan decision #4 collapsed the duplicate "Funds" nav entry
                      into this ONE SPVs engine, and /collective/partner/funds
                      became a <Redirect> here (App.tsx:1349). Fund CREATION is
                      genuinely covered: SPV_TYPES includes `fund`, the wizard's
                      type select offers it, and GET /api/partner/me/funds is
                      just this same store filtered to spvType==='fund'
                      (server/partnerRoutes.ts:1771-1773). So PartnerFunds.tsx
                      is correctly redundant and correctly unrouted.

                      What did NOT survive the collapse is the FUND COMMITMENT
                      REGISTER. POST /api/partner/me/funds/:id/commitments
                      (server/partnerRoutes.ts:1851) is a live write whose only
                      client caller is PartnerFundDetail.tsx:103, on the route
                      /collective/partner/funds/:id — a route that is still OPEN
                      (App.tsx:1346) but whose ONLY inbound link in the entire
                      app was PartnerFunds.tsx:172, which is now unreachable.
                      Route open, engine live, zero ways in.

                      Rendered ONLY for spvType==='fund', verified against the
                      loader: GET /api/partner/me/funds/:id hard-404s on
                      `fund.spvType !== "fund"` (server/partnerRoutes.ts:1819),
                      so offering this exit on a rolling_fund or syndicate row
                      would hand the GP a dead link. Nav is untouched — Ozan
                      decision #4 stands. */}
                  {s.spvType === "fund" && (
                    <>
                      <br />
                      <Link
                        href={`/collective/partner/funds/${s.id}`}
                        className="text-xs underline text-[color:var(--cv-color-primary)] inline-block mt-1"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                        data-testid={`spv-open-fund-commitments-${s.id}`}
                      >
                        Open fund commitment register →
                      </Link>
                    </>
                  )}
                  {/* WAVE 40 / F-1 — THE REAL DISCLOSURE CONTROL.

                      Appended at the END of this column deliberately: the
                      silent-drop guard compares a container's child order as a
                      SUBSEQUENCE, so an append is additive while an insertion or
                      a wrap would read as a removal.

                      This is a native <button>, so the browser — not a hand
                      written key handler — activates it on Enter and Space, and
                      it is the element that carries aria-expanded /
                      aria-controls. stopPropagation on both click and keydown
                      keeps the card's own onClick/onKeyDown from double-toggling
                      it back closed. */}
                  <br />
                  <button
                    type="button"
                    className="text-xs underline text-[color:var(--cv-color-primary)] inline-block mt-1"
                    aria-expanded={selectedId === s.id}
                    aria-controls={`spv-detail-${s.id}`}
                    data-testid={`spv-row-toggle-${s.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedId(s.id === selectedId ? null : s.id);
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    {selectedId === s.id ? "Hide vehicle detail tabs" : "Show vehicle detail tabs"}
                  </button>
                  {/* WAVE 40 — the standalone SPV admin page kept explicitly
                      reachable by a plain click. The two-surface audit
                      (`scripts/spv_two_surface_audit.py --check`, verdict
                      recorded in build_log/WAVE40_REPORT.md) shows 6 endpoints
                      that live ONLY there: LP invite, LP commit, GP-scoped LP
                      roster, capital calls, and both CRM contact endpoints.
                      Repointing the blue link above at the tabs took away its
                      only plain-click door, so this replaces it in the same
                      place. This is a relocation, not a subtraction — nothing
                      here may be deleted until those 6 endpoints have callers on
                      the tabbed surface. */}
                  <br />
                  <Link
                    href={`/collective/partner/spvs/${s.id}`}
                    className="text-xs underline text-[color:var(--cv-color-text-muted)] inline-block mt-1"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    data-testid={`spv-open-standalone-${s.id}`}
                  >
                    Open standalone SPV admin page (LP invites, commits, capital calls) →
                  </Link>
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
                /* WAVE 40 / F-1 — `id` for the header button's aria-controls, and
                   onKeyDown stopPropagation so that a key pressed on ANY control
                   inside the tabbed detail (a tab trigger, an amount input, a
                   Save button) can never bubble to the card's Enter/Space
                   handler and unmount the panel the user is working in. This is
                   the second half of the F-1 fix; removing role="button" alone
                   would leave the bubbling toggle in place. */
                <div className="mt-3 border-t pt-3 text-sm space-y-2" id={`spv-detail-${s.id}`} data-testid={`spv-detail-${s.id}`} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                  {/* W-FIX1f SPV-UI-1 — tabbed detail exposing every engine capability. */}
                  <SpvDetailTabs
                    initialTab={selectedTab?.id === s.id ? selectedTab.tab : undefined}
                    spvId={s.id}
                    detail={detail.data as unknown as SpvDetail}
                    currency={s.currency}
                    canWrite={canWrite}
                    onChanged={() => {
                      qc.invalidateQueries({ queryKey: ["/api/partner/me/spv", s.id] });
                      qc.invalidateQueries({ queryKey: ["/api/partner/me/spv"] });
                    }}
                  />
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

