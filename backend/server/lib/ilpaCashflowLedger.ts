// server/lib/ilpaCashflowLedger.ts
//
// WAVE 10 — EN-1. The ONLY writer for `vehicle_cashflow`, and the chain
// verifier for it.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT WAS ALREADY THERE. This is the tenth time in this build that a thing
// believed missing turned out to exist and need wiring rather than building.
//   · the table            migrations/0159_wave9_reporting_audit.sql:48-86
//                          (STRICT, all 14 ILPA types, integer minor units)
//   · the taxonomy + math  packages/math-fns/src/ilpa.ts:37-142
//                          (ILPA_TRANSACTION_TYPES, isContributionType,
//                           assertSignConvention, and computeFundMetrics for
//                           IRR / DPI / TVPI)
//   · a raw insert helper  server/wave9ReportingStore.ts:144 recordCashflow()
// What did NOT exist: any producer (recordCashflow had ZERO non-test callers),
// any route, and the append-only hash chain the EN-1 item explicitly names.
// An engine with no route is not shipped.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS MODULE EXISTS RATHER THAN MORE FUNCTIONS IN wave9ReportingStore.
// `recordCashflow()` writes a row with no chain fields, and it is already
// referenced by the Wave 9 test suite. Widening it in place would leave two
// write paths — one chained, one not — and the unchained one would keep
// working, silently producing rows the verifier reports as `unchained`. One
// writer, one door. `recordCashflow()` is left alone as the low-level insert
// this module calls through; nothing else may call it, which
// server/__tests__/waveW10_en1_cashflow_ledger.test.ts asserts by grep.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE CHAIN. Identical idiom to the SPV engine's existing chains
// (server/spvFundStore.ts:435-444, "Chains are partitioned per spv_id"):
//
//   curr_hash = sha256( prev_hash ?? "" | canonical-JSON-of-payload )
//
// partitioned per (vehicle_kind, vehicle_id). The payload is serialised with
// explicitly ordered keys, never `JSON.stringify(obj)` over an object literal,
// because key order in a literal is a refactor away from changing and would
// invalidate every historical hash.
//
// MONEY. Integer minor units throughout. `amountMinor` is asserted to be a
// safe integer before it reaches SQL; there is no rounding anywhere in this
// file and no per-party division, so the money.ts allocation helpers are not
// needed here — this ledger records amounts that were already allocated
// upstream. Where an upstream caller must split, it must do so with
// server/lib/money.ts and hand us the resulting integers.
import { createHash, randomUUID } from "node:crypto";
import { rawDb } from "../db/connection";
import { isSqlite } from "../db/portable";
import { log } from "./logger";
import { ensureWave9Schema } from "../wave9ReportingStore";
import { applyWave10EngineSchema } from "./applyWave10EngineSchema";
import {
  assertSignConvention,
  isContributionType,
  isDistributionType,
  isIlpaTransactionType,
  ILPA_RECALLABLE_TYPES,
  type IlpaFlow,
  type IlpaTransactionType,
} from "@capavate/math-fns";

export type VehicleKind = "spv" | "fund" | "company" | "portfolio";

export interface ChainedFlowRow extends IlpaFlow {
  id: string;
  tenantId: string;
  vehicleKind: VehicleKind;
  vehicleId: string;
  sourceKind: string;
  sourceRef: string | null;
  createdBy: string;
  createdAt: string;
  chainSeq: number | null;
  prevHash: string | null;
  currHash: string | null;
}

export interface AppendFlowInput {
  tenantId: string;
  vehicleKind: VehicleKind;
  vehicleId: string;
  lpId?: string | null;
  txnType: IlpaTransactionType;
  valueDate: string;
  amountMinor: number;
  currency: string;
  isRecallable?: boolean;
  sourceKind: string;
  sourceRef?: string | null;
  createdBy: string;
}

/* ==========================================================================
 * 0. Schema readiness. A-22: the sacred bootstrap does not run migration 0165,
 *    so a fresh DB needs the heal or every chain assertion below is vacuous.
 * ======================================================================== */

