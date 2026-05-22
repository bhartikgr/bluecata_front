/**
 * Sprint 17 D4 — server-side event bus + realtime SSE distribution.
 *
 * Stores call `emitMutation({ aggregate, id, change })` after a write.
 * The bus fans out to:
 *   1. Outbound bridge (existing) — already wired upstream
 *   2. SSE subscribers via /api/events/stream — invalidation hints to
 *      React Query, so a founder edit shows up on the investor screen
 *      within ~1 second.
 */
import { EventEmitter } from "node:events";
import type { Request, Response } from "express";

export interface MutationEvent {
  aggregate: string;     // "company" | "round" | "softCircle" | etc.
  id: string;
  version?: number;
  change: "create" | "update" | "delete";
  tenantId?: string;
  ts: number;
}

const bus = new EventEmitter();
bus.setMaxListeners(1000);

export function emitMutation(e: Omit<MutationEvent, "ts"> & { ts?: number }): void {
  const evt: MutationEvent = { ts: Date.now(), ...e };
  bus.emit("mutation", evt);
}

export function onMutation(fn: (e: MutationEvent) => void): () => void {
  bus.on("mutation", fn);
  return () => bus.off("mutation", fn);
}

/* ============================================================
 *  /api/events/stream — SSE handler
 * ============================================================ */
export function realtimeStreamHandler(req: Request, res: Response) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  // Open with a hello frame so the client knows we're up
  res.write(`event: hello\ndata: {"ok":true,"ts":${Date.now()}}\n\n`);

  const off = onMutation(evt => {
    try {
      res.write(`event: mutation\ndata: ${JSON.stringify(evt)}\n\n`);
    } catch { /* client gone */ }
  });

  // Heartbeat every 25s keeps proxies happy
  const beat = setInterval(() => {
    try { res.write(`event: ping\ndata: ${Date.now()}\n\n`); } catch { /* gone */ }
  }, 25_000);

  req.on("close", () => {
    off();
    clearInterval(beat);
    try { res.end(); } catch { /* noop */ }
  });
}

export const realtimeBus = bus;
