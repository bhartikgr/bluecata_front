/**
 * Sprint 12 B6 — Notification bell.
 *
 * Wires to /api/notifications + /api/notifications/stream (SSE). Replaces the
 * decorative bell that previously had no behavior. Shows unread badge count,
 * opens a dropdown with the 10 most recent items + link to /notifications.
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Bell, CheckCheck } from "lucide-react";
import { inboxHrefForSurface, type NotificationSurface } from "@shared/notificationDestination";
import {
  useNotifications,
  useNotificationStream,
  invalidateNotifications,
  markAllReadScoped,
} from "@/lib/useNotifications";
import { performNotificationNavigation } from "@/lib/notificationNavigate";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuLabel, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { notificationKindLabel } from "@/lib/notificationKindLabels";

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

/**
 * WAVE 149 · ITEM 3 — `viewAllHref`.
 *
 * The "View all notifications" item resolved its destination from `useRole()`
 * alone. `client/src/lib/role.tsx:3` has no `collective` role and the provider
 * defaults to `"founder"`, so a Collective member or Consortium Partner reading
 * their bell was sent to a founder page or to the role-agnostic `/notifications`
 * — a page that renders outside their own shell. A shell knows which persona it
 * is hosting; the bell does not and should not have to. The shell therefore names
 * the destination. (The role expression that served as the default until
 * 2026-09-19 is retired: the default is now derived from `surface`, below.)
 */
/**
 * 2026-09-19 · `surface`.
 *
 * The bell listed and COUNTED every notification of the session user, whatever
 * workspace it belonged to, and navigated to the stored link unexamined. The
 * shell that mounts the bell knows which persona it hosts (AppShell derives it
 * from the route; CollectiveShell from partner vs Collective path), and names
 * it here. List, badge count, mark-all-read, cache key and SSE scope all use
 * this ONE value, so what is shown and what is counted can never disagree.
 * Default `account` preserves the legacy account-wide behaviour for any mount
 * that does not name a surface.
 */
