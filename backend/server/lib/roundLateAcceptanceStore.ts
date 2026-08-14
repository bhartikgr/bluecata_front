// server/lib/roundLateAcceptanceStore.ts
//
// WAVE 43 · R7 — the append-only ledger of DELIBERATE founder decisions to let
// money in after a round's decision window closed.
//
//   Owner, 2026-08-13: "Go with your recommendation to enforce the close.
//                       Accepting late commitments should be allowed."
//
// This store is the ONLY door through the server-side refusal in
// `roundCloseEnforcement.ts`. Everything it exposes is built around one
// sentence from the brief:
//
//   THE MONEY IS ALLOWED IN, BUT THE RECORD MUST NEVER LOOK LIKE IT ARRIVED
//   ON TIME.
//
// DESIGN COMMITMENTS
//   · DELIBERATE.  A grant is created only by an explicit founder POST carrying
//     `confirm: true`. There is no create-on-read, no default-on, and no
//     "grant if absent" convenience path anywhere in this file.
//   · ATTRIBUTED.  `acceptedByUserId` comes from the authenticated session at
//     the call site and is required. The store refuses to write without it
//     rather than recording an anonymous override.
//   · AUDITED.  `closedAt` preserves the deadline that was overridden, so the
//     row states not merely "accepted" but "accepted AFTER this instant".
//   · APPEND-ONLY.  No deletes. `revokedAt` is forward-only. `consumedAt` /
//     `softCircleId` are the single permitted post-insert write, only from null.
//   · FAIL-CLOSED.  A write that cannot reach the database throws. It never
//     lands in a cache that would let a subsequent request believe an
//     acceptance was recorded when nothing was persisted (the v25.34 posture).
//   · NO MONEY.  This row carries no amount. The commitment it points at is the
//     only place the amount lives, so the two can never disagree.
//
// SACRED FILES UNTOUCHED: `captableCommitStore.ts` and `soft_circles`' own shape
// are not modified. The "accepted after close" marker is DERIVED from these
// rows plus the round's close window at projection time.
import { getDb, rawDb, getDbDriver } from "../db/connection";
import { log } from "./logger";
import { applyWave43RoundCloseSchemaOnce, WAVE43_LATE_ACCEPTANCE_TABLE } from "./applyWave43RoundCloseSchema";

/** Postgres deployments do not carry this table yet; the caller must say so honestly. */
export const LATE_ACCEPTANCE_UNAVAILABLE = "LATE_ACCEPTANCE_UNAVAILABLE";
/** The heal could not install the table. Refuse; never pretend it worked. */
export const LATE_ACCEPTANCE_SCHEMA_MISSING = "LATE_ACCEPTANCE_SCHEMA_MISSING";
/** Attribution is mandatory — an unattributed override is not an audit record. */
export const LATE_ACCEPTANCE_NO_ACTOR = "LATE_ACCEPTANCE_NO_ACTOR";
/** A `late_commitment` grant may admit exactly one commitment. */
export const LATE_ACCEPTANCE_ALREADY_CONSUMED = "LATE_ACCEPTANCE_ALREADY_CONSUMED";

export type LateAcceptanceKind = "reopen" | "late_commitment";

