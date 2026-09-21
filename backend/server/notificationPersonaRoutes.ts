/**
 * Persona-scoped notification routes — REGISTERED FACADE, SAME RESOURCE.
 *
 * 2026-09-19 · persona notification repair (slide 13a).
 *
 * WHY THIS FILE EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 * `server/notificationsStore.ts` is FROZEN (byte-exact). Its four customer-
 * facing handlers — GET /api/notifications, PATCH /api/notifications,
 * POST /api/notifications/read-all, GET /api/notifications/stream — answer
 * from an in-process array hydrated once at boot and mutate that array first,
 * persisting best-effort afterwards. They also know nothing about surfaces, so
 * a Consortium Partner's bell showed (and counted) founder, investor and
 * Collective notices alongside partner ones, and a historical row whose link
 * is the un-mounted `/partner/pipeline` navigated to a 404.
 *
 * Express dispatches to the FIRST matching registration. This module
 * registers the same four (method, path) pairs and `server/routes.ts` calls it
 * immediately BEFORE `registerNotificationsRoutes(app)`. The frozen handlers
 * stay registered, unchanged and unreachable for those four pairs; every other
 * frozen route (preferences, broadcast, emit, kinds) is untouched and still
 * served by the frozen module. No monkey-patching, no `app._router` surgery.
 *
 * DURABLE SOURCE OF TRUTH
 * ─────────────────────────────────────────────────────────────────────────────
 * Reads and writes go to the SAME canonical table the frozen emitter persists
 * to — `kv_notificationsStore` via the generic strict helpers in
 * `server/lib/storePersistenceShim.ts`. The frozen RAM array is NEVER read here
 * and never used as a write path. A read failure is a 5xx, never an empty
 * list. A mutation is a single transaction; a failure is an error, never a
 * silent `updated: 0`.
 *
 * DISCLOSED LIMITATIONS (also in build_log/…/HANDOFF.md)
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. The frozen `emitNotification` persists BEST-EFFORT (`persistEntry`, which
 *    logs a warning and returns false on failure). A notice whose durable write
 *    failed exists only in frozen RAM and is therefore INVISIBLE to these strict
 *    readers. This build does not and cannot claim to have fixed emission; the
 *    frozen warning remains the signal.
 * 2. The frozen handler's in-process SSE fan-out is orphaned for the stream
 *    pair (this stream is served here). The stream below is bounded polling of
 *    durable state, not an instant fan-out.
 * 3. Read/archive flags written here are not mirrored into the frozen RAM
 *    array. Addendum §9 confirms no production code outside the frozen
 *    handlers imports `listNotifications` / `unreadCount`, so the stale RAM
 *    copy is unobservable through any served route.
 *
 * AUTHORIZATION
 * ─────────────────────────────────────────────────────────────────────────────
 * `requireAuth` from `./lib/authMiddleware` (401 / 403 suspended / 503). The
 * owner is ALWAYS the session user; any `userId` in query or body is ignored.
 * `surface` is a PRESENTATION filter, not a privilege: a user may ask for any
 * surface and receives only their own rows that classify to it. There is
 * deliberately NO partner-membership wall — a revoked or rejected partner must
 * still be able to read their own rejection/revocation notices.
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "./lib/authMiddleware";
import { getUserContext } from "./lib/userContext";
import { getAccountStatusByUserId, isBlockedAccountStatus } from "./lib/accountStatus";
import {
  hydrateEntriesStrict,
  mutateEntriesStrict,
} from "./lib/storePersistenceShim";
import {
  classifyNotificationDestination,
  isNotificationSurface,
  notificationMatchesSurface,
  type NotificationSurface,
} from "../shared/notificationDestination";
import { log } from "./lib/logger";

/** Must equal `PERSIST_STORE` in the frozen server/notificationsStore.ts. */
export const NOTIFICATIONS_PERSIST_STORE = "notificationsStore";

/** Shape persisted by the frozen emitter. Kept structural, not imported. */
export type StoredNotification = {
  id: string;
  userId: string;
  kind: string;
  title: string;
  body: string;
  link?: string;
  read: boolean;
  archived: boolean;
  createdAt: string;
  channels?: unknown;
};

type ReqWithCtx = Request & { userContext?: ReturnType<typeof getUserContext> };

/* ───────────────────────────── query parsing ───────────────────────────── */

