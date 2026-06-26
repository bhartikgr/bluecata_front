/**
 * v25.44 Surface 8 — /collective/schedule.
 * POST /api/collective/schedule writes a structured event into
 * chapter_announcements (date, attendees, RSVP track).
 */
import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CalendarPlus } from "lucide-react";
import { useActiveChapter } from "@/components/collective/widgets/useActiveChapter";

export default function SchedulePage() {
  const { activeChapter } = useActiveChapter();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [attendees, setAttendees] = useState("");
  const [rsvpTrack, setRsvpTrack] = useState(true);
  const [status, setStatus] = useState<"idle" | "saving" | "ok" | "error">("idle");

  async function submit() {
    if (!activeChapter?.id) {
      setStatus("error");
      return;
    }
    setStatus("saving");
    try {
      const res = await apiRequest("POST", "/api/collective/schedule", {
        chapterId: activeChapter.id,
        title,
        date,
        attendees: attendees.split(",").map((s) => s.trim()).filter(Boolean),
        rsvpTrack,
      });
      setStatus(res.ok ? "ok" : "error");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto" data-testid="page-schedule">
      <div className="flex items-center gap-2 mb-6">
        <CalendarPlus className="h-6 w-6 text-[#cc0001]" />
        <h1 className="text-2xl font-semibold" style={{ color: "#041e41" }}>Schedule an Event</h1>
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-slate-500">{activeChapter?.name ?? "Your chapter"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="sched-title">Title</Label>
            <Input id="sched-title" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="schedule-title" />
          </div>
          <div>
            <Label htmlFor="sched-date">Date</Label>
            <Input id="sched-date" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} data-testid="schedule-date" />
          </div>
          <div>
            <Label htmlFor="sched-att">Attendees (comma-separated user ids)</Label>
            <Input id="sched-att" value={attendees} onChange={(e) => setAttendees(e.target.value)} data-testid="schedule-attendees" />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={rsvpTrack} onCheckedChange={setRsvpTrack} data-testid="schedule-rsvp" />
            <Label>Track RSVPs</Label>
          </div>
          <Button onClick={submit} disabled={status === "saving"} data-testid="schedule-submit">
            {status === "saving" ? "Saving…" : "Schedule"}
          </Button>
          {status === "ok" && <p className="text-sm text-green-700" data-testid="schedule-ok">Event scheduled.</p>}
          {status === "error" && <p className="text-sm text-red-700" data-testid="schedule-error">Couldn't schedule the event.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
