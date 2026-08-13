/**
 * server/lib/wave15CarryAccrual.ts
 *
 * WAVE 15 — M-5. ACCRUED CARRY AT AN AS-OF DATE, honouring
 *   - the per-deployment vs whole-SPV carry basis (`spv.carry_basis`,
 *     shared/spvEngine.ts SPV_CARRY_BASES — the GP chooses, there is no default),
 *   - the preferred return (hurdle) and its kind (`none` | `hard` | `soft`),
 *   - the GP catch-up.
 *
 * SINK: `spv_carry_accrual` (migration 0170:231). That table was created by
 * Wave 14 with a DATABASE-LEVEL cent-conservation CHECK
 * (`carry_minor + catch_up_minor + lp_net_minor = distributed_minor`) and had
 * ZERO writers and ZERO readers tree-wide — verified by grep before this file
 * was written. This module is its only writer.
 *
 * MONEY RULES OBSERVED
 *   - Every internal quantity is an exact `bigint` in integer minor units.
 *   - Rates are converted with `exactFractionToCarryScaled` (money.ts), which
 *     REJECTS a float carrying unsupported precision rather than rounding it.
 *   - `Math.round` is never applied to a per-party share. Every tier truncates
 *     the GP side and gives the truncation remainder to the LPs, so the split
 *     is exact by construction and the DB CHECK can never fire. The bias
 *     direction is deliberate and documented: sub-cent ambiguity favours the LP.
 *   - Percentages are FRACTIONS end to end. Nothing here multiplies or divides
 *     by 100.
 *
 * DELIBERATE CONTRAST WITH `server/lib/spvOfflineOps.ts:141-170`, which runs the
 * same waterfall with `Math.round(remaining * carryPct)` per tier. That module
 * is the OFFLINE/quote path and is out of scope for this item; this module does
 * not call it, and the divergence is recorded in the Wave 15 report rather than
 * being silently tolerated. Nothing here changes that file.
 */
import { rawDb } from "../db/connection";
import { randomUUID } from "crypto";
import { log } from "./logger";
import { exactFractionToCarryScaled, CARRY_FRACTION_SCALE } from "./money";
import {
  ILPA_CONTRIBUTION_TYPES,
  ILPA_DISTRIBUTION_TYPES,
  type IlpaTransactionType,
} from "@capavate/math-fns";
import { listFlows, type ChainedFlowRow } from "./ilpaCashflowLedger";

const SCALE = BigInt(CARRY_FRACTION_SCALE);
const ZERO = BigInt(0);

export class CarryAccrualError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "CarryAccrualError";
  }
}

export type CarryBasis = "per_deployment" | "whole_spv";
export type HurdleKind = "none" | "hard" | "soft";

/**
 * The hurdle accrual convention. STORED, not hardcoded: the value is read from
 * `wave9_reporting_config['carry.hurdle_convention']` (migration 0171) and an
 * unrecognised value THROWS. M-5 is `owner_decision = N` in
 * spec/_remaining_w14.tsv, so the seeded default is the build's choice and is
 * recorded with its rationale in `build_policy_decision`
 * (key `carry.hurdle_convention`, migration 0171) so it is inspectable and
 * changeable without a code edit.
 *
 *   simple_act_365   — non-compounding preferred return, accrued per
 *                      contribution from its value date to the as-of date,
 *                      ACT/365. rate * days / 365, truncated to the cent.
 *   none             — no time value: the preferred return is zero regardless
 *                      of the stored hurdle rate. Provided so an operator can
 *                      disable pref accrual without editing the terms row.
 */
export const HURDLE_CONVENTIONS = Object.freeze(["simple_act_365", "none"] as const);
export type HurdleConvention = (typeof HURDLE_CONVENTIONS)[number];
export const HURDLE_CONVENTION_CONFIG_KEY = "carry.hurdle_convention";

export interface CarryTerms {
  spvId: string;
  tenantId: string;
  hurdleRateFraction: number;
  hurdleKind: HurdleKind;
  catchUpRateFraction: number;
  gpCommitmentMinor: number;
  currency: string;
}

