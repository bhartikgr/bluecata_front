/**
 * WAVE 9 — reporting core: config, cash-flow ledger, valuation marks,
 * GP overrides, monthly snapshots and platform-derived cohort benchmarks.
 *
 * ITEMS: M-2, M-2b, M-3, M-4 (and the DB access used by M-1c/RP-1..RP-5).
 *
 * EVERYTHING HERE IS DB-DRIVEN. There is no in-memory cache of a reportable
 * number, no default, no seed and no sample. Where a value cannot be derived
 * from a real row, the caller receives a STATUS (see @capavate/math-fns
 * `MetricStatus`) and `null` — never a placeholder. A fabricated figure in
 * front of an investment bank is worse than a blank.
 *
 * SETTLED OWNER RULINGS implemented here:
 *   Q5  marks AUTO-DERIVE from the last priced round, are BADGED, go stale at
 *       180 days and expire at 365, and are GP-OVERRIDABLE.
 *   Q9  snapshots are MONTHLY; a chart renders only at >= 3 points.
 *   Q10 benchmarks are computed FROM PLATFORM DATA, never an external feed.
 *   Q1  the unified cap-table ledger is canonical (ADR-7 withdrawn) — marks
 *       are applied to positions derived from `captableCommitStore`.
 * All four thresholds are rows in `wave9_reporting_config`, not literals.
 */
import { randomUUID } from "node:crypto";
import { rawDb } from "./db/connection";
import { isSqlite } from "./db/portable";
import { log } from "./lib/logger";
import { applyWave9ReportingSchema } from "./lib/applyWave9ReportingSchema";
import { applyWave38EventLedgerSchema } from "./lib/applyWave38EventLedgerSchema";
import { getRoundsForCompany } from "./roundsStore";
import { toMinor } from "./lib/currency";
/* WAVE 180 · ITEM A SITE 3 — the same normaliser the WAVE 21 currency contract
 * uses, so "cad", " CAD " and "CAD" cannot masquerade as three currencies and
 * trip a false refusal. */
import { normalizeCurrency } from "./lib/currencyScalar";
/* WAVE 221 — the benchmarking opt-out, read at the point of computation. */
import { wave221OptedOutIds } from "./lib/wave221BenchmarkingOptOut";
import {
  computeFundMetrics,
  toEpochDay,
  type FundMetrics,
  type IlpaFlow,
  type IlpaTransactionType,
  type MetricStatus,
} from "@capavate/math-fns";

/* ==========================================================================
 * 0. Bootstrap heal — same memoised, fail-soft shape as
 *    server/partnerClassificationStore.ts:129.
 * ======================================================================== */

let _schemaEnsured = false;
export function ensureWave9Schema(): void {
  if (_schemaEnsured) return;
  _schemaEnsured = true;
  try {
    if (!isSqlite()) return;
    applyWave9ReportingSchema(rawDb());
    // WAVE 38 ROW 4 — 0183 rebuilds `valuation_event` to the canonical ledger
    // shape. The bootstrap path never runs 0183, so the heal must.
    applyWave38EventLedgerSchema(rawDb());
  } catch {
    /* fail-soft: the migration runner is the primary path */
  }
}

/** Test hook — lets a suite re-run the heal against a fresh :memory: db. */
export function _resetWave9SchemaGuardForTests(): void {
  _schemaEnsured = false;
}

function db(): any {
  ensureWave9Schema();
  return rawDb();
}

function tableExists(name: string): boolean {
  try {
    return !!db()
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .get(name);
  } catch {
    return false;
  }
}

/* ==========================================================================
 * 1. CONFIG — every threshold in this wave is a row, not a literal.
 * ======================================================================== */

export interface W9ConfigRow {
  key: string;
  value: unknown;
  valueType: "string" | "number" | "boolean" | "json";
  description: string;
  updatedBy: string;
  updatedAt: string;
}

/**
 * Read a config key. Throws when the key is absent rather than returning a
 * default: a silent default is how a "configured" threshold becomes a
 * hardcoded one. Migration 0152 seeds all seven keys.
 */
export function getW9Config<T = unknown>(key: string): T {
  const row = db()
    .prepare(`SELECT value_json FROM wave9_reporting_config WHERE key = ?`)
    .get(key) as { value_json: string } | undefined;
  if (!row) throw new Error(`W9_CONFIG_MISSING: ${key}`);
  return JSON.parse(row.value_json) as T;
}

export function listW9Config(): W9ConfigRow[] {
  if (!tableExists("wave9_reporting_config")) return [];
  return (
    db()
      .prepare(
        `SELECT key, value_json, value_type, description, updated_by, updated_at
         FROM wave9_reporting_config ORDER BY key`,
      )
      .all() as any[]
  ).map((r) => ({
    key: r.key,
    value: JSON.parse(r.value_json),
    valueType: r.value_type,
    description: r.description,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
  }));
}

export function setW9Config(key: string, value: unknown, actorId: string): void {
  const existing = db()
    .prepare(`SELECT key FROM wave9_reporting_config WHERE key = ?`)
    .get(key);
  if (!existing) throw new Error(`W9_CONFIG_MISSING: ${key}`);
  db()
    .prepare(
      `UPDATE wave9_reporting_config SET value_json = ?, updated_by = ?, updated_at = ? WHERE key = ?`,
    )
    .run(JSON.stringify(value), actorId, new Date().toISOString(), key);
}

/* ==========================================================================
 * 2. CASH-FLOW LEDGER (M-1 storage side)
 * ======================================================================== */

export interface CashflowRow extends IlpaFlow {
  id: string;
  tenantId: string;
  vehicleKind: "spv" | "fund" | "company" | "portfolio";
  vehicleId: string;
  sourceKind: string;
  sourceRef: string | null;
}

