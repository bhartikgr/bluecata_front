/**
 * server/investorMediaRoutes.ts — v25.56 Avi wave item 1a (NON-sacred).
 *
 * The client (client/src/pages/investor/Profile.tsx) POSTs the investor's
 * profile picture to `POST /api/investors/:id/avatar`, but NO server route ever
 * existed — the request fell through to the SPA/API catch-all (server/index.ts)
 * and returned `{error:"not_found"}` for *everyone* (it just surfaced first on a
 * redeemed investor). This adds the missing route in non-sacred code.
 *
 * Storage mirrors the existing KYC-upload pattern in the sacred profileStore:
 * multer memory storage, we record the file metadata (name + size + sha256) and
 * set `profile.profilePictureName`. We persist by writing the durable
 * `profilestore_investor_profile` row directly (same UPSERT the sacred store
 * uses) and then re-hydrating the profile Map via the exported
 * `hydrateProfileStore` — so we NEVER edit the sacred profileStore.ts.
 */
import type { Express, Request, Response } from "express";
import { createHash } from "node:crypto";
import multer from "multer";
import { rawDb } from "./db/connection";
import { hydrateProfileStore } from "./profileStore";
import { makeEmptyInvestorProfile } from "./lib/emptyInvestorProfile";
import { SEED_INVESTOR_PROFILE } from "../client/src/lib/profile/seed";
import type { InvestorProfile } from "../client/src/lib/profile/types";
import { requireAuth } from "./lib/authMiddleware";
import { log } from "./lib/logger";

type AuthedReq = Request & {
  userContext?: { userId?: string; isAdmin?: boolean; identity?: { email?: string } };
};

function readDurableProfile(investorId: string): InvestorProfile | null {
  try {
    const row = rawDb()
      .prepare(`SELECT profile_json FROM profilestore_investor_profile WHERE investor_id = ? AND deleted_at IS NULL`)
      .get(investorId) as { profile_json?: string } | undefined;
    if (!row?.profile_json) return null;
    return JSON.parse(row.profile_json) as InvestorProfile;
  } catch {
    return null;
  }
}

function writeDurableProfile(investorId: string, profile: InvestorProfile): void {
  rawDb()
    .prepare(
      `INSERT INTO profilestore_investor_profile (investor_id, profile_json, updated_at, deleted_at)
       VALUES (?, ?, ?, NULL)
       ON CONFLICT(investor_id) DO UPDATE SET
         profile_json = excluded.profile_json,
         updated_at = excluded.updated_at,
         deleted_at = NULL`,
    )
    .run(investorId, JSON.stringify(profile), new Date().toISOString());
}

export function registerInvestorMediaRoutes(app: Express): void {
  // Image-only, 5MB cap, single file under field "avatar".
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (/^image\//.test(file.mimetype)) return cb(null, true);
      cb(new Error("Only image files are allowed."));
    },
  });

  app.post(
    "/api/investors/:id/avatar",
    requireAuth,
    (req: Request, res: Response, next) => {
      upload.single("avatar")(req, res, (err: unknown) => {
        if (err) {
          return res.status(400).json({ ok: false, message: (err as Error).message || "Upload failed." });
        }
        next();
      });
    },
    async (req: Request, res: Response) => {
      const id = String(req.params.id);
      const ctx = (req as AuthedReq).userContext;
      if (!ctx?.userId) return res.status(401).json({ ok: false, message: "missing_identity" });
      // Owner or admin only.
      if (ctx.userId !== id && !ctx.isAdmin) {
        return res.status(403).json({ ok: false, message: "not_authorized" });
      }

      const file = (req as Request & { file?: { originalname: string; size: number; buffer: Buffer; mimetype: string } }).file;
      if (!file) return res.status(400).json({ ok: false, message: "No file uploaded." });

      try {
        // Resolve the current profile (durable → else synthesise a blank one for
        // the owner, same tenant/email the GET route would use).
        const current =
          readDurableProfile(id) ??
          makeEmptyInvestorProfile(id, SEED_INVESTOR_PROFILE.tenantId, ctx.identity?.email ?? "");

        const filename = file.originalname;
        const sha256 = createHash("sha256").update(file.buffer).digest("hex");

        const patched: InvestorProfile = {
          ...current,
          profile: { ...current.profile, profilePictureName: filename },
          updatedAt: new Date().toISOString(),
        };
        writeDurableProfile(id, patched);
        await hydrateProfileStore();

        return res.json({ ok: true, filename, sha256, sizeBytes: file.size });
      } catch (err) {
        log.warn("[investorMediaRoutes] avatar upload failed:", (err as Error).message);
        return res.status(500).json({ ok: false, message: "Could not save avatar." });
      }
    },
  );
}
