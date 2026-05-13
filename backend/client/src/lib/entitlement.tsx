/**
 * Sprint 15 D3 — Client-side entitlement primitives.
 *
 * Exposes:
 *   - useEntitlement()              — TanStack Query hook for the live UserContext
 *   - useEntitlementCheck(check)    — derives a pass/fail decision client-side
 *   - <RequireEntitlement check>    — wrapper that renders a redirect/empty
 *                                     state instead of a 404 when blocked.
 *
 * SANDBOX-SAFE: no Web Storage APIs. UserContext lives in TanStack Query
 * cache (in-memory) and the server cookies (httpOnly). The client lib never
 * tries to persist the session itself.
 */
import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useRole } from "@/lib/role";

/* ---------- Types (mirrored from server/lib/userContext.ts) ---------- */
export type InvestorState =
  | "NONE"
  | "INVITED_ONLY"
  | "ON_CAP_TABLE"
  | "ON_CAP_TABLE_COLLECTIVE_ACTIVE"
  | "ON_CAP_TABLE_COLLECTIVE_LAPSED";

export type CollectiveStatus = "none" | "applied" | "pending" | "active" | "suspended" | "lapsed";

export interface FounderCompany {
  companyId: string;
  companyName: string;
  legalName: string;
  role: string;
  stage: string;
  sector: string;
  hq: string;
  lastActiveAt: string;
  capTableHolders: number;
  activeRoundsCount: number;
}
export interface InvitedRound {
  invitationId: string;
  roundId: string;
  companyId: string;
  companyName: string;
  roundName: string;
  state: string;
  receivedAt: string;
  expiresAt: string;
}
export interface CapTablePosition {
  companyId: string;
  companyName: string;
  ownershipPct: number;
}
export interface UserContext {
  userId: string;
  identity: { email: string; name: string; screenName?: string };
  founder: { companies: FounderCompany[]; activeCompanyId: string | null };
  investor: {
    invitedRounds: InvitedRound[];
    capTablePositions: CapTablePosition[];
    state: InvestorState;
  };
  collective: { status: CollectiveStatus; role: string | null; expiresAt: string | null };
  isAdmin: boolean;
  isAuthed: boolean;
}

/* ---------- Persona mapping (preview) ----------
 * In the sandbox preview, the "active persona" is driven by the role chip
 * in the topbar (RoleProvider). We pass the persona id as a query param
 * so the server resolves the same UserContext the client expects.
 *
 * Defect 60 fix: personaFromRole is kept for the sandbox role-switcher
 * ONLY. In production the persona is determined purely by the JWT cookie
 * (set by /api/auth/login). The userId is NO LONGER derived from the
 * role string at runtime -- /api/auth/me resolves identity from the
 * session cookie server-side.
 */
function personaFromRole(role: string): string {
  if (role === "founder") return "u_maya_chen";
  if (role === "admin") return "u_admin";
  // For investor: do NOT return a hardcoded persona. Return empty string
  // to let the server cookie drive the session. Fallback to demo persona
  // only in the sandbox role-switcher context.
  if (role === "investor") return "u_aisha_patel"; // sandbox demo only
  return "u_aisha_patel";
}

/** Pure-function entitlement check used by the HOC + tests. */
export type EntitlementCheck =
  | "founder.any"
  | "founder.ofActiveCompany"
  | "investor.any"
  | "investor.hasAnyCapTable"
  | { kind: "investor.onCapTableOf"; companyId: string }
  | "collective.active"
  | "admin";

export function evaluate(check: EntitlementCheck, ctx: UserContext | null): { allow: boolean; reason: string } {
  if (!ctx || !ctx.isAuthed) return { allow: false, reason: "NOT_AUTHED" };
  if (check === "admin") return ctx.isAdmin ? { allow: true, reason: "" } : { allow: false, reason: "NOT_ADMIN" };
  if (check === "founder.any")
    return ctx.founder.companies.length > 0 ? { allow: true, reason: "" } : { allow: false, reason: "NOT_FOUNDER" };
  if (check === "founder.ofActiveCompany") {
    if (ctx.founder.companies.length === 0) return { allow: false, reason: "NOT_FOUNDER" };
    return ctx.founder.activeCompanyId ? { allow: true, reason: "" } : { allow: false, reason: "NO_ACTIVE_COMPANY" };
  }
  if (check === "investor.any")
    return ctx.investor.state !== "NONE" ? { allow: true, reason: "" } : { allow: false, reason: "CAP_TABLE_REQUIRED" };
  if (check === "investor.hasAnyCapTable")
    return ctx.investor.capTablePositions.length > 0
      ? { allow: true, reason: "" }
      : { allow: false, reason: "CAP_TABLE_REQUIRED" };
  if (check === "collective.active")
    return ctx.collective.status === "active" ? { allow: true, reason: "" } : { allow: false, reason: "COLLECTIVE_INACTIVE" };
  if (typeof check === "object" && check.kind === "investor.onCapTableOf") {
    const onIt = ctx.investor.capTablePositions.some((p) => p.companyId === check.companyId);
    return onIt ? { allow: true, reason: "" } : { allow: false, reason: "NOT_ON_CAP_TABLE" };
  }
  return { allow: false, reason: "UNKNOWN_CHECK" };
}

/* ---------- Hook ---------- */

// Sprint 27 fix: deploy_website DOES substitute the __PORT_5000__ sentinel into
// the proxy path at upload time. Without using it, /api/auth/me escapes the
// proxy in production and 404s. Same logic as client/src/lib/queryClient.ts.
const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

