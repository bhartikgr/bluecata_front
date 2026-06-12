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

/** In-memory store: companyId → { buf, mime, ext } */
const logoStore = new Map<string, { buf: Buffer; mime: string; ext: string }>();

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
      logoStore.set(id, { buf: file.buffer, mime, ext });
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
    return res.json({ ok: true, deleted: had });
  });
}
