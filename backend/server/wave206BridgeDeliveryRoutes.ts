/* ═══════════════════════════════════════════════════════════════════════════
   WAVE 206 — ADMIN SURFACE FOR THE COLLECTIVE BRIDGE.                  R182.2
   ═══════════════════════════════════════════════════════════════════════════
   THE RULING: "push to live. I want it working and fully dynamic." Read with,
   from the same message, "Do not break anything or dramatically make
   assumptions to change things."

   Endpoints (all `requireAdmin`):
     GET  /api/admin/bridge/delivery-config   — what is set, where it came from,
                                                what is queued and where each
                                                event type could go
     POST /api/admin/bridge/delivery-config   — set one setting, audited
     POST /api/admin/bridge/backlog-drain     — DRY RUN unless `confirm: true`

   THREE THINGS THIS MODULE MUST NEVER DO, AND WHY
   ----------------------------------------------
   1. NEVER RETURN A SECRET. The signing secret is not stored in the database
      and is never read into a response. The read endpoint returns booleans and
      environment-variable NAMES. There is no branch here that can put secret
      characters into a body — not the value, not a prefix, not a length.
   2. NEVER DELIVER WITHOUT AN EXPLICIT CONFIRMATION. `POST backlog-drain`
      without `confirm: true` is a dry run and delivers nothing. Wave 204's
      pattern: dry run is the default, acting requires the flag.
   3. NEVER PRE-EMPT AN EXISTING ROUTE. These are three NEW paths. The existing
      `/api/bridge/drain` and `/api/admin/bridge/drain` guard behaviour, and
      `maySendOutboundBridge()`, are untouched — which is why turning delivery on
      here cannot start the background worker and cannot drain the backlog.

   The actor is always taken from the authenticated request context, never from
   the request body.
   ═══════════════════════════════════════════════════════════════════════════ */
import type { Express, Request, Response } from "express";
import { requireAdmin } from "./lib/authMiddleware";
import { sanitizeErrorMessage } from "./lib/sanitize";
import { log } from "./lib/logger";
import {
  describeDeliveryConfig,
  setWave206BridgeConfig,
  ensureWave206BridgeConfigKeys,
  Wave206ConfigRefusal,
  WAVE206_BRIDGE_CONFIG_KEYS,
  DRAIN_BATCH_LIMIT_CEILING,
  DRAIN_BATCH_LIMIT_FLOOR,
} from "./lib/wave206BridgeDeliveryConfig";
import { censusBacklog, planDrain, runDrain } from "./lib/wave206BridgeBacklog";
import { COLLECTIVE_RECEIVER_PATH } from "./lib/collectiveBridgeReceiver";

function actorOf(req: Request): { id: string; label: string } {
  const ctx = (req as Request & {
    userContext?: { identity?: { email?: string }; userId?: string };
  }).userContext;
  const id = String(ctx?.userId ?? ctx?.identity?.email ?? "u_unknown_admin");
  const label = String(ctx?.identity?.email ?? ctx?.userId ?? "unknown admin");
  return { id, label };
}

export function registerWave206BridgeDeliveryRoutes(app: Express): void {
  /* ── READ ──────────────────────────────────────────────────────────────────
     Everything the owner needs to answer "is this on, where is it pointing,
     where did that value come from, and what is waiting?" — without a secret
     leaving the server. */
  app.get("/api/admin/bridge/delivery-config", requireAdmin, (_req: Request, res: Response) => {
    try {
      const config = describeDeliveryConfig();
      const census = censusBacklog();
      res.json({
        ok: true,
        config,
        census,
        /* The receiver path is read from the receiver's own exported constant,
           never re-typed here, so this can never name an endpoint that does not
           exist. */
        expectedReceiverPath: COLLECTIVE_RECEIVER_PATH,
        settableKeys: WAVE206_BRIDGE_CONFIG_KEYS,
        batchLimitRange: { min: DRAIN_BATCH_LIMIT_FLOOR, max: DRAIN_BATCH_LIMIT_CEILING },
      });
    } catch (err) {
      log.error("[wave206BridgeDeliveryRoutes] read failed:", err);
      res.status(500).json({ ok: false, error: sanitizeErrorMessage(err) });
    }
  });

  /* ── WRITE ONE SETTING ─────────────────────────────────────────────────────
     Stored in `platform_config` through wave 11's hash-chained writer, audited
     through wave 186's writer. No second storage path, no second audit path. */
  app.post("/api/admin/bridge/delivery-config", requireAdmin, (req: Request, res: Response) => {
    const actor = actorOf(req);
    const body = (req.body ?? {}) as { key?: unknown; value?: unknown };
    if (typeof body.key !== "string") {
      res.status(400).json({
        ok: false,
        error: "Name the setting to change.",
        settableKeys: WAVE206_BRIDGE_CONFIG_KEYS,
      });
      return;
    }
    try {
      const result = setWave206BridgeConfig({
        key: body.key,
        value: body.value,
        actorUserId: actor.id,
        actorLabel: actor.label,
        route: "POST /api/admin/bridge/delivery-config",
      });
      /* The response echoes the stored value. Safe for all three keys: none of
         them holds a secret, by the design decision recorded in
         wave206BridgeDeliveryConfig.ts. */
      res.json({ ok: true, ...result, config: describeDeliveryConfig() });
    } catch (err) {
      if (err instanceof Wave206ConfigRefusal) {
        res.status(400).json({ ok: false, code: err.code, error: err.message });
        return;
      }
      log.error("[wave206BridgeDeliveryRoutes] write failed:", err);
      res.status(500).json({ ok: false, error: sanitizeErrorMessage(err) });
    }
  });

  /* ── DRAIN ─────────────────────────────────────────────────────────────────
     DRY RUN BY DEFAULT. `confirm` must be the boolean `true` — not "true", not
     1, not any truthy value — so a stray form field cannot become a delivery. */
  app.post("/api/admin/bridge/backlog-drain", requireAdmin, async (req: Request, res: Response) => {
    const actor = actorOf(req);
    const body = (req.body ?? {}) as { confirm?: unknown; limit?: unknown };
    const confirm = body.confirm === true;
    const requestedLimit =
      typeof body.limit === "number" && Number.isFinite(body.limit) ? Math.floor(body.limit) : null;
    try {
      ensureWave206BridgeConfigKeys();
      const outcome = await runDrain({
        requestedLimit,
        confirm,
        actorUserId: actor.id,
        actorLabel: actor.label,
        route: "POST /api/admin/bridge/backlog-drain",
      });
      res.json({ ok: true, ...outcome });
    } catch (err) {
      log.error("[wave206BridgeDeliveryRoutes] drain failed:", err);
      res.status(500).json({ ok: false, error: sanitizeErrorMessage(err) });
    }
  });

  /* ── PLAN ONLY ─────────────────────────────────────────────────────────────
     A GET that cannot possibly deliver, for anyone who wants to look without
     the risk of a POST. Same selection as the drain, so the two cannot
     disagree. */
  app.get("/api/admin/bridge/backlog-plan", requireAdmin, (req: Request, res: Response) => {
    try {
      const raw = req.query.limit;
      const asNumber = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
      const requestedLimit = Number.isFinite(asNumber) ? Math.floor(asNumber) : null;
      res.json({ ok: true, dryRun: true, plan: planDrain(requestedLimit) });
    } catch (err) {
      log.error("[wave206BridgeDeliveryRoutes] plan failed:", err);
      res.status(500).json({ ok: false, error: sanitizeErrorMessage(err) });
    }
  });
}
