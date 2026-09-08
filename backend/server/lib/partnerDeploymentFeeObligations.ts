/* ════════════════════════════════════════════════════════════════════════════
 * WAVE 345 · ITEM 1 — THE FEE THE GP OWES BUT COULD NOT SEE.
 * ════════════════════════════════════════════════════════════════════════════
 * THE DEFECT, RE-VERIFIED IN THIS WAVE RATHER THAN INHERITED. `spv_deployment_fee_billing`
 * (migration 0162) is the ONE table that records "this vehicle owes a deployment
 * fee". Every reader of it was an ADMIN reader — counted by hand in this wave,
 * `=== 3` call sites, all three under `/api/admin/consortium-spv/...`
 * (server/spvEngineRoutes.ts:3102, :3111, :3133). ZERO partner routes read it.
 *
 * The partner's own "SPV Fees" tab reads `partner_billing_entries`
 * (server/lib/partnerSelfServiceRoutes.ts), and `partner_billing_entries` only
 * gains a row once a charge SUCCEEDS. So the exact state this table exists to
 * record — `state = 'pending'`, an obligation raised and NOT yet collected —
 * was invisible to the only person who owes the money. The GP saw the sentence
 * "No SPV fees yet" while the platform held a row saying otherwise.
 *
 * WHAT THIS MODULE IS. A READ. It writes nothing, charges nothing, and touches
 * no payment gateway (`paymentGatewayAdapter.ts` is frozen and its 503 is a
 * deliberate correct refusal — this module never calls it). It does not call the
 * admin reconciliation route. It is the missing SELECT, scoped to one partner.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THREE DESIGN RULES THIS FILE OBEYS, EACH BECAUSE SOMETHING WENT WRONG BEFORE
 * ────────────────────────────────────────────────────────────────────────────
 * 1. AN UNCOMPUTABLE FIGURE IS `null`, NEVER `0`.
 *    `openBillingRecord` inserts a `pending` row with `amount_minor` NULL and
 *    `currency` NULL — the obligation is recorded BEFORE it is priced. A `0`
 *    there would read on a GP's screen as "you owe nothing", which is the
 *    opposite of the truth. Every amount this module returns is either a stored
 *    integer or `null`, and `amountBasis` NAMES which. This follows
 *    `canonicalCommittedMinorForSpv`'s discipline: one authoritative figure, and
 *    a caller that can always tell where it came from.
 *
 * 2. NO SILENT EMPTY. The two existing readers in
 *    `spvEngineDeploymentFeeHook.ts` catch their own exceptions and return
 *    `null` / `[]`. A broken query is then indistinguishable from a clean "you
 *    owe nothing": green fence, green typecheck, EMPTY SCREEN. This module
 *    NEVER collapses a failure into an empty list. It returns
 *    `readFailed: true` with `readFailureCode`, and `rows: []` is then NOT a
 *    statement about money. The caller is required to render those two states
 *    differently, and `w345_deployment_fee_read_path.test.ts` asserts it does.
 *
 * 3. NO CURRENCY DEFAULT AND NO CROSS-CURRENCY SUM. `currency` is returned
 *    exactly as stored, `null` included. Totals are bucketed BY CURRENCY, and a
 *    row whose currency is unknown goes into its own explicitly-labelled
 *    `unknownCurrencyRows` count rather than being quietly counted as USD. This
 *    platform is multi-currency; `|| "USD"` on a read is a lie on screen.
 *
 * TENANT SCOPING. `spv_deployment_fee_billing` has NO `tenant_id` column (see
 * the DDL in migration 0162), so `lint:tenant-scope-fence`, which derives its
 * scoped-table set from the migrations at run time, does not cover it and no
 * exemption marker is required. The scope that DOES apply is `partner_id`, and
 * every statement below is parameterised on it. The `spv` engine table likewise
 * carries no `tenant_id`; its ownership column is `sponsor_partner_id`, and the
 * join below requires BOTH to agree so a mis-stamped billing row cannot leak a
 * vehicle belonging to another partner.
 * ════════════════════════════════════════════════════════════════════════════ */
import { rawDb } from "../db/connection";
import { log } from "./logger";
import {
  DEPLOYMENT_FEE_BILLING_TABLE,
  ensureBillingTable,
  type SpvDeploymentFeeBasis,
} from "./spvEngineDeploymentFeeHook";

