/**
 * v25.46 Track 3 — Live Capital Pulse (SSE + polling fallback).
 *
 * Emits MILESTONE-level signals (not raw commits, no amounts):
 *   1. round.opened              — a founder publishes a new round
 *   2. round.soft_circle_placed  — an investor places a soft-circle commitment
 *   3. application.accepted       — an investor redeems/accepts a round invitation
 *
 * Endpoints:
 *   GET /api/pulse/stream                 — text/event-stream (EventSource)
 *   GET /api/pulse/recent?since=<iso>     — polling fallback (JSON)
 *
 * Privacy: investor names follow the MAE privacy contract via resolveDisplayName
 * (context 'collectiveDirectory'); founder/company names per existing visibility.
 *
 * SACRED COMPLIANCE:
 *   - 100% DB-driven (Tier 3 #27). Milestones are DERIVED READ-ONLY from the
 *     durable tables (rounds, soft_circles, round_invitations). No in-memory
 *     event log that would be lost on restart — a reconnecting client re-derives
 *     the same milestone set from the DB.
 *   - Does NOT touch the AVI Tier-2 sseHub.ts; this is a self-contained SSE
 *     writer scoped to the pulse surface only.
 *   - No raw transaction events; no commit amounts (spec-locked).
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "./lib/authMiddleware";
import { getUserContext } from "./lib/userContext";
import { resolveDisplayName } from "./lib/userPrivacyResolver";
import { rawDb } from "./db/connection";
import { log } from "./lib/logger";

export type PulseEventType =
  | "round.opened"
  | "round.soft_circle_placed"
  | "application.accepted";

export interface PulseEvent {
  id: string;
  type: PulseEventType;
  at: string; // ISO timestamp the milestone occurred
  companyName: string | null;
  roundName: string | null;
  /** Privacy-resolved actor label (investor name follows MAE; founder/company per visibility). */
  actorLabel: string | null;
}

const HEARTBEAT_INTERVAL_MS = 30_000;
const POLL_DEFAULT_LIMIT = 50;

