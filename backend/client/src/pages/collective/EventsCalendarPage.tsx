/**
 * v19 Phase A — Capavate Collective: Events Calendar (month view).
 *
 * Responsibilities:
 *   - Render the screening_events for the active chapter as a month-view
 *     calendar (date-fns based).
 *   - Layer high-priority chapter_announcements as a banner overlay at
 *     the top of the page so members notice them without leaving the
 *     calendar view.
 *   - Hidden entirely when the COLLECTIVE_ENABLED feature flag is off.
 *
 * No mock data, no TODOs. Real endpoints only:
 *   GET /api/collective/screening-events?chapter_id=...&status=...
 *   GET /api/collective/announcements?chapter_id=...&filter=priority&priority=high
 */

import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { useCollectiveStream } from "@/lib/sseClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
// v25.42 R7 — compose modal that POSTs an event-flagged announcement to the
// existing /api/collective/announcements endpoint (server unchanged).
import { CalendarComposeSheet } from "@/components/collective/CalendarComposeSheet";

interface FeatureFlagsResponse {
  COLLECTIVE_ENABLED?: boolean;
}

interface MeChaptersResponse {
  chapters: Array<{ id: string; name?: string; role?: string }>;
}

interface ScreeningEventDTO {
  id: string;
  chapterId: string;
  companyId: string | null;
  title: string;
  description: string;
  scheduledFor: number; // unix seconds
  durationMinutes: number;
  location: string;
  eventType: string;
  status: string;
}

interface ScreeningEventsResponse {
  ok: boolean;
  events: ScreeningEventDTO[];
}

interface AnnouncementDTO {
  id: string;
  chapterId: string;
  title: string;
  body: string;
  pinned: boolean;
  priority: "low" | "normal" | "high" | "urgent";
  audience: string;
  expiresAt: string | null;
  createdAt: string;
  read?: boolean;
}

interface AnnouncementsResponse {
  ok: boolean;
  announcements: AnnouncementDTO[];
}

