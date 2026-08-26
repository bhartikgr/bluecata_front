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
/* WAVE 153 · ITEM F — the paired write, its transaction, its read-back check and
   its single refusal sentence live in ONE place used by both writer routes. */
import {
  writeApplicationFeeBothSources,
  ApplicationFeeMirrorError,
  APPLICATION_FEE_PLATFORM_KEY,
  APPLICATION_FEE_MIRROR_FAILED,
  APPLICATION_FEE_MIRROR_MESSAGE,
} from "./lib/applicationFeeMirror";
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
  /* GET /api/admin/platform-fees — list every fee row (admin editor table).
   *
   * WAVE 144 · ITEM 2 (R108.2). This route is the CALLER that PUBLISHED the
   * store's fabricated fallback: when the `platform_fees` row was absent, or the
   * table unreadable, `listFees()` handed back a synthesised row holding 30000
   * and this handler served it as `ok: true` with no qualification, so the admin
   * console showed a fee nobody had set as though it were on record.
   *
   * The store now reports absence (`amountMinor: null`, `source: "missing"` or
   * `"unreadable"`). This handler passes that through UNCHANGED — it does not
   * coalesce to 0, substitute a figure, or drop absent rows — and adds
   * `absentKeys` so a consumer cannot miss the distinction. It still answers 200:
   * R108.2 requires an honest unavailable state, not a 503. */
  app.get("/api/admin/platform-fees", requireAdmin, (_req: Request, res: Response) => {
    try {
      const fees = listFees();
      return res.json({
        ok: true,
        fees,
        absentKeys: fees.filter((f) => f.amountMinor === null).map((f) => f.key),
      });
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

    const b = req.body as {
      amountMinor?: unknown;
      currency?: unknown;
      intentionalZero?: unknown;
      intentionalZeroReason?: unknown;
    };
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

    /* WAVE 152 · ITEM G · G-C9 (R117.2 Q3) — A ZERO HAS TO BE DECLARED.
     *
     * Before this wave an admin could type 0 and the platform GUESSED whether a
     * free price was meant, from whether `updated_by_user_id` happened to be
     * NULL. The guess is now replaced by the admin saying so, and a 0 with no
     * declaration is REFUSED at the edge rather than saved and then treated as an
     * absence downstream — which is what made the difference invisible.
     *
     * The refusal is a plain sentence naming what to do next (R77), not a bare
     * code; the code travels alongside it for logs. */
    const intentionalZero = b?.intentionalZero === true;
    const intentionalZeroReason =
      typeof b?.intentionalZeroReason === "string" ? b.intentionalZeroReason.trim() : "";
    if (amountMinor === 0 && !(intentionalZero && intentionalZeroReason.length > 0)) {
      return res.status(400).json({
        ok: false,
        error: "ZERO_FEE_NEEDS_DECLARATION",
        message:
          "A fee of zero has to be declared deliberately, because otherwise nobody can tell " +
          "it apart from a price that was never set. Tick \"This really is free\" and write the " +
          "reason, or enter the real amount.",
      });
    }

    const userId =
      (req as Request & { userContext?: { userId?: string } }).userContext?.userId ?? null;
    /* WAVE 144 · ITEM 2 — the audit's `before` side. `getFee` used to return the
       fabricated 30000 for a key with no row, so the audit trail recorded a
       change FROM a price that had never existed. It now reports absence, and
       the diff below records `amountMinor: null` plus the reason, which is what
       actually happened. */
    const prev = getFee(key);

    /* ══════════════════════════════════════════════════════════════════════
     * WAVE 153 · ITEM F · F-C1/F-C3 — THE MIRROR IS FATAL AND ATOMIC.
     * ══════════════════════════════════════════════════════════════════════
     *
     * WAS: `setFee` ran on its own, then the mirror into
     * `collective_application_fee_config` ran in a `try` whose `catch` logged
     * "(non-fatal)" and fell through to a 200. The founder-facing resolver reads
     * ONLY the config table, so a swallowed mirror failure told the administrator
     * the price had changed while founders kept paying the old one — for as long
     * as nobody happened to read the log. R115.2 #5.
     *
     * NOW: both writes happen inside ONE transaction owned by
     * `server/lib/applicationFeeMirror.ts`, which re-reads and compares both rows
     * before commit. If the pair cannot be written, the administrator's change
     * DOES NOT HAPPEN and the response says so in a plain sentence. The cache is
     * invalidated and the audit written only on commit — and the FAILURE is
     * audited too, as `platform_fee_update_failed`, so the attempt is visible.
     *
     * Only this one key has a second home. Every other key keeps the plain
     * single-row write below. */
    if (key === APPLICATION_FEE_PLATFORM_KEY) {
      const mirrorCurrency = currency || prev.currency || "USD";
      try {
        const written = writeApplicationFeeBothSources({
          amountMinor,
          currency: mirrorCurrency,
          actor: actorOf(req),
          userId,
          /* The call site stays IN THIS FILE deliberately. The byte pin at
             server/__tests__/wave131_one_pricing_console.test.ts:461-467 asserts
             this file contains `updateApplicationFee(\n          amountMinor,` —
             wave 131 froze it there after a 100x understatement was fixed on this
             exact call (the value is written UNSCALED; both columns are true minor
             units). Removing it would lower a protection, which is forbidden, so
             the helper owns the transaction and this file keeps the pinned call. */
          configWriter: (_minor, cur, act) =>
            updateApplicationFee(
          amountMinor,
              cur,
              act,
            ),
        });
        invalidateAllPricingCaches(`platform_fees.set:${key}`);
        try {
          appendAdminAudit(actorOf(req), `platform_fee:${key}`, "platform_fee_updated", {
            key,
            before: { amountMinor: prev.amountMinor, currency: prev.currency, source: prev.source },
            after: {
              amountMinor: written.fee.amountMinor,
              currency: written.fee.currency,
              source: written.fee.source,
            },
            mirroredTo: "collective_application_fee_config:default",
          });
        } catch (auditErr) {
          log.warn(
            "[adminPlatformFeesRoutes.update] audit append failed (non-fatal):",
            (auditErr as Error).message,
          );
        }
        return res.json({ ok: true, fee: written.fee });
      } catch (err) {
        const detail =
          err instanceof ApplicationFeeMirrorError ? err.detail : String((err as Error)?.message ?? err);
        log.error(`[adminPlatformFeesRoutes.update] application fee write REFUSED: ${detail}`);
        /* The attempt is recorded even though nothing changed, so an operator can
           see that someone tried and why it did not take. */
        try {
          appendAdminAudit(actorOf(req), `platform_fee:${key}`, "platform_fee_update_failed", {
            key,
            attemptedMinor: amountMinor,
            attemptedCurrency: mirrorCurrency,
            before: { amountMinor: prev.amountMinor, currency: prev.currency, source: prev.source },
            reason: APPLICATION_FEE_MIRROR_FAILED,
            detail,
          });
        } catch (auditErr) {
          log.warn(
            "[adminPlatformFeesRoutes.update] failure audit append failed (non-fatal):",
            (auditErr as Error).message,
          );
        }
        return res.status(500).json({
          ok: false,
          error: APPLICATION_FEE_MIRROR_FAILED,
          message: APPLICATION_FEE_MIRROR_MESSAGE,
        });
      }
    }

    let updated;
    try {
      updated = setFee({
        key,
        amountMinor,
        currency,
        updatedByUserId: userId,
        intentionalZero,
        intentionalZeroReason: intentionalZeroReason.length > 0 ? intentionalZeroReason : null,
      });
    } catch (err) {
      log.error("[adminPlatformFeesRoutes.update] failed:", (err as Error).message);
      return res
        .status(500)
        .json({ ok: false, error: "update_failed", message: sanitizeErrorMessage(err) });
    }

    /* WAVE 153 · ITEM F — THE SWALLOWING MIRROR THAT USED TO LIVE HERE IS GONE.
     *
     * The block below this comment previously ran AFTER a committed `setFee`, in a
     * `try` whose `catch (mirrorErr)` logged "(non-fatal)" and continued to a 200.
     * That is how a stale founder-facing price could be served indefinitely while
     * the admin console reported the new one (R115.2 #5). The paired, verified,
     * transactional write now happens ABOVE, before any single-source write, and
     * this key never reaches the code below. Kept as a record of what was removed:
     *
     *   HISTORICAL RECORD OF THE REMOVED BLOCK (no code, comment only):
     *     if (key === "collective_application_fee") {
     *       try { updateApplicationFee(amountMinor, updated.currency || "USD",
     *                                  userId || "admin"); }
     *       catch (mirrorErr) { log.warn("... mirror-write failed (non-fatal):" ...); }
     *     }
     *
     *   It ran after `setFee` had already committed, so a mirror failure left the
     *   two sources disagreeing with a 200 on the wire. Earlier waves fixed the
     *   AMOUNT on that call (WAVE 34 removed a hardcoded exponent-2 divisor;
     *   WAVE 131 removed the remaining minor -> major conversion, because
     *   `collective_application_fee_config.amount_minor` is TRUE minor units on
     *   every other path). Both of those corrections are preserved in the
     *   replacement above: the value is still written UNSCALED, and the pinned
     *   call site still lives in this file. What changed in WAVE 153 is only the
     *   FAILURE behaviour — fatal and rolled back, instead of logged and ignored.
     */
    /* WAVE 131 (R95) — an admin price change must be visible on the NEXT
     * request, not after a cache TTL. One call, one place: see
     * server/lib/pricingCacheBus.ts. */
    invalidateAllPricingCaches(`platform_fees.set:${key}`);
    // Hash-chained admin audit with the before/after diff.
    try {
      appendAdminAudit(actorOf(req), `platform_fee:${key}`, "platform_fee_updated", {
        key,
        before: { amountMinor: prev.amountMinor, currency: prev.currency, source: prev.source },
        after: { amountMinor: updated.amountMinor, currency: updated.currency, source: updated.source },
      });
    } catch (auditErr) {
      log.warn("[adminPlatformFeesRoutes.update] audit append failed (non-fatal):", (auditErr as Error).message);
    }
    return res.json({ ok: true, fee: updated });
  });
}
