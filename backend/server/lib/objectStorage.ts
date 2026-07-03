/**
 * v25.48 — Object storage layer (dataroom files, pitch decks, post attachments).
 *
 * DEFAULT BACKEND: local disk. Uploads are written to the local filesystem for
 * BOTH production and test/sandbox. This is the sanctioned, supported behavior
 * on the VPS (files are served ONLY through authenticated API routes).
 *
 * OPT-IN S3 (dead path unless explicitly enabled): if BOTH AWS_S3_BUCKET and
 * AWS_KMS_KEY_ID are set, uploads go to S3 with SSE-KMS server-side encryption.
 * When AWS_S3_BUCKET is set the S3 opt-in must be COMPLETE (KMS key + region +
 * a credential mode) or configuration validation throws. On a box that does not
 * set AWS_S3_BUCKET (e.g. Avi's VPS) the S3 branch never runs.
 *
 * On-disk layout (scalable, date-sharded so no single directory grows
 * unbounded):
 *   <root>/<prefix>/<YYYY>/<MM>/<id><ext>
 * The persisted storageKey is the RELATIVE path from <root>, e.g.
 *   <prefix>/<YYYY>/<MM>/<id><ext>
 * so it stays portable if the storage root moves. getObject resolves the key
 * against the SAME root. Legacy flat keys (`uploads/<prefix>/<id><ext>`) written
 * by earlier versions remain readable (resolved against cwd).
 *
 * Storage root resolution: DATAROOM_STORAGE_DIR, then UPLOADS_DIR, then a safe
 * default of <cwd>/uploads.
 *
 * The @aws-sdk/* packages are loaded LAZILY (dynamic import inside putObject /
 * getObject) so that a tree without the AWS SDK installed still builds + boots
 * (the FS path never touches the SDK) and the ESM/tsx runtime never evaluates
 * the SDK at module-eval time. Never use require() here.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { log } from "./logger";

export interface StoredObject {
  /** S3 key OR filesystem-relative path; opaque to callers. */
  storageKey: string;
  /** The KMS key id used for SSE-KMS, or null when stored on local disk. */
  kmsKeyId: string | null;
  /** "s3" | "fs" — which backend actually stored the bytes. */
  backend: "s3" | "fs";
  sizeBytes: number;
  mimeType: string;
}

/**
 * v25.48 STORE-2 — S3 is OFF by default. Per Ozan/Avi: local disk must ALWAYS be
 * the default, even when stale AWS_* keys linger in the live .env. S3 therefore
 * requires an EXPLICIT opt-in via STORAGE_BACKEND=s3 (case-insensitive) AND the
 * bucket + KMS key present. Without STORAGE_BACKEND=s3, leftover AWS_* values are
 * inert and every upload/read uses local disk. To use S3 later, set
 * STORAGE_BACKEND=s3 and provide AWS_S3_BUCKET + AWS_KMS_KEY_ID (+ region/creds).
 */
function s3OptedIn(): boolean {
  return (process.env.STORAGE_BACKEND || "").trim().toLowerCase() === "s3";
}

function s3Configured(): boolean {
  return Boolean(
    s3OptedIn() && process.env.AWS_S3_BUCKET && process.env.AWS_KMS_KEY_ID,
  );
}

/**
 * Resolve the local-disk storage root. Prefers DATAROOM_STORAGE_DIR, then the
 * legacy UPLOADS_DIR, then a safe default of <cwd>/uploads (works today).
 */
function storageRoot(): string {
  const configured = process.env.DATAROOM_STORAGE_DIR || process.env.UPLOADS_DIR;
  return configured
    ? path.resolve(configured)
    : path.resolve(process.cwd(), "uploads");
}

/**
 * v25.47 APD-038 — true when a usable AWS credential mode is configured:
 * explicit access keys, OR an instance-profile / IAM-role / named-profile flag.
 * (The SDK can also pick creds up from the environment; these flags are the
 * operator's explicit assertion that a non-key credential source exists.)
 */
