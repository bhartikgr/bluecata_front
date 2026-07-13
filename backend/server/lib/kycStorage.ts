/**
 * v26.1.x WAVE 2.5 AVI-B — storage-agnostic KYC document adapter.
 *
 * KYC documents are PII. This adapter abstracts WHERE the bytes live so the
 * upload route never hard-codes a backend and the investor profile stores only
 * a small FILE REFERENCE (id, name, mime, size, uploadedAt, storageKey), never
 * the binary.
 *
 * TWO BACKENDS (selected by env, decided by Ozan — S3-compatible object storage
 * wired at deploy):
 *
 *   1. DISK / LOCAL (default, dev + sandbox) — used whenever S3 is NOT opted in.
 *      Bytes are written to a DURABLE directory OUTSIDE the web root. This dir is
 *      NEVER registered with express.static and is NEVER served directly; the
 *      only way to read a doc back is through an authenticated API route that
 *      calls getKycObject(). This is NOT in-memory — files survive restart.
 *      Root resolution: KYC_STORAGE_DIR, else <cwd>/var/kyc-storage.
 *
 *   2. S3-COMPATIBLE (prod, opt-in) — selected via KYC_STORAGE=s3. Reads config
 *      from env only (NO hard-coded credentials):
 *        S3_BUCKET   (required)
 *        S3_REGION   (default us-east-1)
 *        S3_ENDPOINT (optional — for S3-compatible providers e.g. R2/MinIO)
 *        S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY (or the standard AWS_* / an
 *          instance role picked up by the SDK's default provider chain)
 *      Objects are written with a PRIVATE ACL and server-side encryption
 *      (SSE — aws:kms when KYC_S3_KMS_KEY_ID is set, else AES256). Retrieval is
 *      via a TIME-LIMITED signed URL (getKycSignedUrl) so the bytes are never
 *      public and links expire.
 *
 * OPTIONAL DEP GATING: the @aws-sdk/* packages are loaded LAZILY via dynamic
 * `import()` (never require() — this project is ESM). The disk path never
 * touches the SDK, so a tree WITHOUT the AWS SDK still builds, boots, and passes
 * dev/sandbox tests. @aws-sdk/client-s3 is present in package.json; the signed-
 * URL helper additionally needs @aws-sdk/s3-request-presigner, which may not be
 * installed — the S3 signed-URL path is therefore gated behind an optional
 * import and documented here. If the presigner is unavailable at runtime, the
 * adapter falls back to returning the API retrieval route (still authenticated),
 * so no build/boot breakage occurs.
 *
 * FAIL-CLOSED: any write failure throws (never swallowed), so the upload route
 * cannot record a profile reference without durably-stored bytes.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { log } from "./logger";

export type KycBackend = "s3" | "fs";

/** Result of a durable KYC store operation — the reference persisted upstream. */
export interface KycStoredObject {
  /** Opaque key: S3 object key OR filesystem-relative path. Never a URL. */
  storageKey: string;
  /** Which backend actually stored the bytes. */
  backend: KycBackend;
  sizeBytes: number;
  mimeType: string;
}

/** True when the operator has EXPLICITLY opted into S3-compatible storage. */
function s3OptedIn(): boolean {
  return (process.env.KYC_STORAGE || "").trim().toLowerCase() === "s3";
}

/** True when S3 is opted in AND the minimum config (bucket) is present. */
function s3Configured(): boolean {
  return Boolean(s3OptedIn() && process.env.S3_BUCKET);
}

/**
 * Resolve the local-disk KYC storage root. Deliberately DISTINCT from the
 * general uploads/ dataroom root and placed OUTSIDE the web root so KYC PII is
 * never accidentally static-served.
 */
function kycStorageRoot(): string {
  const configured = process.env.KYC_STORAGE_DIR;
  return configured
    ? path.resolve(configured)
    : path.resolve(process.cwd(), "var", "kyc-storage");
}

/**
 * Validate S3 opt-in completeness. Local disk (default) is always usable, so
 * this only throws when KYC_STORAGE=s3 is set but the bucket is missing — a
 * partial opt-in is a misconfiguration, not a silent local fallback.
 */
export function assertKycStorageConfigured(): void {
  if (!s3OptedIn()) return;
  if (!process.env.S3_BUCKET) {
    throw new Error(
      "[kycStorage] KYC_STORAGE=s3 but S3_BUCKET is unset. Set S3_BUCKET " +
        "(+ S3_REGION/S3_ENDPOINT/keys), or remove KYC_STORAGE=s3 to use local disk.",
    );
  }
}

let warnedFsInfo = false;
function warnIfUsingDisk(): void {
  if (!s3Configured() && !warnedFsInfo) {
    warnedFsInfo = true;
    log.info(
      `[kycStorage] Using durable local-disk KYC storage (default) at ${kycStorageRoot()} ` +
        "(outside web root, never static-served). Set KYC_STORAGE=s3 + S3_BUCKET to use S3.",
    );
  }
}

/** Build an S3 client from env (no hard-coded creds). Lazy-imported by callers. */
async function makeS3Client(): Promise<{
  client: unknown;
  bucket: string;
  kmsKeyId: string | undefined;
}> {
  // @ts-ignore optional dep — only reached when KYC_STORAGE=s3 is configured.
  const { S3Client } = await import("@aws-sdk/client-s3");
  const region = process.env.S3_REGION || process.env.AWS_REGION || "us-east-1";
  const endpoint = process.env.S3_ENDPOINT || undefined;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
  const client = new S3Client({
    region,
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    // If explicit keys are provided use them; otherwise fall back to the SDK's
    // default provider chain (instance role, shared config, env). NEVER hard-code.
    ...(accessKeyId && secretAccessKey
      ? { credentials: { accessKeyId, secretAccessKey } }
      : {}),
  });
  return {
    client,
    bucket: process.env.S3_BUCKET!,
    kmsKeyId: process.env.KYC_S3_KMS_KEY_ID || undefined,
  };
}

