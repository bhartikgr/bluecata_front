/**
 * WAVE 16 — ORP-042: the market-pulse READ surface.
 *
 * Three server reads existed, were registered, and had ZERO callers tree-wide:
 *   · GET /api/pulse/recent?since=<iso>   server/pulseStream.ts:194   (JSON poll)
 *   · GET /api/pulse/stream               server/pulseStream.ts:214   (SSE)
 *   · GET /api/pulse/symbols              server/pulseSymbolRoutes.ts:140 (authed)
 * Registered for real: `registerPulseRoutes(app)` at server/v2546Routes.ts:201 and
 * `registerPulseSymbolRoutes(app)` at server/routes.ts:1097. Engine live, no reader —
 * so this is WIRING, not a build. No new route, no new table, no migration.
 *
 * TRANSPORT CONTRACT, read off the writer rather than assumed:
 *   · The stream writes NAMED events — `event: round.opened` etc.
 *     (pulseStream.ts:238). A plain `onmessage` handler receives NOTHING from this
 *     server, because `onmessage` only fires for unnamed events. Each of the three
 *     types is therefore subscribed explicitly via addEventListener.
 *   · Heartbeats are SSE COMMENTS (`:hb`, `:connected` — pulseStream.ts:229/:251),
 *     which are invisible to EventSource by design. "Connected but quiet" and
 *     "silently broken" are therefore indistinguishable from payloads alone, so
 *     liveness is reported from `onopen`/`onerror`, never inferred from silence.
 *   · Every flush re-derives the whole set from the DB and re-sends anything newer
 *     than the last sent instant (`:232`). A reconnect legitimately replays, so the
 *     merge is keyed by event id — appending blindly would double-render.
 *
 * NO PRICES ARE SHOWN. `pulse_index_symbols` carries symbol/label/category/cadence
 * and no quote at all (server/pulseSymbolStore.ts:16), and there is no quote route
 * for these symbols anywhere in the tree. The watchlist therefore renders as a
 * watchlist and says so; inventing a price would be worse than showing none.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Radio, WifiOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";

export type PulseEventType =
  | "round.opened"
  | "round.soft_circle_placed"
  | "application.accepted";

/** Mirrors `PulseEvent` at server/pulseStream.ts:37. */
export interface PulseEvent {
  id: string;
  type: PulseEventType;
  at: string;
  companyName: string | null;
  roundName: string | null;
  actorLabel: string | null;
}

export interface PulseSymbol {
  symbol: string;
  label: string | null;
  category: string | null;
  refreshSeconds: number;
  sortOrder: number;
}

/** The three named event types the writer emits — kept in this order for display. */
export const PULSE_EVENT_TYPES: readonly PulseEventType[] = [
  "round.opened",
  "round.soft_circle_placed",
  "application.accepted",
];

export const PULSE_EVENT_LABEL: Record<PulseEventType, string> = {
  "round.opened": "Round opened",
  "round.soft_circle_placed": "Soft circle placed",
  "application.accepted": "Invitation accepted",
};

/** Poll cadence for the fallback path; the writer heartbeats every 30s. */
export const PULSE_POLL_INTERVAL_MS = 30_000;
export const PULSE_MAX_ROWS = 50;

/** Minimal EventSource shape, so the transport can be substituted in tests. */
export interface PulseSource {
  addEventListener(type: string, listener: (ev: MessageEvent) => void): void;
  close(): void;
  onopen: ((ev: Event) => void) | null;
  onerror: ((ev: Event) => void) | null;
}

export type PulseSourceFactory = (url: string) => PulseSource;

function defaultSourceFactory(url: string): PulseSource {
  return new EventSource(url, { withCredentials: true }) as unknown as PulseSource;
}

function sourceAvailable(): boolean {
  return typeof EventSource !== "undefined";
}

function fmtWhen(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Newest first, de-duplicated by event id, capped. */
export function mergePulseEvents(
  existing: readonly PulseEvent[],
  incoming: readonly PulseEvent[],
): PulseEvent[] {
  const byId = new Map<string, PulseEvent>();
  for (const ev of existing) byId.set(ev.id, ev);
  for (const ev of incoming) byId.set(ev.id, ev);
  // Array.from, not [...spread]: this tsconfig targets below es2015 without
  // --downlevelIteration, so spreading a MapIterator is a TS2802. Wave 7B hit the
  // same error spreading a Set. Array.from is the codebase-compatible form.
  return Array.from(byId.values())
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, PULSE_MAX_ROWS);
}

