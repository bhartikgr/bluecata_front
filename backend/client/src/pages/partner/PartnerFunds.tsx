/**
 * Foundation Build — Partner Funds list page.
 * Read-only record-keeping for fund commitments. No money movement.
 */
import { useMemo, useState } from "react";
import { formatMinor as formatMinorLib } from "@/lib/currency"; /* v25.38 currency sweep */
/* WAVE 150 · R111 Q11 — the ONE shipped attestation, the same constant the
   server records verbatim (`server/spvLaunchSignoffStore.ts` re-exports it and
   writes it as `attestationText`). Imported, never retyped: no new legal copy is
   authored by this wave, and the text a managing partner reads is byte-identical
   to the text the platform stores. Same import the sibling SPV screen uses
   (`PartnerSpvs.tsx:10`). */
/* WAVE 169 · R77 — this page can only create a FUND, and it was rendering v1's
   "special-purpose vehicle" wording. It now resolves the fund wording from the
   same shared authority the fund create route records
   (`server/partnerRoutes.ts` passes `spvType: "fund"` to `recordSignoff`), so the
   sentence signed here and the sentence stored are the same bytes. */
import { attestationTextForType } from "@shared/spvAttestation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
/* v25.12 NL7 — toast errors in addition to the inline display for consistency
 * with other partner mutations. */
import { useToast } from "@/hooks/use-toast";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { PartnerShell, PartnerEmptyState } from "@/components/partner/PartnerShell";
/* WAVE 135 · FINDING 4 — the partner money-entry contract, reused not rebuilt.
   Same change as the sibling SPV screen, and for the same reason: this field no
   longer carries minor units in from the client, so a minor-unit gate is the
   wrong instrument. `client/src/lib/wireSafeMinorUnits.ts` is untouched (outside
   this wave's ownership) and merely uncalled here. */
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

/* WAVE 115 · FINDING 1 (L8) — the fund status reached the list raw. The two
   literal branches stay two literal branches (see the note above them about the
   guard inventory); only the interpolated expression moved. */
/* WAVE 138 — `humanizeMachineKey` labels the fund-type options through the same
   shared accessor, so `closed_end` never reaches a client's eye raw. */
import { fundStatusLabel, humanizeMachineKey } from "@/lib/partnerDisplay";
/* WAVE 165 · R130.2 / R139.4 — the ONE canonical spelling of an absent amount.
   R111 Q13 settled it as "Not on record"; this file had invented its own. */
import { NOT_ON_RECORD } from "@shared/raiseTargetWording";
/* WAVE 170 — R77: a refusal reaching a paying client is a plain sentence with a
   next step, or a traceable reference; never whatever string arrived. */
import { partnerActionRefusalText } from "@/lib/serverRefusalMessage";
/* MAJOR 3 (WAVE 2B) — FIELD-NAME CORRECTION, sibling of the SC-1 fix applied to
 * PartnerFundDetail.tsx in Wave 2.
 *
 * GET /api/partner/me/funds answers
 *   res.json({ funds: spvEngineStore.listByPartner(...).filter(spvType==="fund") })
 *                                       — server/partnerRoutes.ts:1736-1739
 * so every element is a canonical `SpvDTO` (shared/spvEngine.ts:205-230), NOT a
 * bespoke fund record. Three of the four fields read here did not exist:
 *   fundName        → DTO field is `name`                    (spvEngine.ts:208)
 *   targetSizeMinor → DTO field is `targetRaiseMinor`, NULLABLE (spvEngine.ts:214)
 *   vintageYear     → not a DTO field at all. The fund shim stores the vintage
 *                     inside the `terms` JSON blob it writes on create
 *                     (server/partnerRoutes.ts:1771 — `terms: { … vintage … }`),
 *                     which is exactly where PartnerFundDetail.tsx reads it.
 *
 * `fundName` and `targetSizeMinor` remain legitimate WRITE aliases on
 * POST /api/partner/me/funds (partnerRoutes.ts:1747) and PATCH .../funds/:id
 * (partnerRoutes.ts:1798-1799). They are write aliases only and are never echoed
 * on read, so the create form below still sends them — deliberately. */
