#!/usr/bin/env python3
"""
Manual migration script for the 10 remaining complex files.
Applies targeted string replacements - no regex, no brace counting.
Each file has a specific set of replacements.
"""

import os
import shutil

BASE = "/home/user/workspace/avi_v19_tree"

def read_file(path):
    with open(path, 'r') as f:
        return f.read()

def write_file(path, content):
    with open(path, 'w') as f:
        f.write(content)

def backup_file(path):
    bak = path + ".bak_manual"
    if not os.path.exists(bak):
        shutil.copy2(path, bak)

def migrate_chaptersStore():
    path = os.path.join(BASE, "server/chaptersStore.ts")
    backup_file(path)
    content = read_file(path)
    
    # Add pAll, pGet, pRun, pTransaction import
    old_import = 'import { and, eq, isNull } from "drizzle-orm";\nimport { getDb } from "./db/connection";\nimport { chapters, chapterMemberships } from "../shared/schema";'
    new_import = 'import { and, eq, isNull } from "drizzle-orm";\nimport { getDb } from "./db/connection";\nimport { pAll, pGet, pRun, pTransaction } from "./db/portable";\nimport { chapters, chapterMemberships } from "../shared/schema";'
    content = content.replace(old_import, new_import)
    
    # listAllChapters: make async, .all() -> await pAll
    old_func = '''export function listAllChapters(): ChapterRow[] {
  const db = getDb();
  // CROSS-TENANT (admin) — justified because chapters is the table that
  // defines the chapter scope itself; listing chapters is inherently
  // cross-tenant (a user picking which chapter to join must see all).
  const rows = db
    .select({
      id: chapters.id,
      tenantId: chapters.tenantId,
      name: chapters.name,
      region: chapters.region,
      city: chapters.city,
      status: chapters.status,
      adminUserId: chapters.adminUserId,
      partnerOrgId: chapters.partnerOrgId,
      membershipFeeAnnualMinor: chapters.membershipFeeAnnualMinor,
      founded: chapters.founded,
    })
    .from(chapters)
    .where(isNull(chapters.deletedAt))
    .all() as ChapterRow[];
  return rows;
}'''
    new_func = '''export async function listAllChapters(): Promise<ChapterRow[]> {
  const db = getDb();
  // CROSS-TENANT (admin) — justified because chapters is the table that
  // defines the chapter scope itself; listing chapters is inherently
  // cross-tenant (a user picking which chapter to join must see all).
  const rows = await pAll<ChapterRow>(db
    .select({
      id: chapters.id,
      tenantId: chapters.tenantId,
      name: chapters.name,
      region: chapters.region,
      city: chapters.city,
      status: chapters.status,
      adminUserId: chapters.adminUserId,
      partnerOrgId: chapters.partnerOrgId,
      membershipFeeAnnualMinor: chapters.membershipFeeAnnualMinor,
      founded: chapters.founded,
    })
    .from(chapters)
    .where(isNull(chapters.deletedAt)));
  return rows;
}'''
    content = content.replace(old_func, new_func)
    
    # listChaptersForUser: make async, fix .all() calls and call to listAllChapters
    old_func2 = '''export function listChaptersForUser(userId: string): Array<ChapterRow & {
  membershipId: string;
  membershipRole: string;
  membershipStatus: string;
  joinedAt: string;
}> {
  const db = getDb();
  // CROSS-TENANT (admin) — justified because chapter_memberships keys on
  // user_id (which belongs to the global identity scope, not a tenant) and
  // a user may hold memberships across multiple chapter tenants.
  const memberships = db
    .select({
      id: chapterMemberships.id,
      chapterId: chapterMemberships.chapterId,
      role: chapterMemberships.role,
      status: chapterMemberships.status,
      joinedAt: chapterMemberships.joinedAt,
    })
    .from(chapterMemberships)
    .where(
      and(
        eq(chapterMemberships.userId, userId),
        eq(chapterMemberships.status, "active"),
        isNull(chapterMemberships.deletedAt),
      ),
    )
    .all();

  if (memberships.length === 0) return [];

  // Fetch the chapter rows in a single pass (small N — most users belong
  // to 1–3 chapters; SQLite IN-list is fine).
  const allChapters = listAllChapters();
  const chaptersById = new Map<string, ChapterRow>(
    allChapters.map((c) => [c.id, c]),
  );'''
    new_func2 = '''export async function listChaptersForUser(userId: string): Promise<Array<ChapterRow & {
  membershipId: string;
  membershipRole: string;
  membershipStatus: string;
  joinedAt: string;
}>> {
  const db = getDb();
  // CROSS-TENANT (admin) — justified because chapter_memberships keys on
  // user_id (which belongs to the global identity scope, not a tenant) and
  // a user may hold memberships across multiple chapter tenants.
  const memberships = await pAll(db
    .select({
      id: chapterMemberships.id,
      chapterId: chapterMemberships.chapterId,
      role: chapterMemberships.role,
      status: chapterMemberships.status,
      joinedAt: chapterMemberships.joinedAt,
    })
    .from(chapterMemberships)
    .where(
      and(
        eq(chapterMemberships.userId, userId),
        eq(chapterMemberships.status, "active"),
        isNull(chapterMemberships.deletedAt),
      ),
    ));

  if (memberships.length === 0) return [];

  // Fetch the chapter rows in a single pass (small N — most users belong
  // to 1–3 chapters; SQLite IN-list is fine).
  const allChapters = await listAllChapters();
  const chaptersById = new Map<string, ChapterRow>(
    allChapters.map((c) => [c.id, c]),
  );'''
    content = content.replace(old_func2, new_func2)

    # joinChapter: fix the .all() before transaction + inside transaction
    # Fix the pre-transaction .all()
    old_pre_tx = '''  const chapterRows = db
    .select({ id: chapters.id, tenantId: chapters.tenantId })
    .from(chapters)
    .where(and(eq(chapters.id, chapterId), isNull(chapters.deletedAt)))
    .limit(1)
    .all();
  const chapter = chapterRows[0];
  if (!chapter) {
    throw new Error(`chapter_not_found: ${chapterId}`);
  }

  // NOTE: Drizzle invokes the transaction callback itself. NO trailing `()`.
  return await db.transaction(async (tx: any) => {
    // CROSS-TENANT (admin) — justified because chapter_memberships keys
    // on user_id across all chapter tenants; we're upserting per
    // (chapter_id, user_id), not per tenant.
    const existing = tx
      .select({
        id: chapterMemberships.id,
        status: chapterMemberships.status,
      })
      .from(chapterMemberships)
      .where(
        and(
          eq(chapterMemberships.userId, userId),
          eq(chapterMemberships.chapterId, chapterId),
          isNull(chapterMemberships.deletedAt),
        ),
      )
      .limit(1)
      .all();

    if (existing.length > 0 && existing[0].status === "active") {
      return { id: existing[0].id, created: false };
    }

    // Either no row, or a non-active row. Upsert.
    const id =
      existing[0]?.id ??
      `chmem_${userId.replace(/^u_/, "")}_${chapterId.replace(/^chap_/, "")}_${Math.random().toString(36).slice(2, 8)}`;

    if (existing.length === 0) {
      tx.insert(chapterMemberships)
        .values({
          id,
          tenantId: chapter.tenantId,
          chapterId,
          userId,
          role,
          status: "active",
          joinedAt: now,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        })
        .run();
    } else {
      tx.update(chapterMemberships)
        .set({ status: "active", role, updatedAt: now })
        .where(eq(chapterMemberships.id, existing[0].id))
        .run();
    }

    return { id, created: existing.length === 0 };
  });
}'''
    new_pre_tx = '''  const chapterRows = await pAll<{ id: string; tenantId: string }>(db
    .select({ id: chapters.id, tenantId: chapters.tenantId })
    .from(chapters)
    .where(and(eq(chapters.id, chapterId), isNull(chapters.deletedAt)))
    .limit(1));
  const chapter = chapterRows[0];
  if (!chapter) {
    throw new Error(`chapter_not_found: ${chapterId}`);
  }

  // NOTE: pTransaction wraps the async callback.
  return await pTransaction(db, async (tx: any) => {
    // CROSS-TENANT (admin) — justified because chapter_memberships keys
    // on user_id across all chapter tenants; we're upserting per
    // (chapter_id, user_id), not per tenant.
    const existing = await pAll<{ id: string; status: string }>(tx
      .select({
        id: chapterMemberships.id,
        status: chapterMemberships.status,
      })
      .from(chapterMemberships)
      .where(
        and(
          eq(chapterMemberships.userId, userId),
          eq(chapterMemberships.chapterId, chapterId),
          isNull(chapterMemberships.deletedAt),
        ),
      )
      .limit(1));

    if (existing.length > 0 && existing[0].status === "active") {
      return { id: existing[0].id, created: false };
    }

    // Either no row, or a non-active row. Upsert.
    const id =
      existing[0]?.id ??
      `chmem_${userId.replace(/^u_/, "")}_${chapterId.replace(/^chap_/, "")}_${Math.random().toString(36).slice(2, 8)}`;

    if (existing.length === 0) {
      await pRun(tx.insert(chapterMemberships)
        .values({
          id,
          tenantId: chapter.tenantId,
          chapterId,
          userId,
          role,
          status: "active",
          joinedAt: now,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        }));
    } else {
      await pRun(tx.update(chapterMemberships)
        .set({ status: "active", role, updatedAt: now })
        .where(eq(chapterMemberships.id, existing[0].id)));
    }

    return { id, created: existing.length === 0 };
  });
}'''
    content = content.replace(old_pre_tx, new_pre_tx)
    
    write_file(path, content)
    print(f"✓ chaptersStore.ts migrated")
    return content


