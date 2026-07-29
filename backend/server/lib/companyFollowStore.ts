/**
 * W-COLLECTIVE Wave 2 STAGE D (D1) — DURABLE company-follow relation.
 *
 * ── WHAT WAS BROKEN ────────────────────────────────────────────────────────
 * `POST /api/comms/posts/:id/follow` (server/commsStore.ts) wrote the followed
 * company id onto the POST object (`p.followingCompanyIds`). Three consequences
 * on LIVE:
 *   1. "which users follow this company" was unanswerable — the relation was
 *      stored on the wrong entity;
 *   2. it was in-memory only, so every follow died at the next restart;
 *   3. the client button reads that POST field
 *      (client/src/components/comms/PostsFeed.tsx:743), so ONE user following
 *      made the button read "Following ✓" for EVERY viewer of that post.
 *
 * This module is the per-USER durable relation, on `company_followers`
 * (Stage A migration 0116). Nothing here is cached in memory.
 *
 * ── UPSERT SEMANTICS (fixed by migration 0116, not chosen here) ─────────────
 * 0116 puts a UNIQUE index on the PAIR `(user_id, company_id)` that is
 * deliberately NOT partial on `deleted_at IS NULL`: exactly one row per pair for
 * all time. So:
 *   - follow   → INSERT … ON CONFLICT(user_id, company_id) DO UPDATE SET
 *                deleted_at = NULL  (this makes follow IDEMPOTENT and makes an
 *                unfollow REVERSIBLE without accumulating duplicate rows);
 *   - unfollow → UPDATE … SET deleted_at = ?  (soft, reversible, auditable).
 * `deleted_at IS NULL` is therefore the single liveness test, and it is the same
 * test `server/lib/networkPostAudience.ts` row 4 already applies — so a follow
 * made here immediately grants that audience row, and an unfollow revokes it.
 *
 * ── NO MONEY ───────────────────────────────────────────────────────────────
 * Following a company is a read-relationship only. It confers no funding, no
 * SPV participation and no soft-circle commit, and this module touches none of
 * those tables.
 *
 * Fail-closed: every function returns a false/empty result on any DB error, and
 * the write helpers report `ok:false` so the route can fail the request rather
 * than report a follow that did not persist. All SQL is parameterised.
 */
import { randomBytes } from "node:crypto";
import { rawDb } from "../db/connection";

const isValidId = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

const nowIso = (): string => new Date().toISOString();

export type FollowWriteResult =
  | { ok: true; following: boolean }
  | { ok: false; error: string };

/**
 * Idempotent follow. Calling it twice leaves exactly one live row (proven by the
 * 0116 unique index on the pair), and calling it after an unfollow clears
 * `deleted_at` so the follow is restored rather than duplicated.
 */
export function followCompany(userId: string, companyId: string): FollowWriteResult {
  if (!isValidId(userId) || !isValidId(companyId)) {
    return { ok: false, error: "invalid_ids" };
  }
  try {
    const db: any = rawDb();
    const ts = nowIso();
    db.prepare(
      `INSERT INTO company_followers
         (id, tenant_id, user_id, company_id, created_at, updated_at, deleted_at)
       VALUES (?, NULL, ?, ?, ?, ?, NULL)
       ON CONFLICT(user_id, company_id) DO UPDATE SET
         deleted_at = NULL,
         updated_at = excluded.updated_at`,
    ).run(`cf_${randomBytes(10).toString("hex")}`, userId.trim(), companyId.trim(), ts, ts);
    return { ok: true, following: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Soft unfollow. Reversible (`followCompany` clears `deleted_at`) and auditable
 * (created_at / updated_at / deleted_at are all retained). Unfollowing when no
 * row exists is a no-op that still reports success — the caller asked for "not
 * following", which is the resulting state.
 */
export function unfollowCompany(userId: string, companyId: string): FollowWriteResult {
  if (!isValidId(userId) || !isValidId(companyId)) {
    return { ok: false, error: "invalid_ids" };
  }
  try {
    const db: any = rawDb();
    const ts = nowIso();
    db.prepare(
      `UPDATE company_followers
          SET deleted_at = ?, updated_at = ?
        WHERE user_id = ?
          AND company_id = ?
          AND deleted_at IS NULL`,
    ).run(ts, ts, userId.trim(), companyId.trim());
    return { ok: true, following: false };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** TRUE iff a LIVE follow row exists for this exact (user, company) pair. */
export function isFollowingCompany(userId: string, companyId: string): boolean {
  if (!isValidId(userId) || !isValidId(companyId)) return false;
  try {
    const db: any = rawDb();
    const row = db
      .prepare(
        `SELECT 1 AS hit
           FROM company_followers
          WHERE user_id = ?
            AND company_id = ?
            AND deleted_at IS NULL
          LIMIT 1`,
      )
      .get(userId.trim(), companyId.trim()) as { hit?: number } | undefined;
    return !!row?.hit;
  } catch {
    return false;
  }
}

/** Companies this user currently follows. */
export function companiesFollowedBy(userId: string): string[] {
  if (!isValidId(userId)) return [];
  try {
    const db: any = rawDb();
    const rows = db
      .prepare(
        `SELECT company_id
           FROM company_followers
          WHERE user_id = ?
            AND deleted_at IS NULL
          ORDER BY company_id ASC`,
      )
      .all(userId.trim()) as Array<{ company_id?: string | null }>;
    return rows.map((r) => r?.company_id).filter(isValidId).map((s) => s.trim());
  } catch {
    return [];
  }
}

export interface FollowerRow {
  userId: string;
  followedAt: string;
}

/**
 * The other direction, which the pre-D1 shape could not answer at all: WHO
 * follows this company. Identity resolution is deliberately NOT done here — the
 * route does it through the sacred privacy resolver, per viewer.
 */
export function followersOfCompany(companyId: string): FollowerRow[] {
  if (!isValidId(companyId)) return [];
  try {
    const db: any = rawDb();
    const rows = db
      .prepare(
        `SELECT user_id, created_at
           FROM company_followers
          WHERE company_id = ?
            AND deleted_at IS NULL
          ORDER BY created_at ASC, user_id ASC`,
      )
      .all(companyId.trim()) as Array<{ user_id?: string | null; created_at?: string | null }>;
    return rows
      .filter((r) => isValidId(r?.user_id))
      .map((r) => ({ userId: (r.user_id as string).trim(), followedAt: r.created_at ?? "" }));
  } catch {
    return [];
  }
}

/** Live follower count for a company. */
export function followerCountOfCompany(companyId: string): number {
  if (!isValidId(companyId)) return 0;
  try {
    const db: any = rawDb();
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n
           FROM company_followers
          WHERE company_id = ?
            AND deleted_at IS NULL`,
      )
      .get(companyId.trim()) as { n?: number } | undefined;
    return Number(row?.n ?? 0);
  } catch {
    return 0;
  }
}