export interface LateAcceptanceRow {
  id: string;
  tenantId: string | null;
  roundId: string;
  companyId: string | null;
  kind: LateAcceptanceKind;
  invitationId: string | null;
  softCircleId: string | null;
  /** The deadline that had already passed when this grant was made. */
  closedAt: string;
  acceptedByUserId: string;
  acceptedByName: string | null;
  acceptedAt: string;
  reason: string | null;
  reopenUntil: string | null;
  consumedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

function db(): any {
  if (getDbDriver() === "postgres") throw new Error(LATE_ACCEPTANCE_UNAVAILABLE);
  getDb();
  const handle = rawDb() as any;
  const heal = applyWave43RoundCloseSchemaOnce(handle);
  if (!heal.tableReady) {
    throw new Error(
      `${LATE_ACCEPTANCE_SCHEMA_MISSING}:${heal.failures.join("|") || "table_absent"}`,
    );
  }
  return handle;
}

const nowIso = (): string => new Date().toISOString();
const newId = (): string =>
  `rla_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

function rowToRecord(r: any): LateAcceptanceRow {
  return {
    id: String(r.id),
    tenantId: r.tenant_id ?? null,
    roundId: String(r.round_id),
    companyId: r.company_id ?? null,
    kind: r.kind as LateAcceptanceKind,
    invitationId: r.invitation_id ?? null,
    softCircleId: r.soft_circle_id ?? null,
    closedAt: String(r.closed_at),
    acceptedByUserId: String(r.accepted_by_user_id),
    acceptedByName: r.accepted_by_name ?? null,
    acceptedAt: String(r.accepted_at),
    reason: r.reason ?? null,
    reopenUntil: r.reopen_until ?? null,
    consumedAt: r.consumed_at ?? null,
    revokedAt: r.revoked_at ?? null,
    createdAt: String(r.created_at),
  };
}

const SELECT_COLS = `
  id, tenant_id, round_id, company_id, kind, invitation_id, soft_circle_id,
  closed_at, accepted_by_user_id, accepted_by_name, accepted_at, reason,
  reopen_until, consumed_at, revoked_at, created_at
`;

/* ═════════════════════════════════════════════════════════════════════════
 * WRITES — both DELIBERATE, both ATTRIBUTED, both AUDITED
 * ═════════════════════════════════════════════════════════════════════════ */

export interface GrantArgs {
  roundId: string;
  companyId?: string | null;
  tenantId?: string | null;
  /** From the session. Never from the request body. */
  acceptedByUserId: string;
  acceptedByName?: string | null;
  /** The deadline being overridden, resolved by `shared/roundClose.ts`. */
  closedAt: string;
  reason?: string | null;
}

/**
 * REOPEN the round until `reopenUntil`.
 *
 * Commitments made inside the reopened window are STILL after the original
 * close and are STILL marked late — `closedAt` on this row is the original
 * deadline, so the marker survives the reopen window's own expiry.
 */
export function grantReopen(args: GrantArgs & { reopenUntil: string }): LateAcceptanceRow {
  if (!args.roundId) throw new Error("missing_round_id");
  if (!args.acceptedByUserId) throw new Error(LATE_ACCEPTANCE_NO_ACTOR);
  if (!args.closedAt) throw new Error("missing_closed_at");
  if (!args.reopenUntil) throw new Error("missing_reopen_until");
  const at = nowIso();
  const row: LateAcceptanceRow = {
    id: newId(),
    tenantId: args.tenantId ?? null,
    roundId: args.roundId,
    companyId: args.companyId ?? null,
    kind: "reopen",
    invitationId: null,
    softCircleId: null,
    closedAt: args.closedAt,
    acceptedByUserId: args.acceptedByUserId,
    acceptedByName: args.acceptedByName ?? null,
    acceptedAt: at,
    reason: args.reason ?? null,
    reopenUntil: args.reopenUntil,
    consumedAt: null,
    revokedAt: null,
    createdAt: at,
  };
  insert(row);
  return row;
}

/**
 * Accept ONE named investor's late commitment WITHOUT reopening the round.
 *
 * Single-use. `consumeGrant` stamps it when the commitment lands.
 */
export function grantLateCommitment(
  args: GrantArgs & { invitationId: string },
): LateAcceptanceRow {
  if (!args.roundId) throw new Error("missing_round_id");
  if (!args.invitationId) throw new Error("missing_invitation_id");
  if (!args.acceptedByUserId) throw new Error(LATE_ACCEPTANCE_NO_ACTOR);
  if (!args.closedAt) throw new Error("missing_closed_at");
  const at = nowIso();
  const row: LateAcceptanceRow = {
    id: newId(),
    tenantId: args.tenantId ?? null,
    roundId: args.roundId,
    companyId: args.companyId ?? null,
    kind: "late_commitment",
    invitationId: args.invitationId,
    softCircleId: null,
    closedAt: args.closedAt,
    acceptedByUserId: args.acceptedByUserId,
    acceptedByName: args.acceptedByName ?? null,
    acceptedAt: at,
    reason: args.reason ?? null,
    reopenUntil: null,
    consumedAt: null,
    revokedAt: null,
    createdAt: at,
  };
  insert(row);
  return row;
}

/** FAIL-CLOSED insert: throws on failure, caches nothing. */
function insert(row: LateAcceptanceRow): void {
  try {
    const handle = db();
    handle
      .prepare(
        `INSERT INTO ${WAVE43_LATE_ACCEPTANCE_TABLE}
           (id, tenant_id, round_id, company_id, kind, invitation_id, soft_circle_id,
            closed_at, accepted_by_user_id, accepted_by_name, accepted_at, reason,
            reopen_until, consumed_at, revoked_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.tenantId,
        row.roundId,
        row.companyId,
        row.kind,
        row.invitationId,
        row.softCircleId,
        row.closedAt,
        row.acceptedByUserId,
        row.acceptedByName,
        row.acceptedAt,
        row.reason,
        row.reopenUntil,
        row.consumedAt,
        row.revokedAt,
        row.createdAt,
      );
  } catch (err) {
    log.error("[roundLateAcceptanceStore.insert] DB write failed:", (err as Error).message);
    throw err;
  }
}

/**
 * Attach a `late_commitment` grant to the commitment it admitted.
 *
 * Guarded by `consumed_at IS NULL` in the UPDATE itself, so two concurrent
 * commitments cannot both consume one grant — the second sees 0 rows changed
 * and throws. That is the check SQLite performs, not one this file performs
 * before the write and hopes still holds.
 */