type Fund = {
  id: string;
  name: string;
  targetRaiseMinor: number | null;
  currency: string;
  status: string;
  /** Fund-specific values (incl. `vintage`) live in the shim's `terms` blob. */
  terms: Record<string, unknown> | null;
};

/** `terms` is `Record<string, unknown>`; render defensively.
 *  Mirrors `termsValue` in PartnerFundDetail.tsx. */
function termsValue(terms: Record<string, unknown> | null, key: string): string | null {
  const v = terms?.[key];
  return typeof v === "string" || typeof v === "number" ? String(v) : null;
}

function formatMinor(minor: number, currency: string) {
  // v25.38 — delegate to shared ISO-4217-aware formatter (2-decimal parity).
  return formatMinorLib(minor, currency, { locale: "en-US" });
}

/* WAVE 138 · DEFECT B — the two enums this endpoint accepts, verbatim from its
   own guards (`server/partnerRoutes.ts:1975` / `:1976`). `fundType` deliberately
   has NO default: it materially changes the vehicle, so an assumed value would
   be a business assumption made on the partner's behalf. `planning` is the first
   state of the status enum and is the visible, editable seed. */
const FUND_TYPE_WIRE_VALUES = ["evergreen", "closed_end", "rolling"] as const;
const FUND_STATUS_WIRE_VALUES = ["planning", "raising", "investing", "harvesting", "wound_down"] as const;

/* Computed, never a year literal — `"2026"` was hardcoded here and would be
   wrong for every client from 1 January onwards. */
function currentVintageYear(): string {
  return String(new Date().getFullYear());
}

