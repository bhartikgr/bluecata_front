/**
 * WAVE 32 · CP-SPV-30 · SIDE-LETTER STORE (capability 4's data layer, built in
 * capability 2 because the waterfall cannot honour a term it cannot read).
 *
 * A side letter is a per-LP agreement that OVERRIDES the fund default for that
 * LP alone. Table `spv_side_letter` (migration 0178).
 *
 * ── NULL IS NOT ZERO, AND THAT IS THE WHOLE DESIGN ────────────────────────
 * Every override column is nullable and NULL means "no override — inherit the
 * fund term". A letter carrying `carry_fraction_scaled = 0` is an LP who pays
 * NO carry; a letter carrying NULL is an LP on the fund's carry. Collapsing the
 * two would silently rewrite economics in a direction nobody agreed to, so
 * every reader in this file preserves the distinction and no default of `?? 0`
 * appears anywhere below.
 *
 * ── ONE ACTIVE LETTER PER (SPV, INVESTOR) ─────────────────────────────────
 * Enforced by the partial unique index `uq_w32_sl_active`, i.e. by the
 * DATABASE, not by a read-then-write check in application code that two
 * concurrent requests can both pass. Superseding writes a NEW row and stamps
 * the old one so the negotiated history survives; nothing is updated in place
 * and nothing is deleted.
 *
 * ── RATES ARE FRACTIONS ───────────────────────────────────────────────────
 * Stored as integer billionths (`CARRY_FRACTION_SCALE`). 20% is 200000000. A
 * GP types "20" in a percent field and the ROUTE converts once, explicitly, at
 * the boundary; nothing in this file guesses at a number's units.
 */
import { randomUUID } from "node:crypto";
import { rawDb } from "./db/connection";
import { isSqlite } from "./db/portable";
import { log } from "./lib/logger";
import { applySpvInstitutionalSchema } from "./lib/applySpvInstitutionalSchema";
import { CARRY_FRACTION_SCALE } from "./lib/money";
import type { SideLetterCarryOverride } from "./lib/spvSideLetterWaterfall";

