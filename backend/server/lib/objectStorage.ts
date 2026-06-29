/**
 * v25.45.4 — Object storage layer (M-7 pitch-deck upload + M-5/M-6 dataroom files).
 *
 * REAL multipart upload target with graceful degradation:
 *   - If AWS_S3_BUCKET + AWS_KMS_KEY_ID are present in .env, store the object in
 *     S3 with SSE-KMS server-side encryption (envelope encryption via KMS).
 *   - Otherwise log a startup warning ONCE and fall back to the local filesystem
 *     under ./uploads/<prefix>/ with a clearly-marked TODO that this MUST be
 *     replaced with real S3+KMS before production.
 *
 * The @aws-sdk/* packages are loaded LAZILY (dynamic import inside putObject)
 * so that:
 *   (a) a tree without the AWS SDK installed still builds + boots (the FS
 *       fallback path never touches the SDK), and
 *   (b) the TS-require shim used elsewhere in this tree is never asked to
 *       evaluate the SDK at module-eval time.
 *
 * TODO(prod): the FS fallback is for sandbox/dev ONLY. Production MUST set
 * AWS_S3_BUCKET + AWS_KMS_KEY_ID so uploads are encrypted-at-rest in S3.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { log } from "./logger";

export interface StoredObject {
  /** S3 key OR filesystem-relative path; opaque to callers. */
  storageKey: string;
  /** The KMS key id used for SSE-KMS, or null when stored on the FS fallback. */
  kmsKeyId: string | null;
  /** "s3" | "fs" — which backend actually stored the bytes. */
  backend: "s3" | "fs";
  sizeBytes: number;
  mimeType: string;
}

function s3Configured(): boolean {
  return Boolean(process.env.AWS_S3_BUCKET && process.env.AWS_KMS_KEY_ID);
}

let warnedFsFallback = false;
/** Emit the FS-fallback startup warning exactly once. */
export function warnIfStorageNotConfigured(): void {
  if (!s3Configured() && !warnedFsFallback) {
    warnedFsFallback = true;
    log.warn(
      "[objectStorage] AWS_S3_BUCKET / AWS_KMS_KEY_ID not set — uploads will fall " +
        "back to the local filesystem under ./uploads/. TODO(prod): this MUST be " +
        "replaced with real S3+KMS encrypted storage before production.",
    );
  }
}

function fsRoot(prefix: string): string {
  const root = path.resolve(process.cwd(), "uploads", prefix);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

/**
 * Store an uploaded buffer. `prefix` segments the keyspace (e.g.
 * "pitch_decks", "dataroom"). Returns a StoredObject describing where the bytes
 * landed so the caller can persist the metadata (s3_key / kms_key_id / mime /
 * size) in its own table.
 */
export async function putObject(args: {
  prefix: string;
  buffer: Buffer;
  mimeType: string;
  originalName: string;
}): Promise<StoredObject> {
  const { prefix, buffer, mimeType, originalName } = args;
  const ext = path.extname(originalName || "").slice(0, 12);
  const id = randomBytes(12).toString("hex");
  const key = `${prefix}/${id}${ext}`;

  if (s3Configured()) {
    try {
      // Lazy import — only reached when the SDK is actually configured/installed.
      // @aws-sdk/client-s3 is an OPTIONAL prod-only dependency (absent in this
      // sandbox where the FS fallback is exercised); suppress the resolve error.
      // @ts-ignore optional peer dep resolved at runtime in production only
      const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
      const region = process.env.AWS_REGION || "us-east-1";
      const client = new S3Client({ region });
      await client.send(
        new PutObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET!,
          Key: key,
          Body: buffer,
          ContentType: mimeType,
          ServerSideEncryption: "aws:kms",
          SSEKMSKeyId: process.env.AWS_KMS_KEY_ID!,
        }),
      );
      return {
        storageKey: key,
        kmsKeyId: process.env.AWS_KMS_KEY_ID!,
        backend: "s3",
        sizeBytes: buffer.length,
        mimeType,
      };
    } catch (err) {
      // If the SDK is missing or the call fails, do NOT lose the upload — fall
      // through to the FS path so the founder's submission still succeeds.
      log.warn("[objectStorage] S3 put failed, falling back to FS:", (err as Error).message);
    }
  }

  // Filesystem fallback (sandbox/dev only). TODO(prod): replace with S3+KMS.
  warnIfStorageNotConfigured();
  const root = fsRoot(prefix);
  const fsPath = path.join(root, `${id}${ext}`);
  fs.writeFileSync(fsPath, buffer);
  return {
    storageKey: `uploads/${prefix}/${id}${ext}`,
    kmsKeyId: null,
    backend: "fs",
    sizeBytes: buffer.length,
    mimeType,
  };
}

/** Read an object back by its storageKey. Returns null if missing. */
export async function getObject(storageKey: string): Promise<Buffer | null> {
  // S3-stored keys do NOT start with "uploads/" (they use the bare prefix).
  if (s3Configured() && !storageKey.startsWith("uploads/")) {
    try {
      // @ts-ignore optional peer dep resolved at runtime in production only
      const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
      const region = process.env.AWS_REGION || "us-east-1";
      const client = new S3Client({ region });
      const out = await client.send(
        new GetObjectCommand({ Bucket: process.env.AWS_S3_BUCKET!, Key: storageKey }),
      );
      const body = out.Body as any;
      const chunks: Buffer[] = [];
      for await (const c of body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
      return Buffer.concat(chunks);
    } catch (err) {
      log.warn("[objectStorage] S3 get failed:", (err as Error).message);
      return null;
    }
  }
  // FS path.
  const fsPath = path.resolve(process.cwd(), storageKey);
  try {
    return fs.readFileSync(fsPath);
  } catch {
    return null;
  }
}
