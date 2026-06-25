/**
 * v25.42 R4 — /collective/chapters
 *
 * Lists all chapters the caller belongs to (GET /api/me/chapters — DB-backed,
 * active memberships) with member count + last meeting + active deals derived
 * from existing endpoints client-side (screening-events per chapter). No new
 * endpoint. Loading / error / empty states handled.
 */
import { useQuery, useQueries } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Building2 } from "lucide-react";
import { useActiveChapter, type MeChapter } from "@/components/collective/widgets/useActiveChapter";

interface EventRow {
  id: string;
  status?: string;
  scheduledFor?: number;
}
interface ListResponse {
  ok?: boolean;
  events?: EventRow[];
}

export default function Chapters() {
  const { chapters, isLoading, error } = useActiveChapter();

  // For each chapter, fetch its screening events to derive last meeting +
  // active deals. useQueries keeps this DB-driven and parallel.
  const eventQueries = useQueries({
    queries: chapters.map((c: MeChapter) => ({
      queryKey: ["/api/collective/screening-events", "chapters-page", c.id],
      queryFn: async (): Promise<ListResponse> =>
        (await apiRequest(
          "GET",
          `/api/collective/screening-events?chapter_id=${encodeURIComponent(c.id)}`,
        )).json(),
      enabled: !!c.id,
      staleTime: 30_000,
    })),
  });

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: "#1A1A2E" }} data-testid="heading-chapters">
          Chapters
        </h1>
        <p className="text-sm text-slate-500 mt-1">Your regional chapters and their activity.</p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="chapters-loading">
          {[...Array(2)].map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700" data-testid="chapters-error">
          Couldn't load chapters. Please refresh.
        </div>
      ) : chapters.length === 0 ? (
        <div className="text-center py-12 text-slate-500" data-testid="chapters-empty">
          <Building2 className="h-8 w-8 mx-auto mb-2 text-slate-300" />
          <p className="text-sm">You're not in any chapters yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="chapters-list">
          {chapters.map((c, idx) => {
            const events = eventQueries[idx]?.data?.events ?? [];
            const nowSec = Math.floor(Date.now() / 1000);
            const past = events.filter((e) => (e.scheduledFor ?? 0) < nowSec);
            const lastMeeting = past.sort((a, b) => (b.scheduledFor ?? 0) - (a.scheduledFor ?? 0))[0];
            const activeDeals = events.filter(
              (e) => e.status === "scheduled" || e.status === "in_progress",
            ).length;
            return (
              <Card key={c.id} data-testid={`chapter-card-${c.id}`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2" style={{ color: "#1A1A2E" }}>
                    <Building2 className="h-4 w-4 text-[#cc0001]" />
                    {c.name ?? c.id}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className="text-[10px] bg-slate-100 text-slate-600">
                      {activeDeals} active deals
                    </Badge>
                    {c.role && (
                      <Badge className="text-[10px] bg-[#cc0001]/15 text-[#cc0001]">{c.role}</Badge>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    Last meeting:{" "}
                    {lastMeeting?.scheduledFor
                      ? new Date(lastMeeting.scheduledFor * 1000).toLocaleDateString()
                      : "—"}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