export function LiveCapitalPulse({
  sourceFactory,
}: {
  /** Production mounts pass nothing; the default is the browser's EventSource. */
  sourceFactory?: PulseSourceFactory;
}) {
  const [streamed, setStreamed] = useState<PulseEvent[]>([]);
  const [live, setLive] = useState(false);
  /** Null until we know: only a real onerror or a missing EventSource sets it. */
  const [streamFailed, setStreamFailed] = useState(false);
  const closedRef = useRef(false);

  const canStream = Boolean(sourceFactory) || sourceAvailable();
  const polling = !canStream || streamFailed;

  const recent = useQuery<{ events: PulseEvent[]; serverTime: string }>({
    queryKey: ["/api/pulse/recent"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/pulse/recent");
      const body = (await res.json()) as { events?: PulseEvent[]; serverTime?: string };
      return { events: body.events ?? [], serverTime: body.serverTime ?? "" };
    },
    /* The poll is the FALLBACK, but it also seeds the first paint on the stream
       path — the stream's opening flush only carries milestones, never a count,
       so without this seed an empty list would be ambiguous. */
    refetchInterval: polling ? PULSE_POLL_INTERVAL_MS : false,
  });

  const symbols = useQuery<PulseSymbol[]>({
    queryKey: ["/api/pulse/symbols"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/pulse/symbols");
      const body = (await res.json()) as { symbols?: PulseSymbol[] };
      return body.symbols ?? [];
    },
  });

  useEffect(() => {
    if (!canStream) return;
    closedRef.current = false;
    let src: PulseSource;
    try {
      src = (sourceFactory ?? defaultSourceFactory)("/api/pulse/stream");
    } catch {
      setStreamFailed(true);
      return;
    }
    // Named events only — see the transport contract in the file header.
    for (const type of PULSE_EVENT_TYPES) {
      src.addEventListener(type, (ev: MessageEvent) => {
        try {
          const parsed = JSON.parse(String(ev.data)) as PulseEvent;
          if (!parsed || typeof parsed.id !== "string") return;
          setStreamed((prev) => mergePulseEvents(prev, [parsed]));
        } catch {
          /* A malformed frame must not tear down a working stream. */
        }
      });
    }
    src.onopen = () => {
      if (closedRef.current) return;
      setLive(true);
      setStreamFailed(false);
    };
    src.onerror = () => {
      if (closedRef.current) return;
      setLive(false);
      setStreamFailed(true);
    };
    return () => {
      closedRef.current = true;
      try {
        src.close();
      } catch {
        /* noop */
      }
    };
  }, [canStream, sourceFactory]);

  const events = useMemo(
    () => mergePulseEvents(recent.data?.events ?? [], streamed),
    [recent.data, streamed],
  );

  const transportCopy = live
    ? "Streaming live."
    : polling
      ? `Live stream unavailable — refreshing every ${PULSE_POLL_INTERVAL_MS / 1000} seconds instead.`
      : "Connecting to the live stream…";

  return (
    <Card className="mb-6" data-testid="card-live-capital-pulse">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4" /> Live capital pulse
        </CardTitle>
        <p className="text-sm text-muted-foreground mt-0.5">
          Platform-wide funding milestones as they happen. Names follow directory privacy rules, and
          no commitment amounts are published here.
        </p>
        <p
          className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1.5"
          data-testid="pulse-transport"
        >
          {live ? <Radio className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
          {transportCopy}
        </p>
      </CardHeader>
      <CardContent>
        {recent.isLoading && events.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center" data-testid="pulse-loading">
            Loading recent milestones…
          </div>
        ) : events.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center" data-testid="pulse-empty">
            No funding milestones have been recorded yet.
          </div>
        ) : (
          <ul className="divide-y divide-border -mx-2" data-testid="pulse-list">
            {events.map((ev) => (
              <li key={ev.id} className="px-2 py-3" data-testid={`pulse-row-${ev.id}`}>
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[10px]" data-testid={`pulse-kind-${ev.id}`}>
                        {PULSE_EVENT_LABEL[ev.type] ?? ev.type}
                      </Badge>
                      <span className="font-medium text-sm" data-testid={`pulse-company-${ev.id}`}>
                        {ev.companyName ?? "Undisclosed company"}
                      </span>
                      {ev.roundName ? (
                        <span className="text-sm text-muted-foreground">{ev.roundName}</span>
                      ) : null}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5" data-testid={`pulse-actor-${ev.id}`}>
                      {ev.actorLabel ?? "Participant withheld"}
                    </div>
                  </div>
                  <div className="text-[11px] text-muted-foreground shrink-0" data-testid={`pulse-when-${ev.id}`}>
                    {fmtWhen(ev.at)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Watchlist — the admin-curated symbol registry, rendered WITHOUT prices. */}
        <div className="mt-5 pt-4 border-t border-border" data-testid="pulse-watchlist">
          <div className="text-xs uppercase text-muted-foreground mb-2">Index watchlist</div>
          {(symbols.data?.length ?? 0) === 0 ? (
            <div className="text-sm text-muted-foreground" data-testid="pulse-watchlist-empty">
              No index symbols are enabled for this platform yet.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2" data-testid="pulse-watchlist-items">
              {(symbols.data ?? []).map((s) => (
                <Badge key={s.symbol} variant="secondary" className="font-mono text-[11px]" data-testid={`pulse-symbol-${s.symbol}`}>
                  {s.symbol}
                  {s.label ? <span className="ml-1.5 font-sans text-muted-foreground">{s.label}</span> : null}
                </Badge>
              ))}
            </div>
          )}
          {/* Honest scope: the registry stores no quote and no quote route exists. */}
          <div className="text-[11px] text-muted-foreground mt-2" data-testid="pulse-watchlist-note">
            Tracked symbols only — live quotes are not published on this surface.
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default LiveCapitalPulse;
