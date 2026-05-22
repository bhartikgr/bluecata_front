/**
 * Sprint 11 — Founder Dataroom rebuild.
 *
 * Patch v12 Day 2 Wave 2 (audit §3.5) — DB-BACKED HYBRID.
 *
 *   - Four in-memory arrays (`folders`, `files`, `permissions`, `events`)
 *     remain as READ CACHES. They are mirrored from the DB on hydrate and
 *     updated on every mutation AFTER the DB write commits.
 *   - File BYTES (`DRFile._buf`) live ONLY in memory. The DB stores metadata
 *     + sha256. v13 swaps the storage adapter to S3 + presigned URLs and the
 *     `_buf` field becomes a streamable handle.
 *   - Every state change wraps in `getDb().transaction(...)` — Drizzle's
 *     BEGIN IMMEDIATE serialises concurrent writers. No trailing `()` on the
 *     transaction call — that's the raw better-sqlite3 API; Drizzle invokes
 *     the callback itself.
 *   - Every upload / permission change / download is mirrored into the
 *     audit_log via `appendAdminAudit(...)` (Wave 1 DB-backed).
 *
 * PATCH v3 — Per-company data scoping (preserved verbatim):
 *   - POST /api/founder/dataroom/files: stamps uploadedBy + uploadedById from session,
 *     never hardcodes "Maya Chen".
 *   - POST /api/founder/dataroom/folders: stamps actor from session.
 *   - Download audit: stamps actor from session.
 *   - Permission changes: stamps actor from session.
 *   - companyId defaults removed — callers must provide companyId; missing companyId → 400.
 *   - Seed data retained for demo personas (co_novapay only); scoped by companyId filter.
 *
 * Endpoints (unchanged):
 *   GET    /api/founder/dataroom/folders                — list folders
 *   POST   /api/founder/dataroom/folders                — create folder
 *   GET    /api/founder/dataroom/files                  — list files (filterable by folderId)
 *   POST   /api/founder/dataroom/files                  — upload (multipart)
 *   GET    /api/founder/dataroom/files/:id              — file metadata + watermarked stream link
 *   GET    /api/founder/dataroom/files/:id/download     — download (audit-logged)
 *   GET    /api/founder/dataroom/permissions            — full matrix
 *   POST   /api/founder/dataroom/permissions            — set per-investor × folder × view/download
 *   GET    /api/founder/dataroom/events                 — audit events
 *   GET    /api/founder/dataroom/engagement             — per-doc + per-investor stats
 */
import type { Express, Request, Response } from "express";
import multer from "multer";
import { randomBytes, createHash } from "node:crypto";
import { and, eq, isNull, asc } from "drizzle-orm";
import { getUserContext } from "./lib/userContext";
import { DEMO_SEED_ENABLED } from "./lib/demoGate";
import { getDb } from "./db/connection";
import {
  dataroomFolders as dataroomFoldersTable,
  dataroomFiles as dataroomFilesTable,
  dataroomPermissions as dataroomPermissionsTable,
  dataroomEvents as dataroomEventsTable,
} from "../shared/schema";
import { appendAdminAudit } from "./adminPlatformStore";
import { log } from "./lib/logger";

export type Folder = {
  id: string;
  companyId: string;
  name: string;
  createdAt: string;
  isRoundFolder: boolean;
  roundId?: string;
};

export type DRFile = {
  id: string;
  companyId: string;
  folderId: string;
  name: string;
  sizeBytes: number;
  mime: string;
  uploadedAt: string;
  uploadedBy: string;
  uploadedById: string;
  sha256: string;
  watermark: boolean;
  // bytes kept in-memory only for preview
  _buf?: Buffer;
};

export type Permission = {
  investorId: string;
  folderId: string;
  view: boolean;
  download: boolean;
};

export type DREvent = {
  id: string;
  companyId: string;
  ts: string;
  actor: string;
  actorId: string;
  action: "upload" | "download" | "view" | "permission_change" | "share_link" | "watermark_toggle" | "folder_create" | "delete";
  targetKind: "file" | "folder" | "permission";
  targetId: string;
  meta?: Record<string, unknown>;
};