export function recordCashflow(input: {
  tenantId: string;
  vehicleKind: CashflowRow["vehicleKind"];
  vehicleId: string;
  lpId?: string | null;
  txnType: IlpaTransactionType;
  valueDate: string;
  amountMinor: number;
  currency: string;
  isRecallable?: boolean;
  sourceKind?: string;
  sourceRef?: string | null;
  createdBy: string;
}): string {
  const id = `vcf_${randomUUID()}`;
  db()
    .prepare(
      `INSERT INTO vehicle_cashflow
        (id, tenant_id, vehicle_kind, vehicle_id, lp_id, txn_type, value_date,
         amount_minor, currency, is_recallable, source_kind, source_ref, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      input.tenantId,
      input.vehicleKind,
      input.vehicleId,
      input.lpId ?? null,
      input.txnType,
      input.valueDate.slice(0, 10),
      Math.trunc(input.amountMinor),
      input.currency,
      input.isRecallable ? 1 : 0,
      input.sourceKind ?? "manual",
      input.sourceRef ?? null,
      input.createdBy,
      new Date().toISOString(),
    );
  return id;
}

/* W313 (R261, R250) — SITE 4. TENANT FILTER ADDED.
 *
 * `vehicle_cashflow.tenant_id` is NOT NULL, but this read named only the
 * vehicle and the LP. W303 scoped `listFlows` in server/lib/ilpaCashflowLedger.ts
 * — a DIFFERENT, near-identical function over the SAME TABLE — and this older
 * sibling was never revisited. Its one non-test caller is `buildInvestorMetrics`
 * (:1058 before this wave), so every `vehicle_cashflow` row carrying an LP's id
 * ON ANY TENANT was summed into that LP's DPI, PIC, TVPI and net IRR, and
 * through `snapshotInvestor` into a DURABLE snapshot row stamped with a single
 * tenant id. Captured over HTTP before the fix — see
 * build_log/wave313/artefacts/analytics_site4a_same_currency.before.json.
 *
 * The predicate is built on the key being PRESENT, not on it being truthy, for
 * the same reason `listOverrides` is: `if (filter.tenantId)` would let a blank
 * string silently widen the read. It is deliberately NOT written
 * `AND (? IS NULL OR tenant_id = ?)` — that shape is the unconditionally-true
 * predicate this wave exists to remove (site 3, below). */
export function listCashflows(filter: {
  vehicleKind?: CashflowRow["vehicleKind"];
  vehicleId?: string;
  lpId?: string;
  tenantId?: string;
}): CashflowRow[] {
  if (!tableExists("vehicle_cashflow")) return [];
  const where: string[] = [];
  const args: unknown[] = [];
  if (filter.vehicleKind) { where.push("vehicle_kind = ?"); args.push(filter.vehicleKind); }
  if (filter.vehicleId) { where.push("vehicle_id = ?"); args.push(filter.vehicleId); }
  if (filter.lpId) { where.push("lp_id = ?"); args.push(filter.lpId); }
  if (filter.tenantId !== undefined && filter.tenantId !== null) {
    where.push("tenant_id = ?"); args.push(filter.tenantId);
  }
  const sql =
    `SELECT * FROM vehicle_cashflow` +
    (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
    ` ORDER BY value_date, id`;
  return (db().prepare(sql).all(...args) as any[]).map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    vehicleKind: r.vehicle_kind,
    vehicleId: r.vehicle_id,
    lpId: r.lp_id,
    txnType: r.txn_type,
    valueDate: r.value_date,
    amountMinor: r.amount_minor,
    currency: r.currency,
    isRecallable: !!r.is_recallable,
    sourceKind: r.source_kind,
    sourceRef: r.source_ref,
  }));
}

/* ==========================================================================
 * 3. M-2 — MARK DERIVATION FROM THE LAST PRICED ROUND, BADGED, WITH STALENESS
 *
 * OWNER RULING Q5, verbatim in effect: marks auto-derive, are badged, go stale
 * at 180 / 365 days, and are GP-overridable.
 *
 * The derivation reads `preMoney`/`postMoney`/`pricePerShare` off the rounds
 * store (server/roundsStore.ts:112-113, the cited evidence) — the LAST round
 * for the company that is genuinely PRICED, i.e. has a price per share. A SAFE
 * or note round is NOT a priced round and must not become a mark: its cap is
 * not a valuation.
 * ======================================================================== */

export type MarkBadge = "fresh" | "stale" | "expired" | "unmarked" | "gp_override";

export interface DerivedMark {
  companyId: string;
  /** Price per share in MAJOR units, exactly as the round stores it. */
  pricePerShare: number;
  valuationDate: string;
  roundId: string;
  roundName: string;
  ageDays: number;
  badge: MarkBadge;
  method: "last_priced_round" | "gp_override";
  source: "derived_priced_round" | "gp_override";
  overrideId?: string;
  overrideReason?: string;
}

export interface MarkThresholds {
  staleWarnDays: number;
  staleExpiredDays: number;
  autoDerive: boolean;
}

export function getMarkThresholds(): MarkThresholds {
  return {
    staleWarnDays: getW9Config<number>("marks.stale_warn_days"),
    staleExpiredDays: getW9Config<number>("marks.stale_expired_days"),
    autoDerive: getW9Config<boolean>("marks.auto_derive"),
  };
}

export function badgeForAge(ageDays: number, t: MarkThresholds): MarkBadge {
  if (ageDays >= t.staleExpiredDays) return "expired";
  if (ageDays >= t.staleWarnDays) return "stale";
  return "fresh";
}

/**
 * Derive the mark for a company as of a date. Returns `null` when no priced
 * round exists — an unmarked holding, which every consumer must render as an
 * explicit empty state rather than as a value equal to cost (RP-2).
 */
export function deriveMarkForCompany(companyId: string, asOfIso?: string): DerivedMark | null {
  const asOf = (asOfIso ?? new Date().toISOString()).slice(0, 10);
  let rounds: Array<Record<string, any>> = [];
  try {
    rounds = getRoundsForCompany(companyId) as Array<Record<string, any>>;
  } catch {
    return null;
  }
  const priced = rounds
    .filter((r) => {
      const pps = typeof r.pricePerShare === "number" ? r.pricePerShare : null;
      if (pps === null || !(pps > 0)) return false;
      if (r.deletedAt) return false;
      const d = (r.closeDate ?? r.createdAt ?? null) as string | null;
      if (!d) return false;
      return d.slice(0, 10) <= asOf;
    })
    .sort((a, b) => {
      const da = (a.closeDate ?? a.createdAt ?? "").slice(0, 10);
      const dbb = (b.closeDate ?? b.createdAt ?? "").slice(0, 10);
      return da < dbb ? -1 : da > dbb ? 1 : 0;
    });
  const last = priced[priced.length - 1];
  if (!last) return null;

  const valuationDate = String(last.closeDate ?? last.createdAt).slice(0, 10);
  const ageDays = toEpochDay(asOf) - toEpochDay(valuationDate);
  const t = getMarkThresholds();
  return {
    companyId,
    pricePerShare: Number(last.pricePerShare),
    valuationDate,
    roundId: String(last.id),
    roundName: String(last.name ?? last.id),
    ageDays,
    badge: badgeForAge(ageDays, t),
    method: "last_priced_round",
    source: "derived_priced_round",
  };
}

/**
 * The EFFECTIVE mark: a GP override supersedes the derived mark (Q5, "and are
 * GP-overridable"). The override is only applied when it is not rejected — a
 * rejected override falls back to the derived mark rather than to nothing.
 */
export function effectiveMarkForCompany(
  companyId: string,
  opts?: { tenantId?: string; asOf?: string },
): DerivedMark | null {
  const derived = deriveMarkForCompany(companyId, opts?.asOf);
  /* W303 (R247) — THE INERT FENCE. `opts.tenantId` has been in this signature
   * since the function was written and was NEVER READ: the body referenced
   * only `opts?.asOf`, twice. Passing a tenant here compiled, type-checked,
   * read like a fix in review, and did nothing. It is now forwarded to
   * `latestOverride`, which is the only tenant-owned row this function reads
   * (`valuation_mark_override.tenant_id`).
   *
   * `deriveMarkForCompany` is deliberately NOT tenant-scoped. It derives from
   * the company's own priced rounds via `getRoundsForCompany`, which is
   * company-scoped data, not tenant-scoped data; narrowing it by tenant would
   * be a different boundary enforced from the wrong authority and could hide a
   * company's own mark from the people entitled to it. That is called out
   * rather than done. */
  const ov = latestOverride("company", companyId, opts?.tenantId);
  // WAVE 23 · ITEM 5: this used to test only `rejected`, which meant a PENDING
  // override moved the computed mark even when the mode was "required" — the
  // approval gate existed in `overrideIsEffective()` but this call site walked
  // straight past it. Route the decision through the single place that decides.
  if (!ov || !overrideIsEffective(ov)) return derived;
  if (!derived) return null;
  // The override carries a fair value, not a per-share price; per-share is
  // recovered only if the caller supplied one. We therefore express the
  // override as a price-per-share replacement when the units match.
  return {
    ...derived,
    pricePerShare: ov.pricePerShareOverride ?? derived.pricePerShare,
    valuationDate: ov.overriddenAt.slice(0, 10),
    ageDays: toEpochDay((opts?.asOf ?? new Date().toISOString()).slice(0, 10)) -
      toEpochDay(ov.overriddenAt.slice(0, 10)),
    badge: "gp_override",
    method: "gp_override",
    source: "gp_override",
    overrideId: ov.id,
    overrideReason: ov.reason,
  };
}

/** Persist a derived mark as a `valuation_event` so the number is auditable. */
export function persistValuationEvent(input: {
  tenantId: string;
  vehicleKind: "spv" | "fund" | "company" | "portfolio";
  vehicleId: string;
  holdingId?: string | null;
  valuationDate: string;
  fairValueMinor: number;
  currency: string;
  method: string;
  source: string;
  sourceRef?: string | null;
  preparer: string;
  isExternal: boolean;
  createdBy: string;
}): string {
  const id = `val_${randomUUID()}`;
  db()
    .prepare(
      // WAVE 38 ROW 4 — canonical event columns. `actor_id` is `created_by`
      // (this table records a real preparer/creator, so nothing is invented),
      // and `seq` is per-parent over (vehicle_kind, vehicle_id), derived by a
      // scalar subquery inside the same statement.
      `INSERT INTO valuation_event
        (id, tenant_id, vehicle_kind, vehicle_id, holding_id, valuation_date,
         fair_value_minor, currency, method, source, source_ref, preparer,
         is_external, created_by, actor_id, seq, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,
               (SELECT COALESCE(MAX(seq), 0) + 1 FROM valuation_event
                 WHERE vehicle_kind = ? AND vehicle_id = ?),
               ?)`,
    )
    .run(
      id, input.tenantId, input.vehicleKind, input.vehicleId, input.holdingId ?? null,
      input.valuationDate.slice(0, 10), Math.trunc(input.fairValueMinor), input.currency,
      input.method, input.source, input.sourceRef ?? null, input.preparer,
      input.isExternal ? 1 : 0, input.createdBy, input.createdBy,
      input.vehicleKind, input.vehicleId,
      new Date().toISOString(),
    );
  return id;
}

/* W303 (R247) — TENANT PARAMETER ADDED. The mark that feeds RVPI/TVPI was
 * readable for any vehicle id by any authenticated caller. Optional so the
 * existing internal callers compile; the HTTP read route always passes it. */
export function latestValuationEvent(
  vehicleKind: string,
  vehicleId: string,
  holdingId?: string | null,
  tenantId?: string,
): {
  id: string; valuationDate: string; fairValueMinor: number; currency: string;
  method: string; source: string; preparer: string; isExternal: boolean;
} | null {
  if (!tableExists("valuation_event")) return null;
  const row = db()
    .prepare(
      `SELECT * FROM valuation_event
        WHERE vehicle_kind = ? AND vehicle_id = ? AND superseded_at IS NULL
          AND (? IS NULL OR holding_id = ?)
          AND (? IS NULL OR tenant_id = ?)
        ORDER BY valuation_date DESC, created_at DESC LIMIT 1`,
    )
    .get(vehicleKind, vehicleId, holdingId ?? null, holdingId ?? null, tenantId ?? null, tenantId ?? null) as any;
  if (!row) return null;
  return {
    id: row.id,
    valuationDate: row.valuation_date,
    fairValueMinor: row.fair_value_minor,
    currency: row.currency,
    method: row.method,
    source: row.source,
    preparer: row.preparer,
    isExternal: !!row.is_external,
  };
}

/* ==========================================================================
 * 4. M-2b — GP MARK OVERRIDE, MANDATORY REASON, ADMIN APPROVAL MODE
 *
 * The reason is enforced in BOTH places: a CHECK constraint in migration 0152
 * (`length(trim(reason)) >= 10`) and a guard here, so neither the API nor a
 * direct SQL writer can produce an unexplained override.
 *
 * APPROVAL MODE — config key `marks.override_admin_approval_mode`.
 * GATE-OPEN3 asked whether admin approval is a GATE or a CAPABILITY.
 *
 * WAVE 23 · ITEM 5 (FINAL REVIEW B, GOVERNANCE) — THE DEFAULT IS NOW
 * "required". It was "able_to", which made a GP fair-value override EFFECTIVE
 * WHILE PENDING. That was tolerable only on the assumption that an admin could
 * see and reverse it — and both counterweights (the approve/reject endpoint and
 * this very config switch) are among the ~11 admin endpoints with zero UI
 * callers, so in the shipped product nobody could. An unreviewed GP-set fair
 * value moving a reported mark is exactly what fund-admin diligence looks for.
 *
 * "able_to" is NOT removed — it remains a fully supported value of the same
 * DB-driven key (migration 0174), so immediate-effect overrides with
 * after-the-fact review are still one config write away. Nothing is hardcoded:
 * `overrideIsEffective()` is still the single place that decides.
 *
 * THE CODE FALLBACK ALSO CHANGED, and this matters as much as the seed. When
 * the config row is absent or holds an unrecognised value, this function used
 * to answer "able_to" — so a missing row silently produced the LESS safe
 * behaviour. A missing row means nobody has made a decision, which is precisely
 * when the safe answer is required-approval. It now fails closed.
 *
 * GRANDFATHERING (see 0174's header for the full statement). Overrides that
 * were pending when 0174 ran were EFFECTIVE under the old default; de-effecting
 * them would move a fund's reported marks because of a config change. They
 * carry `grandfatheredEffective` and stay effective. They are deliberately NOT
 * stamped `approved`: that would invent an approver and an approval time that
 * never existed. They remain visibly pending.
 * ======================================================================== */

export type OverrideApprovalMode = "able_to" | "required";

export interface MarkOverride {
  id: string;
  tenantId: string;
  valuationEventId: string;
  vehicleKind: string;
  vehicleId: string;
  holdingId: string | null;
  priorFairValueMinor: number | null;
  fairValueMinor: number;
  currency: string;
  reason: string;
  overriddenBy: string;
  overriddenAt: string;
  approvalState: "pending" | "approved" | "rejected";
  approvedBy: string | null;
  approvedAt: string | null;
  approvalNote: string | null;
  /** Optional per-share expression of the override, used by mark derivation. */
  pricePerShareOverride?: number | null;
  /**
   * WAVE 23 · ITEM 5. True for overrides that were PENDING when migration 0174
   * flipped the approval default to "required". They were effective under the
   * old default and stay effective, without being falsely stamped `approved`.
   * Always false for anything written after 0174.
   */
  grandfatheredEffective: boolean;
}

export function getOverrideApprovalMode(): OverrideApprovalMode {
  // DB-driven, always. Only the FALLBACK is decided here, and it fails closed:
  // "able_to" is honoured when it is what the operator stored, and nothing else
  // yields it.
  let v: string | undefined;
  try {
    v = getW9Config<string>("marks.override_admin_approval_mode");
  } catch {
    // W9_CONFIG_MISSING (or an unreadable config table). No decision on record.
    return "required";
  }
  if (v === "able_to") return "able_to";
  return "required";
}

export function overrideIsEffective(
  o: Pick<MarkOverride, "approvalState"> & { grandfatheredEffective?: boolean },
): boolean {
  if (o.approvalState === "rejected") return false;
  if (getOverrideApprovalMode() === "required") {
    // Grandfathered rows (pending at the moment 0174 flipped the default) were
    // already effective; they are not retroactively switched off.
    return o.approvalState === "approved" || o.grandfatheredEffective === true;
  }
  return true; // "able_to": effective on write, reviewable afterwards
}

export function createMarkOverride(input: {
  tenantId: string;
  valuationEventId: string;
  vehicleKind: string;
  vehicleId: string;
  holdingId?: string | null;
  priorFairValueMinor?: number | null;
  fairValueMinor: number;
  currency: string;
  reason: string;
  overriddenBy: string;
  pricePerShareOverride?: number | null;
}): MarkOverride {
  const reason = (input.reason ?? "").trim();
  if (reason.length < 10) {
    throw new Error("MARK_OVERRIDE_REASON_REQUIRED");
  }
  if (!Number.isInteger(input.fairValueMinor) || input.fairValueMinor < 0) {
    throw new Error("MARK_OVERRIDE_VALUE_INVALID");
  }
  const id = `mov_${randomUUID()}`;
  const now = new Date().toISOString();
  db()
    .prepare(
      `INSERT INTO valuation_mark_override
        (id, tenant_id, valuation_event_id, vehicle_kind, vehicle_id, holding_id,
         prior_fair_value_minor, fair_value_minor, currency, reason,
         overridden_by, overridden_at, price_per_share_override, approval_state)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending')`,
    )
    .run(
      id, input.tenantId, input.valuationEventId, input.vehicleKind, input.vehicleId,
      input.holdingId ?? null, input.priorFairValueMinor ?? null, input.fairValueMinor,
      input.currency, reason, input.overriddenBy, now, input.pricePerShareOverride ?? null,
    );
  return getOverrideById(id)!;
}

