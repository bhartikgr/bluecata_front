/**
 * v25.46 — Consolidated route registrar for the 6-track release.
 *
 * Mounts the net-new endpoints for:
 *   Track 1 — Messages Inbox      : GET /api/messages/can-dm/:recipientId
 *                                   GET /api/messages/recipients
 *   Track 2 — Network Posts       : GET /api/network/posts (role-enriched)
 *                                   DELETE /api/posts/:id (self-moderate)
 *   Track 3 — Live Capital Pulse  : registerPulseRoutes(app) (SSE + recent)
 *   Track 5 — Markets + Press     : GET /api/markets/quote (60s cache)
 *                                   GET /api/network/press (member read)
 *                                   GET/POST/PUT/DELETE /api/admin/press (admin CRUD)
 *
 * SACRED rules honoured:
 *   - Tier 6: every endpoint here is a REAL Express route, tested with supertest.
 *   - Tier 3 #27: 100% DB-driven; the only in-process state is a 60s read-through
 *     cache (read-accelerator only; the DB / provider remains canonical and the
 *     cache survives nothing across restart).
 *   - Tier 2: does NOT touch AVI files (sseHub.ts untouched; pulse SSE is
 *     self-contained in pulseStream.ts).
 *   - Fail-closed auth via the canonical requireAuth / requireAdmin middleware.
 */
import type { Express, Request, Response } from "express";
import { requireAuth, requireAdmin } from "./lib/authMiddleware";
import { getUserContext } from "./lib/userContext";
import { canDM, resolveDmRole } from "./messagingPolicy";
import { getNetworkPosts, getNetworkPostById, softDeleteNetworkPost } from "./collectiveWaveAStore";
import { registerPulseRoutes } from "./pulseStream";
import { getVentureMarkets, type VentureMarketRecord } from "./ventureMarketsStore";
import {
  listPressItems,
  getPressItem,
  createPressItem,
  updatePressItem,
  deletePressItem,
} from "./pressStore";
import { resolveDisplayName } from "./lib/userPrivacyResolver";
import { rawDb } from "./db/connection";
import { log } from "./lib/logger";

/* ────────────────────────────────────────────────────────────────────────── *
 * Track 5 — Markets quote 60s read-through cache.
 * ────────────────────────────────────────────────────────────────────────── */
const MARKETS_CACHE_TTL_MS = 60_000;
let _marketsCache: { records: VentureMarketRecord[]; asOfDate: string; at: number } | null = null;

function getCachedMarkets(): { records: VentureMarketRecord[]; asOfDate: string } {
  const now = Date.now();
  if (_marketsCache && now - _marketsCache.at < MARKETS_CACHE_TTL_MS) {
    return { records: _marketsCache.records, asOfDate: _marketsCache.asOfDate };
  }
  const resp = getVentureMarkets();
  _marketsCache = { records: resp.records, asOfDate: resp.asOfDate, at: now };
  return { records: resp.records, asOfDate: resp.asOfDate };
}

/** Test-only hook to clear the markets cache between assertions. */
export function _invalidateMarketsCache(): void {
  _marketsCache = null;
}

/* ────────────────────────────────────────────────────────────────────────── *
 * Registrar.
 * ────────────────────────────────────────────────────────────────────────── */
