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
import { emitMutation } from "./lib/eventBus";
import { emitBridgeEvent } from "./bridgeStore";
/* v25.20 Lane 4 — round-close chain-head freeze (v25.18 NH4 preserved).
   NOTE: roundCarryForwardRoutes imports getRoundById from this module, so this
   is a deliberate cycle. Both sides only export functions (no top-level call),
   so ESM resolves the cycle without an init-order hazard. */
import { freezeRoundChainHead } from "./roundCarryForwardRoutes";

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

/* ────────────────────────────────────────────────────────────────────────
 * v25.20 Lane 4 — canonical updateRound + closeRound.
 *
 * Closes the v25.19 Lane 2 NC2 documented gap: carry-forward accept persisted
 * only the audit entry + per-company hash chain (v25.18 NH4) but had no
 * canonical API to mutate the round record. These two functions ARE that API.
 *
 * Both are INTERNAL: the route layer (PATCH /api/founder/rounds/:id and
 * POST /api/founder/rounds/:id/close) verifies the caller is the founder of
 * the round's company (assertRoundOwnership) BEFORE calling them.
 *
 * Persistence pattern matches createRound exactly: single Drizzle
 * transaction = one UPDATE; the in-memory cache mutates ONLY when the DB
 * write reports changes=1 (or the rounds table is first-boot-missing).
 * ──────────────────────────────────────────────────────────────────────── */

/* Mass-assignment guard: ONLY these caller-supplied keys may be patched.
 * The map value is the corresponding Drizzle column on `rounds`. Any key not
 * in this whitelist is REJECTED (UNKNOWN_FIELD) — a closed round-shell field
 * set so a forged body cannot flip tenantId / companyId / createdBy / id. */
const UPDATE_WHITELIST: Record<string, keyof typeof roundsTable.$inferInsert> = {
  state: "state",
  status: "state", /* alias: callers may say `status`; canonical column is `state` */
  name: "name",
  type: "type",
  targetAmount: "targetAmount",
  raisingTarget: "targetAmount", /* alias */
  raisedAmount: "raisedAmount",
  pricePerShare: "pricePerShare",
  preMoney: "preMoney",
  valuationPre: "preMoney", /* alias */
  postMoney: "postMoney",
  valuationPost: "postMoney", /* alias */
  closeDate: "closeDate",
  expectedClose: "closeDate", /* alias */
  minTicket: "minTicket",
  termsSummary: "termsSummary",
  leadInvestor: "leadInvestor",
  currency: "currency",
  region: "region",
  openDate: "openDate",
  instrument: "instrument",
};

/* Exported so callers (e.g. carry-forward accept) can pre-filter a patch to
   only the whitelisted keys without duplicating the list. */
export const UPDATE_ROUND_WHITELIST_KEYS: string[] = Object.keys(UPDATE_WHITELIST);

export interface UpdateRoundOpts {
  actor: string;
  /** Optimistic-concurrency guard. When supplied, the update only applies if
   *  the round's current updatedAt matches; otherwise VERSION_CONFLICT. */
  expectedVersion?: string;
}

export interface UpdateRoundResult {
  ok: boolean;
  round?: Round;
  error?: "ROUND_NOT_FOUND" | "NO_CHANGES" | "UNKNOWN_FIELD" | "VERSION_CONFLICT" | "DB_WRITE_FAILED";
  rejectedKey?: string;
  changes?: number;
}

/**
 * updateRound — transactional, owner-verified-at-route, audited round mutation.
 *
 * @param roundId  the round to patch
 * @param patch    caller-supplied field map (mass-assignment-guarded)
 * @param opts     { actor, expectedVersion? }
 */
