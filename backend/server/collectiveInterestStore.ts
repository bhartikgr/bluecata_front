/**
 * v25.0 Track 2 — Collective B Endpoints
 *
 * B1: POST /api/collective/companies/:companyId/interest
 *      Collective member expresses interest in a founder's company.
 *      Creates a conversation/thread record and notifies the founder.
 *      Idempotent: same member + company → returns existing threadId.
 *
 * B2: GET /api/collective/portfolio
 *      Admin-only aggregate of ALL collective-channel soft-circles.
 *      Grouped by founder + member. Live DB query, no cache.
 *
 * B3: Founder directory auto-enrollment on approval.
 *      Adds INSERT into collective_directory_listings on founder application
 *      approval (hooked via registerCollectiveDirectoryHook).
 *      GET /api/collective/companies now JOINs against this table.
 *
 * B4: GET /api/collective/network (graph payload)
 *      Replaces stub data with live graph: nodes (founders, members)
 *      + edges (committed soft-circles, memberships).
 *
 * Sacred-file rules: does NOT touch packages/cap-table-engine/**,
 * RoundNew.tsx STEPS, or shared/schema.ts.
 */

import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { rawDb } from "./db/connection";
import { emitNotification } from "./notificationsStore";
import { emitBridgeEvent } from "./bridgeStore";
import { requireCollectiveMember } from "./lib/requireCollectiveMember";
import { requireAdmin } from "./lib/authMiddleware";
import { listForCollective as listSoftCirclesForCollective } from "./softCircleStore";
import { listActive as listActiveMembers } from "./collectiveMembershipStore";
import { getAllProfiles } from "./companyProfileStore";
import { getCompaniesForFounder } from "./multiCompanyStore";
import { log } from "./lib/logger";

/* ============================================================
 * B1 — collective_interest_threads helpers
 * ============================================================ */

export interface InterestThread {
  id: string;
  companyId: string;
  collectiveMemberUserId: string;
  initialMessage: string | null;
  status: string;
  createdAt: string;
  lastMessageAt: string;
}

/** Returns the existing thread for this member+company, or null. */
function findExistingThread(
  companyId: string,
  memberId: string,
): InterestThread | null {
  try {
    const db: any = rawDb();
    const rows = db
      .prepare(
        `SELECT id, company_id, collective_member_user_id, initial_message,
                status, created_at, last_message_at
           FROM collective_interest_threads
          WHERE company_id = ? AND collective_member_user_id = ?
            AND status != 'closed'
          LIMIT 1`,
      )
      .all(companyId, memberId) as any[];
    if (!rows.length) return null;
    const r = rows[0];
    return {
      id: r.id,
      companyId: r.company_id,
      collectiveMemberUserId: r.collective_member_user_id,
      initialMessage: r.initial_message ?? null,
      status: r.status,
      createdAt: r.created_at,
      lastMessageAt: r.last_message_at,
    };
  } catch {
    return null;
  }
}

function createInterestThread(
  companyId: string,
  memberId: string,
  initialMessage: string | null,
): InterestThread {
  const id = `cit_${randomBytes(8).toString("hex")}`;
  const now = new Date().toISOString();
  const row: InterestThread = {
    id,
    companyId,
    collectiveMemberUserId: memberId,
    initialMessage: initialMessage ?? null,
    status: "open",
    createdAt: now,
    lastMessageAt: now,
  };
  /* v25.22 Lane A2 NH-002 fix — fail closed on DB write failure. The prior
   * implementation logged "DB write failed (in-memory only)" and returned
   * the in-memory row as success, violating the standing-rule "NO MEMORY
   * STORAGE; ALL TIED DIRECTLY TO THE DATABASE" and producing a phantom
   * thread that the recipient could never reply to. We now throw so the
   * caller surfaces 500 to the client and the user can retry. */
  try {
    const db: any = rawDb();
    db.prepare(
      `INSERT INTO collective_interest_threads
         (id, company_id, collective_member_user_id, initial_message,
          status, created_at, last_message_at)
       VALUES (?, ?, ?, ?, 'open', ?, ?)`,
    ).run(id, companyId, memberId, initialMessage ?? null, now, now);
  } catch (err) {
    log.error({
      route: "collectiveInterest.create",
      errorType: "DB_WRITE_FAILED",
      message: (err as Error).message,
      companyId,
      memberId,
    });
    throw new Error("INTEREST_THREAD_PERSIST_FAILED");
  }
  return row;
}

