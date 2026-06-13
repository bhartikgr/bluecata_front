/**
 * Sprint 17 D1 — generic sync-entity repository.
 *
 * Provides a tiny CRUD façade over the 24 sync_* tables. Stores keep using
 * their existing in-memory Maps; this is offered as a parallel persistence
 * path that can be promoted (the full cutover happens in Sprint 18 where
 * each store points its writes through here).
 *
 * Postgres-compatible: every method uses parameterized SQL via
 * better-sqlite3's prepared statements (no string concat).
 */
import { rawDb } from "./connection";
import { SYNC_TABLES, type SyncTableName } from "./schema";

const TABLE_TO_SQL_NAME: Record<SyncTableName, string> = {
  company: "sync_company",
  investor: "sync_investor",
  capTablePosition: "sync_cap_table_position",
  softCircle: "sync_soft_circle",
  round: "sync_round",
  maIntelligence: "sync_ma_intelligence",
  eligibilitySnapshot: "sync_eligibility_snapshot",
  lifecyclePolicy: "sync_lifecycle_policy",
  auditEntry: "sync_audit_entry",
  kycRecord: "sync_kyc_record",
  accreditation: "sync_accreditation",
  memberTier: "sync_member_tier",
  consortiumPartner: "sync_consortium_partner",
  termSheet: "sync_term_sheet",
  dataroomPermission: "sync_dataroom_permission",
  dataroomFileMeta: "sync_dataroom_file_meta",
  notificationPrefs: "sync_notification_prefs",
  pricingTier: "sync_pricing_tier",
  commsThread: "sync_comms_thread",
  pcrmContact: "sync_pcrm_contact",
  post: "sync_post",
  report: "sync_report",
  spvScore: "sync_spv_score",
  socialSignal: "sync_social_signal",
};

export type SyncRow = {
  id: string;
  tenantId: string | null;
  version: number;
  updatedAt: string;
  createdAt: string;
  deletedAt: string | null;
  payload: unknown;
};

export function upsertSyncDoc(
  entity: SyncTableName,
  doc: { id: string; tenantId?: string | null; version?: number; payload: unknown }
): SyncRow {
  const db = rawDb();
  const table = TABLE_TO_SQL_NAME[entity];
  const now = new Date().toISOString();
  const payloadJson = JSON.stringify(doc.payload);
  const row = db
    .prepare(`SELECT * FROM ${table} WHERE id = ?`)
    .get(doc.id) as Record<string, unknown> | undefined;
  if (!row) {
    db.prepare(
      `INSERT INTO ${table} (id, tenant_id, version, updated_at, created_at, deleted_at, payload)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`
    ).run(doc.id, doc.tenantId ?? null, doc.version ?? 1, now, now, payloadJson);
  } else {
    db.prepare(
      `UPDATE ${table} SET tenant_id = ?, version = ?, updated_at = ?, payload = ? WHERE id = ?`
    ).run(doc.tenantId ?? row.tenant_id ?? null, doc.version ?? ((row.version as number) + 1), now, payloadJson, doc.id);
  }
  return getSyncDoc(entity, doc.id)!;
}

export function getSyncDoc(entity: SyncTableName, id: string): SyncRow | null {
  const db = rawDb();
  const table = TABLE_TO_SQL_NAME[entity];
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return rowToSync(row);
}

export function listSyncDocs(entity: SyncTableName, limit = 200): SyncRow[] {
  const db = rawDb();
  const table = TABLE_TO_SQL_NAME[entity];
  const rows = db
    .prepare(`SELECT * FROM ${table} WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?`)
    .all(limit) as Array<Record<string, unknown>>;
  return rows.map(rowToSync);
}

export function softDeleteSyncDoc(entity: SyncTableName, id: string): boolean {
  const db = rawDb();
  const table = TABLE_TO_SQL_NAME[entity];
  const now = new Date().toISOString();
  const r = db.prepare(`UPDATE ${table} SET deleted_at = ? WHERE id = ?`).run(now, id);
  return (r.changes ?? 0) > 0;
}

function rowToSync(row: Record<string, unknown>): SyncRow {
  let payload: unknown = row.payload;
  if (typeof payload === "string") {
    try { payload = JSON.parse(payload); } catch { /* leave raw */ }
  }
  return {
    id: String(row.id),
    tenantId: (row.tenant_id as string | null) ?? null,
    version: Number(row.version ?? 1),
    updatedAt: String(row.updated_at),
    createdAt: String(row.created_at),
    deletedAt: (row.deleted_at as string | null) ?? null,
    payload,
  };
}

export const ALL_SYNC_TABLES = Object.keys(TABLE_TO_SQL_NAME) as SyncTableName[];
export const SYNC_ENTITY_COUNT = ALL_SYNC_TABLES.length;
export { SYNC_TABLES };
