/**
 * Sprint 15 D2 — RequireEntitlement middleware.
 *
 * Server-side enforcement layer. Every gated endpoint declares the
 * required entitlement(s); on failure we return 403 with an explicit
 * machine-readable error code (never a silent 404).
 *
 * Error codes (per CAPAVATE-LOGIN-DESIGN.md Part 5):
 *   NOT_AUTHED              — no user context resolved
 *   NOT_ADMIN               — admin-only route
 *   NOT_FOUNDER             — founder-any required
 *   FOUNDER_WRONG_COMPANY   — founder, but not of the requested company
 *   NOT_ON_CAP_TABLE        — investor not on requested company's cap table
 *   COMMUNICATION_BLOCKED   — investor messages requires cap-table position
 *   CAP_TABLE_REQUIRED      — investor.hasAnyCapTable false
 *   COLLECTIVE_INACTIVE     — collective.status !== 'active'
 *
 * Companion middleware `loadUserContext` attaches the resolved
 * UserContext to req.userContext so route handlers don't recompute.
 */
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { getUserContext, type UserContext } from "./userContext";

export type Entitlement =
  | "admin"
  | "founder.any"
  | "founder.ofCompany"
  | "investor.any"
  | "investor.onCapTableOf"
  | "investor.hasAnyCapTable"
  | "collective.active";

export type EntitlementErrorCode =
  | "NOT_AUTHED"
  | "NOT_ADMIN"
  | "NOT_FOUNDER"
  | "FOUNDER_WRONG_COMPANY"
  | "NOT_ON_CAP_TABLE"
  | "COMMUNICATION_BLOCKED"
  | "CAP_TABLE_REQUIRED"
  | "COLLECTIVE_INACTIVE";

declare module "express-serve-static-core" {
  interface Request {
    userContext?: UserContext;
  }
}

const HUMAN_MESSAGES: Record<EntitlementErrorCode, string> = {
  NOT_AUTHED: "Sign in to continue.",
  NOT_ADMIN: "Admin access required.",
  NOT_FOUNDER: "You need a founder account to access this.",
  FOUNDER_WRONG_COMPANY: "You're not a founder on this company.",
  NOT_ON_CAP_TABLE: "You're not on this company's cap table.",
  COMMUNICATION_BLOCKED: "Fund a round to unlock communication with this company.",
  CAP_TABLE_REQUIRED: "Fund a round to unlock the investor portfolio surface.",
  COLLECTIVE_INACTIVE: "Your Capavate Collective membership isn't active.",
};

/**
 * Resolve and attach the UserContext to the request. Idempotent — does
 * nothing if already attached. Use this once at the top of every gated
 * handler, OR install as a global middleware.
 */
export const loadUserContext: RequestHandler = async (req, _res, next) => {
  if (!req.userContext) {
    req.userContext = await getUserContext(req);
  }
  next();
};

function pickCompanyId(req: Request): string | undefined {
  return (
    (req.params.companyId as string | undefined) ??
    (req.params.id as string | undefined) ??
    (typeof req.query.companyId === "string" ? req.query.companyId : undefined)
  );
}

interface CheckResult {
  ok: boolean;
  code?: EntitlementErrorCode;
  detail?: Record<string, unknown>;
}

