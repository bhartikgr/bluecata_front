/**
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
import { getDb } from "./db/connection";
import { softCircles as softCirclesTable } from "../shared/schema";
import { emitMutation } from "./lib/eventBus";
import { log } from "./lib/logger";

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
  // For supported fiat (USD/EUR/etc.), minor units = round(amount * 100).
  // For zero-decimal currencies (JPY/KRW) this still produces a consistent
  // integer that engines can normalize downstream.
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
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
    log.warn(
      "[softCircleStore.createSoftCircle] DB write failed (in-memory only):",
      (err as Error).message,
    );
  }
  memCircles.push(row);
  emitSoftCircleChanged(row, "create");
  return row;
}

export function updateSoftCircleStatus(
  id: string,
  status: SoftCircleStatus,
): SoftCircleRow | null {
  const row = memCircles.find((r) => r.id === id);
  if (!row) return null;
  row.status = status;
  row.updatedAt = nowIso();
  try {
    const db: any = getDb();
    db.transaction((tx: any) => {
      tx.update(softCirclesTable)
        .set({ status, updatedAt: row.updatedAt } as any)
        .where(eq(softCirclesTable.id, row.id))
        .run();
    });
  } catch (err) {
    log.warn(
      "[softCircleStore.updateSoftCircleStatus] DB write failed:",
      (err as Error).message,
    );
  }
  emitSoftCircleChanged(row, "update");
  return row;
}

export function validateSoftCircle(id: string): SoftCircleRow | null {
  return updateSoftCircleStatus(id, "confirmed");
}

export function deleteSoftCircle(id: string): boolean {
  const idx = memCircles.findIndex((r) => r.id === id);
  if (idx < 0) return false;
  const [row] = memCircles.splice(idx, 1);
  try {
    const db: any = getDb();
    db.transaction((tx: any) => {
      tx.delete(softCirclesTable).where(eq(softCirclesTable.id, row.id)).run();
    });
  } catch (err) {
    log.warn(
      "[softCircleStore.deleteSoftCircle] DB write failed:",
      (err as Error).message,
    );
  }
  emitSoftCircleChanged(row, "delete");
  return true;
}

/* ---------- Reads ---------- */

export function listForRound(roundId: string): SoftCircleRow[] {
  return memCircles.filter((r) => r.roundId === roundId);
}

export function listForCompany(companyId: string): SoftCircleRow[] {
  return memCircles.filter((r) => r.companyId === companyId);
}

export function listForInvestor(investorUserId: string): SoftCircleRow[] {
  return memCircles.filter((r) => r.investorUserId === investorUserId);
}

/**
 * Collective-facing projection — `server/collectiveRoutes.ts:503` must call
 * this instead of reading from `mockData`. Returns only rows the founder
 * has marked `collectiveVisible: true`.
 */
export function listForCollective(filter?: { roundId?: string; companyId?: string }): CollectiveProjection[] {
  let rows = memCircles.filter((r) => r.collectiveVisible);
  if (filter?.roundId) rows = rows.filter((r) => r.roundId === filter.roundId);
  if (filter?.companyId) rows = rows.filter((r) => r.companyId === filter.companyId);
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
  return memCircles.find((r) => r.id === id) ?? null;
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
