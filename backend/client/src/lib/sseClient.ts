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
  | "crm"
  /* v25.13 NM5 — chapter admin promote/demote events. */
  | "admins";

export interface UseCollectiveStreamArgs {
  /**
   * WAVE 18 / XT-7 — REQUIRED for chapter-scoped topics; IGNORED (and may be
   * "") when `scope: "partner"`. See `scope` below.
   */
  chapterId: string;
  topics: CollectiveSseTopic[];
  /** Called for every event. `topic === 'lag'` indicates a queue-drop notice. */
  onMessage: (topic: CollectiveSseTopic | "lag", data: unknown) => void;
  /** Optional flag to opt out without removing the hook. */
  enabled?: boolean;
  /**
   * WAVE 15 / ORP-052 — which server stream endpoint to open.
   *
   * `/api/collective/stream` (the DEFAULT, so every existing Collective call
   * site is untouched) is gated by `requireCollectiveEnabled` as well as
   * `requireAuth`. `/api/stream` (CP-034, `server/collectiveSseRoutes.ts:336`)
   * shares the exact same handler but gates on `requireAuth` and per-topic
   * authorization only, which is what a PARTNER surface needs: a partner has no
   * reason to be blocked by the Collective feature flag.
   *
   * That route was mounted with zero client callers. This option is the wiring;
   * no new server behaviour was written for it. The type is a closed union so a
   * caller cannot point the hook at an arbitrary URL.
   */
  path?: "/api/collective/stream" | "/api/stream";
  /**
   * WAVE 18 / XT-7 — chapter-scoped (the DEFAULT, so all eight existing call
   * sites are byte-for-byte unchanged) vs PARTNER-scoped.
   *
   * WHY THIS EXISTS. The partner topics (`spv`, `crm`, `partner-workspace`) are
   * not chapter-scoped at either end. The publisher scopes them to the
   * PARTNER id (`server/spvFundStore.ts:1571`, `partnerWorkspaceV19Store.ts:721`
   * — both call `ssePublish(ctx.partnerId, …)`), and the subscriber side
   * resolves that same partner id SERVER-SIDE from the session
   * (`server/collectiveSseRoutes.ts:157` `resolvePartnerId(userId)`) and
   * subscribes partner topics on it, ignoring `chapter_id` entirely
   * (`:218-227`). `chapter_id` is not merely unnecessary for these topics: the
   * server treats a supplied one as a REQUEST TO ENTER CHAPTER SCOPE and
   * applies the CP Phase C membership guard to it (`:175`).
   *
   * So the hook's `if (!chapterId) return;` guard — correct for chapter topics,
   * where a missing chapter would produce a 400 — was what actually kept the
   * partner surface off these streams: a partner page had nothing legitimate to
   * put in `chapterId`. `PartnerBilling.tsx:1526` got around it by having the
   * server hand back its own `sseScope` and passing that as the chapter id,
   * which works but requires an endpoint that volunteers the partner id.
   *
   * With `scope: "partner"` the `chapter_id` param is OMITTED from the URL and
   * the empty-chapter bail is skipped. Nothing about authorization moves: the
   * server still resolves the partner from the session, so a caller cannot
   * subscribe to another partner's stream by asking, and a non-partner asking
   * for partner topics still gets 403 `no_authorized_topics`. Both poles are
   * asserted in `server/__tests__/wave18_xt7_partner_stream.test.ts`.
   *
   * Chapter-scoped topics are NOT usable in this mode — the server 400s with
   * `missing_chapter_id`, which is the correct, visible refusal.
   */
  scope?: "chapter" | "partner";
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
  /* Defaulting here, not at the use site, keeps the six existing Collective
   * callers byte-for-byte behaviour-identical. */
  const path = args.path ?? "/api/collective/stream";
  /* XT-7 — defaulted here for the same reason `path` is: the existing callers
   * must not change shape. */
  const scope = args.scope ?? "chapter";
  // Stash the latest onMessage so we don't tear down the stream on re-render.
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (enabled === false) return;
    /* XT-7 — a chapter-scoped subscription still requires a chapter (without
     * one the server answers 400 `missing_chapter_id`), but a partner-scoped
     * one must NOT be gated on a chapter id it has no business inventing. */
    if (scope === "chapter" && !chapterId) return;
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
      const url =
        scope === "partner"
          ? /* XT-7 — chapter_id is OMITTED, not blanked: an empty-but-present
             * param is still a param, and the server's chapter-scope branch
             * keys off presence. */
            `${path}?topics=${encodeURIComponent(topicsParam)}`
          : `${path}?chapter_id=${encodeURIComponent(
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
      // event name, so we register every CollectiveSseTopic literal up
      // front; unsubscribed topics simply won't receive any frames from
      // the server. v25.13 NC1 — was previously only 6 topics; expanded
      // to all 15 + "lag" so leaderboard/screening_events/announcements/
      // resources/messages/partner-workspace/collective-portfolio/spv/crm
      // listeners actually receive their events.
      const allTopics: Array<CollectiveSseTopic | "lag"> = [
        "comms",
        "events",
        "dsc-votes",
        "offers",
        "questions",
        "billing",
        "screening_events",
        "announcements",
        "resources",
        "leaderboard",
        "messages",
        "partner-workspace",
        "collective-portfolio",
        "spv",
        "crm",
        "admins",
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
    // `path` is in the dependency list: switching endpoints must reconnect, not
    // keep serving the old socket while claiming the new route.
    /* `scope` joins the dependency list for the same reason `path` did:
     * switching scope must re-open the connection, not keep serving a socket
     * opened under the other one. */
  }, [chapterId, JSON.stringify(topics), enabled, path, scope]);
}

export default useCollectiveStream;
