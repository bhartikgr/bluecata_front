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
            Couldn't load network posts.
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
            <Link href="/collective/posts">
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
