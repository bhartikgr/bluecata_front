/**
 * W-V44 wave — unit tests for the pure logic added in this wave.
 * Covers: R3 seat-limit resolver, FIX K market-data key masking, and the
 * FIX K provider metadata/enum integrity. DB-touching paths (banner resolve,
 * stage canonicalization on the dashboard) are exercised in the live walkthrough;
 * here we assert the deterministic pure functions.
 */
import { describe, it, expect } from "vitest";
import { resolveEffectiveSeatLimit, TIER_SEAT_LIMITS } from "../adminContactsStore";
import {
  VENTURE_PROVIDER_IDS,
  KEY_GATED_PROVIDER_IDS,
  VENTURE_PROVIDER_META,
  isVentureProviderId,
} from "../ventureMarketsStore";
import {
  getMaskedMarketDataApiKeys,
  setMarketDataApiKey,
  getMarketDataApiKey,
} from "../collectiveAdminSettingsStore";

describe("W-V44 R3 — resolveEffectiveSeatLimit (tier base + per-partner override)", () => {
  it("falls back to the tier default when there is no arrangement json", () => {
    const r = resolveEffectiveSeatLimit("catalyst", null);
    expect(r.seatLimit).toBe(TIER_SEAT_LIMITS.catalyst);
    expect(r.source).toBe("tier");
  });

  it("falls back to the tier default when arrangement json has no seatLimit", () => {
    const r = resolveEffectiveSeatLimit("builder", JSON.stringify({ quota: { threshold: 5 } }));
    expect(r.seatLimit).toBe(TIER_SEAT_LIMITS.builder);
    expect(r.source).toBe("tier");
  });

  it("uses the per-partner override when present and valid", () => {
    const r = resolveEffectiveSeatLimit("catalyst", JSON.stringify({ seatLimit: 7 }));
    expect(r.seatLimit).toBe(7);
    expect(r.source).toBe("override");
  });

  it("accepts an explicit 0 override (revoke all seats)", () => {
    const r = resolveEffectiveSeatLimit("amplifier", JSON.stringify({ seatLimit: 0 }));
    expect(r.seatLimit).toBe(0);
    expect(r.source).toBe("override");
  });

  it("ignores a negative or non-integer override (falls back to tier)", () => {
    expect(resolveEffectiveSeatLimit("catalyst", JSON.stringify({ seatLimit: -3 })).source).toBe("tier");
    expect(resolveEffectiveSeatLimit("catalyst", JSON.stringify({ seatLimit: 2.5 })).source).toBe("tier");
    expect(resolveEffectiveSeatLimit("catalyst", JSON.stringify({ seatLimit: "10" })).source).toBe("tier");
  });

  it("never throws on malformed json (falls back to tier)", () => {
    const r = resolveEffectiveSeatLimit("nexus", "{not valid json");
    expect(r.seatLimit).toBe(TIER_SEAT_LIMITS.nexus);
    expect(r.source).toBe("tier");
  });
});

describe("W-V44 FIX K — venture provider enum + metadata integrity", () => {
  it("includes the four requested live providers plus the free defaults", () => {
    for (const id of ["stooq", "oecd_baseline", "alpha_vantage", "finnhub", "polygon", "twelve_data"]) {
      expect(VENTURE_PROVIDER_IDS).toContain(id);
      expect(isVentureProviderId(id)).toBe(true);
    }
  });

  it("marks exactly the key-gated providers as requiring a key", () => {
    for (const id of KEY_GATED_PROVIDER_IDS) {
      expect(VENTURE_PROVIDER_META[id].requiresKey).toBe(true);
    }
    expect(VENTURE_PROVIDER_META.stooq.requiresKey).toBe(false);
    expect(VENTURE_PROVIDER_META.oecd_baseline.requiresKey).toBe(false);
  });

  it("has metadata (label + blurb) for every provider id", () => {
    for (const id of VENTURE_PROVIDER_IDS) {
      expect(VENTURE_PROVIDER_META[id].label.length).toBeGreaterThan(0);
      expect(VENTURE_PROVIDER_META[id].blurb.length).toBeGreaterThan(0);
    }
  });

  it("rejects unknown provider ids", () => {
    expect(isVentureProviderId("bloomberg")).toBe(false);
    expect(isVentureProviderId("")).toBe(false);
    expect(isVentureProviderId(null)).toBe(false);
  });
});

describe("W-V44 FIX K — market-data API key masking (never leaks the secret)", () => {
  it("round-trips a key: set -> real getter returns it, masked getter hides it", () => {
    setMarketDataApiKey("polygon", "SECRET_POLYGON_KEY_1234");
    expect(getMarketDataApiKey("polygon")).toBe("SECRET_POLYGON_KEY_1234");
    const masked = getMaskedMarketDataApiKeys();
    expect(masked.polygon).toBeDefined();
    expect(masked.polygon).not.toContain("SECRET");
    expect(masked.polygon).toContain("1234"); // last-4 only
    // cleanup
    setMarketDataApiKey("polygon", "");
    expect(getMarketDataApiKey("polygon")).toBe("");
  });

  it("clearing a key removes it from the masked view", () => {
    setMarketDataApiKey("finnhub", "abcd1234");
    expect(getMaskedMarketDataApiKeys().finnhub).toBeDefined();
    setMarketDataApiKey("finnhub", "");
    expect(getMaskedMarketDataApiKeys().finnhub).toBeUndefined();
  });

  it("setting one provider's key preserves others (merge, not replace)", () => {
    setMarketDataApiKey("polygon", "polyKEY9999");
    setMarketDataApiKey("twelve_data", "twelveKEY8888");
    const masked = getMaskedMarketDataApiKeys();
    expect(masked.polygon).toContain("9999");
    expect(masked.twelve_data).toContain("8888");
    // cleanup
    setMarketDataApiKey("polygon", "");
    setMarketDataApiKey("twelve_data", "");
  });
});
