/**
 * v25.45.4 M-7 — Collective pitch-deck metadata store.
 *
 * Records the metadata for a real pitch-deck upload (bytes stored via
 * server/lib/objectStorage.ts). The Collective DSC review surface reads from
 * here alongside company round info during screening. DB is the read source.
 */
import { rawDb } from "./db/connection";
import { randomBytes } from "node:crypto";

export interface PitchDeckRecord {
  id: string;
  companyId: string;
  applicationId: string | null;
  s3Key: string;
  kmsKeyId: string | null;
  storageBackend: string;
  mimeType: string;
  sizeBytes: number;
  originalName: string;
  uploadedByUserId: string;
  uploadedAt: string;
}

function rowToRecord(r: any): PitchDeckRecord {
  return {
    id: r.id,
    companyId: r.company_id ?? r.companyId,
    applicationId: r.application_id ?? r.applicationId ?? null,
    s3Key: r.s3_key ?? r.s3Key,
    kmsKeyId: r.kms_key_id ?? r.kmsKeyId ?? null,
    storageBackend: r.storage_backend ?? r.storageBackend ?? "fs",
    mimeType: r.mime_type ?? r.mimeType,
    sizeBytes: r.size_bytes ?? r.sizeBytes,
    originalName: r.original_name ?? r.originalName,
    uploadedByUserId: r.uploaded_by_user_id ?? r.uploadedByUserId,
    uploadedAt: r.uploaded_at ?? r.uploadedAt,
  };
}

export function recordPitchDeck(args: {
  companyId: string;
  applicationId?: string | null;
  s3Key: string;
  kmsKeyId: string | null;
  storageBackend: string;
  mimeType: string;
  sizeBytes: number;
  originalName: string;
  uploadedByUserId: string;
}): PitchDeckRecord {
  const id = `pdk_${randomBytes(8).toString("hex")}`;
  const uploadedAt = new Date().toISOString();
  rawDb()
    .prepare(
      `INSERT INTO collective_pitch_decks
         (id, company_id, application_id, s3_key, kms_key_id, storage_backend,
          mime_type, size_bytes, original_name, uploaded_by_user_id, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      args.companyId,
      args.applicationId ?? null,
      args.s3Key,
      args.kmsKeyId,
      args.storageBackend,
      args.mimeType,
      args.sizeBytes,
      args.originalName,
      args.uploadedByUserId,
      uploadedAt,
    );
  return getPitchDeck(id)!;
}

export function getPitchDeck(id: string): PitchDeckRecord | null {
  try {
    const row: any = rawDb().prepare(`SELECT * FROM collective_pitch_decks WHERE id = ?`).get(id);
    return row ? rowToRecord(row) : null;
  } catch {
    return null;
  }
}

/** Most-recent-first list for a company. DSC review surface reads this. */
export function listPitchDecksForCompany(companyId: string): PitchDeckRecord[] {
  try {
    const rows: any[] = rawDb()
      .prepare(`SELECT * FROM collective_pitch_decks WHERE company_id = ? ORDER BY uploaded_at DESC`)
      .all(companyId);
    return rows.map(rowToRecord);
  } catch {
    return [];
  }
}