function awsCredentialsConfigured(): boolean {
  return Boolean(
    (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) ||
      process.env.AWS_USE_INSTANCE_PROFILE ||
      process.env.AWS_USE_IAM_ROLE ||
      process.env.AWS_PROFILE,
  );
}

/**
 * v25.48 — storage configuration check. Local disk is ALWAYS a usable backend
 * and is the default, so this returns true whenever S3 has NOT been opted into.
 *
 * The export + name are preserved because callers and tests reference it. Its
 * semantics changed: it no longer blocks local disk in production. It ONLY
 * throws when the operator has EXPLICITLY opted into S3 (AWS_S3_BUCKET set) but
 * the opt-in is incomplete (missing KMS key, region, or a credential mode) —
 * a partial S3 config is a misconfiguration, not a silent local-disk fallback.
 * Returns true when the active backend (local disk, or a complete S3 opt-in)
 * is usable.
 */
export function assertProductionStorageConfigured(): boolean {
  // v25.48 STORE-2 — S3 is OFF unless STORAGE_BACKEND=s3 is explicitly set. Stale
  // AWS_* keys alone do NOT opt into S3, so local disk stays the default and is
  // always usable. This is what makes Avi's live box use local disk even though
  // his .env still contains AWS_S3_BUCKET/AWS_KMS_KEY_ID/credentials.
  if (!s3OptedIn()) return true;

  // STORAGE_BACKEND=s3 but no bucket → misconfiguration.
  if (!process.env.AWS_S3_BUCKET) {
    throw new Error(
      "[objectStorage] STORAGE_BACKEND=s3 but AWS_S3_BUCKET is unset. " +
        "Set AWS_S3_BUCKET (+ AWS_KMS_KEY_ID/region/credentials), or remove STORAGE_BACKEND=s3 to use local disk.",
    );
  }

  // S3 was opted into (AWS_S3_BUCKET set): the opt-in must be COMPLETE.
  const missing: string[] = [];
  if (!process.env.AWS_KMS_KEY_ID) missing.push("AWS_KMS_KEY_ID");
  if (!process.env.AWS_REGION) missing.push("AWS_REGION");
  if (!awsCredentialsConfigured()) {
    missing.push(
      "AWS credentials (AWS_ACCESS_KEY_ID+AWS_SECRET_ACCESS_KEY, or AWS_USE_INSTANCE_PROFILE/AWS_USE_IAM_ROLE/AWS_PROFILE)",
    );
  }
  if (missing.length > 0) {
    throw new Error(
      `[objectStorage] S3 opt-in incomplete — AWS_S3_BUCKET is set but missing: ${missing.join(", ")}. ` +
        "Set the remaining S3/KMS values, or unset AWS_S3_BUCKET to use the default local-disk storage.",
    );
  }
  return true;
}

let warnedFsInfo = false;
/** Emit the local-disk storage info line exactly once (informational). */
export function warnIfStorageNotConfigured(): void {
  if (!s3Configured() && !warnedFsInfo) {
    warnedFsInfo = true;
    log.info(
      `[objectStorage] Using local-disk storage (default) at ${storageRoot()}. ` +
        "Set AWS_S3_BUCKET + AWS_KMS_KEY_ID to opt into S3+KMS encrypted storage.",
    );
  }
}

