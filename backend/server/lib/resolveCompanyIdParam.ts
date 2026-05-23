/**
 * Avi 22-May Issue 5 — founder pages smoke fix.
 *
 * Many founder-page endpoints take an explicit `?companyId=...` query
 * param and 400 when it is missing. That was the correct strict posture
 * at first, but the client-side react-query hooks fire on mount, *before*
 * the active-company resolution finishes — producing a brief 400 splash
 * on slow networks (Avi's report: "some founder modules broken").
 *
 * This helper centralises the resolution: when no companyId is supplied
 * via query / param / body, fall back to the *authenticated* founder's
 * active company. Routes that cannot determine a company (anonymous
 * caller, or founder with zero companies) still 400 with the same error
 * code so the API surface is unchanged from the bad-input perspective.
 *
 * The function NEVER throws. It returns null when no company can be
 * resolved; callers translate that to whatever status they prefer
 * (400/401/403). All callers in this codebase currently 400 on null —
 * consistent with the pre-existing `companyId_required` contract.
 */
import type { Request } from "express";
import { getUserContext } from "./userContext";

export interface ResolvedCompanyId {
  /** The resolved companyId, or null when no company could be inferred. */
  companyId: string | null;
  /** Where the value came from — useful for logging. */
  source: "query" | "param" | "body" | "active" | "none";
}

/**
 * Resolve the companyId for a founder request.
 *
 * Resolution order:
 *   1. req.query.companyId      (explicit param wins)
 *   2. req.params.companyId     (route param)
 *   3. req.body.companyId       (mutation handlers)
 *   4. ctx.founder.activeCompanyId   (fallback for read endpoints)
 *
 * Returns null when no value was found AND the user has no active
 * company (e.g. unauthenticated request, or founder who hasn't created
 * a company yet).
 */
export function resolveCompanyIdParam(req: Request): ResolvedCompanyId {
  const fromQuery =
    typeof req.query.companyId === "string" && req.query.companyId.length > 0
      ? req.query.companyId
      : null;
  if (fromQuery) return { companyId: fromQuery, source: "query" };

  const fromParam =
    typeof req.params.companyId === "string" && req.params.companyId.length > 0
      ? req.params.companyId
      : null;
  if (fromParam) return { companyId: fromParam, source: "param" };

  // Body inspection is gated behind a present body — never throws on undefined.
  const body = (req as { body?: Record<string, unknown> }).body;
  if (body && typeof body === "object") {
    const fromBody =
      typeof body.companyId === "string" && (body.companyId as string).length > 0
        ? (body.companyId as string)
        : null;
    if (fromBody) return { companyId: fromBody, source: "body" };
  }

  // Active-company fallback. We deliberately use getUserContext here
  // (synchronous, idempotent) rather than reading req.userContext, so
  // this helper works even on routes that don't pre-resolve identity.
  try {
    const ctx = getUserContext(req);
    if (ctx.isAuthed && ctx.founder.activeCompanyId) {
      return { companyId: ctx.founder.activeCompanyId, source: "active" };
    }
  } catch {
    // getUserContext is supposed to be infallible, but if it ever
    // throws we degrade to the "none" branch rather than 500'ing the
    // caller.
  }
  return { companyId: null, source: "none" };
}
