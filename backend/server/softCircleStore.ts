/**
 * server/softCircleStore.ts — v25.34 Collective Mega-Wave (DB-direct migration)
 *
 * ===========================================================================
 * v25.34 CHANGE BLOCK
 * ---------------------------------------------------------------------------
 * Prior state (v15 "Phase B" hybrid): the Map (`memCircles`) was the source of
 * truth for ALL reads; writes wrote-through to DB but SWALLOWED DB failures
 * (catch -> log.warn) and mutated the Map ANYWAY (fail-OPEN). That violated
 * Ozan's standing rule #1 ("Nothing in memory. All DB driven and fully
 * dynamic") because a caller could see a success-shaped result for a write
 * that never persisted, and a restart would silently lose the change.
 *
 * v25.34 delta (mirrors the v25.33 companyProfileStore.updateCompanyProfile
 * surgical fix):
 *   1. READS are now DB-direct via rawDb().prepare(...).get/all(). The Map is
 *      retained only as a best-effort hot cache / fallback when the DB read
 *      itself throws unexpectedly.
 *   2. WRITES are FAIL-CLOSED: BEGIN -> INSERT/UPDATE/DELETE -> COMMIT, then
 *      (and only then) mutate the cache. On DB failure: log.error + throw err.
 *      The cache is NOT mutated on failure.
 *   3. Every public function signature is preserved exactly.
 * ===========================================================================
 *
 * (Original v15 header preserved below.)
 *
 * server/softCircleStore.ts — v15 P0-9, P0-10, P0-11
 *
 * Replaces the in-memory stub at routes.ts:1039-1044. Provides a DB-backed
 * soft-circle store with real-time SSE emission and a Collective-friendly
 * reader that lets `server/collectiveRoutes.ts:503` stop reading from
 * `mockData`.
 *
 *   P0-9   Soft circles persisted to `soft_circles` table.
 *   P0-10  Every state-changing write calls `emitMutation("softCircle.changed")`
 *          on the SSE bus so the Collective dashboard updates live.
 *   P0-11  `listForCollective()` returns a Collective-friendly projection so
 *          the Collective surface no longer reads from mockData.
 *
 * Hard-rule compliance:
 *   - All writes wrapped in `getDb().transaction((tx) => {...})` (no `()`).
 *   - Hydration awaited sequentially from `HYDRATE_ORDER`.
 *   - SSE emit uses canonical `emitMutation` shape; the `softCircle.changed`
 *     change name flows through to subscribers via the `aggregate` field set
 *     to `"softCircle"` plus a `change` of `"create" | "update" | "delete"`.
 */
import { randomBytes } from "crypto";
import { eq, isNull } from "drizzle-orm";
import { getDb, rawDb } from "./db/connection";
import { softCircles as softCirclesTable } from "../shared/schema";
import { emitMutation } from "./lib/eventBus";
import { log } from "./lib/logger";
import { toMinor } from "./lib/currency";

/* ---------- Types ---------- */

// v24.4.2 Bug H — added "wired" terminal state: intent → confirmed → wired → committed
export type SoftCircleStatus = "intent" | "confirmed" | "wired" | "committed" | "declined";

export interface SoftCircleRow {
  id: string;
  tenantId: string | null;
  roundId: string;
  companyId: string | null;
  invitationId: string | null;
  investorUserId: string | null;
  investorEmail: string | null;
  investorName: string;
  amount: number;
  amountMinor: number;
  currency: string;
  status: SoftCircleStatus;
  collectiveVisible: boolean;
  createdAt: string;
  updatedAt: string | null;
}

export interface CreateSoftCircleArgs {
  roundId: string;
  companyId?: string | null;
  invitationId?: string | null;
  investorUserId?: string | null;
  investorEmail?: string | null;
  investorName: string;
  amount: number;
  currency?: string;
  status?: SoftCircleStatus;
  collectiveVisible?: boolean;
  tenantId?: string | null;
}

export interface CollectiveProjection {
  id: string;
  roundId: string;
  companyId: string | null;
  investorName: string;
  amount: number;
  currency: string;
  status: SoftCircleStatus;
  createdAt: string;
}

/* ---------- In-memory mirror ---------- */

const memCircles: SoftCircleRow[] = [];

function tenantForCompany(companyId: string | null | undefined): string {
  if (companyId) return `tenant_co_${companyId}`;
  return "tenant_platform";
}