def migrate_collectiveMembershipStore():
    path = os.path.join(BASE, "server/collectiveMembershipStore.ts")
    backup_file(path)
    content = read_file(path)
    
    # Add portable import
    old_import = 'import { isNull, eq } from "drizzle-orm";\nimport { collectiveMemberships as collectiveMembershipsTable } from "@shared/schema";\nimport { getDb } from "./db/connection";'
    new_import = 'import { isNull, eq } from "drizzle-orm";\nimport { collectiveMemberships as collectiveMembershipsTable } from "@shared/schema";\nimport { getDb } from "./db/connection";\nimport { pAll, pRun, pTransaction } from "./db/portable";'
    content = content.replace(old_import, new_import)
    
    # activate: replace sync db.transaction with void pTransaction (fire-and-forget since activate() returns sync)
    old_activate_tx = '''  // v17 Phase B — DB write-through, transaction-wrapped.
  try {
    const db: any = getDb();
    db.transaction((tx: any) => {
      // Upsert by userId PK. Try insert; on conflict, update.
      try {
        tx.insert(collectiveMembershipsTable).values({
          userId,
          tenantId,
          chapterId,
          status: "active",
          tier,
          activatedAt: now,
          activatedBy: byAdminUserId,
          deactivatedAt: null,
          deactivatedBy: null,
          createdAt: now,
          updatedAt: now,
        } as any).run();
      } catch (_e) {
        tx.update(collectiveMembershipsTable)
          .set({
            tenantId,
            chapterId,
            status: "active",
            tier,
            activatedAt: now,
            activatedBy: byAdminUserId,
            deactivatedAt: null,
            deactivatedBy: null,
            updatedAt: now,
          } as any)
          .where(eq((collectiveMembershipsTable as any).userId, userId))
          .run();
      }
    });
  } catch (err) {
    log.warn(
      "[collectiveMembershipStore.activate] DB write failed (memory only):",
      (err as Error).message,
    );
  }'''
    new_activate_tx = '''  // v17 Phase B — DB write-through, transaction-wrapped.
  void pTransaction(getDb() as any, async (tx: any) => {
    // Upsert by userId PK. Try insert; on conflict, update.
    try {
      await pRun(tx.insert(collectiveMembershipsTable).values({
        userId,
        tenantId,
        chapterId,
        status: "active",
        tier,
        activatedAt: now,
        activatedBy: byAdminUserId,
        deactivatedAt: null,
        deactivatedBy: null,
        createdAt: now,
        updatedAt: now,
      } as any));
    } catch (_e) {
      await pRun(tx.update(collectiveMembershipsTable)
        .set({
          tenantId,
          chapterId,
          status: "active",
          tier,
          activatedAt: now,
          activatedBy: byAdminUserId,
          deactivatedAt: null,
          deactivatedBy: null,
          updatedAt: now,
        } as any)
        .where(eq((collectiveMembershipsTable as any).userId, userId)));
    }
  }).catch((err: unknown) => {
    log.warn(
      "[collectiveMembershipStore.activate] DB write failed (memory only):",
      (err as Error).message,
    );
  });'''
    content = content.replace(old_activate_tx, new_activate_tx)
    
    # deactivate: replace sync db.transaction with void pTransaction
    old_deactivate_tx = '''  try {
    const db: any = getDb();
    db.transaction((tx: any) => {
      tx.update(collectiveMembershipsTable)
        .set({
          status: "suspended",
          deactivatedAt: now,
          deactivatedBy: byAdminUserId,
          updatedAt: now,
        } as any)
        .where(eq((collectiveMembershipsTable as any).userId, userId))
        .run();
    });
  } catch (err) {
    log.warn(
      "[collectiveMembershipStore.deactivate] DB update failed (memory only):",
      (err as Error).message,
    );
  }'''
    new_deactivate_tx = '''  void pTransaction(getDb() as any, async (tx: any) => {
    await pRun(tx.update(collectiveMembershipsTable)
      .set({
        status: "suspended",
        deactivatedAt: now,
        deactivatedBy: byAdminUserId,
        updatedAt: now,
      } as any)
      .where(eq((collectiveMembershipsTable as any).userId, userId)));
  }).catch((err: unknown) => {
    log.warn(
      "[collectiveMembershipStore.deactivate] DB update failed (memory only):",
      (err as Error).message,
    );
  });'''
    content = content.replace(old_deactivate_tx, new_deactivate_tx)
    
    # hydrateCollectiveMembershipStore: fix .all()
    old_hydrate_all = '''    const rows = db
      .select()
      .from(collectiveMembershipsTable)
      .where(isNull((collectiveMembershipsTable as any).deletedAt))
      .all() as any[];'''
    new_hydrate_all = '''    const rows = await pAll<any>(db
      .select()
      .from(collectiveMembershipsTable)
      .where(isNull((collectiveMembershipsTable as any).deletedAt)));'''
    content = content.replace(old_hydrate_all, new_hydrate_all)
    
    write_file(path, content)
    print(f"✓ collectiveMembershipStore.ts migrated")


def migrate_collectiveSettingsStore():
    path = os.path.join(BASE, "server/collectiveSettingsStore.ts")
    backup_file(path)
    content = read_file(path)
    
    # Add portable import after getDb import
    old_import = 'import { getDb } from "./db/connection"; /* v17 Phase B */'
    new_import = 'import { getDb } from "./db/connection"; /* v17 Phase B */\nimport { pAll, pRun, pTransaction } from "./db/portable"; /* v23.5 async */'
    content = content.replace(old_import, new_import)
    
    # patchSettings: replace sync db.transaction with void pTransaction (patchSettings is sync)
    old_patch_tx = '''    // v17 Phase B — DB write-through (upsert by userId PK).
    try {
      const db: any = getDb();
      db.transaction((tx: any) => {
        // Try insert first; on conflict, update.
        try {
          tx.insert(collectiveSettingsTable).values({
            userId,
            tenantId: DEFAULT_CHAPTER_TENANT_ID,
            chapterId: DEFAULT_CHAPTER_ID,
            anonymityLevel: next.anonymityLevel,
            notifyOnDscScore: next.notifyOnDscScore ? 1 : 0,
            notifyOnDealRoomUpdate: next.notifyOnDealRoomUpdate ? 1 : 0,
            dealRoomVisibility: next.dealRoomVisibility,
            version: next.version,
            prevHash: next.prevHash,
            hash: next.hash,
            updatedBy: actorUserId,
            updatedAt: now,
            createdAt: now,
          } as any).run();
        } catch (_e) {
          tx.update(collectiveSettingsTable)
            .set({
              anonymityLevel: next.anonymityLevel,
              notifyOnDscScore: next.notifyOnDscScore ? 1 : 0,
              notifyOnDealRoomUpdate: next.notifyOnDealRoomUpdate ? 1 : 0,
              dealRoomVisibility: next.dealRoomVisibility,
              version: next.version,
              prevHash: next.prevHash,
              hash: next.hash,
              updatedBy: actorUserId,
              updatedAt: now,
            } as any)
            .where(eq((collectiveSettingsTable as any).userId, userId))
            .run();
        }
      });
    } catch (err) {
      log.warn("[collectiveSettingsStore.patch] DB write failed (memory only):", (err as Error).message);
    }'''
    new_patch_tx = '''    // v17 Phase B — DB write-through (upsert by userId PK).
    void pTransaction(getDb() as any, async (tx: any) => {
      // Try insert first; on conflict, update.
      try {
        await pRun(tx.insert(collectiveSettingsTable).values({
          userId,
          tenantId: DEFAULT_CHAPTER_TENANT_ID,
          chapterId: DEFAULT_CHAPTER_ID,
          anonymityLevel: next.anonymityLevel,
          notifyOnDscScore: next.notifyOnDscScore ? 1 : 0,
          notifyOnDealRoomUpdate: next.notifyOnDealRoomUpdate ? 1 : 0,
          dealRoomVisibility: next.dealRoomVisibility,
          version: next.version,
          prevHash: next.prevHash,
          hash: next.hash,
          updatedBy: actorUserId,
          updatedAt: now,
          createdAt: now,
        } as any));
      } catch (_e) {
        await pRun(tx.update(collectiveSettingsTable)
          .set({
            anonymityLevel: next.anonymityLevel,
            notifyOnDscScore: next.notifyOnDscScore ? 1 : 0,
            notifyOnDealRoomUpdate: next.notifyOnDealRoomUpdate ? 1 : 0,
            dealRoomVisibility: next.dealRoomVisibility,
            version: next.version,
            prevHash: next.prevHash,
            hash: next.hash,
            updatedBy: actorUserId,
            updatedAt: now,
          } as any)
          .where(eq((collectiveSettingsTable as any).userId, userId)));
      }
    }).catch((err: unknown) => {
      log.warn("[collectiveSettingsStore.patch] DB write failed (memory only):", (err as Error).message);
    });'''
    content = content.replace(old_patch_tx, new_patch_tx)
    
    # hydrateCollectiveSettingsStore: fix .all()
    old_hydrate_all = '''    const rows = db
      .select()
      .from(collectiveSettingsTable)
      .where(isNull((collectiveSettingsTable as any).deletedAt))
      .all() as any[];'''
    new_hydrate_all = '''    const rows = await pAll<any>(db
      .select()
      .from(collectiveSettingsTable)
      .where(isNull((collectiveSettingsTable as any).deletedAt)));'''
    content = content.replace(old_hydrate_all, new_hydrate_all)
    
    write_file(path, content)
    print(f"✓ collectiveSettingsStore.ts migrated")


