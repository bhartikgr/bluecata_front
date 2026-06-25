/**
 * v25.42 W6 — Upcoming meetings card.
 * Reads /api/collective/screening-events?from=<now> for the active chapter,
 * first 3 upcoming. The server validates `from` as unix-seconds (we send
 * seconds — the ISO in the brief is adapted client-side per the spec
 * correction; the server is NOT changed). Falls back to chapter announcements
 * where event=true when there are no upcoming screening events.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarDays } from "lucide-react";
import { useActiveChapter } from "./useActiveChapter";
import { isEventAnnouncement, stripEventPrefix } from "./eventClassifier";

interface EventRow {
  id: string;
  title?: string;
  scheduledFor?: number;
  status?: string;
}
interface ListResponse {
  ok?: boolean;
  events?: EventRow[];
}
interface Announcement {
  id: string;
  title?: string;
  event?: boolean;
  createdAt?: string;
}
interface AnnouncementsResponse {
  ok?: boolean;
  announcements?: Announcement[];
}

// v25.42 round-2 (Blocker 3) — event classification + prefix stripping live in
// the dependency-free `eventClassifier` module so they can be unit-tested and
// shared with CalendarComposeSheet. Re-exported here for existing importers.
export { isEventAnnouncement, stripEventPrefix };

export function UpcomingMeetingsCard() {
  const { activeChapter, isLoading: chLoading } = useActiveChapter();
  const chapterId = activeChapter?.id;
  const nowSec = Math.floor(Date.now() / 1000);

  const eventsQ = useQuery<ListResponse>({
    queryKey: ["/api/collective/screening-events", "upcoming-meetings", chapterId ?? "none"],
    queryFn: async () =>
      (await apiRequest(
        "GET",
        `/api/collective/screening-events?chapter_id=${encodeURIComponent(chapterId!)}&from=${nowSec}`,
      )).json(),
    enabled: !!chapterId,
    staleTime: 30_000,
  });

  const upcoming = (eventsQ.data?.events ?? [])
    .filter((e) => e.status !== "cancelled" && (e.scheduledFor ?? 0) >= nowSec)
    .sort((a, b) => (a.scheduledFor ?? 0) - (b.scheduledFor ?? 0))
    .slice(0, 3);

  // Fallback: chapter announcements flagged as events, only when no upcoming
  // screening events exist.
  const annQ = useQuery<AnnouncementsResponse>({
    queryKey: ["/api/collective/announcements", "upcoming-meetings-fallback", chapterId ?? "none"],
    queryFn: async () =>
      (await apiRequest(
        "GET",
        `/api/collective/announcements?chapter_id=${encodeURIComponent(chapterId!)}&filter=active`,
      )).json(),
    enabled: !!chapterId && !eventsQ.isLoading && upcoming.length === 0,
    staleTime: 30_000,
  });
  const fallbackEvents = (annQ.data?.announcements ?? []).filter(isEventAnnouncement).slice(0, 3);

  const busy = chLoading || (eventsQ.isLoading && !!chapterId);
  const error = eventsQ.error;

  return (
    <Card data-testid="widget-upcoming-meetings">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2" style={{ color: "#1A1A2E" }}>
          <CalendarDays className="h-4 w-4 text-[#cc0001]" />
          Upcoming Meetings
        </CardTitle>
      </CardHeader>
      <CardContent>
        {busy ? (
          <div className="space-y-2" data-testid="widget-upcoming-loading">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="text-sm text-red-700" data-testid="widget-upcoming-error">
            Couldn't load upcoming meetings.
          </div>
        ) : upcoming.length === 0 && fallbackEvents.length === 0 ? (
          <div className="text-center py-6 text-slate-500" data-testid="widget-upcoming-empty">
            <p className="text-sm">No upcoming meetings.</p>
          </div>
        ) : (
          <div className="space-y-2" data-testid="widget-upcoming-list">
            {upcoming.map((e) => (
              <div
                key={e.id}
                className="flex items-center justify-between py-2 px-3 rounded-md bg-slate-50"
                data-testid={`widget-upcoming-event-${e.id}`}
              >
                <span className="text-sm text-slate-700 truncate">{e.title ?? "Screening event"}</span>
                <span className="text-[11px] text-slate-400 shrink-0">
                  {e.scheduledFor ? new Date(e.scheduledFor * 1000).toLocaleString() : ""}
                </span>
              </div>
            ))}
            {upcoming.length === 0 &&
              fallbackEvents.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between py-2 px-3 rounded-md bg-slate-50"
                  data-testid={`widget-upcoming-ann-${a.id}`}
                >
                  <span className="text-sm text-slate-700 truncate">{stripEventPrefix(a.title) || "Chapter event"}</span>
                  <span className="text-[11px] text-slate-400 shrink-0">
                    {a.createdAt ? new Date(a.createdAt).toLocaleDateString() : ""}
                  </span>
                </div>
              ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
