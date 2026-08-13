/**
 * WAVE 33 · CP-SPV-53 — the GP-facing REACH surface.
 *
 * Backed by `GET /api/partner/me/spv/:spvId/reach`.
 *
 * AN ENGINE WITH NO ROUTE, OR A COMPONENT MOUNTED NOWHERE, IS NOT SHIPPED.
 * This panel is mounted in `SpvDetailTabs.tsx` as the Reach tab.
 *
 * WHY IT EXISTS. `spec/PARTNER_BUILT_VS_PROMISED.md` SPV-53: a GP "can set
 * visibility to discoverable and nothing anywhere will ever discover it". The
 * scope selector told a GP what they had CHOSEN; nothing told them what their
 * choice actually DID. Worse, `invite_only` was excluded from every discovery
 * context for every viewer including the invited one, so selecting it was
 * indistinguishable from selecting `private`.
 *
 * So this panel deliberately does not restate the scope. It prints the
 * server-authored `reachCopy`, which is derived from ROWS — the live invitation
 * count and the count of distinct people who have actually resolved this
 * vehicle through a discovery surface. Nothing here is assembled client-side,
 * because a sentence composed in the browser from a scope enum would be exactly
 * the reassuring-but-unverified claim this item exists to remove.
 *
 * NULL IS NOT ZERO. `invitationCount: null` means the invite list could not be
 * read and renders as an explicit refusal; `0` means there are genuinely no
 * invitations and renders as "nobody can reach it". Those are different facts
 * about a vehicle and a GP must be able to tell them apart.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface ReachSummary {
  scope: string | null;
  broadcastContexts: string[];
  invitationCount: number | null;
  distinctViewers: number | null;
  reachCopy: string;
}

const CONTEXT_LABELS: Record<string, string> = {
  collective: "Capavate Collective",
  capavate: "Core Capavate investor surfaces",
  network: "Network",
};

function Count({ value, testId }: { value: number | null; testId: string }) {
  if (value === null) {
    return (
      <span className="text-[var(--cv-color-text-muted)]" data-testid={testId}>
        Not available
      </span>
    );
  }
  return (
    <span className="font-semibold" data-testid={testId}>
      {value}
    </span>
  );
}

export default function SpvReachPanel({ spvId }: { spvId: string }) {
  const q = useQuery<{ reach: ReachSummary }>({
    queryKey: ["/api/partner/me/spv", spvId, "reach"],
    queryFn: async () => (await apiRequest("GET", `/api/partner/me/spv/${spvId}/reach`)).json(),
    enabled: !!spvId,
  });

  if (q.isLoading) {
    return (
      <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="spv-reach-loading">
        Loading reach…
      </div>
    );
  }
  if (q.isError || !q.data?.reach) {
    return (
      <div className="text-sm" data-testid="spv-reach-unavailable">
        The reach of this vehicle could not be read. Nothing has been changed, and this is a loading
        failure rather than a statement that the vehicle has no reach.
      </div>
    );
  }

  const r = q.data.reach;
  return (
    <div className="space-y-4" data-testid="spv-reach-panel">
      <div>
        <div className="text-sm font-semibold">Who can actually reach this vehicle</div>
        <div className="text-xs text-[var(--cv-color-text-muted)] mt-1">
          Derived from live invitations and recorded discovery, not from the scope setting.
        </div>
      </div>

      <p className="text-sm" data-testid="spv-reach-copy">
        {r.reachCopy}
      </p>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-xs text-[var(--cv-color-text-muted)]">Live invitations</div>
          <Count value={r.invitationCount} testId="spv-reach-invitation-count" />
        </div>
        <div>
          <div className="text-xs text-[var(--cv-color-text-muted)]">People who have reached it</div>
          <Count value={r.distinctViewers} testId="spv-reach-distinct-viewers" />
        </div>
      </div>

      <div>
        <div className="text-xs text-[var(--cv-color-text-muted)] mb-1">Broadcast to</div>
        {r.broadcastContexts.length === 0 ? (
          <div className="text-sm" data-testid="spv-reach-no-broadcast">
            Nowhere. This vehicle is not listed on any discovery surface.
          </div>
        ) : (
          <ul className="text-sm list-disc pl-5" data-testid="spv-reach-broadcast-list">
            {r.broadcastContexts.map((c) => (
              <li key={c} data-testid={`spv-reach-context-${c}`}>
                {CONTEXT_LABELS[c] ?? c}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