function parseSurface(raw: unknown): NotificationSurface | null {
  if (raw === undefined || raw === null || raw === "") return "account";
  return isNotificationSurface(raw) ? raw : null;
}

function parseBoolParam(raw: unknown): boolean | undefined {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return undefined;
}

/* ─────────────────────────── durable read (strict) ────────────────────────── */

export class NotificationRecordInvalidError extends Error {
  constructor(rowId: string, detail: string) {
    super(`NOTIFICATION_RECORD_INVALID: row ${rowId}: ${detail}`);
    this.name = "NotificationRecordInvalidError";
  }
}

/**
 * Ownership fields. A durable record whose owner cannot be determined is a
 * FAIL-SAFE condition (throw), never a silent skip: an inbox that silently
 * omits a row it cannot attribute would present an incomplete list as complete.
 */
function hasOwnerFields(v: unknown): v is { id: string; userId: string } {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === "string" && o.id.length > 0 && typeof o.userId === "string" && o.userId.length > 0;
}

/**
 * Full record contract for rows the session user OWNS. Every field a client
 * renders must be present with the right type so no UI path can crash or show
 * `undefined`. The only permitted omissions are the historically optional
 * `link` (absent for no-link notices) and `channels` (informational).
 */
function assertStoredNotification(rowId: string, v: { id: string; userId: string } & Record<string, unknown>): StoredNotification {
  const bad = (f: string, want: string): never => {
    throw new NotificationRecordInvalidError(rowId, `${f} must be ${want}`);
  };
  if (typeof v.kind !== "string" || v.kind.length === 0) bad("kind", "a non-empty string");
  if (typeof v.title !== "string") bad("title", "a string");
  if (typeof v.body !== "string") bad("body", "a string");
  if (typeof v.read !== "boolean") bad("read", "a boolean");
  if (typeof v.archived !== "boolean") bad("archived", "a boolean");
  if (typeof v.createdAt !== "string" || Number.isNaN(Date.parse(v.createdAt))) bad("createdAt", "an ISO timestamp");
  if (v.link !== undefined && v.link !== null && typeof v.link !== "string") bad("link", "a string when present");
  return {
    id: v.id,
    userId: v.userId,
    kind: v.kind as string,
    title: v.title as string,
    body: v.body as string,
    link: typeof v.link === "string" ? v.link : undefined,
    read: v.read as boolean,
    archived: v.archived as boolean,
    createdAt: v.createdAt as string,
    channels: v.channels,
  };
}

/** Used inside mutations: owned + valid, or null (foreign) / throw (invalid). */
function ownedRecordOrNull(rowId: string, cur: unknown, userId: string): StoredNotification | null {
  if (!hasOwnerFields(cur)) throw new NotificationRecordInvalidError(rowId, "owner fields missing");
  if (cur.id !== rowId) throw new NotificationRecordInvalidError(rowId, `payload id "${cur.id}" does not match durable key`);
  if (cur.userId !== userId) return null;
  return assertStoredNotification(rowId, cur as { id: string; userId: string } & Record<string, unknown>);
}

/**
 * All durable rows owned by `userId`. THROWS on read failure, on any record
 * whose owner cannot be determined, and on any OWNED record that violates the
 * contract. Records validly owned by OTHER users are ignored without
 * inspection (they are not this user's data).
 */
export function readOwnedNotificationsStrict(userId: string): StoredNotification[] {
  const rows = hydrateEntriesStrict<unknown>(NOTIFICATIONS_PERSIST_STORE);
  const out: StoredNotification[] = [];
  for (const [rowId, payload] of rows) {
    if (!hasOwnerFields(payload)) throw new NotificationRecordInvalidError(rowId, "owner fields missing");
    /* The durable key IS the identity a client will PATCH. A payload whose own
       `id` disagrees with its key would be listed under one id and mutated under
       another — fail closed (this also makes duplicate payload ids impossible,
       since the key is the table's primary key). */
    if (payload.id !== rowId) throw new NotificationRecordInvalidError(rowId, `payload id "${payload.id}" does not match durable key`);
    if (payload.userId !== userId) continue;
    out.push(assertStoredNotification(rowId, payload as { id: string; userId: string } & Record<string, unknown>));
  }
  // newest first, matching the frozen list order
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return out;
}

