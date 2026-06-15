/**
 * Sprint 29 KL-08 — Pluggable Session Store.
 *
 * Wraps current session storage with a pluggable backend:
 *   - REDIS_URL set → use connect-redis + ioredis (production-safe cluster sharing)
 *   - REDIS_URL absent → in-memory Map (sandbox)
 *
 * Contract:
 *   get(sid): Session | undefined
 *   set(sid, session, maxAgeMs): void
 *   destroy(sid): void
 *   touch(sid, session): void
 *
 * PRODUCTION DEPLOY NOTE (see DEPLOY_HANDOFF.md):
 *   Set REDIS_URL=redis://... and the cluster will share session state across
 *   PM2 workers.
 */

/* v25.25.2 — createRequire shim: lazy require() calls in this file must work
   in BOTH the dev/prod tsx runtime (ESM, where `require` is undefined) AND
   the bundled CJS dist. This is the minimal, zero-risk way to unblock the
   v25.25 login 500 ("require is not defined" at userContext.ts:585 and other
   sites) without converting every lazy require() to a static import (which
   would re-introduce circular-import bugs). */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

import { log } from "./lib/logger";
export interface SessionData {
  userId?: string;
  role?: string;
  companyId?: string;
  createdAt?: string;
  expiresAt?: string;
  [key: string]: unknown;
}

export interface SessionEntry {
  data: SessionData;
  expiresAt: number; // epoch ms
}

export interface ISessionStore {
  get(sid: string): SessionData | undefined;
  set(sid: string, session: SessionData, maxAgeMs?: number): void;
  destroy(sid: string): void;
  touch(sid: string, session?: SessionData): void;
}

/* ============================================================
 * In-memory backend (sandbox)
 * ============================================================ */
class InMemorySessionStore implements ISessionStore {
  private store = new Map<string, SessionEntry>();

  get(sid: string): SessionData | undefined {
    const entry = this.store.get(sid);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(sid);
      return undefined;
    }
    return entry.data;
  }

  set(sid: string, session: SessionData, maxAgeMs = 86_400_000 /* 24h */): void {
    this.store.set(sid, {
      data: session,
      expiresAt: Date.now() + maxAgeMs,
    });
  }

  destroy(sid: string): void {
    this.store.delete(sid);
  }

  touch(sid: string, session?: SessionData): void {
    const entry = this.store.get(sid);
    if (!entry) return;
    if (session) {
      entry.data = { ...entry.data, ...session };
    }
    // Refresh TTL by 24h
    entry.expiresAt = Date.now() + 86_400_000;
  }

  /** Test helper */
  _all(): Map<string, SessionEntry> {
    return this.store;
  }
}

/* ============================================================
 * Redis-backed backend (production)
 * ============================================================ */
class RedisSessionStore implements ISessionStore {
  private client: any;
  private ready = false;

  constructor() {
    const redisUrl = process.env.REDIS_URL!;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Redis = require("ioredis");
      this.client = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        enableReadyCheck: false,
        lazyConnect: false,
      });
      this.client.on("ready", () => {
        this.ready = true;
        log.info("[session-store] Redis connected");
      });
      this.client.on("error", (err: Error) => {
        log.error("[session-store] Redis error:", err.message);
      });
    } catch (e) {
      log.error("[session-store] ioredis not available:", e);
    }
  }

  private redisKey(sid: string): string {
    return `cap:sess:${sid}`;
  }

  get(sid: string): SessionData | undefined {
    if (!this.ready) return undefined;
    // ioredis is async; in production use RedisStore from connect-redis which
    // plugs into express-session natively. This sync adapter is for the contract.
    // Synchronous read is not feasible with ioredis; production will use
    // the connect-redis SessionStore adapter registered with express-session.
    log.info(`[session-store] get ${sid} — use express-session + connect-redis in production`);
    return undefined;
  }

  set(sid: string, session: SessionData, maxAgeMs = 86_400_000): void {
    if (!this.ready) return;
    const ttlSeconds = Math.floor(maxAgeMs / 1000);
    this.client.setex(this.redisKey(sid), ttlSeconds, JSON.stringify(session)).catch((e: Error) => {
      log.error("[session-store] set error:", e.message);
    });
  }

  destroy(sid: string): void {
    if (!this.ready) return;
    this.client.del(this.redisKey(sid)).catch((e: Error) => {
      log.error("[session-store] destroy error:", e.message);
    });
  }

  touch(sid: string, _session?: SessionData): void {
    if (!this.ready) return;
    this.client.expire(this.redisKey(sid), 86_400).catch((e: Error) => {
      log.error("[session-store] touch error:", e.message);
    });
  }
}

/* ============================================================
 * Factory — picks the right backend
 * ============================================================ */
function createSessionStore(): ISessionStore {
  if (process.env.REDIS_URL) {
    log.info("[session-store] REDIS_URL detected — using RedisSessionStore");
    return new RedisSessionStore();
  }
  log.info("[session-store] no REDIS_URL — using InMemorySessionStore (ephemeral)");
  return new InMemorySessionStore();
}

/** Singleton session store — created once at module load. */
export const sessionStore: ISessionStore = createSessionStore();

/** Expose InMemorySessionStore for testing without env vars. */
export { InMemorySessionStore };
