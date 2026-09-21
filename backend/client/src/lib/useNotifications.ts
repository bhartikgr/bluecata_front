/**
 * Persona-scoped notification query hook — ONE query key shape for every
 * mounted consumer (bell, full inbox pages).
 *
 * 2026-09-19 · persona notification repair (slide 13a).
 *
 * Why a hook and not three inline `useQuery` calls: the bell, NotificationCenter
 * and the investor/founder inbox each built their own `/api/notifications?userId=`
 * string key, so a read-all in one place did not invalidate the others and no
 * consumer asked the server for a surface. Every consumer now:
 *   · asks for `?surface=<shell>` so list AND count come from the same scoped set;
 *   · shares the structured key `["notifications", userId, surface, filters]`
 *     so `invalidateQueries({ queryKey: ["notifications", userId] })` refreshes
 *     every view of that user at once after a mutation;
 *   · keeps the 30 s poll and refetch-on-focus as the guaranteed fallback;
 *   · optionally subscribes to the scoped SSE stream, which sends bounded
 *     durable-state INVALIDATIONS (not payloads) — on any event we refetch.
 *
 * `userId` is passed only to key the cache per session user. The server ignores
 * any client-supplied user id and answers for the session owner only.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { NotificationSurface } from "@shared/notificationDestination";
import type { ClassifiedDestination } from "@shared/notificationDestination";

export type NotificationItem = {
  id: string;
  userId: string;
  kind: string;
  title: string;
  body: string;
  link?: string;
  read: boolean;
  archived: boolean;
  createdAt: string;
  /** Present when served by the persona facade; absent from older fixtures. */
  destination?: ClassifiedDestination;
};

export type NotificationListing = {
  userId: string;
  total: number;
  unread: number;
  items: NotificationItem[];
  surface?: NotificationSurface;
  unclassified?: number;
  /** Un-archived rows of the owner that do NOT belong to this surface (0 for account). */
  outsideWorkspace?: number;
};

export type NotificationFilters = { unreadOnly?: boolean; archived?: boolean };

export const NOTIFICATIONS_QUERY_ROOT = "notifications" as const;

export function notificationsQueryKey(
  userId: string,
  surface: NotificationSurface,
  filters: NotificationFilters = {},
): readonly unknown[] {
  return [NOTIFICATIONS_QUERY_ROOT, userId, surface, { unreadOnly: !!filters.unreadOnly, archived: filters.archived ?? null }];
}

export function notificationsListUrl(surface: NotificationSurface, filters: NotificationFilters = {}): string {
  const params = new URLSearchParams();
  params.set("surface", surface);
  if (filters.unreadOnly) params.set("unreadOnly", "true");
  if (filters.archived !== undefined) params.set("archived", String(filters.archived));
  return `/api/notifications?${params.toString()}`;
}

export const NOTIFICATIONS_REFETCH_MS = 30_000;

export function useNotifications(
  userId: string,
  surface: NotificationSurface,
  filters: NotificationFilters = {},
) {
  const url = notificationsListUrl(surface, filters);
  return useQuery<NotificationListing>({
    queryKey: notificationsQueryKey(userId, surface, filters),
    queryFn: async () => {
      const res = await apiRequest("GET", url);
      return (await res.json()) as NotificationListing;
    },
    enabled: Boolean(userId),
    refetchInterval: NOTIFICATIONS_REFETCH_MS,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

/** Invalidate every notification view of this user (all surfaces, all filters). */
export function invalidateNotifications(qc: ReturnType<typeof useQueryClient>, userId: string): Promise<void> {
  return qc.invalidateQueries({ queryKey: [NOTIFICATIONS_QUERY_ROOT, userId] });
}

/** Mutations, always scoped. The server applies owner + surface filtering. */
export async function markAllReadScoped(surface: NotificationSurface): Promise<void> {
  await apiRequest("POST", "/api/notifications/read-all", { surface });
}

export async function patchNotificationsScoped(
  surface: NotificationSurface,
  ids: string[],
  change: { read?: boolean; archived?: boolean },
): Promise<{ ok: boolean; updated: number }> {
  const res = await apiRequest("PATCH", "/api/notifications", { ids, surface, ...change });
  return (await res.json()) as { ok: boolean; updated: number };
}

/**
 * Scoped SSE subscription. The stream carries INVALIDATIONS only; on
 * `notification` we refetch through the normal query path. Any error closes the
 * socket and the 30 s poll continues to carry the function. Returns whether the
 * stream said hello (for the bell's `data-sse-alive` attribute).
 */
export function useNotificationStream(userId: string, surface: NotificationSurface): boolean {
  const qc = useQueryClient();
  const [alive, setAlive] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;
    if (!userId) return;
    // Skip SSE in production proxy env (no URL rewriting for EventSource); falls back to refetchInterval.
    const apiBase = ("__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__");
    if (!apiBase && /sites\.pplx\.app/.test(window.location.hostname)) {
      setAlive(false);
      return;
    }
    let es: EventSource | null = null;
    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      setAlive(false);
      if (es) { try { es.close(); } catch { /* noop */ } }
    };
    try {
      es = new EventSource(`${apiBase}/api/notifications/stream?surface=${encodeURIComponent(surface)}`);
      es.addEventListener("hello", () => setAlive(true));
      es.addEventListener("notification", () => { void invalidateNotifications(qc, userId); });
      es.addEventListener("bye", () => { void invalidateNotifications(qc, userId); close(); });
      es.onerror = () => close();
    } catch {
      setAlive(false);
    }
    return close;
  }, [userId, surface, qc]);
  return alive;
}
