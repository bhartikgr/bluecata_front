/**
 * WAVE 33 · CP-PIPE-10 — LOCK 1 routes.
 *
 * An engine with no route is not shipped, and a lock nobody can read is not a
 * lock. Three routes:
 *
 *   GET  /api/partner/me/pipeline/lock-notice   — the pipeline surface's notice
 *   GET  /api/admin/lock-text                   — all locks + revision history
 *   PUT  /api/admin/lock-text/:key              — the owner supplies the wording
 *
 * The PUT is the whole point of OQ-5's resolution path: the owner pastes the
 * exact string into the product and it is live, verbatim, with no code change
 * and no redeploy. Nothing here authors, suggests, completes, or defaults any
 * lock wording.
 *
 * All imports STATIC (Wave 32B lazy-require lesson).
 */
import type { Express, Request, Response } from "express";
import { getLock1Notice, listLockNotices, listLockRevisions, setLockText, LockTextError } from "./lockTextStore";
import { LOCK1_TEXT_KEY } from "./lib/lock1Provenance";
import { requirePartnerAuth } from "./lib/requirePartnerAuth";
import { getUserContext } from "./lib/userContext";

export function registerLockTextRoutes(app: Express): void {
  /**
   * The partner pipeline surface's LOCK 1 notice.
   *
   * Partner-authenticated rather than public: the notice belongs to the
   * pipeline surface, and an unauthenticated reader has no pipeline.
   */
  app.get(
    "/api/partner/me/pipeline/lock-notice",
    requirePartnerAuth,
    (req: Request, res: Response) => {
      const partnerId = req.partnerContext?.partnerId;
      if (!partnerId) return res.status(401).json({ error: "AUTH_REQUIRED" });
      try {
        const notice = getLock1Notice();
        res.json({
          key: notice.key,
          supplied: notice.supplied,
          // Verbatim when supplied, null when not. NEVER an approximation:
          // the client has no text of its own to fall back on, by design.
          text: notice.text,
          copy: notice.copy,
          setAt: notice.setAt,
        });
      } catch (err) {
        res.status(500).json({ error: "LOCK_NOTICE_FAILED", message: (err as Error).message });
      }
    },
  );

  app.get("/api/admin/lock-text", (req: Request, res: Response) => {
    const uctx = getUserContext(req);
    if (!uctx?.isAuthed) return res.status(401).json({ error: "AUTH_REQUIRED" });
    if (!uctx.isAdmin) return res.status(403).json({ error: "ADMIN_REQUIRED" });
    try {
      const locks = listLockNotices().map((n) => ({
        key: n.key,
        supplied: n.supplied,
        text: n.text,
        copy: n.copy,
        setBy: n.setBy,
        setAt: n.setAt,
        revisions: listLockRevisions(n.key).length,
      }));
      res.json({ locks, outstanding: locks.filter((l) => !l.supplied).map((l) => l.key) });
    } catch (err) {
      res.status(500).json({ error: "LOCK_LIST_FAILED", message: (err as Error).message });
    }
  });

  app.put("/api/admin/lock-text/:key", (req: Request, res: Response) => {
    const uctx = getUserContext(req);
    if (!uctx?.isAuthed) return res.status(401).json({ error: "AUTH_REQUIRED" });
    if (!uctx.isAdmin) return res.status(403).json({ error: "ADMIN_REQUIRED" });

    const key = String(req.params.key ?? "").trim();
    const text = (req.body ?? {}).text;
    const actor = String(uctx.userId ?? "").trim();

    try {
      // `text` is passed through UNTOUCHED. Verbatim means verbatim: no trim,
      // no normalise. The store validates emptiness against a copy.
      const notice = setLockText({ key, text: typeof text === "string" ? text : "", setBy: actor });
      res.json({
        key: notice.key,
        supplied: notice.supplied,
        text: notice.text,
        copy: notice.copy,
        setBy: notice.setBy,
        setAt: notice.setAt,
      });
    } catch (err) {
      if (err instanceof LockTextError) {
        return res.status(400).json({ error: err.code, message: err.message });
      }
      res.status(500).json({ error: "LOCK_SET_FAILED", message: (err as Error).message });
    }
  });

  /** Revision history for one lock — legal text, so every version is readable. */
  app.get("/api/admin/lock-text/:key/revisions", (req: Request, res: Response) => {
    const uctx = getUserContext(req);
    if (!uctx?.isAuthed) return res.status(401).json({ error: "AUTH_REQUIRED" });
    if (!uctx.isAdmin) return res.status(403).json({ error: "ADMIN_REQUIRED" });
    const key = String(req.params.key ?? "").trim() || LOCK1_TEXT_KEY;
    try {
      res.json({ key, revisions: listLockRevisions(key) });
    } catch (err) {
      res.status(500).json({ error: "LOCK_REVISIONS_FAILED", message: (err as Error).message });
    }
  });
}
