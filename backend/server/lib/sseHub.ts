/**
 * v18 Phase D — Per-(chapter, topic) Server-Sent Events broker for the
 * Capavate Collective real-time layer.
 *
 * Distinct from the legacy sprint-17 `eventBus.ts` (which fans out a single
 * global "mutation" event stream). This hub is topic- and chapter-scoped
 * for the Collective surface and supports:
 *
 *   - Topics: 'comms' | 'events' | 'dsc-votes' | 'offers' | 'questions' | 'billing'
 *   - Per-subscriber bounded queue (256 in-flight events). When the queue
 *     overflows, the oldest event is dropped and a 'lag' notice is delivered
 *     in its place so the client knows it missed something.
 *   - Subscribers are identified by (userId, connectionId). Disconnect
 *     closes the iterator and unregisters cleanly.
 *   - No global queue — fan-out is per-subscriber so a slow client cannot
 *     back-pressure the publisher (which itself is OUTSIDE the SYNC tx).
 *
 * Publishers call `publish(chapterId, topic, data)` AFTER their SYNC
 * transaction has committed. This guarantees the DB write is not blocked
 * by a slow subscriber's send buffer.
 *
 * Heartbeat: a 30s `:hb\n\n` SSE comment frame so proxies do not close the
 * connection mid-idle. Initial frame is `:connected\n\n`.
 */

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

// ─────────────────────────────────────────────────────────────
// Topic catalog. Keep in sync with the client.
// ─────────────────────────────────────────────────────────────
export const SSE_TOPICS = [
  "comms",
  "events",
  "dsc-votes",
  "offers",
  "questions",
  "billing",
  // v19 Phase A — secondary surfaces.
  "announcements",
  "resources",
  "leaderboard",
  // v19 Phase B — messaging + partner workspace.
  "messages",
  "partner-workspace",
  "collective-portfolio",
  // CP Phase A — SPV / fund DB migration + partner CRM hash chain.
  "spv",
  "crm",
  // CP Phase B — apply flow, promotion moderation, GDPR.
  "consortium-apply",
  "promotion-moderation",
  "gdpr",
] as const;
export type SseTopic = (typeof SSE_TOPICS)[number];

export function isValidTopic(t: string): t is SseTopic {
  return (SSE_TOPICS as readonly string[]).includes(t);
}

// ─────────────────────────────────────────────────────────────
// Bounded queue.
//
// Each subscriber gets its own queue (max 256 in-flight events). When full,
// the oldest is dropped and a synthetic { __lag: true } notice is appended.
// ─────────────────────────────────────────────────────────────
export const SSE_QUEUE_MAX = 256;

export interface SseEvent {
  topic: SseTopic | "lag";
  data: unknown;
  ts: number;
}

interface Subscriber {
  userId: string;
  connectionId: string;
  chapterId: string;
  topics: Set<SseTopic>;
  queue: SseEvent[];
  /** Resolver for the next pending pull, if the iterator is awaiting. */
  pending: ((evt: SseEvent | null) => void) | null;
  /** True after `close()` — iterator yields then completes. */
  closed: boolean;
  /** Stats. */
  dropped: number;
  delivered: number;
}

// Map<chapterId, Map<connectionId, Subscriber>>
const byChapter: Map<string, Map<string, Subscriber>> = new Map();

// Lightweight event emitter so test helpers can await delivery.
const bus = new EventEmitter();
bus.setMaxListeners(10_000);

function chapterMap(chapterId: string): Map<string, Subscriber> {
  let m = byChapter.get(chapterId);
  if (!m) {
    m = new Map();
    byChapter.set(chapterId, m);
  }
  return m;
}

// ─────────────────────────────────────────────────────────────
// publish() — called by stores AFTER the SYNC tx commits.
//
// Never throws. Never blocks. Pushes onto each interested subscriber's
// bounded queue. If the queue is full, drop oldest and replace its head
// with a 'lag' notice.
// ─────────────────────────────────────────────────────────────
export function publish(chapterId: string, topic: SseTopic, data: unknown): void {
  if (!chapterId || !isValidTopic(topic)) return;
  const m = byChapter.get(chapterId);
  if (!m || m.size === 0) {
    bus.emit("publish", { chapterId, topic, data });
    return;
  }
  const evt: SseEvent = { topic, data, ts: Date.now() };
  m.forEach((sub) => {
    if (sub.closed) return;
    if (!sub.topics.has(topic)) return;
    enqueue(sub, evt);
  });
  bus.emit("publish", { chapterId, topic, data });
}

