/**
 * Sprint 20 Wave 2 — Investor Notifications page at /investor/notifications.
 *
 * Full-page notification center. Lists all notifications with read/unread state,
 * kind filter chips, and mark-all-read action. Mirrors the notification bell
 * dropdown but with full history visible.
 */
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { surfaceForPathname } from "@shared/notificationDestination";
import {
  useNotifications,
  useNotificationStream,
  invalidateNotifications,
  markAllReadScoped,
  type NotificationItem as Notification,
} from "@/lib/useNotifications";
import { performNotificationNavigation } from "@/lib/notificationNavigate";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bell, CheckCheck, BellOff } from "lucide-react";
import { useEntitlement } from "@/lib/entitlement";
import { notificationKindLabel } from "@/lib/investorLabels";
/* 2026-09-19 — the per-row badge uses the SHARED human label the bell and the
   neutral center use (dotted kinds such as `partner.referral_received`), not a
   machine value with underscores swapped for spaces. */
import { notificationKindLabel as sharedNotificationKindLabel } from "@/lib/notificationKindLabels";

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

const KIND_CHIPS = ["all", "invitation", "round_update", "message", "collective", "portfolio"];

export default function InvestorNotificationsPage() {
  // DEF-006: remove role-keyed fallback chain; block until userId resolves.
  const { data: entCtx, isLoading: entLoading } = useEntitlement();
  const userId = entCtx?.userId;
  const [kindFilter, setKindFilter] = useState("all");
  const [location, navigate] = useLocation();
  /* 2026-09-19 — this page is mounted at BOTH /investor/notifications and
     /founder/notifications. The surface is the one the ROUTE names, so the
     founder mount lists and counts founder rows and the investor mount investor
     rows; a multi-role user sees each workspace's notices in that workspace. */
  const surface = useMemo(() => {
    const s = surfaceForPathname(location);
    return s === "investor" || s === "founder" ? s : "investor";
  }, [location]);

  const { data, isLoading, isError } = useNotifications(userId ?? "", surface);
  useNotificationStream(userId ?? "", surface);

  const filtered = useMemo(() => {
    const items = data?.items ?? [];
    if (kindFilter === "all") return items;
    return items.filter(n => n.kind.includes(kindFilter));
  }, [data, kindFilter]);

  const markAllRead = async () => {
    if (!userId) return;
    await markAllReadScoped(surface);
    await invalidateNotifications(queryClient, userId);
  };

  if (entLoading) {
    return (
      <>
        <PageHeader title="Notifications" description="Loading…" />
        <PageBody>
          <div className="space-y-2">
            <div className="h-12 w-full bg-muted animate-pulse rounded" />
            <div className="h-12 w-full bg-muted animate-pulse rounded" />
          </div>
        </PageBody>
      </>
    );
  }

  if (!userId) {
    return (
      <>
        <PageHeader title="Notifications" />
        <PageBody>
          <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="notif-sign-in-prompt">
            <BellOff className="h-4 w-4" />
            Sign in to view notifications.
          </div>
        </PageBody>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Your full notification history."
        breadcrumbs={[{ href: surface === "founder" ? "/founder/dashboard" : "/investor/dashboard", label: "Workspace" }, { label: "Notifications" }]}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={markAllRead}
            data-testid="button-mark-all-read-page"
          >
            <CheckCheck className="h-3.5 w-3.5 mr-1.5" /> Mark all read
          </Button>
        }
      />
      <PageBody data-testid="page-investor-notifications">
        {/* Kind filter chips */}
        <div className="flex flex-wrap gap-2 mb-4" data-testid="notif-kind-filter" data-surface={surface}>
          {KIND_CHIPS.map((k) => (
            <button
              key={k}
              onClick={() => {
                setKindFilter(k);
                // Sprint 23 Wave B: re-fire query on every chip click so data stays fresh.
                if (userId) void invalidateNotifications(queryClient, userId);
              }}
              data-testid={`chip-notif-kind-${k}`}
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                kindFilter === k
                  ? "bg-[hsl(0_100%_40%)] text-white border-transparent"
                  : "bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {notificationKindLabel(k)}
            </button>
          ))}
        </div>

        {/* Stats bar */}
        <div className="flex items-center gap-4 mb-4 text-sm text-muted-foreground">
          <span data-testid="text-total-notifs">{data?.total ?? 0} total</span>
          <span data-testid="text-unread-notifs">
            <Badge className="bg-[hsl(333_75%_55%)] text-white text-[10px]">{data?.unread ?? 0} unread</Badge>
          </span>
        </div>

        {/* Notification list */}
        {isLoading && (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 bg-muted animate-pulse rounded-md" />
            ))}
          </div>
        )}
        {!isLoading && !isError && filtered.length === 0 && (
          <Card>
            <CardContent className="py-16 text-center text-sm text-muted-foreground">
              <BellOff className="h-8 w-8 mx-auto mb-3 text-muted-foreground/40" />
              {kindFilter === "all" ? "You're all caught up." : `No ${notificationKindLabel(kindFilter).toLowerCase()} notifications.`}
            </CardContent>
          </Card>
        )}
        {isError && (
          /* 2026-09-19 — a failed read is never presented as "caught up". */
          <Card>
            <CardContent className="py-16 text-center text-sm text-destructive" data-testid="text-notifications-error" role="alert">
              Your notifications could not be loaded. They will be retried automatically.
            </CardContent>
          </Card>
        )}
        <div className="space-y-2">
          {filtered.map(n => (
            <Card
              key={n.id}
              data-testid={`notification-${n.id}`}
              data-kind={n.kind}
              className={`transition-colors ${n.link ? "cursor-pointer hover:bg-accent/30" : ""} ${n.read ? "" : "border-[hsl(0_100%_40%)]/30 bg-[hsl(0_100%_40%)]/3"}`}
              onClick={() => {
                /* 2026-09-19 — rows were not actionable here; destination is
                   decided by the shared classifier (never the raw stored link). */
                performNotificationNavigation(n, { activeSurface: surface }, navigate);
              }}
            >
              <CardContent className="p-4 flex items-start gap-3">
                <Bell className={`h-4 w-4 mt-0.5 shrink-0 ${n.read ? "text-muted-foreground" : "text-[hsl(0_100%_40%)]"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{n.title}</span>
                    {!n.read && (
                      <span className="h-1.5 w-1.5 rounded-full bg-[hsl(333_75%_55%)] shrink-0" />
                    )}
                    <Badge variant="outline" className="text-[9px] ml-auto">{sharedNotificationKindLabel(n.kind)}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{n.body}</p>
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0 whitespace-nowrap">{relTime(n.createdAt)}</span>
              </CardContent>
            </Card>
          ))}
        </div>
      </PageBody>
    </>
  );
}
