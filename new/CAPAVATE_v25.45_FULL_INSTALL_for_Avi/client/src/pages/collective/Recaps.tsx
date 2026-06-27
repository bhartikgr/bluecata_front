/**
 * v25.42 R2 — /collective/recaps
 *
 * Reads chapter announcements for the active chapter and filters to recaps
 * client-side (category/priority === "recap" or title prefixed "Recap").
 * Uses the existing GET /api/collective/announcements?chapter_id=... endpoint;
 * no new endpoint. Loading / error / empty states handled.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText } from "lucide-react";
import { useActiveChapter } from "@/components/collective/widgets/useActiveChapter";

interface Announcement {
  id: string;
  title?: string;
  body?: string;
  category?: string;
  createdAt?: string;
}
interface AnnouncementsResponse {
  ok?: boolean;
  announcements?: Announcement[];
}

function isRecap(a: Announcement): boolean {
  const cat = (a.category ?? "").toLowerCase();
  const title = (a.title ?? "").toLowerCase();
  return cat === "recap" || title.startsWith("recap");
}

export default function Recaps() {
  const { activeChapter, isLoading: chLoading } = useActiveChapter();
  const chapterId = activeChapter?.id;

  const { data, isLoading, error } = useQuery<AnnouncementsResponse>({
    queryKey: ["/api/collective/announcements", "recaps", chapterId ?? "none"],
    queryFn: async () =>
      (await apiRequest(
        "GET",
        `/api/collective/announcements?chapter_id=${encodeURIComponent(chapterId!)}&filter=recap`,
      )).json(),
    enabled: !!chapterId,
    staleTime: 30_000,
  });

  const recaps = (data?.announcements ?? []).filter(isRecap);
  const busy = chLoading || (isLoading && !!chapterId);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: "#1A1A2E" }} data-testid="heading-recaps">
          Recaps
        </h1>
        <p className="text-sm text-slate-500 mt-1">Chapter meeting and event recaps.</p>
      </div>

      {busy ? (
        <div className="space-y-3" data-testid="recaps-loading">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700" data-testid="recaps-error">
          Couldn't load recaps. Please refresh.
        </div>
      ) : !chapterId ? (
        <div className="text-center py-12 text-slate-500" data-testid="recaps-empty">
          <p className="text-sm">Join a chapter to see recaps.</p>
        </div>
      ) : recaps.length === 0 ? (
        <div className="text-center py-12 text-slate-500" data-testid="recaps-empty">
          <FileText className="h-8 w-8 mx-auto mb-2 text-slate-300" />
          <p className="text-sm">No recaps yet.</p>
        </div>
      ) : (
        <div className="space-y-3" data-testid="recaps-list">
          {recaps.map((r) => (
            <Card key={r.id} data-testid={`recap-card-${r.id}`}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold" style={{ color: "#1A1A2E" }}>
                  {r.title ?? "Recap"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-600 whitespace-pre-wrap">{r.body ?? ""}</p>
                {r.createdAt && (
                  <p className="text-[11px] text-slate-400 mt-2">
                    {new Date(r.createdAt).toLocaleString()}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
