/**
 * v19 Phase A — Capavate Collective: Chapter Leaderboard.
 *
 * Responsibilities:
 *   - Period tabs (weekly / monthly / all-time).
 *   - Top-50 rows from the snapshot; current user is highlighted.
 *   - Live refresh via the 'leaderboard' SSE topic so members see rank
 *     changes within seconds of the refresh job tick.
 *   - Hidden entirely when COLLECTIVE_ENABLED is off.
 *
 * No mock data, no TODOs. Real endpoints only:
 *   GET /api/collective/leaderboard?chapter_id=...&period=...
 *   POST /api/collective/leaderboard/refresh (admins; not invoked here)
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useCollectiveStream } from "@/lib/sseClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Trophy, Star, MessageCircle, CalendarCheck, Megaphone, BookOpen } from "lucide-react";

type Period = "weekly" | "monthly" | "all-time";

interface FeatureFlagsResponse {
  COLLECTIVE_ENABLED?: boolean;
}

interface MeChaptersResponse {
  chapters: Array<{ id: string; name?: string; role?: string }>;
}

interface MeResponse {
  user?: { id: string; name?: string; email?: string } | null;
}

interface LeaderboardEntry {
  userId: string;
  score: number;
  rank: number;
  breakdown: {
    reputationGained: number;
    bestAnswersAccepted: number;
    eventsAttended: number;
    announcementsPosted: number;
    resourcesApproved: number;
  };
}

interface LeaderboardSnapshot {
  chapter_id: string;
  period: Period;
  period_start: string;
  period_end: string;
  generated_at: string;
  entries: LeaderboardEntry[];
}

interface LeaderboardResponse {
  ok: boolean;
  snapshot: LeaderboardSnapshot;
}

export default function LeaderboardPage(): JSX.Element | null {
  const [period, setPeriod] = useState<Period>("weekly");

  const flagsQ = useQuery<FeatureFlagsResponse>({
    queryKey: ["/api/feature-flags"],
    queryFn: async () => (await apiRequest("GET", "/api/feature-flags")).json(),
  });

  const meQ = useQuery<MeResponse>({
    queryKey: ["/api/me"],
    queryFn: async () => (await apiRequest("GET", "/api/me")).json(),
  });

  const chaptersQ = useQuery<MeChaptersResponse>({
    queryKey: ["/api/me/chapters"],
    queryFn: async () => (await apiRequest("GET", "/api/me/chapters")).json(),
    enabled: flagsQ.data?.COLLECTIVE_ENABLED === true,
  });

  const chapterId = chaptersQ.data?.chapters?.[0]?.id ?? "";

  const lbQ = useQuery<LeaderboardResponse>({
    queryKey: ["/api/collective/leaderboard", chapterId, period],
    queryFn: async () =>
      (
        await apiRequest(
          "GET",
          `/api/collective/leaderboard?chapter_id=${encodeURIComponent(chapterId)}&period=${period}`,
        )
      ).json(),
    enabled: Boolean(chapterId),
  });

  // Live refresh on 'leaderboard' SSE topic.
  useCollectiveStream({
    chapterId,
    topics: ["leaderboard"],
    onMessage: () => {
      lbQ.refetch();
    },
    enabled: Boolean(chapterId),
  });

  if (flagsQ.data?.COLLECTIVE_ENABLED !== true) return null;

  const currentUserId = meQ.data?.user?.id ?? "";
  const entries = lbQ.data?.snapshot?.entries ?? [];

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="leaderboard-page">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Trophy className="w-6 h-6" /> Chapter Leaderboard
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Top contributors by activity score. Updated every 60 minutes.
        </p>
      </div>

      <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
        <TabsList>
          <TabsTrigger value="weekly" data-testid="period-weekly">Weekly</TabsTrigger>
          <TabsTrigger value="monthly" data-testid="period-monthly">Monthly</TabsTrigger>
          <TabsTrigger value="all-time" data-testid="period-all-time">All-time</TabsTrigger>
        </TabsList>

        <TabsContent value={period} className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Top {Math.min(50, entries.length)} contributors
                {lbQ.data?.snapshot?.generated_at && (
                  <span className="ml-2 text-xs text-muted-foreground font-normal">
                    Generated {new Date(lbQ.data.snapshot.generated_at).toLocaleString()}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {lbQ.isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : entries.length === 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center" data-testid="lb-empty">
                  No activity in this period yet. Be the first to ask a question,
                  attend a screening, or submit a resource.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b">
                      <th className="text-left py-2 w-12">Rank</th>
                      <th className="text-left py-2">Member</th>
                      <th className="text-right py-2 w-20">Score</th>
                      <th className="text-left py-2 hidden md:table-cell">Breakdown</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => {
                      const isMe = e.userId === currentUserId;
                      return (
                        <tr
                          key={e.userId}
                          className={[
                            "border-b last:border-0",
                            isMe ? "bg-primary/10 font-medium" : "",
                          ].join(" ")}
                          data-testid={`lb-row-${e.rank}`}
                        >
                          <td className="py-2">
                            <Badge variant={e.rank <= 3 ? "default" : "outline"}>
                              {e.rank}
                            </Badge>
                          </td>
                          <td className="py-2">
                            {e.userId}
                            {isMe && (
                              <Badge variant="secondary" className="ml-2 text-xs">
                                You
                              </Badge>
                            )}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {e.score.toFixed(1)}
                          </td>
                          <td className="py-2 hidden md:table-cell">
                            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1" title="Reputation gained">
                                <Star className="w-3 h-3" />{e.breakdown.reputationGained}
                              </span>
                              <span className="flex items-center gap-1" title="Best answers">
                                <MessageCircle className="w-3 h-3" />{e.breakdown.bestAnswersAccepted}
                              </span>
                              <span className="flex items-center gap-1" title="Events attended">
                                <CalendarCheck className="w-3 h-3" />{e.breakdown.eventsAttended}
                              </span>
                              <span className="flex items-center gap-1" title="Announcements posted">
                                <Megaphone className="w-3 h-3" />{e.breakdown.announcementsPosted}
                              </span>
                              <span className="flex items-center gap-1" title="Resources approved">
                                <BookOpen className="w-3 h-3" />{e.breakdown.resourcesApproved}
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="text-xs text-muted-foreground">
        Scoring formula: <span className="font-mono">score = 1.0&middot;reputation + 3.0&middot;best&nbsp;answers + 2.0&middot;events + 0.5&middot;announcements + 1.5&middot;resources</span>
      </div>
    </div>
  );
}
