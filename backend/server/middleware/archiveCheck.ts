/**
 * v25.45 F20c — Archived-workspace read-only enforcement.
 *
 * When a founder workspace is archived (companies.archive_status === 'archived'),
 * the workspace becomes READ-ONLY: GET requests still resolve so the founder can
 * view their data and the archived-dashboard banner renders, but ANY mutating
 * request (POST/PATCH/PUT/DELETE) against the company is rejected with
 * 403 WORKSPACE_ARCHIVED. The founder must reactivate (resubscribe) to resume
 * editing. Cap-table hash chains are never modified by archive.
 *
 * v25.45 ROUND 2 — the path-prefix middleware below only ever mounted on
 * `/api/founder`, so company-scoped mutation routes that live OUTSIDE that mount
 * (e.g. PATCH /api/companies/:id/profile, POST /api/rounds, soft-circle, etc.)
 * could bypass the archive gate entirely (GPT-5.5 reproduced the bypass). The
 * canonical enforcement is now the per-route helper `assertWorkspaceNotArchived`,
 * called early in EVERY company-scoped mutation handler at company-id resolution
 * time. The path-prefix middleware is RETAINED as a defense-in-depth layer for
 * `/api/founder/*`.
 *
 * SECURITY POSTURE (round 2 hardening):
 *   - GET/HEAD/OPTIONS → always proceed (read-only).
 *   - archive_status === 'archived' → 403 WORKSPACE_ARCHIVED.
 *   - DB/lookup error → FAIL CLOSED with 503 (never 200). A transient DB fault
 *     must not silently open a write path on a possibly-archived workspace.
 *   - archive_status IS NULL → treated as 'active' (legacy/never-archived rows).
 *     This is explicit and tested; NULL is the normal state for active companies.
 */
import type { Request, Response, NextFunction } from "express";
import { getArchiveState } from "../lib/workspaceArchiveStore";

/** Paths (relative to the /api/founder mount) that must work while archived. */
const ARCHIVE_EXEMPT_SUFFIXES = [
  "/workspace/reactivate",     // self-serve revival must always succeed
  "/workspace/archive-status", // read state (also GET, but be explicit)
  "/workspace/archive-state",  // round-2 revival pre-selection read
];

/** Read-only HTTP verbs never mutate state and always proceed. */
function isReadOnlyMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m === "GET" || m === "HEAD" || m === "OPTIONS";
}

/**
 * Best-effort companyId resolution for the path-prefix middleware. The
 * per-route helper takes an explicit companyId instead (see below).
 */
function resolveCompanyId(req: Request): string | null {
  const fromBody = (req.body && (req.body as any).companyId) || null;
  if (fromBody) return String(fromBody);
  const fromQuery = (req.query && (req.query as any).companyId) || null;
  if (fromQuery) return String(fromQuery);
  const ctx = (req as any).userContext;
  const active = ctx?.founder?.activeCompanyId ?? ctx?.founder?.companies?.[0]?.companyId ?? null;
  return active ? String(active) : null;
}

/**
 * v25.45 ROUND 2 — canonical per-route archive gate.
 *
 * Call this EARLY (at company-id resolution time) inside every company-scoped
 * mutation handler. Returns `true` when the request has been terminated (the
 * caller MUST `return` immediately) and `false` when the handler should proceed.
 *
 *   if (assertWorkspaceNotArchived(req, res, companyId)) return;
 *
 * - Read-only verbs (GET/HEAD/OPTIONS) → returns false (proceed).
 * - No companyId → returns false (cannot attribute → don't block).
 * - archive_status === 'archived' → 403 WORKSPACE_ARCHIVED, returns true.
 * - DB/lookup error → 503 (FAIL CLOSED), returns true.
 * - archive_status NULL/'active' → returns false (proceed).
 */
export function assertWorkspaceNotArchived(
  req: Request,
  res: Response,
  companyId: string | null | undefined,
): boolean {
  if (isReadOnlyMethod(req.method)) return false;
  if (!companyId) return false; // can't attribute to a company → don't block

  let state;
  try {
    state = getArchiveState(String(companyId));
  } catch (err) {
    // FAIL CLOSED — a lookup fault must not open a write path on a possibly
    // archived workspace. Respond 503 (not 200) and terminate.
    res.status(503).json({
      error: "ARCHIVE_CHECK_UNAVAILABLE",
      message: "Unable to verify workspace status. Please retry.",
    });
    return true;
  }

  // NULL / missing row / 'active' → proceed. (getArchiveState already coalesces
  // NULL archive_status to 'active'.)
  if (state && state.archiveStatus === "archived") {
    res.status(403).json({
      error: "WORKSPACE_ARCHIVED",
      message: "This workspace is archived. Reactivate to make changes.",
    });
    return true;
  }

  return false;
}

/**
 * Extract a company id from the many shapes a company-scoped route can carry:
 *   - req.params.companyId (explicit param name)
 *   - req.params.id (company-scoped routes where :id IS the company)
 *   - req.body.companyId (round / soft-circle payloads)
 *   - req.query.companyId
 * A round-id resolver may be supplied for /api/rounds/:id* routes where :id is a
 * round, not a company.
 */
export function extractCompanyId(
  req: Request,
  opts?: { idIsCompany?: boolean; roundIdResolver?: (roundId: string) => string | null },
): string | null {
  const params = (req.params ?? {}) as Record<string, string>;
  if (params.companyId) return String(params.companyId);
  if (opts?.idIsCompany && params.id) return String(params.id);
  // Round-scoped: resolve the owning company from the round id.
  if (opts?.roundIdResolver && params.id) {
    try {
      const cid = opts.roundIdResolver(String(params.id));
      if (cid) return String(cid);
    } catch { /* fall through */ }
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (body.companyId) return String(body.companyId);
  const query = (req.query ?? {}) as Record<string, unknown>;
  if (query.companyId) return String(query.companyId);
  return null;
}

/**
 * Path-prefix middleware (defense-in-depth) for `/api/founder/*`. Retained from
 * round 1; the canonical enforcement is now `assertWorkspaceNotArchived`.
 */
export function archiveCheck(req: Request, res: Response, next: NextFunction): void {
  // Read-only operations always pass.
  if (isReadOnlyMethod(req.method)) {
    return next();
  }

  // Allow-list the escape hatch + status endpoints regardless of archive state.
  const mounted = req.path || req.url || "";
  if (ARCHIVE_EXEMPT_SUFFIXES.some((s) => mounted.startsWith(s) || mounted.endsWith(s))) {
    return next();
  }

  const companyId = resolveCompanyId(req);
  if (!companyId) return next(); // can't attribute to a company → don't block

  let state;
  try {
    state = getArchiveState(companyId);
  } catch {
    // Round-2: fail CLOSED on lookup error (was: next() / fail-open).
    res.status(503).json({
      error: "ARCHIVE_CHECK_UNAVAILABLE",
      message: "Unable to verify workspace status. Please retry.",
    });
    return;
  }

  if (state && state.archiveStatus === "archived") {
    res.status(403).json({
      error: "WORKSPACE_ARCHIVED",
      message: "This workspace is archived. Reactivate to make changes.",
    });
    return;
  }

  return next();
}

export default archiveCheck;
