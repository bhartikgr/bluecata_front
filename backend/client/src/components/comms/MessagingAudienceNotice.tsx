/**
 * WAVE 33 · CP-MSG-01 — the messaging audience notice.
 *
 * WHY THIS COMPONENT EXISTS
 *   `GET /api/comms/users` returns an ARRAY. When it is empty, every Messages
 *   surface on the platform renders the same nothing — and an empty recipient
 *   picker has at least three completely different causes:
 *
 *     1. the viewer genuinely has no peers yet (a new investor, no cap table);
 *     2. the platform owner has switched an audience rule OFF;
 *     3. the owner HAS NOT YET DECIDED whether the rule should exist at all —
 *        which is the live state for the two Consortium Partner rules.
 *
 *   Cause 3 is not a bug and must not be rendered as one, and it is certainly
 *   not something this build may decide on the owner's behalf. So the rule set
 *   is read from `GET /api/comms/audience-policy` and the open question is
 *   stated on screen, with the recommendation that was put to the owner.
 *
 *   The same component mounts on the partner, investor and founder Messages
 *   pages, because the empty audience is one SHARED PLATFORM rule and not a
 *   partner-specific defect.
 *
 * NOTHING IS INVENTED HERE. Every string below is either fixed UI copy or a
 * value the server read out of `comms_audience_rules`. If the endpoint fails,
 * the component renders a stated read-failure rather than a reassuring blank.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Info, AlertTriangle, Briefcase } from "lucide-react";

export interface AudiencePolicy {
  viewerRole: string;
  rules: Array<{
    ruleKey: string;
    appliesToViewerRole: string;
    enabled: boolean;
    requiresOwnerDecision: boolean;
    description: string;
    recommendedDefault: string | null;
  }>;
  pendingOwnerDecision: Array<{
    ruleKey: string;
    description: string;
    recommendedDefault: string | null;
  }>;
  delegatedContext: {
    partnerId: string;
    partnerName: string | null;
    engagements: Array<{ engagementId: string; companyId: string; companyName: string | null }>;
  } | null;
}

export function MessagingAudienceNotice({ className }: { className?: string }) {
  const q = useQuery<AudiencePolicy>({
    queryKey: ["/api/comms/audience-policy"],
    queryFn: async () => (await apiRequest("GET", "/api/comms/audience-policy")).json(),
  });

  if (q.isLoading) return null;

  /* WAVE 37 — A MALFORMED 200 IS A READ FAILURE, NOT A CRASH.
   *
   * The header above promises that a failing endpoint "renders a stated
   * read-failure rather than a reassuring blank". That held for a thrown
   * request and for `!q.data`, but NOT for the case that actually occurs: a
   * 200 whose body is missing the arrays. `pendingOwnerDecision.length` on
   * `undefined` throws a TypeError out of render, and because this component
   * sits inside every Messages surface with no error boundary above it, React
   * unmounts the ENTIRE root. The page does not degrade — it disappears,
   * leaving `<div></div>` and taking the conversation list, the refusal banner
   * and its retry button with it.
   *
   * That is strictly worse than the blank this component was written to
   * prevent, and it is how a partner would have experienced any payload skew
   * from `/api/comms/audience-policy`. So an unusable payload is routed into
   * the SAME stated refusal as a failed request. Nothing is invented and
   * nothing is hidden: if the policy cannot be read as a policy, the page says
   * so. The shape check is deliberately narrow — only the two fields this
   * component dereferences — so a genuinely valid payload can never be
   * downgraded into a false refusal. */
  const usable =
    !!q.data &&
    Array.isArray((q.data as AudiencePolicy).pendingOwnerDecision) &&
    Array.isArray((q.data as AudiencePolicy).rules);

  if (q.isError || !q.data || !usable) {
    return (
      <div
        data-testid="audience-policy-unavailable"
        className={`rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive ${className ?? ""}`}
      >
        <AlertTriangle className="inline h-3.5 w-3.5 mr-1.5 -mt-0.5" />
        The messaging audience policy could not be read, so this page cannot say
        who you are able to message. Nothing has been hidden — this is a read
        failure, not an empty audience.
      </div>
    );
  }

  const { pendingOwnerDecision, delegatedContext } = q.data;
  if (pendingOwnerDecision.length === 0 && !delegatedContext) return null;

  return (
    <div className={`space-y-2 ${className ?? ""}`} data-testid="audience-policy-notice">
      {delegatedContext && (
        <div
          data-testid="audience-delegated-context"
          className="rounded-md border border-border bg-muted/40 p-3 text-xs"
        >
          <Briefcase className="inline h-3.5 w-3.5 mr-1.5 -mt-0.5" />
          You are messaging as a member of{" "}
          <span className="font-medium">
            {delegatedContext.partnerName ??
              "your Consortium Partner organisation (name not on file)"}
          </span>
          .{" "}
          {delegatedContext.engagements.length > 0 ? (
            <>
              You currently hold live delegated authority for{" "}
              <span className="font-medium">
                {delegatedContext.engagements
                  .map((e) => e.companyName ?? e.companyId)
                  .join(", ")}
              </span>
              . A message sent on a client's behalf is labelled as such for
              everyone in the thread.
            </>
          ) : (
            <>You currently hold no live client engagements.</>
          )}
        </div>
      )}

      {pendingOwnerDecision.length > 0 && (
        <div
          data-testid="audience-pending-owner-decision"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"
        >
          <Info className="inline h-3.5 w-3.5 mr-1.5 -mt-0.5" />
          <span className="font-medium">
            Awaiting a platform-owner decision — this is not an error.
          </span>
          <p className="mt-1">
            Who a Consortium Partner may message is a commercial decision that
            has not been made yet, so the following audience rules are switched
            off. They are built and can be enabled by the platform owner without
            a code change or a deploy.
          </p>
          <ul className="mt-2 space-y-1.5">
            {pendingOwnerDecision.map((r) => (
              <li key={r.ruleKey} data-testid={`audience-pending-${r.ruleKey}`}>
                <span className="font-mono text-[10px]">{r.ruleKey}</span> — {r.description}
                {r.recommendedDefault && (
                  <div className="italic opacity-80">{r.recommendedDefault}</div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default MessagingAudienceNotice;
