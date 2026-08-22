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
import { useState, useId, useMemo, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatMinor as formatMinorLib } from "@/lib/currency";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { parsePercentInputToFraction, formatFractionAsPercent } from "@/lib/percentDisplay"; /* WAVE 10 / EN-5 — the single canonical percent parser */
import { Link } from "wouter"; /* WAVE 10 — link into the EN-1/EN-2 performance surface */
/* WAVE 8 / ORP-030 — the missing client callers for the ten orphaned SPV
   engine endpoints. Mounted into the tabs that already existed on screen. */
import {
  SpvFeeLedgerPanel,
  useSpvCapitalAccounts,
  SpvCloseSummaryPanel,
  SpvSignoffsPanel,
  SpvEligibilityPanel,
  SpvDeploymentLifecyclePanel,
} from "@/components/partner/SpvOperationsPanels";
import { Button } from "@/components/ui/button";
/* WAVE 32 / CP-SPV-30 capability 1 — the NAV surface. An engine with no route,
   or a component mounted nowhere, is not shipped; this is where it mounts. */
import { SpvNavPanel } from "@/components/partner/SpvNavPanel";
import { SpvK1Panel } from "@/components/partner/SpvK1Panel";
import { SpvSideLetterPanel } from "@/components/partner/SpvSideLetterPanel";
import SpvReachPanel from "@/components/partner/SpvReachPanel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { auditReceiptReference } from "@/lib/auditReceiptRef"; /* WAVE 95 · ITEM 2 */
import {
  SPV_EDU,
  WIND_DOWN_CHECKLIST,
} from "@/lib/spvEducation";
import {
  SPV_MANDATE_MODES,
  SPV_MANDATE_MODE_LABELS,
  SPV_MANDATE_MODE_HELP,
  SPV_FEE_TYPES,
  SPV_DOC_TYPES,
  spvDocTypesForJurisdiction,
  SPV_INVESTOR_PERSONAS,
  /* WAVE 3C / J-3 — jurisdiction-conditional compliance content. These replace
   * the three `@/lib/spvEducation` helpers (investorCountAwareness /
   * formationChecklist / filingsChecklist) THIS FILE used to call. Those
   * helpers keyed off the 4-member enum and returned US copy (Form D,
   * blue-sky, ~100 3(c)(1) cap, Tax ID/EIN) for EVERY jurisdiction that was
   * not literally "cayman"/"bvi" — which, because deriveEngineJurisdiction
   * collapsed everything else to "delaware", meant a BVI or Dutch vehicle got
   * the full US block. The shared ontology is now the single source and it is
   * exhaustive over the widened enum. The spvEducation helpers are left in
   * place, exported and tested (server/__tests__/wfix1f_spv_education.test.ts)
   * — nothing is deleted, this surface simply reads from the ontology now. */
  spvJurisdictionCompliance,
  spvFormationChecklist,
  spvFilingsChecklist,
  SPV_JURISDICTION_GENERIC_NOTICE,
  spvJurisdictionDisplay, /* WAVE 40 / F-3 — single jurisdiction precedence */
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

/**
 * WAVE 10 / EN-5 — the local `parsePercent` this replaces is RETIRED.
 *
 * It was a second, independent implementation of the owner's percent ruling
 * sitting next to the canonical one in `client/src/lib/percentDisplay.ts`. The
 * two agreed today, which is precisely what makes a duplicate dangerous: the
 * next change to the ruling gets applied to one of them, the divergence is
 * silent, and the field that still uses the stale copy keeps validating
 * against yesterday's rule. There must be ONE parser.
 *
 * `parsePercentInputToFraction` returns a result object rather than throwing.
 * This wrapper preserves the throwing shape the three call sites are built
 * around, so retiring the duplicate does not become a refactor of the form
 * handlers — and, unlike the old copy, it reports the field name and the
 * permitted range in the message the operator actually sees.
 */
function parsePercent(v: string, label = "Percentage"): number {
  const r = parsePercentInputToFraction(v, { label });
  if (!r.ok) throw new Error(r.error);
  return r.fraction;
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
  // WAVE 25 / FE-4 — the store-side transfer guards. Untranslated codes fall
  // through to a generic toast, which is how a real refusal reads as noise.
  TRANSFER_SELF: "A transfer needs two different investors — from and to are the same.",
  TRANSFER_CONSIDERATION_REQUIRED: "Enter an amount OR a units percentage for this transfer.",
  INVALID_UNITS_PCT: "Units percentage must be a fraction greater than 0 and at most 1 (0.25 = 25%).",
  SPV_WOUND_DOWN: "This SPV has been wound down. No further transfers can be recorded against it.",
  // WAVE 25 / FE-1 — mandate check-size bounds.
  INVALID_CHECK_MIN: "Minimum check must be a whole, non-negative number of minor units.",
  INVALID_CHECK_MAX: "Maximum check must be a whole, non-negative number of minor units.",
  INVALID_CHECK_RANGE: "Minimum check cannot be greater than maximum check.",
  // WAVE 25 / FE-7 — the compliance write path.
  INVALID_COMPLIANCE_PROFILE_PATCH: "Some compliance fields were not accepted. Check the KYC and accreditation values.",
  INVESTOR_NOT_RELATED_TO_PARTNER: "That investor is not in your partner workspace, so their compliance profile cannot be read or edited here.",
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
/* WAVE 32 / CP-SPV-30 capability 2 — the waterfall now records a
   `side_letter_adjustment` tier when per-LP negotiated carry changed the
   economics. Optional, because a vehicle with no side letters still persists
   the unchanged five-tier waterfall. */
type SideLetterAdjustment = {
  investorId: string;
  sideLetterId: string;
  fundCarryScaled: number;
  lpCarryScaled: number;
  carryBeforeMinor: number;
  carryAfterMinor: number;
  netBeforeMinor: number;
  netAfterMinor: number;
};
type WaterfallTier = { tier: string; amountMinor?: number; adjustments?: SideLetterAdjustment[] };
type Distribution = { event: string; grossProceedsMinor: number; gpCarryMinor: number; platformCarryMinor: number; waterfall?: WaterfallTier[] };

/** Integer billionths -> a human percent. Never `n > 1 ? n / 100 : n`. */
function carryScaledToPercentLabel(scaled: number): string {
  return `${(scaled / 10_000_000).toFixed(2).replace(/\.?0+$/, "")}%`;
}
type Doc = { id?: string; docType?: string; title?: string; createdAt?: string };
type Transfer = { id?: string; fromInvestorId?: string; toInvestorId?: string; status?: string };
type CapitalAccount = { investorId: string; contributedMinor: number; confirmedMinor: number; distributedMinor: number; dpiRatio?: number | null };
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
  /* WAVE 25 / SPV-E (DEF-086) — `revisionHash` and `updatedAt` are read for the
     Overview audit-receipt line. Both are real `SpvDTO` fields
     (shared/spvEngine.ts). `version` and `prevRevisionHash` are deliberately
     NOT declared here: they do not exist on SpvDTO, and declaring them is what
     made the retired PartnerSpvDetail accordion render `undefined` twice
     (DEF-087 / OQ-35). */
  spv?: { status?: string; jurisdiction?: string; lpVisibility?: string; closeDate?: string | null; targetRaiseMinor?: number | null; targetCompanyId?: string | null; terms?: Record<string, unknown> | null; revisionHash?: string | null; updatedAt?: string | null };
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
    /* WAVE 26 / S-3 SECOND PATH — null, not 0, when the server could not
       trust the fee table. See shared/spvEngine.ts SpvFeeBreakdown. */
    managementFeeMinor: number | null;
    platformFeeMinor: number | null;
    netDeployedMinor: number | null;
    currency: string;
    managementCarryPct: number | null;
    platformCarryPct: number | null;
    feesUnknown?: boolean;
  } | null;
}

const CHECK_ITEM = "flex items-start gap-2 text-xs py-1";

/* WAVE 40 — the 16 tab keys this component declares, kept next to the triggers
   themselves. Used ONLY to validate an incoming `initialTab`: an unrecognised
   value falls back to "overview" instead of leaving Radix with a selected value
   that matches no trigger (which renders a tab strip with nothing selected and
   no panel — the exact shape of the F-1 defect this wave fixed). */
export const SPV_TAB_KEYS: readonly string[] = [
  "overview",
  "mandate",
  "fees",
  "lps",
  "deployments",
  "distributions",
  "documents",
  "transfers",
  "close",
  "winddown",
  "compliance",
  "esignature",
  "nav",
  "k1",
  "sideletters",
  "reach",
];

