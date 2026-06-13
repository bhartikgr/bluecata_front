/**
 * Sprint 21 Wave A — MemberValueIntelligenceInvestor
 *
 * Card titled "Member Value & Intelligence".
 * - Tabbed per portfolio company (fetched from /api/investor/portfolio2)
 * - Active tab fetches co-members via GET /api/investor/companies/:id/co-members
 * - Shows: Member · Area of expertise · Experience tier · DM action · Post to group button
 *
 * No window.prompt/alert/confirm.
 * No localStorage/sessionStorage/indexedDB.
 * All calls via apiRequest().
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare, Rss, Users } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type PortfolioPosition = {
  id: string;
  companyId: string;
  company: string;
};

type CoMember = {
  memberId: string;
  /** Sprint 22 Wave 1: platform userId for DM (DEF-014 fix). Only present when allowDM:true. */
  userId?: string;
  displayLabel: string;
  areaOfExpertise: string[];
  investorExperienceTier: string;
  chapter?: string;
  screenNameOnly: boolean;
  allowDM: boolean;
};

const TIER_COLOR: Record<string, string> = {
  Angel: "bg-amber-500/10 text-amber-700",
  "Pre-seed": "bg-violet-500/10 text-violet-700",
  Seed: "bg-[hsl(184_98%_22%)]/10 text-[hsl(184_98%_22%)]",
  "Series A+": "bg-blue-500/10 text-blue-700",
  "Multi-stage": "bg-rose-500/10 text-rose-700",
};

