/**
 * WAVE 27 · CP-PIPE-04 — the read surface for the pipeline activity log.
 *
 * Before this wave the log was write-only in both directions: the server had a
 * writer (`POST /api/partner/me/pipeline/:id/activities`, plus an automatic
 * `stage_change` entry on every stage move at
 * `server/partnerWorkspaceStore.ts:2155`) and a `listForPipeline` reader with no
 * route, and the client had neither. Partners were accumulating deal history
 * that nothing could display. This dialog is the door.
 *
 * Mounted from `client/src/pages/partner/PartnerPipeline.tsx` (History button on
 * each deal card) — a component mounted nowhere is not shipped.
 */
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";

export type PipelineActivity = {
  id: string;
  pipelineId: string;
  activityType: "email" | "note" | "call" | "meeting" | "stage_change";
  body: string;
  occurredAt: string;
  createdBy: string;
};

const TYPE_LABEL: Record<PipelineActivity["activityType"], string> = {
  email: "Email",
  note: "Note",
  call: "Call",
  meeting: "Meeting",
  stage_change: "Stage change",
};

/** The server stores `occurredAt` as an ISO string. A malformed or missing value
 *  is rendered as an explicit refusal rather than "Invalid Date" or a fabricated
 *  timestamp — an unknown time is not the epoch. */
function formatOccurredAt(iso: string | null | undefined): string {
  if (!iso) return "Time not recorded";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Time not recorded";
  return d.toLocaleString();
}

export function PartnerPipelineActivityDialog({
  deal,
  onOpenChange,
}: {
  deal: { id: string; dealName?: string } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const dealId = deal?.id ?? null;
  const activities = useQuery<{ activities: PipelineActivity[] }>({
    queryKey: ["/api/partner/me/pipeline", dealId, "activities"],
    // Only fires once a deal is selected, so opening the page costs nothing.
    enabled: !!dealId,
    queryFn: async () =>
      (await apiRequest("GET", `/api/partner/me/pipeline/${encodeURIComponent(String(dealId))}/activities`)).json(),
  });

  const rows = activities.data?.activities ?? [];

  return (
    <Dialog open={!!deal} onOpenChange={onOpenChange}>
      <DialogContent data-testid="pipeline-activity-modal">
        <DialogHeader>
          <DialogTitle>Deal history</DialogTitle>
          <DialogDescription>
            Every logged touchpoint and stage change for {deal?.dealName ?? "this deal"}, newest first.
          </DialogDescription>
        </DialogHeader>

        {/* Each state is its own SIBLING element. They are never merged into one
            node with interpolated text: the drop guard reads text appended
            inside an existing text node as a removal plus an addition. */}
        {activities.isLoading && (
          <div className="text-xs text-muted-foreground" data-testid="pipeline-activity-loading">
            Loading deal history…
          </div>
        )}

        {activities.isError && (
          <div className="text-xs text-destructive" data-testid="pipeline-activity-error">
            Deal history could not be loaded. Nothing has been lost — please try again.
          </div>
        )}

        {!activities.isLoading && !activities.isError && rows.length === 0 && (
          <div className="text-xs text-muted-foreground" data-testid="pipeline-activity-empty">
            No activity logged for this deal yet. Emails, calls, meetings, notes and stage
            changes will appear here as they happen.
          </div>
        )}

        {rows.length > 0 && (
          <ul className="space-y-2 max-h-[50vh] overflow-y-auto" data-testid="pipeline-activity-list">
            {rows.map((a) => (
              <li
                key={a.id}
                className="rounded border border-border px-3 py-2"
                data-testid={`pipeline-activity-row-${a.id}`}
              >
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">
                    {TYPE_LABEL[a.activityType] ?? a.activityType}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">{formatOccurredAt(a.occurredAt)}</span>
                </div>
                <div className="text-xs mt-1 whitespace-pre-wrap break-words">{a.body}</div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