let _schemaEnsured = false;
/** A-22 heal: `connection.ts` (SACRED) predates 0178 and cannot install it. */
function ensureSchema(): void {
  if (_schemaEnsured) return;
  _schemaEnsured = true;
  try {
    if (!isSqlite()) return;
    applySpvInstitutionalSchema(rawDb() as any);
  } catch (err) {
    log.warn(`[spvSideLetterStore] schema heal skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
}
/** Exported so tests can force the heal on a freshly opened database. */
export function ensureSideLetterSchemaForTests(): void {
  _schemaEnsured = false;
  ensureSchema();
}

export class SideLetterValidationError extends Error {
  constructor(readonly code: string, message?: string) {
    super(message ?? code);
    this.name = "SideLetterValidationError";
  }
}

export interface SideLetterRow {
  id: string;
  spvId: string;
  investorId: string;
  /** Integer billionths, or NULL for "inherit the fund carry". */
  carryFractionScaled: number | null;
  mgmtFeeFractionScaled: number | null;
  hurdleFractionScaled: number | null;
  minCheckMinor: number | null;
  currency: string;
  coInvestorVisibility: "inherit" | "own_only" | "co_investors";
  mfnClause: boolean;
  notes: string | null;
  documentRef: string | null;
  effectiveDate: string;
  status: "active" | "superseded" | "revoked";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
  supersededAt: string | null;
}

function mapRow(r: any): SideLetterRow {
  return {
    id: String(r.id),
    spvId: String(r.spv_id),
    investorId: String(r.investor_id),
    // `?? null`, never `?? 0` — see the header. An absent override is unknown,
    // not free.
    carryFractionScaled: r.carry_fraction_scaled == null ? null : Number(r.carry_fraction_scaled),
    mgmtFeeFractionScaled: r.mgmt_fee_fraction_scaled == null ? null : Number(r.mgmt_fee_fraction_scaled),
    hurdleFractionScaled: r.hurdle_fraction_scaled == null ? null : Number(r.hurdle_fraction_scaled),
    minCheckMinor: r.min_check_minor == null ? null : Number(r.min_check_minor),
    currency: String(r.currency || "USD"),
    coInvestorVisibility: (r.co_investor_visibility ?? "inherit") as SideLetterRow["coInvestorVisibility"],
    mfnClause: Number(r.mfn_clause ?? 0) === 1,
    notes: r.notes == null ? null : String(r.notes),
    documentRef: r.document_ref == null ? null : String(r.document_ref),
    effectiveDate: String(r.effective_date),
    status: String(r.status) as SideLetterRow["status"],
    createdBy: String(r.created_by),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    updatedBy: r.updated_by == null ? null : String(r.updated_by),
    supersededAt: r.superseded_at == null ? null : String(r.superseded_at),
  };
}

const SELECT_COLS = `id, spv_id, investor_id, carry_fraction_scaled, mgmt_fee_fraction_scaled,
  hurdle_fraction_scaled, min_check_minor, currency, co_investor_visibility, mfn_clause, notes,
  document_ref, effective_date, status, created_by, created_at, updated_at, updated_by, superseded_at`;

/** Every letter for a vehicle, newest first. GP-only surface. */
export function listSideLetters(spvId: string, opts?: { activeOnly?: boolean }): SideLetterRow[] {
  ensureSchema();
  const sql = opts?.activeOnly
    ? `SELECT ${SELECT_COLS} FROM spv_side_letter WHERE spv_id = ? AND status = 'active'
       ORDER BY effective_date DESC, created_at DESC, id ASC`
    : `SELECT ${SELECT_COLS} FROM spv_side_letter WHERE spv_id = ?
       ORDER BY effective_date DESC, created_at DESC, id ASC`;
  return (rawDb().prepare(sql).all(spvId) as any[]).map(mapRow);
}

/**
 * ONE LP's own active side letter, and nothing else.
 *
 * LP PRIVACY. A side letter is the most sensitive per-LP artifact in the
 * vehicle — it is literally the record that this LP negotiated better terms
 * than their co-investors. This function is the ONLY reader the LP-facing
 * surface may call, and it is scoped by `investor_id` in the SQL itself rather
 * than by filtering a fetched list, so there is no intermediate array holding
 * another LP's terms that a future edit could accidentally return.
 */
export function lpOwnSideLetter(spvId: string, investorId: string): SideLetterRow | null {
  ensureSchema();
  const row = rawDb()
    .prepare(`SELECT ${SELECT_COLS} FROM spv_side_letter
              WHERE spv_id = ? AND investor_id = ? AND status = 'active' LIMIT 1`)
    .get(spvId, investorId) as any | undefined;
  return row ? mapRow(row) : null;
}

/**
 * The carry overrides in force for a distribution, in the shape
 * `applySideLetterCarry` consumes.
 *
 * Letters whose carry is NULL are EXCLUDED, because NULL means "inherit" and an
 * inheriting LP must go through the fund rate untouched — including its
 * rounding path. Only an explicit rate reaches the waterfall.
 */
export function activeCarryOverrides(spvId: string): SideLetterCarryOverride[] {
  ensureSchema();
  const rows = rawDb()
    .prepare(`SELECT id, investor_id, carry_fraction_scaled FROM spv_side_letter
              WHERE spv_id = ? AND status = 'active' AND carry_fraction_scaled IS NOT NULL
              ORDER BY investor_id ASC`)
    .all(spvId) as Array<{ id: string; investor_id: string; carry_fraction_scaled: number }>;
  return rows.map((r) => ({
    investorId: String(r.investor_id),
    carryFractionScaled: Number(r.carry_fraction_scaled),
    sideLetterId: String(r.id),
  }));
}

/* ── writes ──────────────────────────────────────────────────────────────── */

export interface SideLetterInput {
  spvId: string;
  tenantId: string;
  investorId: string;
  carryFractionScaled?: number | null;
  mgmtFeeFractionScaled?: number | null;
  hurdleFractionScaled?: number | null;
  minCheckMinor?: number | null;
  currency: string;
  coInvestorVisibility?: "inherit" | "own_only" | "co_investors";
  mfnClause?: boolean;
  notes?: string | null;
  documentRef?: string | null;
  effectiveDate: string;
  actor: string;
}

function validateScaled(v: number | null | undefined, label: string): number | null {
  if (v === null || v === undefined) return null;
  if (!Number.isFinite(v) || !Number.isInteger(v)) {
    throw new SideLetterValidationError("SIDE_LETTER_RATE_NOT_INTEGER_SCALED", `${label} must be integer billionths`);
  }
  // Out of domain is REFUSED, not clamped and not "repaired" by a
  // `n > 1 ? n/100 : n` guess. That guess cannot distinguish 1% from 100%
  // and is what turned a typed "8" into a 100% preferred return in Wave 5.
  if (v < 0 || v > CARRY_FRACTION_SCALE) {
    throw new SideLetterValidationError("SIDE_LETTER_RATE_OUT_OF_DOMAIN", `${label} must be within [0, 1e9]`);
  }
  return v;
}

/**
 * Create an active side letter, superseding any existing active one for the
 * same (spv, investor) inside ONE transaction — so the partial unique index can
 * never see two active rows, and a failure leaves the prior letter intact and
 * in force rather than revoking terms with nothing to replace them.
 */
export function createSideLetter(input: SideLetterInput): SideLetterRow {
  ensureSchema();
  if (!input.investorId) throw new SideLetterValidationError("SIDE_LETTER_INVESTOR_REQUIRED");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate)) {
    throw new SideLetterValidationError("SIDE_LETTER_EFFECTIVE_DATE_INVALID");
  }
  const carry = validateScaled(input.carryFractionScaled, "carryFractionScaled");
  const mgmt = validateScaled(input.mgmtFeeFractionScaled, "mgmtFeeFractionScaled");
  const hurdle = validateScaled(input.hurdleFractionScaled, "hurdleFractionScaled");
  if (input.minCheckMinor != null && (!Number.isInteger(input.minCheckMinor) || input.minCheckMinor < 0)) {
    throw new SideLetterValidationError("SIDE_LETTER_MIN_CHECK_INVALID");
  }
  const vis = input.coInvestorVisibility ?? "inherit";
  if (!["inherit", "own_only", "co_investors"].includes(vis)) {
    throw new SideLetterValidationError("SIDE_LETTER_VISIBILITY_INVALID");
  }

  const now = new Date().toISOString();
  const id = `sl_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const db = rawDb();
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE spv_side_letter SET status = 'superseded', superseded_at = ?, updated_at = ?, updated_by = ?
       WHERE spv_id = ? AND investor_id = ? AND status = 'active'`,
    ).run(now, now, input.actor, input.spvId, input.investorId);
    db.prepare(
      `INSERT INTO spv_side_letter (id, tenant_id, spv_id, investor_id, carry_fraction_scaled,
         mgmt_fee_fraction_scaled, hurdle_fraction_scaled, min_check_minor, currency,
         co_investor_visibility, mfn_clause, notes, document_ref, effective_date, status,
         created_by, created_at, updated_at, updated_by, superseded_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?,?,NULL,NULL)`,
    ).run(
      id, input.tenantId, input.spvId, input.investorId, carry, mgmt, hurdle,
      input.minCheckMinor ?? null, input.currency, vis, input.mfnClause ? 1 : 0,
      input.notes ?? null, input.documentRef ?? null, input.effectiveDate,
      input.actor, now, now,
    );
  });
  tx();
  const created = rawDb().prepare(`SELECT ${SELECT_COLS} FROM spv_side_letter WHERE id = ?`).get(id) as any;
  return mapRow(created);
}

/** Revoke an active letter. The LP reverts to the fund defaults. */
export function revokeSideLetter(spvId: string, sideLetterId: string, actor: string): SideLetterRow | null {
  ensureSchema();
  const now = new Date().toISOString();
  rawDb()
    .prepare(`UPDATE spv_side_letter SET status = 'revoked', superseded_at = ?, updated_at = ?, updated_by = ?
              WHERE id = ? AND spv_id = ? AND status = 'active'`)
    .run(now, now, actor, sideLetterId, spvId);
  const row = rawDb()
    .prepare(`SELECT ${SELECT_COLS} FROM spv_side_letter WHERE id = ? AND spv_id = ?`)
    .get(sideLetterId, spvId) as any | undefined;
  return row ? mapRow(row) : null;
}