function enqueue(sub: Subscriber, evt: SseEvent): void {
  if (sub.queue.length >= SSE_QUEUE_MAX) {
    // Drop oldest, append a 'lag' notice in its slot.
    sub.queue.shift();
    sub.dropped++;
    sub.queue.push({
      topic: "lag",
      data: { dropped: sub.dropped, message: "queue_overflow_oldest_dropped" },
      ts: Date.now(),
    });
  }
  sub.queue.push(evt);
  // Wake any waiting consumer.
  if (sub.pending) {
    const resolve = sub.pending;
    sub.pending = null;
    const next = sub.queue.shift()!;
    sub.delivered++;
    resolve(next);
  }
}

// ─────────────────────────────────────────────────────────────
// subscribe() — register a new subscriber. Returns:
//   - async iterator that yields SseEvent in order until close()
//   - close() to terminate and unregister.
// ─────────────────────────────────────────────────────────────
export interface SubscribeArgs {
  userId: string;
  chapterId: string;
  topics: SseTopic[];
  /** Optional pre-generated connection id (useful for tests). */
  connectionId?: string;
}

export interface Subscription {
  connectionId: string;
  iterator: AsyncIterableIterator<SseEvent>;
  close: () => void;
  stats: () => { delivered: number; dropped: number; queueDepth: number };
}

export function subscribe(args: SubscribeArgs): Subscription {
  const connectionId = args.connectionId ?? randomUUID();
  const sub: Subscriber = {
    userId: args.userId,
    connectionId,
    chapterId: args.chapterId,
    topics: new Set(args.topics),
    queue: [],
    pending: null,
    closed: false,
    dropped: 0,
    delivered: 0,
  };
  chapterMap(args.chapterId).set(connectionId, sub);
  bus.emit("subscribe", { chapterId: args.chapterId, connectionId, userId: args.userId });

  const close = (): void => {
    if (sub.closed) return;
    sub.closed = true;
    // Resolve any pending pull with null → iterator completes.
    if (sub.pending) {
      const resolve = sub.pending;
      sub.pending = null;
      resolve(null);
    }
    const m = byChapter.get(args.chapterId);
    if (m) {
      m.delete(connectionId);
      if (m.size === 0) byChapter.delete(args.chapterId);
    }
    bus.emit("unsubscribe", { chapterId: args.chapterId, connectionId });
  };

  const iterator: AsyncIterableIterator<SseEvent> = {
    [Symbol.asyncIterator](): AsyncIterableIterator<SseEvent> {
      return iterator;
    },
    async next(): Promise<IteratorResult<SseEvent>> {
      if (sub.queue.length > 0) {
        const v = sub.queue.shift()!;
        sub.delivered++;
        return { value: v, done: false };
      }
      if (sub.closed) {
        return { value: undefined as unknown as SseEvent, done: true };
      }
      const result = await new Promise<SseEvent | null>((resolve) => {
        sub.pending = resolve;
      });
      if (result === null) {
        return { value: undefined as unknown as SseEvent, done: true };
      }
      return { value: result, done: false };
    },
    async return(): Promise<IteratorResult<SseEvent>> {
      close();
      return { value: undefined as unknown as SseEvent, done: true };
    },
  };

  return {
    connectionId,
    iterator,
    close,
    stats: () => ({
      delivered: sub.delivered,
      dropped: sub.dropped,
      queueDepth: sub.queue.length,
    }),
  };
}

// ─────────────────────────────────────────────────────────────
// Hub-level stats. Used by the chapter-admin dashboard's Health panel.
// ─────────────────────────────────────────────────────────────
export function hubStats(): {
  chapters: number;
  totalSubscribers: number;
  byChapter: Record<string, number>;
  topics: readonly SseTopic[];
} {
  const counts: Record<string, number> = {};
  let total = 0;
  byChapter.forEach((m, chapId) => {
    counts[chapId] = m.size;
    total += m.size;
  });
  return {
    chapters: byChapter.size,
    totalSubscribers: total,
    byChapter: counts,
    topics: SSE_TOPICS,
  };
}

export function chapterSubscriberCount(chapterId: string): number {
  return byChapter.get(chapterId)?.size ?? 0;
}

// Test-only helpers.
export const _internal = Object.freeze({
  bus,
  byChapter,
  /** Reset all state — for tests only. */
  reset: (): void => {
    byChapter.forEach((m) => {
      m.forEach((sub) => {
        sub.closed = true;
        if (sub.pending) {
          const r = sub.pending;
          sub.pending = null;
          r(null);
        }
      });
      m.clear();
    });
    byChapter.clear();
  },
});

export default { publish, subscribe, hubStats, chapterSubscriberCount, SSE_TOPICS };
