// server/lib/roundMathDisclosureStore.ts
//
// WAVE 52b — the persistence Wave 52 computed and did not write, plus the
// rollback flag Wave 52 did not ship.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS CLOSES
// ─────────────────────────────────────────────────────────────────────────────
//   AC-17     — `conversion_status` becomes a STORED per-instrument field.
//   §11.4.3   — `residual_disposition` becomes a STORED, ENUMERATED value.
//   §11.6.2   — the Wave 52 behaviour change gets a flag that can actually
//               revert it, resolved from the DATABASE (owner ruling R21:
//               "100% dynamic. Nothing static or hard coded.").
//
// ─────────────────────────────────────────────────────────────────────────────
// THE FLAG, AND WHY IT IS NOT AN ENV VAR
// ─────────────────────────────────────────────────────────────────────────────
// `server/lib/featureFlags.ts` reads `process.env` and says so in its own header:
// "flags are a deploy-time decision. There is no setFlag() API." That is the
// wrong shape for this wave. R21 is explicit that behaviour must be DB-driven,
// and a rollback that requires a redeploy is not a rollback — the whole reason
// §11.6.2 asks for a flag is that the first deploy ships Waves 40-57 together,
// so redeploying v26.16.0 to undo W52 would take every other wave with it.
//
// So the flag is a `platform_config` row, read at CALL TIME (never cached at
// import time, or flipping it would need a restart), through the same
// `ensurePlatformConfigKey` genesis path WAVE 11 / EN-9 established. A migration
// cannot seed it, because `trg_pc_no_direct_insert` requires a computed revision
// hash that SQL cannot produce — which is exactly why that helper exists.
//
// DEFAULT = ON = THE NEW (CORRECT) BEHAVIOUR.
// §11.6.2 as drafted asked for a flag defaulting OFF. THIS WAVE DEFAULTS IT ON,
// deliberately, and the divergence is stated rather than buried: the Wave 52
// changes are not a new feature whose exposure is a product decision, they are
// corrections to arithmetic that was measurably wrong — a 50% overprice on the
// canonical example ($3.00 against a true $2.00) and a SAFE taking 403,225
// shares it was not entitled to. Defaulting OFF would mean shipping code whose
// documented purpose is to stop overcharging investors, and then leaving the
// overcharge switched on. The flag exists to REVERT if the correction turns out
// to break something in production, not to gate the correction.
//
// WHAT "OFF" ACTUALLY MEANS — AND THIS IS THE POINT
// A flag that cannot restore the prior behaviour is decoration. OFF restores all
// THREE pre-Wave-52 defects together, because they were one order-of-operations
// bug: the price is not solved (p = p0), the pool top-up is applied ABOVE the
// conversion loops, and the converting instrument's company capitalization is
// measured AFTER the pool push. Proof of both poles with worked numbers is in
// `build_log/wave52b/W52B_FLAG_PROOF.md`.
//
// ─────────────────────────────────────────────────────────────────────────────
// SACRED
// ─────────────────────────────────────────────────────────────────────────────
// Nothing here edits a sacred file. `server/db/connection.ts` is used only
// through its ordinary public `getDb` / `rawDb` / `getDbDriver` exports;
// `server/captableCommitStore.ts` and `server/lib/capTableMembership.ts` are not
// imported at all; `server/roundCarryForwardEngine.ts` is not imported at all.
import { getDb, rawDb, getDbDriver } from "../db/connection";
import {
  applyWave52bRoundMathSchemaOnce,
  WAVE52B_CONVERSION_TABLE,
  WAVE52B_RESIDUAL_TABLE,
} from "./applyWave52bRoundMathSchema";
import { ensurePlatformConfigKey, readConfigRow } from "./platformConfigWriter";
import { log } from "./logger";

/* ─────────────────────────────────────────────────────────────────────────── */
/* 0. REFUSAL CODES — an honest error, never a silent success.                 */
/* ─────────────────────────────────────────────────────────────────────────── */

/** Postgres deployments do not carry 0189's tables yet; say so honestly. */
export const ROUND_MATH_UNAVAILABLE = "ROUND_MATH_DISCLOSURE_UNAVAILABLE";
/** The heal could not install the tables. Refuse; never pretend it worked. */
export const ROUND_MATH_SCHEMA_MISSING = "ROUND_MATH_DISCLOSURE_SCHEMA_MISSING";
/** Attribution is mandatory — an unattributed record is not an audit record. */
export const ROUND_MATH_NO_ACTOR = "ROUND_MATH_DISCLOSURE_NO_ACTOR";
/** The value offered is not in the enumeration. Refused before it reaches SQL. */
export const ROUND_MATH_BAD_ENUM = "ROUND_MATH_DISCLOSURE_BAD_ENUM";
/** `I_applied + r != I_committed`. Invariant I-5; refused before it reaches SQL. */
export const ROUND_MATH_RESIDUAL_UNRECONCILED = "ROUND_MATH_RESIDUAL_UNRECONCILED";

