/**
 * Soft partner-membership probe.
 *
 * Unlike `useRequirePartnerRole`, this hook does NOT redirect on 401/403.
 * It returns `{ isPartner, identity }` and is intended for UI gates that
 * conditionally show partner-only affordances inside the CollectiveShell
 * (e.g. the PARTNER WORKSPACE sidebar section).
 *
 * Non-negotiable #3: we do not modify `client/src/lib/role.tsx`. Partner
 * identity is resolved exclusively through `/api/partner/me`.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { PartnerIdentity } from "@/lib/partner/useRequirePartnerRole";

export interface PartnerMembershipState {
  ready: boolean;
  isPartner: boolean;
  identity: PartnerIdentity | null;
}

export function usePartnerMembership(): PartnerMembershipState {
  const q = useQuery<{ ok: true; identity: PartnerIdentity } | { ok: false }>({
    queryKey: ["/api/partner/me", "soft"],
    queryFn: async () => {
      const r = await apiRequest("GET", "/api/partner/me");
      if (r.status === 200) {
        const identity = (await r.json()) as PartnerIdentity;
        return { ok: true, identity };
      }
      return { ok: false };
    },
    retry: false,
    staleTime: 30_000,
  });

  if (!q.isSuccess || !q.data) {
    return { ready: q.isFetched, isPartner: false, identity: null };
  }
  if (q.data.ok) {
    return { ready: true, isPartner: true, identity: q.data.identity };
  }
  return { ready: true, isPartner: false, identity: null };
}
