/**
 * server/dscVoteStore.ts — v16 Addendum B.
 *
 * DSC voting DATA layer. FOUNDATION ONLY.
 *
 * NO PUBLIC ENDPOINT in v16. There is intentionally no
 * `POST /api/dsc/votes` route registered anywhere. This store is callable
 * from server-side code only. v17 will layer screening/scheduling/UI on top
 * behind its own feature flag.
 *
 * Pattern: hash-chained, audit-grade, hybrid Map+DB (per v15 build brief).
 *   - Every write wrapped in `getDb().transaction((tx) => {...})` — no `()`.
 *   - Per-company hash chain (chain tip selected inside the same tx so two
 *     parallel `recordVote()` calls cannot collide).
 *   - When a voter re-votes, the prior un-superseded row is marked
 *     superseded in the SAME transaction — atomic.
 *   - Tenant-stamped on every row; reads use the in-memory mirror with
 *     explicit company filtering. Admin aggregate reads are marked
 *     `// CROSS-TENANT (admin)`.
 *   - Sequential hydration via HYDRATE_ORDER.
 */
import { randomBytes, createHash } from "crypto";
import { eq, isNull } from "drizzle-orm";
import { getDb } from "./db/connection";
import { pAll } from "./db/portable"; /* Wave H Track A — Postgres compatibility */
import { dscVotes as dscVotesTable } from "../shared/schema";
import * as collectiveMembershipStore from "./collectiveMembershipStore";
import { log } from "./lib/logger";

export type DscVote = "approve" | "reject" | "conditional" | "abstain";

export interface DscVoteRow {
  id: string;
  tenantId: string;
  companyId: string;
  roundId: string | null;
  voterUserId: string;
  vote: DscVote;
  conditions: string[] | null;
  notes: string | null;
  prevHash: string;
  hash: string;
  castAt: string;
  supersededAt: string | null;
}

export interface RecordVoteArgs {
  companyId: string;
  roundId?: string | null;
  voterUserId: string;
  vote: DscVote;
  conditions?: string[];
  notes?: string;
  tenantId?: string;
}

export interface VoteTally {
  approve: number;
  reject: number;
  conditional: number;
  abstain: number;
  quorumReached: boolean;
  /** total active DSC members at tally time */
  dscMemberCount: number;
  /** count of distinct voters with active (un-superseded) votes */
  voterCount: number;
}

/* ---------- In-memory mirror ---------- */
const memVotes: DscVoteRow[] = [];