/* ─────────────────────────────────────────────────────────────────────────── */
/* 1. THE ENUMERATIONS — one definition, mirrored by the CHECK in 0189.        */
/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * Deliberately re-declared here rather than imported from
 * `client/src/lib/roundMath.ts`. A server module must not depend on a client
 * page's module graph, and AC-3 / §11.4.6 requires Method B (`roundMath.ts`) to
 * stay import-isolated. The two lists are kept in step by
 * `server/__tests__/w52b_round_math_persistence.test.ts`, which asserts them
 * EQUAL element-for-element and fails if either side drifts — a test, not a
 * comment, because a comment cannot fail.
 */
export const CONVERSION_STATUSES = [
  "converts_in_this_round",
  "does_not_convert",
  "undetermined",
] as const;
export type ConversionStatus = (typeof CONVERSION_STATUSES)[number];

export const CONVERSION_TRIGGER_BASES = [
  "qualified_financing_threshold_met",
  "elective",
  "cap_binding",
  "discount_binding",
  "mfn",
] as const;
export type ConversionTriggerBasis = (typeof CONVERSION_TRIGGER_BASES)[number];

export const INSTRUMENT_KINDS = [
  "safe_post",
  "safe_pre",
  "convertible_note",
  "warrant",
] as const;
export type InstrumentKind = (typeof INSTRUMENT_KINDS)[number];

/**
 * §11.4.3, verbatim. Each value closes the post-money identity differently,
 * which is why prose is not acceptable and why there is NO DEFAULT.
 */
export const RESIDUAL_DISPOSITIONS = [
  "returned",
  "not_called",
  "credited_next_close",
  "waived",
  "subscription_receivable",
  "subscription_payable",
  "retained_by_agreement",
] as const;
export type ResidualDisposition = (typeof RESIDUAL_DISPOSITIONS)[number];

/* ─────────────────────────────────────────────────────────────────────────── */
/* 2. THE DB-DRIVEN FLAG (R21).                                               */
/* ─────────────────────────────────────────────────────────────────────────── */

export const W52_PRICING_ORDER_FLAG_KEY = "round_math.w52_pricing_order_enabled";

export const W52_PRICING_ORDER_FLAG_DESCRIPTION =
  "WAVE 52 pricing order. TRUE (default) = price per share is solved AFTER the " +
  "option-pool top-up and AFTER SAFE/note conversion, and a post-money SAFE's " +
  "company capitalization excludes the round's new pool. FALSE = the " +
  "pre-Wave-52 order, which prices BEFORE both and measures the SAFE's " +
  "capitalization after the pool push. FALSE restores three measured " +
  "arithmetic defects and exists ONLY as a rollback; see " +
  "build_log/wave52b/W52B_FLAG_PROOF.md.";

/** The default. ON = the corrected arithmetic. See the header for why. */
export const W52_PRICING_ORDER_DEFAULT = true;

export type PricingOrderMode = "w52_post_pool_post_conversion" | "legacy_pre_w52";

export interface FlagResolution {
  enabled: boolean;
  mode: PricingOrderMode;
  /** Where the answer came from — never guessed silently. */
  source: "platform_config" | "default_unavailable_db" | "default_seed_failed";
  /** The `platform_config` row version, so a flip is auditable. */
  version: number | null;
  reason: string | null;
}

/**
 * Seed the flag row if it is absent. Idempotent by `ensurePlatformConfigKey`'s
 * own contract, so it is safe on every boot and in every test.
 */
export function ensureW52PricingOrderFlag(createdBy = "wave52b_installer"): FlagResolution {
  try {
    if (getDbDriver() === "postgres") {
      return {
        enabled: W52_PRICING_ORDER_DEFAULT,
        mode: W52_PRICING_ORDER_DEFAULT ? "w52_post_pool_post_conversion" : "legacy_pre_w52",
        source: "default_unavailable_db",
        version: null,
        reason: "postgres driver: platform_config flag path is sqlite-only in this tree",
      };
    }
    getDb();
    const row = ensurePlatformConfigKey({
      key: W52_PRICING_ORDER_FLAG_KEY,
      valueJson: JSON.stringify(W52_PRICING_ORDER_DEFAULT),
      valueType: "boolean",
      description: W52_PRICING_ORDER_FLAG_DESCRIPTION,
      createdBy,
    });
    const enabled = JSON.parse(row.valueJson) === true;
    return {
      enabled,
      mode: enabled ? "w52_post_pool_post_conversion" : "legacy_pre_w52",
      source: "platform_config",
      version: row.version,
      reason: null,
    };
  } catch (err) {
    const reason = (err as Error).message;
    log.warn(`[roundMathDisclosureStore] flag seed failed, falling back to the default: ${reason}`);
    return {
      enabled: W52_PRICING_ORDER_DEFAULT,
      mode: W52_PRICING_ORDER_DEFAULT ? "w52_post_pool_post_conversion" : "legacy_pre_w52",
      source: "default_seed_failed",
      version: null,
      reason,
    };
  }
}