export function updateRound(
  roundId: string,
  patch: Record<string, unknown>,
  opts: UpdateRoundOpts,
): UpdateRoundResult {
  const round = ROUNDS_BY_ID.get(roundId);
  if (!round) return { ok: false, error: "ROUND_NOT_FOUND" };

  /* Optimistic concurrency: reject if the caller's expected version no longer
     matches the persisted updatedAt (lost-update guard). */
  if (opts.expectedVersion !== undefined) {
    const currentVersion = (round.updatedAt as string | undefined) ?? (round.createdAt as string | undefined) ?? "";
    if (currentVersion && currentVersion !== opts.expectedVersion) {
      return { ok: false, error: "VERSION_CONFLICT" };
    }
  }

  /* Whitelist + mass-assignment guard. Build BOTH the DB column set and the
     in-memory cache patch from the same validated keys. */
  const dbSet: Record<string, unknown> = {};
  const cachePatch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue; /* absent — leave untouched */
    const column = UPDATE_WHITELIST[key];
    if (!column) {
      return { ok: false, error: "UNKNOWN_FIELD", rejectedKey: key };
    }
    dbSet[column as string] = value;
    /* Cache uses the original Round field name; the alias resolves to the
       canonical Round key. `state` is canonical (Round has no `status`). */
    const cacheKey =
      key === "status" ? "state"
      : key === "raisingTarget" ? "targetAmount"
      : key === "valuationPre" ? "preMoney"
      : key === "valuationPost" ? "postMoney"
      : key === "expectedClose" ? "closeDate"
      : key;
    cachePatch[cacheKey] = value;
  }

  if (Object.keys(dbSet).length === 0) {
    return { ok: false, error: "NO_CHANGES" };
  }

  const now = new Date().toISOString();
  dbSet["updatedAt"] = now;

  /* Transactional DB write — single UPDATE. Mirrors createRound's hardened
     contract: first-boot "no such table" tolerated (cache-only), any other DB
     error propagates so the route returns a clean 500. */
  let changes = 0;
  let tableMissing = false;
  try {
    const db = getDb();
    db.transaction((tx: any) => {
      const r = tx
        .update(roundsTable)
        .set(dbSet)
        .where(and(eq(roundsTable.id, roundId), isNull(roundsTable.deletedAt)))
        .run();
      changes = Number(r?.changes ?? r?.rowsAffected ?? 0);
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (/no such table/i.test(msg)) {
      tableMissing = true;
      log.warn("[roundsStore.updateRound] rounds table missing (first boot tolerated):", msg);
    } else {
      log.error("[roundsStore.updateRound] DB write FAILED — propagating to caller:", msg);
      return { ok: false, error: "DB_WRITE_FAILED" };
    }
  }

  /* Mutate the in-memory cache ONLY on a real change (changes=1) or when the
     table is first-boot-missing (cache is the only store at that point). */
  if (changes === 0 && !tableMissing) {
    /* Row vanished between cache read and UPDATE (soft-deleted concurrently). */
    return { ok: false, error: "ROUND_NOT_FOUND", changes };
  }
  const updated: Round = { ...round, ...cachePatch, updatedAt: now };
  cacheUpsert(updated);

  /* Audit: append `round.updated` so the founder Activity timeline reflects
     the mutation (preserves B-V11-7). */
  const tenantId = tenantForCompany(updated.companyId);
  try {
    appendAdminAudit(
      opts.actor,
      `company:${updated.companyId}`,
      "round.updated",
      { roundId, changedKeys: Object.keys(cachePatch), patch: cachePatch },
      tenantId,
    );
  } catch (err) {
    log.warn("[roundsStore.updateRound] audit append failed:", (err as Error).message);
  }

  /* Realtime: tell SSE subscribers the round changed. */
  emitMutation({ aggregate: "round", id: roundId, change: "update" });

  return { ok: true, round: updated, changes: changes || 1 };
}

export interface CloseRoundOpts {
  actor: string;
  reason: string;
  finalAmountMinor?: number;
  finalCurrency?: string;
  /** Optional explicit terminal state. Defaults to "closed". The rounds schema
   *  documents the terminal state as `closed`; callers funding/aborting may
   *  pass "closed_funded"/"closed_aborted" if their flow distinguishes them. */
  finalState?: "closed" | "closed_funded" | "closed_aborted";
}

export interface CloseRoundResult {
  ok: boolean;
  round?: Round;
  alreadyClosed?: boolean;
  frozenChainHead?: string | null;
  error?: "ROUND_NOT_FOUND" | "DB_WRITE_FAILED";
}

/**
 * closeRound — transitions a round to a terminal state, idempotently.
 *
 * - Idempotent: if the round is already in a terminal state, returns ok with
 *   alreadyClosed=true and NO mutation.
 * - Transactional: single UPDATE setting state + closeDate.
 * - Audit: appendAdminAudit `round.closed` with reason + final amount.
 * - Bridge: emitBridgeEvent({ eventType: "round.closed", ... }).
 * - Cap-table hash chain: freezes the round's per-company carry-forward chain
 *   head (v25.18 NH4) — see freezeRoundChainHead. The chain is NOT mutated;
 *   only a read-only snapshot of its tip is captured for this round.
 */
export function closeRound(roundId: string, opts: CloseRoundOpts): CloseRoundResult {
  const round = ROUNDS_BY_ID.get(roundId);
  if (!round) return { ok: false, error: "ROUND_NOT_FOUND" };

  const TERMINAL = new Set(["closed", "closed_funded", "closed_aborted", "funded"]);
  if (TERMINAL.has(round.state)) {
    /* Idempotent no-op — still report the (previously) frozen chain head. */
    return {
      ok: true,
      alreadyClosed: true,
      round,
      frozenChainHead: freezeRoundChainHead(roundId, round.companyId),
    };
  }

  const finalState = opts.finalState ?? "closed";
  const now = new Date().toISOString();
  const tenantId = tenantForCompany(round.companyId);

  let changes = 0;
  let tableMissing = false;
  try {
    const db = getDb();
    db.transaction((tx: any) => {
      const r = tx
        .update(roundsTable)
        .set({ state: finalState, closeDate: round.closeDate ?? now, updatedAt: now })
        .where(and(eq(roundsTable.id, roundId), isNull(roundsTable.deletedAt)))
        .run();
      changes = Number(r?.changes ?? r?.rowsAffected ?? 0);
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (/no such table/i.test(msg)) {
      tableMissing = true;
      log.warn("[roundsStore.closeRound] rounds table missing (first boot tolerated):", msg);
    } else {
      log.error("[roundsStore.closeRound] DB write FAILED — propagating to caller:", msg);
      return { ok: false, error: "DB_WRITE_FAILED" };
    }
  }

  if (changes === 0 && !tableMissing) {
    return { ok: false, error: "ROUND_NOT_FOUND", round };
  }

  const closed: Round = {
    ...round,
    state: finalState,
    closeDate: round.closeDate ?? now,
    closedAt: now,
    updatedAt: now,
  };
  cacheUpsert(closed);

  /* Cap-table hash chain — freeze the per-company carry-forward chain head for
     this round (v25.18 NH4). Append-only chain is NOT mutated. */
  const frozenChainHead = freezeRoundChainHead(roundId, round.companyId);

  /* Audit. */
  try {
    appendAdminAudit(
      opts.actor,
      `company:${round.companyId}`,
      "round.closed",
      {
        roundId,
        reason: opts.reason,
        finalState,
        finalAmountMinor: opts.finalAmountMinor ?? null,
        finalCurrency: opts.finalCurrency ?? round.currency ?? null,
        frozenChainHead,
      },
      tenantId,
    );
  } catch (err) {
    log.warn("[roundsStore.closeRound] audit append failed:", (err as Error).message);
  }

  /* Bridge outbound event. */
  try {
    emitBridgeEvent({
      eventType: "round.closed",
      aggregateId: roundId,
      aggregateKind: "round",
      tenantId,
      actor: { userId: opts.actor },
      payload: {
        roundId,
        companyId: round.companyId,
        reason: opts.reason,
        finalState,
        finalAmountMinor: opts.finalAmountMinor ?? null,
        finalCurrency: opts.finalCurrency ?? round.currency ?? null,
        frozenChainHead,
      },
    });
  } catch (err) {
    log.warn("[roundsStore.closeRound] bridge emit failed:", (err as Error).message);
  }

  emitMutation({ aggregate: "round", id: roundId, change: "update" });

  return { ok: true, round: closed, alreadyClosed: false, frozenChainHead };
}

/** Test-only access for the v13 persistence test. */
export const _testAccessRounds = {
  cache: roundsCache,
  byId: ROUNDS_BY_ID,
  reset: () => { ROUNDS_BY_ID.clear(); roundsCache.length = 0; },
};
