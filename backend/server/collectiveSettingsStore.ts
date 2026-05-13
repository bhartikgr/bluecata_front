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
import { HashChain, registerChain } from "./lib/hashChain";
import { withTrace } from "./lib/trace";
import { emitBridgeEvent } from "./bridgeStore";
import { appendAdminAudit } from "./adminPlatformStore";

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

export function getOrCreateSettings(userId: string): CollectiveSettings {
  if (!settingsMap.has(userId)) {
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

/* ============================================================
 * Routes
 * ============================================================ */

export function registerCollectiveSettingsRoutes(app: Express): void {
  // GET /api/collective/settings/mine
  app.get("/api/collective/settings/mine", (req: Request, res: Response) => {
    const userId = String(req.headers["x-user-id"] ?? "u_demo");
    const settings = getOrCreateSettings(userId);
    res.json(settings);
  });

  // PATCH /api/collective/settings/mine  (double-verify: x-confirm: true required)
  app.patch("/api/collective/settings/mine", (req: Request, res: Response) => {
    const confirm = req.headers["x-confirm"];
    if (confirm !== "true") {
      return res.status(428).json({ error: "double_verify_required", hint: 'Set header x-confirm: true' });
    }

    const userId = String(req.headers["x-user-id"] ?? "u_demo");
    const actorUserId = String(req.headers["x-actor-user-id"] ?? userId);

    const parsed = collectiveSettingsPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
    }

    const updated = patchSettings(userId, parsed.data, actorUserId);
    res.json(updated);
  });
}
