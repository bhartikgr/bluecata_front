import { asArray } from "@/lib/safeArray";
import { useState, useRef, useCallback } from "react";
import { useParams, Link, useSearch, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { StateBadge } from "@/components/common";
/* COS-6 (Wave 4) — the duplicate in-page text-link glossary control
   (<GlossaryLink /> from @/components/Glossary, data-testid="link-glossary") was
   removed from this page header. PageHeader already renders the shared ICON
   glossary control (data-testid="button-open-glossary", AppShell.tsx) on EVERY
   page, so the detail header showed TWO "Open glossary" controls. Ozan-approved
   single-control dedupe: keep the icon, drop the text-link. The `link-glossary`
   testid is unreferenced by any test and still exported for other surfaces
   (founder pages), so nothing is dropped from those. */
import { HelpTip } from "@/components/HelpTip";
import { SoftCircleExpiryBanner } from "@/components/SoftCircleExpiryBanner";
import { ArrowLeft, FileText, Eye, Download, ShieldCheck, Check, X, Layers, PieChart as PieIcon, Building2, Info, Hash, Undo2, Wallet, Copy, Minus } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { fmtUSD, fmtPct, fmtDate, fmtNum, fmtBytes } from "@/lib/format";
/* WAVE 43 · OWNER RULING R7 — the ONE close definition, shared with the server
 * route that refuses the money. This page must never offer an action the API
 * will reject. */
import {
  resolveCloseWindow,
  countdownVerdict,
  countdownCopy,
  closedStatement,
  NO_CLOSE_DATE_COPY,
} from "@shared/roundClose";
import { roundPhrase, nonEmpty, fullLegalName } from "@/lib/investorLabels";
import {
  NOT_PROVIDED, ppsDisplay, computeIllustrativePosition,
} from "@/lib/wave4Display";
import type { InvestorProfile } from "@/lib/profile/types";
import { useToast } from "@/hooks/use-toast";
import { emit } from "@/lib/sprint3";
import { useEffect } from "react";
import { signSES, captureSessionMetadata } from "@/lib/esign/ses";
import { useTermSheetStore } from "@/lib/termsheet/store";
import { useEntitlement } from "@/lib/entitlement";
import { apiRequest, ApiError } from "@/lib/queryClient";
// Sprint 21 Wave B components
import InvestmentHistoryPanel from "@/components/investor/InvestmentHistoryPanel";
import CoSoftCircleBox from "@/components/investor/CoSoftCircleBox";
import FounderQABox from "@/components/investor/FounderQABox";
import { CapTableInterim } from "@/components/founder/CapTableInterim"; /* W-CAP — read-only interim (pro-forma) view for investors */
import { instrumentLabel, holderTypeLabel, decisionStateLabel, displayName } from "@shared/investorDisplayLabels"; /* WAVE 90 · ITEM 3 (M-3) */
import { useRealtimeSync } from "@/lib/realtimeSync";

type RoundTerms = {
 liquidationPref?: string;
 antiDilution?: string;
 proRataMinimum?: string;
 boardComposition?: string;
};
type UseOfProceedsEntry = { category: string; percent: number };
/* WAVE 80 · ITEM 2 — USE OF PROCEEDS ARRIVES IN EITHER OF TWO REAL SHAPES.
   The founder round wizard collects it as ONE FREE-TEXT NARRATIVE; the structured
   `{category, percent}` rows this card was typed for only ever came from
   `server/mockData.ts`. Wave 80 made the wizard actually persist what the founder
   typed and widened both readers rather than deriving rows from a sentence —
   deriving them would mean Capavate inventing per-bucket percentages a founder
   never entered and printing them on the document an investor uses to decide.
   The rationale is declared once, on `validateUseOfProceeds` in
   `shared/roundMathEngineAdapter.ts`. */
type UseOfProceedsShared = UseOfProceedsEntry[] | string | null;
type Inv = {
 id: string;
 company: { id: string; name: string; sector: string };
 round: { id: string; name: string; type: string; state: string;
 whyNow?: string;
 leadInvestorNote?: string;
 terms?: RoundTerms;
 useOfProceeds?: UseOfProceedsShared;
 };
 state: string; receivedAt: string;
 /* WAVE 43 · R7 + R6 — nullable, as `round_invitations.expires_at` always was.
  * The detail projection used to substitute `now + 14 days`, which meant THIS
  * page — the one carrying the "Submit soft-circle" button — could never learn
  * that a round had closed. */
 expiresAt: string | null;
 /** Round-level close inputs (R7 · S3: the earliest deadline wins). */
 closeDate?: string | null;
 roundState?: string | null;
 minTicket: number; targetAmount: number; raisedAmount: number;
 preMoney: number; postMoney: number;
 // v25.25 Avi-8 — priced rounds sometimes leave price_per_share NULL when
 // sharesAuthorized isn't filled. Allow null so callers must guard.
 pricePerShare: number | null;
 // W-FIX2 F1 — projected by the invitation-detail handler (round instrument).
 instrument?: string;
};
type Sec = { id: string; holderName: string; holderType: string; instrument: string; series: string | null; shares: number; investmentAmount: number | null };
type DR = { id: string; category: string; name: string; sizeBytes: number; uploadedAt: string };
// v24.3 — wire-transfer instructions published by the founder for this round.
type WireInstructions = {
 roundId: string;
 bankName: string;
 accountName: string;
 accountNumber: string;
 routingNumber: string | null;
 swift: string | null;
 reference: string | null;
 notes: string | null;
 updatedAt: string;
};

const INSTRUMENT_COLORS: Record<string, string> = {
 common: "hsl(219 45% 30%)", preferred: "hsl(0 100% 40%)", safe: "hsl(333 75% 40%)",
 note: "hsl(38 92% 50%)", warrant: "hsl(158 64% 38%)", option: "hsl(219 70% 55%)",
};

/* Sprint 4 — short orientation line at the top of every tab. */
function TabIntro({ children }: { children: React.ReactNode }) {
 return (
  <div className="flex items-start gap-2 p-3 rounded-md bg-secondary/40 border border-border text-xs leading-relaxed" data-testid="tab-intro">
   <Info className="h-3.5 w-3.5 mt-0.5 text-[hsl(0_100%_40%)] shrink-0" />
   <span className="text-muted-foreground">{children}</span>
  </div>
 );
}

/* COS-1 (Wave 4) — consistent, muted "Not provided" treatment for an empty deal
   field. Ozan: ALWAYS show a "Not provided" line for empty sections/fields — do
   NOT hide sections and do NOT fabricate data. */
function NotProvided({ className = "" }: { className?: string }) {
 return (
  <span className={`text-muted-foreground italic ${className}`} data-testid="text-not-provided">
   {NOT_PROVIDED}
  </span>
 );
}

/**
 * Wave 38 · Row 5 — the server decision record as this page consumes it.
 * `softCircledAt` is DERIVED SERVER-SIDE from the durable decision history
 * (`yourDecisionStore.deriveSoftCircledAt`) and is `null` whenever the server
 * cannot supply a real timestamp. The client never substitutes one.
 */
type DecisionRecordShape = {
  state?: string;
  softCircledAt?: string | null;
  /* WAVE 59 · S1 — the recorded commitment, read from the SAME durable decision
     record the PATCH validates against (yourDecisionStore.ensureRecord →
     no-downgrade guard). Previously this page typed only `state`/`softCircledAt`,
     so the amount the server had already accepted was unreadable and the
     "already submitted" case could not be rendered honestly. */
  amount?: number | null;
  currency?: string | null;
  softCircleType?: string | null;
};
type DecisionRecordResponse = DecisionRecordShape & { record?: DecisionRecordShape };

/**
 * WAVE 59 · S1 — HONEST NAMES FOR THE DECISION STATE-MACHINE REFUSALS.
 *
 * `PATCH /api/rounds/:roundId/invitations/:invId/decision` answers 409 with a
 * machine-readable transition error (server/yourDecisionStore.ts
 * `validateTransition`, :~528). Every one of them used to reach the investor as
 * the single toast "Action failed / Please try again." — which is a dead end,
 * because none of these refusals can ever be cleared by retrying. Shadie's 2a
 * is exactly this: a 409 `noop_transition:soft_circled` presented as a
 * transient failure.
 *
 * Returns `null` for anything this function does not recognise, so a genuine
 * fault (network, auth, 5xx) still falls through to the generic retry copy
 * instead of being mislabelled.
 */
export function describeDecisionRefusal(message: string): { title: string; description: string } | null {
  const noop = /noop_transition:([a-z_]+)/i.exec(message);
  if (noop) {
    const state = noop[1].toLowerCase();
    if (state === "soft_circled") {
      return {
        title: "Already submitted",
        description: "You have already submitted a soft circle for this round. Reload the page to see the amount on record.",
      };
    }
    return {
      title: "Already recorded",
      description: `This invitation is already recorded as "${state.replace(/_/g, " ")}", so there was nothing to change. Retrying will not alter it.`,
    };
  }
  const forbidden = /forbidden_transition:([a-z_]+)->([a-z_]+)/i.exec(message);
  if (forbidden) {
    return {
      title: "Not available from this state",
      description: `This invitation is recorded as "${forbidden[1].replace(/_/g, " ")}", and that step cannot move it to "${forbidden[2].replace(/_/g, " ")}". Reload the page to see the current state.`,
    };
  }
  const invalidFrom = /invalid_(from|to)_state:([a-z_]*)/i.exec(message);
  if (invalidFrom) {
    return {
      title: "Invitation state not recognised",
      description: `The server does not recognise the state "${invalidFrom[2] || "(empty)"}" for this step, so it refused rather than guess. Retrying will not help — please report this invitation id.`,
    };
  }
  return null;
}

// B4: Tab values mapped to URL-safe keys
type TabValue = "overview" | "captable" | "terms" | "dataroom" | "decision";

const VALID_TABS: TabValue[] = ["overview", "captable", "terms", "dataroom", "decision"];

function parseTabParam(search: string): TabValue {
 const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
 const t = params.get("tab") as TabValue | null;
 return t && VALID_TABS.includes(t) ? t : "overview";
}

export default function InvitationDetail() {
 useRealtimeSync();
 const params = useParams<{ id: string }>();
 const id = params.id;
 const { toast } = useToast();
 const queryClient = useQueryClient();
 const { data: entitlementCtx } = useEntitlement();
 const [, navigate] = useLocation();

 // B4: URL-synced tab — read ?tab= from search
 const search = useSearch();
 const activeTab = parseTabParam(search);

 const setActiveTab = useCallback((tab: TabValue) => {
   navigate(`/investor/invitations/${id}?tab=${tab}`, { replace: true });
 }, [id, navigate]);

 // Ref for scrolling to soft-circle form (B5)
 const softCircleFormRef = useRef<HTMLDivElement>(null);

 const inv = useQuery<Inv>({ queryKey: ["/api/investor/invitations", id] });

 // Patch v4: company id is sourced from the invitation; no hardcoded ids.
 const companyId = inv.data?.company.id;
 const roundId = inv.data?.round.id;

 const sec = useQuery<Sec[]>({
  queryKey: ["/api/companies", companyId, "securities"],
  queryFn: async () => {
   if (!companyId) return [];
   const res = await apiRequest("GET", `/api/companies/${companyId}/securities`);
   return res.json();
  },
  enabled: !!companyId,
 });
 // Defect 2 fix: fetch dataroom scoped to company
 const dr = useQuery<DR[]>({
  queryKey: ["/api/dataroom", companyId],
  /* v25.32 burndown — item 15: apiRequest throws ApiError on non-2xx, so the
     prior `if (!res.ok) return []` was dead — a non-2xx surfaced as a query
     error instead of the intended empty dataroom. Catch ApiError and return [].
     Source: v25_32_apiRequest_dead_code_sites_gpt55.txt (InvitationDetail.tsx:143).
     Read-only; additive. */
  queryFn: async () => {
   if (!companyId) return [];
   try {
    const res = await apiRequest("GET", `/api/dataroom?companyId=${encodeURIComponent(companyId)}`);
    return res.json();
   } catch (err) {
    if (err instanceof ApiError) return [];
    throw err;
   }
  },
  enabled: !!companyId,
 });

 /* B3: Fetch decision record to know if investor has soft-circled (for B6 CoSoftCircleBox).
    Wave 38 · Row 5 — SHAPE FIX. `GET …/decision` answers with the decision
    record ITSELF (`res.json({...rec, softCircledAt})`, yourDecisionStore.ts);
    only the PATCH wraps it as `{ ok, record, telemetry }`. This query was typed
    and read as `{ record?: … }`, so every `decision?.state`
    read below was permanently `undefined` and the server state never reached
    the UI. `CompanyDetail.tsx:489` reads the same endpoint bare and is correct.
    We normalise through `decision` and tolerate both shapes so a wrapped
    response could not silently blank the page again. */
 const decisionRecord = useQuery<DecisionRecordResponse>({
   queryKey: ["/api/rounds", roundId, "invitations", id, "decision"],
   /* v25.32 burndown — item 15: apiRequest throws ApiError on non-2xx, so the
      prior `if (!res.ok) return {}` was dead — a non-2xx surfaced as a query
      error instead of the intended empty decision record. Catch ApiError and
      return {}. Source: v25_32_apiRequest_dead_code_sites_gpt55.txt
      (InvitationDetail.tsx:155). Read-only; additive. */
   queryFn: async () => {
     if (!roundId || !id) return {};
     try {
       const res = await apiRequest("GET", `/api/rounds/${roundId}/invitations/${id}/decision`);
       return res.json();
     } catch (err) {
       if (err instanceof ApiError) return {};
       throw err;
     }
   },
   enabled: !!roundId && !!id,
 });

 /* Normalised decision record — bare (GET) or wrapped (PATCH-shaped). */
 const decision: DecisionRecordShape | undefined =
   (decisionRecord.data as { record?: DecisionRecordShape } | undefined)?.record ??
   (decisionRecord.data as DecisionRecordShape | undefined);

 // v26.1.x AVI-ACCRED — accreditation status for the deal/soft-circle surface
 // banner. When the investor has no valid accredited-investor self-declaration,
 // the founder's wire-funded step 412s (money core, captableCommitStore.ts:872)
 // — so we surface a proactive banner here linking to /investor/accreditation.
 // Read-only; catches ApiError → treat as unknown (no banner) rather than crash.
 const accreditationStatus = useQuery<{ accredited?: boolean }>({
   queryKey: ["/api/investor/compliance/accreditation-declaration"],
   retry: false,
   queryFn: async () => {
     try {
       return await (await apiRequest("GET", "/api/investor/compliance/accreditation-declaration")).json();
     } catch (err) {
       if (err instanceof ApiError) return {};
       throw err;
     }
   },
 });
 const needsAccreditation = accreditationStatus.data?.accredited === false;

 // COS-2 (Wave 4) — seed the Your-Decision legal name from the investor
 // PROFILE's legal name (contact.firstName + lastName, rule #13) rather than the
 // "New contact" / session placeholder. The investor profile is the authoritative
 // source (Ozan). Read-only; catches ApiError → treat as absent (blank seed).
 const investorId = entitlementCtx?.userId;
 const profile = useQuery<InvestorProfile>({
   queryKey: ["/api/investors", investorId, "profile"],
   enabled: !!investorId,
   retry: false,
   queryFn: async () => {
     try {
       return await (await apiRequest("GET", `/api/investors/${investorId}/profile`)).json();
     } catch (err) {
       if (err instanceof ApiError) return {} as InvestorProfile;
       throw err;
     }
   },
 });
 // Trimmed profile name parts. Never mutate stored values — display/seed only.
 const profileFirstName = (profile.data?.contact?.firstName ?? "").trim();
 const profileLastName = (profile.data?.contact?.lastName ?? "").trim();
 // Full legal name from the profile ONLY when both parts are present (rule #13).
 const profileLegalName =
   profileFirstName && profileLastName
     ? `${profileFirstName} ${profileLastName}`
     : "";
 // rule #13 prompt condition: a first name exists but the last name is missing.
 // We PROMPT inline (do NOT hard-block submit) — Ozan's Wave-4 decision.
 const profileMissingLastName = !!profileFirstName && !profileLastName;

 const [acceptOpen, setAcceptOpen] = useState(false);
 const [declineOpen, setDeclineOpen] = useState(false);
 // Sign term sheet state
 const [signOpen, setSignOpen] = useState(false);
 const [signName, setSignName] = useState("");
 const [signAck, setSignAck] = useState(false);
 const [amount, setAmount] = useState("250000");
 // COS-5 (Wave 4): track whether the investor has ACTUALLY edited the amount.
 // The cap-table illustrative position binds to a genuinely-entered amount; when
 // untouched it is a labelled "Example" (never a hard-coded $250,000 presented as
 // the investor's real position). Display-only — no ledger/money-core write.
 const [amountTouched, setAmountTouched] = useState(false);
 const [note, setNote] = useState("");
 const [signerName, setSignerName] = useState("");
 // Defect 6 fix: signerEmail from session identity, not hardcoded
 const [signerEmail, setSignerEmail] = useState("");
 const [ack, setAck] = useState(false);
 const softCircleSigs = useTermSheetStore((s) => s.softCircleSigs);
 const saveSoftCircleSig = useTermSheetStore.getState().saveSoftCircleSig;
 const mySoftCircleId = `sc-${id}`;
 const mySig = softCircleSigs[mySoftCircleId];

 // Prefill signer email from session once available (Defect 6)
 useEffect(() => {
  const email = entitlementCtx?.identity?.email;
  if (email && !signerEmail) {
   setSignerEmail(email);
  }
 }, [entitlementCtx?.identity?.email]);

 // BUG-21 + COS-2 (Wave 4): prefill the typed legal signature from the investor
 // PROFILE's full legal name (contact.firstName + lastName, rule #13). The
 // profile is the authoritative source (Ozan); we fall back to the session
 // identity full name only when the profile has not resolved one. Only prefill a
 // genuine full name (never a lone first name, placeholder, or email — never
 // "New contact"); leave editable + blank otherwise so the investor types their
 // own. Prefill is one-shot (guarded by `!signerName`) so it never clobbers what
 // the investor has typed.
 useEffect(() => {
  if (signerName) return;
  const legal = profileLegalName || fullLegalName(entitlementCtx?.identity?.name);
  if (legal) {
   setSignerName(legal);
  }
 }, [profileLegalName, entitlementCtx?.identity?.name]);

 // Decision mutation helper
 const decisionMutation = useMutation({
  mutationFn: async (patch: Record<string, unknown>) => {
   if (!inv.data) throw new Error("no invitation");
   const res = await apiRequest(
    "PATCH",
    `/api/rounds/${inv.data.round.id}/invitations/${inv.data.id}/decision`,
    patch,
   );
   if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? "decision_failed");
   }
   return res.json();
  },
  onError: (err: Error, variables) => {
   // v26.1.x AVI-C-EXT / FIX #2 — a benign, already-past-view transition is NOT
   // a user-facing failure. When the record has already progressed past
   // `viewed` (viewed/accepted/soft_circled/…), the mount view ping is a no-op
   // the server rejects with `noop_transition` or `forbidden_transition:*->viewed`.
   // Treat those as silent; the view is already recorded.
   //
   // WAVE 59 · S1 — the silence is now scoped to THE MOUNT PING ONLY.
   // Previously the two guards below were unconditional, which meant every
   // transition refusal on a DELIBERATE investor action fell through to the
   // generic "Action failed / Please try again." toast. Shadie's 2a is exactly
   // that: a 409 `noop_transition:soft_circled` on a "Submit soft circle" click
   // reported as something a retry could fix. `variables.action === "view"` is
   // the automatic ping; anything else the investor pressed on purpose and is
   // owed a named reason.
   const isMountViewPing = (variables as { action?: string } | undefined)?.action === "view";
   if (isMountViewPing) {
    if (/noop_transition/i.test(err.message)) return;
    if (/forbidden_transition:[a-z_]+->viewed/i.test(err.message)) return;
   }
   // WAVE 59 · S1 — surface the REAL reason for a state-machine refusal. These
   // are permanent: retrying can never clear them, so telling the investor to
   // retry is a dead promise (R21). Unrecognised failures keep the generic copy.
   const named = describeDecisionRefusal(err.message);
   if (named) {
    toast({ title: named.title, description: named.description, variant: "destructive" });
    // Re-read the authoritative decision record so the page stops showing a
    // form for an action the server has already recorded.
    queryClient.invalidateQueries({ queryKey: ["/api/rounds", roundId, "invitations", id, "decision"] });
    return;
   }
   // Contact-support affordance removed (v26.1.x AVI-C-EXT, Ozan): there is no
   // in-app support destination, so no dead link is shown. Keep the rest of the
   // error copy.
   toast({ title: "Action failed", description: "Please try again.", variant: "destructive" });
  },
 });

 useEffect(() => {
  if (!inv.data) return;
  // v26.1.x AVI-C-EXT / FIX #2 — gate the mount view ping so it is NON-DESTRUCTIVE.
  // Only fire {action:"view"} when the current decision-record state can legally
  // accept a view (i.e. it is still `pending`). For any already-progressed state
  // (viewed/accepted/soft_circled/confirmed/signed/funded/declined/expired/revoked)
  // the view is already recorded, so we SKIP the ping entirely — no server 409,
  // no benign error, no toast. The `viewed` client event still emits so downstream
  // channels are unaffected. Do NOT add an accepted->viewed edge to the sacred
  // state machine.
  const currentState = decision?.state;
  // When the record hasn't loaded yet, `currentState` is undefined; only ping
  // once we know the state is `pending` to avoid a spurious ping on an
  // already-progressed record. If the record query errors/empties, we skip
  // (the onError guard above is the belt-and-suspenders fallback).
  if (currentState === "pending") {
   decisionMutation.mutate({ action: "view" });
  }
  emit({ type: "invitation.viewed", payload: { invitationId: `inv-${inv.data.id}` } }, { companyId: inv.data.company.id ?? "co-x", roundId: inv.data.round.id, actorId: entitlementCtx?.userId ?? "investor-current", actorRole: "investor" });
 }, [inv.data?.id, decision?.state]);

 // v25.48 INV-CRASH fix — Rules of Hooks: these hooks MUST run on every render,
 // BEFORE the `if (!inv.data) return …` early return below. Previously they lived
 // after the early return, so the first (loading) render ran fewer hooks than the
 // data-loaded render → React error #310 ("rendered fewer hooks than expected")
 // crashed the whole Invitation detail page into the error boundary. Moving them
 // above the early return keeps the hook count stable across renders.
 // isConfirmed depends only on decisionRecord (a hook declared earlier), so it is
 // safe to compute here.
 const isConfirmed =
   decision?.state === "confirmed" ||
   decision?.state === "signed" ||
   decision?.state === "funded";

 const wireInstr = useQuery<WireInstructions | null>({
   queryKey: [`/api/investor/rounds/${roundId}/wire-instructions`],
   queryFn: async () => {
     // Use apiRequest so the session cookie travels with the call and the
     // proxy prefix is applied. A 404 ("founder hasn't shared yet") is a
     // normal empty state, so we catch it rather than surfacing an error.
     try {
       const res = await apiRequest("GET", `/api/investor/rounds/${roundId}/wire-instructions`);
       const json = await res.json();
       return (json?.wireInstructions ?? null) as WireInstructions | null;
     } catch (err) {
       if (err instanceof ApiError && err.status === 404) return null;
       throw err;
     }
   },
   enabled: !!roundId && isConfirmed,
   retry: false,
 });

 const copyAccountNumber = useCallback(() => {
   const acct = wireInstr.data?.accountNumber;
   if (!acct) return;
   try {
     navigator.clipboard?.writeText(acct);
     toast({ title: "Copied", description: "Account number copied to clipboard." });
   } catch {
     toast({ title: "Copy failed", description: "Select and copy the account number manually.", variant: "destructive" });
   }
 }, [wireInstr.data, toast]);

 /* WAVE 59 · S5.1 — A 404 INVITATION USED TO SPIN FOREVER.
  *
  * Found while verifying Shadie's 2a, using the invitation id printed in her own
  * deck: `GET /api/investor/invitations/inv_rnd_ae5e403b01b7_bd34388615601030`
  * answers 404 (routes.ts: `{ message: "Not found" }`), the shared queryClient
  * runs with `retry: false`, so `inv.data` stays `undefined` forever and this
  * line rendered "Loading…" indefinitely with no error surfaced at all. The
  * reader is left believing the platform is hung.
  *
  * The route deliberately answers 404 for BOTH "no such invitation" and "exists
  * but is not yours" (it must not confirm existence to a non-owner), so the copy
  * below states exactly that pair and does not guess which one applies. Any other
  * status is a genuine fault and says so. */
 if (inv.isError) {
  const invStatus = Number((inv.error as { status?: number } | null)?.status ?? 0);
  return (
   <PageBody>
    {/* WAVE 59 · S5.1 — the wrapper <div> is NOT decoration. The silent-drop
        guard keys an un-testid'd container on `at=<ancestor tag chain>#ordinal`,
        and it increments that ordinal even for containers it then keys by
        data-testid. Placing this Card directly under <PageBody> renumbered the
        pre-existing `at=InvitationDetail:PageBody#1` Card to #2 and the guard
        correctly reported its CardContent body as REMOVED. One extra <div> puts
        this card on a different structural path, so no existing ordinal moves.
        Same lesson as the Wave 43 R7 "append at the end, never substitute
        mid-list" note further down this file. */}
    <div>
    <Card className="border-[hsl(7_61%_43%)]/40" data-testid="panel-invitation-unavailable">
     <CardHeader className="pb-3">
      <CardTitle role="heading" aria-level={2} className="text-base text-[hsl(7_61%_43%)]" data-testid="text-invitation-unavailable">
       {invStatus === 404 ? "This invitation could not be opened" : "This invitation could not be loaded"}
      </CardTitle>
     </CardHeader>
     <CardContent className="space-y-3 text-sm">
      <p className="text-muted-foreground" data-testid="text-invitation-unavailable-reason">
       {invStatus === 404
        ? "The server does not have an invitation with this id for your account. Either the link is out of date, or it belongs to a different account. Ask the founder to resend it — reloading this page will not help."
        : `The server could not return this invitation${invStatus ? ` (HTTP ${invStatus})` : ""}. This is a fault on our side, not a problem with your link.`}
      </p>
      <div className="text-xs font-mono text-muted-foreground" data-testid="text-invitation-unavailable-id">Invitation id: {id}</div>
      <Button variant="outline" asChild data-testid="button-back-to-invitations">
       <Link href="/investor/invitations"><ArrowLeft className="h-3.5 w-3.5 mr-1.5" /> Back to your invitations</Link>
      </Button>
     </CardContent>
    </Card>
    </div>
   </PageBody>
  );
 }
 if (!inv.data) return <PageBody>Loading…</PageBody>;
 const i = inv.data;
 const pct = (i.raisedAmount / i.targetAmount) * 100;
 // Defect 7 fix: guard against totalShares <= 0 to avoid garbage percentages
 const rawTotalShares = asArray(sec.data).reduce((s, x) => s + x.shares, 0);
 const totalShares = rawTotalShares > 0 ? rawTotalShares : null;
 const captableRows = totalShares
  ? asArray(sec.data).map(x => ({ ...x, ownership: (x.shares / totalShares) * 100 }))
  : [];

 // W-FIX2 F1 (owner decision) — surface the investor's OWN pending/accepted
 // position as a clearly-labelled row so the cap-table tab is never blank after
 // accepting an invitation (even pre-commit). Distinct from committed holders;
 // does NOT alter the founder view. Shown for any progressed-but-uncommitted
 // state (accepted/viewed/soft_circled) and while pending.
 const myCapState =
   decision?.state ?? inv.data?.state ?? "pending";
 const showMyPendingRow =
   !!inv.data &&
   ["pending", "viewed", "accepted", "soft_circled"].includes(myCapState);
 const myPendingPos = showMyPendingRow
  ? computeIllustrativePosition(
      amountTouched ? amount : "",
      inv.data.minTicket,
      inv.data.pricePerShare,
      inv.data.postMoney,
    )
  : null;
 // W-FIX2 F1 — never silent-empty: distinguish "genuinely empty" from a failed
 // /securities or /dataroom fetch (or an unresolved companyId).
 const capTableUnavailable = !companyId || sec.isError;
 /* WAVE 42 · R6-family honesty defect — live-audit finding F-9, VERDICT.
  *
  * The audit observed "Cap table temporarily unavailable … Please refresh
  * shortly" firing IDENTICALLY on all three investor rounds and asked whether
  * the cap-table scope guard was over-reaching. IT IS NOT. Traced end to end:
  *
  *   GET /api/companies/:id/securities
  *     -> server/routes.ts  decideCapTableSinkAccess(ctx, cid)
  *     -> server/lib/capTableSinkScope.ts: allow for an admin, or the founder of
  *        the company, or an investor holding a position in it; otherwise refuse
  *        with 404 CAP_TABLE_SINK_NOT_FOUND.
  *
  * WAVE 36 · ROW 1 deliberately REMOVED the `invitedRounds` disjunct, because a
  * person merely INVITED to a round — holding nothing, owning nothing — could
  * read the entire cap-table ledger. So the guard fires on all three rounds for
  * the correct reason: in all three the investor is invited and holds nothing.
  * The guard must NOT be weakened and is not touched here.
  *
  * THE ACTUAL DEFECT IS THIS MESSAGE. A permanent, deliberate authorisation
  * refusal was dressed up as a transient network blip that the user was told to
  * fix by refreshing. Refreshing will never work, and the user is left believing
  * the platform is broken rather than understanding that they are not on this
  * cap table. That is the same class of dishonesty as "$0" for an unknown
  * valuation: the surface states something it does not know to be true.
  *
  * A cross-tenant / out-of-scope refusal is 404 by policy (it must not confirm
  * the resource exists), so a 404 here means "deliberately not yours", while any
  * other status really is a fault. Both messages are retained; the correct one
  * is now chosen. */
 const capTableRefusalStatus =
  sec.isError ? Number((sec.error as { status?: number } | null)?.status ?? 0) : 0;
 const capTableOutOfScope = capTableRefusalStatus === 404;
 const dataroomUnavailable = !companyId || dr.isError;

 // B6: check if investor has soft-circled (from local term-sheet store OR decision record)
 const hasSoftCircled =
   (mySig && !mySig.withdrawn) ||
   decision?.state === "soft_circled" ||
   decision?.state === "confirmed" ||
   decision?.state === "signed" ||
   decision?.state === "funded";

 /* WAVE 59 · S1 — ONE STATE AUTHORITY FOR THIS SCREEN.
  *
  * Shadie's 2a: "Submit soft circle" returned 409 `noop_transition:soft_circled`
  * and the page said only "Action failed / Please try again."
  *
  * The two authorities that disagreed:
  *   • `GET /api/investor/invitations/:id` projects `state: modern.state`, which
  *     was `"sent"`. `mapModernInvitationState()` maps "sent" (and anything not
  *     in the decision chart) to `pending`.
  *   • `PATCH …/decision` validates against the DECISION RECORD, resolved
  *     durable-first through the NO-DOWNGRADE guard
  *     (yourDecisionStore.ensureRecord), which already held `soft_circled`.
  *
  * The submit form was gated ONLY on `!roundClosed`, and the "Soft-circle
  * recorded" card was gated on `mySig` — client zustand in localStorage. On a
  * fresh browser, or another device, or after clearing storage, `mySig` is empty,
  * so the investor was shown a submit form for a commitment the server had
  * already accepted.
  *
  * `decisionSoftCircleLocked` is read from `decision` — the response of
  * `GET /api/rounds/:roundId/invitations/:invId/decision`, which calls the SAME
  * `ensureRecord()` the PATCH validates against. So the surface the investor
  * reads and the surface the write path enforces are now the same one.
  *
  * The NO-DOWNGRADE GUARD IS NOT TOUCHED. It is deliberate and correct — it
  * stops a server restart erasing a real investor commitment. Weakening it to
  * make the 409 go away would trade a UI bug for lost commitments. */
 const decisionState = decision?.state ?? null;
 const decisionSoftCircleLocked =
   decisionState === "soft_circled" ||
   decisionState === "confirmed" ||
   decisionState === "signed" ||
   decisionState === "funded";
 /* The amount the SERVER has on record. Never a client guess and never `mySig`:
  * if the durable record carries no usable amount we say so rather than print a
  * number we cannot source (R21). */
 const recordedSoftCircleAmount =
   typeof decision?.amount === "number" && Number.isFinite(decision.amount) && decision.amount > 0
     ? decision.amount
     : null;

 // v24.3 — isConfirmed / wireInstr / copyAccountNumber were MOVED above the
 // `if (!inv.data) return` early return (see the v25.48 INV-CRASH fix comment)
 // to satisfy the Rules of Hooks. They are intentionally not redeclared here.

 /* WAVE 43 · OWNER RULING R7 — resolve the close window ONCE for this page, from
  * the identical inputs and the identical shared resolver
  * `server/lib/roundCloseEnforcement.ts` uses before it admits or refuses a
  * commitment. There is deliberately no second opinion computed anywhere on this
  * page: the live audit's F-7 was two disagreeing definitions of "expired", and
  * a third one here — on the surface that takes the money — would be the worst
  * place of all to keep one. */
 const closeWindow = resolveCloseWindow({
  invitationExpiresAt: i.expiresAt ?? null,
  roundCloseDate: i.closeDate ?? (i.round as { closeDate?: string | null }).closeDate ?? null,
  roundState: i.roundState ?? i.round.state ?? null,
 });
 const closeVerdict = countdownVerdict(closeWindow, Date.now());
 const roundClosed = closeVerdict.kind === "closed";

 // B5: handler for the Soft-Circle button — navigates to Your Decision tab + scrolls
 const handleSoftCircleClick = () => {
   setActiveTab("decision");
   // Brief delay to allow tab render before scrolling
   setTimeout(() => {
     softCircleFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
   }, 120);
 };

 return (
  <>
   <PageHeader
    title={i.company.name}
    description={[i.round.name, i.company.sector].filter(Boolean).join(" · ")}
    breadcrumbs={[{ href: "/investor/dashboard", label: "Workspace" }, { href: "/investor/invitations", label: "Invitations" }, { label: i.company.name }]}
    actions={
     <>
      {/* COS-6 (Wave 4): duplicate text-link glossary removed here; PageHeader
          renders the shared icon glossary control (button-open-glossary). */}
      <Button variant="ghost" data-testid="button-back" asChild>
       <Link href="/investor/invitations"><ArrowLeft className="h-4 w-4 mr-2" /> All invitations</Link>
      </Button>
     </>
    }
   />
   <PageBody>
    {/* v26.1.x AVI-ACCRED — accreditation-required banner on the deal/soft-circle
        surface. Links to /investor/accreditation so the investor can clear the
        money-core 412 before the founder marks the round funded. */}
    {needsAccreditation && (
     <div
      className="mb-6 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
      data-testid="banner-accreditation-required"
     >
      <div className="font-medium mb-1">Accreditation required to fund this round</div>
      <p className="mb-3">
       Before this round can be marked funded, you must sign an accredited-investor
       self-declaration. Soft-circling is unaffected, but funding is blocked until
       your declaration is on file.
      </p>
      <Button size="sm" data-testid="button-goto-accreditation" asChild>
       <Link href="/investor/accreditation">
        <ShieldCheck className="h-4 w-4 mr-2" /> Complete accreditation
       </Link>
      </Button>
     </div>
    )}
    {/* Header strip */}
    <Card className="mb-6">
     <CardContent className="p-5">
      <div className="flex flex-col md:flex-row md:items-center gap-4">
       <div className="h-14 w-14 rounded-md bg-[hsl(219_45%_20%)] text-white flex items-center justify-center text-lg font-semibold shrink-0">
        {i.company.name.split(" ").map(s => s[0]).slice(0, 2).join("")}
       </div>
       <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
         <h2 className="text-xl font-semibold">{i.company.name}</h2>
         <StateBadge state={i.state} />
         <Badge variant="outline" className="text-[10px] capitalize">{i.round.type.replace("_", " ")}</Badge>
        </div>
        {/* WAVE 43 · R7/R6 — "expires —" told the investor nothing; a closed round
            said the same thing as a round with no date. The window now states
            itself in one sentence, and a missing date says it is missing. */}
        <div className="text-sm text-muted-foreground mt-1" data-testid="text-invitation-window">{i.company.sector} · invited {fmtDate(i.receivedAt)} · {countdownCopy(closeVerdict)}{!roundClosed && closeWindow.deadlineIso ? <span data-testid="text-invitation-expires"> · expires {fmtDate(closeWindow.deadlineIso)}</span> : null}</div>
       </div>
       <div className="flex gap-2 shrink-0 flex-wrap">
        <Button variant="outline" onClick={() => setDeclineOpen(true)} data-testid="button-decline"><X className="h-4 w-4 mr-2" /> Decline</Button>
        {/* B5: Soft-circle button navigates to Your Decision tab */}
        <Button
          onClick={handleSoftCircleClick}
          className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white"
          data-testid="button-accept"
        >
          <Check className="h-4 w-4 mr-2" /> Soft-circle
        </Button>
        {/* DEF-013: Sign Term Sheet trigger — visible when invitation state is confirmed */}
        {(i.state === "confirmed" || i.state === "soft_circled") && (
         <Button
          onClick={() => setSignOpen(true)}
          variant="outline"
          className="border-[hsl(0_100%_40%)] text-[hsl(0_100%_40%)]"
          data-testid="button-open-sign"
         >
          <ShieldCheck className="h-4 w-4 mr-2" /> Sign Term Sheet
         </Button>
        )}
       </div>
      </div>
     </CardContent>
    </Card>

    {/* B4: URL-synced tabs via value + onValueChange */}
    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)} className="space-y-4">
     <TabsList className="grid grid-cols-5 h-auto">
      <TabsTrigger value="overview" data-testid="tab-overview" className="py-2">Overview</TabsTrigger>
      <TabsTrigger value="captable" data-testid="tab-captable" className="py-2">Cap Table</TabsTrigger>
      <TabsTrigger value="terms" data-testid="tab-terms" className="py-2">Investment Terms</TabsTrigger>
      <TabsTrigger value="dataroom" data-testid="tab-dataroom" className="py-2">Data Room</TabsTrigger>
      <TabsTrigger value="decision" data-testid="tab-decision" className="py-2">Your Decision</TabsTrigger>
     </TabsList>

     {/* TAB 1 — OVERVIEW */}
     <TabsContent value="overview" className="space-y-5">
      <TabIntro>Read the company's pitch and decide if it's worth a closer look.</TabIntro>
      <div className="grid md:grid-cols-3 gap-4">
       <Card><CardContent className="p-4">
        <div className="text-xs uppercase text-muted-foreground tracking-wide font-medium">Round target</div>
        <div className="text-2xl font-semibold mt-1">{fmtUSD(i.targetAmount, { compact: true })}</div>
        <div className="text-xs text-muted-foreground mt-1">{fmtUSD(i.raisedAmount, { compact: true })} soft-circled · {fmtPct(pct, 0)}</div>
        {/* WAVE 101 - the same progress-to-target bar as the invitations LIST; only
   the list copy was reported, so the detail page is an added find. */}
        <div className="h-2 mt-2 bg-secondary rounded-full overflow-hidden"><div className="h-full bg-emerald-700" style={{ width: `${Math.min(100, pct)}%` }} /></div>
       </CardContent></Card>
       <Card><CardContent className="p-4">
        <div className="text-xs uppercase text-muted-foreground tracking-wide font-medium">Pre / post-money</div>
        <div className="text-2xl font-semibold mt-1">{fmtUSD(i.preMoney, { compact: true })}</div>
        {/* COS-4 (Wave 4): render exactly "Not set" when PPS is 0/null/unset
            (never $0.0000 / "PPS not set"). ppsDisplay returns "Not set" or
            "$X.XX"; the "/sh" suffix is only appended when a real PPS exists. */}
        <div className="text-xs text-muted-foreground mt-1">Post: {fmtUSD(i.postMoney, { compact: true })} · {i.pricePerShare != null && i.pricePerShare !== 0 ? `${ppsDisplay(i.pricePerShare, 2)}/sh` : ppsDisplay(i.pricePerShare, 2)}</div>
       </CardContent></Card>
       <Card><CardContent className="p-4">
        <div className="text-xs uppercase text-muted-foreground tracking-wide font-medium">Min ticket</div>
        <div className="text-2xl font-semibold mt-1">{fmtUSD(i.minTicket, { compact: true })}</div>
        <div className="text-xs text-muted-foreground mt-1">Pro-rata for $250k+ investors</div>
       </CardContent></Card>
      </div>

      <Card>
       <CardHeader className="pb-3"><CardTitle role="heading" aria-level={2} className="text-base">About the company</CardTitle></CardHeader>
       <CardContent className="space-y-4 text-sm">
        {/* Defect 18 + COS-1 (Wave 4): render company description from API data.
            When empty, show a calm "Not provided" line — do NOT fabricate a
            "No description available" sentence. */}
        <p>
         {(i.company as { description?: string }).description?.trim()
          ? (i.company as { description?: string }).description
          : <NotProvided />}
        </p>
        <div className="grid md:grid-cols-3 gap-3 pt-3 border-t border-border">
         {/* COS-1: empty founding/HQ/team fields render "Not provided", not "—". */}
         <div><div className="text-xs text-muted-foreground">Founded</div><div className="font-medium">{(i.company as {founded?: string}).founded?.trim() ? (i.company as {founded?: string}).founded : <NotProvided />}</div></div>
         <div><div className="text-xs text-muted-foreground">Headquarters</div><div className="font-medium">{(i.company as {headquarters?: string}).headquarters?.trim() ? (i.company as {headquarters?: string}).headquarters : <NotProvided />}</div></div>
         <div><div className="text-xs text-muted-foreground">Team size</div><div className="font-medium">{(i.company as {teamSize?: string}).teamSize?.trim() ? (i.company as {teamSize?: string}).teamSize : <NotProvided />}</div></div>
        </div>
        <div className="pt-3 border-t border-border">
         <div className="text-xs text-muted-foreground mb-1">Traction (last 90 days)</div>
         {/* COS-1: when the founder has published no traction highlights, show a
             single "Not provided" line instead of fabricated "data not
             available" bullets. When highlights exist, render them as-is. */}
         {((i.round as {highlights?: string[]}).highlights ?? []).filter((h) => (h ?? "").trim()).length === 0 ? (
          <NotProvided className="text-sm" />
         ) : (
          <ul className="space-y-1.5">
           {((i.round as {highlights?: string[]}).highlights ?? []).filter((h) => (h ?? "").trim()).map((h, idx) => {
             const absent = /not available|unavailable|not disclosed|not provided|\bn\/a\b|no (?:data|info|information)\b/i.test(h);
             return (
              <li key={idx} className="flex items-center gap-2">
               {absent
                ? <Minus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                : <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />} {h}
              </li>
             );
           })}
          </ul>
         )}
        </div>
       </CardContent>
      </Card>

      {/* DEF-021 fix: source "Why now" from round.whyNow API field */}
      <Card>
       <CardHeader className="pb-3"><CardTitle role="heading" aria-level={2} className="text-base">Why now</CardTitle></CardHeader>
       <CardContent className="text-sm space-y-2">
        {/* COS-1 (Wave 4): consistent "Not provided" line when no "Why now". */}
        {i.round.whyNow?.trim() ? (
         <p>{i.round.whyNow}</p>
        ) : (
         <p><NotProvided /></p>
        )}
        {i.round.leadInvestorNote && (
         <p className="text-muted-foreground">{i.round.leadInvestorNote}</p>
        )}
       </CardContent>
      </Card>

      {/* B6: Co-Soft-Circle members box — only when soft-circled */}
      {companyId && roundId && (
        <CoSoftCircleBox roundId={roundId} hasSoftCircled={!!hasSoftCircled} />
      )}

      {/* B7: Founder Q&A box */}
      {roundId && <FounderQABox roundId={roundId} />}
     </TabsContent>

     {/* TAB 2 — CAP TABLE */}
     <TabsContent value="captable" className="space-y-5">
      <TabIntro>See who else is on the cap table and what they own.</TabIntro>
      {capTableUnavailable && !capTableOutOfScope && (
       <div
        data-testid="note-captable-unavailable"
        className="rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-800 dark:text-amber-200"
       >
        Cap table temporarily unavailable — we couldn't load the shared holders right now. Your own position is still shown below. Please refresh shortly.
       </div>
      )}
      {/* WAVE 42 · R6 / live-audit F-9 — appended as a SIBLING at the end of this
          notice group, and the transient notice above is left BYTE-IDENTICAL.

          A first attempt replaced that text node with a ternary so one <div>
          could serve both cases. `npm run guard` correctly flagged it as a
          removed copy string, because the guard only indexes literal text nodes
          and the wording had moved into an expression. Rather than allowlist a
          flagged item — the standing rule is that a real drop is never
          allowlisted, and "it isn't really gone" is exactly the argument that
          makes an allowlist worthless — the original text node is restored
          verbatim, its condition narrowed to the transient case, and the honest
          permanent-refusal wording added here as new copy. Guard result: 0
          removed, +1 copy string, itemised in guard_delta_accounting.txt. */}
      {capTableOutOfScope && (
       <div
        data-testid="note-captable-out-of-scope"
        className="rounded-md border border-slate-300/60 bg-slate-50 dark:bg-slate-900/40 px-4 py-3 text-sm text-slate-700 dark:text-slate-300"
       >
        Shared cap table not available to you — you are not on this company&rsquo;s cap table, so only your own position is shown. This is deliberate under the cap-table redaction policy, not a fault: refreshing will not change it. The shared holder list opens to you once you hold a position in this company.
       </div>
      )}
      <Card>
       <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <div>
         <CardTitle role="heading" aria-level={2} className="text-base flex items-center gap-2"><PieIcon className="h-4 w-4" /> Pre-money cap table</CardTitle>
         <p className="text-sm text-muted-foreground mt-0.5">Fully-diluted view, shared with you under the company's cap-table redaction policy.</p>
        </div>
        <Badge variant="outline" className="text-[10px]"><ShieldCheck className="h-3 w-3 mr-1" /> Redacted to investor-grade</Badge>
       </CardHeader>
       <CardContent>
        <div className="flex h-10 rounded-md overflow-hidden border border-border mb-4">
         {captableRows.map(r => (
          <div key={r.id} className="relative group" style={{ width: `${r.ownership}%`, backgroundColor: INSTRUMENT_COLORS[r.instrument] }} title={`${r.holderName} · ${fmtPct(r.ownership, 2)}`} />
         ))}
        </div>
        <table className="w-full text-sm" data-testid="table-investor-captable">
         <thead>
          <tr className="text-xs uppercase text-muted-foreground border-b border-border">
           <th className="text-left font-medium py-2">Holder</th>
           <th className="text-left font-medium py-2">Instrument</th>
           <th className="text-right font-medium py-2">Shares</th>
           <th className="text-right font-medium py-2 w-40">Ownership</th>
          </tr>
         </thead>
         <tbody>
          {captableRows.map(r => (
           <tr key={r.id} className="border-b border-border/60">
            <td className="py-2.5">
             {/* WAVE 90 · ITEM 3 (M-3) — `displayName` describes the row rather
                 than printing an id when the name field carries one (the
                 `u_redeemed_...` / "New contact data" class, M-11). */}
             <div className="font-medium">{displayName(r.holderName, "holder", r.id)}</div>
             <div className="text-xs text-muted-foreground" data-holder-type={r.holderType}>{holderTypeLabel(r.holderType)}</div>
            </td>
            {/* WAVE 90 · ITEM 3 — THE M-3 DEFECT ITSELF. This cell rendered the raw
                enum `safe_post` under a CSS `capitalize`, so an investor read
                `Safe_post` in a column headed "Instrument". The label now comes
                from `INSTRUMENTS` in shared/schema.ts — the same domain table the
                round wizard renders its options from, so there is one source and
                no per-component switch to go stale. R77: the machine value is
                retained as a `data-` attribute for tests and tooling. */}
            <td className="py-2.5" data-instrument={r.instrument}>{instrumentLabel(r.instrument)}</td>
            <td className="py-2.5 text-right font-mono tabular-nums">{fmtNum(r.shares)}</td>
            <td className="py-2.5 text-right font-mono tabular-nums">{fmtPct(r.ownership, 2)}</td>
           </tr>
          ))}
          {/* W-FIX2 F1 (owner decision) — the investor's own pending/accepted row,
              so the tab is never blank after accepting. Distinct styling + label. */}
          {myPendingPos && (
           <tr key="__my_pending__" data-testid="row-my-pending-position" className="border-b border-dashed border-primary/40 bg-primary/5">
            <td className="py-2.5">
             <div className="font-medium">You</div>
             <div className="text-xs text-primary" data-testid="text-my-pending-state" data-state={myCapState}>{myCapState === "soft_circled" ? "Soft-circled (pending)" : `${decisionStateLabel(myCapState)} — not yet committed`}</div>
            </td>
            <td className="py-2.5" data-instrument={i.instrument ?? "preferred"}>{instrumentLabel(i.instrument ?? "preferred")}</td>
            <td className="py-2.5 text-right font-mono tabular-nums">{myPendingPos.shares ? fmtNum(myPendingPos.shares) : NOT_PROVIDED}</td>
            <td className="py-2.5 text-right font-mono tabular-nums">{myPendingPos.ownershipPct != null ? fmtPct(myPendingPos.ownershipPct, 2) : NOT_PROVIDED}</td>
           </tr>
          )}
         </tbody>
        </table>
       </CardContent>
      </Card>

      {/* COS-5 (Wave 4): the illustrative position binds to the investor's ENTERED
          soft-circle amount (recomputed shares/ownership from it). When no amount
          has been entered yet it is a labelled "Example" computed from the min
          ticket — never a hard-coded $250,000 presented as the investor's real
          holding. Pure display math; the money core / cap-table engine is
          untouched. */}
      {(() => {
       const pos = computeIllustrativePosition(
        amountTouched ? amount : "",
        i.minTicket,
        i.pricePerShare,
        i.postMoney,
       );
       return (
      <Card data-testid="card-illustrative-position">
       <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <CardTitle role="heading" aria-level={2} className="text-base">Your post-round position (illustrative)</CardTitle>
        {pos.isExample && (
         <Badge variant="outline" className="text-[10px]" data-testid="badge-illustrative-example">Example</Badge>
        )}
       </CardHeader>
       <CardContent className="text-sm">
        <p className="text-muted-foreground mb-3">
         {pos.isExample
          ? <>Example only — enter a soft-circle amount below to see your position. Based on a {fmtUSD(pos.amount)} example on a {fmtUSD(i.preMoney, { compact: true })} pre-money:</>
          : <>Assuming you commit at the {fmtUSD(pos.amount)} level on a {fmtUSD(i.preMoney, { compact: true })} pre-money:</>}
        </p>
        <div className="grid md:grid-cols-3 gap-3">
         <div><div className="text-xs text-muted-foreground">Shares purchased</div><div className="font-mono tabular-nums font-medium" data-testid="text-illustrative-shares">{fmtNum(pos.shares)}</div></div>
         <div><div className="text-xs text-muted-foreground">Implied ownership</div><div className="font-mono tabular-nums font-medium" data-testid="text-illustrative-ownership">{pos.ownershipPct != null ? fmtPct(pos.ownershipPct, 3) : NOT_PROVIDED}</div></div>
         <div><div className="text-xs text-muted-foreground">Pro-rata reservation</div><div className="font-mono tabular-nums font-medium">{pos.proRata ? "Yes" : "No"}</div></div>
        </div>
       </CardContent>
      </Card>
       );
      })()}

      {/* W-CAP (2026-07-17) — Interim (pro-forma) view, READ-ONLY for investors
          (no commit CTAs — commit/wire-fund are founder-only). Additive; never
          blended into committed ownership. */}
      {companyId && (
       <CapTableInterim companyId={companyId} readOnly />
      )}
     </TabsContent>

     {/* TAB 3 — INVESTMENT TERMS */}
     <TabsContent value="terms" className="space-y-5">
      <TabIntro>The deal terms — instrument, valuation, and the preferences that decide who gets paid first on an exit.</TabIntro>
      <Card>
       <CardHeader className="pb-3"><CardTitle role="heading" aria-level={2} className="text-base flex items-center gap-2"><Layers className="h-4 w-4" /> Headline terms</CardTitle></CardHeader>
       <CardContent className="grid md:grid-cols-2 gap-x-6 gap-y-3 text-sm">
        {/* DEF-022 fix: source liquidation pref / anti-dilution / pro-rata / board from round.terms */}
        {([
         ["Instrument", "Series Seed Preferred Stock", "Investor shares with extra rights compared to Common: liquidation preference, anti-dilution, board seats, information rights."],
         ["Pre-money valuation", fmtUSD(i.preMoney), "The company's value before this round's new money lands."],
         ["Post-money valuation", fmtUSD(i.postMoney), "Pre-money plus the round size — the company's value the instant the round closes."],
         ["Round size", fmtUSD(i.targetAmount), "Total new money the company is targeting in this round."],
         /* v25.25 Avi-8 — was `$${i.pricePerShare?.toFixed(4)}` which rendered
            "$undefined" when price_per_share is NULL (priced rounds where the
            founder didn't fill sharesAuthorized). Surface honestly. */
         /* COS-4 (Wave 4): exactly "Not set" when PPS is 0/null/unset. */
         ["Price per share", ppsDisplay(i.pricePerShare, 4), "The cost of one share in this round, set by pre-money divided by fully-diluted shares."],
         ["Min ticket", fmtUSD(i.minTicket), "The smallest cheque the founder will accept."],
         /* COS-1 (Wave 4): empty term fields render "Not provided" (consistent
            with the rest of the deal surface) instead of "Not specified". */
         ["Liquidation preference", nonEmpty(i.round.terms?.liquidationPref, NOT_PROVIDED), "On exit you receive your invested capital back BEFORE common shareholders — OR you convert to common and share pro-rata, whichever is better. 1× non-participating is the founder-friendly standard."],
         ["Anti-dilution", nonEmpty(i.round.terms?.antiDilution, NOT_PROVIDED), "If the company later raises at a lower valuation, your conversion ratio adjusts in your favour. Broad-based weighted-average is the gentle, mainstream version."],
         ["Pro-rata rights", nonEmpty(i.round.terms?.proRataMinimum, NOT_PROVIDED), "The right to participate in future rounds at an amount that maintains your current ownership %."],
         ["Board composition", nonEmpty(i.round.terms?.boardComposition, NOT_PROVIDED), "How the board of directors is structured."],
         ["Information rights", "Quarterly financials + KPI dashboard", "What financial reporting the company commits to share with you."],
         ["ESOP top-up", "10% post-money pool refresh", "Size of the new employee option pool created at this round. Pool timing affects who is diluted by it."],
        ] as Array<[string, string, string]>).map(([k, v, tip]) => (
         <div key={k} className="flex justify-between border-b border-border/60 py-1.5 gap-3">
          <span className="text-muted-foreground inline-flex items-center gap-1.5">
           {k}
           <HelpTip>{tip}</HelpTip>
          </span>
          <span className="font-medium text-right">{v}</span>
         </div>
        ))}
       </CardContent>
      </Card>

      {/* DEF-023 fix: source use-of-proceeds from round.useOfProceeds API field */}
      <Card>
       <CardHeader className="pb-3"><CardTitle role="heading" aria-level={2} className="text-base">Use of proceeds</CardTitle></CardHeader>
       <CardContent>
        {/* COS-1 (Wave 4): consistent "Not provided" line when no use-of-proceeds. */}
        {/* WAVE 80 · ITEM 2 — the narrative branch. Rendered verbatim, as the founder
            wrote it, with no bars and no invented percentages. The rows branch below
            is untouched, so every structured round looks exactly as it did. */}
        {(typeof i.round.useOfProceeds === "string" && i.round.useOfProceeds.trim().length > 0) ? (
         <div className="space-y-2" data-testid="uop-narrative">
          <p className="text-sm whitespace-pre-wrap leading-relaxed" data-testid="text-uop-narrative">{i.round.useOfProceeds.trim()}</p>
          <p className="text-xs text-muted-foreground">Recorded by the founder when the round was created.</p>
         </div>
        ) : (!i.round.useOfProceeds || !Array.isArray(i.round.useOfProceeds) || i.round.useOfProceeds.length === 0) ? (
         <p className="text-sm"><NotProvided /></p>
        ) : (
         <div className="space-y-3">
          {(Array.isArray(i.round.useOfProceeds) ? i.round.useOfProceeds : []).map((u, idx) => (
           <div key={u.category ?? `uof-${idx}`}>
            <div className="flex justify-between text-sm mb-1"><span>{u.category ?? "Uncategorized"}</span><span className="font-mono tabular-nums">{u.percent}%</span></div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden"><div className="h-full bg-[hsl(0_100%_40%)]" style={{ width: `${u.percent}%` }} /></div>
           </div>
          ))}
         </div>
        )}
       </CardContent>
      </Card>

      <Card>
       <CardHeader className="pb-3"><CardTitle role="heading" aria-level={2} className="text-base">Round timeline</CardTitle></CardHeader>
       <CardContent>
        {/* Defect 17 fix: derive dates from round data */}
        <ol className="relative border-l border-border ml-2 space-y-4">
         {[
          { d: (i.round as { createdAt?: string }).createdAt ?? i.receivedAt, t: "Invitation sent" },
          { d: i.receivedAt, t: "Soft-circle book opens" },
          { d: i.expiresAt, t: "Soft-circle book closes" },
          { d: (i.round as { closeDate?: string }).closeDate ?? i.expiresAt, t: "Definitive docs + wire instructions" },
         ].map((s, idx) => (
          <li key={idx} className="ml-4">
           <div className="absolute -left-[5px] mt-1 h-2.5 w-2.5 rounded-full bg-[hsl(0_100%_40%)]" />
           <div className="text-xs text-muted-foreground">{fmtDate(s.d)}</div>
           <div className="font-medium text-sm">{s.t}</div>
          </li>
         ))}
        </ol>
       </CardContent>
      </Card>
     </TabsContent>

     {/* TAB 4 — DATA ROOM */}
     <TabsContent value="dataroom" className="space-y-5">
      <TabIntro>Sensitive documents the founder is sharing for diligence. Every view is logged.</TabIntro>
      {dataroomUnavailable && (
       <div
        data-testid="note-dataroom-unavailable"
        className="rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-800 dark:text-amber-200"
       >
        Documents temporarily unavailable — we couldn't load the data room right now. Please refresh shortly.
       </div>
      )}
      <Card>
       <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <div>
         <CardTitle role="heading" aria-level={2} className="text-base flex items-center gap-2"><Building2 className="h-4 w-4" /> Files shared with you</CardTitle>
         <p className="text-sm text-muted-foreground mt-0.5">All access is logged in the company's audit ledger. Watermarked on download.</p>
        </div>
        <Badge variant="outline" className="text-[10px]"><Eye className="h-3 w-3 mr-1" /> Read-only</Badge>
       </CardHeader>
       <CardContent className="px-0">
        <table className="w-full text-sm" data-testid="table-dataroom">
         <thead>
          <tr className="text-xs uppercase text-muted-foreground border-b border-border">
           <th className="text-left font-medium px-5 py-2.5">Name</th>
           <th className="text-left font-medium px-3 py-2.5">Category</th>
           <th className="text-left font-medium px-3 py-2.5">Uploaded</th>
           <th className="text-right font-medium px-3 py-2.5">Size</th>
           <th className="text-right font-medium px-5 py-2.5"></th>
          </tr>
         </thead>
         <tbody>
          {(dr.data ?? []).length === 0 && (
           <tr data-testid="row-dr-empty">
            <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">No documents shared yet.</td>
           </tr>
          )}
          {(dr.data ?? []).slice(0, 8).map(f => (
           <tr key={f.id} className="border-b border-border/60" data-testid={`row-dr-${f.id}`}>
            <td className="px-5 py-2.5 flex items-center gap-2"><FileText className="h-4 w-4 text-muted-foreground" /> {f.name}</td>
            <td className="px-3 py-2.5 text-muted-foreground capitalize">{f.category ? f.category.replace("_", " ") : "Uncategorized"}</td>
            <td className="px-3 py-2.5 text-muted-foreground">{fmtDate(f.uploadedAt)}</td>
            <td className="px-3 py-2.5 text-right font-mono tabular-nums text-muted-foreground">{fmtBytes(f.sizeBytes)}</td>
            <td className="px-5 py-2.5 text-right">
             {/* v25.18 Lane D NC1 + NC3 — server-streaming endpoints replace the
                 nonexistent `(f as any).url` field. The server enforces auth +
                 investor permission (v25.17 Lane A NC1). */}
             <div className="inline-flex gap-1">
              <Button size="sm" variant="ghost" data-testid={`button-view-dr-${f.id}`}
               onClick={() => { try { window.open(`/api/dataroom/files/${encodeURIComponent(f.id)}/download?disposition=inline`, "_blank", "noopener,noreferrer"); } catch { /* swallow */ } }}
              ><Eye className="h-3.5 w-3.5" /></Button>
              <Button size="sm" variant="ghost" data-testid={`button-dl-dr-${f.id}`}
               onClick={() => { try { window.open(`/api/dataroom/files/${encodeURIComponent(f.id)}/download`, "_blank", "noopener,noreferrer"); } catch { /* swallow */ } }}
              ><Download className="h-3.5 w-3.5" /></Button>
             </div>
            </td>
           </tr>
          ))}
         </tbody>
        </table>
       </CardContent>
      </Card>
     </TabsContent>

     {/* TAB 5 — YOUR DECISION */}
     <TabsContent value="decision" className="space-y-5">
      <TabIntro>Indicate interest with a soft-circle amount or decline politely. Soft-circles are non-binding indications of interest — not contracts.</TabIntro>

      {/* v24.3 — Wire Transfer Instructions. Shown once the soft-circle is
          CONFIRMED (signed), so the investor knows where to send funds.
          Addresses Avi's main v24.3 complaint. */}
      {isConfirmed && (
       <Card className="border-[hsl(0_100%_40%)]/40" data-testid="card-wire-instructions-investor">
        <CardHeader className="pb-3">
         <CardTitle role="heading" aria-level={2} className="text-base flex items-center gap-2"><Wallet className="h-4 w-4" /> Wire Transfer Instructions</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
         {wireInstr.isLoading ? (
          <div className="text-muted-foreground">Loading…</div>
         ) : wireInstr.data ? (
          <div className="space-y-3" data-testid="investor-wire-display">
           <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2">
            <div><span className="text-muted-foreground">Bank</span><div className="font-medium">{wireInstr.data.bankName}</div></div>
            <div><span className="text-muted-foreground">Account name</span><div className="font-medium">{wireInstr.data.accountName}</div></div>
            <div>
             <span className="text-muted-foreground">Account number</span>
             <div className="font-mono flex items-center gap-2">
              <span data-testid="investor-wire-accountNumber">{wireInstr.data.accountNumber}</span>
              <Button size="sm" variant="ghost" className="h-6 px-2" onClick={copyAccountNumber} data-testid="button-copy-account-number">
               <Copy className="h-3.5 w-3.5 mr-1" /> Copy
              </Button>
             </div>
            </div>
            {wireInstr.data.routingNumber && <div><span className="text-muted-foreground">Routing</span><div className="font-mono">{wireInstr.data.routingNumber}</div></div>}
            {wireInstr.data.swift && <div><span className="text-muted-foreground">SWIFT/BIC</span><div className="font-mono">{wireInstr.data.swift}</div></div>}
            {wireInstr.data.reference && <div><span className="text-muted-foreground">Reference</span><div className="font-medium">{wireInstr.data.reference}</div></div>}
           </div>
           {wireInstr.data.notes && (
            <div className="p-3 rounded-md bg-secondary/40 border border-border text-xs">
             <span className="font-semibold">Note from the founder: </span>{wireInstr.data.notes}
            </div>
           )}
           <div className="text-xs text-muted-foreground">Always confirm these details with the founder via Messages before sending a wire.</div>
          </div>
         ) : (
          <div className="text-muted-foreground" data-testid="investor-wire-empty">
           The founder hasn't shared wire instructions yet. Reach out via Messages.
          </div>
         )}
        </CardContent>
       </Card>
      )}

      {/* B3: Previous engagement history panel ABOVE the decision form */}
      {companyId && (
        <InvestmentHistoryPanel companyId={companyId} companyName={i.company.name} />
      )}

      <div className="flex items-start gap-2 p-3 rounded-md border border-[hsl(0_100%_40%)]/30 bg-[hsl(0_100%_40%)]/5 text-xs leading-relaxed">
       <Info className="h-3.5 w-3.5 mt-0.5 text-[hsl(0_100%_40%)] shrink-0" />
       <div>
        <span className="font-semibold">Soft-circle commitment — non-binding indication of interest.</span> A binding subscription requires definitive transaction documents executed by both parties. You can withdraw before the deadline.
       </div>
      </div>

      {/* Wave 38 · Row 5 — 14-day soft-circle expiry countdown, rendered
          immediately above the "Soft-circle recorded" card.

          Driven ONLY by the server decision record's derived `softCircledAt`
          (yourDecisionStore.deriveSoftCircledAt, read off the durable decision
          history) — never by `mySig.signature.timestamp`, which is client
          zustand and violates the standing "no in-memory ANYWHERE" rule.

          Deliberately NOT nested inside the card below: that card is gated on
          the in-memory `mySig`, so nesting would have made a DB-driven banner
          disappear whenever the client-side store was empty (e.g. another
          device, cleared storage) even though the server knows the investor is
          soft-circled. The component itself renders nothing when the timestamp
          is absent or unparseable — an investor must never be shown a guessed
          expiry date. */}
      <SoftCircleExpiryBanner
       softCircledAtIso={decision?.softCircledAt ?? null}
       readOnly
      />

      {/* Recorded soft-circle (success card) */}
      {mySig && !mySig.withdrawn && (
       <Card className="border-emerald-300/40 bg-emerald-50/30 " data-testid="card-softcircle-recorded">
        <CardHeader className="pb-3">
         <CardTitle role="heading" aria-level={2} className="text-base flex items-center gap-2 text-emerald-700 "><ShieldCheck className="h-4 w-4" /> Soft-circle recorded</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
         <div>You indicated <strong>{fmtUSD(mySig.amount)}</strong> in the {i.round.name} round.</div>
         <div className="flex items-center gap-1.5 text-xs font-mono" data-testid="text-softcircle-hash">
          <Hash className="h-3 w-3" /> Verifiable hash: <span className="break-all">{mySig.signature.hash}</span>
         </div>
         <div className="text-xs text-muted-foreground">You can withdraw before {fmtDate(i.expiresAt)} by clicking <strong>Withdraw soft-circle</strong>.</div>
         <Button size="sm" variant="outline" onClick={() => {
          saveSoftCircleSig({ ...mySig, withdrawn: true });
          emit({ type: "softcircle.cancelled", payload: { softCircleId: mySig.softCircleId, reason: "investor withdrew" } }, { companyId: i.company.id ?? "co-x", roundId: i.round.id, actorId: entitlementCtx?.userId ?? "investor-current", actorRole: "investor" });
          toast({ title: "Soft-circle withdrawn", variant: "destructive" });
         }} data-testid="button-withdraw-softcircle"><Undo2 className="h-3.5 w-3.5 mr-1" />Withdraw soft-circle</Button>
        </CardContent>
       </Card>
      )}

      {/* B5: Scroll target for Soft-Circle button (ref placed at top of form) */}
      <div ref={softCircleFormRef} />

      <div className="grid md:grid-cols-2 gap-5">
       {/* WAVE 59 · S1 — the form is gated on the SERVER's decision record, not on
           the client's localStorage copy. `decisionSoftCircleLocked` is derived
           from `GET /api/rounds/:roundId/invitations/:invId/decision`, the same
           `ensureRecord()` resolution the PATCH validates against. When the
           server already holds `soft_circled` (or beyond), the form is ABSENT and
           the statement panel appended at the end of this list is shown instead
           — following the Wave 43 R7 precedent immediately below: gate the Card
           whole, append the replacement at the END, never substitute mid-list.
           The card is not merely disabled and no legitimate operation is
           suppressed: the server refuses this exact action as a no-op, so
           rendering the form was the page making a promise it could not keep. */}
       {!roundClosed && !decisionSoftCircleLocked && (
       <Card className="border-[hsl(0_100%_40%)]/40">
        <CardHeader className="pb-3"><CardTitle role="heading" aria-level={2} className="text-base text-[hsl(0_100%_40%)] ">{mySig && !mySig.withdrawn ? "Update soft-circle" : "Soft-circle this round"}</CardTitle></CardHeader>
        {/* WAVE 43 · OWNER RULING R7 — THE DEFECT THE AUDITOR PHOTOGRAPHED.

            This card is where "Submit soft-circle ($250,000)" lived, fully
            enabled, on two rounds whose windows had closed on 3 and 6 August —
            ten days earlier. The form is no longer rendered on a closed round.
            Not disabled: ABSENT, replaced by the statement of fact the ruling
            requires. The server refuses the same commitment independently
            (`POST /api/rounds/:id/soft-circle` and the decision PATCH both call
            `evaluateCommitmentAdmission`), so this is the page telling the truth
            rather than the page being the lock.

            The late-acceptance path is named here explicitly, because the owner
            ruled that late money IS allowed in — the investor must know the
            route exists and that taking it will be recorded. */}
        <CardContent className="space-y-3">
         <div>
          <Label>Investment amount (USD)</Label>
          <Input className="mt-1 font-mono" value={amount} onChange={e => { setAmount(e.target.value); setAmountTouched(true); }} data-testid="input-amount" />
          <div className="text-xs text-muted-foreground mt-1">Min ticket {fmtUSD(i.minTicket)}. Pro-rata available at $250k+.</div>
         </div>
         <div>
          <Label>Your full legal name (typed signature)</Label>
          <Input className="mt-1" placeholder="Your full legal name" value={signerName} onChange={(e) => setSignerName(e.target.value)} data-testid="input-investor-signer-name" />
          {/* COS-2 (Wave 4): when the profile has a first name but no last name,
              PROMPT to complete the full legal name (rule #13) inline. This is
              guidance only — it does NOT hard-block the submit (Ozan). */}
          {profileMissingLastName && (
           <p className="text-xs text-amber-700 mt-1" data-testid="text-lastname-prompt">
            Add your last name to complete your full legal name (rule #13).{" "}
            <Link href="/investor/profile" className="underline">Complete your profile</Link>.
           </p>
          )}
         </div>
         <div>
          <Label>Your email</Label>
          <Input className="mt-1" placeholder="you@firm.com" value={signerEmail} onChange={(e) => setSignerEmail(e.target.value)} data-testid="input-investor-signer-email" />
         </div>
         <div>
          <Label>Note to founder (optional)</Label>
          <Textarea rows={2} className="mt-1" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Looking forward to partnering…" data-testid="input-note" />
         </div>
         <div className="rounded-md border border-border bg-secondary/40 p-3 text-xs leading-relaxed">
          I, <strong>{signerName.trim() || "[Typed Name]"}</strong>, indicate my intention to invest <strong>{fmtUSD(Number(amount) || 0)}</strong> in <strong>{nonEmpty(i.company.name, "this company")}</strong>'s <strong>{roundPhrase(i.round.name)}</strong> at the terms stated. This soft-circle is a non-binding indication of interest, not a contract. A binding subscription requires definitive transaction documents executed by both parties.
         </div>
         {/* FIX #6 (Wave 3) — a NATIVE <label> wrapping a Radix Checkbox (a
             <button role="checkbox">) double-fired: clicking the text made the
             label synthesize a click on the button AND the button toggled from
             the direct/keyboard interaction, so the two events cancelled and
             `ack` desynced from the visible checkmark (submit guard then read
             ack=false). Bind the checkbox to an explicit id and associate the
             text via htmlFor so exactly ONE toggle fires per interaction
             (label click, checkbox click, keyboard space). Same className, same
             data-testid, same `ack` source of truth the guard reads. `signAck`
             (signing) stays a SEPARATE gate. */}
         <div className="flex items-start gap-2 text-xs">
          <Checkbox id="investor-ack" checked={ack} onCheckedChange={(v) => setAck(!!v)} data-testid="checkbox-investor-ack" />
          <label htmlFor="investor-ack" className="cursor-pointer">I acknowledge this is a non-binding indication of interest.</label>
         </div>
         <Button
          className="w-full bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white h-11"
          onClick={async () => {
           if (!signerName.trim()) { toast({ title: "Type your full legal name", variant: "destructive" }); return; }
           if (!ack) { toast({ title: "Acknowledge before submitting", variant: "destructive" }); return; }
           const meta = captureSessionMetadata();
           const prevHash = mySig?.signature.hash ?? "0".repeat(64);
           const sig = signSES({
            documentId: mySoftCircleId,
            documentType: "softcircle",
            signerName: signerName.trim(),
            signerEmail: signerEmail.trim(),
            signerRole: "investor",
            intentText: `Soft-circle ${fmtUSD(Number(amount) || 0)} into ${i.company.name} ${i.round.name}. Non-binding indication of interest.`,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            timestamp: meta.timestamp,
            sessionId: meta.sessionId,
            prevHash,
           });
           // Defect 3 fix: call PATCH to persist soft-circle on server. Roll back on failure.
           try {
            await decisionMutation.mutateAsync({
             action: "soft_circle",
             amount: Number(amount) || 0,
             currency: "USD",
             softCircleType: "indication",
             note: note.trim() || undefined,
             sesContext: { typedName: signerName.trim(), timestamp: meta.timestamp, ipBucket: meta.ipAddress },
            });
           } catch {
            // Error already toasted by mutation onError
            return;
           }
           saveSoftCircleSig({
            softCircleId: mySoftCircleId,
            roundId: i.round.id,
            invitationId: i.id,
            signature: sig,
            amount: Number(amount) || 0,
            withdrawn: false,
           });
           emit({ type: "invitation.soft_circled", payload: { invitationId: `inv-${i.id}`, amount: String(Number(amount) || 0) } }, { companyId: i.company.id ?? "co-x", roundId: i.round.id, actorId: entitlementCtx?.userId ?? "investor-current", actorRole: "investor" });
           emit({ type: "softcircle.created", payload: { softCircleId: mySoftCircleId, roundId: i.round.id, investorId: "investor-current", amount: String(Number(amount) || 0) } }, { companyId: i.company.id ?? "co-x", roundId: i.round.id, actorId: entitlementCtx?.userId ?? "investor-current", actorRole: "investor" });
           toast({ title: "Soft-circle recorded. Founder notified.", description: `Verifiable hash ${sig.hash.slice(0, 16)}…` });
           setAck(false);
          }}
          data-testid="button-submit-softcircle"
         >
          <ShieldCheck className="h-4 w-4 mr-2" /> Submit soft-circle ({fmtUSD(Number(amount) || 0)})
         </Button>
        </CardContent>
       </Card>
       )}

       <Card>
        <CardHeader className="pb-3"><CardTitle role="heading" aria-level={2} className="text-base">Pass on this round</CardTitle></CardHeader>
        <CardContent className="space-y-3">
         <p className="text-sm text-muted-foreground">If this isn't a fit, let the founder know. Your decline is private to {nonEmpty(i.company.name, "the company")}.</p>
         <div className="rounded-md border border-border bg-secondary/40 p-3 text-sm">
          <div className="font-medium mb-1">Common reasons</div>
          <ul className="text-muted-foreground space-y-1">
           <li>· Stage too early / too late</li>
           <li>· Outside thesis</li>
           <li>· Pass for now, revisit at next round</li>
          </ul>
         </div>
         <Button variant="outline" className="w-full h-11" onClick={() => setDeclineOpen(true)} data-testid="button-pass">
          <X className="h-4 w-4 mr-2" /> Decline politely
         </Button>
        </CardContent>
       </Card>

       {/* WAVE 43 · R7 — APPENDED AT THE END OF THIS SIBLING LIST ON PURPOSE.
           The first attempt replaced the soft-circle Card's `CardContent` with a
           ternary. That is a mid-list substitution: it renumbered every
           `CardContent` under `TabsContent>div>Card`, and the silent-drop guard
           correctly reported 11 vanished panel-body records for children that
           had not moved an inch. The statement panel is therefore a NEW sibling
           at the END of the grid, and the original Card is gated whole. */}
       {roundClosed && (
        <Card className="border-[hsl(7_61%_43%)]/40" data-testid="panel-round-closed">
         <CardHeader className="pb-3"><CardTitle role="heading" aria-level={2} className="text-base text-[hsl(7_61%_43%)]" data-testid="text-round-closed-statement">{closedStatement(closeVerdict.kind === "closed" ? closeVerdict.deadlineIso : null)}</CardTitle></CardHeader>
         <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
           Soft-circles are no longer accepted on this round, and a submission would be refused by the server. If you still intend to participate, contact the founder: they can reopen the round or accept your commitment specifically. Either way it is recorded as <strong>accepted after close</strong>, attributed to the founder who accepted it, and shown that way to you, to them, and on the cap table.
          </p>
         </CardContent>
        </Card>
       )}

       {/* WAVE 59 · S1 — "ALREADY SUBMITTED", from the authoritative record.
           Appended at the END of this sibling list for the identical reason the
           Wave 43 R7 panel above is: a mid-list substitution renumbers every
           sibling `CardContent` and the silent-drop guard reports panel bodies
           that never moved. Everything shown here comes from the durable decision
           record. If the record carries no usable amount we say so rather than
           print a number we cannot source (R21). */}
       {decisionSoftCircleLocked && (
        <Card className="border-emerald-300/50 bg-emerald-50/20" data-testid="panel-softcircle-already-submitted">
         <CardHeader className="pb-3">
          <CardTitle role="heading" aria-level={2} className="text-base flex items-center gap-2 text-emerald-800" data-testid="text-softcircle-already-submitted">
           <ShieldCheck className="h-4 w-4" /> You have already submitted a soft circle for this round
          </CardTitle>
         </CardHeader>
         <CardContent className="space-y-3 text-sm">
          <div data-testid="text-recorded-softcircle-amount">
           {recordedSoftCircleAmount != null
            ? <>Amount on record: <strong>{fmtUSD(recordedSoftCircleAmount)}</strong>{decision?.currency ? <> {decision.currency}</> : null}.</>
            : <>The server holds your soft circle for this round, but no amount is recorded against it. {NOT_PROVIDED}</>}
          </div>
          <div className="text-xs text-muted-foreground" data-testid="text-recorded-softcircle-state">
           Recorded state: <span className="font-mono">{decisionState}</span>. This is the same record the server validates a submission against, which is why re-submitting is refused rather than duplicated.
          </div>
          <p className="text-xs text-muted-foreground">
           To change the amount, contact the founder — amending a recorded soft circle is not something this page can do today.
          </p>
         </CardContent>
        </Card>
       )}
      </div>

      <Card>
       <CardHeader className="pb-3"><CardTitle role="heading" aria-level={2} className="text-base">Decision history</CardTitle></CardHeader>
       <CardContent>
        <ul className="space-y-2 text-sm">
         <li className="flex justify-between border-b border-border/60 py-2"><span>Invitation received</span><span className="text-muted-foreground">{fmtDate(i.receivedAt)}</span></li>
         {/* Defect 19 fix: show viewedAt from decision store, not receivedAt */}
         <li className="flex justify-between border-b border-border/60 py-2">
          <span>You opened the deal</span>
          <span className="text-muted-foreground" data-testid="text-viewed-at">
           {decisionMutation.data?.record?.viewedAt
            ? fmtDate(decisionMutation.data.record.viewedAt)
            : fmtDate(i.receivedAt)}
          </span>
         </li>
         {/* WAVE 43 · R6 — the deadline shown is the EFFECTIVE one the server
             enforces (earliest of invitation expiry and round close date), and
             an absent deadline is stated rather than dashed. */}
         <li className="flex justify-between py-2"><span className="text-muted-foreground">Decision deadline</span><span className="font-medium" data-testid="text-decision-deadline">{closeWindow.deadlineIso ? fmtDate(closeWindow.deadlineIso) : NO_CLOSE_DATE_COPY}</span></li>
        </ul>
       </CardContent>
      </Card>
     </TabsContent>
    </Tabs>

    {/* Soft-circle confirm */}
    <AlertDialog open={acceptOpen} onOpenChange={setAcceptOpen}>
     <AlertDialogContent>
      <AlertDialogHeader>
       <AlertDialogTitle>Soft-circle {fmtUSD(Number(amount) || 0)}?</AlertDialogTitle>
       <AlertDialogDescription>
        This signals intent to invest at the listed terms. The founder will be notified. You can confirm or withdraw before docs are signed.
       </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
       <AlertDialogCancel>Cancel</AlertDialogCancel>
       {/* Defect 4 fix: call PATCH with action:\"confirm\" BEFORE emitting bridge events */}
       <AlertDialogAction onClick={async () => {
        try {
         await decisionMutation.mutateAsync({ action: "confirm" });
        } catch {
         return; // error already toasted
        }
        const invId = `inv-${i.id}`;
        const scId = `sc-${i.id}-${Date.now()}`;
        emit({ type: "invitation.soft_circled", payload: { invitationId: invId, amount: String(i.minTicket ?? 100000) } }, { companyId: i.company.id ?? "co-x", roundId: i.round?.id, actorId: entitlementCtx?.userId ?? "investor-current", actorRole: "investor" });
        emit({ type: "softcircle.created", payload: { softCircleId: scId, roundId: i.round?.id ?? "r1", investorId: "investor-current", amount: String(i.minTicket ?? 100000) } }, { companyId: i.company.id ?? "co-x", roundId: i.round?.id, actorId: entitlementCtx?.userId ?? "investor-current", actorRole: "investor" });
        toast({ title: "Soft-circled", description: `${i.company.name} has been notified.` });
        setAcceptOpen(false);
       }} className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)]" data-testid="button-confirm-soft">
        Confirm soft-circle
       </AlertDialogAction>
      </AlertDialogFooter>
     </AlertDialogContent>
    </AlertDialog>

    <AlertDialog open={declineOpen} onOpenChange={setDeclineOpen}>
     <AlertDialogContent>
      <AlertDialogHeader>
       <AlertDialogTitle>Decline this invitation?</AlertDialogTitle>
       <AlertDialogDescription>
        The founder will see your decline (without your reason). You can leave a private note if helpful.
       </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
       <AlertDialogCancel>Keep open</AlertDialogCancel>
       {/* Defect 5 fix: call PATCH with action:\"decline\" to persist on server */}
       <AlertDialogAction onClick={async () => {
        try {
         await decisionMutation.mutateAsync({ action: "decline" });
        } catch {
         return; // error already toasted
        }
        emit({ type: "invitation.declined", payload: { invitationId: `inv-${i.id}`, reason: "investor declined" } }, { companyId: i.company.id ?? "co-x", roundId: i.round?.id, actorId: entitlementCtx?.userId ?? "investor-current", actorRole: "investor" });
        // Invalidate invitations list so it reflects the new declined state
        queryClient.invalidateQueries({ queryKey: ["/api/investor/invitations"] });
        toast({ title: "Invitation declined", variant: "destructive" });
        setDeclineOpen(false);
       }} className="bg-destructive hover:bg-destructive/90" data-testid="button-confirm-decline">
        Decline
       </AlertDialogAction>
      </AlertDialogFooter>
     </AlertDialogContent>
    </AlertDialog>

    {/* Defect 33: Sign term sheet — SES evidence dialog (no window.confirm/alert) */}
    <Dialog open={signOpen} onOpenChange={setSignOpen}>
     <DialogContent>
      <DialogHeader>
       <DialogTitle>Sign term sheet</DialogTitle>
       <DialogDescription>
        Review the term sheet summary below. By typing your full legal name and checking the box,
        you provide electronic signature evidence (SES) for this commitment.
       </DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-2">
       <div className="rounded-md border border-border bg-secondary/40 p-3 text-xs leading-relaxed">
        <div className="font-medium mb-1">Term sheet summary</div>
        <div>Company: <strong>{i.company.name}</strong></div>
        <div>Round: <strong>{i.round.name}</strong></div>
        <div>Pre-money: <strong>{fmtUSD(i.preMoney)}</strong></div>
        <div>Target: <strong>{fmtUSD(i.targetAmount)}</strong></div>
       </div>
       <div className="space-y-1.5">
        <Label>Your full legal name (typed signature)</Label>
        <Input value={signName} onChange={e => setSignName(e.target.value)} placeholder="Legal name" data-testid="input-sign-name" />
       </div>
       <label className="flex items-start gap-2 text-xs cursor-pointer">
        <Checkbox checked={signAck} onCheckedChange={v => setSignAck(!!v)} data-testid="checkbox-sign-ack" />
        <span>I confirm I have read the term sheet and intend to sign this document. This constitutes my electronic signature.</span>
       </label>
      </div>
      <DialogFooter>
       <Button variant="outline" onClick={() => setSignOpen(false)}>Cancel</Button>
       <Button
        disabled={!signName.trim() || !signAck || decisionMutation.isPending}
        onClick={async () => {
         if (!signName.trim() || !signAck) return;
         const meta = captureSessionMetadata();
         try {
          await decisionMutation.mutateAsync({
           action: "sign",
           sesContext: { typedName: signName.trim(), timestamp: meta.timestamp, ipBucket: meta.ipAddress },
          });
          toast({ title: "Term sheet signed", description: "Your signature has been recorded." });
          setSignOpen(false);
         } catch { /* error already toasted */ }
        }}
        className="bg-[hsl(0_100%_40%)] text-white"
        data-testid="button-confirm-sign"
       >
        Sign term sheet
       </Button>
      </DialogFooter>
     </DialogContent>
    </Dialog>
   </PageBody>
  </>
 );
}
