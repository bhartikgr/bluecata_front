/**
 * v25.45.4 L-2 — Admin "Platform Fees" route (read + update, admin-only).
 *
 * Per Ozan's locked answer (c) on this thread (Saturday June 27, 2026): build a
 * narrow, DB-backed platform-fees foundation. For v25.45.4 the only configured
 * fee is `collective_application_fee` (formerly the $2,500 hardcode in
 * ApplyToCollective.tsx). The schema + this route are intentionally key-generic
 * so the v25.46 full Platform Fees admin panel extends with ZERO schema change.
 *
 * ============================================================================
 * v25.46 EXTENSION POINT
 * ----------------------------------------------------------------------------
 * This route is the foundation for the full Platform Fees admin panel. v25.46
 * will add subscription tier rows, per-deal fee rows, and marketplace fee rows.
 * The current schema (platform_fees: key/amount_minor/currency/updated_at/
 * updated_by_user_id) supports this extension — just add more rows with new
 * `key` values; both the GET (lists every row) and PUT (upserts by key) already
 * handle arbitrary keys. See build_spec/v25_46_extension_points.md.
 * ============================================================================
 *
 * Endpoints (admin-only; ownership-checked via requireAdmin):
 *   GET /api/admin/platform-fees           — list every configured fee row
 *   PUT /api/admin/platform-fees/:key      — upsert one fee (amountMinor, currency)
 *
 * Mirrors the RBAC + hash-chained admin-audit pattern of adminCollectiveFeeRoutes.
 */
import type { Express, Request, Response } from "express";
import { requireAdmin } from "./lib/authMiddleware";
import { appendAdminAudit } from "./adminPlatformStore";
import { sanitizeErrorMessage } from "./lib/sanitize";
import { log } from "./lib/logger";
import { listFees, getFee, setFee } from "./platformFeesStore";
import { invalidateAllPricingCaches } from "./lib/pricingCacheBus";
import { updateApplicationFee } from "./lib/collectiveApplicationFeeResolver";
/* WAVE 131 — the WAVE 34 minor→display mirror conversion is GONE (see the note
   at the mirror-write): the config column is true minor units, so no exponent
   conversion belongs on this path at all. `fromMinor` is no longer imported
   here; nothing else in this file converted money. */

function actorOf(req: Request): string {
  const ctx = (req as Request & {
    userContext?: { identity?: { email?: string }; userId?: string };
  }).userContext;
  return String(ctx?.identity?.email ?? ctx?.userId ?? "u_unknown_admin");
}

