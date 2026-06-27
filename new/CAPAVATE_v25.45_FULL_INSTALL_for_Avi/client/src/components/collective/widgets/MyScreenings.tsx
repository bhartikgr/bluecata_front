/**
 * v25.42 W5 — My screenings.
 * Reads /api/collective/screening-events for the active chapter. The brief's
 * `?attendee=me` filter is NOT supported by the existing server (it returns
 * the chapter's events regardless), so we bucket CLIENT-SIDE into:
 *   Live (in_progress) · Voted (completed) · Upcoming (scheduled, future) ·
 *   Awaiting your vote (in_progress OR scheduled+past — needs your vote).
 * Server envelope is {events, hasMore, degraded}; we adapt client-side and
 * never change the server.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Vote } from "lucide-react";
import { useActiveChapter } from "./useActiveChapter";

interface EventRow {
  id: string;
  status?: string;
  scheduledFor?: number;
}
interface ListResponse {
  ok?: boolean;
  events?: EventRow[];
  degraded?: boolean;
}

interface Bucket {
  key: string;
  label: string;
  count: number;
  tone: string;
}

export function MyScreenings() {
  const { activeChapter, isLoading: chLoading } = useActiveChapter();
  const chapterId = activeChapter?.id;

  const { data, isLoading, error } = useQuery<ListResponse>({
    queryKey: ["/api/collective/screening-events", "my-screenings", chapterId ?? "none"],
    queryFn: async () =>
      (await apiRequest(
        "GET",
        `/api/collective/screening-events?chapter_id=${encodeURIComponent(chapterId!)}`,
      )).json(),
    enabled: !!chapterId,
    staleTime: 30_000,
  });

  const nowSec = Math.floor(Date.now() / 1000);
  const events = data?.events ?? [];
  const live = events.filter((e) => e.status === "in_progress");
  const voted = events.filter((e) => e.status === "completed");
  const upcoming = events.filter((e) => e.status === "scheduled" && (e.scheduledFor ?? 0) >= nowSec);
  const awaiting = events.filter(
    (e) => e.status === "in_progress" || (e.status === "scheduled" && (e.scheduledFor ?? 0) < nowSec),
  );

  const buckets: Bucket[] = [
    { key: "live", label: "Live", count: live.length, tone: "text-red-600" },
    { key: "voted", label: "Voted", count: voted.length, tone: "text-emerald-600" },
    { key: "upcoming", label: "Upcoming", count: upcoming.length, tone: "text-sky-600" },
    { key: "awaiting", label: "Awaiting your vote", count: awaiting.length, tone: "text-amber-600" },
  ];

  const busy = chLoading || (isLoading && !!chapterId);

  return (
    <Card data-testid="widget-my-screenings">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2" style={{ color: "#1A1A2E" }}>
          <Vote className="h-4 w-4 text-[#cc0001]" />
          My Screenings
        </CardTitle>
      </CardHeader>
      <CardContent>
        {busy ? (
          <div className="grid grid-cols-4 gap-2" data-testid="widget-my-screenings-loading">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="text-sm text-red-700" data-testid="widget-my-screenings-error">
            Couldn't load your screenings.
          </div>
        ) : !chapterId ? (
          <div className="text-sm text-slate-500" data-testid="widget-my-screenings-empty">
            Join a chapter to see screenings.
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2" data-testid="widget-my-screenings-buckets">
            {buckets.map((b) => (
              <div
                key={b.key}
                className="rounded-md bg-slate-50 p-3 text-center"
                data-testid={`widget-my-screenings-${b.key}`}
              >
                <div className={`text-2xl font-bold ${b.tone}`}>{b.count}</div>
                <div className="text-[11px] text-slate-500 mt-1">{b.label}</div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
