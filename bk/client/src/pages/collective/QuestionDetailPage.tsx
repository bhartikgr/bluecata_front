/**
 * v18 Phase C — Capavate Collective: Question detail.
 *
 * Responsibilities:
 *   - Render the question + all answers sorted (best-first, then upvotes
 *     desc, then ctime asc).
 *   - Post an answer (members + admins; asker is blocked by the server
 *     with cannot_answer_own_question).
 *   - Vote up/down on answers (disabled on own content).
 *   - "Accept best" (asker only) — server enforces ownership.
 *   - Show reputation badge next to every user name.
 *   - Hidden when COLLECTIVE_ENABLED feature flag is off.
 */

import { useEffect, useMemo, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCollectiveStream } from "@/lib/sseClient";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronUp,
  ChevronDown,
  CheckCircle2,
  Flag,
  ArrowLeft,
  Award,
} from "lucide-react";

interface FeatureFlagsResponse {
  COLLECTIVE_ENABLED?: boolean;
}

interface MeResponse {
  userId?: string;
  email?: string;
}

interface QuestionDTO {
  id: string;
  chapterId: string;
  askerUserId: string;
  /** CP Phase C — 'partner' when the asker has an active partner team
   *  membership; null otherwise. UI renders a 'Partner' badge. */
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

interface AnswerDTO {
  id: string;
  chapterId: string;
  questionId: string;
  responderUserId: string;
  /** CP Phase C — 'partner' when the responder has an active partner team
   *  membership; null otherwise. UI renders a 'Partner' badge. */
  responderUserRole?: "partner" | null;
  body: string;
  upvoteCount: number;
  isBestAnswer: boolean;
  status: "active" | "edited" | "deleted" | "flagged";
  createdAt: string;
  updatedAt: string;
}

/** CP Phase C — small inline badge for partner-authored Q&A entries. */
function PartnerBadge() {
  return (
    <span
      data-testid="badge-partner"
      className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200"
    >
      Partner
    </span>
  );
}

interface ReputationDTO {
  userId: string;
  chapterId: string;
  score: number;
  questionsAsked: number;
  answersGiven: number;
  bestAnswers: number;
  upvotesReceived: number;
}

interface QuestionDetailResponse {
  ok: boolean;
  question: QuestionDTO;
  answers: AnswerDTO[];
  askerReputation: ReputationDTO | null;
}

function ReputationBadge(props: { userId: string; chapterId: string }) {
  const { userId, chapterId } = props;
  const q = useQuery<{ ok: boolean; reputation: ReputationDTO }>({
    queryKey: ["/api/collective/reputation", userId, chapterId],
    queryFn: async () =>
      (
        await apiRequest(
          "GET",
          `/api/collective/reputation/${encodeURIComponent(userId)}?chapter_id=${encodeURIComponent(chapterId)}`,
        )
      ).json(),
  });
  const score = q.data?.reputation?.score ?? 0;
  return (
    <Badge
      variant="outline"
      className="text-xs"
      data-testid={`badge-reputation-${userId}`}
    >
      <Award className="h-3 w-3 mr-1" />
      {score}
    </Badge>
  );
}

export default function QuestionDetailPage(): JSX.Element | null {
  const [, params] = useRoute<{ id: string }>("/collective/ask/:id");
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [draftAnswer, setDraftAnswer] = useState("");

  const flagsQ = useQuery<FeatureFlagsResponse>({
    queryKey: ["/api/feature-flags"],
    queryFn: async () => (await apiRequest("GET", "/api/feature-flags")).json(),
  });
  const collectiveOn = flagsQ.data?.COLLECTIVE_ENABLED === true;

  const meQ = useQuery<MeResponse>({
    queryKey: ["/api/me"],
    queryFn: async () => (await apiRequest("GET", "/api/me")).json(),
    enabled: collectiveOn,
  });
  const myUserId = meQ.data?.userId ?? "";

  const id = params?.id ?? "";
  const detailQ = useQuery<QuestionDetailResponse>({
    queryKey: ["/api/collective/questions", id],
    queryFn: async () =>
      (await apiRequest("GET", `/api/collective/questions/${encodeURIComponent(id)}`)).json(),
    enabled: collectiveOn && id.length > 0,
  });

  // v18 Phase D — SSE realtime: subscribe to the question's chapter and
  // refresh on every Q&A frame. Polling remains as fallback.
  const questionChapterId = detailQ.data?.question?.chapterId ?? "";
  useCollectiveStream({
    chapterId: questionChapterId,
    topics: ["questions"],
    enabled: collectiveOn && !!questionChapterId,
    onMessage: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/collective/questions", id],
      });
    },
  });

  const answerMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/collective/questions/${encodeURIComponent(id)}/answers`,
        { body: draftAnswer.trim() },
      );
      return res.json();
    },
    onSuccess: () => {
      setDraftAnswer("");
      queryClient.invalidateQueries({
        queryKey: ["/api/collective/questions", id],
      });
    },
  });

  const voteMut = useMutation({
    mutationFn: async (args: { answerId: string; voteType: "up" | "down" }) => {
      const res = await apiRequest(
        "POST",
        `/api/collective/answers/${encodeURIComponent(args.answerId)}/vote`,
        { vote_type: args.voteType },
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/collective/questions", id],
      });
    },
  });

  const acceptMut = useMutation({
    mutationFn: async (answerId: string) => {
      const res = await apiRequest(
        "POST",
        `/api/collective/answers/${encodeURIComponent(answerId)}/accept-best`,
        {},
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/collective/questions", id],
      });
    },
  });

  const closeMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/collective/questions/${encodeURIComponent(id)}/close`,
        {},
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/collective/questions", id],
      });
    },
  });

  const isAsker = useMemo(
    () => detailQ.data?.question?.askerUserId === myUserId,
    [detailQ.data, myUserId],
  );

  if (!flagsQ.isLoading && !collectiveOn) {
    return null;
  }

  if (detailQ.isLoading) {
    return (
      <div className="container mx-auto p-6 max-w-3xl space-y-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const q = detailQ.data?.question;
  if (!q) {
    return (
      <div className="container mx-auto p-6 max-w-3xl">
        <p className="text-sm text-muted-foreground">Question not found.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-3xl">
      <Button
        variant="ghost"
        size="sm"
        className="mb-4"
        onClick={() => navigate("/collective/ask")}
        data-testid="button-back-to-list"
      >
        <ArrowLeft className="h-4 w-4 mr-1" /> Back
      </Button>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-2">
            {q.bestAnswerId ? (
              <CheckCircle2 className="h-5 w-5 text-green-600 mt-1 shrink-0" />
            ) : q.status === "flagged" ? (
              <Flag className="h-5 w-5 text-destructive mt-1 shrink-0" />
            ) : null}
            <CardTitle className="flex-1">{q.title}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 whitespace-pre-wrap">
          <div className="text-sm">{q.body}</div>
          <div className="flex flex-wrap gap-2 items-center text-xs text-muted-foreground">
            <span>Asked by {q.askerUserId}</span>
            {q.askerUserRole === "partner" && <PartnerBadge />}
            <ReputationBadge userId={q.askerUserId} chapterId={q.chapterId} />
            <Badge variant="outline">{q.status}</Badge>
            {q.tags.map((t) => (
              <Badge key={t} variant="secondary">
                {t}
              </Badge>
            ))}
            <span className="ml-auto">{q.viewCount} views</span>
          </div>
          {isAsker && q.status !== "closed" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => closeMut.mutate()}
              disabled={closeMut.isPending}
              data-testid="button-close-question"
            >
              {closeMut.isPending ? "Closing…" : "Close question"}
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {/* Answers */}
      <h2 className="text-lg font-semibold mt-6 mb-3">
        {detailQ.data?.answers?.length ?? 0} answers
      </h2>
      <div className="space-y-3">
        {detailQ.data?.answers?.map((a) => {
          const isOwn = a.responderUserId === myUserId;
          return (
            <Card
              key={a.id}
              className={a.isBestAnswer ? "border-green-600 border-2" : ""}
            >
              <CardContent className="p-4">
                <div className="flex gap-3">
                  <div className="flex flex-col items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={isOwn || voteMut.isPending}
                      onClick={() =>
                        voteMut.mutate({ answerId: a.id, voteType: "up" })
                      }
                      data-testid={`button-vote-up-${a.id}`}
                    >
                      <ChevronUp className="h-5 w-5" />
                    </Button>
                    <span
                      className="text-sm font-semibold"
                      data-testid={`text-upvote-count-${a.id}`}
                    >
                      {a.upvoteCount}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={isOwn || voteMut.isPending}
                      onClick={() =>
                        voteMut.mutate({ answerId: a.id, voteType: "down" })
                      }
                      data-testid={`button-vote-down-${a.id}`}
                    >
                      <ChevronDown className="h-5 w-5" />
                    </Button>
                  </div>
                  <div className="flex-1">
                    {a.isBestAnswer ? (
                      <Badge className="mb-2 bg-green-600">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Accepted best answer
                      </Badge>
                    ) : null}
                    <div className="text-sm whitespace-pre-wrap">{a.body}</div>
                    <div className="flex flex-wrap gap-2 items-center text-xs text-muted-foreground mt-2">
                      <span>{a.responderUserId}</span>
                      {a.responderUserRole === "partner" && <PartnerBadge />}
                      <ReputationBadge
                        userId={a.responderUserId}
                        chapterId={a.chapterId}
                      />
                      <Badge variant="outline">{a.status}</Badge>
                      {isAsker && !a.isBestAnswer && a.status === "active" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="ml-auto"
                          onClick={() => acceptMut.mutate(a.id)}
                          disabled={acceptMut.isPending}
                          data-testid={`button-accept-best-${a.id}`}
                        >
                          Accept as best
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Answer composer — server blocks asker self-answer + closed/flagged. */}
      {!isAsker && q.status !== "closed" && q.status !== "flagged" ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">Your answer</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Textarea
              rows={5}
              value={draftAnswer}
              onChange={(e) => setDraftAnswer(e.target.value.slice(0, 8000))}
              placeholder="Share what you know."
              data-testid="input-answer-body"
            />
            <Button
              onClick={() => answerMut.mutate()}
              disabled={answerMut.isPending || draftAnswer.trim().length === 0}
              data-testid="button-submit-answer"
            >
              {answerMut.isPending ? "Posting…" : "Post answer"}
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
