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
          const displayName = resolveDisplayName(
            c.userId,
            viewerId,
            "message",
            { legalName: c.legalName ?? c.userId },
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
 * Enumerate plausible DM counterparties for the viewer from DURABLE identity
 * tables (auth_users — the canonical registry). canDM() then filters this set
 * down to the LOCKED-permitted recipients; this function only widens the pool.
 * Read-only, fail-soft to [] so the inbox degrades gracefully.
 */
function listDmCandidates(viewerId: string): DmCandidate[] {
  try {
    const db: any = rawDb();
    const rows: any[] = db
      .prepare(
        `SELECT id, email, name FROM auth_users
          WHERE id != ? AND COALESCE(status, 'active') != 'disabled'
          ORDER BY COALESCE(name, email) ASC
          LIMIT 200`,
      )
      .all(viewerId);
    return rows.map((r) => ({
      userId: String(r.id),
      legalName: typeof r.name === "string" ? r.name : undefined,
    }));
  } catch (err) {
    log.warn("[v25.46] listDmCandidates failed:", (err as Error).message);
    return [];
  }
}

export default registerV2546Routes;
