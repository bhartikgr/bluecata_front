/* ═══════════════════════════════════════════════════════════════════════════
   WAVE 154 · BATCH 2 · ITEM K — THE LAUNCH-GATE OVERRIDE LEDGER (R114.3).
   ═══════════════════════════════════════════════════════════════════════════
   THIS IS A HARD RELEASE CONDITION. The owner's ruling is that the eligibility
   gate does not ship without a way for a human to let a specific SPV, or a
   specific company, through it — because the alternative is a support queue with
   no lever, and the first false refusal becomes an outage.

   IT IS A LEDGER, NOT A FLAG.
     · `reason` is NOT NULL at the database level. An override with no stated
       reason is not a decision; it is an accident waiting to be blamed on the
       platform.
     · Withdrawing an override STAMPS `revoked_at`/`revoked_by`. Rows are never
       deleted and never rewritten, so "who let this through, and why" stays
       answerable after the fact.
     · The actor is bound by the caller's authenticated admin identity — never
       taken from a request body.

   "Is this override live right now" is `revoked_at IS NULL`, evaluated at read
   time. There is no stored `active` column: a derived boolean sitting next to its
   own inputs is precisely the class of bug this wave exists to remove.

   Table: `spv_launch_gate_override` (migrations/0203_wave154_k_spv_launch_gate_override.sql).
   ═══════════════════════════════════════════════════════════════════════════ */
import { randomUUID } from "node:crypto";
import { rawDb } from "../db/connection";

export type OverrideScopeKind = "spv" | "company";

export interface LaunchGateOverride {
  id: string;
  scopeKind: OverrideScopeKind;
  scopeId: string;
  reason: string;
  createdAt: string;
  createdBy: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
}

export class OverrideWriteError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "OverrideWriteError";
  }
}

function rowToOverride(r: any): LaunchGateOverride {
  return {
    id: r.id,
    scopeKind: r.scope_kind,
    scopeId: r.scope_id,
    reason: r.reason,
    createdAt: r.created_at,
    createdBy: r.created_by ?? null,
    revokedAt: r.revoked_at ?? null,
    revokedBy: r.revoked_by ?? null,
  };
}

/** The table is created by migration 0203. A DB that has not run it yet must not
 *  crash a read path — an absent table means NO overrides exist, which is the
 *  fail-closed answer for a gate. */
function tableExists(): boolean {
  try {
    return !!rawDb()
      .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='spv_launch_gate_override'`)
      .get();
  } catch {
    return false;
  }
}

/**
 * Record an override. `reason` is required in the application layer too, with a
 * plain-sentence refusal (R77), so an admin sees why the write was rejected
 * instead of a CHECK-constraint stack trace.
 */
export function createOverride(input: {
  scopeKind: OverrideScopeKind;
  scopeId: string;
  reason: string;
  createdBy: string;
}): LaunchGateOverride {
  if (input.scopeKind !== "spv" && input.scopeKind !== "company") {
    throw new OverrideWriteError(
      "OVERRIDE_SCOPE_INVALID",
      "An override must apply to either one SPV or one company. Choose a scope and try again.",
    );
  }
  const scopeId = String(input.scopeId ?? "").trim();
  if (!scopeId) {
    throw new OverrideWriteError(
      "OVERRIDE_SCOPE_ID_REQUIRED",
      "Name the SPV or company this override applies to.",
    );
  }
  const reason = String(input.reason ?? "").trim();
  if (!reason) {
    throw new OverrideWriteError(
      "OVERRIDE_REASON_REQUIRED",
      "Write the reason for this override — it is kept on the record permanently.",
    );
  }
  const row: LaunchGateOverride = {
    id: `slgo_${randomUUID()}`,
    scopeKind: input.scopeKind,
    scopeId,
    reason,
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy || null,
    revokedAt: null,
    revokedBy: null,
  };
  rawDb()
    .prepare(
      `INSERT INTO spv_launch_gate_override
         (id, scope_kind, scope_id, reason, created_at, created_by, revoked_at, revoked_by)
       VALUES (?,?,?,?,?,?,NULL,NULL)`,
    )
    .run(row.id, row.scopeKind, row.scopeId, row.reason, row.createdAt, row.createdBy);
  return row;
}

/** Withdraw an override. NEVER a DELETE. */
export function revokeOverride(id: string, revokedBy: string): LaunchGateOverride {
  const existing = getOverride(id);
  if (!existing) {
    throw new OverrideWriteError(
      "OVERRIDE_NOT_FOUND",
      "That override is no longer on file. Refresh the list and try again.",
    );
  }
  if (existing.revokedAt) return existing; // idempotent
  const revokedAt = new Date().toISOString();
  rawDb()
    .prepare(
      `UPDATE spv_launch_gate_override
          SET revoked_at = ?, revoked_by = ?
        WHERE id = ? AND revoked_at IS NULL`,
    )
    .run(revokedAt, revokedBy || null, id);
  return { ...existing, revokedAt, revokedBy: revokedBy || null };
}

export function getOverride(id: string): LaunchGateOverride | null {
  if (!tableExists()) return null;
  const r = rawDb()
    .prepare(`SELECT * FROM spv_launch_gate_override WHERE id = ?`)
    .get(id);
  return r ? rowToOverride(r) : null;
}

/** Live overrides only. */
export function listActiveOverrides(): LaunchGateOverride[] {
  if (!tableExists()) return [];
  return (
    rawDb()
      .prepare(
        `SELECT * FROM spv_launch_gate_override WHERE revoked_at IS NULL ORDER BY created_at DESC`,
      )
      .all() as any[]
  ).map(rowToOverride);
}

/** EVERYTHING, revoked included — this is the audit view. */
export function listAllOverrides(): LaunchGateOverride[] {
  if (!tableExists()) return [];
  return (
    rawDb()
      .prepare(`SELECT * FROM spv_launch_gate_override ORDER BY created_at DESC`)
      .all() as any[]
  ).map(rowToOverride);
}