export type ScopedListing = {
  userId: string;
  surface: NotificationSurface;
  total: number;
  unread: number;
  /** Rows of the owner that do NOT classify to any shell (account view only). */
  /** Un-archived owned rows with NO classified destination (account-only history). */
  unclassified: number;
  /** Un-archived owned rows that do NOT belong to `surface` (0 for `account`). */
  outsideWorkspace: number;
  items: Array<StoredNotification & { destination: ReturnType<typeof classifyNotificationDestination> }>;
};

/**
 * Compute one scoped listing. `unread` and `items` come from the SAME
 * classified set, so a badge count can never disagree with the rows shown.
 * `unread` counts un-archived unread rows in scope regardless of list filters
 * (matches the frozen semantics of `unreadCount`).
 */
export function scopedListing(
  userId: string,
  surface: NotificationSurface,
  filters: { unreadOnly?: boolean; archived?: boolean },
): ScopedListing {
  const owned = readOwnedNotificationsStrict(userId);
  const inScope = owned.filter((n) => notificationMatchesSurface(n, surface));
  const unread = inScope.filter((n) => !n.read && !n.archived).length;
  const unclassified = owned.filter((n) => !n.archived && classifyNotificationDestination(n.link, n.kind).class === "unclassified").length;
  const outsideWorkspace = surface === "account" ? 0 : owned.filter((n) => !n.archived && !notificationMatchesSurface(n, surface)).length;
  let items = inScope;
  if (filters.archived === undefined) items = items.filter((n) => !n.archived);
  else items = items.filter((n) => n.archived === filters.archived);
  if (filters.unreadOnly) items = items.filter((n) => !n.read);
  return {
    userId,
    surface,
    total: items.length,
    unread,
    unclassified,
    outsideWorkspace,
    items: items.map((n) => ({ ...n, destination: classifyNotificationDestination(n.link, n.kind) })),
  };
}

/* ───────────────────────────── error responses ─────────────────────────── */

function sendReadFailure(res: Response, where: string, err: unknown): void {
  log.error?.({ route: `notificationPersonaRoutes.${where}`, message: (err as Error).message });
  res.status(503).json({
    ok: false,
    error: "NOTIFICATIONS_UNAVAILABLE",
    message: "Your notifications could not be loaded right now. Please try again.",
  });
}

function sendMutationFailure(res: Response, where: string, err: unknown): void {
  log.error?.({ route: `notificationPersonaRoutes.${where}`, message: (err as Error).message });
  res.status(503).json({
    ok: false,
    error: "NOTIFICATIONS_UPDATE_FAILED",
    message: "Your change could not be saved. Nothing was changed. Please try again.",
  });
}

/* ───────────────────────────── PATCH body guard ────────────────────────── */

const MAX_PATCH_IDS = 500;
const MAX_ID_LEN = 128;
/* `userId` is accepted as IGNORED noise: legacy client bundles sent it, and the
   owner is always the session user. It is never read. */
const ALLOWED_PATCH_KEYS = new Set(["ids", "read", "archived", "surface", "userId"]);

type PatchBody = { ids: string[]; read?: boolean; archived?: boolean; surface: NotificationSurface };

function parsePatchBody(raw: unknown): { ok: true; body: PatchBody } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "BODY_REQUIRED" };
  for (const k of Object.keys(raw as object)) {
    if (!ALLOWED_PATCH_KEYS.has(k)) return { ok: false, error: "UNKNOWN_FIELD" };
  }
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.ids) || o.ids.length === 0) return { ok: false, error: "IDS_REQUIRED" };
  if (o.ids.length > MAX_PATCH_IDS) return { ok: false, error: "TOO_MANY_IDS" };
  const ids: string[] = [];
  for (const id of o.ids) {
    if (typeof id !== "string" || id.length === 0 || id.length > MAX_ID_LEN) return { ok: false, error: "INVALID_ID" };
    ids.push(id);
  }
  const hasRead = o.read !== undefined;
  const hasArchived = o.archived !== undefined;
  if (hasRead && typeof o.read !== "boolean") return { ok: false, error: "INVALID_READ" };
  if (hasArchived && typeof o.archived !== "boolean") return { ok: false, error: "INVALID_ARCHIVED" };
  if (!hasRead && !hasArchived) return { ok: false, error: "NO_CHANGE_REQUESTED" };
  const surface = parseSurface(o.surface);
  if (!surface) return { ok: false, error: "INVALID_SURFACE" };
  return {
    ok: true,
    body: {
      ids: Array.from(new Set(ids)),
      read: hasRead ? (o.read as boolean) : undefined,
      archived: hasArchived ? (o.archived as boolean) : undefined,
      surface,
    },
  };
}

