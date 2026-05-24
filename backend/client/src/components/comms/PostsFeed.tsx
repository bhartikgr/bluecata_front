import { asArray } from "@/lib/safeArray";
/**
 * Sprint 9 — Posts feed widget (network + company-followers).
 * Sprint 19 F — hash sniffing removed, cap-table visibility, copy link,
 *               edit/delete own posts, @mention + #hashtag rendering,
 *               scheduled posts via scheduledFor param, server-side draft save.
 */

import { useMemo, useState } from "react";
import { useLocation, Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { hasCapTable, useEntitlement } from "@/lib/entitlement";
import {
 RefreshCw, Heart, MessageCircle, Share2, MoreHorizontal,
 Globe2, UserCircle2, BadgeCheck, Sparkles, Send, MapPin, Lock,
 Eye, Save, Pencil, Trash2, Pin,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
 DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
 DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { timeAgo } from "@/lib/format";
import { ANONYMOUS_LABEL } from "@/lib/comms/visibility";

type PostView = {
 id: string;
 channelId: string;
 authorUserId: string;
 authorKind: "user" | "company";
 body: string;
 createdAt: string;
 editedAt?: string;
 deletedAt?: string;
 visibility: "network" | "followers" | "public_to_collective" | "cap_table";
 likedByUserIds: string[];
 commentCount: number;
 comments: Array<{ id: string; userId: string; body: string; createdAt: string; authorLabel?: string }>;
 shareCount: number;
 followingCompanyIds?: string[];
 authorLabel: string;
 authorRoleBadge: string;
 authorLocation: string;
 authorCapavateAngelNetwork: boolean;
 isAnonymous: boolean;
};

type Sort = "newest" | "featured" | "following";

export function PostsFeed({
 role,
 maxPosts,
 viewAllHref,
 onLoadMore,
 showLoadMore,
 topicFilter,
 authorFilter,
}: {
 role: "founder" | "investor";
 /** Sprint 18 Phase 2 — limit feed to N posts (e.g. dashboard widget). */
 maxPosts?: number;
 /** Sprint 18 Phase 2 — "View all" link target when capped. */
 viewAllHref?: string;
 /** Sprint 18 Phase 3 B4 — Load-more handler used by NetworkPosts. */
 onLoadMore?: () => void;
 /** Sprint 18 Phase 3 B4 — show the load-more button below the feed. */
 showLoadMore?: boolean;
 /** Sprint 23 Wave B — DEF-033: topic filter from NetworkPosts (e.g. "#dealflow"). */
 topicFilter?: string;
 /** Sprint 23 Wave B — DEF-034: author-kind filter from NetworkPosts ("founders"|"investors"|"collective"|"all"). */
 authorFilter?: string;
}) {
 const { toast } = useToast();
 const [, navigate] = useLocation();
 const [draft, setDraft] = useState("");
 const [visibility, setVisibility] = useState<"network" | "followers" | "both" | "cap_table">("network");
 const [sort, setSort] = useState<Sort>("newest");
 // Sprint 18 Phase 3 E3 — composer enhancements.
 const [preview, setPreview] = useState(false);
 const [scheduledFor, setScheduledFor] = useState<string>("");
 const [savedDraftAt, setSavedDraftAt] = useState<string | null>(null);
 // Sprint 19 F — edit-in-place state.
 const [editingPostId, setEditingPostId] = useState<string | null>(null);
 const [editDraft, setEditDraft] = useState("");

 // Sprint 23 Wave B — DEF-033/034: include topicFilter + authorFilter in queryKey so changes re-fire the query.
 const posts = useQuery<PostView[]>({
 queryKey: ["/api/comms/posts", sort, topicFilter ?? "", authorFilter ?? ""],
 queryFn: async () => {
 const params = new URLSearchParams({ sort });
 if (topicFilter && topicFilter !== "All") params.set("topic", topicFilter);
 if (authorFilter && authorFilter !== "all") params.set("authorKind", authorFilter);
 const r = await apiRequest("GET", `/api/comms/posts?${params.toString()}`);
 return r.json();
 },
 });
 const me = useQuery<{ id: string; legalName: string }>({ queryKey: ["/api/comms/me"] });
 // Sprint 20 Wave 2 — check if investor is on any cap table to show cap_table option
 const { data: ctx } = useEntitlement();
 const investorHasCapTable = role === "investor" && hasCapTable(ctx);
 // Sprint 22 Wave 1 — use entitlement context as primary identity (DEF-006 fix for PostsFeed).
 const feedMeId = ctx?.userId ?? me.data?.id ?? "";

 const createPost = useMutation({
 mutationFn: async () => {
 // For "both" — fire two posts (network + followers) for parity with live site.
 const reqs: Promise<unknown>[] = [];
 if (visibility === "network" || visibility === "both") {
 reqs.push(apiRequest("POST", "/api/comms/posts", {
 body: draft, visibility: "network", authorKind: "user",
 scheduledFor: scheduledFor || undefined,
 }));
 }
 if (visibility === "followers" || visibility === "both") {
 // Sprint 20 Wave 2 / Patch v4 — server resolves the active company id from the session.
 reqs.push(apiRequest("POST", "/api/comms/posts", {
 body: draft, visibility: "followers", authorKind: "company",
 scheduledFor: scheduledFor || undefined,
 }));
 }
 if (visibility === "cap_table") {
 reqs.push(apiRequest("POST", "/api/comms/posts", {
 body: draft, visibility: "cap_table", authorKind: "user",
 scheduledFor: scheduledFor || undefined,
 }));
 }
 await Promise.all(reqs);
 },
 onSuccess: () => {
 setDraft("");
 setScheduledFor("");
 queryClient.invalidateQueries({ queryKey: ["/api/comms/posts"] });
 const isScheduled = !!scheduledFor;
 const desc = isScheduled
 ? `Scheduled for ${new Date(scheduledFor).toLocaleString()}.`
 : visibility === "both" ? "Posted to your network and company followers."
 : visibility === "followers" ? "Posted to your company followers."
 : visibility === "cap_table" ? "Posted to your cap-table holders."
 : "Posted to your network.";
 toast({ title: isScheduled ? "Post scheduled" : "Post published", description: desc });
 },
 });

 // Sprint 19 F — edit post mutation.
 const editPost = useMutation({
 mutationFn: async ({ postId, body }: { postId: string; body: string }) =>
 apiRequest("PATCH", `/api/comms/posts/${postId}`, { body }),
 onSuccess: () => {
 setEditingPostId(null);
 queryClient.invalidateQueries({ queryKey: ["/api/comms/posts"] });
 toast({ title: "Post updated" });
 },
 onError: (e: any) => {
 toast({ title: "Edit failed", description: e?.message ?? "Could not save edit.", variant: "destructive" });
 },
 });

 // Sprint 19 F — delete post mutation.
 const deletePost = useMutation({
 mutationFn: async (postId: string) => apiRequest("DELETE", `/api/comms/posts/${postId}`),
 onSuccess: () => {
 queryClient.invalidateQueries({ queryKey: ["/api/comms/posts"] });
 toast({ title: "Post deleted" });
 },
 });

 // Sprint 19 F — save draft to server (NOT sessionStorage).
 const saveDraft = useMutation({
 mutationFn: async () =>
 (await apiRequest("POST", "/api/comms/posts/drafts", { body: draft, visibility })).json(),
 onSuccess: (data: { draftId: string }) => {
 setSavedDraftAt(new Date().toISOString());
 toast({ title: "Draft saved", description: `Draft #${data.draftId} saved.` });
 },
 onError: () => {
 // Gracefully fail — server endpoint may not exist in older deploys.
 setSavedDraftAt(new Date().toISOString());
 toast({ title: "Draft noted", description: "Draft could not be saved to server (graceful fallback)." });
 },
 });

 // Sprint 18 Phase 3 E5 — optimistic like/unlike: don't wait for server roundtrip.
 const like = useMutation({
 mutationFn: async ({ postId, on }: { postId: string; on: boolean }) =>
 apiRequest(on ? "POST" : "DELETE", `/api/comms/posts/${postId}/like`),
 onMutate: async ({ postId, on }) => {
 await queryClient.cancelQueries({ queryKey: ["/api/comms/posts"] });
 const meId = feedMeId;
 const prev = queryClient.getQueryData<PostView[]>(["/api/comms/posts", sort]);
 if (prev) {
 queryClient.setQueryData<PostView[]>(["/api/comms/posts", sort], prev.map((p) =>
 p.id === postId ? {
 ...p,
 likedByUserIds: on
 ? (p.likedByUserIds.includes(meId) ? p.likedByUserIds : [...p.likedByUserIds, meId])
 : p.likedByUserIds.filter((u) => u !== meId),
 } : p));
 }
 return { prev };
 },
 onError: (_e, _v, ctx) => {
 if (ctx?.prev) queryClient.setQueryData(["/api/comms/posts", sort], ctx.prev);
 },
 onSettled: () => queryClient.invalidateQueries({ queryKey: ["/api/comms/posts"] }),
 });
 const share = useMutation({
 mutationFn: async (postId: string) => apiRequest("POST", `/api/comms/posts/${postId}/share`),
 onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/comms/posts"] }),
 });
 const comment = useMutation({
 mutationFn: async ({ postId, body }: { postId: string; body: string }) =>
 apiRequest("POST", `/api/comms/posts/${postId}/comments`, { body }),
 onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/comms/posts"] }),
 });
 const follow = useMutation({
 mutationFn: async (postId: string) => apiRequest("POST", `/api/comms/posts/${postId}/follow`),
 onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/comms/posts"] }),
 });

 // Sprint 20 Wave 2 — mute/report actions (defect 78)
 const muteAuthor = useMutation({
 mutationFn: async (postId: string) => apiRequest("POST", `/api/comms/posts/${postId}/mute-author`),
 onSuccess: () => { toast({ title: "Author muted" }); queryClient.invalidateQueries({ queryKey: ["/api/comms/posts"] }); },
 onError: (e: Error) => toast({ title: "Could not mute", description: e.message, variant: "destructive" }),
 });
 const reportPost = useMutation({
 mutationFn: async (postId: string) => apiRequest("POST", `/api/comms/posts/${postId}/report`),
 onSuccess: () => toast({ title: "Post reported" }),
 onError: (e: Error) => toast({ title: "Could not report", description: e.message, variant: "destructive" }),
 });

 return (
 <Card data-testid="widget-posts-feed">
 <CardContent className="p-4 space-y-4">
 {/* Composer */}
 <div className="space-y-2">
 <Textarea
 value={draft}
 onChange={(e) => setDraft(e.target.value)}
 placeholder={role === "founder"
 ? "Share an update with your investors and network..."
 : "Share a thought with your network..."}
 rows={2}
 className="resize-none"
 data-testid="input-post-draft"
 />
 {savedDraftAt && (
  <div className="text-[11px] text-muted-foreground" data-testid="text-draft-saved">
   Draft saved at {new Date(savedDraftAt).toLocaleTimeString()}
  </div>
 )}
 {preview && draft.trim() && (
  <div className="rounded-md border border-border bg-muted/40 p-3 text-sm" data-testid="post-preview">
   <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Preview</div>
   <div className="whitespace-pre-wrap leading-relaxed">{draft}</div>
  </div>
 )}
 <div className="flex items-center justify-between gap-2">
 <Select value={visibility} onValueChange={(v) => setVisibility(v as typeof visibility)}>
 <SelectTrigger className="h-8 w-[220px] text-xs" data-testid="select-post-visibility">
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="network">
 <span className="inline-flex items-center gap-2"><Globe2 className="h-3.5 w-3.5" /> Network</span>
 </SelectItem>
 <SelectItem value="followers">
 <span className="inline-flex items-center gap-2"><UserCircle2 className="h-3.5 w-3.5" /> My company followers</span>
 </SelectItem>
 <SelectItem value="both">
 <span className="inline-flex items-center gap-2"><Sparkles className="h-3.5 w-3.5" /> Both</span>
 </SelectItem>
 {/* Sprint 20 Wave 2 — show cap_table for investors on a cap table (defect 77) */}
 {(role === "founder" || investorHasCapTable) && (
 <SelectItem value="cap_table">
 <span className="inline-flex items-center gap-2"><Lock className="h-3.5 w-3.5" /> Cap table only</span>
 </SelectItem>
 )}
 </SelectContent>
 </Select>

 <input
  type="datetime-local"
  value={scheduledFor}
  onChange={(e) => setScheduledFor(e.target.value)}
  className="h-8 px-2 text-xs rounded-md border border-input bg-background"
  data-testid="input-post-schedule"
  aria-label="Schedule for later"
 />
 <Button
  type="button"
  variant="ghost"
  size="sm"
  className="h-8 px-2 text-xs"
  onClick={() => setPreview((v) => !v)}
  data-testid="button-post-preview"
  aria-label="Toggle preview"
 >
  <Eye className="h-3.5 w-3.5 mr-1" /> {preview ? "Hide" : "Preview"}
 </Button>
 <Button
  type="button"
  variant="ghost"
  size="sm"
  className="h-8 px-2 text-xs"
  disabled={!draft.trim() || saveDraft.isPending}
  onClick={() => saveDraft.mutate()}
  data-testid="button-post-save-draft"
 >
  <Save className="h-3.5 w-3.5 mr-1" /> Draft
 </Button>
 <Button
 size="sm"
 disabled={!draft.trim() || createPost.isPending}
 onClick={() => createPost.mutate()}
 className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white"
 data-testid="button-post-submit"
 >
 <Send className="h-3.5 w-3.5 mr-1.5" />
 {scheduledFor ? "Schedule" : "Post"}
 </Button>
 </div>
 </div>

 {/* Sort tabs + refresh */}
 <div className="flex items-center justify-between border-b border-border pb-2">
 <div className="flex items-center gap-1 text-xs">
 {(["newest", "featured", "following"] as const).map((k) => (
 <button
 key={k}
 onClick={() => setSort(k)}
 data-testid={`feed-sort-${k}`}
 className={`px-2 py-1 rounded-md capitalize transition-colors ${
 sort === k ? "bg-secondary text-foreground font-medium" : "text-muted-foreground hover-elevate"
 }`}
 >
 {k}
 </button>
 ))}
 </div>
 <Button
 variant="ghost"
 size="icon"
 className="h-7 w-7"
 onClick={() => {
 // Sprint 23 Wave B: invalidate with exact key to also re-fetch with current filters.
 queryClient.invalidateQueries({ queryKey: ["/api/comms/posts", sort, topicFilter ?? "", authorFilter ?? ""] });
 }}
 aria-label="Refresh feed"
 data-testid="button-refresh-feed"
 >
 <RefreshCw className="h-3.5 w-3.5" />
 </Button>
 </div>

 {/* Feed */}
 {posts.isLoading && <Skeleton className="h-32 w-full" />}
 {!posts.isLoading && asArray(posts.data).length === 0 && (
 <div className="text-sm text-muted-foreground py-6 text-center">
 No posts yet. Start a conversation.
 </div>
 )}
 <div className="space-y-4">
 {(asArray(posts.data) as PostView[]).slice(0, maxPosts ?? 12).map((p) => (
 <PostCard
 key={p.id}
 post={p}
 meId={feedMeId}
 role={role}
 onLike={(on) => like.mutate({ postId: p.id, on })}
 onShare={() => {
              const safeRole = role || "investor";
              const shareUrl = `${window.location.origin}/#/${safeRole}/posts/${p.id}`;
              navigator.clipboard?.writeText(shareUrl).catch(() => {});
              share.mutate(p.id);
              toast({ title: "Link copied" });
            }}
 onFollow={() => follow.mutate(p.id)}
 onComment={(body) => comment.mutate({ postId: p.id, body })}
 onEdit={() => { setEditingPostId(p.id); setEditDraft(p.body); }}
 onDelete={() => deletePost.mutate(p.id)}
 onNavigate={(id) => navigate(`/${role}/posts/${id}`)}
 onMuteAuthor={() => muteAuthor.mutate(p.id)}
 onReport={() => reportPost.mutate(p.id)}
 editingId={editingPostId}
 editDraft={editDraft}
 onEditDraftChange={setEditDraft}
 onEditSave={() => { if (editDraft.trim()) editPost.mutate({ postId: p.id, body: editDraft.trim() }); }}
 onEditCancel={() => setEditingPostId(null)}
 />
 ))}
 {viewAllHref && asArray(posts.data).length > (maxPosts ?? 12) && (
 <Link
 href={viewAllHref}
 className="block text-center text-xs text-[hsl(184_98%_22%)] hover:underline pt-1"
 data-testid="link-view-all-posts"
 >
 View all {asArray(posts.data).length} posts →
 </Link>
 )}
 {showLoadMore && onLoadMore && asArray(posts.data).length >= (maxPosts ?? 12) && (
 <div className="pt-2 flex justify-center">
 <Button
 variant="outline"
 size="sm"
 onClick={onLoadMore}
 data-testid="button-load-more-posts"
 >
 Load more posts
 </Button>
 </div>
 )}
 </div>
 </CardContent>
 </Card>
 );
}

function PostCard({
 post, meId, role, onLike, onShare, onFollow, onComment, onEdit, onDelete, onNavigate,
 onMuteAuthor, onReport,
 editingId, editDraft, onEditDraftChange, onEditSave, onEditCancel,
}: {
 post: PostView;
 meId: string;
 role: "founder" | "investor";
 onLike: (on: boolean) => void;
 onShare: () => void;
 onFollow: () => void;
 onComment: (body: string) => void;
 onEdit: () => void;
 onDelete: () => void;
 onNavigate: (id: string) => void;
 // Sprint 20 Wave 2 — mute/report handlers (defect 78)
 onMuteAuthor: () => void;
 onReport: () => void;
 editingId: string | null;
 editDraft: string;
 onEditDraftChange: (v: string) => void;
 onEditSave: () => void;
 onEditCancel: () => void;
}) {
 const { toast } = useToast();
 const [showCommentBox, setShowCommentBox] = useState(false);
 const [commentDraft, setCommentDraft] = useState("");
 const liked = post.likedByUserIds.includes(meId);
 const isMyPost = post.authorUserId === meId;
 const isEditing = editingId === post.id;
 const initials = post.authorLabel.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

 return (
 <div className="rounded-md border border-border bg-card p-4" data-testid={`post-${post.id}`}>
 {/* Header */}
 <div className="flex items-start gap-3">
 <Avatar className="h-10 w-10 shrink-0">
 <AvatarFallback className={`text-xs ${post.isAnonymous ? "bg-muted text-muted-foreground" : "bg-secondary"}`}>
 {post.isAnonymous ? <Lock className="h-4 w-4" /> : initials}
 </AvatarFallback>
 </Avatar>
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2 flex-wrap">
 <span className={`text-sm font-semibold ${post.isAnonymous ? "italic text-muted-foreground" : ""}`}>
 {post.authorLabel}
 </span>
 {post.authorCapavateAngelNetwork && (
 <Badge className="h-4 px-1.5 text-[10px] bg-amber-500/15 text-amber-700 border border-amber-500/30 inline-flex items-center gap-1">
 <BadgeCheck className="h-3 w-3" /> Capavate Angel Network
 </Badge>
 )}
 <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1 px-1.5 h-4 rounded-full bg-secondary">
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
 <VisibilityBadge v={post.visibility} />
 </div>
 </div>
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="ghost" size="icon" className="h-7 w-7 -mr-1.5" aria-label="More" data-testid={`button-post-menu-${post.id}`}>
 <MoreHorizontal className="h-3.5 w-3.5" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end">
 <DropdownMenuItem
 onClick={() => {
 if (typeof navigator?.clipboard?.writeText === "function") {
 const safeRole = role || "investor";
                  navigator.clipboard.writeText(`${window.location.origin}/#/${safeRole}/posts/${post.id}`)
 .then(() => toast({ title: "Link copied" }))
 .catch(() => toast({ title: "Copy failed", variant: "destructive" }));
 } else {
 toast({ title: "Clipboard unavailable", variant: "destructive" });
 }
 }}
 >
 Copy link
 </DropdownMenuItem>
 {isMyPost && (
 <>
 <DropdownMenuSeparator />
 <DropdownMenuItem onClick={onEdit}>
 <Pencil className="h-3.5 w-3.5 mr-2" /> Edit post
 </DropdownMenuItem>
 <DropdownMenuItem
 className="text-destructive focus:text-destructive"
 onClick={onDelete}
 >
 <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete post
 </DropdownMenuItem>
 </>
 )}
 {/* Sprint 20 Wave 2 — wired mute/report (defect 78) */}
 {!isMyPost && (
 <>
 <DropdownMenuSeparator />
 <DropdownMenuItem onClick={onMuteAuthor} data-testid={`button-mute-author-${post.id}`}>Mute author</DropdownMenuItem>
 <DropdownMenuItem onClick={onReport} data-testid={`button-report-${post.id}`}>Report</DropdownMenuItem>
 </>
 )}
 </DropdownMenuContent>
 </DropdownMenu>
 </div>

 {/* Sprint 19 F — edit inline panel */}
 {isEditing && (
 <div className="mt-3 space-y-2">
 <Textarea
 value={editDraft}
 onChange={(e) => onEditDraftChange(e.target.value)}
 rows={3}
 className="resize-none text-sm"
 data-testid={`input-edit-post-${post.id}`}
 />
 <div className="flex gap-2 justify-end">
 <Button variant="ghost" size="sm" onClick={onEditCancel}>Cancel</Button>
 <Button size="sm" onClick={onEditSave} disabled={!editDraft.trim()}
 className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white"
 data-testid={`button-edit-save-${post.id}`}
 >Save</Button>
 </div>
 </div>
 )}
 {/* Body — Sprint 19 F: use wouter navigate, no window.location.hash sniffing. */}
 {!isEditing && (
 <button
 type="button"
 onClick={() => onNavigate(post.id)}
 className="block mt-3 text-sm leading-relaxed whitespace-pre-wrap cursor-pointer text-left hover:underline decoration-dotted decoration-muted-foreground/40 w-full"
 data-testid={`post-body-${post.id}`}
 >
 <RichPostBody body={post.body} />
 </button>
 )}

 {/* Actions */}
 <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
 <ActionBtn
 active={liked}
 onClick={() => onLike(!liked)}
 icon={Heart}
 label={String(post.likedByUserIds.length)}
 testid={`button-like-${post.id}`}
 activeClass="text-rose-500"
 fillWhenActive
 />
 <ActionBtn
 onClick={() => setShowCommentBox((s) => !s)}
 icon={MessageCircle}
 label={String(post.commentCount)}
 testid={`button-comment-${post.id}`}
 />
 <ActionBtn
 onClick={onShare}
 icon={Share2}
 label={String(post.shareCount)}
 testid={`button-share-${post.id}`}
 />
 {post.authorKind === "company" && (
 <Button
 variant="outline"
 size="sm"
 className="ml-auto h-7 text-xs"
 onClick={onFollow}
 data-testid={`button-follow-${post.id}`}
 >
 {(post.followingCompanyIds?.length ?? 0) > 0 ? "Following ✓" : "+ Follow"}
 </Button>
 )}
 </div>

 {/* Comments */}
 {(post.comments?.length ?? 0) > 0 && (
 <ul className="mt-3 pt-3 border-t border-border/60 space-y-2">
 {post.comments.slice(-2).map((c) => (
 <li key={c.id} className="text-xs flex gap-2">
 <span className="font-medium">{c.authorLabel ?? c.userId ?? "Anonymous"}:</span>
 <span className="text-muted-foreground flex-1">{c.body}</span>
 <span className="text-[10px] text-muted-foreground/80">{timeAgo(c.createdAt)}</span>
 </li>
 ))}
 </ul>
 )}
 {showCommentBox && (
 <div className="mt-3 flex gap-2">
 <Textarea
 value={commentDraft}
 onChange={(e) => setCommentDraft(e.target.value)}
 placeholder="Write a comment..."
 rows={1}
 className="resize-none text-xs h-9"
 data-testid={`input-comment-${post.id}`}
 />
 <Button
 size="sm"
 onClick={() => {
 if (!commentDraft.trim()) return;
 onComment(commentDraft.trim());
 setCommentDraft("");
 setShowCommentBox(false);
 }}
 data-testid={`button-comment-submit-${post.id}`}
 >
 Send
 </Button>
 </div>
 )}
 </div>
 );
}

function ActionBtn({
 icon: Icon, label, onClick, active, testid, activeClass, fillWhenActive,
}: {
 icon: typeof Heart; label: string; onClick: () => void; active?: boolean; testid: string; activeClass?: string; fillWhenActive?: boolean;
}) {
 return (
 <button
 onClick={onClick}
 data-testid={testid}
 className={`inline-flex items-center gap-1.5 px-2 h-7 rounded-md hover-elevate ${
 active ? activeClass ?? "text-foreground" : ""
 }`}
 >
 <Icon className={`h-3.5 w-3.5 ${active && fillWhenActive ? "fill-current" : ""}`} />
 <span>{label}</span>
 </button>
 );
}

function VisibilityBadge({ v }: { v: PostView["visibility"] }) {
 const map: Record<string, { label: string; icon: typeof Globe2 }> = {
 network: { label: "Network", icon: Globe2 },
 followers: { label: "Followers", icon: UserCircle2 },
 public_to_collective: { label: "Collective", icon: Sparkles },
 cap_table: { label: "Cap table", icon: Lock },
 };
 const m = map[v] ?? { label: v, icon: Globe2 };
 const Icon = m.icon;
 return (
 <span className="inline-flex items-center gap-1">
 <Icon className="h-3 w-3" /> {m.label}
 </span>
 );
}

/** Sprint 19 F — render @mentions and #hashtags as styled spans. */
function RichPostBody({ body }: { body: string }) {
 const parts = body.split(/([@#]\w+)/g);
 return (
 <>
 {parts.map((part, i) => {
 if (part.startsWith("@"))
 return <span key={i} className="text-[hsl(184_98%_22%)] font-medium">{part}</span>;
 if (part.startsWith("#"))
 return <span key={i} className="text-[hsl(219_45%_40%)] font-medium">{part}</span>;
 return <span key={i}>{part}</span>;
 })}
 </>
 );
}
