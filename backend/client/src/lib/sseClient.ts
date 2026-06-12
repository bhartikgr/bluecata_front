/**
 * v18 Phase D — Collective per-(chapter, topic) SSE client hook.
 *
 * Connects to GET /api/collective/stream?chapter_id=X&topics=a,b,c. Each
 * inbound event (`event: <topic>`) is dispatched via `onMessage`. Reconnect
 * on transient failure uses exponential backoff (1s → 30s capped).
 *
 *   const close = useCollectiveStream({
 *     chapterId,
 *     topics: ['questions','billing'],
 *     onMessage: (topic, data) => queryClient.invalidateQueries({ queryKey: [...] }),
 *   });
 *
 * No-ops when:
 *   - SSR (typeof window === 'undefined')
 *   - feature env says COLLECTIVE_ENABLED=0 (we just don't connect; the
 *     server would 503 anyway)
 *
 * Polling fallback is the responsibility of the call site (each page keeps
 * its existing polling tanstack-query refetchInterval — SSE only invalidates
 * earlier).
 */

import { useEffect, useRef } from "react";

export type CollectiveSseTopic =
  | "comms"
  | "events"
  | "dsc-votes"
  | "offers"
  | "questions"
  | "billing"
  /* v18 Phase A — chapter screening events. */
  | "screening_events"
  /* v19 Phase A — chapter announcements / resources / leaderboard. */
  | "announcements"
  | "resources"
  | "leaderboard"
  /* v19 Phase B — messaging + partner workspace. */
  | "messages"
  | "partner-workspace"
  | "collective-portfolio"
  | "spv"
  | "crm";

export interface UseCollectiveStreamArgs {
  chapterId: string;
  topics: CollectiveSseTopic[];
  /** Called for every event. `topic === 'lag'` indicates a queue-drop notice. */
  onMessage: (topic: CollectiveSseTopic | "lag", data: unknown) => void;
  /** Optional flag to opt out without removing the hook. */
  enabled?: boolean;
}

function backoffMs(attempt: number): number {
  // 1s, 2s, 4s, 8s, 16s, 30s, 30s, ...
  const base = Math.min(30_000, 1000 * Math.pow(2, Math.max(0, attempt - 1)));
  // Tiny jitter so a thundering-herd reconnect doesn't hammer.
  return base + Math.floor(Math.random() * 250);
}

/**
 * Opens an EventSource and dispatches events for the configured topics.
 * Returns nothing; the connection is managed for the component's lifetime.
 */
export function useCollectiveStream(args: UseCollectiveStreamArgs): void {
  const { chapterId, topics, onMessage, enabled } = args;
  // Stash the latest onMessage so we don't tear down the stream on re-render.
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (enabled === false) return;
    if (!chapterId) return;
    // Honor the deploy-time gate by short-circuiting when an env-injected
    // build flag says the feature is off. Most builds leave this unset.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    if (w?.__COLLECTIVE_ENABLED__ === false) return;

    let es: EventSource | null = null;
    let attempt = 0;
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const topicsParam = topics.join(",");

    const connect = (): void => {
      if (closed) return;
      const url = `/api/collective/stream?chapter_id=${encodeURIComponent(
        chapterId,
      )}&topics=${encodeURIComponent(topicsParam)}`;
      try {
        es = new EventSource(url);
      } catch {
        scheduleReconnect();
        return;
      }
      const dispatch = (topic: CollectiveSseTopic | "lag") =>
        (evt: MessageEvent): void => {
          try {
            const data = evt.data ? JSON.parse(evt.data) : null;
            onMessageRef.current(topic, data);
          } catch {
            onMessageRef.current(topic, evt.data ?? null);
          }
        };

      // Add a listener per known topic. Browsers only fire the matching
      // event name, so we register all six up front; unsubscribed topics
      // simply won't receive any frames from the server.
      const allTopics: Array<CollectiveSseTopic | "lag"> = [
        "comms",
        "events",
        "dsc-votes",
        "offers",
        "questions",
        "billing",
        "lag",
      ];
      for (const t of allTopics) {
        es.addEventListener(t, dispatch(t) as EventListener);
      }
      es.onopen = (): void => {
        attempt = 0;
      };
      es.onerror = (): void => {
        // EventSource auto-reconnects on its own per spec, but we replace
        // the underlying source so that backoff is deterministic and the
        // url params (chapter, topics) are re-resolved on every retry.
        if (es) {
          try { es.close(); } catch { /* noop */ }
          es = null;
        }
        scheduleReconnect();
      };
    };

    const scheduleReconnect = (): void => {
      if (closed) return;
      attempt += 1;
      const wait = backoffMs(attempt);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, wait);
    };

    connect();
    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (es) {
        try { es.close(); } catch { /* noop */ }
        es = null;
      }
    };
    // We intentionally re-open on chapter/topic change but ignore onMessage
    // identity (handled via the ref above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId, JSON.stringify(topics), enabled]);
}

export default useCollectiveStream;
