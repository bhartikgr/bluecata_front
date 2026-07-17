/**
 * v25.47 APD-031 (HIGH-3) — Collective admin settings (DB-backed, no in-memory
 * canonical state).
 *
 * Persists the Collective surface's admin-tunable settings onto the additive
 * `collective_admin_settings` table (migration 0071 + connection.ts bootstrap).
 * The whole settings object lives in one row (key='collective', value_json) so
 * the table's key/value_json shape backs a typed object without per-field rows.
 *
 * A documented PUBLIC subset (getPublicCollectiveSettings) is exposed unauthed
 * so the marketing/landing surfaces can render live copy without leaking the
 * admin-only fields.
 */
import { rawDb } from "./db/connection";

const SETTINGS_KEY = "collective";

/**
 * GROUP E (1e/E2) — admin-swappable venture-market data provider id. Kept as a
 * loose string here (the ventureMarketsStore owns the canonical union +
 * validation) to avoid a server→store import cycle. Default resolves from the
 * VENTURE_MARKET_PROVIDER env var when set, else "stooq".
 */
function defaultVentureProvider(): string {
  const env = process.env.VENTURE_MARKET_PROVIDER;
  return typeof env === "string" && env.trim().length > 0 ? env.trim() : "stooq";
}

export interface CollectiveSettings {
  /** Whether the Collective is accepting new founder applications. */
  applicationsOpen: boolean;
  /** Headline shown on the public membership/landing surface. */
  membershipHeadline: string;
  /** Short public blurb under the headline. */
  membershipBlurb: string;
  /** Public-facing support contact. */
  supportEmail: string;
  /** Admin-only internal note (never exposed publicly). */
  internalNote: string;
  /** GROUP E — active venture-market data provider id (admin-swappable). */
  ventureProvider: string;
  /**
   * W-V44 FIX K — per-provider market-data API keys (DB-backed, admin-config).
   * Keyed by provider id (e.g. "polygon", "finnhub", "alpha_vantage",
   * "twelve_data"). Stored server-side only; NEVER returned in full to the
   * client (getMaskedMarketDataApiKeys masks them). An empty/absent key means
   * the provider is not configured and the resolver falls back to the free
   * stooq/OECD baseline so nothing breaks. Source of truth is the DB row.
   */
  marketDataApiKeys: Record<string, string>;
}

export const DEFAULT_COLLECTIVE_SETTINGS: CollectiveSettings = {
  applicationsOpen: true,
  membershipHeadline: "Join the Capavate Collective",
  membershipBlurb: "A curated network of founders and private investors.",
  supportEmail: "scale@capavate.com",
  internalNote: "",
  ventureProvider: defaultVentureProvider(),
  marketDataApiKeys: {},
};

/** Fields safe to expose without authentication. */
const PUBLIC_FIELDS = [
  "applicationsOpen",
  "membershipHeadline",
  "membershipBlurb",
  "supportEmail",
] as const;

export type PublicCollectiveSettings = Pick<CollectiveSettings, (typeof PUBLIC_FIELDS)[number]>;

function coerce(raw: unknown): CollectiveSettings {
  const obj = (raw && typeof raw === "object") ? (raw as Record<string, unknown>) : {};
  return {
    applicationsOpen:
      typeof obj.applicationsOpen === "boolean"
        ? obj.applicationsOpen
        : DEFAULT_COLLECTIVE_SETTINGS.applicationsOpen,
    membershipHeadline:
      typeof obj.membershipHeadline === "string"
        ? obj.membershipHeadline
        : DEFAULT_COLLECTIVE_SETTINGS.membershipHeadline,
    membershipBlurb:
      typeof obj.membershipBlurb === "string"
        ? obj.membershipBlurb
        : DEFAULT_COLLECTIVE_SETTINGS.membershipBlurb,
    supportEmail:
      typeof obj.supportEmail === "string"
        ? obj.supportEmail
        : DEFAULT_COLLECTIVE_SETTINGS.supportEmail,
    internalNote:
      typeof obj.internalNote === "string"
        ? obj.internalNote
        : DEFAULT_COLLECTIVE_SETTINGS.internalNote,
    ventureProvider:
      typeof obj.ventureProvider === "string" && obj.ventureProvider.trim().length > 0
        ? obj.ventureProvider.trim()
        : DEFAULT_COLLECTIVE_SETTINGS.ventureProvider,
    // W-V44 FIX K — coerce the api-key map: keep only string values keyed by
    // string provider ids; drop anything malformed. Defaults to {} so absent
    // config is a well-defined "not configured" state (not undefined).
    marketDataApiKeys: coerceApiKeyMap(obj.marketDataApiKeys),
  };
}

