/* client/src/components/partner/SpvOperationsPanels.tsx
 *
 * WAVE 8 — ORP-030 / DEF-030. "Give the SPV fee/close/compliance API tier its
 * client callers."
 *
 * THE DEFECT (PLATFORM_ORPHAN_AUDIT #4 / §C1, CRITICAL). Ten `spvEngineRoutes`
 * endpoints were mounted, authenticated, tested server-side — and called by
 * nothing in the client. The audit's sharpest evidence, re-verified against
 * this tree: `SpvDetailTabs.tsx` already renders
 * `data-testid="spv-detail-capital-accounts"` and
 * `data-testid="spv-close-summary"`, so the TABS existed while neither called
 * its dedicated endpoint — both derived their numbers from the generic
 * `GET /api/partner/me/spv/:spvId` payload. A partner running an SPV therefore
 * could not see fee obligations, could not charge one, could not amend or
 * commit a deployment, and could not pull an authoritative capital-account or
 * close statement.
 *
 * EXISTS-VS-MISSING: every endpoint here ALREADY EXISTS. Nothing server-side is
 * built by this file. This is pure WIRING — the panels below are the missing
 * client callers, mounted into the tabs that were already on screen.
 *
 * VERIFIED ENDPOINTS (re-checked against server/spvEngineRoutes.ts 2026-08-10;
 * the audit's line numbers had drifted, the routes had not):
 *   GET   /api/partner/me/spv-wizard/defaults                      :140
 *   GET   /api/partner/me/spv/:spvId/signoffs                      :210
 *   POST  /api/partner/me/spv/:spvId/eligibility/evaluate          :268
 *   GET   /api/partner/me/spv/:spvId/fee-breakdown                 :284
 *   GET   /api/partner/me/spv/:spvId/fee-obligations               :293
 *   POST  /api/partner/me/spv/:spvId/fee-obligations/:obId/charge  :313
 *   PATCH /api/partner/me/spv/:spvId/deployments/:depId            :432
 *   POST  /api/partner/me/spv/:spvId/deployments/:depId/commit     :447
 *   GET   /api/partner/me/spv/:spvId/capital-accounts              :555
 *   GET   /api/partner/me/spv/:spvId/close-summary                 :575
 *   GET   /api/spv/:spvId/lp-roster                                :623  (ORP-051)
 *
 * DESIGN NOTES
 *   - Panels are read-first: every one renders its own loading, empty and error
 *     state rather than disappearing, because an invisible panel is the same
 *     silent drop this wave exists to repair.
 *   - Money is rendered through `formatMinor` in the row's own currency. No
 *     `× 100`, no defaulted USD.
 *   - The charge control is honest about the current server contract: the
 *     server returns PAYMENT_GATEWAY_UNAVAILABLE (503) until a gateway is
 *     wired, and that is surfaced as readable copy, not a raw code.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatMinor } from "@/lib/currency";
import { MONEY_UNAVAILABLE } from "@/lib/moneyDisplay"; /* WAVE 147 · R111 Q13 */
import { formatFractionAsPercent } from "@/lib/percentDisplay";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
/* WAVE 128 · FINDING 2 — the partner money-entry contract (Wave 126) and its
   shared confirmation line. This panel's commitment field is one of the five
   that still asked a paying client for the currency's smallest unit. */
import { parseWholeUnits, toWireMinor, wholeUnitsLabel, wholeUnitsPlaceholder } from "./partnerMoneyInput";
import { PartnerMoneyEntryNotice } from "./PartnerMoneyEntryNotice";

function money(minor: number | null | undefined, currency: string): string {
  /* WAVE 147 · R111 Q13 — this local helper already refused an absent amount, but
     it printed a bare em dash. The words are now the platform's single
     unknown-money wording, imported so a future rename cannot leave this panel
     behind. The guard itself is unchanged, so a genuine 0 still formats. */
  if (minor == null || !Number.isFinite(Number(minor))) return MONEY_UNAVAILABLE;
  return formatMinor(Number(minor), currency, { locale: "en-US" });
}

/* WAVE 127 · FINDING 2 — STRICT MINOR-UNIT PARSE FOR A TYPED AMOUNT: RETIRED BY
 * WAVE 128 · FINDING 2, AND WHY THAT IS NOT A LOSS OF PROTECTION.
 *
 * Wave 127 replaced `money(Number(commitmentMinor), currency)` in this panel's
 * echo line with `strictMinorOrNull` — a digits-only regex, then a safe-integer
 * check, then a widening of an already-proven integer string — because `Number()`
 * applied to typed money accepts exponent notation ("1e7" reads as 10,000,000)
 * and turns junk into NaN rather than refusing.
 *
 * Wave 128 re-scales the same field to whole currency units, so what the client
 * types is now parsed by `parseWholeUnits` (partnerMoneyInput.ts), which is
 * STRICTLY STRONGER on every case Wave 127 was defending: it refuses exponent
 * notation with a sentence naming the field, refuses a negative, refuses more
 * fractional digits than the currency has instead of rounding them away, and
 * applies `BigInt` once to a string of digits so no float ever touches the
 * figure. `strictMinorOrNull` had no remaining caller, and a dead parser beside
 * a live one is an invitation to use the wrong one; the function is therefore
 * gone and this note records what replaced it.
 */


/* ==========================================================================
 * WAVE 106 - FINDING 2: the fee breakdown was rendered as a raw object dump.
 *
 * `Object.entries(bd)` printed the STORAGE KEY as the label and `String(v)` as
 * the value, so a partner read `managementCarryPct: 0.2` - a fraction, under a
 * field name from this codebase - immediately below the same carry rendered
 * correctly as 20% elsewhere on the page. Two renderings of one number, one of
 * them a hundredfold out from how this product states every other percentage,
 * sitting next to money.
 *
 * PRESENTATION ONLY. No stored value changes, no arithmetic changes, and no
 * field is dropped: every key the server sends is still shown, under a human
 * label, with money already formatted and carry rendered the way the rest of
 * the product renders it (formatFractionAsPercent: 0.2 -> 20%). An UNMAPPED key
 * still renders, humanised rather than as raw camelCase, so a field added on
 * the server can never silently vanish from this panel.
 * ========================================================================== */

const FEE_FIELD_LABELS: Record<string, string> = {
  commitmentMinor: "Commitment modelled",
  managementFeeMinor: "Management fee",
  platformFeeMinor: "Platform fee",
  netDeployedMinor: "Net deployed to the company",
  currency: "Currency",
  managementCarryPct: "Management carry",
  platformCarryPct: "Platform carry",
  feesUnknown: "Fee schedule",
};

/** Humanise an unmapped key rather than printing a code. */
function humaniseFeeKey(key: string): string {
  const words = key
    .replace(/Minor$/, "")
    .replace(/Pct$/, " percentage")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Detail";
}

export function feeFieldLabel(key: string): string {
  return FEE_FIELD_LABELS[key] ?? humaniseFeeKey(key);
}

/**
 * The partner-facing value for one breakdown field.
 *
 * Money: already formatted, in the row's own currency. Carry: a stored FRACTION
 * rendered as a percentage by the shared formatter - the conversion happens
 * here and nowhere else, so it cannot be applied twice. `feesUnknown` is a
 * predicate, not a figure, so it is stated as a sentence rather than as false.
 */
