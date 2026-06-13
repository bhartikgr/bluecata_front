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
import { getUserContext } from "./userContext";
import { founderOwnedCompanyIds, investorVisibleCompanyIds, companyIdForRound } from "./tenantAuth";

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
  // B15 (v24.0 LOCKDOWN) — the SSE stream previously had NO auth and wrote
  // EVERY mutation event (aggregate + id + change for every tenant) to EVERY
  // connected client, leaking which companies/rounds/invitations changed across
  // tenant boundaries. We now (1) require an authenticated session, and (2)
  // filter each event so a client only receives events for resources it can
  // see. The event payload is only a cache-invalidation hint, but the ids it
  // carries are themselves tenant-sensitive.
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed || !ctx.userId) {
    res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    return;
  }
  const isAdmin = !!ctx.isAdmin;
  // Pre-compute the caller's accessible company set + tenant set.
  const accessibleCompanies = new Set<string>();
  founderOwnedCompanyIds(ctx).forEach((id) => accessibleCompanies.add(id));
  investorVisibleCompanyIds(ctx).forEach((id) => accessibleCompanies.add(id));
  const accessibleTenants = new Set<string>();
  accessibleCompanies.forEach((cid) => accessibleTenants.add(`tenant_co_${cid}`));

  // Decide whether a single mutation event is visible to THIS caller.
  const eventVisibleToCaller = (evt: MutationEvent): boolean => {
    if (isAdmin) return true;
    // Tenant match (events that carry an explicit tenantId).
    if (evt.tenantId && accessibleTenants.has(evt.tenantId)) return true;
    // Resolve the event's company by aggregate type.
    if (evt.aggregate === "company") return accessibleCompanies.has(evt.id);
    if (evt.aggregate === "round") {
      const cid = companyIdForRound(evt.id);
      return !!cid && accessibleCompanies.has(cid);
    }
    // For aggregates we cannot resolve to a company/tenant (e.g. user-scoped
    // events whose id IS the caller's own userId), only forward when the id is
    // the caller themselves; otherwise fail closed.
    if (evt.id === ctx.userId) return true;
    return false;
  };

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  // Open with a hello frame so the client knows we're up
  res.write(`event: hello\ndata: {"ok":true,"ts":${Date.now()}}\n\n`);

  const off = onMutation(evt => {
    try {
      // B15 — tenant/company filter before writing to this client's stream.
      if (!eventVisibleToCaller(evt)) return;
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
