/**
 * Shared server error types.
 *
 * v25.42h round-2 (Blocker 2) — `DbUnavailableError` is thrown by store helpers
 * when a database read fails. The strict mandate is: on a DB read failure, the
 * platform must respond 503 + ok:false and NEVER fall back to an empty/default
 * literal (which would silently present fabricated/empty data as if real).
 *
 * Store helpers throw this; the route handlers that call them catch it and map
 * it to `res.status(503).json({ ok:false, error:"db_unavailable", message })`.
 */
export class DbUnavailableError extends Error {
  constructor(public readonly resource: string, cause?: unknown) {
    super(`db_unavailable: ${resource}`);
    this.name = "DbUnavailableError";
    if (cause) (this as { cause?: unknown }).cause = cause;
  }
}