/**
 * Look up the founder userId for a company.
 * Strategy: check raw DB company_members first (real users), then fall through
 * to the in-memory USER_COMPANIES map (demo personas like u_maya_chen).
 */
function founderUserIdForCompanySafe(companyId: string): string | null {
  // 1. Try raw DB (works for real registered founders)
  try {
    const db: any = rawDb();
    const rows = db
      .prepare(
        `SELECT user_id FROM company_members
          WHERE company_id = ? AND role IN ('founder','co_founder')
          LIMIT 1`,
      )
      .all(companyId) as any[];
    if (rows[0]?.user_id) return rows[0].user_id;
  } catch { /* fall through */ }
  // 2. Fall through to the in-memory USER_COMPANIES map (demo personas)
  // getCompaniesForFounder(undefined) returns all companies; we search by companyId.
  // We iterate over known demo persona IDs to find ownership.
  const DEMO_PERSONAS = ["u_maya_chen", "u_aisha_patel", "u_raj_patel", "u_founder_demo"];
  for (const uid of DEMO_PERSONAS) {
    try {
      const companies = getCompaniesForFounder(uid);
      if (companies.some((c) => c.companyId === companyId)) return uid;
    } catch { /* non-fatal */ }
  }
  return null;
}

/* ============================================================
 * B3 — collective_directory_listings helpers
 * ============================================================ */

export interface DirectoryListing {
  id: string;
  companyId: string;
  applicationId: string;
  chapter: string | null;
  stage: string | null;
  sector: string | null;
  listedAt: string;
  status: string;
}

/** Called after admin approves a founder application. Idempotent. */
export function upsertDirectoryListing(
  companyId: string,
  applicationId: string,
  opts?: { chapter?: string | null; stage?: string | null; sector?: string | null },
): void {
  try {
    const db: any = rawDb();
    const now = new Date().toISOString();
    // Check if listing already exists
    const existing = db
      .prepare(
        `SELECT id FROM collective_directory_listings WHERE company_id = ? LIMIT 1`,
      )
      .get(companyId) as any;
    if (existing) {
      // Update to ensure status is listed
      db.prepare(
        `UPDATE collective_directory_listings
            SET status = 'listed', application_id = ?, chapter = ?, stage = ?, sector = ?
          WHERE company_id = ?`,
      ).run(
        applicationId,
        opts?.chapter ?? null,
        opts?.stage ?? null,
        opts?.sector ?? null,
        companyId,
      );
      return;
    }
    const id = `cdl_${randomBytes(8).toString("hex")}`;
    db.prepare(
      `INSERT INTO collective_directory_listings
         (id, company_id, application_id, chapter, stage, sector, listed_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'listed')`,
    ).run(
      id,
      companyId,
      applicationId,
      opts?.chapter ?? null,
      opts?.stage ?? null,
      opts?.sector ?? null,
      now,
    );
    log.info(`[directoryListings] Enrolled company ${companyId} (app ${applicationId})`);
  } catch (err) {
    // v25.40 FIX-16 (collective P2 #3) + round-2 (per GPT-5.5): elevate visibility.
    // The store now logs at ERROR (was WARN) and re-throws so the swallow is
    // visible at the caller layer rather than hidden inside the store.
    //
    // CALLER INTENT PRESERVED: both call sites (Avi-authored in
    // adminCollectiveRoutes.ts:383 approve, :525 reject, both marked
    // "// v25.0 Track 2 B3 —") deliberately wrap this in their own
    // `try { } catch { /* non-fatal */ }` to keep approval/rejection unblocked if
    // the directory write fails. Per Ozan's standing rule on Avi code, that
    // caller-level non-fatal pattern is INTENTIONAL and untouched here. The
    // round-2 change is logging visibility only: the error is now ERROR-level
    // and structured (was inline WARN with no stack), so a directory-listing
    // failure is now observable in the LIVE logs.
    log.error("[directoryListings.upsert] DB write failed:", (err as Error).message);
    throw err;
  }
}

