/**
 * Foundation Build — Partner SPVs list page.
 * Read-only record-keeping (no money movement). Lists all SPVs recorded for this partner.
 */
import { useMemo, useState } from "react";
import { formatMinor as formatMinorLib } from "@/lib/currency"; /* v25.38 currency sweep */
/* WAVE 138 — the SHIPPED v1 launch attestation, imported from the one shared
   definition the server also records (`shared/spvAttestation.ts`). No new legal
   copy is authored here and no third copy of the sentence is created. */
import { ATTESTATION_TEXT_V1 } from "@shared/spvAttestation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
/* v25.12 NL7 — toast errors on create. */
import { useToast } from "@/hooks/use-toast";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { PartnerShell, PartnerEmptyState } from "@/components/partner/PartnerShell";
/* WAVE 135 · FINDING 4 — the partner money-entry contract, reused not rebuilt.
   `wireSafeMinorUnits` is gone from this screen: it was a MINOR-unit gate, and
   this field no longer carries minor units in from the client. Its refusal text
   also addressed an engineer ("ask for this field to be carried as exact text"),
   which is not a sentence to show a paying client. The file itself is outside
   this wave's ownership and is untouched; it is simply no longer called here. */
import {
  wholeUnitsLabel,
  wholeUnitsPlaceholder,
} from "@/components/partner/partnerMoneyInput";
import {
  PartnerMoneyEntryNotice,
  wholeUnitsToWireMinor,
  wireMinorNumber,
} from "@/components/partner/PartnerMoneyEntryNotice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
/* WAVE 138 — status options are labelled through the SHARED accessor, so this
   screen cannot disagree with PartnerSpvDetail / PartnerPipeline about what
   `wound_down` reads as. One rule, one implementation. */
import { spvStatusLabel } from "@/lib/partnerDisplay";
/* WAVE 165 · R130.2 / R139.4 — the ONE canonical spelling of an absent amount.
   R111 Q13 settled it as "Not on record"; this file had invented its own. */
import { NOT_ON_RECORD } from "@shared/raiseTargetWording";
/* WAVE 179 · ITEM B · R151.3 — the OPTIONAL legal form. The jurisdiction on this
   screen is free text ("Delaware"), so it is CANONICALISED through the engine's own
   resolver — the same function the server uses on the way in — before the option set
   is looked up. This is not inference of a legal form; it is agreement about which
   jurisdiction is being talked about. */
import { resolveSpvJurisdiction } from "@shared/spvEngine";
import {
  spvLegalFormOptions,
  SPV_LEGAL_FORM_LABELS,
  SPV_LEGAL_FORM_NOT_STATED_LABEL,
  SPV_LEGAL_FORM_OPTIONAL_HINT,
  SPV_LEGAL_FORM_NOT_OFFERED_NOTICE,
  SPV_LEGAL_FORM_FIELD_LABEL,
  SPV_LEGAL_FORM_UNSTATED_SENTINEL,
} from "@shared/spvLegalForm";
import { describeFailure } from "@/lib/failureMessage";

/* MAJOR 3 (WAVE 2B) — FIELD-NAME CORRECTION, sibling of SC-1.
 *
 * Wave 2 fixed the DETAIL pages (PartnerSpvDetail.tsx) but this LIST page read
 * the same fictional fields, so Review B (build_log/WAVES_012_REVIEW_B.md,
 * MAJOR 3) left every row rendering `undefined` for the name and `$0.00` for
 * the target.
 *
 * GET /api/partner/me/spvs answers
 *   res.json({ spvs: spvEngineStore.listByPartner(...) })  — partnerRoutes.ts:1595-1597
 * i.e. an array of canonical `SpvDTO` (shared/spvEngine.ts:205-230). The DTO has:
 *   name              (NOT `spvName`)               — spvEngine.ts:208
 *   targetRaiseMinor  (NOT `targetSizeMinor`, and NULLABLE) — spvEngine.ts:214
 *
 * `spvName` remains a legitimate WRITE alias on POST /api/partner/me/spvs
 * (partnerRoutes.ts:1606) and PATCH /api/partner/me/spvs/:id
 * (partnerRoutes.ts:1681). It is a write alias only and is never echoed on
 * read, so the create form below still sends `spvName` — deliberately. */
