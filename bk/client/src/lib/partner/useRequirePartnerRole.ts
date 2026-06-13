/**
 * Foundation Build — partner role guard hook.
 *
 * Separate file from `client/src/lib/role.tsx` per spec non-negotiable #3.
 * Calls `GET /api/partner/me` to determine whether the current session has
 * an active partner membership; on 401/403, redirects to login or the
 * "no access" page. Returns the partner identity once resolved.
 *
 * Routes mount this at the top of every page component:
 *   const { ready, partnerId, subRole, tier } = useRequirePartnerRole();
 *   if (!ready) return <LoadingShell />;
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";

export type PartnerTier = "catalyst" | "builder" | "amplifier" | "nexus" | "founding_member";
export type PartnerSubRole = "managing_partner" | "associate" | "bd" | "analyst" | "viewer";

export interface PartnerIdentity {
  partnerId: string;
  tier: PartnerTier;
  subRole: PartnerSubRole;
  identity: { userId: string; email: string; name: string };
}

export interface PartnerRoleState {
  ready: boolean;
  identity: PartnerIdentity | null;
  error: string | null;
}

export function useRequirePartnerRole(): PartnerRoleState {
  const [, navigate] = useLocation();
  const q = useQuery<PartnerIdentity>({
    queryKey: ["/api/partner/me"],
    queryFn: async () => {
      const r = await apiRequest("GET", "/api/partner/me");
      if (r.status === 401) throw new Error("AUTH_REQUIRED");
      if (r.status === 403) throw new Error("PARTNER_NOT_FOUND");
      if (!r.ok) throw new Error(`HTTP_${r.status}`);
      return r.json();
    },
    retry: false,
  });

  useEffect(() => {
    if (q.error && q.error.message === "AUTH_REQUIRED") {
      navigate("/login");
    } else if (q.error && q.error.message === "PARTNER_NOT_FOUND") {
      navigate("/partner/no-access");
    }
  }, [q.error, navigate]);

  return {
    ready: q.isSuccess,
    identity: q.data ?? null,
    error: q.error?.message ?? null,
  };
}

/**
 * Tier ordering helper used by client-side UI gating.
 * Note: the UI gate is NEVER the security boundary; the server enforces tier
 * gates at the route layer (Section 9.2 of the master spec).
 */
const TIER_RANK: Record<PartnerTier, number> = {
  catalyst: 1, builder: 2, amplifier: 3, nexus: 4, founding_member: 5,
};

export function tierAtLeast(current: PartnerTier, min: PartnerTier): boolean {
  return TIER_RANK[current] >= TIER_RANK[min];
}

export function isManagingPartner(subRole: PartnerSubRole): boolean {
  return subRole === "managing_partner";
}
