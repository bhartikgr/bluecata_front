/**
 * v25.47 APD-022 — Pulse index symbol routes.
 *
 * Admin manages the DB-driven Pulse watchlist; authed users read the enabled
 * set. No hardcoded symbol list — the catalog lives entirely in
 * pulse_index_symbols (server/pulseSymbolStore.ts).
 *
 * Endpoints:
 *   GET   /api/admin/pulse-symbols                      (admin) — full catalog
 *   POST  /api/admin/pulse-symbols                      (admin) — upsert
 *   PATCH /api/admin/pulse-symbols/:symbol/enabled      (admin) — toggle
 *   GET   /api/pulse/symbols                            (authed) — enabled only
 */
import type { Express, Request, Response } from "express";
import { requireAdmin, requireAuth } from "./lib/authMiddleware";
import { appendAdminAudit } from "./adminPlatformStore";
import { sanitizeErrorMessage } from "./lib/sanitize";
import { log } from "./lib/logger";
import {
  listAllSymbols,
  listEnabledSymbols,
  getSymbol,
  upsertSymbol,
  setSymbolEnabled,
  isValidSymbol,
} from "./pulseSymbolStore";

function actorOf(req: Request): string {
  const ctx = (req as Request & {
    userContext?: { identity?: { email?: string }; userId?: string };
  }).userContext;
  return String(ctx?.identity?.email ?? ctx?.userId ?? "admin");
}

export function registerPulseSymbolRoutes(app: Express): void {
  // ADMIN — full catalog.
  app.get("/api/admin/pulse-symbols", requireAdmin, (_req: Request, res: Response) => {
    try {
      return res.json({ ok: true, symbols: listAllSymbols() });
    } catch (err) {
      log.error("[pulseSymbolRoutes.list] failed:", (err as Error).message);
      return res
        .status(500)
        .json({ ok: false, error: "read_failed", message: sanitizeErrorMessage(err) });
    }
  });

  // ADMIN — upsert one symbol.
  app.post("/api/admin/pulse-symbols", requireAdmin, (req: Request, res: Response) => {
    const b = req.body as {
      symbol?: unknown;
      label?: unknown;
      category?: unknown;
      enabled?: unknown;
      refreshSeconds?: unknown;
      sortOrder?: unknown;
    };
    if (!isValidSymbol(b?.symbol)) {
      return res
        .status(400)
        .json({ ok: false, error: "symbol must be A-Z0-9.-/ (1..24 chars)" });
    }
    if (b.refreshSeconds !== undefined) {
      const rs = b.refreshSeconds;
      if (typeof rs !== "number" || !Number.isFinite(rs) || rs < 1) {
        return res
          .status(400)
          .json({ ok: false, error: "refreshSeconds must be a positive number" });
      }
    }
    let saved;
    try {
      saved = upsertSymbol({
        symbol: b.symbol,
        label: typeof b.label === "string" ? b.label : undefined,
        category: typeof b.category === "string" ? b.category : undefined,
        enabled: typeof b.enabled === "boolean" ? b.enabled : undefined,
        refreshSeconds: typeof b.refreshSeconds === "number" ? b.refreshSeconds : undefined,
        sortOrder: typeof b.sortOrder === "number" ? b.sortOrder : undefined,
      });
    } catch (err) {
      log.error("[pulseSymbolRoutes.upsert] failed:", (err as Error).message);
      return res
        .status(500)
        .json({ ok: false, error: "upsert_failed", message: sanitizeErrorMessage(err) });
    }
    try {
      appendAdminAudit(actorOf(req), `pulse_symbol:${saved.symbol}`, "pulse_symbol_upserted", {
        after: { enabled: saved.enabled, refreshSeconds: saved.refreshSeconds },
      });
    } catch (auditErr) {
      log.warn(
        "[pulseSymbolRoutes.upsert] audit append failed (non-fatal):",
        (auditErr as Error).message,
      );
    }
    return res.status(201).json({ ok: true, symbol: saved });
  });

  // ADMIN — toggle enabled flag.
  app.patch(
    "/api/admin/pulse-symbols/:symbol/enabled",
    requireAdmin,
    (req: Request, res: Response) => {
      const symbol = req.params.symbol;
      if (!isValidSymbol(symbol)) {
        return res.status(400).json({ ok: false, error: "invalid_symbol" });
      }
      const enabled = (req.body as { enabled?: unknown })?.enabled;
      if (typeof enabled !== "boolean") {
        return res.status(400).json({ ok: false, error: "enabled must be a boolean" });
      }
      if (!getSymbol(symbol)) {
        return res.status(404).json({ ok: false, error: "symbol_not_found", symbol });
      }
      let updated;
      try {
        updated = setSymbolEnabled(symbol, enabled);
      } catch (err) {
        log.error("[pulseSymbolRoutes.toggle] failed:", (err as Error).message);
        return res
          .status(500)
          .json({ ok: false, error: "update_failed", message: sanitizeErrorMessage(err) });
      }
      try {
        appendAdminAudit(actorOf(req), `pulse_symbol:${symbol}`, "pulse_symbol_enabled_set", {
          after: { enabled },
        });
      } catch (auditErr) {
        log.warn(
          "[pulseSymbolRoutes.toggle] audit append failed (non-fatal):",
          (auditErr as Error).message,
        );
      }
      return res.json({ ok: true, symbol: updated });
    },
  );

  // AUTHED — enabled symbols only (the live watchlist).
  app.get("/api/pulse/symbols", requireAuth, (_req: Request, res: Response) => {
    try {
      return res.json({ ok: true, symbols: listEnabledSymbols() });
    } catch (err) {
      log.error("[pulseSymbolRoutes.enabled] failed:", (err as Error).message);
      return res
        .status(500)
        .json({ ok: false, error: "read_failed", message: sanitizeErrorMessage(err) });
    }
  });

  log.info("[v25.47 APD-022] registered pulse-symbol routes");
}

export default registerPulseSymbolRoutes;
