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
/* v25.25.2 — createRequire shim: lazy require() calls in this file must work
   in BOTH the dev/prod tsx runtime (ESM, where `require` is undefined) AND
   the bundled CJS dist. This is the minimal, zero-risk way to unblock the
   v25.25 login 500 ("require is not defined" at userContext.ts:585 and other
   sites) without converting every lazy require() to a static import (which
   would re-introduce circular-import bugs). */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

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
  /* v25.12 NC-2 — chapterId is the chapter scope at vote-cast time. Required
   * for per-chapter tally + quorum. Older v16/v17 rows that predate this
   * field will be null — they are not included in chapter-scoped tallies
   * and only show up in the platform-wide audit/global view. */
  chapterId: string | null;
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
  /* v25.12 NC-2 — chapter scope the vote is cast under. Routes pass this
   * from the validated `castVoteSchema` body. */
  chapterId?: string | null;
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
      /* v25.12 NM-3 — chain-tip lookup is now performed INSIDE the same
       * transaction, and we use the DB rows directly to compute prevHash
       * (sorted by castAt). The prior implementation read the tip from
       * `memVotes` outside the transaction, which let two concurrent
       * recordVote() calls observe the same prevHash and fork the chain.
       * SQLite serialises writers within a transaction, so picking prevHash
       * from the in-tx SELECT is safe under concurrency. */
      const tipRows = tx
        .select({ hash: dscVotesTable.hash, castAt: dscVotesTable.castAt })
        .from(dscVotesTable)
        .where(eq(dscVotesTable.companyId, args.companyId))
        .all() as Array<{ hash: string; castAt: string }>;
      const sortedTips = [...tipRows].sort((a, b) => (a.castAt < b.castAt ? -1 : a.castAt > b.castAt ? 1 : 0));
      const prevHash = sortedTips.length > 0
        ? sortedTips[sortedTips.length - 1].hash
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
        chapterId: args.chapterId ?? null,
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
    /* v25.22 NH-1 fix — the legacy code built a memory-only row here, which
     * violated "ALL TIED DIRECTLY TO THE DATABASE / NO MEMORY STORAGE" and
     * created a phantom-vote class: a DB failure produced an in-memory vote
     * that could push the proposal past quorum and (post v25.21) fire
     * deal-room admission for a company whose vote never actually persisted.
     * We now fail closed — the caller's POST returns 500 and the
     * tally/quorum/deal-room logic never observes a phantom vote. */
    log.error(
      "[dscVoteStore.recordVote] DB write failed; failing closed to avoid phantom vote:",
      (err as Error).message,
    );
    throw new Error(`recordVote_db_failed:${(err as Error).message}`);
  }

  // Mirror updates: supersede prior + insert new.
  if (priorIdx >= 0) {
    memVotes[priorIdx] = { ...memVotes[priorIdx], supersededAt: castAt };
    /* v25.12 NC-2 — persist the prior-row supersedence too so post-restart
     * tallies see the same state. */
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { persistEntry } = require("./lib/storePersistenceShim");
      persistEntry("dscVoteStoreChapter", memVotes[priorIdx].id, memVotes[priorIdx]);
    } catch { /* non-fatal */ }
  }
  if (!row) {
    // Defensive: should never happen.
    throw new Error("recordVote_internal_error_no_row");
  }
  memVotes.push(row);
  /* v25.12 NC-2 — persist the chapterId-bearing row via kv shim so it
   * survives restart even when the underlying DB schema lacks a chapterId
   * column. On hydrate we merge this back into memVotes. */
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { persistEntry } = require("./lib/storePersistenceShim");
    persistEntry("dscVoteStoreChapter", row.id, row);
  } catch { /* non-fatal */ }
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
  opts?: { tenantId?: string; activeOnly?: boolean; chapterId?: string },
): DscVoteRow[] {
  let rows = memVotes.filter((v) => v.companyId === companyId);
  if (opts?.tenantId !== undefined) {
    rows = rows.filter((v) => v.tenantId === opts.tenantId);
  }
  /* v25.12 NC-2 — chapter scoping. Each vote row carries the chapterId of the
   * voter at cast time (it lives on the row as `chapterId`, mirrored from the
   * DSC role at vote time). When a chapterId filter is supplied we only count
   * votes cast on behalf of that chapter; this prevents Chapter A's votes
   * from showing up in Chapter B's tally. Rows that do not carry a chapterId
   * (legacy v16 rows) are kept ONLY when the caller passes `chapterId`
   * unspecified (back-compat for the global tally path used by audits). */
  if (opts?.chapterId !== undefined) {
    rows = rows.filter((v) => (v as any).chapterId === opts.chapterId);
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
export function tallyForCompany(companyId: string, opts?: { chapterId?: string }): VoteTally {
  /* v25.12 NC-2 — chapterId is now passed through to the per-chapter
   * vote slice. The previous implementation pooled all chapters' votes
   * into one tally and used a platform-wide member count for quorum,
   * which let votes from Chapter A pass or fail Chapter B's proposal.
   * Callers that don't pass chapterId (legacy audits) get the global
   * tally for back-compat — see the route layer where we now require
   * chapterId from the verified caller context. */
  const active = getVotesForCompany(companyId, { activeOnly: true, chapterId: opts?.chapterId });
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
  /* v25.12 NC-2 — quorum denominator is now per-chapter when chapterId is
   * supplied. Falls back to platform-wide active membership only when no
   * chapterId is passed (audit / aggregate path). */
  let memberCount: number;
  if (opts?.chapterId) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { countActiveChapterMembers } = require("./chaptersStore");
      memberCount = countActiveChapterMembers(opts.chapterId) ?? 0;
    } catch {
      memberCount = 0;
    }
  } else {
    memberCount = collectiveMembershipStore.listActive().length;
  }
  tally.dscMemberCount = memberCount;
  // Quorum: ≥50% of DSC members in scope. Conservative: 0 members → false.
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
        chapterId: null, // Legacy DB rows don't carry chapterId; kv shim layer below restores it where available.
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
  /* v25.12 NC-2 — merge chapterId from the kv shim layer onto each
   * matching row by id. Rows we added in v25.12+ will have chapterId set;
   * older rows fall back to null and get the global (un-chaptered) tally. */
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { hydrateEntries } = require("./lib/storePersistenceShim");
    const kv = hydrateEntries("dscVoteStoreChapter") as Array<[string, DscVoteRow]>;
    if (Array.isArray(kv) && kv.length > 0) {
      const byId = new Map<string, DscVoteRow>(kv.filter(([k]) => typeof k === "string"));
      for (let i = 0; i < memVotes.length; i++) {
        const enriched = byId.get(memVotes[i].id);
        if (enriched) {
          memVotes[i] = { ...memVotes[i], chapterId: enriched.chapterId ?? null, supersededAt: enriched.supersededAt ?? memVotes[i].supersededAt };
        }
      }
      // Also re-add rows that only exist in kv (e.g. when the DB has no chapterId path).
      for (const [id, row] of kv) {
        if (!memVotes.find((v) => v.id === id)) {
          memVotes.push(row);
        }
      }
      memVotes.sort((a, b) => (a.castAt < b.castAt ? -1 : a.castAt > b.castAt ? 1 : 0));
    }
  } catch { /* non-fatal */ }
}

/* ---------- Test helpers ---------- */
export const _testAccessDscVotes = {
  rows: memVotes,
  reset(): void { memVotes.length = 0; },
};