export function registerAdminPlatformFeesRoutes(app: Express): void {
  /* GET /api/admin/platform-fees — list every fee row (admin editor table). */
  app.get("/api/admin/platform-fees", requireAdmin, (_req: Request, res: Response) => {
    try {
      return res.json({ ok: true, fees: listFees() });
    } catch (err) {
      log.error("[adminPlatformFeesRoutes.list] failed:", (err as Error).message);
      return res
        .status(500)
        .json({ ok: false, error: "list_failed", message: sanitizeErrorMessage(err) });
    }
  });

  /* PUT /api/admin/platform-fees/:key — upsert one fee.
   * Body: { amountMinor: number (>=0 integer), currency?: string }. */
  app.put("/api/admin/platform-fees/:key", requireAdmin, (req: Request, res: Response) => {
    const key = String(req.params.key || "").trim();
    if (!key) return res.status(400).json({ ok: false, error: "key_required" });

    const b = req.body as { amountMinor?: unknown; currency?: unknown };
    const amountMinor = b?.amountMinor;
    if (
      typeof amountMinor !== "number" ||
      !Number.isFinite(amountMinor) ||
      !Number.isInteger(amountMinor) ||
      !Number.isSafeInteger(amountMinor) ||
      amountMinor < 0
    ) {
      return res
        .status(400)
        .json({ ok: false, error: "amountMinor must be a non-negative integer (minor units)" });
    }
    const currency =
      typeof b?.currency === "string" && b.currency.trim() ? b.currency.trim().toUpperCase() : undefined;

    const userId =
      (req as Request & { userContext?: { userId?: string } }).userContext?.userId ?? null;
    const prev = getFee(key);
    let updated;
    try {
      updated = setFee({ key, amountMinor, currency, updatedByUserId: userId });
    } catch (err) {
      log.error("[adminPlatformFeesRoutes.update] failed:", (err as Error).message);
      return res
        .status(500)
        .json({ ok: false, error: "update_failed", message: sanitizeErrorMessage(err) });
    }

    // v25.45.4 L-2 BRIDGE: the collective_application_fee is ALSO surfaced on the
    // founder Billing page, which resolves through getApplicationFeeMinor() (the
    // collective_application_fee_config table is authoritative there). To keep a
    // single source of truth WITHOUT inserting platform_fees as a resolver
    // fallback (that would break the documented v25.38/v25.39 source='default'
    // contract when the config row is absent), we MIRROR-WRITE the new value into
    // the config table. platform_fees stores TRUE minor units (cents); the config
    // table / founder display contract uses display units (fmtUSD with NO
    // division), so we convert minor → major. This makes a Platform-Fees edit
    // flow to the founder Billing surface with source='db'.
    //
    // WAVE 34 · TASK 2 — was: `Math.round(amountMinor / 100)`. The hardcoded
    // exponent-2 divisor ignored `updated.currency`, which was already in scope
    // on the very next line. A ¥250,000 fee (JPY, exponent 0) was mirrored as
    // 2,500 and the founder's Collective application screen then quoted ¥2,500
    // — a real price, wrong by a factor of 100. `fromMinor` reads the ISO-4217
    // exponent from server/lib/currency.ts (JPY/KRW = 0) and returns a number,
    // so the argument type of updateApplicationFee is unchanged.
    if (key === "collective_application_fee") {
      try {
        const mirrorCurrency = updated.currency || "USD";
        /* WAVE 131 (R95 / R96 req 3 — displayed must equal charged). The mirror
         * used to convert minor→MAJOR before writing, on the belief that
         * `collective_application_fee_config.amount_minor` held display dollars.
         * It does not. That column is TRUE minor units on every other path:
         * PUT /api/admin/collective/application-fee validates its body as
         * "non-negative integer (minor units)" and writes it unscaled
         * (server/adminCollectiveFeeRoutes.ts), updateApplicationFee re-validates
         * the same contract, and the seed default is 30000 for a $300 fee
         * (DEFAULT_APPLICATION_FEE_MINOR, server/lib/collectiveApplicationFeeResolver.ts:30).
         * So the conversion was writing 300 where 30000 was meant — a fee
         * understated by two orders of magnitude, in the opposite direction to
         * the founder-side render defect R97 names. The value is mirrored
         * unscaled; one unit, one contract, on both sides. */
        updateApplicationFee(
          amountMinor,
          mirrorCurrency,
          userId || "admin",
        );
      } catch (mirrorErr) {
        log.warn(
          "[adminPlatformFeesRoutes.update] config mirror-write failed (non-fatal):",
          (mirrorErr as Error).message,
        );
      }
    }
    /* WAVE 131 (R95) — an admin price change must be visible on the NEXT
     * request, not after a cache TTL. One call, one place: see
     * server/lib/pricingCacheBus.ts. */
    invalidateAllPricingCaches(`platform_fees.set:${key}`);
    // Hash-chained admin audit with the before/after diff.
    try {
      appendAdminAudit(actorOf(req), `platform_fee:${key}`, "platform_fee_updated", {
        key,
        before: { amountMinor: prev.amountMinor, currency: prev.currency },
        after: { amountMinor: updated.amountMinor, currency: updated.currency },
      });
    } catch (auditErr) {
      log.warn("[adminPlatformFeesRoutes.update] audit append failed (non-fatal):", (auditErr as Error).message);
    }
    return res.json({ ok: true, fee: updated });
  });
}