function makeId(roundId: string): string {
  return `sc_${roundId}_${randomBytes(6).toString("hex")}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Emit canonical `softCircle.changed` event on the SSE bus. */
function emitSoftCircleChanged(row: SoftCircleRow, change: "create" | "update" | "delete"): void {
  emitMutation({
    aggregate: "round",
    id: row.roundId,
    change: "update",
    tenantId: row.tenantId ?? undefined,
  });
  // Custom aggregate name "softCircle" used by SSE consumers that filter on
  // `e.aggregate === "softCircle" && e.change === ...`. The realtime bus does
  // not enforce a whitelist on aggregate names.
  emitMutation({
    aggregate: "softCircle" as any,
    id: row.id,
    change,
    tenantId: row.tenantId ?? undefined,
  });
}

function toAmountMinor(amount: number, currency: string): number {
  // v25.37 (BLOCKER B-Currency): derive the minor-unit exponent from the ISO
  // 4217 currency code instead of hardcoding `* 100`. USD/EUR/etc. stay at
  // 2 decimals (× 100); zero-decimal currencies (JPY/KRW) use × 1; 3-decimal
  // currencies (BHD/JOD/KWD) use × 1000. `toMinor` already guards non-finite
  // input (returns 0), preserving the prior behavior.
  return toMinor(amount, currency);
}

/* ---------- Create / update ---------- */

export function createSoftCircle(args: CreateSoftCircleArgs): SoftCircleRow {
  if (!args.roundId) throw new Error("missing_round_id");
  if (!args.investorName) throw new Error("missing_investor_name");
  if (typeof args.amount !== "number" || !Number.isFinite(args.amount) || args.amount < 0) {
    throw new Error("invalid_amount");
  }
  const currency = (args.currency ?? "USD").toUpperCase();
  const tenantId = args.tenantId ?? tenantForCompany(args.companyId);
  const createdAt = nowIso();
  const row: SoftCircleRow = {
    id: makeId(args.roundId),
    tenantId,
    roundId: args.roundId,
    companyId: args.companyId ?? null,
    invitationId: args.invitationId ?? null,
    investorUserId: args.investorUserId ?? null,
    investorEmail: args.investorEmail ?? null,
    investorName: args.investorName,
    amount: args.amount,
    amountMinor: toAmountMinor(args.amount, currency),
    currency,
    status: args.status ?? "intent",
    collectiveVisible: args.collectiveVisible ?? true,
    createdAt,
    updatedAt: createdAt,
  };

  // v25.34 FAIL-CLOSED: persist first; on failure throw (do NOT touch cache).
  try {
    const db: any = getDb();
    db.transaction((tx: any) => {
      tx.insert(softCirclesTable)
        .values({
          id: row.id,
          roundId: row.roundId,
          invitationId: row.invitationId,
          investorName: row.investorName,
          amount: row.amount,
          status: row.status,
          createdAt: row.createdAt,
          // v15 additive columns.
          tenantId: row.tenantId,
          companyId: row.companyId,
          investorUserId: row.investorUserId,
          investorEmail: row.investorEmail,
          amountMinor: row.amountMinor,
          currency: row.currency,
          collectiveVisible: row.collectiveVisible ? 1 : 0,
          updatedAt: row.updatedAt,
        } as any)
        .run();
    });
  } catch (err) {
    log.error(
      "[softCircleStore.createSoftCircle] DB write failed:",
      (err as Error).message,
    );
    throw err;
  }
  // Refresh the hot cache only AFTER the durable INSERT lands.
  memCircles.push(row);
  emitSoftCircleChanged(row, "create");
  return row;
}

export function updateSoftCircleStatus(
  id: string,
  status: SoftCircleStatus,
): SoftCircleRow | null {
  // v25.34 (BLOCKER 3): DB-first lookup. The cache may be cold (restart /
  // cross-process write), so if the row isn't in memCircles read it straight
  // from the DB and repopulate the cache before proceeding with the update.
  let row = memCircles.find((r) => r.id === id);
  if (!row) {
    try {
      const dbRow = getSoftCircle(id);
      if (dbRow) {
        row = dbRow;
        memCircles.push(dbRow);
      }
    } catch (err) {
      log.warn("[softCircleStore.updateSoftCircleStatus] DB-first lookup failed:", (err as Error).message);
    }
  }
  if (!row) return null;
  const nextUpdatedAt = nowIso();
  // v25.34 FAIL-CLOSED: persist first; only mutate the cached row on success.
  // v25.34 fix-2: also verify the UPDATE actually affected a row — if the
  // DB has no matching row (deleted by another process) we must NOT mutate
  // the stale cache and return success. Use rawDb so we can read `changes()`.
  let affected = 0;
  try {
    const info = rawDb()
      .prepare(
        `UPDATE soft_circles SET status = ?, updated_at = ? WHERE id = ?`,
      )
      .run(status, nextUpdatedAt, row.id);
    affected = info.changes;
  } catch (err) {
    log.error(
      "[softCircleStore.updateSoftCircleStatus] DB write failed:",
      (err as Error).message,
    );
    throw err;
  }
  if (affected === 0) {
    // DB row no longer exists — drop the stale cache entry and signal not-found.
    const idx = memCircles.findIndex((c) => c.id === row.id);
    if (idx >= 0) memCircles.splice(idx, 1);
    return null;
  }
  row.status = status;
  row.updatedAt = nextUpdatedAt;
  emitSoftCircleChanged(row, "update");
  return row;
}

export function validateSoftCircle(id: string): SoftCircleRow | null {
  return updateSoftCircleStatus(id, "confirmed");
}

export function deleteSoftCircle(id: string): boolean {
  // v25.34 (BLOCKER 3): DB-first lookup. If the row isn't in the hot cache,
  // read it from the DB and repopulate the cache so the delete can proceed
  // even after a restart / cross-process write.
  let idx = memCircles.findIndex((r) => r.id === id);
  if (idx < 0) {
    try {
      const dbRow = getSoftCircle(id);
      if (dbRow) {
        memCircles.push(dbRow);
        idx = memCircles.length - 1;
      }
    } catch (err) {
      log.warn("[softCircleStore.deleteSoftCircle] DB-first lookup failed:", (err as Error).message);
    }
  }
  if (idx < 0) return false;
  const row = memCircles[idx];
  // v25.34 FAIL-CLOSED: delete from DB first; only splice cache on success.
  // v25.34 fix-2: also verify the DELETE actually removed a row. If the DB
  // row was already gone (another process / restart), drop the stale cache
  // entry but still return false so the caller knows nothing was deleted.
  let affected = 0;
  try {
    const info = rawDb()
      .prepare(`DELETE FROM soft_circles WHERE id = ?`)
      .run(row.id);
    affected = info.changes;
  } catch (err) {
    log.error(
      "[softCircleStore.deleteSoftCircle] DB write failed:",
      (err as Error).message,
    );
    throw err;
  }
  memCircles.splice(idx, 1);
  if (affected === 0) return false;
  emitSoftCircleChanged(row, "delete");
  return true;
}

/* ---------- Reads (v25.34: DB-direct via rawDb prepared statements) ---------- */

/** Map a raw soft_circles SQLite row (snake_case) to a SoftCircleRow. */
function mapRow(r: any): SoftCircleRow {
  return {
    id: r.id,
    tenantId: r.tenant_id ?? null,
    roundId: r.round_id,
    companyId: r.company_id ?? null,
    invitationId: r.invitation_id ?? null,
    investorUserId: r.investor_user_id ?? null,
    investorEmail: r.investor_email ?? null,
    investorName: r.investor_name,
    amount: Number(r.amount ?? 0),
    amountMinor: Number(r.amount_minor ?? 0),
    currency: r.currency ?? "USD",
    status: (r.status ?? "intent") as SoftCircleStatus,
    collectiveVisible: !!(r.collective_visible ?? 1),
    createdAt: r.created_at,
    updatedAt: r.updated_at ?? null,
  };
}

export function listForRound(roundId: string): SoftCircleRow[] {
  try {
    const rows = rawDb()
      .prepare(
        "SELECT * FROM soft_circles WHERE round_id = ? AND deleted_at IS NULL ORDER BY created_at ASC",
      )
      .all(roundId) as any[];
    return rows.map(mapRow);
  } catch (err) {
    log.warn("[softCircleStore.listForRound] DB read failed, using cache:", (err as Error).message);
    return memCircles.filter((r) => r.roundId === roundId);
  }
}

export function listForCompany(companyId: string): SoftCircleRow[] {
  try {
    const rows = rawDb()
      .prepare(
        "SELECT * FROM soft_circles WHERE company_id = ? AND deleted_at IS NULL ORDER BY created_at ASC",
      )
      .all(companyId) as any[];
    return rows.map(mapRow);
  } catch (err) {
    log.warn("[softCircleStore.listForCompany] DB read failed, using cache:", (err as Error).message);
    return memCircles.filter((r) => r.companyId === companyId);
  }
}

export function listForInvestor(investorUserId: string): SoftCircleRow[] {
  try {
    const rows = rawDb()
      .prepare(
        "SELECT * FROM soft_circles WHERE investor_user_id = ? AND deleted_at IS NULL ORDER BY created_at ASC",
      )
      .all(investorUserId) as any[];
    return rows.map(mapRow);
  } catch (err) {
    log.warn("[softCircleStore.listForInvestor] DB read failed, using cache:", (err as Error).message);
    return memCircles.filter((r) => r.investorUserId === investorUserId);
  }
}

/**
 * Collective-facing projection — `server/collectiveRoutes.ts:503` must call
 * this instead of reading from `mockData`. Returns only rows the founder
 * has marked `collectiveVisible: true`.
 */
export function listForCollective(filter?: { roundId?: string; companyId?: string }): CollectiveProjection[] {
  let rows: SoftCircleRow[];
  try {
    const sql: string[] = ["SELECT * FROM soft_circles WHERE collective_visible = 1 AND deleted_at IS NULL"];
    const params: any[] = [];
    if (filter?.roundId) { sql.push("AND round_id = ?"); params.push(filter.roundId); }
    if (filter?.companyId) { sql.push("AND company_id = ?"); params.push(filter.companyId); }
    sql.push("ORDER BY created_at ASC");
    rows = (rawDb().prepare(sql.join(" ")).all(...params) as any[]).map(mapRow);
  } catch (err) {
    log.warn("[softCircleStore.listForCollective] DB read failed, using cache:", (err as Error).message);
    rows = memCircles.filter((r) => r.collectiveVisible);
    if (filter?.roundId) rows = rows.filter((r) => r.roundId === filter.roundId);
    if (filter?.companyId) rows = rows.filter((r) => r.companyId === filter.companyId);
  }
  return rows.map((r) => ({
    id: r.id,
    roundId: r.roundId,
    companyId: r.companyId,
    investorName: r.investorName,
    amount: r.amount,
    currency: r.currency,
    status: r.status,
    createdAt: r.createdAt,
  }));
}

export function getSoftCircle(id: string): SoftCircleRow | null {
  try {
    const r = rawDb()
      .prepare("SELECT * FROM soft_circles WHERE id = ? AND deleted_at IS NULL")
      .get(id) as any;
    return r ? mapRow(r) : null;
  } catch (err) {
    log.warn("[softCircleStore.getSoftCircle] DB read failed, using cache:", (err as Error).message);
    return memCircles.find((r) => r.id === id) ?? null;
  }
}

/* ---------- Hydration ---------- */

export async function hydrateSoftCircleStore(): Promise<void> {
  memCircles.length = 0;
  try {
    const db: any = getDb();
    const rows = db
      .select()
      .from(softCirclesTable)
      .where(isNull((softCirclesTable as any).deletedAt ?? (softCirclesTable as any).deleted_at ?? null))
      .all() as any[];
    for (const r of rows) {
      memCircles.push({
        id: r.id,
        tenantId: r.tenant_id ?? r.tenantId ?? null,
        roundId: r.round_id ?? r.roundId,
        companyId: r.company_id ?? r.companyId ?? null,
        invitationId: r.invitation_id ?? r.invitationId ?? null,
        investorUserId: r.investor_user_id ?? r.investorUserId ?? null,
        investorEmail: r.investor_email ?? r.investorEmail ?? null,
        investorName: r.investor_name ?? r.investorName,
        amount: Number(r.amount ?? 0),
        amountMinor: Number(r.amount_minor ?? r.amountMinor ?? 0),
        currency: r.currency ?? "USD",
        status: (r.status ?? "intent") as SoftCircleStatus,
        collectiveVisible: !!(r.collective_visible ?? r.collectiveVisible ?? 1),
        createdAt: r.created_at ?? r.createdAt,
        updatedAt: r.updated_at ?? r.updatedAt ?? null,
      });
    }
    if (rows.length > 0) {
      log.info(`[hydrate] softCircleStore: ${rows.length} circles restored`);
    }
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!/no such table/i.test(msg)) {
      log.warn("[hydrate] softCircleStore: DB read failed:", msg);
    }
  }
}

/* ---------- Test helpers ---------- */

export const _testAccessSoftCircles = {
  rows: memCircles,
  reset(): void {
    memCircles.length = 0;
  },
};