let _w10SchemaEnsured = false;
function db(): any {
  ensureWave9Schema();
  if (!_w10SchemaEnsured) {
    _w10SchemaEnsured = true;
    try {
      if (isSqlite()) applyWave10EngineSchema(rawDb());
    } catch {
      /* fail-soft: the migration runner is the primary path */
    }
  }
  return rawDb();
}

/** Test hook — lets a suite re-run the heal against a fresh :memory: db. */
export function _resetWave10SchemaGuardForTests(): void {
  _w10SchemaEnsured = false;
}

export function cashflowChainInstalled(): boolean {
  try {
    const cols = db().prepare(`PRAGMA table_info(vehicle_cashflow)`).all() as Array<{ name: string }>;
    return cols.some((c) => c.name === "curr_hash");
  } catch {
    return false;
  }
}

/* ==========================================================================
 * 1. Hashing.
 * ======================================================================== */

/**
 * Canonical payload string. Key order is written out by hand and must never be
 * reordered — every stored hash depends on it. If a field is ever added, it
 * goes at the END and old rows keep verifying because their payload did not
 * contain it... which is false, so: adding a field requires a new chain
 * version. There is deliberately no version field yet; adding one later is the
 * moment to think about it, and this comment is here so that moment is not
 * missed.
 */
export function canonicalFlowPayload(f: {
  id: string;
  tenantId: string;
  vehicleKind: string;
  vehicleId: string;
  lpId: string | null;
  txnType: string;
  valueDate: string;
  amountMinor: number;
  currency: string;
  isRecallable: boolean;
  sourceKind: string;
  sourceRef: string | null;
  createdBy: string;
  createdAt: string;
  chainSeq: number;
}): string {
  return [
    f.id,
    f.tenantId,
    f.vehicleKind,
    f.vehicleId,
    f.lpId ?? "",
    f.txnType,
    f.valueDate,
    String(f.amountMinor),
    f.currency,
    f.isRecallable ? "1" : "0",
    f.sourceKind,
    f.sourceRef ?? "",
    f.createdBy,
    f.createdAt,
    String(f.chainSeq),
  ].join("\u001f");
}

export function computeFlowHash(prevHash: string | null, payload: string): string {
  return createHash("sha256")
    .update(prevHash ?? "", "utf8")
    .update("\u001e", "utf8")
    .update(payload, "utf8")
    .digest("hex");
}

interface ChainTip {
  seq: number;
  hash: string | null;
}

function chainTip(dbh: any, vehicleKind: string, vehicleId: string): ChainTip {
  const row = dbh
    .prepare(
      `SELECT chain_seq AS seq, curr_hash AS hash
         FROM vehicle_cashflow
        WHERE vehicle_kind = ? AND vehicle_id = ? AND chain_seq IS NOT NULL
        ORDER BY chain_seq DESC LIMIT 1`,
    )
    .get(vehicleKind, vehicleId) as { seq: number; hash: string | null } | undefined;
  return row ? { seq: Number(row.seq), hash: row.hash ?? null } : { seq: 0, hash: null };
}

/* ==========================================================================
 * 2. The single write door.
 * ======================================================================== */

export class CashflowLedgerError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
    this.name = "CashflowLedgerError";
  }
}

/**
 * Append one flow to a vehicle's chain.
 *
 * VALIDATION ORDER MATTERS. Everything that can be rejected without touching
 * the database is rejected first, so a bad request cannot advance a chain
 * sequence and leave a gap.
 */
