/**
 * server/roundsStore.ts — v13 (Avi's Issue 3)
 *
 * Avi reported: "In the Round module, I created two entries, but they are
 * not saved in the record table". The round writes lived inline in
 * server/routes.ts and pushed to an in-memory `rounds: Round[]` array. On
 * server restart the entries vanished.
 *
 * v13 fix (hybrid pattern, same as v12 Day 2/3 stores):
 *   - The `rounds` SQL table is authoritative.
 *   - A Map<id, Round> + array view stays in-memory as a READ CACHE.
 *   - Every create/update wraps in `getDb().transaction(async (tx) => {...})`.
 *     No trailing `()` — Drizzle invokes the callback for us.
 *   - On boot, `hydrateRoundsStore()` rebuilds the cache from
 *     `SELECT * FROM rounds WHERE deleted_at IS NULL`.
 *   - Each successful create emits `round.created` via appendAdminAudit so
 *     the v11 audit-timeline marker stays alive.
 *
 * The legacy `mockData.rounds` array (DEMO_SEED_ENABLED gated) remains for
 * legacy importers, but newly created rounds also live there as a back-fill
 * so the existing read paths (rounds.find / rounds.filter) keep working
 * without changing 30+ callsites in routes.ts.
 *
 * CRITICAL: this store does NOT touch cap-table-engine. Round commits still
 * flow through captableCommitStore (frozen in v12 Day 2 Wave 2). roundsStore
 * is purely the round-shell persistence layer.
 */
import { randomBytes } from "node:crypto";
import { and, eq, isNull, desc } from "drizzle-orm";
import { getDb } from "./db/connection";
import { rounds as roundsTable } from "../shared/schema";
import { appendAdminAudit } from "./adminPlatformStore";
import { log } from "./lib/logger";

// Tenant id for a company. Same canonical pattern as
// adminPlatformStore.tenantForCompany / founderCrmStore.tenantForCompany.
function tenantForCompany(companyId: string): string {
  return `tenant_co_${companyId}`;
}

/** Round shape the API serves. Mirrors mockData seed shape exactly so the
 * inline route handlers in routes.ts can continue using `rounds.find(...)`
 * without caring whether the entry came from the DB or the legacy array. */
export type Round = {
  id: string;
  companyId: string;
  name: string;
  type: string;
  state: string;
  targetAmount: number;
  raisedAmount: number;
  preMoney: number | null;
  postMoney: number | null;
  pricePerShare: number | null;
  minTicket: number | null;
  closeDate: string | null;
  termsSummary: string | null;
  leadInvestor?: string | null;
  currency?: string | null;
  region?: string | null;
  openDate?: string | null;
  instrument?: string | null;
  createdAt?: string;
  // long-tail form fields preserved verbatim (useOfProceeds, tranches, etc.).
  [extra: string]: unknown;
};

/** Map<id, Round>. Read cache only — DB is authoritative. */
const ROUNDS_BY_ID = new Map<string, Round>();

/** Array view that legacy callers in routes.ts already use. */
const roundsCache: Round[] = [];

function cacheUpsert(r: Round): void {
  const existing = ROUNDS_BY_ID.get(r.id);
  ROUNDS_BY_ID.set(r.id, r);
  if (existing) {
    const idx = roundsCache.findIndex((x) => x.id === r.id);
    if (idx !== -1) roundsCache[idx] = r;
    else roundsCache.push(r);
  } else {
    roundsCache.push(r);
  }
}

