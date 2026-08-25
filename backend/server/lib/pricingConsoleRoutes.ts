/**
 * server/lib/pricingConsoleRoutes.ts
 *
 * WAVE 131 — THE ONE PRICING CONSOLE'S SERVER SIDE.
 *
 * The owner asked, several times, for ONE place to administer pricing for every
 * area of the platform. Wave 131 answers that on the client by extending
 * `/admin/fees` (client/src/pages/admin/AdminFeesConsolidated.tsx). Two things
 * that console needs did not exist as routes, and this file is those two things:
 *
 *   GET  /api/admin/pricing-console/source-map
 *        Every administered price, with the ONE table that decides it, the
 *        amount as it stands, its PERIOD, and where it is edited. Built by
 *        calling the same resolvers the charge paths call — so this route cannot
 *        drift from what is actually charged, which is what a hand-maintained
 *        list of sources would eventually do.
 *
 *   GET  /api/admin/pricing-console/repoint
 *   POST /api/admin/pricing-console/repoint-ack
 *        R96 requirement 5 — DO NOT SILENTLY REPRICE A LIVE CUSTOMER. The GET
 *        shows, per fee kind, what partners are being SHOWN today, what the
 *        authoritative source says, and the period. The POST records an explicit
 *        confirmation (migration 0195) and only then does the display move onto
 *        the authoritative source. Both numbers are re-resolved SERVER-SIDE at
 *        confirmation time and the client's numbers are never trusted.
 *
 * MONEY. Integer minor units on the wire. No route here accepts an amount at
 * all — the confirmation carries a decision, not a price, which is why it cannot
 * mis-state one. No `Number()`, `parseInt` or `parseFloat` touches money in this
 * file.
 *
 * AUTHORISATION. Every route is `requireAdmin`.
 */
import type { Express, Request, Response } from "express";
import { requireAdmin } from "./authMiddleware";
import { log } from "./logger";
import { sanitizeErrorMessage } from "./sanitize";
import {
  REPOINTABLE_FEE_KINDS,
  AUTHORITATIVE_SOURCE_BY_FEE_KIND,
  NEGOTIATED_OVERRIDE_PURPOSE,
  buildRepointPreview,
  listRepointAcks,
  acknowledgeRepoint,
  resolveLegacyDisplayedFee,
  resolveAuthoritativeDisplayedFee,
  periodForFeeKind,
} from "./pricingDisplaySourceRepoint";
import { resolveConsortiumPricing } from "./partnerTiers";
import { resolveAuthoritativeSpvDeploymentFee, AUTHORITATIVE_SPV_DEPLOYMENT_FEE_KEY } from "./spvDeploymentFeeSource";
import { COLLECTIVE_APPLICATION_FEE_KEY } from "../platformFeesStore";
import { rawDb } from "../db/connection";
import { PRICE_CACHES } from "./pricingCacheBus";

/** One administered price, as the console lists it. */
export interface SourceMapEntry {
  /** Stable id so a test can name a row. */
  id: string;
  /** What it is, in the owner's language. */
  label: string;
  /** Which product area: capavate | collective | consortium | admin. */
  area: "capavate" | "collective" | "consortium" | "admin";
  /** The ONE table that decides it. */
  authoritativeSource: string;
  /** Column or key inside that table, so the row is findable by hand. */
  authoritativeKey: string | null;
  amountMinor: number | null;
  currency: string | null;
  /** 'annual' | 'monthly' | 'one_off' | null when nobody configured one. */
  billingPeriod: string | null;
  /** Set instead of an amount when the source cannot answer. Never a silent 0. */
  error: string | null;
  /** The console tab that edits it. */
  editorTab: string;
}

function actorOf(req: Request): string | null {
  const uc = (req as Request & { userContext?: { userId?: string } }).userContext;
  return uc?.userId ?? null;
}

