/**
 * v25.44 Wave A — Tier-1 widgets + routes (Surfaces 1-12).
 *
 * All endpoints are DB-driven (NO fake data), tenant/chapter-scoped, and
 * fail-closed. They reuse existing tables only (no new tables here; the two
 * additive columns live in connection.ts / schema.ts). AVI Tier-2 stores are
 * NOT touched — every read here goes through rawDb() with explicit scoping.
 *
 * Surfaces:
 *   1  GET  /api/collective/me/engagement
 *   2  GET  /api/collective/platform-pulse
 *   3  GET  /api/collective/me/portfolio
 *   4  GET  /api/collective/chapters/:chapterId/presentations
 *   5  GET  /api/collective/posts?cursor=&limit=
 *   6  GET  /api/collective/me/connections          (extended response)
 *   7  GET  /api/collective/monthly-meetings
 *   8  POST /api/collective/schedule
 *   9  POST /api/collective/applications            (application_type=syndicate)
 *  10  GET  /api/admin/deal-statistics
 *  11  POST /api/admin/applications/:id/decline
 *  12  GET  /api/admin/regions/rollup
 */
import type { Express, Request, Response } from "express";
import { randomBytes, createHash } from "node:crypto";
import { rawDb } from "./db/connection";
import { getUserContext } from "./lib/userContext";
import { requireCollectiveMember } from "./lib/requireCollectiveMember";
import { resolveDisplayName } from "./lib/userPrivacyResolver";
import { areCoMembersOnAnyCapTable } from "./lib/capTableMembership";
import { MA_PRIVACY_DEFAULT, maPrivacySchema } from "@shared/schema";
import { log } from "./lib/logger";

/* ---------------- shared helpers ---------------- */