function rowToRound(row: any): Round {
  let extras: Record<string, unknown> = {};
  if (row.extras_json || row.extrasJson) {
    try { extras = JSON.parse((row.extras_json ?? row.extrasJson) as string); } catch { /* tolerated */ }
  }
  return {
    id: row.id,
    companyId: row.company_id ?? row.companyId,
    name: row.name,
    type: row.type,
    state: row.state,
    targetAmount: Number(row.target_amount ?? row.targetAmount ?? 0),
    raisedAmount: Number(row.raised_amount ?? row.raisedAmount ?? 0),
    preMoney: row.pre_money ?? row.preMoney ?? null,
    postMoney: row.post_money ?? row.postMoney ?? null,
    pricePerShare: row.price_per_share ?? row.pricePerShare ?? null,
    minTicket: row.min_ticket ?? row.minTicket ?? null,
    closeDate: row.close_date ?? row.closeDate ?? null,
    termsSummary: row.terms_summary ?? row.termsSummary ?? null,
    leadInvestor: row.lead_investor ?? row.leadInvestor ?? null,
    currency: row.currency ?? null,
    region: row.region ?? null,
    openDate: row.open_date ?? row.openDate ?? null,
    instrument: row.instrument ?? null,
    createdAt: row.created_at ?? row.createdAt ?? undefined,
    ...extras,
  };
}

/**
 * Hydrate the in-memory cache from `rounds` WHERE deleted_at IS NULL.
 * Called sequentially by hydrateAllStores() on boot.
 */
export async function hydrateRoundsStore(): Promise<void> {
  ROUNDS_BY_ID.clear();
  roundsCache.length = 0;
  try {
    const db = getDb();
    // CROSS-TENANT (admin) — the boot-time hydrate reads every live row in
    // `rounds`. Per-tenant filtering happens at the API layer (founder owns
    // the company id) once the cache is populated.
    const rows = db
      .select()
      .from(roundsTable)
      .where(isNull(roundsTable.deletedAt))
      .all() as any[];
    for (const row of rows) {
      const r = rowToRound(row);
      cacheUpsert(r);
    }
  } catch (err) {
    // First-boot before the table exists is tolerated.
    if (!/no such table/i.test((err as Error).message)) {
      log.warn("[roundsStore.hydrate] failed (continuing):", (err as Error).message);
    }
  }
}

/**
 * Create a new round. Writes through `rounds` (DB) and updates the in-memory
 * cache. Also emits the v11 B-V11-7 `round.created` audit event.
 */