def migrate_dataroomStore():
    path = os.path.join(BASE, "server/dataroomStore.ts")
    backup_file(path)
    content = read_file(path)
    
    # Add portable import
    old_import = 'import { getDb } from "./db/connection";\nimport {'
    new_import = 'import { getDb } from "./db/connection";\nimport { pAll, pRun, pTransaction } from "./db/portable";\nimport {'
    content = content.replace(old_import, new_import, 1)
    
    # persistFolder: sync db.transaction -> void pTransaction
    old_persist_folder = '''/** Persist a folder row. Idempotent via primary-key onConflictDoNothing. */
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
}'''
    new_persist_folder = '''/** Persist a folder row. Idempotent via primary-key onConflictDoNothing. */
function persistFolder(f: Folder): void {
  void pTransaction(getDb(), async (tx: any) => {
    await pRun(tx.insert(dataroomFoldersTable)
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
      .onConflictDoNothing({ target: dataroomFoldersTable.id }));
  }).catch((err: unknown) => {
    log.warn("[dataroomStore.persistFolder] DB write failed:", (err as Error).message);
  });
}'''
    content = content.replace(old_persist_folder, new_persist_folder)
    
    # persistFile: sync db.transaction -> void pTransaction
    old_persist_file = '''/** Persist a file row (metadata only — bytes stay in memory). */
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
}'''
    new_persist_file = '''/** Persist a file row (metadata only — bytes stay in memory). */
function persistFile(f: DRFile): void {
  void pTransaction(getDb(), async (tx: any) => {
    await pRun(tx.insert(dataroomFilesTable)
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
      .onConflictDoNothing({ target: dataroomFilesTable.id }));
  }).catch((err: unknown) => {
    log.warn("[dataroomStore.persistFile] DB write failed:", (err as Error).message);
  });
}'''
    content = content.replace(old_persist_file, new_persist_file)
    
    # persistPermission: complex tx with if/else .run() inside
    old_persist_perm = '''/** Upsert a permission row keyed by (investorId, folderId). */
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
}'''
    new_persist_perm = '''/** Upsert a permission row keyed by (investorId, folderId). */
function persistPermission(p: Permission, tenantId: string): void {
  void pTransaction(getDb(), async (tx: any) => {
    // Look up existing row by composite (investorId, folderId).
    const existing = await pAll<{ id: string }>(tx
      .select({ id: dataroomPermissionsTable.id })
      .from(dataroomPermissionsTable)
      .where(and(
        eq(dataroomPermissionsTable.investorId, p.investorId),
        eq(dataroomPermissionsTable.folderId, p.folderId),
        isNull(dataroomPermissionsTable.deletedAt),
      ))
      .limit(1));

    const now = new Date().toISOString();
    if (existing.length > 0) {
      await pRun(tx.update(dataroomPermissionsTable)
        .set({
          view: p.view,
          download: p.download,
          updatedAt: now,
        })
        .where(eq(dataroomPermissionsTable.id, existing[0].id)));
    } else {
      await pRun(tx.insert(dataroomPermissionsTable)
        .values({
          id: `dperm_${randomBytes(4).toString("hex")}`,
          tenantId,
          investorId: p.investorId,
          folderId: p.folderId,
          view: p.view,
          download: p.download,
          updatedAt: now,
          deletedAt: null,
        }));
    }
  }).catch((err: unknown) => {
    log.warn("[dataroomStore.persistPermission] DB write failed:", (err as Error).message);
  });
}'''
    content = content.replace(old_persist_perm, new_persist_perm)
    
    # persistEvent: sync db.transaction -> void pTransaction
    old_persist_event = '''/** Persist a dataroom event row (append-only — no soft-delete column). */
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
}'''
    new_persist_event = '''/** Persist a dataroom event row (append-only — no soft-delete column). */
function persistEvent(e: DREvent): void {
  void pTransaction(getDb(), async (tx: any) => {
    await pRun(tx.insert(dataroomEventsTable)
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
      .onConflictDoNothing({ target: dataroomEventsTable.id }));
  }).catch((err: unknown) => {
    log.warn("[dataroomStore.persistEvent] DB write failed:", (err as Error).message);
  });
}'''
    content = content.replace(old_persist_event, new_persist_event)
    
    # hydrateDataroomStore: fix all the .all() calls inside the async function
    # These are safe to use await pAll since hydrateDataroomStore is already async
    replacements = [
        (
            '    const folderRows = db\n      .select()\n      .from(dataroomFoldersTable)\n      .where(isNull(dataroomFoldersTable.deletedAt))\n      .all() as any[];',
            '    const folderRows = await pAll<any>(db\n      .select()\n      .from(dataroomFoldersTable)\n      .where(isNull(dataroomFoldersTable.deletedAt)));'
        ),
        (
            '    const fileRows = db\n      .select()\n      .from(dataroomFilesTable)\n      .where(isNull(dataroomFilesTable.deletedAt))\n      .all() as any[];',
            '    const fileRows = await pAll<any>(db\n      .select()\n      .from(dataroomFilesTable)\n      .where(isNull(dataroomFilesTable.deletedAt)));'
        ),
        (
            '    const permRows = db\n      .select()\n      .from(dataroomPermissionsTable)\n      .where(isNull(dataroomPermissionsTable.deletedAt))\n      .all() as any[];',
            '    const permRows = await pAll<any>(db\n      .select()\n      .from(dataroomPermissionsTable)\n      .where(isNull(dataroomPermissionsTable.deletedAt)));'
        ),
        (
            '    const evRowsExisting = db.select().from(dataroomEventsTable).all() as any[];',
            '    const evRowsExisting = await pAll<any>(db.select().from(dataroomEventsTable));'
        ),
        (
            '    const folderRows2 = db\n      .select()\n      .from(dataroomFoldersTable)\n      .where(isNull(dataroomFoldersTable.deletedAt))\n      .all() as any[];',
            '    const folderRows2 = await pAll<any>(db\n      .select()\n      .from(dataroomFoldersTable)\n      .where(isNull(dataroomFoldersTable.deletedAt)));'
        ),
        (
            '    const fileRows2 = db\n      .select()\n      .from(dataroomFilesTable)\n      .where(isNull(dataroomFilesTable.deletedAt))\n      .all() as any[];',
            '    const fileRows2 = await pAll<any>(db\n      .select()\n      .from(dataroomFilesTable)\n      .where(isNull(dataroomFilesTable.deletedAt)));'
        ),
        (
            '    const permRows2 = db\n      .select()\n      .from(dataroomPermissionsTable)\n      .where(isNull(dataroomPermissionsTable.deletedAt))\n      .all() as any[];',
            '    const permRows2 = await pAll<any>(db\n      .select()\n      .from(dataroomPermissionsTable)\n      .where(isNull(dataroomPermissionsTable.deletedAt)));'
        ),
        (
            '    const evRows = db\n      .select()\n      .from(dataroomEventsTable)\n      .orderBy(asc(dataroomEventsTable.ts))\n      .all() as any[];',
            '    const evRows = await pAll<any>(db\n      .select()\n      .from(dataroomEventsTable)\n      .orderBy(asc(dataroomEventsTable.ts)));'
        ),
    ]
    for old, new in replacements:
        content = content.replace(old, new)
    
    write_file(path, content)
    print(f"✓ dataroomStore.ts migrated")


def migrate_founderCrmStore():
    path = os.path.join(BASE, "server/founderCrmStore.ts")
    backup_file(path)
    content = read_file(path)
    
    # Add portable import
    old_import = 'import { and, eq, isNull } from "drizzle-orm";\nimport { emitSync } from "./sprint10Telemetry";'
    new_import = 'import { and, eq, isNull } from "drizzle-orm";\nimport { pAll, pRun, pTransaction } from "./db/portable";\nimport { emitSync } from "./sprint10Telemetry";'
    content = content.replace(old_import, new_import)
    
    # seedDemoContactsIntoDb: sync transaction -> void pTransaction
    old_seed_tx = '''  try {
    const db = getDb();
    db.transaction((tx: any) => {
      for (const c of DEMO_SEED) {
        // CROSS-TENANT (seed) — demo seeding writes across tenants on first boot.
        const existing = tx
          .select({ id: founderCrmContactsTable.id })
          .from(founderCrmContactsTable)
          .where(crossTenant(eq(founderCrmContactsTable.id, c.id), founderCrmContactsTable))
          .limit(1)
          .all() as any[];
        if (existing.length === 0) {
          tx.insert(founderCrmContactsTable).values(contactToRow(c)).run();
        }
      }
    });
  } catch (err) {
    log.warn("[founderCrmStore] demo seed write-through failed:", (err as Error).message);
  }'''
    new_seed_tx = '''  void pTransaction(getDb(), async (tx: any) => {
    for (const c of DEMO_SEED) {
      // CROSS-TENANT (seed) — demo seeding writes across tenants on first boot.
      const existing = await pAll<{ id: string }>(tx
        .select({ id: founderCrmContactsTable.id })
        .from(founderCrmContactsTable)
        .where(crossTenant(eq(founderCrmContactsTable.id, c.id), founderCrmContactsTable))
        .limit(1));
      if (existing.length === 0) {
        await pRun(tx.insert(founderCrmContactsTable).values(contactToRow(c)));
      }
    }
  }).catch((err: unknown) => {
    log.warn("[founderCrmStore] demo seed write-through failed:", (err as Error).message);
  });'''
    content = content.replace(old_seed_tx, new_seed_tx)
    
    # POST handler: sync transaction -> void pTransaction
    old_post_tx = '''    try {
      const db = getDb();
      db.transaction((tx: any) => {
        tx.insert(founderCrmContactsTable).values(contactToRow(c)).run();
      });
    } catch (err) {
      log.error("[founderCrmStore POST] DB write failed:", (err as Error).message);
    }'''
    new_post_tx = '''    void pTransaction(getDb(), async (tx: any) => {
      await pRun(tx.insert(founderCrmContactsTable).values(contactToRow(c)));
    }).catch((err: unknown) => {
      log.error("[founderCrmStore POST] DB write failed:", (err as Error).message);
    });'''
    content = content.replace(old_post_tx, new_post_tx)
    
    # PATCH handler: sync transaction -> void pTransaction
    old_patch_tx = '''    try {
      const db = getDb();
      const tenantId = tenantForCompany(c.companyId);
      db.transaction((tx: any) => {
        tx.update(founderCrmContactsTable)
          .set({
            stage: c.stage,
            notes: c.notes,
            notesUpdatedAt: c.notesUpdatedAt,
            tasks: JSON.stringify(c.tasks),
            updatedAt: new Date().toISOString(),
          })
          .where(withTenant(eq(founderCrmContactsTable.id, c.id), { tenantId, table: founderCrmContactsTable }))
          .run();
      });
    } catch (err) {
      log.error("[founderCrmStore PATCH] DB write failed:", (err as Error).message);
    }'''
    new_patch_tx = '''    const tenantId = tenantForCompany(c.companyId);
    void pTransaction(getDb(), async (tx: any) => {
      await pRun(tx.update(founderCrmContactsTable)
        .set({
          stage: c.stage,
          notes: c.notes,
          notesUpdatedAt: c.notesUpdatedAt,
          tasks: JSON.stringify(c.tasks),
          updatedAt: new Date().toISOString(),
        })
        .where(withTenant(eq(founderCrmContactsTable.id, c.id), { tenantId, table: founderCrmContactsTable })));
    }).catch((err: unknown) => {
      log.error("[founderCrmStore PATCH] DB write failed:", (err as Error).message);
    });'''
    content = content.replace(old_patch_tx, new_patch_tx)
    
    # hydrateFounderCrmStore: fix .all()
    old_hydrate_all = '''    const rows = db
      .select()
      .from(founderCrmContactsTable)
      // CROSS-TENANT (boot hydration) — justified because we read all rows then
      // assign each to its owning tenant's cache. Each row carries its tenant_id,
      // and the cache is filtered per-request by resolveCompanyId().
      .where(crossTenant(isNull(founderCrmContactsTable.deletedAt), founderCrmContactsTable, { skipSoftDelete: true }))
      .all() as any[];'''
    new_hydrate_all = '''    const rows = await pAll<any>(db
      .select()
      .from(founderCrmContactsTable)
      // CROSS-TENANT (boot hydration) — justified because we read all rows then
      // assign each to its owning tenant's cache. Each row carries its tenant_id,
      // and the cache is filtered per-request by resolveCompanyId().
      .where(crossTenant(isNull(founderCrmContactsTable.deletedAt), founderCrmContactsTable, { skipSoftDelete: true })));'''
    content = content.replace(old_hydrate_all, new_hydrate_all)
    
    write_file(path, content)
    print(f"✓ founderCrmStore.ts migrated")