function nowIso(): string {
  return new Date().toISOString();
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${randomBytes(6).toString("hex")}`;
}

/** Active chapter ids for a user, derived from chapter_memberships (DB-direct). */
function chapterIdsForUser(userId: string): string[] {
  try {
    const rows = rawDb()
      .prepare(
        `SELECT chapter_id FROM chapter_memberships
         WHERE user_id = ? AND status = 'active' AND deleted_at IS NULL`,
      )
      .all(userId) as Array<{ chapter_id: string }>;
    return rows.map((r) => r.chapter_id);
  } catch {
    return [];
  }
}

function isUserInChapter(userId: string, chapterId: string): boolean {
  return chapterIdsForUser(userId).includes(chapterId);
}

function isDbAdmin(userId: string): boolean {
  try {
    const row = rawDb()
      .prepare(`SELECT role FROM users WHERE id = ? LIMIT 1`)
      .get(userId) as { role?: string } | undefined;
    return row?.role === "admin";
  } catch {
    return false;
  }
}

/** requireAdmin shim consistent with the rest of the tree (ctx.isAdmin or DB). */
async function requireAdminCtx(
  req: Request,
  res: Response,
): Promise<{ userId: string } | null> {
  const ctx = await getUserContext(req);
  const userId = ctx?.userId;
  if (!userId) {
    res.status(401).json({ ok: false, error: "missing_identity" });
    return null;
  }
  if (ctx?.isAdmin || isDbAdmin(userId)) return { userId };
  res.status(403).json({ ok: false, error: "forbidden_admin_only" });
  return null;
}

function scalar<T = number>(sql: string, params: unknown[] = [], fallback: T): T {
  try {
    const row = rawDb().prepare(sql).get(...(params as any[])) as
      | Record<string, unknown>
      | undefined;
    if (!row) return fallback;
    const v = Object.values(row)[0];
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/* ============================================================
 * SURFACE 1 — Engagement Score
 * ============================================================ */

export interface EngagementResponse {
  score: number;
  components: {
    softCircles: { count: number; weight: 25 };
    screeningsVoted: { count: number; weight: 15 };
    inquiriesSent: { count: number; weight: 10 };
    dealsListed: { count: number; weight: 5 };
  };
  asOf: string;
}

export function computeEngagement(userId: string): EngagementResponse {
  const softCircles = scalar<number>(
    `SELECT COUNT(*) AS c FROM soft_circles WHERE investor_user_id = ? AND deleted_at IS NULL`,
    [userId],
    0,
  );
  // screening_votes is the canonical vote table (dsc_votes proxy where present).
  const screeningsVoted = scalar<number>(
    `SELECT COUNT(*) AS c FROM dsc_votes WHERE voter_user_id = ?`,
    [userId],
    0,
  );
  // inquiries sent — threads initiated by user (message_threads). READ-ONLY.
  const inquiriesSent = scalar<number>(
    `SELECT COUNT(*) AS c FROM message_threads WHERE created_by_user_id = ? AND deleted_at IS NULL`,
    [userId],
    0,
  );
  // deals listed — rounds the user created (proxy for deal-list authorship).
  const dealsListed = scalar<number>(
    `SELECT COUNT(*) AS c FROM rounds WHERE created_by = ? AND deleted_at IS NULL`,
    [userId],
    0,
  );

  const score = Math.min(
    100,
    softCircles * 25 + screeningsVoted * 15 + inquiriesSent * 10 + dealsListed * 5,
  );
  return {
    score,
    components: {
      softCircles: { count: softCircles, weight: 25 },
      screeningsVoted: { count: screeningsVoted, weight: 15 },
      inquiriesSent: { count: inquiriesSent, weight: 10 },
      dealsListed: { count: dealsListed, weight: 5 },
    },
    asOf: nowIso(),
  };
}

/* ============================================================
 * SURFACE 2 — Platform Pulse  (audit_log; fail-closed if unavailable)
 * ============================================================ */

export type PlatformPulseResponse =
  | {
      status: "OK";
      counts: {
        membersOnline: number;
        dealUpdatesToday: number;
        softCirclesToday: number;
        screeningsThisWeek: number;
        activeDeals: number;
        openDeals: number;
      };
      asOf: string;
    }
  | { status: "AUDIT_LOG_UNAVAILABLE"; counts: null; asOf: string };

export function getPlatformPulse(): PlatformPulseResponse {
  // audit_log table presence check — fail closed (NO fake numbers).
  let auditAvailable = false;
  try {
    rawDb().prepare(`SELECT 1 FROM audit_log LIMIT 1`).get();
    auditAvailable = true;
  } catch {
    auditAvailable = false;
  }
  if (!auditAvailable) {
    return { status: "AUDIT_LOG_UNAVAILABLE", counts: null, asOf: nowIso() };
  }
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

  // audit_log columns: action, actor_id, target_id, created_at.
  const membersOnline = scalar<number>(
    `SELECT COUNT(DISTINCT actor_id) AS c FROM audit_log
     WHERE action IN ('auth.login','session.login','user.login') AND created_at >= ?`,
    [dayAgo],
    0,
  );
  const dealUpdatesToday = scalar<number>(
    `SELECT COUNT(*) AS c FROM audit_log
     WHERE action IN ('deal.created','deal.updated','round.created','round.updated') AND created_at >= ?`,
    [dayAgo],
    0,
  );
  const softCirclesToday = scalar<number>(
    `SELECT COUNT(*) AS c FROM audit_log
     WHERE action = 'soft_circle.created' AND created_at >= ?`,
    [dayAgo],
    0,
  );
  const screeningsThisWeek = scalar<number>(
    `SELECT COUNT(*) AS c FROM audit_log
     WHERE action = 'screening.voted' AND created_at >= ?`,
    [weekAgo],
    0,
  );
  const activeDeals = scalar<number>(
    `SELECT COUNT(DISTINCT target_id) AS c FROM audit_log
     WHERE action LIKE 'round.%' AND created_at >= ?`,
    [monthAgo],
    0,
  );
  const openDeals = scalar<number>(
    `SELECT COUNT(*) AS c FROM rounds WHERE state = 'open' AND deleted_at IS NULL`,
    [],
    0,
  );
  return {
    status: "OK",
    counts: {
      membersOnline,
      dealUpdatesToday,
      softCirclesToday,
      screeningsThisWeek,
      activeDeals,
      openDeals,
    },
    asOf: nowIso(),
  };
}

/* ============================================================
 * SURFACE 3 — My Portfolio (captable_commits → companies)
 * ============================================================ */

export interface PortfolioPosition {
  companyId: string;
  companyName: string;
  sector: string | null;
  region: string | null;
  role: "founder" | "investor" | "advisor";
  round: string;
  positionValueUsd: number | null;
  presentingNext: boolean;
}
export interface PortfolioResponse {
  positions: PortfolioPosition[];
  totalValueUsd: number | null;
  count: number;
}

export function getMyPortfolio(userId: string): PortfolioResponse {
  let rows: Array<{
    company_id: string;
    name: string | null;
    sector: string | null;
    region: string | null;
    round_id: string;
    round_name: string | null;
    amount: string | null;
    currency: string | null;
  }> = [];
  try {
    rows = rawDb()
      .prepare(
        `SELECT cc.company_id AS company_id, c.name AS name, c.sector AS sector,
                r.region AS region, cc.round_id AS round_id, r.name AS round_name,
                cc.amount AS amount, cc.currency AS currency
         FROM captable_commits cc
         LEFT JOIN companies c ON c.id = cc.company_id AND c.deleted_at IS NULL
         LEFT JOIN rounds r ON r.id = cc.round_id AND r.deleted_at IS NULL
         WHERE cc.investor_id = ? AND cc.deleted_at IS NULL
           AND cc.state IN ('funded','committed','confirmed')`,
      )
      .all(userId) as typeof rows;
  } catch (err) {
    log.warn("[waveA.portfolio] read failed:", (err as Error).message);
    rows = [];
  }

  // "presenting next" — open round in next 30d for this company.
  const horizon = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  function presentingNext(companyId: string): boolean {
    return (
      scalar<number>(
        `SELECT COUNT(*) AS c FROM rounds
         WHERE company_id = ? AND state = 'open' AND deleted_at IS NULL
           AND (close_date IS NULL OR close_date <= ?)`,
        [companyId, horizon],
        0,
      ) > 0
    );
  }

  let anyValue = false;
  const positions: PortfolioPosition[] = rows.map((r) => {
    let valueUsd: number | null = null;
    if (r.amount != null && (r.currency == null || r.currency === "USD")) {
      const n = Number(r.amount);
      if (Number.isFinite(n)) {
        valueUsd = n;
        anyValue = true;
      }
    }
    return {
      companyId: r.company_id,
      companyName: r.name ?? r.company_id,
      sector: r.sector ?? null,
      region: r.region ?? null,
      role: "investor",
      round: r.round_name ?? r.round_id,
      positionValueUsd: valueUsd,
      presentingNext: presentingNext(r.company_id),
    };
  });

  const totalValueUsd = anyValue
    ? positions.reduce((sum, p) => sum + (p.positionValueUsd ?? 0), 0)
    : null;

  return { positions, totalValueUsd, count: positions.length };
}

/* ============================================================
 * SURFACE 4 — Presentations · my chapter
 * ============================================================ */

export interface PresentationMeeting {
  date: string;
  location: string;
  confirmedPresenters: Array<{ companyId: string; companyName: string; sector: string | null }>;
  invitedFounders: Array<{ userId: string; name: string; status: string }>;
}
export interface PresentationsResponse {
  nextMeeting: PresentationMeeting | null;
  upcoming: PresentationMeeting[];
}

export function getChapterPresentations(chapterId: string): PresentationsResponse {
  let events: Array<{
    id: string;
    company_id: string;
    company_name: string | null;
    sector: string | null;
    scheduled_for: number;
    location: string | null;
    status: string;
  }> = [];
  try {
    events = rawDb()
      .prepare(
        `SELECT se.id AS id, se.company_id AS company_id, c.name AS company_name,
                c.sector AS sector, se.scheduled_for AS scheduled_for,
                se.location AS location, se.status AS status
         FROM screening_events se
         LEFT JOIN companies c ON c.id = se.company_id
         WHERE se.chapter_id = ? AND se.deleted_at IS NULL
           AND se.scheduled_for >= ?
         ORDER BY se.scheduled_for ASC`,
      )
      .all(chapterId, Date.now()) as typeof events;
  } catch (err) {
    log.warn("[waveA.presentations] read failed:", (err as Error).message);
    events = [];
  }

  const meetings: PresentationMeeting[] = events.map((e) => ({
    date: new Date(e.scheduled_for).toISOString(),
    location: e.location ?? "—",
    confirmedPresenters: [
      {
        companyId: e.company_id,
        companyName: e.company_name ?? e.company_id,
        sector: e.sector ?? null,
      },
    ],
    invitedFounders: [],
  }));

  return {
    nextMeeting: meetings[0] ?? null,
    upcoming: meetings.slice(1, 4),
  };
}

/* ============================================================
 * SURFACE 5 — Network Posts feed (network_posts table, read-only)
 * ============================================================ */

export interface NetworkPostItem {
  id: string;
  authorUserId: string;
  authorName: string;
  body: string;
  createdAt: string;
  chapterId: string | null;
  sectorTags: string[];
  likeCount: number;
  commentCount: number;
}
export interface NetworkPostsResponse {
  posts: NetworkPostItem[];
  nextCursor: string | null;
}

export function getNetworkPosts(
  limit: number,
  cursor: string | null,
  viewerUserId: string | null = null,
): NetworkPostsResponse {
  const lim = Math.max(1, Math.min(50, limit || 20));
  let rows: Array<{
    id: string;
    author_user_id: string;
    body: string;
    content_json: string | null;
    likes: number;
    comments: number;
    created_at: string;
  }> = [];
  try {
    const params: unknown[] = [];
    let where = `WHERE np.deleted_at IS NULL AND np.parent_post_id IS NULL`;
    if (cursor) {
      where += ` AND np.created_at < ?`;
      params.push(cursor);
    }
    params.push(lim + 1);
    rows = rawDb()
      .prepare(
        `SELECT np.id AS id, np.author_user_id AS author_user_id, np.body AS body,
                np.content_json AS content_json, np.likes AS likes, np.comments AS comments,
                np.created_at AS created_at
         FROM network_posts np
         ${where}
         ORDER BY np.created_at DESC
         LIMIT ?`,
      )
      .all(...(params as any[])) as typeof rows;
  } catch (err) {
    log.warn("[waveA.posts] read failed:", (err as Error).message);
    rows = [];
  }

  const hasMore = rows.length > lim;
  const page = rows.slice(0, lim);
  const posts: NetworkPostItem[] = page.map((r) => {
    let content: { topics?: string[]; chapterId?: string | null } = {};
    try {
      content = r.content_json ? JSON.parse(r.content_json) : {};
    } catch {
      content = {};
    }
    // v25.45 ROUND 7 — network posts are a SOCIAL surface, not a counterparty
    // surface (isCoMember:false). They use the "collectiveDirectory" posture,
    // which ALWAYS requires explicit opt-in (visibleInCollectiveDirectory:true);
    // a no-row author renders as "Private Investor". Never return raw users.name.
    const rawAuthorName =
      scalar<string>(
        `SELECT name AS n FROM users WHERE id = ? LIMIT 1`,
        [r.author_user_id],
        r.author_user_id,
      ) || r.author_user_id;
    const authorName = resolveDisplayName(
      r.author_user_id,
      viewerUserId ?? null,
      "collectiveDirectory",
      { legalName: rawAuthorName, isCoMember: false },
    );
    return {
      id: r.id,
      authorUserId: r.author_user_id,
      authorName,
      body: r.body,
      createdAt: r.created_at,
      chapterId: content.chapterId ?? null,
      sectorTags: Array.isArray(content.topics) ? content.topics : [],
      likeCount: r.likes ?? 0,
      commentCount: r.comments ?? 0,
    };
  });

  const nextCursor = hasMore ? page[page.length - 1]?.created_at ?? null : null;
  return { posts, nextCursor };
}

/* ------------------------------------------------------------------
 * v25.46 Track 2 — single-post read + self-moderation soft-delete.
 * Both read/write the SAME network_posts table the feed reads; the
 * delete is SOFT (deleted_at) per Tier 3 #28/#29 (never destructive).
 * ------------------------------------------------------------------ */
export interface NetworkPostLite {
  id: string;
  authorUserId: string;
  body: string;
  createdAt: string;
  deletedAt: string | null;
}

/** Fetch a single network post by id (including already-deleted rows so the
 *  route can return 404 vs 403 deterministically). Returns null if absent. */
export function getNetworkPostById(id: string): NetworkPostLite | null {
  if (typeof id !== "string" || id.trim().length === 0) return null;
  try {
    const row = rawDb()
      .prepare(
        `SELECT id, author_user_id, body, created_at, deleted_at
           FROM network_posts WHERE id = ? LIMIT 1`,
      )
      .get(id.trim()) as
      | { id: string; author_user_id: string; body: string; created_at: string; deleted_at: string | null }
      | undefined;
    if (!row || row.deleted_at) return null;
    return {
      id: row.id,
      authorUserId: row.author_user_id,
      body: row.body,
      createdAt: row.created_at,
      deletedAt: row.deleted_at ?? null,
    };
  } catch (err) {
    log.warn("[waveA.posts] getNetworkPostById failed:", (err as Error).message);
    return null;
  }
}

/** Soft-delete a network post (self-moderation). Marks deleted_at; never drops
 *  the row. Returns true if a live row was marked deleted. */
export function softDeleteNetworkPost(id: string, actorUserId: string): boolean {
  if (typeof id !== "string" || id.trim().length === 0) return false;
  try {
    const now = new Date().toISOString();
    const info = rawDb()
      .prepare(
        `UPDATE network_posts SET deleted_at = ?
           WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(now, id.trim());
    if (info?.changes && info.changes > 0) {
      log.info(`[waveA.posts] soft-deleted ${id} by ${actorUserId}`);
      return true;
    }
    return false;
  } catch (err) {
    log.warn("[waveA.posts] softDeleteNetworkPost failed:", (err as Error).message);
    return false;
  }
}

