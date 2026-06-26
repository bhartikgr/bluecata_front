/**
 * v25.44 Surface 5 — /collective/posts full page (read-only feed w/ cursor).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageSquare, Heart } from "lucide-react";

interface Post {
  id: string;
  authorName: string;
  body: string;
  createdAt: string;
  sectorTags: string[];
  likeCount: number;
  commentCount: number;
}
interface PostsResponse {
  posts: Post[];
  nextCursor: string | null;
}

export default function NetworkPostsPage() {
  const [cursor, setCursor] = useState<string | null>(null);
  const q = useQuery<PostsResponse>({
    queryKey: ["/api/collective/posts", "page", cursor ?? "first"],
    queryFn: async () =>
      (await apiRequest("GET", `/api/collective/posts?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)).json(),
    staleTime: 30_000,
  });
  const posts = q.data?.posts ?? [];

  return (
    <div className="p-6 max-w-3xl mx-auto" data-testid="page-network-posts">
      <div className="flex items-center gap-2 mb-6">
        <MessageSquare className="h-6 w-6 text-[#cc0001]" />
        <h1 className="text-2xl font-semibold" style={{ color: "#041e41" }}>Network Posts</h1>
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-slate-500">Collective network feed</CardTitle>
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : q.error ? (
            <div className="text-sm text-red-700">Couldn't load network posts.</div>
          ) : posts.length === 0 ? (
            <div className="text-center py-10 text-slate-500" data-testid="page-posts-empty">
              <p className="text-sm">No network posts yet.</p>
            </div>
          ) : (
            <div className="space-y-3" data-testid="page-posts-list">
              {posts.map((p) => (
                <div key={p.id} className="py-3 px-3 rounded-md bg-slate-50">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700">{p.authorName}</span>
                    <span className="text-[11px] text-slate-400">{new Date(p.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="text-sm text-slate-600 mt-1">{p.body}</p>
                  <div className="flex items-center gap-3 mt-1.5 text-[11px] text-slate-400">
                    <span className="flex items-center gap-1"><Heart className="h-3 w-3" />{p.likeCount}</span>
                    <span className="flex items-center gap-1"><MessageSquare className="h-3 w-3" />{p.commentCount}</span>
                  </div>
                </div>
              ))}
              {q.data?.nextCursor && (
                <Button variant="outline" size="sm" onClick={() => setCursor(q.data!.nextCursor)} data-testid="page-posts-more">
                  Load more
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
