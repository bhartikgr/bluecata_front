/**
 * v25.44 Surface 4 — /collective/presentations full page.
 * Lists past/present/future presentations for the active chapter.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Presentation } from "lucide-react";
import { useActiveChapter } from "@/components/collective/widgets/useActiveChapter";

interface Meeting {
  date: string;
  location: string;
  confirmedPresenters: Array<{ companyId: string; companyName: string; sector: string | null }>;
}
interface PresentationsResponse {
  nextMeeting: Meeting | null;
  upcoming: Meeting[];
}

export default function PresentationsPage() {
  const { activeChapter, isLoading: chLoading } = useActiveChapter();
  const chapterId = activeChapter?.id;
  const q = useQuery<PresentationsResponse>({
    queryKey: ["/api/collective/chapters", chapterId ?? "none", "presentations-page"],
    queryFn: async () =>
      (await apiRequest("GET", `/api/collective/chapters/${encodeURIComponent(chapterId!)}/presentations`)).json(),
    enabled: !!chapterId,
    staleTime: 30_000,
  });
  const meetings = q.data ? [q.data.nextMeeting, ...q.data.upcoming].filter(Boolean) as Meeting[] : [];
  const busy = chLoading || (q.isLoading && !!chapterId);

  return (
    <div className="p-6 max-w-4xl mx-auto" data-testid="page-presentations">
      <div className="flex items-center gap-2 mb-6">
        <Presentation className="h-6 w-6 text-[#cc0001]" />
        <h1 className="text-2xl font-semibold" style={{ color: "#041e41" }}>Presentations</h1>
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-slate-500">{activeChapter?.name ?? "Your chapter"}</CardTitle>
        </CardHeader>
        <CardContent>
          {busy ? (
            <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : q.error ? (
            <div className="text-sm text-red-700">Couldn't load presentations.</div>
          ) : meetings.length === 0 ? (
            <div className="text-center py-10 text-slate-500" data-testid="page-presentations-empty">
              <p className="text-sm">No presentations scheduled for your chapter.</p>
            </div>
          ) : (
            <div className="space-y-2" data-testid="page-presentations-list">
              {meetings.map((m, idx) => (
                <div key={idx} className="py-3 px-3 rounded-md bg-slate-50">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700">
                      {m.confirmedPresenters[0]?.companyName ?? "Presentation"}
                    </span>
                    <span className="text-xs text-slate-400">{new Date(m.date).toLocaleString()}</span>
                  </div>
                  <p className="text-xs text-slate-400">{m.location}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
