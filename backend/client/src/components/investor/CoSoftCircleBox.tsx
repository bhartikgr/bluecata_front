/**
 * Sprint 21 Wave B — B6: CoSoftCircleBox
 *
 * "Co-soft-circle members" box displayed on the Overview tab ONLY when the
 * current investor has soft-circled this round.
 *
 * Fetches GET /api/rounds/:roundId/co-soft-circle-members
 *
 * Columns: Member · Area of expertise · Investment activity tier · Soft-circled amount · DM action
 * Privacy: respects displayLabel (already "[Anonymous Holder]" when coMembersOff)
 *          and disclosesAmount flag.
 *
 * Actions:
 *  - "Communicate" per row → navigates to /investor/messages?contactId=<memberId>
 *  - "Post to all co-soft-circle members" → creates a round-scoped post
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, MessageSquare, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface CoMember {
  id: string;
  /** Platform userId for DM routing. May be absent if the member hasn't linked a platform account. */
  userId?: string;
  displayLabel: string;
  areaOfExpertise: string;
  activityTier: string;
  amountBucket?: string;
  disclosesAmount: boolean;
}

interface CoMembersResponse {
  roundId: string;
  members: CoMember[];
}

interface Props {
  roundId: string;
  hasSoftCircled: boolean;
}

export default function CoSoftCircleBox({ roundId, hasSoftCircled }: Props) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<CoMembersResponse>({
    queryKey: ["/api/rounds", roundId, "co-soft-circle-members"],
    /* v25.32 burndown — item 15: apiRequest throws ApiError on non-2xx, so the
       prior `if (!res.ok) { ... }` block (incl. the 403 → empty-members
       fallback) was dead code — a 403/non-2xx surfaced as a query error instead
       of the intended empty roster. Catch ApiError and return the empty roster
       on any non-2xx, preserving the original graceful-degradation behavior.
       Source: v25_32_apiRequest_dead_code_sites_gpt55.txt (CoSoftCircleBox.tsx:57).
       Read-only; additive. */
    queryFn: async () => {
      try {
        const res = await apiRequest(
          "GET",
          `/api/rounds/${roundId}/co-soft-circle-members?hasSoftCircled=true`,
        );
        return res.json();
      } catch (err) {
        if (err instanceof ApiError) return { roundId, members: [] };
        throw err;
      }
    },
    enabled: !!roundId && hasSoftCircled,
  });

  const postMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/comms/posts", {
        body: `Update for all co-soft-circle members of round ${roundId}.`,
        visibility: "cap_table",
        roundScope: roundId,
      });
      if (!res.ok) throw new Error("post_failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Post sent to co-soft-circle members" });
      queryClient.invalidateQueries({ queryKey: ["/api/comms/posts"] });
    },
    onError: () => {
      toast({ title: "Failed to post", variant: "destructive" });
    },
  });

  // Only show when soft-circled
  if (!hasSoftCircled) return null;

  return (
    <Card data-testid="co-soft-circle-box">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4 text-[hsl(0_100%_40%)]" />
          Co-soft-circle members
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-4/5" />
          </div>
        )}

        {!isLoading && (!data?.members || data.members.length === 0) && (
          <p className="text-sm text-muted-foreground" data-testid="co-members-empty">
            You are the first to soft-circle this round. Co-members will appear here as they
            soft-circle.
          </p>
        )}

        {!isLoading && data?.members && data.members.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table
                className="w-full text-sm"
                data-testid="co-members-table"
              >
                <thead>
                  <tr className="text-xs uppercase text-muted-foreground border-b border-border">
                    <th className="text-left font-medium py-2">Member</th>
                    <th className="text-left font-medium py-2">Area of expertise</th>
                    <th className="text-left font-medium py-2">Activity tier</th>
                    <th className="text-right font-medium py-2">Soft-circled</th>
                    <th className="text-right font-medium py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.members.map((m) => (
                    <tr
                      key={m.id}
                      className="border-b border-border/60"
                      data-testid={`co-member-row-${m.id}`}
                    >
                      <td className="py-2.5 font-medium">{m.displayLabel}</td>
                      <td className="py-2.5 text-muted-foreground">{m.areaOfExpertise}</td>
                      <td className="py-2.5">
                        <Badge variant="outline" className="text-[10px]">
                          {m.activityTier}
                        </Badge>
                      </td>
                      <td className="py-2.5 text-right font-mono text-xs">
                        {m.disclosesAmount && m.amountBucket ? (
                          <span className="text-[hsl(0_100%_40%)]">{m.amountBucket}</span>
                        ) : (
                          <span className="text-muted-foreground">Confidential</span>
                        )}
                      </td>
                      <td className="py-2.5 text-right">
                        {/* DEF-009/038: use m.userId (platform userId); disable when absent */}
                        <Button
                          size="sm"
                          variant="ghost"
                          data-testid={`co-member-dm-${m.id}`}
                          title={m.userId ? "Communicate with this investor" : "Direct messages not available for this member."}
                          disabled={!m.userId}
                          onClick={() => {
                            if (m.userId) navigate(`/investor/messages?targetUserId=${encodeURIComponent(m.userId)}`);
                          }}
                        >
                          <MessageSquare className="h-3.5 w-3.5 mr-1" />
                          <span className="text-xs">DM</span>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Post to all co-soft-circle members */}
            <div className="mt-4 pt-3 border-t border-border">
              <Button
                variant="outline"
                size="sm"
                onClick={() => postMutation.mutate()}
                disabled={postMutation.isPending}
                data-testid="button-post-co-members"
                className="gap-2"
              >
                <Send className="h-3.5 w-3.5" />
                Post to all co-soft-circle members
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
