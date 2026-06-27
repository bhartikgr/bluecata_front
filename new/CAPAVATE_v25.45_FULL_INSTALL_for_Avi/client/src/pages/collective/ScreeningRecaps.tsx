/**
 * v25.42 R3 — /collective/screening-recaps
 *
 * Reads closed screening events for the active chapter via the existing
 * GET /api/collective/screening-events?chapter_id=...&status=completed
 * endpoint. (The server status enum uses "completed"; we also surface
 * "closed" if a row carries it.) Lists post-event metadata. No new endpoint.
 * Loading / error / empty states handled.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ClipboardCheck } from "lucide-react";
import { useActiveChapter } from "@/components/collective/widgets/useActiveChapter";

interface EventRow {
  id: string;
  title?: string;
  status?: string;
  scheduledFor?: number;
  companyId?: string | null;
  attendeeCount?: number | null;
}
interface ListResponse {
  ok?: boolean;
  events?: EventRow[];
}

export default function ScreeningRecaps() {
  const { activeChapter, isLoading: chLoading } = useActiveChapter();
  const chapterId = activeChapter?.id;

  const { data, isLoading, error } = useQuery<ListResponse>({
    queryKey: ["/api/collective/screening-events", "screening-recaps", chapterId ?? "none"],
    queryFn: async () =>
      (await apiRequest(
        "GET",
        `/api/collective/screening-events?chapter_id=${encodeURIComponent(chapterId!)}&status=completed`,
      )).json(),
    enabled: !!chapterId,
    staleTime: 30_000,
  });

  const closed = (data?.events ?? []).filter(
    (e) => e.status === "completed" || e.status === "closed",
  );
  const busy = chLoading || (isLoading && !!chapterId);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: "#1A1A2E" }} data-testid="heading-screening-recaps">
          Screening Recaps
        </h1>
        <p className="text-sm text-slate-500 mt-1">Closed screening events and their outcomes.</p>
      </div>

      {busy ? (
        <div className="space-y-3" data-testid="screening-recaps-loading">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700" data-testid="screening-recaps-error">
          Couldn't load screening recaps. Please refresh.
        </div>
      ) : !chapterId ? (
        <div className="text-center py-12 text-slate-500" data-testid="screening-recaps-empty">
          <p className="text-sm">Join a chapter to see screening recaps.</p>
        </div>
      ) : closed.length === 0 ? (
        <div className="text-center py-12 text-slate-500" data-testid="screening-recaps-empty">
          <ClipboardCheck className="h-8 w-8 mx-auto mb-2 text-slate-300" />
          <p className="text-sm">No closed screenings yet.</p>
        </div>
      ) : (
        <div className="space-y-3" data-testid="screening-recaps-list">
          {closed.map((e) => (
            <Card key={e.id} data-testid={`screening-recap-card-${e.id}`}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center justify-between" style={{ color: "#1A1A2E" }}>
                  <span>{e.title ?? "Screening event"}</span>
                  <Badge className="text-[10px] bg-emerald-100 text-emerald-700">closed</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4 text-xs text-slate-500">
                  {e.scheduledFor && <span>{new Date(e.scheduledFor * 1000).toLocaleString()}</span>}
                  {e.attendeeCount != null && <span>{e.attendeeCount} attendees</span>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
