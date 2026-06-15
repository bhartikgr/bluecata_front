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
// Persistent mute + report stores (v25.11 NM2)
// Backed by the kv shim so mute preferences and content reports survive restart.
// The Maps remain the hot read path; the shim is the durable write-through.
// ---------------------------------------------------------------------------
const mutedAuthors = new Map<string, Set<string>>(); // userId → Set<authorId>
const reportedPosts = new Map<string, { postId: string; reporterId: string; reason: string; ts: string }[]>();

function getMutedSet(userId: string): Set<string> {
  if (!mutedAuthors.has(userId)) mutedAuthors.set(userId, new Set());
  return mutedAuthors.get(userId)!;
}

/**
 * v25.11 NM2 — rebuild the in-memory Maps from kv on boot. Wired into
 * HYDRATE_ORDER so deploys do not lose user mute preferences or pending
 * moderation reports.
 */
export function hydrateSprint20Wave2Stores(): number {
  let n = 0;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { hydrateEntries } = require("./lib/storePersistenceShim");
    const mutedRows = hydrateEntries("mutedAuthors") as Array<[string, string[]]>;
    if (Array.isArray(mutedRows)) {
      for (const [userId, arr] of mutedRows) {
        if (typeof userId !== "string" || !Array.isArray(arr)) continue;
        mutedAuthors.set(userId, new Set(arr.filter((x) => typeof x === "string")));
        n += 1;
      }
    }
    const reportRows = hydrateEntries("reportedPosts") as Array<[
      string,
      { postId: string; reporterId: string; reason: string; ts: string }[],
    ]>;
    if (Array.isArray(reportRows)) {
      for (const [postId, arr] of reportRows) {
        if (typeof postId !== "string" || !Array.isArray(arr)) continue;
        reportedPosts.set(postId, arr);
        n += 1;
      }
    }
  } catch {
    /* shim unavailable — first boot or migration */
  }
  return n;
}

function persistMutedAuthors(userId: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { persistEntry } = require("./lib/storePersistenceShim");
    persistEntry("mutedAuthors", userId, Array.from(getMutedSet(userId)));
  } catch { /* non-fatal */ }
}

function persistReportedPosts(postId: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { persistEntry } = require("./lib/storePersistenceShim");
    persistEntry("reportedPosts", postId, reportedPosts.get(postId) ?? []);
  } catch { /* non-fatal */ }
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
  /* v25.11 NH2 fix — the previous handler used multer.memoryStorage() and
   * returned a synthetic /uploads/<random>.<ext> URL. The file bytes were
   * never written anywhere, so the URL pointed at nothing — compliance
   * blocker. This handler now writes the bytes to the kyc_documents SQLite
   * table (BLOB column) and returns a real URL /api/collective/kyc-document/:id
   * which the matching GET serves below. */
  app.post(
    "/api/collective/kyc-upload",
    upload.single("file"),
    (req: Request, res: Response) => {
      const ctx = (req as any).userContext;
      if (!ctx?.isAuthed) {
        return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
      }
      const file = req.file;
      if (!file) {
        return res.status(400).json({ ok: false, error: "No file received" });
      }
      const id = randomBytes(12).toString("hex");
      const ext = path.extname(file.originalname || "").slice(0, 8);
      const url = `/api/collective/kyc-document/${id}`;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { rawDb } = require("./db/connection");
        const db: any = rawDb();
        /* v25.11 NH2 — we use a distinct table name (collective_kyc_blobs)
         * to avoid colliding with the legacy kyc_documents schema owned
         * by kycDocumentStore.ts. That earlier table has its own columns
         * (investor_id / doc_type / blob_base64) and is consumed by a
         * different compliance flow. */
        db.exec(`CREATE TABLE IF NOT EXISTS collective_kyc_blobs (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL,
          field TEXT,
          original_name TEXT NOT NULL,
          mime TEXT NOT NULL,
          ext TEXT NOT NULL,
          payload BLOB NOT NULL,
          created_at TEXT NOT NULL
        );`);
        db.prepare(
          `INSERT INTO collective_kyc_blobs (id, user_id, field, original_name, mime, ext, payload, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          ctx.userId,
          String((req.body && req.body.field) || "").slice(0, 60),
          (file.originalname || "").slice(0, 200),
          file.mimetype || "application/octet-stream",
          ext,
          file.buffer,
          new Date().toISOString(),
        );
      } catch (err) {
        return res.status(500).json({ ok: false, error: "persist_failed", message: (err as Error).message });
      }
      return res.json({ ok: true, id, url });
    },
  );

  /* v25.11 NH2 — GET endpoint to retrieve a previously-uploaded KYC document
   * blob. The owner can fetch their own; admins can fetch any (for compliance
   * review). Narrow surface: no listing, only direct by-id reads. */
  app.get(
    "/api/collective/kyc-document/:id",
    (req: Request, res: Response) => {
      const ctx = (req as any).userContext;
      if (!ctx?.isAuthed) {
        return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
      }
      const id = String(req.params.id || "");
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { rawDb } = require("./db/connection");
        const db: any = rawDb();
        const row: any = db.prepare(
          `SELECT user_id, mime, ext, payload, original_name FROM collective_kyc_blobs WHERE id = ?`,
        ).get(id);
        if (!row) return res.status(404).json({ ok: false, error: "not_found" });
        if (!ctx.isAdmin && row.user_id !== ctx.userId) {
          return res.status(403).json({ ok: false, error: "not_owner" });
        }
        const p: any = row.payload;
        const buf: Buffer = Buffer.isBuffer(p) ? p : Buffer.from(p);
        res.setHeader("Content-Type", row.mime || "application/octet-stream");
        res.setHeader(
          "Content-Disposition",
          `inline; filename="${String(row.original_name || "kyc" + (row.ext || "")).replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
        );
        return res.send(buf);
      } catch (err) {
        return res.status(500).json({ ok: false, error: "read_failed", message: (err as Error).message });
      }
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
  /* v25.8 Bug 3 fix — this duplicate /api/comms/dm/start handler was
   * pre-empting the real handler in commsStore.ts (Express dispatches in
   * registration order, and sprint20Wave2Routes registers before commsStore).
   * The duplicate only returned a deterministic channelId without actually
   * persisting a channel row, so subsequent POSTs to
   * /api/comms/channels/:id/messages 404'd — messages never sent.
   * Avi: "Messages are still not being sent."
   *
   * The real handler in commsStore.ts:1791 performs:
   *   - Permission check via resolveDisplayIdentity / sharedContextBetween
   *   - CRM-bridge fallback so founder ↔ invited-investor DMs work
   *   - Actual channel object creation in the channels Map
   *   - dm.channel.opened outbox event
   *
   * We now no-op here and let commsStore handle it. */

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
    persistMutedAuthors(callerId);
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
    persistReportedPosts(postId);

    return res.json({ ok: true, postId, status: "under_review" });
  });
}
