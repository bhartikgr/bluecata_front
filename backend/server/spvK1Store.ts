/**
 * WAVE 32 · CP-SPV-30 · CAPABILITY 3 — K-1 STORE.
 *
 * The DB-backed half of the K-1 capability. `server/lib/spvK1.ts` holds the
 * pure computation; this file reads the real rows it computes over and persists
 * generated statements into `spv_k1_statement` (migration 0178).
 *
 * NO IN-MEMORY STATE beyond the idempotent schema-heal memo.
 *
 * NAMED SINKS (rule 2 — fix where the data flows):
 *   distributions <- `spv_distribution` (allocations_json, waterfall_json). The
 *                    realized profit comes from the `carry_base` tier, which is
 *                    the same figure the waterfall charged carry on — so an
 *                    LP's K-1 income and their carry can never disagree.
 *   contributions <- `spv.terms._fundsConfirmations`, the durable offline
 *                    wire-confirmation record (SPV-CORE-1). Commitments are NOT
 *                    used: a promise is not cash.
 *   register      <- `spv_subscription` where status = 'committed'.
 *   statements    -> `spv_k1_statement`.
 *
 * A DERIVED K-1 IS NOT PERSISTED ON READ, for the same reason a NAV is not: an
 * issued K-1 is a filed artifact with a named preparer, and manufacturing one
 * as a side effect of a page load would put an unsigned tax document into the
 * record.
 */
import { randomUUID } from "node:crypto";
import { rawDb } from "./db/connection";
import { isSqlite } from "./db/portable";
import { log } from "./lib/logger";
import { applySpvInstitutionalSchema } from "./lib/applySpvInstitutionalSchema";
import { computeK1Statements, type K1Statement, type K1DistributionInput, type K1ContributionInput } from "./lib/spvK1";
import { spvBasics, committedRegisterRows } from "./spvNavStore";

