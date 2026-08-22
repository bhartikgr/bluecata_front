/**
 * Foundation Build — Partner Fund detail page.
 * Read-only fund record with commitment ledger and audit receipt.
 */
import { useState } from "react";
import { formatMinor as formatMinorLib } from "@/lib/currency"; /* v25.38 currency sweep */
import { moneyOrNotProvided } from "@/lib/moneyDisplay"; /* WAVE 55 · R6 */
import { useRoute } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { PartnerShell } from "@/components/partner/PartnerShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast"; /* v25.14 NC3 — pledge error toast */
import { auditReceiptReference } from "@/lib/auditReceiptRef"; /* WAVE 95 · ITEM 2 */

/* SC-0 (WAVE 2) — RESPONSE-SHAPE CORRECTION.
 *
 * The previous local types on this page described a response body the server
 * has never sent. GET /api/partner/me/funds/:id is a compatibility shim over
 * the ONE canonical SPV engine and answers with:
 *
 *   res.json({ fund, commitments: spvEngineStore.investorRegister(...) })
 *                                       — server/partnerRoutes.ts:1779-1784
 *
 * i.e. `commitments` is a SIBLING key of `fund`, not a member of it, and
 * `fund` is a canonical `SpvDTO` (shared/spvEngine.ts:205-230), not a
 * bespoke fund record. Reading `fund.commitments.length` therefore threw
 * `TypeError: Cannot read properties of undefined (reading 'length')` and
 * white-screened the whole route.
 *
 * Each field below is taken from a verified source:
 *   - fund fields          → SpvDTO, shared/spvEngine.ts:205-230
 *   - fund-only extras     → the `terms` JSON blob the create route writes,
 *                            server/partnerRoutes.ts:1771 (`vintage`, `fundType`)
 *   - commitment fields    → spvEngineStore.investorRegister(),
 *                            server/spvEngineStore.ts:1156-1165
 */
type Commitment = {
  investorId: string;
  commitmentMinor: number;
  ownershipPct: number;
};

type FundDetail = {
  id: string;
  /** SpvDTO.name — the shim maps the legacy `fundName` onto it on write. */
  name: string;
  jurisdiction: string;
  /** SpvDTO.targetRaiseMinor — nullable on the DTO. */
  targetRaiseMinor: number | null;
  currency: string;
  status: string;
  /** SpvDTO carries ONE hash plus a timestamp. There is no `version` and no
   *  `prevRevisionHash` at runtime — see the Audit Receipt note below. */
  revisionHash: string;
  createdAt: string;
  /** Fund-specific values live in the shim's `terms` blob, not as columns. */
  terms: Record<string, unknown> | null;
};

type FundDetailResponse = { fund: FundDetail; commitments: Commitment[] };

/** `terms` is `Record<string, unknown>`; render defensively. */
function termsValue(terms: Record<string, unknown> | null, key: string): string | null {
  const v = terms?.[key];
  return typeof v === "string" || typeof v === "number" ? String(v) : null;
}

function formatMinor(minor: number, currency: string) {
  // v25.38 — delegate to shared ISO-4217-aware formatter (2-decimal parity).
  return formatMinorLib(minor, currency, { locale: "en-US" });
}

