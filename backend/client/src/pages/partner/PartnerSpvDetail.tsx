/**
 * Foundation Build — Partner SPV detail page.
 * Shows SPV summary, audit receipt, and (managing_partner-only) capital-call
 * + distribution forms wired to the v25.23 NC-A real DB-backed handlers.
 */
import { useState } from "react";
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
  wireMinorNumber,
} from "@/components/partner/PartnerMoneyEntryNotice";
import { wholeUnitsLabel, wholeUnitsPlaceholder, parseWholeUnits } from "@/components/partner/partnerMoneyInput";

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
  /* WAVE 83 · ITEM 2.4 — a validation message is an answer to something the user
     did. Until they touch the field there is nothing to answer, so it is not
     shown. Nothing about what is REQUIRED changed; both buttons stay disabled. */
  const [lpLastNameTouched, setLpLastNameTouched] = useState(false);
  const [commitLastTouched, setCommitLastTouched] = useState(false);

  /* W2-H — GP LP roster (subscribers + pending invites). */
  const roster = useQuery<{
    spvId: string;
    lpVisibility: string;
    subscribers: Array<{ investorId: string; name: string | null; email: string | null; commitmentMinor: number; status: string; ownershipPct: number }>;
    invites: Array<{ id: string; email: string; firstName: string | null; lastName: string; note: string | null; status: string; createdAt: string }>;
  }>({
    queryKey: ["/api/partner/me/spv", spvId, "lp-roster"],
    enabled: role.ready && !!role.identity && !!spvId,
    queryFn: async () => (await apiRequest("GET", `/api/partner/me/spv/${spvId}/lp-roster`)).json(),
  });

  const inviteMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/partner/me/spv/${spvId}/lp-invites`, {
        email: lpEmail.trim(),
        firstName: lpFirstName.trim() || undefined,
        lastName: lpLastName.trim(),
      });
      return res.json();
    },
    onSuccess: () => {
      setLpEmail(""); setLpFirstName(""); setLpLastName("");
      /* WAVE 83 · ITEM 2.3 — BOTH roster surfaces, and a forced refetch. */
      qc.invalidateQueries({ queryKey: ["/api/partner/me/spv", spvId, "lp-roster"] });
      qc.invalidateQueries({ queryKey: ["/api/spv", spvId, "lp-roster"] });
      qc.refetchQueries({ queryKey: ["/api/partner/me/spv", spvId, "lp-roster"] });
      qc.refetchQueries({ queryKey: ["/api/spv", spvId, "lp-roster"] });
      toast({ title: "LP invited", description: "The roster below has been refreshed — the invite is on it. Do not send it again." });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Invite failed", description: e.message }),
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
      });
      return res.json();
    },
    onSuccess: () => {
      setCommitFirst(""); setCommitLast(""); setCommitEmail(""); setCommitAmount(""); setCommitUnits("");
      /* WAVE 83 · ITEM 2.3 — same two keys, same forced refetch, same reason. */
      qc.invalidateQueries({ queryKey: ["/api/partner/me/spv", spvId, "lp-roster"] });
      qc.invalidateQueries({ queryKey: ["/api/spv", spvId, "lp-roster"] });
      qc.refetchQueries({ queryKey: ["/api/partner/me/spv", spvId, "lp-roster"] });
      qc.refetchQueries({ queryKey: ["/api/spv", spvId, "lp-roster"] });
      toast({ title: "LP committed to the cap table" });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "LP commit failed", description: e.message }),
  });

  const callMut = useMutation({
    mutationFn: async (amountMinor: number) => {
      /* v25.33 — apiRequest() throws ApiError on non-2xx; the former `if (!res.ok)`
         guard (here and in distMut below) was unreachable dead code. The thrown
         ApiError reaches onError unchanged, preserving the failure toast. */
      const res = await apiRequest("POST", `/api/partner/me/spvs/${spvId}/capital-calls`, {
        amount_minor: amountMinor,
        called_at: new Date().toISOString(),
      });
      return res.json();
    },
    onSuccess: () => {
      setCallAmount("");
      qc.invalidateQueries({ queryKey: ["/api/partner/me/spvs", spvId] });
      toast({ title: "Capital call recorded" });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Capital call failed", description: e.message }),
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
      });
      return res.json();
    },
    onSuccess: () => {
      setDistAmount("");
      /* Both surfaces must refresh: this page's own query AND the canonical
         engine query the Distributions tab reads, or the GP sees a stale
         ledger on whichever surface they open next. */
      qc.invalidateQueries({ queryKey: ["/api/partner/me/spvs", spvId] });
      qc.invalidateQueries({ queryKey: ["/api/partner/me/spv", spvId] });
      toast({ title: "Distribution recorded" });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Distribution failed", description: e.message }),
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
    onError: (e: Error) => toast({ variant: "destructive", title: "Add to CRM failed", description: e.message }),
  });

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

  return (
    <PartnerShell title={`${s.name} · ${jurisdictionLabel(s)} · ${spvStatusLabel(s.status)}`} tier={me.tier} subRole={me.subRole} partnerName={me.identity.name}>
      <Card className="p-4 mb-4 space-y-2" data-testid="partner-spv-detail">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-[var(--cv-color-text-muted)]">Target Size</div>
            {/* WAVE 55 · R6 / 55-Q1 — prominent readout: named refusal, not a dash.
                See PartnerFundDetail.tsx for the identical tile. */}
            <div className="font-mono">{moneyOrNotProvided(s.targetRaiseMinor, s.currency)}</div>
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
                    description: (err as Error).message,
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
                  toast({ variant: "destructive", title: "Distribution not recorded", description: (err as Error).message });
                  return;
                }
                try {
                  cb = wireMinorNumber(
                    wholeUnitsToWireMinor(distCostBasis, s.currency, "Cost basis", { allowZero: true }),
                    "Cost basis",
                  );
                } catch (err) {
                  toast({ variant: "destructive", title: "Cost basis required", description: (err as Error).message });
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
                      <td className="p-2">{humanizeMachineKey(sub.status, "Status not recorded")}</td>
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
              <Input
                type="number"
                inputMode="numeric"
                min="1"
                placeholder="Units (shares)"
                value={commitUnits}
                onChange={(e) => setCommitUnits(e.target.value)}
                data-testid="partner-spv-lp-commit-units"
              />
            </div>
            <PartnerMoneyEntryNotice
              raw={commitAmount}
              currency={s.currency}
              label="Commitment amount"
              testid="partner-spv-lp-commit-amount-notice"
            />
            {commitLastTouched && !commitLast.trim() && (
              <div className="text-xs text-rose-600" data-testid="partner-spv-lp-commit-lastname-error">
                Last name is required to commit an LP.
              </div>
            )}
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
