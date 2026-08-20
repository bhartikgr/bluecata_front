/**
 * W3.3 — Admin pitch-deck download route (NON-sacred, parallel module).
 *
 * Admins should download the stored pitch deck by id, not copy a raw
 * filename string. This route validates admin auth, resolves the deck by id,
 * and streams the bytes from object storage. The raw `s3Key` is never sent to
 * the browser — only sanitized display metadata (see resolvePitchDeckMeta in
 * adminCollectiveRoutes.ts) and this download endpoint are exposed.
 *
 * Mirrors the existing signed-download streaming pattern in
 * server/lib/dscPitchDeckV2548.ts, but reuses the standard requireAdmin guard
 * instead of a signed link (this is an authenticated admin session route, not
 * an externally-shareable link).
 */
import type { Express, Request, Response } from "express";
import { requireAdmin } from "./authMiddleware";
import { getPitchDeck } from "../collectivePitchDeckStore";
import { getObject } from "./objectStorage";
import { appendAdminAudit } from "../adminPlatformStore";
import { log } from "./logger";

type AugReq = Request & { userContext?: { userId?: string } };

export function registerAdminPitchDeckDownloadRoute(app: Express): void {
  app.get(
    "/api/admin/collective/pitch-decks/:deckId/download",
    requireAdmin,
    async (req: AugReq, res: Response) => {
      const deckId = String(req.params.deckId ?? "");
      if (!deckId) return res.status(400).json({ ok: false, error: "deck_id_required" });

      const deck = getPitchDeck(deckId);
      if (!deck) return res.status(404).json({ ok: false, error: "not_found" });

      let buf: Buffer | null = null;
      try {
        buf = await getObject(deck.s3Key);
      } catch (err) {
        log.warn("[adminPitchDeckDownloadRoute] stream failed:", (err as Error).message);
        return res.status(500).json({ ok: false, error: "stream_failed" });
      }
      if (!buf) return res.status(404).json({ ok: false, error: "object_missing" });

      // Audit the download without ever logging the raw storage key.
      try {
        appendAdminAudit(
          req.userContext?.userId ?? "u_unknown",
          `pitch-deck:${deck.id}`,
          "collective.pitch_deck.downloaded",
          { deckId: deck.id, companyId: deck.companyId, applicationId: deck.applicationId },
        );
      } catch { /* non-fatal */ }

      const safeName = (deck.originalName || "pitch-deck").replace(/["\r\n]/g, "");
      res.setHeader("Content-Type", deck.mimeType || "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
      return res.status(200).end(buf);
    },
  );
}
