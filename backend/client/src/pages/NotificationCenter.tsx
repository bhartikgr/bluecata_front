/**
 * Sprint 12 B6 — Notification center.
 * /notifications — full inbox with filters, bulk actions, archive.
 *
 * 2026-09-19 · persona-scoped. The page now takes a `surface` (named by the
 * route that mounts it) and:
 *   · lists and counts ONLY that workspace's rows (`?surface=`), through the
 *     shared hook/key every other consumer uses;
 *   · offers a labelled "Across your account" scope (`?scope=account`) that
 *     shows every row the user holds — including rows whose workspace could not
 *     be identified, labelled "Workspace not identified" — WITHOUT leaving the
 *     current shell;
 *   · navigates through the shared classifier (never the raw stored link);
 *   · sends scoped PATCH bodies and clears selection whenever user, surface or
 *     filter changes so a bulk action can never touch a row that is no longer
 *     on screen;
 *   · renders a shell-safe header for Consortium Partner / Collective mounts:
 *     the AppShell `PageHeader` carries a founder/investor glossary link, which
 *     would eject a partner from their shell.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { Bell, Check, Archive, Filter } from "lucide-react";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { notificationKindLabel } from "@/lib/notificationKindLabels";
import {
  classifyNotificationDestination,
  surfaceLabel,
  WORKSPACE_NOT_IDENTIFIED_LABEL,
  type NotificationSurface,
} from "@shared/notificationDestination";
import {
  useNotifications,
  useNotificationStream,
  invalidateNotifications,
  patchNotificationsScoped,
  type NotificationItem,
} from "@/lib/useNotifications";
import { performNotificationNavigation } from "@/lib/notificationNavigate";

type Filter = "all" | "unread" | "archived";

export type NotificationCenterProps = {
  /** Workspace this mount belongs to. Default `account` = legacy behaviour at /notifications. */
  surface?: NotificationSurface;
  /**
   * Which shell hosts the page. `collective` renders a local header (no
   * AppShell glossary link, which points at founder/investor pages).
   */
  chrome?: "app" | "collective";
};

/** `?scope=account` in the given search string → account-wide view in-shell. */
function scopeFromSearch(search: string): "workspace" | "account" {
  return new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("scope") === "account" ? "account" : "workspace";
}