export default function PartnerFundDetail() {
  const role = useRequirePartnerRole();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, params] = useRoute<{ id: string }>("/collective/partner/funds/:id");
  const fundId = params?.id;
  const [pledgeForm, setPledgeForm] = useState({ lpName: "", amountMinor: "0" });

  const { data, isLoading, error } = useQuery<FundDetailResponse>({
    /* v25.12 NL1 — explicit queryFn for robustness.
       v25.14 NH4 — canonical 2-element queryKey so the parent list's
       invalidateQueries({queryKey: ["/api/partner/me/funds"]}) cascades. */
    queryKey: ["/api/partner/me/funds", fundId],
    enabled: role.ready && !!role.identity && !!fundId,
    queryFn: async () => (await apiRequest("GET", `/api/partner/me/funds/${fundId}`)).json(),
  });

  const pledge = useMutation({
    mutationFn: async () => {
      // v25.14 NL7 — client-side numeric validation before submit so the
      // user sees an immediate, sensible error instead of a 400 Zod blob.
      const amount = parseInt(pledgeForm.amountMinor, 10);
      if (!pledgeForm.lpName.trim()) throw new Error("LP name required.");
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Pledge amount must be a positive number.");
      /* v25.33 — apiRequest() throws ApiError on non-2xx; the former `if (!res.ok)`
         guard was unreachable dead code. (The client-side validation throws above
         are intentional and remain.) The thrown ApiError reaches onError unchanged. */
      const res = await apiRequest("POST", `/api/partner/me/funds/${fundId}/commitments`, {
        lpName: pledgeForm.lpName,
        amountMinor: amount,
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/partner/me/funds", fundId] });
      qc.invalidateQueries({ queryKey: ["/api/partner/me/funds"] });
      setPledgeForm({ lpName: "", amountMinor: "0" });
      toast({ title: "Pledge recorded" });
    },
    // v25.14 NC3 — was silently swallowed; only an inline error div that
    // reset on next mutate. Now surfaces a destructive toast.
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Pledge failed.";
      toast({ title: "Pledge failed", description: msg, variant: "destructive" });
    },
  });

  if (!role.ready || !role.identity) return null;
  const me = role.identity;
  if (isLoading) return <PartnerShell title="Fund" tier={me.tier} subRole={me.subRole} partnerName={me.identity.name}><div>Loading…</div></PartnerShell>;
  if (error || !data?.fund) {
    return (
      <PartnerShell title="Fund not found" tier={me.tier} subRole={me.subRole} partnerName={me.identity.name}>
        <div className="text-red-600" data-testid="partner-fund-not-found">
          This fund does not exist or you do not have access to it.
        </div>
      </PartnerShell>
    );
  }

  const f = data.fund;
  /* SC-0 — sibling key, defaulted so an absent/short body degrades to an empty
     ledger instead of throwing. */
  const commitments: Commitment[] = data.commitments ?? [];
  const vintage = termsValue(f.terms, "vintage");
  const canPledge = me.subRole === "managing_partner" || me.subRole === "associate";

  return (
    <PartnerShell title={`${f.name}${vintage ? ` · Vintage ${vintage}` : ""} · ${f.status}`} tier={me.tier} subRole={me.subRole} partnerName={me.identity.name}>
      <Card className="p-4 mb-4 space-y-2" data-testid="partner-fund-detail">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-[var(--cv-color-text-muted)]">Target Size</div>
            {/* WAVE 55 · R6 / 55-Q1 — a prominent single-value readout, so an
                explicit named refusal rather than a dash. `?? 0` claimed this
                fund targets nothing. A fund that genuinely targets 0 still prints. */}
            <div className="font-mono">{moneyOrNotProvided(f.targetRaiseMinor, f.currency)}</div>
          </div>
          <div>
            <div className="text-[var(--cv-color-text-muted)]">Currency (ISO 4217)</div>
            <div className="font-mono">{f.currency}</div>
          </div>
        </div>
      </Card>

      <Card className="p-4 mb-4" data-testid="partner-fund-commitments">
        <div className="flex justify-between items-center mb-3">
          <div className="font-medium">Commitments</div>
        </div>
        {commitments.length === 0 ? (
          <div className="text-sm text-[var(--cv-color-text-muted)]">No commitments pledged yet.</div>
        ) : (
          <div className="space-y-2">
            {commitments.map((c) => (
              <div key={c.investorId} className="flex justify-between text-sm border-b pb-2" data-testid={`partner-commitment-${c.investorId}`}>
                <div>{c.investorId}</div>
                <div className="font-mono">{formatMinor(c.commitmentMinor, f.currency)}</div>
              </div>
            ))}
          </div>
        )}

        {/* SC-0 SAFETY — this form is rendered INERT, deliberately and reversibly.
            Making this route stop crashing also makes this form reachable for the
            first time. It cannot succeed: it POSTs `{ lpName, amountMinor }` while
            POST /api/partner/me/funds/:id/commitments hard-requires
            `{ lpContactId, commitmentMinor, currency }` and 400s otherwise
            (server/partnerRoutes.ts:1814-1839). It is also managing_partner-only
            server-side, while `canPledge` here also admits `associate`.
            Nothing is deleted; re-enabling is a one-line change once the LP-contact
            picker exists. Logged in build_log/WAVE2_REPORT.md. */}
        {canPledge && (
          <div className="mt-4 border-t pt-3 space-y-2 opacity-60" data-testid="partner-fund-pledge-disabled">
            <Label>Record New Pledge</Label>
            <div className="text-xs text-amber-700" data-testid="partner-fund-pledge-disabled-note">
              Temporarily unavailable. This form submits an LP name, but the commitment
              endpoint requires an existing LP contact. Seat LPs from the SPV Engine
              (SPV → LP roster) until the contact picker ships.
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="LP name"
                value={pledgeForm.lpName}
                onChange={(e) => setPledgeForm({ ...pledgeForm, lpName: e.target.value })}
                data-testid="partner-pledge-lp-name"
                disabled
              />
              <Input
                type="number"
                placeholder="Amount (minor units)"
                value={pledgeForm.amountMinor}
                onChange={(e) => setPledgeForm({ ...pledgeForm, amountMinor: e.target.value })}
                data-testid="partner-pledge-amount"
                disabled
              />
              <Button
                onClick={() => pledge.mutate()}
                disabled
                data-testid="partner-pledge-submit"
              >
                Pledge
              </Button>
            </div>
            {pledge.error ? (
              <div className="text-sm text-red-600">
                {pledge.error instanceof Error ? pledge.error.message : String(pledge.error)}
              </div>
            ) : null}
          </div>
        )}
      </Card>

      <Card className="p-4 space-y-2" data-testid="partner-fund-hash-chain">
        <div className="font-medium mb-2">Audit Receipt</div>
        {/* SC-0 — `version` and `prev_revision_hash` were rendered here but exist
            on NEITHER the runtime payload NOR `SpvDTO` (shared/spvEngine.ts:205-230,
            which carries only `revisionHash` and `createdAt`). Both lines rendered
            blank in production. They are removed rather than invented; see
            WAVE2_REPORT.md "What a complete audit receipt should show". */}
        {/* WAVE 95 · ITEM 2 — the SAME 64-character machine value was rendered
            here as on the SPV page (register M-8). Fixed identically rather than
            left as the one place a partner can still read a raw digest: the label
            is Wave 83's owner-approved wording and is kept verbatim, the full
            digest stays on the row as `data-revision-hash`, and what a human
            reads is a short quotable prefix of the same value. R77 + R44. */}
        <div className="text-xs font-mono space-y-1">
          <div data-revision-hash={f.revisionHash} data-testid="partner-fund-audit-receipt-ref">
            Revision fingerprint: {auditReceiptReference(f.revisionHash) ?? "not recorded"}
          </div>
          <div>Created: {f.createdAt}</div>
        </div>
        <div className="text-xs" data-testid="partner-fund-audit-receipt-help">
          Quote this fingerprint to Capavate support if you need this receipt checked.
        </div>
      </Card>
    </PartnerShell>
  );
}
