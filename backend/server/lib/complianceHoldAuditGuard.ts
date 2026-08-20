/**
 * server/lib/complianceHoldAuditGuard.ts — WAVE 57c · ITEM 2 (R37 approved
 * order #2) and part of ITEM 5 (anonymous audit actors).
 *
 * ── THE DEFECT ─────────────────────────────────────────────────────────────
 * `DELETE /api/admin/compliance-hold/:tenantId` releases the per-tenant control
 * that BLOCKS cap-table commits (`commitFunded()` refuses with
 * `compliance_hold:*` while a hold is on). Before this wave it wrote **no audit
 * record at all**, and its actor resolution was:
 *
 *     let heldBy = "system";
 *     try { heldBy = requireIdentity(req).userId; } catch { }
 *
 * so an unresolvable identity produced a real state change attributed to
 * `"system"`. The sibling `POST /api/admin/compliance-hold` has the identical
 * fallback. R35 requires a BOUND actor; Repair Wave 1 (server/bridgeStore.ts:1500)
 * established the pattern: **fail closed on identity BEFORE anything mutates.**
 *
 * ── WHY THIS IS A SEPARATE FILE AND NOT AN EDIT ─────────────────────────────
 * Both handlers live in `server/captableCommitStore.ts` (:1352 and :1366), which
 * is SACRED — read, never edited. R37 order #2 says to consider whether the
 * audit can be added at the route-registration / middleware layer instead, and
 * it can, exactly:
 *
 *   Express matches routes in REGISTRATION ORDER. A middleware registered on
 *   the same method+path BEFORE `registerCaptableCommitRoutes(app)` runs first;
 *   calling `next()` then hands the request to the sacred handler, which ends
 *   the request. This is not a new mechanism — `registerRoundMathRoutes` already
 *   installs `commitRoundMathHook` this way on the two sacred commit paths
 *   (server/roundMathRoutes.ts:406-407) with a comment saying precisely why it
 *   must come first, and `server/lib/captableCommitV2548.ts` is a whole parallel
 *   wrapper built on the same rule. No waiver is taken and no sacred byte moves.
 *
 * ── WHAT THE HOOK DOES ─────────────────────────────────────────────────────
 *   1. FAIL CLOSED ON IDENTITY, before the sacred handler mutates anything. It
 *      calls the SAME `requireIdentity(req)` the sacred handler calls, so if
 *      this hook admits the request the sacred handler's own `requireIdentity`
 *      cannot throw — which means its `"system"` fallback branch is now
 *      UNREACHABLE through HTTP. The `"system"` literal still exists in the
 *      sacred source (it must; the file is frozen), but no request can reach it.
 *   2. Reads the PRIOR hold state through the store's exported readers, so the
 *      audit payload records what actually changed rather than what was asked
 *      for.
 *   3. Wraps `res.json` — the same technique as `commitRoundMathHook` — and, on
 *      a successful (`ok: true`) response, appends a hash-chained
 *      `appendAdminAudit(actor, …)` entry. It NEVER alters the status or body.
 *   4. If the audit write throws OR returns the writer's empty-hash failure
 *      sentinel (WAVE 57d · D2 — the DB-failure path does not throw), it sets
 *      `X-Audit-Warning: audit_log_write_failed`
 *      (the pattern at server/lib/adminUsersRoutes.ts:265-270) so a lost audit
 *      record is visible to the caller instead of silent.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────────────────
 * It does not add a confirmation token. R35 offers "real admin surface OR
 * confirmation token OR retired" as alternatives to each other; the audit + bound
 * actor requirement is the non-negotiable part and is what R37 order #2 names.
 * Requiring a token would change the request contract of a live admin endpoint
 * that has no UI, and is reported as an open item instead of taken unilaterally.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { requireIdentity } from "./requireIdentity";
import {
  getComplianceHoldForTenant,
  getComplianceHold,
} from "../captableCommitStore";
import { appendAdminAudit, isAuditWriteFailure } from "../adminPlatformStore";
import { log } from "./logger";

/** Route paths this guard fronts. Exported so a test can assert the coverage
 *  set rather than trusting a comment. */
export const COMPLIANCE_HOLD_AUDITED_PATHS = [
  "POST /api/admin/compliance-hold",
  "DELETE /api/admin/compliance-hold/:tenantId",
] as const;

interface HoldAuditPlan {
  action: string;
  tenantId: string;
  requestedOn: boolean | null;
  reason?: string;
}

/** Resolve the tenant scope + intent of the incoming request, mirroring the
 *  sacred handler's own parsing so the audit describes the real operation. */
function planFor(req: Request): HoldAuditPlan {
  if (req.method === "DELETE") {
    const raw = req.params.tenantId;
    const tenantId =
      typeof raw === "string" ? raw : Array.isArray(raw) ? String(raw[0] ?? "") : "";
    return { action: "compliance_hold.released", tenantId, requestedOn: false };
  }
  const body = (req.body ?? {}) as { on?: unknown; tenantId?: unknown; reason?: unknown };
  const tenantId = typeof body.tenantId === "string" ? body.tenantId : "";
  const on = !!body.on;
  return {
    /* The legacy global path (no tenantId) is a DIFFERENT operation and is
       named differently in the audit trail so the two can never be confused. */
    action: tenantId
      ? on
        ? "compliance_hold.set"
        : "compliance_hold.released"
      : "compliance_hold.global_set",
    tenantId,
    requestedOn: on,
    reason: typeof body.reason === "string" ? body.reason : undefined,
  };
}

