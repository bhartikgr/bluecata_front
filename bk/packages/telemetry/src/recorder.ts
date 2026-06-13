/**
 * Telemetry recorder — appends events to a hash-chained log.
 *
 * In preview: in-memory store. In production: backed by Postgres with the same
 * schema; the `prevHash → hash` linkage is identical so swapping persistence is
 * a one-line change at the storage layer.
 */
import type { TelemetryEvent, TelemetryEventBody, TelemetryLocation } from "./events.js";

const GENESIS_PREV_HASH = "0".repeat(64);

/** FNV-1a → 64-bit hex; same algorithm shape as engine `sha256`. */
function fnv64(input: string, s1 = 0xcbf29ce4, s2 = 0x84222325): string {
  let h1 = s1 >>> 0, h2 = s2 >>> 0;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c; h2 ^= c;
    h1 = Math.imul(h1, 16777619) >>> 0;
    h2 = Math.imul(h2, 16777619) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

function hash256(input: string): string {
  return (
    fnv64(input, 0xcbf29ce4, 0x84222325)
    + fnv64(input, 0xdeadbeef, 0x13371337)
    + fnv64(input + "$1", 0xfeedface, 0xc0ffee01)
    + fnv64(input + "$2", 0xa5a5a5a5, 0x5a5a5a5a)
  ).slice(0, 64);
}

function canonical(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "bigint") return JSON.stringify(value.toString() + "n");
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return "{" + keys.map((k) =>
    JSON.stringify(k) + ":" + canonical((value as Record<string, unknown>)[k])
  ).join(",") + "}";
}

export type RecordContext = {
  companyId: string;
  roundId?: string;
  actorId: string;
  actorRole: TelemetryEvent["actorRole"];
  ipAddress?: string;
  location?: TelemetryLocation;
  userAgent?: string;
  sessionId?: string;
  timestamp?: string;
};

export class TelemetryStore {
  private events: TelemetryEvent[] = [];
  private listeners: Set<(events: TelemetryEvent[]) => void> = new Set();

  get length(): number { return this.events.length; }
  get head(): string {
    return this.events.length === 0 ? GENESIS_PREV_HASH : this.events[this.events.length - 1].hash;
  }

  list(): TelemetryEvent[] { return this.events; }

  /** Append a new event to the log. Returns the materialised event. */
  recordEvent(body: TelemetryEventBody, ctx: RecordContext): TelemetryEvent {
    const prevHash = this.head;
    const id = `evt-${this.events.length + 1}-${(Math.random().toString(36).slice(2, 8))}`;
    const candidate = {
      ...body,
      id,
      companyId: ctx.companyId,
      roundId: ctx.roundId,
      actorId: ctx.actorId,
      actorRole: ctx.actorRole,
      timestamp: ctx.timestamp ?? new Date().toISOString(),
      ipAddress: ctx.ipAddress,
      location: ctx.location,
      userAgent: ctx.userAgent,
      sessionId: ctx.sessionId,
      prevHash,
    };
    const hash = hash256(canonical(candidate));
    const finalEvent: TelemetryEvent = { ...candidate, hash };
    this.events.push(finalEvent);
    for (const fn of this.listeners) fn(this.events);
    return finalEvent;
  }

  /** Bulk seed — preserves chain ordering. */
  bulkSeed(items: Array<{ body: TelemetryEventBody; ctx: RecordContext }>): void {
    for (const it of items) this.recordEvent(it.body, it.ctx);
  }

  filter(pred: (e: TelemetryEvent) => boolean): TelemetryEvent[] {
    return this.events.filter(pred);
  }

  subscribe(fn: (events: TelemetryEvent[]) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** Verify the chain — every prevHash must match its predecessor's hash. */
  verifyChain(): { valid: boolean; brokenAt?: number; length: number } {
    if (this.events.length === 0) return { valid: true, length: 0 };
    for (let i = 0; i < this.events.length; i++) {
      const e = this.events[i];
      const expectedPrev = i === 0 ? GENESIS_PREV_HASH : this.events[i - 1].hash;
      if (e.prevHash !== expectedPrev) return { valid: false, brokenAt: i, length: this.events.length };
      const { hash, ...rest } = e;
      const recomputed = hash256(canonical(rest));
      if (recomputed !== hash) return { valid: false, brokenAt: i, length: this.events.length };
    }
    return { valid: true, length: this.events.length };
  }
}

/** Default singleton — useful for in-process apps. */
export const defaultTelemetryStore = new TelemetryStore();

export function recordEvent(body: TelemetryEventBody, ctx: RecordContext): TelemetryEvent {
  return defaultTelemetryStore.recordEvent(body, ctx);
}