function scalar<T>(sql: string, params: unknown[], fallback: T): T {
  try {
    const row: any = rawDb().prepare(sql).get(...(params as any[]));
    if (!row) return fallback;
    const v = Object.values(row)[0];
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function companyName(companyId: string | null): string | null {
  if (!companyId) return null;
  return scalar<string | null>(
    `SELECT name FROM companies WHERE id = ? LIMIT 1`,
    [companyId],
    null,
  );
}

/**
 * Derive recent pulse milestones from the durable tables, newest first.
 * `since` (ISO) optionally filters to milestones strictly after that instant.
 * `viewerUserId` drives MAE name resolution for investor actors.
 */
export function derivePulseEvents(
  viewerUserId: string | null,
  opts: { since?: string | null; limit?: number } = {},
): PulseEvent[] {
  const since = opts.since && typeof opts.since === "string" ? opts.since : null;
  const limit = Math.max(1, Math.min(200, opts.limit ?? POLL_DEFAULT_LIMIT));
  const events: PulseEvent[] = [];
  const db: any = rawDb();

  // 1. round.opened — rounds with state 'open'. Milestone time = open_date or created_at.
  try {
    const rows: any[] = db
      .prepare(
        `SELECT id, company_id, name, COALESCE(open_date, created_at) AS at
           FROM rounds
          WHERE state = 'open' AND deleted_at IS NULL
          ORDER BY at DESC
          LIMIT ?`,
      )
      .all(limit);
    for (const r of rows) {
      if (!r.at) continue;
      if (since && r.at <= since) continue;
      events.push({
        id: `round.opened:${r.id}`,
        type: "round.opened",
        at: r.at,
        companyName: companyName(r.company_id),
        roundName: r.name ?? null,
        actorLabel: companyName(r.company_id),
      });
    }
  } catch (err) {
    log.warn("[pulse] round.opened derive failed:", (err as Error).message);
  }

  // 2. round.soft_circle_placed — soft circles in a placed state.
  try {
    const rows: any[] = db
      .prepare(
        `SELECT id, round_id, company_id, investor_user_id, investor_name, created_at AS at
           FROM soft_circles
          WHERE status IN ('intent', 'confirmed', 'committed')
            AND deleted_at IS NULL
          ORDER BY created_at DESC
          LIMIT ?`,
      )
      .all(limit);
    for (const r of rows) {
      if (!r.at) continue;
      if (since && r.at <= since) continue;
      const investorLabel = r.investor_user_id
        ? resolveDisplayName(r.investor_user_id, viewerUserId, "collectiveDirectory", {
            legalName: r.investor_name ?? "",
          })
        : "Private Investor";
      const roundName = scalar<string | null>(
        `SELECT name FROM rounds WHERE id = ? LIMIT 1`,
        [r.round_id],
        null,
      );
      events.push({
        id: `round.soft_circle_placed:${r.id}`,
        type: "round.soft_circle_placed",
        at: r.at,
        companyName: companyName(r.company_id),
        roundName,
        actorLabel: investorLabel,
      });
    }
  } catch (err) {
    log.warn("[pulse] soft_circle derive failed:", (err as Error).message);
  }

  // 3. application.accepted — redeemed round invitations (investor accepted).
  try {
    const rows: any[] = db
      .prepare(
        `SELECT id, round_id, company_id, redeemed_by_user_id, investor_name, redeemed_at AS at
           FROM round_invitations
          WHERE state = 'redeemed' AND redeemed_at IS NOT NULL
            AND deleted_at IS NULL
          ORDER BY redeemed_at DESC
          LIMIT ?`,
      )
      .all(limit);
    for (const r of rows) {
      if (!r.at) continue;
      if (since && r.at <= since) continue;
      const investorLabel = r.redeemed_by_user_id
        ? resolveDisplayName(r.redeemed_by_user_id, viewerUserId, "collectiveDirectory", {
            legalName: r.investor_name ?? "",
          })
        : "Private Investor";
      const roundName = scalar<string | null>(
        `SELECT name FROM rounds WHERE id = ? LIMIT 1`,
        [r.round_id],
        null,
      );
      events.push({
        id: `application.accepted:${r.id}`,
        type: "application.accepted",
        at: r.at,
        companyName: companyName(r.company_id),
        roundName,
        actorLabel: investorLabel,
      });
    }
  } catch (err) {
    log.warn("[pulse] application.accepted derive failed:", (err as Error).message);
  }

  // Newest first across all three sources; cap to the requested limit.
  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return events.slice(0, limit);
}

export function registerPulseRoutes(app: Express): void {
  /* GET /api/pulse/recent?since=<iso> — polling fallback (JSON). */
  app.get("/api/pulse/recent", requireAuth, async (req: Request, res: Response) => {
    try {
      const ctx = await getUserContext(req);
      const viewerUserId = ctx?.userId ?? null;
      const since =
        typeof req.query.since === "string" && req.query.since.trim()
          ? req.query.since.trim()
          : null;
      const events = derivePulseEvents(viewerUserId, { since });
      const now = new Date().toISOString();
      return res.json({ ok: true, events, serverTime: now });
    } catch (err) {
      log.error("[pulse.recent] failed:", (err as Error).message);
      return res.status(500).json({ ok: false, error: "pulse_recent_failed" });
    }
  });

  /* GET /api/pulse/stream — SSE (text/event-stream).
   * Sends the current milestone snapshot, then heartbeats. On each heartbeat we
   * re-derive from the DB and push any milestone newer than the last sent. */
  app.get("/api/pulse/stream", requireAuth, async (req: Request, res: Response) => {
    let ctx: Awaited<ReturnType<typeof getUserContext>>;
    try {
      ctx = await getUserContext(req);
    } catch {
      return res.status(401).json({ ok: false, error: "unauthenticated" });
    }
    const viewerUserId = ctx?.userId ?? null;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // disable nginx buffering for SSE (Tier 8 #63)
    });
    res.write(`:connected\n\n`);

    let lastAt = new Date(0).toISOString();
    const flush = () => {
      try {
        const events = derivePulseEvents(viewerUserId, { since: null });
        // Send in chronological order so lastAt advances monotonically.
        const chronological = [...events].reverse();
        for (const ev of chronological) {
          if (ev.at > lastAt) {
            res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
            lastAt = ev.at;
          }
        }
      } catch {
        /* swallow; heartbeat keeps the connection alive */
      }
    };
    // Initial snapshot.
    flush();

    const hb = setInterval(() => {
      try {
        res.write(`:hb\n\n`);
        flush();
      } catch {
        /* connection likely closed */
      }
    }, HEARTBEAT_INTERVAL_MS);

    req.on("close", () => {
      clearInterval(hb);
      try {
        res.end();
      } catch {
        /* noop */
      }
    });
  });
}

export default registerPulseRoutes;
