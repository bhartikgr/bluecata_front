/**
 * v25.42 (Bucket A/B) — shared active-chapter hook.
 *
 * Mirrors the chapter-resolution pattern already used by
 * ScreeningEventsPage.tsx: read GET /api/me/chapters (active memberships
 * only — the server filters status="active") and pick the first chapter.
 * Endpoints like /api/collective/screening-events and
 * /api/collective/announcements require a chapter_id query param.
 *
 * Purely DB-backed (the endpoint reads chapter_memberships); no in-memory
 * state of our own.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export interface MeChapter {
  id: string;
  name?: string;
  role?: string;
}

interface MeChaptersResponse {
  ok?: boolean;
  chapters?: MeChapter[];
}

export function useActiveChapter() {
  const q = useQuery<MeChaptersResponse>({
    queryKey: ["/api/me/chapters"],
    queryFn: async () => {
      try {
        return await (await apiRequest("GET", "/api/me/chapters")).json();
      } catch {
        // Fail closed — COLLECTIVE_ENABLED=0 makes the endpoint 503.
        return { ok: false, chapters: [] };
      }
    },
    retry: false,
    staleTime: 30_000,
  });
  const chapters = Array.isArray(q.data?.chapters) ? q.data!.chapters! : [];
  return {
    activeChapter: chapters[0],
    chapters,
    isLoading: q.isLoading,
    error: q.error,
  };
}
