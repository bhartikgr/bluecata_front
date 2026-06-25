/**
 * Sprint 18 Phase 3 — E4 Post Detail page.
 *
 * Routes:
 *   /founder/posts/:id  -> founder shell
 *   /investor/posts/:id -> investor shell
 *
 * Renders:
 *   - Post header (author, time, visibility chip)
 *   - Full body
 *   - Reaction strip (likes / shares / follow if company author)
 *   - Reaction history list (who liked the post — anonymous-aware)
 *   - Comment thread (chronological) + nested one-level replies
 *   - Reply composer
 *
 * The page reads /api/comms/posts/:id with the existing `apiRequest` helper so it
 * works both locally and through the deploy proxy port-rewrite.
 */
import { asArray } from "@/lib/safeArray";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEntitlement } from "@/lib/entitlement";
import { useToast } from "@/hooks/use-toast";
import { Link, useRoute } from "wouter";
import {
  ArrowLeft, Heart, MessageCircle, Share2, Globe2, UserCircle2, Sparkles,
  CornerDownRight, Send, Lock, BadgeCheck, MapPin, Users2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { timeAgo } from "@/lib/format";

interface PostView {
  id: string;
  channelId: string;
  authorUserId: string;
  authorKind: "user" | "company";
  body: string;
  createdAt: string;
  visibility: "network" | "followers" | "public_to_collective" | "cap_table";
  likedByUserIds: string[];
  commentCount: number;
  comments: Array<{ id: string; userId: string; body: string; createdAt: string }>;
  shareCount: number;
  authorLabel: string;
  authorRoleBadge: string;
  authorLocation: string;
  authorCapavateAngelNetwork: boolean;
  isAnonymous: boolean;
}

interface CommentResolved {
  id: string; userId: string; body: string; createdAt: string;
  authorLabel: string; isAnonymous: boolean;
  parentCommentId?: string;
}

export default function PostDetail({ role }: { role: "founder" | "investor" }) {
  const [, params] = useRoute(`/${role}/posts/:id`);
  const postId = params?.id ?? "";
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const { toast } = useToast();
  // Wave 2: meId fix — use entitlement context as primary source, not hardcoded fallback
  // Note: meId from me.data is used directly (Wave 1 owns the entCtx meId fix)
  // DEF-016: h1 is added to the page so there is always an accessible heading

  const detailQ = useQuery<{
    post: PostView;
    comments: CommentResolved[];
    reactionHistory: Array<{ userId: string; label: string; isAnonymous: boolean }>;
  }>({
    queryKey: ["/api/comms/posts", postId],
    queryFn: async () => (await apiRequest("GET", `/api/comms/posts/${encodeURIComponent(postId)}`)).json(),
    enabled: !!postId,
  });

  const me = useQuery<{ id: string; legalName: string }>({ queryKey: ["/api/comms/me"] });
  // Sprint 22 Wave 1 — DEF-005 fix: use entitlement context as primary source; block actions until identity confirmed.
  const { data: entCtx } = useEntitlement();
  const meId = entCtx?.userId ?? me.data?.id;

  const post = detailQ.data?.post;
  const comments = useMemo(() => asArray(detailQ.data?.comments), [detailQ.data]);
  const reactionHistory = useMemo(() => asArray(detailQ.data?.reactionHistory), [detailQ.data]);

  // Group comments into top-level + child replies (one level only).
  const tree = useMemo(() => {
    const top: CommentResolved[] = [];
    const children: Record<string, CommentResolved[]> = {};
    for (const c of comments) {
      if (c.parentCommentId) {
        (children[c.parentCommentId] ||= []).push(c);
      } else {
        top.push(c);
      }
    }
    return { top, children };
  }, [comments]);

  const liked = !!post?.likedByUserIds?.includes(meId);

  const like = useMutation({
    // Optimistic UI — E5: don't wait for server roundtrip for the heart fill.
    mutationFn: async (on: boolean) =>
      apiRequest(on ? "POST" : "DELETE", `/api/comms/posts/${encodeURIComponent(postId)}/like`),
    onMutate: async (on: boolean) => {
      await queryClient.cancelQueries({ queryKey: ["/api/comms/posts", postId] });
      const prev = queryClient.getQueryData<typeof detailQ.data>(["/api/comms/posts", postId]);
      if (prev?.post) {
        const liked = prev.post.likedByUserIds.includes(meId);
        const next = {
          ...prev,
          post: {
            ...prev.post,
            likedByUserIds: on
              ? (liked ? prev.post.likedByUserIds : [...prev.post.likedByUserIds, meId])
              : prev.post.likedByUserIds.filter((u) => u !== meId),
          },
        };
        queryClient.setQueryData(["/api/comms/posts", postId], next);
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["/api/comms/posts", postId], ctx.prev);
    },
    onSettled: () => {
      // Sprint 19 G — update both detail cache and feed cache.
      queryClient.invalidateQueries({ queryKey: ["/api/comms/posts", postId] });
      queryClient.invalidateQueries({ queryKey: ["/api/comms/posts"] });
    },
  });

  const comment = useMutation({
    mutationFn: async () => {
      if (!draft.trim()) return;
      await apiRequest("POST", `/api/comms/posts/${encodeURIComponent(postId)}/comments`, {
        body: draft.trim(),
        parentCommentId: replyTo ?? undefined,
      });
    },
    onSuccess: () => {
      setDraft("");
      setReplyTo(null);
      queryClient.invalidateQueries({ queryKey: ["/api/comms/posts", postId] });
    },
  });

  const share = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/comms/posts/${encodeURIComponent(postId)}/share`),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["/api/comms/posts", postId] });
      // Sprint 22 Wave 1 — DEF-008 fix: copy post URL to clipboard after share.
      const url = `${window.location.origin}/#/${role}/posts/${postId}`;
      try {
        if (typeof navigator?.share === "function") {
          await navigator.share({ title: "Post", url });
        } else if (typeof navigator?.clipboard?.writeText === "function") {
          await navigator.clipboard.writeText(url);
          toast({ title: "Link copied", description: "Post URL copied to your clipboard." });
        } else {
          toast({ title: "Share", description: `Copy this URL: ${url}` });
        }
      } catch {
        // Clipboard access may be blocked in some sandbox environments
        toast({ title: "Could not copy", description: `Press ⌘+C to copy this URL: ${url}` });
      }
    },
  });

  // Derive page title from loaded post or fallback
  const pageTitle = post
    ? `${post.authorLabel}'s post`
    : postId
    ? "Post detail"
    : "Post detail";

  return (
    <div className="container mx-auto px-6 py-8 max-w-3xl" data-testid="page-post-detail">
      {/* DEF-016 / Wave 2: accessible h1 + breadcrumb */}
      <h1 className="sr-only">{pageTitle}</h1>
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
        {/* Sprint 19 G — role-aware nav: investor gets /investor/network-posts if available, else dashboard. */}
        <Link href={role === "founder" ? "/founder/network-posts" : "/investor/network-posts"}>
          <Button variant="ghost" size="sm" className="-ml-2 h-7 text-xs" data-testid="link-back-network-posts">
            <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Network Posts
          </Button>
        </Link>
        <span className="text-muted-foreground/60">/</span>
        <span className="truncate max-w-xs">{pageTitle}</span>
      </div>

      {detailQ.isLoading && <Skeleton className="h-48 w-full" data-testid="loading-post" />}

      {!detailQ.isLoading && !post && (
        <Card><CardContent className="p-6 text-sm text-muted-foreground" data-testid="empty-post">
          That post is no longer available, or you do not have visibility into it.
        </CardContent></Card>
      )}

      {post && (
        <Card data-testid={`post-detail-${post.id}`}>
          <CardContent className="p-5 space-y-4">
            {/* Header */}
            <div className="flex items-start gap-3">
              <Avatar className="h-12 w-12 shrink-0">
                <AvatarFallback className={`text-xs ${post.isAnonymous ? "bg-muted text-muted-foreground" : "bg-secondary"}`}>
                  {post.isAnonymous ? <Lock className="h-4 w-4" /> : initials(post.authorLabel)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-base font-semibold ${post.isAnonymous ? "italic text-muted-foreground" : ""}`}>
                    {post.authorLabel}
                  </span>
                  {post.authorCapavateAngelNetwork && (
                    <Badge className="h-4 px-1.5 text-[10px] bg-amber-500/15 text-amber-700 border border-amber-500/30 inline-flex items-center gap-1">
                      <BadgeCheck className="h-3 w-3" /> Capavate Angel Network
                    </Badge>
                  )}
                  <span className="text-[10px] inline-flex items-center gap-1 px-1.5 h-4 rounded-full bg-secondary text-muted-foreground">
                    {post.authorRoleBadge}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                  {post.authorLocation && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> {post.authorLocation}
                    </span>
                  )}
                  <span>·</span>
                  <span>{timeAgo(post.createdAt)}</span>
                  <span>·</span>
                  <VisibilityChip v={post.visibility} />
                </div>
              </div>
            </div>

            {/* Full body */}
            <div className="text-sm leading-relaxed whitespace-pre-wrap" data-testid="post-detail-body">
              {post.body}
            </div>

            {/* Reaction strip */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground border-t border-border pt-3">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => like.mutate(!liked)}
                    data-testid={`button-like-detail-${post.id}`}
                    className={`inline-flex items-center gap-1.5 px-2 h-7 rounded-md hover-elevate disabled:opacity-50 ${liked ? "text-rose-500" : ""}`}
                    disabled={!meId}
                  >
                    <Heart className={`h-3.5 w-3.5 ${liked ? "fill-current" : ""}`} />
                    <span>{post.likedByUserIds.length}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {reactionHistory.length === 0
                    ? "Be the first to like this post"
                    : `Liked by ${reactionHistory.map((r) => r.label).slice(0, 5).join(", ")}${reactionHistory.length > 5 ? ` +${reactionHistory.length - 5}` : ""}`}
                </TooltipContent>
              </Tooltip>
              <span className="inline-flex items-center gap-1.5 px-2 h-7 rounded-md">
                <MessageCircle className="h-3.5 w-3.5" /> {post.commentCount}
              </span>
              <button
                onClick={() => share.mutate()}
                data-testid={`button-share-detail-${post.id}`}
                className="inline-flex items-center gap-1.5 px-2 h-7 rounded-md hover-elevate disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={!meId || share.isPending}
              >
                <Share2 className="h-3.5 w-3.5" /> {post.shareCount}
              </button>
            </div>

            {/* Reaction history strip — E5 polish */}
            {reactionHistory.length > 0 && (
              <div className="text-[11px] text-muted-foreground" data-testid="reaction-history">
                <span className="inline-flex items-center gap-1 font-medium">
                  <Users2 className="h-3 w-3" /> Liked by
                </span>{" "}
                {reactionHistory.slice(0, 8).map((r, i) => (
                  <span key={r.userId}>
                    {i > 0 ? ", " : " "}
                    <span className={r.isAnonymous ? "italic" : ""}>{r.label}</span>
                  </span>
                ))}
                {reactionHistory.length > 8 && <span> + {reactionHistory.length - 8} more</span>}
              </div>
            )}

            {/* Comment thread */}
            <div className="border-t border-border pt-4 space-y-3" data-testid="comment-thread">
              <div className="text-xs font-medium text-muted-foreground">Comments</div>
              {tree.top.length === 0 && (
                <div className="text-xs text-muted-foreground">No comments yet — be the first to reply.</div>
              )}
              {tree.top.map((c) => (
                <div key={c.id} className="text-xs space-y-1.5" data-testid={`comment-${c.id}`}>
                  <div className="flex items-start gap-2">
                    <Avatar className="h-7 w-7 shrink-0">
                      <AvatarFallback className={`text-[10px] ${c.isAnonymous ? "bg-muted text-muted-foreground" : "bg-secondary"}`}>
                        {c.isAnonymous ? <Lock className="h-3 w-3" /> : initials(c.authorLabel)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`font-medium ${c.isAnonymous ? "italic text-muted-foreground" : ""}`}>{c.authorLabel}</span>
                        <span className="text-[10px] text-muted-foreground">{timeAgo(c.createdAt)}</span>
                      </div>
                      <div className="text-muted-foreground">{c.body}</div>
                      <button
                        onClick={() => setReplyTo(c.id)}
                        className="text-[10px] inline-flex items-center gap-1 text-[hsl(0_100%_40%)] hover:underline mt-0.5"
                        data-testid={`button-reply-${c.id}`}
                      >
                        <CornerDownRight className="h-2.5 w-2.5" /> Reply
                      </button>
                    </div>
                  </div>

                  {(tree.children[c.id] ?? []).map((child) => (
                    <div key={child.id} className="flex items-start gap-2 pl-9" data-testid={`comment-reply-${child.id}`}>
                      <Avatar className="h-6 w-6 shrink-0">
                        <AvatarFallback className={`text-[10px] ${child.isAnonymous ? "bg-muted text-muted-foreground" : "bg-secondary"}`}>
                          {child.isAnonymous ? <Lock className="h-3 w-3" /> : initials(child.authorLabel)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`font-medium ${child.isAnonymous ? "italic text-muted-foreground" : ""}`}>{child.authorLabel}</span>
                          <span className="text-[10px] text-muted-foreground">{timeAgo(child.createdAt)}</span>
                        </div>
                        <div className="text-muted-foreground">{child.body}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {/* Reply composer */}
            <div className="border-t border-border pt-3 space-y-2">
              {replyTo && (
                <div className="text-[11px] flex items-center gap-2 px-2 py-1.5 rounded bg-muted">
                  <CornerDownRight className="h-3 w-3" /> Replying to a comment
                  <button
                    onClick={() => setReplyTo(null)}
                    className="ml-auto text-muted-foreground hover-elevate px-1"
                    data-testid="button-cancel-reply-comment"
                  >×</button>
                </div>
              )}
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Add a comment…"
                rows={2}
                className="resize-none text-sm"
                data-testid="input-comment-detail"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    if (draft.trim()) comment.mutate();
                  }
                }}
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => comment.mutate()}
                  disabled={!draft.trim() || comment.isPending}
                  className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white"
                  data-testid="button-comment-submit-detail"
                >
                  <Send className="h-3.5 w-3.5 mr-1.5" /> Comment
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function initials(label: string): string {
  return label
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";
}

function VisibilityChip({ v }: { v: PostView["visibility"] }) {
  // Defects 65 & 87: add "cap_table" so the map is exhaustive and never crashes.
  const map: Record<PostView["visibility"], { label: string; icon: typeof Globe2; color?: string }> = {
    network: { label: "Network", icon: Globe2 },
    followers: { label: "Followers", icon: UserCircle2 },
    public_to_collective: { label: "Collective", icon: Sparkles },
    cap_table: { label: "Cap-table only", icon: Lock, color: "text-amber-600" },
  };
  const m = map[v] ?? { label: v, icon: Globe2 };
  const Icon = m.icon;
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className="h-3 w-3" /> {m.label}
    </span>
  );
}