export function decideMarkOverride(
  id: string,
  decision: "approved" | "rejected",
  adminId: string,
  note?: string,
): MarkOverride | null {
  const existing = getOverrideById(id);
  if (!existing) return null;
  db()
    .prepare(
      `UPDATE valuation_mark_override
          SET approval_state = ?, approved_by = ?, approved_at = ?, approval_note = ?
        WHERE id = ?`,
    )
    .run(decision, adminId, new Date().toISOString(), note ?? null, id);
  return getOverrideById(id);
}

function rowToOverride(r: any): MarkOverride {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    valuationEventId: r.valuation_event_id,
    vehicleKind: r.vehicle_kind,
    vehicleId: r.vehicle_id,
    holdingId: r.holding_id,
    priorFairValueMinor: r.prior_fair_value_minor,
    fairValueMinor: r.fair_value_minor,
    currency: r.currency,
    reason: r.reason,
    overriddenBy: r.overridden_by,
    overriddenAt: r.overridden_at,
    approvalState: r.approval_state,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at,
    approvalNote: r.approval_note,
    pricePerShareOverride: r.price_per_share_override ?? null,
    // Column added by 0174; `?? 0` keeps a pre-0174 row shape readable rather
    // than turning it into `undefined` and quietly widening effectiveness.
    grandfatheredEffective: !!(r.grandfathered_effective ?? 0),
  };
}