def migrate_gdprRoutes():
    path = os.path.join(BASE, "server/gdprRoutes.ts")
    backup_file(path)
    content = read_file(path)
    
    # Add portable import
    old_import = 'import { eq } from "drizzle-orm";\nimport { createHash, randomBytes } from "node:crypto";\n\nimport { requireAuth, requireAdmin } from "./lib/authMiddleware";\nimport { getDb } from "./db/connection";'
    new_import = 'import { eq } from "drizzle-orm";\nimport { createHash, randomBytes } from "node:crypto";\n\nimport { requireAuth, requireAdmin } from "./lib/authMiddleware";\nimport { getDb } from "./db/connection";\nimport { pAll, pRun, pTransaction } from "./db/portable";'
    content = content.replace(old_import, new_import)
    
    # lastDeleteHash: fix .all()
    old_last_hash = '''    const rows: Array<{ curr_hash?: string; currHash?: string }> = db
      .select()
      .from(dataDeleteLogTable)
      .all();'''
    new_last_hash = '''    const rows: Array<{ curr_hash?: string; currHash?: string }> = await pAll(db
      .select()
      .from(dataDeleteLogTable));'''
    content = content.replace(old_last_hash, new_last_hash)
    
    # lastDeleteHash must become async
    old_last_fn = 'function lastDeleteHash(): string | null {'
    new_last_fn = 'async function lastDeleteHash(): Promise<string | null> {'
    content = content.replace(old_last_fn, new_last_fn)
    
    # buildExportEnvelope: fix .all() calls - make async
    old_build_fn = 'function buildExportEnvelope(userId: string): {'
    new_build_fn = 'async function buildExportEnvelope(userId: string): Promise<{'
    content = content.replace(old_build_fn, new_build_fn)
    
    # Fix the .all() calls in buildExportEnvelope
    replacements_gdpr = [
        (
            '  const userRows: any[] = db\n    .select()\n    .from(usersTable)\n    .where(eq(usersTable.id, userId))\n    .all();\n  const identity = userRows[0] ?? null;\n  const email = identity?.email ?? null;\n\n  const memberships: any[] = db\n    .select()\n    .from(chapterMembershipsTable)\n    .where(eq(chapterMembershipsTable.userId, userId))\n    .all();\n\n  let applications: any[] = [];\n  if (email) {\n    applications = db\n      .select()\n      .from(consortiumApplicationsTable)\n      .where(eq(consortiumApplicationsTable.contactEmail, email))\n      .all();\n  }\n\n  const exportLogs: any[] = db\n    .select()\n    .from(dataExportLogTable)\n    .where(eq(dataExportLogTable.userId, userId))\n    .all();\n\n  const deleteLogs: any[] = db\n    .select()\n    .from(dataDeleteLogTable)\n    .where(eq(dataDeleteLogTable.userId, userId))\n    .all();',
            '  const userRows: any[] = await pAll(db\n    .select()\n    .from(usersTable)\n    .where(eq(usersTable.id, userId)));\n  const identity = userRows[0] ?? null;\n  const email = identity?.email ?? null;\n\n  const memberships: any[] = await pAll(db\n    .select()\n    .from(chapterMembershipsTable)\n    .where(eq(chapterMembershipsTable.userId, userId)));\n\n  let applications: any[] = [];\n  if (email) {\n    applications = await pAll(db\n      .select()\n      .from(consortiumApplicationsTable)\n      .where(eq(consortiumApplicationsTable.contactEmail, email)));\n  }\n\n  const exportLogs: any[] = await pAll(db\n    .select()\n    .from(dataExportLogTable)\n    .where(eq(dataExportLogTable.userId, userId)));\n\n  const deleteLogs: any[] = await pAll(db\n    .select()\n    .from(dataDeleteLogTable)\n    .where(eq(dataDeleteLogTable.userId, userId)));'
        ),
    ]
    for old, new in replacements_gdpr:
        content = content.replace(old, new)
    
    # data-export route: fix db.transaction, await buildExportEnvelope, await lastDeleteHash
    old_export_tx = '''        const { envelope, bytes } = buildExportEnvelope(userId);
        const db = getDb();
        const now = nowIso();
        const logRow = {
          id: newId("dexp"),
          tenantId: ctx?.tenantId ?? "tenant_unknown",
          userId,
          exportedAt: now,
          format: "json",
          bytes,
          requestIp: clientIp(req),
          createdAt: now,
        };
        db.transaction((tx: any) => {
          tx.insert(dataExportLogTable).values(logRow).run();
        });'''
    new_export_tx = '''        const { envelope, bytes } = await buildExportEnvelope(userId);
        const db = getDb();
        const now = nowIso();
        const logRow = {
          id: newId("dexp"),
          tenantId: ctx?.tenantId ?? "tenant_unknown",
          userId,
          exportedAt: now,
          format: "json",
          bytes,
          requestIp: clientIp(req),
          createdAt: now,
        };
        await pTransaction(db, async (tx: any) => {
          await pRun(tx.insert(dataExportLogTable).values(logRow));
        });'''
    content = content.replace(old_export_tx, new_export_tx)
    
    # data-export route handler: needs to be async
    old_export_handler = '    (req: Request, res: Response): void => {\n      const ctx = (req as Request & { userContext?: { userId?: string; tenantId?: string } }).userContext;\n      const userId = ctx?.userId;\n      if (!userId) {\n        res.status(401).json({ error: "missing_identity" });\n        return;\n      }\n      try {\n        const { envelope, bytes } = buildExportEnvelope(userId);'
    new_export_handler = '    async (req: Request, res: Response): Promise<void> => {\n      const ctx = (req as Request & { userContext?: { userId?: string; tenantId?: string } }).userContext;\n      const userId = ctx?.userId;\n      if (!userId) {\n        res.status(401).json({ error: "missing_identity" });\n        return;\n      }\n      try {\n        const { envelope, bytes } = await buildExportEnvelope(userId);'
    content = content.replace(old_export_handler, new_export_handler)
    
    # data-delete route: fix .all(), db.transaction, lastDeleteHash
    # Make the route handler async
    old_delete_handler = '    async (req: Request, res: Response): Promise<void> => {' 
    # It's already async for the other ones, need to find the right one
    # Actually let me check what the delete handler looks like - find the specific pattern
    old_delete_tx1 = '''        const userRows: any[] = db
          .select()
          .from(usersTable)
          .where(eq(usersTable.id, userId))
          .all();
        if (!userRows.length) {
          res.status(404).json({ error: "user_not_found" });
          return;
        }
        const email = userRows[0].email as string;

        const prevHash = lastDeleteHash();'''
    new_delete_tx1 = '''        const userRows: any[] = await pAll(db
          .select()
          .from(usersTable)
          .where(eq(usersTable.id, userId)));
        if (!userRows.length) {
          res.status(404).json({ error: "user_not_found" });
          return;
        }
        const email = userRows[0].email as string;

        const prevHash = await lastDeleteHash();'''
    content = content.replace(old_delete_tx1, new_delete_tx1)

    # Make the /api/me/data-delete route async
    old_delete_route_header = '''  app.post(
    "/api/me/data-delete",
    requireAuth,
    (req: Request, res: Response): void => {
      const ctx = (req as Request & { userContext?: { userId?: string; tenantId?: string } }).userContext;
      const userId = ctx?.userId;
      if (!userId) {
        res.status(401).json({ error: "missing_identity" });
        return;
      }
      const reason ='''
    new_delete_route_header = '''  app.post(
    "/api/me/data-delete",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      const ctx = (req as Request & { userContext?: { userId?: string; tenantId?: string } }).userContext;
      const userId = ctx?.userId;
      if (!userId) {
        res.status(401).json({ error: "missing_identity" });
        return;
      }
      const reason ='''
    content = content.replace(old_delete_route_header, new_delete_route_header)

    # Fix the db.transaction in data-delete route
    old_delete_dbtx = '''        db.transaction((tx: any) => {
          tx.update(usersTable)
            .set({
              deletionRequestedAt: now,
              deletionToken: token,
            })
            .where(eq(usersTable.id, userId))
            .run();
          tx.insert(dataDeleteLogTable)
            .values({
              id: logId,
              tenantId: ctx?.tenantId ?? "tenant_unknown",
              userId,
              requestedAt: now,
              confirmedAt: null,
              initiatedByUserId: userId,
              reason,
              recordsRedacted: 0,
              prevHash,
              currHash,
              createdAt: now,
            })
            .run();
        });'''
    new_delete_dbtx = '''        await pTransaction(db, async (tx: any) => {
          await pRun(tx.update(usersTable)
            .set({
              deletionRequestedAt: now,
              deletionToken: token,
            })
            .where(eq(usersTable.id, userId)));
          await pRun(tx.insert(dataDeleteLogTable)
            .values({
              id: logId,
              tenantId: ctx?.tenantId ?? "tenant_unknown",
              userId,
              requestedAt: now,
              confirmedAt: null,
              initiatedByUserId: userId,
              reason,
              recordsRedacted: 0,
              prevHash,
              currHash,
              createdAt: now,
            }));
        });'''
    content = content.replace(old_delete_dbtx, new_delete_dbtx)
    
    # /api/me/data-delete/confirm route: fix .all() and db.transaction - make handler async
    old_confirm_header = '''  app.post(
    "/api/me/data-delete/confirm",
    requireAuth,
    (req: Request, res: Response): void => {'''
    new_confirm_header = '''  app.post(
    "/api/me/data-delete/confirm",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {'''
    content = content.replace(old_confirm_header, new_confirm_header)

    # Fix .all() in confirm route
    old_confirm_all1 = '''        const userRows: any[] = db
          .select()
          .from(usersTable)
          .where(eq(usersTable.id, userId))
          .all();
        const u = userRows[0];'''
    new_confirm_all1 = '''        const userRows: any[] = await pAll(db
          .select()
          .from(usersTable)
          .where(eq(usersTable.id, userId)));
        const u = userRows[0];'''
    content = content.replace(old_confirm_all1, new_confirm_all1)

    old_confirm_all2 = '''        const pending: any[] = db
          .select()
          .from(dataDeleteLogTable)
          .where(eq(dataDeleteLogTable.userId, userId))
          .all();'''
    new_confirm_all2 = '''        const pending: any[] = await pAll(db
          .select()
          .from(dataDeleteLogTable)
          .where(eq(dataDeleteLogTable.userId, userId)));'''
    content = content.replace(old_confirm_all2, new_confirm_all2)

    old_confirm_tx = '''        db.transaction((tx: any) => {
          tx.update(dataDeleteLogTable)
            .set({ confirmedAt: now })
            .where(eq(dataDeleteLogTable.id, pendingRow.id))
            .run();
        });'''
    new_confirm_tx = '''        await pTransaction(db, async (tx: any) => {
          await pRun(tx.update(dataDeleteLogTable)
            .set({ confirmedAt: now })
            .where(eq(dataDeleteLogTable.id, pendingRow.id)));
        });'''
    content = content.replace(old_confirm_tx, new_confirm_tx)

    # /api/admin/users/:id/anonymize route: fix .all() and db.transaction - make handler async
    old_anon_header = '''  app.post(
    "/api/admin/users/:id/anonymize",
    requireAuth,
    requireAdmin,
    (req: Request, res: Response): void => {'''
    new_anon_header = '''  app.post(
    "/api/admin/users/:id/anonymize",
    requireAuth,
    requireAdmin,
    async (req: Request, res: Response): Promise<void> => {'''
    content = content.replace(old_anon_header, new_anon_header)

    old_anon_all1 = '''        const userRows: any[] = db
          .select()
          .from(usersTable)
          .where(eq(usersTable.id, targetId))
          .all();
        const target = userRows[0];'''
    new_anon_all1 = '''        const userRows: any[] = await pAll(db
          .select()
          .from(usersTable)
          .where(eq(usersTable.id, targetId)));
        const target = userRows[0];'''
    content = content.replace(old_anon_all1, new_anon_all1)

    old_anon_all2 = '''        const membershipRows: any[] = db
          .select()
          .from(chapterMembershipsTable)
          .where(eq(chapterMembershipsTable.userId, targetId))
          .all();'''
    new_anon_all2 = '''        const membershipRows: any[] = await pAll(db
          .select()
          .from(chapterMembershipsTable)
          .where(eq(chapterMembershipsTable.userId, targetId)));'''
    content = content.replace(old_anon_all2, new_anon_all2)

    old_anon_prevhash = 'const prevHash = lastDeleteHash();'
    new_anon_prevhash = 'const prevHash = await lastDeleteHash();'
    content = content.replace(old_anon_prevhash, new_anon_prevhash)

    old_anon_tx = '''        db.transaction((tx: any) => {
          // Anonymize the user identity in place.
          tx.update(usersTable)
            .set({
              email: anonEmail,
              name: "Deleted User",
              avatarUrl: null,
              anonymizedAt: now,
              anonymizedByUserId: actor,
              deletedAt: now,
            })
            .where(eq(usersTable.id, targetId))
            .run();
          // Revoke all chapter memberships for the user.
          tx.update(chapterMembershipsTable)
            .set({ status: "revoked", updatedAt: now, deletedAt: now })
            .where(eq(chapterMembershipsTable.userId, targetId))
            .run();
          // Append the anonymization to the hash chain.
          tx.insert(dataDeleteLogTable)
            .values({
              id: logId,
              tenantId: target.tenant_id ?? target.tenantId ?? "tenant_unknown",
              userId: targetId,
              requestedAt: now,
              confirmedAt: now,
              initiatedByUserId: actor,
              reason: "admin_anonymization",
              recordsRedacted,
              prevHash,
              currHash,
              createdAt: now,
            })
            .run();
        });'''
    new_anon_tx = '''        await pTransaction(db, async (tx: any) => {
          // Anonymize the user identity in place.
          await pRun(tx.update(usersTable)
            .set({
              email: anonEmail,
              name: "Deleted User",
              avatarUrl: null,
              anonymizedAt: now,
              anonymizedByUserId: actor,
              deletedAt: now,
            })
            .where(eq(usersTable.id, targetId)));
          // Revoke all chapter memberships for the user.
          await pRun(tx.update(chapterMembershipsTable)
            .set({ status: "revoked", updatedAt: now, deletedAt: now })
            .where(eq(chapterMembershipsTable.userId, targetId)));
          // Append the anonymization to the hash chain.
          await pRun(tx.insert(dataDeleteLogTable)
            .values({
              id: logId,
              tenantId: target.tenant_id ?? target.tenantId ?? "tenant_unknown",
              userId: targetId,
              requestedAt: now,
              confirmedAt: now,
              initiatedByUserId: actor,
              reason: "admin_anonymization",
              recordsRedacted,
              prevHash,
              currHash,
              createdAt: now,
            }));
        });'''
    content = content.replace(old_anon_tx, new_anon_tx)

    # Fix _gdprInternal export to reference async functions
    old_internal = '''export const _gdprInternal = {
  buildExportEnvelope,
  computeHash,
  lastDeleteHash,
};'''
    new_internal = '''export const _gdprInternal = {
  buildExportEnvelope,
  computeHash,
  lastDeleteHash,
};'''
    # no change needed here

    write_file(path, content)
    print(f"✓ gdprRoutes.ts migrated")


