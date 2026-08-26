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
  DEFAULT_APPLICATION_FEE_CURRENCY,
} from "./lib/collectiveApplicationFeeResolver";
import {
  updateCommissionRate,
  listCommissionRates,
  isCommissionRateTier,
} from "./lib/partnerCommissionRateResolver";
/* WAVE 16 / CP-BRG-07 */
import { publishFeeScheduleChangedForTier } from "./lib/wave15FeeScheduleAggregate";
/* WAVE 153 · ITEM F — one writer, one transaction, one refusal sentence, shared
   with server/adminPlatformFeesRoutes.ts. */
import {
  writeApplicationFeeBothSources,
  ApplicationFeeMirrorError,
  APPLICATION_FEE_MIRROR_FAILED,
  APPLICATION_FEE_MIRROR_MESSAGE,
} from "./lib/applicationFeeMirror";
import { invalidateAllPricingCaches } from "./lib/pricingCacheBus";

/* WAVE 153 · ITEM F — `platform_fees` records the actor as a USER ID, the config
   row records it as the actor string. Both come from the same request context so
   one edit cannot look like two different people. */
function userIdOf(req: Request): string | null {
  const ctx = (req as Request & { userContext?: { userId?: string } }).userContext;
  return ctx?.userId ?? null;
}

function actorOf(req: Request): string {
  const ctx = (req as Request & {
    userContext?: { identity?: { email?: string }; userId?: string };
  }).userContext;
  return String(ctx?.identity?.email ?? ctx?.userId ?? "u_unknown_admin");
}

export function registerAdminCollectiveFeeRoutes(app: Express): void {
  /* -----------------------------------------------------------------
   * GET /api/admin/collective/application-fee
   * Read the current config row (incl. updated_at / updated_by) for the
   * admin editor.
   *
   * BATCH 1 · ITEM 2 (R108.2): `source` is now "db" | "missing" | "unreadable"
   * and `amountMinor` is NULL for the latter two — the resolver no longer echoes
   * the canonical reference figure back as though it were configured. This body
   * is what the consolidated fee console renders in its resolver-state panel, so
   * the administrator can SEE that the founder-facing figure is absent instead of
   * inferring it from a page that looks fine.
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
      /* BATCH 1 · ITEM 2 — `prev.currency` is NULL when no row is on record
         (source "missing"/"unreadable"), so the denomination for the FIRST write
         falls back to the canonical currency constant rather than to `null`. A
         currency code is not a price: this is not the R95 shape, and the AMOUNT
         is still whatever the administrator typed and is never defaulted. */
      const currency =
        typeof b?.currency === "string" && b.currency.trim()
          ? b.currency.trim().toUpperCase()
          : (prev.currency ?? DEFAULT_APPLICATION_FEE_CURRENCY);
      /* ═══════════════════════════════════════════════════════════════════
       * WAVE 153 · ITEM F · F-C2 — THIS ROUTE NOW MIRRORS BACK.
       * ═══════════════════════════════════════════════════════════════════
       *
       * WAS: `updateApplicationFee` alone. It wrote the founder-authoritative
       * config row and left `platform_fees.collective_application_fee` — the row
       * the admin Platform Fees console lists — holding the OLD figure, with no
       * cache invalidation at all. So this route silently created exactly the
       * divergence the platform-fees route was mirroring to prevent, in the other
       * direction: the console showed one price, founders were charged another.
       *
       * NOW: both rows move in ONE verified transaction (the same helper the
       * platform-fees route uses), and the pricing caches are invalidated after
       * commit so the change is visible on the NEXT request. If the pair cannot be
       * written, nothing is written and the administrator is told so plainly. */
      let updated;
      try {
        const written = writeApplicationFeeBothSources({
          amountMinor,
          currency,
          actor: actorOf(req),
          /* `platform_fees.updated_by_user_id` takes the user id when the request
             carries one, so BOTH rows record the SAME actor for the same edit. */
          userId: userIdOf(req),
        });
        updated = written.config;
      } catch (err) {
        if (err instanceof ApplicationFeeMirrorError) {
          log.error(
            "[adminCollectiveFeeRoutes.application-fee] paired write REFUSED:",
            err.detail,
          );
          return res.status(500).json({
            ok: false,
            error: APPLICATION_FEE_MIRROR_FAILED,
            message: APPLICATION_FEE_MIRROR_MESSAGE,
          });
        }
        log.error(
          "[adminCollectiveFeeRoutes.application-fee] update failed:",
          (err as Error).message,
        );
        return res
          .status(500)
          .json({ ok: false, error: "update_failed", message: sanitizeErrorMessage(err) });
      }
      /* WAVE 153 · ITEM F — this route used to invalidate NOTHING, so a change made
         here could be served stale from a pricing cache. One call, one place: see
         server/lib/pricingCacheBus.ts. Only after a committed paired write. */
      invalidateAllPricingCaches("collective_application_fee.set");
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
      /* WAVE 16 / CP-BRG-07 — SECOND PATH to the fee aggregate. The commission
       * rate is one of the aggregate's three legs (`resolveCommissionRate`), and
       * it is written HERE, not in partnerFeeAdminRoutes. Publishing only from
       * the fee-schedule routes would have left every partner on this tier
       * showing a stale commission rate. Tier-scoped fanout, revision only. */
      publishFeeScheduleChangedForTier(tier, "commission_rate.updated");
      res.json({ ok: true, tier, rate, source: "db", rates: listCommissionRates() });
    },
  );
}