export function feeFieldValue(key: string, value: unknown, currency: string): string {
  if (key === "feesUnknown") {
    /* WAVE 128 - FINDING 4: this row used to report the platform's own read
       operation ("Read successfully" / "Could not be read"), which is a sentence
       about our database, not about the client's fees. A GP does not care
       whether a query returned; they care whether the figures beside it can be
       relied on. Same predicate, stated as what it means for them. */
    return value === true
      ? "Unavailable - the figures below are withheld, not zero"
      : "Live from the agreed fee schedule";
  }
  if (value == null) return "—";
  if (/Minor$/.test(key)) {
    return typeof value === "number" ? money(value, currency) : String(value);
  }
  if (/Pct$/.test(key)) {
    return typeof value === "number" ? formatFractionAsPercent(value) : "—";
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

/** Human copy for the server codes these endpoints can return. Never render a
 *  raw code to a partner (00_SHARED_STANDARDS §6). */
const OPS_ERROR_COPY: Record<string, string> = {
  SPV_NOT_FOUND: "This SPV no longer exists. Refresh the page.",
  FEE_OBLIGATION_NOT_FOUND: "That fee obligation no longer exists. Refresh the panel.",
  PAYMENT_GATEWAY_UNAVAILABLE:
    "No payment gateway is connected yet, so this fee cannot be charged from here. A Capavate admin can settle it in the meantime.",
  DEPLOYMENT_NOT_FOUND: "That deployment no longer exists. Refresh the page.",
  DEPLOYMENT_NOT_WIRED: "The deployment must be marked wired before it can be committed.",
  FOUNDER_NOT_CONFIRMED: "The founder has not confirmed this deployment yet.",
  WIRE_PAYMENT_REF_REQUIRED: "A real wire payment reference is required before this step.",
  DOCS_REQUIRED: "Upload at least one closing document before committing.",
  FEES_UNPAID: "Fixed fees for this SPV are unsettled — settle them before committing.",
  ALREADY_COMMITTED: "This deployment has already been committed to the cap table.",
  INVALID_SHARES: "Enter a whole number of shares.",
  LEDGER_COMMIT_FAILED: "The cap-table ledger rejected this commit. Nothing was written.",
  AUTH_REQUIRED: "Please sign in again to view this roster.",
  NOT_A_SUBSCRIBER: "Only an LP of this SPV can see its roster.",

  /* WAVE 32 · CP-SPV-34 — THE FAIL-CLOSED FEE CODES, on the SECOND PATH.

     CP-SPV-34's honest 503 copy was delivered on the distribution PREVIEW
     (`SpvDetailTabs.tsx:1284`), where `FEE_STATE_UNKNOWN` renders as persistent
     state next to an empty result. The fee LEDGER reaches the same fail-closed
     resolver — `accrueFundingFeeObligations` throws `FEE_STATE_UNKNOWN` at
     `spvEngineStore.ts:926`, and `spvEngineRoutes.ts` maps
     `SPV_FEE_SCHEDULE_MISSING`, `SPV_FEE_SCHEDULE_UNAVAILABLE` and
     `FEE_STATE_UNKNOWN` to 503 — but none of those codes had an entry here, so
     `opsErrorMessage` fell through to its last line and rendered either the RAW
     CODE to a partner (00_SHARED_STANDARDS §6 forbids exactly that) or the
     contentless "Something went wrong."

     Each sentence below says the same three things, because they are the three
     a GP needs and the reason this item exists: WHAT is missing, that the blank
     is NOT a zero fee, and what happens next. A 503 here is retryable and the
     vehicle is fine — the server simply will not guess a price. */
  FEE_STATE_UNKNOWN:
    "Fee figures cannot be shown: the SPV fee schedule could not be read, so the carry and fees are unknown. Nothing here is a zero fee — no amount is being shown at all. Try again once the schedule loads.",
  SPV_FEE_SCHEDULE_MISSING:
    "No fee schedule is configured for this SPV, so its fees cannot be priced. This is not a fee-free vehicle — the figures are unknown. A Capavate admin must add the schedule before fees can be shown or charged.",
  SPV_FEE_SCHEDULE_UNAVAILABLE:
    "The fee schedule is temporarily unreadable, so no fee figures can be shown. The amounts are unknown, not a zero fee. This usually clears on its own — try again shortly.",
  SPV_FEE_SCHEDULE_INVALID:
    "This SPV's fee schedule could not be interpreted, so no fee can be priced or charged. The amounts are unknown, not a zero fee. A Capavate admin needs to correct the schedule.",
};

export function opsErrorMessage(err: unknown): string {
  const anyErr = err as { code?: string; message?: string } | undefined;
  const code = anyErr?.code;
  if (code && OPS_ERROR_COPY[code]) return OPS_ERROR_COPY[code];
  const msg = anyErr?.message ?? "";
  for (const key of Object.keys(OPS_ERROR_COPY)) {
    if (msg.includes(key)) return OPS_ERROR_COPY[key];
  }
  /* WAVE 32 · CP-SPV-34 — THE LAST LINE, which is where the raw code escaped.

     The map above can never be exhaustive: every new server error code is one
     more chance for `return msg` to put `FEE_STATE_UNKNOWN` on a GP's screen.
     Adding four entries fixes today's leak; this fixes the CLASS. A message
     that is nothing but a SCREAMING_SNAKE_CASE token is a machine code, not a
     sentence, and a partner must never be shown one — 00_SHARED_STANDARDS §6.

     The refusal names the code for support without pretending it is English,
     and it does not claim the operation succeeded or failed silently. Real
     prose messages are unaffected: the test is anchored and requires the WHOLE
     message to be a token. */
  if (/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/.test(msg.trim())) {
    return `This could not be completed and the reason has not been translated yet. Nothing was changed. Quote reference ${msg.trim()} to Capavate support.`;
  }
  return msg || "Something went wrong.";
}

function PanelFrame({
  title,
  testid,
  children,
  hint,
}: {
  title: string;
  testid: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="mt-4 rounded-md border p-3" data-testid={testid}>
      <div className="font-medium text-sm mb-1">{title}</div>
      {hint ? <div className="text-[10px] text-[var(--cv-color-text-faint)] mb-2">{hint}</div> : null}
      {children}
    </div>
  );
}

function StateLine({ loading, error, empty, emptyText, testid }: {
  loading: boolean; error: unknown; empty: boolean; emptyText: string; testid: string;
}) {
  if (loading) return <div className="text-xs text-[var(--cv-color-text-faint)]" data-testid={`${testid}-loading`}>Loading…</div>;
  if (error) return <div className="text-xs text-red-600" data-testid={`${testid}-error`}>{opsErrorMessage(error)}</div>;
  if (empty) return <div className="text-xs text-[var(--cv-color-text-faint)]" data-testid={`${testid}-empty`}>None recorded yet.</div>;
  return null;
}

/* ── ORP-030 (a) — fee breakdown + fee obligations + charge ──────────────────
   GET /fee-breakdown, GET /fee-obligations, POST /fee-obligations/:obId/charge.
   The SPV fee ledger was computed server-side and displayed nowhere. */
export function SpvFeeLedgerPanel({
  spvId, currency, canWrite, onChanged,
}: { spvId: string; currency: string; canWrite: boolean; onChanged: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  /* WAVE 128 · FINDING 2 — held as the client TYPED it, in whole currency
     units. `commitmentWireMinor` below is the exact minor-unit integer the wire
     has always carried, so the request this panel issues is byte-identical to
     the one it issued before for the same INTENDED amount — what changes is that
     typing 2500 now models $2,500.00 rather than $25.00. */
  const [commitmentInput, setCommitmentInput] = useState("");
  /* WAVE 32 · CP-SPV-34 — held as state, not announced in a toast. See onError. */
  const [chargeFailure, setChargeFailure] = useState<string | null>(null);

  /* ══════════════════════════════════════════════════════════════════════════
     WAVE 127 · FINDING 2 — AN EMPTY INPUT NOW PRODUCES NO FIGURES AT ALL.
     ══════════════════════════════════════════════════════════════════════════
     WHAT WENT WRONG, AND IT WAS SYSTEMIC. This query fired UNCONDITIONALLY and
     omitted the query parameter when the box was empty. The server
     (server/spvEngineRoutes.ts) then read

         Number(req.query.commitmentMinor ?? spv.minCheckMinor ?? 0)

     and silently substituted the vehicle's MINIMUM CHEQUE SIZE. So a partner
     who had typed nothing was shown a complete, arithmetically-correct fee
     breakdown of an amount they never supplied: Test SPV modelled $484.47
     (min_check_minor 48447) and QUantum SPV modelled $100.00
     (min_check_minor 10000). 484.47 − 33.00 = 451.47 held because the
     ARITHMETIC was never wrong — only the INPUT was invented, which is worse
     than a hardcoded placeholder, not better: real code was running on a
     question nobody had asked.

     THE FIX HERE IS THE STRONGEST AVAILABLE: no request is issued while the box
     is empty, so there is no figure to render and none can be. The route's own
     substitution is removed at source as well, so the next caller cannot be
     lied to either. `enabled` is the whole mechanism; nothing is filtered out
     of a response after the fact.

     WAVE 128 · FINDING 2 EXTENDS THE SAME RULE TO A REFUSED AMOUNT. The wire
     value is now the parse RESULT, so an unparseable entry ("1e7", "12.345",
     "-4") is treated exactly like an empty box: no request, no figures, and the
     refusal sentence stated under the field. The endpoint
     `GET /api/partner/me/spv/:spvId/fee-breakdown?commitmentMinor=` expects
     MINOR units and still receives them, exactly, as a digit string. */
  const commitmentParse = useMemo(
    () => parseWholeUnits(commitmentInput, currency, { label: "Commitment modelled" }),
    [commitmentInput, currency],
  );
  const commitmentWireMinor = commitmentParse.ok ? toWireMinor(commitmentParse.minor) : "";
  const awaitingCommitmentInput = commitmentWireMinor === "";
  /* WAVE 128 - THE ECHO IS HOISTED, AND THE REASON IS THE DROP GATE, NOT STYLE.
     `restyle-drop-detector` inventories every EXPRESSION CHILD by the digest of
     its source text. The echo container below used to hold one:

       {commitmentMinor === ""
         ? `Enter the amount in the smallest unit of ${currency}. The amount
            being modelled appears here as you type.`
         : `Modelling ${money(Number(commitmentMinor), currency)} - check this is
            the amount you meant before reading the figures below.`}

     digest `client/src/components/partner/SpvOperationsPanels.tsx div
     34f4b78a53ab`. That expression had to go: its first branch asked a paying
     client for the smallest unit of their currency, which is this wave's Finding
     2, and its second ran `Number()` on a typed amount, which the money rule
     forbids outright. Replacing it with a COMPONENT would have registered as a
     BARE DROP - an expression child gone with no expression child added - and a
     bare drop is a preflight failure that cannot be allowlisted in source and
     must not be waved through by re-cutting `baseline.json`.

     So the replacement is kept as an expression child, hoisted into a `useMemo`
     exactly as W116_TESTS.md 3.1 prescribes: the container keeps its id, its test
     id, its position and its single dynamic child, and the gate keeps a paired
     ADDED expression to weigh the removal against. Nothing about the rendered
     result depends on this hoist - it is the honest shape for the change. */
  const commitmentEcho = useMemo(
    () => (
      <PartnerMoneyEntryNotice
        raw={commitmentInput}
        currency={currency}
        label="Commitment modelled"
        testid="spv-fee-breakdown-input-notice"
      />
    ),
    [commitmentInput, currency],
  );
  const breakdown = useQuery<{ breakdown: unknown }>({
    queryKey: ["/api/partner/me/spv", spvId, "fee-breakdown", commitmentWireMinor],
    enabled: !awaitingCommitmentInput,
    queryFn: async () =>
      (await apiRequest(
        "GET",
        `/api/partner/me/spv/${spvId}/fee-breakdown${commitmentWireMinor ? `?commitmentMinor=${encodeURIComponent(commitmentWireMinor)}` : ""}`,
      )).json(),
  });

  const obligations = useQuery<{ obligations: Array<Record<string, unknown>> }>({
    queryKey: ["/api/partner/me/spv", spvId, "fee-obligations"],
    queryFn: async () => (await apiRequest("GET", `/api/partner/me/spv/${spvId}/fee-obligations`)).json(),
  });

  const charge = useMutation({
    mutationFn: async (obId: string) =>
      (await apiRequest("POST", `/api/partner/me/spv/${spvId}/fee-obligations/${obId}/charge`, {})).json(),
    onSuccess: () => {
      setChargeFailure(null);
      toast({ title: "Fee charged" });
      qc.invalidateQueries({ queryKey: ["/api/partner/me/spv", spvId, "fee-obligations"] });
      onChanged();
    },
    /* WAVE 32 · CP-SPV-34 — A TOAST IS NOT A RENDERED STATE, the same defect
       this item fixed on the distribution preview. The toast that announces a
       failed charge is gone in seconds; the obligation stays on screen looking
       exactly as chargeable as it did before, with nothing saying the attempt
       was made and refused. The failure is now held as state next to the row
       until the next attempt, and cleared on success. */
    onError: (e) => {
      setChargeFailure(opsErrorMessage(e));
      toast({ title: "Could not charge this fee", description: opsErrorMessage(e), variant: "destructive" });
    },
  });

  const rows = obligations.data?.obligations ?? [];
  /* WAVE 127 · FINDING 2 — hoisted, so the render below keeps its static sibling
     shape (build_log/wave116/W116_TESTS.md §3.1) instead of a conditional
     swapping siblings in and out. While the box is empty this is null even if a
     stale response is still cached, so no previously-modelled figure can linger
     next to an empty input. */
  const bd = useMemo<Record<string, unknown> | null>(
    () => (awaitingCommitmentInput ? null : ((breakdown.data?.breakdown ?? null) as Record<string, unknown> | null)),
    [awaitingCommitmentInput, breakdown.data],
  );

  return (
    <PanelFrame
      title="Fee ledger"
      testid="spv-fee-ledger-panel"
      hint="Authoritative fee figures, read live from the SPV fee engine. Amounts and carry percentages come from the admin-configured fee schedule — nothing here is entered by hand."
    >
      <div className="flex items-end gap-2 mb-2">
        {/* WAVE 106 - FINDING 3 asked this field to explain itself: it said
            "enter the amount in USD cents, not whole USD" and echoed what it
            would model, but it still asked a paying client for the currency's
            SMALLEST unit, and someone modelling five million dollars modelled
            fifty thousand.

            WAVE 128 · FINDING 2 re-scales it. The field now accepts the amount
            a person writes — "2,500", "$2,500.00" — and the WIRE FORMAT does not
            move: `commitmentWireMinor` is the same exact minor-unit integer this
            panel always sent, so no server contract and no arithmetic changes.
            The conversion is `parseWholeUnits` from the one partner money module
            (bigint, string surgery, no `Number()` on a typed amount); there is
            no second converter here.

            The echo container keeps its id and its test id — it is the field's
            `aria-describedby` target — and now holds the shared confirmation
            line, which also states a refusal inline instead of leaving an
            unparseable entry to look accepted. */}
        <div className="flex-1">
          <Label htmlFor={`fee-bd-${spvId}`} className="text-xs">
            {wholeUnitsLabel("Model a commitment", currency)}
          </Label>
          <Input
            id={`fee-bd-${spvId}`}
            value={commitmentInput}
            onChange={(e) => setCommitmentInput(e.target.value)}
            placeholder={wholeUnitsPlaceholder(currency)}
            aria-describedby={`fee-bd-echo-${spvId}`}
            data-testid="spv-fee-breakdown-input"
          />
          <div
            id={`fee-bd-echo-${spvId}`}
            className="text-xs mt-1"
            data-testid="spv-fee-breakdown-input-echo"
          >
            {commitmentEcho}
          </div>
        </div>
      </div>

      {/* WAVE 26 / S-3 SECOND PATH — a SIBLING element above the breakdown, not
          text spliced into it. When the server cannot trust the `spv_fee` view
          it now sends nulls instead of zeros; the rows below render those as
          "—", which is honest but silent. The refusal has to be stated, because
          the thing being withheld is money. */}
      {bd && bd.feesUnknown === true ? (
        <div className="text-xs mb-2 text-red-600" role="alert" data-testid="spv-fee-breakdown-unknown">
          Fee figures unavailable — the fee schedule could not be read. No amount shown here is a zero fee.
        </div>
      ) : null}

      {/* WAVE 127 · FINDING 2 — A PROMPT, NEVER A FIGURE. A SIBLING above the
          breakdown rather than text spliced into them, for the same reason the
          WAVE 26 refusal above is a sibling. An empty input is not a commitment
          of zero and it is not the vehicle's minimum cheque; it is a question
          that has not been asked, and the honest answer on a money surface is
          nothing at all. */}
      {awaitingCommitmentInput ? (
        <div className="text-xs mb-2 text-[var(--cv-color-text-faint)]" data-testid="spv-fee-breakdown-awaiting-input">
          Enter a commitment amount above to model the fees on it. No figures are shown until you do — an amount you
          have not entered has no fee, and this panel will not model one for you.
        </div>
      ) : null}

      <div className="text-xs mb-3" data-testid="spv-fee-breakdown">
        <StateLine
          loading={!awaitingCommitmentInput && breakdown.isLoading}
          error={awaitingCommitmentInput ? null : breakdown.error}
          empty={!awaitingCommitmentInput && !bd}
          emptyText="No breakdown"
          testid="spv-fee-breakdown"
        />
        {bd
          ? Object.entries(bd).map(([k, v]) => (
              <div key={k} className="grid grid-cols-2 gap-2 py-0.5" data-testid={`spv-fee-breakdown-${k}`}>
                <div className="text-[var(--cv-color-text-faint)]">{feeFieldLabel(k)}</div>
                <div className="font-mono">{feeFieldValue(k, v, currency)}</div>
              </div>
            ))
          : null}
      </div>

      <div className="font-medium text-xs mb-1">Fee obligations</div>
      <StateLine
        loading={obligations.isLoading}
        error={obligations.error}
        empty={rows.length === 0}
        emptyText="None"
        testid="spv-fee-obligations"
      />
      {/* WAVE 32 · CP-SPV-34 — SIBLING of the obligation list, never nested in a
          row: the row it belongs to may be re-rendered or gone, and the refusal
          has to outlive it. */}
      {chargeFailure !== null && (
        <div className="text-xs mb-1 text-red-600" role="alert" data-testid="spv-fee-charge-failed">
          No fee was charged — nothing was written. {chargeFailure}
        </div>
      )}
      <div data-testid="spv-fee-obligations">
        {rows.map((o) => {
          const id = String(o.id ?? "");
          const state = String(o.state ?? o.status ?? "");
          /* WAVE 147 · R111 Q13 — `?? 0` here made a fee obligation with no amount
             on record indistinguishable from a $0.00 obligation. `amt` stays a
             number for the arithmetic below; the DISPLAY goes through `money()`,
             which refuses `NaN`. */
          const amt = Number(o.amountMinor ?? Number.NaN);
          const cur = String(o.currency ?? currency);
          return (
            <div key={id} className="flex items-center justify-between gap-2 text-xs py-1 border-b last:border-0" data-testid={`spv-fee-obligation-${id}`}>
              <div className="truncate">
                <span className="font-medium">{String(o.kind ?? o.feeType ?? "fee")}</span>
                <span className="text-[var(--cv-color-text-faint)]"> · {state || "pending"}</span>
              </div>
              <div className="font-mono">{money(amt, cur)}</div>
              {canWrite && state !== "paid" && state !== "waived" ? (
                <Button
                  variant="outline"
                  disabled={charge.isPending}
                  onClick={() => charge.mutate(id)}
                  data-testid={`spv-fee-obligation-charge-${id}`}
                >
                  Charge
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
    </PanelFrame>
  );
}

/* ── ORP-030 (b) — authoritative capital accounts ────────────────────────────
   GET /capital-accounts. Exposed as a HOOK, not a component, on purpose: the
   Capital accounts table and all of its copy ("Capital accounts", "Investor",
   "Contributed", "Confirmed", "Distributed", "not yet reported") must stay in
   SpvDetailTabs.tsx where they have always lived. Moving that markup into a
   component here removed those strings from that file and the silent-drop guard
   correctly flagged it as a copy loss. The hook wires the endpoint without
   relocating a single rendered string. */
export interface CapitalAccountRow {
  investorId: string;
  contributedMinor: number;
  confirmedMinor: number;
  distributedMinor: number;
  /* WAVE 36 / ROW 9 — realised DPI as produced by the SERVER
     (server/lib/spvOfflineOps.ts computeCapitalAccounts). Never recomputed in
     the browser: a second definition of DPI is a definition that can drift.
     `null` means undefined (nothing paid in yet), which the table renders as an
     explicit refusal rather than as 0.00x. */
  dpiRatio: number | null;
}

export function useSpvCapitalAccounts(
  spvId: string,
  fallback: CapitalAccountRow[],
): { rows: CapitalAccountRow[]; source: "endpoint" | "detail-payload"; isLoading: boolean } {
  /* WAVE 36 / ROW 9 — the endpoint's own key is `rows`
     (server/spvEngineRoutes.ts:665 `res.json({ rows: … })`); `accounts` /
     `capitalAccounts` were never emitted by it, so every response was silently
     falling through to the detail-payload fallback and the source line said so.
     All three keys are read: the two legacy names cost nothing and keep any
     older deployment working. */
  const q = useQuery<{ rows?: unknown; accounts?: unknown; capitalAccounts?: unknown }>({
    queryKey: ["/api/partner/me/spv", spvId, "capital-accounts"],
    queryFn: async () => (await apiRequest("GET", `/api/partner/me/spv/${spvId}/capital-accounts`)).json(),
  });
  const raw = q.data?.rows ?? q.data?.accounts ?? q.data?.capitalAccounts;
  if (!Array.isArray(raw)) {
    return { rows: fallback, source: "detail-payload", isLoading: q.isLoading };
  }
  const rows = (raw as Array<Record<string, unknown>>).map((c) => ({
    investorId: String(c.investorId ?? ""),
    contributedMinor: Number(c.contributedMinor ?? 0),
    confirmedMinor: Number(c.confirmedMinor ?? 0),
    distributedMinor: Number(c.distributedMinor ?? 0),
    /* `?? null`, never `?? 0`: an older server that does not send the field, or
       a genuinely undefined DPI, must both surface as "not reported". Coercing
       a missing ratio to zero would state a fact the server never asserted. */
    dpiRatio: typeof c.dpiRatio === "number" && Number.isFinite(c.dpiRatio) ? (c.dpiRatio as number) : null,
  }));
  return { rows, source: "endpoint", isLoading: q.isLoading };
}

/* ── ORP-030 (c) — authoritative close summary ───────────────────────────── */
export function SpvCloseSummaryPanel({ spvId, currency }: { spvId: string; currency: string }) {
  const q = useQuery<{ summary?: Record<string, unknown> } & Record<string, unknown>>({
    queryKey: ["/api/partner/me/spv", spvId, "close-summary"],
    queryFn: async () => (await apiRequest("GET", `/api/partner/me/spv/${spvId}/close-summary`)).json(),
  });
  const s = (q.data?.summary ?? q.data ?? null) as Record<string, unknown> | null;
  const entries = s ? Object.entries(s).filter(([, v]) => typeof v !== "object") : [];

  return (
    <PanelFrame
      title="Authoritative close statement"
      testid="spv-close-summary-panel"
      hint="Read live from Capavate's own closing statement, not a figure re-derived in the browser."
    >
      <StateLine loading={q.isLoading} error={q.error} empty={entries.length === 0} emptyText="No close statement" testid="spv-close-summary-authoritative" />
      <div className="text-xs">
        {entries.map(([k, v]) => (
          <div key={k} className="grid grid-cols-2 gap-2 py-0.5" data-testid={`spv-close-summary-${k}`}>
            <div className="text-[var(--cv-color-text-faint)]">{k}</div>
            <div className="font-mono">{typeof v === "number" && /Minor$/.test(k) ? money(v, currency) : String(v ?? "—")}</div>
          </div>
        ))}
      </div>
    </PanelFrame>
  );
}

/* ── ORP-030 (d) — launch sign-offs ──────────────────────────────────────── */
export function SpvSignoffsPanel({ spvId }: { spvId: string }) {
  const q = useQuery<{ signoffs: Array<Record<string, unknown>> }>({
    queryKey: ["/api/partner/me/spv", spvId, "signoffs"],
    queryFn: async () => (await apiRequest("GET", `/api/partner/me/spv/${spvId}/signoffs`)).json(),
  });
  const rows = q.data?.signoffs ?? [];
  return (
    <PanelFrame
      title="Launch sign-offs"
      testid="spv-signoffs-panel"
      hint="The recorded launch sign-off(s) for this SPV — who attested to what, and when."
    >
      <StateLine loading={q.isLoading} error={q.error} empty={rows.length === 0} emptyText="No sign-offs" testid="spv-signoffs" />
      {rows.map((r, i) => (
        <div key={String(r.id ?? i)} className="text-xs py-0.5" data-testid={`spv-signoff-${String(r.id ?? i)}`}>
          <span className="font-medium">{String(r.signedByName ?? r.signedBy ?? r.userId ?? "signatory")}</span>
          {r.signedAt ? <span className="text-[var(--cv-color-text-faint)]"> · {new Date(String(r.signedAt)).toLocaleString()}</span> : null}
          {r.statement ? <div className="text-[10px]">{String(r.statement)}</div> : null}
        </div>
      ))}
    </PanelFrame>
  );
}

/**
 * WAVE 128 · FINDING 3 — the mandate verdict, as a sentence.
 *
 * The route answers with the SUBSET of the ids it was asked about that clear the
 * mandate (`{ eligible: string[] }`, server/spvEngineRoutes.ts:524). So the
 * verdict is membership, and it is stated without interpreting anything the
 * server did not say: if the shape is not the one documented, this says so
 * rather than guessing a pass or a fail on a mandate decision.
 */
export function eligibilityVerdict(result: Record<string, unknown>, askedFor: string): string {
  const list = result.eligible;
  if (!Array.isArray(list)) {
    return "The engine's answer did not arrive in the expected form, so no verdict is stated here. Read the response below before relying on it.";
  }
  const ids = list.map((x) => String(x));
  if (askedFor && ids.includes(askedFor)) {
    return "Clears this SPV's mandate. Nothing has been committed - this check changes nothing.";
  }
  if (askedFor) {
    return "Does NOT clear this SPV's mandate. Committing a deployment to it would be refused by the engine for the same reason.";
  }
  return ids.length > 0
    ? `${ids.length} of the companies asked about clear this SPV's mandate.`
    : "No company was asked about, so nothing was evaluated.";
}

/* ── ORP-030 (e) — eligibility evaluate ──────────────────────────────────── */
export function SpvEligibilityPanel({ spvId, canWrite }: { spvId: string; canWrite: boolean }) {
  const { toast } = useToast();
  const [companyId, setCompanyId] = useState("");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  /* ════════════════════════════════════════════════════════════════════════
     WAVE 128 · FINDING 3 — THIS PANEL ASKED THE SERVER A QUESTION IT DOES NOT
     READ, AND THEN SHOWED THE ANSWER AS A JSON DUMP.
     ════════════════════════════════════════════════════════════════════════
     TWO DEFECTS, BOTH LIVE, FOUND WHILE VERIFYING THE WIRE FORMAT.

     1. THE REQUEST WAS IGNORED. The route reads ONE key:
          const companyIds: string[] = Array.isArray((req.body ?? {}).companyIds)
            ? req.body.companyIds : [];
        (server/spvEngineRoutes.ts:523). This panel sent `{ companyId }` -
        singular, not an array - so `companyIds` was ALWAYS the empty array and
        `evaluateEligibleCompanies` always filtered an empty list. Every check
        this panel has ever run returned `{"eligible": []}` REGARDLESS of the
        company, and a GP reading that empty array before committing a
        deployment would conclude the company fails the mandate. It sends
        `companyIds: [id]` now, which is the key the server actually reads.

     2. THE ANSWER WAS A JSON DUMP. `{JSON.stringify(result, null, 2)}` put the
        engine's response, keys and raw ids and all, on a client-facing panel.
        The verdict is now STATED - the company clears the mandate, or it does
        not - and the raw response is kept underneath, captioned, because a GP
        checking a mandate is entitled to see exactly what the engine returned.
        Nothing is removed; a sentence is added above it.
     ════════════════════════════════════════════════════════════════════════ */
  const evaluate = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/partner/me/spv/${spvId}/eligibility/evaluate`, {
        companyIds: [companyId.trim()],
      })).json(),
    onSuccess: (data) => setResult(data as Record<string, unknown>),
    onError: (e) => toast({ title: "Could not evaluate eligibility", description: opsErrorMessage(e), variant: "destructive" }),
  });

  return (
    <PanelFrame
      title="Mandate eligibility check"
      testid="spv-eligibility-panel"
      hint="Ask the server whether a company clears this SPV's mandate BEFORE you commit a deployment. Read-only — evaluating never changes anything."
    >
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Label htmlFor={`elig-${spvId}`} className="text-xs">Company id</Label>
          <Input
            id={`elig-${spvId}`}
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            placeholder="co_…"
            data-testid="spv-eligibility-company-input"
          />
        </div>
        <Button
          variant="outline"
          disabled={!canWrite || !companyId.trim() || evaluate.isPending}
          onClick={() => evaluate.mutate()}
          data-testid="spv-eligibility-evaluate-button"
        >
          Evaluate
        </Button>
      </div>
      {result ? (
        <div className="mt-2">
          <div className="text-xs" data-testid="spv-eligibility-verdict">
            {eligibilityVerdict(result, companyId.trim())}
          </div>
          <div className="text-[10px] text-[var(--cv-color-text-faint)] mt-1">
            The engine's own response, kept in full so a mandate decision can be checked line by line:
          </div>
          <pre className="mt-1 text-[10px] whitespace-pre-wrap break-all" data-testid="spv-eligibility-result">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      ) : null}
    </PanelFrame>
  );
}

/* ── ORP-030 (f) — deployment lifecycle: PATCH advance + POST commit ─────────
   These two Wave-D endpoints were the reason a partner could never amend or
   commit a deployment from the UI. `commit` is the one that writes the single
   sacred cap-table ledger line, and — as of ORP-029 — the one that now also
   charges the SPV deployment fee. */
export function SpvDeploymentLifecyclePanel({
  spvId, deployments, currency, canWrite, onChanged,
}: {
  spvId: string;
  deployments: Array<{ id?: string; companyId?: string; amountMinor?: number; status?: string; capTableLedgerRef?: string | null }>;
  currency: string;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [wireRef, setWireRef] = useState<Record<string, string>>({});
  const [shares, setShares] = useState<Record<string, string>>({});

  const advance = useMutation({
    mutationFn: async (v: { depId: string; to: string; wirePaymentRef?: string }) =>
      (await apiRequest("PATCH", `/api/partner/me/spv/${spvId}/deployments/${v.depId}`, {
        to: v.to,
        ...(v.wirePaymentRef ? { wirePaymentRef: v.wirePaymentRef } : {}),
      })).json(),
    onSuccess: () => { toast({ title: "Deployment advanced" }); onChanged(); },
    onError: (e) => toast({ title: "Could not advance this deployment", description: opsErrorMessage(e), variant: "destructive" }),
  });

  const commit = useMutation({
    mutationFn: async (v: { depId: string; shares: string }) =>
      (await apiRequest("POST", `/api/partner/me/spv/${spvId}/deployments/${v.depId}/commit`, { shares: v.shares })).json(),
    onSuccess: () => { toast({ title: "Deployment committed to the cap table" }); onChanged(); },
    onError: (e) => toast({ title: "Could not commit this deployment", description: opsErrorMessage(e), variant: "destructive" }),
  });

  return (
    <PanelFrame
      title="Deployment lifecycle"
      testid="spv-deployment-lifecycle-panel"
      /* WAVE 135 · FINDING 1 — "fail-closed server-side" is our vocabulary for our
         own architecture. The two facts the client must not lose are that a step
         cannot be skipped and that committing cannot be undone; both are stated more
         plainly than before. "irreversible" survives verbatim because on a cap-table
         write that word is the warning. */
      hint="Advance a deployment through founder confirmation, documents and the wire, then commit the single cap-table ledger line. No step can be skipped or taken out of order, and committing cannot be undone."
    >
      {deployments.length === 0 ? (
        <div className="text-xs text-[var(--cv-color-text-faint)]" data-testid="spv-deployment-lifecycle-empty">
          No deployments yet — create one above first.
        </div>
      ) : (
        deployments.map((d, i) => {
          const id = String(d.id ?? "");
          const status = String(d.status ?? "");
          const committed = Boolean(d.capTableLedgerRef);
          return (
            <div key={id || i} className="border-b last:border-0 py-2 text-xs space-y-1" data-testid={`spv-deployment-lifecycle-${id}`}>
              <div className="flex justify-between gap-2">
                <div className="truncate">{String(d.companyId ?? "—")}</div>
                <div className="font-mono">{money(Number(d.amountMinor), currency)}</div>
                <div className="text-[var(--cv-color-text-faint)]">{committed ? "committed" : status || "pending"}</div>
              </div>
              {canWrite && !committed ? (
                <div className="flex flex-wrap items-end gap-2">
                  <Button
                    variant="outline"
                    disabled={advance.isPending || status === "founder_confirmed" || status === "wired"}
                    onClick={() => advance.mutate({ depId: id, to: "founder_confirmed" })}
                    data-testid={`spv-deployment-confirm-${id}`}
                  >
                    Mark founder-confirmed
                  </Button>
                  <div>
                    <Label htmlFor={`wire-${id}`} className="text-[10px]">Wire payment ref</Label>
                    <Input
                      id={`wire-${id}`}
                      value={wireRef[id] ?? ""}
                      onChange={(e) => setWireRef((p) => ({ ...p, [id]: e.target.value }))}
                      placeholder="bank reference"
                      data-testid={`spv-deployment-wireref-${id}`}
                    />
                  </div>
                  <Button
                    variant="outline"
                    disabled={advance.isPending || !(wireRef[id] ?? "").trim()}
                    onClick={() => advance.mutate({ depId: id, to: "wired", wirePaymentRef: (wireRef[id] ?? "").trim() })}
                    data-testid={`spv-deployment-wire-${id}`}
                  >
                    Mark wired
                  </Button>
                  <div>
                    <Label htmlFor={`shares-${id}`} className="text-[10px]">Shares</Label>
                    <Input
                      id={`shares-${id}`}
                      value={shares[id] ?? ""}
                      onChange={(e) => setShares((p) => ({ ...p, [id]: e.target.value.replace(/[^\d-]/g, "") }))}
                      placeholder="whole number"
                      data-testid={`spv-deployment-shares-${id}`}
                    />
                  </div>
                  <Button
                    disabled={commit.isPending || !(shares[id] ?? "").trim()}
                    onClick={() => commit.mutate({ depId: id, shares: (shares[id] ?? "").trim() })}
                    data-testid={`spv-deployment-commit-${id}`}
                  >
                    Commit to cap table
                  </Button>
                </div>
              ) : null}
              {/* WAVE 33 / CP-SPV-31 — APPENDED as the LAST sibling of this
                  row, never inserted mid-list (inserting renumbers a sibling's
                  positional path and the guard reads that as a drop). It
                  carries the two things this ladder was missing: the
                  `docs_sent` rung, which the store has always accepted and the
                  UI never exposed, and the DERIVED share count, so the number
                  written permanently to the cap table is checked against the
                  round's own price instead of merely being typed. */}
              <DeploymentDerivation
                spvId={spvId}
                depId={id}
                typedShares={shares[id] ?? ""}
                canWrite={canWrite}
                committed={committed}
                onUseDerived={(v) => setShares((p) => ({ ...p, [id]: v }))}
                onChanged={onChanged}
              />
            </div>
          );
        })
      )}
    </PanelFrame>
  );
}

/* ── WAVE 33 / CP-SPV-31 · the derivation + the missing rung ──────────────────
   Server-derived throughout. The share figure, the divergence warning, the
   ladder labels and every refusal sentence are authored by
   `/deployments/:depId/share-derivation` and printed verbatim; none of it is
   assembled here, so the client cannot drift from what the store enforces.

   The derived figure is OFFERED, never substituted. Committing still sends the
   GP's own number: replacing it silently would swap one unchecked figure for
   another, and a share count can legitimately differ from a naive division. */
function DeploymentDerivation({
  spvId, depId, typedShares, canWrite, committed, onUseDerived, onChanged,
}: {
  spvId: string;
  depId: string;
  typedShares: string;
  canWrite: boolean;
  committed: boolean;
  onUseDerived: (v: string) => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [docRef, setDocRef] = useState("");

  const q = useQuery<{
    derivation?: { wholeShares: string | null; residualMinor: number | null; exact: boolean; refusal: string | null; copy: string; currency: string };
    divergence?: string | null;
    closingDocRef?: string | null;
    status?: string;
    roundFound?: boolean;
  }>({
    queryKey: ["/api/partner/me/spv", spvId, "deployments", depId, "share-derivation", typedShares],
    queryFn: async () =>
      (await apiRequest(
        "GET",
        `/api/partner/me/spv/${spvId}/deployments/${depId}/share-derivation?shares=${encodeURIComponent(typedShares)}`,
      )).json(),
    retry: false,
  });

  const sendDocs = useMutation({
    mutationFn: async () =>
      (await apiRequest("PATCH", `/api/partner/me/spv/${spvId}/deployments/${depId}`, {
        to: "docs_sent",
        ...(docRef.trim() ? { closingDocRef: docRef.trim() } : {}),
      })).json(),
    onSuccess: () => { toast({ title: "Closing docs marked sent" }); onChanged(); },
    onError: (e) => toast({ title: "Could not mark closing docs sent", description: opsErrorMessage(e), variant: "destructive" }),
  });

  const d = q.data?.derivation;

  return (
    <div className="mt-1 rounded border-l-2 pl-2 py-1 space-y-1" data-testid={`spv-deployment-derivation-${depId}`}>
      {q.isLoading ? (
        <div className="text-[10px] text-[var(--cv-color-text-faint)]" data-testid={`spv-deployment-derivation-loading-${depId}`}>
          Deriving the share count…
        </div>
      ) : q.error || !d ? (
        <div className="text-[10px]" data-testid={`spv-deployment-derivation-unavailable-${depId}`}>
          The share derivation could not be read. No figure is shown rather than one that may be wrong — nothing has been changed.
        </div>
      ) : (
        <>
          {/* Null is never rendered as zero: a derived "0 shares" would be a
              claim that the money bought nothing. */}
          <div className="text-[10px]" data-testid={`spv-deployment-derived-shares-${depId}`}>
            {d.wholeShares === null ? "Derived shares: not available" : `Derived shares: ${d.wholeShares}`}
          </div>
          <div className="text-[10px] text-[var(--cv-color-text-faint)]" data-testid={`spv-deployment-derivation-copy-${depId}`}>
            {d.copy}
          </div>
          {q.data?.divergence ? (
            <div className="text-[10px] font-medium" data-testid={`spv-deployment-derivation-divergence-${depId}`}>
              {q.data.divergence}
            </div>
          ) : null}
          {canWrite && !committed && d.wholeShares !== null ? (
            <Button
              variant="outline"
              onClick={() => onUseDerived(d.wholeShares as string)}
              data-testid={`spv-deployment-use-derived-${depId}`}
            >
              Use derived share count
            </Button>
          ) : null}
        </>
      )}

      {canWrite && !committed ? (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label htmlFor={`docref-${depId}`} className="text-[10px]">Closing doc ref</Label>
            <Input
              id={`docref-${depId}`}
              value={docRef}
              onChange={(e) => setDocRef(e.target.value)}
              placeholder="document reference"
              data-testid={`spv-deployment-docref-${depId}`}
            />
          </div>
          <Button
            variant="outline"
            disabled={sendDocs.isPending}
            onClick={() => sendDocs.mutate()}
            data-testid={`spv-deployment-docs-sent-${depId}`}
          >
            Mark closing docs sent
          </Button>
        </div>
      ) : null}

      {q.data?.closingDocRef ? (
        <div className="text-[10px] text-[var(--cv-color-text-faint)]" data-testid={`spv-deployment-closingdocref-${depId}`}>
          Closing doc ref on file: {q.data.closingDocRef}
        </div>
      ) : null}
    </div>
  );
}

/* ── ORP-051 / DEF-051 — investor-context LP roster ──────────────────────────
   GET /api/spv/:spvId/lp-roster was orphaned while its partner twin
   (/api/partner/me/spv/:spvId/lp-roster) was called. It is NOT a duplicate:
   the investor route gates on subscriber membership from the SESSION and omits
   co-investors server-side unless the GP set lp_visibility='co_investors'. It
   is the ONLY route an LP may use to see who else is in their SPV, so it is
   wired (not retired) into the investor-facing SPV view. */
/* ══════════════════════════════════════════════════════════════════════════════
   WAVE 163 · BLOCKER 1 · R137.1 — THE LP-FACING FIX NOW REACHES THE LP.
   ══════════════════════════════════════════════════════════════════════════════
   WHAT WENT WRONG, AND IT MADE WAVE 161 INVISIBLE. This component read
   `q.data?.subscribers ?? q.data?.roster`. The route it calls
   (`GET /api/spv/:spvId/lp-roster`, server/spvEngineRoutes.ts:1163 →
   `spvEngineStore.lpRosterForViewer`) has NEVER returned either key: it returns
   `entries`. So for every valid response this panel fell through to its empty
   state, and NONE of wave 161's stage labelling, capital split or committed-only
   ownership reached the investor. Wave 161's 10.48% proof was against the store
   function, not this mounted surface.

   WHY THE CLIENT MOVED AND NOT THE SERVER (R126.8 — consumers enumerated before
   choosing). The `entries` key is consumed by `server/spvEngineRoutes.ts:1167`
   (verbatim `res.json`) and asserted by name in `spvLpVisibility.test.ts`
   (:84/:87/:98/:100/:101/:108/:111), `wave161_itemA_aggregation_fence.test.ts`
   (:182/:214/:230/:238 + the source assertion at :582) and reached by
   `v25_50_group_b_spv.test.ts:189`. The GP TWIN route
   (`/api/partner/me/spv/:spvId/lp-roster`) is the surface that legitimately
   serves `subscribers`, and `v25_50_group_b_spv.test.ts:92` reads that key from
   it. Renaming the investor payload to `subscribers` would therefore break ~12
   existing assertions (R98: never lower an assertion count) AND collide the two
   routes' vocabularies. `entries` is ADDED as the first read key here; the two
   historical keys are RETAINED as fallbacks so no producer is dropped.

   WHAT THE LP NOW ACTUALLY SEES: their own share of COMMITTED CAPITAL (the
   figure wave 161 computed and nobody rendered), the all-stages share beside the
   words naming its denominator, every row's stage in words, a row that is not a
   commitment claiming NO committed share at all (`null`, never 0.0% — R111 Q13),
   and the vehicle's confirmed-versus-soft-circled split.

   Row view-models are hoisted into `useMemo` and the panel's JSX sibling shape is
   STATIC — every line is always present, carrying its own absence wording rather
   than disappearing. */
interface InvestorRosterRowView {
  key: string;
  name: string;
  amount: string;
  stageLabel: string;
  confirmedShare: string;
  allStagesShare: string;
}

/** Minor units, read WITHOUT coercion. A value that is not a safe integer is
 *  absent, not zero — so an unreadable amount can never print as $0.00. */
function rosterMinor(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

/** The words for "this row holds no share of committed capital", used when the
 *  server sent `null` — which it does for every pre-commitment stage. */
const INVESTOR_ROSTER_NO_COMMITTED_SHARE = "no share of committed capital — this is not a commitment";

export function InvestorSpvLpRosterPanel({ spvId, currency }: { spvId: string; currency: string }) {
  const q = useQuery<{
    entries?: Array<Record<string, unknown>>;
    subscribers?: Array<Record<string, unknown>>;
    roster?: Array<Record<string, unknown>>;
    visibility?: string;
    split?: Record<string, unknown>;
    splitStatement?: string | null;
    viewerStageLabel?: string;
    viewerIsConfirmedCapital?: boolean;
    denominatorLabel?: string;
    confirmedDenominatorLabel?: string;
  }>({
    queryKey: ["/api/spv", spvId, "lp-roster"],
    queryFn: async () => (await apiRequest("GET", `/api/spv/${spvId}/lp-roster`)).json(),
    retry: false,
  });
  const rows = (q.data?.entries ?? q.data?.subscribers ?? q.data?.roster ?? []) as Array<Record<string, unknown>>;
  const confirmedDenominatorLabel = q.data?.confirmedDenominatorLabel ?? "share of committed capital only";
  const allStagesDenominatorLabel = q.data?.denominatorLabel ?? "share of every non-withdrawn subscription at any stage";

  const views = useMemo<InvestorRosterRowView[]>(
    () =>
      rows.map((r, i) => {
        const id = String(r.investorId ?? i);
        const confirmedPct = r.ownershipPctOfConfirmedCapital;
        const allStagesPct = r.ownershipPctOfAllStages ?? r.ownershipPct;
        return {
          key: id,
          name: String(r.name ?? r.investorId ?? "LP"),
          amount: money(rosterMinor(r.commitmentMinor), currency),
          stageLabel: String(r.stageLabel ?? r.stage ?? "Not on record"),
          confirmedShare:
            typeof confirmedPct === "number"
              ? formatFractionAsPercent(confirmedPct)
              : INVESTOR_ROSTER_NO_COMMITTED_SHARE,
          allStagesShare:
            typeof allStagesPct === "number" ? formatFractionAsPercent(allStagesPct) : "Not on record",
        };
      }),
    [rows, currency],
  );

  const splitLines = useMemo(() => {
    const s = q.data?.split ?? {};
    return [
      { key: "confirmed", label: "Committed capital", value: money(rosterMinor(s.confirmedCapitalMinor), currency) },
      { key: "soft", label: "Soft-circled interest — not capital", value: money(rosterMinor(s.softCircledInterestMinor), currency) },
      { key: "wired", label: "Funds received, not yet committed", value: money(rosterMinor(s.wiredNotCommittedMinor), currency) },
      { key: "all", label: "All stages combined — capacity, not capital", value: money(rosterMinor(s.allStagesMinor), currency) },
    ];
  }, [q.data?.split, currency]);

  return (
    <PanelFrame
      title="Co-investors in this SPV"
      testid="investor-spv-lp-roster-panel"
      hint="Visible to LPs of this SPV only. The GP controls whether co-investor names are shown; when they are hidden the server omits them entirely rather than this page filtering them."
    >
      <StateLine loading={q.isLoading} error={q.error} empty={rows.length === 0} emptyText="No co-investors visible" testid="investor-spv-lp-roster" />
      <div className="text-[10px] text-[var(--cv-color-text-faint)] py-0.5" data-testid="investor-spv-lp-roster-viewer-stage">
        Your own subscription in this SPV: {q.data?.viewerStageLabel ?? "Not on record"}
      </div>
      {views.map((v) => (
        <div key={v.key} className="border-t py-1" data-testid={`investor-spv-lp-${v.key}`}>
          <div className="flex justify-between text-xs py-0.5">
            <div className="truncate">{v.name}</div>
            <div className="font-mono">{v.amount}</div>
          </div>
          <div className="text-[10px] text-[var(--cv-color-text-muted)]" data-testid={`investor-spv-lp-stage-${v.key}`}>
            Stage: {v.stageLabel}
          </div>
          <div className="text-[10px]" data-testid={`investor-spv-lp-ownership-confirmed-${v.key}`}>
            Ownership of committed capital: {v.confirmedShare}
          </div>
          <div className="text-[10px] text-[var(--cv-color-text-faint)]" data-testid={`investor-spv-lp-ownership-all-stages-${v.key}`}>
            Share of all stages: {v.allStagesShare} — {allStagesDenominatorLabel}
          </div>
        </div>
      ))}
      <div className="mt-2 border-t pt-1 text-[10px]" data-testid="investor-spv-lp-roster-split">
        <div className="text-[var(--cv-color-text-muted)]">What is capital here, and what is only interest ({confirmedDenominatorLabel})</div>
        {splitLines.map((l) => (
          <div key={l.key} className="flex justify-between" data-testid={`investor-spv-lp-roster-split-${l.key}`}>
            <div>{l.label}</div>
            <div className="font-mono">{l.value}</div>
          </div>
        ))}
        <div data-testid="investor-spv-lp-roster-split-statement">{q.data?.splitStatement ?? ""}</div>
      </div>
    </PanelFrame>
  );
}
