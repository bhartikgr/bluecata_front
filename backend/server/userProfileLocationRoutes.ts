/**
 * server/userProfileLocationRoutes.ts — W-COLLECTIVE Wave 2 STAGE D (D4).
 *
 * The INVESTOR-FACING way to set the optional self-entered profile location that
 * migration 0120 (`users.location`) declared but nothing could ever populate.
 *
 * Why a self-entered field at all: the two author-location render sites
 * (`client/src/components/comms/PostsFeed.tsx:622-624` and
 * `client/src/pages/PostDetail.tsx:233-235`) show the post author's location.
 * For a FOUNDER that is derived from the company they front (`companies.hq`) —
 * never duplicated into the user row. An INVESTOR has no company, so the value
 * must be theirs to enter, and OPTIONAL: an empty location stays empty and the
 * client renders NOTHING (both sites already guard on `post.authorLocation &&`),
 * not a placeholder and not a guess from IP, tenant or chapter.
 *
 * ENDPOINTS
 *   GET   /api/users/me/location            → { ok, location }   (self only)
 *   PATCH /api/users/me/location  { location: string | null }
 *          Trimmed; max 120 chars; "" or null CLEARS it (a clear is a valid,
 *          supported state, not an error).
 *
 * SELF-ONLY BY CONSTRUCTION. There is no `:userId` parameter, so this surface
 * cannot be used to read or write anyone else's location. Location is not
 * privacy-resolvable in the way a name is — it is either published by its owner
 * or absent — so the safe design is that only the owner can set it, and it is
 * only ever surfaced attached to content that person chose to publish.
 *
 * NO MONEY, no KYC field, no address-of-record: this is a display string. It is
 * deliberately NOT wired to anything in payments, funding, SPV or tax paths.
 * All SQL parameterised. Fail closed.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";

import { rawDb } from "./db/connection";
import { log } from "./lib/logger";

const MAX_LOCATION_LEN = 120;

type Ctx = { userId?: string; isAuthed?: boolean } | undefined;

function ctxOf(req: Request): Ctx {
  return (req as Request & { userContext?: Ctx }).userContext;
}

const patchSchema = z.object({
  location: z.string().max(500).nullable().optional(),
});

/** Read `users.location` for one user. `undefined` when unset/blank/missing. */
export function readUserLocation(userId: string): string | undefined {
  if (typeof userId !== "string" || !userId.trim()) return undefined;
  try {
    const db: any = rawDb();
    const row = db
      .prepare(`SELECT location FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1`)
      .get(userId.trim()) as { location?: string | null } | undefined;
    const v = row?.location;
    if (typeof v !== "string" || !v.trim()) return undefined;
    return v.trim();
  } catch {
    return undefined;
  }
}

export function registerUserProfileLocationRoutes(app: Express): void {
  app.get("/api/users/me/location", (req: Request, res: Response) => {
    const ctx = ctxOf(req);
    if (!ctx?.isAuthed || !ctx.userId) {
      return res.status(401).json({ ok: false, error: "unauthenticated" });
    }
    return res.json({ ok: true, location: readUserLocation(ctx.userId) ?? null });
  });

  app.patch("/api/users/me/location", (req: Request, res: Response) => {
    const ctx = ctxOf(req);
    if (!ctx?.isAuthed || !ctx.userId) {
      return res.status(401).json({ ok: false, error: "unauthenticated" });
    }
    const parsed = patchSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: "invalid", issues: parsed.error.issues });
    }
    const raw = parsed.data.location;
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    if (trimmed.length > MAX_LOCATION_LEN) {
      return res.status(400).json({ ok: false, error: "location_too_long" });
    }
    const next = trimmed.length ? trimmed : null; // "" / null / absent => CLEAR
    try {
      const db: any = rawDb();
      const info = db
        .prepare(`UPDATE users SET location = ? WHERE id = ? AND deleted_at IS NULL`)
        .run(next, ctx.userId);
      if (!info || info.changes === 0) {
        return res.status(404).json({ ok: false, error: "user_not_found" });
      }
    } catch (err) {
      log.error("[userProfileLocation] write failed:", (err as Error).message);
      return res.status(500).json({ ok: false, error: "write_failed" });
    }
    return res.json({ ok: true, location: next });
  });
}

export default registerUserProfileLocationRoutes;