export function createRound(input: {
  companyId: string;
  name: string;
  type: string;
  state?: string;
  targetAmount?: number;
  preMoney?: number | null;
  postMoney?: number | null;
  pricePerShare?: number | null;
  minTicket?: number | null;
  closeDate?: string | null;
  termsSummary?: string | null;
  leadInvestor?: string | null;
  currency?: string | null;
  region?: string | null;
  openDate?: string | null;
  instrument?: string | null;
  actorUserId?: string;
  extras?: Record<string, unknown>;
}): Round {
  const id = `rnd_${randomBytes(6).toString("hex")}`;
  const tenantId = tenantForCompany(input.companyId);
  const now = new Date().toISOString();
  const state = input.state ?? "draft";
  const round: Round = {
    id,
    companyId: input.companyId,
    name: input.name,
    type: input.type,
    state,
    targetAmount: Number(input.targetAmount ?? 0),
    raisedAmount: 0,
    preMoney: input.preMoney ?? null,
    postMoney: input.postMoney ?? null,
    pricePerShare: input.pricePerShare ?? null,
    minTicket: input.minTicket ?? null,
    closeDate: input.closeDate ?? null,
    termsSummary: input.termsSummary ?? null,
    leadInvestor: input.leadInvestor ?? null,
    currency: input.currency ?? null,
    region: input.region ?? null,
    openDate: input.openDate ?? null,
    instrument: input.instrument ?? null,
    createdAt: now,
    ...(input.extras ?? {}),
  };

  // Avi 22-May Issue 3 — round persistence proof.
  //
  // Previously the DB write was wrapped in a try/catch that demoted ANY
  // failure to a non-fatal warning. That hid genuine schema-drift /
  // constraint failures and meant a round could live ONLY in the in-memory
  // cache on a hot deploy. Avi specifically asked for confirmation that
  // rounds are saved to the table.
  //
  // Hardened contract:
  //   - First-boot tolerated: "no such table" => the rounds table hasn't
  //     been migrated yet; allow the cache write to proceed.
  //   - Any OTHER DB error THROWS so the route handler can surface a 5xx
  //     to the caller and the audit log shows a clear failure rather than
  //     a silent cache-only entry.
  try {
    const db = getDb();
    db.transaction((tx: any) => {
      tx.insert(roundsTable)
        .values({
          id,
          tenantId,
          companyId: input.companyId,
          name: input.name,
          type: input.type,
          state,
          targetAmount: round.targetAmount,
          raisedAmount: 0,
          preMoney: round.preMoney ?? undefined,
          postMoney: round.postMoney ?? undefined,
          pricePerShare: round.pricePerShare ?? undefined,
          minTicket: round.minTicket ?? undefined,
          closeDate: round.closeDate ?? undefined,
          termsSummary: round.termsSummary ?? undefined,
          leadInvestor: round.leadInvestor ?? undefined,
          currency: round.currency ?? undefined,
          region: round.region ?? undefined,
          openDate: round.openDate ?? undefined,
          instrument: round.instrument ?? undefined,
          extrasJson: input.extras ? JSON.stringify(input.extras) : undefined,
          createdAt: now,
          updatedAt: now,
          createdBy: input.actorUserId ?? null,
        })
        .run();
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (/no such table/i.test(msg)) {
      log.warn("[roundsStore.createRound] rounds table missing (first boot tolerated):", msg);
    } else {
      log.error("[roundsStore.createRound] DB write FAILED — propagating to caller:", msg);
      throw err;
    }
  }

  cacheUpsert(round);

  // B-V11-7 fix preserved — audit timeline must reflect every new round so
  // the founder Activity page (Issue 6) surfaces it.
  try {
    appendAdminAudit(
      input.actorUserId ?? "u_unknown",
      `company:${input.companyId}`,
      "round.created",
      { roundId: id, name: input.name, type: input.type, instrument: input.instrument ?? null },
      tenantId,
    );
  } catch (err) {
    log.warn("[roundsStore.createRound] audit append failed:", (err as Error).message);
  }

  return round;
}

/** Read a single round from the cache (DB is hydrated). */
export function getRoundById(id: string): Round | undefined {
  return ROUNDS_BY_ID.get(id);
}

/** All rounds for a given company. */
export function getRoundsForCompany(companyId: string): Round[] {
  return roundsCache.filter((r) => r.companyId === companyId);
}

/** All rounds (cache view). */
export function listRounds(): Round[] {
  return [...roundsCache];
}

/** Soft delete (kept for symmetry; not currently used by any route). */
export function softDeleteRound(id: string, actorUserId: string): boolean {
  const round = ROUNDS_BY_ID.get(id);
  if (!round) return false;
  const tenantId = tenantForCompany(round.companyId);
  try {
    const db = getDb();
    db.transaction((tx: any) => {
      tx.update(roundsTable)
        .set({ deletedAt: new Date().toISOString() })
        .where(and(eq(roundsTable.id, id), isNull(roundsTable.deletedAt)))
        .run();
    });
  } catch (err) {
    log.warn("[roundsStore.softDeleteRound] DB write failed:", (err as Error).message);
  }
  ROUNDS_BY_ID.delete(id);
  const idx = roundsCache.findIndex((r) => r.id === id);
  if (idx !== -1) roundsCache.splice(idx, 1);
  try {
    appendAdminAudit(actorUserId, `company:${round.companyId}`, "round.deleted", { roundId: id }, tenantId);
  } catch { /* tolerated */ }
  return true;
}

/** Test-only access for the v13 persistence test. */
export const _testAccessRounds = {
  cache: roundsCache,
  byId: ROUNDS_BY_ID,
  reset: () => { ROUNDS_BY_ID.clear(); roundsCache.length = 0; },
};
