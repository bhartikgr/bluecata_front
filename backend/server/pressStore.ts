/**
 * v25.46 Track 5 — Press feed store (DB-backed editorial layer).
 *
 * Curated press items surfaced read-only at /network/press; admin CRUD lives at
 * /admin/press. All state persists to the `press_items` table (Tier 3 #27 —
 * 100% DB-driven). Deletes are SOFT (deleted_at) so nothing is destroyed
 * (Tier 3 #28 / #29).
 */
import { randomUUID } from "node:crypto";
import { rawDb } from "./db/connection";

export interface PressItem {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedAt: string | null;
  editorialNote: string | null;
  createdAt: string;
  updatedAt: string | null;
  createdByUserId: string | null;
}

function rowToItem(r: any): PressItem {
  return {
    id: r.id,
    title: r.title,
    source: r.source,
    url: r.url,
    publishedAt: r.published_at ?? null,
    editorialNote: r.editorial_note ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at ?? null,
    createdByUserId: r.created_by_user_id ?? null,
  };
}

/** List all non-deleted press items, newest first (by published_at, then created_at). */
export function listPressItems(): PressItem[] {
  try {
    const rows: any[] = rawDb()
      .prepare(
        `SELECT * FROM press_items
          WHERE deleted_at IS NULL
          ORDER BY COALESCE(published_at, created_at) DESC, created_at DESC`,
      )
      .all();
    return rows.map(rowToItem);
  } catch {
    return [];
  }
}

export function getPressItem(id: string): PressItem | null {
  try {
    const row: any = rawDb()
      .prepare(`SELECT * FROM press_items WHERE id = ? AND deleted_at IS NULL`)
      .get(id);
    return row ? rowToItem(row) : null;
  } catch {
    return null;
  }
}

export function createPressItem(args: {
  title: string;
  source: string;
  url: string;
  publishedAt?: string | null;
  editorialNote?: string | null;
  createdByUserId: string | null;
}): PressItem {
  const id = `press_${randomUUID()}`;
  const now = new Date().toISOString();
  rawDb()
    .prepare(
      `INSERT INTO press_items
         (id, title, source, url, published_at, editorial_note, created_at, updated_at, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      args.title.trim(),
      args.source.trim(),
      args.url.trim(),
      args.publishedAt ?? null,
      args.editorialNote ?? null,
      now,
      now,
      args.createdByUserId,
    );
  return getPressItem(id)!;
}

export function updatePressItem(
  id: string,
  patch: Partial<{
    title: string;
    source: string;
    url: string;
    publishedAt: string | null;
    editorialNote: string | null;
  }>,
): PressItem | null {
  const existing = getPressItem(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  rawDb()
    .prepare(
      `UPDATE press_items
          SET title = ?, source = ?, url = ?, published_at = ?, editorial_note = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
    )
    .run(
      patch.title !== undefined ? patch.title.trim() : existing.title,
      patch.source !== undefined ? patch.source.trim() : existing.source,
      patch.url !== undefined ? patch.url.trim() : existing.url,
      patch.publishedAt !== undefined ? patch.publishedAt : existing.publishedAt,
      patch.editorialNote !== undefined ? patch.editorialNote : existing.editorialNote,
      now,
      id,
    );
  return getPressItem(id);
}

/** Soft-delete (Tier 3 #28/#29 — never destructive). Returns true if a row was marked deleted. */
export function deletePressItem(id: string): boolean {
  const existing = getPressItem(id);
  if (!existing) return false;
  const now = new Date().toISOString();
  rawDb()
    .prepare(`UPDATE press_items SET deleted_at = ?, updated_at = ? WHERE id = ?`)
    .run(now, now, id);
  return true;
}