export function NotificationBell({
  viewAllHref,
  surface = "account",
}: { viewAllHref?: string; surface?: NotificationSurface } = {}) {
  // Patch v4 — the bell uses the actual session user id from /api/auth/me.
  // When there is no authed user we render nothing (no badge, no SSE).
  const meQ = useQuery<{ isAuthed: boolean; userId: string | null }>({
    queryKey: ["/api/auth/me"],
  });
  const userId = meQ.data?.userId ?? "";
  const [_, navigate] = useLocation();
  const qc = useQueryClient();

  const { data, isError } = useNotifications(userId, surface);
  /* Distinct loading / error / empty states: an unresolved first read is NOT an
     empty inbox, so "caught up" is never rendered before the first response. */
  const isPending = !data && !isError;
  /* 2026-09-19 — controlled open state so a SUCCESSFUL row navigation closes
     the menu. Previously every row `preventDefault`ed Radix's close-on-select;
     once the repaired destination stays inside the same shell, the still-open
     menu survived the navigation and intercepted pointer events on the next
     page (observed in the real browser). Rows whose plan is `none` keep the
     menu open — nothing happened, so nothing should disappear. */
  const [open, setOpen] = useState(false);
  // SSE stream — scoped, bounded durable-state invalidations; the 30 s poll in
  // useNotifications carries the function when the stream is unavailable.
  const sseAlive = useNotificationStream(userId, surface);

  const unread = userId ? (data?.unread ?? 0) : 0;
  const recent = useMemo(() => (data?.items ?? []).slice(0, 10), [data]);
  const outsideWorkspace = data?.outsideWorkspace ?? 0;
  /* 2026-09-19 — the "View all" target is the inbox of the SAME surface the
     bell lists and counts, so the navigation plane and the data plane cannot
     disagree. Shells may pass an explicit `viewAllHref`; otherwise the shared
     mapping decides (admin → /admin/inbox, account → /notifications). The
     former role-provider branch is gone: a multi-role account standing in one
     workspace must not be sent to another workspace's inbox. Handler change
     authorised by the owner 2026-09-19 (scripts/silent-drop-guard/allowlist.json). */
  const effectiveViewAllHref = viewAllHref ?? inboxHrefForSurface(surface);

  // Hide the bell entirely for anonymous users (no badge, no surface).
  if (!userId) return null;

  const markAllRead = async () => {
    // Scoped to this shell's surface; the server applies owner + surface.
    await markAllReadScoped(surface);
    await invalidateNotifications(qc, userId);
  };

  /* The account-wide history (every row the user holds, including rows whose
     workspace could not be identified) is reachable from the shell's OWN inbox
     with `?scope=account`, so a partner never leaves their shell to see it. */
  const accountHistoryHref = viewAllHref
    ? `${viewAllHref}${viewAllHref.includes("?") ? "&" : "?"}scope=account`
    : surface === "admin"
      ? `${inboxHrefForSurface("admin")}?scope=account`
      /* founder/investor inboxes are the shared kind-chip page (no scope toggle);
         their account history is the role-agnostic center inside the SAME AppShell. */
      : "/notifications";

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Notifications"
          data-testid="button-notifications"
          data-sse-alive={sseAlive ? "true" : "false"}
          data-unread-count={unread}
          data-surface={surface}
          data-menu-open={open ? "true" : "false"}
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
        {isError ? (
          /* A failed read is NOT an empty inbox. Never render "caught up" for an error. */
          <div className="p-6 text-center text-xs text-destructive" data-testid="text-notifications-error" role="alert">
            Your notifications could not be loaded. They will be retried automatically.
          </div>
        ) : isPending ? (
          <div className="p-6 text-center text-xs text-muted-foreground" data-testid="text-notifications-loading" role="status">
            Loading notifications…
          </div>
        ) : recent.length === 0 ? (
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
                /* 2026-09-19 — destination decided by the shared classifier:
                   exact legacy alias repaired (/partner/pipeline →
                   /collective/partner/pipeline), unsafe values refused, the
                   audited data-room download opened outside the router, and
                   rows with no identified workspace left where they are. The
                   raw stored link is never handed to the router. Handler
                   change authorised by the owner 2026-09-19 (see
                   scripts/silent-drop-guard/allowlist.json). */
                const plan = performNotificationNavigation(n, { activeSurface: surface }, navigate);
                /* Navigated or opened a document → let Radix close the menu.
                   Nothing happened (wrong surface / unsafe / unknown path) →
                   keep it open; the row stays where the user can see it. */
                if (plan.action === "none") e.preventDefault();
                else setOpen(false);
              }}
              className="flex flex-col items-start gap-0.5 py-2"
            >
              <div className="flex items-center w-full gap-2">
                <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${n.read ? "bg-transparent" : "bg-[hsl(333_75%_55%)]"}`} />
                <span className="text-xs font-medium truncate flex-1">{n.title}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">{relTime(n.createdAt)}</span>
              </div>
              <div className="text-[11px] text-muted-foreground line-clamp-2 pl-3.5">{n.body}</div>
              {/* WAVE 149 · ITEM 4 (R77) — this line rendered the persisted machine
                  value `{n.kind}`. `data-kind` above still carries it, which R77
                  explicitly permits; what a human reads is now a written label. */}
              <div className="text-[10px] text-muted-foreground/70 pl-3.5 mt-0.5">{notificationKindLabel(n.kind)}</div>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        {/* WAVE 149 · ITEM 3 kept two static "View all" siblings (shell-supplied
            href vs. the Sprint 20 role chain) because the guard fingerprints
            handler EXPRESSIONS and no owner authorization existed to change one.
            2026-09-19 — the owner authorized this repair (final reconciled
            notification spec): ONE item whose destination is the inbox of the
            SAME surface the bell lists and counts (`inboxHrefForSurface`), so the
            data plane and the navigation plane cannot disagree. Both former
            handler fingerprints are retired under that authorization
            (scripts/silent-drop-guard/allowlist.json, 2026-09-19). */}
        <DropdownMenuItem
          onSelect={() => { setOpen(false); navigate(effectiveViewAllHref); }}
          data-testid="button-open-notification-center"
          data-view-all-scope={viewAllHref ? "shell" : "surface"}
          data-view-all-href={effectiveViewAllHref}
        >
          View all notifications →
        </DropdownMenuItem>
        {/* 2026-09-19 — labelled account-history entry. Only rendered for a
            scoped bell that actually has rows outside this workspace (including
            "Workspace not identified" rows), so nothing is silently hidden and
            nothing is shown in a workspace it does not belong to. */}
        {surface !== "account" && outsideWorkspace > 0 && (
          <DropdownMenuItem
            onSelect={() => { setOpen(false); navigate(accountHistoryHref); }}
            data-testid="button-open-account-history"
            data-outside-workspace-count={outsideWorkspace}
            className="text-[11px] text-muted-foreground"
          >
            {outsideWorkspace} more across your account →
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default NotificationBell;