export default function NotificationCenter({ surface = "account", chrome = "app" }: NotificationCenterProps = {}) {
  const meQ = useQuery<{ isAuthed: boolean; userId: string | null }>({
    queryKey: ["/api/auth/me"],
  });
  const userId = meQ.data?.userId ?? "";
  const qc = useQueryClient();
  const [location, navigate] = useLocation();
  /* 2026-09-19 — the URL is the single source of truth for the presentation
     scope. `useSearch()` is reactive to QUERY-ONLY changes, which a
     pathname-keyed effect missed: the bell's "more across your account" entry
     on the SAME path (`?scope=account`) changed the URL but not the view. The
     toggle buttons push the same query so direct load, the bell entry and
     browser back/forward all restore the same selection. */
  const search = useSearch();
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const scope: "workspace" | "account" = surface === "account" ? "account" : scopeFromSearch(search);
  const setScope = (next: "workspace" | "account") => {
    if (surface === "account" || next === scope) return;
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    if (next === "account") params.set("scope", "account"); else params.delete("scope");
    const qs = params.toString();
    navigate(`${location}${qs ? `?${qs}` : ""}`);
  };

  const effectiveSurface: NotificationSurface = scope === "account" ? "account" : surface;
  const filters = useMemo(
    () => ({
      unreadOnly: filter === "unread",
      archived: filter === "archived" ? true : undefined,
    }),
    [filter],
  );
  const { data, isLoading, isError } = useNotifications(userId, effectiveSurface, filters);
  useNotificationStream(userId, effectiveSurface);

  // Selection can only ever refer to rows currently on screen.
  useEffect(() => { setSelected([]); }, [userId, effectiveSurface, filter]);

  const toggle = (id: string) =>
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const bulk = async (op: "read" | "archive") => {
    if (selected.length === 0) return;
    await patchNotificationsScoped(effectiveSurface, selected, op === "read" ? { read: true } : { archived: true });
    setSelected([]);
    await invalidateNotifications(qc, userId);
  };

  /* Static copy (guard-visible literals). The workspace in view is named by the
     scope toggle below, not by a dynamic title. "Refreshes automatically" is the
     accurate statement: a bounded poll-backed stream plus a 30 s refetch, not an
     instant fan-out. */

  const actions = (
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
  );

  const workspaceLabelFor = (n: NotificationItem): string => {
    const c = classifyNotificationDestination(n.link, n.kind);
    if (c.class === "surface") return surfaceLabel(c.surface);
    if (c.class === "document") return "Document";
    return WORKSPACE_NOT_IDENTIFIED_LABEL;
  };

  return (
    <>
      {chrome === "collective" ? (
        /* Shell-safe header: same title/description/actions structure, no
           AppShell glossary link (that link targets founder/investor pages). */
        <div className="border-b border-border bg-card/50" data-testid="notification-center-header-collective">
          <div className="px-6 py-5 max-w-[1400px] mx-auto">
            <h1 className="text-xl font-semibold tracking-tight leading-tight" data-testid="text-page-title">Notification center</h1>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">Refreshes automatically; preferences in Settings.</p>
            <div className="flex items-center gap-2 flex-wrap mt-3">{actions}</div>
          </div>
        </div>
      ) : (
        <PageHeader title="Notification center" description="Refreshes automatically; preferences in Settings." actions={actions} />
      )}
      <PageBody>
        <div className="flex items-center gap-2 mb-4 text-xs flex-wrap">
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
          {surface !== "account" && (
            /* Presentation scope toggle. Stays in the SAME shell and route. */
            <div className="inline-flex items-center gap-1 ml-2" data-testid="notification-scope-toggle" data-scope={scope}>
              <Button
                size="sm" variant={scope === "workspace" ? "default" : "outline"}
                data-testid="scope-workspace"
                onClick={() => setScope("workspace")}
              >
                This workspace · {surfaceLabel(surface)}
              </Button>
              <Button
                size="sm" variant={scope === "account" ? "default" : "outline"}
                data-testid="scope-account"
                onClick={() => setScope("account")}
              >
                Across your account
              </Button>
            </div>
          )}
          {data && (
            <span className="ml-auto text-muted-foreground" data-testid="text-notification-counts">
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
        ) : data && !isError && data.items.length === 0 ? (
          <Card className="p-12 text-center text-sm text-muted-foreground" data-testid="text-notifications-empty">
            <Bell className="h-8 w-8 mx-auto mb-3 text-muted-foreground/40" />
            No notifications.
          </Card>
        ) : isError || !data ? (
          /* A failed read is NOT an empty inbox — it is never shown as one. */
          <Card className="p-12 text-center text-sm text-destructive" data-testid="text-notifications-error" role="alert">
            <Bell className="h-8 w-8 mx-auto mb-3 text-destructive/40" />
            Your notifications could not be loaded. They will be retried automatically.
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
                onClick={() => {
                  /* 2026-09-19 — classifier-decided destination; raw link is
                     never handed to the router. Handler change authorised by
                     the owner 2026-09-19 (scripts/silent-drop-guard/allowlist.json). */
                  performNotificationNavigation(
                    n,
                    /* Account-wide view: rows are labelled with their workspace, so a
                       cross-workspace click is explicit. Persona view: same-workspace only. */
                    { activeSurface: effectiveSurface, allowCrossWorkspace: effectiveSurface === "account" },
                    navigate,
                  );
                }}
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
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">{n.title}</span>
                    {!n.read && <Badge variant="default" className="text-[9px] h-4">NEW</Badge>}
                    {/* WAVE 149 · ITEM 4 (R77) — this badge printed the persisted
                        machine value. It is the same breach as NotificationBell's,
                        and this is the page the bell's "View all" lands on, so
                        fixing one without the other would only move it one click
                        away. `data-kind` on the Card still carries the raw value. */}
                    <Badge variant="outline" className="text-[9px] h-4 ml-auto">{notificationKindLabel(n.kind)}</Badge>
                    {effectiveSurface === "account" && (
                      <Badge variant="secondary" className="text-[9px] h-4" data-testid={`workspace-${n.id}`}>
                        {workspaceLabelFor(n)}
                      </Badge>
                    )}
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
