/**
 * Foundation Build — Partner SPV detail page.
 * Shows SPV summary, audit receipt, and (managing_partner-only) capital-call
 * + distribution forms wired to the v25.23 NC-A real DB-backed handlers.
 */
import { useMemo, useState } from "react";
import { formatMinor as formatMinorLib } from "@/lib/currency"; /* v25.38 currency sweep */
import { moneyOrNotProvided } from "@/lib/moneyDisplay"; /* WAVE 55 · R6 */
import { useRoute } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient"; /* v25.14 NH3 — needed for queryFn */
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { PartnerShell } from "@/components/partner/PartnerShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { SPV_JURISDICTION_LABELS, resolveSpvJurisdiction, spvJurisdictionDisplay } from "@shared/spvEngine";
/* WAVE 115 · FINDING 1 (L7) — the SPV lifecycle status reached the page title
   and the Status field raw, so a partner could read `wound_down`. Also (L12) the
   three money placeholders asked a human for "minor units"; they now follow the
   WAVE 106 precedent at components/partner/SpvOperationsPanels.tsx:298 and name
   the real unit in the partner's own currency. No arithmetic changed: the value
   posted for a given keystroke sequence is byte-identical. */
import { spvStatusLabel } from "@/lib/partnerDisplay";
import { humanizeMachineKey, formatTimestamp } from "@/lib/partnerDisplay";
import { auditReceiptReference } from "@/lib/auditReceiptRef"; /* WAVE 95 · ITEM 2 */
import PartnerCsvDownloadButton from "@/components/partner/PartnerCsvDownloadButton"; /* WAVE 179 · ITEM C · R151.2 */
/* WAVE 170 · BATCH 4 ITEM B · R77 / R111 Q13 — the five onError handlers below
   rendered `e.message` raw. `partnerActionRefusalText` resolves the server's own
   sentence first (so wave 164's cap-split disclosure and wave 166's offline
   refusal are unchanged), then the shared copy map, and only then a plain
   sentence naming the next step with the opaque support reference beside it. It
   NEVER returns an internal code. Reasoning in the module. */
import { partnerActionRefusalText } from "@/lib/serverRefusalMessage";
/* ════════════════════════════════════════════════════════════════════════════
   WAVE 128 · FINDING 2 — THREE FIELDS ON THIS PAGE ASKED A PAYING CLIENT FOR
   CENTS, AND A FOURTH DID NOT BUT LOOKED IDENTICAL TO THE THREE.
   ════════════════════════════════════════════════════════════════════════════
   The capital-call amount, the distribution gross proceeds and the distribution
   cost basis were labelled "in USD cents, not whole USD" and posted the typed
   integer straight to the wire. A managing partner recording a $250,000 capital
   call typed 250000 and recorded $2,500.00.

   WHAT EACH FIELD POSTS, AND IN WHAT UNIT — verified end to end this wave,
   because Wave 127 changed the SERVER end of the fee route and a fourth field on
   this same page has ALWAYS been whole units:

     · Capital call  → POST /api/partner/me/spvs/:id/capital-calls
                       body `amount_minor`, zod `z.number().int().min(0)`
                       (server/spvFundStore.ts:409-413) — MINOR units, as a JSON
                       number. CONVERTED here.
     · Distribution  → POST /api/partner/me/spv/:spvId/distributions
                       body `grossProceedsMinor` + `costBasisMinor`
                       (server/spvEngineRoutes.ts:501, allowlist
                       `pickDistributionBody` :72) — MINOR units. CONVERTED here.
     · LP commitment → POST /api/partner/me/spv/:spvId/lp-commit
                       body `amount`, a DECIMAL STRING IN WHOLE UNITS which the
                       server itself scales with `decimalStringToMinor`
                       (server/spvEngineRoutes.ts:1193/1243, server/lib/money.ts:727).
                       NOT converted, deliberately: multiplying it by a hundred
                       on the client would CREATE the very defect this finding
                       removes. It gets the same label and the same live
                       confirmation line, and nothing else.

   ONE CONVERTER. `parseWholeUnits` / `toWireMinor` from the Wave 126 partner
   money module, via the shared notice component. No `Number()`, `parseInt` or
   `parseFloat` runs on anything a client typed; `wireMinorNumber` widens an
   ALREADY-PROVEN digits-only minor-unit string for the two endpoints whose
   schemas type the field as a JSON number, and refuses outside safe-integer
   range rather than losing precision.
   ════════════════════════════════════════════════════════════════════════════ */
import {
  PartnerMoneyEntryNotice,
  wholeUnitsToWireMinor,
  /* WAVE 216 — the non-throwing form of the SAME converter, so the attestation
     panel can restate the figure that goes on the wire. See its doc comment. */
  wholeUnitsToWireMinorOrNull,
  wireMinorNumber,
} from "@/components/partner/PartnerMoneyEntryNotice";
import { wholeUnitsLabel, wholeUnitsPlaceholder, parseWholeUnits, formatWholeUnits } from "@/components/partner/partnerMoneyInput";
/* WAVE 164 · BATCH 3 ITEM C — the vocabulary, imported rather than re-spelled.
   Eight surfaces describing the same distinction eight ways is how a partner came
   to read a target as a limit, so the words and the keys have one home. */
import {
  SPV_CAP_BLANK_LABEL,
  SPV_NOT_ON_RECORD_LABEL,
  SPV_TARGET_OVERAGES_TERMS_KEY,
} from "@shared/spvCapSplitDisclosure";
import { SPV_COMMITTED_SUBSCRIPTION_STATUS } from "@shared/spvCommittedCapital";
/* WAVE 182 · ITEM A · R152 — the SAME predicate and the SAME words the server
   refusal is built from, so the sentence on this form and the sentence the route
   returns cannot drift. */
import { spvIsClosedToNewCapital, spvClosedToNewCapitalNotice } from "@shared/spvClosedToNewCapital";

/* SC-1 (WAVE 2) — FIELD-NAME CORRECTION.
 *
 * GET /api/partner/me/spvs/:id answers
 *   res.json({ spv, positions: spvEngineStore.investorRegister(...) })
 *                                       — server/partnerRoutes.ts:1662-1668
 * where `spv` is a canonical `SpvDTO` (shared/spvEngine.ts:205-230). The type
 * below previously named four fields the DTO does not have:
 *
 *   spvName          → DTO field is `name`            (spvEngine.ts:208)
 *   targetSizeMinor  → DTO field is `targetRaiseMinor`(spvEngine.ts:214)
 *   version          → exists on NEITHER type nor payload
 *   prevRevisionHash → exists on NEITHER type nor payload
 *
 * The first two rendered the heading as `undefined · cayman · open` and Target
 * Size as `$0.00`; the last two rendered blank. Only `revisionHash` and
 * `createdAt` are real, so only those are declared and rendered.
 * (`spvName` IS accepted on the PATCH *write* path at partnerRoutes.ts:1681 as
 * a legacy alias — it is a write alias only and is never echoed on read.) */
type SpvDetail = {
  id: string;
  name: string;
  jurisdiction: string;
  targetRaiseMinor: number | null;
  /* WAVE 151 · ITEM C · R105 — the cap has ALWAYS been on the wire: this route
     serves the whole `SpvDTO` (server/partnerRoutes.ts:1891) and `capMinor` is a
     declared field of it (shared/spvEngine.ts:606). This page simply never
     declared it, which is why the GP could commit past a cap with no figure in
     front of them. `null` means NO CAP (wave 140 made a blank cap persist as NULL
     rather than 0), and that is NOT the same as a cap of zero. */
  capMinor?: number | null;
  currency: string;
  status: string;
  revisionHash: string;
  createdAt: string;
  /* WAVE 40 / F-3 — the GP's own wizard-entered domicile. The DTO has carried
     `terms` all along (shared/spvEngine.ts SpvDTO) and this page simply never
     declared it, which is why it could only read the coerced enum column and
     disagreed with every other surface. Typed as unknown-valued because `terms`
     is a free-form blob; the shared resolver narrows it. */
  terms?: Record<string, unknown> | null;
};

/* SC-2 SAFETY (WAVE 2) — single switch for the inert Record Distribution panel.
   Set to `false` under SC-5, once the form is repointed from the legacy PLURAL
   `spv_distributions` write onto the canonical SINGULAR `spv_distribution`
   ledger. See the block comment above the panel for the full rationale.

   WAVE 6 / SC-5 — DONE, so this is now `false`. The switch is KEPT rather than
   deleted: it is the documented kill-switch for this panel, and removing it
   would erase the record of why the panel was ever inert. `distMut` now writes
   to the canonical singular ledger (see the block comment on that mutation). */
/* WAVE 211 · ITEM A — the partner money gate. One panel, four actions, and every
   word of it generated from `shared/wave211MoneyEventAttestation`, which is the same
   module the server renders and stores its copy from. The panel is NOT the control:
   the server refuses an incomplete confirmation on its own, and no button below is
   disabled on account of it. */
import {
  Wave211AttestationPanel,
  useWave211Attestation,
} from "@/components/partner/Wave211AttestationPanel";
import {
  W211_EVENT_NOUN_CAPITAL_CALL,
  W211_EVENT_NOUN_DISTRIBUTION,
} from "@shared/wave211MoneyEventAttestation";

const DIST_PANEL_DISABLED: boolean = false;

function formatMinor(minor: number, currency: string) {
  // v25.38 — delegate to shared ISO-4217-aware formatter (2-decimal parity).
  return formatMinorLib(minor, currency, { locale: "en-US" });
}

/* WAVE 6 / SC-5 — the note that replaces the "Temporarily unavailable" banner.
   Extracted into a component on purpose: scripts/silent-drop-guard fingerprints
   a panel by its concatenated inline JSX text, so editing prose in place reads
   as a removal. Same technique WAVE 3C used for <JurisdictionField />. */
