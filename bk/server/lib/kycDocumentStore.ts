/**
 * v25.6 — KYC document upload store + endpoint.
 *
 * Background:
 *   v25.4 added a KYC gate on wire-funded transitions (regulatory P0). The
 *   gate enforces existence of an investor_kyc row + accreditedConfirmed=true.
 *   But the v25.4 master report flagged a real residual gap: there was no
 *   UI/endpoint for the investor to UPLOAD supporting evidence (passport,
 *   accreditation letter, source-of-funds proof). The compliance team had
 *   to handle document storage manually.
 *
 * v25.6 fills the gap:
 *   - New table kyc_documents stores document metadata + base64-encoded blob.
 *   - POST /api/investor/kyc/documents — investor uploads a document.
 *   - GET /api/investor/kyc/documents — investor lists their uploaded docs.
 *   - GET /api/admin/kyc/documents/:investorId — admin reviews docs.
 *   - POST /api/admin/kyc/documents/:docId/verify — admin marks a doc verified.
 *
 * Storage notes:
 *   - For v25.6 we store the document blob base64-encoded in SQLite.
 *     File size cap: 10 MB pre-encode (~13.3 MB encoded). This keeps the
 *     deployment dependency-free. A future release will move blobs to
 *     S3-compatible storage with the row only holding the URL + checksum.
 *   - SHA-256 of the raw bytes is computed and stored so tampering is
 *     detectable.
 *   - Document type is one of: passport | drivers_license | accreditation_letter
 *     | source_of_funds | other.
 *
 * Sacred contract: no edits to track1Routes.ts or captableCommitStore.ts.
 */

import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { rawDb } from "../db/connection";
import { log } from "./logger";

export const KYC_DOC_TYPES = [
  "passport",
  "drivers_license",
  "accreditation_letter",
  "source_of_funds",
  "other",
] as const;
export type KycDocType = (typeof KYC_DOC_TYPES)[number];

const MAX_RAW_BYTES = 10 * 1024 * 1024;

let tableReady = false;
function ensureTable(): void {
  if (tableReady) return;
  try {
    const db: any = rawDb();
    db.exec(`CREATE TABLE IF NOT EXISTS kyc_documents (
      id TEXT PRIMARY KEY NOT NULL,
      investor_id TEXT NOT NULL,
      kyc_id TEXT,
      doc_type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      blob_base64 TEXT NOT NULL,
      verified INTEGER NOT NULL DEFAULT 0,
      verified_by TEXT,
      verified_at TEXT,
      verification_notes TEXT,
      uploaded_at TEXT NOT NULL,
      deleted_at TEXT
    );`);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_kyc_documents_investor ON kyc_documents(investor_id);`,
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_kyc_documents_verified ON kyc_documents(verified);`,
    );
    tableReady = true;
  } catch (err) {
    log.warn({
      route: "kycDocumentStore.ensureTable",
      message: `CREATE TABLE failed (non-fatal): ${(err as Error).message}`,
    });
    tableReady = true;
  }
}

interface KycDocSummary {
  id: string;
  investorId: string;
  kycId: string | null;
  docType: KycDocType;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  verified: boolean;
  verifiedBy: string | null;
  verifiedAt: string | null;
  verificationNotes: string | null;
  uploadedAt: string;
}

function rowToSummary(r: any): KycDocSummary {
  return {
    id: r.id,
    investorId: r.investor_id,
    kycId: r.kyc_id ?? null,
    docType: r.doc_type as KycDocType,
    fileName: r.file_name,
    mimeType: r.mime_type,
    sizeBytes: typeof r.size_bytes === "number" ? r.size_bytes : Number(r.size_bytes),
    sha256: r.sha256,
    verified: r.verified === 1,
    verifiedBy: r.verified_by ?? null,
    verifiedAt: r.verified_at ?? null,
    verificationNotes: r.verification_notes ?? null,
    uploadedAt: r.uploaded_at,
  };
}