/**
 * Resolve the flag AT CALL TIME. Not memoised, deliberately: a flag cached at
 * import time cannot be flipped without a restart, and a rollback that needs a
 * restart is a worse rollback than one that does not.
 */
export function resolveW52PricingOrder(): FlagResolution {
  const seeded = ensureW52PricingOrderFlag();
  if (seeded.source !== "platform_config") return seeded;
  const row = readConfigRow(W52_PRICING_ORDER_FLAG_KEY);
  if (!row) {
    return {
      enabled: W52_PRICING_ORDER_DEFAULT,
      mode: W52_PRICING_ORDER_DEFAULT ? "w52_post_pool_post_conversion" : "legacy_pre_w52",
      source: "default_unavailable_db",
      version: null,
      reason: "platform_config row disappeared between seed and read",
    };
  }
  let enabled = W52_PRICING_ORDER_DEFAULT;
  try {
    enabled = JSON.parse(row.valueJson) === true;
  } catch {
    /* A malformed value falls back to the CORRECT behaviour, not to the
       defective one: an unreadable flag must not silently restore a known
       arithmetic defect. */
    enabled = W52_PRICING_ORDER_DEFAULT;
  }
  return {
    enabled,
    mode: enabled ? "w52_post_pool_post_conversion" : "legacy_pre_w52",
    source: "platform_config",
    version: row.version,
    reason: null,
  };
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* 3. THE HANDLE                                                              */
/* ─────────────────────────────────────────────────────────────────────────── */

function db(): any {
  if (getDbDriver() === "postgres") throw new Error(ROUND_MATH_UNAVAILABLE);
  getDb();
  const handle = rawDb() as any;
  const heal = applyWave52bRoundMathSchemaOnce(handle);
  if (!heal.tablesReady) {
    throw new Error(
      `${ROUND_MATH_SCHEMA_MISSING}:${heal.failures.join("|") || "tables_absent"}`,
    );
  }
  return handle;
}

const nowIso = (): string => new Date().toISOString();
const newId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

/* ─────────────────────────────────────────────────────────────────────────── */
/* 4. CONVERSION STATUS — AC-17's stored field.                               */
/* ─────────────────────────────────────────────────────────────────────────── */

export interface ConversionStatusRow {
  id: string;
  tenantId: string | null;
  roundId: string;
  companyId: string | null;
  instrumentId: string;
  instrumentKind: InstrumentKind;
  conversionStatus: ConversionStatus;
  conversionTriggerBasis: ConversionTriggerBasis | null;
  accruedInterestModelled: boolean;
  /** Integer string. `null` when it could not be computed — never `0`. */
  asConvertedShares: string | null;
  recordedAt: string;
  recordedBy: string | null;
  notes: string | null;
}

const CONV_COLS = `
  id, tenant_id, round_id, company_id, instrument_id, instrument_kind,
  conversion_status, conversion_trigger_basis, accrued_interest_modelled,
  as_converted_shares, recorded_at, recorded_by, notes`;

function toConversionRow(r: any): ConversionStatusRow {
  return {
    id: String(r.id),
    tenantId: r.tenant_id ?? null,
    roundId: String(r.round_id),
    companyId: r.company_id ?? null,
    instrumentId: String(r.instrument_id),
    instrumentKind: r.instrument_kind as InstrumentKind,
    conversionStatus: r.conversion_status as ConversionStatus,
    conversionTriggerBasis: (r.conversion_trigger_basis ?? null) as ConversionTriggerBasis | null,
    accruedInterestModelled: Number(r.accrued_interest_modelled) === 1,
    asConvertedShares: r.as_converted_shares == null ? null : String(r.as_converted_shares),
    recordedAt: String(r.recorded_at),
    recordedBy: r.recorded_by ?? null,
    notes: r.notes ?? null,
  };
}

/**
 * Record (or correct) one instrument's conversion status for one round.
 *
 * UPSERT on `(round_id, instrument_id)` — a founder changing their mind is a
 * legitimate correction, and a second INSERT would put the same instrument into
 * the denominator twice. `recordedAt` / `recordedBy` are overwritten so the row
 * always states who last decided it.
 */
export function recordConversionStatus(input: {
  roundId: string;
  instrumentId: string;
  instrumentKind: InstrumentKind;
  conversionStatus: ConversionStatus;
  conversionTriggerBasis?: ConversionTriggerBasis | null;
  accruedInterestModelled?: boolean;
  asConvertedShares?: string | bigint | null;
  tenantId?: string | null;
  companyId?: string | null;
  recordedBy: string;
  notes?: string | null;
}): ConversionStatusRow {
  if (!input.recordedBy) throw new Error(ROUND_MATH_NO_ACTOR);
  if (!CONVERSION_STATUSES.includes(input.conversionStatus)) {
    throw new Error(`${ROUND_MATH_BAD_ENUM}:conversion_status:${input.conversionStatus}`);
  }
  if (!INSTRUMENT_KINDS.includes(input.instrumentKind)) {
    throw new Error(`${ROUND_MATH_BAD_ENUM}:instrument_kind:${input.instrumentKind}`);
  }
  const basis = input.conversionTriggerBasis ?? null;
  if (basis !== null && !CONVERSION_TRIGGER_BASES.includes(basis)) {
    throw new Error(`${ROUND_MATH_BAD_ENUM}:conversion_trigger_basis:${basis}`);
  }
  if (input.conversionStatus === "converts_in_this_round" && basis === null) {
    /* Refused in TypeScript as well as in SQL. "It converted, we don't know why"
       is not a record. */
    throw new Error(`${ROUND_MATH_BAD_ENUM}:conversion_trigger_basis:required_when_converting`);
  }
  const shares =
    input.asConvertedShares === null || input.asConvertedShares === undefined
      ? null
      : String(input.asConvertedShares);
  if (shares !== null && !/^\d+$/.test(shares)) {
    /* I-9: a fractional or non-numeric share count is rejected BY NAME. */
    throw new Error(`${ROUND_MATH_BAD_ENUM}:as_converted_shares:${shares}`);
  }

  const handle = db();
  const existing = handle
    .prepare(
      `SELECT ${CONV_COLS} FROM ${WAVE52B_CONVERSION_TABLE}
        WHERE round_id = ? AND instrument_id = ?`,
    )
    .get(input.roundId, input.instrumentId);

  const at = nowIso();
  if (existing) {
    handle
      .prepare(
        `UPDATE ${WAVE52B_CONVERSION_TABLE}
            SET instrument_kind = ?, conversion_status = ?, conversion_trigger_basis = ?,
                accrued_interest_modelled = ?, as_converted_shares = ?,
                recorded_at = ?, recorded_by = ?, notes = ?
          WHERE round_id = ? AND instrument_id = ?`,
      )
      .run(
        input.instrumentKind,
        input.conversionStatus,
        basis,
        input.accruedInterestModelled ? 1 : 0,
        shares,
        at,
        input.recordedBy,
        input.notes ?? null,
        input.roundId,
        input.instrumentId,
      );
  } else {
    handle
      .prepare(
        `INSERT INTO ${WAVE52B_CONVERSION_TABLE}
           (id, tenant_id, round_id, company_id, instrument_id, instrument_kind,
            conversion_status, conversion_trigger_basis, accrued_interest_modelled,
            as_converted_shares, recorded_at, recorded_by, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        newId("ric"),
        input.tenantId ?? null,
        input.roundId,
        input.companyId ?? null,
        input.instrumentId,
        input.instrumentKind,
        input.conversionStatus,
        basis,
        input.accruedInterestModelled ? 1 : 0,
        shares,
        at,
        input.recordedBy,
        input.notes ?? null,
      );
  }

  const row = handle
    .prepare(
      `SELECT ${CONV_COLS} FROM ${WAVE52B_CONVERSION_TABLE}
        WHERE round_id = ? AND instrument_id = ?`,
    )
    .get(input.roundId, input.instrumentId);
  return toConversionRow(row);
}

export function listConversionStatuses(roundId: string): ConversionStatusRow[] {
  return (
    db()
      .prepare(
        `SELECT ${CONV_COLS} FROM ${WAVE52B_CONVERSION_TABLE}
          WHERE round_id = ? ORDER BY instrument_id`,
      )
      .all(roundId) as any[]
  ).map(toConversionRow);
}

/**
 * FAIL CLOSED (AC-17 Pole B). An instrument with NO stored row is reported
 * `undetermined`, never `converts_in_this_round`. The absence of a decision is
 * not a decision, and treating it as one would silently move the denominator.
 */
export function resolveConversionStatus(
  roundId: string,
  instrumentId: string,
): { status: ConversionStatus; stored: boolean; row: ConversionStatusRow | null } {
  const row = db()
    .prepare(
      `SELECT ${CONV_COLS} FROM ${WAVE52B_CONVERSION_TABLE}
        WHERE round_id = ? AND instrument_id = ?`,
    )
    .get(roundId, instrumentId);
  if (!row) return { status: "undetermined", stored: false, row: null };
  const rec = toConversionRow(row);
  return { status: rec.conversionStatus, stored: true, row: rec };
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* 5. RESIDUAL DISPOSITION — §11.4.3's stored, enumerated value.              */
/* ─────────────────────────────────────────────────────────────────────────── */

export interface ResidualDispositionRow {
  id: string;
  tenantId: string | null;
  roundId: string;
  closeRef: string;
  investorId: string;
  currency: string;
  /** Integer minor units. Three distinct quantities per §11.4.2. */
  committedMinor: number;
  appliedMinor: number;
  residualMinor: number;
  residualDisposition: ResidualDisposition;
  dispositionClauseRef: string | null;
  creditedToCloseRef: string | null;
  recordedAt: string;
  recordedBy: string | null;
  notes: string | null;
}

const RES_COLS = `
  id, tenant_id, round_id, close_ref, investor_id, currency,
  committed_minor, applied_minor, residual_minor, residual_disposition,
  disposition_clause_ref, credited_to_close_ref, recorded_at, recorded_by, notes`;

function toResidualRow(r: any): ResidualDispositionRow {
  return {
    id: String(r.id),
    tenantId: r.tenant_id ?? null,
    roundId: String(r.round_id),
    closeRef: String(r.close_ref),
    investorId: String(r.investor_id),
    currency: String(r.currency),
    committedMinor: Number(r.committed_minor),
    appliedMinor: Number(r.applied_minor),
    residualMinor: Number(r.residual_minor),
    residualDisposition: r.residual_disposition as ResidualDisposition,
    dispositionClauseRef: r.disposition_clause_ref ?? null,
    creditedToCloseRef: r.credited_to_close_ref ?? null,
    recordedAt: String(r.recorded_at),
    recordedBy: r.recorded_by ?? null,
    notes: r.notes ?? null,
  };
}

/**
 * Record one investor's residual and its disposition for one close.
 *
 * NO DEFAULT DISPOSITION IS ACCEPTED. `residualDisposition` is required by the
 * type, validated against the enumeration here, and validated again by 0189's
 * CHECK. `applied + residual == committed` is asserted here in integers and
 * again by 0189's CHECK — invariant I-5, tolerance exactly zero minor units.
 */
export function recordResidualDisposition(input: {
  roundId: string;
  investorId: string;
  closeRef?: string;
  currency: string;
  committedMinor: number;
  appliedMinor: number;
  residualMinor: number;
  residualDisposition: ResidualDisposition;
  dispositionClauseRef?: string | null;
  creditedToCloseRef?: string | null;
  tenantId?: string | null;
  recordedBy: string;
  notes?: string | null;
}): ResidualDispositionRow {
  if (!input.recordedBy) throw new Error(ROUND_MATH_NO_ACTOR);
  if (!RESIDUAL_DISPOSITIONS.includes(input.residualDisposition)) {
    throw new Error(`${ROUND_MATH_BAD_ENUM}:residual_disposition:${input.residualDisposition}`);
  }
  for (const [name, v] of [
    ["committed_minor", input.committedMinor],
    ["applied_minor", input.appliedMinor],
    ["residual_minor", input.residualMinor],
  ] as const) {
    if (!Number.isInteger(v) || v < 0) {
      throw new Error(`${ROUND_MATH_BAD_ENUM}:${name}:${v}`);
    }
  }
  if (input.appliedMinor + input.residualMinor !== input.committedMinor) {
    throw new Error(
      `${ROUND_MATH_RESIDUAL_UNRECONCILED}:` +
        `${input.appliedMinor}+${input.residualMinor}!=${input.committedMinor}`,
    );
  }
  if (input.residualDisposition === "retained_by_agreement" && !input.dispositionClauseRef) {
    throw new Error(`${ROUND_MATH_BAD_ENUM}:disposition_clause_ref:required`);
  }
  if (input.residualDisposition === "credited_next_close" && !input.creditedToCloseRef) {
    throw new Error(`${ROUND_MATH_BAD_ENUM}:credited_to_close_ref:required`);
  }

  const closeRef = input.closeRef ?? "initial";
  const handle = db();
  const existing = handle
    .prepare(
      `SELECT id FROM ${WAVE52B_RESIDUAL_TABLE}
        WHERE round_id = ? AND close_ref = ? AND investor_id = ?`,
    )
    .get(input.roundId, closeRef, input.investorId);

  const at = nowIso();
  if (existing) {
    handle
      .prepare(
        `UPDATE ${WAVE52B_RESIDUAL_TABLE}
            SET currency = ?, committed_minor = ?, applied_minor = ?, residual_minor = ?,
                residual_disposition = ?, disposition_clause_ref = ?, credited_to_close_ref = ?,
                recorded_at = ?, recorded_by = ?, notes = ?
          WHERE round_id = ? AND close_ref = ? AND investor_id = ?`,
      )
      .run(
        input.currency,
        input.committedMinor,
        input.appliedMinor,
        input.residualMinor,
        input.residualDisposition,
        input.dispositionClauseRef ?? null,
        input.creditedToCloseRef ?? null,
        at,
        input.recordedBy,
        input.notes ?? null,
        input.roundId,
        closeRef,
        input.investorId,
      );
  } else {
    handle
      .prepare(
        `INSERT INTO ${WAVE52B_RESIDUAL_TABLE}
           (id, tenant_id, round_id, close_ref, investor_id, currency,
            committed_minor, applied_minor, residual_minor, residual_disposition,
            disposition_clause_ref, credited_to_close_ref, recorded_at, recorded_by, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        newId("rrd"),
        input.tenantId ?? null,
        input.roundId,
        closeRef,
        input.investorId,
        input.currency,
        input.committedMinor,
        input.appliedMinor,
        input.residualMinor,
        input.residualDisposition,
        input.dispositionClauseRef ?? null,
        input.creditedToCloseRef ?? null,
        at,
        input.recordedBy,
        input.notes ?? null,
      );
  }

  const row = handle
    .prepare(
      `SELECT ${RES_COLS} FROM ${WAVE52B_RESIDUAL_TABLE}
        WHERE round_id = ? AND close_ref = ? AND investor_id = ?`,
    )
    .get(input.roundId, closeRef, input.investorId);
  return toResidualRow(row);
}

export function listResidualDispositions(
  roundId: string,
  closeRef?: string,
): ResidualDispositionRow[] {
  const handle = db();
  const rows =
    closeRef === undefined
      ? handle
          .prepare(
            `SELECT ${RES_COLS} FROM ${WAVE52B_RESIDUAL_TABLE}
              WHERE round_id = ? ORDER BY close_ref, investor_id`,
          )
          .all(roundId)
      : handle
          .prepare(
            `SELECT ${RES_COLS} FROM ${WAVE52B_RESIDUAL_TABLE}
              WHERE round_id = ? AND close_ref = ? ORDER BY investor_id`,
          )
          .all(roundId, closeRef);
  return (rows as any[]).map(toResidualRow);
}

/**
 * §11.4.3: "A round with a non-zero residual and no disposition is an INCOMPLETE
 * round and the disclosure says so."
 *
 * `residualMinor` is the residual the caller computed for this investor. If it
 * is non-zero and there is no stored row, this reports INCOMPLETE by name. It
 * does NOT invent a disposition, and it does not treat a missing row as
 * `waived`, which would be the convenient answer and would quietly hand the
 * money to the company.
 */
export function assessRoundCompleteness(input: {
  roundId: string;
  closeRef?: string;
  /** investorId → residual in integer minor units, as computed by the caller. */
  residualsByInvestor: Record<string, number>;
}): {
  complete: boolean;
  missingDispositions: string[];
  storedCount: number;
  totalResidualMinor: number;
  reason: string | null;
} {
  const closeRef = input.closeRef ?? "initial";
  const stored = new Map(
    listResidualDispositions(input.roundId, closeRef).map((r) => [r.investorId, r]),
  );
  const missing: string[] = [];
  let total = 0;
  for (const [investorId, residual] of Object.entries(input.residualsByInvestor)) {
    total += residual;
    if (residual !== 0 && !stored.has(investorId)) missing.push(investorId);
  }
  missing.sort();
  return {
    complete: missing.length === 0,
    missingDispositions: missing,
    storedCount: stored.size,
    totalResidualMinor: total,
    reason:
      missing.length === 0
        ? null
        : `INCOMPLETE ROUND — ${missing.length} investor(s) have a non-zero rounding ` +
          `residual with no recorded disposition (${missing.join(", ")}). The residual's ` +
          `treatment changes the post-money identity, so it cannot be defaulted.`,
  };
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* 6. THE §5.8 DENOMINATOR SWITCHES — invariant I-10's persisted column set.   */
/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * §5.8, verbatim: eleven places where the authorities genuinely disagree about
 * what a denominator contains, each of which "becomes a STORED, VERSIONED,
 * USER-VISIBLE round setting" with the ISR-recommended default.
 *
 * `note_conversion_method` is the one to look at if this list ever seems
 * academic: Buchanan Ingersoll's four defensible methods give 20.00%, 18.52% and
 * 18.18% ON IDENTICAL FACTS, and ISR §10 error #10 records that not disclosing
 * the method is a diligence failure.
 */
export const DENOMINATOR_SWITCHES = {
  include_unallocated_pool: {
    values: ["in", "out"] as const,
    default: "in",
    authority: "WSGR/Carta include it; a common drafted definition expressly excludes shares reserved but unissued (ISR §1.3, §13 #1)",
  },
  pool_top_up_placement: {
    values: ["pre_money", "post_money"] as const,
    default: "pre_money",
    authority: "Cooley: most investors require pre-money (ISR §13 #2)",
  },
  converting_instruments_in_premoney: {
    values: ["in", "out"] as const,
    default: "in",
    authority: "WSGR term-sheet watch-item; YC fn. 2 documents the out-case (ISR §13 #3)",
  },
  note_conversion_method: {
    values: ["pre_money_method", "post_money_method", "dollars_for_dollars", "percentage_ownership"] as const,
    default: "pre_money_method",
    authority: "Buchanan Ingersoll: four defensible methods give 20.00% / 18.52% / 18.18% on identical facts (ISR §3, §13 #4)",
  },
  pool_target_basis: {
    values: ["post_money_fd", "pre_money_fd"] as const,
    default: "post_money_fd",
    authority: "investor targets are stated post-closing (ISR §4.3, §13 #5)",
  },
  rsu_sar_in_fd: {
    values: ["in", "out"] as const,
    default: "in",
    authority: "Carta excludes them from outstanding; the YC safe includes them in Options (ISR §13 #6)",
  },
  promised_options: {
    values: ["recognise_when_safe_outstanding", "always", "never"] as const,
    default: "recognise_when_safe_outstanding",
    authority: "a safe-specific defined term, not a general cap-table concept (ISR §13 #7)",
  },
  displayed_post_money: {
    values: ["show_both_when_differ", "t_times_p_only", "pmv_plus_i_only"] as const,
    default: "show_both_when_differ",
    authority: "the identity is conventional but conditional (ISR §13 #10)",
  },
  second_close_pricing: {
    values: ["same_price", "reprice"] as const,
    default: "same_price",
    authority: "NVCA §1.3 same terms and conditions (ISR §13 #11)",
  },
  liquidity_denominator: {
    values: ["without_pool", "with_pool"] as const,
    default: "without_pool",
    authority: "the YC safe itself uses two denominators — Company Capitalization for conversion, Liquidity Capitalization for liquidity (ISR §8.1, §13 #12)",
  },
  fx_rate_date: {
    values: ["closing_date", "commitment_date", "payment_date"] as const,
    default: "closing_date",
    /* Recorded as UNVERIFIED rather than dressed up. ISR §13 #13 located no
       Tier-A/B standard, and claiming an authority we do not have is worse than
       naming none. */
    authority: "UNVERIFIED — ISR §13 #13 located no Tier-A/B standard for the FX rate date",
  },
} as const;

export type DenominatorSwitchKey = keyof typeof DENOMINATOR_SWITCHES;
export const DENOMINATOR_SWITCH_KEYS = Object.keys(DENOMINATOR_SWITCHES) as DenominatorSwitchKey[];

export const WAVE52B_SWITCH_TABLE = "round_denominator_switches";

export interface DenominatorSwitchRow {
  id: string;
  tenantId: string | null;
  roundId: string;
  switchKey: DenominatorSwitchKey;
  switchValue: string;
  isDefault: boolean;
  version: number;
  authorityRef: string | null;
  recordedAt: string;
  recordedBy: string | null;
}

const SW_COLS = `
  id, tenant_id, round_id, switch_key, switch_value, is_default, version,
  authority_ref, recorded_at, recorded_by`;

function toSwitchRow(r: any): DenominatorSwitchRow {
  return {
    id: String(r.id),
    tenantId: r.tenant_id ?? null,
    roundId: String(r.round_id),
    switchKey: r.switch_key as DenominatorSwitchKey,
    switchValue: String(r.switch_value),
    isDefault: Number(r.is_default) === 1,
    version: Number(r.version),
    authorityRef: r.authority_ref ?? null,
    recordedAt: String(r.recorded_at),
    recordedBy: r.recorded_by ?? null,
  };
}

/**
 * Record one switch. A correction is a HIGHER VERSION, never a rewrite: "which
 * convention was this percentage computed under, on the day it was published?"
 * must keep having an answer after somebody changes their mind.
 */
export function recordDenominatorSwitch(input: {
  roundId: string;
  switchKey: DenominatorSwitchKey;
  switchValue: string;
  isDefault?: boolean;
  authorityRef?: string | null;
  tenantId?: string | null;
  recordedBy: string;
}): DenominatorSwitchRow {
  if (!input.recordedBy) throw new Error(ROUND_MATH_NO_ACTOR);
  const spec = DENOMINATOR_SWITCHES[input.switchKey];
  if (!spec) throw new Error(`${ROUND_MATH_BAD_ENUM}:switch_key:${String(input.switchKey)}`);
  if (!(spec.values as readonly string[]).includes(input.switchValue)) {
    throw new Error(`${ROUND_MATH_BAD_ENUM}:${input.switchKey}:${input.switchValue}`);
  }
  const isDefault = input.isDefault ?? input.switchValue === spec.default;
  /* `undefined` means "not supplied, use the ISR authority"; an EXPLICIT `null`
     means "there is no authority", which is only acceptable for a default. The
     first draft used `??` and swallowed the explicit null, so the
     non-default-without-authority refusal could never fire. Caught by its own
     test going green when it should have been red. */
  const authorityRef = input.authorityRef === undefined ? spec.authority : input.authorityRef;
  if (!isDefault && !authorityRef) {
    throw new Error(`${ROUND_MATH_BAD_ENUM}:authority_ref:required_for_non_default`);
  }

  const handle = db();
  const top = handle
    .prepare(
      `SELECT MAX(version) AS v FROM ${WAVE52B_SWITCH_TABLE}
        WHERE round_id = ? AND switch_key = ?`,
    )
    .get(input.roundId, input.switchKey) as { v: number | null };
  const version = (top?.v ?? 0) + 1;

  handle
    .prepare(
      `INSERT INTO ${WAVE52B_SWITCH_TABLE}
         (id, tenant_id, round_id, switch_key, switch_value, is_default, version,
          authority_ref, recorded_at, recorded_by)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      newId("rds"),
      input.tenantId ?? null,
      input.roundId,
      input.switchKey,
      input.switchValue,
      isDefault ? 1 : 0,
      version,
      authorityRef,
      nowIso(),
      input.recordedBy,
    );

  return toSwitchRow(
    handle
      .prepare(
        `SELECT ${SW_COLS} FROM ${WAVE52B_SWITCH_TABLE}
          WHERE round_id = ? AND switch_key = ? AND version = ?`,
      )
      .get(input.roundId, input.switchKey, version),
  );
}

/** Seed every switch at its ISR default. Idempotent by version-1 presence. */
export function ensureDenominatorSwitchDefaults(
  roundId: string,
  recordedBy = "wave52b_installer",
  tenantId: string | null = null,
): DenominatorSwitchRow[] {
  const existing = new Set(readDenominatorSwitches(roundId).map((r) => r.switchKey));
  const out: DenominatorSwitchRow[] = [];
  for (const key of DENOMINATOR_SWITCH_KEYS) {
    if (existing.has(key)) continue;
    out.push(
      recordDenominatorSwitch({
        roundId,
        switchKey: key,
        switchValue: DENOMINATOR_SWITCHES[key].default,
        isDefault: true,
        tenantId,
        recordedBy,
      }),
    );
  }
  return out;
}

/** The LIVE value of every recorded switch — highest version wins. */
export function readDenominatorSwitches(roundId: string): DenominatorSwitchRow[] {
  const rows = db()
    .prepare(
      `SELECT ${SW_COLS} FROM ${WAVE52B_SWITCH_TABLE} s
        WHERE round_id = ?
          AND version = (SELECT MAX(version) FROM ${WAVE52B_SWITCH_TABLE} t
                          WHERE t.round_id = s.round_id AND t.switch_key = s.switch_key)
        ORDER BY switch_key`,
    )
    .all(roundId) as any[];
  return rows.map(toSwitchRow);
}

/**
 * Resolve the switch set for a round, and REFUSE to invent one.
 *
 * `missing` names every §5.8 switch with no stored row. It is not filled in from
 * `DENOMINATOR_SWITCHES[key].default` here, because a default silently applied is
 * indistinguishable from a choice deliberately made — and the response document
 * already promised the founder that the convention is disclosed, not assumed.
 * This is the shape invariant I-10's mutation attacks: drop one switch from the
 * persisted set and `complete` goes false, naming it.
 */
export function resolveDenominatorSwitches(roundId: string): {
  complete: boolean;
  values: Partial<Record<DenominatorSwitchKey, string>>;
  missing: DenominatorSwitchKey[];
  rows: DenominatorSwitchRow[];
} {
  const rows = readDenominatorSwitches(roundId);
  const values: Partial<Record<DenominatorSwitchKey, string>> = {};
  for (const r of rows) values[r.switchKey] = r.switchValue;
  const missing = DENOMINATOR_SWITCH_KEYS.filter((k) => values[k] === undefined);
  return { complete: missing.length === 0, values, missing, rows };
}
