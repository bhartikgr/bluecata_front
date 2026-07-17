/**
 * v25.47 APD-031 (HIGH-3) — Collective admin settings routes.
 *
 *   GET  /api/admin/collective-settings   (admin)  — full settings object
 *   PUT  /api/admin/collective-settings   (admin)  — merge-patch + persist
 *   GET  /api/collective/public-settings  (public) — public-safe subset
 *
 * Persistence lives in server/collectiveAdminSettingsStore.ts (DB-backed).
 */
import type { Express, Request, Response } from "express";
import { requireAdmin } from "./lib/authMiddleware";
import { appendAdminAudit } from "./adminPlatformStore";
import { sanitizeErrorMessage } from "./lib/sanitize";
import { log } from "./lib/logger";
import {
  getCollectiveSettings,
  getPublicCollectiveSettings,
  updateCollectiveSettings,
  getMaskedMarketDataApiKeys,
  setMarketDataApiKey,
  type CollectiveSettings,
} from "./collectiveAdminSettingsStore";
import {
  isVentureProviderId,
  setProvider,
  getActiveProvider,
  VENTURE_PROVIDER_IDS,
  VENTURE_PROVIDER_META,
} from "./ventureMarketsStore"; /* GROUP E (1e/E2) + W-V44 FIX K */

/**
 * W-V44 FIX K — build the client-safe integrations payload. NEVER includes raw
 * API keys: keys are masked ("•••• last4") and each provider carries a
 * `configured` boolean so the admin UI can show status without the secret.
 */
function buildIntegrationsPayload() {
  const masked = getMaskedMarketDataApiKeys();
  const active = getActiveProvider();
  const providers = VENTURE_PROVIDER_IDS.map((id) => {
    const meta = VENTURE_PROVIDER_META[id];
    return {
      id,
      label: meta.label,
      requiresKey: meta.requiresKey,
      docsUrl: meta.docsUrl,
      blurb: meta.blurb,
      configured: Boolean(masked[id]),
      maskedKey: masked[id] ?? "",
    };
  });
  return { active, providers };
}

function actorOf(req: Request): string {
  const ctx = (req as Request & {
    userContext?: { identity?: { email?: string }; userId?: string };
  }).userContext;
  return String(ctx?.identity?.email ?? ctx?.userId ?? "admin");
}