/* ─────────────────────────── stream (bounded polling) ─────────────────────── */

/** Bounded, durable-state polling. NOT an instant fan-out (disclosed). */
export const STREAM_POLL_MIN_MS = 5000;
export const STREAM_POLL_MAX_MS = 60_000;
export const STREAM_POLL_DEFAULT_MS = 15_000;
/** Clamped to [5 s, 60 s]; non-numeric → default. Each poll is one strict
 *  full-table read per connected client, so the floor is deliberate; the 30 s
 *  client refetch already bounds staleness. Configuration hardening. */
export function resolveStreamPollMs(raw: string | undefined): number {
  const n = Number(raw);
  if (raw === undefined || raw === "" || !Number.isFinite(n)) return STREAM_POLL_DEFAULT_MS;
  return Math.min(STREAM_POLL_MAX_MS, Math.max(STREAM_POLL_MIN_MS, Math.floor(n)));
}
export const STREAM_POLL_MS = resolveStreamPollMs(process.env.NOTIFICATIONS_STREAM_POLL_MS);
const STREAM_KEEPALIVE_MS = 30_000;

function fingerprint(userId: string, surface: NotificationSurface): { unread: number; total: number; version: string } | null {
  const l = scopedListing(userId, surface, {});
  // version = deterministic digest of (id, read, archived) so a flag flip is a change
  const version = l.items.map((n) => `${n.id}:${n.read ? 1 : 0}${n.archived ? 1 : 0}`).join("|");
  return { unread: l.unread, total: l.total, version: `${l.items.length}:${simpleHash(version)}` };
}

function simpleHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

/** Re-check the session on every poll so a suspended account stops receiving. */
function sessionStillAllowed(req: Request, userId: string): boolean {
  try {
    const ctx = getUserContext(req);
    if (!ctx?.isAuthed || ctx.userId !== userId) return false;
    const status = getAccountStatusByUserId(userId);
    return !isBlockedAccountStatus(status);
  } catch {
    return false; // fail closed
  }
}

/* ─────────────────────────────── registration ──────────────────────────── */

/** Exactly the four (method, path) pairs this facade owns. */
export const PERSONA_FACADE_ROUTES: ReadonlyArray<{ method: "get" | "patch" | "post"; path: string }> = [
  { method: "get", path: "/api/notifications" },
  { method: "patch", path: "/api/notifications" },
  { method: "post", path: "/api/notifications/read-all" },
  { method: "get", path: "/api/notifications/stream" },
];

