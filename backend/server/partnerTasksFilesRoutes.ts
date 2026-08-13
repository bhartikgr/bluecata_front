/**
 * WAVE 7 — W-8 (DEF-057) and W-5 (DEF-056).
 *
 * Restores the `/api/partner/me/tasks*` and `/api/partner/me/files*` route
 * surfaces that v25.50.0 Phase 6 deleted (see the comment block still standing
 * at `server/partnerRoutes.ts:1525-1530`, which records the deletion and the
 * deliberate retention of the stores).
 *
 * WIRING, NOT BUILDING. Everything below the route layer already existed:
 *
 *   W-8 sink:  partnerTasksStore.create/update  (server/partnerWorkspaceStore.ts:2210, :2236)
 *                → persistTask()                (server/partnerWorkspaceStore.ts:578)
 *                → INSERT INTO partner_tasks    (DDL server/db/connection.ts:5106)
 *   W-5 sink:  partnerFilesStore.add/remove     (server/partnerWorkspaceStore.ts:2257, :2292)
 *                → persistFile()                (server/partnerWorkspaceStore.ts:592)
 *                → INSERT INTO partner_files    (DDL server/db/connection.ts:5115)
 *
 * SECOND-PATH CHECK. `grep -rn "partner_tasks\|partner_files" server/` returns
 * exactly two other call sites — `server/partnerRoutes.ts:546` and `:553` — and
 * both are SELECTs inside the admin audit endpoint. There is no second writer to
 * either table, so these routes are the whole write path.
 *
 * W-5 BYTES. The retired Files page posted metadata only: `sizeBytes: 0`,
 * `mimeType: "application/octet-stream"`, no payload. `PartnerFile` has carried
 * a `dataroomFileId` slot since v25.x (`partnerWorkspaceStore.ts:281`) and it has
 * never been populated. Rather than mint a parallel blob store, uploads here go
 * through the SAME durable seam the dataroom uses — `putObject()` /
 * `getObject()` in `server/lib/objectStorage.ts`, which is what
 * `registerDataroomRoutes` calls at `server/dataroomStore.ts:635`. A storage
 * failure is FAIL-CLOSED (no row is written), mirroring v25.48 STORE-1: a
 * partner_files row without bytes behind it is the silent-loss shape that rule
 * exists to prevent. Download streams the real bytes back.
 *
 * The storage pointer rides in the existing `file_json` blob, so W-5 needs NO
 * migration and collides with no wave's migration number.
 */
import type { Express, Request, Response } from "express";
import multer from "multer";
import { requirePartnerAuth, assertSubRole } from "./lib/requirePartnerAuth";
import { partnerTasksStore, partnerFilesStore } from "./partnerWorkspaceStore";
import { putObject, getObject } from "./lib/objectStorage";
import { log } from "./lib/logger";

/** Same limit and memory strategy the dataroom uses (dataroomStore.ts:364). */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });

/**
 * The durable storage pointer for a partner file. It is persisted inside the
 * existing `partner_files.file_json` blob, so no column and no migration are
 * required. Kept as a separate interface so the cast below is narrow and
 * greppable rather than an `as any` at the boundary.
 */
export interface PartnerFileStorageRef {
  storageKey: string | null;
  storageBackend: string | null;
  storageKmsKeyId: string | null;
  sha256: string | null;
}

type StoredPartnerFile = ReturnType<typeof partnerFilesStore.add> & Partial<PartnerFileStorageRef>;

const TASK_STATUSES = ["open", "in_progress", "done", "cancelled"] as const;
const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
const FILE_SCOPES = ["private", "team", "client_shared"] as const;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