export function checkEntitlement(
  ctx: UserContext,
  entitlement: Entitlement,
  ctxArgs: { companyId?: string },
): CheckResult {
  switch (entitlement) {
    case "admin":
      if (ctx.isAdmin) return { ok: true };
      return { ok: false, code: ctx.isAuthed ? "NOT_ADMIN" : "NOT_AUTHED" };

    case "founder.any":
      if (!ctx.isAuthed) return { ok: false, code: "NOT_AUTHED" };
      if (ctx.founder.companies.length > 0) return { ok: true };
      return { ok: false, code: "NOT_FOUNDER" };

    case "founder.ofCompany": {
      if (!ctx.isAuthed) return { ok: false, code: "NOT_AUTHED" };
      if (ctx.founder.companies.length === 0) return { ok: false, code: "NOT_FOUNDER" };
      const cid = ctxArgs.companyId;
      if (!cid) {
        // No company id supplied — accept if they're a founder of any company.
        return { ok: true };
      }
      const owned = ctx.founder.companies.some((c) => c.companyId === cid);
      return owned ? { ok: true } : { ok: false, code: "FOUNDER_WRONG_COMPANY", detail: { companyId: cid } };
    }

    case "investor.any":
      if (!ctx.isAuthed) return { ok: false, code: "NOT_AUTHED" };
      // "Investor" here = anyone with the invited+invest signal.
      if (ctx.investor.state !== "NONE") return { ok: true };
      // Founders are not investors by default.
      return { ok: false, code: "CAP_TABLE_REQUIRED" };

    case "investor.hasAnyCapTable":
      if (!ctx.isAuthed) return { ok: false, code: "NOT_AUTHED" };
      if (ctx.investor.capTablePositions.length > 0) return { ok: true };
      return { ok: false, code: "CAP_TABLE_REQUIRED" };

    case "investor.onCapTableOf": {
      if (!ctx.isAuthed) return { ok: false, code: "NOT_AUTHED" };
      const cid = ctxArgs.companyId;
      if (!cid) return { ok: false, code: "NOT_ON_CAP_TABLE" };
      // V4 (Patch v8): ctx.investor.capTablePositions is now derived from
      // membershipStore.getMembership(), which itself merges seeded fixtures
      // with live captableCommitStore commits. A cap-table commit therefore
      // immediately unlocks this entitlement on the next request.
      const onIt = ctx.investor.capTablePositions.some((p) => p.companyId === cid);
      return onIt ? { ok: true } : { ok: false, code: "NOT_ON_CAP_TABLE", detail: { companyId: cid } };
    }

    case "collective.active":
      if (!ctx.isAuthed) return { ok: false, code: "NOT_AUTHED" };
      if (ctx.collective.status === "active") return { ok: true };
      return { ok: false, code: "COLLECTIVE_INACTIVE", detail: { status: ctx.collective.status } };
  }
}

/**
 * Middleware factory. Pass one or more required entitlements; ALL must
 * pass for the request to continue. Returns 403 with the *first* failed
 * code, plus a human message and helpful detail.
 */
export function requireEntitlement(...required: Entitlement[]): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.userContext) {
      req.userContext = await getUserContext(req);
    }
    const ctx = req.userContext;
    const companyId = pickCompanyId(req);

    for (const ent of required) {
      const result = checkEntitlement(ctx, ent, { companyId });
      if (!result.ok && result.code) {
        // Special-case: failures from the messaging surface should report
        // COMMUNICATION_BLOCKED (per design Part 5) regardless of which
        // cap-table check tripped (NOT_ON_CAP_TABLE or CAP_TABLE_REQUIRED).
        // Use originalUrl + baseUrl because app.use() strips the mount point
        // from req.path, leaving "/" inside the mounted middleware.
        const fullPath = `${req.baseUrl ?? ""}${req.path ?? ""}` + (req.originalUrl ?? "");
        const isMsgRoute = fullPath.includes("/messages") || fullPath.includes("/comms");
        const code: EntitlementErrorCode = isMsgRoute && (result.code === "NOT_ON_CAP_TABLE" || result.code === "CAP_TABLE_REQUIRED")
          ? "COMMUNICATION_BLOCKED"
          : result.code;
        return res.status(code === "NOT_AUTHED" ? 401 : 403).json({
          error: code,
          message: HUMAN_MESSAGES[code],
          entitlement: ent,
          detail: result.detail ?? null,
          userId: ctx.userId,
        });
      }
    }
    next();
  };
}

export { HUMAN_MESSAGES };