export function registerKycDocumentRoutes(app: Express): void {
  ensureTable();

  /**
   * POST /api/investor/kyc/documents
   * Body: { docType, fileName, mimeType, blobBase64, kycId? }
   *
   * Investor uploads a KYC supporting document. Stored base64 with SHA-256
   * checksum so admin verification can detect tampering.
   */
  app.post("/api/investor/kyc/documents", async (req: Request, res: Response) => {
    const ctx = (req as any).userContext;
    if (!ctx?.userId) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }
    const { docType, fileName, mimeType, blobBase64, kycId } = req.body ?? {};

    if (!KYC_DOC_TYPES.includes(docType)) {
      return res
        .status(400)
        .json({ ok: false, error: "invalid_doc_type", allowed: KYC_DOC_TYPES });
    }
    if (!fileName || typeof fileName !== "string") {
      return res.status(400).json({ ok: false, error: "fileName_required" });
    }
    if (!mimeType || typeof mimeType !== "string") {
      return res.status(400).json({ ok: false, error: "mimeType_required" });
    }
    if (!blobBase64 || typeof blobBase64 !== "string") {
      return res.status(400).json({ ok: false, error: "blobBase64_required" });
    }

    let buf: Buffer;
    try {
      buf = Buffer.from(blobBase64, "base64");
    } catch {
      return res.status(400).json({ ok: false, error: "invalid_base64" });
    }
    if (buf.length === 0) {
      return res.status(400).json({ ok: false, error: "empty_blob" });
    }
    if (buf.length > MAX_RAW_BYTES) {
      return res
        .status(413)
        .json({ ok: false, error: "file_too_large", maxBytes: MAX_RAW_BYTES, gotBytes: buf.length });
    }

    const sha256 = createHash("sha256").update(buf).digest("hex");
    const docId = `kycdoc_${Date.now()}_${randomBytes(4).toString("hex")}`;
    const uploadedAt = new Date().toISOString();

    try {
      const db: any = rawDb();
      db.prepare(
        `INSERT INTO kyc_documents (
           id, investor_id, kyc_id, doc_type, file_name, mime_type,
           size_bytes, sha256, blob_base64, verified, uploaded_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      ).run(
        docId,
        ctx.userId,
        kycId ?? null,
        docType,
        fileName,
        mimeType,
        buf.length,
        sha256,
        blobBase64,
        uploadedAt,
      );
      return res.json({
        ok: true,
        document: {
          id: docId,
          investorId: ctx.userId,
          docType,
          fileName,
          mimeType,
          sizeBytes: buf.length,
          sha256,
          verified: false,
          uploadedAt,
        },
      });
    } catch (err) {
      return res
        .status(500)
        .json({ ok: false, error: "insert_failed", message: (err as Error).message });
    }
  });

  /**
   * GET /api/investor/kyc/documents
   * Returns list of documents uploaded by the calling investor (summary only,
   * blob NOT included).
   */
  app.get("/api/investor/kyc/documents", async (req: Request, res: Response) => {
    const ctx = (req as any).userContext;
    if (!ctx?.userId) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }
    try {
      const db: any = rawDb();
      const rows: any[] = db
        .prepare(
          `SELECT id, investor_id, kyc_id, doc_type, file_name, mime_type, size_bytes,
                  sha256, verified, verified_by, verified_at, verification_notes, uploaded_at
             FROM kyc_documents
            WHERE investor_id = ? AND deleted_at IS NULL
            ORDER BY uploaded_at DESC`,
        )
        .all(ctx.userId);
      return res.json({ ok: true, documents: rows.map(rowToSummary) });
    } catch (err) {
      return res
        .status(500)
        .json({ ok: false, error: "list_failed", message: (err as Error).message });
    }
  });

  /**
   * GET /api/admin/kyc/documents/:investorId
   * Admin lists all KYC documents for a given investor.
   */
  app.get("/api/admin/kyc/documents/:investorId", async (req: Request, res: Response) => {
    const ctx = (req as any).userContext;
    if (!ctx?.isAdmin) {
      return res.status(403).json({ ok: false, error: "admin_only" });
    }
    const investorId = String(req.params.investorId);
    try {
      const db: any = rawDb();
      const rows: any[] = db
        .prepare(
          `SELECT id, investor_id, kyc_id, doc_type, file_name, mime_type, size_bytes,
                  sha256, verified, verified_by, verified_at, verification_notes, uploaded_at
             FROM kyc_documents
            WHERE investor_id = ? AND deleted_at IS NULL
            ORDER BY uploaded_at DESC`,
        )
        .all(investorId);
      return res.json({ ok: true, investorId, documents: rows.map(rowToSummary) });
    } catch (err) {
      return res
        .status(500)
        .json({ ok: false, error: "list_failed", message: (err as Error).message });
    }
  });

  /**
   * POST /api/admin/kyc/documents/:docId/verify
   * Body: { verified: boolean, notes?: string }
   * Admin marks a document verified or rejected.
   */
  app.post("/api/admin/kyc/documents/:docId/verify", async (req: Request, res: Response) => {
    const ctx = (req as any).userContext;
    if (!ctx?.isAdmin) {
      return res.status(403).json({ ok: false, error: "admin_only" });
    }
    const docId = String(req.params.docId);
    const { verified, notes } = req.body ?? {};
    if (typeof verified !== "boolean") {
      return res.status(400).json({ ok: false, error: "verified_boolean_required" });
    }
    try {
      const db: any = rawDb();
      const exist = db
        .prepare("SELECT id FROM kyc_documents WHERE id = ? AND deleted_at IS NULL")
        .get(docId);
      if (!exist) {
        return res.status(404).json({ ok: false, error: "not_found" });
      }
      db.prepare(
        `UPDATE kyc_documents
            SET verified = ?, verified_by = ?, verified_at = ?, verification_notes = ?
          WHERE id = ?`,
      ).run(verified ? 1 : 0, ctx.userId, new Date().toISOString(), notes ?? null, docId);
      return res.json({ ok: true, docId, verified });
    } catch (err) {
      return res
        .status(500)
        .json({ ok: false, error: "verify_failed", message: (err as Error).message });
    }
  });

  /**
   * GET /api/admin/kyc/documents/:docId/blob
   * Admin downloads the raw bytes of an uploaded document.
   */
  app.get("/api/admin/kyc/documents/:docId/blob", async (req: Request, res: Response) => {
    const ctx = (req as any).userContext;
    if (!ctx?.isAdmin) {
      return res.status(403).json({ ok: false, error: "admin_only" });
    }
    const docId = String(req.params.docId);
    try {
      const db: any = rawDb();
      const row: any = db
        .prepare("SELECT * FROM kyc_documents WHERE id = ? AND deleted_at IS NULL")
        .get(docId);
      if (!row) {
        return res.status(404).json({ ok: false, error: "not_found" });
      }
      const buf = Buffer.from(row.blob_base64, "base64");
      res.setHeader("Content-Type", row.mime_type);
      res.setHeader("Content-Disposition", `attachment; filename="${row.file_name}"`);
      res.setHeader("X-KYC-Doc-SHA256", row.sha256);
      return res.send(buf);
    } catch (err) {
      return res
        .status(500)
        .json({ ok: false, error: "blob_failed", message: (err as Error).message });
    }
  });
}
