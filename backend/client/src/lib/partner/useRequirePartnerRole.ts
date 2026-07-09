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
import { apiRequest, ApiError } from "@/lib/queryClient";

export type PartnerTier = "catalyst" | "builder" | "amplifier" | "nexus" | "founding_member";
export type PartnerSubRole = "managing_partner" | "associate" | "bd" | "analyst" | "viewer";

/* GROUP F3 — admin↔partner reconciliation status. Mirrors the server
 * ContactStatus. A partner whose status !== "active" (suspended/archived) is
 * still allowed to REACH the shell so PartnerShell can render a non-blocking
 * status banner — this is the CLIENT mirror of the server `requirePartnerSelf`
 * relaxation, and it applies to the /me bootstrap ONLY. All data pages remain
 * gated by the server's hard requirePartnerAuth (a suspended partner gets 403
 * on every other /api/partner/me/* route), so no client route guard is
 * loosened here. */
export type PartnerStatus = "active" | "inactive" | "suspended" | "archived";

export interface PartnerIdentity {
  partnerId: string;
  tier: PartnerTier;
  subRole: PartnerSubRole;
  identity: { userId: string; email: string; name: string };
  /* GROUP F3 — additive, DISPLAY-only reconciliation fields from GET /me.
   * Optional so older/mis-config payloads (or effectivePlan null) degrade
   * gracefully. commissionPct is DISPLAY-only (server-derived percent); it
   * NEVER drives any calculation. */
  status?: PartnerStatus | null;
  commissionPct?: number | null;
  partnerType?: string | null;
  region?: string | null;
}

export interface PartnerRoleState {
  ready: boolean;
  identity: PartnerIdentity | null;
  error: string | null;
}

/* W2-I — the sign page itself mounts this hook; never bounce a partner who is
 * already on the agreement route or we create a redirect loop. */
const AGREEMENT_SIGN_PATH = "/collective/partner/agreement";

type AgreementState = { signedCurrent: boolean; canSign: boolean };

export function useRequirePartnerRole(): PartnerRoleState {
  const [location, navigate] = useLocation();
  const q = useQuery<PartnerIdentity>({
    queryKey: ["/api/partner/me"],
    queryFn: async () => {
      // v25.32 P0' — apiRequest() THROWS an ApiError on any non-2xx response,
      // so the previous `if (r.status === 401)` checks after the await were
      // dead code that never ran. The thrown ApiError carries `.status` —
      // catch it and re-throw a normalized sentinel the useEffect below
      // routes on. This is the root cause of partner role detection failing
      // silently after redeem (the 403 "not a partner yet" / 401 cases never
      // produced the AUTH_REQUIRED / PARTNER_NOT_FOUND sentinels).
      try {
        const r = await apiRequest("GET", "/api/partner/me");
        return (await r.json()) as PartnerIdentity;
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.status === 401) throw new Error("AUTH_REQUIRED");
          if (err.status === 403) throw new Error("PARTNER_NOT_FOUND");
          throw new Error(`HTTP_${err.status}`);
        }
        throw err;
      }
    },
    retry: false,
  });

  useEffect(() => {
    if (q.error && q.error.message === "AUTH_REQUIRED") {
      navigate("/login");
    } else if (q.error && q.error.message === "PARTNER_NOT_FOUND") {
      // v25.13 NC3 — /partner/no-access was never registered. Send to
      // /partner/login with an error param so the login page can render
      // a meaningful banner instead of a generic 404.
      navigate("/partner/login?error=no_access");
    }
  }, [q.error, navigate]);

  /* W2-I — login-time agreement redirect (Ozan decision). Once a partner
   * identity resolves, read the DURABLE signed state; if the managing partner
   * has not signed the CURRENT version, route them to the sign page BEFORE they
   * land on any workspace surface. Only a partner who can sign is bounced (a
   * viewer would be stranded on a page they cannot act on) — the server
   * requireSignedAgreement write-gate remains the fail-closed backstop for
   * everyone. Reads stay open; signing once at login lets them proceed. */
  const ag = useQuery<AgreementState>({
    queryKey: ["/api/partner/me/agreement"],
    enabled: q.isSuccess,
    retry: false,
    queryFn: async () => {
      const r = await apiRequest("GET", "/api/partner/me/agreement");
      return (await r.json()) as AgreementState;
    },
  });

  useEffect(() => {
    if (!ag.isSuccess || !ag.data) return;
    if (location === AGREEMENT_SIGN_PATH) return;
    if (ag.data.canSign && !ag.data.signedCurrent) {
      navigate(AGREEMENT_SIGN_PATH);
    }
  }, [ag.isSuccess, ag.data, location, navigate]);

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
