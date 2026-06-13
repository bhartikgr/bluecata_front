/**
 * Sprint 20 Wave 2 — Investor Notifications page at /investor/notifications.
 *
 * Full-page notification center. Lists all notifications with read/unread state,
 * kind filter chips, and mark-all-read action. Mirrors the notification bell
 * dropdown but with full history visible.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bell, CheckCheck, BellOff } from "lucide-react";
import { useEntitlement } from "@/lib/entitlement";

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

const KIND_CHIPS = ["all", "invitation", "round_update", "message", "collective", "portfolio"];

export default function InvestorNotificationsPage() {
  // DEF-006: remove role-keyed fallback chain; block until userId resolves.
  const { data: entCtx, isLoading: entLoading } = useEntitlement();
  const userId = entCtx?.userId;
  const [kindFilter, setKindFilter] = useState("all");

  const { data, isLoading } = useQuery<NotifList>({
    queryKey: [`/api/notifications?userId=${userId}`],
    refetchInterval: 30_000,
    enabled: !!userId,
  });

  const filtered = useMemo(() => {
    const items = data?.items ?? [];
    if (kindFilter === "all") return items;
    return items.filter(n => n.kind.includes(kindFilter));
  }, [data, kindFilter]);

  const markAllRead = async () => {
    if (!userId) return;
    await apiRequest("POST", "/api/notifications/read-all", { userId });
    queryClient.invalidateQueries({ queryKey: [`/api/notifications?userId=${userId}`] });
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
        breadcrumbs={[{ href: "/investor/dashboard", label: "Workspace" }, { label: "Notifications" }]}
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
        <div className="flex flex-wrap gap-2 mb-4" data-testid="notif-kind-filter">
          {KIND_CHIPS.map((k) => (
            <button
              key={k}
              onClick={() => {
                setKindFilter(k);
                // Sprint 23 Wave B: re-fire query on every chip click so data stays fresh.
                queryClient.invalidateQueries({ queryKey: [`/api/notifications?userId=${userId}`] });
              }}
              data-testid={`chip-notif-kind-${k}`}
              className={`px-3 py-1 text-xs rounded-full border capitalize transition-colors ${
                kindFilter === k
                  ? "bg-[hsl(184_98%_22%)] text-white border-transparent"
                  : "bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {k}
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
        {!isLoading && filtered.length === 0 && (
          <Card>
            <CardContent className="py-16 text-center text-sm text-muted-foreground">
              <BellOff className="h-8 w-8 mx-auto mb-3 text-muted-foreground/40" />
              {kindFilter === "all" ? "You're all caught up." : `No ${kindFilter} notifications.`}
            </CardContent>
          </Card>
        )}
        <div className="space-y-2">
          {filtered.map(n => (
            <Card
              key={n.id}
              data-testid={`notification-${n.id}`}
              className={`transition-colors ${n.read ? "" : "border-[hsl(184_98%_22%)]/30 bg-[hsl(184_98%_22%)]/3"}`}
            >
              <CardContent className="p-4 flex items-start gap-3">
                <Bell className={`h-4 w-4 mt-0.5 shrink-0 ${n.read ? "text-muted-foreground" : "text-[hsl(184_98%_22%)]"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{n.title}</span>
                    {!n.read && (
                      <span className="h-1.5 w-1.5 rounded-full bg-[hsl(333_75%_55%)] shrink-0" />
                    )}
                    <Badge variant="outline" className="text-[9px] uppercase ml-auto">{n.kind.replace(/_/g, " ")}</Badge>
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