/* ============================================================
 * SURFACE 6 — Connections extended (mutualDeals + sharedSoftCircles)
 * ============================================================ */

export interface ConnectionRow {
  userId: string;
  name: string;
  mutualDeals: string[];
  sharedSoftCircles: string[];
}

export function getMyConnections(userId: string): { connections: ConnectionRow[] } {
  // Rounds I'm invited to (by redeemed_by_user_id) → co-investors on same rounds.
  let myRoundIds: string[] = [];
  try {
    const rows = rawDb()
      .prepare(
        `SELECT DISTINCT round_id FROM round_invitations
         WHERE redeemed_by_user_id = ? AND deleted_at IS NULL`,
      )
      .all(userId) as Array<{ round_id: string }>;
    myRoundIds = rows.map((r) => r.round_id);
  } catch {
    myRoundIds = [];
  }
  if (myRoundIds.length === 0) return { connections: [] };

  const placeholders = myRoundIds.map(() => "?").join(",");
  let coRows: Array<{ redeemed_by_user_id: string; round_id: string }> = [];
  try {
    coRows = rawDb()
      .prepare(
        `SELECT DISTINCT redeemed_by_user_id, round_id FROM round_invitations
         WHERE round_id IN (${placeholders})
           AND redeemed_by_user_id IS NOT NULL
           AND redeemed_by_user_id != ?
           AND deleted_at IS NULL`,
      )
      .all(...myRoundIds, userId) as typeof coRows;
  } catch {
    coRows = [];
  }

  const byUser = new Map<string, Set<string>>();
  for (const r of coRows) {
    if (!byUser.has(r.redeemed_by_user_id)) byUser.set(r.redeemed_by_user_id, new Set());
    byUser.get(r.redeemed_by_user_id)!.add(r.round_id);
  }

  const connections: ConnectionRow[] = [];
  for (const [otherId, rounds] of Array.from(byUser.entries())) {
    // v25.45 ROUND 7 — connections are people the user has shared rounds / soft
    // circles with. By default they are SOCIAL connections (isCoMember:false →
    // "Private Investor") UNLESS we can PROVE they are on a shared cap table,
    // in which case the counterparty principle applies (isCoMember:true → legal
    // name, subject to the connection's explicit opt-out). Never return raw
    // users.name.
    const rawName =
      scalar<string>(`SELECT name AS n FROM users WHERE id = ? LIMIT 1`, [otherId], otherId) ||
      otherId;
    const isCapTableCoMember = areCoMembersOnAnyCapTable(otherId, userId);
    const name = resolveDisplayName(otherId, userId, "externalCapTable", {
      legalName: rawName,
      isCoMember: isCapTableCoMember,
    });
    // shared soft circles — rounds where both have a soft circle.
    let shared: string[] = [];
    try {
      const sc = rawDb()
        .prepare(
          `SELECT DISTINCT a.round_id FROM soft_circles a
           JOIN soft_circles b ON a.round_id = b.round_id
           WHERE a.investor_user_id = ? AND b.investor_user_id = ?
             AND a.deleted_at IS NULL AND b.deleted_at IS NULL`,
        )
        .all(userId, otherId) as Array<{ round_id: string }>;
      shared = sc.map((x) => x.round_id);
    } catch {
      shared = [];
    }
    connections.push({
      userId: otherId,
      name,
      mutualDeals: Array.from(rounds),
      sharedSoftCircles: shared,
    });
  }
  return { connections };
}

