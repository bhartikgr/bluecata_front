/**
 * v19 Phase C — Correlation ID middleware.
 *
 * Every request gets a UUID assigned to `req.id`. If the client provides
 * an `X-Correlation-ID` header (or its dash/snake variants), that value
 * is honored instead (so distributed traces can flow end-to-end).
 *
 * The same value is echoed back via the `X-Correlation-ID` response
 * header for client-side reconstruction.
 *
 * The id is exposed through a thread-safe-ish AsyncLocalStorage so
 * other server code (loggers, audit-log writers, SSE heartbeats) can
 * read it without explicit plumbing.
 *
 * Per-request typing: `req.id` is a string. We avoid a global
 * `declare module "express"` here so we don't impact unrelated TS
 * types in the project; callers should cast to `Request & { id: string }`.
 */
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Request, Response, NextFunction } from "express";

const storage = new AsyncLocalStorage<{ correlationId: string }>();

const HEADER_NAMES = [
  "x-correlation-id",
  "x-correlation-Id",
  "X-Correlation-ID",
  "x-request-id",
  "x-cap-trace-id",
] as const;

function readHeader(req: Request): string | undefined {
  for (const h of HEADER_NAMES) {
    const v = req.headers[h.toLowerCase() as string];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
    if (Array.isArray(v) && v[0]) return String(v[0]).trim();
  }
  return undefined;
}

function isLikelyUuid(s: string): boolean {
  // Accept any non-empty string up to 200 chars without control chars.
  if (s.length > 200) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(s)) return false;
  return true;
}

/**
 * Express middleware. Sets `req.id`, runs the rest of the request inside
 * an AsyncLocalStorage frame, and echoes the value to the client.
 */
export function correlationIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const fromHeader = readHeader(req);
  const id = fromHeader && isLikelyUuid(fromHeader) ? fromHeader : randomUUID();
  (req as Request & { id?: string }).id = id;
  res.setHeader("X-Correlation-ID", id);
  storage.run({ correlationId: id }, () => {
    next();
  });
}

/** Read the active correlation id from anywhere in the call tree. */
export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

/** Re-export for tests. */
export const _internal = Object.freeze({
  storage,
  HEADER_NAMES,
});