export function getOverrideById(id: string): MarkOverride | null {
  if (!tableExists("valuation_mark_override")) return null;
  const r = db().prepare(`SELECT * FROM valuation_mark_override WHERE id = ?`).get(id);
  return r ? rowToOverride(r) : null;
}

/* W303 (R247) — TENANT PARAMETER ADDED. This is the override that SUPERSEDES a
 * derived mark, so an unscoped read let one tenant's GP override change the
 * number another tenant is shown. */
export function latestOverride(vehicleKind: string, vehicleId: string, tenantId?: string): MarkOverride | null {
  if (!tableExists("valuation_mark_override")) return null;
  const r = db()
    .prepare(
      `SELECT * FROM valuation_mark_override
        WHERE vehicle_kind = ? AND vehicle_id = ? AND approval_state <> 'rejected'
          AND (? IS NULL OR tenant_id = ?)
        ORDER BY overridden_at DESC LIMIT 1`,
    )
    .get(vehicleKind, vehicleId, tenantId ?? null, tenantId ?? null);
  if (!r) return null;
  const o = rowToOverride(r);
  return overrideIsEffective(o) ? o : null;
}

/* W303 (R247) — TENANT FILTER ADDED. Before this, `GET /api/reporting/mark-overrides`
 * returned EVERY tenant's valuation overrides — reason text included — to any
 * authenticated caller. The predicate is built unconditionally on the tenant
 * argument being present rather than truthy-tested inline, so a blank tenant
 * cannot silently widen the read the way `if (filter.tenantId)` would. */
