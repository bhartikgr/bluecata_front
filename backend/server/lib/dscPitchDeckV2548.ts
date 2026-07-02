/**
 * server/lib/dscPitchDeckV2548.ts — v25.48 DSC-1c.
 *
 * Renders the founder's uploaded pitch deck as a CLICKABLE SECURE (signed) link
 * on the DSC review surface. PARALLEL module — no sacred file is edited.
 *
 * Two thin authed endpoints:
 *   GET /api/collective/dsc/pitch-deck/:companyId
 *     → gated by isDscMember (dsc_roles) OR admin. Returns a short-lived,
 *       HMAC-SIGNED download URL for the company's most-recent pitch deck
 *       (never the raw S3 key). 404 when the company has no deck.
 *
 *   GET /api/collective/dsc/pitch-deck/download?token=...
 *     → verifies the HMAC + expiry (constant-time), then streams the object via
 *       objectStorage.getObject(). The token is the credential (short TTL), so
 *       the link is safe to render as an external href.
 *
 * The signed URL is generated server-side (analogous to an object-storage
 * presigned URL) so a DSC reviewer clicks a secure, expiring link — exactly the
 * safeExternalHref pattern the client uses for external links.
 */
import type { Express, Request, Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { isDscMember } from "../adminDscRoutes";
import { listPitchDecksForCompany } from "../collectivePitchDeckStore";
import { getObject } from "./objectStorage";
import { log } from "./logger";

// TTL for a signed pitch-deck link (10 minutes).
const LINK_TTL_MS = 10 * 60 * 1000;

function secret(): string {
  // Reuse JWT_SECRET (already required in production); fall back to a dev value.
  return process.env.JWT_SECRET || process.env.SESSION_COOKIE_SECRET || "dev-pitch-deck-secret";
}

function sign(deckId: string, exp: number): string {
  return createHmac("sha256", secret()).update(`${deckId}.${exp}`).digest("hex");
}

function verify(deckId: string, exp: number, sig: string): boolean {
  if (!deckId || !Number.isFinite(exp) || !sig) return false;
  if (Date.now() > exp) return false;
  const expected = sign(deckId, exp);
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(sig, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function isDscOrAdmin(req: Request): boolean {
  const ctx = (req as Request & { userContext?: { userId?: string; isAdmin?: boolean; isAuthed?: boolean } }).userContext;
  if (!ctx?.isAuthed) return false;
  if (ctx.isAdmin) return true;
  return !!(ctx.userId && isDscMember(ctx.userId));
}

export function registerDscPitchDeckV2548Routes(app: Express): void {
  // Issue a short-lived signed link for the company's latest pitch deck.
  app.get("/api/collective/dsc/pitch-deck/:companyId", (req: Request, res: Response) => {
    const ctx = (req as Request & { userContext?: { isAuthed?: boolean } }).userContext;
    if (!ctx?.isAuthed) return res.status(401).json({ ok: false, error: "unauthorized" });
    if (!isDscOrAdmin(req)) {
      return res.status(403).json({ ok: false, error: "forbidden", message: "DSC member or admin role required." });
    }
    const companyId = String(req.params.companyId);
    const decks = listPitchDecksForCompany(companyId);
    if (decks.length === 0) {
      return res.status(404).json({ ok: false, error: "no_pitch_deck", message: "No pitch deck uploaded for this company." });
    }
    const deck = decks[0]; // most-recent-first
    const exp = Date.now() + LINK_TTL_MS;
    const sig = sign(deck.id, exp);
    const url = `/api/collective/dsc/pitch-deck/download?deckId=${encodeURIComponent(deck.id)}&exp=${exp}&sig=${sig}`;
    return res.json({
      ok: true,
      pitchDeck: {
        id: deck.id,
        companyId: deck.companyId,
        originalName: deck.originalName,
        mimeType: deck.mimeType,
        sizeBytes: deck.sizeBytes,
        uploadedAt: deck.uploadedAt,
      },
      url,          // clickable secure (signed, expiring) link
      expiresAt: new Date(exp).toISOString(),
    });
  });

  // Verify the signed token and stream the object. The token is the credential.
  app.get("/api/collective/dsc/pitch-deck/download", async (req: Request, res: Response) => {
    // Still require an authed DSC/admin session in addition to the signed token
    // (defense-in-depth: the token alone is scoped, but we never serve to anon).
    if (!isDscOrAdmin(req)) {
      return res.status(403).json({ ok: false, error: "forbidden" });
    }
    const deckId = String(req.query.deckId ?? "");
    const exp = Number(req.query.exp ?? 0);
    const sig = String(req.query.sig ?? "");
    if (!verify(deckId, exp, sig)) {
      return res.status(403).json({ ok: false, error: "invalid_or_expired_link" });
    }
    // Resolve the deck row to get its storage key.
    let s3Key: string | null = null;
    let mimeType = "application/octet-stream";
    let originalName = "pitch-deck";
    try {
      // Re-read the deck via a company-scoped list is not possible without the
      // companyId; use a direct id lookup through the store.
      const { getPitchDeck } = await import("../collectivePitchDeckStore");
      const deck = getPitchDeck(deckId);
      if (!deck) return res.status(404).json({ ok: false, error: "not_found" });
      s3Key = deck.s3Key;
      mimeType = deck.mimeType || mimeType;
      originalName = deck.originalName || originalName;
    } catch (err) {
      log.warn("[dscPitchDeckV2548.download] deck lookup failed:", (err as Error).message);
      return res.status(500).json({ ok: false, error: "lookup_failed" });
    }
    try {
      const buf = await getObject(s3Key!);
      if (!buf) return res.status(404).json({ ok: false, error: "object_missing" });
      res.setHeader("Content-Type", mimeType);
      res.setHeader("Content-Disposition", `inline; filename="${originalName.replace(/["\r\n]/g, "")}"`);
      return res.status(200).end(buf);
    } catch (err) {
      log.warn("[dscPitchDeckV2548.download] stream failed:", (err as Error).message);
      return res.status(500).json({ ok: false, error: "stream_failed" });
    }
  });
}
