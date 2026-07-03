/**
 * v25.48 — local-disk storage end-to-end (Save -> reload-from-disk -> Load).
 *
 * Hits the REAL dataroom upload + download Express routes via supertest and
 * asserts that with local-disk storage (the default; no S3 env set):
 *   1. Upload lands on local disk and the DB row records the NEW relative
 *      sharded storageKey (<prefix>/<YYYY>/<MM>/<id><ext>, no leading uploads/).
 *   2. After dropping the in-memory buffer (simulating a process restart), the
 *      download route re-reads the bytes from local disk via getObject and
 *      returns the EXACT uploaded bytes with the original mime — NOT the
 *      minimal-PDF fallback.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import * as fs from "node:fs";
import * as path from "node:path";
import { registerDataroomRoutes, _testAccess, persistFileStrict } from "../dataroomStore";
import * as dbConnection from "../db/connection";
import { getDb } from "../db/connection";
import { dataroomFiles as dataroomFilesTable } from "../../shared/schema";
import { eq } from "drizzle-orm";

let app: Express;
beforeAll(() => {
  // Ensure local-disk (default) backend: no S3 opt-in.
  delete process.env.AWS_S3_BUCKET;
  delete process.env.AWS_KMS_KEY_ID;
  app = express();
  app.use(express.json());
  registerDataroomRoutes(app);
});

describe("v25.48 dataroom local-disk persistence (e2e via supertest)", () => {
  it("uploads to local disk, records a relative storageKey, and round-trips bytes after a simulated restart", async () => {
    const folder = _testAccess.folders[0];
    expect(folder).toBeTruthy();
    const companyId = folder!.companyId;
    const folderId = folder!.id;

    const payload = Buffer.from(
      `v25.48-e2e-local-disk-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      "utf8",
    );

    // --- Save: upload via the real route (admin persona owns any company) ---
    const up = await request(app)
      .post("/api/founder/dataroom/files")
      .query({ as: "admin" })
      .field("companyId", companyId)
      .field("folderId", folderId)
      .attach("file", payload, { filename: "e2e-note.txt", contentType: "text/plain" });

    expect(up.status).toBe(200);
    expect(up.body?.ok).toBe(true);
    const fileId: string = up.body.file.id;
    const storageKey: string = up.body.file.storageKey;
    expect(up.body.file.storageBackend).toBe("fs");
    // New relative sharded shape, no leading uploads/.
    expect(storageKey).toMatch(/^dataroom\/\d{4}\/\d{2}\/[0-9a-f]{24}\.txt$/);

    // --- Bytes really landed on local disk under the storage root ---
    const root =
      process.env.DATAROOM_STORAGE_DIR ||
      process.env.UPLOADS_DIR ||
      path.resolve(process.cwd(), "uploads");
    const onDisk = path.resolve(root, storageKey);
    expect(fs.existsSync(onDisk)).toBe(true);
    expect(fs.readFileSync(onDisk).equals(payload)).toBe(true);

    // --- DB row exists with the relative storageKey ---
    const db = getDb();
    const rows = db
      .select()
      .from(dataroomFilesTable)
      .where(eq(dataroomFilesTable.id, fileId))
      .all() as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].storageKey).toBe(storageKey);

    // --- Simulate restart: drop the in-memory buffer so the download route
    //     MUST re-read from local disk via getObject. ---
    const cached = _testAccess.files.find((f) => f.id === fileId);
    expect(cached).toBeTruthy();
    (cached as any)._buf = undefined;

    // --- Load: download and assert exact bytes + original mime (not the
    //     application/pdf minimal fallback). ---
    const down = await request(app)
      .get(`/api/founder/dataroom/files/${fileId}/download`)
      .query({ as: "admin" });

    expect(down.status).toBe(200);
    expect(down.headers["content-type"]).toMatch(/text\/plain/);
    // supertest exposes the raw body on .body for non-JSON via .parse, but for
    // arbitrary bytes we compare the buffered response.
    const body = Buffer.isBuffer(down.body) && down.body.length
      ? down.body
      : Buffer.from(down.text ?? "", "utf8");
    expect(body.equals(payload)).toBe(true);
  });

  // v25.48 STORE-1 (GPT-5.5/Gemini review) — FAIL-CLOSED on DB write.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("persistFileStrict THROWS on a primary-key collision (no silent onConflictDoNothing success)", () => {
    const folder = _testAccess.folders[0]!;
    const dup = {
      id: `drf_dupe_${Date.now()}`,
      companyId: folder.companyId,
      folderId: folder.id,
      name: "dupe.txt",
      sizeBytes: 3,
      mime: "text/plain",
      uploadedAt: new Date().toISOString(),
      uploadedBy: "tester",
      uploadedById: "u_test",
      sha256: "abc",
      watermark: true,
      storageKey: "dataroom/2026/07/deadbeefdeadbeefdeadbeef.txt",
      storageKmsKeyId: null,
      storageBackend: "fs",
    } as any;
    // First insert succeeds.
    expect(() => persistFileStrict(dup)).not.toThrow();
    // Second insert with the SAME id MUST throw (PK collision), proving the
    // route will fail-closed rather than silently "succeed".
    expect(() => persistFileStrict(dup)).toThrow();
  });

  it("upload route returns 500 and does NOT push to cache / log success when DB persist fails", async () => {
    const folder = _testAccess.folders[0]!;
    const beforeCount = _testAccess.files.length;

    // Force the DB-persist step to fail deterministically by making getDb()
    // (which persistFileStrict resolves at call-time) return a db whose
    // .transaction throws. This mirrors a real durable-DB write failure.
    vi.spyOn(dbConnection, "getDb").mockReturnValue({
      transaction: () => {
        throw new Error("forced DB failure (test)");
      },
    } as any);

    const payload = Buffer.from(`fail-closed-${Date.now()}`);
    const up = await request(app)
      .post("/api/founder/dataroom/files")
      .query({ as: "admin" })
      .field("companyId", folder.companyId)
      .field("folderId", folder.id)
      .attach("file", payload, { filename: "fail.txt", contentType: "text/plain" });

    expect(up.status).toBe(500);
    expect(up.body?.error).toBe("db_write_failed");
    // No new file pushed to the in-memory cache (no canonical in-memory state).
    expect(_testAccess.files.length).toBe(beforeCount);
  });
});