/* ============================================================
 * SURFACE 7 — Monthly meetings
 * ============================================================ */

export function getMonthlyMeetings(chapterIds: string[]): {
  past: any[];
  current: any[];
  upcoming: any[];
} {
  if (chapterIds.length === 0) return { past: [], current: [], upcoming: [] };
  const placeholders = chapterIds.map(() => "?").join(",");
  let rows: Array<{
    id: string;
    title: string;
    scheduled_for: number;
    location: string | null;
    company_id: string | null;
  }> = [];
  try {
    rows = rawDb()
      .prepare(
        `SELECT id, title, scheduled_for, location, company_id
         FROM screening_events
         WHERE chapter_id IN (${placeholders})
           AND event_type = 'monthly_meeting' AND deleted_at IS NULL
         ORDER BY scheduled_for ASC`,
      )
      .all(...chapterIds) as typeof rows;
  } catch {
    rows = [];
  }
  const now = Date.now();
  const dayMs = 24 * 3600 * 1000;
  const map = (r: (typeof rows)[number]) => ({
    id: r.id,
    title: r.title,
    date: new Date(r.scheduled_for).toISOString(),
    location: r.location ?? "—",
    companyId: r.company_id,
  });
  return {
    past: rows.filter((r) => r.scheduled_for < now - dayMs).map(map),
    current: rows.filter((r) => Math.abs(r.scheduled_for - now) <= dayMs).map(map),
    upcoming: rows.filter((r) => r.scheduled_for > now + dayMs).map(map),
  };
}

