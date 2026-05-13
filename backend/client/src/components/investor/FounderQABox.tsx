/**
 * Sprint 21 Wave B — B7: FounderQABox
 *
 * "Ask the founder" box displayed on the Overview tab.
 *
 * Fetches GET /api/rounds/:roundId/founder-qa (last 10 messages)
 * POST /api/rounds/:roundId/founder-qa to send a question.
 *
 * SSE auto-refresh: invalidated by commsThread aggregate events.
 * Optional "Make my question public" checkbox (default ON).
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageCircle, Send } from "lucide-react";
import { fmtDate } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";

interface QAMessage {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  authorRole: "founder" | "investor";
  body: string;
  publicWithinRound: boolean;
  createdAt: string;
}

interface QAResponse {
  roundId: string;
  messages: QAMessage[];
  channelId: string;
}

interface Props {
  roundId: string;
}

export default function FounderQABox({ roundId }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [questionBody, setQuestionBody] = useState("");
  const [makePublic, setMakePublic] = useState(true);

  const { data, isLoading } = useQuery<QAResponse>({
    queryKey: ["/api/rounds", roundId, "founder-qa"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/rounds/${roundId}/founder-qa`);
      if (!res.ok) return { roundId, messages: [], channelId: "" };
      return res.json();
    },
    enabled: !!roundId,
    // Refetch every 30s as a fallback (SSE handles real-time via commsThread aggregate)
    refetchInterval: 30_000,
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/rounds/${roundId}/founder-qa`, {
        body: questionBody.trim(),
        publicWithinRound: makePublic,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "send_failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Question sent to founder" });
      setQuestionBody("");
      // Invalidate to refresh the thread
      queryClient.invalidateQueries({ queryKey: ["/api/rounds", roundId, "founder-qa"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to send", description: err.message, variant: "destructive" });
    },
  });

  const handleSend = () => {
    if (!questionBody.trim()) {
      toast({ title: "Please type a question", variant: "destructive" });
      return;
    }
    sendMutation.mutate();
  };

  return (
    <Card data-testid="founder-qa-box">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-[hsl(184_98%_22%)]" />
          Ask the founder
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Message thread */}
        <div className="space-y-3 max-h-72 overflow-y-auto" data-testid="qa-thread">
          {isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-4/5" />
            </div>
          )}

          {!isLoading && (!data?.messages || data.messages.length === 0) && (
            <p className="text-sm text-muted-foreground py-4 text-center" data-testid="qa-empty-state">
              No questions yet. Start the conversation.
            </p>
          )}

          {!isLoading &&
            data?.messages?.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-3 ${msg.authorRole === "founder" ? "flex-row-reverse" : ""}`}
                data-testid={`qa-message-${msg.id}`}
              >
                {/* Avatar */}
                <div
                  className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${
                    msg.authorRole === "founder"
                      ? "bg-[hsl(184_98%_22%)] text-white"
                      : "bg-[hsl(219_45%_20%)] text-white"
                  }`}
                >
                  {msg.authorName
                    .split(" ")
                    .map((s) => s[0])
                    .slice(0, 2)
                    .join("")}
                </div>

                {/* Bubble */}
                <div
                  className={`flex-1 rounded-lg p-3 text-sm ${
                    msg.authorRole === "founder"
                      ? "bg-[hsl(184_98%_22%)]/10 border border-[hsl(184_98%_22%)]/20"
                      : "bg-secondary border border-border"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1 gap-2">
                    <span className="font-medium text-xs">{msg.authorName}</span>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {fmtDate(msg.createdAt)}
                    </span>
                  </div>
                  <p className="leading-relaxed">{msg.body}</p>
                  {!msg.publicWithinRound && (
                    <span className="mt-1 inline-block text-[10px] text-muted-foreground">
                      (Private — visible only to you and founder)
                    </span>
                  )}
                </div>
              </div>
            ))}
        </div>

        {/* Composer */}
        <div className="space-y-2 pt-2 border-t border-border">
          <Textarea
            rows={3}
            placeholder="Type your question for the founder…"
            value={questionBody}
            onChange={(e) => setQuestionBody(e.target.value)}
            maxLength={1000}
            data-testid="qa-input"
            className="resize-none"
          />
          <div className="text-right text-xs text-muted-foreground">
            {questionBody.length}/1000
          </div>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs cursor-pointer" data-testid="qa-public-label">
              <Checkbox
                checked={makePublic}
                onCheckedChange={(v) => setMakePublic(!!v)}
                data-testid="qa-public-checkbox"
              />
              <span className="text-muted-foreground">Make my question public to co-investors</span>
            </label>
            <Button
              size="sm"
              onClick={handleSend}
              disabled={sendMutation.isPending || !questionBody.trim()}
              className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white gap-2"
              data-testid="button-send-question"
            >
              <Send className="h-3.5 w-3.5" />
              Send question
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