export function listOverrides(filter?: { approvalState?: string; tenantId?: string }): MarkOverride[] {
  if (!tableExists("valuation_mark_override")) return [];
  const where: string[] = [];
  const args: unknown[] = [];
  if (filter?.approvalState) { where.push("approval_state = ?"); args.push(filter.approvalState); }
  if (filter?.tenantId !== undefined && filter.tenantId !== null) {
    where.push("tenant_id = ?"); args.push(filter.tenantId);
  }
  const sql = `SELECT * FROM valuation_mark_override${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY overridden_at DESC`;
  const rows = db().prepare(sql).all(...(args as any[]));
  return (rows as any[]).map(rowToOverride);
}

/* ==========================================================================
 * 5. M-3 — MONTHLY SNAPSHOTS (owner ruling Q9)
 *
 * Precedent followed: `chapter_leaderboard_snapshots` (migrations/0036).
 * Cadence is MONTHLY and the CHECK constraint makes any other cadence
 * unrepresentable. `period_start` is always the FIRST of the month, so the
 * UNIQUE key makes the writer idempotent within a month — re-running the job
 * updates that month's row instead of appending a second point.
 * ======================================================================== */

export interface SnapshotInput {
  tenantId: string;
  subjectKind: "investor" | "spv" | "fund" | "platform";
  subjectId: string;
  periodStart?: string;
  contributedMinor: number;
  distributedMinor: number;
  residualValueMinor: number;
  currency: string;
  metrics: FundMetrics;
  markedPositions: number;
  unmarkedPositions: number;
}

export function monthStart(iso?: string): string {
  const d = (iso ?? new Date().toISOString()).slice(0, 7);
  return `${d}-01`;
}

export function writeMonthlySnapshot(input: SnapshotInput): string {
  const periodStart = monthStart(input.periodStart);
  const m = input.metrics;
  const statusJson = JSON.stringify({
    DPI: m.DPI.status, RVPI: m.RVPI.status, TVPI: m.TVPI.status,
    PIC: m.PIC.status, net_IRR: m.net_IRR.status, gross_IRR: m.gross_IRR.status,
    irrBasis: m.inputs.irrBasis,
  });
  const now = new Date().toISOString();
  const existing = db()
    .prepare(
      `SELECT id FROM portfolio_metric_snapshot
        WHERE tenant_id=? AND subject_kind=? AND subject_id=? AND period='monthly' AND period_start=?`,
    )
    .get(input.tenantId, input.subjectKind, input.subjectId, periodStart) as { id: string } | undefined;
  const id = existing?.id ?? `pms_${randomUUID()}`;
  const args = [
    input.tenantId, input.subjectKind, input.subjectId, periodStart,
    Math.trunc(input.contributedMinor), Math.trunc(input.distributedMinor),
    Math.trunc(input.residualValueMinor), input.currency,
    m.DPI.value, m.RVPI.value, m.TVPI.value, m.PIC.value, m.net_IRR.value, m.gross_IRR.value,
    statusJson, input.markedPositions, input.unmarkedPositions, now,
  ];
  if (existing) {
    db()
      .prepare(
        `UPDATE portfolio_metric_snapshot SET
           tenant_id=?, subject_kind=?, subject_id=?, period_start=?,
           contributed_minor=?, distributed_minor=?, residual_value_minor=?, currency=?,
           dpi=?, rvpi=?, tvpi=?, pic_multiple=?, net_irr=?, gross_irr=?,
           status_json=?, marked_positions=?, unmarked_positions=?, generated_at=?
         WHERE id=?`,
      )
      .run(...args, id);
  } else {
    db()
      .prepare(
        `INSERT INTO portfolio_metric_snapshot
          (tenant_id, subject_kind, subject_id, period_start,
           contributed_minor, distributed_minor, residual_value_minor, currency,
           dpi, rvpi, tvpi, pic_multiple, net_irr, gross_irr,
           status_json, marked_positions, unmarked_positions, generated_at, id, period)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'monthly')`,
      )
      .run(...args, id);
  }
  return id;
}

export interface SnapshotPoint {
  periodStart: string;
  dpi: number | null;
  rvpi: number | null;
  tvpi: number | null;
  picMultiple: number | null;
  netIrr: number | null;
  grossIrr: number | null;
  status: Record<string, MetricStatus | string>;
  markedPositions: number;
  unmarkedPositions: number;
}

/* W303 (R247) — TENANT PARAMETER ADDED. `portfolio_metric_snapshot.tenant_id`
 * is NOT NULL and is part of the table's UNIQUE key, but this read named only
 * the subject, so one tenant's monthly DPI/TVPI series was readable by any
 * authenticated caller who knew a subject id. */
export function listSnapshots(
  subjectKind: string,
  subjectId: string,
  limit = 60,
  tenantId?: string,
): SnapshotPoint[] {
  if (!tableExists("portfolio_metric_snapshot")) return [];
  const rows = db()
    .prepare(
      `SELECT * FROM portfolio_metric_snapshot
        WHERE subject_kind=? AND subject_id=? AND period='monthly'
          AND (? IS NULL OR tenant_id = ?)
        ORDER BY period_start ASC LIMIT ?`,
    )
    .all(subjectKind, subjectId, tenantId ?? null, tenantId ?? null, limit) as any[];
  return rows.map((r) => ({
    periodStart: r.period_start,
    dpi: r.dpi, rvpi: r.rvpi, tvpi: r.tvpi,
    picMultiple: r.pic_multiple, netIrr: r.net_irr, grossIrr: r.gross_irr,
    status: JSON.parse(r.status_json),
    markedPositions: r.marked_positions,
    unmarkedPositions: r.unmarked_positions,
  }));
}

export interface SeriesResult {
  points: SnapshotPoint[];
  /** Q9: a chart renders ONLY at or above the configured minimum. */
  renderable: boolean;
  minPoints: number;
  reason?: string;
}

/**
 * The ONLY function a chart should call. It returns `renderable:false` with the
 * reason when there are too few points, so the component shows "Not enough
 * history yet — 1 of 3 monthly points" instead of drawing a two-point line that
 * looks like a trend.
 */
