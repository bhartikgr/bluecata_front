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
import { useState, useRef, useEffect } from "react";
import { useCollectiveStream } from "@/lib/sseClient"; /* WAVE 18 / XT-7 */
import { formatMinor as formatMinorLib, toMinor } from "@/lib/currency";
/* WAVE 128 - ADDITION 3: the wizard's money now goes through the ONE partner
   money module (wave 126) instead of `parseFloat`. No second converter. */
import {
  parseWholeUnits,
  toWireMinor,
  formatWholeUnits,
} from "@/components/partner/partnerMoneyInput";
import { wireMinorNumber } from "@/components/partner/PartnerMoneyEntryNotice";
import { REGIONS_ALL } from "@/lib/regions";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter"; /* SC-2 (WAVE 2) — inbound link to the SPV detail route */
import { apiRequest } from "@/lib/queryClient";
import { fieldValidityProps } from "@/lib/fieldValidityClass";
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
import { spvStatusLabel } from "@/lib/partnerDisplay"; /* WAVE 128 - FINDING 3 */
import { ATTESTATION_TEXT_V1 } from "@shared/spvAttestation"; /* WAVE 138 — one definition, shared with the server that records it */
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
/* WAVE 106 - FINDING 5: the two fields below now take their border from the
   SAME predicate that drives their inline error text and the Next button, so a
   valid field cannot keep an invalid border. See lib/fieldValidityClass.ts. */
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

/* ══════════════════════════════════════════════════════════════════════════════
   WAVE 128 · ADDITION 3 — NO FLOAT TOUCHES THE FIGURES A VEHICLE IS CREATED WITH
   ══════════════════════════════════════════════════════════════════════════════
   THE DEFECT. Seven sites in this file ran `parseFloat` on money and handed the
   result to `toMinor`, which multiplies by a power of ten:

     targetRaiseMinor: toMinor(parseFloat(w.targetRaiseMinor || "0") || 0, w.currency)
     minCheckMinor / capMinor / gpCommitMinor / checkMinMinor / checkMaxMinor /
     fixedAmountMinor  — identical shape

   This is NOT a cents bug: these fields already collect whole units, and the
   review step already displayed them as whole units. It is FLOAT ARITHMETIC ON
   MONEY, and binary floating point cannot hold ordinary decimal amounts exactly:
   `Math.round(parseFloat("8916.13") * 100)` is one of the family of expressions
   that lands a cent away from the amount that was typed. These particular seven
   are the target raise, the minimum cheque, the hard cap, the GP's own
   commitment, both mandate bounds and the fixed management fee — the terms a
   vehicle is CREATED with and then administered against for years.

   `parseFloat` also fails silently in three ways this platform must not tolerate
   on money, all of which were live here:
     · `parseFloat("500,000")` is 500 — a thousandfold loss from a thousands
       separator a client is entitled to type;
     · `parseFloat("12abc")` is 12 — garbage becomes a figure;
     · `|| 0` turned every unparseable entry into a legitimate-looking ZERO
       target raise, so a typo created a vehicle with no target at all.

   THE FIX. Everything goes through `parseWholeUnits` from
   client/src/components/partner/partnerMoneyInput.ts — the module wave 126 built
   for exactly this: string surgery against the currency's ISO-4217 exponent, one
   `BigInt` applied to a string of digits, thousands separators accepted, more
   fractional digits than the currency has REFUSED rather than rounded, and a
   refusal returned as a sentence rather than a zero. `toMinor` is no longer
   called on any of these seven; the wire value is the exact integer
   `toWireMinor` produces.

   THE WIRE FORMAT DOES NOT MOVE. Every one of these keys still posts minor units
   as an integer JSON number, to the same endpoints, validated by the same server
   handlers. `wireMinorNumber` is what converts the exact digit string to the JSON
   number, and it REFUSES beyond `Number.MAX_SAFE_INTEGER` instead of losing
   precision quietly.

   AND THE REVIEW STEP IS RE-PINNED. The confirmation screen used the same
   `parseFloat` expressions, so it showed the float — meaning it agreed with the
   wire by sharing its defect. It now renders through the same parse, and when an
   entry cannot be parsed it states the REFUSAL where the figure would be, so the
   last screen before a vehicle is created can no longer show a number that is
   not the number that will be recorded.
   ══════════════════════════════════════════════════════════════════════════════ */
export type WizardMoney =
  | { ok: true; minor: bigint; wire: number; display: string }
  | { ok: false; message: string };