export function registerCollectiveAdminSettingsRoutes(app: Express): void {
  app.get("/api/admin/collective-settings", requireAdmin, (_req: Request, res: Response) => {
    try {
      // W-V44 FIX K — never leak raw market-data API keys to the client. Replace
      // the secret map with the masked view ("•••• last4") before returning.
      const settings = { ...getCollectiveSettings(), marketDataApiKeys: getMaskedMarketDataApiKeys() };
      return res.json({ ok: true, settings });
    } catch (err) {
      log.error("[collectiveAdminSettingsRoutes.get] failed:", (err as Error).message);
      return res
        .status(500)
        .json({ ok: false, error: "read_failed", message: sanitizeErrorMessage(err) });
    }
  });

  app.put("/api/admin/collective-settings", requireAdmin, (req: Request, res: Response) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const patch: Partial<CollectiveSettings> = {};
    if ("applicationsOpen" in b) {
      if (typeof b.applicationsOpen !== "boolean") {
        return res.status(400).json({ ok: false, error: "applicationsOpen must be a boolean" });
      }
      patch.applicationsOpen = b.applicationsOpen;
    }
    for (const key of ["membershipHeadline", "membershipBlurb", "supportEmail", "internalNote"] as const) {
      if (key in b) {
        if (typeof b[key] !== "string") {
          return res.status(400).json({ ok: false, error: `${key} must be a string` });
        }
        patch[key] = b[key] as string;
      }
    }
    // GROUP E (1e/E2) — admin-swappable venture-market data provider.
    if ("ventureProvider" in b) {
      if (!isVentureProviderId(b.ventureProvider)) {
        return res.status(400).json({ ok: false, error: "ventureProvider is not a known provider id" });
      }
      patch.ventureProvider = b.ventureProvider;
    }
    let saved: CollectiveSettings;
    try {
      saved = updateCollectiveSettings(patch);
      // GROUP E / W-V44 FIX K (Option A) — apply the provider swap live. The
      // admin selection is the single source of truth (env no longer overrides
      // at read time; it only seeds a fresh DB).
      if (patch.ventureProvider && isVentureProviderId(saved.ventureProvider)) {
        setProvider(saved.ventureProvider);
      }
    } catch (err) {
      log.error("[collectiveAdminSettingsRoutes.put] failed:", (err as Error).message);
      return res
        .status(500)
        .json({ ok: false, error: "update_failed", message: sanitizeErrorMessage(err) });
    }
    try {
      appendAdminAudit(actorOf(req), "collective_admin_settings:collective", "collective_settings_updated", {
        keys: Object.keys(patch),
      });
    } catch (auditErr) {
      log.warn(
        "[collectiveAdminSettingsRoutes.put] audit append failed (non-fatal):",
        (auditErr as Error).message,
      );
    }
    // W-V44 FIX K (H1 leak fix) — the PUT fires on every admin provider switch
    // (AdminIntegrations.tsx). NEVER return the raw marketDataApiKeys map here;
    // mask it exactly like the GET so secrets never reach the browser.
    const safeSaved = { ...saved, marketDataApiKeys: getMaskedMarketDataApiKeys() };
    return res.json({ ok: true, settings: safeSaved });
  });

  // W-V44 FIX K — market-data integrations: provider list + masked keys + active.
  app.get("/api/admin/market-data-integrations", requireAdmin, (_req: Request, res: Response) => {
    try {
      return res.json({ ok: true, ...buildIntegrationsPayload() });
    } catch (err) {
      log.error("[marketDataIntegrations.get] failed:", (err as Error).message);
      return res
        .status(500)
        .json({ ok: false, error: "read_failed", message: sanitizeErrorMessage(err) });
    }
  });

  // W-V44 FIX K — set/clear a provider's API key (empty string clears it). Never
  // echoes the raw key back; returns the refreshed masked payload.
  app.post("/api/admin/market-data-integrations/key", requireAdmin, (req: Request, res: Response) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (!isVentureProviderId(b.provider)) {
      return res.status(400).json({ ok: false, error: "provider is not a known provider id" });
    }
    if (typeof b.apiKey !== "string") {
      return res.status(400).json({ ok: false, error: "apiKey must be a string" });
    }
    try {
      setMarketDataApiKey(b.provider, b.apiKey);
    } catch (err) {
      log.error("[marketDataIntegrations.key] failed:", (err as Error).message);
      return res
        .status(500)
        .json({ ok: false, error: "update_failed", message: sanitizeErrorMessage(err) });
    }
    try {
      appendAdminAudit(
        actorOf(req),
        `market_data_integration:${b.provider}`,
        b.apiKey.trim().length > 0 ? "market_data_api_key_set" : "market_data_api_key_cleared",
        { provider: b.provider }, // NEVER log the key itself
      );
    } catch (auditErr) {
      log.warn("[marketDataIntegrations.key] audit append failed (non-fatal):", (auditErr as Error).message);
    }
    return res.json({ ok: true, ...buildIntegrationsPayload() });
  });

  app.get("/api/collective/public-settings", (_req: Request, res: Response) => {
    try {
      return res.json({ ok: true, settings: getPublicCollectiveSettings() });
    } catch (err) {
      log.error("[collectiveAdminSettingsRoutes.public] failed:", (err as Error).message);
      return res
        .status(500)
        .json({ ok: false, error: "read_failed", message: sanitizeErrorMessage(err) });
    }
  });

  log.info("[v25.47 APD-031] registered collective-admin-settings routes");
}

export default registerCollectiveAdminSettingsRoutes;