function priorStateOf(plan: HoldAuditPlan): boolean | null {
  try {
    return plan.tenantId ? getComplianceHoldForTenant(plan.tenantId) : getComplianceHold();
  } catch (err) {
    log.warn(
      `[complianceHoldAuditGuard] prior-state read failed: ${(err as Error).message}`,
    );
    return null;
  }
}

function complianceHoldAuditHook(req: Request, res: Response, next: NextFunction): void {
  /* 1 — FAIL CLOSED ON IDENTITY, BEFORE THE SACRED HANDLER MUTATES ANYTHING.
     This is what makes the sacred file's `?? "system"` fallback unreachable
     over HTTP without editing the sacred file. */
  let actorUserId: string;
  try {
    actorUserId = requireIdentity(req).userId;
  } catch {
    res
      .status(401)
      .json({ ok: false, error: "missing_identity", code: "missing_identity" });
    return;
  }
  if (!actorUserId) {
    res
      .status(401)
      .json({ ok: false, error: "missing_identity", code: "missing_identity" });
    return;
  }

  const plan = planFor(req);
  const priorHeld = priorStateOf(plan);

  /* 2 — observe the sacred handler's own response, then audit. Never alter it. */
  const originalJson = res.json.bind(res);
  (res as Response).json = ((body: unknown) => {
    try {
      const payload = body as {
        ok?: boolean;
        held?: unknown;
        complianceHold?: unknown;
        tenantId?: unknown;
      };
      /* ── WAVE 57d · D6.1 — THE LEGACY GLOBAL PATH USES A DIFFERENT KEY ──────
         The per-tenant sacred handlers answer `{ok, tenantId, held}`, but the
         LEGACY GLOBAL path (`POST /api/admin/compliance-hold` with no tenantId)
         answers `{ok:true, complianceHold, scope:"global"}` — it has no `held`
         key at all (server/captableCommitStore.ts:1355-1358, SACRED: read, never
         edited). Wave 57c read only `held`, so on the global path `resultHeld`
         was recorded as `null` and `changed` was INVERTED: turning a global hold
         ON from OFF logged `changed:false`, and re-setting an already-ON hold
         logged `changed:true`. Independent Review 3 §1.1 found this; I reproduced
         it over HTTP before fixing it.

         The fix is here in the guard, NOT in the sacred file: read `held` first
         (per-tenant, unchanged behaviour) and fall back to `complianceHold`
         (global). When neither key carries a boolean, `resultHeld` stays `null`
         and `changed` stays `null` — an unknown result is never reported as a
         known one. */
      const resultHeld: boolean | null =
        typeof payload?.held === "boolean"
          ? payload.held
          : typeof payload?.complianceHold === "boolean"
            ? payload.complianceHold
            : null;
      if (payload?.ok === true) {
        const written = appendAdminAudit(
          actorUserId,
          plan.tenantId ? `tenant:${plan.tenantId}` : "platform:compliance_hold",
          plan.action,
          {
            tenantId: plan.tenantId || null,
            method: req.method,
            requestedOn: plan.requestedOn,
            priorHeld,
            resultHeld,
            reason: plan.reason ?? null,
            /* An audit entry that records no change is still a record that the
               lever was pulled — that distinction is the point of the entry. */
            changed:
              priorHeld === null || resultHeld === null
                ? null
                : priorHeld !== resultHeld,
          },
        );
        /* WAVE 57d D2 — the audit writer swallows its own DB failure and returns
           an empty-hash sentinel rather than throwing, so the catch below never
           fired for the principal failure mode and this header was dead code.
           The sentinel is now inspected.

           HONEST LABEL: this makes audit failure VISIBLE. The hold release is
           STILL NOT fail-closed on audit, deliberately and unchanged — the
           sacred handler has already released the hold by the time this runs,
           and blocking a release during an audit outage would freeze every
           cap-table commit for that tenant behind a hold nobody can lift, with
           no admin UI to do it (Review 3 §1.1). Fail-closed here applies to
           IDENTITY ONLY (the 401 above). */
        if (isAuditWriteFailure(written)) {
          if (!res.headersSent) res.setHeader("X-Audit-Warning", "audit_log_write_failed");
          log.error(
            "[complianceHoldAuditGuard] AUDIT_DB_WRITE_FAILED — the compliance-hold " +
              `change for ${plan.tenantId || "(global)"} was NOT recorded in audit_log; ` +
              "the operation proceeded and is unattributable.",
          );
        }
      }
    } catch (err) {
      /* Never fail the operation on an audit error — make it VISIBLE instead. */
      if (!res.headersSent) res.setHeader("X-Audit-Warning", "audit_log_write_failed");
      log.warn(
        `[complianceHoldAuditGuard] audit append failed: ${(err as Error).message}`,
      );
    }
    return originalJson(body);
  }) as Response["json"];

  next();
}

/**
 * MUST be called BEFORE `registerCaptableCommitRoutes(app)`. Express matches in
 * registration order and the sacred handler ends the request, so a hook
 * registered afterwards would never run.
 */
export function registerComplianceHoldAuditGuard(app: Express): void {
  app.post("/api/admin/compliance-hold", complianceHoldAuditHook);
  app.delete("/api/admin/compliance-hold/:tenantId", complianceHoldAuditHook);
}
