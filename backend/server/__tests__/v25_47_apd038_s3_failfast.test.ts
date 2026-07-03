/**
 * v25.48 STORE-2 — object-storage config semantics. Local disk is ALWAYS the
 * default; S3 is OFF unless the operator explicitly sets STORAGE_BACKEND=s3.
 * Stale AWS_* keys alone do NOT opt into S3 (this is Avi's exact live case:
 * his .env still has AWS_S3_BUCKET/AWS_KMS_KEY_ID/credentials, but without
 * STORAGE_BACKEND=s3 every upload must go to local disk).
 *
 * Behavior asserted:
 *   1. Production, no S3 opt-in → assertProductionStorageConfigured() returns
 *      true; putObject writes local disk (backend: "fs", sharded relative key).
 *   2. Production, STALE AWS_* keys present but STORAGE_BACKEND unset → STILL
 *      local disk (keys are inert). This is the Avi-live regression guard.
 *   3. STORAGE_BACKEND=s3 but AWS_S3_BUCKET unset → throws (misconfig).
 *   4. STORAGE_BACKEND=s3 + AWS_S3_BUCKET set but KMS/region/creds missing →
 *      throws (incomplete opt-in).
 *   5. Outside production, local disk works.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  assertProductionStorageConfigured,
  putObject,
  getObject,
} from "../lib/objectStorage";

const SAVED = {
  NODE_ENV: process.env.NODE_ENV,
  STORAGE_BACKEND: process.env.STORAGE_BACKEND,
  AWS_S3_BUCKET: process.env.AWS_S3_BUCKET,
  AWS_KMS_KEY_ID: process.env.AWS_KMS_KEY_ID,
  AWS_REGION: process.env.AWS_REGION,
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
};

function restore(key: keyof typeof SAVED) {
  if (SAVED[key] === undefined) delete process.env[key];
  else process.env[key] = SAVED[key] as string;
}

afterEach(() => {
  (Object.keys(SAVED) as (keyof typeof SAVED)[]).forEach(restore);
});

describe("v25.48 object-storage config (local disk is the default; S3 opt-in)", () => {
  it("does NOT throw in production when S3 is unconfigured; putObject writes to local disk", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.STORAGE_BACKEND;
    delete process.env.AWS_S3_BUCKET;
    delete process.env.AWS_KMS_KEY_ID;
    delete process.env.AWS_REGION;

    expect(assertProductionStorageConfigured()).toBe(true);

    const stored = await putObject({
      prefix: "test",
      buffer: Buffer.from("hi-prod-local"),
      mimeType: "text/plain",
      originalName: "a.txt",
    });
    expect(stored.backend).toBe("fs");
    expect(stored.kmsKeyId).toBeNull();
    // New relative sharded key shape: <prefix>/<YYYY>/<MM>/<id><ext>, no leading uploads/.
    expect(stored.storageKey).toMatch(/^test\/\d{4}\/\d{2}\/[0-9a-f]{24}\.txt$/);
  });

  it("STALE AWS_* keys are INERT without STORAGE_BACKEND=s3 (Avi live-env guard) — writes local disk", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.STORAGE_BACKEND; // NOT opted into S3
    process.env.AWS_S3_BUCKET = "leftover-bucket";
    process.env.AWS_KMS_KEY_ID = "leftover-kms";
    process.env.AWS_REGION = "us-east-1";
    process.env.AWS_ACCESS_KEY_ID = "leftover-akid";
    process.env.AWS_SECRET_ACCESS_KEY = "leftover-secret";

    // Must NOT throw and must NOT route to S3.
    expect(assertProductionStorageConfigured()).toBe(true);
    const stored = await putObject({
      prefix: "test",
      buffer: Buffer.from("stale-keys-still-local"),
      mimeType: "text/plain",
      originalName: "a.txt",
    });
    expect(stored.backend).toBe("fs");
    expect(stored.kmsKeyId).toBeNull();
  });

  it("throws when STORAGE_BACKEND=s3 but AWS_S3_BUCKET is unset", () => {
    process.env.NODE_ENV = "production";
    process.env.STORAGE_BACKEND = "s3";
    delete process.env.AWS_S3_BUCKET;
    expect(() => assertProductionStorageConfigured()).toThrow(/AWS_S3_BUCKET is unset/);
  });

  it("throws when STORAGE_BACKEND=s3 + bucket set but KMS/region/creds missing (incomplete opt-in)", () => {
    process.env.NODE_ENV = "production";
    process.env.STORAGE_BACKEND = "s3";
    process.env.AWS_S3_BUCKET = "some-bucket";
    delete process.env.AWS_KMS_KEY_ID;
    delete process.env.AWS_REGION;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    expect(() => assertProductionStorageConfigured()).toThrow(/S3 opt-in incomplete/);
  });

  it("allows local disk outside production", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.STORAGE_BACKEND;
    delete process.env.AWS_S3_BUCKET;
    delete process.env.AWS_KMS_KEY_ID;

    expect(assertProductionStorageConfigured()).toBe(true);
    const stored = await putObject({
      prefix: "test",
      buffer: Buffer.from("hi"),
      mimeType: "text/plain",
      originalName: "a.txt",
    });
    expect(stored.backend).toBe("fs");
  });

  it("STORE-3: a local FS relative key stays READABLE after S3 is later opted in", async () => {
    // Write the file with S3 OFF (local disk) — this yields a new relative
    // sharded key with no "uploads/" prefix, e.g. test/2026/07/<id>.txt.
    process.env.NODE_ENV = "production";
    delete process.env.STORAGE_BACKEND;
    delete process.env.AWS_S3_BUCKET;
    delete process.env.AWS_KMS_KEY_ID;
    const payload = Buffer.from(`store3-${Date.now()}`);
    const stored = await putObject({
      prefix: "test",
      buffer: payload,
      mimeType: "text/plain",
      originalName: "a.txt",
    });
    expect(stored.backend).toBe("fs");
    expect(stored.storageKey.startsWith("uploads/")).toBe(false);

    // Now the operator OPTS INTO S3 (bucket + KMS + creds set). getObject will
    // attempt S3 for this non-"uploads/" key, MISS, and MUST fall back to local
    // disk — the pre-opt-in file must remain readable.
    process.env.STORAGE_BACKEND = "s3";
    process.env.AWS_S3_BUCKET = "nonexistent-bucket-for-test";
    process.env.AWS_KMS_KEY_ID = "arn:aws:kms:us-east-1:000000000000:key/test";
    process.env.AWS_REGION = "us-east-1";
    process.env.AWS_ACCESS_KEY_ID = "AKIATEST";
    process.env.AWS_SECRET_ACCESS_KEY = "secrettest";

    const readBack = await getObject(stored.storageKey);
    expect(readBack).not.toBeNull();
    expect(Buffer.compare(readBack!, payload)).toBe(0);
  });

  it("STORE-3: getObject rejects path-traversal storageKeys", async () => {
    delete process.env.STORAGE_BACKEND;
    delete process.env.AWS_S3_BUCKET;
    expect(await getObject("../../etc/passwd")).toBeNull();
    expect(await getObject("/etc/passwd")).toBeNull();
  });
});
