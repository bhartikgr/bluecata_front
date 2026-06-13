/**
 * v18 Phase A — Capavate Collective: Screening Events page.
 *
 * Responsibilities:
 *   - List screening events for the active chapter
 *   - Admin-only "Schedule event" modal (chapter admin / DSC)
 *   - Per-attendee RSVP buttons (accept / tentative / decline)
 *   - "Add to calendar" link that downloads the ICS file
 *   - Cancel (admin / organizer)
 *
 * Hidden when `COLLECTIVE_ENABLED` feature flag is off — the parent shell
 * already gates the route, but this component double-checks to fail
 * closed if the flag flips at runtime.
 *
 * No mock data, no TODOs, no stubs — every action calls a real endpoint.
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useCollectiveStream } from "@/lib/sseClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
/* v25.12 NH4 — toast errors on RSVP / cancel / create mutations. */
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar, CalendarPlus, Download, XCircle, CheckCircle2 } from "lucide-react";

// ----- Types --------------------------------------------------------------

interface FeatureFlagsResponse {
  COLLECTIVE_ENABLED?: boolean;
}

interface MeChaptersResponse {
  chapters: Array<{ id: string; name?: string; role?: string }>;
}

type RsvpStatus = "invited" | "accepted" | "declined" | "tentative";
type EventStatus = "scheduled" | "in_progress" | "completed" | "cancelled";
type EventType = "screening" | "pitch" | "office_hours";

interface ScreeningEventDTO {
  id: string;
  tenantId: string;
  chapterId: string;
  companyId: string;
  roundId: string | null;
  title: string;
  description: string;
  scheduledFor: number; // unix seconds
  durationMinutes: number;
  location: string | null;
  eventType: EventType;
  status: EventStatus;
  organizerUserId: string;
  icsUid: string;
  prevHash: string | null;
  currHash: string;
  createdAt: string;
  updatedAt: string;
}

interface AttendeeDTO {
  id: string;
  eventId: string;
  userId: string;
  role: "founder" | "investor" | "dsc" | "observer";
  rsvp: RsvpStatus;
  attended: boolean;
  checkedInAt: string | null;
}

interface ListResponse {
  ok: boolean;
  events: ScreeningEventDTO[];
}

interface DetailResponse {
  ok: boolean;
  event: ScreeningEventDTO;
  attendees: AttendeeDTO[];
}

interface MeResponse {
  user?: { id?: string; isAdmin?: boolean };
}

// ----- Helpers ------------------------------------------------------------