type Spv = {
  id: string;
  name: string;
  jurisdiction: string;
  targetRaiseMinor: number | null;
  currency: string;
  status: string;
};

function formatMinor(minor: number, currency: string) {
  // v25.38 — delegate to shared ISO-4217-aware formatter (2-decimal parity).
  return formatMinorLib(minor, currency, { locale: "en-US" });
}

/* WAVE 138 · DEFECT A — the four statuses this endpoint accepts, verbatim from
   its own guard (`server/partnerRoutes.ts:1830-1833`, the `validSpvStatus`
   tuple). `planned` is the draft-equivalent and is the seeded default; every
   other value stays selectable, so nothing is assumed on the partner's behalf. */
const SPV_STATUS_WIRE_VALUES = ["planned", "open", "closed", "wound_down"] as const;

/* The vintage default is COMPUTED, never a year literal: a hardcoded year is
   wrong for every client from 1 January onwards. */
function currentVintageYear(): string {
  return String(new Date().getFullYear());
}

export default function PartnerSpvs() {
  const role = useRequirePartnerRole();
  const qc = useQueryClient();
  /* WAVE 138 · DEFECT A — `vintage`, `status`, `signoffLegalName` and
     `signoffAccepted` are now part of the form because the server REQUIRES them
     (`server/partnerRoutes.ts:1827` and `:1834-1836`); without them this screen
     could only ever 400. Each has a visible, editable control below — no value
     is smuggled into the payload as a hidden constant. */
  const [form, setForm] = useState({
    spvName: "",
    jurisdiction: "Delaware",
    /* WAVE 179 · ITEM B · R151.3 — OPTIONAL and DEFAULTS TO NOT STATED. A vehicle
       created without touching this control records no legal form at all, and every
       tax surface then renders wave 175's conditional wording exactly as before. */
    legalForm: SPV_LEGAL_FORM_UNSTATED_SENTINEL,
    vintage: currentVintageYear(),
    status: "planned",
    targetSizeMinor: "0",
    currency: "USD",
    signoffLegalName: "",
    signoffAccepted: false,
  });
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading, isError } = useQuery<{ spvs: Spv[] }>({
    /* v25.12 NL1 — explicit queryFn for robustness. */
    /* v25.15 NM6 — isError surfaced for explicit error UI. */
    queryKey: ["/api/partner/me/spvs"],
    enabled: role.ready && !!role.identity,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/spvs")).json(),
  });

  /* v25.12 NL7 — toast helper. */
  const { toast } = useToast();

  const create = useMutation({
    mutationFn: async () => {
      /* v25.33 — apiRequest() throws ApiError on non-2xx; the former `if (!res.ok)`
         guard was unreachable dead code. The thrown ApiError reaches onError
         unchanged, preserving the "Create SPV failed" toast. */
      /* WAVE 100 · ITEM 3 (R72) — `parseInt(form.targetSizeMinor, 10)` was here, and
         it destroyed a minor unit above 2^53 on a money field. WAVE 135 · FINDING 4
         goes further: the client now types the amount it MEANS, in whole currency
         units, and the exact minor-unit integer is produced by string surgery in
         `parseWholeUnits` (BigInt applied once, to digits). The WIRE IS UNCHANGED —
         `targetSizeMinor` is still an integer count of minor units, and
         `wireMinorNumber` widens it only after proving it is digits-only and a safe
         integer, because this endpoint's guard is `isNumber(targetSizeMinor)`
         (server/partnerRoutes.ts:180, :1987 on the sibling fund route).

         `allowZero` is TRUE here and deliberately so: an SPV is legitimately
         recorded before a target raise is set, and the seeded value below is "0".
         Zero is the one figure that reads identically in both units, which is why
         the seed needed no migration when the units changed.

         A refusal is now a SENTENCE thrown from the shared parser, not the raw
         constant `TARGET_SIZE_NOT_EXACTLY_REPRESENTABLE` interpolated into a toast
         description, which is a machine value reaching a human eye (R77). */
      const targetSizeMinor = wireMinorNumber(
        wholeUnitsToWireMinor(form.targetSizeMinor, form.currency, "Target size", { allowZero: true }),
        "Target size",
      );
      /* WAVE 179 · ITEM B — derived HERE, from the jurisdiction as it stands at
         submit time, using the same shared validator the picker uses. A form that
         does not belong to the typed jurisdiction is sent as `null`, i.e. NOT STATED,
         and is never translated into that jurisdiction's nearest equivalent. */
      const legalFormChoicesAtSubmit = spvLegalFormOptions(resolveSpvJurisdiction(form.jurisdiction));
      const legalFormForWire = legalFormChoicesAtSubmit.includes(form.legalForm as never)
        ? form.legalForm
        : null;
      const res = await apiRequest("POST", "/api/partner/me/spvs", {
        spvName: form.spvName,
        jurisdiction: form.jurisdiction,
        /* WAVE 138 — `vintage` is the key the server reads (`:1826` destructure,
           `isNumber` at `:1827`). `parseInt` is correct HERE and is NOT a money
           conversion: this is a four-digit calendar YEAR. The money field above
           keeps its exact-integer `wholeUnitsToWireMinor` path, untouched. */
        vintage: parseInt(form.vintage, 10),
        status: form.status,
        targetSizeMinor,
        currency: form.currency,
        /* The sign-off gate is KEPT, not weakened — these two are what the server
           records as a durable authorization (`:1834-1836`, then `recordSignoff`
           BEFORE the SPV exists). The client now satisfies it instead of
           tripping over it. */
        signoffLegalName: form.signoffLegalName,
        signoffAccepted: form.signoffAccepted,
        /* WAVE 179 · ITEM B · R151.3 — OPTIONAL, and `null` unless a human picked a
           value. The sentinel never travels; nothing is inferred from the name,
           the jurisdiction or the status. */
        legalForm: legalFormForWire,
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/partner/me/spvs"] });
      setForm({
        spvName: "",
        jurisdiction: "Delaware",
        vintage: currentVintageYear(),
        status: "planned",
        targetSizeMinor: "0",
        currency: "USD",
        legalForm: SPV_LEGAL_FORM_UNSTATED_SENTINEL, /* WAVE 179 · ITEM B — back to not stated */
        /* Assent is per-SPV and is never carried over to the next one. */
        signoffLegalName: "",
        signoffAccepted: false,
      });
      setShowForm(false);
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Create SPV failed", description: describeFailure(e, "write") }),
  });

  /* WAVE 138 · DEFECT A, associate case — the route is
     `assertSubRole("managing_partner")` ONLY (`server/partnerRoutes.ts:1814`), so
     an associate's click could only ever return 403
     PARTNER_SUB_ROLE_INSUFFICIENT (`server/lib/requirePartnerAuth.ts:133`) before
     the body was even read. Nothing is shut off and no control is deleted: the
     form stays visible, the submit is disabled, and the REASON is stated in a
     plain sentence. Hoisted into `useMemo` so the note is ONE always-rendered
     sibling and the sibling shape does not move (W116 §3.1). */
  const spvRoleNote = useMemo(
    () =>
      role.identity && role.identity.subRole !== "managing_partner"
        ? "Recording an SPV requires a managing partner. Ask a managing partner at your firm to complete the sign-off, or ask them to change your role."
        : "",
    [role.identity],
  );

  /* WAVE 179 · ITEM B — the options for the jurisdiction as typed, canonicalised.
     EMPTY for the nine jurisdictions wave 175 found are not legal-form dependent,
     and empty for a jurisdiction string the engine cannot resolve at all — in both
     cases the picker is not offered and the reason is stated instead. */
  const spvLegalFormChoices = spvLegalFormOptions(resolveSpvJurisdiction(form.jurisdiction));
  /* WAVE 179 · ITEM B — the form as it applies to the jurisdiction CURRENTLY typed.
     Derived rather than cleared on keystroke: a form stated for Singapore and then
     re-pointed at Delaware is not carried over and is not re-mapped to Delaware's
     nearest equivalent — it simply reads, and is sent, as NOT STATED. Used both for
     the picker's value and for the request body, so the screen and the wire cannot
     disagree, and the server validates it a third time against the persisted
     jurisdiction regardless. */
  const effectiveLegalForm = spvLegalFormChoices.includes(form.legalForm as never)
    ? form.legalForm
    : SPV_LEGAL_FORM_UNSTATED_SENTINEL;

  if (!role.ready || !role.identity) return null;
  const me = role.identity;
  const canWrite = me.subRole === "managing_partner" || me.subRole === "associate";
  /* Only a managing partner can complete the server's sign-off gate. */
  const canSignOff = me.subRole === "managing_partner";
  const spvs = data?.spvs ?? [];

  return (
    <PartnerShell title="SPVs" tier={me.tier} subRole={me.subRole} partnerName={me.identity.name}>
      <div className="mb-4 bg-[rgba(4,30,65,0.05)] border border-[rgba(4,30,65,0.2)] text-[var(--cv-color-navy)] p-3 rounded text-sm" data-testid="partner-spvs-disclaimer">
        SPV records are for documentation only. No funds are moved by Capavate.
      </div>

      {canWrite && (
        <div className="mb-4">
          <Button
            onClick={() => setShowForm(!showForm)}
            data-testid="partner-spvs-new-toggle"
          >
            {showForm ? "Cancel" : "Record New SPV"}
          </Button>
        </div>
      )}

      {showForm && canWrite && (
        <Card className="p-4 mb-4 space-y-3" data-testid="partner-spvs-new-form">
          <div>
            <Label>SPV Name</Label>
            <Input value={form.spvName} onChange={(e) => setForm({ ...form, spvName: e.target.value })} data-testid="partner-spv-name" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Jurisdiction</Label>
              {/* WAVE 179 · ITEM B — THIS HANDLER IS UNTOUCHED, byte-verbatim. An
                  earlier draft of this wave rewrote it to clear the legal form when the
                  jurisdiction was retyped; the silent-drop guard correctly read that as
                  a REMOVED `onChange` expression, and an allow-list entry was not an
                  option. The same guarantee is now obtained WITHOUT touching this
                  control, by validating the selected form against the current
                  jurisdiction at the two boundaries that matter — see
                  `effectiveLegalForm` below. */}
              <Input value={form.jurisdiction} onChange={(e) => setForm({ ...form, jurisdiction: e.target.value })} data-testid="partner-spv-jurisdiction" />
            </div>
            <div>
              {/* WAVE 135 · FINDING 4 — the label asked the client for "minor units",
                  which is our storage vocabulary, not their money. `type="text"` with
                  `inputMode="decimal"` because a person writes "5,000,000" and a number
                  input silently discards separators it dislikes; the parser refuses, in
                  a sentence, under the field. The notice is ONE always-rendered sibling
                  (build_log/wave116/W116_TESTS.md §3.1), so this cell's child shape does
                  not move and the silent-drop gate sees no swap.

                  WHY THE VISIBLE LABEL IS LITERAL TEXT AND THE CURRENCY-AWARE LABEL IS
                  THE `aria-label`. Writing the whole label as `{wholeUnitsLabel(…)}` was
                  the first attempt and `npm run drop:restyle` FAILED it — two bare
                  disappearances, one here and one on the sibling fund screen: the old
                  literal text vanished from the copy inventory and nothing literal
                  replaced it, which the detector cannot distinguish from a label being
                  deleted. That detector has no ratification path for a text drop (its
                  allowlists cover statically-dead regions and dead controls only), and
                  its baseline is not this wave's to re-emit. So the change was made
                  VISIBLE to the gate instead of hidden from it: literal prose here, the
                  shared currency-aware helper on the `aria-label`, exactly as wave 128
                  did on the capital-call field. One format, one helper, still no second
                  implementation — and a screen-reader user gets MORE than before, not
                  less. A sighted client reads the currency two ways regardless: the
                  placeholder is currency-shaped and the notice under the field states
                  the recorded amount with its code. */}
              <Label>Target size</Label>
              {/* WAVE 165 · R130.2 / R139.4 — the field that AUTHORS the number said
                  nothing about it. Added beneath the label as a sibling text node. */}
              <div className="text-[10px] text-[var(--cv-color-text-muted)]" data-testid="partner-spv-target-input-is-a-goal">
                The fundraising goal for this vehicle, not a limit. Commitments may exceed it and are
                never refused for doing so. A separate cap, if you set one, is the maximum.
              </div>
              <Input
                type="text"
                inputMode="decimal"
                placeholder={wholeUnitsPlaceholder(form.currency)}
                aria-label={wholeUnitsLabel("Target size", form.currency)}
                value={form.targetSizeMinor}
                onChange={(e) => setForm({ ...form, targetSizeMinor: e.target.value })}
                data-testid="partner-spv-target"
              />
              <PartnerMoneyEntryNotice
                raw={form.targetSizeMinor}
                currency={form.currency}
                label="Target size"
                testid="partner-spv-target-notice"
              />
            </div>
            <div>
              <Label>Currency (ISO 4217)</Label>
              <Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} maxLength={3} data-testid="partner-spv-currency" />
            </div>
          </div>
          {/* WAVE 138 · DEFECT A — `vintage` and `status` are REQUIRED by the
              server and were never collected. Both are rendered as real controls
              with their defaults visible (current calendar year; `planned`, the
              draft-equivalent), so a partner sees and can change every value
              that will be recorded. */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Vintage year</Label>
              <Input
                type="number"
                value={form.vintage}
                onChange={(e) => setForm({ ...form, vintage: e.target.value })}
                data-testid="partner-spv-vintage"
              />
            </div>
            <div>
              <Label>Status</Label>
              <select
                className="w-full border rounded h-9 px-2"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                data-testid="partner-spv-status"
              >
                {SPV_STATUS_WIRE_VALUES.map((s) => (
                  <option key={s} value={s}>{spvStatusLabel(s)}</option>
                ))}
              </select>
            </div>
          </div>

          {/* WAVE 138 — the sign-off gate the server has always enforced on this
              route, now actually presented. Same contract as the SPV Engine
              wizard (`PartnerSpvEngine.tsx`): typed full legal name + explicit
              assent to the SHIPPED v1 attestation, imported from the one shared
              definition the server records. Nothing here is newly authored. */}
          <div className="rounded-md border p-3 space-y-2" data-testid="partner-spv-signoff">
            <div className="font-medium">Authorized sign-off (required)</div>
            <div>
              <Label>Full legal name *</Label>
              <Input
                value={form.signoffLegalName}
                onChange={(e) => setForm({ ...form, signoffLegalName: e.target.value })}
                placeholder="Type your full legal name"
                data-testid="partner-spv-signoff-legalname"
              />
            </div>
            <label className="flex items-start gap-2 cursor-pointer" htmlFor="partner-spv-signoff-accept">
              <input
                id="partner-spv-signoff-accept"
                type="checkbox"
                className="mt-1"
                data-testid="partner-spv-signoff-accept"
                checked={form.signoffAccepted}
                onChange={(e) => setForm({ ...form, signoffAccepted: e.target.checked })}
              />
              <span className="text-xs text-[var(--cv-color-text-secondary)]" data-testid="partner-spv-attestation-text">{ATTESTATION_TEXT_V1}</span>
            </label>
            <div className="text-[10px] text-[var(--cv-color-text-faint)]">Your name, assent, and a UTC timestamp are recorded for audit (ESIGN/UETA).</div>
          </div>
          {/* ══ WAVE 179 · ITEM B · R151.3 — the OPTIONAL legal form ════════════
              ADDITIVE BLOCK inserted between two existing siblings. Neither the
              sign-off card above nor the role note below is altered, and no existing
              literal or placeholder is reworded (R143.1).

              Both branches always render one node, so the sibling shape does not move
              with the jurisdiction: either the picker, or the sentence explaining that
              this jurisdiction has no legal-form-dependent treatment to state. */}
          <div data-testid="partner-spv-legal-form-block">
            {spvLegalFormChoices.length > 0 ? (
              <div className="space-y-1" data-testid="partner-spv-legal-form-field">
                <Label>{SPV_LEGAL_FORM_FIELD_LABEL}</Label>
                <select
                  value={effectiveLegalForm}
                  onChange={(e) => setForm({ ...form, legalForm: e.target.value })}
                  className="w-full rounded-md border border-[var(--cv-color-border)] px-3 py-2 text-sm"
                  data-testid="partner-spv-legal-form"
                >
                  <option value={SPV_LEGAL_FORM_UNSTATED_SENTINEL}>{SPV_LEGAL_FORM_NOT_STATED_LABEL}</option>
                  {spvLegalFormChoices.map((lf) => (
                    <option key={lf} value={lf}>{SPV_LEGAL_FORM_LABELS[lf]}</option>
                  ))}
                </select>
                <div className="text-[10px] text-[var(--cv-color-text-muted)]" data-testid="partner-spv-legal-form-hint">
                  {SPV_LEGAL_FORM_OPTIONAL_HINT}
                </div>
              </div>
            ) : (
              <div className="text-[10px] text-[var(--cv-color-text-muted)]" data-testid="partner-spv-legal-form-not-offered">
                {SPV_LEGAL_FORM_NOT_OFFERED_NOTICE}
              </div>
            )}
          </div>

          <div className="text-xs text-rose-700" data-testid="partner-spv-role-note">{spvRoleNote}</div>
          <Button
            onClick={() => create.mutate()}
            disabled={!form.spvName.trim() || !form.signoffLegalName.trim() || !form.signoffAccepted || !canSignOff || create.isPending}
            data-testid="partner-spvs-create"
          >
            {create.isPending ? "Recording…" : "Record SPV"}
          </Button>
          {create.error && <div className="text-sm text-red-600">{(create.error as Error).message}</div>}
        </Card>
      )}

      {isLoading && <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="spvs-loading">Loading…</div>}
      {/* v25.15 NM6 — explicit error branch. */}
      {isError && (
        <div
          className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"
          data-testid="spvs-error"
        >
          Could not load SPVs. Please refresh and try again.
        </div>
      )}
      {!isLoading && !isError && spvs.length === 0 && (
        <PartnerEmptyState
          title="No SPVs recorded yet"
          description="Record an SPV to keep documentation in one place."
        />
      )}

      {spvs.length > 0 && (
        <div className="space-y-2" data-testid="partner-spvs-list">
          {spvs.map((s) => (
            <Card key={s.id} className="p-3" data-testid={`partner-spv-${s.id}`}>
              <Link href={`/collective/partner/spvs/${s.id}`} className="block hover:bg-[var(--cv-color-surface-2)] -m-3 p-3 rounded">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-[var(--cv-color-text-muted)]">{s.jurisdiction} · {s.status}</div>
                  </div>
                  <div className="text-right">
                    {/* MAJOR 3 — `targetRaiseMinor` is nullable on the DTO; an
                        unset target must read as "—", never as $0.00.
                        WAVE 164 · R130.2 (S6) — the dash is now words: a reader
                        cannot tell "unset" from "zero" from "not loaded" otherwise,
                        and a target of zero is a real target. */}
                    <div className="font-mono">
                      {s.targetRaiseMinor === null || s.targetRaiseMinor === undefined
                        ? NOT_ON_RECORD
                        : formatMinor(s.targetRaiseMinor, s.currency)}
                    </div>
                    {/* WAVE 164 · R130.2 (S6) — the cap is the maximum; this is not. */}
                    <div className="text-xs text-[var(--cv-color-text-muted)]">target</div>
                    <div className="text-[10px] text-[var(--cv-color-text-muted)]">fundraising goal, not a limit</div>
                  </div>
                </div>
              </Link>
            </Card>
          ))}
        </div>
      )}
    </PartnerShell>
  );
}