export function consumeGrant(grantId: string, softCircleId: string): LateAcceptanceRow {
  if (!grantId) throw new Error("missing_grant_id");
  if (!softCircleId) throw new Error("missing_soft_circle_id");
  const handle = db();
  const at = nowIso();
  const info = handle
    .prepare(
      `UPDATE ${WAVE43_LATE_ACCEPTANCE_TABLE}
          SET consumed_at = ?, soft_circle_id = ?
        WHERE id = ? AND kind = 'late_commitment'
          AND consumed_at IS NULL AND soft_circle_id IS NULL AND revoked_at IS NULL`,
    )
    .run(at, softCircleId, grantId);
  if (!info || Number(info.changes ?? 0) === 0) {
    throw new Error(LATE_ACCEPTANCE_ALREADY_CONSUMED);
  }
  const row = getById(grantId);
  if (!row) throw new Error(LATE_ACCEPTANCE_ALREADY_CONSUMED);
  return row;
}

/** Forward-only withdrawal. The history stays readable. */
export function revokeGrant(grantId: string): LateAcceptanceRow | null {
  const handle = db();
  handle
    .prepare(
      `UPDATE ${WAVE43_LATE_ACCEPTANCE_TABLE} SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
    )
    .run(nowIso(), grantId);
  return getById(grantId);
}

/* ═════════════════════════════════════════════════════════════════════════
 * READS
 * ═════════════════════════════════════════════════════════════════════════ */

export function getById(id: string): LateAcceptanceRow | null {
  try {
    const r = db()
      .prepare(`SELECT ${SELECT_COLS} FROM ${WAVE43_LATE_ACCEPTANCE_TABLE} WHERE id = ?`)
      .get(id);
    return r ? rowToRecord(r) : null;
  } catch (err) {
    log.warn("[roundLateAcceptanceStore.getById] read failed:", (err as Error).message);
    return null;
  }
}

export function listForRound(roundId: string): LateAcceptanceRow[] {
  try {
    const rows = db()
      .prepare(
        `SELECT ${SELECT_COLS} FROM ${WAVE43_LATE_ACCEPTANCE_TABLE}
          WHERE round_id = ? ORDER BY created_at ASC, id ASC`,
      )
      .all(roundId) as any[];
    return rows.map(rowToRecord);
  } catch (err) {
    log.warn("[roundLateAcceptanceStore.listForRound] read failed:", (err as Error).message);
    return [];
  }
}

/** Grants attached to specific commitments, keyed by `softCircleId`. */
export function listForSoftCircleIds(ids: string[]): Map<string, LateAcceptanceRow> {
  const out = new Map<string, LateAcceptanceRow>();
  const wanted = Array.from(new Set(ids.filter(Boolean)));
  if (wanted.length === 0) return out;
  try {
    const placeholders = wanted.map(() => "?").join(", ");
    const rows = db()
      .prepare(
        `SELECT ${SELECT_COLS} FROM ${WAVE43_LATE_ACCEPTANCE_TABLE}
          WHERE soft_circle_id IN (${placeholders})`,
      )
      .all(...wanted) as any[];
    for (const raw of rows) {
      const rec = rowToRecord(raw);
      if (rec.softCircleId) out.set(rec.softCircleId, rec);
    }
  } catch (err) {
    log.warn(
      "[roundLateAcceptanceStore.listForSoftCircleIds] read failed:",
      (err as Error).message,
    );
  }
  return out;
}

/**
 * The live reopen grant for a round, if any — not revoked and `reopenUntil`
 * still in the future at `nowMs`.
 */
export function findLiveReopen(roundId: string, nowMs: number): LateAcceptanceRow | null {
  for (const r of listForRound(roundId)) {
    if (r.kind !== "reopen") continue;
    if (r.revokedAt) continue;
    const until = r.reopenUntil ? Date.parse(r.reopenUntil) : NaN;
    if (!Number.isFinite(until)) continue;
    if (nowMs < until) return r;
  }
  return null;
}

/** An unconsumed, unrevoked `late_commitment` grant for this invitation. */
export function findOpenLateGrant(
  roundId: string,
  invitationId: string,
): LateAcceptanceRow | null {
  if (!invitationId) return null;
  for (const r of listForRound(roundId)) {
    if (r.kind !== "late_commitment") continue;
    if (r.invitationId !== invitationId) continue;
    if (r.revokedAt || r.consumedAt || r.softCircleId) continue;
    return r;
  }
  return null;
}

/** Test-only: the raw row count, for a store-level assertion that a write landed. */
export function _countAll(): number {
  try {
    const r = db()
      .prepare(`SELECT COUNT(*) AS n FROM ${WAVE43_LATE_ACCEPTANCE_TABLE}`)
      .get() as { n?: number } | undefined;
    return Number(r?.n ?? 0);
  } catch {
    return 0;
  }
}