/**
 * Store an uploaded buffer. `prefix` segments the keyspace (e.g. "pitch_decks",
 * "dataroom", "post_attachments"). Returns a StoredObject describing where the
 * bytes landed so the caller can persist the metadata (storageKey / kmsKeyId /
 * mime / size) in its own table.
 *
 * Fail-closed: on the local-disk path a failed write throws (never swallowed),
 * so callers that persist DB metadata only after putObject resolves cannot
 * create a DB row without bytes.
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

  // Validate storage config. With local disk (default) this is a no-op; it only
  // throws when S3 has been opted into but incompletely configured.
  assertProductionStorageConfigured();

  if (s3Configured()) {
    const key = `${prefix}/${id}${ext}`;
    try {
      // Lazy import — only reached when the SDK is actually configured/installed.
      // @aws-sdk/client-s3 is an OPTIONAL prod-only dependency; suppress the
      // resolve error for trees that do not install it.
      // @ts-ignore optional peer dep resolved at runtime only when S3 opted in
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
      // S3 was explicitly opted into; a failed put MUST NOT silently fall back
      // to local disk — re-throw so the upload fails loudly (fail-closed).
      log.error(
        "[objectStorage] S3 put failed (no local-disk fallback when S3 is opted in):",
        (err as Error).message,
      );
      throw err;
    }
  }

  // Local-disk storage (default). Date-sharded layout keeps any single
  // directory bounded. storageKey is the path RELATIVE to the storage root.
  warnIfStorageNotConfigured();
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const relKey = `${prefix}/${yyyy}/${mm}/${id}${ext}`;
  const root = storageRoot();
  const dir = path.join(root, prefix, yyyy, mm);
  fs.mkdirSync(dir, { recursive: true });
  const fsPath = path.join(dir, `${id}${ext}`);
  fs.writeFileSync(fsPath, buffer); // throws on failure → fail-closed
  return {
    storageKey: relKey,
    kmsKeyId: null,
    backend: "fs",
    sizeBytes: buffer.length,
    mimeType,
  };
}

/** Read an object back by its storageKey. Returns null if missing. */
export async function getObject(storageKey: string): Promise<Buffer | null> {
  // When S3 is opted in, keys that are NOT legacy local-disk keys (no "uploads/"
  // prefix) are ATTEMPTED against S3 first. v25.48 STORE-3 (GPT-5.5/Gemini review):
  // an S3 miss/failure MUST fall through to the local-disk resolver, because
  // files written locally BEFORE an S3 opt-in have relative keys (e.g.
  // "dataroom/2026/07/<id>.pdf") that also lack the "uploads/" prefix and live on
  // local disk. Without this fallback, enabling S3 later would make every
  // pre-opt-in local file unreadable (silent 404). We therefore try S3, and on
  // null/throw continue to the local candidates below rather than returning null.
  if (s3Configured() && !storageKey.startsWith("uploads/")) {
    try {
      // @ts-ignore optional peer dep resolved at runtime only when S3 opted in
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
      // Do NOT return null here — fall through to the local-disk resolver so
      // pre-opt-in local files (and any FS-backed key) remain readable.
      log.warn("[objectStorage] S3 get miss/failed, falling back to local disk:", (err as Error).message);
    }
  }

  // Local-disk resolution with backward compatibility.
  //   (a) Legacy flat keys ("uploads/<prefix>/<id><ext>") → resolve against cwd
  //       exactly as older versions did, so already-uploaded files still open.
  //   (b) New relative keys ("<prefix>/<YYYY>/<MM>/<id><ext>") → resolve against
  //       the storage root.
  // v25.48 STORE-3 (GPT-5.5 nice-to-have): reject path-traversal in DB-backed
  // storageKeys before touching the filesystem. Keys are server-generated
  // (prefix/date/hex), so any ".." or absolute path is illegitimate.
  if (storageKey.includes("..") || path.isAbsolute(storageKey)) {
    log.warn("[objectStorage] rejected suspicious storageKey:", storageKey);
    return null;
  }

  const candidates: string[] = [];
  if (storageKey.startsWith("uploads/")) {
    candidates.push(path.resolve(process.cwd(), storageKey));
  } else {
    candidates.push(path.resolve(storageRoot(), storageKey));
    // Extra safety: also try under <cwd>/uploads for any bare relative key that
    // predates the storage-root env var.
    candidates.push(path.resolve(process.cwd(), "uploads", storageKey));
  }
  for (const p of candidates) {
    try {
      return fs.readFileSync(p);
    } catch {
      /* try next candidate */
    }
  }
  return null;
}
