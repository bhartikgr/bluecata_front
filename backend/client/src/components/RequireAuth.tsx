/**
 * RequireAuth.tsx — client-side auth gate (Sprint-fix May 14 2026)
 *
 * Wraps a route. If GET /api/auth/me returns isAuthed=false, redirects to
 * /auth/login. Optional `role` prop enforces role match on top of auth check.
 *
 * USAGE in App.tsx:
 *   import { RequireAuth } from "@/components/RequireAuth";
 *
 *   // Basic auth gate (any authenticated user):
 *   <Route path="/founder/dashboard">
 *     {() => <RequireAuth><FounderDashboard /></RequireAuth>}
 *   </Route>
 *
 *   // Role-scoped gate:
 *   <Route path="/admin/dashboard">
 *     {() => <RequireAuth role="admin"><AdminDashboard /></RequireAuth>}
 *   </Route>
 *
 * Notes:
 *   - Uses TanStack Query v5 object-form.
 *   - No localStorage / sessionStorage — reads auth state from the server only.
 *   - Shows a loading skeleton while the /api/auth/me query resolves.
 */
import type { ReactNode } from "react";
import { Redirect } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

type Role = "admin" | "founder" | "investor";

interface RequireAuthProps {
  children: ReactNode;
  /** Optional role to enforce. If the user does not have this role, redirect to /auth/login. */
  role?: Role;
  /** Path to redirect to if not authenticated. Defaults to "/auth/login". */
  redirectTo?: string;
}

interface AuthMeResponse {
  isAuthed: boolean;
  userId: string | null;
  isAdmin?: boolean;
  founder?: { companies: Array<unknown>; activeCompanyId: string | null };
  investor?: { state: string };
  collective?: { status: string };
}

function LoadingSkeleton() {
  return (
    <div className="p-6 space-y-4" data-testid="require-auth-loading">
      <div className="h-4 w-48 bg-muted animate-pulse rounded" />
      <div className="h-4 w-32 bg-muted animate-pulse rounded" />
      <div className="h-4 w-64 bg-muted animate-pulse rounded" />
    </div>
  );
}

export function RequireAuth({ children, role, redirectTo = "/auth/login" }: RequireAuthProps) {
  const { data, isLoading, isError } = useQuery<AuthMeResponse>({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      try {
        const res = await apiRequest("GET", "/api/auth/me");
        if (!res.ok) return { isAuthed: false, userId: null };
        return res.json() as Promise<AuthMeResponse>;
      } catch {
        return { isAuthed: false, userId: null };
      }
    },
    staleTime: 30_000,  // re-check every 30 seconds
    retry: false,
  });

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (isError || !data?.isAuthed) {
    return <Redirect to={redirectTo} />;
  }

  // Role enforcement
  if (role === "admin" && !data.isAdmin) {
    return <Redirect to={redirectTo} />;
  }

  if (role === "founder") {
    const hasCompany = (data.founder?.companies?.length ?? 0) > 0;
    if (!hasCompany) {
      return <Redirect to={redirectTo} />;
    }
  }

  if (role === "investor") {
    const isInvestor = data.investor?.state !== undefined && data.investor.state !== "NONE";
    if (!isInvestor) {
      return <Redirect to={redirectTo} />;
    }
  }

  return <>{children}</>;
}

export default RequireAuth;
