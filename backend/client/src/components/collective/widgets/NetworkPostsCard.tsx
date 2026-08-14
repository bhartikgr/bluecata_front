/**
 * v25.44 Surface 5 — Network Posts feed widget (read-only).
 * Reads GET /api/collective/posts?limit=5. Link to /collective/posts.
 * likeCount/commentCount are 0 until v25.45 Tier-2 social.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageSquare, Heart } from "lucide-react";
import { collectiveWidgetErrorText } from "@/lib/collectiveGateError";

interface Post {
  id: string;
  authorUserId: string;
  authorName: string;
  body: string;
  createdAt: string;
  chapterId: string | null;
  sectorTags: string[];
  likeCount: number;
  commentCount: number;
}
interface PostsResponse {
  posts: Post[];
  nextCursor: string | null;
}

export function NetworkPostsCard() {
  const q = useQuery<PostsResponse>({
    queryKey: ["/api/collective/posts", "widget"],
    queryFn: async () => (await apiRequest("GET", "/api/collective/posts?limit=5")).json(),
    staleTime: 30_000,
  });

  const posts = q.data?.posts ?? [];

  return (
    <Card data-testid="widget-network-posts">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2" style={{ color: "#1A1A2E" }}>
          <MessageSquare className="h-4 w-4 text-[#cc0001]" />
          Network Posts
        </CardTitle>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <div className="space-y-2" data-testid="widget-posts-loading">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : q.error ? (
          <div className="text-sm text-red-700" data-testid="widget-posts-error">
            {collectiveWidgetErrorText(q.error, 'Couldn\'t load network posts.')}
          </div>
        ) : posts.length === 0 ? (
          <div className="text-center py-6 text-slate-500" data-testid="widget-posts-empty">
            <p className="text-sm">No network posts yet.</p>
          </div>
        ) : (
          <div className="space-y-2" data-testid="widget-posts-list">
            {posts.map((p) => (
              <div key={p.id} className="py-2 px-3 rounded-md bg-slate-50" data-testid={`widget-posts-row-${p.id}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-700">{p.authorName}</span>
                  <span className="text-[10px] text-slate-400">{new Date(p.createdAt).toLocaleDateString()}</span>
                </div>
                <p className="text-sm text-slate-600 line-clamp-2 mt-0.5">{p.body}</p>
                <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-400">
                  <span className="flex items-center gap-1"><Heart className="h-3 w-3" />{p.likeCount}</span>
                  <span className="flex items-center gap-1"><MessageSquare className="h-3 w-3" />{p.commentCount}</span>
                </div>
              </div>
            ))}
            {/* WAVE 41 · REACHABILITY RULE R3 — REAL DEFECT, REPAIRED (not allowlisted).
                R3 flagged an interactive <a> nested inside <Link>. It was right, and
                this is not a stylistic quibble. wouter is pinned at 3.9.0, whose
                Link (node_modules/wouter/src/index.js:308-318) clones its child
                ONLY when `asChild` is passed; otherwise it renders its OWN <a> and
                places `children` inside it. Without `asChild` this emitted
                  <a href="/collective/posts"><a class="…" data-testid="…">…</a></a>
                — nested anchors, which is invalid HTML, and the INNER anchor (the
                one carrying the class and the testid, i.e. the one the user sees
                and clicks) had NO href. So keyboard focus, middle-click,
                open-in-new-tab, "copy link address" and the status-bar preview all
                behaved wrongly on the visible element, while a plain left-click
                still worked because it bubbled to the outer anchor's onClick.
                That is why no test caught it: the testid is on the inner anchor and
                clicking it navigates. `asChild` makes wouter clone this anchor and
                give it the href, producing ONE correct <a>. No element, class,
                testid or copy string is added or removed. */}
              <Link asChild href="/collective/posts">
              <a className="block text-xs text-[#cc0001] hover:underline pt-1" data-testid="widget-posts-viewall">
                View all posts
              </a>
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default NetworkPostsCard;