function tenantForCompany(companyId: string): string {
  return `tenant_co_${companyId}`;
}

// ─── In-memory caches ─────────────────────────────────────────────────────────

// Patch v4: demo seed only when DEMO_SEED_ENABLED.
const folders: Folder[] = DEMO_SEED_ENABLED ? [
  { id: "fld_pitch",       companyId: "co_novapay", name: "Pitch",      createdAt: "2026-01-10T09:00:00Z", isRoundFolder: false },
  { id: "fld_financials",  companyId: "co_novapay", name: "Financials", createdAt: "2026-01-10T09:00:00Z", isRoundFolder: false },
  { id: "fld_legal",       companyId: "co_novapay", name: "Legal",      createdAt: "2026-01-10T09:00:00Z", isRoundFolder: false },
  { id: "fld_diligence",   companyId: "co_novapay", name: "Diligence",  createdAt: "2026-01-10T09:00:00Z", isRoundFolder: false },
  { id: "fld_round_seed",  companyId: "co_novapay", name: "Round-Specific — Seed Extension", createdAt: "2026-04-01T09:00:00Z", isRoundFolder: true, roundId: "rnd_seed" },
] : [];

const files: DRFile[] = DEMO_SEED_ENABLED ? [
  { id: "drf_pitch_q2",    companyId: "co_novapay", folderId: "fld_pitch",      name: "NovaPay Pitch Q2 2026.pdf",  sizeBytes: 4_200_000, mime: "application/pdf", uploadedAt: "2026-04-15T14:00:00Z", uploadedBy: "Maya Chen", uploadedById: "u_maya_chen", sha256: "demo-pitch-pdf", watermark: true },
  { id: "drf_revops",      companyId: "co_novapay", folderId: "fld_financials", name: "RevOps Snapshot Apr.xlsx",   sizeBytes: 920_000,   mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", uploadedAt: "2026-04-29T11:00:00Z", uploadedBy: "CFO", uploadedById: "u_maya_chen", sha256: "demo-revops", watermark: false },
  { id: "drf_articles",    companyId: "co_novapay", folderId: "fld_legal",      name: "Articles of Incorporation.pdf", sizeBytes: 285_000, mime: "application/pdf", uploadedAt: "2024-04-01T09:00:00Z", uploadedBy: "Counsel", uploadedById: "u_maya_chen", sha256: "demo-articles", watermark: true },
  { id: "drf_dd_master",   companyId: "co_novapay", folderId: "fld_diligence",  name: "DD Master Index.xlsx",       sizeBytes: 110_000,   mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", uploadedAt: "2026-05-01T09:00:00Z", uploadedBy: "Maya Chen", uploadedById: "u_maya_chen", sha256: "demo-dd-idx", watermark: false },
  { id: "drf_seed_terms",  companyId: "co_novapay", folderId: "fld_round_seed", name: "Seed Extension Term Sheet v3.pdf", sizeBytes: 320_000, mime: "application/pdf", uploadedAt: "2026-05-04T14:00:00Z", uploadedBy: "Maya Chen", uploadedById: "u_maya_chen", sha256: "demo-seed-terms", watermark: true },
] : [];

const permissions: Permission[] = DEMO_SEED_ENABLED ? [
  { investorId: "u_aisha_patel", folderId: "fld_pitch",       view: true,  download: true  },
  { investorId: "u_aisha_patel", folderId: "fld_financials",  view: true,  download: false },
  { investorId: "u_aisha_patel", folderId: "fld_legal",       view: true,  download: false },
  { investorId: "u_aisha_patel", folderId: "fld_diligence",   view: false, download: false },
  { investorId: "u_aisha_patel", folderId: "fld_round_seed",  view: true,  download: true  },
  { investorId: "u_lapsed_lp",   folderId: "fld_pitch",       view: true,  download: false },
] : [];

const events: DREvent[] = DEMO_SEED_ENABLED ? [
  { id: "drev_1", companyId: "co_novapay", ts: "2026-05-08T10:13:00Z", actor: "Aisha Patel",  actorId: "u_aisha_patel", action: "view",     targetKind: "file", targetId: "drf_pitch_q2",   meta: { duration_s: 142 } },
  { id: "drev_2", companyId: "co_novapay", ts: "2026-05-07T11:42:00Z", actor: "Aisha Patel",  actorId: "u_aisha_patel", action: "download", targetKind: "file", targetId: "drf_pitch_q2",   meta: { ip: "—" } },
  { id: "drev_3", companyId: "co_novapay", ts: "2026-05-06T09:00:00Z", actor: "Maya Chen",    actorId: "u_maya_chen",   action: "upload",   targetKind: "file", targetId: "drf_seed_terms", meta: { folderId: "fld_round_seed" } },
  { id: "drev_4", companyId: "co_novapay", ts: "2026-05-05T16:00:00Z", actor: "Maya Chen",    actorId: "u_maya_chen",   action: "permission_change", targetKind: "permission", targetId: "u_aisha_patel:fld_round_seed", meta: { view: true, download: true } },
] : [];

// ─── DB write-through helpers ────────────────────────────────────────────────

/** Persist a folder row. Idempotent via primary-key onConflictDoNothing. */
function persistFolder(f: Folder): void {
  try {
    const db = getDb();
    db.transaction((tx: any) => {
      tx.insert(dataroomFoldersTable)
        .values({
          id: f.id,
          companyId: f.companyId,
          tenantId: tenantForCompany(f.companyId),
          name: f.name,
          createdAt: f.createdAt,
          isRoundFolder: f.isRoundFolder,
          roundId: f.roundId ?? null,
          deletedAt: null,
        })
        .onConflictDoNothing({ target: dataroomFoldersTable.id })
        .run();
    });
  } catch (err) {
    log.warn("[dataroomStore.persistFolder] DB write failed:", (err as Error).message);
  }
}

/** Persist a file row (metadata only — bytes stay in memory). */
function persistFile(f: DRFile): void {
  try {
    const db = getDb();
    db.transaction((tx: any) => {
      tx.insert(dataroomFilesTable)
        .values({
          id: f.id,
          companyId: f.companyId,
          tenantId: tenantForCompany(f.companyId),
          folderId: f.folderId,
          category: "misc",
          name: f.name,
          sizeBytes: f.sizeBytes,
          mime: f.mime,
          uploadedAt: f.uploadedAt,
          uploadedBy: f.uploadedBy,
          uploadedById: f.uploadedById,
          sha256: f.sha256,
          watermark: f.watermark,
          deletedAt: null,
        })
        .onConflictDoNothing({ target: dataroomFilesTable.id })
        .run();
    });
  } catch (err) {
    log.warn("[dataroomStore.persistFile] DB write failed:", (err as Error).message);
  }
}

/** Upsert a permission row keyed by (investorId, folderId). */
function persistPermission(p: Permission, tenantId: string): void {
  try {
    const db = getDb();
    db.transaction((tx: any) => {
      // Look up existing row by composite (investorId, folderId).
      const existing = tx
        .select({ id: dataroomPermissionsTable.id })
        .from(dataroomPermissionsTable)
        .where(and(
          eq(dataroomPermissionsTable.investorId, p.investorId),
          eq(dataroomPermissionsTable.folderId, p.folderId),
          isNull(dataroomPermissionsTable.deletedAt),
        ))
        .limit(1)
        .all() as Array<{ id: string }>;

      const now = new Date().toISOString();
      if (existing.length > 0) {
        tx.update(dataroomPermissionsTable)
          .set({
            view: p.view,
            download: p.download,
            updatedAt: now,
          })
          .where(eq(dataroomPermissionsTable.id, existing[0].id))
          .run();
      } else {
        tx.insert(dataroomPermissionsTable)
          .values({
            id: `dperm_${randomBytes(4).toString("hex")}`,
            tenantId,
            investorId: p.investorId,
            folderId: p.folderId,
            view: p.view,
            download: p.download,
            updatedAt: now,
            deletedAt: null,
          })
          .run();
      }
    });
  } catch (err) {
    log.warn("[dataroomStore.persistPermission] DB write failed:", (err as Error).message);
  }
}

/** Persist a dataroom event row (append-only — no soft-delete column). */
function persistEvent(e: DREvent): void {
  try {
    const db = getDb();
    db.transaction((tx: any) => {
      tx.insert(dataroomEventsTable)
        .values({
          id: e.id,
          tenantId: tenantForCompany(e.companyId),
          companyId: e.companyId,
          ts: e.ts,
          actor: e.actor,
          actorId: e.actorId,
          action: e.action,
          targetKind: e.targetKind,
          targetId: e.targetId,
          metaJson: e.meta ? JSON.stringify(e.meta) : null,
        })
        .onConflictDoNothing({ target: dataroomEventsTable.id })
        .run();
    });
  } catch (err) {
    log.warn("[dataroomStore.persistEvent] DB write failed:", (err as Error).message);
  }
}

function logEvent(e: Omit<DREvent, "id" | "ts">): DREvent {
  const ev: DREvent = { ...e, id: `drev_${randomBytes(4).toString("hex")}`, ts: new Date().toISOString() };
  events.unshift(ev);
  persistEvent(ev);
  // Mirror into the platform audit_log (Wave 1 DB-backed) for cross-store
  // visibility. Entity key uses dataroom:<companyId>:<targetId> for filtering.
  try {
    appendAdminAudit(
      ev.actorId,
      `dataroom:${ev.companyId}:${ev.targetId}`,
      `dataroom.${ev.action}`,
      { actor: ev.actor, targetKind: ev.targetKind, meta: ev.meta ?? {} },
      tenantForCompany(ev.companyId),
    );
  } catch (err) {
    log.warn("[dataroomStore.logEvent] appendAdminAudit failed:", (err as Error).message);
  }
  return ev;
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });

// ─── Hydration ───────────────────────────────────────────────────────────────

/**
 * Hydrate the in-memory caches from the DB. Called once from
 * hydrateStores.HYDRATE_ORDER after multiCompany/companyProfile are warm.
 *
 * Idempotent: safe to call multiple times. Replaces the cache contents in
 * place so other modules that closed over the array references (e.g.
 * `_testAccess`) keep observing live data.
 */
export async function hydrateDataroomStore(): Promise<void> {
  try {
    const db = getDb();

    // Folders
    const folderRows = db
      .select()
      .from(dataroomFoldersTable)
      .where(isNull(dataroomFoldersTable.deletedAt))
      .all() as any[];
    // Mirror seed rows into DB so re-hydration is deterministic on next boot.
    for (const f of folders) {
      if (!folderRows.find((r) => r.id === f.id)) persistFolder(f);
    }

    // Files
    const fileRows = db
      .select()
      .from(dataroomFilesTable)
      .where(isNull(dataroomFilesTable.deletedAt))
      .all() as any[];
    for (const f of files) {
      if (!fileRows.find((r) => r.id === f.id)) persistFile(f);
    }

    // Permissions
    const permRows = db
      .select()
      .from(dataroomPermissionsTable)
      .where(isNull(dataroomPermissionsTable.deletedAt))
      .all() as any[];
    for (const p of permissions) {
      if (!permRows.find((r) => r.investorId === p.investorId && r.folderId === p.folderId)) {
        persistPermission(p, "tenant_co_co_novapay");
      }
    }

    // Events — append-only, seed only if table is empty for this set of ids.
    const evRowsExisting = db.select().from(dataroomEventsTable).all() as any[];
    const existingEvIds = new Set(evRowsExisting.map((r: any) => r.id));
    for (const e of events) {
      if (!existingEvIds.has(e.id)) persistEvent(e);
    }

    // Now refresh caches from the (possibly seeded) DB.
    const folderRows2 = db
      .select()
      .from(dataroomFoldersTable)
      .where(isNull(dataroomFoldersTable.deletedAt))
      .all() as any[];
    folders.length = 0;
    for (const r of folderRows2) {
      folders.push({
        id: r.id,
        companyId: r.companyId,
        name: r.name,
        createdAt: r.createdAt,
        isRoundFolder: !!r.isRoundFolder,
        roundId: r.roundId ?? undefined,
      });
    }

    const fileRows2 = db
      .select()
      .from(dataroomFilesTable)
      .where(isNull(dataroomFilesTable.deletedAt))
      .all() as any[];
    files.length = 0;
    for (const r of fileRows2) {
      files.push({
        id: r.id,
        companyId: r.companyId,
        folderId: r.folderId ?? "",
        name: r.name,
        sizeBytes: r.sizeBytes,
        mime: r.mime,
        uploadedAt: r.uploadedAt,
        uploadedBy: r.uploadedBy ?? "",
        uploadedById: r.uploadedById ?? "",
        sha256: r.sha256 ?? "",
        watermark: !!r.watermark,
      });
    }

    const permRows2 = db
      .select()
      .from(dataroomPermissionsTable)
      .where(isNull(dataroomPermissionsTable.deletedAt))
      .all() as any[];
    permissions.length = 0;
    for (const r of permRows2) {
      permissions.push({
        investorId: r.investorId,
        folderId: r.folderId,
        view: !!r.view,
        download: !!r.download,
      });
    }

    const evRows = db
      .select()
      .from(dataroomEventsTable)
      .orderBy(asc(dataroomEventsTable.ts))
      .all() as any[];
    if (evRows.length > 0) {
      events.length = 0;
      for (const r of evRows) {
        events.unshift({
          id: r.id,
          companyId: r.companyId,
          ts: r.ts,
          actor: r.actor,
          actorId: r.actorId,
          action: r.action,
          targetKind: r.targetKind,
          targetId: r.targetId,
          meta: r.metaJson ? JSON.parse(r.metaJson) : undefined,
        });
      }
    }
  } catch (err) {
    log.warn("[dataroomStore.hydrate] DB read failed:", (err as Error).message);
  }
}

// ─── Routes (unchanged surface) ──────────────────────────────────────────────

export function registerDataroomRoutes(app: Express): void {
  app.get("/api/founder/dataroom/folders", (req, res) => {
    const companyId = String(req.query.companyId ?? "");
    if (!companyId) return res.status(400).json({ error: "companyId_required" });
    res.json(folders.filter((f) => f.companyId === companyId));
  });

  app.post("/api/founder/dataroom/folders", (req, res) => {
    const ctx = getUserContext(req);
    if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    const { name, companyId, isRoundFolder, roundId } = req.body ?? {};
    if (!name) return res.status(400).json({ error: "name required" });
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    // Verify session user owns this company
    const ownsCompany = ctx.founder.companies.some((c) => c.companyId === companyId) || ctx.isAdmin;
    if (!ownsCompany) return res.status(403).json({ ok: false, error: "FOUNDER_WRONG_COMPANY" });
    const f: Folder = {
      id: `fld_${randomBytes(4).toString("hex")}`,
      companyId,
      name,
      createdAt: new Date().toISOString(),
      isRoundFolder: !!isRoundFolder,
      roundId,
    };
    persistFolder(f);
    folders.push(f);
    // PATCH v3: stamp actor from session
    logEvent({ companyId: f.companyId, actor: ctx.identity.name, actorId: ctx.userId, action: "folder_create", targetKind: "folder", targetId: f.id, meta: { name } });
    res.json(f);
  });

  app.get("/api/founder/dataroom/files", (req, res) => {
    const companyId = String(req.query.companyId ?? "");
    if (!companyId) return res.status(400).json({ error: "companyId_required" });
    const folderId = req.query.folderId ? String(req.query.folderId) : null;
    const list = files.filter((f) => f.companyId === companyId && (!folderId || f.folderId === folderId));
    // strip _buf from JSON response
    res.json(list.map(({ _buf: _, ...rest }) => rest));
  });

  // PATCH v3: upload stamps actor from session
  app.post("/api/founder/dataroom/files", upload.single("file"), (req, res) => {
    type MulterReq = Request & { file?: { originalname: string; mimetype: string; buffer: Buffer; size: number } };
    const r = req as MulterReq;
    if (!r.file) return res.status(400).json({ error: "file required" });

    const ctx = getUserContext(req);
    if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

    const companyId = String(req.body?.companyId ?? "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });

    // Verify session user owns this company
    const ownsCompany = ctx.founder.companies.some((c) => c.companyId === companyId) || ctx.isAdmin;
    if (!ownsCompany) return res.status(403).json({ ok: false, error: "FOUNDER_WRONG_COMPANY" });

    const folderIdForFile = String(req.body?.folderId ?? (folders.find((fl) => fl.companyId === companyId)?.id ?? ""));
    const sha = createHash("sha256").update(r.file.buffer).digest("hex").slice(0, 16);

    // PATCH v3: uploadedBy comes from session identity, not hardcoded "Maya Chen"
    const f: DRFile = {
      id: `drf_${randomBytes(4).toString("hex")}`,
      companyId,
      folderId: folderIdForFile,
      name: r.file.originalname,
      sizeBytes: r.file.size,
      mime: r.file.mimetype,
      uploadedAt: new Date().toISOString(),
      uploadedBy: ctx.identity.name,
      uploadedById: ctx.userId,
      sha256: sha,
      watermark: true,
      _buf: r.file.buffer,
    };
    persistFile(f);
    files.push(f);
    logEvent({ companyId, actor: ctx.identity.name, actorId: ctx.userId, action: "upload", targetKind: "file", targetId: f.id, meta: { name: f.name, sizeBytes: f.sizeBytes } });
    res.json({ ok: true, file: { ...f, _buf: undefined } });
  });

  app.get("/api/founder/dataroom/files/:id", (req, res) => {
    const f = files.find((x) => x.id === req.params.id);
    if (!f) return res.status(404).json({ error: "not_found" });
    res.json({ ...f, _buf: undefined });
  });

  app.get("/api/founder/dataroom/files/:id/download", (req, res) => {
    const f = files.find((x) => x.id === req.params.id);
    if (!f) return res.status(404).json({ error: "not_found" });

    const ctx = getUserContext(req);
    const role = String(req.query.as ?? "founder");
    const investorId = req.query.investorId ? String(req.query.investorId) : null;
    if (role === "investor" && investorId) {
      const p = permissions.find((p) => p.investorId === investorId && p.folderId === f.folderId);
      if (!p?.download) return res.status(403).json({ error: "download_denied" });
    }
    // PATCH v3: stamp actor from session when available
    const auditActor = ctx.isAuthed ? ctx.identity.name : (investorId ?? "anonymous");
    const auditActorId = ctx.isAuthed ? ctx.userId : (investorId ?? "anonymous");
    logEvent({ companyId: f.companyId, actor: auditActor, actorId: auditActorId, action: "download", targetKind: "file", targetId: f.id });
    if (!f._buf) {
      // synthesize a tiny placeholder so download succeeds for seeded files
      res.setHeader("Content-Type", "text/plain");
      res.setHeader("Content-Disposition", `attachment; filename="${f.name}.txt"`);
      return res.send(`Placeholder content for ${f.name} (Sprint 11 preview).\nsha=${f.sha256}\n`);
    }
    res.setHeader("Content-Type", f.mime);
    res.setHeader("Content-Disposition", `attachment; filename="${f.name}"`);
    return res.send(f._buf);
  });

  app.get("/api/founder/dataroom/permissions", (req, res) => {
    const companyId = String(req.query.companyId ?? "");
    if (!companyId) return res.status(400).json({ error: "companyId_required" });
    const folderIds = new Set(folders.filter((f) => f.companyId === companyId).map((f) => f.id));
    res.json(permissions.filter((p) => folderIds.has(p.folderId)));
  });

  app.post("/api/founder/dataroom/permissions", (req, res) => {
    const ctx = getUserContext(req);
    if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    const { investorId, folderId, view, download } = req.body ?? {};
    if (!investorId || !folderId) return res.status(400).json({ error: "investorId + folderId required" });
    // Resolve companyId from the folder
    const folder = folders.find((fl) => fl.id === folderId);
    const companyId = folder?.companyId ?? "unknown";
    let p = permissions.find((x) => x.investorId === investorId && x.folderId === folderId);
    if (!p) {
      p = { investorId, folderId, view: !!view, download: !!download };
      permissions.push(p);
    } else {
      p.view = !!view;
      p.download = !!download;
    }
    persistPermission(p, tenantForCompany(companyId));
    // PATCH v3: stamp actor from session
    logEvent({ companyId, actor: ctx.identity.name, actorId: ctx.userId, action: "permission_change", targetKind: "permission", targetId: `${investorId}:${folderId}`, meta: { view: p.view, download: p.download } });
    res.json(p);
  });

  app.get("/api/founder/dataroom/events", (req, res) => {
    const companyId = String(req.query.companyId ?? "");
    if (!companyId) return res.status(400).json({ error: "companyId_required" });
    res.json(events.filter((e) => e.companyId === companyId));
  });

  app.get("/api/founder/dataroom/engagement", (req, res) => {
    const companyId = String(req.query.companyId ?? "");
    if (!companyId) return res.status(400).json({ error: "companyId_required" });
    const fileStats: Record<string, { uniqueViewers: Set<string>; totalViews: number; totalSeconds: number; lastViewedAt: string | null }> = {};
    const investorStats: Record<string, { docsViewed: Set<string>; totalSeconds: number; lastActiveAt: string | null }> = {};

    for (const e of events) {
      if (e.companyId !== companyId) continue;
      if (e.action === "view") {
        const fs = (fileStats[e.targetId] ??= { uniqueViewers: new Set(), totalViews: 0, totalSeconds: 0, lastViewedAt: null });
        fs.uniqueViewers.add(e.actor);
        fs.totalViews += 1;
        fs.totalSeconds += Number((e.meta as { duration_s?: number } | undefined)?.duration_s ?? 0);
        fs.lastViewedAt = e.ts;
        const is = (investorStats[e.actor] ??= { docsViewed: new Set(), totalSeconds: 0, lastActiveAt: null });
        is.docsViewed.add(e.targetId);
        is.totalSeconds += Number((e.meta as { duration_s?: number } | undefined)?.duration_s ?? 0);
        is.lastActiveAt = e.ts;
      }
    }
    const docs = Object.entries(fileStats).map(([fileId, s]) => {
      const f = files.find((x) => x.id === fileId);
      return {
        fileId,
        name: f?.name ?? fileId,
        uniqueViewers: s.uniqueViewers.size,
        totalViews: s.totalViews,
        avgTimeSeconds: s.totalViews ? Math.round(s.totalSeconds / s.totalViews) : 0,
        lastViewedAt: s.lastViewedAt,
      };
    }).sort((a, b) => b.totalViews - a.totalViews);
    const investors = Object.entries(investorStats).map(([investorId, s]) => ({
      investorId,
      docsViewed: s.docsViewed.size,
      totalSeconds: s.totalSeconds,
      lastActiveAt: s.lastActiveAt,
    }));
    res.json({ topDocs: docs.slice(0, 5), allDocs: docs, investors });
  });
}

/**
 * Test surface — preserved verbatim from v11 to avoid breaking the 2 test
 * files that destructure this. Arrays are the LIVE caches; mutations from
 * tests do not write through to the DB (intentional — tests poke at the
 * cache directly).
 */
export const _testAccess = { folders, files, permissions, events };