export function appendFlow(input: AppendFlowInput): ChainedFlowRow {
  if (!input.tenantId) throw new CashflowLedgerError("TENANT_REQUIRED");
  if (!input.vehicleId) throw new CashflowLedgerError("VEHICLE_REQUIRED");
  if (!isIlpaTransactionType(input.txnType)) {
    throw new CashflowLedgerError("BAD_TXN_TYPE", `not an ILPA transaction type: ${String(input.txnType)}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}/.test(input.valueDate)) {
    throw new CashflowLedgerError("BAD_VALUE_DATE", `value_date must be ISO yyyy-mm-dd: ${input.valueDate}`);
  }
  if (!Number.isSafeInteger(input.amountMinor)) {
    throw new CashflowLedgerError(
      "AMOUNT_NOT_MINOR_UNITS",
      `amountMinor must be a safe integer in minor units, got ${String(input.amountMinor)}`,
    );
  }
  if (input.amountMinor === 0) {
    // A zero flow contributes nothing to IRR and everything to noise; more
    // importantly it is almost always a caller that failed to compute.
    throw new CashflowLedgerError("AMOUNT_ZERO", "a zero-amount cash flow is never meaningful");
  }
  if (!input.currency || input.currency.length !== 3) {
    throw new CashflowLedgerError("BAD_CURRENCY", `expected a 3-letter code, got ${String(input.currency)}`);
  }

  // The sign convention is the ledger's load-bearing invariant: get it wrong
  // and the IRR flips sign. Enforced by the shared assertion, not re-typed.
  const flow: IlpaFlow = {
    lpId: input.lpId ?? null,
    txnType: input.txnType,
    valueDate: input.valueDate.slice(0, 10),
    amountMinor: input.amountMinor,
    currency: input.currency,
    isRecallable: input.isRecallable ?? ILPA_RECALLABLE_TYPES.includes(input.txnType),
  };
  assertSignConvention(flow);

  const dbh = db();
  if (!cashflowChainInstalled()) {
    // Refuse rather than silently write an unchained row. An unchained row is
    // exactly what this item exists to eliminate.
    throw new CashflowLedgerError(
      "CHAIN_SCHEMA_MISSING",
      "vehicle_cashflow has no chain columns; migration 0165 has not been applied",
    );
  }

  const id = `vcf_${randomUUID()}`;
  const createdAt = new Date().toISOString();

  const write = () => {
    const tip = chainTip(dbh, input.vehicleKind, input.vehicleId);
    const chainSeq = tip.seq + 1;
    const payload = canonicalFlowPayload({
      id,
      tenantId: input.tenantId,
      vehicleKind: input.vehicleKind,
      vehicleId: input.vehicleId,
      lpId: flow.lpId ?? null,
      txnType: flow.txnType,
      valueDate: flow.valueDate,
      amountMinor: flow.amountMinor,
      currency: flow.currency,
      isRecallable: !!flow.isRecallable,
      sourceKind: input.sourceKind,
      sourceRef: input.sourceRef ?? null,
      createdBy: input.createdBy,
      createdAt,
      chainSeq,
    });
    const currHash = computeFlowHash(tip.hash, payload);
    dbh
      .prepare(
        `INSERT INTO vehicle_cashflow
           (id, tenant_id, vehicle_kind, vehicle_id, lp_id, txn_type, value_date,
            amount_minor, currency, is_recallable, source_kind, source_ref,
            created_by, created_at, chain_seq, prev_hash, curr_hash)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        input.tenantId,
        input.vehicleKind,
        input.vehicleId,
        flow.lpId ?? null,
        flow.txnType,
        flow.valueDate,
        flow.amountMinor,
        flow.currency,
        flow.isRecallable ? 1 : 0,
        input.sourceKind,
        input.sourceRef ?? null,
        input.createdBy,
        createdAt,
        chainSeq,
        tip.hash,
        currHash,
      );
    return { chainSeq, prevHash: tip.hash, currHash };
  };

  // Read-tip-then-insert must be atomic, or two concurrent appends compute the
  // same prev_hash and fork the chain. The unique index on
  // (vehicle_kind, vehicle_id, chain_seq) is the backstop that turns a lost
  // race into an error rather than a silent fork; the transaction is what
  // makes the race rare instead of routine.
  let res: { chainSeq: number; prevHash: string | null; currHash: string };
  if (typeof dbh.transaction === "function") {
    res = dbh.transaction(write)();
  } else {
    res = write();
  }

  return {
    id,
    tenantId: input.tenantId,
    vehicleKind: input.vehicleKind,
    vehicleId: input.vehicleId,
    lpId: flow.lpId ?? null,
    txnType: flow.txnType,
    valueDate: flow.valueDate,
    amountMinor: flow.amountMinor,
    currency: flow.currency,
    isRecallable: !!flow.isRecallable,
    sourceKind: input.sourceKind,
    sourceRef: input.sourceRef ?? null,
    createdBy: input.createdBy,
    createdAt,
    chainSeq: res.chainSeq,
    prevHash: res.prevHash,
    currHash: res.currHash,
  };
}