/* W313 (R261, R250.2) — SITE 3. THE FENCE THAT WAS PRESENT AND NEVER PASSED.
 *
 * `listSnapshots` grew a `tenantId` parameter in W303 and guards it with
 * `AND (? IS NULL OR tenant_id = ?)`. This function — the ONLY function a chart
 * should call — took no tenant and called it with TWO arguments, so the
 * predicate evaluated to TRUE for every row and the fence, though installed,
 * never bit. One tenant's monthly DPI/TVPI/IRR series was charted to another.
 * Captured over HTTP before the fix — see
 * build_log/wave313/artefacts/analytics_site3_series.before.json, where tenant
 * B's months 2026-07/08/09 appear in tenant A's response.
 *
 * The parameter stays OPTIONAL so the wave-9 chart tests, which legitimately
 * read a series irrespective of tenant, keep working. Its INSTALLATION is
 * therefore proved by consequence over real HTTP rather than by its presence in
 * this signature — the presence of a parameter proves nothing, which is the
 * whole lesson of this defect. */
export function getChartSeries(subjectKind: string, subjectId: string, tenantId?: string): SeriesResult {
  const minPoints = getW9Config<number>("snapshot.min_points_for_chart");
  const points = listSnapshots(subjectKind, subjectId, 60, tenantId);
  if (points.length < minPoints) {
    return {
      points,
      renderable: false,
      minPoints,
      reason: `Not enough history yet — ${points.length} of ${minPoints} monthly snapshots.`,
    };
  }
  return { points, renderable: true, minPoints };
}

/* ==========================================================================
 * 6. M-4 — COHORT BENCHMARKS FROM PLATFORM DATA (owner ruling Q10)
 *
 * "Benchmarks are computed FROM PLATFORM DATA, not external feeds." The cohort
 * is the set of monthly snapshots for the same period across the platform. The
 * percentiles are computed over REAL rows, and if fewer than `benchmark.min_cohort_n`
 * subjects reported that period the benchmark is SUPPRESSED — publishing a
 * quartile over three funds identifies them and means nothing.
 *
 * The three literals this replaces (1.18 / 1.42 / 1.86) are deleted at the
 * PRODUCER in server/portfolioAnalyticsStore.ts (RP-5).
 * ======================================================================== */

export interface CohortBenchmark {
  metric: "tvpi" | "dpi" | "net_irr" | "rvpi";
  periodStart: string;
  p25: number;
  p50: number;
  p75: number;
  n: number;
  you: number | null;
  source: "platform_snapshots";
}

export interface CohortBenchmarkResult {
  benchmark: CohortBenchmark | null;
  status: "COMPUTED" | "INSUFFICIENT_COHORT" | "NO_DATA";
  n: number;
  minN: number;
  reason?: string;
}

/** Nearest-rank percentile over a sorted sample. Deterministic, no interpolation. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) throw new Error("PERCENTILE_EMPTY");
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

export function computeCohortBenchmark(opts: {
  metric: CohortBenchmark["metric"];
  periodStart?: string;
  subjectKind?: string;
  youSubjectId?: string;
  /** Restrict the cohort to subjects with the same vintage year, when known. */
  vintageYear?: number | null;
}): CohortBenchmarkResult {
  const minN = getW9Config<number>("benchmark.min_cohort_n");
  if (!tableExists("portfolio_metric_snapshot")) {
    return { benchmark: null, status: "NO_DATA", n: 0, minN, reason: "No snapshot history exists." };
  }
  const period = monthStart(opts.periodStart);
  const col = opts.metric === "net_irr" ? "net_irr" : opts.metric;
  const subjectKind = opts.subjectKind ?? "investor";
  /* WAVE 221 — `let`, not `const`: the opt-out filter below rebinds this. */
  /* TENANT-SCOPE-EXEMPT: Q10_COHORT_BENCHMARK */
  let rows = db()
    .prepare(
      `SELECT subject_id, ${col} AS v FROM portfolio_metric_snapshot
        WHERE period='monthly' AND period_start=? AND subject_kind=? AND ${col} IS NOT NULL`,
    )
    .all(period, subjectKind) as Array<{ subject_id: string; v: number }>;

  /* ── WAVE 221 · the benchmarking opt-out, honoured HERE and not at display ──
   *
   * R190.10: users may switch off having their data used for benchmarking and
   * matchmaking. That has to bind where the number is MADE, because a benchmark
   * filtered only on the way to the screen has still been computed from the data
   * of someone who asked it not to be.
   *
   * `unfilteredRows` is kept because `you` is resolved from it below: an opted-out
   * investor must still see THEIR OWN figure on their own screen. Removing that
   * would hide something from its owner, which R190.10 forbids.
   *
   * WITH NO TAKERS THIS IS A NO-OP. `wave221OptedOutIds` returns an empty Set for
   * a platform where nobody has switched off — and for a database that has never
   * seen migration 0228 — so `rows` is the same array contents, in the same order,
   * and every branch below produces byte-identical output to before this wave. The
   * filter is placed BEFORE the NO_DATA and minN branches deliberately: if an
   * opt-out drops a cohort under the published minimum, the benchmark must be
   * suppressed with a truthful reason, not published from a short sample. */
  const unfilteredRows = rows;
  const w221Silo: "investor" | "partner" | null =
    subjectKind === "investor" ? "investor" : subjectKind === "partner" ? "partner" : null;
  if (w221Silo !== null) {
    const optedOut = wave221OptedOutIds(w221Silo);
    if (optedOut.size > 0) {
      rows = rows.filter((r) => !optedOut.has(String(r.subject_id)));
    }
  }

  if (rows.length === 0) {
    return {
      benchmark: null, status: "NO_DATA", n: 0, minN,
      reason: `No platform snapshots reported ${opts.metric} for ${period}.`,
    };
  }
  if (rows.length < minN) {
    return {
      benchmark: null, status: "INSUFFICIENT_COHORT", n: rows.length, minN,
      reason: `Cohort of ${rows.length} is below the published minimum of ${minN}; benchmark suppressed.`,
    };
  }
  const values = rows.map((r) => r.v).sort((a, b) => a - b);
  /* WAVE 221 — resolved from the UNFILTERED rows on purpose. An opted-out subject
     is out of the peer sample above but must still be shown their own number. */
  const you = opts.youSubjectId
    ? (unfilteredRows.find((r) => r.subject_id === opts.youSubjectId)?.v ?? null)
    : null;
  return {
    benchmark: {
      metric: opts.metric,
      periodStart: period,
      p25: percentile(values, 25),
      p50: percentile(values, 50),
      p75: percentile(values, 75),
      n: values.length,
      you,
      source: "platform_snapshots",
    },
    status: "COMPUTED",
    n: values.length,
    minN,
  };
}

/* ==========================================================================
 * 7. Per-investor metric assembly — the shared path used by the investor
 *    dashboard route (RP-1..RP-5) and by the monthly snapshot job (M-3).
 * ======================================================================== */