/** Called when admin REJECTS a founder application. Removes listing. */
export function removeDirectoryListing(companyId: string): void {
  try {
    const db: any = rawDb();
    db.prepare(
      `UPDATE collective_directory_listings SET status = 'removed' WHERE company_id = ?`,
    ).run(companyId);
    log.info(`[directoryListings] Removed company ${companyId} from directory`);
  } catch (err) {
    // v25.40 FIX-16 (collective P2 #3) + round-2 (per GPT-5.5): elevate visibility.
    // See upsert comment above — caller-level non-fatal pattern (Avi-authored)
    // is INTENTIONALLY preserved; this just upgrades the log to ERROR-level so
    // a removal failure is observable in LIVE logs.
    log.error("[directoryListings.remove] DB write failed:", (err as Error).message);
    throw err;
  }
}

/** Returns a Set of companyIds currently listed in the directory. */
export function getListedCompanyIds(): Set<string> {
  const out = new Set<string>();
  try {
    const db: any = rawDb();
    const rows = db
      .prepare(
        `SELECT company_id FROM collective_directory_listings WHERE status = 'listed'`,
      )
      .all() as any[];
    for (const r of rows) {
      if (r.company_id) out.add(r.company_id);
    }
  } catch {
    // Non-fatal — fall through with empty set
  }
  return out;
}

/**
 * v25.22 NC-6 fix — chapter-scoped listed company ids. The legacy
 * `getListedCompanyIds()` returns every chapter's listings, which allowed
 * a member of `chap_keiretsu_canada` to see `chap_keiretsu_us` companies on
 * `/api/collective/{companies,dealroom/companies}`. This variant restricts
 * to the chapters the caller actually belongs to. An empty input list
 * returns an empty Set (fail closed). The directory row's `chapter`
 * column is the source of truth.
 */