/** W-V44 FIX K — sanitise the persisted api-key map. */
function coerceApiKeyMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k === "string" && k.trim().length > 0 && typeof v === "string" && v.trim().length > 0) {
      out[k.trim()] = v.trim();
    }
  }
  return out;
}

export function getCollectiveSettings(): CollectiveSettings {
  try {
    const row = rawDb()
      .prepare(`SELECT value_json FROM collective_admin_settings WHERE key = ?`)
      .get(SETTINGS_KEY) as { value_json: string | null } | undefined;
    if (row && row.value_json) {
      return coerce(JSON.parse(row.value_json));
    }
  } catch {
    // fall through to defaults
  }
  return { ...DEFAULT_COLLECTIVE_SETTINGS };
}

export function getPublicCollectiveSettings(): PublicCollectiveSettings {
  const full = getCollectiveSettings();
  return {
    applicationsOpen: full.applicationsOpen,
    membershipHeadline: full.membershipHeadline,
    membershipBlurb: full.membershipBlurb,
    supportEmail: full.supportEmail,
  };
}

/** Merge a partial patch over the current settings and persist. */
export function updateCollectiveSettings(patch: Partial<CollectiveSettings>): CollectiveSettings {
  const current = getCollectiveSettings();
  const next = coerce({ ...current, ...patch });
  rawDb()
    .prepare(
      `INSERT INTO collective_admin_settings (key, value_json, updated_at)
         VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    )
    .run(SETTINGS_KEY, JSON.stringify(next), new Date().toISOString());
  return next;
}

/* ============================================================================
 * W-V44 FIX K — market-data API-key accessors (DB-backed source of truth).
 * ==========================================================================*/

/**
 * Server-only: return the REAL (unmasked) API key for a provider, or "" when
 * not configured. Used exclusively by the live provider adapters — never sent
 * to the client.
 */
export function getMarketDataApiKey(providerId: string): string {
  const keys = getCollectiveSettings().marketDataApiKeys;
  const v = keys[providerId];
  return typeof v === "string" ? v : "";
}

/**
 * Client-safe: mask every stored key so the admin UI can show "configured vs
 * not" WITHOUT leaking the secret. A configured key becomes e.g. "•••• last4";
 * an absent key is omitted. NEVER returns the raw secret.
 */
export function getMaskedMarketDataApiKeys(): Record<string, string> {
  const keys = getCollectiveSettings().marketDataApiKeys;
  const out: Record<string, string> = {};
  for (const [provider, secret] of Object.entries(keys)) {
    if (typeof secret === "string" && secret.length > 0) {
      const last4 = secret.length >= 4 ? secret.slice(-4) : secret;
      out[provider] = `•••• ${last4}`;
    }
  }
  return out;
}

/**
 * Merge a single provider's API key into the map and persist. Passing an empty
 * string CLEARS that provider's key (removes it), which reverts that provider
 * to "not configured". Other providers' keys are preserved (merge, not replace).
 */
export function setMarketDataApiKey(providerId: string, key: string): CollectiveSettings {
  const current = getCollectiveSettings();
  const nextKeys = { ...current.marketDataApiKeys };
  const trimmed = typeof key === "string" ? key.trim() : "";
  if (trimmed.length > 0) {
    nextKeys[providerId] = trimmed;
  } else {
    delete nextKeys[providerId];
  }
  return updateCollectiveSettings({ marketDataApiKeys: nextKeys });
}