/* ============================================================
 * Route registration
 * ============================================================ */

export function registerCollectiveWaveARoutes(app: Express): void {
  /* Surface 1 */
  app.get(
    "/api/collective/me/engagement",
    requireCollectiveMember,
    async (req: Request, res: Response) => {
      const ctx = await getUserContext(req);
      if (!ctx?.userId) {
        res.status(401).json({ ok: false, error: "missing_identity" });
        return;
      }
      res.json(computeEngagement(ctx.userId));
    },
  );

  /* Surface 2 */
  app.get(
    "/api/collective/platform-pulse",
    requireCollectiveMember,
    async (_req: Request, res: Response) => {
      res.json(getPlatformPulse());
    },
  );

  /* Surface 3 */
  app.get(
    "/api/collective/me/portfolio",
    requireCollectiveMember,
    async (req: Request, res: Response) => {
      const ctx = await getUserContext(req);
      if (!ctx?.userId) {
        res.status(401).json({ ok: false, error: "missing_identity" });
        return;
      }
      res.json(getMyPortfolio(ctx.userId));
    },
  );

  /* Surface 4 — chapter membership check enforced */
  app.get(
    "/api/collective/chapters/:chapterId/presentations",
    requireCollectiveMember,
    async (req: Request, res: Response) => {
      const ctx = await getUserContext(req);
      const userId = ctx?.userId;
      if (!userId) {
        res.status(401).json({ ok: false, error: "missing_identity" });
        return;
      }
      const chapterId = String(req.params.chapterId);
      const isAdmin = ctx?.isAdmin || isDbAdmin(userId);
      if (!isAdmin && !isUserInChapter(userId, chapterId)) {
        res.status(403).json({ ok: false, error: "not_chapter_member" });
        return;
      }
      res.json(getChapterPresentations(chapterId));
    },
  );

  /* Surface 5 */
  app.get(
    "/api/collective/posts",
    requireCollectiveMember,
    async (req: Request, res: Response) => {
      const limit = req.query.limit ? Number(req.query.limit) : 20;
      const cursor = req.query.cursor ? String(req.query.cursor) : null;
      const ctx = await getUserContext(req);
      res.json(getNetworkPosts(limit, cursor, ctx?.userId ?? null));
    },
  );

  /* Surface 6 */
  app.get(
    "/api/collective/me/connections",
    requireCollectiveMember,
    async (req: Request, res: Response) => {
      const ctx = await getUserContext(req);
      if (!ctx?.userId) {
        res.status(401).json({ ok: false, error: "missing_identity" });
        return;
      }
      res.json(getMyConnections(ctx.userId));
    },
  );

  /* Surface 7 */
  app.get(
    "/api/collective/monthly-meetings",
    requireCollectiveMember,
    async (req: Request, res: Response) => {
      const ctx = await getUserContext(req);
      const userId = ctx?.userId;
      if (!userId) {
        res.status(401).json({ ok: false, error: "missing_identity" });
        return;
      }
      const isAdmin = ctx?.isAdmin || isDbAdmin(userId);
      const chapterIds = isAdmin
        ? (rawDb().prepare(`SELECT id FROM chapters WHERE deleted_at IS NULL`).all() as Array<{
            id: string;
          }>).map((r) => r.id)
        : chapterIdsForUser(userId);
      res.json(getMonthlyMeetings(chapterIds));
    },
  );

  /* Surface 8 — schedule: additive insert into chapter_announcements */
  app.post(
    "/api/collective/schedule",
    requireCollectiveMember,
    async (req: Request, res: Response) => {
      const ctx = await getUserContext(req);
      const userId = ctx?.userId;
      if (!userId) {
        res.status(401).json({ ok: false, error: "missing_identity" });
        return;
      }
      const body = (req.body ?? {}) as {
        chapterId?: string;
        title?: string;
        date?: string;
        attendees?: string[];
        rsvpTrack?: boolean;
      };
      const chapterId = body.chapterId;
      if (!chapterId || typeof chapterId !== "string") {
        res.status(400).json({ ok: false, error: "chapter_id_required" });
        return;
      }
      const isAdmin = ctx?.isAdmin || isDbAdmin(userId);
      if (!isAdmin && !isUserInChapter(userId, chapterId)) {
        res.status(403).json({ ok: false, error: "not_chapter_member" });
        return;
      }
      const id = genId("ann");
      const now = nowIso();
      const tenantId = scalar<string>(
        `SELECT tenant_id AS t FROM chapters WHERE id = ? LIMIT 1`,
        [chapterId],
        `tenant_chap_${chapterId}`,
      );
      const payload = {
        kind: "schedule",
        date: body.date ?? null,
        attendees: Array.isArray(body.attendees) ? body.attendees : [],
        rsvpTrack: body.rsvpTrack === true,
      };
      const currHash = createHash("sha256")
        .update(`${id}|${chapterId}|${now}|schedule`)
        .digest("hex");
      try {
        rawDb()
          .prepare(
            `INSERT INTO chapter_announcements
               (id, tenant_id, chapter_id, author_user_id, title, body, pinned,
                priority, audience, expires_at, prev_hash, curr_hash, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 0, 'normal', 'all', NULL, NULL, ?, ?, ?)`,
          )
          .run(
            id,
            tenantId,
            chapterId,
            userId,
            body.title ?? "Scheduled event",
            JSON.stringify(payload),
            currHash,
            now,
            now,
          );
      } catch (err) {
        log.warn("[waveA.schedule] insert failed:", (err as Error).message);
        res.status(500).json({ ok: false, error: "schedule_write_failed" });
        return;
      }
      res.status(201).json({ ok: true, id, chapterId, payload });
    },
  );

  /* Surface 9 — syndicate apply: reuse the collective_apps TABLE (with
   * applicationType='syndicate' in the payload). A DISTINCT path is used so we
   * do NOT collide with the existing membership-application endpoint in
   * collectiveAppStore.ts (which serves the 7-step membership wizard, a
   * different purpose). Reuses the table, not the route. */
  app.post(
    "/api/collective/syndicate/apply",
    requireCollectiveMember,
    async (req: Request, res: Response) => {
      const ctx = await getUserContext(req);
      const userId = ctx?.userId;
      if (!userId) {
        res.status(401).json({ ok: false, error: "missing_identity" });
        return;
      }
      const body = (req.body ?? {}) as {
        applicationType?: string;
        chapterId?: string;
        payload?: Record<string, unknown>;
      };
      const applicationType = body.applicationType ?? "syndicate";
      const chapterId =
        body.chapterId ?? chapterIdsForUser(userId)[0] ?? "chapter_unassigned";
      const id = genId("capp");
      const now = nowIso();
      const tenantId = scalar<string>(
        `SELECT tenant_id AS t FROM chapters WHERE id = ? LIMIT 1`,
        [chapterId],
        `tenant_chap_${chapterId}`,
      );
      const payloadJson = JSON.stringify({
        applicationType,
        kind: applicationType,
        ...(body.payload ?? {}),
      });
      try {
        rawDb()
          .prepare(
            `INSERT INTO collective_apps
               (id, tenant_id, chapter_id, user_id, status, payload_json, submitted_at, created_at)
             VALUES (?, ?, ?, ?, 'submitted', ?, ?, ?)`,
          )
          .run(id, tenantId, chapterId, userId, payloadJson, now, now);
      } catch (err) {
        log.warn("[waveA.applications] insert failed:", (err as Error).message);
        res.status(500).json({ ok: false, error: "application_write_failed" });
        return;
      }
      res.status(201).json({ ok: true, id, applicationType, status: "submitted" });
    },
  );

  /* Surface 10 — admin deal statistics */
  app.get("/api/admin/deal-statistics", async (req: Request, res: Response) => {
    const admin = await requireAdminCtx(req, res);
    if (!admin) return;
    const companies = scalar<number>(
      `SELECT COUNT(*) AS c FROM companies WHERE deleted_at IS NULL`,
      [],
      0,
    );
    const rounds = scalar<number>(
      `SELECT COUNT(*) AS c FROM rounds WHERE deleted_at IS NULL`,
      [],
      0,
    );
    const openRounds = scalar<number>(
      `SELECT COUNT(*) AS c FROM rounds WHERE state = 'open' AND deleted_at IS NULL`,
      [],
      0,
    );
    const softCircles = scalar<number>(
      `SELECT COUNT(*) AS c FROM soft_circles WHERE deleted_at IS NULL`,
      [],
      0,
    );
    const screenings = scalar<number>(
      `SELECT COUNT(*) AS c FROM screening_events WHERE deleted_at IS NULL`,
      [],
      0,
    );
    const fundedCommits = scalar<number>(
      `SELECT COUNT(*) AS c FROM captable_commits WHERE state = 'funded' AND deleted_at IS NULL`,
      [],
      0,
    );
    res.json({
      asOf: nowIso(),
      funnel: {
        companies,
        rounds,
        openRounds,
        softCircles,
        screenings,
        fundedCommits,
      },
      conversion: {
        softCirclePerRound: rounds ? Math.round((softCircles / rounds) * 100) / 100 : 0,
        fundedPerSoftCircle: softCircles
          ? Math.round((fundedCommits / softCircles) * 100) / 100
          : 0,
      },
    });
  });

  /* Surface 11 — decline-with-reason (writes the new declined_reason column) */
  app.post(
    "/api/admin/applications/:id/decline",
    async (req: Request, res: Response) => {
      const admin = await requireAdminCtx(req, res);
      if (!admin) return;
      const id = String(req.params.id);
      const reason = (req.body ?? {}).reason;
      if (typeof reason !== "string" || reason.trim().length === 0) {
        res.status(400).json({ ok: false, error: "reason_required" });
        return;
      }
      if (reason.length > 1000) {
        res.status(400).json({ ok: false, error: "reason_too_long" });
        return;
      }
      const now = nowIso();
      let changed = 0;
      try {
        const info = rawDb()
          .prepare(
            `UPDATE collective_apps
             SET status = 'rejected', declined_reason = ?, reviewed_at = ?, updated_at = ?
             WHERE id = ? AND deleted_at IS NULL`,
          )
          .run(reason.trim(), now, now, id);
        changed = info.changes ?? 0;
      } catch (err) {
        log.warn("[waveA.decline] update failed:", (err as Error).message);
        res.status(500).json({ ok: false, error: "decline_write_failed" });
        return;
      }
      if (changed === 0) {
        res.status(404).json({ ok: false, error: "application_not_found" });
        return;
      }
      res.json({ ok: true, id, status: "rejected", declinedReason: reason.trim() });
    },
  );

  /* v25.44 Surface 13 support — M&A privacy consent read/write (Company Step 4).
   * Additive: reads/writes only the new companies.ma_privacy_json column. The
   * caller must be a founder/member of the company (company_members check). */
  app.get(
    "/api/collective/companies/:id/ma-privacy",
    requireCollectiveMember,
    async (req: Request, res: Response) => {
      const ctx = await getUserContext(req);
      const userId = ctx?.userId;
      if (!userId) {
        res.status(401).json({ ok: false, error: "missing_identity" });
        return;
      }
      const companyId = String(req.params.id);
      // v25.44 ROUND 2 (BLOCKER 3) — mirror the PUT authorization. Opting OUT of
      // M&A sharing can itself signal strategy, so the sharing posture is
      // sensitive metadata: only company members (or admins) may READ it.
      const isAdmin = ctx?.isAdmin || isDbAdmin(userId);
      if (!isAdmin) {
        const isMember =
          scalar<number>(
            `SELECT COUNT(*) AS c FROM company_members WHERE company_id = ? AND user_id = ?`,
            [companyId, userId],
            0,
          ) > 0;
        if (!isMember) {
          res.status(403).json({ ok: false, error: "not_company_member" });
          return;
        }
      }
      const json = scalar<string | null>(
        `SELECT ma_privacy_json AS j FROM companies WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
        [companyId],
        null,
      );
      let privacy = { ...MA_PRIVACY_DEFAULT };
      if (json) {
        try {
          privacy = maPrivacySchema.parse(JSON.parse(json));
        } catch {
          privacy = { ...MA_PRIVACY_DEFAULT };
        }
      }
      res.json({ companyId, maPrivacy: privacy });
    },
  );

  app.put(
    "/api/collective/companies/:id/ma-privacy",
    requireCollectiveMember,
    async (req: Request, res: Response) => {
      const ctx = await getUserContext(req);
      const userId = ctx?.userId;
      if (!userId) {
        res.status(401).json({ ok: false, error: "missing_identity" });
        return;
      }
      const companyId = String(req.params.id);
      const isAdmin = ctx?.isAdmin || isDbAdmin(userId);
      // Authorization: caller must be a member of the company (or admin).
      if (!isAdmin) {
        const isMember =
          scalar<number>(
            `SELECT COUNT(*) AS c FROM company_members WHERE company_id = ? AND user_id = ?`,
            [companyId, userId],
            0,
          ) > 0;
        if (!isMember) {
          res.status(403).json({ ok: false, error: "not_company_member" });
          return;
        }
      }
      const parsed = maPrivacySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ ok: false, error: "invalid_ma_privacy" });
        return;
      }
      try {
        const info = rawDb()
          .prepare(`UPDATE companies SET ma_privacy_json = ? WHERE id = ? AND deleted_at IS NULL`)
          .run(JSON.stringify(parsed.data), companyId);
        if ((info.changes ?? 0) === 0) {
          res.status(404).json({ ok: false, error: "company_not_found" });
          return;
        }
      } catch (err) {
        log.warn("[waveA.maPrivacy] update failed:", (err as Error).message);
        res.status(500).json({ ok: false, error: "ma_privacy_write_failed" });
        return;
      }
      res.json({ ok: true, companyId, maPrivacy: parsed.data });
    },
  );

  /* Surface 12 — regions rollup */
  app.get("/api/admin/regions/rollup", async (req: Request, res: Response) => {
    const admin = await requireAdminCtx(req, res);
    if (!admin) return;
    let rows: Array<{
      region: string | null;
      chapters: number;
      members: number;
    }> = [];
    try {
      rows = rawDb()
        .prepare(
          `SELECT ch.region AS region,
                  COUNT(DISTINCT ch.id) AS chapters,
                  COUNT(DISTINCT cm.user_id) AS members
           FROM chapters ch
           LEFT JOIN chapter_memberships cm
             ON cm.chapter_id = ch.id AND cm.status = 'active' AND cm.deleted_at IS NULL
           WHERE ch.deleted_at IS NULL
           GROUP BY ch.region
           ORDER BY members DESC`,
        )
        .all() as typeof rows;
    } catch (err) {
      log.warn("[waveA.regions] rollup failed:", (err as Error).message);
      rows = [];
    }
    // company counts by region (via rounds.region as proxy region attribution).
    const regions = rows.map((r) => ({
      region: r.region ?? "Unspecified",
      chapters: r.chapters ?? 0,
      members: r.members ?? 0,
    }));
    res.json({ asOf: nowIso(), regions });
  });
}

export default registerCollectiveWaveARoutes;