function DistributionLedgerNote() {
  return (
    <span data-testid="partner-spv-distribution-ledger-note">
      Writes to the <strong>canonical SPV distribution ledger</strong> — the same
      ledger shown by SPV Engine → Distributions. Recording here and recording
      there produce the same row. Distributions are append-only and cannot be
      edited or deleted once recorded.
    </span>
  );
}

/* WAVE 6 — KNOWN GAP #1 CLOSED: raw enum leak.

   `s.jurisdiction` is a member of the 16-value SpvJurisdiction enum, and this
   page rendered it RAW in two places — the page title and the Jurisdiction
   field — so a GP saw `canadian_lp`, `hong_kong` or `united_kingdom` instead of
   "Canada", "Hong Kong", "United Kingdom". SPV_JURISDICTION_LABELS
   (shared/spvEngine.ts:199) is the existing, exhaustive label map; this is a
   WIRING fix, not a new one.

   It resolves defensively: a legacy row whose column still holds free text
   ("Ontario, Canada") is passed through resolveSpvJurisdiction first, which
   after this wave understands comma-qualified values. Anything unresolvable
   shows "Other / not specified" — never a raw token, never a guessed country. */
/* WAVE 40 / F-3 — THIS FUNCTION NO LONGER DECIDES THE JURISDICTION.

   It used to take ONLY the `jurisdiction` enum column, while the SPV Engine list
   card and the engine tabs both preferred `terms.jurisdictionCountry` and fell
   back to the column. Same row, two precedence rules, so the live site showed
   "Asian Biotech" as `British Virgin Islands` on the list and `United States
   (Delaware)` here. The precedence now lives once in
   `spvJurisdictionDisplay()` (shared/spvEngine.ts) and all three surfaces call
   it, so they cannot drift again.

   Kept as a named wrapper rather than inlined because it is the documented seam
   where this page's jurisdiction rendering happens, and because the label is
   needed in two places (page title and the Jurisdiction field). */
function jurisdictionLabel(s: { jurisdiction?: string | null; terms?: unknown }): string {
  return spvJurisdictionDisplay(s).label;
}

/* Referenced so the shared enum-label map stays imported and type-checked here:
   `spvJurisdictionDisplay` returns labels FROM this map, and a future edit that
   reintroduced a local label table would now conflict visibly. */
void SPV_JURISDICTION_LABELS;
void resolveSpvJurisdiction;

