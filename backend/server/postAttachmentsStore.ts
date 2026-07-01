/**
 * v25.47 APD-024 — Network post attachments (DB-backed, no in-memory state).
 *
 * Validates an uploaded attachment (allowed MIME + size ≤ 15MB), stores the
 * bytes via server/lib/objectStorage.ts (S3+KMS in prod, FS in sandbox), and
 * persists the descriptor metadata onto network_posts.attachments (a JSON
 * array, additive column from migration 0077 + connection.ts bootstrap).
 *
 * Bytes never live in the DB — only the {storageKey, mime, size, name} pointer.
 */
import { rawDb } from "./db/connection";
import { putObject } from "./lib/objectStorage";

/** Allowed attachment MIME types (APD-024). */
export const ALLOWED_ATTACHMENT_MIME: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "video/mp4",
  "application/pdf",
]);

/** Max attachment size: 15 MB. */
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

export interface PostAttachment {
  storageKey: string;
  mime: string;
  size: number;
  name: string;
  backend: "s3" | "fs";
  createdAt: string;
}

export function isAllowedMime(mime: unknown): mime is string {
  return typeof mime === "string" && ALLOWED_ATTACHMENT_MIME.has(mime);
}

function postExists(postId: string): boolean {
  try {
    const row = rawDb()
      .prepare(`SELECT id FROM network_posts WHERE id = ?`)
      .get(postId);
    return Boolean(row);
  } catch {
    return false;
  }
}

/** Read the attachment list for a post (empty array if none / absent). */
export function listAttachments(postId: string): PostAttachment[] {
  try {
    const row: any = rawDb()
      .prepare(`SELECT attachments FROM network_posts WHERE id = ?`)
      .get(postId);
    if (!row || !row.attachments) return [];
    const parsed = JSON.parse(row.attachments);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export class AttachmentValidationError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "AttachmentValidationError";
  }
}

/**
 * Validate + store one attachment and append its descriptor to the post.
 * Throws AttachmentValidationError("unsupported_mime" | "too_large" |
 * "post_not_found") on rejection; the route maps these to 400/404.
 */
export async function addAttachment(args: {
  postId: string;
  buffer: Buffer;
  mimeType: string;
  originalName: string;
}): Promise<{ attachment: PostAttachment; attachments: PostAttachment[] }> {
  if (!isAllowedMime(args.mimeType)) {
    throw new AttachmentValidationError(
      "unsupported_mime",
      `mime ${args.mimeType} is not allowed`,
    );
  }
  if (!Buffer.isBuffer(args.buffer) || args.buffer.length === 0) {
    throw new AttachmentValidationError("empty_file", "attachment is empty");
  }
  if (args.buffer.length > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentValidationError("too_large", "attachment exceeds 15MB");
  }
  if (!postExists(args.postId)) {
    throw new AttachmentValidationError("post_not_found", "post does not exist");
  }

  const stored = await putObject({
    prefix: "post_attachments",
    buffer: args.buffer,
    mimeType: args.mimeType,
    originalName: args.originalName,
  });

  const attachment: PostAttachment = {
    storageKey: stored.storageKey,
    mime: stored.mimeType,
    size: stored.sizeBytes,
    name: args.originalName,
    backend: stored.backend,
    createdAt: new Date().toISOString(),
  };

  const existing = listAttachments(args.postId);
  const next = [...existing, attachment];
  rawDb()
    .prepare(`UPDATE network_posts SET attachments = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(next), new Date().toISOString(), args.postId);

  return { attachment, attachments: next };
}