def migrate_auditChainQuarterly():
    path = os.path.join(BASE, "server/jobs/auditChainQuarterly.ts")
    backup_file(path)
    content = read_file(path)
    
    # Add portable import
    old_import = 'import { getDb } from "../db/connection";\nimport {'
    new_import = 'import { getDb } from "../db/connection";\nimport { pAll, pRun, pTransaction } from "../db/portable";\nimport {'
    content = content.replace(old_import, new_import, 1)
    
    # listActiveChapters: fix .all()
    old_list_chapters = '''    const rows = db
      .select({ id: chaptersTable.id, tenantId: chaptersTable.tenantId })
      .from(chaptersTable)
      .where(
        and(
          // Status "active" or "paused" — we still verify paused chapters.
          // Soft-deleted chapters are skipped.
          isNull((chaptersTable as any).deletedAt),
        ),
      )
      .all() as Array<{ id: string; tenantId: string }>;
    return rows;'''
    new_list_chapters = '''    const rows = await pAll<{ id: string; tenantId: string }>(db
      .select({ id: chaptersTable.id, tenantId: chaptersTable.tenantId })
      .from(chaptersTable)
      .where(
        and(
          // Status "active" or "paused" — we still verify paused chapters.
          // Soft-deleted chapters are skipped.
          isNull((chaptersTable as any).deletedAt),
        ),
      ));
    return rows;'''
    content = content.replace(old_list_chapters, new_list_chapters)
    
    # listActiveChapters must become async
    old_list_fn = '/** Read the active chapters list (one row per chapter). */\nfunction listActiveChapters(): Array<{ id: string; tenantId: string }> {'
    new_list_fn = '/** Read the active chapters list (one row per chapter). */\nasync function listActiveChapters(): Promise<Array<{ id: string; tenantId: string }>> {'
    content = content.replace(old_list_fn, new_list_fn)

    # persistResult: sync db.transaction -> void pTransaction
    old_persist_result = '''  try {
    const db: any = getDb();
    db.transaction((tx: any) => {
      tx.insert(auditChainVerificationsTable)
        .values({
          id: genId(),
          tenantId,
          chapterId,
          tableName: result.table,
          verifiedCount: result.verified,
          brokenCount: result.broken_at_row_id ? 1 : 0,
          brokenFirstId: result.broken_at_row_id,
          totalRows: result.total_rows,
          durationMs: result.duration_ms,
          startedAt: result.started_at,
          finishedAt: result.finished_at,
          detailsJson: JSON.stringify({
            broken_at_index: result.broken_at_index,
            first_bad_field_hint: result.first_bad_field_hint,
            last_known_good_hash: result.last_known_good_hash,
          }),
        })
        .run();
    });
  } catch (err) {
    log.error('''
    new_persist_result = '''  void pTransaction(getDb() as any, async (tx: any) => {
    await pRun(tx.insert(auditChainVerificationsTable)
      .values({
        id: genId(),
        tenantId,
        chapterId,
        tableName: result.table,
        verifiedCount: result.verified,
        brokenCount: result.broken_at_row_id ? 1 : 0,
        brokenFirstId: result.broken_at_row_id,
        totalRows: result.total_rows,
        durationMs: result.duration_ms,
        startedAt: result.started_at,
        finishedAt: result.finished_at,
        detailsJson: JSON.stringify({
          broken_at_index: result.broken_at_index,
          first_bad_field_hint: result.first_bad_field_hint,
          last_known_good_hash: result.last_known_good_hash,
        }),
      }));
  }).catch((err: unknown) => {
    log.error('''
    content = content.replace(old_persist_result, new_persist_result)

    # runAuditChainQuarterlySweep must await listActiveChapters
    old_run_sweep = '''  const chapters = listActiveChapters();'''
    new_run_sweep = '''  const chapters = await listActiveChapters();'''
    content = content.replace(old_run_sweep, new_run_sweep)
    
    # runAuditChainQuarterlySweep must be async
    old_run_fn = '/** Run the full sweep once. Synchronous (sqlite single-threaded). */\nexport function runAuditChainQuarterlySweep(): QuarterlySweepSummary {'
    new_run_fn = '/** Run the full sweep once. */\nexport async function runAuditChainQuarterlySweep(): Promise<QuarterlySweepSummary> {'
    content = content.replace(old_run_fn, new_run_fn)

    # Fix the timer invocation to handle async
    old_timer_call = '''    try {
      runAuditChainQuarterlySweep();
    } catch (err) {'''
    new_timer_call = '''    try {
      void runAuditChainQuarterlySweep();
    } catch (err) {'''
    content = content.replace(old_timer_call, new_timer_call)

    write_file(path, content)
    print(f"✓ auditChainQuarterly.ts migrated")


def migrate_auditChainVerifier():
    path = os.path.join(BASE, "server/lib/auditChainVerifier.ts")
    backup_file(path)
    content = read_file(path)
    
    # Add portable import
    old_import = 'import { createHash } from "node:crypto";\nimport { getDb } from "../db/connection";'
    new_import = 'import { createHash } from "node:crypto";\nimport { getDb } from "../db/connection";\nimport { pAll, pTransaction } from "../db/portable";'
    content = content.replace(old_import, new_import)
    
    # verifyChainForTable: fix the db.transaction((tx) => { q.all() }) pattern
    old_verify_tx = '''  let rows: any[] = [];
  try {
    const db: any = getDb();
    // Read-only transaction: select rows in chronological order, apply filters.
    db.transaction((tx: any) => {
      let q = tx.select().from(cfg.table);
      // No WHERE chaining via drizzle here because filters vary; we filter
      // in JS for simplicity + portability across the 19 tables. This is
      // acceptable because verification is an admin-only batch operation.
      rows = q.all() as any[];
    });
  } catch (err) {'''
    new_verify_tx = '''  let rows: any[] = [];
  try {
    const db: any = getDb();
    // Read-only transaction: select rows in chronological order, apply filters.
    await pTransaction(db, async (tx: any) => {
      const q = tx.select().from(cfg.table);
      // No WHERE chaining via drizzle here because filters vary; we filter
      // in JS for simplicity + portability across the 19 tables. This is
      // acceptable because verification is an admin-only batch operation.
      rows = await pAll(q);
    });
  } catch (err) {'''
    content = content.replace(old_verify_tx, new_verify_tx)
    
    # verifyChainForTable must become async
    old_verify_fn = 'export function verifyChainForTable(\n  tableName: string,\n  opts: ChainVerifyOpts = {},\n): ChainVerifyResult {'
    new_verify_fn = 'export async function verifyChainForTable(\n  tableName: string,\n  opts: ChainVerifyOpts = {},\n): Promise<ChainVerifyResult> {'
    content = content.replace(old_verify_fn, new_verify_fn)
    
    # verifyAllChains: must be async and await verifyChainForTable
    old_verify_all = '''export function verifyAllChains(opts: ChainVerifyOpts = {}): ChainVerifyResult[] {
  const out: ChainVerifyResult[] = [];
  for (const cfg of CATALOG) {
    // For chapter-scoped queries on tables without a chapter_id column,
    // skip the chapter filter (verifier will scan tenant-wide rows).
    const effOpts: ChainVerifyOpts = { ...opts };
    if (!cfg.hasChapterId) {
      effOpts.chapterId = undefined;
    }
    out.push(verifyChainForTable(cfg.name, effOpts));
  }
  return out;
}'''
    new_verify_all = '''export async function verifyAllChains(opts: ChainVerifyOpts = {}): Promise<ChainVerifyResult[]> {
  const out: ChainVerifyResult[] = [];
  for (const cfg of CATALOG) {
    // For chapter-scoped queries on tables without a chapter_id column,
    // skip the chapter filter (verifier will scan tenant-wide rows).
    const effOpts: ChainVerifyOpts = { ...opts };
    if (!cfg.hasChapterId) {
      effOpts.chapterId = undefined;
    }
    out.push(await verifyChainForTable(cfg.name, effOpts));
  }
  return out;
}'''
    content = content.replace(old_verify_all, new_verify_all)
    
    write_file(path, content)
    print(f"✓ auditChainVerifier.ts migrated")