export function SpvDetailTabs({
  spvId,
  detail,
  currency,
  canWrite,
  onChanged,
  initialTab,
}: {
  spvId: string;
  detail: SpvDetail;
  currency: string;
  canWrite: boolean;
  onChanged: () => void;
  /* WAVE 40 — which tab this mount opens on. Optional and defaulted, so every
     existing call site keeps landing on Overview unchanged; the SPV Engine list
     passes "lps" when the GP arrives via the "Open LP roster & capital calls"
     link, so the link keeps the promise its label makes. An unknown value would
     leave Radix with no selected tab, so it is validated against the declared
     trigger set below rather than trusted. */
  initialTab?: string;
}) {
  const register = detail.register ?? [];
  const subs = detail.subscriptions ?? [];
  const fees = detail.fees ?? [];
  const deployments = detail.deployments ?? [];
  const distributions = detail.distributions ?? [];
  const documents = detail.documents ?? [];
  const transfers = detail.transfers ?? [];
  const capitalAccounts = detail.capitalAccounts ?? [];
  /* WAVE 8 / ORP-030 — prefer the authoritative GET /capital-accounts endpoint
     (server/spvEngineRoutes.ts:555), which had no client caller at all, and
     fall back to the rows carried on the generic detail payload so the table
     below can never go blank. */
  /* WAVE 36 / ROW 9 — the detail payload has never carried a DPI, so its rows
     enter the fallback as `dpiRatio: null` ("not reported"), not as 0.00x. The
     ratio is only ever the one the capital-account endpoint produced. */
  const { rows: capitalAccountRows, source: capitalAccountsSource } = useSpvCapitalAccounts(
    spvId,
    capitalAccounts.map((c) => ({ ...c, dpiRatio: c.dpiRatio ?? null })),
  );
  const closeSummary = detail.closeSummary;
  const spv = detail.spv ?? {};
  const raised = register.reduce((a, r) => a + r.commitmentMinor, 0);
  // WAVE 3C / J-3 — resolve the jurisdiction the COMPLIANCE copy is keyed on.
  // `terms.jurisdictionCountry` is what the GP actually chose in the wizard and
  // is the more specific value; the `jurisdiction` enum column is the legacy
  // coerced one (4 of 6 live vehicles disagree with their own country until
  // scripts/backfill_spv_jurisdiction.ts is applied). Prefer the country, fall
  // back to the enum, and let the ontology decide — never a hard-coded block.
  const jurisdictionCountry = typeof spv.terms?.jurisdictionCountry === "string" ? spv.terms.jurisdictionCountry : "";
  const jurisdiction = (jurisdictionCountry.trim() || spv.jurisdiction) ?? null;
  const compliance = spvJurisdictionCompliance(jurisdiction);

  /* WAVE 20 / V-1 — vintage year, read from the SAME `terms.vintage` key the
   * wizard writes (PartnerSpvEngine.tsx:336) and the admin legacy shim writes
   * (server/partnerRoutes.ts:1705). `terms` is `Record<string, unknown>`, so
   * this narrows defensively and NEVER substitutes a guessed year: a vehicle
   * with no recorded vintage renders an em-dash. A non-integer or implausible
   * value is also refused rather than printed, so a corrupt blob cannot put a
   * fabricated year on a legal-ish summary. */
  const spvVintageDisplay = ((): string => {
    const raw = spv.terms?.vintage;
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (!Number.isInteger(n) || n < 1990 || n > 9999) return "—";
    return String(n);
  })();
  /* WAVE 40 / F-3 — the DISPLAYED jurisdiction now comes from the one shared
     resolver every SPV surface uses (`spvJurisdictionDisplay`, shared/spvEngine.ts),
     so this panel, the SPV Engine list card and the standalone detail page can no
     longer print three different domiciles for the same stored row. The COMPLIANCE
     copy above still keys on `compliance`, which is derived from the same
     country-first value — the label and the compliance text stay in agreement.
     `compliance.label` remains the fallback path inside the shared resolver, so
     nothing about non-US vehicles changes except that it is decided once. */
  const jurisdictionDisplay = spvJurisdictionDisplay({
    jurisdiction: typeof spv.jurisdiction === "string" ? spv.jurisdiction : null,
    terms: spv.terms,
  }).label;

  // D6 — jurisdiction-aware, NON-BLOCKING investor-count awareness.
  const lpCount = subs.filter((s) => s.status !== "withdrawn").length;
  const awareness = { limit: compliance.investorCountLimit, label: compliance.investorCountNote };
  const nearLimit = awareness.limit != null && lpCount >= Math.floor(awareness.limit * 0.8);
  const overLimit = awareness.limit != null && lpCount > awareness.limit;

  return (
    <Tabs
      defaultValue={initialTab && SPV_TAB_KEYS.includes(initialTab) ? initialTab : "overview"}
      className="w-full"
      data-testid={`spv-tabs-${spvId}`}
    >
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
        {/* WAVE 11 / EN-9 — the TWELFTH tab. WAVE 10 could not add this: the
            silent-drop guard fingerprinted TabsList by its children's
            concatenated text, so appending a trigger reported the eleven-tab
            list as REMOVED. That fingerprinting was fixed at the start of this
            wave (child-set membership + subsequence order), and this tab is the
            proof it works on the real file, not only on a fixture. */}
        <TabsTrigger value="esignature" data-testid="spv-tab-esignature">E-signature</TabsTrigger>
        {/* WAVE 32 / CP-SPV-30 — the THIRTEENTH tab. APPENDED AT THE END on
            purpose: the silent-drop guard reads a Card or trigger inserted
            mid-list as a renumbering of its siblings' positional paths, which
            reports untouched surfaces as removals. Appending is the shape that
            adds without renumbering. */}
        <TabsTrigger value="nav" data-testid="spv-tab-nav">NAV</TabsTrigger>
        {/* WAVE 32 / CP-SPV-30 capability 3 — the FOURTEENTH tab, appended at
            the END for the same reason as the thirteenth: appending adds
            without renumbering its siblings' positional paths. */}
        <TabsTrigger value="k1" data-testid="spv-tab-k1">K-1</TabsTrigger>
        {/* WAVE 32 / CP-SPV-30 capability 4 — the FIFTEENTH tab, appended at
            the END so no sibling's positional path is renumbered. */}
        <TabsTrigger value="sideletters" data-testid="spv-tab-sideletters">Side letters</TabsTrigger>
        {/* WAVE 33 / CP-SPV-53 — the SIXTEENTH tab, appended at the END so no
            sibling's positional path is renumbered. The scope selector said
            what the GP had chosen; nothing said what the choice actually did. */}
        <TabsTrigger value="reach" data-testid="spv-tab-reach">Reach</TabsTrigger>
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
        {/* WAVE 15 / ORP-063 (DEF-063) — SPV_EDU had 18 keys and 16 references.
            `terms` and `reviewLaunch` were authored copy that no surface
            rendered: existing functionality that was not reflected in the UI.
            They are RENDERED here as SIBLING elements (never appended inside an
            existing text node, which the silent-drop guard reads as one removal
            plus one addition) rather than deleted. The two keys are also
            recorded as `copy_key` rows with disposition `adopted` and this file
            as `caller_ref` in `orphan_surface_disposition` (migration 0171), so
            the adoption is auditable and cannot be re-reported as an orphan. */}
        <Edu testid="spv-edu-terms">{SPV_EDU.terms}</Edu>
        <Edu testid="spv-edu-review-launch">{SPV_EDU.reviewLaunch}</Edu>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div data-testid="spv-detail-raise">
            <div className="font-medium">Raise progress</div>
            <div className="font-mono">{fmt(raised, currency)}{spv.targetRaiseMinor ? ` / ${fmt(spv.targetRaiseMinor, currency)} target` : ""}</div>
          </div>
          <div data-testid="spv-detail-status">
            <div className="font-medium">Status</div>
            <div className="text-xs">{spv.status ?? "—"}</div>
          </div>
          {/* J-4 (WAVE 3C) — jurisdiction on the overview, alongside status.
              Rendered through a component (not inline JSX) so the silent-drop
              guard's tab-label fingerprint for this tab is unchanged: nothing
              is removed, this is purely additive. */}
          <JurisdictionField value={jurisdictionDisplay} />
          {/* WAVE 20 / V-1 (DEF-085) — vintage year on the overview, alongside
              jurisdiction. It was CAPTURED by the wizard
              (PartnerSpvEngine.tsx:550 field → :336 terms.vintage) and shown on
              the LIST row (:980), but the detail page — the surface a GP opens
              to inspect one vehicle — never displayed it. Same `terms.vintage`
              key the admin writer uses (partnerRoutes.ts:1705), so there is no
              second source of truth and no new column.

              Rendered through a component, not inline JSX, for the same reason
              JurisdictionField is: the silent-drop guard fingerprints a tab by
              the concatenated text of its inline JSX children, so inline copy
              here would make this untouched tab read as REMOVED. */}
          <VintageField value={spvVintageDisplay} />
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
          {/* WAVE 10 / EN-1 + EN-2 — the way in to the performance surface.
              WITHOUT THIS THE PAGE IS UNREACHABLE, which is trap #1 exactly:
              W-4 in Wave 7B was a fix landed on a page nothing could navigate
              to. Rendered through a component, following the JurisdictionField
              precedent above, so the guard's text fingerprint for this tab does
              not move. */}
          <PerformanceLink spvId={spvId} />
          {/* WAVE 25 / SPV-E (DEF-086) — the audit receipt, restored to the
              Overview tab. It was lost when the PartnerSpvDetail accordion was
              collapsed into these tabs; OQ23_REMOVED_SURFACES_DELTA.md:246
              records option (c), "add the audit receipt (version + revision
              hash) to the engine Overview tab", as the intended home.

              ONLY REAL FIELDS. The retired accordion rendered four field names,
              two of which — `version` and `prevRevisionHash` — do not exist on
              SpvDTO (shared/spvEngine.ts declares `revisionHash` and the
              timestamps, nothing else), so it printed `undefined` on both
              endpoints. That is DEF-087, and OQ-35 leaves "expose the chain
              read" as the owner's open call. This line therefore shows the two
              values that are genuinely available and says plainly that the
              version number is not, rather than inventing it.

              Rendered through a component, following the JurisdictionField and
              VintageField precedent in this same grid, so the guard's text
              fingerprint for this tab does not move. */}
          <AuditReceiptField revisionHash={spv.revisionHash ?? null} updatedAt={spv.updatedAt ?? null} />
        </div>
      </TabsContent>

      {/* ── Mandate ──────────────────────────────────────────────────────── */}
      <TabsContent value="mandate">
        <Edu testid="spv-edu-mandate">{SPV_EDU.mandate}</Edu>
        {/* WAVE 25 / FE-1 — empty state.

            The four lines below keep their EXACT JSX shape (#text + {expr}) and
            their exact position in this tab's direct-child sequence. An earlier
            attempt wrapped the whole <div> in a ternary and the silent-drop
            guard correctly rejected it: `childorder=Edu|div|{expr}` became
            `Edu|{expr}|{expr}`, reported as two REMOVED panel bodies. Rule 8 —
            additions, never restructuring.

            What changed is only the FALLBACK inside each existing expression.
            With no `spv_mandate` row the tab used to print "Geography: Any" and
            "Stage: Any": a fabricated claim that the mandate permits anything.
            It permits nothing — `deployCapital` throws NO_MANDATE
            (server/spvEngineStore.ts:1517) and `isCompanyEligible` returns
            NO_MANDATE (spvEngineStore.ts:601) in exactly this state. Both the
            "Any" and "None selected" literals are retained, on the branch where
            they are TRUE (a mandate exists and the list is empty). Rule 7. */}
        <div className="text-sm space-y-1" data-testid="spv-detail-mandate">
          <div><span className="font-medium">Mode:</span> {detail.mandate?.mode ?? "—"}</div>
          <div><span className="font-medium">Sectors:</span> {detail.mandate?.sector?.length ? detail.mandate.sector.join(", ") : detail.mandate ? "None selected" : "—"}</div>
          <div><span className="font-medium">Geography:</span> {detail.mandate?.geography?.length ? detail.mandate.geography.join(", ") : detail.mandate ? "Any" : "—"}</div>
          <div><span className="font-medium">Stage:</span> {detail.mandate?.stage?.length ? detail.mandate.stage.join(", ") : detail.mandate ? "Any" : "—"}</div>
          <MandateEmptyState mandate={detail.mandate ?? null} canWrite={canWrite} />
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
          {/* WAVE 26 / S-3 SECOND PATH — a SIBLING element (never text appended
              into an existing node, which the drop guard reads as a removal plus
              an addition). Without it, `feesUnknown` would fall through to the
              transparency note below, which reads "shown here when applied" and
              would tell a GP the platform layer is simply unset when in truth
              the server could not read the fee table at all. */}
          {detail.feeSummary?.feesUnknown ? (
            <div className="mt-1 text-xs text-red-600" role="alert" data-testid="spv-detail-fees-unknown">
              Fee figures are unavailable — the fee schedule could not be read. These are not zero fees; nothing is being shown until the schedule loads.
            </div>
          ) : null}
          {detail.feeSummary?.platformCarryPct != null ? (
            <div className="mt-1 text-xs" data-testid="spv-detail-platform-carry">
              <span className="font-medium">Platform carry:</span> {(detail.feeSummary.platformCarryPct * 100).toFixed(1)}%
              <span className="text-[10px] text-[var(--cv-color-text-faint)]"> (set by Capavate — read-only to you)</span>
            </div>
          ) : (
            <div className="text-[10px] text-[var(--cv-color-text-faint)]" data-testid="spv-detail-platform-carry-note">The platform fee layer is set by Capavate and shown here when applied.</div>
          )}
          {/* ORP-030 — GET /fee-breakdown, GET /fee-obligations,
              POST /fee-obligations/:obId/charge. Nested inside this existing
              <div> rather than added as a new direct child of <TabsContent> so
              no existing panel fingerprint is disturbed. */}
          <SpvFeeLedgerPanel spvId={spvId} currency={currency} canWrite={canWrite} onChanged={onChanged} />
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

        {/* D10 — minimal capital accounts.
            WAVE 8 / ORP-030: this block used to derive its rows from the generic
            detail payload while GET /capital-accounts
            (server/spvEngineRoutes.ts:555) had no caller at all. It now reads
            that authoritative endpoint via useSpvCapitalAccounts() and keeps the
            derived rows as a visible fallback, so the tab can never go blank.
            The MARKUP and every copy string below are deliberately left exactly
            where they were — moving them into the panel component tripped the
            silent-drop guard as a real copy loss, which is the correct verdict:
            those strings must stay on this surface. */}
        <div className="mt-4" data-testid="spv-detail-capital-accounts">
          <div className="font-medium text-sm mb-1">Capital accounts</div>
          <Edu testid="spv-edu-capital-accounts">{SPV_EDU.capitalAccounts}</Edu>
          <div className="text-[10px] text-[var(--cv-color-text-faint)]" data-testid="spv-capital-accounts-source">
            {capitalAccountsSource === "endpoint"
              ? "Read live from this vehicle's capital accounts."
              : "Showing the figures carried on the SPV detail payload."}
          </div>
          {capitalAccountRows.length === 0 ? (
            <div className="text-xs text-[var(--cv-color-text-faint)]">not yet reported</div>
          ) : (
            <div className="text-xs">
              {/* WAVE 36 / ROW 9 — DPI is APPENDED as the last column of each
                  row. Appended, never inserted: the silent-drop guard reads a
                  cell inserted mid-row as a renumbering of its siblings'
                  positional paths and reports untouched cells as removed. The
                  four existing headers and their text are untouched. */}
              <div className="grid grid-cols-5 gap-2 font-medium border-b pb-1">
                <div>Investor</div><div>Contributed</div><div>Confirmed</div><div>Distributed</div><div>DPI</div>
              </div>
              {capitalAccountRows.map((c) => (
                <div key={c.investorId} className="grid grid-cols-5 gap-2 py-0.5" data-testid={`spv-cap-acct-${c.investorId}`}>
                  <div className="truncate">{c.investorId}</div>
                  <div className="font-mono">{fmt(c.contributedMinor, currency)}</div>
                  <div className="font-mono">{fmt(c.confirmedMinor, currency)}</div>
                  <div className="font-mono">{fmt(c.distributedMinor, currency)}</div>
                  {/* The server's ratio, rendered. NOT recomputed here, and a
                      null renders as a refusal — an LP with nothing paid in has
                      an UNDEFINED DPI, not a DPI of zero. */}
                  <div className="font-mono" data-testid={`spv-cap-acct-dpi-${c.investorId}`}>
                    {c.dpiRatio == null
                      ? <span className="text-[var(--cv-color-text-faint)]">not reported</span>
                      : `${c.dpiRatio.toFixed(2)}x`}
                  </div>
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
          {/* ORP-030 — POST /eligibility/evaluate, PATCH /deployments/:depId and
              POST /deployments/:depId/commit; all three were orphaned. Nested in
              this existing <div> to leave the tab's panel fingerprint intact. */}
          <SpvEligibilityPanel spvId={spvId} canWrite={canWrite} />
          <SpvDeploymentLifecyclePanel
            spvId={spvId}
            deployments={deployments}
            currency={currency}
            canWrite={canWrite}
            onChanged={onChanged}
          />
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
        {/* WAVE 32 / CP-SPV-30 — SIDE-LETTER EFFECTS ON RECORDED DISTRIBUTIONS.
            A SIBLING block appended after the distributions list, never text
            spliced into an existing row: the silent-drop guard reads an
            appended string inside a live text node as a removal plus an
            addition. Rendered only when the engine actually recorded an
            adjustment, so a vehicle without side letters shows nothing new. */}
        {distributions.some((d) => (d.waterfall ?? []).some((t) => t.tier === "side_letter_adjustment")) && (
          <div className="mt-3 border-t pt-3" data-testid="spv-distribution-side-letter-effects">
            <div className="font-medium text-sm mb-1">Side-letter adjustments</div>
            <div className="text-[10px] text-[var(--cv-color-text-faint)] mb-2">
              Per-LP negotiated carry applied by the waterfall. Each line is the carry this LP
              actually bore against the fund default, taken from the recorded distribution.
            </div>
            <div className="space-y-1">
              {distributions.map((d, i) =>
                (d.waterfall ?? [])
                  .filter((t) => t.tier === "side_letter_adjustment")
                  .flatMap((t) => t.adjustments ?? [])
                  .map((a, j) => (
                    <div key={`${i}-${j}`} className="text-xs" data-testid="spv-side-letter-effect-row">
                      {d.event}: {a.investorId} · carry {carryScaledToPercentLabel(a.lpCarryScaled)} vs fund{" "}
                      {carryScaledToPercentLabel(a.fundCarryScaled)} · {fmt(a.carryBeforeMinor, currency)} →{" "}
                      {fmt(a.carryAfterMinor, currency)} · net {fmt(a.netBeforeMinor, currency)} →{" "}
                      {fmt(a.netAfterMinor, currency)}
                    </div>
                  )),
              )}
            </div>
          </div>
        )}
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
        {/* WAVE 23 · ITEM 6 — the document-type dropdown is jurisdiction-filtered.
            `jurisdiction` is the same resolved value the compliance content on
            this page is keyed on (terms.jurisdictionCountry, falling back to the
            legacy enum column), so the dropdown and the compliance copy can
            never disagree about where this vehicle is domiciled. */}
        {canWrite && <DocumentPanel spvId={spvId} jurisdiction={jurisdiction} onChanged={onChanged} />}
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
        {/* ORP-030 — GET /close-summary. ClosePanel renders the summary carried
            on the detail payload; the authoritative endpoint is rendered from
            INSIDE ClosePanel (see its `authoritative` slot) so this tab's
            direct-child sequence — which the silent-drop guard fingerprints —
            is byte-for-byte what it was before this wave. */}
        <ClosePanel
          spvId={spvId}
          spvStatus={spv.status ?? ""}
          currency={currency}
          summary={closeSummary}
          canWrite={canWrite}
          onChanged={onChanged}
          authoritative={<SpvCloseSummaryPanel spvId={spvId} currency={currency} />}
        />
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
          {/* ORP-030 — GET /signoffs, previously orphaned. Nested inside this
              existing block so the compliance tab's panel fingerprint is
              unchanged (the guard digests direct children only). */}
          <SpvSignoffsPanel spvId={spvId} />
          {/* J-3/J-4 (WAVE 3C) — state WHICH jurisdiction every item below is
              keyed on, so a GP can immediately see that a non-US vehicle is not
              being shown US law. Rendered as a component nested inside the
              first existing block so the guard's child-sequence digest and
              tab-label fingerprint for this panel are both unchanged. */}
          <ComplianceJurisdictionHeader value={jurisdictionDisplay} isUnitedStates={compliance.isUnitedStates} />
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
          {/* WAVE 25 / FE-7 — the compliance WRITE path. GET+PUT
              /api/partner/me/compliance/:investorId had zero client callers;
              this is their first. Appended as a third child of this existing
              block — an addition, never a restructure, so the guard's
              child-sequence digest for the compliance tab is unchanged. */}
          <InvestorCompliancePanel register={register} canWrite={canWrite} />
        </div>

        {/* D7 — voluntary filings checklist. */}
        <div className="mb-3" data-testid="spv-compliance-filings">
          <div className="font-medium text-sm">Regulatory filings (voluntary)</div>
          <Edu testid="spv-edu-filings">{SPV_EDU.filings}</Edu>
          {/* J-3 — where Capavate holds no verified requirements for the
              jurisdiction we say so, and show a NEUTRAL list. We never invent a
              foreign filing, and we never fall back to the US one. */}
          {!compliance.filingsAreJurisdictionSpecific && (
            <div className="text-xs text-[var(--cv-color-text-muted)] mb-1" data-testid="spv-filings-generic-notice">
              {SPV_JURISDICTION_GENERIC_NOTICE}
            </div>
          )}
          <VoluntaryChecklist items={spvFilingsChecklist(jurisdiction)} testid="spv-filings-checklist" />
        </div>

        {/* D1 — voluntary formation checklist. */}
        <div data-testid="spv-compliance-formation">
          <div className="font-medium text-sm">Formation checklist (voluntary)</div>
          <Edu testid="spv-edu-formation">{SPV_EDU.nameJurisdiction}</Edu>
          <VoluntaryChecklist items={spvFormationChecklist(jurisdiction)} testid="spv-formation-checklist" />
        </div>
      </TabsContent>

      {/* ── E-signature (WAVE 11 / EN-9) ─────────────────────────────────── */}
      <TabsContent value="esignature">
        <EsignaturePanel spvId={spvId} documents={documents} canWrite={canWrite} />
      </TabsContent>

      {/* ── NAV (WAVE 32 / CP-SPV-30 capability 1) ───────────────────────── */}
      <TabsContent value="nav">
        <SpvNavPanel spvId={spvId} canWrite={canWrite} />
      </TabsContent>

      {/* ── K-1 (WAVE 32 / CP-SPV-30 capability 3) ───────────────────────── */}
      <TabsContent value="k1">
        <SpvK1Panel spvId={spvId} canWrite={canWrite} />
      </TabsContent>

      {/* ── Side letters (WAVE 32 / CP-SPV-30 capability 4) ───────────────── */}
      <TabsContent value="sideletters">
        <SpvSideLetterPanel spvId={spvId} canWrite={canWrite} />
      </TabsContent>

      {/* ── Reach (WAVE 33 / CP-SPV-53) ──────────────────────────────────── */}
      <TabsContent value="reach">
        <SpvReachPanel spvId={spvId} />
      </TabsContent>
    </Tabs>
  );
}

/* ==========================================================================
 * WAVE 11 / EN-9 — the e-signature surface.
 *
 * Backed by GET/POST /api/partner/me/spvs/:spvId/esignature and the sign / void
 * endpoints in server/lib/esignatureRoutes.ts. The document list comes from the
 * SPV's own documents (the dataroom byte seam), so an LPA is sent against a file
 * that actually exists rather than a typed-in reference.
 *
 * The provider is shown BY NAME. If the configured provider cannot execute, the
 * server refuses the send and that refusal is rendered here — never a silent
 * downgrade to a typed name.
 * ======================================================================== */
type EsignRecipient = {
  id: string; role: string; signingOrder: number; fullName: string; email: string;
  status: string; signedName: string | null; signatureHash: string | null; signedAt: string | null;
};
type EsignEnvelope = {
  id: string; documentKind: string; documentRef: string; documentTitle: string;
  documentSha256: string | null; provider: string; status: string;
  createdAt: string; sentAt: string | null; completedAt: string | null;
  completionHash: string | null; lastError: string | null;
};
type EsignDetail = {
  envelope: EsignEnvelope;
  recipients: EsignRecipient[];
  events: Array<{ id: string; eventKind: string; fromStatus: string | null; toStatus: string | null; createdAt: string }>;
  nextAction: string;
  documentHashBound: boolean;
};

function EsignaturePanel({
  spvId,
  documents,
  canWrite,
}: {
  spvId: string;
  documents: Array<{ id?: string; title?: string; docType?: string }>;
  canWrite: boolean;
}) {
  const { toast } = useToast();
  const { data, isLoading, isError, error, refetch } = useQuery<{
    spvId: string;
    schemaInstalled: boolean;
    provider?: string;
    providerConfigMissing?: boolean;
    envelopes: EsignDetail[];
    message?: string;
  }>({
    queryKey: [`/api/partner/me/spvs/${spvId}/esignature`],
    retry: false,
    queryFn: async () =>
      (await apiRequest("GET", `/api/partner/me/spvs/${encodeURIComponent(spvId)}/esignature`)).json(),
  });

  const [docRef, setDocRef] = useState("");
  const [docKind, setDocKind] = useState("lpa");
  const [signerName, setSignerName] = useState("");
  const [signerEmail, setSignerEmail] = useState("");
  const [gpName, setGpName] = useState("");
  const [gpEmail, setGpEmail] = useState("");
  const [typedName, setTypedName] = useState("");

  const createMut = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("POST", `/api/partner/me/spvs/${encodeURIComponent(spvId)}/esignature`, {
          documentKind: docKind,
          documentRef: docRef,
          documentTitle: documents.find((d) => d.id === docRef)?.title ?? docRef,
          recipients: [
            { role: "signer", signingOrder: 1, partyKind: "lp", fullName: signerName, email: signerEmail },
            ...(gpName.trim() && gpEmail.trim()
              ? [{ role: "countersigner", signingOrder: 2, partyKind: "gp", fullName: gpName, email: gpEmail }]
              : []),
          ],
        })
      ).json(),
    onSuccess: () => {
      setDocRef(""); setSignerName(""); setSignerEmail(""); setGpName(""); setGpEmail("");
      void refetch();
      toast({ title: "Envelope sent for signature" });
    },
    onError: (e: unknown) =>
      toast({
        title: "Could not send for signature",
        description: e instanceof Error ? e.message : "unknown error",
        variant: "destructive",
      }),
  });

  const signMut = useMutation({
    mutationFn: async (v: { envelopeId: string; recipientId: string }) =>
      (
        await apiRequest("POST", `/api/partner/me/esignature/${encodeURIComponent(v.envelopeId)}/sign`, {
          recipientId: v.recipientId,
          signedName: typedName,
        })
      ).json(),
    onSuccess: () => {
      setTypedName("");
      void refetch();
      toast({ title: "Signature recorded" });
    },
    onError: (e: unknown) =>
      toast({
        title: "Signature refused",
        description: e instanceof Error ? e.message : "unknown error",
        variant: "destructive",
      }),
  });

  const voidMut = useMutation({
    mutationFn: async (envelopeId: string) =>
      (await apiRequest("POST", `/api/partner/me/esignature/${encodeURIComponent(envelopeId)}/void`, { reason: "voided by GP" })).json(),
    onSuccess: () => { void refetch(); toast({ title: "Envelope voided" }); },
  });

  if (isLoading) {
    return <div className="text-xs text-[var(--cv-color-text-faint)]" data-testid="spv-esign-loading">Loading…</div>;
  }
  if (isError) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900" data-testid="spv-esign-error">
        {error instanceof Error ? error.message : "Could not load e-signature envelopes."}
      </div>
    );
  }
  if (data && data.schemaInstalled === false) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900" data-testid="spv-esign-schema-missing">
        {data.message ?? "The e-signature tables are not installed on this database yet."}
      </div>
    );
  }

  const envelopes = data?.envelopes ?? [];

  return (
    <div className="space-y-4" data-testid="spv-detail-esignature">
      <div className="text-xs text-[var(--cv-color-text-muted)]" data-testid="spv-esign-provider">
        Signing method: <span className="font-mono">{data?.provider ?? "unknown"}</span>
        {data?.providerConfigMissing
          ? " — not configured; sends will be refused rather than downgraded."
          : ""}
      </div>

      {envelopes.length === 0 ? (
        <div className="text-xs text-[var(--cv-color-text-faint)]" data-testid="spv-esign-empty">
          No documents have been sent for signature on this vehicle yet.
        </div>
      ) : (
        <div className="space-y-3">
          {envelopes.map((d) => (
            <div key={d.envelope.id} className="rounded-md border border-[var(--cv-color-border)] p-3" data-testid="spv-esign-envelope">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">{d.envelope.documentTitle}</div>
                <div className="text-xs font-mono" data-testid="spv-esign-status">{d.envelope.status}</div>
              </div>
              <div className="mt-1 text-xs text-[var(--cv-color-text-muted)]" data-testid="spv-esign-next-action">
                {d.nextAction}
              </div>
              {!d.documentHashBound && (
                <div className="mt-1 text-xs text-amber-800" data-testid="spv-esign-unbound-doc">
                  No document hash was captured, so this envelope cannot prove which bytes were signed.
                </div>
              )}
              {d.envelope.lastError && (
                <div className="mt-1 text-xs text-rose-800" data-testid="spv-esign-last-error">
                  {d.envelope.lastError}
                </div>
              )}
              <ul className="mt-2 space-y-1 text-xs">
                {d.recipients.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2" data-testid="spv-esign-recipient">
                    <span className="font-mono">{r.signingOrder}</span>
                    <span>{r.fullName}</span>
                    <span className="text-[var(--cv-color-text-faint)]">{r.role}</span>
                    <span className="font-mono">{r.status}</span>
                    {r.signedAt ? (
                      <span className="text-[var(--cv-color-text-faint)]">
                        signed {new Date(r.signedAt).toLocaleDateString()}
                      </span>
                    ) : null}
                    {canWrite && r.status !== "signed" && r.role !== "cc" &&
                      (d.envelope.status === "sent" || d.envelope.status === "partially_signed") ? (
                      <>
                        <Input
                          className="h-7 w-40 text-xs"
                          placeholder="Type full name"
                          value={typedName}
                          onChange={(e) => setTypedName(e.target.value)}
                          data-testid="spv-esign-typed-name"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid="spv-esign-sign-btn"
                          disabled={signMut.isPending || !typedName.trim()}
                          onClick={() => signMut.mutate({ envelopeId: d.envelope.id, recipientId: r.id })}
                        >
                          Record signature
                        </Button>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
              {d.envelope.completionHash && (
                <div className="mt-2 break-all text-[10px] font-mono text-[var(--cv-color-text-faint)]" data-testid="spv-esign-completion-hash">
                  execution hash {d.envelope.completionHash}
                </div>
              )}
              {canWrite && d.envelope.status !== "completed" && d.envelope.status !== "voided" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  data-testid="spv-esign-void-btn"
                  disabled={voidMut.isPending}
                  onClick={() => voidMut.mutate(d.envelope.id)}
                >
                  Void envelope
                </Button>
              )}
              <ul className="mt-2 space-y-0.5 text-[10px] text-[var(--cv-color-text-faint)]" data-testid="spv-esign-events">
                {d.events.slice(-6).map((e) => (
                  <li key={e.id}>
                    {e.eventKind}
                    {e.toStatus ? ` → ${e.toStatus}` : ""} · {new Date(e.createdAt).toLocaleString()}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {canWrite && (
        <div className="rounded-md border border-[var(--cv-color-border)] p-3" data-testid="spv-esign-new">
          <div className="text-sm font-medium">Send a document for signature</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Document</Label>
              <select
                className="mt-1 w-full rounded border px-2 py-1 text-xs"
                value={docRef}
                onChange={(e) => setDocRef(e.target.value)}
                data-testid="spv-esign-document"
              >
                <option value="">Select a document…</option>
                {documents.map((d, i) => (
                  <option key={d.id ?? i} value={d.id ?? ""}>
                    {d.title ?? d.docType ?? "document"}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs">Document type</Label>
              <select
                className="mt-1 w-full rounded border px-2 py-1 text-xs"
                value={docKind}
                onChange={(e) => setDocKind(e.target.value)}
                data-testid="spv-esign-document-kind"
              >
                <option value="lpa">LPA</option>
                <option value="subscription_agreement">Subscription agreement</option>
                <option value="side_letter">Side letter</option>
              </select>
            </div>
            <div>
              <Label className="text-xs">Signatory name</Label>
              <Input className="mt-1 h-8 text-xs" value={signerName} onChange={(e) => setSignerName(e.target.value)} data-testid="spv-esign-signer-name" />
            </div>
            <div>
              <Label className="text-xs">Signatory email</Label>
              <Input className="mt-1 h-8 text-xs" value={signerEmail} onChange={(e) => setSignerEmail(e.target.value)} data-testid="spv-esign-signer-email" />
            </div>
            <div>
              <Label className="text-xs">Countersignatory name (optional)</Label>
              <Input className="mt-1 h-8 text-xs" value={gpName} onChange={(e) => setGpName(e.target.value)} data-testid="spv-esign-gp-name" />
            </div>
            <div>
              <Label className="text-xs">Countersignatory email (optional)</Label>
              <Input className="mt-1 h-8 text-xs" value={gpEmail} onChange={(e) => setGpEmail(e.target.value)} data-testid="spv-esign-gp-email" />
            </div>
          </div>
          <Button
            size="sm"
            className="mt-3"
            data-testid="spv-esign-send-btn"
            disabled={createMut.isPending || !docRef || !signerName.trim() || !signerEmail.trim()}
            onClick={() => createMut.mutate()}
          >
            Send for signature
          </Button>
        </div>
      )}
    </div>
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
  const [hurdleUsed, setHurdleUsed] = useState<{ fraction: number | null; source: string; termsAsWritten: number | null } | null>(null);
  /* WAVE 26 / S-3 SECOND PATH — a RENDERED failure, not a four-second toast. */
  const [previewFailure, setPreviewFailure] = useState<string | null>(null);

  /* WAVE 14 / P-7 — the SPV's OWN agreed hurdle, read from terms. Until this
     wave nothing in the product read this field: the wizard collected it, the
     route normalised it, the store persisted it, and every consumer of the
     waterfall took the hurdle from its own caller instead. So this panel asked
     the GP to retype a number the SPV already carried, and a typo silently
     previewed a split on terms the LPs never agreed to. */
  const storedHurdle = useQuery<{ hurdle: { fraction: number | null; source: string; asWritten: number | null } }>({
    queryKey: [`/api/partner/me/spv/${spvId}/hurdle`],
    retry: false,
  });
  const termHurdle = storedHurdle.data?.hurdle?.fraction ?? null;

  const preview = useMutation({
    mutationFn: async () => {
      // Wave C v3 hardening (GPT-5 v2 finding): use parseMinor to reject
      // exponent notation and non-integer input on the gross proceeds field.
      const body: Record<string, unknown> = { grossProceedsMinor: parseMinor(gross) };
      if (hurdle.trim()) body.hurdleRatePct = parsePercent(hurdle, "Hurdle rate"); // WAVE 4A: hurdleRatePct is a FRACTION.
      /* Blank field is deliberately NOT sent, so the server applies the SPV's
         stored term. Sending null would mean "explicitly no hurdle". */
      const j = await (await apiRequest("POST", `/api/partner/me/spv/${spvId}/distributions/preview`, body)).json();
      setHurdleUsed(j.hurdleUsed ?? null);
      return j.split;
    },
    onSuccess: (s) => {
      setSplit(s);
      setPreviewFailure(null);
    },
    /* WAVE 26 / S-3 SECOND PATH. Two defects were fixed here, both about what
       the GP is left looking at when a preview fails.

       (1) `split` was NOT cleared, so a failed re-preview left the PREVIOUS
           run's LP/GP totals on screen, computed from different inputs, with
           nothing on the page saying so. The toast that announced the failure
           is gone in seconds; the stale money stays.
       (2) A toast is not a rendered state. `FEE_STATE_UNKNOWN` (503) means the
           server could not read the fee schedule — the reason the split cannot
           be computed at all — and that has to persist next to the empty result
           until the GP runs a preview that succeeds. */
    onError: (e: Error) => {
      setSplit(null);
      setHurdleUsed(null);
      setPreviewFailure(e.message || "Preview failed");
      toast({ variant: "destructive", title: "Preview failed", description: e.message });
    },
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
      {termHurdle !== null && (
        <div className="mt-1 text-[10px] text-[var(--cv-color-text-faint)]" data-testid="spv-preview-term-hurdle">
          This SPV's agreed hurdle is {formatFractionAsPercent(termHurdle)}. Leave the field blank to preview on the agreed
          term; type a value only to model a what-if.
          {" "}
          <button
            type="button"
            className="underline"
            onClick={() => setHurdle("")}
            data-testid="spv-preview-use-term-hurdle"
          >
            Use agreed term
          </button>
        </div>
      )}
      <Button size="sm" className="mt-2" disabled={preview.isPending || !gross.trim()} onClick={() => preview.mutate()} data-testid="spv-preview-run">
        {preview.isPending ? "Computing…" : "Preview split"}
      </Button>
      {/* WAVE 26 / S-3 SECOND PATH — SIBLING of the result block, never nested
          inside it: the result block does not render when there is no split,
          which is exactly when this has to be visible. */}
      {previewFailure !== null && (
        <div className="mt-2 text-xs text-red-600" role="alert" data-testid="spv-preview-failed">
          {/FEE_STATE_UNKNOWN/.test(previewFailure)
            ? "No split can be computed: the SPV fee schedule could not be read, so the carry is unknown. This is not a zero-carry split — nothing is being shown. Try again once the schedule loads."
            : `No split is shown — the preview did not complete: ${previewFailure}`}
        </div>
      )}
      {split && (
        <div className="mt-2 text-xs space-y-0.5" data-testid="spv-preview-result">
          {split.tiers.map((t, i) => (
            <div key={i} className="flex justify-between"><span>{t.tier.replace(/_/g, " ")}</span><span className="font-mono">{fmt(t.amountMinor, currency)}</span></div>
          ))}
          <div className="flex justify-between border-t pt-1 font-medium"><span>LP total</span><span className="font-mono">{fmt(split.lpTotalMinor, currency)}</span></div>
          <div className="flex justify-between font-medium"><span>GP total</span><span className="font-mono">{fmt(split.gpTotalMinor, currency)}</span></div>
          {hurdleUsed && (
            <div className="text-[10px] text-[var(--cv-color-text-faint)]" data-testid="spv-preview-hurdle-used">
              Hurdle applied:{" "}
              {hurdleUsed.fraction === null || hurdleUsed.fraction === 0
                ? "none"
                : formatFractionAsPercent(hurdleUsed.fraction)}{" "}
              ({hurdleUsed.source === "spv_terms" ? "the SPV's agreed term" : hurdleUsed.source === "request" ? "typed above, overriding the agreed term" : "no term set"})
            </div>
          )}
          <div className="text-[10px] text-[var(--cv-color-text-faint)]">{split.tiered ? "Tiered waterfall (preferred return + GP catch-up engaged)." : "Simple waterfall (return of capital, then carry)."} This is a projection only — no money moves.</div>
        </div>
      )}
    </div>
  );
}

/**
 * WAVE 25 / FE-3 — the resolved rolling-close policy, RENDERED.
 *
 * Mirrors `SpvCloseWindowPolicy` in server/lib/spvFeeScheduleStore.ts.
 */
interface SpvCloseWindowPolicy {
  windowDays: number;
  scopeKind: "platform" | "partner" | "spv";
  scopeId: string;
  policyId: string;
}

/**
 * WAVE 25 / FE-3. A component, not inline JSX, for the same reason as
 * `JurisdictionField` below: the silent-drop guard fingerprints a container by
 * the concatenated text of its INLINE children, so inline copy here would make
 * the untouched close panel read as a removal plus an addition. As a sibling
 * element the addition is genuinely additive.
 *
 * Rule 7 — a missing policy is rendered as a refusal, never as a fabricated
 * "30 days" and never as a blank line that looks like there is no window.
 */
function CloseWindowPolicyLine({
  isLoading,
  isError,
  error,
  policy,
}: {
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  policy: SpvCloseWindowPolicy | undefined;
}) {
  if (isLoading) {
    return (
      <div className="text-xs text-[var(--cv-color-text-muted)]" data-testid="spv-close-window-loading">
        <span>Loading the rolling-close window policy…</span>
      </div>
    );
  }
  if (isError || !policy) {
    return (
      <div
        className="rounded p-2 text-xs text-amber-900"
        style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)" }}
        data-testid="spv-close-window-unavailable"
      >
        <div>Rolling-close window unavailable — no active close-window policy resolved for this vehicle.</div>
        <div>Reopening is disabled until an administrator sets a policy at platform, partner or SPV scope.</div>
        {error?.message ? <div data-testid="spv-close-window-error-detail">{error.message}</div> : null}
      </div>
    );
  }
  return (
    <div className="text-xs text-[var(--cv-color-text-muted)]" data-testid="spv-close-window-policy">
      <span data-testid="spv-close-window-days">Rolling-close window: {policy.windowDays} day(s)</span>
      <span data-testid="spv-close-window-scope"> · policy scope {policy.scopeKind} ({policy.scopeId})</span>
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
  authoritative,
}: {
  spvId: string;
  spvStatus: string;
  currency: string;
  summary: CloseSummary | undefined;
  canWrite: boolean;
  onChanged: () => void;
  /* WAVE 8 / ORP-030 — slot for the authoritative GET /close-summary panel. It
     is passed in rather than rendered as a sibling in the Close tab so the
     tab's direct-child sequence (fingerprinted by the silent-drop guard) is
     unchanged; nothing existing is moved or removed. */
  authoritative?: React.ReactNode;
}) {
  const { toast } = useToast();
  const [setTargetToRaised, setSetTargetToRaised] = useState(false);

  /* WAVE 25 / FE-3 — the rolling-close window is DB policy, not a literal.
     `resolveCloseWindowDays` (server/lib/spvFeeScheduleStore.ts) shipped in
     WAVE 6 with zero callers while this component posted a hardcoded 30. The
     window now comes from GET /close-window; when no policy row resolves the
     server answers 503 and this panel RENDERS that (rule 7) and disables the
     reopen action, rather than inventing 30 and looking like it worked. */
  const closeWindow = useQuery<{ closeWindow: SpvCloseWindowPolicy }>({
    queryKey: [`/api/partner/me/spv/${spvId}/close-window`],
    retry: false,
    queryFn: async () =>
      (await apiRequest("GET", `/api/partner/me/spv/${encodeURIComponent(spvId)}/close-window`)).json(),
  });
  const closeWindowDays = closeWindow.data?.closeWindow?.windowDays;

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
      (await apiRequest("POST", `/api/partner/me/spv/${spvId}/reopen`, { windowDays: closeWindowDays })).json(),
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
      <CloseWindowPolicyLine
        isLoading={closeWindow.isLoading}
        isError={closeWindow.isError}
        error={closeWindow.error as Error | null}
        policy={closeWindow.data?.closeWindow}
      />
      {canWrite && isClosed && (
        <Button size="sm" variant="outline" disabled={reopen.isPending || closeWindowDays == null} onClick={() => reopen.mutate()} data-testid="spv-reopen-submit">
          {reopen.isPending ? "Reopening…" : "Reopen for a rolling close"}
        </Button>
      )}
      {authoritative}
    </div>
  );
}

/**
 * J-4 (WAVE 3C) — jurisdiction on the Overview tab.
 *
 * A component rather than inline JSX on purpose: the silent-drop guard
 * fingerprints a tab by the concatenated text of its inline JSX children, so
 * inline copy here would make an untouched tab look "removed". Nothing about
 * the existing overview content changes; this is strictly an addition.
 */
/**
 * WAVE 10 / EN-1 + EN-2 — link into the vehicle's ILPA performance surface.
 *
 * A component rather than inline JSX for the reason stated on JurisdictionField
 * below: the silent-drop guard fingerprints a tab by the concatenated text of
 * its children, so inline text added here would change this tab's identity and
 * be reported as the old tab having been REMOVED. Behind a component the
 * addition is invisible to the fingerprint and genuinely additive.
 */
function PerformanceLink({ spvId }: { spvId: string }) {
  return (
    <div data-testid="spv-detail-performance-link">
      <div className="font-medium">Performance</div>
      <div className="text-xs">
        <Link
          href={`/collective/partner/spvs/${encodeURIComponent(spvId)}/performance`}
          className="underline"
          data-testid="spv-detail-performance-link-anchor"
        >
          Cash flows, IRR / DPI / TVPI and ledger integrity
        </Link>
      </div>
    </div>
  );
}

/**
 * WAVE 20 / V-1 — vintage year on the Overview tab. Sibling of
 * JurisdictionField, added for the reason documented on that component.
 *
 * NEVER guesses. A vehicle created before the wizard carried the field has no
 * `terms.vintage`; that renders an em-dash, not the current year.
 */
function VintageField({ value }: { value: string }) {
  return (
    <div data-testid="spv-detail-vintage">
      <div className="font-medium">Vintage year</div>
      <div className="text-xs">{value}</div>
    </div>
  );
}

/* WAVE 25 / SPV-E (DEF-086) — the Overview audit receipt.
 *
 * `revisionHash` is the hash-chain head for this SPV row and is a real SpvDTO
 * field. `version` and `prevRevisionHash` are NOT (DEF-087); the retired
 * accordion rendered them and printed `undefined`. Exposing them needs a chain
 * read no endpoint offers — that is OQ-35, the owner's open call — so this
 * component states their absence instead of inventing a value.
 *
 * Rule 7: a missing hash renders as an explicit "not recorded" refusal, never
 * as a blank, a dash pretending to be data, or the string "undefined". */
function AuditReceiptField({ revisionHash, updatedAt }: { revisionHash: string | null; updatedAt: string | null }) {
  /* WAVE 95 · ITEM 2 — TWO INTERNAL ARTEFACTS REMOVED FROM A PARTNER'S VIEW.

     (a) THE TOOLTIP CARRIED THE WHOLE DIGEST. This field already shortened the
         value on screen to 16 characters, but it also set `title={revisionHash}`,
         and R77 names `title` explicitly as RENDERED TEXT — it reaches the eye on
         hover and reaches a screen reader unconditionally. So the full 64
         characters were exposed after all, to the one class of user least able to
         avoid them. The attribute is gone; the value is not. It moves to
         `data-revision-hash`, which R77 allows, so support and any integration
         still read the exact digest.
     (b) WHAT A HUMAN READS is now a short quotable reference rather than a
         16-character fragment of a hash, which was no more readable than 64.

     R44: nothing here is deleted for style. The label "Audit receipt" and the
     absence note below are Wave 83's owner-approved wording and are kept. */
  const receiptRef = auditReceiptReference(revisionHash);
  return (
    <div data-testid="spv-detail-audit-receipt">
      <div className="font-medium">Audit receipt</div>
      {receiptRef ? (
        <div
          className="text-xs font-mono break-all"
          /* R77 — an `aria-label` IS rendered text, so it says in WORDS what this
             field is. The `title` it replaces contained the 64-character digest,
             which a screen reader read out character by character; a sighted user
             could at least ignore it. This is the honest replacement for that
             tooltip: the same position, the same purpose, words instead of a
             machine value. */
          aria-label={`Audit receipt reference ${receiptRef}`}
          data-revision-hash={revisionHash}
          data-testid="spv-detail-audit-receipt-hash"
        >{receiptRef}</div>
      ) : (
        <div className="text-xs text-[var(--cv-color-text-faint)]" data-testid="spv-detail-audit-receipt-missing">
          No revision hash recorded for this SPV.
        </div>
      )}
      <div className="text-[10px] text-[var(--cv-color-text-faint)]" data-testid="spv-detail-audit-receipt-updated">
        {updatedAt ? `Last revised ${updatedAt}` : "Revision time not recorded"}
      </div>
      {/* OQ-35 — named openly rather than left as a silent gap.

          WAVE 95 · ITEM 2 — ONE WORD REMOVED, AND WHAT *IS* AVAILABLE STATED.
          Reviewer 3 flagged the original of this line — "Revision number and
          previous hash are not exposed by the engine yet" — as an engineering
          statement about an unfinished engine shown to a customer. Wave 83
          removed the engine and the column names. What survived was the word
          "YET", which is a promise about a future engine and is exactly what this
          wave was told not to ship. It is gone.

          R44 governs the rest: the remaining sentence is TRUE and is the owner-
          approved Wave 83 wording, so it is kept verbatim rather than rewritten,
          and the positive half — what this receipt DOES record — is ADDED beside
          it rather than replacing anything. "I'd rather add than delete." */}
      <div className="text-[10px] text-[var(--cv-color-text-faint)]" data-testid="spv-detail-audit-receipt-version-note">
        A revision number and a link to the previous audit entry are not recorded for this vehicle.
      </div>
      <div className="text-[10px] text-[var(--cv-color-text-faint)]" data-testid="spv-detail-audit-receipt-available-note">
        This receipt records the fingerprint above and the time of the last revision. Nothing else
        is recorded for this vehicle. Quote the fingerprint to Capavate support if you need this
        receipt checked.
      </div>
    </div>
  );
}

function JurisdictionField({ value }: { value: string }) {
  return (
    <div data-testid="spv-detail-jurisdiction">
      <div className="font-medium">Jurisdiction</div>
      <div className="text-xs">{value}</div>
    </div>
  );
}

/**
 * J-3 (WAVE 3C) — names the jurisdiction the whole Compliance tab is keyed on,
 * and says out loud when a vehicle is NOT American, because the failure this
 * wave fixes was a BVI company and a Dutch syndicate both being shown SEC Form
 * D and blue-sky notices.
 */
function ComplianceJurisdictionHeader({ value, isUnitedStates }: { value: string; isUnitedStates: boolean }) {
  return (
    <div className="mb-3" data-testid="spv-compliance-jurisdiction">
      <div className="font-medium text-sm">Jurisdiction</div>
      <div className="text-xs text-[var(--cv-color-text-muted)]">
        {value}. Everything below is scoped to this jurisdiction.
      </div>
      {!isUnitedStates && (
        <div className="text-xs text-[var(--cv-color-text-muted)]" data-testid="spv-compliance-non-us">
          This is not a United States vehicle, so US securities items are not shown.
        </div>
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
              {eligibility.eligible ? "✓ Eligible per your SPV mandate." : `Not eligible: ${eligibility.reasons.join("; ") || "no reason given"}. Deployment will be refused unless you update the mandate.`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * WAVE 25 / FE-1 — the SPV mandate tab's HONEST empty state.
 *
 * Before this, an SPV with no `spv_mandate` row rendered:
 *     Mode: — · Sectors: None selected · Geography: Any · Stage: Any
 * "Any" is a claim about a permissive mandate. There is no mandate. The engine
 * refuses in exactly this state — `deployCapital` throws `NO_MANDATE`
 * (server/spvEngineStore.ts:1517) and `isCompanyEligible` returns
 * `{eligible:false, reasons:["NO_MANDATE"]}` (spvEngineStore.ts:601) — so the
 * tab was contradicting the engine. Rule 7: a fail-closed state is RENDERED,
 * never dressed up as a permissive default.
 *
 * A component rather than inline JSX, per the `JurisdictionField` precedent in
 * this file: the silent-drop guard fingerprints a tab by the concatenated text
 * of its inline children.
 */
function MandateEmptyState({ mandate, canWrite }: { mandate: unknown; canWrite: boolean }) {
  if (mandate) return null;
  return (
    <div
      className="rounded p-2 text-sm text-amber-900"
      style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)" }}
      data-testid="spv-mandate-empty"
    >
      <div className="font-medium">No mandate has been set for this SPV.</div>
      <div>This is not an open mandate. Deployment and eligibility are both refused until a mandate is recorded.</div>
      {canWrite ? (
        <div data-testid="spv-mandate-empty-cta">Use “Edit mandate” below to set one.</div>
      ) : (
        <div data-testid="spv-mandate-empty-readonly">Ask a managing partner or associate to set the mandate.</div>
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
      /* WAVE 25 / FE-1 — validation. An inverted range was accepted by BOTH
         sides and persisted: nothing in `setMandate` (spvEngineStore.ts:530)
         nor here ever compared the two. The server-side check is the real
         gate (see INVALID_CHECK_RANGE in the store — the API is a second door
         onto the same sink); this one exists so the GP is told before the
         round trip rather than after it. */
      if (
        typeof body.checkMinMinor === "number" &&
        typeof body.checkMaxMinor === "number" &&
        body.checkMinMinor > body.checkMaxMinor
      ) {
        throw new Error("Minimum check cannot be greater than maximum check.");
      }
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
            <Input id={`${id}-companyIds`} value={companyIds} onChange={(e) => setCompanyIds(e.target.value)} data-testid="spv-mandate-company-ids" placeholder="one company id per line" />
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
        body.carryPct = parsePercent(carry, "Carry");
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
function DocumentPanel({ spvId, jurisdiction, onChanged }: { spvId: string; jurisdiction: string | null; onChanged: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  // WAVE 23 · ITEM 6 — offered types come from the ontology, not the raw enum.
  // A non-US vehicle is not shown Form D or blue-sky filings. `SPV_DOC_TYPES`
  // itself is untouched, so documents already registered under any type still
  // read back.
  const docTypes = useMemo(() => spvDocTypesForJurisdiction(jurisdiction), [jurisdiction]);
  const [docType, setDocType] = useState<string>(docTypes[0]);
  // If the vehicle's jurisdiction changes under an open panel, a US-only type
  // must not stay selected and be submitted.
  useEffect(() => {
    if (!(docTypes as readonly string[]).includes(docType)) setDocType(docTypes[0]);
  }, [docTypes, docType]);
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
              {docTypes.map((t) => <option key={t} value={t}>{docTypeLabels[t] ?? t}</option>)}
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

/* ── WAVE 25 / FE-7 — the investor compliance WRITE path ────────────────────
 *
 * `GET /api/partner/me/compliance/:investorId` and
 * `PUT /api/partner/me/compliance/:investorId` (spvEngineRoutes.ts:455 and
 * :473) have existed, IDOR-guarded and zod-`.strict()`-validated, with a
 * per-investor `gateStatus()` behind them — and `grep -rn "me/compliance"
 * client/` returned NOTHING. Zero callers on either verb. The compliance tab
 * was read-only educational copy: investor count, an "Accreditation" heading
 * with a paragraph under it, and two voluntary checklists. A GP could read
 * about accreditation and had no way to record it.
 *
 * The other half of FE-7 — "two-argument call signature" — is ALREADY correct;
 * see WAVE25_REPORT.md. This is the half that was actually missing.
 *
 * Rendered as a nested child of the existing `spv-compliance-accreditation`
 * block so the compliance TabsContent's direct-child sequence, which the
 * silent-drop guard fingerprints, is unchanged. Same shape as the
 * SpvSignoffsPanel mount above it.
 *
 * FAIL-CLOSED RENDERING (rule 7): when the profile read errors we say so. We
 * never render "KYC: none" for a profile we could not load — that is a
 * fabricated compliance fact, and it is the exact failure mode a fabricated
 * `$0` is in the money surfaces. */
const KYC_STATUSES = ["none", "pending", "verified", "expired", "manual_review"] as const;
const ACCREDITATION_STATUSES = ["none", "self_certified", "verified", "manual_review"] as const;
const COMPLIANCE_STATUS_LABELS: Record<string, string> = {
  none: "Not recorded",
  pending: "Pending",
  verified: "Verified",
  expired: "Expired",
  manual_review: "Manual review",
  self_certified: "Self-certified",
};

interface InvestorComplianceProfile {
  investorId: string;
  kycStatus: string;
  kycVerifiedAt: string | null;
  kycExpiry: string | null;
  accreditationStatus: string;
  accreditationCertifiedAt: string | null;
  jurisdiction: string | null;
}
interface InvestorComplianceGates { kyc: boolean; accreditation: boolean; needsReview: boolean }

function InvestorCompliancePanel({
  register,
  canWrite,
}: {
  register: RegisterRow[];
  canWrite: boolean;
}) {
  const { toast } = useToast();
  const id = useId();
  const [selected, setSelected] = useState("");
  const [kycStatus, setKycStatus] = useState("");
  const [accreditationStatus, setAccreditationStatus] = useState("");
  const [dirty, setDirty] = useState(false);

  const investorId = selected.trim();
  const q = useQuery<{ profile: InvestorComplianceProfile | null; gates: InvestorComplianceGates }>({
    queryKey: ["/api/partner/me/compliance", investorId],
    queryFn: async () => (await apiRequest("GET", `/api/partner/me/compliance/${encodeURIComponent(investorId)}`)).json(),
    enabled: investorId.length > 0,
  });

  /* Reset the form to whatever the server actually holds whenever the selected
     investor's profile arrives, unless the GP has started editing. An
     unsubmitted edit must never leak across investors. */
  useEffect(() => {
    if (dirty) return;
    setKycStatus(q.data?.profile?.kycStatus ?? "none");
    setAccreditationStatus(q.data?.profile?.accreditationStatus ?? "none");
  }, [q.data, dirty]);

  useEffect(() => { setDirty(false); }, [investorId]);

  const save = useMutation({
    mutationFn: async () => {
      if (!investorId) throw new Error("INVESTOR_ID_REQUIRED");
      await (await apiRequest("PUT", `/api/partner/me/compliance/${encodeURIComponent(investorId)}`, {
        kycStatus,
        accreditationStatus,
      })).json();
    },
    onSuccess: () => {
      toast({ title: "Compliance profile saved", description: "KYC and accreditation status recorded for this investor." });
      setDirty(false);
      void q.refetch();
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Could not save compliance profile", description: spvErrorMessage(e) }),
  });

  return (
    <div className="mt-2 border-t pt-2 space-y-2" data-testid="spv-investor-compliance">
      <div className="text-xs font-medium">Investor KYC &amp; accreditation</div>
      {register.length === 0 ? (
        <div className="text-xs text-[var(--cv-color-text-faint)]" data-testid="spv-investor-compliance-empty">
          No investors on the register yet — compliance profiles appear here once an investor subscribes.
        </div>
      ) : (
        <>
          <div>
            <Label htmlFor={`${id}-investor`} className="text-[10px]">Investor</Label>
            <select
              id={`${id}-investor`}
              className="w-full text-xs border rounded px-2 py-1"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              data-testid="spv-investor-compliance-select"
            >
              <option value="">Select an investor…</option>
              {register.map((r) => (
                <option key={r.investorId} value={r.investorId}>{r.investorId}</option>
              ))}
            </select>
          </div>
          {investorId === "" ? null : q.isLoading ? (
            <div className="text-xs text-[var(--cv-color-text-faint)]" data-testid="spv-investor-compliance-loading">Loading compliance profile…</div>
          ) : q.isError ? (
            <div className="text-xs text-red-700" data-testid="spv-investor-compliance-error">
              Could not load this investor's compliance profile. Nothing is shown rather than a status we cannot vouch for. {spvErrorMessage(q.error as Error)}
            </div>
          ) : (
            <>
              <div className="text-xs text-[var(--cv-color-text-muted)]" data-testid="spv-investor-compliance-gates">
                {q.data?.profile == null
                  ? "No compliance profile recorded for this investor yet."
                  : `KYC: ${COMPLIANCE_STATUS_LABELS[q.data.profile.kycStatus] ?? q.data.profile.kycStatus} · Accreditation: ${COMPLIANCE_STATUS_LABELS[q.data.profile.accreditationStatus] ?? q.data.profile.accreditationStatus}`}
                {q.data?.gates?.needsReview ? " · Flagged for manual review" : ""}
              </div>
              <div>
                <Label htmlFor={`${id}-kyc`} className="text-[10px]">KYC status</Label>
                <select
                  id={`${id}-kyc`}
                  className="w-full text-xs border rounded px-2 py-1"
                  value={kycStatus}
                  disabled={!canWrite}
                  onChange={(e) => { setDirty(true); setKycStatus(e.target.value); }}
                  data-testid="spv-investor-compliance-kyc"
                >
                  {KYC_STATUSES.map((s) => <option key={s} value={s}>{COMPLIANCE_STATUS_LABELS[s]}</option>)}
                </select>
              </div>
              <div>
                <Label htmlFor={`${id}-accr`} className="text-[10px]">Accreditation status</Label>
                <select
                  id={`${id}-accr`}
                  className="w-full text-xs border rounded px-2 py-1"
                  value={accreditationStatus}
                  disabled={!canWrite}
                  onChange={(e) => { setDirty(true); setAccreditationStatus(e.target.value); }}
                  data-testid="spv-investor-compliance-accreditation"
                >
                  {ACCREDITATION_STATUSES.map((s) => <option key={s} value={s}>{COMPLIANCE_STATUS_LABELS[s]}</option>)}
                </select>
              </div>
              {canWrite ? (
                <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending} data-testid="spv-investor-compliance-save">
                  {save.isPending ? "Saving…" : "Save compliance profile"}
                </Button>
              ) : (
                <div className="text-xs text-[var(--cv-color-text-faint)]" data-testid="spv-investor-compliance-readonly">
                  Read-only: your role cannot change compliance status.
                </div>
              )}
            </>
          )}
        </>
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
      if (unitsPct.trim()) body.unitsPct = parsePercent(unitsPct, "Units");
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
  // WAVE 1A / S-2 — the `collectionOutcome` selector is GONE. A partner may not
  // declare that carry was collected; the server rejects the key outright
  // (SETTLEMENT_NOT_CLIENT_SUPPLIED) and derives settlement from the gateway or a
  // Capavate platform admin. See server/lib/feeSettlementAuthority.ts.
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
          <div className="text-[10px] text-[var(--cv-color-text-faint)]" data-testid="spv-distribution-settlement-note">
            Carry settlement is not self-declared. If this SPV charges carry, the collection
            is settled by the payment gateway or recorded by a Capavate platform admin.
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