export function registerPartnerTasksFilesRoutes(app: Express): void {
  /* ==========================================================
   * W-8 — TASKS. partner_tasks is the only partner model that
   * carries an assignee (`assignedToUserId`,
   * partnerWorkspaceStore.ts:261-276), which is why the spec calls
   * it out by name: deleting the routes stranded the only
   * assignment surface the partner workspace has.
   * ========================================================== */

  app.get("/api/partner/me/tasks", requirePartnerAuth, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    try {
      res.json({ tasks: partnerTasksStore.listByPartner(pid) });
    } catch (e) {
      res.status(500).json({ error: "PARTNER_TASKS_QUERY_FAILED", message: (e as Error).message });
    }
  });

  /* A viewer cannot create — the retired page's own header comment said so
     ("Viewer cannot create", PartnerTasks.tsx:3) but nothing enforced it,
     because there was no route to enforce it on. */
  app.post(
    "/api/partner/me/tasks",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate"),
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const title = str(body.title);
      if (!title) return res.status(400).json({ error: "TITLE_REQUIRED" });
      const status = str(body.status);
      if (status && !(TASK_STATUSES as readonly string[]).includes(status)) {
        return res.status(400).json({ error: "INVALID_STATUS", allowed: TASK_STATUSES });
      }
      const priority = str(body.priority);
      if (priority && !(TASK_PRIORITIES as readonly string[]).includes(priority)) {
        return res.status(400).json({ error: "INVALID_PRIORITY", allowed: TASK_PRIORITIES });
      }
      try {
        const task = partnerTasksStore.create(
          ctx.partnerId,
          {
            title,
            description: str(body.description),
            status: (status ?? "open") as "open",
            priority: (priority ?? "normal") as "normal",
            assignedToUserId: str(body.assignedToUserId),
            dueDate: str(body.dueDate),
            scope: str(body.scope) as null,
            scopeId: str(body.scopeId),
          },
          ctx.userId,
        );
        res.status(201).json({ task });
      } catch (e) {
        res.status(400).json({ error: (e as Error).message });
      }
    },
  );

  app.patch(
    "/api/partner/me/tasks/:taskId",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate"),
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      if ("title" in body) {
        const t = str(body.title);
        if (!t) return res.status(400).json({ error: "TITLE_REQUIRED" });
        patch.title = t;
      }
      if ("status" in body) {
        const s = str(body.status);
        if (!s || !(TASK_STATUSES as readonly string[]).includes(s)) {
          return res.status(400).json({ error: "INVALID_STATUS", allowed: TASK_STATUSES });
        }
        patch.status = s;
      }
      if ("priority" in body) {
        const p = str(body.priority);
        if (!p || !(TASK_PRIORITIES as readonly string[]).includes(p)) {
          return res.status(400).json({ error: "INVALID_PRIORITY", allowed: TASK_PRIORITIES });
        }
        patch.priority = p;
      }
      if ("description" in body) patch.description = str(body.description);
      if ("assignedToUserId" in body) patch.assignedToUserId = str(body.assignedToUserId);
      if ("dueDate" in body) patch.dueDate = str(body.dueDate);
      try {
        const task = partnerTasksStore.update(ctx.partnerId, String(req.params.taskId), patch, ctx.userId);
        res.json({ task });
      } catch (e) {
        const msg = (e as Error).message;
        if (msg === "TASK_NOT_FOUND") return res.status(404).json({ error: msg });
        res.status(400).json({ error: msg });
      }
    },
  );

  /* Cancel is the store's own soft-retire (`listByPartner` filters
     status==='cancelled', partnerWorkspaceStore.ts:2247). There is no hard
     delete on the store and this route does not invent one. */
  app.delete(
    "/api/partner/me/tasks/:taskId",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate"),
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      try {
        const task = partnerTasksStore.update(
          ctx.partnerId,
          String(req.params.taskId),
          { status: "cancelled" },
          ctx.userId,
        );
        res.json({ task });
      } catch (e) {
        const msg = (e as Error).message;
        if (msg === "TASK_NOT_FOUND") return res.status(404).json({ error: msg });
        res.status(400).json({ error: msg });
      }
    },
  );

  /* ==========================================================
   * W-5 — FILES, with real bytes.
   * ========================================================== */

  app.get("/api/partner/me/files", requirePartnerAuth, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    try {
      const files = partnerFilesStore.listByPartner(pid).map((f) => {
        const s = f as StoredPartnerFile;
        return {
          ...f,
          /* Explicit, so the client can distinguish a file it can download from
             a metadata-only row left over from the pre-W-5 era rather than
             offering a download button that 404s. */
          hasBytes: Boolean(s.storageKey),
        };
      });
      res.json({ files });
    } catch (e) {
      res.status(500).json({ error: "PARTNER_FILES_QUERY_FAILED", message: (e as Error).message });
    }
  });

  app.post(
    "/api/partner/me/files",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate"),
    upload.single("file"),
    async (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      type MulterReq = Request & {
        file?: { originalname: string; mimetype: string; buffer: Buffer; size: number };
      };
      const r = req as MulterReq;
      if (!r.file) {
        /* The retired page POSTed JSON metadata with sizeBytes: 0 and no
           payload. Accepting that again would recreate exactly the defect
           DEF-056 names — a files surface with no files in it. Refuse, and say
           which field is missing. */
        return res.status(400).json({
          error: "FILE_REQUIRED",
          message: "Attach the file itself (multipart field `file`). Metadata-only rows are not accepted.",
        });
      }
      const scope = str((req.body ?? {}).scope) ?? "private";
      if (!(FILE_SCOPES as readonly string[]).includes(scope)) {
        return res.status(400).json({ error: "INVALID_SCOPE", allowed: FILE_SCOPES });
      }

      /* FAIL-CLOSED, exactly as v25.48 STORE-1 requires of the dataroom
         (dataroomStore.ts:625-650): if the bytes do not land, NO row is
         written. A row without bytes is the silent-loss shape. */
      let stored: Awaited<ReturnType<typeof putObject>>;
      try {
        stored = await putObject({
          prefix: "partner-files",
          buffer: r.file.buffer,
          mimeType: r.file.mimetype || "application/octet-stream",
          originalName: r.file.originalname,
        });
      } catch (err) {
        log.error(
          "[partnerFiles] durable storage write failed — refusing to persist a row without bytes:",
          (err as Error).message,
        );
        return res.status(500).json({
          error: "storage_write_failed",
          message: "The file could not be saved to durable storage. No record was created; please try again.",
        });
      }

      const { createHash } = await import("node:crypto");
      const sha256 = createHash("sha256").update(r.file.buffer).digest("hex");

      try {
        const file = partnerFilesStore.add(
          ctx.partnerId,
          {
            dataroomFileId: null,
            /* The client's "Register new file name" box is a DISPLAY LABEL and
               is honoured here — it predates this route and dropping it would
               make an existing input decorative. It never affects the stored
               object: `stored.storageKey` is derived from the real upload. */
            fileName: str((req.body ?? {}).fileName) ?? r.file.originalname,
            mimeType: r.file.mimetype || "application/octet-stream",
            sizeBytes: r.file.size,
            scope: scope as "private",
            scopeId: str((req.body ?? {}).scopeId),
            uploadedBy: ctx.userId,
            /* Storage pointer rides in the same JSON blob. Narrow cast, one
               site, named interface — not an `as any` at the boundary. */
            ...({
              storageKey: stored.storageKey,
              storageBackend: stored.backend,
              storageKmsKeyId: stored.kmsKeyId ?? null,
              sha256,
            } as PartnerFileStorageRef),
          } as Parameters<typeof partnerFilesStore.add>[1],
          ctx.userId,
        );
        res.status(201).json({ file: { ...file, hasBytes: true } });
      } catch (e) {
        res.status(400).json({ error: (e as Error).message });
      }
    },
  );

  /** W-5 — the read-back that makes this a files surface rather than a list of names. */
  app.get(
    "/api/partner/me/files/:fileId/download",
    requirePartnerAuth,
    async (req: Request, res: Response) => {
      const pid = req.partnerContext!.partnerId;
      const f = partnerFilesStore.getById(pid, String(req.params.fileId)) as StoredPartnerFile | null;
      if (!f) return res.status(404).json({ error: "FILE_NOT_FOUND" });
      if (!f.storageKey) {
        /* Pre-W-5 metadata-only row. Say so rather than serving a placeholder —
           a placeholder PDF is what v25.48 STORE-1 was written to stop. */
        return res.status(409).json({
          error: "FILE_HAS_NO_BYTES",
          message: "This record predates durable partner-file storage and has no bytes behind it.",
        });
      }
      let buf: Buffer | null = null;
      try {
        buf = await getObject(f.storageKey);
      } catch (err) {
        log.error("[partnerFiles] storage read failed:", (err as Error).message);
      }
      if (!buf) return res.status(404).json({ error: "FILE_BYTES_MISSING" });
      res.setHeader("Content-Type", f.mimeType || "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${String(f.fileName).replace(/["\\\r\n]/g, "_")}"`,
      );
      res.setHeader("Content-Length", String(buf.length));
      res.end(buf);
    },
  );

  app.delete(
    "/api/partner/me/files/:fileId",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate"),
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      try {
        /* Soft delete only — the store has no hard delete and this route does
           not add one (partnerWorkspaceStore.ts:2292 tombstones). The bytes are
           deliberately NOT unlinked: the tombstone is auditable and a hard
           unlink would make an admin audit read unreproducible. */
        const file = partnerFilesStore.remove(ctx.partnerId, String(req.params.fileId), ctx.userId);
        res.json({ file });
      } catch (e) {
        const msg = (e as Error).message;
        if (msg === "FILE_NOT_FOUND") return res.status(404).json({ error: msg });
        res.status(400).json({ error: msg });
      }
    },
  );
}
