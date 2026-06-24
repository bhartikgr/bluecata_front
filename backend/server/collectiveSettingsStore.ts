/**
 * Wave C-3 — Collective Settings Store
 *
 * Per-user Collective preferences:
 *   - anonymityLevel: public | screen_name | private
 *   - notifyOnDscScore: boolean (emit notification when new DSC score is published)
 *   - notifyOnDealRoomUpdate: boolean
 *   - dealRoomVisibility: visible | hidden | members_only
 *
 * Every PATCH:
 *   - requires x-confirm: true header (double-verify)
 *   - appends a hash-chain entry
 *   - emits `collective.member.updated` bridge event
 *   - writes to audit log
 *
 * Routes:
 *   GET  /api/collective/settings/mine    — caller's settings (userId from x-user-id header)
 *   PATCH /api/collective/settings/mine   — update caller's settings (x-confirm required)
 */

import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { isNull, eq } from "drizzle-orm";
import { HashChain, registerChain } from "./lib/hashChain";
import { withTrace } from "./lib/trace";
import { emitBridgeEvent } from "./bridgeStore";
import { appendAdminAudit } from "./adminPlatformStore";
import { getDb } from "./db/connection"; /* v17 Phase B */
import { collectiveSettingsTable } from "@shared/schema"; /* v17 Phase B */
import { DEFAULT_CHAPTER_ID, DEFAULT_CHAPTER_TENANT_ID } from "./lib/chapterDefaults";
import { log } from "./lib/logger";

/* ============================================================
 * Type definitions
 * ============================================================ */

export type AnonymityLevel = "public" | "screen_name" | "private";
export type DealRoomVisibility = "visible" | "hidden" | "members_only";

export interface CollectiveSettings {
  userId: string;
  anonymityLevel: AnonymityLevel;
  notifyOnDscScore: boolean;
  notifyOnDealRoomUpdate: boolean;
  dealRoomVisibility: DealRoomVisibility;
  updatedAt: string;
  updatedBy: string;
  version: number;
  prevHash: string;
  hash: string;
}

/* ============================================================
 * Crypto helpers
 * ============================================================ */

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

function computeHash(settings: Omit<CollectiveSettings, "hash">, prevHash: string): string {
  const body = JSON.stringify({
    userId: settings.userId,
    anonymityLevel: settings.anonymityLevel,
    notifyOnDscScore: settings.notifyOnDscScore,
    notifyOnDealRoomUpdate: settings.notifyOnDealRoomUpdate,
    dealRoomVisibility: settings.dealRoomVisibility,
    updatedAt: settings.updatedAt,
    version: settings.version,
    prevHash,
  });
  return sha256(body);
}

/* ============================================================
 * In-memory store
 * ============================================================ */

const settingsMap = new Map<string, CollectiveSettings>();

export const collectiveSettingsChain = registerChain(
  new HashChain<{ userId: string; version: number; ts: string }>("collective_settings")
);

/* ============================================================
 * Default settings for a user
 * ============================================================ */

function defaultSettings(userId: string): CollectiveSettings {
  const now = new Date().toISOString();
  const prevHash = "GENESIS";
  const partial = {
    userId,
    anonymityLevel: "public" as AnonymityLevel,
    notifyOnDscScore: true,
    notifyOnDealRoomUpdate: true,
    dealRoomVisibility: "visible" as DealRoomVisibility,
    updatedAt: now,
    updatedBy: userId,
    version: 1,
    prevHash,
  };
  const hash = computeHash(partial, prevHash);
  return { ...partial, hash };
}

/* ============================================================
 * Business logic
 * ============================================================ */

// v25.41 Q4 (Avi answer = B): map a durable collective_settings row to the
// in-memory CollectiveSettings shape. Mirrors the boot hydrator's mapping so a
// single source of truth is preserved (snake_case OR camelCase column access).
function rowToSettings(r: any): CollectiveSettings {
  return {
    userId: r.user_id ?? r.userId,
    anonymityLevel: (r.anonymity_level ?? r.anonymityLevel ?? "public") as AnonymityLevel,
    notifyOnDscScore: Boolean(r.notify_on_dsc_score ?? r.notifyOnDscScore),
    notifyOnDealRoomUpdate: Boolean(r.notify_on_deal_room_update ?? r.notifyOnDealRoomUpdate),
    dealRoomVisibility: (r.deal_room_visibility ?? r.dealRoomVisibility ?? "visible") as DealRoomVisibility,
    updatedAt: r.updated_at ?? r.updatedAt,
    updatedBy: r.updated_by ?? r.updatedBy,
    version: Number(r.version ?? 1),
    prevHash: r.prev_hash ?? r.prevHash ?? "GENESIS",
    hash: r.hash,
  };
}

