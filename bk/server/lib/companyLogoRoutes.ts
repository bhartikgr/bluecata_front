/**
 * v23.4.7 Phase 13 / BUG 030 — Company logo upload.
 *
 * Bug: the founder Company-profile form used to read the picked file via
 * FileReader, store the resulting base64 data URL in form state, and ship
 * that megabyte-sized payload back to the PATCH /api/companies/:id endpoint
 * on every save. The form is large and any keystroke caused a re-render of
 * the data URL field, which (combined with the focus-loss-after-pick
 * behavior) regularly produced stale-save bugs.
 *
 * Fix: add a dedicated endpoint that accepts a small image file via
 * multipart/form-data, persists it server-side (in-memory in dev — same
 * pattern as the existing KYC-upload + dataroom-upload routes), and returns
 * a short URL the form can store as a plain string. The form state then
 * carries ONLY that URL, not the base64 bytes.
 *
 * Accepted: image/jpeg, image/png, image/webp. Max 2 MB.
 * URL shape: GET /api/founder/company/:id/logo serves the latest upload.
 */
import type { Express, Request, Response } from "express";
import multer from "multer";
import path from "node:path";
import { rawDb } from "../db/connection";
import { log } from "./logger";

/**
 * v25.10 fix H1 — company logos are now persisted to SQLite.
 *
 * The previous implementation kept logos only in this in-memory Map, so
 * every uploaded logo was lost on server restart. The Map is preserved as
 * a hot cache (avoids a DB round-trip on every GET /logo request) but the
 * authoritative copy lives in the `company_logos` table, which is created
 * lazily and hydrated at boot via hydrateCompanyLogos().
 */
interface LogoEntry { buf: Buffer; mime: string; ext: string }
const logoStore = new Map<string, LogoEntry>();
let logoTableEnsured = false;

function ensureLogoTable(): boolean {
  if (logoTableEnsured) return true;
  try {
    const db: any = rawDb();
    db.exec(`CREATE TABLE IF NOT EXISTS company_logos (
      company_id TEXT PRIMARY KEY NOT NULL,
      mime TEXT NOT NULL,
      ext TEXT NOT NULL,
      payload BLOB NOT NULL,
      updated_at TEXT NOT NULL
    );`);
    logoTableEnsured = true;
    return true;
  } catch (err) {
    log.warn({
      route: "companyLogoRoutes.ensureLogoTable",
      message: `CREATE TABLE failed (non-fatal): ${(err as Error).message}`,
    });
    return false;
  }
}

function persistLogo(companyId: string, entry: LogoEntry): void {
  if (!ensureLogoTable()) return;
  try {
    const db: any = rawDb();
    db.prepare(
      `INSERT INTO company_logos (company_id, mime, ext, payload, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(company_id) DO UPDATE SET
         mime = excluded.mime,
         ext = excluded.ext,
         payload = excluded.payload,
         updated_at = excluded.updated_at`,
    ).run(companyId, entry.mime, entry.ext, entry.buf, new Date().toISOString());
  } catch (err) {
    log.warn({
      route: "companyLogoRoutes.persistLogo",
      message: `${companyId} persist failed: ${(err as Error).message}`,
    });
  }
}

function deletePersistedLogo(companyId: string): void {
  if (!ensureLogoTable()) return;
  try {
    const db: any = rawDb();
    db.prepare(`DELETE FROM company_logos WHERE company_id = ?`).run(companyId);
  } catch (err) {
    log.warn({
      route: "companyLogoRoutes.deletePersistedLogo",
      message: `${companyId} delete failed: ${(err as Error).message}`,
    });
  }
}

/**
 * Restore the in-memory logo Map from the company_logos table. Called from
 * HYDRATE_ORDER in lib/hydrateStores.ts.
 */
export function hydrateCompanyLogos(): number {
  if (!ensureLogoTable()) return 0;
  try {
    const db: any = rawDb();
    const rows: any[] = db
      .prepare(`SELECT company_id, mime, ext, payload FROM company_logos`)
      .all();
    let n = 0;
    for (const r of rows) {
      const p: any = r.payload;
      const buf: Buffer = Buffer.isBuffer(p) ? p : Buffer.from(p);
      logoStore.set(r.company_id, { buf, mime: r.mime, ext: r.ext });
      n++;
    }
    return n;
  } catch (err) {
    log.warn({
      route: "companyLogoRoutes.hydrate",
      message: `hydrate failed: ${(err as Error).message}`,
    });
    return 0;
  }
}

/** Test-only accessor so unit tests can read what got stored. */
export const _logoStoreForTest = logoStore;

const ALLOWED_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB cap (logos are small).
  fileFilter(_req, file, cb) {
    if (ALLOWED_MIMES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only image/jpeg, image/png, image/webp are accepted."));
    }
  },
});

function extForMime(mime: string, originalName: string): string {
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  return path.extname(originalName) || ".bin";
}

export function registerCompanyLogoRoutes(app: Express): void {
  /**
   * POST /api/founder/company/:id/logo
   * multipart/form-data, field name: "logo" (or "file" for compat).
   * Response: { ok: true, url: "/api/founder/company/:id/logo" }
   */
  app.post(
    "/api/founder/company/:id/logo",
    (req, res, next) => {
      // Accept either field name so existing harnesses that POST "file" work.
      const handler = upload.fields([
        { name: "logo", maxCount: 1 },
        { name: "file", maxCount: 1 },
      ]);
      handler(req, res, (err) => {
        if (err) {
          return res
            .status(400)
            .json({ ok: false, error: (err as Error).message });
        }
        next();
      });
    },
    (req: Request, res: Response) => {
      const id = String(req.params.id || "").trim();
      if (!id) return res.status(400).json({ ok: false, error: "company id required" });
      const files = (req as Request & { files?: Record<string, Express.Multer.File[]> }).files ?? {};
      const file =
        (files.logo && files.logo[0]) ||
        (files.file && files.file[0]) ||
        null;
      if (!file) {
        return res
          .status(400)
          .json({ ok: false, error: "No file uploaded. Use multipart/form-data with field 'logo'." });
      }
      const mime = file.mimetype;
      if (!ALLOWED_MIMES.has(mime)) {
        return res.status(400).json({ ok: false, error: "Unsupported image type." });
      }
      const ext = extForMime(mime, file.originalname);
      const entry: LogoEntry = { buf: file.buffer, mime, ext };
      logoStore.set(id, entry);
      /* v25.10 fix H1 — write-through to DB so logos survive restart. */
      persistLogo(id, entry);
      const url = `/api/founder/company/${encodeURIComponent(id)}/logo`;
      return res.json({ ok: true, url });
    },
  );

  /**
   * GET /api/founder/company/:id/logo
   * Returns the latest uploaded logo bytes for the company.
   */
  app.get("/api/founder/company/:id/logo", (req: Request, res: Response) => {
    const id = String(req.params.id || "").trim();
    const entry = logoStore.get(id);
    if (!entry) return res.status(404).json({ ok: false, error: "no logo set" });
    res.setHeader("Content-Type", entry.mime);
    res.setHeader("Content-Disposition", `inline; filename="logo${entry.ext}"`);
    return res.send(entry.buf);
  });

  /**
   * DELETE /api/founder/company/:id/logo
   * Clears the stored logo.
   */
  app.delete("/api/founder/company/:id/logo", (req: Request, res: Response) => {
    const id = String(req.params.id || "").trim();
    const had = logoStore.delete(id);
    /* v25.10 fix H1 — also delete the persisted row. */
    deletePersistedLogo(id);
    return res.json({ ok: true, deleted: had });
  });
}
