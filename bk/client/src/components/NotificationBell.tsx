/**
 * Sprint 12 B6 — Notification bell.
 *
 * Wires to /api/notifications + /api/notifications/stream (SSE). Replaces the
 * decorative bell that previously had no behavior. Shows unread badge count,
 * opens a dropdown with the 10 most recent items + link to /notifications.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Bell, CheckCheck } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuLabel, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
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

type NotifList = { userId: string; total: number; unread: number; items: Notification[] };

function relTime(iso: string): string {
  const ts = new Date(iso).getTime();
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function NotificationBell() {
  const { role } = useRole();
  // Patch v4 — the bell uses the actual session user id from /api/auth/me.
  // When there is no authed user we render nothing (no badge, no SSE).
  const meQ = useQuery<{ isAuthed: boolean; userId: string | null }>({
    queryKey: ["/api/auth/me"],
  });
  const userId = meQ.data?.userId ?? "";
  const [_, navigate] = useLocation();
  const qc = useQueryClient();
  const [sseAlive, setSseAlive] = useState(false);

  const { data } = useQuery<NotifList>({
    queryKey: [`/api/notifications?userId=${userId}`],
    refetchInterval: 30_000,
    enabled: Boolean(userId),
  });

  // SSE stream — live updates
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!userId) return;
    // Skip SSE in production proxy env (no URL rewriting for EventSource); falls back to refetchInterval.
    const apiBase = ("__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__");
    if (!apiBase && /sites\.pplx\.app/.test(window.location.hostname)) {
      setSseAlive(false);
      return;
    }
    let es: EventSource | null = null;
    let closed = false;
    try {
      es = new EventSource(`${apiBase}/api/notifications/stream?userId=${userId}`);
      es.addEventListener("hello", () => setSseAlive(true));
      es.addEventListener("notification", () => {
        // Sprint 19 L — match the exact query key used by useQuery above.
        qc.invalidateQueries({ queryKey: [`/api/notifications?userId=${userId}`] });
      });
      // Silent fallback: close the connection on first error so the browser
      // doesn't repeatedly retry and spam the console with EventSource errors.
      es.onerror = () => {
        setSseAlive(false);
        if (!closed && es) {
          closed = true;
          try { es.close(); } catch { /* noop */ }
        }
      };
    } catch {
      setSseAlive(false);
    }
    return () => {
      closed = true;
      if (es) { try { es.close(); } catch { /* noop */ } }
    };
  }, [userId, qc]);

  const unread = userId ? (data?.unread ?? 0) : 0;
  const recent = useMemo(() => (data?.items ?? []).slice(0, 10), [data]);

  // Hide the bell entirely for anonymous users (no badge, no surface).
  if (!userId) return null;

  const markAllRead = async () => {
    await apiRequest("POST", "/api/notifications/read-all", { userId });
    qc.invalidateQueries({ queryKey: [`/api/notifications?userId=${userId}`] });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Notifications"
          data-testid="button-notifications"
          data-sse-alive={sseAlive ? "true" : "false"}
          data-unread-count={unread}
          className="relative p-2 rounded text-white/90 hover:bg-white/10"
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span
              data-testid="badge-unread-count"
              className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full text-[9px] font-semibold bg-[hsl(333_75%_55%)] text-white flex items-center justify-center"
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96 max-h-[28rem] overflow-y-auto">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Notifications</span>
          <button
            type="button"
            onClick={markAllRead}
            className="text-[11px] inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            data-testid="button-mark-all-read"
          >
            <CheckCheck className="h-3 w-3" /> Mark all read
          </button>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {recent.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground" data-testid="text-notifications-empty">
            You're all caught up.
          </div>
        ) : (
          recent.map(n => (
            <DropdownMenuItem
              key={n.id}
              data-testid={`notification-${n.id}`}
              data-kind={n.kind}
              data-read={n.read ? "true" : "false"}
              onSelect={(e) => {
                e.preventDefault();
                if (n.link) navigate(n.link);
              }}
              className="flex flex-col items-start gap-0.5 py-2"
            >
              <div className="flex items-center w-full gap-2">
                <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${n.read ? "bg-transparent" : "bg-[hsl(333_75%_55%)]"}`} />
                <span className="text-xs font-medium truncate flex-1">{n.title}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">{relTime(n.createdAt)}</span>
              </div>
              <div className="text-[11px] text-muted-foreground line-clamp-2 pl-3.5">{n.body}</div>
              <div className="text-[10px] text-muted-foreground/70 pl-3.5 mt-0.5">{n.kind}</div>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        {/* Sprint 20 Wave 2 — role-based notifications route (defect 64) */}
        <DropdownMenuItem
          onSelect={() => navigate(
            role === "investor" ? "/investor/notifications" :
            role === "founder"  ? "/founder/notifications" :
            "/notifications"
          )}
          data-testid="button-open-notification-center"
        >
          View all notifications →
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default NotificationBell;