export interface InvestorPosition {
  companyId: string;
  roundId: string;
  /** MAJOR units as recorded on the commit ledger. */
  invested: number;
  shares: number;
  currency: string;
  ts: string;
  mark: DerivedMark | null;
  /** MAJOR units. `null` when the position is UNMARKED — never equal to cost. */
  currentValue: number | null;
}

export interface InvestorMetricBundle {
  positions: InvestorPosition[];
  metrics: FundMetrics;
  markedPositions: number;
  unmarkedPositions: number;
  expiredMarks: number;
  staleMarks: number;
  /* WAVE 180 · ITEM A SITE 3 — `currency` used to be `positions[0].currency`,
   * i.e. the FIRST holding's code stamped onto totals accumulated over every
   * holding. It is now null when the ledger spans codes, and the money scalars
   * below go null with it. NOTHING IS CONVERTED: this platform has no FX rate
   * source, so a mixed ledger yields a stated refusal, never a number. */
  currency: string | null;
  contributedMinor: number | null;
  distributedMinor: number | null;
  residualValueMinor: number | null;
  /* WAVE 180 · ITEM A SITE 3 — every ISO code seen across the positions AND the
   * ledgered cashflows, sorted. Length > 1 is the refusal condition. */
  currencies: string[];
  /* WAVE 180 · ITEM A SITE 3 — false when the scalars above are null because the
   * ledger is cross-currency. Callers MUST NOT read `metrics`' money inputs or
   * its ratios when this is false: they were computed over a flow array spanning
   * currencies and are not denominated in anything real. The shape deliberately
   * mirrors the endpoint refusal wave 21 already ships in
   * server/lib/reportingEngineRoutes.ts, so the store and the routes refuse
   * cross-currency data in one recognisable way. */
  metricsAvailable: boolean;
  metricsUnavailable: {
    reason: "needs_fx_conversion";
    currencies: string[];
    message: string;
  } | null;
  /* WAVE 180 · ITEM A SITE 3 — the per-currency truth that replaces the mixed
   * sum. Always populated, single-currency included, so a caller never has to
   * branch on availability just to render the breakdown. */
  byCurrency: Array<{
    currency: string;
    contributedMinor: number;
    residualValueMinor: number | null;
    positions: number;
  }>;
}

/* WAVE 33 OQ-33-2 sink 1 — this function previously read
 *   `return Math.round(major * 100)`
 * i.e. a hardcoded ISO 4217 exponent of 2. Every position on the ledger
 * carries its own `currency`, so the exponent is derived from it and never
 * assumed. For JPY (exponent 0) the old form inflated every figure 100x, in
 * BOTH poles of this store: the capital-call flow (negative) and the residual
 * value (positive). Same numeric type (number of minor units) as before. */
function toMinorUnits(major: number, currency: string): number {
  return toMinor(major, currency);
}

/**
 * Build the metric bundle for one investor from REAL rows only:
 *   contributions  <- the canonical cap-table commit ledger (owner ruling Q1)
 *                     plus any explicit `vehicle_cashflow` rows for the LP
 *   distributions  <- `vehicle_cashflow` distribution rows ONLY
 *   residual value <- marks derived from the last priced round (M-2)
 * A holding with no priced round contributes NOTHING to residual value and is
 * counted in `unmarkedPositions`, so the UI can say "4 of 7 holdings unmarked".
 */
