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
import { assertCompanyOwnership } from "./requireIdentity";

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
   *
   * ── WAVE 57d · D1 — THE OTHER HALF OF THE SAME HOLE ───────────────────────
   *
   * Wave 57c closed the cross-tenant IDOR on the DELETE below but left THIS
   * handler with ZERO ownership checks (independent Review 1, W57C_REVIEW_1_
   * SECURITY.md "Bypass found: unauthorised POST overwrite"). It read `:id`
   * straight off the path and replaced BOTH the hot cache entry and the durable
   * `company_logos` row for that id. The `/api/founder` prefix mount supplies
   * only `requireAuth`, so any authenticated principal of any persona could
   * overwrite any company's logo bytes — which destroys the previous bytes just
   * as permanently as the DELETE did, and was equally unaudited.
   *
   * The fix is deliberately the SAME two patterns the DELETE path now uses, not
   * a new mechanism:
   *   1. `assertCompanyOwnership(req, companyId)` awaited BEFORE the first
   *      mutating statement (401 `missing_identity` with no session, 403
   *      `not_authorized` when the caller is neither a platform admin nor a
   *      member of the company, with a `company_members` DB re-check for a
   *      stale in-memory context).
   *   2. `appendAdminAudit(<resolved identity>, …)` afterwards, with the
   *      `X-Audit-Warning` header on failure. Wave 57d · D2 additionally makes
   *      that header REACHABLE by inspecting the writer's empty-hash sentinel.
   *
   * NOT changed here, deliberately: the upload is still a destructive overwrite
   * of the previous bytes (no version history), the GET remains ungated, and the
   * 2 MB / three-MIME limits are untouched. Converting to versioned storage
   * would need a schema change and is reported as a recommendation, not taken.
   * ─────────────────────────────────────────────────────────────────────────── */
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
    async (req: Request, res: Response) => {
      const id = String(req.params.id || "").trim();
      if (!id) return res.status(400).json({ ok: false, error: "company id required" });

      /* WAVE 57d D1 — fail closed on identity AND ownership BEFORE the first
         mutating statement. Mirrors the DELETE path below exactly, including the
         status mapping (this path is not behind the centralised error
         middleware, so forwarding to next() would surface as a 500). */
      let actorUserId: string;
      try {
        const identity = await assertCompanyOwnership(req, id);
        actorUserId = identity.userId;
      } catch (err) {
        const e = err as Error & { status?: number; code?: string };
        const status = e.status === 401 ? 401 : 403;
        return res.status(status).json({
          ok: false,
          error: e.code ?? (status === 401 ? "missing_identity" : "not_authorized"),
          code: e.code ?? (status === 401 ? "missing_identity" : "not_authorized"),
        });
      }

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
      const replacedExisting = logoStore.has(id);
      logoStore.set(id, entry);
      /* v25.10 fix H1 — write-through to DB so logos survive restart. */
      persistLogo(id, entry);

      /* WAVE 57d D1 — bound-actor audit entry for the overwrite. Same shape as
         the DELETE path. A failed audit does NOT fail the upload (the bytes are
         already replaced by then); it is made VISIBLE via X-Audit-Warning, and
         WAVE 57d D2 makes that visibility actually fire on a DB write failure by
         inspecting the writer's empty-hash sentinel. */
      try {
        const { appendAdminAudit, isAuditWriteFailure } = await import("../adminPlatformStore");
        const written = appendAdminAudit(
          actorUserId,
          `company:${id}`,
          "company.logo.replaced",
          {
            companyId: id,
            mime,
            bytes: file.buffer.length,
            replacedExisting,
            hardOverwrite: true,
          },
        );
        if (isAuditWriteFailure(written)) {
          res.setHeader("X-Audit-Warning", "audit_log_write_failed");
          log.error({
            route: "companyLogoRoutes.post",
            errorType: "AUDIT_DB_WRITE_FAILED",
            message: `audit row for company.logo.replaced ${id} was NOT written`,
          });
        }
      } catch (err) {
        res.setHeader("X-Audit-Warning", "audit_log_write_failed");
        log.warn({
          route: "companyLogoRoutes.post",
          message: `audit append failed for ${id}: ${(err as Error).message}`,
        });
      }

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
   *
   * ── WAVE 57c · ITEM 1 (R37 order #1) — CROSS-TENANT IDOR CLOSED ───────────
   *
   * Before this wave the handler read `:id` straight off the path and destroyed
   * that company's logo bytes with NO ownership check and NO audit entry. The
   * `/api/founder` prefix mount only supplies `requireAuth`
   * (server/lib/applyRouteGuards.ts:109 → `requireAuth` for `/api/founder/`),
   * so ANY authenticated principal of ANY persona — a founder of another
   * tenant, an investor, a partner team member — could permanently delete any
   * company's logo by knowing or guessing its id. It was the only true
   * cross-tenant IDOR in the destructive-endpoint sweep
   * (build_log/wave57c/DESTRUCTIVE_ENDPOINT_SWEEP.md F1), and because it wrote
   * no audit record the destruction was also undetectable after the fact.
   *
   * The fix reuses the two patterns that already exist in this tree rather than
   * inventing new ones:
   *   1. `assertCompanyOwnership(req, companyId)` (server/lib/requireIdentity.ts)
   *      — the same helper the founder surface already uses. It throws 401
   *      `missing_identity` with no session, 403 `not_authorized` when the
   *      caller is neither a platform admin nor a member of the company, and
   *      it double-checks `company_members` in the DB when the in-memory
   *      context is stale. Ownership is asserted BEFORE anything mutates.
   *   2. `appendAdminAudit(actor, …)` + the `X-Audit-Warning` response header
   *      on audit-write failure — the pattern at
   *      server/lib/adminUsersRoutes.ts:265. The actor is the resolved session
   *      identity, never a `"system"`-shaped placeholder (R35 / Repair Wave 1).
   *
   * The audit append is a DYNAMIC import: `adminPlatformStore` is a large
   * module that transitively reaches the bridge/store graph, and the same
   * dynamic-import precedent is used at server/bridgeStore.ts:1541 for exactly
   * this reason. A failed audit does NOT fail the delete (the bytes are already
   * gone by then); it surfaces as `X-Audit-Warning`.
   *
   * WAVE 57d · D2 CORRECTION TO THIS COMMENT: as shipped in 57c the sentence
   * "so it is never silent" was FALSE. `appendAudit` catches its own DB write
   * failure and returns an empty-hash sentinel instead of throwing, so the
   * try/catch below never ran for the principal failure mode and the header was
   * unreachable. The returned entry is now checked with `isAuditWriteFailure()`,
   * which is what makes the claim true. It is a VISIBILITY guarantee only — the
   * delete is still audit-fail-OPEN by design.
   *
   * NOT changed here, deliberately: the delete is still a hard delete of the
   * bytes. R37 order #1 authorises "the ownership assertion and the audit
   * entry"; converting to soft delete would need a `company_logos.deleted_at`
   * column and is reported as an open item, not taken unilaterally.
   * ────────────────────────────────────────────────────────────────────────── */
  app.delete("/api/founder/company/:id/logo", async (req: Request, res: Response) => {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ ok: false, error: "company id required" });

    /* WAVE 57c ITEM 1 — fail closed on identity AND on ownership, before the
       first destructive statement. `assertCompanyOwnership` throws with
       `err.status` set; this handler is not mounted behind the centralised
       error middleware for this path, so the status is mapped here rather than
       forwarded to next(), which would have produced a 500. */
    let actorUserId: string;
    try {
      const identity = await assertCompanyOwnership(req, id);
      actorUserId = identity.userId;
    } catch (err) {
      const e = err as Error & { status?: number; code?: string };
      const status = e.status === 401 ? 401 : 403;
      return res.status(status).json({
        ok: false,
        error: e.code ?? (status === 401 ? "missing_identity" : "not_authorized"),
        code: e.code ?? (status === 401 ? "missing_identity" : "not_authorized"),
      });
    }

    const had = logoStore.delete(id);
    /* v25.10 fix H1 — also delete the persisted row. */
    deletePersistedLogo(id);

    /* WAVE 57c ITEM 1 — bound-actor audit entry.
       WAVE 57d D2 — the writer swallows its own DB failure and returns an
       empty-hash sentinel instead of throwing, so this catch alone never fired
       for the principal failure mode and the header below was dead code. The
       returned entry is now inspected. This makes the failure VISIBLE; it does
       NOT make the delete fail-closed (the bytes are already gone above). */
    try {
      const { appendAdminAudit, isAuditWriteFailure } = await import("../adminPlatformStore");
      const written = appendAdminAudit(
        actorUserId,
        `company:${id}`,
        "company.logo.deleted",
        { companyId: id, hadLogo: had, hardDelete: true },
      );
      if (isAuditWriteFailure(written)) {
        res.setHeader("X-Audit-Warning", "audit_log_write_failed");
        log.error({
          route: "companyLogoRoutes.delete",
          errorType: "AUDIT_DB_WRITE_FAILED",
          message: `audit row for company.logo.deleted ${id} was NOT written`,
        });
      }
    } catch (err) {
      res.setHeader("X-Audit-Warning", "audit_log_write_failed");
      log.warn({
        route: "companyLogoRoutes.delete",
        message: `audit append failed for ${id}: ${(err as Error).message}`,
      });
    }

    return res.json({ ok: true, deleted: had });
  });
}