export function registerV2546Routes(app: Express): void {
  // ───────────────────────────── Track 1 — Messages ─────────────────────────
  // GET /api/messages/can-dm/:recipientId — the LOCKED permission verdict for
  // the authenticated viewer → recipient, plus the privacy mode the inbox
  // should render under. Pure read of messagingPolicy (single source of truth).
  app.get(
    "/api/messages/can-dm/:recipientId",
    requireAuth,
    (req: Request, res: Response) => {
      const ctx = getUserContext(req);
      if (!ctx?.userId) {
        res.status(401).json({ error: "unauthenticated" });
        return;
      }
      const recipientId = String(req.params.recipientId ?? "");
      const verdict = canDM(ctx.userId, recipientId);
      res.json({
        recipientId,
        allowed: verdict.allowed,
        reason: verdict.reason ?? null,
        privacyMode: verdict.privacyMode,
        viewerRole: resolveDmRole(ctx.userId),
        recipientRole: resolveDmRole(recipientId),
      });
    },
  );

  // GET /api/messages/recipients — the set of users the viewer is permitted to
  // DM, each tagged with a role badge + the privacy mode + the display name the
  // inbox should show (MAE-resolved through the canonical privacy resolver).
  app.get(
    "/api/messages/recipients",
    requireAuth,
    (req: Request, res: Response) => {
      const ctx = getUserContext(req);
      if (!ctx?.userId) {
        res.status(401).json({ error: "unauthenticated" });
        return;
      }
      const viewerId = ctx.userId;
      const candidates = listDmCandidates(viewerId);
      const recipients = candidates
        .map((c) => {
          const verdict = canDM(viewerId, c.userId);
          if (!verdict.allowed) return null;
          const role = resolveDmRole(c.userId);
          // W3 #9 (spec §7.4 Bypass P6) — pass the PROVEN co-member flag from the
          // canDM verdict instead of leaving isCoMember at its fail-private
          // default. 'real' (known counterparty, e.g. founder<->founder /
          // partner conversations) and 'unblocked-by-cap-table' (investor<->
          // investor sharing a cap table) both unambiguously mean the viewer
          // has a proven shared-cap-table/counterparty relationship with this
          // recipient. 'alias' does NOT prove that relationship, so it must NOT
          // set isCoMember — an explicit opt-out on the subject's side still
          // wins either way inside the resolver.
          const isCoMember =
            verdict.privacyMode === "real" || verdict.privacyMode === "unblocked-by-cap-table";
          const displayName = resolveDisplayName(
            c.userId,
            viewerId,
            "message",
            { legalName: c.legalName ?? c.userId, isCoMember },
          );
          return {
            userId: c.userId,
            displayName,
            role,
            privacyMode: verdict.privacyMode,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      res.json({ recipients });
    },
  );

  // ───────────────────────────── Track 2 — Network Posts ────────────────────
  // GET /api/network/posts — the role-enriched network feed. Wraps the existing
  // collective network_posts store (getNetworkPosts) and attaches a role badge
  // for each author (resolved via messagingPolicy.resolveDmRole). Does NOT
  // duplicate the post body / MAE name resolution already done by the store.
  app.get(
    "/api/network/posts",
    requireAuth,
    (req: Request, res: Response) => {
      const ctx = getUserContext(req);
      if (!ctx?.userId) {
        res.status(401).json({ error: "unauthenticated" });
        return;
      }
      const limit = clampLimit(req.query.limit);
      const cursor = typeof req.query.cursor === "string" ? req.query.cursor : null;
      const page = getNetworkPosts(limit, cursor, ctx.userId);
      const items = (page.posts ?? []).map((p: any) => ({
        ...p,
        authorRole: p.authorUserId ? resolveDmRole(p.authorUserId) : "unknown",
        canDelete: p.authorUserId === ctx.userId || ctx.isAdmin === true,
      }));
      res.json({ items, nextCursor: page.nextCursor ?? null });
    },
  );

  // DELETE /api/posts/:id — self-moderation. The author (or an admin) may
  // soft-delete their own network post. Fail-closed: anyone else → 403.
  // Soft-delete only (Tier 3 #28/#29 — never destructive).
  app.delete(
    "/api/posts/:id",
    requireAuth,
    (req: Request, res: Response) => {
      const ctx = getUserContext(req);
      if (!ctx?.userId) {
        res.status(401).json({ error: "unauthenticated" });
        return;
      }
      const id = String(req.params.id ?? "");
      const post = getNetworkPostById(id);
      if (!post) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const isOwner = post.authorUserId === ctx.userId;
      const isAdmin = ctx.isAdmin === true;
      if (!isOwner && !isAdmin) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      const ok = softDeleteNetworkPost(id, ctx.userId);
      if (!ok) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json({ ok: true, id });
    },
  );

  // ───────────────────────────── Track 3 — Live Capital Pulse ───────────────
  // Self-contained SSE + recent endpoints (does not touch AVI sseHub.ts).
  registerPulseRoutes(app);

  // ───────────────────────────── Track 5 — Markets quote ────────────────────
  // GET /api/markets/quote — 60s-cached venture-markets quote feed. Optional
  // ?symbol= filter returns a single record. Member-or-admin read.
  app.get(
    "/api/markets/quote",
    requireAuth,
    (req: Request, res: Response) => {
      const { records, asOfDate } = getCachedMarkets();
      const symbol = typeof req.query.symbol === "string" ? req.query.symbol.trim() : "";
      if (symbol) {
        const match = records.find(
          (r) => r.exchangeSymbol.toLowerCase() === symbol.toLowerCase(),
        );
        if (!match) {
          res.status(404).json({ error: "symbol_not_found", symbol });
          return;
        }
        res.json({ asOfDate, quote: match, cached: true });
        return;
      }
      res.json({ asOfDate, quotes: records, count: records.length, cached: true });
    },
  );

  // ───────────────────────────── Track 5 — Press feed ───────────────────────
  // GET /api/network/press — member-visible editorial press listing.
  app.get(
    "/api/network/press",
    requireAuth,
    (_req: Request, res: Response) => {
      res.json({ items: listPressItems() });
    },
  );

  // Admin press CRUD at /api/admin/press[/:id].
  app.get(
    "/api/admin/press",
    requireAdmin,
    (_req: Request, res: Response) => {
      res.json({ items: listPressItems() });
    },
  );

  app.post(
    "/api/admin/press",
    requireAdmin,
    (req: Request, res: Response) => {
      const ctx = getUserContext(req);
      const { title, source, url, publishedAt, editorialNote } = req.body ?? {};
      if (!isNonEmpty(title) || !isNonEmpty(source) || !isNonEmpty(url)) {
        res.status(400).json({ error: "title, source and url are required" });
        return;
      }
      const item = createPressItem({
        title: String(title),
        source: String(source),
        url: String(url),
        publishedAt: typeof publishedAt === "string" ? publishedAt : null,
        editorialNote: typeof editorialNote === "string" ? editorialNote : null,
        createdByUserId: ctx?.userId ?? null,
      });
      res.status(201).json({ item });
    },
  );

  app.put(
    "/api/admin/press/:id",
    requireAdmin,
    (req: Request, res: Response) => {
      const id = String(req.params.id ?? "");
      const { title, source, url, publishedAt, editorialNote } = req.body ?? {};
      const patch: Record<string, unknown> = {};
      if (title !== undefined) patch.title = String(title);
      if (source !== undefined) patch.source = String(source);
      if (url !== undefined) patch.url = String(url);
      if (publishedAt !== undefined) patch.publishedAt = publishedAt === null ? null : String(publishedAt);
      if (editorialNote !== undefined) patch.editorialNote = editorialNote === null ? null : String(editorialNote);
      const updated = updatePressItem(id, patch as any);
      if (!updated) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json({ item: updated });
    },
  );

  app.delete(
    "/api/admin/press/:id",
    requireAdmin,
    (req: Request, res: Response) => {
      const id = String(req.params.id ?? "");
      const ok = deletePressItem(id);
      if (!ok) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json({ ok: true, id });
    },
  );

  log.info("[v25.46] registered 6-track routes (messages, network posts, pulse, markets, press)");
}

/* ────────────────────────────────────────────────────────────────────────── *
 * Helpers.
 * ────────────────────────────────────────────────────────────────────────── */
function isNonEmpty(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

function clampLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 20;
  return Math.min(Math.floor(n), 100);
}

interface DmCandidate {
  userId: string;
  legalName?: string;
}

/**
 * W-AVI64 FIX 2 — RELATIONSHIP-SCOPED DM candidate enumeration.
 *
 * Root cause of "No eligible contacts" from the investor side: this function
 * used to return a flat `SELECT id,email,name FROM auth_users LIMIT 200` scan.
 * canDM() fails CLOSED unless it can prove a real relationship, so an investor
 * viewing an arbitrary auth_users slice never reliably included the founder who
 * invited them → every candidate was denied → empty inbox. (Founder→investor
 * happened to work only because the founder's own CRM contacts landed in the
 * flat slice.)
 *
 * Fix: UNION the viewer's REAL counterparties on top of the existing auth_users
 * base set (union, not replace — nothing that worked before breaks), then still
 * pass every candidate through canDM() at the call site (fail-closed gate is
 * unchanged; we only widen the pool). Counterparties resolved:
 *   - companies the viewer is tied to (as a founder member, as an invited
 *     investor by email, as a cap-table committer, or as a founder-CRM contact)
 *   - for each such company: the founder owner user(s), the invited investors
 *     (email→auth_users), and cap-table co-party investors
 *   - the invited_by_user_id directly recorded on the viewer's invitations
 * Dedup by userId; cap at 500. Read-only, fail-soft per-query so a missing
 * table or column degrades gracefully instead of emptying the inbox.
 */
function listDmCandidates(viewerId: string): DmCandidate[] {
  const db: any = (() => {
    try { return rawDb(); } catch { return null; }
  })();
  if (!db) return [];

  const byId = new Map<string, DmCandidate>();
  const add = (id: unknown, name?: unknown): void => {
    const uid = typeof id === "string" ? id.trim() : "";
    if (!uid || uid === viewerId) return;
    if (byId.size >= 500 && !byId.has(uid)) return;
    const existing = byId.get(uid);
    const legalName = typeof name === "string" && name.trim() ? name.trim() : existing?.legalName;
    byId.set(uid, { userId: uid, legalName });
  };
  const safeAll = (sql: string, ...params: unknown[]): any[] => {
    try { return db.prepare(sql).all(...params) as any[]; } catch { return []; }
  };

  // Resolve the viewer's canonical email so we can match email-keyed rows
  // (round_invitations / founder_crm_contacts store the counterparty email,
  // not a userId, for not-yet-registered investors).
  let viewerEmail = "";
  {
    const row = safeAll(`SELECT email FROM auth_users WHERE id = ? LIMIT 1`, viewerId)[0];
    viewerEmail = typeof row?.email === "string" ? row.email.trim().toLowerCase() : "";
  }

  // ── 1. Base set (existing behavior; union, not replace). ──
  for (const r of safeAll(
    `SELECT id, email, name FROM auth_users
       WHERE id != ? AND COALESCE(status, 'active') != 'disabled'
       ORDER BY COALESCE(name, email) ASC
       LIMIT 200`,
    viewerId,
  )) {
    add(r.id, r.name);
  }

  // ── 2. Companies the viewer is related to (any of four relationships). ──
  const companyIds = new Set<string>();
  const noteCompany = (rows: any[], key = "company_id"): void => {
    for (const r of rows) {
      const cid = typeof r?.[key] === "string" ? r[key].trim() : "";
      if (cid) companyIds.add(cid);
    }
  };
  // 2a. viewer is a founder/member of the company.
  noteCompany(safeAll(
    `SELECT DISTINCT company_id FROM company_members
       WHERE user_id = ? AND COALESCE(is_active, 1) = 1 AND deleted_at IS NULL`,
    viewerId,
  ));
  // 2b. viewer was invited to a round (email-keyed) → owning company.
  if (viewerEmail) {
    noteCompany(safeAll(
      `SELECT DISTINCT company_id FROM round_invitations
         WHERE lower(trim(investor_email)) = ? AND deleted_at IS NULL`,
      viewerEmail,
    ));
    // Also directly capture the inviter recorded on the invitation.
    for (const r of safeAll(
      `SELECT DISTINCT invited_by_user_id FROM round_invitations
         WHERE lower(trim(investor_email)) = ? AND deleted_at IS NULL`,
      viewerEmail,
    )) {
      add(r.invited_by_user_id);
    }
  }
  // 2c. viewer is a cap-table committer → the company they committed to.
  noteCompany(safeAll(
    `SELECT DISTINCT company_id FROM captable_commits
       WHERE investor_id = ? AND deleted_at IS NULL`,
    viewerId,
  ));
  // 2d. viewer is referenced by a founder-CRM contact (by id or email).
  noteCompany(safeAll(
    `SELECT DISTINCT company_id FROM founder_crm_contacts
       WHERE (investor_id = ? OR lower(trim(email)) = ?) AND deleted_at IS NULL`,
    viewerId,
    viewerEmail,
  ));

  // ── 3. For each related company, pull the real counterparties. ──
  for (const cid of companyIds) {
    if (byId.size >= 500) break;
    // 3a. founder owner user(s).
    for (const r of safeAll(
      `SELECT cm.user_id AS user_id, au.name AS name
         FROM company_members cm
         LEFT JOIN auth_users au ON au.id = cm.user_id
        WHERE cm.company_id = ? AND cm.role IN ('founder','co_founder')
          AND COALESCE(cm.is_active, 1) = 1 AND cm.deleted_at IS NULL`,
      cid,
    )) {
      add(r.user_id, r.name);
    }
    // 3b. invited investors on this company's rounds → resolve email→auth_users
    // so a registered investor gets a stable userId canDM can evaluate.
    for (const r of safeAll(
      `SELECT au.id AS user_id, au.name AS name
         FROM round_invitations ri
         JOIN auth_users au ON lower(trim(au.email)) = lower(trim(ri.investor_email))
        WHERE ri.company_id = ? AND ri.deleted_at IS NULL`,
      cid,
    )) {
      add(r.user_id, r.name);
    }
    // 3c. cap-table co-party investors on this company.
    for (const r of safeAll(
      `SELECT DISTINCT investor_id FROM captable_commits
         WHERE company_id = ? AND deleted_at IS NULL`,
      cid,
    )) {
      add(r.investor_id);
    }
  }

  return Array.from(byId.values()).slice(0, 500);
}

export default registerV2546Routes;