let _schemaEnsured = false;
function ensureSchema(): void {
  if (_schemaEnsured) return;
  _schemaEnsured = true;
  try {
    if (!isSqlite()) return;
    applySpvInstitutionalSchema(rawDb() as any);
  } catch (err) {
    log.warn(`[spvK1Store] schema heal skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
}
export function ensureK1SchemaForTests(): void {
  _schemaEnsured = false;
  ensureSchema();
}

export class SpvK1NotFoundError extends Error {
  readonly code = "SPV_NOT_FOUND";
  constructor() {
    super("SPV not found.");
    this.name = "SpvK1NotFoundError";
  }
}

/* ── readers ─────────────────────────────────────────────────────────────── */

/** Recorded distributions with their realized profit and per-LP allocations. */
export function k1DistributionsForSpv(spvId: string): K1DistributionInput[] {
  const rows = rawDb()
    .prepare(`SELECT id, created_at, currency, gross_proceeds_minor, waterfall_json, allocations_json
              FROM spv_distribution WHERE spv_id = ? ORDER BY created_at ASC, id ASC`)
    .all(spvId) as Array<{
      id: string; created_at: string; currency: string; gross_proceeds_minor: number;
      waterfall_json: string; allocations_json: string;
    }>;
  return rows.map((r) => {
    let realizedProfitMinor: number | null = null;
    try {
      const tiers = JSON.parse(r.waterfall_json) as Array<{ tier?: string; amountMinor?: number }>;
      const base = tiers.find((t) => t?.tier === "carry_base");
      // NULL, not 0, when the row does not state it. A legacy distribution
      // written before the tier existed has an UNKNOWN profit, and an unknown
      // profit is not a zero-profit event.
      realizedProfitMinor = typeof base?.amountMinor === "number" ? base.amountMinor : null;
    } catch {
      realizedProfitMinor = null;
    }
    let allocations: K1DistributionInput["allocations"] = [];
    try {
      allocations = (JSON.parse(r.allocations_json) as any[]).map((a) => ({
        investorId: String(a.investorId),
        grossMinor: Number(a.grossMinor ?? 0),
        carryMinor: Number(a.carryMinor ?? 0),
        netMinor: Number(a.netMinor ?? 0),
      }));
    } catch {
      allocations = [];
    }
    return {
      id: r.id,
      createdAt: String(r.created_at),
      currency: String(r.currency || "USD"),
      grossProceedsMinor: Number(r.gross_proceeds_minor ?? 0),
      realizedProfitMinor,
      allocations,
    };
  });
}

/** Confirmed offline capital receipts, from the durable SPV terms record. */
export function k1ContributionsForSpv(spvId: string): K1ContributionInput[] {
  const row = rawDb().prepare(`SELECT terms_json FROM spv WHERE id = ?`).get(spvId) as
    | { terms_json?: string }
    | undefined;
  if (!row?.terms_json) return [];
  let bag: Record<string, { receivedMinor?: number; confirmedAt?: string }> = {};
  try {
    bag = ((JSON.parse(row.terms_json) as any)?._fundsConfirmations ?? {}) as typeof bag;
  } catch {
    return [];
  }
  const out: K1ContributionInput[] = [];
  for (const [investorId, v] of Object.entries(bag)) {
    // A confirmation with no date cannot be placed in a tax year. Dropping it
    // is the honest move: it will surface as NO_FUNDS_CONFIRMATION rather than
    // being silently assigned to whatever year happens to be open.
    if (!v?.confirmedAt || typeof v.receivedMinor !== "number") continue;
    out.push({ investorId, confirmedAt: String(v.confirmedAt), receivedMinor: Number(v.receivedMinor) });
  }
  return out.sort((a, b) => (a.confirmedAt < b.confirmedAt ? -1 : 1));
}

/** Derive every LP's K-1 for a tax year. Writes nothing. */
export function deriveK1s(spvId: string, taxYear: number): K1Statement[] {
  ensureSchema();
  const spv = spvBasics(spvId);
  if (!spv) throw new SpvK1NotFoundError();
  return computeK1Statements({
    spvId,
    taxYear,
    vehicleCurrency: spv.currency,
    register: committedRegisterRows(spvId),
    distributions: k1DistributionsForSpv(spvId),
    contributions: k1ContributionsForSpv(spvId),
  });
}

/**
 * ONE LP's own K-1, and nothing else.
 *
 * LP PRIVACY. The whole cohort is computed (an ownership fraction is only
 * meaningful against the whole register) and then filtered to the caller
 * before returning. Other LPs' statements exist for microseconds inside this
 * function and are never returned, logged or serialised. Returns null for a
 * non-member so the caller's refusal shape stays uniform.
 */
export function lpOwnK1(spvId: string, investorId: string, taxYear: number): K1Statement | null {
  return deriveK1s(spvId, taxYear).find((k) => k.investorId === investorId) ?? null;
}

/* ── persistence ─────────────────────────────────────────────────────────── */

export interface StoredK1 extends K1Statement {
  id: string;
  spvId: string;
  status: "draft" | "issued" | "superseded";
  generatedBy: string;
  generatedAt: string;
  issuedAt: string | null;
  supersededAt: string | null;
}

function mapStored(r: any): StoredK1 {
  return {
    id: String(r.id),
    spvId: String(r.spv_id),
    investorId: String(r.investor_id),
    taxYear: Number(r.tax_year),
    currency: String(r.currency),
    beginningCapitalMinor: r.beginning_capital_minor == null ? null : Number(r.beginning_capital_minor),
    contributionsMinor: r.contributions_minor == null ? null : Number(r.contributions_minor),
    distributionsMinor: r.distributions_minor == null ? null : Number(r.distributions_minor),
    allocatedIncomeMinor: r.allocated_income_minor == null ? null : Number(r.allocated_income_minor),
    carryAllocatedMinor: r.carry_allocated_minor == null ? null : Number(r.carry_allocated_minor),
    endingCapitalMinor: r.ending_capital_minor == null ? null : Number(r.ending_capital_minor),
    ownershipFraction: r.ownership_fraction == null ? null : Number(r.ownership_fraction),
    refusals: JSON.parse(String(r.refusals_json || "[]")),
    sourceIds: JSON.parse(String(r.sources_json || "[]")),
    status: String(r.status) as StoredK1["status"],
    generatedBy: String(r.generated_by),
    generatedAt: String(r.generated_at),
    issuedAt: r.issued_at == null ? null : String(r.issued_at),
    supersededAt: r.superseded_at == null ? null : String(r.superseded_at),
  };
}

const K1_COLS = `id, spv_id, investor_id, tax_year, currency, beginning_capital_minor,
  contributions_minor, distributions_minor, allocated_income_minor, carry_allocated_minor,
  ending_capital_minor, ownership_fraction, refusals_json, sources_json, status,
  generated_by, generated_at, issued_at, superseded_at`;

/**
 * Generate and persist a DRAFT K-1 per committed LP for the tax year,
 * superseding any prior draft for the same (spv, investor, year) in one
 * transaction. Issued statements are NEVER overwritten — reissuing writes a new
 * row that supersedes, because an issued K-1 has left the building.
 *
 * REFUSALS ARE PERSISTED AS NULL, NOT AS ZERO. The stored row carries exactly
 * what the engine derived, so a statement read back next year still says "we
 * did not know this" rather than "this was nothing".
 */
export function generateK1Drafts(spvId: string, taxYear: number, actor: string): StoredK1[] {
  ensureSchema();
  const derived = deriveK1s(spvId, taxYear);
  const spv = spvBasics(spvId)!;
  const now = new Date().toISOString();
  const db = rawDb();
  const ids: string[] = [];
  const tx = db.transaction(() => {
    for (const k of derived) {
      db.prepare(
        `UPDATE spv_k1_statement SET status = 'superseded', superseded_at = ?
         WHERE spv_id = ? AND investor_id = ? AND tax_year = ? AND status = 'draft'`,
      ).run(now, spvId, k.investorId, taxYear);
      const id = `k1_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
      ids.push(id);
      db.prepare(
        `INSERT INTO spv_k1_statement (id, tenant_id, spv_id, investor_id, tax_year, currency,
           beginning_capital_minor, contributions_minor, distributions_minor, allocated_income_minor,
           carry_allocated_minor, ending_capital_minor, ownership_fraction, refusals_json,
           sources_json, status, supersedes_k1_id, generated_by, generated_at, issued_at, superseded_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',NULL,?,?,NULL,NULL)`,
      ).run(
        id, spv.tenantId, spvId, k.investorId, taxYear, k.currency,
        k.beginningCapitalMinor, k.contributionsMinor, k.distributionsMinor, k.allocatedIncomeMinor,
        k.carryAllocatedMinor, k.endingCapitalMinor, k.ownershipFraction,
        JSON.stringify(k.refusals), JSON.stringify(k.sourceIds), actor, now,
      );
    }
  });
  tx();
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  return (db.prepare(`SELECT ${K1_COLS} FROM spv_k1_statement WHERE id IN (${placeholders})
                      ORDER BY investor_id ASC`).all(...ids) as any[]).map(mapStored);
}