def migrate_messagingStore():
    path = os.path.join(BASE, "server/messagingStore.ts")
    backup_file(path)
    content = read_file(path)
    
    # Add portable import
    old_import = 'import { requireAuth } from "./lib/authMiddleware";\nimport { getDb } from "./db/connection";'
    new_import = 'import { requireAuth } from "./lib/authMiddleware";\nimport { getDb } from "./db/connection";\nimport { pAll, pRun, pTransaction } from "./db/portable";'
    content = content.replace(old_import, new_import)
    
    # findMessageByIdAnyTenant: fix .all()
    old_find_msg = '''    const rows = db
      .select()
      .from(messagesTable)
      .where(eq((messagesTable as any).id, id))
      .limit(1)
      .all() as any[];'''
    new_find_msg = '''    const rows = await pAll<any>(db
      .select()
      .from(messagesTable)
      .where(eq((messagesTable as any).id, id))
      .limit(1));'''
    content = content.replace(old_find_msg, new_find_msg)

    # findMessageByIdAnyTenant: make async
    old_find_msg_fn = 'function findMessageByIdAnyTenant(id: string): MessageRow | null {'
    new_find_msg_fn = 'async function findMessageByIdAnyTenant(id: string): Promise<MessageRow | null> {'
    content = content.replace(old_find_msg_fn, new_find_msg_fn)

    # findThreadByIdAnyTenant: fix .all()
    old_find_thread = '''    const rows = db
      .select()
      .from(messageThreadsTable)
      .where(eq((messageThreadsTable as any).id, id))
      .limit(1)
      .all() as any[];'''
    new_find_thread = '''    const rows = await pAll<any>(db
      .select()
      .from(messageThreadsTable)
      .where(eq((messageThreadsTable as any).id, id))
      .limit(1));'''
    content = content.replace(old_find_thread, new_find_thread)

    # findThreadByIdAnyTenant: make async
    old_find_thread_fn = 'function findThreadByIdAnyTenant(id: string): MessageThreadRow | null {'
    new_find_thread_fn = 'async function findThreadByIdAnyTenant(id: string): Promise<MessageThreadRow | null> {'
    content = content.replace(old_find_thread_fn, new_find_thread_fn)

    # findLatestMessageInThread: fix .all() + make async
    old_latest = '''  try {
    const db: any = getDb();
    // CROSS-TENANT (admin) — thread membership establishes scope; per-message
    // tenant filtering would over-constrain when threads span chapters.
    const rows = db
      .select()
      .from(messagesTable)
      .where(eq((messagesTable as any).threadId, threadId))
      .all() as any[];'''
    new_latest = '''  try {
    const db: any = getDb();
    // CROSS-TENANT (admin) — thread membership establishes scope; per-message
    // tenant filtering would over-constrain when threads span chapters.
    const rows = await pAll<any>(db
      .select()
      .from(messagesTable)
      .where(eq((messagesTable as any).threadId, threadId)));'''
    content = content.replace(old_latest, new_latest)

    old_latest_fn = '/** Latest message in a thread (by createdAt). Returns null if none / not found. */\nfunction findLatestMessageInThread(threadId: string): MessageRow | null {'
    new_latest_fn = '/** Latest message in a thread (by createdAt). Returns null if none / not found. */\nasync function findLatestMessageInThread(threadId: string): Promise<MessageRow | null> {'
    content = content.replace(old_latest_fn, new_latest_fn)

    # sharesAnyChapterMembership: fix .all() + make async
    old_shares_all1 = '''    const callerChapters = db
      .select({ cid: (chapterMembershipsTable as any).chapterId })
      .from(chapterMembershipsTable)
      .where(
        and(
          eq((chapterMembershipsTable as any).userId, callerUserId),
          eq((chapterMembershipsTable as any).status, "active"),
          isNull((chapterMembershipsTable as any).deletedAt),
        ),
      )
      .all() as Array<{ cid: string }>;
    if (callerChapters.length === 0) return false;
    const callerChapterSet = new Set(callerChapters.map((r) => r.cid));
    // CROSS-TENANT (admin) — same justification.
    const otherChapters = db
      .select({ cid: (chapterMembershipsTable as any).chapterId })
      .from(chapterMembershipsTable)
      .where(
        and(
          eq((chapterMembershipsTable as any).userId, otherUserId),
          eq((chapterMembershipsTable as any).status, "active"),
          isNull((chapterMembershipsTable as any).deletedAt),
        ),
      )
      .all() as Array<{ cid: string }>;'''
    new_shares_all1 = '''    const callerChapters = await pAll<{ cid: string }>(db
      .select({ cid: (chapterMembershipsTable as any).chapterId })
      .from(chapterMembershipsTable)
      .where(
        and(
          eq((chapterMembershipsTable as any).userId, callerUserId),
          eq((chapterMembershipsTable as any).status, "active"),
          isNull((chapterMembershipsTable as any).deletedAt),
        ),
      ));
    if (callerChapters.length === 0) return false;
    const callerChapterSet = new Set(callerChapters.map((r) => r.cid));
    // CROSS-TENANT (admin) — same justification.
    const otherChapters = await pAll<{ cid: string }>(db
      .select({ cid: (chapterMembershipsTable as any).chapterId })
      .from(chapterMembershipsTable)
      .where(
        and(
          eq((chapterMembershipsTable as any).userId, otherUserId),
          eq((chapterMembershipsTable as any).status, "active"),
          isNull((chapterMembershipsTable as any).deletedAt),
        ),
      ));'''
    content = content.replace(old_shares_all1, new_shares_all1)

    old_shares_fn = '''function sharesAnyChapterMembership(callerUserId: string, otherUserId: string): boolean {
  if (callerUserId === otherUserId) return true;
  try {
    const db: any = getDb();'''
    new_shares_fn = '''async function sharesAnyChapterMembership(callerUserId: string, otherUserId: string): Promise<boolean> {
  if (callerUserId === otherUserId) return true;
  try {
    const db: any = getDb();'''
    content = content.replace(old_shares_fn, new_shares_fn)

    # sendMessageInternal: fix .all() for prevHash lookup and db.transaction - make async
    old_send_fn = 'function sendMessageInternal(args: SendArgs): SendResult {'
    new_send_fn = 'async function sendMessageInternal(args: SendArgs): Promise<SendResult> {'
    content = content.replace(old_send_fn, new_send_fn)

    old_send_prevhash = '''  let prevHash: string | null = null;
  try {
    const tipRows = db
      .select({ h: (messagesTable as any).currHash, c: (messagesTable as any).createdAt })
      .from(messagesTable)
      .where(eq((messagesTable as any).tenantId, tenantId))
      .all() as Array<{ h: string; c: string }>;'''
    new_send_prevhash = '''  let prevHash: string | null = null;
  try {
    const tipRows = await pAll<{ h: string; c: string }>(db
      .select({ h: (messagesTable as any).currHash, c: (messagesTable as any).createdAt })
      .from(messagesTable)
      .where(eq((messagesTable as any).tenantId, tenantId)));'''
    content = content.replace(old_send_prevhash, new_send_prevhash)

    # sendMessageInternal: fix the db.transaction
    old_send_tx = '''  db.transaction((tx: any) => {
    tx.insert(messagesTable).values({
      id: messageRow.id,
      tenantId: messageRow.tenantId,
      chapterId: messageRow.chapterId ?? null,
      threadId: messageRow.threadId ?? null,
      channelType: messageRow.channelType,
      senderUserId: messageRow.senderUserId,
      recipientUserIds: JSON.stringify(messageRow.recipientUserIds),
      subject: messageRow.subject ?? null,
      body: messageRow.body,
      attachments: JSON.stringify(messageRow.attachments),
      readBy: JSON.stringify(messageRow.readBy),
      status: messageRow.status,
      prevHash: messageRow.prevHash,
      currHash: messageRow.currHash,
      createdAt: messageRow.createdAt,
      updatedAt: messageRow.updatedAt,
      deletedAt: null,
    }).run();
    if (newThread) {
      tx.insert(messageThreadsTable).values({
        id: newThread.id,
        tenantId: newThread.tenantId,
        chapterId: newThread.chapterId ?? null,
        title: newThread.title,
        participantUserIds: JSON.stringify(newThread.participantUserIds),
        lastMessageId: newThread.lastMessageId ?? null,
        lastActivityAt: newThread.lastActivityAt,
        createdByUserId: newThread.createdByUserId,
        prevHash: newThread.prevHash,
        currHash: newThread.currHash,
        createdAt: newThread.createdAt,
        updatedAt: newThread.updatedAt,
        deletedAt: null,
      }).run();
    } else if (existingThreadUpdate) {
      tx.update(messageThreadsTable)
        .set({
          lastMessageId: existingThreadUpdate.lastMessageId,
          lastActivityAt: existingThreadUpdate.lastActivityAt,
          updatedAt: now,
        })
        .where(eq((messageThreadsTable as any).id, existingThreadUpdate.id))
        .run();
    }
    // Sender's read receipt is established at send time (denorm parity).
    const receiptId = newId("mrr");
    tx.insert(messageReadReceiptsTable).values({
      id: receiptId,
      messageId: messageRow.id,
      userId: messageRow.senderUserId,
      readAt: now,
    }).run();
  });'''
    new_send_tx = '''  await pTransaction(db, async (tx: any) => {
    await pRun(tx.insert(messagesTable).values({
      id: messageRow.id,
      tenantId: messageRow.tenantId,
      chapterId: messageRow.chapterId ?? null,
      threadId: messageRow.threadId ?? null,
      channelType: messageRow.channelType,
      senderUserId: messageRow.senderUserId,
      recipientUserIds: JSON.stringify(messageRow.recipientUserIds),
      subject: messageRow.subject ?? null,
      body: messageRow.body,
      attachments: JSON.stringify(messageRow.attachments),
      readBy: JSON.stringify(messageRow.readBy),
      status: messageRow.status,
      prevHash: messageRow.prevHash,
      currHash: messageRow.currHash,
      createdAt: messageRow.createdAt,
      updatedAt: messageRow.updatedAt,
      deletedAt: null,
    }));
    if (newThread) {
      await pRun(tx.insert(messageThreadsTable).values({
        id: newThread.id,
        tenantId: newThread.tenantId,
        chapterId: newThread.chapterId ?? null,
        title: newThread.title,
        participantUserIds: JSON.stringify(newThread.participantUserIds),
        lastMessageId: newThread.lastMessageId ?? null,
        lastActivityAt: newThread.lastActivityAt,
        createdByUserId: newThread.createdByUserId,
        prevHash: newThread.prevHash,
        currHash: newThread.currHash,
        createdAt: newThread.createdAt,
        updatedAt: newThread.updatedAt,
        deletedAt: null,
      }));
    } else if (existingThreadUpdate) {
      await pRun(tx.update(messageThreadsTable)
        .set({
          lastMessageId: existingThreadUpdate.lastMessageId,
          lastActivityAt: existingThreadUpdate.lastActivityAt,
          updatedAt: now,
        })
        .where(eq((messageThreadsTable as any).id, existingThreadUpdate.id)));
    }
    // Sender's read receipt is established at send time (denorm parity).
    const receiptId = newId("mrr");
    await pRun(tx.insert(messageReadReceiptsTable).values({
      id: receiptId,
      messageId: messageRow.id,
      userId: messageRow.senderUserId,
      readAt: now,
    }));
  });'''
    content = content.replace(old_send_tx, new_send_tx)

    # Fix findThreadByIdAnyTenant call after sendMessageInternal
    old_find_thread_call = '''    const existing = findThreadByIdAnyTenant(existingThreadUpdate.id);'''
    new_find_thread_call = '''    const existing = await findThreadByIdAnyTenant(existingThreadUpdate.id);'''
    content = content.replace(old_find_thread_call, new_find_thread_call)

    # markMessageReadInternal: make async + fix
    old_mark_fn = 'function markMessageReadInternal(messageId: string, userId: string): MessageRow | null {'
    new_mark_fn = 'async function markMessageReadInternal(messageId: string, userId: string): Promise<MessageRow | null> {'
    content = content.replace(old_mark_fn, new_mark_fn)

    old_mark_find = '  const row = findMessageByIdAnyTenant(messageId);\n  if (!row) return null;\n  if (row.deletedAt) return row;\n  if (row.readBy.includes(userId)) return row; // idempotent\n\n  const db: any = getDb();\n  const now = nowIso();\n  const nextReadBy = [...row.readBy, userId];\n\n  db.transaction((tx: any) => {\n    // Idempotent UPSERT on (message_id, user_id).\n    try {\n      const receiptId = newId("mrr");\n      tx.insert(messageReadReceiptsTable).values({\n        id: receiptId,\n        messageId,\n        userId,\n        readAt: now,\n      }).run();\n    } catch (err) {\n      // UNIQUE conflict — already exists. The denorm cache is the\n      // source of truth for "did caller see this in their inbox?",\n      // so reflect the receipt even when DB row pre-existed.\n      const msg = (err as Error).message ?? "";\n      if (!/UNIQUE constraint/i.test(msg) && !/SQLITE_CONSTRAINT/i.test(msg)) {\n        throw err;\n      }\n    }\n    tx.update(messagesTable)\n      .set({\n        readBy: JSON.stringify(nextReadBy),\n        updatedAt: now,\n      })\n      .where(eq((messagesTable as any).id, messageId))\n      .run();\n  });'
    new_mark_find = '  const row = await findMessageByIdAnyTenant(messageId);\n  if (!row) return null;\n  if (row.deletedAt) return row;\n  if (row.readBy.includes(userId)) return row; // idempotent\n\n  const db: any = getDb();\n  const now = nowIso();\n  const nextReadBy = [...row.readBy, userId];\n\n  await pTransaction(db, async (tx: any) => {\n    // Idempotent UPSERT on (message_id, user_id).\n    try {\n      const receiptId = newId("mrr");\n      await pRun(tx.insert(messageReadReceiptsTable).values({\n        id: receiptId,\n        messageId,\n        userId,\n        readAt: now,\n      }));\n    } catch (err) {\n      // UNIQUE conflict — already exists. The denorm cache is the\n      // source of truth for "did caller see this in their inbox?",\n      // so reflect the receipt even when DB row pre-existed.\n      const msg = (err as Error).message ?? "";\n      if (!/UNIQUE constraint/i.test(msg) && !/SQLITE_CONSTRAINT/i.test(msg)) {\n        throw err;\n      }\n    }\n    await pRun(tx.update(messagesTable)\n      .set({\n        readBy: JSON.stringify(nextReadBy),\n        updatedAt: now,\n      })\n      .where(eq((messagesTable as any).id, messageId)));\n  });'
    content = content.replace(old_mark_find, new_mark_find)

    # editMessageInternal: make async + fix
    old_edit_fn = 'function editMessageInternal(messageId: string, newBody: string): MessageRow | null {'
    new_edit_fn = 'async function editMessageInternal(messageId: string, newBody: string): Promise<MessageRow | null> {'
    content = content.replace(old_edit_fn, new_edit_fn)

    old_edit_find = '  const row = findMessageByIdAnyTenant(messageId);\n  if (!row) return null;\n  if (row.deletedAt || row.status === "deleted") return null;\n\n  const db: any = getDb();\n  const now = nowIso();\n  // Hash chain extends: prev = current curr_hash.\n  const nextPayload = { id: row.id, body: newBody, editedAt: now };\n  const nextPrev = row.currHash;\n  const nextHash = computeHash(nextPrev, nextPayload);\n\n  db.transaction((tx: any) => {\n    tx.update(messagesTable)\n      .set({\n        body: newBody,\n        status: "edited",\n        prevHash: nextPrev,\n        currHash: nextHash,\n        updatedAt: now,\n      })\n      .where(eq((messagesTable as any).id, messageId))\n      .run();\n  });'
    new_edit_find = '  const row = await findMessageByIdAnyTenant(messageId);\n  if (!row) return null;\n  if (row.deletedAt || row.status === "deleted") return null;\n\n  const db: any = getDb();\n  const now = nowIso();\n  // Hash chain extends: prev = current curr_hash.\n  const nextPayload = { id: row.id, body: newBody, editedAt: now };\n  const nextPrev = row.currHash;\n  const nextHash = computeHash(nextPrev, nextPayload);\n\n  await pTransaction(db, async (tx: any) => {\n    await pRun(tx.update(messagesTable)\n      .set({\n        body: newBody,\n        status: "edited",\n        prevHash: nextPrev,\n        currHash: nextHash,\n        updatedAt: now,\n      })\n      .where(eq((messagesTable as any).id, messageId)));\n  });'
    content = content.replace(old_edit_find, new_edit_find)

    # deleteMessageInternal: make async + fix
    old_delete_fn = 'function deleteMessageInternal(messageId: string): MessageRow | null {'
    new_delete_fn = 'async function deleteMessageInternal(messageId: string): Promise<MessageRow | null> {'
    content = content.replace(old_delete_fn, new_delete_fn)

    old_delete_find = '  const row = findMessageByIdAnyTenant(messageId);\n  if (!row) return null;\n  if (row.deletedAt) return row;\n\n  const db: any = getDb();\n  const now = nowIso();\n  const nextPayload = { id: row.id, deleted: true, deletedAt: now };\n  const nextPrev = row.currHash;\n  const nextHash = computeHash(nextPrev, nextPayload);\n\n  db.transaction((tx: any) => {\n    tx.update(messagesTable)\n      .set({\n        status: "deleted",\n        prevHash: nextPrev,\n        currHash: nextHash,\n        deletedAt: now,\n        updatedAt: now,\n      })\n      .where(eq((messagesTable as any).id, messageId))\n      .run();\n  });'
    new_delete_find = '  const row = await findMessageByIdAnyTenant(messageId);\n  if (!row) return null;\n  if (row.deletedAt) return row;\n\n  const db: any = getDb();\n  const now = nowIso();\n  const nextPayload = { id: row.id, deleted: true, deletedAt: now };\n  const nextPrev = row.currHash;\n  const nextHash = computeHash(nextPrev, nextPayload);\n\n  await pTransaction(db, async (tx: any) => {\n    await pRun(tx.update(messagesTable)\n      .set({\n        status: "deleted",\n        prevHash: nextPrev,\n        currHash: nextHash,\n        deletedAt: now,\n        updatedAt: now,\n      })\n      .where(eq((messagesTable as any).id, messageId)));\n  });'
    content = content.replace(old_delete_find, new_delete_find)

    # hydrateMessagingStore: fix .all() - already async
    old_hydrate_msg = '''    const msgRows = db
      .select()
      .from(messagesTable)
      .all() as any[];'''
    new_hydrate_msg = '''    const msgRows = await pAll<any>(db
      .select()
      .from(messagesTable));'''
    content = content.replace(old_hydrate_msg, new_hydrate_msg)

    old_hydrate_thread = '''    const threadRows = db
      .select()
      .from(messageThreadsTable)
      .all() as any[];'''
    new_hydrate_thread = '''    const threadRows = await pAll<any>(db
      .select()
      .from(messageThreadsTable));'''
    content = content.replace(old_hydrate_thread, new_hydrate_thread)

    # Route handlers: many call sendMessageInternal, markMessageReadInternal etc - make them async
    # POST /api/messages
    old_post_handler = '  app.post("/api/messages", requireAuth, (req, res) => {'
    new_post_handler = '  app.post("/api/messages", requireAuth, async (req, res) => {'
    content = content.replace(old_post_handler, new_post_handler)

    old_sent_call = '    const sent = sendMessageInternal({'
    new_sent_call = '    const sent = await sendMessageInternal({'
    content = content.replace(old_sent_call, new_sent_call)

    # GET /api/messages (list)
    old_get_all = '  app.get("/api/messages", requireAuth, (req, res) => {'
    new_get_all = '  app.get("/api/messages", requireAuth, async (req, res) => {'
    content = content.replace(old_get_all, new_get_all)

    # GET /api/messages/threads
    old_get_threads = '  app.get("/api/messages/threads", requireAuth, (req, res) => {'
    new_get_threads = '  app.get("/api/messages/threads", requireAuth, async (req, res) => {'
    content = content.replace(old_get_threads, new_get_threads)

    # GET /api/messages/threads/:id
    old_get_thread_detail = '  app.get("/api/messages/threads/:id", requireAuth, (req, res) => {'
    new_get_thread_detail = '  app.get("/api/messages/threads/:id", requireAuth, async (req, res) => {'
    content = content.replace(old_get_thread_detail, new_get_thread_detail)

    # POST /api/messages/threads
    old_post_threads = '  app.post("/api/messages/threads", requireAuth, (req, res) => {'
    new_post_threads = '  app.post("/api/messages/threads", requireAuth, async (req, res) => {'
    content = content.replace(old_post_threads, new_post_threads)

    old_sent_call2 = '    const sent = sendMessageInternal({\n      sender: caller,\n      recipients: parsed.data.participants,'
    new_sent_call2 = '    const sent = await sendMessageInternal({\n      sender: caller,\n      recipients: parsed.data.participants,'
    content = content.replace(old_sent_call2, new_sent_call2)

    # GET /api/messages/:id
    old_get_msg_detail = '  app.get("/api/messages/:id", requireAuth, (req, res) => {'
    new_get_msg_detail = '  app.get("/api/messages/:id", requireAuth, async (req, res) => {'
    content = content.replace(old_get_msg_detail, new_get_msg_detail)

    old_find_msg_detail = '    const row = findMessageByIdAnyTenant(String(req.params.id));\n    if (!row || row.deletedAt) {\n      res.status(404).json({ error: "MESSAGE_NOT_FOUND" });\n      return;\n    }\n    const involved = row.senderUserId === caller || row.recipientUserIds.includes(caller);\n    if (!involved && !isPlatformAdmin(req)) {\n      // For chapter messages, chapter admins may view.\n      if (row.chapterId && isChapterAdminOrPlatformAdmin(caller, row.chapterId, req)) {\n        // allowed\n      } else {\n        res.status(403).json({ error: "NOT_INVOLVED" });\n        return;\n      }\n    }\n    res.json({ message: row });'
    new_find_msg_detail = '    const row = await findMessageByIdAnyTenant(String(req.params.id));\n    if (!row || row.deletedAt) {\n      res.status(404).json({ error: "MESSAGE_NOT_FOUND" });\n      return;\n    }\n    const involved = row.senderUserId === caller || row.recipientUserIds.includes(caller);\n    if (!involved && !isPlatformAdmin(req)) {\n      // For chapter messages, chapter admins may view.\n      if (row.chapterId && isChapterAdminOrPlatformAdmin(caller, row.chapterId, req)) {\n        // allowed\n      } else {\n        res.status(403).json({ error: "NOT_INVOLVED" });\n        return;\n      }\n    }\n    res.json({ message: row });'
    content = content.replace(old_find_msg_detail, new_find_msg_detail)

    # PATCH /api/messages/:id
    old_patch_msg = '  app.patch("/api/messages/:id", requireAuth, (req, res) => {'
    new_patch_msg = '  app.patch("/api/messages/:id", requireAuth, async (req, res) => {'
    content = content.replace(old_patch_msg, new_patch_msg)

    old_patch_find = '    const row = findMessageByIdAnyTenant(String(req.params.id));\n    if (!row || row.deletedAt || row.status === "deleted") {\n      res.status(404).json({ error: "MESSAGE_NOT_FOUND" });\n      return;\n    }\n    if (row.senderUserId !== caller && !isPlatformAdmin(req)) {\n      res.status(403).json({ error: "SENDER_ONLY" });\n      return;\n    }\n    const parsed = editBodySchema.safeParse(req.body);\n    if (!parsed.success) {\n      res.status(400).json({ error: "INVALID_BODY", details: parsed.error.flatten() });\n      return;\n    }\n    const updated = editMessageInternal(row.id, parsed.data.body);\n    if (!updated) {\n      res.status(409).json({ error: "EDIT_FAILED" });\n      return;\n    }\n    publishMessageEvent("messages.edited", updated);\n    res.json({ ok: true, message: updated });'
    new_patch_find = '    const row = await findMessageByIdAnyTenant(String(req.params.id));\n    if (!row || row.deletedAt || row.status === "deleted") {\n      res.status(404).json({ error: "MESSAGE_NOT_FOUND" });\n      return;\n    }\n    if (row.senderUserId !== caller && !isPlatformAdmin(req)) {\n      res.status(403).json({ error: "SENDER_ONLY" });\n      return;\n    }\n    const parsed = editBodySchema.safeParse(req.body);\n    if (!parsed.success) {\n      res.status(400).json({ error: "INVALID_BODY", details: parsed.error.flatten() });\n      return;\n    }\n    const updated = await editMessageInternal(row.id, parsed.data.body);\n    if (!updated) {\n      res.status(409).json({ error: "EDIT_FAILED" });\n      return;\n    }\n    publishMessageEvent("messages.edited", updated);\n    res.json({ ok: true, message: updated });'
    content = content.replace(old_patch_find, new_patch_find)

    # DELETE /api/messages/:id
    old_delete_msg_route = '  app.delete("/api/messages/:id", requireAuth, (req, res) => {'
    new_delete_msg_route = '  app.delete("/api/messages/:id", requireAuth, async (req, res) => {'
    content = content.replace(old_delete_msg_route, new_delete_msg_route)

    old_delete_find_row = '    const row = findMessageByIdAnyTenant(String(req.params.id));\n    if (!row || row.deletedAt) {\n      res.status(404).json({ error: "MESSAGE_NOT_FOUND" });\n      return;\n    }\n    if (row.senderUserId !== caller && !isPlatformAdmin(req)) {\n      res.status(403).json({ error: "SENDER_ONLY" });\n      return;\n    }\n    const updated = deleteMessageInternal(row.id);\n    if (!updated) {\n      res.status(409).json({ error: "DELETE_FAILED" });\n      return;\n    }\n    publishMessageEvent("messages.deleted", updated);\n    res.json({ ok: true, message: updated });'
    new_delete_find_row = '    const row = await findMessageByIdAnyTenant(String(req.params.id));\n    if (!row || row.deletedAt) {\n      res.status(404).json({ error: "MESSAGE_NOT_FOUND" });\n      return;\n    }\n    if (row.senderUserId !== caller && !isPlatformAdmin(req)) {\n      res.status(403).json({ error: "SENDER_ONLY" });\n      return;\n    }\n    const updated = await deleteMessageInternal(row.id);\n    if (!updated) {\n      res.status(409).json({ error: "DELETE_FAILED" });\n      return;\n    }\n    publishMessageEvent("messages.deleted", updated);\n    res.json({ ok: true, message: updated });'
    content = content.replace(old_delete_find_row, new_delete_find_row)

    # POST /api/messages/:id/read
    old_read_route = '  app.post("/api/messages/:id/read", requireAuth, (req, res) => {'
    new_read_route = '  app.post("/api/messages/:id/read", requireAuth, async (req, res) => {'
    content = content.replace(old_read_route, new_read_route)

    old_read_find = '    const row = findMessageByIdAnyTenant(String(req.params.id));\n    if (!row || row.deletedAt) {\n      res.status(404).json({ error: "MESSAGE_NOT_FOUND" });\n      return;\n    }\n    const involved = row.senderUserId === caller || row.recipientUserIds.includes(caller);\n    if (!involved && !isPlatformAdmin(req)) {\n      res.status(403).json({ error: "NOT_INVOLVED" });\n      return;\n    }\n    const updated = markMessageReadInternal(row.id, caller);\n    if (!updated) {\n      res.status(404).json({ error: "MESSAGE_NOT_FOUND" });\n      return;\n    }\n    publishMessageEvent("messages.read", updated);\n    res.json({ ok: true, message: updated, idempotent: row.readBy.includes(caller) });'
    new_read_find = '    const row = await findMessageByIdAnyTenant(String(req.params.id));\n    if (!row || row.deletedAt) {\n      res.status(404).json({ error: "MESSAGE_NOT_FOUND" });\n      return;\n    }\n    const involved = row.senderUserId === caller || row.recipientUserIds.includes(caller);\n    if (!involved && !isPlatformAdmin(req)) {\n      res.status(403).json({ error: "NOT_INVOLVED" });\n      return;\n    }\n    const updated = await markMessageReadInternal(row.id, caller);\n    if (!updated) {\n      res.status(404).json({ error: "MESSAGE_NOT_FOUND" });\n      return;\n    }\n    publishMessageEvent("messages.read", updated);\n    res.json({ ok: true, message: updated, idempotent: row.readBy.includes(caller) });'
    content = content.replace(old_read_find, new_read_find)

    # Fix GET list handler: findThreadByIdAnyTenant and sharesAnyChapterMembership calls
    old_get_list_thread = '      const t = findThreadByIdAnyTenant(threadId);\n      if (!t) {\n        res.status(404).json({ error: "THREAD_NOT_FOUND" });\n        return;\n      }\n      if (!t.participantUserIds.includes(caller) && !isPlatformAdmin(req)) {\n        res.status(403).json({ error: "NOT_THREAD_PARTICIPANT" });\n        return;\n      }\n      filtered = filtered.filter((m) => m.threadId === threadId);'
    new_get_list_thread = '      const t = await findThreadByIdAnyTenant(threadId);\n      if (!t) {\n        res.status(404).json({ error: "THREAD_NOT_FOUND" });\n        return;\n      }\n      if (!t.participantUserIds.includes(caller) && !isPlatformAdmin(req)) {\n        res.status(403).json({ error: "NOT_THREAD_PARTICIPANT" });\n        return;\n      }\n      filtered = filtered.filter((m) => m.threadId === threadId);'
    content = content.replace(old_get_list_thread, new_get_list_thread)

    # GET /api/messages/threads/:id - findThreadByIdAnyTenant
    old_get_detail_thread = '    const t = findThreadByIdAnyTenant(String(req.params.id));\n    if (!t || t.deletedAt) {'
    new_get_detail_thread = '    const t = await findThreadByIdAnyTenant(String(req.params.id));\n    if (!t || t.deletedAt) {'
    content = content.replace(old_get_detail_thread, new_get_detail_thread)

    # POST /api/messages - findThreadByIdAnyTenant + sharesAnyChapterMembership
    old_post_find_thread = '      const t = findThreadByIdAnyTenant(threadId);\n      if (!t) {\n        res.status(404).json({ error: "THREAD_NOT_FOUND" });\n        return;\n      }\n      if (!t.participantUserIds.includes(caller) && !isPlatformAdmin(req)) {\n        res.status(403).json({ error: "NOT_THREAD_PARTICIPANT" });\n        return;\n      }'
    new_post_find_thread = '      const t = await findThreadByIdAnyTenant(threadId);\n      if (!t) {\n        res.status(404).json({ error: "THREAD_NOT_FOUND" });\n        return;\n      }\n      if (!t.participantUserIds.includes(caller) && !isPlatformAdmin(req)) {\n        res.status(403).json({ error: "NOT_THREAD_PARTICIPANT" });\n        return;\n      }'
    content = content.replace(old_post_find_thread, new_post_find_thread)

    # POST /api/messages - sharesAnyChapterMembership
    old_shares_call = '      for (const r of parsed.data.recipients) {\n        if (!sharesAnyChapterMembership(caller, r) && !isPlatformAdmin(req)) {\n          res.status(403).json({ error: "NO_SHARED_CHAPTER", recipient: r });\n          return;\n        }\n      }'
    new_shares_call = '      for (const r of parsed.data.recipients) {\n        if (!await sharesAnyChapterMembership(caller, r) && !isPlatformAdmin(req)) {\n          res.status(403).json({ error: "NO_SHARED_CHAPTER", recipient: r });\n          return;\n        }\n      }'
    content = content.replace(old_shares_call, new_shares_call)

    # POST /api/messages/threads - sharesAnyChapterMembership
    old_shares_call2 = '    for (const p of parsed.data.participants) {\n      if (!sharesAnyChapterMembership(caller, p) && !isPlatformAdmin(req)) {\n        res.status(403).json({ error: "NO_SHARED_CHAPTER", participant: p });\n        return;\n      }\n    }'
    new_shares_call2 = '    for (const p of parsed.data.participants) {\n      if (!await sharesAnyChapterMembership(caller, p) && !isPlatformAdmin(req)) {\n        res.status(403).json({ error: "NO_SHARED_CHAPTER", participant: p });\n        return;\n      }\n    }'
    content = content.replace(old_shares_call2, new_shares_call2)

    write_file(path, content)
    print(f"✓ messagingStore.ts migrated")