export function registerPersonaNotificationRoutes(app: Express): void {
  /* GET list — session owner only; ?surface= scopes presentation. */
  app.get("/api/notifications", requireAuth, (req: ReqWithCtx, res: Response) => {
    const userId = req.userContext!.userId;
    const surface = parseSurface(req.query.surface);
    if (!surface) {
      return res.status(400).json({ ok: false, error: "INVALID_SURFACE", message: "Unknown workspace filter." });
    }
    const unreadOnly = String(req.query.unreadOnly ?? "") === "true";
    const archived = parseBoolParam(req.query.archived);
    try {
      const listing = scopedListing(userId, surface, { unreadOnly, archived });
      return res.json(listing);
    } catch (err) {
      return sendReadFailure(res, "list", err);
    }
  });

  /* PATCH — mark read / archive, owner-filtered then surface-classified, atomic. */
  app.patch("/api/notifications", requireAuth, (req: ReqWithCtx, res: Response) => {
    const userId = req.userContext!.userId;
    const parsed = parsePatchBody(req.body);
    if (!parsed.ok) {
      return res.status(400).json({ ok: false, error: parsed.error, message: "The request could not be applied." });
    }
    const { ids, read, archived, surface } = parsed.body;
    try {
      // Owner + surface filter happens INSIDE the transaction against the latest
      // payload, so a foreign or out-of-scope id is simply skipped (never
      // disclosed as "not yours" vs "does not exist").
      const updated = mutateEntriesStrict<unknown>(NOTIFICATIONS_PERSIST_STORE, ids, (raw, rowId) => {
        const cur = ownedRecordOrNull(rowId, raw, userId);
        if (!cur) return null;
        if (!notificationMatchesSurface(cur, surface)) return null;
        const next = { ...(raw as Record<string, unknown>) } as StoredNotification;
        if (read !== undefined) next.read = read;
        if (archived !== undefined) next.archived = archived;
        return next;
      });
      return res.json({ ok: true, updated });
    } catch (err) {
      return sendMutationFailure(res, "patch", err);
    }
  });

  /* POST read-all — scoped to `surface` (account = every owned row), atomic. */
  app.post("/api/notifications/read-all", requireAuth, (req: ReqWithCtx, res: Response) => {
    const userId = req.userContext!.userId;
    const body = (req.body && typeof req.body === "object" && !Array.isArray(req.body)) ? (req.body as Record<string, unknown>) : {};
    const surface = parseSurface(body.surface ?? req.query.surface);
    if (!surface) {
      return res.status(400).json({ ok: false, error: "INVALID_SURFACE", message: "Unknown workspace filter." });
    }
    try {
      /* Persona surfaces mark only VISIBLE unread rows (un-archived) — an
         archived row the user cannot see in that workspace is never changed
         behind their back. `account` keeps the legacy frozen semantics (every
         unread row of the owner) so the role-agnostic /notifications page
         behaves exactly as before. */
      const eligible = (n: StoredNotification): boolean =>
        !n.read && (surface === "account" || !n.archived) && notificationMatchesSurface(n, surface);
      const candidates = readOwnedNotificationsStrict(userId).filter(eligible).map((n) => n.id);
      const marked = candidates.length === 0
        ? 0
        : mutateEntriesStrict<unknown>(NOTIFICATIONS_PERSIST_STORE, candidates, (raw, rowId) => {
            const cur = ownedRecordOrNull(rowId, raw, userId);
            if (!cur) return null;
            if (!eligible(cur)) return null;
            return { ...(raw as Record<string, unknown>), read: true };
          });
      return res.json({ ok: true, marked, surface });
    } catch (err) {
      return sendMutationFailure(res, "readAll", err);
    }
  });

  /* GET stream — SSE, bounded polling of durable state, scoped invalidations. */
  app.get("/api/notifications/stream", requireAuth, (req: ReqWithCtx, res: Response) => {
    const userId = req.userContext!.userId;
    const surface = parseSurface(req.query.surface);
    if (!surface) {
      return res.status(400).json({ ok: false, error: "INVALID_SURFACE", message: "Unknown workspace filter." });
    }
    let first: ReturnType<typeof fingerprint>;
    try {
      first = fingerprint(userId, surface);
    } catch (err) {
      return sendReadFailure(res, "stream", err);
    }
    res.setHeader("content-type", "text/event-stream");
    res.setHeader("cache-control", "no-cache");
    res.setHeader("connection", "keep-alive");
    res.flushHeaders?.();

    let last = first!;
    const write = (event: string, data: unknown): void => {
      try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* noop */ }
    };
    write("hello", { surface, unread: last.unread, total: last.total, version: last.version, pollMs: STREAM_POLL_MS });

    let closed = false;
    const stop = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(poll);
      clearInterval(keepalive);
      try { res.end(); } catch { /* noop */ }
    };
    const poll = setInterval(() => {
      if (closed) return;
      if (!sessionStillAllowed(req, userId)) { write("bye", { reason: "session" }); stop(); return; }
      try {
        const now = fingerprint(userId, surface)!;
        if (now.version !== last.version || now.unread !== last.unread || now.total !== last.total) {
          last = now;
          write("notification", { surface, unread: now.unread, total: now.total, version: now.version });
        }
      } catch (err) {
        // Strict read failed: tell the client to fall back to polling, and stop.
        log.warn?.({ route: "notificationPersonaRoutes.stream", message: (err as Error).message });
        write("bye", { reason: "unavailable" });
        stop();
      }
    }, STREAM_POLL_MS);
    const keepalive = setInterval(() => write("ping", {}), STREAM_KEEPALIVE_MS);
    req.on("close", stop);
    res.on("close", stop);
  });
}