export default function PartnerFunds() {
  const role = useRequirePartnerRole();
  const qc = useQueryClient();
  /* WAVE 138 · DEFECT B — the state key was `vintageYear`, which this file's own
     header comment (`:48`) already recorded as "not a DTO field at all"; the
     server reads `vintage` (`server/partnerRoutes.ts:1971`), so the value arrived
     `undefined` and `isNumber` failed on every call. `fundType`, `jurisdiction`
     and `status` were never collected at all. All four now have visible,
     editable controls. */
  const [form, setForm] = useState({
    fundName: "",
    fundType: "",
    jurisdiction: "Delaware",
    /* The local state key stays `vintageYear` deliberately: renaming it would
       rewrite this field's `onChange` expression, which the silent-drop guard
       inventories by hash, and a rename is not worth a drop-gate waiver. The
       DEFECT was never the local name — it was that the local name was put ON
       THE WIRE. The payload below sends `vintage`, the key the server reads. */
    vintageYear: currentVintageYear(),
    status: "planning",
    targetSizeMinor: "0",
    currency: "USD",
    /* WAVE 150 — the server now REQUIRES both
       (`server/partnerRoutes.ts:2021-2024`); each has a visible, editable
       control below and neither is smuggled in as a hidden constant. */
    signoffLegalName: "",
    signoffAccepted: false,
  });
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading, isError } = useQuery<{ funds: Fund[] }>({
    /* v25.12 NL1 — explicit queryFn for robustness; previously relied on the
     * global default which would silently break if the queryKey ever becomes
     * multi-element. */
    /* v25.15 NM7 — isError surfaced for explicit error UI. */
    queryKey: ["/api/partner/me/funds"],
    enabled: role.ready && !!role.identity,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/funds")).json(),
  });

  /* v25.12 NL7 — toast helper. */
  const { toast } = useToast();

  const create = useMutation({
    mutationFn: async () => {
      /* WAVE 100 · ITEM 3 (R72) — checked BEFORE the request is built, by the same
         shared helper the SPV screen uses. One rule, one implementation (R21).

         WAVE 135 · FINDING 4 — the shared helper is now the whole-currency-unit
         parser, still one rule and one implementation across both screens. This
         field's units matter MORE than the SPV screen's, because unlike that one
         this payload is actually persisted: `targetRaiseMinor: isNumber(
         targetSizeMinor) ? targetSizeMinor : null` (server/partnerRoutes.ts:1987).
         A client typing five million and getting fifty thousand recorded was a
         stored 100× error, not a display one. `allowZero: true` because the
         seeded value is "0" and a fund may be recorded before its target is set. */
      const fundTargetSizeMinor = wireMinorNumber(
        wholeUnitsToWireMinor(form.targetSizeMinor, form.currency, "Target size", { allowZero: true }),
        "Target size",
      );
      /* v25.33 — apiRequest() throws ApiError on non-2xx; the former `if (!res.ok)`
         guard was unreachable dead code. The thrown ApiError reaches onError
         unchanged, preserving the "Create fund failed" toast. */
      const res = await apiRequest("POST", "/api/partner/me/funds", {
        fundName: form.fundName,
        fundType: form.fundType,
        jurisdiction: form.jurisdiction,
        status: form.status,
        /* WAVE 138 — renamed to the key the server actually reads. `parseInt` is
           correct HERE and is NOT money: this is a four-digit calendar YEAR. The
           money field below keeps its exact-integer `wholeUnitsToWireMinor`
           path, untouched. */
        vintage: parseInt(form.vintageYear, 10),
        /* WAVE 100 · ITEM 3 (R72) — `parseInt(form.targetSizeMinor, 10)` was here.
           The SAME defect as `PartnerSpvs.tsx` and, unlike that screen, this payload
           does persist: `POST /api/partner/me/funds` writes `targetRaiseMinor`
           (`server/partnerRoutes.ts:1987`). Checked, not narrowed. WAVE 135 — and now
           scaled exactly from what the client meant, with the wire unit unchanged. */
        targetSizeMinor: fundTargetSizeMinor,
        currency: form.currency,
        /* WAVE 150 · R111 Q11 — the two fields the server records as a durable
           authorization BEFORE the fund exists (`recordSignoff` at
           `server/partnerRoutes.ts:2027`, then `linkSignoffToSpv` at `:2063`).
           Same wire keys as the SPV path. */
        signoffLegalName: form.signoffLegalName,
        signoffAccepted: form.signoffAccepted,
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/partner/me/funds"] });
      setForm({
        fundName: "",
        fundType: "",
        jurisdiction: "Delaware",
        vintageYear: currentVintageYear(),
        status: "planning",
        targetSizeMinor: "0",
        currency: "USD",
        /* Assent is per-fund and is never carried over to the next one. */
        signoffLegalName: "",
        signoffAccepted: false,
      });
      setShowForm(false);
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Create fund failed", description: partnerActionRefusalText(e) }),
  });

  /* WAVE 150 · R111 Q11 — an associate could create funds until this wave and
     can no longer. That is a DELIBERATE access removal by owner ruling, so it is
     SURFACED rather than silently failing: the form and the submit control stay
     visible, the submit is disabled, and the REASON is stated in a plain
     sentence. Nothing is deleted. Hoisted into `useMemo` so the note is ONE
     always-rendered sibling and the sibling shape does not move (W116 §3.1) —
     replacing sibling JSX with a conditional would trip the drop gate. Mirrors
     `spvRoleNote` in PartnerSpvs.tsx. */
  const fundRoleNote = useMemo(
    () =>
      role.identity && role.identity.subRole !== "managing_partner"
        ? "Recording a fund requires a managing partner. Ask a managing partner at your firm to complete the sign-off, or ask them to change your role."
        : "",
    [role.identity],
  );

  if (!role.ready || !role.identity) return null;
  const me = role.identity;
  const canWrite = me.subRole === "managing_partner" || me.subRole === "associate";
  /* Only a managing partner can complete the server's sign-off gate
     (`assertSubRole("managing_partner")`, server/partnerRoutes.ts:1987). */
  const canSignOff = me.subRole === "managing_partner";
  const funds = data?.funds ?? [];

  return (
    <PartnerShell title="Funds" tier={me.tier} subRole={me.subRole} partnerName={me.identity.name}>
      <div className="mb-4 bg-[rgba(4,30,65,0.05)] border border-[rgba(4,30,65,0.2)] text-[var(--cv-color-navy)] p-3 rounded text-sm" data-testid="partner-funds-disclaimer">
        Fund records are for documentation only. No funds are moved by Capavate.
      </div>

      {canWrite && (
        <div className="mb-4">
          <Button onClick={() => setShowForm(!showForm)} data-testid="partner-funds-new-toggle">
            {showForm ? "Cancel" : "Record New Fund"}
          </Button>
        </div>
      )}

      {showForm && canWrite && (
        <Card className="p-4 mb-4 space-y-3" data-testid="partner-funds-new-form">
          <div>
            <Label>Fund Name</Label>
            <Input value={form.fundName} onChange={(e) => setForm({ ...form, fundName: e.target.value })} data-testid="partner-fund-name" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Vintage Year</Label>
              <Input type="number" value={form.vintageYear} onChange={(e) => setForm({ ...form, vintageYear: e.target.value })} data-testid="partner-fund-vintage" />
            </div>
            <div>
              {/* WAVE 135 · FINDING 4 — see the sibling comment in PartnerSpvs.tsx.
                  `type="text"` + `inputMode="decimal"`; the notice is ONE
                  always-rendered sibling (W116 §3.1) so the child shape is stable.
                  Literal label + `aria-label` from the shared helper, for the
                  drop-detector reason written out in full on PartnerSpvs.tsx. */}
              <Label>Target size</Label>
              {/* WAVE 165 · R130.2 / R139.4 — see the sibling note in PartnerSpvs.tsx.
                  A fund's target is a goal on exactly the same terms as an SPV's. */}
              <div className="text-[10px] text-[var(--cv-color-text-muted)]" data-testid="partner-fund-target-input-is-a-goal">
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
                data-testid="partner-fund-target"
              />
              <PartnerMoneyEntryNotice
                raw={form.targetSizeMinor}
                currency={form.currency}
                label="Target size"
                testid="partner-fund-target-notice"
              />
            </div>
            <div>
              <Label>Currency (ISO 4217)</Label>
              <Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} maxLength={3} data-testid="partner-fund-currency" />
            </div>
          </div>
          {/* WAVE 138 · DEFECT B — `fundType`, `jurisdiction` and `status` are
              REQUIRED by the server and were never collected. `fundType` opens
              UNSET so the partner chooses the vehicle; the submit stays disabled
              until they do. */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Fund type *</Label>
              <select
                className="w-full border rounded h-9 px-2"
                value={form.fundType}
                onChange={(e) => setForm({ ...form, fundType: e.target.value })}
                data-testid="partner-fund-type"
              >
                <option value="">Select a fund type…</option>
                {FUND_TYPE_WIRE_VALUES.map((t) => (
                  <option key={t} value={t}>{humanizeMachineKey(t)}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Jurisdiction</Label>
              <Input
                value={form.jurisdiction}
                onChange={(e) => setForm({ ...form, jurisdiction: e.target.value })}
                data-testid="partner-fund-jurisdiction"
              />
            </div>
            <div>
              <Label>Status</Label>
              <select
                className="w-full border rounded h-9 px-2"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                data-testid="partner-fund-status"
              >
                {FUND_STATUS_WIRE_VALUES.map((s) => (
                  <option key={s} value={s}>{fundStatusLabel(s)}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="text-xs text-[var(--cv-color-text-muted)]" data-testid="partner-fund-type-note">
            {form.fundType ? "" : "Choose a fund type to record this fund. It changes the vehicle, so it is never assumed for you."}
          </div>
          {/* WAVE 150 · R111 Q11 — the same sign-off block the SPV screen already
              renders (PartnerSpvs.tsx:314-337), same shape, same shared text
              constant. Nothing here is newly authored legal copy. */}
          <div className="rounded-md border p-3 space-y-2" data-testid="partner-fund-signoff">
            <div className="font-medium">Authorized sign-off (required)</div>
            <div>
              <Label>Full legal name *</Label>
              <Input
                value={form.signoffLegalName}
                onChange={(e) => setForm({ ...form, signoffLegalName: e.target.value })}
                placeholder="Type your full legal name"
                data-testid="partner-fund-signoff-legalname"
              />
            </div>
            <label className="flex items-start gap-2 cursor-pointer" htmlFor="partner-fund-signoff-accept">
              <input
                id="partner-fund-signoff-accept"
                type="checkbox"
                className="mt-1"
                data-testid="partner-fund-signoff-accept"
                checked={form.signoffAccepted}
                onChange={(e) => setForm({ ...form, signoffAccepted: e.target.checked })}
              />
              <span className="text-xs text-[var(--cv-color-text-secondary)]" data-testid="partner-fund-attestation-text">{attestationTextForType("fund")}</span>
            </label>
            <div className="text-[10px] text-[var(--cv-color-text-faint)]">Your name, assent, and a UTC timestamp are recorded for audit (ESIGN/UETA).</div>
          </div>
          <div className="text-xs text-rose-700" data-testid="partner-fund-role-note">{fundRoleNote}</div>
          <Button
            onClick={() => create.mutate()}
            disabled={!form.fundName.trim() || !form.fundType || !form.signoffLegalName.trim() || !form.signoffAccepted || !canSignOff || create.isPending}
            data-testid="partner-funds-create"
          >
            {create.isPending ? "Recording…" : "Record Fund"}
          </Button>
          {create.error && <div className="text-sm text-red-600">{(create.error as Error).message}</div>}
        </Card>
      )}

      {isLoading && <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="funds-loading">Loading…</div>}
      {/* v25.15 NM7 — explicit error branch. */}
      {isError && (
        <div
          className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"
          data-testid="funds-error"
        >
          Could not load funds. Please refresh and try again.
        </div>
      )}
      {!isLoading && !isError && funds.length === 0 && (
        <PartnerEmptyState
          title="No funds recorded yet"
          description="Record a fund to document commitments."
        />
      )}

      {funds.length > 0 && (
        <div className="space-y-2" data-testid="partner-funds-list">
          {funds.map((f) => (
            <Card key={f.id} className="p-3" data-testid={`partner-fund-${f.id}`}>
              <Link href={`/collective/partner/funds/${f.id}`} className="block hover:bg-[var(--cv-color-surface-2)] -m-3 p-3 rounded">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="font-medium">{f.name}</div>
                    <div className="text-xs text-[var(--cv-color-text-muted)]">
                      {/* MAJOR 3 — vintage comes from `terms`, and a fund created
                          without one must not render "Vintage undefined". */}
                      {/* Kept as literal JSX text (not a template string) so the
                          "Vintage" copy string stays in the guard inventory. */}
                      {termsValue(f.terms, "vintage") ? (
                        <>
                          Vintage {termsValue(f.terms, "vintage")} · {fundStatusLabel(f.status)}
                        </>
                      ) : (
                        fundStatusLabel(f.status)
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    {/* MAJOR 3 — nullable target must read as "—", never $0.00.
                        WAVE 164 · R130.2 (S5) — and a bare dash does not say WHICH
                        of "unset", "zero" or "unknown" it means, so the absence is
                        named in words instead. */}
                    <div className="font-mono">
                      {f.targetRaiseMinor === null || f.targetRaiseMinor === undefined
                        ? NOT_ON_RECORD
                        : formatMinor(f.targetRaiseMinor, f.currency)}
                    </div>
                    {/* WAVE 164 · R130.2 (S5) — "target" alone read as a limit on the
                        list, which is the misreading that started this. */}
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