export default function PartnerSpvDetail() {
  const role = useRequirePartnerRole();
  const [, params] = useRoute<{ id: string }>("/collective/partner/spvs/:id");
  const spvId = params?.id;
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery<{ spv: SpvDetail }>({
    /* v25.12 NL1 — explicit queryFn for robustness.
       v25.14 NH3 — canonical 2-element queryKey so the parent list's
       invalidateQueries({queryKey: ["/api/partner/me/spvs"]}) cascades. */
    queryKey: ["/api/partner/me/spvs", spvId],
    enabled: role.ready && !!role.identity && !!spvId,
    queryFn: async () => (await apiRequest("GET", `/api/partner/me/spvs/${spvId}`)).json(),
  });

  /* v25.24 NM-1 fix — wire capital-call + distribution forms to the v25.23
   * NC-A real DB-backed handlers. PartnerSpvDetail was a read-only dead-end
   * even after v25.23 made the server side correct + gated. Both endpoints
   * are managing_partner-only on the server, so we also disable the forms
   * unless the user holds that subRole. */
  const isManagingPartner = role.identity?.subRole === "managing_partner";
  const canWriteLp =
    role.identity?.subRole === "managing_partner" ||
    role.identity?.subRole === "associate" ||
    role.identity?.subRole === "bd";
  const [callAmount, setCallAmount] = useState("");
  const [distAmount, setDistAmount] = useState("");
  /* WAVE 6 / SC-5 — the canonical sink REQUIRES an explicit cost basis
     (DISTRIBUTION_BASIS_REQUIRED, server/spvEngineStore.ts:1543). The legacy
     plural endpoint did not, which is a second reason this form could not simply
     be re-enabled: repointing it without collecting a basis would have produced
     a 400 on every submit — a panel that looks alive and still cannot write. */
  const [distCostBasis, setDistCostBasis] = useState("");
  // v26.4.0-fix3 (Opus NEW-4): distribution type is user-selectable. Prior
  // client code hardcoded "dividend", which mischaracterized every SPV
  // distribution (different tax/accounting meaning). Default to
  // return_of_capital — the conservative label for SPV distributions where
  // the GP hasn't yet confirmed the tax classification.
  const [distType, setDistType] = useState<"return_of_capital" | "dividend" | "exit">("return_of_capital");
  const [lpEmail, setLpEmail] = useState("");
  const [lpFirstName, setLpFirstName] = useState("");
  const [lpLastName, setLpLastName] = useState("");
  /* B3 — LP commitment (seats a named LP on the SPV cap table via the sacred
     commitFunded path). amount is a major-unit decimal string; units = shares. */
  const [commitFirst, setCommitFirst] = useState("");
  const [commitLast, setCommitLast] = useState("");
  const [commitEmail, setCommitEmail] = useState("");
  const [commitAmount, setCommitAmount] = useState("");
  const [commitUnits, setCommitUnits] = useState("");
  /* WAVE 176 · ITEM B · R147.3(1) — the target-overage warning the LAST commit
     came back with. Held in state rather than derived from the roster on purpose:
     the sentence is the SERVER's, built from the figures the server actually
     recorded, so the screen and `terms._targetOverages` cannot disagree. Empty
     string means "the last commit did not pass the target", which is also the
     initial state, so the element that renders it is never conditional. */
  const [commitTargetWarning, setCommitTargetWarning] = useState("");
  /* WAVE 83 · ITEM 2.4 — a validation message is an answer to something the user
     did. Until they touch the field there is nothing to answer, so it is not
     shown. Nothing about what is REQUIRED changed; both buttons stay disabled. */
  const [lpLastNameTouched, setLpLastNameTouched] = useState(false);
  const [commitLastTouched, setCommitLastTouched] = useState(false);

  /* W2-H — GP LP roster (subscribers + pending invites). */
  const roster = useQuery<{
    spvId: string;
    lpVisibility: string;
    /* WAVE 182 · ITEM B · R152.3 — `fundsConfirmed` is OPTIONAL in this type on
       purpose: a cached payload from before this wave has no such key, and the
       renderer must treat its absence as "not confirmed" rather than as `undefined`
       on screen. */
    subscribers: Array<{ investorId: string; name: string | null; email: string | null; commitmentMinor: number; status: string; ownershipPct: number; fundsConfirmed?: boolean }>;
    invites: Array<{ id: string; email: string; firstName: string | null; lastName: string; note: string | null; status: string; createdAt: string }>;
  }>({
    queryKey: ["/api/partner/me/spv", spvId, "lp-roster"],
    enabled: role.ready && !!role.identity && !!spvId,
    queryFn: async () => (await apiRequest("GET", `/api/partner/me/spv/${spvId}/lp-roster`)).json(),
  });

  /* WAVE 211 — one panel state per gated action. Four, not one: a partner may have a
     capital call half-typed while they invite an LP, and sharing one confirmation
     between two money events would let a name typed for one authorise the other. */
  const w211Call = useWave211Attestation("money_event");
  const w211Dist = useWave211Attestation("money_event");
  const w211Invite = useWave211Attestation("lp_invitation");
  const w211Commit = useWave211Attestation("lp_commitment");

  const inviteMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/partner/me/spv/${spvId}/lp-invites`, {
        email: lpEmail.trim(),
        firstName: lpFirstName.trim() || undefined,
        lastName: lpLastName.trim(),
        /* WAVE 211 — APPENDED, never replacing what was already sent. The server
           strips these five keys from the body before anything else reads it, so they
           cannot reach the invite record as data. */
        ...w211Invite.bodyFields(),
      });
      return res.json();
    },
    onSuccess: () => {
      setLpEmail(""); setLpFirstName(""); setLpLastName("");
      w211Invite.reset();   // WAVE 211 — a fresh confirmation for the next invitation.
      /* WAVE 83 · ITEM 2.3 — BOTH roster surfaces, and a forced refetch. */
      qc.invalidateQueries({ queryKey: ["/api/partner/me/spv", spvId, "lp-roster"] });
      qc.invalidateQueries({ queryKey: ["/api/spv", spvId, "lp-roster"] });
      qc.refetchQueries({ queryKey: ["/api/partner/me/spv", spvId, "lp-roster"] });
      qc.refetchQueries({ queryKey: ["/api/spv", spvId, "lp-roster"] });
      toast({ title: "LP invited", description: "The roster below has been refreshed — the invite is on it. Do not send it again." });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Invite failed", description: partnerActionRefusalText(e) }),
  });

  const commitMut = useMutation({
    mutationFn: async () => {
      /* WAVE 135 · FINDING 2 — THE BOUND WAS DISPLAYED BUT NEVER ENFORCED.

         Wave 128 put `PartnerMoneyEntryNotice` under this field, and that notice
         correctly REFUSES a negative amount in a sentence as the client types —
         `parseWholeUnits` has always rejected a leading minus. But nothing on the
         submit path ever ASKED the parser. The button's `disabled` tested
         `!commitAmount.trim()` (non-empty) and the handler posted
         `amount: commitAmount.trim()` verbatim, so `-5000` sailed past a visible
         red refusal and reached the endpoint. A refusal a client can read and
         then ignore is not a bound; it is a decoration.

         So the parser's verdict now gates BOTH the button's `disabled` expression
         and this handler. Gated twice on purpose, and consulted
         through the SAME parser the notice already renders, so the sentence the
         client sees and the reason the submit refuses cannot drift apart.

         WHAT IS DELIBERATELY NOT DONE: the value is still posted as
         `commitAmount.trim()`, byte-for-byte what it was. This endpoint takes
         `amount` as a DECIMAL STRING IN WHOLE UNITS and scales it itself with
         `decimalStringToMinor` (server/lib/money.ts:727), so sending the parser's
         minor-unit integer here would be a hundredfold error — the exact trap wave
         128 documented at the field. Validate with the parser; do not convert. */
      const commitCheck = parseWholeUnits(commitAmount, s.currency, { label: "Commitment amount" });
      if (!commitCheck.ok) throw new Error(commitCheck.message);
      const res = await apiRequest("POST", `/api/partner/me/spv/${spvId}/lp-commit`, {
        holderFirstName: commitFirst.trim(),
        holderLastName: commitLast.trim(),
        investorEmail: commitEmail.trim(),
        amount: commitAmount.trim(),
        shares: commitUnits.trim(),
        /* WAVE 211 — appended. `amount` above is still the whole-unit decimal string
           this endpoint has always taken; nothing here converts it. */
        ...w211Commit.bodyFields(),
      });
      return res.json();
    },
    onSuccess: (payload: unknown) => {
      /* ══ WAVE 176 · ITEM B · R147.3(1) — R130's WARN HALF, FINALLY ON SCREEN.

         `onSuccess` took NO argument before this wave, so the entire response
         body — including `targetRaise`, which wave 164 has been sending — was
         discarded, and a $9,000,000 commit against a $5,000,000 target produced
         only the toast below. This reads the sentence the route now returns.

         THE COMMITMENT IS ALREADY DONE at this point and nothing here can undo
         it: this is `onSuccess`, the ledger line exists, and the recorded
         outcome is untouched. Warn-only, exactly R130.1 with R135.3.

         Defensive narrowing rather than a cast, because a response shape is an
         assumption about a server: anything that is not a non-empty string
         clears the line instead of rendering `undefined` at a partner. */
      const body = (payload ?? {}) as { targetRaise?: { warning?: unknown } };
      const warning = body.targetRaise?.warning;
      setCommitTargetWarning(typeof warning === "string" ? warning : "");
      setCommitFirst(""); setCommitLast(""); setCommitEmail(""); setCommitAmount(""); setCommitUnits("");
      w211Commit.reset();   // WAVE 211 — a fresh confirmation for the next commitment.
      /* WAVE 83 · ITEM 2.3 — same two keys, same forced refetch, same reason. */
      qc.invalidateQueries({ queryKey: ["/api/partner/me/spv", spvId, "lp-roster"] });
      qc.invalidateQueries({ queryKey: ["/api/spv", spvId, "lp-roster"] });
      qc.refetchQueries({ queryKey: ["/api/partner/me/spv", spvId, "lp-roster"] });
      qc.refetchQueries({ queryKey: ["/api/spv", spvId, "lp-roster"] });
      toast({ title: "LP committed to the cap table" });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "LP commit failed", description: partnerActionRefusalText(e) }),
  });

  const callMut = useMutation({
    mutationFn: async (amountMinor: number) => {
      /* v25.33 — apiRequest() throws ApiError on non-2xx; the former `if (!res.ok)`
         guard (here and in distMut below) was unreachable dead code. The thrown
         ApiError reaches onError unchanged, preserving the failure toast. */
      const res = await apiRequest("POST", `/api/partner/me/spvs/${spvId}/capital-calls`, {
        amount_minor: amountMinor,
        called_at: new Date().toISOString(),
        /* WAVE 211 — appended. This is the PLURAL adapter route, which is the one
           actually mounted for capital calls; the gate is on it there. */
        ...w211Call.bodyFields(),
      });
      return res.json();
    },
    onSuccess: () => {
      setCallAmount("");
      w211Call.reset();     // WAVE 211 — a fresh confirmation for the next call.
      qc.invalidateQueries({ queryKey: ["/api/partner/me/spvs", spvId] });
      toast({ title: "Capital call recorded" });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Capital call failed", description: partnerActionRefusalText(e) }),
  });

  /* ── WAVE 6 / SC-5 — THE REPOINT ────────────────────────────────────────
   *
   * THIS IS THE "DISABLED PANEL WITH THE ROUTE STILL OPEN" FIX.
   *
   * BEFORE: this mutation POSTed to the PLURAL legacy endpoint
   *   POST /api/partner/me/spvs/:id/distributions   (server/spvLegacyAdapters.ts:394)
   *     -> spvFundStore.recordDistribution
   *     -> INSERT INTO spv_distributions            (PLURAL, legacy ledger)
   * which WAVE 2B closed fail-closed (`legacyDistributionLedgerClosed`, adapters
   * :403). So the form could not write at all, and SC-2 papered over that with
   * `DIST_PANEL_DISABLED = true` — a dead control on a page whose route
   * (client/src/App.tsx:1221) was, and still is, open. Every symptom of this
   * project's recurring failure mode in one place.
   *
   * AFTER: it POSTs to the CANONICAL SINGULAR endpoint
   *   POST /api/partner/me/spv/:spvId/distributions (server/spvEngineRoutes.ts:501)
   *     -> spvEngineStore.recordDistribution        (server/spvEngineStore.ts:1731)
   *     -> INSERT INTO spv_distribution             (SINGULAR, canonical ledger)
   * the same sink SpvDetailTabs' Distributions tab already writes to, so the
   * two SPV surfaces stop disagreeing about where a distribution lives.
   *
   * SECOND-PATH CHECK (the instruction to look for another route to the same
   * write): `grep -n "INSERT INTO spv_distribution "` over server/ returns ONE
   * hit, spvEngineStore.ts:1735/1738. The plural ledger is a DIFFERENT table
   * reached only through spvFundStore.ts:902, whose two entry points
   * (the legacy HTTP route, and the engineRecordDistribution adapter at
   * spvEngineStore.ts:~2806) both now throw LEGACY_DISTRIBUTION_LEDGER_DISABLED
   * unconditionally. There is no third writer.
   *
   * BODY SHAPE. The canonical route takes a five-field allowlist projection
   * (`pickDistributionBody`, spvEngineRoutes.ts:72) — event, grossProceedsMinor,
   * currency, costBasisMinor, distributionType — NOT the legacy snake_case
   * `{distribution_type, total_minor, distributed_at}`. `distributionType` was
   * added to that allowlist in this same wave (SC-3); without that server-side
   * change this field would have been silently dropped, which is why the two
   * items ship together. `distributed_at` is deliberately NOT sent: the
   * canonical ledger stamps `created_at` itself and does not accept a
   * client-supplied effective date.
   *
   * MONEY. `grossProceedsMinor` is an integer in minor units, parsed by the
   * caller. No float, no client-side rounding, no per-party split here — the
   * waterfall allocation is the store's job via server/lib/money.ts. */
  const distMut = useMutation({
    mutationFn: async (args: { totalMinor: number; costBasisMinor: number; type: "return_of_capital" | "dividend" | "exit" }) => {
      const res = await apiRequest("POST", `/api/partner/me/spv/${spvId}/distributions`, {
        event: args.type,
        grossProceedsMinor: args.totalMinor,
        costBasisMinor: args.costBasisMinor,
        currency: data?.spv?.currency ?? undefined,
        distributionType: args.type,
        /* WAVE 211 — appended AFTER the five-field allowlist projection this route
           takes. `pickDistributionBody` never sees these keys as data; the gate reads
           them from the raw body and strips them. */
        ...w211Dist.bodyFields(),
      });
      return res.json();
    },
    onSuccess: () => {
      setDistAmount("");
      w211Dist.reset();     // WAVE 211 — a fresh confirmation for the next distribution.
      /* Both surfaces must refresh: this page's own query AND the canonical
         engine query the Distributions tab reads, or the GP sees a stale
         ledger on whichever surface they open next. */
      qc.invalidateQueries({ queryKey: ["/api/partner/me/spvs", spvId] });
      qc.invalidateQueries({ queryKey: ["/api/partner/me/spv", spvId] });
      toast({ title: "Distribution recorded" });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Distribution failed", description: partnerActionRefusalText(e) }),
  });

  /* GROUP F1 — seed a person-level CRM contact from an SPV LP row. Idempotent
     server-side by (partner_id, email); the server verifies this SPV belongs to
     the calling partner (source_ref) before creating. */
  const addToCrmMut = useMutation({
    mutationFn: async (sub: { name: string | null; email: string | null }) => {
      const res = await apiRequest("POST", "/api/partner/me/crm/contacts/from-source", {
        source_kind: "spv_lp",
        source_ref: spvId,
        identity: { email: sub.email ?? undefined, name: sub.name ?? undefined },
      });
      return res.json();
    },
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["/api/partner/me/crm/contacts"] });
      toast({ title: r?.existing ? "Already in CRM" : "Added to CRM" });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Add to CRM failed", description: partnerActionRefusalText(e) }),
  });

  /* ═════════════════════════════════════════════════════════════════════
     WAVE 151 · ITEM C · R105(1) — THE PRE-COMMIT CAP WARNING.

     R105 requires a CLEAR warning BEFORE the commit that names the cap, the
     current committed total and the overage. It appears as the GP types, beside
     the amount field, from the figures already on this page — the SPV's own
     `capMinor` and the LP roster this page already loads.

     IT DOES NOT BLOCK. R105 is warn-and-record: the submit button's `disabled`
     expression is deliberately UNCHANGED, because refusing here would be a new
     gate the ruling did not ask for and would strand a GP whose legitimate
     oversubscription the ledger has every right to record.

     ARITHMETIC, AND WHY IT IS IN `bigint`. `parseWholeUnits` already returns
     exact minor units as a `bigint` from string surgery — no float touches what
     the GP typed. The roster figures arrive as JSON `number`s, so EVERY ONE is
     checked with `Number.isSafeInteger` BEFORE any maths: a `NaN`, a fraction or
     a value past 2^53 makes the total unknowable, and an unknowable total is
     reported as such rather than rendered as a confident wrong number. Only after
     that check is `BigInt()` applied — a widening of an integer, never a parse of
     money.

     THE OVERLAP. `committedBefore` ALREADY CONTAINS this LP's existing row when
     they were invited or previously committed, and the server ASSIGNS rather than
     adds (`projectLpCommitted`, spvEngineStore.ts:1571). So their existing
     contribution is subtracted before the new amount is added, exactly as
     `computeCapImpact` does on the server; otherwise a no-op re-commit would show
     a phantom overage. The LP is matched by trimmed, lower-cased email, the same
     normal form `lpInvestorIdForEmail` uses server-side to derive the investor id.

     Hoisted into `useMemo` and rendered as ONE always-present sibling with an
     empty string when there is nothing to warn about, so no sibling JSX is
     swapped for a conditional and the drop gate sees no shape change. */
  const capWarning = useMemo((): { text: string; overage: boolean } => {
    const spv = data?.spv;
    if (!spv) return { text: "", overage: false };
    const capMinor = spv.capMinor ?? null;
    // No cap set on this vehicle — there is nothing to be over.
    if (capMinor == null || !Number.isSafeInteger(capMinor) || capMinor <= 0) return { text: "", overage: false };
    const typed = parseWholeUnits(commitAmount, spv.currency, { label: "Commitment amount" });
    if (!typed.ok) return { text: "", overage: false };
    const subs = roster.data?.subscribers;
    if (!subs) return { text: "", overage: false };
    const occupying = subs.filter((x) => x.status !== "withdrawn");
    if (occupying.some((x) => !Number.isSafeInteger(x.commitmentMinor))) {
      return {
        text:
          "The committed total for this SPV cannot be calculated from the roster, so no cap comparison is shown. " +
          "Check the LP roster figures before committing.",
        overage: false,
      };
    }
    let committedBefore = BigInt(0);
    for (const x of occupying) committedBefore += BigInt(x.commitmentMinor);
    const email = commitEmail.trim().toLowerCase();
    let existingContribution = BigInt(0);
    if (email) {
      for (const x of occupying) {
        if ((x.email ?? "").trim().toLowerCase() === email) existingContribution += BigInt(x.commitmentMinor);
      }
    }
    const resulting = committedBefore - existingContribution + typed.minor;
    const capBig = BigInt(capMinor);
    if (resulting <= capBig) return { text: "", overage: false };
    /* ══════════════════════════════════════════════════════════════════
       WAVE 164 · BATCH 3 ITEM C · R133.1 — "Committed now:" WAS FALSE AND IS GONE.
       ══════════════════════════════════════════════════════════════════
       `committedBefore` is the CAPACITY basis — every non-withdrawn subscription,
       including soft-circled, GP-confirmed and under-review indications. Labelling
       that total "Committed now" told a GP that interest was capital, which is the
       single defect R133.1 is about. The BASIS IS CORRECT AND IS UNCHANGED (a
       soft-circle does occupy a seat in the vehicle); only the LABEL was wrong.

       So the four occupying figures are now named SEPARATELY — confirmed capital,
       soft-circled interest, funds received but not committed — alongside the cap
       and the overage. Confirmed capital is `status === "committed"` only;
       soft-circled interest is soft-circled + GP-confirmed + under review; the
       three plus the requested amount add up to the total, so no figure here is a
       total without its parts. Sums are BigInt throughout — no `Number()`,
       `parseInt` or `parseFloat` on money — and every addend was safe-integer
       checked by the `occupying` guard above.

       The committing LP's own existing row is excluded from all three parts for the
       same reason it is subtracted from the total: `projectLpCommitted` REPLACES it
       rather than adding to it. */
    const others = occupying.filter((x) => !email || (x.email ?? "").trim().toLowerCase() !== email);
    let confirmedCapital = BigInt(0);
    let softCircledInterest = BigInt(0);
    let wiredNotCommitted = BigInt(0);
    for (const x of others) {
      const st = String(x.status ?? "").trim();
      if (st === SPV_COMMITTED_SUBSCRIPTION_STATUS) confirmedCapital += BigInt(x.commitmentMinor);
      else if (st === "wire_funded") wiredNotCommitted += BigInt(x.commitmentMinor);
      else softCircledInterest += BigInt(x.commitmentMinor);
    }
    return {
      overage: true,
      text:
        `This commitment would take ${spv.name} past its cap. ` +
        `Cap (maximum this vehicle may accept): ${formatWholeUnits(capBig, spv.currency)}. ` +
        `Confirmed capital (committed subscriptions only): ${formatWholeUnits(confirmedCapital, spv.currency)}. ` +
        `Soft-circled interest (soft-circled, GP-confirmed or under review — not capital, but it does occupy capacity): ` +
        `${formatWholeUnits(softCircledInterest, spv.currency)}. ` +
        `Funds received, not yet committed: ${formatWholeUnits(wiredNotCommitted, spv.currency)}. ` +
        `This commitment: ${formatWholeUnits(typed.minor, spv.currency)}. ` +
        `Total occupying capacity after this commitment: ${formatWholeUnits(resulting, spv.currency)}. ` +
        `Overage above the cap: ${formatWholeUnits(resulting - capBig, spv.currency)}. ` +
        "You can still record it. If you do, the overage is recorded against this SPV with your name and the time, " +
        "together with this same split, so the record cannot assert an overage that does not exist in capital.",
    };
  }, [data?.spv, roster.data?.subscribers, commitAmount, commitEmail]);

  /* ══════════════════════════════════════════════════════════════════════════
     WAVE 176 · ITEM A · R147.3(3) — WHY THE COMMIT BUTTON IS DEAD, IN WORDS.
     ══════════════════════════════════════════════════════════════════════════
     A partner on live 26.29.0 filled every field marked required and the button
     stayed disabled with NOTHING on screen saying why, because "Units (shares)"
     gates submission without being marked required. This names the missing
     fields instead.

     IT MIRRORS THE `disabled` EXPRESSION TERM FOR TERM, in the same order, and
     both consult the same `parseWholeUnits` verdict, so the reason on screen
     cannot claim the form is ready while the button refuses (or the reverse).
     `isPending` is deliberately NOT reported here: the button already says
     "Committing…" for that state, so repeating it would be noise.

     NO MONEY IS PARSED. `parseWholeUnits` is the shared parser this form already
     uses; its own refusal sentence is rendered by `PartnerMoneyEntryNotice` at
     the field, so this line only reports THAT the amount is not yet an amount
     and lets the notice say why. No `Number()`, `parseInt` or `parseFloat`. */
  const commitDisabledReason = useMemo((): string => {
    const spv = data?.spv;
    if (!spv) return "";
    const missing: string[] = [];
    if (!commitFirst.trim()) missing.push("first name");
    if (!commitLast.trim()) missing.push("last name");
    if (!commitEmail.trim()) missing.push("email");
    if (!commitAmount.trim()) missing.push("commitment amount");
    if (!commitUnits.trim()) missing.push("units (shares)");
    if (missing.length > 0) {
      return (
        `Commit LP is unavailable until every required field is filled. Still needed: ${missing.join(", ")}. ` +
        "Units (shares) is required: the server refuses a commitment that does not carry a unit count."
      );
    }
    if (!parseWholeUnits(commitAmount, spv.currency, { label: "Commitment amount" }).ok) {
      return "Commit LP is unavailable because the commitment amount is not yet a valid amount. The line at the amount field says what is wrong with it.";
    }
    return "";
  }, [data?.spv, commitFirst, commitLast, commitEmail, commitAmount, commitUnits]);

  /* WAVE 151 · R105(3) — THE OVERAGE, VISIBLE AFTERWARDS.
     A warning shown once during typing satisfies R105(1) only. The recorded
     override must still be READABLE on the SPV after the fact, so the durable
     `terms._capOverrides` bag the server writes (spvEngineStore.recordCapOverride)
     is rendered here from the SPV payload this page already loads. Read-only; each
     figure is safe-integer checked before it is formatted, and a figure that is
     not usable is named as such rather than printed. */
  const recordedCapOverrides = useMemo(() => {
    const bag = (data?.spv?.terms ?? {}) as Record<string, unknown>;
    const overrides = bag._capOverrides as Record<string, Record<string, unknown>> | undefined;
    return Object.values(overrides ?? {}).map((o) => {
      const overage = o.overageMinor;
      const total = o.resultingTotalMinor;
      const cap = o.capMinor;
      const cur = typeof o.currency === "string" ? o.currency : (data?.spv?.currency ?? "USD");
      /* WAVE 164 · ITEM C — `"not recorded"` read as though the platform had
         chosen not to record the figure. It never held one. `"Not on record"` is
         the one spelling of that across every surface this wave touches. */
      const fig = (v: unknown) =>
        typeof v === "number" && Number.isSafeInteger(v) ? formatMinor(v, cur) : SPV_NOT_ON_RECORD_LABEL;
      return {
        investorId: String(o.investorId ?? ""),
        recordedAt: typeof o.recordedAt === "string" ? o.recordedAt : "",
        actor: String(o.actor ?? ""),
        /* WAVE 164 · ITEM C · R133.1 — the durable record now renders the SPLIT the
           server writes, so a reader can see how much of the total was actually
           capital instead of an unattributed "total after". A record written before
           this wave carries no split fields, and those read as "Not on record"
           rather than as zero. */
        line:
          `Cap (maximum) ${fig(cap)} · confirmed capital ${fig(o.confirmedCapitalMinor)} · ` +
          `soft-circled interest ${fig(o.softCircledInterestMinor)} · ` +
          `funds received not committed ${fig(o.wiredNotCommittedMinor)} · ` +
          `total occupying capacity ${fig(total)} · overage ${fig(overage)}`,
      };
    });
  }, [data?.spv]);

  /* WAVE 164 · R130 — THE TARGET OVERAGES, READ FROM THEIR OWN KEY.
     `terms._targetOverages`, NEVER `terms._capOverrides`. A target is a GOAL and
     passing it is good news; a cap is a MAXIMUM and passing it is a breach. They
     are read here by two separate memos over two separate keys so a GP surface
     cannot present one as the other, which is the conflation R130 forbids. */
  const recordedTargetOverages = useMemo(() => {
    const bag = (data?.spv?.terms ?? {}) as Record<string, unknown>;
    const overages = bag[SPV_TARGET_OVERAGES_TERMS_KEY] as
      | Record<string, Record<string, unknown>>
      | undefined;
    return Object.values(overages ?? {}).map((o) => {
      const cur = typeof o.currency === "string" ? o.currency : (data?.spv?.currency ?? "USD");
      const fig = (v: unknown) =>
        typeof v === "number" && Number.isSafeInteger(v) ? formatMinor(v, cur) : SPV_NOT_ON_RECORD_LABEL;
      return {
        investorId: String(o.investorId ?? ""),
        recordedAt: typeof o.recordedAt === "string" ? o.recordedAt : "",
        line:
          `Target raise (the goal, not a limit) ${fig(o.targetRaiseMinor)} · ` +
          `confirmed capital ${fig(o.confirmedCapitalMinor)} · ` +
          `soft-circled interest ${fig(o.softCircledInterestMinor)} · ` +
          `total ${fig(o.resultingTotalMinor)} · above target by ${fig(o.targetOverageMinor)}`,
      };
    });
  }, [data?.spv]);

  if (!role.ready || !role.identity) return null;
  const me = role.identity;
  if (isLoading) return <PartnerShell title="SPV" tier={me.tier} subRole={me.subRole} partnerName={me.identity.name}><div>Loading…</div></PartnerShell>;
  if (error || !data?.spv) {
    return (
      <PartnerShell title="SPV not found" tier={me.tier} subRole={me.subRole} partnerName={me.identity.name}>
        <div className="text-red-600" data-testid="partner-spv-not-found">
          This SPV does not exist or you do not have access to it.
        </div>
      </PartnerShell>
    );
  }
  const s = data.spv;

  /* WAVE 216 — THE WIRE FIGURES, computed once where the currency is known.

     These are not new conversions. Each is the SAME call this page already makes in
     the corresponding submit handler (capital call at :807, gross proceeds at :963),
     through the one `bigint` converter, in its non-throwing form so it can run during
     render. They exist so the money-event attestation panels can restate the figure
     the ROUTE receives — which is the figure the server writes into the stored
     recital — instead of the whole-unit figure the partner typed. That mismatch is
     the discrepancy wave 226 pinned.

     The labels are the same labels the submit handlers pass, so a refusal sentence
     cannot describe a different field here than it does there. `null` means "not yet
     an amount", never zero: nothing here defaults, rounds or fabricates a figure. */
  const callAmountWire = wholeUnitsToWireMinorOrNull(callAmount, s.currency, "Capital call amount");
  const distAmountWire = wholeUnitsToWireMinorOrNull(distAmount, s.currency, "Gross proceeds");

  return (
    <PartnerShell title={`${s.name} · ${jurisdictionLabel(s)} · ${spvStatusLabel(s.status)}`} tier={me.tier} subRole={me.subRole} partnerName={me.identity.name}>
      <Card className="p-4 mb-4 space-y-2" data-testid="partner-spv-detail">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-[var(--cv-color-text-muted)]">Target Size</div>
            {/* WAVE 55 · R6 / 55-Q1 — prominent readout: named refusal, not a dash.
                See PartnerFundDetail.tsx for the identical tile. */}
            <div className="font-mono">{moneyOrNotProvided(s.targetRaiseMinor, s.currency)}</div>
            {/* WAVE 164 · R130.2 — S1. "Target Size" alone read as a LIMIT to at
                least one partner, and that misreading is the original defect. The
                heading above is left EXACTLY as it shipped (removing a live copy
                string is a drop the guard correctly refuses) and the distinction is
                ADDED beneath it: the target is a goal, the cap is the maximum, and a
                blank cap reads "no maximum" rather than being shown as 0. */}
            <div className="text-xs text-[var(--cv-color-text-muted)]" data-testid="partner-spv-target-is-a-goal">
              This is the fundraising goal for this vehicle, not a limit. Passing it does not block a
              commitment; it is recorded so the raise can be reconciled against what was planned.
            </div>
            <div className="text-[var(--cv-color-text-muted)] mt-2">Cap (maximum this vehicle may accept)</div>
            <div className="font-mono" data-testid="partner-spv-cap-maximum">
              {s.capMinor == null ? SPV_CAP_BLANK_LABEL : moneyOrNotProvided(s.capMinor, s.currency)}
            </div>
          </div>
          <div>
            <div className="text-[var(--cv-color-text-muted)]">Currency (ISO 4217)</div>
            <div className="font-mono">{s.currency}</div>
          </div>
          <div>
            <div className="text-[var(--cv-color-text-muted)]">Jurisdiction</div>
            <div data-testid="partner-spv-jurisdiction">{jurisdictionLabel(s)}</div>
          </div>
          <div>
            <div className="text-[var(--cv-color-text-muted)]">Status</div>
            <div data-testid="partner-spv-status">{spvStatusLabel(s.status)}</div>
          </div>
        </div>
      </Card>

      {/* v25.24 NM-1 — managing_partner-only capital-call + distribution UI.
          Server endpoints are also gated with assertSubRole; the disable here
          is defense-in-depth for UX (avoid pre-flight failed POSTs). */}
      {isManagingPartner ? (
        <Card className="p-4 mb-4 space-y-3" data-testid="partner-spv-capital-call-form">
          <div className="font-medium">Record Capital Call</div>
          {/* WAVE 128 · FINDING 2 — whole currency units. `type="text"` because a
              person writes "250,000" and a number input silently discards the
              separators it does not like; the parser does the refusing, in a
              sentence, under the field. The notice is ONE always-rendered sibling
              (W116 §3.1), so the panel's child shape does not move. */}
          <div className="flex items-center gap-2">
            <Input
              type="text"
              inputMode="decimal"
              placeholder={wholeUnitsPlaceholder(s.currency)}
              aria-label={wholeUnitsLabel("Capital call amount", s.currency)}
              value={callAmount}
              onChange={(e) => setCallAmount(e.target.value)}
              data-testid="partner-spv-capital-call-amount"
            />
            <Button
              disabled={!callAmount || callMut.isPending}
              onClick={() => {
                /* The typed amount becomes the exact minor-unit integer this
                   endpoint has always taken. A refusal is stated, never guessed
                   at and never rounded — `Math.round(Number(...))` is gone. */
                let amountMinor: number;
                try {
                  amountMinor = wireMinorNumber(
                    wholeUnitsToWireMinor(callAmount, s.currency, "Capital call amount"),
                    "Capital call amount",
                  );
                } catch (err) {
                  toast({
                    variant: "destructive",
                    title: "Capital call not recorded",
                    /* WAVE 170 — the same resolver as the five onError handlers.
                       These three sites throw the money parser's OWN sentence,
                       which passes through unchanged; the resolver is here so a
                       future throw that is NOT a sentence cannot reach the GP. */
                    description: partnerActionRefusalText(err),
                  });
                  return;
                }
                callMut.mutate(amountMinor);
              }}
              data-testid="partner-spv-capital-call-submit"
            >
              {callMut.isPending ? "Recording…" : "Record"}
            </Button>
          </div>
          {/* WAVE 211 · ITEM A — APPENDED as a static sibling above the existing money
              notice. The submit button's `disabled` expression is UNTOUCHED (R143.1):
              this panel adds a control, it does not replace or gate one. The server
              refuses a call with no confirmation regardless of what is on screen. */}
          <Wave211AttestationPanel
            kind="money_event"
            testIdSuffix="capital-call"
            state={w211Call.state}
            patch={w211Call.patch}
            complete={w211Call.complete}
            facts={{
              kind: "money_event",
              eventNoun: W211_EVENT_NOUN_CAPITAL_CALL,
              vehicleName: s.name,
              eventType: W211_EVENT_NOUN_CAPITAL_CALL,
              /* WAVE 216 — THE AMOUNT LINE WAVE 226 PINNED.

                 This used to read `amountRaw: callAmount, amountUnit: "as_entered"`,
                 with a comment saying the server states the minor figure separately.
                 It does — `spvLegacyAdapters.ts:558` stores this recital with
                 `amountUnit: "minor"` — so the signer read one Amount line and the
                 record kept a different one for the SAME event. Wave 226's S-4 test
                 pinned that as a known discrepancy.

                 The fix converts NOTHING NEW. `callAmountWire` is the exact string
                 this form already puts on the wire at :807, produced by the one
                 `bigint` converter. When it exists the panel restates it and labels it
                 `minor`, agreeing with the stored recital byte-for-byte; while the box
                 does not yet hold an amount there is no wire figure at all, so the
                 panel states what the partner typed and SAYS it is as entered. No
                 arithmetic is authored here, no currency converted, none assumed. */
              amountRaw: callAmountWire ?? callAmount,
              amountUnit: callAmountWire == null ? "as_entered" : "minor",
              currency: s.currency,
              eventDate: null,
            }}
          />
          <PartnerMoneyEntryNotice
            raw={callAmount}
            currency={s.currency}
            label="Capital call amount"
            testid="partner-spv-capital-call-amount-notice"
          />
        </Card>
      ) : null}

      {/* SC-2 SAFETY (WAVE 2) — DELIBERATE, REVERSIBLE, OWNER-VISIBLE DISABLE.

          This panel is rendered INERT. Nothing is deleted: the component, the
          `distMut` mutation and every field below stay in the tree exactly as
          written, and re-enabling is a one-line change (drop `DIST_PANEL_DISABLED`).

          Why. SC-2 gives this page an inbound link from the SPV Engine list for
          the first time. This panel POSTs to
            POST /api/partner/me/spvs/:id/distributions   (PLURAL)
          which writes the legacy PLURAL table `spv_distributions` via
          engineRecordDistribution → spvFundStore.recordDistribution
          (server/spvLegacyAdapters.ts:353-380, server/spvEngineStore.ts:2501-2515).
          The SPV Engine accordion's Distributions tab POSTs to
            POST /api/partner/me/spv/:id/distributions    (SINGULAR)
          which writes the SINGULAR canonical table `spv_distribution` via
          spvEngineStore.recordDistribution (server/spvEngineRoutes.ts:395-399,
          insert at server/spvEngineStore.ts:1489-1493). One letter apart, two
          ledgers, and the singular read CANNOT see a plural write. Linking this
          page without disabling the panel would make that split ledger reachable
          to a GP recording real distributions.

          This drops nothing reachable: the page has no inbound link today, so no
          user loses a surface they can currently use. SC-5 repoints this form
          onto the canonical singular ledger and the panel comes back. */}
      {isManagingPartner ? (
        <Card className="p-4 mb-4 space-y-3" data-testid="partner-spv-distribution-form">
          <div className="font-medium">Record Distribution</div>
          <div
            className="text-xs rounded border border-slate-300 bg-slate-50 p-2 text-slate-800"
            data-testid="partner-spv-distribution-disabled-note"
          >
            <DistributionLedgerNote />
          </div>
          <div className="text-xs text-[var(--cv-color-text-muted)]">
            Select the appropriate tax/accounting classification for this distribution. Return of capital is the conservative default when unsure.
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              className="h-9 rounded-md border px-2 text-sm bg-background"
              value={distType}
              onChange={(e) => setDistType(e.target.value as "return_of_capital" | "dividend" | "exit")}
              data-testid="partner-spv-distribution-type"
              disabled={DIST_PANEL_DISABLED}
            >
              <option value="return_of_capital">Return of Capital</option>
              <option value="dividend">Dividend</option>
              <option value="exit">Exit Proceeds</option>
            </select>
            {/* WAVE 128 · FINDING 2 — both distribution amounts in whole currency
                units. The wire still carries `grossProceedsMinor` and
                `costBasisMinor` as exact minor-unit integers. */}
            <Input
              type="text"
              inputMode="decimal"
              placeholder={wholeUnitsPlaceholder(s.currency)}
              aria-label={wholeUnitsLabel("Gross proceeds", s.currency)}
              value={distAmount}
              onChange={(e) => setDistAmount(e.target.value)}
              data-testid="partner-spv-distribution-amount"
              className="flex-1 min-w-[220px]"
              disabled={DIST_PANEL_DISABLED}
            />
            <Input
              type="text"
              inputMode="decimal"
              placeholder={wholeUnitsPlaceholder(s.currency)}
              aria-label={wholeUnitsLabel("Cost basis", s.currency)}
              value={distCostBasis}
              onChange={(e) => setDistCostBasis(e.target.value)}
              data-testid="partner-spv-distribution-cost-basis"
              className="flex-1 min-w-[220px]"
              disabled={DIST_PANEL_DISABLED}
            />
            <Button
              disabled={DIST_PANEL_DISABLED || !distAmount || distCostBasis === "" || distMut.isPending}
              onClick={() => {
                /* SC-2 SAFETY, RETAINED. Even with the panel live, the guard
                   stays: if a future wave flips DIST_PANEL_DISABLED back on,
                   a programmatic click must not fire a write. */
                if (DIST_PANEL_DISABLED) return;
                /* FE-2 — client-side validation mirrors the SERVER's rules; it
                   does not replace them. The server still enforces INVALID_GROSS
                   and DISTRIBUTION_BASIS_REQUIRED (spvEngineStore.ts:1538,1543),
                   so this only spares the GP a round trip.

                   WAVE 128 · FINDING 2 — the three `Number()` guards that stood
                   here are gone, and nothing they protected is now unprotected.
                   `parseWholeUnits` refuses a negative, an empty field, exponent
                   notation, junk, and MORE fractional digits than the currency
                   carries — which is the same rule the old "whole minor units
                   only" guard was expressing, stated in the unit the client is
                   actually typing in. The cost basis is still REQUIRED and still
                   never defaulted to zero: `allowZero` is true so a genuine zero
                   basis can be RECORDED, but an EMPTY field is refused by the
                   parser and by the button's own disabled condition. A silent 0
                   basis would treat every dollar of proceeds as profit and
                   over-charge carry to the LPs. */
                let n: number;
                let cb: number;
                try {
                  n = wireMinorNumber(
                    wholeUnitsToWireMinor(distAmount, s.currency, "Gross proceeds"),
                    "Gross proceeds",
                  );
                } catch (err) {
                  /* WAVE 170 — see the note at the capital-call handler above. */
                  toast({ variant: "destructive", title: "Distribution not recorded", description: partnerActionRefusalText(err) });
                  return;
                }
                try {
                  cb = wireMinorNumber(
                    wholeUnitsToWireMinor(distCostBasis, s.currency, "Cost basis", { allowZero: true }),
                    "Cost basis",
                  );
                } catch (err) {
                  toast({ variant: "destructive", title: "Cost basis required", description: partnerActionRefusalText(err) });
                  return;
                }
                /* FE-5 — IRREVERSIBILITY. A distribution is an append-only,
                   hash-chained ledger row (prev_hash/curr_hash on
                   spv_distribution) and there is no delete path. The GP is told
                   that before the write, not after. */
                const ok = window.confirm(
                  `Record a ${distType.replace(/_/g, " ")} of ${formatMinor(n, s.currency)} against ${s.name}?\n\n` +
                  `Cost basis: ${formatMinor(cb, s.currency)}\n\n` +
                  `This appends a permanent row to the SPV distribution ledger and allocates proceeds across committed LPs. It CANNOT be edited or deleted afterwards.`,
                );
                if (!ok) return;
                distMut.mutate({ totalMinor: n, costBasisMinor: cb, type: distType });
              }}
              data-testid="partner-spv-distribution-submit"
            >
              {distMut.isPending ? "Recording…" : "Record"}
            </Button>
          </div>
          {/* Two always-rendered siblings, one per amount, so a GP sees both
              figures stated before appending an irreversible ledger row. */}
          {/* WAVE 211 · ITEM A — APPENDED sibling. Same rule as the capital call above:
              nothing existing is replaced, no `disabled` expression is changed, and the
              window.confirm the GP already sees stays exactly as it was. */}
          <Wave211AttestationPanel
            kind="money_event"
            testIdSuffix="distribution"
            state={w211Dist.state}
            patch={w211Dist.patch}
            complete={w211Dist.complete}
            facts={{
              kind: "money_event",
              eventNoun: W211_EVENT_NOUN_DISTRIBUTION,
              vehicleName: s.name,
              eventType: distType,
              /* WAVE 216 — same fix, same reason, for the distribution recital the
                 server stores with `amountUnit: "minor"` at `spvEngineRoutes.ts:1736`.
                 `distAmountWire` is the string already sent at :963. */
              amountRaw: distAmountWire ?? distAmount,
              amountUnit: distAmountWire == null ? "as_entered" : "minor",
              currency: s.currency,
              eventDate: null,
            }}
          />
          <PartnerMoneyEntryNotice
            raw={distAmount}
            currency={s.currency}
            label="Gross proceeds"
            testid="partner-spv-distribution-amount-notice"
          />
          <PartnerMoneyEntryNotice
            raw={distCostBasis}
            currency={s.currency}
            label="Cost basis"
            testid="partner-spv-distribution-cost-basis-notice"
          />
        </Card>
      ) : null}

      {/* W2-H — LP roster (subscribers + pending invites) + partner-gated invite. */}
      <Card className="p-4 mb-4 space-y-3" data-testid="partner-spv-lp-roster">
        <div className="font-medium">LP Roster</div>
        {/* WAVE 151 · R105(3) — always-rendered sibling; empty when this SPV has
            never been committed past its cap. */}
        <div className="text-xs space-y-1" data-testid="partner-spv-cap-overrides">
          {recordedCapOverrides.map((o) => (
            <div key={o.investorId} className="text-amber-700" data-testid={`partner-spv-cap-override-${o.investorId}`}>
              Recorded over-cap commitment — {o.line}
              {o.recordedAt ? ` · ${formatTimestamp(o.recordedAt)}` : ""}
              {o.actor ? ` · recorded by ${o.actor}` : ""}
            </div>
          ))}
        </div>
        {/* WAVE 164 · R130 — always-rendered sibling, empty when this vehicle has
            not passed its target. A SEPARATE block from the cap overrides above,
            with its own testid, because a goal being beaten is not a breach. */}
        <div className="text-xs space-y-1" data-testid="partner-spv-target-overages">
          {recordedTargetOverages.map((o) => (
            <div key={o.investorId} className="text-emerald-700" data-testid={`partner-spv-target-overage-${o.investorId}`}>
              Above target raise — not blocked, the target is a goal rather than a limit — {o.line}
              {o.recordedAt ? ` · ${formatTimestamp(o.recordedAt)}` : ""}
            </div>
          ))}
        </div>
        {/* WAVE 179 · ITEM C · R151.2 — export THIS roster. A STATIC SIBLING above the
            table; no existing node, literal or handler is touched. The server builds
            the file from `buildPartnerLpRosterPayload`, the exact function that
            produces the rows rendered below, so the file cannot disagree with the
            screen. Rendered whenever the roster loaded, including when it is empty —
            a GP is entitled to a header-only file proving there are no LPs yet. */}
        {roster.data ? (
          <div className="flex items-center gap-2" data-testid="partner-spv-lp-roster-export">
            <PartnerCsvDownloadButton
              url={`/api/partner/me/spv/${spvId}/lp-roster.csv`}
              filename={`spv-lp-roster-${spvId}.csv`}
              testid="partner-spv-lp-roster-export-button"
            />
            <span className="text-xs text-[var(--cv-color-text-muted)]" data-testid="partner-spv-lp-roster-export-note">
              The same rows shown here, with a currency column per row. Figures that are not derivable are marked, never zeroed.
            </span>
          </div>
        ) : null}
        {roster.isLoading && <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="partner-spv-lp-roster-loading">Loading…</div>}
        {roster.isError && (
          <div className="text-sm text-rose-600" data-testid="partner-spv-lp-roster-error">
            Could not load the LP roster. Please refresh and try again.
          </div>
        )}
        {roster.data && (
          <>
            {roster.data.subscribers.length === 0 && roster.data.invites.length === 0 ? (
              <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="partner-spv-lp-roster-empty">
                No LPs yet. Invite one below to get started.
              </div>
            ) : (
              <table className="w-full text-sm" data-testid="partner-spv-lp-roster-table">
                <thead className="bg-[var(--cv-color-surface-2)]">
                  <tr>
                    <th className="text-left p-2">LP</th>
                    <th className="text-left p-2">Email</th>
                    <th className="text-left p-2">Commitment</th>
                    <th className="text-left p-2">Status</th>
                    {canWriteLp && <th className="text-left p-2">CRM</th>}
                  </tr>
                </thead>
                <tbody>
                  {roster.data.subscribers.map((sub) => (
                    <tr key={sub.investorId} className="border-t" data-testid={`partner-spv-lp-sub-${sub.investorId}`}>
                      <td className="p-2">{sub.name ?? "—"}</td>
                      <td className="p-2 text-[var(--cv-color-text-muted)]">{sub.email ?? "—"}</td>
                      <td className="p-2 font-mono">{formatMinor(sub.commitmentMinor, s.currency)}</td>
                      {/* ═══ WAVE 182 · ITEM B · R152.3 / R143.1 — THE SECOND FACT, AS A
                          STATIC SIBLING INSIDE THE EXISTING STATUS CELL.

                          `humanizeMachineKey(sub.status, …)` is NOT touched and NOT made
                          conditional. "Committed" is what this roster has always said and
                          it stays exactly as it renders today: a REPLACED text node scores
                          as REMOVED copy (R143.1). The funds fact is APPENDED beside it.

                          WHY A SIBLING AND NOT ITS OWN COLUMN, WHICH READS BETTER. The
                          silent-drop guard identifies a `td` by its ordinal among the `td`s
                          on this structural path in this file. Both roster rows — the
                          subscriber row and the invite row below — share that path, so a
                          SIXTH cell in this row renumbers every cell in the invite row and
                          the guard, correctly, reports the ones that used to hold the
                          invite name and the em dash as DISAPPEARED. Measured, not assumed:
                          inserting the column produced exactly three such removals at
                          `tbody>tr#6` and `tbody>tr#8`, and appending it last still
                          produced them, because the ordinal is consumed wherever the cell
                          sits. Within a container, by contrast, membership is a SET and the
                          order is compared as a SUBSEQUENCE, so an appended child is purely
                          additive. Nothing here is allow-listed or suppressed.

                          The status literal and the funds statement are separate elements
                          with separate test ids, so "Committed" is still independently
                          readable and this cannot be mistaken for a renamed status. */}
                      <td className="p-2">
                        {humanizeMachineKey(sub.status, "Status not recorded")}
                        <span
                          className="block text-xs text-[var(--cv-color-text-muted)]"
                          data-testid={`partner-spv-lp-funds-${sub.investorId}`}
                        >
                          {/* Derived from `terms._fundsConfirmations`, which the platform
                              has persisted all along; this wave writes nothing and changes
                              no schema. Absent field reads as NOT confirmed, because an
                              older payload is not evidence that funds arrived. */}
                          {sub.fundsConfirmed === true ? "Funds confirmed" : "Funds not yet confirmed"}
                        </span>
                      </td>
                      {canWriteLp && (
                        <td className="p-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!sub.email || addToCrmMut.isPending}
                            onClick={() => addToCrmMut.mutate({ name: sub.name, email: sub.email })}
                            data-testid={`partner-spv-lp-add-crm-${sub.investorId}`}
                          >
                            Add to CRM
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {roster.data.invites.map((inv) => (
                    <tr key={inv.id} className="border-t text-[var(--cv-color-text-muted)]" data-testid={`partner-spv-lp-invite-${inv.id}`}>
                      <td className="p-2">{[inv.firstName, inv.lastName].filter(Boolean).join(" ") || inv.lastName}</td>
                      <td className="p-2">{inv.email}</td>
                      <td className="p-2">—</td>
                      <td className="p-2">invited</td>
                      {/* An invited LP has committed nothing, so there is nothing to
                          confirm, and "Funds not yet confirmed" here would imply a
                          commitment exists. The invite row therefore gains no funds
                          statement at all — silence is the accurate output. */}
                      {canWriteLp && <td className="p-2">—</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {canWriteLp && (
          <div className="pt-2 border-t space-y-2" data-testid="partner-spv-lp-invite-form">
            <div className="text-sm font-medium">Invite an LP</div>
            <div className="grid grid-cols-3 gap-2">
              <Input
                placeholder="First name (optional)"
                value={lpFirstName}
                onChange={(e) => setLpFirstName(e.target.value)}
                data-testid="partner-spv-lp-invite-firstname"
              />
              <Input
                placeholder="Last name *"
                value={lpLastName}
                onChange={(e) => { setLpLastName(e.target.value); setLpLastNameTouched(true); }}
                onBlur={() => setLpLastNameTouched(true)}
                data-testid="partner-spv-lp-invite-lastname"
              />
              <Input
                type="email"
                placeholder="Email *"
                value={lpEmail}
                onChange={(e) => setLpEmail(e.target.value)}
                data-testid="partner-spv-lp-invite-email"
              />
            </div>
            {lpLastNameTouched && !lpLastName.trim() && (
              <div className="text-xs text-rose-600" data-testid="partner-spv-lp-invite-lastname-error">
                Last name is required to invite an LP.
              </div>
            )}
            {/* WAVE 211 · ITEM A — draft 04 Part A, APPENDED above the existing button.
                The button's `disabled` expression and its `onClick` handler expression
                are both untouched (R143.1 covers handler expressions too). */}
            <Wave211AttestationPanel
              kind="lp_invitation"
              testIdSuffix="lp-invite"
              state={w211Invite.state}
              patch={w211Invite.patch}
              complete={w211Invite.complete}
              facts={{
                kind: "lp_invitation",
                /* Null, matching the server. The partner client payload carries no
                   registered organisation name, so the shared builder renders the
                   second-person attribution on both sides and the text shown here is
                   byte-identical to the text stored (R187.3). */
                partnerName: null,
                vehicleName: s.name,
                inviteeEmail: lpEmail,
              }}
            />
            <Button
              disabled={!lpEmail.trim() || !lpLastName.trim() || inviteMut.isPending}
              onClick={() => inviteMut.mutate()}
              data-testid="partner-spv-lp-invite-submit"
            >
              {inviteMut.isPending ? "Inviting…" : "Send invite"}
            </Button>
          </div>
        )}

        {/* B3 — commit a named LP onto the SPV cap table (advances them to
            committed via the sacred commitFunded ledger path). */}
        {canWriteLp && (
          <div className="pt-2 border-t space-y-2" data-testid="partner-spv-lp-commit-form">
            <div className="text-sm font-medium">Commit an LP to the cap table</div>
            {/* ═══ WAVE 182 · ITEM A · R152 — THE CLOSED VEHICLE SAYS SO, ON THE FORM.

                THE DEFECT. This form committed an LP $50,000 into an SPV that had
                already been closed to new LPs, with no refusal and no warning, and
                the close statement then recomputed AFTER the close. The enforcement
                for that lives at the store and the route (a disabled button is not
                enforcement, and this wave does NOT disable the submit control below).
                This is the part a general partner READS.

                ALWAYS RENDERED, empty while the vehicle is open — the same shape as
                the target-raise warning further down, so the negative control is an
                assertion about this element rather than about an absent one, and no
                sibling moves between the two states.

                A STATIC SIBLING. No existing node, literal, placeholder or handler in
                this panel is touched; the words come from the SAME shared module the
                server refusal is built from, so the sentence on the form and the
                sentence returned by the route cannot drift apart. */}
            <div
              className={spvIsClosedToNewCapital(s.status) ? "text-xs text-rose-700" : "text-xs text-[var(--cv-color-text-muted)]"}
              data-testid="partner-spv-lp-commit-closed-notice"
            >
              {spvIsClosedToNewCapital(s.status) ? spvClosedToNewCapitalNotice(s.name) : ""}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Input
                placeholder="First name *"
                value={commitFirst}
                onChange={(e) => setCommitFirst(e.target.value)}
                data-testid="partner-spv-lp-commit-firstname"
              />
              <Input
                placeholder="Last name *"
                value={commitLast}
                onChange={(e) => { setCommitLast(e.target.value); setCommitLastTouched(true); }}
                onBlur={() => setCommitLastTouched(true)}
                data-testid="partner-spv-lp-commit-lastname"
              />
              <Input
                type="email"
                placeholder="Email *"
                value={commitEmail}
                onChange={(e) => setCommitEmail(e.target.value)}
                data-testid="partner-spv-lp-commit-email"
              />
              {/* WAVE 128 · FINDING 2 — THIS FIELD IS NOT CONVERTED, AND THAT IS
                  THE FINDING FOR IT. `lp-commit` takes `amount` as a DECIMAL
                  STRING IN WHOLE UNITS and the server scales it itself with
                  `decimalStringToMinor` (server/spvEngineRoutes.ts:1193/1243).
                  It sat beside three cents fields looking identical to them; a
                  client-side ×100 here would have introduced a hundredfold error
                  where there was none. It gets the explicit whole-unit label and
                  the same confirmation line, and the value posted for a given
                  keystroke is byte-identical to before. */}
              <Input
                type="text"
                inputMode="decimal"
                placeholder={wholeUnitsPlaceholder(s.currency)}
                aria-label={wholeUnitsLabel("Commitment amount", s.currency)}
                value={commitAmount}
                onChange={(e) => setCommitAmount(e.target.value)}
                data-testid="partner-spv-lp-commit-amount"
              />
              {/* ── WAVE 176 · ITEM A · R147.3(3) — A DEAD LABEL ON A MONEY FORM.

                  THE TRUTH WAS ESTABLISHED ON THE SERVER FIRST, not inferred from
                  this file. `POST /api/partner/me/spv/:spvId/lp-commit` refuses a
                  commit with no units outright — server/spvEngineRoutes.ts:1641:
                      if (!amount || !shares) return res.status(400).json({
                        error: "COMMIT_FIELDS_REQUIRED",
                        message: "amount and shares (units) are required." });
                  and `shares` then travels into the sacred `commitFunded` ledger
                  write. So the submit gate below is CORRECT and is NOT relaxed:
                  removing `!commitUnits.trim()` would have swapped a silent dead
                  button for a server refusal, which is strictly worse.

                  WHAT WAS ACTUALLY WRONG is that this field alone carried no
                  required marker while its three neighbours carry `*` inside
                  their placeholders, so a partner filled everything marked
                  required and the button stayed dead with no explanation.

                  R143.1 — the placeholder literal "Units (shares)" is kept
                  BYTE-VERBATIM. The guard inventories `placeholder` attributes as
                  copy strings (see the placeholder entries in
                  scripts/silent-drop-guard/allowlist.json), so appending `*` to it
                  would score as a REMOVED copy string and would need an
                  allow-list entry. Instead the requirement is stated in the
                  STATIC SIBLING line below, and an `aria-label` is ADDED here so
                  assistive technology gets the same marker the sighted
                  convention uses. Nothing is replaced. */}
              <Input
                type="number"
                inputMode="numeric"
                min="1"
                placeholder="Units (shares)"
                aria-label="Units (shares) * — required"
                value={commitUnits}
                onChange={(e) => setCommitUnits(e.target.value)}
                data-testid="partner-spv-lp-commit-units"
              />
            </div>
            <div className="text-xs text-[var(--cv-color-text-muted)]" data-testid="partner-spv-lp-commit-units-required">
              Units (shares) * — required. Every commitment on this cap table records a unit count, and a commit sent without one is refused.
            </div>
            <PartnerMoneyEntryNotice
              raw={commitAmount}
              currency={s.currency}
              label="Commitment amount"
              testid="partner-spv-lp-commit-amount-notice"
            />
            {/* WAVE 151 · R105(1) — always-rendered sibling; empty when within cap. */}
            <div
              className={capWarning.overage ? "text-xs text-amber-700" : "text-xs text-[var(--cv-color-text-muted)]"}
              data-testid="partner-spv-lp-commit-cap-warning"
            >
              {capWarning.text}
            </div>
            {commitLastTouched && !commitLast.trim() && (
              <div className="text-xs text-rose-600" data-testid="partner-spv-lp-commit-lastname-error">
                Last name is required to commit an LP.
              </div>
            )}
            {/* ── WAVE 176 · ITEM A — NO USER IS LEFT GUESSING WHY THE BUTTON IS DEAD.

                ALWAYS RENDERED, empty when nothing is missing — the same shape as
                the wave-151 cap warning above, so no element appears or
                disappears between states and the guard sees a stable sibling.
                Derived from the SAME expression that disables the button
                (`commitDisabledReason` beside it), so the sentence and the gate
                cannot drift apart. */}
            <div
              className={commitDisabledReason ? "text-xs text-amber-700" : "text-xs text-[var(--cv-color-text-muted)]"}
              data-testid="partner-spv-lp-commit-disabled-reason"
            >
              {commitDisabledReason}
            </div>
            {/* ── WAVE 176 · ITEM B · R147.3(1) — R130's TARGET WARNING, ON THE SCREEN.

                THE RECORD WAS NEVER THE DEFECT. spvEngineStore.recordTargetRaiseOverage
                (server/spvEngineStore.ts:3155) has recorded TARGET_RAISE_EXCEEDED with
                `blocked: false` since wave 164, and R135.3 says never block — so
                nothing about the recorded outcome is touched here. What was missing
                was any path from that record to a partner's eyes: the four
                committed-writers discard the sentence the store builds, and this
                page's `onSuccess` used to take no `data` argument at all, so the
                only thing a $9,000,000-against-$5,000,000 commit produced on live
                was the toast. The route now returns the sentence
                (`targetRaise.warning`, built by the SHARED
                `spvTargetRaiseWarningSentence`) and it is rendered here.

                ALWAYS RENDERED, empty when the target was not passed — so the
                negative control is an assertion about this same element rather
                than about an absent one. NON-BLOCKING by construction: this is a
                sibling of a commit that has already SUCCEEDED, and the toast
                literal "LP committed to the cap table" is untouched beside it. */}
            <div
              className={commitTargetWarning ? "text-xs text-amber-700" : "text-xs text-[var(--cv-color-text-muted)]"}
              data-testid="partner-spv-lp-commit-target-warning"
            >
              {commitTargetWarning}
            </div>
            {/* WAVE 211 · ITEM A — draft 04 Part B5/B6, APPENDED above the existing
                button. The `disabled` expression below and its handler expression are
                untouched: wave 135's parser check and wave 211's confirmation are two
                independent conditions and neither replaces the other. */}
            <Wave211AttestationPanel
              kind="lp_commitment"
              testIdSuffix="lp-commit"
              state={w211Commit.state}
              patch={w211Commit.patch}
              complete={w211Commit.complete}
              facts={{
                kind: "lp_commitment",
                /* Null on both sides — see the invitation panel above. */
                partnerName: null,
                vehicleName: s.name,
                investorEmail: commitEmail,
                /* The whole-unit decimal string as typed. Restated, never converted:
                   this endpoint scales it server-side and showing the partner a
                   minor-unit integer would show them a figure they never entered. */
                amountRaw: commitAmount,
                amountUnit: "as_entered",
                currency: s.currency,
              }}
            />
            <Button
              /* WAVE 135 · FINDING 2 — `!commitAmount.trim()` only ever asked whether
                 the client had typed SOMETHING. It now also asks the shared parser
                 whether what they typed is an amount, which is what the refusal
                 sentence rendered above this button has been claiming all along. A
                 negative, a scientific-notation figure, an over-precise fraction and
                 zero are all refused here exactly as the notice states. No new element
                 is introduced — the sentence is already on screen from the notice at
                 the field — so no sibling shape moves and no gate sees a swap. */
              disabled={
                !commitFirst.trim() || !commitLast.trim() || !commitEmail.trim() ||
                !commitAmount.trim() || !commitUnits.trim() || commitMut.isPending ||
                !parseWholeUnits(commitAmount, s.currency, { label: "Commitment amount" }).ok
              }
              onClick={() => commitMut.mutate()}
              data-testid="partner-spv-lp-commit-submit"
            >
              {commitMut.isPending ? "Committing…" : "Commit LP"}
            </Button>
          </div>
        )}
      </Card>

      <Card className="p-4 space-y-2" data-testid="partner-spv-hash-chain">
        <div className="font-medium mb-2">Audit Receipt</div>
        {/* SC-1 — `version` and `prev_revision_hash` are NOT invented back. They
            are on neither `SpvDTO` (shared/spvEngine.ts:205-230) nor the serving
            route's payload (server/partnerRoutes.ts:1662-1668), and both rendered
            blank in production. Only verified fields are shown. What a complete
            audit receipt SHOULD carry, if these are added later, is written up in
            build_log/WAVE2_REPORT.md. */}
        {/* WAVE 95 · ITEM 2 (register M-8) — THE FULL 64-CHARACTER HASH IS NO
            LONGER RENDERED TO A PARTNER. It was: this line printed
            `s.revisionHash` verbatim, so the live page read
            "Revision fingerprint: 00e0892930df04916d2885750882fa4ea211b9561e67b4287c7c2a234d25e6d8".
            A sha256 digest is a machine value — unquotable, unreadable, and it
            tells a partner nothing (R77: banned in rendered text, allowed as a
            machine-readable value; owner Q25: no exposure of internal process).
            R44: the LABEL is accurate and owner-approved (Wave 83) so it is kept
            verbatim; only the value a human reads is shortened.
            NOTHING IS DELETED — the full digest stays on this row as
            `data-revision-hash`, so support, an integration and a test reader
            all still have the exact value; and the short reference is a
            deterministic prefix of it, so a partner quoting it identifies
            exactly one receipt. */}
        <div className="text-xs font-mono space-y-1">
          <div data-revision-hash={s.revisionHash} data-testid="partner-spv-audit-receipt-ref">
            Revision fingerprint: {auditReceiptReference(s.revisionHash) ?? "not recorded"}
          </div>
          <div>Created: {formatTimestamp(s.createdAt)}</div>
        </div>
        <div className="text-xs" data-testid="partner-spv-audit-receipt-help">
          Quote this fingerprint to Capavate support if you need this receipt checked.
        </div>
      </Card>
    </PartnerShell>
  );
}
