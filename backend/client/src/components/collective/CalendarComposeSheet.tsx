/**
 * v25.42 R7 — CalendarComposeSheet
 *
 * A compose modal added to the existing /collective/calendar page. It POSTs to
 * the EXISTING POST /api/collective/announcements endpoint with an event
 * marker (the server schema has no dedicated `event` column, so we mark the
 * announcement as an event via an "[Event] " title prefix — the same
 * convention the Upcoming-meetings widget reads as event=true). The server is
 * NOT changed. The chapter admin guard is enforced server-side (the endpoint
 * returns 403 not_chapter_admin for non-admins); we surface that error.
 *
 * No in-memory state beyond transient form fields; the mutation writes to the
 * DB-backed announcements store and invalidates the live queries.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CalendarPlus } from "lucide-react";
// v25.42 round-2 (Blocker 3) — the storage-only "[Event] " marker + helpers
// live in the shared, dependency-free classifier so the compose sheet and the
// UpcomingMeetingsCard fallback agree on exactly the same convention.
import { EVENT_TITLE_PREFIX, stripEventPrefix } from "./widgets/eventClassifier";

export { EVENT_TITLE_PREFIX, stripEventPrefix };

export interface CalendarComposeSheetProps {
  chapterId?: string;
  /** Disable the trigger (e.g. no active chapter / not admin). */
  disabled?: boolean;
}

export function CalendarComposeSheet({ chapterId, disabled }: CalendarComposeSheetProps) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  // The title field holds the user-facing (prefix-stripped) value; the
  // "[Event] " marker is added only when persisting (and stripped on display).
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      if (!chapterId) throw new Error("No active chapter");
      // event=true payload — marked via the "[Event] " title convention so the
      // existing (unchanged) announcements store can carry it.
      const res = await apiRequest("POST", "/api/collective/announcements", {
        title: `${EVENT_TITLE_PREFIX}${title.trim()}`,
        body: body.trim() || title.trim(),
        priority: "normal",
        audience: "all",
        chapter_id: chapterId,
      });
      return res.json();
    },
    onSuccess: () => {
      setTitle("");
      setBody("");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["/api/collective/announcements"] });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || !chapterId}
          data-testid="calendar-compose-trigger"
          className="gap-2 border-[#cc0001]/30 text-[#cc0001] hover:bg-[#cc0001]/05"
        >
          <CalendarPlus className="h-4 w-4" />
          Add event
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="calendar-compose-sheet">
        <DialogHeader>
          <DialogTitle>Add a chapter event</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label htmlFor="cc-title">Title</Label>
            <Input
              id="cc-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Quarterly chapter mixer"
              data-testid="calendar-compose-title"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cc-body">Details</Label>
            <Textarea
              id="cc-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="When, where, and what to expect."
              data-testid="calendar-compose-body"
            />
          </div>
          {mutation.isError && (
            <p className="text-xs text-red-600" data-testid="calendar-compose-error">
              {(mutation.error as Error)?.message ?? "Couldn't create the event."}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!title.trim() || mutation.isPending || !chapterId}
            data-testid="calendar-compose-submit"
          >
            {mutation.isPending ? "Creating…" : "Create event"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