export function getListedCompanyIdsForChapters(chapterIds: string[]): Set<string> {
  const out = new Set<string>();
  if (!chapterIds || chapterIds.length === 0) return out;
  try {
    const db: any = rawDb();
    const placeholders = chapterIds.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT company_id FROM collective_directory_listings
          WHERE status = 'listed' AND chapter IN (${placeholders})`,
      )
      .all(...chapterIds) as any[];
    for (const r of rows) {
      if (r.company_id) out.add(r.company_id);
    }
  } catch {
    // Non-fatal — fall through with empty set
  }
  return out;
}

/**
 * v25.22 NC-6 fix — verify a specific company is listed in at least one
 * of the caller's chapters. Used by `/api/collective/companies/:id` to
 * short-circuit cross-chapter reads with a 404.
 */
export function isCompanyListedInAnyChapter(
  companyId: string,
  chapterIds: string[],
): boolean {
  if (!companyId || !chapterIds || chapterIds.length === 0) return false;
  try {
    const db: any = rawDb();
    const placeholders = chapterIds.map(() => "?").join(",");
    const row = db
      .prepare(
        `SELECT 1 AS hit FROM collective_directory_listings
          WHERE status = 'listed' AND company_id = ? AND chapter IN (${placeholders})
          LIMIT 1`,
      )
      .get(companyId, ...chapterIds);
    return !!row;
  } catch {
    return false;
  }
}

/* ============================================================
 * B4 — Network graph helpers
 * ============================================================ */

interface NetworkNode {
  id: string;
  type: "founder" | "member";
  label: string;
}

interface NetworkEdge {
  from: string;
  to: string;
  kind: "committed" | "member_of";
}

/* ============================================================
 * Route registration
 * ============================================================ */

export function registerCollectiveInterestRoutes(app: Express): void {
  /* -----------------------------------------------------------------
   * B1 — POST /api/collective/companies/:companyId/interest
   * Collective member expresses interest in a company.
   * Idempotent: same member + company → existing thread id.
   * ----------------------------------------------------------------- */
  app.post(
    "/api/collective/companies/:companyId/interest",
    requireCollectiveMember,
    (req: Request, res: Response) => {
      const ctx = (req as any).userContext as
        | { userId?: string; isAuthed?: boolean; isAdmin?: boolean }
        | undefined;
      if (!ctx?.isAuthed || !ctx?.userId) {
        return res.status(401).json({ error: "unauthorized" });
      }
      const memberId = ctx.userId;
      const companyId = String(req.params.companyId);
      const message: string | null =
        typeof req.body?.message === "string" ? req.body.message.trim() : null;

      // Idempotency: return existing thread if already open
      const existing = findExistingThread(companyId, memberId);
      if (existing) {
        return res.json({
          ok: true,
          threadId: existing.id,
          existing: true,
          thread: existing,
        });
      }

      // Create new thread — fail closed on DB write failure (v25.22 NH-002 fix).
      let thread;
      try {
        thread = createInterestThread(companyId, memberId, message);
      } catch (err) {
        return res.status(500).json({
          ok: false,
          error: "INTEREST_THREAD_PERSIST_FAILED",
          message: "Could not record your interest right now. Please try again.",
        });
      }

      // Emit bridge event so founder side picks it up
      try {
        emitBridgeEvent({
          eventType: "collective.interest.created",
          aggregateId: thread.id,
          aggregateKind: "platform",
          payload: {
            threadId: thread.id,
            companyId,
            collectiveMemberUserId: memberId,
            initialMessage: message,
          },
        });
      } catch { /* non-fatal */ }

      // Notify the founder
      try {
        const founderUserId = founderUserIdForCompanySafe(companyId);
        if (founderUserId) {
          emitNotification({
            userId: founderUserId,
            kind: "crm.intro_request",
            title: "A Collective member is interested in your company",
            body: message
              ? `New interest message: "${message.slice(0, 120)}"`
              : "A Collective member expressed interest in your company via the directory.",
            link: `/founder/collective/interest/${thread.id}`,
          });
        }
      } catch { /* non-fatal */ }

      return res.status(201).json({
        ok: true,
        threadId: thread.id,
        existing: false,
        thread,
      });
    },
  );

  /* -----------------------------------------------------------------
   * B2 — GET /api/collective/portfolio
   * Admin-only aggregate of all collective-channel soft-circles.
   * Pure live query — no new table.
   * ----------------------------------------------------------------- */
  app.get(
    "/api/collective/portfolio",
    requireAdmin,
    (_req: Request, res: Response) => {
      // Pull ALL soft circles (collective-visible)
      const circles = listSoftCirclesForCollective();

      // Aggregate by companyId
      type CompanyStat = {
        companyId: string | null;
        totalCommitted: number;
        memberCount: number;
        circles: typeof circles;
      };
      const byCompany = new Map<string, CompanyStat>();
      const byMember = new Map<string, { memberId: string; totalCommitted: number; count: number }>();

      for (const sc of circles) {
        const cid = sc.companyId ?? "unknown";
        const existing = byCompany.get(cid);
        if (existing) {
          existing.totalCommitted += sc.amount;
          existing.circles.push(sc);
        } else {
          byCompany.set(cid, {
            companyId: sc.companyId,
            totalCommitted: sc.amount,
            memberCount: 0,
            circles: [sc],
          });
        }
        // member aggregation uses investorName as surrogate (investorUserId may be null)
        const mid = sc.investorName;
        const em = byMember.get(mid);
        if (em) {
          em.totalCommitted += sc.amount;
          em.count++;
        } else {
          byMember.set(mid, { memberId: mid, totalCommitted: sc.amount, count: 1 });
        }
      }

      // Compute unique member counts per company
      Array.from(byCompany.entries()).forEach(([cid, stat]: [string, CompanyStat]) => {
        const uniqueMembers = new Set(stat.circles.map((c) => c.investorName));
        stat.memberCount = uniqueMembers.size;
        byCompany.set(cid, stat);
      });

      // Top performers (members by total committed, desc)
      const topPerformers = Array.from(byMember.values())
        .sort((a, b) => b.totalCommitted - a.totalCommitted)
        .slice(0, 10);

      // Top founders (by total collective coverage, desc)
      const topFounders = Array.from(byCompany.values())
        .sort((a, b) => b.totalCommitted - a.totalCommitted)
        .slice(0, 10)
        .map((s) => ({
          companyId: s.companyId,
          totalCommitted: s.totalCommitted,
          uniqueMemberCount: s.memberCount,
        }));

      const totalCommitted = circles.reduce((sum, c) => sum + c.amount, 0);
      const uniqueMembers = new Set(circles.map((c) => c.investorName)).size;
      const uniqueFounders = new Set(
        circles.map((c) => c.companyId).filter(Boolean),
      ).size;

      return res.json({
        summary: {
          totalCommitted,
          uniqueMembers,
          uniqueFounders,
          totalCircles: circles.length,
        },
        byFounder: Array.from(byCompany.values()).map((s) => ({
          companyId: s.companyId,
          totalCommitted: s.totalCommitted,
          uniqueMemberCount: s.memberCount,
        })),
        byMember: Array.from(byMember.values()),
        topPerformers,
        topFounders,
      });
    },
  );

  /* -----------------------------------------------------------------
   * B4 — GET /api/collective/network (graph payload)
   *
   * v25.0 Fix: Returns a graph with all current members and founder
   * companies as nodes, soft-circle commits as edges.
   * Even with no commits, all members + founders appear as nodes.
   * ----------------------------------------------------------------- */
  app.get(
    "/api/collective/network",
    requireCollectiveMember,
    (_req: Request, res: Response) => {
      const nodes: NetworkNode[] = [];
      const edges: NetworkEdge[] = [];
      const seenNodes = new Set<string>();

      function addNode(id: string, type: "founder" | "member", label: string) {
        if (!seenNodes.has(id)) {
          nodes.push({ id, type, label });
          seenNodes.add(id);
        }
      }

      // Add all active collective members as nodes
      const activeMembers = listActiveMembers();
      for (const m of activeMembers) {
        addNode(m.userId, "member", m.userId);
        // member_of edge: member → collective
        edges.push({ from: m.userId, to: "collective", kind: "member_of" });
      }

      // v25.13 NM8 — only include companies that are directory-listed.
      // Previously this used the unfiltered getAllProfiles() which leaked
      // unapproved / rejected founder companies into the public network
      // graph, letting investors discover them ahead of approval.
      const listedIds = getListedCompanyIds();
      const allProfiles = getAllProfiles().filter((p) => listedIds.has(p.companyId));
      for (const p of allProfiles) {
        addNode(p.companyId, "founder", p.founderName ?? p.companyId);
      }

      // Add collective-visible soft-circle edges (committed)
      const circles = listSoftCirclesForCollective();
      for (const sc of circles) {
        if (!sc.companyId) continue;
        // Ensure the company is a node
        addNode(sc.companyId, "founder", sc.companyId);
        // Use investorName as member node id if no userId
        const memberId = sc.investorName;
        addNode(memberId, "member", sc.investorName);
        edges.push({ from: memberId, to: sc.companyId, kind: "committed" });
      }

      return res.json({ nodes, edges });
    },
  );
}
