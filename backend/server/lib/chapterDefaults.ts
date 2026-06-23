/**
 * v17 Phase B — chapter default helpers.
 *
 * Phase A seeds a single default chapter (`chap_keiretsu_canada`) and a
 * matching tenant (`tenant_chap_chap_keiretsu_canada`). All v16 Collective
 * rows are backfilled to that chapter. Phase B stores stamp `chapter_id`
 * on every write; when the caller doesn't pass one we fall back to this
 * default so writes don't fail their NOT NULL constraint.
 *
 * Per the brief:
 *   - chapter_id default backfill: chap_keiretsu_canada
 *   - tenant naming convention: tenant_chap_<chapterId>
 */
export const DEFAULT_CHAPTER_ID = "chap_keiretsu_canada";

export function tenantForChapter(chapterId: string): string {
  return `tenant_chap_${chapterId}`;
}

export const DEFAULT_CHAPTER_TENANT_ID = tenantForChapter(DEFAULT_CHAPTER_ID);
