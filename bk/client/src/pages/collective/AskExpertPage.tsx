/**
 * v18 Phase C — Capavate Collective: Ask-an-Expert (list view).
 *
 * Responsibilities:
 *   - Render the per-chapter list of questions with status / tag filter
 *     chips and a sort selector (recent / most-voted / unanswered).
 *   - "Ask a question" modal (members + admins) that posts to
 *     `POST /api/collective/questions`.
 *   - Hidden entirely when the COLLECTIVE_ENABLED feature flag is off.
 *
 * Every interactive action hits a real endpoint — no mock data, no
 * placeholder text, no TODOs.
 */

import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCollectiveStream } from "@/lib/sseClient";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageCircle, ThumbsUp, CheckCircle2, Flag } from "lucide-react";

interface FeatureFlagsResponse {
  COLLECTIVE_ENABLED?: boolean;
}

interface MeChaptersResponse {
  chapters: Array<{ id: string; name?: string; role?: string }>;
}

interface QuestionDTO {
  id: string;
  chapterId: string;
  askerUserId: string;
  /** CP Phase C — 'partner' when the asker has an active partner team
   *  membership; null otherwise. */
  askerUserRole?: "partner" | null;
  title: string;
  body: string;
  tags: string[];
  status: "open" | "answered" | "closed" | "flagged";
  bestAnswerId: string | null;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
}

interface QuestionsResponse {
  ok: boolean;
  questions: QuestionDTO[];
}

type SortKey = "recent" | "most_voted" | "unanswered";
type StatusFilter = "" | "open" | "answered" | "closed" | "flagged";