export function getOrCreateSettings(userId: string): CollectiveSettings {
  if (!settingsMap.has(userId)) {
    // v25.41 Q4 (Avi answer = B): DB-FIRST before minting. The boot hydrator only
    // restores rows that existed at startup; a user whose row was written by
    // another process (or after this process booted) would otherwise be silently
    // re-minted to defaults, forking the hash chain. Per Avi's unifying directive
    // ("nothing in memory; everything fetched from the record table"), query the
    // durable collective_settings table first; hydrate into memory and return it
    // if a row exists. Only mint a fresh default when the DB returns nothing.
    try {
      const db: any = getDb();
      const row = db
        .select()
        .from(collectiveSettingsTable)
        .where(eq((collectiveSettingsTable as any).userId, userId))
        .get() as any;
      if (row && row.hash) {
        settingsMap.set(userId, rowToSettings(row));
        return settingsMap.get(userId)!;
      }
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (!/no such table/i.test(msg)) {
        log.warn("[collectiveSettingsStore.getOrCreate] DB read failed:", msg);
      }
      // fall through to mint (preserves prior behavior on DB error)
    }
    settingsMap.set(userId, defaultSettings(userId));
  }
  return settingsMap.get(userId)!;
}

export const collectiveSettingsPatchSchema = z.object({
  anonymityLevel: z.enum(["public", "screen_name", "private"]).optional(),
  notifyOnDscScore: z.boolean().optional(),
  notifyOnDealRoomUpdate: z.boolean().optional(),
  dealRoomVisibility: z.enum(["visible", "hidden", "members_only"]).optional(),
});

export function patchSettings(
  userId: string,
  patch: z.infer<typeof collectiveSettingsPatchSchema>,
  actorUserId: string
): CollectiveSettings {
  return withTrace("collective.settings.patch", "1.0.0", "US", () => {
    const current = getOrCreateSettings(userId);
    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const prevHash = current.hash;

    const updated: Omit<CollectiveSettings, "hash"> = {
      userId,
      anonymityLevel: patch.anonymityLevel ?? current.anonymityLevel,
      notifyOnDscScore: patch.notifyOnDscScore ?? current.notifyOnDscScore,
      notifyOnDealRoomUpdate: patch.notifyOnDealRoomUpdate ?? current.notifyOnDealRoomUpdate,
      dealRoomVisibility: patch.dealRoomVisibility ?? current.dealRoomVisibility,
      updatedAt: now,
      updatedBy: actorUserId,
      version: nextVersion,
      prevHash,
    };
    const hash = computeHash(updated, prevHash);
    const next: CollectiveSettings = { ...updated, hash };

    // v17 Phase B — DB write-through (upsert by userId PK).
    try {
      const db: any = getDb();
      db.transaction((tx: any) => {
        // Try insert first; on conflict, update.
        try {
          tx.insert(collectiveSettingsTable).values({
            userId,
            tenantId: DEFAULT_CHAPTER_TENANT_ID,
            chapterId: DEFAULT_CHAPTER_ID,
            anonymityLevel: next.anonymityLevel,
            notifyOnDscScore: next.notifyOnDscScore ? 1 : 0,
            notifyOnDealRoomUpdate: next.notifyOnDealRoomUpdate ? 1 : 0,
            dealRoomVisibility: next.dealRoomVisibility,
            version: next.version,
            prevHash: next.prevHash,
            hash: next.hash,
            updatedBy: actorUserId,
            updatedAt: now,
            createdAt: now,
          } as any).run();
        } catch (_e) {
          tx.update(collectiveSettingsTable)
            .set({
              anonymityLevel: next.anonymityLevel,
              notifyOnDscScore: next.notifyOnDscScore ? 1 : 0,
              notifyOnDealRoomUpdate: next.notifyOnDealRoomUpdate ? 1 : 0,
              dealRoomVisibility: next.dealRoomVisibility,
              version: next.version,
              prevHash: next.prevHash,
              hash: next.hash,
              updatedBy: actorUserId,
              updatedAt: now,
            } as any)
            .where(eq((collectiveSettingsTable as any).userId, userId))
            .run();
        }
      });
    } catch (err) {
      // v25.35 Phase 4 #18 — fail-closed: settings are hash-chained, so a
      // memory-only patch would advance the in-process version/hash while the
      // durable row stayed at the old version, permanently forking the chain.
      // Throw → route returns 500; cache + chain advance only AFTER commit.
      log.error("[collectiveSettingsStore.patch] DB write failed:", (err as Error).message);
      throw err;
    }

    // v25.35 — cache + hash-chain advance only AFTER the durable upsert committed.
    settingsMap.set(userId, next);
    collectiveSettingsChain.append({ userId, version: nextVersion, ts: now });

    // Bridge event
    emitBridgeEvent({
      eventType: "collective.member.updated",
      aggregateId: userId,
      aggregateKind: "platform",
      payload: {
        userId,
        changedFields: Object.keys(patch),
        version: nextVersion,
      },
    });

    // Audit
    try {
      appendAdminAudit(
        actorUserId,
        `collective_settings:${userId}`,
        "collective.settings.patched",
        { changedFields: Object.keys(patch), version: nextVersion }
      );
    } catch {
      // appendAdminAudit may throw if not initialized; swallow
    }

    return next;
  });
}

