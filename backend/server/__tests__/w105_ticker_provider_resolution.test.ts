/**
 * WAVE 105 — the ticker must honour the ADMIN-CONFIGURED, DB-BACKED market data
 * provider, live, per request.
 *
 * These tests encode the owner's reported symptom: an administrator selects a
 * provider on the Integrations screen (persisted in `collective_admin_settings`)
 * and the ticker still reports PROVIDER_NOT_CONFIGURED because feedsStore read
 * one env var ONCE at module load. Every assertion below that mentions
 * "the exact bug" FAILS on the pre-wave code.
 *
 * HARD RULES asserted here:
 *   - No fabricated prices: an unresolved provider means empty arrays.
 *   - Env, if set, wins; otherwise the database decides.
 *   - A key-gated provider without a key falls back to the free feed.
 *   - No API key may ever appear in the browser-facing payload.
 *   - An admin change applies with NO restart.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  buildTickerPayload,
  resolveTickerProvider,
  _invalidateFeedsCache,
} from "../feedsStore";
import {
  updateCollectiveSettings,
  setMarketDataApiKey,
} from "../collectiveAdminSettingsStore";
import { rawDb } from "../db/connection";

const ENV_KEY = "FEEDS_PROVIDER";
const ORIGINAL_ENV = process.env[ENV_KEY];

/** Remove every persisted admin selection — a never-configured deployment. */
function clearAdminSettings(): void {
  try {
    rawDb().prepare(`DELETE FROM collective_admin_settings WHERE key = ?`).run("collective");
  } catch {
    /* table absent — already "not configured" */
  }
}

function clearEnv(): void {
  delete process.env[ENV_KEY];
}

beforeEach(() => {
  clearEnv();
  clearAdminSettings();
  _invalidateFeedsCache();
});

afterAll(() => {
  clearEnv();
  if (typeof ORIGINAL_ENV === "string") process.env[ENV_KEY] = ORIGINAL_ENV;
  clearAdminSettings();
  _invalidateFeedsCache();
});

describe("W105 — DB-configured provider is honoured with NO env var (the exact bug)", () => {
  it("resolves the administrator's persisted provider when no env var is set", () => {
    updateCollectiveSettings({ ventureProvider: "stooq" });
    const p = resolveTickerProvider();
    expect(p.source).toBe("admin");
    expect(p.configured).toBe("stooq");
    expect(p.feed).not.toBeNull();
  });

  it("the ticker payload leaves PROVIDER_NOT_CONFIGURED once an admin has configured a provider", async () => {
    updateCollectiveSettings({ ventureProvider: "stooq" });
    const payload = await buildTickerPayload();
    // THIS is the owner's symptom: on the pre-wave code this is
    // "PROVIDER_NOT_CONFIGURED" no matter what the admin screen says.
    expect(payload.status).toBe("OK");
    expect(payload.provider.source).toBe("admin");
    expect(payload.provider.configured).toBe("stooq");
    // Quotes may legitimately be null (upstream rate limit / offline) — but they
    // must be real nulls, never invented numbers.
    for (const q of [...payload.market, ...payload.crypto, ...payload.macro]) {
      expect(q.last === null || typeof q.last === "number").toBe(true);
    }
  });
});

describe("W105 — no provider anywhere stays honestly empty", () => {
  it("returns PROVIDER_NOT_CONFIGURED with empty arrays and no fabricated numbers", async () => {
    const payload = await buildTickerPayload();
    expect(payload.status).toBe("PROVIDER_NOT_CONFIGURED");
    expect(payload.market).toEqual([]);
    expect(payload.crypto).toEqual([]);
    expect(payload.macro).toEqual([]);
    expect(payload.provider.source).toBe("none");
    expect(payload.provider.feed).toBeNull();
    // Absolutely no substituted zeros / dashes / sample rows.
    const serialised = JSON.stringify({
      market: payload.market,
      crypto: payload.crypto,
      macro: payload.macro,
    });
    expect(serialised).toBe('{"market":[],"crypto":[],"macro":[]}');
    // The Capavate pulse is still real DB-backed data.
    expect(typeof payload.capavate.applicationsToday).toBe("number");
  });
});

describe("W105 — precedence: env wins, otherwise the database decides", () => {
  it("an env var overrides the administrator's database selection", () => {
    updateCollectiveSettings({ ventureProvider: "alpha_vantage" });
    process.env[ENV_KEY] = "yahoo_coingecko";
    const p = resolveTickerProvider();
    expect(p.source).toBe("environment");
    expect(p.configured).toBe("yahoo_coingecko");
    expect(p.feed).toBe("yahoo_coingecko");
  });

  it("keeps the historical env behaviour: an unrecognised env value leaves feeds off", () => {
    updateCollectiveSettings({ ventureProvider: "stooq" });
    process.env[ENV_KEY] = "not_a_real_provider";
    const p = resolveTickerProvider();
    expect(p.source).toBe("none");
    expect(p.feed).toBeNull();
  });

  it("the free keyless env value still enables the feed exactly as before", async () => {
    process.env[ENV_KEY] = "yahoo_coingecko";
    const payload = await buildTickerPayload();
    expect(payload.status).toBe("OK");
    expect(payload.provider.source).toBe("environment");
  });
});

describe("W105 — key-gated provider without a key falls back to the free feed", () => {
  it("falls back (never errors, never blanks) when no key is configured", () => {
    setMarketDataApiKey("alpha_vantage", "");
    updateCollectiveSettings({ ventureProvider: "alpha_vantage" });
    const p = resolveTickerProvider();
    expect(p.configured).toBe("alpha_vantage");
    expect(p.feed).not.toBeNull();
    expect(p.freeFeedFallback).toBe(true);
  });

  it("does not report a fallback once the administrator stores a key", () => {
    updateCollectiveSettings({ ventureProvider: "alpha_vantage" });
    setMarketDataApiKey("alpha_vantage", "W105_KEY_ONLY_FOR_TESTS_OGLG");
    const p = resolveTickerProvider();
    expect(p.freeFeedFallback).toBe(false);
    // The descriptor itself must never carry the secret.
    expect(JSON.stringify(p)).not.toContain("OGLG");
    setMarketDataApiKey("alpha_vantage", "");
  });
});

describe("W105 — no secret ever reaches the browser payload", () => {
  it("the serialised ticker response contains no API key material", async () => {
    const SECRET = "W105_SUPER_SECRET_KEY_ZZZZ";
    updateCollectiveSettings({ ventureProvider: "alpha_vantage" });
    setMarketDataApiKey("alpha_vantage", SECRET);
    const payload = await buildTickerPayload();
    const serialised = JSON.stringify(payload);
    expect(serialised).not.toContain(SECRET);
    expect(serialised).not.toContain("ZZZZ");
    expect(serialised.toLowerCase()).not.toContain("apikey");
    expect(serialised).not.toContain("marketDataApiKeys");
    expect(serialised).not.toContain("secret");
    setMarketDataApiKey("alpha_vantage", "");
  });
});

describe("W105 — an admin change applies live, with no restart", () => {
  it("reflects a database change between two calls of the same builder", async () => {
    const before = await buildTickerPayload();
    expect(before.status).toBe("PROVIDER_NOT_CONFIGURED");

    // Same process, same module instance — exactly what an admin save does.
    updateCollectiveSettings({ ventureProvider: "stooq" });
    _invalidateFeedsCache();

    const after = await buildTickerPayload();
    expect(after.status).toBe("OK");
    expect(after.provider.source).toBe("admin");
  });
});