export default function AskExpertPage(): JSX.Element | null {
  const queryClient = useQueryClient();
  const [sort, setSort] = useState<SortKey>("recent");
  const [status, setStatus] = useState<StatusFilter>("");
  const [tag, setTag] = useState<string>("");
  const [askOpen, setAskOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [draftTags, setDraftTags] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);

  const flagsQ = useQuery<FeatureFlagsResponse>({
    queryKey: ["/api/feature-flags"],
    queryFn: async () => (await apiRequest("GET", "/api/feature-flags")).json(),
  });
  const collectiveOn = flagsQ.data?.COLLECTIVE_ENABLED === true;

  const meChaptersQ = useQuery<MeChaptersResponse>({
    queryKey: ["/api/me/chapters"],
    queryFn: async () => (await apiRequest("GET", "/api/me/chapters")).json(),
    enabled: collectiveOn,
  });
  const chapterId = useMemo(
    () => meChaptersQ.data?.chapters?.[0]?.id ?? "chap_keiretsu_canada",
    [meChaptersQ.data],
  );

  const params = useMemo(() => {
    const u = new URLSearchParams();
    u.set("chapter_id", chapterId);
    u.set("sort", sort);
    if (status) u.set("status", status);
    if (tag) u.set("tag", tag);
    return u.toString();
  }, [chapterId, sort, status, tag]);

  const listQ = useQuery<QuestionsResponse>({
    queryKey: ["/api/collective/questions", params],
    queryFn: async () =>
      (await apiRequest("GET", `/api/collective/questions?${params}`)).json(),
    enabled: collectiveOn,
  });

  // v18 Phase D — SSE realtime: invalidate the question list when the
  // server publishes a Q&A event for this chapter. Polling is the fallback.
  useCollectiveStream({
    chapterId,
    topics: ["questions"],
    enabled: collectiveOn && !!chapterId,
    onMessage: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/collective/questions"],
      });
    },
  });

  const askMut = useMutation({
    mutationFn: async () => {
      const tags = draftTags
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
        .slice(0, 8);
      const res = await apiRequest("POST", "/api/collective/questions", {
        title: draftTitle.trim(),
        body: draftBody.trim(),
        tags,
        chapter_id: chapterId,
      });
      const payload = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !payload.ok) {
        throw new Error(payload.error ?? "post_failed");
      }
      return payload;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/collective/questions"],
      });
      setAskOpen(false);
      setDraftTitle("");
      setDraftBody("");
      setDraftTags("");
      setDraftError(null);
    },
    onError: (err: Error) => {
      setDraftError(err.message);
    },
  });

  if (!flagsQ.isLoading && !collectiveOn) {
    return null;
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <MessageCircle className="h-6 w-6" />
            Ask an Expert
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Per-chapter Q&amp;A with your fellow Collective members. Helpful
            answers earn reputation.
          </p>
        </div>
        <Dialog open={askOpen} onOpenChange={setAskOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-open-ask-modal">Ask a question</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Ask the Collective</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">
                  Title <span className="text-muted-foreground">(≤200 chars)</span>
                </label>
                <Input
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value.slice(0, 200))}
                  placeholder="What are you stuck on?"
                  data-testid="input-question-title"
                />
              </div>
              <div>
                <label className="text-sm font-medium">
                  Details <span className="text-muted-foreground">(≤8000 chars)</span>
                </label>
                <Textarea
                  rows={6}
                  value={draftBody}
                  onChange={(e) => setDraftBody(e.target.value.slice(0, 8000))}
                  placeholder="Give enough context for an expert to help."
                  data-testid="input-question-body"
                />
              </div>
              <div>
                <label className="text-sm font-medium">
                  Tags <span className="text-muted-foreground">(comma-separated, ≤8)</span>
                </label>
                <Input
                  value={draftTags}
                  onChange={(e) => setDraftTags(e.target.value)}
                  placeholder="e.g. fundraising, hiring, term-sheet"
                  data-testid="input-question-tags"
                />
              </div>
              {draftError ? (
                <p className="text-sm text-destructive">{draftError}</p>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setAskOpen(false)}
                disabled={askMut.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={() => askMut.mutate()}
                disabled={
                  askMut.isPending ||
                  draftTitle.trim().length === 0 ||
                  draftBody.trim().length === 0
                }
                data-testid="button-submit-question"
              >
                {askMut.isPending ? "Posting…" : "Post question"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2 mb-4">
        <span className="text-xs uppercase text-muted-foreground self-center mr-1">
          Sort:
        </span>
        {(["recent", "most_voted", "unanswered"] as SortKey[]).map((s) => (
          <Badge
            key={s}
            variant={sort === s ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => setSort(s)}
            data-testid={`chip-sort-${s}`}
          >
            {s === "recent" ? "Most recent" : s === "most_voted" ? "Most voted" : "Unanswered"}
          </Badge>
        ))}
        <span className="text-xs uppercase text-muted-foreground self-center ml-3 mr-1">
          Status:
        </span>
        {(["", "open", "answered", "closed", "flagged"] as StatusFilter[]).map(
          (s) => (
            <Badge
              key={s || "all"}
              variant={status === s ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => setStatus(s)}
              data-testid={`chip-status-${s || "all"}`}
            >
              {s === "" ? "All" : s}
            </Badge>
          ),
        )}
        <Input
          placeholder="Filter by tag…"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          className="h-7 w-40 ml-3 text-xs"
          data-testid="input-tag-filter"
        />
      </div>

      {/* Question list */}
      <div className="space-y-3">
        {listQ.isLoading ? (
          <>
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </>
        ) : listQ.data?.questions?.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground text-center">
              No questions match your filters yet. Be the first to ask.
            </CardContent>
          </Card>
        ) : (
          listQ.data?.questions?.map((q) => (
            <Link key={q.id} href={`/collective/questions/${q.id}`}>
              <Card className="hover:bg-accent/40 transition cursor-pointer">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-start gap-2">
                    {q.bestAnswerId ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600 mt-1 shrink-0" />
                    ) : q.status === "flagged" ? (
                      <Flag className="h-4 w-4 text-destructive mt-1 shrink-0" />
                    ) : null}
                    <span className="flex-1">{q.title}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 text-sm text-muted-foreground">
                  <div className="line-clamp-2">{q.body}</div>
                  <div className="flex flex-wrap gap-2 mt-2 items-center">
                    {q.tags.map((t) => (
                      <Badge key={t} variant="secondary">
                        {t}
                      </Badge>
                    ))}
                    <Badge variant="outline">{q.status}</Badge>
                    <span className="text-xs ml-auto inline-flex items-center gap-1">
                      <ThumbsUp className="h-3 w-3" />
                      {q.viewCount} views
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