export function __clearCollectiveSettings(): void {
  settingsMap.clear();
  collectiveSettingsChain.__clear();
}

/* ---------- v17 Phase B — hydrator ---------- */
export async function hydrateCollectiveSettingsStore(): Promise<void> {
  settingsMap.clear();
  collectiveSettingsChain.__clear();
  try {
    const db: any = getDb();
    const rows = db
      .select()
      .from(collectiveSettingsTable)
      .where(isNull((collectiveSettingsTable as any).deletedAt))
      .all() as any[];
    // Sort by version so the chain entries replay in order.
    rows.sort((a: any, b: any) => Number(a.version ?? 0) - Number(b.version ?? 0));
    for (const r of rows) {
      const settings: CollectiveSettings = {
        userId: r.user_id ?? r.userId,
        anonymityLevel: (r.anonymity_level ?? r.anonymityLevel ?? "public") as AnonymityLevel,
        notifyOnDscScore: Boolean(r.notify_on_dsc_score ?? r.notifyOnDscScore),
        notifyOnDealRoomUpdate: Boolean(r.notify_on_deal_room_update ?? r.notifyOnDealRoomUpdate),
        dealRoomVisibility: (r.deal_room_visibility ?? r.dealRoomVisibility ?? "visible") as DealRoomVisibility,
        updatedAt: r.updated_at ?? r.updatedAt,
        updatedBy: r.updated_by ?? r.updatedBy,
        version: Number(r.version ?? 1),
        prevHash: r.prev_hash ?? r.prevHash ?? "GENESIS",
        hash: r.hash,
      };
      settingsMap.set(settings.userId, settings);
      collectiveSettingsChain.append({
        userId: settings.userId,
        version: settings.version,
        ts: settings.updatedAt,
      });
    }
    if (rows.length > 0) {
      log.info(`[hydrate] collectiveSettingsStore: ${rows.length} settings rows restored`);
    }
    void DEFAULT_CHAPTER_ID;
    void DEFAULT_CHAPTER_TENANT_ID;
    void randomBytes;
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!/no such table/i.test(msg)) {
      log.warn("[hydrate] collectiveSettingsStore: DB read failed:", msg);
    }
  }
}

/* ============================================================
 * Routes
 * ============================================================ */

/**
 * v25.12 NH-1 — settings are scoped to active Collective members only.
 * Without this gate, any authenticated platform user (non-member investor,
 * founder, admin observer) could read and write the personal settings ledger
 * including the hash chain. Admin bypasses for support cases.
 */
function requireCollectiveMember(
  req: Request,
  res: Response,
): { userId: string } | null {
  const ctx = (req as Request & {
    userContext?: {
      userId?: string;
      isAuthed?: boolean;
      isAdmin?: boolean;
      collective?: { status?: string };
    };
  }).userContext;
  if (!ctx?.userId || !ctx?.isAuthed) {
    res.status(401).json({ error: "missing_identity" });
    return null;
  }
  if (!ctx.isAdmin && ctx.collective?.status !== "active") {
    res.status(403).json({ error: "not_collective_member" });
    return null;
  }
  return { userId: ctx.userId };
}

export function registerCollectiveSettingsRoutes(app: Express): void {
  // GET /api/collective/settings/mine
  app.get("/api/collective/settings/mine", (req: Request, res: Response) => {
    const m = requireCollectiveMember(req, res);
    if (!m) return;
    const settings = getOrCreateSettings(m.userId);
    res.json(settings);
  });

  // PATCH /api/collective/settings/mine  (double-verify: x-confirm: true required)
  app.patch("/api/collective/settings/mine", (req: Request, res: Response) => {
    const confirm = req.headers["x-confirm"];
    if (confirm !== "true") {
      return res.status(428).json({ error: "double_verify_required", hint: 'Set header x-confirm: true' });
    }

    const m = requireCollectiveMember(req, res);
    if (!m) return;
    const userId = m.userId;
    const actorUserId = userId; // patch.actorUserId always equals session id

    const parsed = collectiveSettingsPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
    }

    // v25.35 Phase 4 #18 — patchSettings now fails-closed (throws) when the
    // hash-chained durable write does not commit; translate into a 500 with a
    // sanitized message rather than returning a memory-only success.
    try {
      const updated = patchSettings(userId, parsed.data, actorUserId);
      res.json(updated);
    } catch (err) {
      log.error("[collectiveSettings.patchRoute] persist failed:", (err as Error).message);
      res.status(500).json({ ok: false, error: "SETTINGS_PERSIST_FAILED", message: "Could not save settings. No change applied." });
    }
  });
}