/** Where a displayed amount came from. Rendered in words on the partner screen;
 *  nothing branches on it in a money computation. */
export type DeploymentFeeAmountBasis =
  /** `amount_minor` was stored on the billing row by a collection attempt. */
  | "recorded_on_billing_row"
  /** The obligation exists but has not been priced yet: `amount_minor` is NULL.
   *  The amount is `null`, NOT `0`. */
  | "not_yet_priced";

export interface PartnerDeploymentFeeObligation {
  spvId: string;
  /** From `spv.name`; `null` when the vehicle row is missing (an orphaned
   *  billing row — reported, not hidden, and not silently dropped by the join). */
  spvName: string | null;
  /** `spv.status` as stored. `null` for an orphaned billing row. */
  spvStatus: string | null;
  /** `spv.jurisdiction` as stored — a GP with vehicles in several places needs
   *  to know WHICH one this fee belongs to. */
  spvJurisdiction: string | null;
  state: "pending" | "charged";
  /** Integer minor units, or `null` when not yet priced. NEVER `0` as a stand-in. */
  amountMinor: number | null;
  amountBasis: DeploymentFeeAmountBasis;
  /** Exactly as stored, `null` included. NEVER defaulted to "USD". */
  currency: string | null;
  /** Which measure chose the fee band, when a band was chosen. */
  feeBasis: SpvDeploymentFeeBasis | null;
  basisSizeMinor: number | null;
  attempts: number;
  /** The machine reason from the last collection attempt, as stored. The client
   *  turns this into a sentence; this module does not invent prose. */
  lastReason: string | null;
  lastAttemptAt: string | null;
  chargedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** TRUE when a matching `partner_billing_entries` row exists, i.e. the fee has
   *  reached the invoice ledger the "SPV Fees" table already renders. A
   *  `charged` obligation with `invoiced: false` is a real inconsistency and is
   *  shown as one rather than reconciled away here. */
  invoiced: boolean;
}

export interface PartnerDeploymentFeeObligationsResult {
  rows: PartnerDeploymentFeeObligation[];
  /** How many rows the SELECT actually returned. Present so a caller — and a
   *  test — can assert `rowsRead > 0` instead of merely asserting no throw. */
  rowsRead: number;
  /** FALSE means WE DO NOT KNOW, not "nothing is owed". */
  readOk: boolean;
  /** A short machine code when `readOk` is false. `null` when the read worked. */
  readFailureCode: string | null;
  /** Per-currency pending/charged sums in minor units. Keyed by the currency AS
   *  STORED. Nothing is converted and nothing is summed across currencies. */
  totalsByCurrency: Record<string, { pendingMinor: number; chargedMinor: number }>;
  /** Rows excluded from every total because their currency is unknown, or their
   *  amount was never priced. Counted, never folded into a number. */
  unpricedRows: number;
  unknownCurrencyRows: number;
}

const FAILURE_TABLE_UNAVAILABLE = "DEPLOYMENT_FEE_TABLE_UNAVAILABLE";
const FAILURE_QUERY_FAILED = "DEPLOYMENT_FEE_QUERY_FAILED";
const FAILURE_NO_DB_HANDLE = "DEPLOYMENT_FEE_NO_DB_HANDLE";

function failure(code: string): PartnerDeploymentFeeObligationsResult {
  return {
    rows: [],
    rowsRead: 0,
    readOk: false,
    readFailureCode: code,
    totalsByCurrency: {},
    unpricedRows: 0,
    unknownCurrencyRows: 0,
  };
}

/**
 * Every deployment-fee obligation recorded against ONE partner, in both states.
 *
 * A `charged` row is included deliberately. The GP needs the same list the
 * platform's own billing engine holds, not a filtered view that happens to
 * agree with the invoice ledger — the disagreement is the interesting part.
 */
