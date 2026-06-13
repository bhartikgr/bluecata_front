/**
 * Sprint 12 B6 — Notification center.
 * /notifications — full inbox with filters, bulk actions, archive.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Bell, Check, Archive, Trash2, Filter } from "lucide-react";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useRole } from "@/lib/role";

type Notification = {
  id: string;
  userId: string;
  kind: string;
  title: string;
  body: string;
  link?: string;
  read: boolean;
  archived: boolean;
  createdAt: string;
};

export default function NotificationCenter() {
  const { role: _role } = useRole();
  void _role;
  const meQ = useQuery<{ isAuthed: boolean; userId: string | null }>({
    queryKey: ["/api/auth/me"],
  });
  const userId = meQ.data?.userId ?? "";
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [filter, setFilter] = useState<"all" | "unread" | "archived">("all");
  const [selected, setSelected] = useState<string[]>([]);

  const queryUrl = (() => {
    const params = new URLSearchParams({ userId });
    if (filter === "unread") params.set("unreadOnly", "true");
    if (filter === "archived") params.set("archived", "true");
    return `/api/notifications?${params.toString()}`;
  })();
  const { data, isLoading } = useQuery<{ items: Notification[]; unread: number; total: number }>({
    queryKey: [queryUrl],
    enabled: Boolean(userId),
  });

  const toggle = (id: string) =>
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const bulk = async (op: "read" | "archive") => {
    await apiRequest("PATCH", "/api/notifications", { ids: selected, [op === "read" ? "read" : "archived"]: true });
    setSelected([]);
    qc.invalidateQueries({ queryKey: [queryUrl] });
  };

  return (
    <>
      <PageHeader
        title="Notification center"
        description="All notifications across surfaces. Real-time updates via SSE; preferences in Settings."
        actions={
          <>
            <Button
              variant="outline" size="sm"
              data-testid="button-mark-selected-read"
              disabled={selected.length === 0}
              onClick={() => bulk("read")}
            >
              <Check className="h-3.5 w-3.5 mr-1" /> Mark read ({selected.length})
            </Button>
            <Button
              variant="outline" size="sm"
              data-testid="button-archive-selected"
              disabled={selected.length === 0}
              onClick={() => bulk("archive")}
            >
              <Archive className="h-3.5 w-3.5 mr-1" /> Archive
            </Button>
          </>
        }
      />
      <PageBody>
        <div className="flex items-center gap-2 mb-4 text-xs">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          {(["all", "unread", "archived"] as const).map(f => (
            <Button
              key={f} size="sm" variant={filter === f ? "default" : "outline"}
              data-testid={`filter-${f}`}
              onClick={() => setFilter(f)}
            >
              {f}
            </Button>
          ))}
          {data && (
            <span className="ml-auto text-muted-foreground">
              {data.total} total · <span className="text-foreground font-medium">{data.unread} unread</span>
            </span>
          )}
        </div>

        {!userId ? (
          <Card className="p-12 text-center text-sm text-muted-foreground" data-testid="text-notifications-signin">
            <Bell className="h-8 w-8 mx-auto mb-3 text-muted-foreground/40" />
            Sign in to see notifications.
          </Card>
        ) : isLoading ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">Loading…</Card>
        ) : !data || data.items.length === 0 ? (
          <Card className="p-12 text-center text-sm text-muted-foreground" data-testid="text-notifications-empty">
            <Bell className="h-8 w-8 mx-auto mb-3 text-muted-foreground/40" />
            No notifications.
          </Card>
        ) : (
          <div className="space-y-2">
            {data.items.map(n => (
              <Card
                key={n.id}
                data-testid={`row-notification-${n.id}`}
                data-kind={n.kind}
                data-read={n.read ? "true" : "false"}
                className={`p-3 flex items-start gap-3 cursor-pointer hover:bg-accent/30 ${!n.read ? "border-l-2 border-l-[hsl(333_75%_55%)]" : ""}`}
                onClick={() => n.link && navigate(n.link)}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(n.id)}
                  onChange={(e) => { e.stopPropagation(); toggle(n.id); }}
                  onClick={(e) => e.stopPropagation()}
                  data-testid={`checkbox-${n.id}`}
                  className="mt-1"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{n.title}</span>
                    {!n.read && <Badge variant="default" className="text-[9px] h-4">NEW</Badge>}
                    <Badge variant="outline" className="text-[9px] h-4 ml-auto">{n.kind}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</div>
                  <div className="text-[10px] text-muted-foreground/60 mt-1">{new Date(n.createdAt).toLocaleString()}</div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}
