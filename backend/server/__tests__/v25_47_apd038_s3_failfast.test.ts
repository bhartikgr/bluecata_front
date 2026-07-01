/**
 * v25.47 APD-038 — production object-storage fail-fast.
 *
 * Coverage:
 *   1. In production with storage unconfigured, assertProductionStorageConfigured
 *      throws and putObject re-throws (no silent FS fallback).
 *   2. Outside production, the FS fallback still works (sandbox/dev path).
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  assertProductionStorageConfigured,
  putObject,
} from "../lib/objectStorage";

const SAVED = {
  NODE_ENV: process.env.NODE_ENV,
  AWS_S3_BUCKET: process.env.AWS_S3_BUCKET,
  AWS_KMS_KEY_ID: process.env.AWS_KMS_KEY_ID,
  AWS_REGION: process.env.AWS_REGION,
};

afterEach(() => {
  process.env.NODE_ENV = SAVED.NODE_ENV;
  if (SAVED.AWS_S3_BUCKET === undefined) delete process.env.AWS_S3_BUCKET;
  else process.env.AWS_S3_BUCKET = SAVED.AWS_S3_BUCKET;
  if (SAVED.AWS_KMS_KEY_ID === undefined) delete process.env.AWS_KMS_KEY_ID;
  else process.env.AWS_KMS_KEY_ID = SAVED.AWS_KMS_KEY_ID;
  if (SAVED.AWS_REGION === undefined) delete process.env.AWS_REGION;
  else process.env.AWS_REGION = SAVED.AWS_REGION;
});

describe("APD-038 production storage fail-fast", () => {
  it("throws in production when storage is unconfigured", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.AWS_S3_BUCKET;
    delete process.env.AWS_KMS_KEY_ID;
    delete process.env.AWS_REGION;

    expect(() => assertProductionStorageConfigured()).toThrow(/production storage misconfigured/);

    await expect(
      putObject({
        prefix: "test",
        buffer: Buffer.from("hi"),
        mimeType: "text/plain",
        originalName: "a.txt",
      }),
    ).rejects.toThrow(/production storage misconfigured/);
  });

  it("allows the FS fallback outside production", async () => {
    process.env.NODE_ENV = "test";
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
});