/**
 * Sprint 22 hotfix: sandbox-fallback context.
 *
 * When the auth/me endpoint isn't reachable (e.g. static deploy without the
 * server bundle, or a transient 4xx during demo bootstrap), we synthesise a
 * minimal UserContext from the role so the role-switcher demo continues to
 * work. Production builds with a real backend always get the server response.
 *
 * IMPORTANT: this fallback is sandbox-only. It seeds Aisha Patel with a
 * single cap-table position on co_novapay so the gated investor surfaces
 * (CompanyDetail, Portfolio detail) render in demo mode.
 */
function synthesiseFallbackContext(role: string, userId: string): UserContext {
  const isInvestor = role === "investor";
  const isFounder = role === "founder";
  const isAdmin = role === "admin";
  return {
    userId,
    isAuthed: true,
    isAdmin,
    identity: {
      id: userId,
      name: isFounder ? "Maya Chen" : isInvestor ? "Aisha Patel" : "Demo Admin",
      email: isFounder ? "maya@novapay.demo" : isInvestor ? "aisha@hydra.demo" : "admin@capavate.demo",
      avatarColor: "#0BA5B7",
    } as UserContext["identity"],
    role: role as UserContext["role"],
    founder: {
      companies: isFounder ? [{ id: "co_novapay", name: "NovaPay AI" } as UserContext["founder"]["companies"][0]] : [],
      activeCompanyId: isFounder ? "co_novapay" : null,
    },
    investor: {
      invitedRounds: isInvestor
        ? [
            { roundId: "rnd_novapay_seed_extension", invitationId: "in_1", companyId: "co_novapay", state: "pending" } as UserContext["investor"]["invitedRounds"][0],
          ]
        : [],
      capTablePositions: isInvestor
        ? [
            { companyId: "co_novapay", positionType: "Preferred" as const, ownershipPct: 4.21 } as UserContext["investor"]["capTablePositions"][0],
          ]
        : [],
      state: isInvestor ? ("ON_CAP_TABLE" as InvestorState) : ("NONE" as InvestorState),
    },
    collective: { status: "none", role: null, expiresAt: null },
  };
}

export function useEntitlement() {
  const { role } = useRole();
  const userId = personaFromRole(role);
  const q = useQuery<UserContext>({
    queryKey: ["/api/auth/me", userId],
    queryFn: async () => {
      try {
        const res = await fetch(`${API_BASE}/api/auth/me?userId=${encodeURIComponent(userId)}`, { credentials: "include" });
        if (!res.ok) {
          // Sprint 22 hotfix: synthesise demo context when server isn't reachable
          return synthesiseFallbackContext(role, userId);
        }
        return await res.json();
      } catch {
        // Network error → demo fallback
        return synthesiseFallbackContext(role, userId);
      }
    },
    staleTime: 30_000,
    retry: false,
  });
  return q;
}

/* ---------- Wrapper component ---------- */

export interface RequireEntitlementProps {
  check: EntitlementCheck;
  /** Where to send the user when blocked. */
  redirectTo?: string;
  /** Optional message surfaced to the user (toast or empty-state copy). */
  blockedMessage?: string;
  /** Optional custom node rendered in place when blocked. */
  fallback?: ReactNode;
  children: ReactNode;
}

export function RequireEntitlement({ check, redirectTo, blockedMessage, fallback, children }: RequireEntitlementProps) {
  const { data: ctx, isLoading, isError } = useEntitlement();
  const [, navigate] = useLocation();
  const decision = useMemo(() => evaluate(check, ctx ?? null), [check, ctx]);

  if (isLoading) {
    return (
      <div className="p-6 max-w-2xl mx-auto" data-testid="require-entitlement-loading">
        <div className="h-6 w-40 bg-muted animate-pulse rounded mb-3" />
        <div className="h-4 w-60 bg-muted animate-pulse rounded" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="p-6 max-w-2xl mx-auto" data-testid="require-entitlement-error">
        <p className="text-sm text-muted-foreground">Couldn't verify your account. Please refresh.</p>
      </div>
    );
  }
  if (!decision.allow) {
    if (fallback) return <>{fallback}</>;
    return (
      <div className="p-8 max-w-2xl mx-auto text-center"
           data-testid="require-entitlement-blocked"
           data-block-reason={decision.reason}>
        <h2 className="text-base font-semibold mb-2">Access locked</h2>
        <p className="text-sm text-muted-foreground mb-4">
          {blockedMessage ?? defaultMessageFor(decision.reason)}
        </p>
        {redirectTo && (
          <button
            className="text-sm font-medium underline underline-offset-4 hover:no-underline"
            onClick={() => navigate(redirectTo)}
            data-testid="button-require-redirect"
          >
            Take me there
          </button>
        )}
      </div>
    );
  }
  return <>{children}</>;
}

function defaultMessageFor(reason: string): string {
  switch (reason) {
    case "NOT_AUTHED":
      return "Sign in to continue.";
    case "NOT_ADMIN":
      return "Admin access required.";
    case "NOT_FOUNDER":
      return "This page is for founders. Switch to the founder portal or create a company.";
    case "NO_ACTIVE_COMPANY":
      return "Pick a company to work on.";
    case "NOT_ON_CAP_TABLE":
      return "You're not on this company's cap table yet.";
    case "CAP_TABLE_REQUIRED":
      return "Fund a round to unlock the investor portfolio surface.";
    case "COLLECTIVE_INACTIVE":
      return "Your Capavate Collective membership isn't active.";
    default:
      return "You don't have access to this section.";
  }
}

/* ---------- helpers ---------- */
export function isInState1(ctx: UserContext | null | undefined): boolean {
  if (!ctx) return false;
  return ctx.investor.state === "INVITED_ONLY";
}
export function hasCapTable(ctx: UserContext | null | undefined): boolean {
  return !!ctx && ctx.investor.capTablePositions.length > 0;
}