export interface CarryComponentInput {
  /** Component label. `whole_spv` for the single-component basis. */
  key: string;
  contributions: Array<{ valueDate: string; amountMinor: number }>;
  distributionsMinor: number;
}

export interface CarryComponentResult {
  key: string;
  contributedMinor: number;
  distributedMinor: number;
  hurdleOwedMinor: number;
  hurdleMet: boolean;
  carryMinor: number;
  catchUpMinor: number;
  lpNetMinor: number;
}

export interface CarryAccrualResult {
  spvId: string;
  asOfDate: string;
  basis: CarryBasis;
  convention: HurdleConvention;
  contributedMinor: number;
  distributedMinor: number;
  hurdleOwedMinor: number;
  hurdleMet: boolean;
  carryMinor: number;
  catchUpMinor: number;
  lpNetMinor: number;
  currency: string;
  carryRateFraction: number;
  hurdleRateFraction: number;
  catchUpRateFraction: number;
  hurdleKind: HurdleKind;
  componentCount: number;
  components: CarryComponentResult[];
}

/* ==========================================================================
 * PURE MATH — no DB, no clock. This is what the tests hammer.
 * ======================================================================== */

function requireDay(s: string, label: string): number {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(s)) {
    throw new CarryAccrualError("CARRY_ACCRUAL_INVALID_DATE", `CARRY_ACCRUAL_INVALID_DATE:${label}=${String(s)}`);
  }
  const t = Date.parse(`${s.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(t)) {
    throw new CarryAccrualError("CARRY_ACCRUAL_INVALID_DATE", `CARRY_ACCRUAL_INVALID_DATE:${label}=${s}`);
  }
  return t;
}

function requireMinor(v: number, label: string): bigint {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) {
    throw new CarryAccrualError("CARRY_ACCRUAL_INVALID_MINOR", `CARRY_ACCRUAL_INVALID_MINOR:${label}=${String(v)}`);
  }
  return BigInt(v);
}

/**
 * Preferred return owed on ONE contribution at the as-of date, exact integer
 * truncation. A contribution dated AFTER the as-of date accrues nothing (and is
 * not an error — it simply has not happened yet at the reporting date).
 */
export function hurdleOwedForContribution(args: {
  amountMinor: number;
  valueDate: string;
  asOfDate: string;
  hurdleRateFraction: number;
  convention: HurdleConvention;
}): bigint {
  if (args.convention === "none") return ZERO;
  const amount = requireMinor(args.amountMinor, "contribution.amountMinor");
  const from = requireDay(args.valueDate, "contribution.valueDate");
  const to = requireDay(args.asOfDate, "asOfDate");
  if (to <= from) return ZERO;
  const days = BigInt(Math.floor((to - from) / 86400000));
  const rate = exactFractionToCarryScaled(args.hurdleRateFraction, "hurdleRateFraction");
  if (rate === ZERO) return ZERO;
  // amount * rate/SCALE * days/365, ONE truncation at the end so the day count
  // and the rate cannot each lose a cent independently.
  return (amount * rate * days) / (SCALE * BigInt(365));
}

/**
 * THE WATERFALL, at one as-of date, for one component. Pure and exact.
 *
 * Tier 1  return of capital to the LPs, up to contributed capital.
 * Tier 2  preferred return to the LPs, up to the accrued hurdle.
 * Tier 3  GP catch-up — ONLY when hurdleKind is `soft`. A `hard` hurdle means
 *         the GP takes carry solely on profit ABOVE the pref, which is exactly
 *         "no catch-up". `none` has no pref to catch up on.
 * Tier 4  residual split: carryRate to the GP, remainder to the LPs.
 *
 * POST-CONDITION, asserted before return: carry + catchUp + lpNet ===
 * distributed. This is the same invariant the `spv_carry_accrual` CHECK
 * enforces, asserted here so a bad split fails in the engine with a legible
 * message instead of as a SQLITE_CONSTRAINT.
 */
export function computeComponentCarry(args: {
  contributedMinor: bigint;
  distributedMinor: bigint;
  hurdleOwedMinor: bigint;
  hurdleKind: HurdleKind;
  carryRateFraction: number;
  catchUpRateFraction: number;
}): { carry: bigint; catchUp: bigint; lpNet: bigint; hurdleMet: boolean } {
  const carryRate = exactFractionToCarryScaled(args.carryRateFraction, "carryRateFraction");
  const catchUpRate = exactFractionToCarryScaled(args.catchUpRateFraction, "catchUpRateFraction");
  const distributed = args.distributedMinor;
  if (distributed < ZERO) {
    throw new CarryAccrualError("CARRY_ACCRUAL_INVALID_MINOR", "CARRY_ACCRUAL_INVALID_MINOR:distributedMinor<0");
  }

  const pref = args.hurdleKind === "none" ? ZERO : args.hurdleOwedMinor;

  let remaining = distributed;
  let lp = ZERO;

  // Tier 1 — return of capital.
  const roc = remaining < args.contributedMinor ? remaining : args.contributedMinor;
  lp += roc;
  remaining -= roc;

  // Tier 2 — preferred return.
  const prefPaid = remaining < pref ? remaining : pref;
  lp += prefPaid;
  remaining -= prefPaid;
  const hurdleMet = pref === ZERO ? true : prefPaid >= pref;

  // Tier 3 — GP catch-up (soft hurdle only).
  let catchUp = ZERO;
  if (args.hurdleKind === "soft" && prefPaid > ZERO && carryRate > ZERO && carryRate < SCALE && catchUpRate > ZERO) {
    // Full catch-up = carry/(1-carry) * prefPaid, so that after the catch-up the
    // GP holds `carry` of (pref + catchUp). Truncated (GP side), never rounded.
    const full = (carryRate * prefPaid) / (SCALE - carryRate);
    // The catch-up RATE throttles how fast the residual is applied to it.
    const throttled = (remaining * catchUpRate) / SCALE;
    catchUp = full < throttled ? full : throttled;
    if (catchUp > remaining) catchUp = remaining;
    remaining -= catchUp;
  }

  // Tier 4 — residual split. GP side truncated; the remainder stays with the LP.
  const residualCarry = (remaining * carryRate) / SCALE;
  const carry = residualCarry;
  lp += remaining - residualCarry;

  const total = carry + catchUp + lp;
  if (total !== distributed) {
    throw new CarryAccrualError(
      "CARRY_ACCRUAL_NOT_CONSERVED",
      `CARRY_ACCRUAL_NOT_CONSERVED:carry=${carry}:catchUp=${catchUp}:lpNet=${lp}:distributed=${distributed}`,
    );
  }
  if (carry < ZERO || catchUp < ZERO || lp < ZERO) {
    throw new CarryAccrualError(
      "CARRY_ACCRUAL_NEGATIVE_SHARE",
      `CARRY_ACCRUAL_NEGATIVE_SHARE:carry=${carry}:catchUp=${catchUp}:lpNet=${lp}`,
    );
  }
  return { carry, catchUp, lpNet: lp, hurdleMet };
}

/* ==========================================================================
 * DB-BOUND RESOLUTION
 * ======================================================================== */

export function readHurdleConvention(): HurdleConvention {
  let raw: unknown;
  try {
    const row = rawDb()
      .prepare(`SELECT value_json FROM wave9_reporting_config WHERE key = ?`)
      .get(HURDLE_CONVENTION_CONFIG_KEY) as { value_json?: string } | undefined;
    if (!row?.value_json) {
      throw new CarryAccrualError(
        "CARRY_HURDLE_CONVENTION_MISSING",
        `CARRY_HURDLE_CONVENTION_MISSING: ${HURDLE_CONVENTION_CONFIG_KEY} is not seeded. ` +
          `Migration 0171 seeds it; a missing row is a schema gap, not a licence to default.`,
      );
    }
    raw = JSON.parse(row.value_json);
  } catch (err) {
    if (err instanceof CarryAccrualError) throw err;
    throw new CarryAccrualError("CARRY_HURDLE_CONVENTION_MISSING", `CARRY_HURDLE_CONVENTION_MISSING: ${String(err)}`);
  }
  if (typeof raw !== "string" || !(HURDLE_CONVENTIONS as readonly string[]).includes(raw)) {
    throw new CarryAccrualError(
      "CARRY_HURDLE_CONVENTION_OUT_OF_DOMAIN",
      `CARRY_HURDLE_CONVENTION_OUT_OF_DOMAIN: ${JSON.stringify(raw)} is not one of ${HURDLE_CONVENTIONS.join(", ")}`,
    );
  }
  return raw as HurdleConvention;
}

/** Terms from `spv_carry_terms` (0159:201). Absent row => the item is not
 *  configured, and that is reported rather than defaulted to a zero hurdle. */
export function readCarryTerms(spvId: string): CarryTerms {
  const row = rawDb()
    .prepare(
      `SELECT spv_id, tenant_id, hurdle_rate, hurdle_kind, catch_up_rate, gp_commitment_minor, currency
         FROM spv_carry_terms WHERE spv_id = ?`,
    )
    .get(spvId) as any;
  if (!row) {
    throw new CarryAccrualError(
      "CARRY_TERMS_MISSING",
      `CARRY_TERMS_MISSING: no spv_carry_terms row for ${spvId}. Set the terms before accruing carry.`,
    );
  }
  return {
    spvId: row.spv_id,
    tenantId: row.tenant_id,
    hurdleRateFraction: Number(row.hurdle_rate),
    hurdleKind: row.hurdle_kind as HurdleKind,
    catchUpRateFraction: Number(row.catch_up_rate),
    gpCommitmentMinor: Number(row.gp_commitment_minor ?? 0),
    currency: String(row.currency),
  };
}

/**
 * The GP carry rate for the SPV, from `spv_fee` (the engine's fee table) —
 * layer `management`, the SPONSOR's carry. The PLATFORM carry layer is a
 * different payee and is charged by `allocateDistributionMinor` at distribution
 * time; folding it in here would double-count it as GP carry, so it is
 * deliberately excluded and returned separately for disclosure.
 */
export function readCarryRates(spvId: string): { gpCarryFraction: number; platformCarryFraction: number } {
  let rows: any[] = [];
  try {
    rows = rawDb()
      .prepare(`SELECT layer, fee_type, carry_pct FROM spv_fee WHERE spv_id = ?`)
      .all(spvId) as any[];
  } catch (err) {
    log.warn(`[w15-carry] spv_fee read failed for ${spvId}: ${String(err)}`);
  }
  let gp = 0;
  let platform = 0;
  for (const r of rows) {
    if (r.fee_type === "fixed") continue;
    const v = Number(r.carry_pct ?? 0);
    if (!Number.isFinite(v) || v < 0 || v > 1) continue;
    if (r.layer === "management" || r.layer === "sponsor" || r.layer === "gp") gp = v;
    else if (r.layer === "platform") platform = v;
  }
  return { gpCarryFraction: gp, platformCarryFraction: platform };
}

export function readCarryBasis(spvId: string): CarryBasis {
  const row = rawDb().prepare(`SELECT carry_basis FROM spv WHERE id = ?`).get(spvId) as
    | { carry_basis?: string }
    | undefined;
  const v = row?.carry_basis;
  if (v !== "per_deployment" && v !== "whole_spv") {
    throw new CarryAccrualError(
      "CARRY_BASIS_UNSET",
      `CARRY_BASIS_UNSET: spv ${spvId} has carry_basis=${JSON.stringify(v)}. ` +
        `SPV_CARRY_BASES has no default — the GP must choose, so accrual refuses rather than assuming whole_spv.`,
    );
  }
  return v;
}

const IS_CONTRIBUTION = new Set<string>(ILPA_CONTRIBUTION_TYPES as readonly string[]);
const IS_DISTRIBUTION = new Set<string>(ILPA_DISTRIBUTION_TYPES as readonly string[]);

/**
 * Split the SPV's flows into carry components according to the basis.
 *
 * per_deployment — one component per `source_ref` on flows whose `source_kind`
 *   is `spv_deployment`. Flows with no deployment attribution form a single
 *   explicit `unattributed` component; they are NOT dropped and NOT folded into
 *   an arbitrary deployment, because either would move money between
 *   components silently.
 * whole_spv — exactly one component.
 */
export function partitionFlows(flows: readonly ChainedFlowRow[], basis: CarryBasis, asOfDate: string): CarryComponentInput[] {
  const asOf = requireDay(asOfDate, "asOfDate");
  const byKey = new Map<string, CarryComponentInput>();
  for (const f of flows) {
    if (!f.valueDate || requireDay(f.valueDate, "flow.valueDate") > asOf) continue;
    const key =
      basis === "whole_spv"
        ? "whole_spv"
        : f.sourceKind === "spv_deployment" && f.sourceRef
          ? `deployment:${f.sourceRef}`
          : "unattributed";
    let comp = byKey.get(key);
    if (!comp) {
      comp = { key, contributions: [], distributionsMinor: 0 };
      byKey.set(key, comp);
    }
    const t = f.txnType as IlpaTransactionType;
    const abs = Math.abs(Math.trunc(f.amountMinor));
    if (IS_CONTRIBUTION.has(t)) comp.contributions.push({ valueDate: f.valueDate.slice(0, 10), amountMinor: abs });
    else if (IS_DISTRIBUTION.has(t)) comp.distributionsMinor += abs;
  }
  // Stable order so `component_count` and the persisted row are deterministic.
  return Array.from(byKey.values()).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * Compute accrued carry for an SPV at an as-of date. READ-ONLY: no write. The
 * caller persists with `persistCarryAccrual` so a report can be produced
 * without mutating anything.
 */
export function computeCarryAccrual(args: { spvId: string; asOfDate: string; basisOverride?: CarryBasis }): CarryAccrualResult {
  const asOfDate = String(args.asOfDate).slice(0, 10);
  requireDay(asOfDate, "asOfDate");
  const terms = readCarryTerms(args.spvId);
  const basis = args.basisOverride ?? readCarryBasis(args.spvId);
  const convention = readHurdleConvention();
  const rates = readCarryRates(args.spvId);

  const flows = listFlows({ vehicleKind: "spv", vehicleId: args.spvId });
  const comps = partitionFlows(flows, basis, asOfDate);

  const results: CarryComponentResult[] = [];
  let tContrib = ZERO;
  let tDist = ZERO;
  let tHurdle = ZERO;
  let tCarry = ZERO;
  let tCatch = ZERO;
  let tLp = ZERO;
  let allMet = true;

  for (const c of comps) {
    let contributed = ZERO;
    let hurdle = ZERO;
    for (const k of c.contributions) {
      contributed += requireMinor(k.amountMinor, "contribution");
      hurdle += hurdleOwedForContribution({
        amountMinor: k.amountMinor,
        valueDate: k.valueDate,
        asOfDate,
        hurdleRateFraction: terms.hurdleKind === "none" ? 0 : terms.hurdleRateFraction,
        convention,
      });
    }
    const distributed = requireMinor(c.distributionsMinor, "distributions");
    const split = computeComponentCarry({
      contributedMinor: contributed,
      distributedMinor: distributed,
      hurdleOwedMinor: hurdle,
      hurdleKind: terms.hurdleKind,
      carryRateFraction: rates.gpCarryFraction,
      catchUpRateFraction: terms.catchUpRateFraction,
    });
    results.push({
      key: c.key,
      contributedMinor: Number(contributed),
      distributedMinor: Number(distributed),
      hurdleOwedMinor: Number(hurdle),
      hurdleMet: split.hurdleMet,
      carryMinor: Number(split.carry),
      catchUpMinor: Number(split.catchUp),
      lpNetMinor: Number(split.lpNet),
    });
    tContrib += contributed;
    tDist += distributed;
    tHurdle += hurdle;
    tCarry += split.carry;
    tCatch += split.catchUp;
    tLp += split.lpNet;
    if (!split.hurdleMet) allMet = false;
  }

  // The aggregate must conserve too — component sums, not a re-derivation.
  if (tCarry + tCatch + tLp !== tDist) {
    throw new CarryAccrualError(
      "CARRY_ACCRUAL_NOT_CONSERVED",
      `CARRY_ACCRUAL_NOT_CONSERVED:aggregate:carry=${tCarry}:catchUp=${tCatch}:lpNet=${tLp}:distributed=${tDist}`,
    );
  }

  return {
    spvId: args.spvId,
    asOfDate,
    basis,
    convention,
    contributedMinor: Number(tContrib),
    distributedMinor: Number(tDist),
    hurdleOwedMinor: Number(tHurdle),
    hurdleMet: allMet,
    carryMinor: Number(tCarry),
    catchUpMinor: Number(tCatch),
    lpNetMinor: Number(tLp),
    currency: terms.currency,
    carryRateFraction: rates.gpCarryFraction,
    hurdleRateFraction: terms.hurdleKind === "none" ? 0 : terms.hurdleRateFraction,
    catchUpRateFraction: terms.catchUpRateFraction,
    hurdleKind: terms.hurdleKind,
    componentCount: results.length,
    components: results,
  };
}

/**
 * Persist one accrual row. Idempotent on (spv_id, as_of_date, basis) — the
 * UNIQUE key from 0170 — so re-running a report for the same date updates that
 * row instead of appending a second, contradictory one.
 */
export function persistCarryAccrual(r: CarryAccrualResult, actorId: string): string {
  const terms = readCarryTerms(r.spvId);
  const id = `sca_${randomUUID()}`;
  const now = new Date().toISOString();
  rawDb()
    .prepare(
      `INSERT INTO spv_carry_accrual
         (id, spv_id, tenant_id, as_of_date, basis, contributed_minor, distributed_minor,
          hurdle_owed_minor, hurdle_met, carry_minor, catch_up_minor, lp_net_minor, currency,
          carry_rate_fraction, hurdle_rate_fraction, catch_up_rate_fraction, hurdle_kind,
          component_count, computed_at, computed_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(spv_id, as_of_date, basis) DO UPDATE SET
         contributed_minor=excluded.contributed_minor,
         distributed_minor=excluded.distributed_minor,
         hurdle_owed_minor=excluded.hurdle_owed_minor,
         hurdle_met=excluded.hurdle_met,
         carry_minor=excluded.carry_minor,
         catch_up_minor=excluded.catch_up_minor,
         lp_net_minor=excluded.lp_net_minor,
         currency=excluded.currency,
         carry_rate_fraction=excluded.carry_rate_fraction,
         hurdle_rate_fraction=excluded.hurdle_rate_fraction,
         catch_up_rate_fraction=excluded.catch_up_rate_fraction,
         hurdle_kind=excluded.hurdle_kind,
         component_count=excluded.component_count,
         computed_at=excluded.computed_at,
         computed_by=excluded.computed_by`,
    )
    .run(
      id,
      r.spvId,
      terms.tenantId,
      r.asOfDate,
      r.basis,
      r.contributedMinor,
      r.distributedMinor,
      r.hurdleOwedMinor,
      r.hurdleMet ? 1 : 0,
      r.carryMinor,
      r.catchUpMinor,
      r.lpNetMinor,
      r.currency,
      r.carryRateFraction,
      r.hurdleRateFraction,
      r.catchUpRateFraction,
      r.hurdleKind,
      r.componentCount,
      now,
      actorId,
    );
  const row = rawDb()
    .prepare(`SELECT id FROM spv_carry_accrual WHERE spv_id = ? AND as_of_date = ? AND basis = ?`)
    .get(r.spvId, r.asOfDate, r.basis) as { id: string } | undefined;
  return row?.id ?? id;
}

export function listCarryAccruals(spvId: string): any[] {
  try {
    return rawDb()
      .prepare(
        `SELECT * FROM spv_carry_accrual WHERE spv_id = ? ORDER BY as_of_date DESC, basis`,
      )
      .all(spvId) as any[];
  } catch (err) {
    log.warn(`[w15-carry] listCarryAccruals failed for ${spvId}: ${String(err)}`);
    return [];
  }
}