function tenantForCompany(companyId: string): string {
  return `tenant_co_${companyId}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(): string {
  return `dscv_${randomBytes(8).toString("hex")}`;
}

function buildVoteBody(args: {
  id: string;
  companyId: string;
  voterUserId: string;
  vote: DscVote;
  conditions: string[] | null;
  castAt: string;
}): string {
  return JSON.stringify({
    id: args.id,
    companyId: args.companyId,
    voterUserId: args.voterUserId,
    vote: args.vote,
    conditions: args.conditions,
    castAt: args.castAt,
  });
}

/* ---------- Writes ---------- */

/**
 * Record a DSC vote for `companyId` from `voterUserId`.
 *
 * If the same voter already has an active (un-superseded) vote for the same
 * company, that prior row is marked superseded in the same transaction.
 *
 * Returns the newly-inserted row.
 */
export function recordVote(args: RecordVoteArgs): DscVoteRow {
  if (!args.companyId) throw new Error("missing_company_id");
  if (!args.voterUserId) throw new Error("missing_voter_user_id");
  if (!["approve", "reject", "conditional", "abstain"].includes(args.vote)) {
    throw new Error("invalid_vote");
  }
  const tenantId = args.tenantId ?? tenantForCompany(args.companyId);
  const id = makeId();
  const castAt = nowIso();
  const conditions = args.conditions && args.conditions.length > 0 ? args.conditions : null;

  // Pre-compute supersession candidate from the mirror so we can update
  // memVotes after the tx without re-scanning.
  const priorIdx = memVotes.findIndex(
    (v) => v.companyId === args.companyId
      && v.voterUserId === args.voterUserId
      && v.supersededAt === null,
  );

  let row: DscVoteRow | null = null;

  try {
    const db: any = getDb();
    db.transaction((tx: any) => {
      // Chain tip per company.
      const tipRow = tx
        .select({ hash: dscVotesTable.hash })
        .from(dscVotesTable)
        .where(eq(dscVotesTable.companyId, args.companyId))
        .all() as Array<{ hash: string; castAt?: string }>;
      // Most recent by lex-sorted castAt — but simpler: re-query ordered.
      // SQLite doesn't have ordered limit in our composed query above for ascending stable sort, so use mirror:
      // The mirror is authoritative for ordering because it's hydrated in insert order.
      const tipFromMirror = [...memVotes]
        .filter((v) => v.companyId === args.companyId)
        .sort((a, b) => (a.castAt < b.castAt ? -1 : a.castAt > b.castAt ? 1 : 0));
      const prevHash = tipFromMirror.length > 0
        ? tipFromMirror[tipFromMirror.length - 1].hash
        : "GENESIS";
      void tipRow;

      const body = buildVoteBody({
        id,
        companyId: args.companyId,
        voterUserId: args.voterUserId,
        vote: args.vote,
        conditions,
        castAt,
      });
      const hash = createHash("sha256").update(`${prevHash}|${body}`).digest("hex").slice(0, 24);

      // Mark prior un-superseded vote (same voter/company) as superseded.
      if (priorIdx >= 0) {
        const prior = memVotes[priorIdx];
        tx.update(dscVotesTable)
          .set({ supersededAt: castAt } as any)
          .where(eq(dscVotesTable.id, prior.id))
          .run();
      }

      tx.insert(dscVotesTable)
        .values({
          id,
          tenantId,
          companyId: args.companyId,
          roundId: args.roundId ?? null,
          voterUserId: args.voterUserId,
          vote: args.vote,
          conditions: conditions ? JSON.stringify(conditions) : null,
          notes: args.notes ?? null,
          prevHash,
          hash,
          castAt,
          supersededAt: null,
        } as any)
        .run();

      row = {
        id,
        tenantId,
        companyId: args.companyId,
        roundId: args.roundId ?? null,
        voterUserId: args.voterUserId,
        vote: args.vote,
        conditions,
        notes: args.notes ?? null,
        prevHash,
        hash,
        castAt,
        supersededAt: null,
      };
    });
  } catch (err) {
    log.warn("[dscVoteStore.recordVote] DB write failed (memory only):", (err as Error).message);
    // Build the row anyway for memory-only mode (mirrors v15 hybrid behavior).
    const tipFromMirror = [...memVotes]
      .filter((v) => v.companyId === args.companyId)
      .sort((a, b) => (a.castAt < b.castAt ? -1 : 1));
    const prevHash = tipFromMirror.length > 0
      ? tipFromMirror[tipFromMirror.length - 1].hash
      : "GENESIS";
    const body = buildVoteBody({
      id,
      companyId: args.companyId,
      voterUserId: args.voterUserId,
      vote: args.vote,
      conditions,
      castAt,
    });
    const hash = createHash("sha256").update(`${prevHash}|${body}`).digest("hex").slice(0, 24);
    row = {
      id, tenantId, companyId: args.companyId,
      roundId: args.roundId ?? null,
      voterUserId: args.voterUserId, vote: args.vote,
      conditions, notes: args.notes ?? null,
      prevHash, hash, castAt, supersededAt: null,
    };
  }

  // Mirror updates: supersede prior + insert new.
  if (priorIdx >= 0) {
    memVotes[priorIdx] = { ...memVotes[priorIdx], supersededAt: castAt };
  }
  if (!row) {
    // Defensive: should never happen.
    throw new Error("recordVote_internal_error_no_row");
  }
  memVotes.push(row);
  return row;
}

/* ---------- Reads ---------- */

/**
 * Returns all votes for a company in cast order (oldest first).
 *
 * Tenant scoping: callers must pass an authenticated request context for the
 * cross-tenant case. This function intentionally takes only `companyId` —
 * the company's tenant is derived from `tenantForCompany`. To enforce
 * tenant isolation at the route level (when v17 wires this up), the route
 * handler should compare `req.userContext.tenantId` against
 * `tenantForCompany(companyId)` and 403 on mismatch.
 *
 * For v16 (foundation), opts.tenantId filters the mirror — callers from a
 * different tenant pass their own tenantId and get an empty array, which is
 * the cross-tenant assertion we test in `v16_dsc_vote_foundation.test.ts`.
 */
export function getVotesForCompany(
  companyId: string,
  opts?: { tenantId?: string; activeOnly?: boolean },
): DscVoteRow[] {
  let rows = memVotes.filter((v) => v.companyId === companyId);
  if (opts?.tenantId !== undefined) {
    rows = rows.filter((v) => v.tenantId === opts.tenantId);
  }
  if (opts?.activeOnly) {
    rows = rows.filter((v) => v.supersededAt === null);
  }
  // Stable oldest-first.
  rows.sort((a, b) => (a.castAt < b.castAt ? -1 : a.castAt > b.castAt ? 1 : 0));
  return rows;
}

/**
 * Tally active (un-superseded) votes. Quorum = at least 50% of active DSC
 * members must have cast an active vote.
 *
 * "DSC members" for v16 = all users with an active row in
 * `collectiveMembershipStore`. v17 will introduce a real `dsc_role` flag.
 */
export function tallyForCompany(companyId: string): VoteTally {
  const active = getVotesForCompany(companyId, { activeOnly: true });
  const tally: VoteTally = {
    approve: 0,
    reject: 0,
    conditional: 0,
    abstain: 0,
    quorumReached: false,
    dscMemberCount: 0,
    voterCount: 0,
  };
  const voters = new Set<string>();
  for (const v of active) {
    voters.add(v.voterUserId);
    if (v.vote === "approve") tally.approve += 1;
    else if (v.vote === "reject") tally.reject += 1;
    else if (v.vote === "conditional") tally.conditional += 1;
    else if (v.vote === "abstain") tally.abstain += 1;
  }
  tally.voterCount = voters.size;
  const memberCount = collectiveMembershipStore.listActive().length;
  tally.dscMemberCount = memberCount;
  // v16 quorum: ≥50% of DSC members. If no DSC members are registered,
  // quorum is conservatively reported as false to avoid false positives.
  tally.quorumReached = memberCount > 0 && tally.voterCount * 2 >= memberCount;
  return tally;
}

/**
 * Walk the per-company hash chain. Returns `{ valid: true, lastHash }` on
 * success, or `{ valid: false, brokenAt: <id> }` on the first row whose
 * `prevHash` doesn't match the previous row's `hash`.
 */
export function verifyChain(companyId: string):
  | { valid: true; lastHash: string }
  | { valid: false; brokenAt: string }
{
  // Include superseded rows — they remain part of the chain (audit-grade).
  const rows = getVotesForCompany(companyId);
  let prev = "GENESIS";
  for (const r of rows) {
    if (r.prevHash !== prev) {
      return { valid: false, brokenAt: r.id };
    }
    prev = r.hash;
  }
  return { valid: true, lastHash: prev };
}

/* ---------- Hydration ---------- */

export async function hydrateDscVoteStore(): Promise<void> {
  memVotes.length = 0;
  try {
    const db: any = getDb();
    /* Wave H Track A — was `.all() as any[]`; converted to portable pAll() so
     * this hydrate path works on both better-sqlite3 (sync .all) and
     * postgres-js (thenable). This was one of the three crash sites in
     * Avi's production logs: `[hydrate] dscVoteStore: DB read failed`. */
    const rows = await pAll<any>(
      db
        .select()
        .from(dscVotesTable)
        .where(isNull((dscVotesTable as any).deletedAt ?? (dscVotesTable as any).deleted_at ?? null))
    );
    for (const r of rows) {
      let conds: string[] | null = null;
      try {
        if (r.conditions) conds = JSON.parse(r.conditions);
      } catch { /* keep null */ }
      memVotes.push({
        id: r.id,
        tenantId: r.tenant_id ?? r.tenantId ?? "",
        companyId: r.company_id ?? r.companyId,
        roundId: r.round_id ?? r.roundId ?? null,
        voterUserId: r.voter_user_id ?? r.voterUserId,
        vote: (r.vote ?? "abstain") as DscVote,
        conditions: conds,
        notes: r.notes ?? null,
        prevHash: r.prev_hash ?? r.prevHash ?? "GENESIS",
        hash: r.hash,
        castAt: r.cast_at ?? r.castAt,
        supersededAt: r.superseded_at ?? r.supersededAt ?? null,
      });
    }
    // Maintain oldest-first order for chain integrity.
    memVotes.sort((a, b) => (a.castAt < b.castAt ? -1 : a.castAt > b.castAt ? 1 : 0));
    if (rows.length > 0) {
      log.info(`[hydrate] dscVoteStore: ${rows.length} votes restored`);
    }
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!/no such table/i.test(msg)) {
      log.warn("[hydrate] dscVoteStore: DB read failed:", msg);
    }
  }
}

/* ---------- Test helpers ---------- */
export const _testAccessDscVotes = {
  rows: memVotes,
  reset(): void { memVotes.length = 0; },
};
