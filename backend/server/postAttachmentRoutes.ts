/**
 * v25.47 APD-024 — Network post attachment routes.
 *
 *   GET  /api/posts/:id/attachments   (authed) — list descriptors
 *   POST /api/posts/:id/attachments   (authed) — multipart `file` upload
 *
 * Validation (MIME allow-list + 15MB cap) + storage + persistence live in
 * server/postAttachmentsStore.ts. Multer caps the request body at 15MB so an
 * oversize upload is rejected before buffering completes.
 */
import type { Express, Request, Response } from "express";
import multer from "multer";
import { requireAuth } from "./lib/authMiddleware";
import { sanitizeErrorMessage } from "./lib/sanitize";
import { log } from "./lib/logger";
import {
  listAttachments,
  addAttachment,
  MAX_ATTACHMENT_BYTES,
  AttachmentValidationError,
} from "./postAttachmentsStore";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_BYTES },
});

export function registerPostAttachmentRoutes(app: Express): void {
  app.get("/api/posts/:id/attachments", requireAuth, (req: Request, res: Response) => {
    try {
      return res.json({ ok: true, attachments: listAttachments(String(req.params.id)) });
    } catch (err) {
      log.error("[postAttachmentRoutes.list] failed:", (err as Error).message);
      return res
        .status(500)
        .json({ ok: false, error: "read_failed", message: sanitizeErrorMessage(err) });
    }
  });

  app.post(
    "/api/posts/:id/attachments",
    requireAuth,
    (req: Request, res: Response) => {
      upload.single("file")(req, res, async (uploadErr: unknown) => {
        if (uploadErr) {
          const code =
            (uploadErr as { code?: string })?.code === "LIMIT_FILE_SIZE"
              ? "too_large"
              : "upload_failed";
          return res
            .status(400)
            .json({ ok: false, error: code, message: sanitizeErrorMessage(uploadErr) });
        }
        const file = (req as Request & { file?: Express.Multer.File }).file;
        if (!file) {
          return res.status(400).json({
            ok: false,
            error: "no_file",
            message: "Use multipart/form-data with field 'file'.",
          });
        }
        try {
          const result = await addAttachment({
            postId: String(req.params.id),
            buffer: file.buffer,
            mimeType: file.mimetype,
            originalName: file.originalname || "attachment",
          });
          return res
            .status(201)
            .json({ ok: true, attachment: result.attachment, attachments: result.attachments });
        } catch (err) {
          if (err instanceof AttachmentValidationError) {
            const status = err.code === "post_not_found" ? 404 : 400;
            return res.status(status).json({ ok: false, error: err.code, message: err.message });
          }
          log.error("[postAttachmentRoutes.add] failed:", (err as Error).message);
          return res
            .status(500)
            .json({ ok: false, error: "attach_failed", message: sanitizeErrorMessage(err) });
        }
      });
    },
  );

  log.info("[v25.47 APD-024] registered post-attachment routes");
}

export default registerPostAttachmentRoutes;