export function MemberValueIntelligenceInvestor() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);
  // DEF-011 fix: Post-to-group compose dialog state.
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeDraft, setComposeDraft] = useState("");

  const portfolioQ = useQuery<PortfolioPosition[]>({
    queryKey: ["/api/investor/portfolio2"],
  });

  const positions = portfolioQ.data ?? [];
  const resolvedCompanyId = activeCompanyId ?? positions[0]?.companyId ?? null;

  const coMembersQ = useQuery<CoMember[]>({
    queryKey: ["/api/investor/companies", resolvedCompanyId, "co-members"],
    queryFn: async () => {
      if (!resolvedCompanyId) return [];
      const r = await apiRequest(
        "GET",
        `/api/investor/companies/${resolvedCompanyId}/co-members`,
      );
      return r.json();
    },
    enabled: !!resolvedCompanyId,
  });

  const members = coMembersQ.data ?? [];
  const activePosition = positions.find((p) => p.companyId === resolvedCompanyId);

  // Sprint 22 Wave 1 — DEF-014 fix: use userId (platform userId), not memberId.
  function handleDm(userId: string) {
    navigate(`/investor/messages?targetUserId=${encodeURIComponent(userId)}`);
  }

  // DEF-011 fix: Open compose dialog instead of navigating.
  function handlePostToGroup() {
    if (!resolvedCompanyId) return;
    setComposeDraft("");
    setComposeOpen(true);
  }

  const postToGroupMut = useMutation({
    mutationFn: async () => {
      if (!resolvedCompanyId) throw new Error("No company selected");
      const res = await apiRequest("POST", "/api/comms/posts", {
        body: composeDraft.trim(),
        visibility: "cap_table",
        authorKind: "user",
        companyId: resolvedCompanyId,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/comms/posts"] });
      toast({ title: "Post published", description: `Shared with ${activePosition?.company ?? "your"} cap-table holders.` });
      setComposeDraft("");
      setComposeOpen(false);
    },
    onError: (e: Error) => toast({ title: "Post failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Card data-testid="card-member-value-intelligence">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-[hsl(184_98%_22%)]" />
          <CardTitle className="text-base">Member Value &amp; Intelligence</CardTitle>
        </div>
        <p className="text-sm text-muted-foreground mt-0.5">
          Your co-investors on each portfolio company's cap table.
        </p>
      </CardHeader>
      <CardContent>
        {/* Company tabs */}
        {portfolioQ.isLoading ? (
          <Skeleton className="h-8 w-full mb-4" />
        ) : positions.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center">
            No portfolio positions yet.
          </div>
        ) : (
          <>
            <div className="flex gap-1 flex-wrap mb-4 border-b border-border pb-2">
              {positions.map((p) => (
                <button
                  key={p.companyId}
                  type="button"
                  onClick={() => setActiveCompanyId(p.companyId)}
                  className={`text-xs px-2.5 py-1 rounded-md capitalize transition-colors ${
                    p.companyId === resolvedCompanyId
                      ? "bg-[hsl(184_98%_22%)] text-white"
                      : "text-muted-foreground hover:bg-secondary"
                  }`}
                  data-testid={`tab-company-${p.companyId}`}
                >
                  {p.company}
                </button>
              ))}
            </div>

            {/* Co-member table */}
            {coMembersQ.isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : members.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4 text-center">
                No co-members found for {activePosition?.company ?? "this company"}.
              </div>
            ) : (
              <>
                <table className="w-full text-sm" data-testid="table-co-members">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="text-xs uppercase text-muted-foreground font-medium pb-2 pr-3">
                        Member
                      </th>
                      <th className="text-xs uppercase text-muted-foreground font-medium pb-2 pr-3">
                        Area of expertise
                      </th>
                      <th className="text-xs uppercase text-muted-foreground font-medium pb-2 pr-3">
                        Experience
                      </th>
                      <th className="text-xs uppercase text-muted-foreground font-medium pb-2 text-right">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => {
                      const tierCls = TIER_COLOR[m.investorExperienceTier] ?? "bg-secondary text-muted-foreground";
                      return (
                        <tr
                          key={m.memberId}
                          className="border-b border-border/50 last:border-0"
                          data-testid={`row-comember-${m.memberId}`}
                        >
                          <td className="py-2.5 pr-3">
                            <span
                              className={`text-sm font-medium ${m.screenNameOnly ? "italic text-muted-foreground" : ""}`}
                            >
                              {m.displayLabel}
                            </span>
                            {m.chapter && (
                              <div className="text-[11px] text-muted-foreground">
                                {m.chapter}
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 pr-3">
                            <div className="flex gap-1 flex-wrap">
                              {m.areaOfExpertise.map((tag) => (
                                <span
                                  key={tag}
                                  className="text-[10px] px-1.5 h-4 rounded-full bg-secondary text-muted-foreground inline-flex items-center"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="py-2.5 pr-3">
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${tierCls}`}
                            >
                              {m.investorExperienceTier}
                            </Badge>
                          </td>
                          <td className="py-2.5 text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              disabled={!m.allowDM || !m.userId}
                              onClick={() => m.userId && handleDm(m.userId)}
                              data-testid={`button-dm-${m.memberId}`}
                            >
                              <MessageSquare className="h-3 w-3 mr-1" />
                              DM
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {/* "Post to this cap table" CTA */}
                <div className="mt-4 pt-3 border-t border-border">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-xs"
                    onClick={handlePostToGroup}
                    data-testid="button-post-to-cap-table"
                  >
                    <Rss className="h-3.5 w-3.5 mr-1.5" />
                    Post to {activePosition?.company ?? "this"} cap-table channel
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </CardContent>

      {/* DEF-011: Post-to-group compose dialog */}
      <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Rss className="h-4 w-4" />
              Post to {activePosition?.company ?? "cap-table"} channel
            </DialogTitle>
          </DialogHeader>
          <Textarea
            rows={5}
            placeholder="Share an update, question, or insight with your fellow cap-table holders…"
            value={composeDraft}
            onChange={(e) => setComposeDraft(e.target.value)}
            className="resize-none"
            data-testid="input-post-to-group"
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setComposeOpen(false)}
              data-testid="button-post-cancel"
            >
              Cancel
            </Button>
            <Button
              disabled={!composeDraft.trim() || postToGroupMut.isPending}
              onClick={() => postToGroupMut.mutate()}
              data-testid="button-post-submit"
            >
              {postToGroupMut.isPending ? "Posting…" : "Publish post"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
