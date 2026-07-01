/**
 * v25.47 APD-023 — Admin Network Post Moderation.
 *
 * Lists posts (incl. hidden) from GET /api/admin/posts, applies flag/hide/unhide
 * via POST /api/admin/posts/:id/moderate, and shows the immutable audit trail
 * from GET /api/admin/posts/:id/moderation-log. Nothing hardcoded — every action
 * hits a real route and the table re-reads after each change.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ShieldAlert } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ModeratedPost {
  id: string;
  authorUserId: string | null;
  body: string;
  createdAt: string;
  hidden: boolean;
  deletedAt: string | null;
}

interface PostsResponse {
  ok: boolean;
  posts: ModeratedPost[];
}

interface ModerationLogEntry {
  id: string;
  postId: string;
  action: string;
  actor: string | null;
  reason: string | null;
  createdAt: string;
}

interface LogResponse {
  ok: boolean;
  log: ModerationLogEntry[];
}

type ModerationAction = "flag" | "hide" | "unhide";

export default function PostsModeration() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [openLogFor, setOpenLogFor] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<PostsResponse>({
    queryKey: ["/api/admin/posts"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/posts")).json(),
    retry: false,
  });
  const posts = data?.posts ?? [];

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/api/admin/posts"] });

  const moderateMut = useMutation({
    mutationFn: async (vars: { id: string; action: ModerationAction; reason?: string }) =>
      (
        await apiRequest("POST", `/api/admin/posts/${encodeURIComponent(vars.id)}/moderate`, {
          action: vars.action,
          reason: vars.reason,
        })
      ).json(),
    onSuccess: (_d, vars) => {
      invalidate();
      if (openLogFor === vars.id) {
        qc.invalidateQueries({ queryKey: ["/api/admin/posts", vars.id, "moderation-log"] });
      }
      toast({ title: `Post ${vars.action}d` });
    },
    onError: (e: Error) =>
      toast({ variant: "destructive", title: "Moderation failed", description: e.message }),
  });

  const logQuery = useQuery<LogResponse>({
    queryKey: ["/api/admin/posts", openLogFor, "moderation-log"],
    queryFn: async () =>
      (
        await apiRequest("GET", `/api/admin/posts/${encodeURIComponent(openLogFor!)}/moderation-log`)
      ).json(),
    enabled: !!openLogFor,
    retry: false,
  });

  return (
    <>
      <PageHeader
        title="Post Moderation"
        description="Review, flag, hide, or restore network posts. Hidden posts are soft-deleted (reversible) and every action is written to an immutable audit trail."
        breadcrumbs={[{ href: "/admin/dashboard", label: "Admin" }, { label: "Post Moderation" }]}
      />
      <PageBody>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-[#cc0001]" /> Posts ({posts.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground" data-testid="posts-moderation-loading">
                Loading posts…
              </p>
            ) : error ? (
              <p className="text-sm text-rose-600" data-testid="posts-moderation-error">
                Could not load posts. Please retry.
              </p>
            ) : posts.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="posts-moderation-empty">
                No posts to moderate.
              </p>
            ) : (
              <Table data-testid="posts-moderation-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Post</TableHead>
                    <TableHead>Author</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {posts.map((p) => (
                    <TableRow key={p.id} data-testid={`post-row-${p.id}`}>
                      <TableCell className="max-w-md">
                        <p className="truncate">{p.body || "—"}</p>
                        <p className="text-xs text-muted-foreground">{p.id}</p>
                      </TableCell>
                      <TableCell className="text-sm">{p.authorUserId ?? "—"}</TableCell>
                      <TableCell>
                        {p.hidden ? (
                          <Badge variant="destructive">Hidden</Badge>
                        ) : (
                          <Badge variant="secondary">Visible</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right space-x-2 whitespace-nowrap">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={moderateMut.isPending}
                          onClick={() => moderateMut.mutate({ id: p.id, action: "flag" })}
                          data-testid={`flag-${p.id}`}
                        >
                          Flag
                        </Button>
                        {p.hidden ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={moderateMut.isPending}
                            onClick={() => moderateMut.mutate({ id: p.id, action: "unhide" })}
                            data-testid={`unhide-${p.id}`}
                          >
                            Unhide
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={moderateMut.isPending}
                            onClick={() => moderateMut.mutate({ id: p.id, action: "hide" })}
                            data-testid={`hide-${p.id}`}
                          >
                            Hide
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setOpenLogFor(openLogFor === p.id ? null : p.id)}
                          data-testid={`log-${p.id}`}
                        >
                          {openLogFor === p.id ? "Hide log" : "Log"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {openLogFor && (
              <div className="mt-6 rounded-md border p-4" data-testid="moderation-log-panel">
                <h3 className="mb-2 text-sm font-medium">Moderation log — {openLogFor}</h3>
                {logQuery.isLoading ? (
                  <p className="text-sm text-muted-foreground">Loading log…</p>
                ) : (logQuery.data?.log ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No moderation history yet.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {(logQuery.data?.log ?? []).map((e) => (
                      <li key={e.id} className="flex items-center gap-2">
                        <Badge variant="outline">{e.action}</Badge>
                        <span className="text-muted-foreground">{e.actor ?? "—"}</span>
                        {e.reason && <span>· {e.reason}</span>}
                        <span className="ml-auto text-xs text-muted-foreground">{e.createdAt}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