function formatLocal(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  return d.toLocaleString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusColor(status: EventStatus): string {
  switch (status) {
    case "scheduled":
      return "bg-blue-100 text-blue-700";
    case "in_progress":
      return "bg-amber-100 text-amber-700";
    case "completed":
      return "bg-emerald-100 text-emerald-700";
    case "cancelled":
      return "bg-red-100 text-red-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

// ----- Page ---------------------------------------------------------------

export default function ScreeningEventsPage() {
  const qc = useQueryClient();

  // 1) Feature flag — hide entirely when COLLECTIVE_ENABLED is off.
  const flagsQ = useQuery<FeatureFlagsResponse>({
    queryKey: ["/api/feature-flags"],
    queryFn: async () => (await apiRequest("GET", "/api/feature-flags")).json(),
  });
  const collectiveOn = flagsQ.data?.COLLECTIVE_ENABLED === true;

  // 2) Active chapter — for v18 Phase A we pick the user's first chapter.
  //    A topbar chapter selector exists separately; reading from it would
  //    require a global state subscription, which is out of scope here.
  const chaptersQ = useQuery<MeChaptersResponse>({
    queryKey: ["/api/me/chapters"],
    queryFn: async () => (await apiRequest("GET", "/api/me/chapters")).json(),
    enabled: collectiveOn,
  });
  const activeChapter = chaptersQ.data?.chapters?.[0];
  const isChapterAdmin = activeChapter?.role === "admin";

  // 3) Current user identity for admin / organizer checks.
  const meQ = useQuery<MeResponse>({
    queryKey: ["/api/me"],
    queryFn: async () => (await apiRequest("GET", "/api/me")).json(),
    enabled: collectiveOn,
  });
  const myUserId = meQ.data?.user?.id ?? "";
  const isPlatformAdmin = meQ.data?.user?.isAdmin === true;
  const canSchedule = isChapterAdmin || isPlatformAdmin;

  // 4) List of events for this chapter.
  const eventsQ = useQuery<ListResponse>({
    queryKey: [
      "/api/collective/screening-events",
      activeChapter?.id ?? "none",
    ],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/collective/screening-events?chapter_id=${encodeURIComponent(activeChapter!.id)}`,
      );
      return res.json();
    },
    enabled: collectiveOn && !!activeChapter?.id,
  });

  // 5) Modal state for "Schedule event".
  const [createOpen, setCreateOpen] = useState(false);

  // v18 Phase D — SSE realtime: invalidate the events query on every
  // `events` topic frame for this chapter. Polling refetch remains as the
  // background fallback if SSE never connects.
  useCollectiveStream({
    chapterId: activeChapter?.id ?? "",
    topics: ["events"],
    enabled: collectiveOn && !!activeChapter?.id,
    onMessage: () => {
      qc.invalidateQueries({
        queryKey: [
          "/api/collective/screening-events",
          activeChapter?.id ?? "none",
        ],
      });
    },
  });

  // ---- Render gates ----
  if (!collectiveOn) {
    return null;
  }
  if (chaptersQ.isLoading) {
    return (
      <div className="p-6 space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (!activeChapter) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>No active chapter</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-600">
              Join a Capavate Collective chapter to view and schedule events.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[#1A1A2E] flex items-center gap-2">
            <Calendar className="w-6 h-6 text-[#8E2A4E]" />
            Screening Events
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            DSC screenings, pitches, and office hours for {activeChapter.name ?? activeChapter.id}.
          </p>
        </div>
        {canSchedule ? (
          <Button
            onClick={() => setCreateOpen(true)}
            data-testid="schedule-event-btn"
            className="bg-[#8E2A4E] hover:bg-[#6E1F3C] text-white"
          >
            <CalendarPlus className="w-4 h-4 mr-2" />
            Schedule event
          </Button>
        ) : null}
      </header>

      {eventsQ.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (eventsQ.data?.events?.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-slate-600">
            No events scheduled. {canSchedule ? "Schedule one to get started." : null}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {(eventsQ.data?.events ?? []).map((ev) => (
            <EventRow
              key={ev.id}
              ev={ev}
              myUserId={myUserId}
              canAdmin={canSchedule}
              onChange={() => {
                qc.invalidateQueries({
                  queryKey: [
                    "/api/collective/screening-events",
                    activeChapter.id,
                  ],
                });
              }}
            />
          ))}
        </div>
      )}

      {canSchedule && createOpen ? (
        <CreateEventDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          chapterId={activeChapter.id}
          onCreated={() => {
            setCreateOpen(false);
            qc.invalidateQueries({
              queryKey: [
                "/api/collective/screening-events",
                activeChapter.id,
              ],
            });
          }}
        />
      ) : null}
    </div>
  );
}

// ----- EventRow -----------------------------------------------------------

function EventRow(props: {
  ev: ScreeningEventDTO;
  myUserId: string;
  canAdmin: boolean;
  onChange: () => void;
}) {
  const { ev, myUserId, canAdmin, onChange } = props;
  const qc = useQueryClient();

  // Per-row detail fetch (attendees), expanded on demand.
  const [expanded, setExpanded] = useState(false);
  const detailQ = useQuery<DetailResponse>({
    queryKey: ["/api/collective/screening-events/detail", ev.id],
    queryFn: async () =>
      (await apiRequest("GET", `/api/collective/screening-events/${ev.id}`)).json(),
    enabled: expanded,
  });

  const myAttendee = detailQ.data?.attendees?.find((a) => a.userId === myUserId);
  const isOrganizer = ev.organizerUserId === myUserId;
  const canCancel = (canAdmin || isOrganizer) && ev.status !== "cancelled";

  /* v25.12 NH4 — toast helper. */
  const { toast } = useToast();
  const onErr = (label: string) => (e: Error) =>
    toast({ variant: "destructive", title: `${label} failed`, description: e.message });

  const rsvpMut = useMutation({
    mutationFn: async (rsvp: RsvpStatus) => {
      const res = await apiRequest(
        "POST",
        `/api/collective/screening-events/${ev.id}/rsvp`,
        { rsvp },
      );
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["/api/collective/screening-events/detail", ev.id],
      });
      onChange();
    },
    onError: onErr("RSVP"),
  });

  const cancelMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/collective/screening-events/${ev.id}/cancel`,
      );
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["/api/collective/screening-events/detail", ev.id],
      });
      onChange();
    },
    onError: onErr("Cancel event"),
  });

  return (
    <Card data-testid={`event-row-${ev.id}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base text-[#1A1A2E]">
              {ev.title}
            </CardTitle>
            <p className="text-xs text-slate-500 mt-1">
              {formatLocal(ev.scheduledFor)} · {ev.durationMinutes} min · {ev.eventType.replace("_", " ")}
            </p>
            {ev.location ? (
              <p className="text-xs text-slate-500">{ev.location}</p>
            ) : null}
          </div>
          <Badge className={statusColor(ev.status)}>{ev.status}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {ev.description ? (
          <p className="text-sm text-slate-700 whitespace-pre-line">{ev.description}</p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {/* v25.12 NL3 — use a programmatic fetch with credentials: "include"
           * so the session cookie is sent even under SameSite=Strict.
           * The plain anchor download could 401 in stricter cookie policies. */}
          <button
            type="button"
            onClick={async () => {
              try {
                const res = await fetch(`/api/collective/screening-events/${ev.id}/ics`, { credentials: "include" });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `capavate-event-${ev.id}.ics`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
              } catch (e) {
                toast({ variant: "destructive", title: "Could not download ICS", description: (e as Error).message });
              }
            }}
            className="inline-flex items-center text-xs px-3 py-1.5 rounded border border-[#8E2A4E]/30 text-[#8E2A4E] hover:bg-[#8E2A4E]/5"
            data-testid={`ics-download-${ev.id}`}
          >
            <Download className="w-3 h-3 mr-1" />
            Add to calendar (.ics)
          </button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => setExpanded((x) => !x)}
            data-testid={`toggle-detail-${ev.id}`}
          >
            {expanded ? "Hide" : "Show"} attendees
          </Button>
          {canCancel ? (
            <Button
              variant="outline"
              size="sm"
              className="text-xs text-red-600 border-red-200 hover:bg-red-50"
              onClick={() => {
                if (window.confirm("Cancel this event? Attendees will be notified.")) {
                  cancelMut.mutate();
                }
              }}
              disabled={cancelMut.isPending}
              data-testid={`cancel-event-${ev.id}`}
            >
              <XCircle className="w-3 h-3 mr-1" />
              Cancel
            </Button>
          ) : null}
        </div>

        {expanded ? (
          <div className="border-t pt-3 mt-3 space-y-2">
            {detailQ.isLoading ? (
              <Skeleton className="h-12 w-full" />
            ) : detailQ.data?.attendees && detailQ.data.attendees.length > 0 ? (
              <>
                <p className="text-xs font-semibold text-slate-700">
                  Attendees ({detailQ.data.attendees.length})
                </p>
                <ul className="text-xs space-y-1">
                  {detailQ.data.attendees.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between border-b last:border-b-0 py-1"
                    >
                      <span className="font-mono text-slate-600">
                        {a.userId}
                        {a.userId === ev.organizerUserId ? (
                          <span className="ml-2 text-[#8E2A4E]">(organizer)</span>
                        ) : null}
                      </span>
                      <span className="flex items-center gap-2">
                        <Badge variant="outline">{a.rsvp}</Badge>
                        {a.attended ? (
                          <Badge className="bg-emerald-100 text-emerald-700">
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            attended
                          </Badge>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-xs text-slate-500">No attendees on this event yet.</p>
            )}

            {myAttendee && ev.status !== "cancelled" ? (
              <div className="pt-2 border-t mt-2">
                <p className="text-xs text-slate-700 mb-1">
                  Your RSVP: <strong>{myAttendee.rsvp}</strong>
                </p>
                <div className="flex gap-2">
                  {(["accepted", "tentative", "declined"] as RsvpStatus[]).map((opt) => (
                    <Button
                      key={opt}
                      variant={myAttendee.rsvp === opt ? "default" : "outline"}
                      size="sm"
                      className="text-xs"
                      disabled={rsvpMut.isPending}
                      onClick={() => rsvpMut.mutate(opt)}
                      data-testid={`rsvp-${ev.id}-${opt}`}
                    >
                      {opt}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ----- CreateEventDialog --------------------------------------------------

function CreateEventDialog(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  chapterId: string;
  onCreated: () => void;
}) {
  const { open, onOpenChange, chapterId, onCreated } = props;

  // Form state. We avoid web storage per V19 brief — pure local state only.
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [scheduledForLocal, setScheduledForLocal] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("60");
  const [location, setLocation] = useState("");
  const [eventType, setEventType] = useState<EventType>("screening");
  const [attendeeIds, setAttendeeIds] = useState("");

  const submitError = useMemo(() => {
    if (title.trim().length < 3) return "Title must be at least 3 characters.";
    if (!companyId.trim()) return "Company ID is required.";
    if (!scheduledForLocal) return "Scheduled time is required.";
    const ts = Math.floor(new Date(scheduledForLocal).getTime() / 1000);
    if (!Number.isFinite(ts) || ts <= 0) return "Scheduled time is invalid.";
    return null;
  }, [title, companyId, scheduledForLocal]);

  /* v25.12 NH4 — toast helper inside CreateEventDialog scope. */
  const { toast: toastCreate } = useToast();

  const createMut = useMutation({
    mutationFn: async () => {
      const scheduled_for = Math.floor(
        new Date(scheduledForLocal).getTime() / 1000,
      );
      const attendee_user_ids = attendeeIds
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const body = {
        title: title.trim(),
        description: description.trim(),
        scheduled_for,
        duration_minutes: Number(durationMinutes) || 60,
        location: location.trim() || undefined,
        event_type: eventType,
        company_id: companyId.trim(),
        chapter_id: chapterId,
        attendee_user_ids,
      };
      const res = await apiRequest(
        "POST",
        "/api/collective/screening-events",
        body,
      );
      return res.json();
    },
    onSuccess: () => {
      onCreated();
    },
    onError: (e: Error) =>
      toastCreate({ variant: "destructive", title: "Create event failed", description: e.message }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Schedule screening event</DialogTitle>
          <DialogDescription>
            Visible only to chapter members. Attendees receive an in-app
            notification on creation; the ICS file is offered for offline
            calendar import.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="DSC screening — Company name"
              data-testid="create-title"
            />
          </div>

          <div>
            <Label htmlFor="company">Company ID</Label>
            <Input
              id="company"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              placeholder="co_novapay"
              data-testid="create-company"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="scheduled">Scheduled for</Label>
              <Input
                id="scheduled"
                type="datetime-local"
                value={scheduledForLocal}
                onChange={(e) => setScheduledForLocal(e.target.value)}
                data-testid="create-scheduled"
              />
            </div>
            <div>
              <Label htmlFor="duration">Duration (min)</Label>
              <Input
                id="duration"
                type="number"
                min={5}
                max={720}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                data-testid="create-duration"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="evtype">Event type</Label>
            <Select
              value={eventType}
              onValueChange={(v) => setEventType(v as EventType)}
            >
              <SelectTrigger id="evtype" data-testid="create-evtype">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="screening">Screening</SelectItem>
                <SelectItem value="pitch">Pitch</SelectItem>
                <SelectItem value="office_hours">Office hours</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="location">Location</Label>
            <Input
              id="location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Zoom link or address"
              data-testid="create-location"
            />
          </div>

          <div>
            <Label htmlFor="desc">Description</Label>
            <Textarea
              id="desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="create-description"
            />
          </div>

          <div>
            <Label htmlFor="attendees">Attendee user IDs (comma-separated)</Label>
            <Input
              id="attendees"
              value={attendeeIds}
              onChange={(e) => setAttendeeIds(e.target.value)}
              placeholder="u_maya_chen, u_daniel_okafor"
              data-testid="create-attendees"
            />
          </div>

          {submitError ? (
            <p className="text-xs text-red-600">{submitError}</p>
          ) : null}
          {createMut.error ? (
            <p className="text-xs text-red-600">
              {(createMut.error as Error).message}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={createMut.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => createMut.mutate()}
            disabled={!!submitError || createMut.isPending}
            className="bg-[#8E2A4E] hover:bg-[#6E1F3C] text-white"
            data-testid="create-submit"
          >
            {createMut.isPending ? "Scheduling…" : "Schedule event"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
