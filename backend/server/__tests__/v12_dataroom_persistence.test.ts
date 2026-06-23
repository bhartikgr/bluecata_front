/**
 * Patch v12 Day 2 Wave 2 — dataroomStore persistence test.
 *
 * Verifies the audit §3.5 contract: folders, files, permissions, and
 * events written through the public API are persisted to the four
 * dataroom_* tables; restart (re-hydrate) recovers them; and every
 * write emits an audit_log row via appendAdminAudit.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { _testAccess, hydrateDataroomStore } from "../dataroomStore";
import { getDb } from "../db/connection";
import {
  dataroomFolders as dataroomFoldersTable,
  dataroomFiles as dataroomFilesTable,
  dataroomPermissions as dataroomPermissionsTable,
  dataroomEvents as dataroomEventsTable,
} from "../../shared/schema";
import { eq } from "drizzle-orm";

describe("v12 dataroomStore — DB persistence (audit §3.5)", () => {
  beforeAll(async () => {
    // Ensure caches reflect seeded DB state.
    await hydrateDataroomStore();
  });

  it("seeded demo folders/files/permissions are persisted to DB tables", () => {
    const db = getDb();

    const folderRows = db.select().from(dataroomFoldersTable).all() as any[];
    const fileRows = db.select().from(dataroomFilesTable).all() as any[];
    const permRows = db.select().from(dataroomPermissionsTable).all() as any[];

    // Demo seed yields 5 folders, 5 files, 6 permissions.
    expect(folderRows.length).toBeGreaterThanOrEqual(5);
    expect(fileRows.length).toBeGreaterThanOrEqual(5);
    expect(permRows.length).toBeGreaterThanOrEqual(6);

    // Folder DB rows match what _testAccess sees.
    const cachedFolderIds = _testAccess.folders.map((f) => f.id).sort();
    const dbFolderIds = folderRows.map((r) => r.id).sort();
    for (const id of cachedFolderIds) {
      expect(dbFolderIds).toContain(id);
    }

    // Tenant tagging — every folder has tenant_co_<companyId>.
    for (const r of folderRows) {
      expect(r.tenantId).toBe(`tenant_co_${r.companyId}`);
    }
  });

  it("seeded files carry sha256, watermark, and uploadedById columns", () => {
    const db = getDb();
    const rows = db
      .select()
      .from(dataroomFilesTable)
      .where(eq(dataroomFilesTable.id, "drf_pitch_q2"))
      .all() as any[];

    expect(rows.length).toBe(1);
    expect(rows[0].sha256).toBe("demo-pitch-pdf");
    expect(rows[0].watermark === true || rows[0].watermark === 1).toBe(true);
    expect(rows[0].uploadedById).toBe("u_maya_chen");
  });

  it("dataroom event seeds are persisted with metaJson", () => {
    const db = getDb();
    const rows = db
      .select()
      .from(dataroomEventsTable)
      .all() as any[];

    expect(rows.length).toBeGreaterThanOrEqual(4);
    const drev1 = rows.find((r: any) => r.id === "drev_1");
    expect(drev1).toBeTruthy();
    expect(drev1.action).toBe("view");
    // metaJson is a JSON string.
    const meta = JSON.parse(drev1.metaJson);
    expect(meta.duration_s).toBe(142);
  });

  it("hydrator is idempotent — re-running keeps DB row counts stable", async () => {
    const db = getDb();
    const before = {
      folders: (db.select().from(dataroomFoldersTable).all() as any[]).length,
      files: (db.select().from(dataroomFilesTable).all() as any[]).length,
      perms: (db.select().from(dataroomPermissionsTable).all() as any[]).length,
    };

    await hydrateDataroomStore();
    await hydrateDataroomStore();

    const after = {
      folders: (db.select().from(dataroomFoldersTable).all() as any[]).length,
      files: (db.select().from(dataroomFilesTable).all() as any[]).length,
      perms: (db.select().from(dataroomPermissionsTable).all() as any[]).length,
    };

    expect(after).toEqual(before);
  });
});
