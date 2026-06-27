/**
 * v25.39 — Admin write endpoints for DB-driven fee configuration.
 *
 * Closes v25.38's carry-forward: the application-fee and partner commission-rate
 * config tables were READ-only (resolver + GET). This thin route module adds the
 * admin-only WRITE surfaces, satisfying the SACRED rule:
 *   "Pricing plans are determined from the Admin area. They are never hardcoded."
 *
 * Endpoints (all admin-only — explicit requireAdmin for defense-in-depth, on top
 * of the router-level /api/admin guard in routes.ts):
 *   PUT  /api/admin/collective/application-fee            update the single-row fee
 *   GET  /api/admin/collective/application-fee            read the config row + provenance
 *   GET  /api/admin/partner/commission-rates             list all 5 tier rates
 *   PUT  /api/admin/partner/commission-rates/:tier        update one tier's rate
 *
 * Pattern mirrors server/lib/partnerFeeAdminRoutes.ts (actorOf + appendAdminAudit).
 * The resolvers own the validated UPSERT; this layer owns RBAC, request parsing,
 * and the hash-chained admin audit entry. No amounts/rates are hardcoded here.
 */
import type { Express, Request, Response } from "express";
import { requireAdmin } from "./lib/authMiddleware";
import { appendAdminAudit } from "./adminPlatformStore";
import { sanitizeErrorMessage } from "./lib/sanitize";
import { log } from "./lib/logger";
import {
  updateApplicationFee,
  getApplicationFeeConfig,
} from "./lib/collectiveApplicationFeeResolver";
import {
  updateCommissionRate,
  listCommissionRates,
  isCommissionRateTier,
} from "./lib/partnerCommissionRateResolver";

function actorOf(req: Request): string {
  const ctx = (req as Request & {
    userContext?: { identity?: { email?: string }; userId?: string };
  }).userContext;
  return String(ctx?.identity?.email ?? ctx?.userId ?? "admin");
}

export function registerAdminCollectiveFeeRoutes(app: Express): void {
  /* -----------------------------------------------------------------
   * GET /api/admin/collective/application-fee
   * Read the current config row (incl. updated_at / updated_by) for the
   * admin editor. Returns source="default" if the row is genuinely missing.
   * ----------------------------------------------------------------- */
  app.get(
    "/api/admin/collective/application-fee",
    requireAdmin,
    (_req: Request, res: Response) => {
      res.json({ ok: true, ...getApplicationFeeConfig() });
    },
  );

  /* -----------------------------------------------------------------
   * PUT /api/admin/collective/application-fee
   * Body: { amountMinor: number, currency?: string }
   *   amountMinor MUST be a non-negative integer (minor units).
   *   currency defaults to the existing row's currency, else "USD".
   * ----------------------------------------------------------------- */
  app.put(
    "/api/admin/collective/application-fee",
    requireAdmin,
    (req: Request, res: Response) => {
      const b = req.body as { amountMinor?: unknown; currency?: unknown };
      const amountMinor = b?.amountMinor;
      // v25.39 round-2 (per GPT-5.5 concern #5): also reject unsafe integers
      // beyond 2^53-1. Combined with the resolver-level re-validation, this
      // closes the precision gap before any JS arithmetic on the value.
      if (
        typeof amountMinor !== "number" ||
        !Number.isFinite(amountMinor) ||
        !Number.isInteger(amountMinor) ||
        !Number.isSafeInteger(amountMinor) ||
        amountMinor < 0
      ) {
        return res.status(400).json({
          ok: false,
          error: "amountMinor must be a non-negative integer (minor units)",
        });
      }
      // Capture the prior state for the audit diff.
      const prev = getApplicationFeeConfig();
      const currency =
        typeof b?.currency === "string" && b.currency.trim()
          ? b.currency.trim().toUpperCase()
          : prev.currency;
      let updated;
      try {
        updated = updateApplicationFee(amountMinor, currency, actorOf(req));
      } catch (err) {
        log.error(
          "[adminCollectiveFeeRoutes.application-fee] update failed:",
          (err as Error).message,
        );
        return res
          .status(500)
          .json({ ok: false, error: "update_failed", message: sanitizeErrorMessage(err) });
      }
      appendAdminAudit(
        actorOf(req),
        "collective_application_fee_config:default",
        "application_fee.updated",
        {
          fromMinor: prev.amountMinor,
          toMinor: updated.amountMinor,
          fromCurrency: prev.currency,
          toCurrency: updated.currency,
        },
      );
      res.json({ ok: true, ...updated });
    },
  );

  /* -----------------------------------------------------------------
   * GET /api/admin/partner/commission-rates
   * List all 5 tier rates in deterministic order (incl. provenance).
   * ----------------------------------------------------------------- */
  app.get(
    "/api/admin/partner/commission-rates",
    requireAdmin,
    (_req: Request, res: Response) => {
      res.json({ ok: true, rates: listCommissionRates() });
    },
  );

  /* -----------------------------------------------------------------
   * PUT /api/admin/partner/commission-rates/:tier
   * Body: { rate: number }  — rate MUST be finite, 0 <= rate <= 1.
   * :tier MUST be one of the 5 canonical tiers.
   * Returns all tier rates after the update (deterministic order).
   * ----------------------------------------------------------------- */
  app.put(
    "/api/admin/partner/commission-rates/:tier",
    requireAdmin,
    (req: Request, res: Response) => {
      const tier = req.params.tier;
      if (!isCommissionRateTier(tier)) {
        return res.status(400).json({ ok: false, error: "invalid_tier" });
      }
      const rate = (req.body as { rate?: unknown })?.rate;
      if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 1) {
        return res.status(400).json({
          ok: false,
          error: "rate must be a finite number between 0 and 1 (inclusive)",
        });
      }
      // Prior rate (for the audit diff) — find the matching row in the list.
      const before = listCommissionRates().find((r) => r.tier === tier);
      const fromRate = before ? before.rate : null;
      try {
        updateCommissionRate(tier, rate, actorOf(req));
      } catch (err) {
        log.error(
          "[adminCollectiveFeeRoutes.commission-rates] update failed:",
          (err as Error).message,
        );
        return res
          .status(500)
          .json({ ok: false, error: "update_failed", message: sanitizeErrorMessage(err) });
      }
      appendAdminAudit(
        actorOf(req),
        `partner_commission_rate_config:${tier}`,
        "commission_rate.updated",
        { tier, fromRate, toRate: rate },
      );
      res.json({ ok: true, tier, rate, source: "db", rates: listCommissionRates() });
    },
  );
}
