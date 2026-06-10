/**
 * Sprint 18 Phase 2 — T1.2 Welcome ack persistence.
 *
 * Stores the welcome-ack flag per-user. v24.4.1 — migrated from pure RAM to
 * DB-backed cache-on-top-of-SQLite. Boot calls `hydrateWelcomeStore()` to
 * rebuild the in-memory Map from `welcome_acks`. Every set() does a tx-safe
 * write-through (Map.set + SQLite UPSERT) so an Avi restart never loses ack
 * state.
 *
 * Backwards-compat: the in-memory Map is still the read-path, so existing
 * callers don't change. The shape (Map<string, boolean>) is preserved.
 */
import type { Express, Request, Response } from "express";
import { getUserContext } from "./lib/userContext";
import { getDb, rawDb } from "./db/connection";
import { log } from "./lib/logger";

/** Cache-on-top-of-DB: read path stays in-memory; writes flow to both. */
const ackByUser = new Map<string, boolean>();

/**
 * v24.4.1 — hydrate the welcome-ack cache from the durable `welcome_acks`
 * table. Called once on server boot via hydrateStores.HYDRATE_ORDER. Failure
 * is non-fatal (the Map just stays empty; users will see the welcome prompt
 * on next visit and ack again).
 */
export async function hydrateWelcomeStore(): Promise<void> {
  try {
    const db = rawDb();
    const rows = db
      .prepare(`SELECT user_id, ack FROM welcome_acks`)
      .all() as Array<{ user_id: string; ack: number }>;
    ackByUser.clear();
    for (const r of rows) {
      ackByUser.set(r.user_id, r.ack === 1);
    }
    if (rows.length > 0) {
      log.info(`[hydrate] welcomeStore: ${rows.length} ack rows loaded`);
    }
  } catch (err) {
    log.warn("[hydrate] welcomeStore: DB read failed:", (err as Error).message);
  }
}

/** Write-through: update the cache AND persist to `welcome_acks`. */
function setAck(userId: string, ack: boolean): void {
  ackByUser.set(userId, ack);
  try {
    const db = rawDb();
    db.prepare(
      `INSERT INTO welcome_acks (user_id, ack, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET ack = excluded.ack, updated_at = excluded.updated_at`,
    ).run(userId, ack ? 1 : 0, new Date().toISOString());
  } catch (err) {
    // Non-fatal: the cache still holds the new value. Next boot will lose it
    // but a re-ack from the UI restores. Logged for observability.
    log.warn("[welcomeStore] write-through failed:", (err as Error).message);
  }
}

export function registerWelcomeRoutes(app: Express): void {
  app.get("/api/founder/welcome", async (req: Request, res: Response) => {
    const ctx = await getUserContext(req);
    const userId = ctx?.userId || "anonymous";
    // Wave B FIX 5 (F-BUG-008) — the UserContext stores the founder's name
    // on `identity.name` (set by registerFounderUser from the signup form).
    // The legacy code here read `ctx.displayName`, which has never existed
    // on UserContext, so firstName always fell back to "Founder".
    const displayName = (ctx?.identity?.name ?? "").trim() || "Founder";
    const firstName = displayName.split(" ")[0] || "Founder";
    res.json({
      welcomeAck: ackByUser.get(userId) === true,
      firstName,
      displayName,
    });
  });

  app.post("/api/founder/welcome/ack", async (req: Request, res: Response) => {
    const ctx = await getUserContext(req);
    const userId = ctx?.userId || "anonymous";
    setAck(userId, true);
    res.json({ ok: true, welcomeAck: true });
  });

  app.post("/api/founder/welcome/reset", async (req: Request, res: Response) => {
    const ctx = await getUserContext(req);
    const userId = ctx?.userId || "anonymous";
    setAck(userId, false);
    res.json({ ok: true, welcomeAck: false });
  });
}

export function _resetWelcomeStoreForTests(): void {
  ackByUser.clear();
  try {
    rawDb().prepare(`DELETE FROM welcome_acks`).run();
  } catch { /* table may not exist in non-prod paths */ }
}