/**
 * Store an uploaded KYC buffer durably. Returns the reference metadata to
 * persist upstream. Fail-closed: throws on any write failure.
 */
export async function putKycObject(args: {
  buffer: Buffer;
  mimeType: string;
  originalName: string;
  /** Segments the keyspace, e.g. the investor id. */
  ownerId: string;
}): Promise<KycStoredObject> {
  const { buffer, mimeType, originalName, ownerId } = args;
  const ext = path.extname(originalName || "").slice(0, 12);
  const id = randomBytes(12).toString("hex");
  const safeOwner = String(ownerId || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_");

  assertKycStorageConfigured();

  if (s3Configured()) {
    const key = `kyc/${safeOwner}/${id}${ext}`;
    try {
      // @ts-ignore optional dep resolved at runtime only when S3 opted in.
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      const { client, bucket, kmsKeyId } = await makeS3Client();
      await (client as { send: (c: unknown) => Promise<unknown> }).send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: buffer,
          ContentType: mimeType,
          // Private ACL — KYC docs must never be public-read.
          ACL: "private",
          // Encrypted-at-rest. Prefer SSE-KMS when a key is configured, else
          // provider-managed SSE (AES256 / provider default).
          ...(kmsKeyId
            ? { ServerSideEncryption: "aws:kms", SSEKMSKeyId: kmsKeyId }
            : { ServerSideEncryption: "AES256" }),
        }),
      );
      return { storageKey: key, backend: "s3", sizeBytes: buffer.length, mimeType };
    } catch (err) {
      // Fail-closed: S3 was opted into; do NOT silently fall back to disk.
      log.error("[kycStorage] S3 put failed (fail-closed, no disk fallback):", (err as Error).message);
      throw err;
    }
  }

  // Local-disk (default). Durable, outside web root, never static-served.
  warnIfUsingDisk();
  const relKey = `kyc/${safeOwner}/${id}${ext}`;
  const dir = path.join(kycStorageRoot(), "kyc", safeOwner);
  fs.mkdirSync(dir, { recursive: true });
  const fsPath = path.join(dir, `${id}${ext}`);
  fs.writeFileSync(fsPath, buffer); // throws on failure → fail-closed
  return { storageKey: relKey, backend: "fs", sizeBytes: buffer.length, mimeType };
}

/** Read a KYC object back by its storageKey. Returns null if missing. */
export async function getKycObject(storageKey: string): Promise<Buffer | null> {
  if (s3Configured()) {
    try {
      // @ts-ignore optional dep resolved at runtime only when S3 opted in.
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const { client, bucket } = await makeS3Client();
      const out = (await (client as { send: (c: unknown) => Promise<unknown> }).send(
        new GetObjectCommand({ Bucket: bucket, Key: storageKey }),
      )) as { Body?: AsyncIterable<Buffer | Uint8Array> };
      const body = out.Body;
      if (!body) return null;
      const chunks: Buffer[] = [];
      for await (const c of body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
      return Buffer.concat(chunks);
    } catch (err) {
      log.warn("[kycStorage] S3 get failed:", (err as Error).message);
      return null;
    }
  }

  // Local-disk resolution. Reject traversal — keys are server-generated.
  if (storageKey.includes("..") || path.isAbsolute(storageKey)) {
    log.warn("[kycStorage] rejected suspicious storageKey:", storageKey);
    return null;
  }
  const p = path.resolve(kycStorageRoot(), storageKey);
  try {
    return fs.readFileSync(p);
  } catch {
    return null;
  }
}

/**
 * Produce a retrieval URL for a KYC doc.
 *
 * - S3 backend: a TIME-LIMITED SIGNED URL (private object, expiring link) via
 *   @aws-sdk/s3-request-presigner. That presigner package is an OPTIONAL dep
 *   (may not be installed in dev/sandbox); the import is gated so its absence
 *   never breaks the build. If it is unavailable we fall back to the
 *   authenticated API route below (still access-controlled).
 * - Disk backend: there is no public URL by design (bytes are outside the web
 *   root). We return the authenticated API route the caller mounts, which
 *   streams the bytes only to the owner/admin.
 *
 * @param expiresInSeconds signed-URL TTL (S3 only). Default 300s.
 */
export async function getKycSignedUrl(
  storageKey: string,
  apiRetrievalPath: string,
  expiresInSeconds = 300,
): Promise<string> {
  if (s3Configured()) {
    try {
      // @ts-ignore optional dep — presigner may not be installed in dev/sandbox.
      const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
      // @ts-ignore optional dep resolved at runtime only when S3 opted in.
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const { client, bucket } = await makeS3Client();
      return await getSignedUrl(
        client as never,
        new GetObjectCommand({ Bucket: bucket, Key: storageKey }) as never,
        { expiresIn: expiresInSeconds },
      );
    } catch (err) {
      // Presigner unavailable or signing failed — fall back to the authenticated
      // API route so retrieval still works (no public exposure, no build break).
      log.warn(
        "[kycStorage] signed-URL unavailable (optional presigner dep?), " +
          "falling back to authenticated API route:",
        (err as Error).message,
      );
      return apiRetrievalPath;
    }
  }
  // Disk backend: no public URL by design.
  return apiRetrievalPath;
}

/** Introspection for tests / diagnostics. */
export const _kycStorageInternals = {
  s3OptedIn,
  s3Configured,
  kycStorageRoot,
};
