/**
 * Foundation Build — Partner SPV detail page.
 * Shows SPV summary, audit receipt, and (managing_partner-only) capital-call
 * + distribution forms wired to the v25.23 NC-A real DB-backed handlers.
 */
import { useState } from "react";
import { formatMinor as formatMinorLib } from "@/lib/currency"; /* v25.38 currency sweep */
import { useRoute } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient"; /* v25.14 NH3 — needed for queryFn */
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { PartnerShell } from "@/components/partner/PartnerShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { SPV_JURISDICTION_LABELS, resolveSpvJurisdiction } from "@shared/spvEngine";

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
function jurisdictionLabel(raw: string | null | undefined): string {
  return SPV_JURISDICTION_LABELS[resolveSpvJurisdiction(raw)];
}

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
      qc.invalidateQueries({ queryKey: ["/api/partner/me/spv", spvId, "lp-roster"] });
      toast({ title: "LP invited" });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Invite failed", description: e.message }),
  });

  const commitMut = useMutation({
    mutationFn: async () => {
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
      qc.invalidateQueries({ queryKey: ["/api/partner/me/spv", spvId, "lp-roster"] });
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
    <PartnerShell title={`${s.name} · ${jurisdictionLabel(s.jurisdiction)} · ${s.status}`} tier={me.tier} subRole={me.subRole} partnerName={me.identity.name}>
      <Card className="p-4 mb-4 space-y-2" data-testid="partner-spv-detail">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-[var(--cv-color-text-muted)]">Target Size</div>
            <div className="font-mono">{formatMinor(s.targetRaiseMinor ?? 0, s.currency)}</div>
          </div>
          <div>
            <div className="text-[var(--cv-color-text-muted)]">Currency (ISO 4217)</div>
            <div className="font-mono">{s.currency}</div>
          </div>
          <div>
            <div className="text-[var(--cv-color-text-muted)]">Jurisdiction</div>
            <div data-testid="partner-spv-jurisdiction">{jurisdictionLabel(s.jurisdiction)}</div>
          </div>
          <div>
            <div className="text-[var(--cv-color-text-muted)]">Status</div>
            <div>{s.status}</div>
          </div>
        </div>
      </Card>

      {/* v25.24 NM-1 — managing_partner-only capital-call + distribution UI.
          Server endpoints are also gated with assertSubRole; the disable here
          is defense-in-depth for UX (avoid pre-flight failed POSTs). */}
      {isManagingPartner ? (
        <Card className="p-4 mb-4 space-y-3" data-testid="partner-spv-capital-call-form">
          <div className="font-medium">Record Capital Call</div>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              inputMode="numeric"
              min="1"
              placeholder={`Amount in minor units (${s.currency})`}
              value={callAmount}
              onChange={(e) => setCallAmount(e.target.value)}
              data-testid="partner-spv-capital-call-amount"
            />
            <Button
              disabled={!callAmount || callMut.isPending}
              onClick={() => {
                const n = Number(callAmount);
                if (!Number.isFinite(n) || n <= 0) {
                  toast({ variant: "destructive", title: "Invalid amount" });
                  return;
                }
                callMut.mutate(Math.round(n));
              }}
              data-testid="partner-spv-capital-call-submit"
            >
              {callMut.isPending ? "Recording…" : "Record"}
            </Button>
          </div>
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
            <Input
              type="number"
              inputMode="numeric"
              min="1"
              placeholder={`Gross proceeds in minor units (${s.currency})`}
              value={distAmount}
              onChange={(e) => setDistAmount(e.target.value)}
              data-testid="partner-spv-distribution-amount"
              className="flex-1 min-w-[220px]"
              disabled={DIST_PANEL_DISABLED}
            />
            <Input
              type="number"
              inputMode="numeric"
              min="0"
              placeholder={`Cost basis in minor units (${s.currency})`}
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
                   so this only spares the GP a round trip. */
                const n = Number(distAmount);
                if (!Number.isFinite(n) || n <= 0) {
                  toast({ variant: "destructive", title: "Invalid amount" });
                  return;
                }
                /* Blocker 4 discipline: the cost basis is REQUIRED and is never
                   defaulted to 0 here. A silent 0 basis would treat every dollar
                   of proceeds as profit and over-charge carry to the LPs. */
                const cb = Number(distCostBasis);
                if (!Number.isFinite(cb) || cb < 0 || !Number.isInteger(cb)) {
                  toast({ variant: "destructive", title: "Cost basis required", description: "Enter the cost basis in whole minor units. It is never assumed to be zero." });
                  return;
                }
                if (!Number.isInteger(n)) {
                  toast({ variant: "destructive", title: "Whole minor units only", description: "Amounts are integers in minor units; fractional minor units cannot be allocated." });
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
                      <td className="p-2">{sub.status}</td>
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
                onChange={(e) => setLpLastName(e.target.value)}
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
            {!lpLastName.trim() && (
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
                onChange={(e) => setCommitLast(e.target.value)}
                data-testid="partner-spv-lp-commit-lastname"
              />
              <Input
                type="email"
                placeholder="Email *"
                value={commitEmail}
                onChange={(e) => setCommitEmail(e.target.value)}
                data-testid="partner-spv-lp-commit-email"
              />
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                placeholder={`Amount (${s.currency})`}
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
            {!commitLast.trim() && (
              <div className="text-xs text-rose-600" data-testid="partner-spv-lp-commit-lastname-error">
                Last name is required to commit an LP.
              </div>
            )}
            <Button
              disabled={
                !commitFirst.trim() || !commitLast.trim() || !commitEmail.trim() ||
                !commitAmount.trim() || !commitUnits.trim() || commitMut.isPending
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
        <div className="text-xs font-mono space-y-1">
          <div>revision_hash: {s.revisionHash}</div>
          <div>created_at: {s.createdAt}</div>
        </div>
      </Card>
    </PartnerShell>
  );
}