/** The collective application fee, read RAW so absent stays distinguishable from 0. */
function readApplicationFee(): { amountMinor: number | null; currency: string | null; error: string | null } {
  try {
    const row = rawDb()
      .prepare(`SELECT amount_minor, currency FROM platform_fees WHERE key = ?`)
      .get(COLLECTIVE_APPLICATION_FEE_KEY) as { amount_minor?: number | null; currency?: string | null } | undefined;
    if (!row || row.amount_minor === null || row.amount_minor === undefined) {
      return {
        amountMinor: null,
        currency: null,
        error: `APPLICATION_FEE_UNCONFIGURED: no platform_fees row for key "${COLLECTIVE_APPLICATION_FEE_KEY}"`,
      };
    }
    return { amountMinor: row.amount_minor, currency: row.currency ?? null, error: null };
  } catch (err) {
    return { amountMinor: null, currency: null, error: `APPLICATION_FEE_UNREADABLE: ${String(err)}` };
  }
}

/**
 * Build the source map by CALLING THE RESOLVERS, not by describing them.
 */
export function buildPricingSourceMap(): SourceMapEntry[] {
  const entries: SourceMapEntry[] = [];

  // ── Consortium Partners — the authoritative tier catalogue ────────────────
  try {
    const tiers = resolveConsortiumPricing();
    if (tiers.length === 0) {
      entries.push({
        id: "consortium.tier_prices",
        label: "Consortium partner subscription tiers",
        area: "consortium",
        authoritativeSource: "partner_tier_price",
        authoritativeKey: null,
        amountMinor: null,
        currency: null,
        billingPeriod: null,
        error:
          "TIER_CATALOGUE_EMPTY: no active priced partner_tier_price row resolved. Nothing is advertised rather than a price being invented.",
        editorTab: "tier-prices",
      });
    }
    for (const t of tiers) {
      entries.push({
        id: `consortium.tier_price.${t.slug}`,
        label: `Consortium partner tier — ${t.label}`,
        area: "consortium",
        authoritativeSource: "partner_tier_price",
        authoritativeKey: `tier_slug='${t.slug}', cadence='${t.billingPeriod ?? ""}'`,
        amountMinor: t.amountMinor,
        currency: t.currency,
        billingPeriod: t.billingPeriod || null,
        error: null,
        editorTab: "tier-prices",
      });
    }
  } catch (err) {
    entries.push({
      id: "consortium.tier_prices",
      label: "Consortium partner subscription tiers",
      area: "consortium",
      authoritativeSource: "partner_tier_price",
      authoritativeKey: null,
      amountMinor: null,
      currency: null,
      billingPeriod: null,
      error: `TIER_CATALOGUE_UNREADABLE: ${String(err)}`,
      editorTab: "tier-prices",
    });
  }

  // ── Consortium Partners — the SPV deployment fee ──────────────────────────
  try {
    const spv = resolveAuthoritativeSpvDeploymentFee();
    entries.push({
      id: "consortium.spv_deployment_fee",
      label: "SPV deployment fee",
      area: "consortium",
      authoritativeSource: "platform_fees",
      authoritativeKey: AUTHORITATIVE_SPV_DEPLOYMENT_FEE_KEY,
      amountMinor: spv ? spv.amountMinor : null,
      currency: spv ? spv.currency : null,
      billingPeriod: periodForFeeKind("spv_deployment"),
      error: spv
        ? null
        : `SPV_DEPLOYMENT_FEE_UNCONFIGURED: platform_fees key "${AUTHORITATIVE_SPV_DEPLOYMENT_FEE_KEY}" has never been set`,
      editorTab: "consortium-promotions",
    });
  } catch (err) {
    entries.push({
      id: "consortium.spv_deployment_fee",
      label: "SPV deployment fee",
      area: "consortium",
      authoritativeSource: "platform_fees",
      authoritativeKey: AUTHORITATIVE_SPV_DEPLOYMENT_FEE_KEY,
      amountMinor: null,
      currency: null,
      billingPeriod: periodForFeeKind("spv_deployment"),
      error: `SPV_DEPLOYMENT_FEE_UNREADABLE: ${String(err)}`,
      editorTab: "consortium-promotions",
    });
  }

  // ── Collective — the application fee ─────────────────────────────────────
  const appFee = readApplicationFee();
  entries.push({
    id: "collective.application_fee",
    label: "Collective application fee",
    area: "collective",
    authoritativeSource: "platform_fees",
    authoritativeKey: COLLECTIVE_APPLICATION_FEE_KEY,
    amountMinor: appFee.amountMinor,
    currency: appFee.currency,
    billingPeriod: "one_off",
    error: appFee.error,
    editorTab: "application-fee",
  });

  return entries;
}