/* ==========================================================================
 * 3. Reads.
 * ======================================================================== */

function mapRow(r: any): ChainedFlowRow {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    vehicleKind: r.vehicle_kind,
    vehicleId: r.vehicle_id,
    lpId: r.lp_id ?? null,
    txnType: r.txn_type,
    valueDate: r.value_date,
    amountMinor: Number(r.amount_minor),
    currency: r.currency,
    isRecallable: !!r.is_recallable,
    sourceKind: r.source_kind,
    sourceRef: r.source_ref ?? null,
    createdBy: r.created_by,
    createdAt: r.created_at,
    chainSeq: r.chain_seq === null || r.chain_seq === undefined ? null : Number(r.chain_seq),
    prevHash: r.prev_hash ?? null,
    currHash: r.curr_hash ?? null,
  };
}

export function listFlows(filter: {
  vehicleKind?: VehicleKind;
  vehicleId?: string;
  lpId?: string | null;
  tenantId?: string;
}): ChainedFlowRow[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (filter.vehicleKind) { where.push("vehicle_kind = ?"); args.push(filter.vehicleKind); }
  if (filter.vehicleId) { where.push("vehicle_id = ?"); args.push(filter.vehicleId); }
  if (filter.lpId) { where.push("lp_id = ?"); args.push(filter.lpId); }
  if (filter.tenantId) { where.push("tenant_id = ?"); args.push(filter.tenantId); }
  try {
    const rows = db()
      .prepare(
        `SELECT * FROM vehicle_cashflow` +
          (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
          ` ORDER BY chain_seq IS NULL, chain_seq, value_date, id`,
      )
      .all(...args) as any[];
    return rows.map(mapRow);
  } catch (err) {
    log.warn(`[en1] listFlows failed: ${(err as Error).message}`);
    return [];
  }
}

/**
 * Resolve a set of investor ids that all denote the same person, for LP-scoped
 * reads. EN-3's alias resolution is applied here so an LP seated under
 * `ext_<sha256(email)>` sees their own flows once they hold a platform account.
 * Import is lazy to keep this module free of a cycle through the alias store.
 */
export function listFlowsForInvestor(canonicalUserId: string, vehicleId?: string): ChainedFlowRow[] {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { resolveInvestorIdSet } = require("./investorIdentityAliasStore") as
    typeof import("./investorIdentityAliasStore");
  const ids = resolveInvestorIdSet(canonicalUserId);
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  const args: unknown[] = [...ids];
  let sql = `SELECT * FROM vehicle_cashflow WHERE lp_id IN (${placeholders})`;
  if (vehicleId) { sql += ` AND vehicle_id = ?`; args.push(vehicleId); }
  sql += ` ORDER BY value_date, chain_seq, id`;
  try {
    return (db().prepare(sql).all(...args) as any[]).map(mapRow);
  } catch (err) {
    log.warn(`[en1] listFlowsForInvestor failed: ${(err as Error).message}`);
    return [];
  }
}

/* ==========================================================================
 * 4. Verification.
 * ======================================================================== */

export interface ChainVerification {
  vehicleKind: string;
  vehicleId: string;
  ok: boolean;
  checked: number;
  /** Rows written before migration 0165 landed. NOT counted as verified. */
  unchained: number;
  breaks: Array<{ id: string; chainSeq: number | null; reason: string }>;
}

/**
 * Recompute the chain from scratch and report every break.
 *
 * THIS FUNCTION MUST BE ABLE TO RETURN ok:false, AND IS PROVEN TO. WAVE 7B
 * found DA-3's scope fence reporting success against paths that never existed,
 * because the collector silently skipped what it could not find. The
 * corresponding trap here would be returning `{ ok: true, checked: 0 }` for a
 * vehicle with rows that have no hashes. It does not: unchained rows are
 * counted separately and, if there are any, `ok` is false. A verifier that
 * says OK about rows it did not check is worse than no verifier, because it
 * is quoted in an audit.
 */
export function verifyVehicleChain(vehicleKind: string, vehicleId: string): ChainVerification {
  const out: ChainVerification = {
    vehicleKind,
    vehicleId,
    ok: true,
    checked: 0,
    unchained: 0,
    breaks: [],
  };
  let rows: any[];
  try {
    rows = db()
      .prepare(
        `SELECT * FROM vehicle_cashflow
          WHERE vehicle_kind = ? AND vehicle_id = ?
          ORDER BY chain_seq IS NULL, chain_seq, id`,
      )
      .all(vehicleKind, vehicleId) as any[];
  } catch (err) {
    return {
      ...out,
      ok: false,
      breaks: [{ id: "-", chainSeq: null, reason: `READ_FAILED: ${(err as Error).message}` }],
    };
  }

  let expectedSeq = 0;
  let prev: string | null = null;
  for (const raw of rows) {
    const r = mapRow(raw);
    if (r.chainSeq === null || r.currHash === null) {
      out.unchained += 1;
      out.ok = false;
      out.breaks.push({
        id: r.id,
        chainSeq: r.chainSeq,
        reason: "UNCHAINED_ROW: written before migration 0165; cannot be verified",
      });
      continue;
    }
    expectedSeq += 1;
    if (r.chainSeq !== expectedSeq) {
      out.ok = false;
      out.breaks.push({ id: r.id, chainSeq: r.chainSeq, reason: `SEQ_GAP: expected ${expectedSeq}` });
      expectedSeq = r.chainSeq;
    }
    if ((r.prevHash ?? null) !== prev) {
      out.ok = false;
      out.breaks.push({ id: r.id, chainSeq: r.chainSeq, reason: "PREV_HASH_MISMATCH" });
    }
    const recomputed = computeFlowHash(
      r.prevHash ?? null,
      canonicalFlowPayload({
        id: r.id,
        tenantId: r.tenantId,
        vehicleKind: r.vehicleKind,
        vehicleId: r.vehicleId,
        lpId: r.lpId ?? null,
        txnType: r.txnType,
        valueDate: r.valueDate,
        amountMinor: r.amountMinor,
        currency: r.currency,
        isRecallable: !!r.isRecallable,
        sourceKind: r.sourceKind,
        sourceRef: r.sourceRef ?? null,
        createdBy: r.createdBy,
        createdAt: r.createdAt,
        chainSeq: r.chainSeq,
      }),
    );
    if (recomputed !== r.currHash) {
      out.ok = false;
      out.breaks.push({ id: r.id, chainSeq: r.chainSeq, reason: "HASH_MISMATCH: row content was altered" });
    }
    out.checked += 1;
    prev = r.currHash;
  }
  return out;
}

/* ==========================================================================
 * 5. Projectors — the producers EN-1 was missing.
 * ======================================================================== */

/**
 * A capital call is a CONTRIBUTION: money moves LP -> vehicle, so the amount is
 * NEGATIVE in the ledger (XIRR convention, migration 0159:70-73). Callers hand
 * us a positive "amount called" because that is how a capital call is written
 * on a notice, and the sign is applied here in exactly one place.
 *
 * IDEMPOTENT BY SOURCE REF. A capital call may be projected more than once —
 * a retry, a replayed event, a backfill. The (source_kind, source_ref) pair is
 * checked first, so a second projection is a no-op that returns the existing
 * row rather than doubling the LP's contributions and halving the IRR.
 */
export function projectCapitalCall(args: {
  tenantId: string;
  vehicleKind: VehicleKind;
  vehicleId: string;
  lpId?: string | null;
  capitalCallId: string;
  calledAmountMinor: number;
  currency: string;
  valueDate: string;
  purpose?: "investment" | "management_fee" | "expenses";
  createdBy: string;
}): ChainedFlowRow | null {
  const existing = findBySource("spv_capital_call", args.capitalCallId);
  if (existing) return existing;
  if (args.calledAmountMinor <= 0) {
    throw new CashflowLedgerError(
      "CALL_AMOUNT_NOT_POSITIVE",
      "a capital call is quoted as a positive amount called; the ledger sign is applied here",
    );
  }
  const txnType: IlpaTransactionType =
    args.purpose === "management_fee"
      ? "capital_call_management_fee"
      : args.purpose === "expenses"
        ? "capital_call_expenses"
        : "capital_call_investment";
  return appendFlow({
    tenantId: args.tenantId,
    vehicleKind: args.vehicleKind,
    vehicleId: args.vehicleId,
    lpId: args.lpId ?? null,
    txnType,
    valueDate: args.valueDate,
    amountMinor: -Math.abs(args.calledAmountMinor),
    currency: args.currency,
    sourceKind: "spv_capital_call",
    sourceRef: args.capitalCallId,
    createdBy: args.createdBy,
  });
}

/**
 * A distribution is money vehicle -> LP, so POSITIVE. The ILPA taxonomy draws a
 * distinction the platform's own `distribution_type` does not always carry, so
 * the mapping is explicit and unmapped values fail loudly rather than being
 * bucketed into `distribution_income` — a misclassified return of capital
 * overstates DPI-as-income and is exactly the sort of quiet wrongness that
 * survives a demo and fails an audit.
 */
const DISTRIBUTION_TYPE_MAP: Readonly<Record<string, IlpaTransactionType>> = Object.freeze({
  income: "distribution_income",
  dividend: "distribution_income",
  interest: "distribution_income",
  gain: "distribution_gain_loss",
  gain_loss: "distribution_gain_loss",
  exit: "distribution_gain_loss",
  return_of_capital: "distribution_return_of_capital_permanent",
  return_of_capital_recallable: "distribution_return_of_capital_recallable",
  return_of_mgmt_fees: "distribution_return_of_mgmt_fees_permanent",
  return_of_mgmt_fees_recallable: "distribution_return_of_mgmt_fees_recallable",
  excess_capital: "distribution_return_of_excess_capital",
  in_specie: "in_specie_distribution",
});

export function mapDistributionType(platformType: string | null | undefined): IlpaTransactionType | null {
  if (!platformType) return null;
  return DISTRIBUTION_TYPE_MAP[platformType] ?? null;
}

export function projectDistribution(args: {
  tenantId: string;
  vehicleKind: VehicleKind;
  vehicleId: string;
  lpId?: string | null;
  distributionId: string;
  /** Positive, as written on the distribution notice. */
  grossAmountMinor: number;
  currency: string;
  valueDate: string;
  /** Platform-side type; see DISTRIBUTION_TYPE_MAP. */
  distributionType?: string | null;
  createdBy: string;
}): ChainedFlowRow | null {
  const existing = findBySource("spv_distribution", args.distributionId);
  if (existing) return existing;
  if (args.grossAmountMinor <= 0) {
    throw new CashflowLedgerError(
      "DISTRIBUTION_AMOUNT_NOT_POSITIVE",
      "a distribution is quoted as a positive amount distributed",
    );
  }
  const txnType = mapDistributionType(args.distributionType) ?? "distribution_gain_loss";
  return appendFlow({
    tenantId: args.tenantId,
    vehicleKind: args.vehicleKind,
    vehicleId: args.vehicleId,
    lpId: args.lpId ?? null,
    txnType,
    valueDate: args.valueDate,
    amountMinor: Math.abs(args.grossAmountMinor),
    currency: args.currency,
    sourceKind: "spv_distribution",
    sourceRef: args.distributionId,
    createdBy: args.createdBy,
  });
}

export function findBySource(sourceKind: string, sourceRef: string): ChainedFlowRow | null {
  try {
    const row = db()
      .prepare(`SELECT * FROM vehicle_cashflow WHERE source_kind = ? AND source_ref = ? LIMIT 1`)
      .get(sourceKind, sourceRef);
    return row ? mapRow(row) : null;
  } catch {
    return null;
  }
}

/**
 * Fire-and-forget projection for producers embedded in a domain write path.
 * A failure to project MUST NOT roll back the capital call that has already
 * been recorded — the ledger is a derived reporting surface, and a partner who
 * successfully called capital should not see the call fail because a reporting
 * row would not write. The failure is logged loudly and
 * `GET /api/reporting/vehicles/:kind/:id/cashflows/verify` will report the gap.
 */
export function tryProject(fn: () => unknown, label: string): void {
  try {
    fn();
  } catch (err) {
    log.warn(`[en1] cash-flow projection failed (${label}): ${(err as Error).message}`);
  }
}

export { isContributionType, isDistributionType };