/** Blank counts as zero ONLY where the old code did (`|| "0"`); never rounds. */
export function wizardMoney(raw: string, currency: string, label: string): WizardMoney {
  const r = parseWholeUnits(raw.trim() === "" ? "0" : raw, currency, { label, allowZero: true });
  if (!r.ok) return { ok: false, message: r.message };
  try {
    return {
      ok: true,
      minor: r.minor,
      wire: wireMinorNumber(toWireMinor(r.minor), label),
      display: formatWholeUnits(r.minor, currency),
    };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** For `create.mutationFn`: refuse the whole launch before the first request. */
export function wizardMoneyWire(raw: string, currency: string, label: string): number {
  const m = wizardMoney(raw, currency, label);
  if (!m.ok) throw new Error(m.message);
  return m.wire;
}

/** Optional money: blank stays NULL, and is never turned into a zero. */
export function wizardMoneyWireOptional(raw: string, currency: string, label: string): number | null {
  return raw.trim() === "" ? null : wizardMoneyWire(raw, currency, label);
}

/** What the Review step shows: the exact figure, or the refusal, never a float. */
export function wizardMoneyDisplay(raw: string, currency: string, label: string): string {
  const m = wizardMoney(raw, currency, label);
  return m.ok ? m.display : m.message;
}

/** The same, where blank means "not given" rather than zero. */
export function wizardMoneyDisplayOptional(raw: string, currency: string, label: string): string {
  return raw.trim() === "" ? "—" : wizardMoneyDisplay(raw, currency, label);
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
  /* WAVE 126 · REFERRED ITEM — the client's explicit acknowledgement of the
     vehicle's denomination. Defaults to false on every fresh wizard. */
  currencyConfirmed: boolean;
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
 * 1c — the versioned launch attestation text shown to the signer.
 *
 * WAVE 138 — this was a client-local COPY of the server's constant, kept in
 * sync by a comment ("must match server/spvLaunchSignoffStore.ts"). The wording
 * is unchanged; it is now imported from the single shared definition that
 * `server/spvLaunchSignoffStore.ts` also records, so the sentence a partner
 * ticks and the sentence the platform stores cannot drift apart.
 */

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

/* ════════════════════════════════════════════════════════════════════════════
   WAVE 126 · REFERRED ITEM — THE WIZARD NO LONGER HARD-DEFAULTS TO USD.

   `EMPTY_WIZARD` set `currency: "USD"` unconditionally, and nothing re-derived
   it when the client picked a jurisdiction. A partner incorporating in Canada
   therefore got a CAD-jurisdiction vehicle denominated in USD unless they
   noticed the currency select on step 3 and changed it by hand. Every figure
   afterwards — commitments, fees, distributions, the K-1 — is then denominated
   in a currency the vehicle does not operate in, and the denomination is a
   column on the SPV row that no partner-facing screen can edit after creation.

   THE DERIVATION USES THE TABLE THAT ALREADY EXISTS. `REGIONS_ALL`
   (client/src/lib/regions.ts) is keyed by the same country NAME strings the
   jurisdiction picker uses and already carries a currency per country, so this
   is a lookup, not a second source of truth.

   WHERE THE TABLE HAS NO ANSWER, THIS RETURNS null AND THE WIZARD ASKS.
   `REGIONS_ALL` covers 9 countries; the jurisdiction picker offers 15 plus
   "other". Cayman, BVI, Luxembourg, Ireland, the UAE, Jersey, Guernsey, the
   Netherlands and Mauritius are NOT in it. Guessing for those would swap one
   silent wrong default for another — several are genuinely USD-denominated in
   practice while others are EUR or GBP, and that is a judgement about a
   client's fund, not a lookup. So this returns null and the caller leaves the
   client's own selection alone rather than overwriting it with an invention. */
export function spvCurrencyForJurisdictionCountry(country: string): string | null {
  const hit = REGIONS_ALL.find((r) => r.name === country);
  return hit ? hit.currency : null;
}

/**
 * WAVE 128 · ADDITION 4 (ratified referral) — WHERE THIS DENOMINATION CAME FROM.
 *
 * The owner ratified the deliberate gap in `spvCurrencyForJurisdictionCountry`:
 * for the nine offered jurisdictions the table does not cover, the wizard keeps
 * the client's own selection rather than inventing a currency, and the table is
 * NOT to be "completed" by guessing. What the confirmation step was still not
 * saying is WHICH of those two things happened. A partner confirming "USD" for a
 * Cayman vehicle should know whether the platform derived that or whether it is
 * simply the value that was in the box, because only one of those is a statement
 * anybody has made about their fund.
 *
 * Additive: a sentence inside the existing confirmation block. No row is moved,
 * renamed or removed, and nothing here changes the value being confirmed.
 */
export function currencyOriginStatement(country: string, currency: string): string {
  const derived = spvCurrencyForJurisdictionCountry(country);
  if (derived && derived === currency) {
    return `${currency} was derived from the jurisdiction you chose (${country}). Change it on the Terms step if this vehicle operates in another currency.`;
  }
  if (derived && derived !== currency) {
    return `You have selected ${currency}, which is not the currency this platform associates with ${country} (${derived}). That is allowed - please be certain it is what this vehicle operates in.`;
  }
  return `${currency} is your own selection: this platform holds no denomination for ${country || "that jurisdiction"} and will not invent one. Confirm it against the vehicle's formation documents.`;
}

const EMPTY_WIZARD: WizardState = {
  name: "", jurisdiction: "delaware", jurisdictionCountry: "United States", jurisdictionOther: "",
  legalEntityStructure: SPV_JURISDICTION_ENTITY_STRUCTURES["United States"][0],
  legalEntityStructureOther: "",
  /* V-1 — defaults to the current year, exactly like the admin form
     (PartnerDetail.tsx:190). Editable; validated as a 4-digit year. */
  vintage: String(new Date().getFullYear()),
  spvType: "spv", carryBasis: "", distributionScope: "network", lpVisibility: "own_only",
  /* WAVE 83 · ITEM 5.2 — THE STRAY LEADING ZERO, FIXED WHERE IT WAS BORN.
     These three are CONTROLLED numeric inputs. Initialising them to the string
     "0" meant a GP who typed without clearing the box first produced "02000000",
     "025000" and "02500000" — the zero was ours, not theirs. An EMPTY string is
     the correct initial value for an empty control; every reader below already
     parses with `|| "0"`, so a blank field still means zero on the wire and no
     stored value changes. */
  targetRaiseMinor: "", minCheckMinor: "", capMinor: "", currency: "USD",
  mandateMode: "deal_specific", mandateDescription: "", sectors: [], subSector: "",
  mgmtFeeType: "carry", mgmtFixedMinor: "", mgmtCarryPct: "20", feeCurrency: "USD",
  geography: "", stage: "", checkMinMajor: "", checkMaxMajor: "", targetCompanyId: "",
  hurdleRatePct: "", gpCommitMajor: "",
  termsDocRef: "", closeDate: "",
  signoffLegalName: "", signoffAccepted: false,
  currencyConfirmed: false,
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
      /* ═══════════════════════════════════════════════════════════════════════
         WAVE 82 · ITEM 2 — REFUSE BEFORE ANYTHING IS CREATED.
         ═══════════════════════════════════════════════════════════════════════
         THIS THROW MUST STAY THE FIRST STATEMENT IN THIS FUNCTION. Everything
         below it creates durable, attested state: `POST /api/partner/me/spv`
         records the ESIGN/UETA sign-off (`recordSignoff`) before the vehicle row
         exists, and the fee row is only written by the THIRD request. Until this
         wave, an out-of-domain carry produced a signed vehicle and mandate with
         no fee terms and a red toast — measured in
         build_log/wave82/W82_ITEM2_LAUNCH_BEFORE.txt. The same predicate also
         drives the step-2 Next gate, so a payload that reaches here has already
         been shown to the partner as acceptable; this is the belt to that
         braces, and it is what makes a failed fee write impossible to reach with
         an attested vehicle behind it. */
      const refusal = feeStepRefusal();
      if (refusal) throw new Error(refusal);
      /* WAVE 128 - ADDITION 3 — AND THE MONEY IS PARSED HERE, BEFORE THE FIRST
         REQUEST, for the same reason the refusal above is first: this function
         issues three sequential writes and the first one records an ESIGN/UETA
         attestation. A figure that cannot be parsed must stop the launch while
         nothing exists, not half-way through it. Each of these throws the
         parser's own sentence, which the `onError` toast shows verbatim. */
      const targetRaiseWire = wizardMoneyWire(w.targetRaiseMinor, w.currency, "Target raise");
      const minCheckWire = wizardMoneyWire(w.minCheckMinor, w.currency, "Minimum cheque");
      const capWire = wizardMoneyWire(w.capMinor, w.currency, "Hard cap");
      const gpCommitWire = wizardMoneyWireOptional(w.gpCommitMajor, w.currency, "GP commitment");
      const checkMinWire = wizardMoneyWireOptional(w.checkMinMajor, w.currency, "Minimum cheque (mandate)");
      const checkMaxWire = wizardMoneyWireOptional(w.checkMaxMajor, w.currency, "Maximum cheque (mandate)");
      const mgmtFixedWire =
        w.mgmtFeeType !== "carry" ? wizardMoneyWire(w.mgmtFixedMinor, w.feeCurrency, "Fixed fee amount") : undefined;
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
        gpCommitMinor: gpCommitWire,
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
        targetRaiseMinor: targetRaiseWire,
        minCheckMinor: minCheckWire,
        capMinor: capWire,
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
        checkMinMinor: checkMinWire,
        checkMaxMinor: checkMaxWire,
        ruleTree: w.sectors.length
          ? { op: "and", rules: [{ field: "sector", op: "in", value: w.sectors }] }
          : { op: "and", rules: [{ field: "company_id", op: "in", value: [] }] },
      });
      if (w.mgmtFeeType) {
        await apiRequest("POST", `/api/partner/me/spv/${spv.id}/fees`, {
          layer: "management", feeType: w.mgmtFeeType,
          fixedAmountMinor: mgmtFixedWire,
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

  /* ══════════════════════════════════════════════════════════════════════
     W104 · EVERY HOOK IN THIS COMPONENT MUST SIT ABOVE THE GUARD BELOW.
     DO NOT ADD A HOOK AFTER THE `role.ready` RETURN.

     The guard below returns early while the partner role is still resolving.
     Wave 83 added three hooks BELOW it — a `useState` tracking whether the GP
     had touched the mandate dropdown, and a `useRef`/`useEffect` pair that
     focuses the first wizard field. On the first render the guard fired and
     React recorded the shorter hook list; on the render after the role
     resolved, three further hooks appeared. React threw error #310, "Rendered
     more hooks than during the previous render", and the whole SPV engine page
     rendered a crash screen ON PRODUCTION.

     None of these three hooks reads `role.identity`, so they belong here,
     above the guard, where they run on every render. A hook placed below the
     guard breaks this page again — and neither `tsc` nor the unit suite will
     tell you, because only a render that takes the early return FIRST and then
     re-renders can expose it.
     ══════════════════════════════════════════════════════════════════════ */

  /* WAVE 83 · ITEM 2.5 — has the GP touched the mandate dropdown yet? */
  const [mandateModeTouched, setMandateModeTouched] = useState(false);

  /* WAVE 83 · ITEM 5.1 — ref for the field the wizard focuses first. */
  const spvNameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    /* Radix places focus itself when the dialog opens; this runs after that and
       puts it on the first required field, which is where a GP starts typing. */
    if (!wizardOpen || step !== 0) return;
    const t = setTimeout(() => spvNameRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [wizardOpen, step]);

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
  /* ══════════════════════════════════════════════════════════════════════
     WAVE 83 · ITEM 2.5 — MANDATE MODE FOLLOWS SPV TYPE.
     Choosing "Fund" on step 1 left the mandate on "Deal-Specific (Single Asset)"
     on step 2: a blind-pool fund described as a single-asset deal. The two are
     logically linked, so the default now follows the type — and ONLY the default:
     the mandate dropdown keeps every option and the GP can still override it,
     which is why this fires only while the mandate is still untouched.
     ══════════════════════════════════════════════════════════════════════ */
  const DEFAULT_MANDATE_FOR_TYPE: Record<string, string> = {
    spv: "deal_specific",
    multi_asset: "open",
    fund: "open",
    syndicate: "deal_specific",
    rolling_fund: "open",
  };
  const onSpvTypeChange = (spvType: string) =>
    setW((prev) => ({
      ...prev,
      spvType,
      mandateMode: mandateModeTouched ? prev.mandateMode : (DEFAULT_MANDATE_FOR_TYPE[spvType] ?? prev.mandateMode),
    }));

  const onJurisdictionCountryChange = (country: string) =>
    setW((prev) => ({
      ...prev,
      jurisdictionCountry: country,
      legalEntityStructure: country === OTHER ? "" : (SPV_JURISDICTION_ENTITY_STRUCTURES[country]?.[0] ?? ""),
      legalEntityStructureOther: "",
      // 1e — auto-derive the strict engine enum from the country (the standalone
      // "Engine legal-entity type" field was removed as redundant).
      jurisdiction: deriveEngineJurisdiction(country),
      /* WAVE 126 · REFERRED ITEM — the denomination follows the jurisdiction.
         Only when the table HAS an answer for this country; otherwise the
         client's own selection is left exactly as it is (see
         `spvCurrencyForJurisdictionCountry`). The client still confirms the
         result on the Review step before anything is created. */
      currency: spvCurrencyForJurisdictionCountry(country) ?? prev.currency,
      feeCurrency: spvCurrencyForJurisdictionCountry(country) ?? prev.feeCurrency,
    }));
  /* ════════════════════════════════════════════════════════════════════════
     WAVE 82 · ITEM 2 — THE LAUNCH IS NOT ATOMIC, SO REFUSE BEFORE ANYTHING IS
     CREATED.
     ════════════════════════════════════════════════════════════════════════
     MEASURED, not assumed (build_log/wave82/W82_ITEM2_LAUNCH_BEFORE.txt).
     `create.mutationFn` issues THREE sequential requests: POST /spv (which
     records the ESIGN/UETA sign-off), PUT /mandate, POST /fees. Entering 250 in
     Carry % does NOT store a 250% carry — the wizard divides by 100, and
     `spvEngineStore.addFee` (the SOLE writer of `spv_fee`) refuses
     `carryPct > 1` by name. What it produces is worse: requests 1 and 2 succeed,
     request 3 returns 400 `CARRY_PCT_REQUIRED`, and the partner is left with an
     ATTESTED, SIGNED VEHICLE THAT HAS NO FEE TERMS AT ALL, plus a red "Launch
     failed" toast. Executed: `ATTESTED VEHICLE EXISTS: true · FEE ROWS: 0`.

     Full atomicity would need a single composite server endpoint — the fee
     payload is not part of the POST /spv body, so the server cannot validate it
     there, and deleting a vehicle whose ESIGN attestation is already recorded is
     worse than leaving it. That is a platform change, not a defect fix, and it is
     raised as an OWNER QUESTION. The smallest correct fix, and the one the
     pre-flight prescribes, is the second option: VALIDATE THE WHOLE PAYLOAD UP
     FRONT and refuse before the first request, so no attested vehicle can be
     created without its economics.

     UNITS. Carry on this path is a FRACTION on the wire
     (`PERCENT_FIELD_DOMAIN["spv.carryPct"] = [0,1]`, deliberately not widened);
     the control collects it PERCENT-AS-WRITTEN and divides by 100. The hurdle is
     PERCENT-AS-WRITTEN end to end (`PERCENT_FIELD_DOMAIN["spv.hurdleRatePct"] =
     [0,100]`). The two conventions coexist by ruling, so the bounds below are
     stated in the AS-WRITTEN form the control actually holds, and each label now
     names its unit. NOTHING IS CLAMPED — R16/P-4: refuse, never rescale. The
     banned `n > 1 ? n/100 : n` heuristic appears nowhere here.

     `server/lib/percentPolicy.ts` is not client-importable (it imports the DB
     connection), so these two constants are the single client-side statement of
     the same declared domains. A change must be made in both places.
     ════════════════════════════════════════════════════════════════════════ */
  const CARRY_PCT_AS_WRITTEN_MAX = 100; // wire fraction max 1, × 100 as written
  const HURDLE_PCT_AS_WRITTEN_MAX = 100; // PERCENT_FIELD_DOMAIN["spv.hurdleRatePct"].max

  /**
   * The ONE refusal reason for everything the fee / waterfall step collects, in
   * the order a partner reads the form. `null` means the whole launch payload is
   * acceptable. Consumed by BOTH the step-2 Next gate and `create.mutationFn`,
   * so the gate and the launch can never disagree.
   */
  const feeStepRefusal = (): string | null => {
    if (!w.mgmtFeeType) return "Choose a management fee type to continue.";
    if (w.mgmtFeeType !== "fixed") {
      const raw = w.mgmtCarryPct.trim();
      if (raw === "") return "Enter a carry percentage (20 = 20%), or choose “Fixed only”.";
      const c = Number(raw);
      if (!Number.isFinite(c)) return "Carry % must be a number (20 = 20%).";
      if (c < 0) return "Carry % cannot be negative.";
      if (c > CARRY_PCT_AS_WRITTEN_MAX) {
        return `Carry % must be between 0 and ${CARRY_PCT_AS_WRITTEN_MAX} (20 = 20%). You entered ${raw}.`;
      }
    }
    if (w.mgmtFeeType !== "carry") {
      /* WAVE 128 - ADDITION 3: the gate now asks the SAME parser the launch
         asks, so Next can never be enabled for an amount the launch will
         refuse. `Number.isFinite` used to accept "500,000" as 500. */
      const fixed = wizardMoney(w.mgmtFixedMinor, w.feeCurrency, "Fixed fee amount");
      if (!fixed.ok) return fixed.message;
    }
    if (w.hurdleRatePct.trim() !== "") {
      const h = Number(w.hurdleRatePct.trim());
      if (!Number.isFinite(h)) return "Hurdle % must be a number (8 = 8%).";
      if (h < 0) return "Hurdle % cannot be negative.";
      if (h > HURDLE_PCT_AS_WRITTEN_MAX) {
        return `Hurdle % must be between 0 and ${HURDLE_PCT_AS_WRITTEN_MAX} (8 = 8%). You entered ${w.hurdleRatePct.trim()}.`;
      }
    }
    if (w.gpCommitMajor.trim() !== "") {
      const gp = wizardMoney(w.gpCommitMajor, w.currency, "GP commitment");
      if (!gp.ok) return gp.message;
    }
    if (!w.carryBasis) return "Choose a carry basis to continue.";
    return null;
  };

  const canAdvance = (): boolean => {
    /* V-1 — vintage is OPTIONAL but must be a plausible 4-digit year when
       given, so a typo cannot silently persist as null. */
    if (step === 0)
      return (
        !!w.name.trim() && !!w.jurisdiction && jurisdictionCountryValid && vintageValid
      );
    if (step === 1) return !!w.mandateMode && !!w.mandateDescription.trim(); // 3e mandatory
    /* WAVE 82 · ITEM 2 — was `!!w.mgmtFeeType && !!w.carryBasis`, with no numeric
       bound anywhere, so Next stayed enabled for any number at all. */
    if (step === 2) return feeStepRefusal() === null; // S1 — carry basis co-located on Fees
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
        <Button data-testid="spv-engine-new" onClick={() => { setWizardOpen(true); setStep(0); }} style={{ background: NAVY, borderColor: NAVY }}>
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
              {/* WAVE 83 · ITEM 5.1 — THE FIRST FOUR KEYSTROKES. The wizard opened without
                  placing focus on its first required field, so a GP who started typing
                  straight away typed into whatever the dialog had focused — and the
                  Vintage year box, which is `maxLength={4}` and already holds a 4-digit
                  year, swallowed exactly four characters and then silently refused the
                  rest. Focus is now placed on the SPV name field explicitly. Nothing
                  moved, nothing was renamed, and Vintage keeps its own validation. */}
              <div><Label>SPV name *</Label><Input autoFocus ref={spvNameRef} data-testid="spv-w-name" {...fieldValidityProps(w.name.trim().length > 0)} value={w.name} onChange={(e) => setW({ ...w, name: e.target.value })} /></div>
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
                  <select data-testid="spv-w-type" className="w-full border rounded h-9 px-2" value={w.spvType} onChange={(e) => onSpvTypeChange(e.target.value)}>
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
                <select data-testid="spv-w-mode" className="w-full border rounded h-9 px-2" value={w.mandateMode} onChange={(e) => { setMandateModeTouched(true); setW({ ...w, mandateMode: e.target.value }); }}>
                  {SPV_MANDATE_MODES.map((m) => <option key={m} value={m}>{SPV_MANDATE_MODE_LABELS[m]}</option>)}
                </select>
                <div className="text-xs text-[var(--cv-color-text-muted)] mt-1">{SPV_MANDATE_MODE_HELP[w.mandateMode as keyof typeof SPV_MANDATE_MODE_HELP]}</div>
              </div>
              {/* 3e — mandate description, mandatory, max 1200 */}
              <div>
                <Label>Description of mandate *</Label>
                <Textarea
                  data-testid="spv-w-mandate-desc"
                  {...fieldValidityProps(w.mandateDescription.trim().length > 0)}
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
                <div><Label>Stage (optional)</Label><Input data-testid="spv-w-stage" value={w.stage} onChange={(e) => setW({ ...w, stage: e.target.value })} placeholder="e.g. Seed, Series A" /></div>
                <div><Label>{amountLabel("Min check")} (optional)</Label><Input data-testid="spv-w-checkmin" type="number" value={w.checkMinMajor} onChange={(e) => setW({ ...w, checkMinMajor: e.target.value })} placeholder="e.g. 25000" /></div>
                <div><Label>{amountLabel("Max check")} (optional)</Label><Input data-testid="spv-w-checkmax" type="number" value={w.checkMaxMajor} onChange={(e) => setW({ ...w, checkMaxMajor: e.target.value })} placeholder="e.g. 250000" /></div>
              </div>

              {/* SPV-BUG-4 (D2) — OPTIONAL target-company link. Links a company to
                  the vehicle WITHOUT any allocation amount (deployment/allocation is
                  a separate, deliberate money-path step on the Deployments tab). */}
              <div>
                <Label>Target company (optional)</Label>
                <Input data-testid="spv-w-target-company" value={w.targetCompanyId} onChange={(e) => setW({ ...w, targetCompanyId: e.target.value })} placeholder="Paste the company's reference code from its Capavate page" />
                <div className="text-[10px] text-[var(--cv-color-text-faint)]">
                  Links a target company to this SPV for reference only — no capital is allocated or committed here.
                  {/* WAVE 106 - FINDING 4.2: this field still needs the company's
                      reference code because there is no company picker yet. A
                      picker is out of scope for this wave and is recorded as an
                      open item; the wording at least now says where to find the
                      code instead of naming an internal identifier. */}
                  {" "}You can copy it from the address bar of that company's page. Leave this blank if you are not linking a company yet.
                </div>
              </div>

              {/* WAVE 135 · FINDING 1 — "fail-closed" is how an engineer describes a
                  default; "nothing else is offered" is the same guarantee in the
                  client's language, and it is the part they actually care about. The
                  three eligibility conditions are unchanged because they are the
                  operative fact. */}
              <p className="text-xs text-[var(--cv-color-text-muted)]">Only active, paid Capavate companies with a valid M&amp;A profile and an open round can ever match. Anything that does not meet all three is never offered here.</p>
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
                  <div><Label>{amountLabel("Fixed fee amount")}</Label><Input data-testid="spv-w-fixed" type="number" min={0} value={w.mgmtFixedMinor} onChange={(e) => setW({ ...w, mgmtFixedMinor: e.target.value })} /></div>
                  {/* 3g — fee currency selector for fixed/hybrid */}
                  <div>
                    <Label>Fee currency</Label>
                    <select data-testid="spv-w-fee-currency" className="w-full border rounded h-9 px-2" value={w.feeCurrency} onChange={(e) => setW({ ...w, feeCurrency: e.target.value })}>
                      {CURRENCY_OPTIONS.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
                    </select>
                  </div>
                </div>
              )}
              {/* WAVE 82 · ITEM 2 — bounds + the unit ON THE LABEL. The control
                  collects PERCENT-AS-WRITTEN; the payload divides by 100 because
                  `spv.carryPct` is a FRACTION on the wire. */}
              {w.mgmtFeeType !== "fixed" && (
                <div>
                  {/* WAVE 82 · ITEM 2 — THE LABEL COPY IS UNCHANGED ON PURPOSE.
                      The unit was first written into the label itself as
                      "Carry % (20 = 20%)", and `npm run guard` correctly reported
                      the original string "Carry %" as a REMOVED copy item. The
                      allowlist is 80 by owner ruling and this wave does not add to
                      it, so the unit is stated ADDITIVELY beneath the label
                      instead: the existing copy survives byte-for-byte and the
                      guard's copy count moves only upward. */}
                  <Label>Carry %</Label>
                  <div className="text-[10px] text-[var(--cv-color-text-faint)]" data-testid="spv-w-carrypct-unit">Enter it as written: 20 = 20%. Range 0–{CARRY_PCT_AS_WRITTEN_MAX}.</div>
                  <Input data-testid="spv-w-carrypct" type="number" min={0} max={CARRY_PCT_AS_WRITTEN_MAX} step={0.1} value={w.mgmtCarryPct} onChange={(e) => setW({ ...w, mgmtCarryPct: e.target.value })} />
                </div>
              )}

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
                  {/* WAVE 82 · ITEM 2 — the hurdle is PERCENT-AS-WRITTEN end to
                      end (PERCENT_FIELD_DOMAIN["spv.hurdleRatePct"] = [0,100]).
                      Bounded here so the refusal happens at entry, not months
                      later at a distribution. */}
                  <Label>Hurdle % (optional)</Label>
                  {/* WAVE 82 · ITEM 2 — unit stated ADDITIVELY, for the same reason
                      as the carry field above: rewriting the label removed an
                      existing copy string and the guard refused it. */}
                  <div className="text-[10px] text-[var(--cv-color-text-faint)]" data-testid="spv-w-hurdle-unit">Enter it as written: 8 = 8%. Range 0–{HURDLE_PCT_AS_WRITTEN_MAX}.</div>
                  <Input data-testid="spv-w-hurdle" type="number" min={0} max={HURDLE_PCT_AS_WRITTEN_MAX} step={0.1} value={w.hurdleRatePct} onChange={(e) => setW({ ...w, hurdleRatePct: e.target.value })} placeholder="e.g. 8" />
                  <div className="text-[10px] text-[var(--cv-color-text-faint)]">Preferred return LPs receive before GP carry. Leave blank for a simple return-of-capital-then-carry waterfall.</div>
                </div>
                <div>
                  <Label>{amountLabel("GP commitment")} (optional)</Label>
                  <Input data-testid="spv-w-gpcommit" type="number" min={0} value={w.gpCommitMajor} onChange={(e) => setW({ ...w, gpCommitMajor: e.target.value })} placeholder="e.g. 50000" />
                  <div className="text-[10px] text-[var(--cv-color-text-faint)]">How much the GP invests alongside LPs (skin in the game). Optional.</div>
                </div>
              </div>

              {/* SPV-BUG-5 (D3) — platform fee is DB-driven & read-only to the GP.
                  The exact % appears on the SPV's Fees tab once Capavate applies it
                  (pulled live from config, never hardcoded here). */}
              <p className="text-xs text-[var(--cv-color-text-muted)]" data-testid="spv-w-platform-fee-note">The platform fee layer is set by Capavate and is read-only to you. Its exact percentage is shown on this SPV's Fees tab once applied.</p>

              {/* WAVE 82 · ITEM 2 — the blocking inline reason, in this wizard's
                  own idiom (see `spv-w-carrybasis-error`). APPENDED at the end of
                  this container, never inserted mid-list: the silent-drop guard
                  fingerprints panel children by subsequence and a head insertion
                  reads as a mass removal (the ordinal trap). It renders only when
                  Next is disabled, and it names the field, the bound and the unit
                  — so a fat finger is told immediately instead of after an ESIGN
                  attestation. */}
              {feeStepRefusal() && (
                <div className="text-xs text-rose-600" data-testid="spv-w-fee-error">
                  {feeStepRefusal()}
                </div>
              )}
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
                value={w.mgmtFeeType === "carry" ? `Carry ${w.mgmtCarryPct}%` : w.mgmtFeeType === "fixed" ? `${wizardMoneyDisplay(w.mgmtFixedMinor, w.feeCurrency, "Fixed fee amount")} fixed` : `${wizardMoneyDisplay(w.mgmtFixedMinor, w.feeCurrency, "Fixed fee amount")} + ${w.mgmtCarryPct}% carry`}
                onEdit={() => setStep(2)}
              />
              <ReviewRow label="Target raise" value={wizardMoneyDisplay(w.targetRaiseMinor, w.currency, "Target raise")} onEdit={() => setStep(3)} />
              <ReviewRow label="Distribution scope" value={SPV_DISTRIBUTION_SCOPE_WIZARD_OPTIONS.find((o) => o.value === w.distributionScope)?.label ?? w.distributionScope} onEdit={() => setStep(3)} />
              <ReviewRow label="Co-investor visibility" value={w.lpVisibility === "co_investors" ? "On (club deal)" : "Off (own only)"} onEdit={() => setStep(3)} />
              <ReviewRow label="Carry basis" value={w.carryBasis ? (w.carryBasis === "per_deployment" ? "Per deployment" : "Whole SPV") : "— (required)"} onEdit={() => setStep(2)} />
              {w.targetCompanyId.trim() && <ReviewRow label="Target company" value={w.targetCompanyId.trim()} onEdit={() => setStep(1)} />}
              {(w.hurdleRatePct.trim() || w.gpCommitMajor.trim()) && (
                <ReviewRow
                  label="Waterfall"
                  value={[w.hurdleRatePct.trim() ? `${w.hurdleRatePct}% hurdle` : null, w.gpCommitMajor.trim() ? `${wizardMoneyDisplay(w.gpCommitMajor, w.currency, "GP commitment")} GP commit` : null].filter(Boolean).join(" · ")}
                  onEdit={() => setStep(2)}
                />
              )}
              {w.termsDocRef && <ReviewRow label="Terms doc" value={w.termsDocRef} onEdit={() => setStep(3)} />}

              {/* ═══════════════════════════════════════════════════════════════
                  WAVE 82 · ITEM 3 — THE SEVEN ENTERED FIELDS THIS SCREEN OMITTED.
                  ═══════════════════════════════════════════════════════════════
                  Review & Launch exists for exactly one purpose: to let a partner
                  verify what they are about to attest to under ESIGN/UETA. Seven
                  inputs the wizard collects and persists were never shown here —
                  Geography, Stage, mandate min check, mandate max check, minimum
                  investment, Cap and Currency (the register counts the min/max
                  pair as one row, hence "six"). The values DO persist; this is a
                  review-completeness defect, not a persistence one.

                  APPENDED at the end of the ReviewRow list. No existing row is
                  re-ordered, re-labelled, re-styled or re-valued, and no payload
                  changes: the guard fingerprints panel children by subsequence, so
                  every existing row keeps its relative position and the guard's
                  panel/copy/button counts can only move UP.

                  Money is formatted with the SAME `fmt(toMinor(…), w.currency)` the
                  existing rows use — no second conversion, no second unit. A blank
                  optional renders an explicit "—" and stays optional; nothing here
                  makes a field look required. Each row's Edit returns to the step
                  that OWNS the field: 1 for the mandate refinements, 3 for the
                  terms amounts and the currency.
                  ═══════════════════════════════════════════════════════════════ */}
              <ReviewRow label="Geography" value={w.geography.trim() || "—"} onEdit={() => setStep(1)} />
              <ReviewRow label="Stage" value={w.stage.trim() || "—"} onEdit={() => setStep(1)} />
              <ReviewRow
                label="Mandate min check"
                value={wizardMoneyDisplayOptional(w.checkMinMajor, w.currency, "Minimum cheque (mandate)")}
                onEdit={() => setStep(1)}
              />
              <ReviewRow
                label="Mandate max check"
                value={wizardMoneyDisplayOptional(w.checkMaxMajor, w.currency, "Maximum cheque (mandate)")}
                onEdit={() => setStep(1)}
              />
              <ReviewRow
                label="Minimum investment"
                value={wizardMoneyDisplay(w.minCheckMinor, w.currency, "Minimum cheque")}
                onEdit={() => setStep(3)}
              />
              <ReviewRow
                label="Cap"
                value={wizardMoneyDisplay(w.capMinor, w.currency, "Hard cap")}
                onEdit={() => setStep(3)}
              />
              {/* Named in its own row so no amount on this screen is unit-ambiguous.
                  Until now the currency was only INFERABLE from how Target raise
                  happened to be formatted. */}
              <ReviewRow label="Currency" value={w.currency} onEdit={() => setStep(3)} />
              {/* WAVE 126 · REFERRED ITEM — the denomination is confirmed in
                  words, as a SIBLING of the review row above, never as a
                  replacement for it (the silent-drop guard fingerprints this
                  block by its inline text). A vehicle created in the wrong
                  currency is not something a partner can put right from any
                  screen in this product, so it is stated plainly and
                  acknowledged before the launch button will act. */}
              <div className="text-xs rounded p-2" style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)" }} data-testid="spv-w-currency-confirm-block">
                <div data-testid="spv-w-currency-confirm-statement">
                  This vehicle will be denominated in {w.currency}. Every commitment, fee, distribution and tax
                  form for it will be recorded in {w.currency}. The denomination cannot be changed after the
                  vehicle is created.
                </div>
                <div className="mt-1" data-testid="spv-w-currency-origin">
                  {currencyOriginStatement(
                    w.jurisdictionCountry === OTHER ? w.jurisdictionOther.trim() : w.jurisdictionCountry,
                    w.currency,
                  )}
                </div>
                <label className="flex items-start gap-2 mt-1">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={w.currencyConfirmed}
                    onChange={(e) => setW({ ...w, currencyConfirmed: e.target.checked })}
                    data-testid="spv-w-currency-confirm"
                  />
                  <span>I confirm {w.currency} is the correct denomination for this vehicle.</span>
                </label>
              </div>
              {/* The fee currency is a SEPARATE selection from the SPV currency and
                  applies only to a fixed or hybrid management fee. Shown when it can
                  differ, so the fixed amount above is never read in the wrong unit.
                  The existing "Management fee" row is untouched. */}
              {w.mgmtFeeType !== "carry" && (
                <ReviewRow label="Fee currency" value={w.feeCurrency} onEdit={() => setStep(2)} />
              )}
              {/* The one wizard key that is NOT user-entered: the strict engine
                  jurisdiction enum is DERIVED from the country chosen in step 0
                  (`deriveEngineJurisdiction`). Disclosed rather than given a row, so
                  the screen does not imply it was typed. This is the only collected
                  key not represented above. */}
              <div className="text-[10px] text-[var(--cv-color-text-faint)]" data-testid="spv-review-derived-note">
                {/* WAVE 106 - FINDING 4.3: this printed the raw enum ("cayman"). The
                    same shared label map the rest of the SPV surfaces use is
                    used here, so a partner reads "Cayman Islands". */}
                The registration used by the engine ({SPV_JURISDICTION_LABELS[w.jurisdiction as keyof typeof SPV_JURISDICTION_LABELS] ?? w.jurisdiction}) is derived automatically from the country above and is not separately entered.
              </div>
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
              <Button data-testid="spv-wizard-next" disabled={!canAdvance()} onClick={() => setStep(step + 1)} style={{ background: NAVY, borderColor: NAVY }}>Next</Button>
            ) : (
              <Button data-testid="spv-wizard-launch" disabled={!w.carryBasis || !w.signoffLegalName.trim() || !w.signoffAccepted || !w.currencyConfirmed || create.isPending} onClick={() => create.mutate()} style={{ background: NAVY, borderColor: NAVY }}>
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
                  <div className="text-xs text-[var(--cv-color-text-muted)]">{(SPV_TYPE_LABELS as Record<string, string>)[s.spvType] ?? s.spvType} · {spvStatusLabel(s.status)} · {labelFor(DISTRIBUTION_SCOPE_LABELS, s.distributionScope)} · Carry: {labelFor(CARRY_BASIS_LABELS, s.carryBasis)}</div>
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
                    /* WAVE 128 - FINDING 4: TWO LINKS ON THIS CARD POINT AT THE
                       SAME URL AND DO DIFFERENT THINGS. This one intercepts the
                       plain click and opens the LPs TAB in place; the
                       `spv-open-standalone-*` link below navigates to the
                       standalone admin page. Neither may be deleted - the comment
                       at the standalone link records six endpoints that exist
                       only there - and the href here must stay real so a
                       middle-click still opens a page. What was missing was any
                       way for a reader to tell them apart, so each now states
                       what it does and what a new-tab click will land on. Titles
                       are ADDED; no text, href or test id changes. */
                    title="Opens the LP roster and capital calls as a tab on this page. A middle-click or Cmd/Ctrl-click opens the standalone admin page in a new tab instead."
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
                    title="Leaves this list and opens the standalone SPV admin page, which holds the LP invite form, LP commitments and the capital-call record that the tabs do not."
                    data-testid={`spv-open-standalone-${s.id}`}
                  >
                    Open standalone SPV admin page (LP invites, commits, capital calls) →
                  </Link>
                </div>
                <div className="flex items-center gap-3">
                  {/* WAVE 126 · REFERRED ITEM — THIS FIGURE NOW SAYS WHAT IT IS.
                      It renders `targetRaiseMinor` — the TARGET SIZE of the
                      vehicle. Uncaptioned, right-aligned and in a money font, it
                      reads as money raised, and a column of them reads as a
                      portfolio total; on the live workspace that invited the
                      conclusion that ~$22m had been committed while the
                      Dashboard correctly reported $0.00 committed. The Dashboard
                      was right. Nothing about the value changes here — only that
                      a reader can now tell what they are looking at. */}
                  <div className="text-right">
                    <div className="font-mono">{fmt(s.targetRaiseMinor, s.currency)}</div>
                    <div className="text-[10px] text-[color:var(--cv-color-text-faint)]" data-testid={`spv-target-raise-caption-${s.id}`}>
                      Target raise — not the amount committed
                    </div>
                  </div>
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

