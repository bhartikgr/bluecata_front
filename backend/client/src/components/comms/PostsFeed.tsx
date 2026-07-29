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
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
 DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
 DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, ApiError } from "@/lib/queryClient";
import { timeAgo } from "@/lib/format";
import { ANONYMOUS_LABEL } from "@/lib/comms/visibility";

/**
 * W2M B4 — styled schedule datetime field.
 *
 * Thin wrapper around shadcn `Input` (type="datetime-local") so the field
 * matches the app's input styling instead of the unstyled native control.
 * Keeps the exact same value/onChange contract as the native input it
 * replaces (value: "" | "YYYY-MM-DDTHH:mm", onChange receives the raw string).
 */
function DateTimeLocalField({
 value,
 onChange,
 testId,
 ariaLabel,
}: {
 value: string;
 onChange: (value: string) => void;
 testId?: string;
 ariaLabel?: string;
}) {
 return (
 <Input
 type="datetime-local"
 value={value}
 onChange={(e) => onChange(e.target.value)}
 className="h-8 px-2 text-xs w-[190px]"
 data-testid={testId}
 aria-label={ariaLabel}
 />
 );
}

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
 /* Stage D (D1) — per-viewer follow state from durable `company_followers`. */
 viewerIsFollowingCompany?: boolean;
 authorCompanyId?: string;
 companyFollowerCount?: number;
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
 basePath,
}: {
 role: "founder" | "investor";
 /** v25.49 Phase-3B — override the `/${role}` URL prefix used for post-detail
  * navigation + share links so the SAME feed component can be reused inside the
  * partner shell (e.g. "/collective/partner/posts") and keep the user in-context
  * instead of bouncing to /investor/posts/:id. Defaults to `/${role}`. */
 basePath?: string;
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
 // v25.49 Phase-3B — resolved URL prefix for detail nav + share links.
 const postsBase = basePath ?? `/${role || "investor"}`;
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
 // W-FIX2 F3 — the feed showed empty on first mount until a post/refresh.
 // Two causes: (1) the shared 30s staleTime could serve a stale empty/errored
 // cache entry for this key (e.g. seeded by a dashboard-widget instance)
 // without refetching; (2) a failed first fetch fell through to the "No posts
 // yet" empty state. Force a fresh fetch on every mount so the live feed is
 // never served a stale empty cache; the error branch below (never silent)
 // handles a genuine failure distinctly from a genuinely-empty result.
 staleTime: 0,
 refetchOnMount: "always",
 });
 const me = useQuery<{ id: string; legalName: string }>({ queryKey: ["/api/comms/me"] });
 // Sprint 20 Wave 2 — check if investor is on any cap table to show cap_table option
 const { data: ctx } = useEntitlement();
 const investorHasCapTable = role === "investor" && hasCapTable(ctx);
 // Sprint 22 Wave 1 — use entitlement context as primary identity (DEF-006 fix for PostsFeed).
 const feedMeId = ctx?.userId ?? me.data?.id ?? "";

 // W2M B4 — resolve the active companyId from the entitlement context already
 // available to this component (no new fetch). Founders post as their active
 // company; investors post to the cap table of a company they actually hold
 // a position on. If neither is known, `followers`/`cap_table` options are
 // DISABLED below rather than silently omitting companyId server-side.
 const activeCompanyId = ctx?.founder?.activeCompanyId
 || ctx?.investor?.capTablePositions?.[0]?.companyId
 || "";
 const hasCompanyContext = !!activeCompanyId;

 const createPost = useMutation({
 mutationFn: async () => {
 // For "both" — fire two posts (network + followers) for parity with live site.
 // W2M B4 — collect settled results (not Promise.all-or-nothing) so a
 // partial failure on "both" can be reported precisely instead of masking
 // which half succeeded.
 type Req = { audience: "network" | "followers" | "cap_table"; promise: Promise<Response> };
 const reqs: Req[] = [];
 if (visibility === "network" || visibility === "both") {
 reqs.push({
 audience: "network",
 promise: apiRequest("POST", "/api/comms/posts", {
 body: draft, visibility: "network", authorKind: "user",
 scheduledFor: scheduledFor || undefined,
 }),
 });
 }
 if (visibility === "followers" || visibility === "both") {
 // W2M B4 — companyId now sent explicitly from the active-company context;
 // the audience option is disabled below when hasCompanyContext is false.
 reqs.push({
 audience: "followers",
 promise: apiRequest("POST", "/api/comms/posts", {
 body: draft, visibility: "followers", authorKind: "company",
 companyId: activeCompanyId || undefined,
 scheduledFor: scheduledFor || undefined,
 }),
 });
 }
 if (visibility === "cap_table") {
 reqs.push({
 audience: "cap_table",
 promise: apiRequest("POST", "/api/comms/posts", {
 body: draft, visibility: "cap_table", authorKind: "user",
 companyId: activeCompanyId || undefined,
 scheduledFor: scheduledFor || undefined,
 }),
 });
 }
 const settled = await Promise.allSettled(reqs.map((r) => r.promise));
 const failed = settled
 .map((s, i) => ({ s, audience: reqs[i].audience }))
 .filter((x) => x.s.status === "rejected") as Array<{ s: PromiseRejectedResult; audience: string }>;
 const succeeded = settled.filter((s) => s.status === "fulfilled").length;
 if (failed.length > 0) {
 // W2M B4 — never report false success. If ANY create failed (incl. a
 // partial failure on "both"), throw with enough detail for onError to
 // render a precise partial-failure toast with retry.
 throw Object.assign(new Error("post_create_partial_failure"), {
 failedAudiences: failed.map((f) => f.audience),
 succeededCount: succeeded,
 totalCount: reqs.length,
 firstError: failed[0].s.reason,
 });
 }
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
 // v25.13 NM3 — was previously a silent failure; surface error to user.
 // W2M B4 — on a 500 (POST_PERSIST_FAILED / COLLECTIVE_POST_PERSIST_FAILED)
 // or partial "both" failure, keep the composer open with the draft text
 // intact (no setDraft("")/setScheduledFor("") here) and show a destructive
 // toast — never a success state.
 onError: (e: unknown) => {
 const failedAudiences = (e as { failedAudiences?: string[] })?.failedAudiences;
 const succeededCount = (e as { succeededCount?: number })?.succeededCount ?? 0;
 const totalCount = (e as { totalCount?: number })?.totalCount ?? 1;
 if (failedAudiences && failedAudiences.length > 0 && totalCount > 1 && succeededCount > 0) {
 // Partial failure on the "both" split — some audiences succeeded.
 queryClient.invalidateQueries({ queryKey: ["/api/comms/posts"] });
 toast({
 title: "Post partially failed",
 description: `Could not post to: ${failedAudiences.join(", ")}. Your text is still in the composer — retry to finish posting.`,
 variant: "destructive",
 });
 return;
 }
 const firstError = (e as { firstError?: unknown })?.firstError;
 // W2M B4 — surface the server's POST_PERSIST_FAILED / COLLECTIVE_POST_PERSIST_FAILED
 // 500 body verbatim (via ApiError.message) rather than a generic string.
 const msg = firstError instanceof ApiError ? firstError.message
 : firstError instanceof Error ? firstError.message
 : e instanceof Error ? e.message : "Could not publish post.";
 toast({ title: "Post failed", description: msg, variant: "destructive" });
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
 // v25.13 NH3 — use the exact 4-element queryKey the posts query is
 // registered with; the previous 2-element key never matched the cache
 // entry so the optimistic update + rollback were a no-op.
 const postsKey = ["/api/comms/posts", sort, topicFilter ?? "", authorFilter ?? ""] as const;
 await queryClient.cancelQueries({ queryKey: postsKey });
 const meId = feedMeId;
 const prev = queryClient.getQueryData<PostView[]>(postsKey);
 if (prev) {
 queryClient.setQueryData<PostView[]>(postsKey, prev.map((p) =>
 p.id === postId ? {
 ...p,
 likedByUserIds: on
 ? (p.likedByUserIds.includes(meId) ? p.likedByUserIds : [...p.likedByUserIds, meId])
 : p.likedByUserIds.filter((u) => u !== meId),
 } : p));
 }
 return { prev, postsKey };
 },
 onError: (_e, _v, ctx) => {
 if (ctx?.prev && ctx?.postsKey) queryClient.setQueryData(ctx.postsKey as readonly unknown[], ctx.prev);
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
 {/* W2M B4 — followers/cap_table audiences need a resolved companyId to post
 with; disable rather than silently posting without one. */}
 <SelectItem value="followers" disabled={!hasCompanyContext} data-testid="select-post-visibility-followers">
 <span className="inline-flex items-center gap-2"><UserCircle2 className="h-3.5 w-3.5" /> My company followers{!hasCompanyContext ? " (no active company)" : ""}</span>
 </SelectItem>
 <SelectItem value="both" disabled={!hasCompanyContext} data-testid="select-post-visibility-both">
 <span className="inline-flex items-center gap-2"><Sparkles className="h-3.5 w-3.5" /> Both</span>
 </SelectItem>
 {/* Sprint 20 Wave 2 — show cap_table for investors on a cap table (defect 77) */}
 {(role === "founder" || investorHasCapTable) && (
 <SelectItem value="cap_table" disabled={!hasCompanyContext} data-testid="select-post-visibility-cap-table">
 <span className="inline-flex items-center gap-2"><Lock className="h-3.5 w-3.5" /> Cap table only{!hasCompanyContext ? " (no active company)" : ""}</span>
 </SelectItem>
 )}
 </SelectContent>
 </Select>

 <label className="inline-flex flex-col gap-0.5 leading-none" data-testid="label-post-schedule">
  <span className="text-[10px] text-muted-foreground">Schedule for later (optional)</span>
  <DateTimeLocalField
   value={scheduledFor}
   onChange={setScheduledFor}
   testId="post-schedule-datetime"
   ariaLabel="Schedule for later (optional)"
  />
 </label>
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
 disabled={!draft.trim() || createPost.isPending || ((visibility !== "network") && !hasCompanyContext)}
 onClick={() => createPost.mutate()}
 className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white"
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
 {/* W-FIX2 F3 — a fetch FAILURE must never masquerade as "No posts yet"
     (silent-drop). Surface the error + a retry so an empty render only ever
     means a genuinely-empty successful result. */}
 {posts.isError && (
 <div className="text-sm text-destructive py-6 text-center" data-testid="posts-load-error">
 Couldn’t load posts.{" "}
 <button type="button" className="underline" onClick={() => posts.refetch()} data-testid="button-posts-retry">
 Retry
 </button>
 </div>
 )}
 {posts.isSuccess && asArray(posts.data).length === 0 && (
 <div className="text-sm text-muted-foreground py-6 text-center" data-testid="posts-empty">
 No posts yet. Start a conversation.
 </div>
 )}
 <div className="space-y-4">
 {(asArray(posts.data) as PostView[]).slice(0, maxPosts ?? 12).map((p) => (
 <PostCard
 key={p.id}
 post={p}
 postsBase={postsBase}
 meId={feedMeId}
 role={role}
 onLike={(on) => like.mutate({ postId: p.id, on })}
 onShare={() => {
              // v25.13 NM4 — App uses History-API router, not hash router.
              // Hash-prefixed URLs land on / with an unmatched fragment.
              // v25.49 Phase-3B — use resolved postsBase so partner shares stay in-context.
              const shareUrl = `${window.location.origin}${postsBase}/posts/${p.id}`;
              navigator.clipboard?.writeText(shareUrl).catch(() => {});
              share.mutate(p.id);
              toast({ title: "Link copied" });
            }}
 onFollow={() => follow.mutate(p.id)}
 onComment={(body) => comment.mutate({ postId: p.id, body })}
 onEdit={() => { setEditingPostId(p.id); setEditDraft(p.body); }}
 onDelete={() => deletePost.mutate(p.id)}
 onNavigate={(id) => navigate(`${postsBase}/posts/${id}`)}
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
 className="block text-center text-xs text-[hsl(0_100%_40%)] hover:underline pt-1"
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
 post, postsBase, meId, role, onLike, onShare, onFollow, onComment, onEdit, onDelete, onNavigate,
 onMuteAuthor, onReport,
 editingId, editDraft, onEditDraftChange, onEditSave, onEditCancel,
}: {
 post: PostView;
 postsBase: string;
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
                  // v25.13 NM4 — History-API router, drop the hash prefix.
                  // v25.49 Phase-3B fix — use resolved postsBase so partner share links stay in-shell.
                  navigator.clipboard.writeText(`${window.location.origin}${postsBase}/posts/${post.id}`)
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
 className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white"
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
 {/* W-COLLECTIVE Wave 2 Stage D (D1) — PER-VIEWER follow state.
 `post.followingCompanyIds` used to be written on the POST by
 `POST /api/comms/posts/:id/follow`, so as soon as ONE investor
 followed, this button read "Following ✓" for EVERY viewer. The
 server now derives `viewerIsFollowingCompany` for the requesting
 viewer from the durable `company_followers` rows. The old
 expression is kept as the fallback so an older/cached payload
 that lacks the new field still renders exactly as before. */}
 {(post.viewerIsFollowingCompany ?? (post.followingCompanyIds?.length ?? 0) > 0)
 ? "Following ✓"
 : "+ Follow"}
 </Button>
 )}
 </div>

 {/* Comments */}
 {(post.comments?.length ?? 0) > 0 && (
 <ul className="mt-3 pt-3 border-t border-border/60 space-y-2">
 {post.comments.slice(-2).map((c) => (
 <li key={c.id} className="text-xs flex gap-2">
 {/* W2M B5 — identity display safety: NEVER fall back to the raw userId
 (which can be an email-derived id) as the primary author name. */}
 <span className="font-medium">{c.authorLabel || "Collective member"}:</span>
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
 return <span key={i} className="text-[hsl(0_100%_40%)] font-medium">{part}</span>;
 if (part.startsWith("#"))
 return <span key={i} className="text-[hsl(219_45%_40%)] font-medium">{part}</span>;
 return <span key={i}>{part}</span>;
 })}
 </>
 );
}