export function listPartnerDeploymentFeeObligations(
  partnerId: string,
): PartnerDeploymentFeeObligationsResult {
  if (!partnerId) return failure(FAILURE_NO_DB_HANDLE);
  let raw: any;
  try {
    raw = rawDb();
  } catch (err) {
    log.warn(`[w345-fee-read] no database handle: ${String(err)}`);
    return failure(FAILURE_NO_DB_HANDLE);
  }
  /* `ensureBillingTable` returns false when the table is neither present nor
   * creatable. That is a FAILURE, not an empty result — the distinction this
   * whole module exists to preserve. */
  if (!ensureBillingTable(raw)) return failure(FAILURE_TABLE_UNAVAILABLE);

  let raws: any[];
  try {
    raws = raw
      .prepare(
        `SELECT b.spv_id            AS spvId,
                b.partner_id        AS partnerId,
                b.state             AS state,
                b.attempts          AS attempts,
                b.last_reason       AS lastReason,
                b.last_attempt_at   AS lastAttemptAt,
                b.amount_minor      AS amountMinor,
                b.currency          AS currency,
                b.charged_at        AS chargedAt,
                b.created_at        AS createdAt,
                b.updated_at        AS updatedAt,
                b.fee_basis         AS feeBasis,
                b.basis_size_minor  AS basisSizeMinor,
                s.name              AS spvName,
                s.status            AS spvStatus,
                s.jurisdiction      AS spvJurisdiction,
                (SELECT COUNT(*) FROM partner_billing_entries pbe
                  WHERE pbe.partner_id = b.partner_id
                    AND pbe.spv_fund_id = b.spv_id
                    AND pbe.entry_kind = 'spv_deployment_fee') AS invoicedCount
           FROM ${DEPLOYMENT_FEE_BILLING_TABLE} b
           /* LEFT JOIN, and the ownership predicate is on the JOIN rather than
            * in WHERE: an orphaned or mis-stamped billing row must still appear
            * for the partner it is stamped to, with a null name, instead of
            * vanishing from a GP's bill. An INNER JOIN here would hide exactly
            * the rows most likely to be wrong. */
           LEFT JOIN spv s
                  ON s.id = b.spv_id
                 AND s.sponsor_partner_id = b.partner_id
          WHERE b.partner_id = ?
          ORDER BY CASE b.state WHEN 'pending' THEN 0 ELSE 1 END, b.updated_at DESC`,
      )
      .all(partnerId) as any[];
  } catch (err) {
    /* CAUGHT AND REPORTED, NOT SWALLOWED. `rows: []` never ships with
     * `readOk: true` from this path. */
    log.warn(`[w345-fee-read] obligation query failed for ${partnerId}: ${String(err)}`);
    return failure(FAILURE_QUERY_FAILED);
  }

  const totalsByCurrency: Record<string, { pendingMinor: number; chargedMinor: number }> = {};
  let unpricedRows = 0;
  let unknownCurrencyRows = 0;

  const rows: PartnerDeploymentFeeObligation[] = raws.map((r) => {
    const amountMinor =
      r.amountMinor === null || r.amountMinor === undefined ? null : Number(r.amountMinor);
    const currency = r.currency === null || r.currency === undefined || r.currency === "" ? null : String(r.currency);
    if (amountMinor === null) unpricedRows += 1;
    else if (currency === null) unknownCurrencyRows += 1;
    else {
      if (!totalsByCurrency[currency]) totalsByCurrency[currency] = { pendingMinor: 0, chargedMinor: 0 };
      if (r.state === "charged") totalsByCurrency[currency].chargedMinor += amountMinor;
      else totalsByCurrency[currency].pendingMinor += amountMinor;
    }
    return {
      spvId: String(r.spvId),
      spvName: r.spvName ?? null,
      spvStatus: r.spvStatus ?? null,
      spvJurisdiction: r.spvJurisdiction ?? null,
      state: r.state === "charged" ? "charged" : "pending",
      amountMinor,
      amountBasis: amountMinor === null ? "not_yet_priced" : "recorded_on_billing_row",
      currency,
      feeBasis: (r.feeBasis ?? null) as SpvDeploymentFeeBasis | null,
      basisSizeMinor:
        r.basisSizeMinor === null || r.basisSizeMinor === undefined ? null : Number(r.basisSizeMinor),
      attempts: Number(r.attempts ?? 0),
      lastReason: r.lastReason ?? null,
      lastAttemptAt: r.lastAttemptAt ?? null,
      chargedAt: r.chargedAt ?? null,
      createdAt: String(r.createdAt),
      updatedAt: String(r.updatedAt),
      invoiced: Number(r.invoicedCount ?? 0) > 0,
    };
  });

  return {
    rows,
    rowsRead: rows.length,
    readOk: true,
    readFailureCode: null,
    totalsByCurrency,
    unpricedRows,
    unknownCurrencyRows,
  };
}
