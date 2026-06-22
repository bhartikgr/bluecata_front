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
import { apiRequest, ApiError } from "@/lib/queryClient";
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
      // v25.32 P0' — apiRequest() THROWS on non-2xx, so the old
      // `if (r.status === 200)` / `return { ok: false }` fallthrough was dead
      // code: a 403/401 never reached the `return { ok: false }` line, it
      // bubbled up as a rejected promise and react-query treated the soft
      // probe as an error (breaking the conditional partner sidebar). This
      // probe must NEVER throw past react-query — catch ApiError and resolve
      // to { ok: false } for the expected 401/403 (not a partner) cases.
      try {
        const r = await apiRequest("GET", "/api/partner/me");
        const identity = (await r.json()) as PartnerIdentity;
        return { ok: true, identity };
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          return { ok: false };
        }
        // Unexpected (5xx / network) — still resolve soft to avoid throwing
        // past react-query for a non-blocking UI gate.
        return { ok: false };
      }
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