def migrate_expertQAStore():
    """expertQAStore.ts has many .all() and .run() patterns. Read and apply systematically."""
    path = os.path.join(BASE, "server/expertQAStore.ts")
    backup_file(path)
    content = read_file(path)
    
    # Add portable import  
    old_import = 'import { requireAuth } from "./lib/authMiddleware";'
    new_import = 'import { requireAuth } from "./lib/authMiddleware";\nimport { pAll, pGet, pRun, pTransaction } from "./db/portable";'
    content = content.replace(old_import, new_import, 1)
    
    # Replace all .all() -> await pAll patterns (there are many in this file)
    # and all .run() -> await pRun patterns
    # and all db.transaction -> await pTransaction
    import re
    
    # Replace all .all() occurrences with await pAll() pattern where preceded by query chain
    # This is complex - do it by replacing the simpler patterns first
    
    # Pattern: .all() as any[] -> use pAll
    content = re.sub(r'\.all\(\) as any\[\]', '_REPLACED_all_', content)
    content = re.sub(r'\.all\(\) as Array<', '_REPLACED_all_Array_<', content)
    content = re.sub(r'\.all\(\);', '_REPLACED_all_;', content)
    content = re.sub(r'\.all\(\)', '_REPLACED_all_', content)
    
    # Replace .run() with await pRun(...)
    # These appear as: tx.insert(...).values({...}).run(); 
    # or tx.update(...).set({...}).where(...).run();
    # Pattern is: multiline query ending in .run()
    content = re.sub(r'\.run\(\);', ');\n// __NEEDS_pRun_WRAP__', content)
    
    # This approach is too complex for an automated script without context.
    # Let me restore and do targeted replacements instead.
    content = read_file(path)
    
    # Re-add import
    content = content.replace('import { requireAuth } from "./lib/authMiddleware";',
                              'import { requireAuth } from "./lib/authMiddleware";\nimport { pAll, pGet, pRun, pTransaction } from "./db/portable";', 1)
    
    write_file(path, content)
    # expertQAStore is very complex with many patterns. We'll handle it via a separate approach.
    print(f"✓ expertQAStore.ts — portable import added (full migration needs separate script)")


if __name__ == "__main__":
    print("Starting migration of remaining 10 files...")
    migrate_chaptersStore()
    migrate_collectiveMembershipStore()
    migrate_collectiveSettingsStore()
    migrate_dataroomStore()
    migrate_founderCrmStore()
    migrate_gdprRoutes()
    migrate_auditChainQuarterly()
    migrate_auditChainVerifier()
    migrate_messagingStore()
    migrate_expertQAStore()
    print("\nDone! Check for any remaining .all()/.run()/db.transaction patterns.")
