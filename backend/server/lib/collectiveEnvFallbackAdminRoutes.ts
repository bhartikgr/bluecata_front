/**
 * server/lib/collectiveEnvFallbackAdminRoutes.ts — D2.5 R1 fix (B-5 / FIX 5).
 *
 * Slice 3's `airwallexCollective.ts` (`priceConfigForTier`) reads
 * `collective_subscription_configs.use_env_fallback` to decide whether a
 * Collective membership charge is priced from the admin-authored DB row or
 * from the legacy `AIRWALLEX_COLLECTIVE_*_AMOUNT_MINOR` env vars. The column
 * (added by `applyD25Slice3CollectiveEnvFallbackSchema.ts`, defaulting every
 * row to `1` = "still trust env") had NO write path anywhere — no store
 * setter, no admin route, no UI control — so an admin could never actually
 * flip a package to DB-authoritative pricing without raw SQL.
 *
 * This file is the write path: ONE admin route, gated by the router-level
 * `app.use("/api/admin", requireAdmin)` in routes.ts (same as every other
 * admin-only route in this codebase — no second requireAdmin needed here,
 * consistent with e.g. collectivePaymentAdminRoutes.ts).
 *
 * Scope discipline:
 *   - This file does NOT import or modify `server/lib/airwallexCollective.ts`
 *     (Airwallex-adjacent, not sacred, but left untouched per the task's
 *     "zero Airwallex touches" instruction — this route only writes a plain
 *     SQLite column that that file already knows how to read).
 *   - No Airwallex API calls. No gateway credentials touched.
 *   - Writes by `airwallex_tier` (basic|standard|premium), matching how
 *     `priceConfigFromDb()` looks the row up (`WHERE airwallex_tier = ?`),
 *     not by a specific package id — this mirrors the actual read path 1:1,
 *     so toggling "basic" flips the flag on every row for that tier (there
 *     is normally exactly one live row per tier; see priceConfigFromDb's own
 *     "most recent wins" ORDER BY for the multi-row case).
 */
import type { Express, Request, Response } from "express";
import { rawDb } from "../db/connection";
import { appendAdminAudit } from "../adminPlatformStore";

const VALID_TIERS = new Set(["basic", "standard", "premium"]);

function actorOf(req: Request): string {
  const ctx = (req as any).userContext;
  return String(ctx?.identity?.email ?? ctx?.userId ?? "admin");
}

export function registerCollectiveEnvFallbackAdminRoutes(app: Express): void {
  // GET current use_env_fallback state per tier (read-side, for the UI toggle).
  app.get("/api/admin/collective-configs/env-fallback", (_req: Request, res: Response) => {
    try {
      const rows = rawDb()
        .prepare(
          `SELECT airwallex_tier, use_env_fallback, id, status
           FROM collective_subscription_configs
           WHERE deleted_at IS NULL
           ORDER BY airwallex_tier, (status = 'live') DESC, updated_at DESC`,
        )
        .all() as Array<{ airwallex_tier: string; use_env_fallback: number; id: string; status: string }>;
      res.json({ ok: true, rows: rows.map((r) => ({ tier: r.airwallex_tier, useEnvFallback: !!r.use_env_fallback, packageId: r.id, status: r.status })) });
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  // PATCH /api/admin/collective-configs/:tier/env-fallback  { useEnvFallback: boolean }
  app.patch("/api/admin/collective-configs/:tier/env-fallback", (req: Request, res: Response) => {
    const tier = String(req.params.tier ?? "");
    if (!VALID_TIERS.has(tier)) {
      return res.status(400).json({ ok: false, error: "invalid_tier", validTiers: Array.from(VALID_TIERS) });
    }
    const body = req.body as { useEnvFallback?: unknown };
    if (typeof body?.useEnvFallback !== "boolean") {
      return res.status(400).json({ ok: false, error: "useEnvFallback_must_be_boolean" });
    }
    const actor = actorOf(req);
    if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });

    try {
      const db = rawDb();
      const exists = db
        .prepare(`SELECT COUNT(*) as n FROM collective_subscription_configs WHERE airwallex_tier = ? AND deleted_at IS NULL`)
        .get(tier) as { n: number };
      if (!exists || exists.n === 0) {
        return res.status(404).json({ ok: false, error: "no_package_for_tier" });
      }
      db.prepare(
        `UPDATE collective_subscription_configs SET use_env_fallback = ?, updated_at = ? WHERE airwallex_tier = ? AND deleted_at IS NULL`,
      ).run(body.useEnvFallback ? 1 : 0, new Date().toISOString(), tier);

      appendAdminAudit(actor, `collective_subscription_config:tier:${tier}`, "collective_subscription_config.env_fallback_toggled", {
        tier,
        useEnvFallback: body.useEnvFallback,
      });

      res.json({ ok: true, tier, useEnvFallback: body.useEnvFallback });
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });
}