/** Mark a draft as issued. An issued K-1 is immutable from here. */
export function issueK1(spvId: string, k1Id: string): StoredK1 | null {
  ensureSchema();
  const now = new Date().toISOString();
  rawDb()
    .prepare(`UPDATE spv_k1_statement SET status = 'issued', issued_at = ?
              WHERE id = ? AND spv_id = ? AND status = 'draft'`)
    .run(now, k1Id, spvId);
  const row = rawDb().prepare(`SELECT ${K1_COLS} FROM spv_k1_statement WHERE id = ? AND spv_id = ?`)
    .get(k1Id, spvId) as any | undefined;
  return row ? mapStored(row) : null;
}

/** Every stored statement for a vehicle and year. GP-only surface. */
export function listK1s(spvId: string, taxYear?: number): StoredK1[] {
  ensureSchema();
  const sql = taxYear
    ? `SELECT ${K1_COLS} FROM spv_k1_statement WHERE spv_id = ? AND tax_year = ?
       ORDER BY tax_year DESC, investor_id ASC, generated_at DESC`
    : `SELECT ${K1_COLS} FROM spv_k1_statement WHERE spv_id = ?
       ORDER BY tax_year DESC, investor_id ASC, generated_at DESC`;
  const rows = taxYear
    ? rawDb().prepare(sql).all(spvId, taxYear)
    : rawDb().prepare(sql).all(spvId);
  return (rows as any[]).map(mapStored);
}

/**
 * ONE LP's stored statements. Scoped by `investor_id` IN THE SQL, not by
 * filtering a fetched list, so there is no intermediate array holding another
 * LP's tax figures that a later edit could accidentally return.
 *
 * DRAFTS ARE EXCLUDED. An LP sees a K-1 when the GP has issued it; showing a
 * draft would put an unfinished tax figure in front of a taxpayer.
 */
export function lpOwnStoredK1s(spvId: string, investorId: string): StoredK1[] {
  ensureSchema();
  return (rawDb()
    .prepare(`SELECT ${K1_COLS} FROM spv_k1_statement
              WHERE spv_id = ? AND investor_id = ? AND status = 'issued'
              ORDER BY tax_year DESC, generated_at DESC`)
    .all(spvId, investorId) as any[]).map(mapStored);
}