export function buildInvestorMetrics(
  commits: Array<{ companyId: string; roundId: string; amount: string; shares: string; currency: string; ts: string }>,
  /* W313 — `tenantId` added. See SITE 4 and SITE 5 below. */
  opts?: { asOf?: string; lpId?: string; tenantId?: string },
): InvestorMetricBundle {
  const asOf = (opts?.asOf ?? new Date().toISOString()).slice(0, 10);
  const t = (() => {
    try { return getMarkThresholds(); } catch { return null; }
  })();

  const positions: InvestorPosition[] = commits.map((c) => {
    const invested = Number.parseFloat(c.amount || "0");
    const shares = Number.parseFloat(c.shares || "0");
    let mark: DerivedMark | null = null;
    /* W313 — SITE 5. `effectiveMarkForCompany` forwards its tenant to
     * `latestOverride`, which reads `valuation_mark_override.tenant_id`. This
     * call omitted it, so ANOTHER TENANT'S private GP valuation restatement —
     * its replacement price per share AND its mandatory free-text reason —
     * decided the mark on this investor's position. Reached over real HTTP:
     * build_log/wave313/artefacts/analytics_site5_marks.before.json shows
     * `valuation.worstBadge === "gp_override"` on tenant A's own response after
     * tenant B wrote an override tenant A can never see. */
    try { mark = effectiveMarkForCompany(c.companyId, { asOf, tenantId: opts?.tenantId }); } catch { mark = null; }
    // An EXPIRED mark (>= 365 days, owner ruling Q5) stops counting as a mark.
    const usable = mark && mark.badge !== "expired" ? mark : null;
    const currentValue =
      usable && Number.isFinite(shares) && shares > 0 ? usable.pricePerShare * shares : null;
    return {
      companyId: c.companyId,
      roundId: c.roundId,
      invested: Number.isFinite(invested) ? invested : 0,
      shares: Number.isFinite(shares) ? shares : 0,
      currency: c.currency || "USD",
      ts: c.ts,
      mark,
      currentValue,
    };
  });

  const flows: IlpaFlow[] = positions.map((p) => ({
    valueDate: (p.ts || asOf).slice(0, 10),
    amountMinor: -toMinorUnits(p.invested, p.currency),
    txnType: "capital_call_investment",
    currency: p.currency,
  }));

  // Real recorded distributions (and any explicitly ledgered extra calls).
  if (opts?.lpId) {
    /* W313 — SITE 4. `tenantId` forwarded. Before this, every ledgered cash
     * flow carrying this LP's id, on ANY tenant and in ANY currency, was pushed
     * into `flows` and reached `computeFundMetrics` below. */
    for (const row of listCashflows({ lpId: opts.lpId, tenantId: opts.tenantId })) {
      flows.push({
        valueDate: row.valueDate,
        amountMinor: row.amountMinor,
        txnType: row.txnType,
        currency: row.currency,
        isRecallable: row.isRecallable,
      });
    }
  }

  const markedPositions = positions.filter((p) => p.currentValue !== null).length;
  const unmarkedPositions = positions.length - markedPositions;
  const expiredMarks = positions.filter((p) => p.mark?.badge === "expired").length;
  const staleMarks = positions.filter((p) => p.mark?.badge === "stale").length;

  /* Residual value is reported ONLY when EVERY position is marked. A partial
   * sum would understate the portfolio while looking like a complete figure —
   * the single most dangerous shape a reporting number can take. */
  /* WAVE 180 · ITEM A SITE 3 — THE DEFECT.
   *
   * This store carried the exact defect wave 21 fixed one layer up in
   * server/lib/reportingEngineRoutes.ts, and was missed: `currency` was
   * `positions[0]?.currency ?? "USD"`, the FIRST holding's code, while
   * `residualValueMinor` reduced `toMinorUnits(...)` over EVERY holding and the
   * flow array handed to `computeFundMetrics` mixed each position's own currency
   * (plus every ledgered cashflow's currency) into one `paidInMinor` and one
   * `distributedMinor`. An investor holding CA$1,200.00 and HK$2,000,000.00
   * alongside USD got those minor units added and the result labelled with
   * whichever holding happened to sort first — then `snapshotInvestor` PERSISTED
   * that label next to that total, which is a durable financial record of money
   * that does not exist.
   *
   * THE FIX. Currency is a precondition, exactly as it is in the routes. The set
   * of codes is taken across BOTH poles that feed the metrics — the positions and
   * the appended `vehicle_cashflow` rows — because a USD-only holdings list with a
   * CAD distribution row is the same defect. More than one code ⇒ every money
   * scalar is null, `metricsAvailable` is false, and the reason is stated. NO FX
   * RATE IS INVENTED OR HARDCODED; there is no rate source in this repository.
   *
   * The per-currency breakdown is computed unconditionally so the surface has
   * something true to show in place of the refused total. */
  const currencySet = new Set<string>();
  for (const p of positions) currencySet.add(normalizeCurrency(p.currency));
  for (const f of flows) currencySet.add(normalizeCurrency(f.currency));
  const currencies = Array.from(currencySet).sort();
  const crossCurrency = currencies.length > 1;

  const byCurrencyMap = new Map<string, { contributedMinor: number; residualValueMinor: number | null; positions: number }>();
  for (const p of positions) {
    const code = normalizeCurrency(p.currency);
    const row = byCurrencyMap.get(code) ?? { contributedMinor: 0, residualValueMinor: null, positions: 0 };
    row.positions += 1;
    row.contributedMinor += toMinorUnits(p.invested, code);
    byCurrencyMap.set(code, row);
  }
  /* A per-currency residual is reported only when EVERY holding in THAT currency
   * is marked — the same all-or-nothing rule the single-currency total has always
   * used, applied per bucket rather than abandoned. */
  for (const code of Array.from(byCurrencyMap.keys())) {
    const inCode = positions.filter((p) => normalizeCurrency(p.currency) === code);
    const row = byCurrencyMap.get(code)!;
    row.residualValueMinor = inCode.length > 0 && inCode.every((p) => p.currentValue !== null)
      ? inCode.reduce((s, p) => s + toMinorUnits(p.currentValue as number, code), 0)
      : null;
  }
  const byCurrency = Array.from(byCurrencyMap.entries())
    .map(([currency, r]) => ({ currency, ...r }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  const currency = crossCurrency ? null : (currencies[0] ?? "USD");

  const residualValueMinor =
    !crossCurrency && positions.length > 0 && unmarkedPositions === 0
      ? positions.reduce((s, p) => s + toMinorUnits(p.currentValue as number, p.currency), 0)
      : null;

  const metrics = computeFundMetrics({
    flows,
    residualValueMinor,
    committedMinor: null, // an angel investor has no committed-capital construct
    asOfDate: asOf,
    marksStale: staleMarks > 0,
  });

  /* WAVE 180 · ITEM A SITE 3 — these two came straight off `metrics.inputs`,
     which sums across the whole flow array. On a mixed ledger that sum is not
     denominated in any currency, so it is withheld rather than relabelled. */
  const contributedMinor = crossCurrency ? null : metrics.inputs.picMinor;
  const distributedMinor = crossCurrency ? null : metrics.inputs.distributedMinor;

  void t;
  return {
    positions, metrics, markedPositions, unmarkedPositions,
    expiredMarks, staleMarks, currency,
    contributedMinor, distributedMinor, residualValueMinor,
    currencies,
    metricsAvailable: !crossCurrency,
    metricsUnavailable: crossCurrency
      ? {
          reason: "needs_fx_conversion",
          currencies,
          message:
            `This portfolio is recorded in ${currencies.join(", ")}. ` +
            "Contributed, distributed and current value are shown per currency rather than as one figure, " +
            "because adding them would need an exchange rate, an as-of date and an audit trail, " +
            "and no FX conversion source is configured on this platform.",
        }
      : null,
    byCurrency,
  };
}

/**
 * M-3 job entry point. Writes THIS month's snapshot for one investor.
 * Idempotent within the month by the UNIQUE key.
 */
export function snapshotInvestor(
  tenantId: string,
  investorId: string,
  commits: Parameters<typeof buildInvestorMetrics>[0],
  asOf?: string,
): string | null {
  try {
    /* W313 — the DURABLE half of site 4. This function already knows its
     * tenant; it just never told the metrics builder. A snapshot row carries
     * ONE `tenant_id` and is written by `writeMonthlySnapshot` keyed on it, so
     * an unscoped read here persisted one tenant's distributions inside another
     * tenant's financial record. That is the sharpest harm in this wave: a
     * stored, auditable figure, not just a screen. */
    const b = buildInvestorMetrics(commits, { asOf, lpId: investorId, tenantId });
    /* WAVE 180 · ITEM A SITE 3 — REFUSE THE DURABLE WRITE, mirroring the HTTP 409
     * CROSS_CURRENCY_SNAPSHOT_BLOCKED that wave 21 put on the vehicle snapshot
     * route. A snapshot row carries ONE currency column; this path used to write
     * `currency: b.currency` — the first holding's code — beside totals summed
     * over every currency in the ledger. A skipped month is recoverable from the
     * live ledger; a wrong persisted financial record is not. */
    if (!b.metricsAvailable || b.currency === null || b.contributedMinor === null || b.distributedMinor === null) {
      log.warn(
        `[wave9][M-3] snapshot REFUSED for ${investorId}: cross-currency ledger ` +
        `(${b.currencies.join(", ")}). A snapshot row carries a single currency; writing one ` +
        "would record totals that are not denominated in any real currency. No FX conversion source is configured.",
      );
      return null;
    }
    return writeMonthlySnapshot({
      tenantId,
      subjectKind: "investor",
      subjectId: investorId,
      periodStart: asOf,
      contributedMinor: b.contributedMinor,
      distributedMinor: b.distributedMinor,
      residualValueMinor: b.residualValueMinor ?? 0,
      currency: b.currency,
      metrics: b.metrics,
      markedPositions: b.markedPositions,
      unmarkedPositions: b.unmarkedPositions,
    });
  } catch (err) {
    log.warn(`[wave9][M-3] snapshot skipped for ${investorId}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
