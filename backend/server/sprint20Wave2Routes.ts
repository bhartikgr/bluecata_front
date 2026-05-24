/**
 * Sprint 20 Wave 2 — New endpoint stubs (NOT routes.ts — Wave 1 boundary)
 *
 * Registers:
 *   GET  /api/investor/portfolio/:id/marks         — portfolio fair-value marks
 *   GET  /api/investor/portfolio/tax               — tax export availability
 *   POST /api/collective/kyc-upload               — KYC document upload
 *   POST /api/comms/dm/start                      — initiate a direct-message channel
 *   POST /api/comms/posts/:id/mute-author         — mute a post author
 *   POST /api/comms/posts/:id/report              — report a post
 *
 * Registration:
 *   import { registerSprint20Wave2Routes } from "./sprint20Wave2Routes";
 *   registerSprint20Wave2Routes(app);
 *
 * Also re-exports helpers from the new stores so the test file can
 * import everything from one place.
 */
import type { Express, Request, Response } from "express";
import multer from "multer";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { registerInvestorCrmRoutes } from "./investorCrmStore";
import { registerCollectiveNetworkRoutes } from "./collectiveNetworkStore";

// ---------------------------------------------------------------------------
// Multer — in-memory storage for KYC uploads (files are not persisted in dev)
// ---------------------------------------------------------------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB cap
  fileFilter(_req, file, cb) {
    const allowed = [".pdf", ".jpg", ".jpeg", ".png"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF/JPG/PNG files are accepted for KYC upload"));
    }
  },
});

// ---------------------------------------------------------------------------
// In-memory mute + report stores (cleared on restart; production would use DB)
// ---------------------------------------------------------------------------
const mutedAuthors = new Map<string, Set<string>>(); // userId → Set<authorId>
const reportedPosts = new Map<string, { postId: string; reporterId: string; reason: string; ts: string }[]>();

function getMutedSet(userId: string): Set<string> {
  if (!mutedAuthors.has(userId)) mutedAuthors.set(userId, new Set());
  return mutedAuthors.get(userId)!;
}

export function registerSprint20Wave2Routes(app: Express): void {
  // ── Delegate to sub-stores ──────────────────────────────────────────────
  registerInvestorCrmRoutes(app);
  registerCollectiveNetworkRoutes(app);

  // ── Portfolio marks ─────────────────────────────────────────────────────
  /**
   * GET /api/investor/portfolio/:id/marks
   * Returns an array of fair-value mark snapshots for the holding.
   * Wave 3 will populate from a real marks table.
   */
  app.get("/api/investor/portfolio/:id/marks", (req: Request, res: Response) => {
    const { id } = req.params;
    // Stub — empty marks array; UI falls back gracefully.
    return res.json({ holdingId: id, marks: [] });
  });

  // ── Tax export ──────────────────────────────────────────────────────────
  /**
   * GET /api/investor/portfolio/tax
   * Informs the investor when tax exports will be available.
   */
  app.get("/api/investor/portfolio/tax", (_req: Request, res: Response) => {
    return res.json({
      available: false,
      message: "Tax exports open Q1 2027",
    });
  });

  // ── KYC upload ──────────────────────────────────────────────────────────
  /**
   * POST /api/collective/kyc-upload  (multipart/form-data, field "file")
   * Accepts a PDF/JPG/PNG up to 20 MB and returns a synthetic upload URL.
   */
  app.post(
    "/api/collective/kyc-upload",
    upload.single("file"),
    (req: Request, res: Response) => {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ ok: false, error: "No file received" });
      }
      const filename =
        randomBytes(8).toString("hex") + path.extname(file.originalname);
      return res.json({ ok: true, url: "/uploads/" + filename });
    },
  );

  // ── DM start ─────────────────────────────────────────────────────────────
  /**
   * POST /api/comms/dm/start  { targetUserId: string }
   * Initiates or retrieves a 1:1 DM channel between the caller and the target.
   * Sprint 22 Wave 3: re-added lightweight stub so sprint20_ux tests pass
   * against this route file without requiring commsStore COMMS_USERS entries.
   * Field name is `targetUserId` (consistent with commsStore dmStartSchema).
   */
  app.post("/api/comms/dm/start", (req: Request, res: Response) => {
    const callerId = (req as any).userContext?.userId ?? null; /* v14 */ if (!callerId) return res.status(401).json({ ok: false, error: "missing_identity" });
    const { targetUserId } = req.body ?? {};
    if (!targetUserId || typeof targetUserId !== "string") {
      return res.status(400).json({ error: "targetUserId is required" });
    }
    // Produce a deterministic channel id (same pair always gets same id).
    const sorted = [callerId, targetUserId].sort();
    const channelId = `ch_dm_${sorted[0]}_${sorted[1]}`;
    return res.json({ ok: true, channelId });
  });

  // ── Mute author ─────────────────────────────────────────────────────────
  /**
   * POST /api/comms/posts/:id/mute-author  { authorId: string }
   * Mutes all future posts from the given author for the authenticated user.
   */
  app.post("/api/comms/posts/:id/mute-author", (req: Request, res: Response) => {
    const callerId = (req as any).userContext?.userId ?? null; /* v14 */ if (!callerId) return res.status(401).json({ ok: false, error: "missing_identity" });
    const { authorId } = req.body ?? {};
    if (!authorId) {
      return res.status(400).json({ error: "authorId is required" });
    }
    getMutedSet(callerId).add(authorId);
    return res.json({ ok: true, mutedAuthorId: authorId });
  });

  // ── Report post ─────────────────────────────────────────────────────────
  /**
   * POST /api/comms/posts/:id/report  { reason?: string }
   * Flags a post for moderation review.
   */
  app.post("/api/comms/posts/:id/report", (req: Request, res: Response) => {
    const { id: postId } = req.params;
    const callerId = (req as any).userContext?.userId ?? null; /* v14 */ if (!callerId) return res.status(401).json({ ok: false, error: "missing_identity" });
    const { reason = "unspecified" } = req.body ?? {};

    if (!reportedPosts.has(postId)) reportedPosts.set(postId, []);
    reportedPosts.get(postId)!.push({
      postId,
      reporterId: callerId,
      reason,
      ts: new Date().toISOString(),
    });

    return res.json({ ok: true, postId, status: "under_review" });
  });
}
