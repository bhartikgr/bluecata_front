/**
 * v25.47 APD-021 — Consortium SPV deployment ledger (DB-backed, no in-memory
 * state).
 *
 * Records each Consortium SPV deployment with the fee that applied at the time,
 * DB-resolved from the flat `consortium.spv_deployment_fee` platform_fees row
 * (owned by consortiumFeesStore.ts — never hardcoded here). Recording is
 * IDEMPOTENT on spv_id: a repeat deployment of the same SPV returns the existing
 * row unchanged (no double-charge, no duplicate ledger entry).
 *
 * Storage (additive only — migration 0074 + connection.ts bootstrap):
 *   spv_deployments(
 *     id TEXT PK, spv_id TEXT UNIQUE, fee_minor INTEGER, currency TEXT,
 *     recorded_at TEXT, recorded_by_user_id TEXT, note TEXT
 *   )
 *
 * SEPARATE/PARALLEL to the Capavate founder/investor flow (Rule 76): touches
 * only spv_deployments + reads platform_fees via consortiumFeesStore.
 */
import { randomUUID } from "node:crypto";
import { rawDb } from "./db/connection";
import { getSpvDeploymentFee } from "./consortiumFeesStore";

export interface SpvDeployment {
  id: string;
  spvId: string;
  feeMinor: number;
  currency: string;
  recordedAt: string;
  recordedByUserId: string | null;
  note: string | null;
}

function rowToDeployment(r: any): SpvDeployment {
  return {
    id: r.id,
    spvId: r.spv_id,
    feeMinor: r.fee_minor ?? 0,
    currency: r.currency || "USD",
    recordedAt: r.recorded_at,
    recordedByUserId: r.recorded_by_user_id ?? null,
    note: r.note ?? null,
  };
}

/** SPV id: lowercase/uppercase alnum, dash, underscore; 1..128 chars. */
export function isValidSpvId(spvId: unknown): spvId is string {
  return typeof spvId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(spvId);
}

/** List all recorded deployments, newest first. */
export function listSpvDeployments(): SpvDeployment[] {
  try {
    const rows: any[] = rawDb()
      .prepare(`SELECT * FROM spv_deployments ORDER BY recorded_at DESC, id DESC`)
      .all();
    return rows.map(rowToDeployment);
  } catch {
    return [];
  }
}

/** Read one deployment by spv_id. Null if absent. */
export function getSpvDeployment(spvId: string): SpvDeployment | null {
  if (!isValidSpvId(spvId)) return null;
  try {
    const row: any = rawDb()
      .prepare(`SELECT * FROM spv_deployments WHERE spv_id = ?`)
      .get(spvId);
    return row ? rowToDeployment(row) : null;
  } catch {
    return null;
  }
}

export interface RecordSpvDeploymentResult {
  deployment: SpvDeployment;
  /** True when this call created the row; false when it already existed. */
  created: boolean;
}

/**
 * Record an SPV deployment. Idempotent on spv_id — if a row already exists it is
 * returned unchanged (created:false). The fee is DB-resolved from the flat
 * consortium SPV deployment fee at record time and frozen onto the row.
 */
export function recordSpvDeployment(args: {
  spvId: string;
  recordedByUserId: string | null;
  note?: string | null;
}): RecordSpvDeploymentResult {
  if (!isValidSpvId(args.spvId)) throw new Error("invalid_spv_id");
  const existing = getSpvDeployment(args.spvId);
  if (existing) return { deployment: existing, created: false };

  const fee = getSpvDeploymentFee();
  const id = `spvd_${randomUUID()}`;
  const recordedAt = new Date().toISOString();
  const note = typeof args.note === "string" && args.note.trim() ? args.note.trim() : null;
  try {
    rawDb()
      .prepare(
        `INSERT INTO spv_deployments
           (id, spv_id, fee_minor, currency, recorded_at, recorded_by_user_id, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, args.spvId, fee.amountMinor, fee.currency, recordedAt, args.recordedByUserId, note);
  } catch (err: any) {
    // Lost the race to a concurrent insert on the UNIQUE spv_id — return the
    // winner's row (still idempotent).
    if (/UNIQUE constraint failed/i.test(err?.message ?? String(err))) {
      const row = getSpvDeployment(args.spvId);
      if (row) return { deployment: row, created: false };
    }
    throw err;
  }
  const created = getSpvDeployment(args.spvId);
  if (!created) throw new Error("record_failed");
  return { deployment: created, created: true };
}