export function registerPricingConsoleRoutes(app: Express): void {
  /**
   * THE SOURCE MAP. One request answers "which table decides this price, what
   * does it say, and over what period".
   */
  app.get("/api/admin/pricing-console/source-map", requireAdmin, (_req: Request, res: Response) => {
    try {
      res.json({
        ok: true,
        prices: buildPricingSourceMap(),
        repointableFeeKinds: REPOINTABLE_FEE_KINDS,
        authoritativeSourceByFeeKind: AUTHORITATIVE_SOURCE_BY_FEE_KIND,
        secondTablePurpose: NEGOTIATED_OVERRIDE_PURPOSE,
        caches: PRICE_CACHES,
        acks: listRepointAcks(),
      });
    } catch (e) {
      log.error("[pricing-console.source-map] failed:", (e as Error).message);
      res.status(500).json({ ok: false, error: "source_map_failed", message: sanitizeErrorMessage(e) });
    }
  });

  /**
   * DISPLAYED vs CHARGED for one partner/tier. Read-only: looking at the
   * difference must never be what changes it.
   */
  app.get("/api/admin/pricing-console/repoint", requireAdmin, (req: Request, res: Response) => {
    try {
      const partnerId = String(req.query.partnerId ?? "").trim();
      const tier = String(req.query.tier ?? "").trim();
      if (!tier) {
        return res.status(400).json({
          ok: false,
          error: "TIER_REQUIRED",
          message: "Pass ?tier=<slug> (and optionally &partnerId=) to compare the displayed and charged fee.",
        });
      }
      const rows = buildRepointPreview(partnerId, tier);
      res.json({
        ok: true,
        partnerId: partnerId || null,
        tier,
        rows,
        secondTablePurpose: NEGOTIATED_OVERRIDE_PURPOSE,
      });
    } catch (e) {
      log.error("[pricing-console.repoint] failed:", (e as Error).message);
      res.status(500).json({ ok: false, error: "repoint_preview_failed", message: sanitizeErrorMessage(e) });
    }
  });

  /**
   * THE EXPLICIT CONFIRMATION. `confirm: true` is REQUIRED — a repoint cannot
   * happen as a side effect of any other request. Both amounts are re-resolved
   * here so the record says what the change actually was.
   */
  app.post("/api/admin/pricing-console/repoint-ack", requireAdmin, (req: Request, res: Response) => {
    try {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const feeKind = String(b.feeKind ?? "").trim();
      const tier = String(b.tier ?? "").trim();
      const partnerId = String(b.partnerId ?? "").trim();
      if (b.confirm !== true) {
        return res.status(400).json({
          ok: false,
          error: "CONFIRMATION_REQUIRED",
          message:
            "Repointing what a partner is shown onto the authoritative source changes what they see. Send confirm: true to accept that explicitly.",
        });
      }
      if (!REPOINTABLE_FEE_KINDS.includes(feeKind)) {
        return res.status(400).json({
          ok: false,
          error: "FEE_KIND_UNKNOWN",
          message: `feeKind must be one of ${REPOINTABLE_FEE_KINDS.join(", ")}`,
        });
      }
      if (!tier) return res.status(400).json({ ok: false, error: "TIER_REQUIRED" });

      const displayed = resolveLegacyDisplayedFee(partnerId, tier, feeKind);
      const authoritative = resolveAuthoritativeDisplayedFee(partnerId, tier, feeKind);
      const ack = acknowledgeRepoint({
        feeKind,
        displayedAmountMinor: displayed.amountMinor,
        displayedCurrency: displayed.currency,
        authoritativeAmountMinor: authoritative.amountMinor,
        authoritativeCurrency: authoritative.currency,
        billingPeriod: authoritative.billingPeriod ?? periodForFeeKind(feeKind),
        acknowledgedByUserId: actorOf(req),
        note: typeof b.note === "string" ? b.note : null,
      });
      res.json({ ok: true, ack, displayed, authoritative });
    } catch (e) {
      log.error("[pricing-console.repoint-ack] failed:", (e as Error).message);
      res.status(500).json({ ok: false, error: "repoint_ack_failed", message: sanitizeErrorMessage(e) });
    }
  });
}

export default registerPricingConsoleRoutes;
