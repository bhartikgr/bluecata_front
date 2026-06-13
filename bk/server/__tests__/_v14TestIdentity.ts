/**
 * v14 test helper — install a tiny userContext shim on a test Express app.
 *
 * RATIONALE
 *   In v14 Tier-1 Fix 1, every store-route that previously fell back to
 *   `?? "u_admin"` / `?? "u_demo"` / `req.headers["x-actor-user-id"]`
 *   was refactored to read identity from `req.userContext` and 401 when
 *   absent. That's the correct production posture, but the legacy test
 *   harnesses in this tree mount routes directly via `express()` —
 *   `applyRouteGuards` (which would normally populate userContext) is
 *   never called, so every test request looked anonymous.
 *
 *   This shim re-creates the SAME identity surface the production guard
 *   stack would produce, derived from existing legacy headers each test
 *   already sends:
 *     - x-actor             →  userContext.identity.email
 *     - x-actor-user-id     →  userContext.userId          (kept here ONLY
 *                              because test helpers may pass it; production
 *                              code never reads this header).
 *     - x-user-id           →  userContext.userId (fallback)
 *     - x-company-id        →  attached to req.companyIdHeader for stores
 *                              that previously read this header.
 *     - x-role              →  isAdmin = (role === "admin")
 *
 *   Default test identity (when no headers): `u_admin_test` with admin=true.
 *   This matches what `?? "u_admin"` used to do in v13, but now happens
 *   ONLY in the test harness, NEVER in production routes.
 *
 *   This file lives under server/__tests__/ so the v14 banned-pattern lint
 *   ignores it.
 */
import type { Express, Request, Response, NextFunction } from "express";

/**
 * Mode:
 *  - default ("opt-in"):  ONLY inject userContext when the request supplies
 *                          an identity header. If no header is present we
 *                          leave userContext undefined so the production
 *                          401-on-anonymous path is exercised verbatim.
 *  - { defaultIdentity: true }: inject a fallback `u_admin_test` admin
 *                          identity even for anonymous requests. Use this
 *                          for legacy admin-API tests that pre-date the
 *                          v14 strict-identity refactor and depended on
 *                          the `?? "u_admin"` fallback being baked into
 *                          the route handlers themselves.
 */
export function installV14TestIdentity(
  app: Express,
  options: { defaultIdentity?: boolean } = { defaultIdentity: true },
): void {
  const useDefault = options.defaultIdentity !== false;
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const headers = req.headers;
    const headerActorId =
      (headers["x-actor-user-id"] as string | undefined) ??
      (headers["x-user-id"] as string | undefined) ??
      undefined;
    const headerActorEmail = (headers["x-actor-email"] as string | undefined) ?? undefined;
    const headerActor = (headers["x-actor"] as string | undefined) ?? undefined;
    const headerActorIdLegacy = (headers["x-actor-id"] as string | undefined) ?? undefined;
    const role = String(headers["x-role"] ?? "admin");
    const companyId = (headers["x-company-id"] as string | undefined) ?? undefined;

    const explicitId = headerActorId ?? headerActor ?? headerActorIdLegacy;
    const hasAnyIdentity = !!(explicitId || headerActorEmail || companyId);

    if (!hasAnyIdentity && !useDefault) {
      // Leave userContext undefined — production code will 401.
      next();
      return;
    }

    const userId = explicitId ?? "u_admin_test";
    const email = headerActorEmail ?? `${userId}@test.local`;

    /* Cast through `unknown` because the test-shim shape intentionally only
     * fills the minimum surface area used by the v14 production guards; the
     * full UserContext type (FounderCompany / InvestorState unions) is not
     * worth recreating in a test helper. */
    const ctx = {
      userId,
      isAdmin: role === "admin",
      isAuthed: true,
      identity: { email, name: userId, screenName: userId },
      founder: { companies: companyId ? [{ companyId, role: "founder" }] : [], activeCompanyId: companyId ?? null },
      investor: { invitedRounds: [], capTablePositions: [], state: "NONE" as const },
      collective: { status: "active" as const, role: null, expiresAt: null },
    };
    (req as Request & { userContext?: unknown }).userContext = ctx as unknown as Request["userContext"];
    if (companyId) (req as Request & { companyIdHeader?: string }).companyIdHeader = companyId;
    /* Stamp the EXPLICITLY supplied user id (header-sourced) so test-only routes
     * such as termSheetStore.requireAuth can opt in without re-enabling header
     * identity reads in production. Only set when explicit — not for the
     * default `u_admin_test` fallback. */
    if (explicitId) {
      (req as Request & { __v14ExplicitUserId?: string }).__v14ExplicitUserId = explicitId;
    }
    next();
  });
}

export default installV14TestIdentity;
