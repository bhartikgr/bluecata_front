/**
 * v25.44 Surface 4 — Presentations · my chapter widget.
 * Reads GET /api/collective/chapters/:chapterId/presentations for the active
 * chapter. Shows next meeting + up to 3 upcoming. Link to /collective/presentations.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Presentation } from "lucide-react";
import { useActiveChapter } from "./useActiveChapter";

interface Meeting {
  date: string;
  location: string;
  confirmedPresenters: Array<{ companyId: string; companyName: string; sector: string | null }>;
  invitedFounders: Array<{ userId: string; name: string; status: string }>;
}
interface PresentationsResponse {
  nextMeeting: Meeting | null;
  upcoming: Meeting[];
}

export function PresentationsCard() {
  const { activeChapter, isLoading: chLoading } = useActiveChapter();
  const chapterId = activeChapter?.id;

  const q = useQuery<PresentationsResponse>({
    queryKey: ["/api/collective/chapters", chapterId ?? "none", "presentations"],
    queryFn: async () =>
      (await apiRequest("GET", `/api/collective/chapters/${encodeURIComponent(chapterId!)}/presentations`)).json(),
    enabled: !!chapterId,
    staleTime: 30_000,
  });

  const busy = chLoading || (q.isLoading && !!chapterId);
  const meetings = q.data ? [q.data.nextMeeting, ...q.data.upcoming].filter(Boolean) as Meeting[] : [];

  return (
    <Card data-testid="widget-presentations">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2" style={{ color: "#1A1A2E" }}>
          <Presentation className="h-4 w-4 text-[#cc0001]" />
          Presentations · My Chapter
        </CardTitle>
      </CardHeader>
      <CardContent>
        {busy ? (
          <div className="space-y-2" data-testid="widget-presentations-loading">
            {[...Array(2)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : q.error ? (
          <div className="text-sm text-red-700" data-testid="widget-presentations-error">
            Couldn't load presentations.
          </div>
        ) : meetings.length === 0 ? (
          <div className="text-center py-6 text-slate-500" data-testid="widget-presentations-empty">
            <p className="text-sm">No upcoming presentations for your chapter.</p>
          </div>
        ) : (
          <div className="space-y-2" data-testid="widget-presentations-list">
            {meetings.map((m, idx) => (
              <div key={idx} className="py-2 px-3 rounded-md bg-slate-50" data-testid={`widget-presentations-row-${idx}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-700">
                    {m.confirmedPresenters[0]?.companyName ?? "Presentation"}
                  </span>
                  <span className="text-[11px] text-slate-400">{new Date(m.date).toLocaleDateString()}</span>
                </div>
                <p className="text-[11px] text-slate-400">{m.location}</p>
              </div>
            ))}
            <Link href="/collective/presentations">
              <a className="block text-xs text-[#cc0001] hover:underline pt-1" data-testid="widget-presentations-viewall">
                View all presentations
              </a>
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default PresentationsCard;