export default function EventsCalendarPage(): JSX.Element | null {
  const [cursor, setCursor] = useState<Date>(() => new Date());

  const flagsQ = useQuery<FeatureFlagsResponse>({
    queryKey: ["/api/feature-flags"],
    queryFn: async () => (await apiRequest("GET", "/api/feature-flags")).json(),
  });

  const chaptersQ = useQuery<MeChaptersResponse>({
    queryKey: ["/api/me/chapters"],
    queryFn: async () => (await apiRequest("GET", "/api/me/chapters")).json(),
    enabled: flagsQ.data?.COLLECTIVE_ENABLED === true,
  });

  const chapterId = chaptersQ.data?.chapters?.[0]?.id ?? "";

  const eventsQ = useQuery<ScreeningEventsResponse>({
    queryKey: ["/api/collective/screening-events", chapterId],
    queryFn: async () =>
      (
        await apiRequest(
          "GET",
          `/api/collective/screening-events?chapter_id=${encodeURIComponent(chapterId)}`,
        )
      ).json(),
    enabled: Boolean(chapterId),
  });

  const announcementsQ = useQuery<AnnouncementsResponse>({
    queryKey: ["/api/collective/announcements", chapterId, "priority"],
    queryFn: async () =>
      (
        await apiRequest(
          "GET",
          `/api/collective/announcements?chapter_id=${encodeURIComponent(chapterId)}&filter=priority`,
        )
      ).json(),
    enabled: Boolean(chapterId),
  });

  // Live update when new events / announcements land.
  useCollectiveStream({
    chapterId,
    topics: ["screening_events", "announcements"],
    onMessage: () => {
      eventsQ.refetch();
      announcementsQ.refetch();
    },
    enabled: Boolean(chapterId),
  });

  /** All days in the visible 6-week grid (Sun → Sat). */
  const calendarDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor));
    const end = endOfWeek(endOfMonth(cursor));
    const days: Date[] = [];
    let d = start;
    while (d <= end) {
      days.push(d);
      d = new Date(d.getTime() + 24 * 60 * 60 * 1000);
    }
    return days;
  }, [cursor]);

  /** Map yyyy-MM-dd → events on that day. */
  const eventsByDay = useMemo(() => {
    const map = new Map<string, ScreeningEventDTO[]>();
    for (const ev of eventsQ.data?.events ?? []) {
      const date = new Date(ev.scheduledFor * 1000);
      const key = format(date, "yyyy-MM-dd");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ev);
    }
    return map;
  }, [eventsQ.data]);

  const highPriorityAnnouncements = useMemo(() => {
    const list = announcementsQ.data?.announcements ?? [];
    return list.filter(
      (a) => a.priority === "high" || a.priority === "urgent",
    );
  }, [announcementsQ.data]);

  if (flagsQ.data?.COLLECTIVE_ENABLED !== true) return null;

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="events-calendar-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <CalendarDays className="w-6 h-6" /> Events Calendar
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Chapter screening events and high-priority announcements in one view.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* v25.42 R7 — add-event compose modal (chapter-admin guarded server-side). */}
          <CalendarComposeSheet chapterId={chapterId || undefined} />
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCursor((c) => subMonths(c, 1))}
            data-testid="cal-prev-month"
            aria-label="Previous month"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <div className="text-base font-medium min-w-[180px] text-center" data-testid="cal-month-label">
            {format(cursor, "MMMM yyyy")}
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCursor((c) => addMonths(c, 1))}
            data-testid="cal-next-month"
            aria-label="Next month"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCursor(new Date())}
            data-testid="cal-today"
          >
            Today
          </Button>
        </div>
      </div>

      {highPriorityAnnouncements.length > 0 && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/30" data-testid="high-priority-banner">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-amber-800 dark:text-amber-300">
              <AlertCircle className="w-4 h-4" /> Priority announcements
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {highPriorityAnnouncements.map((a) => (
              <Link
                key={a.id}
                href={`/collective/announcements/${a.id}`}
                className="block hover:underline"
              >
                <div className="flex items-center gap-2">
                  <Badge variant={a.priority === "urgent" ? "destructive" : "default"}>
                    {a.priority}
                  </Badge>
                  <span className="font-medium">{a.title}</span>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-2 md:p-4">
          {/* Weekday header */}
          <div className="grid grid-cols-7 text-xs font-medium text-muted-foreground border-b">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="py-2 text-center">
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7" data-testid="cal-grid">
            {calendarDays.map((day) => {
              const key = format(day, "yyyy-MM-dd");
              const dayEvents = eventsByDay.get(key) ?? [];
              const inMonth = isSameMonth(day, cursor);
              const isToday = isSameDay(day, new Date());
              return (
                <div
                  key={key}
                  className={[
                    "min-h-[100px] border-b border-r p-1 text-xs",
                    inMonth ? "" : "bg-muted/30 text-muted-foreground",
                    isToday ? "ring-2 ring-primary ring-inset" : "",
                  ].join(" ")}
                  data-testid={`cal-day-${key}`}
                >
                  <div className="font-medium mb-1">{format(day, "d")}</div>
                  <div className="space-y-1">
                    {dayEvents.slice(0, 3).map((ev) => (
                      <Link
                        key={ev.id}
                        href={`/collective/screening-events/${ev.id}`}
                        className="block truncate rounded bg-primary/10 hover:bg-primary/20 px-1 py-0.5"
                      >
                        <span className="font-medium">{format(new Date(ev.scheduledFor * 1000), "HH:mm")}</span>{" "}
                        {ev.title}
                      </Link>
                    ))}
                    {dayEvents.length > 3 && (
                      <div className="text-muted-foreground">
                        +{dayEvents.length - 3} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* v25.34 Phase 5 — empty-state hint when this month/chapter has no events
          (data loaded successfully but nothing is scheduled). */}
      {!eventsQ.isLoading && !eventsQ.isError && Boolean(chapterId) && (eventsQ.data?.events?.length ?? 0) === 0 && (
        <div className="text-sm text-muted-foreground text-center py-2" data-testid="cal-empty">
          No screening events scheduled for this chapter yet.
        </div>
      )}

      {eventsQ.isError && (
        <div className="text-sm text-destructive" data-testid="cal-error">
          Failed to load events. Try refreshing the page.
        </div>
      )}
    </div>
  );
}
