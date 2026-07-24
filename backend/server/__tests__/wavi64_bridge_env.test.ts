/**
 * W-AVI64 FIX 3 — bridge outbound receiver env-name ALIAS resolution.
 *
 * Root cause: the live production `.env` ships the external receiver under the
 * legacy names `BRIDGE_OUTBOUND_URL` + `BRIDGE_INBOUND_HMAC_SECRET`, while the
 * outbound guard (and the Sacred bridgeRuntime.ts) historically read ONLY the
 * canonical `COLLECTIVE_WEBHOOK_URL` / `COLLECTIVE_WEBHOOK_SECRET`. With the
 * canonical names unset, hasRealReceiver() returned false → the worker never
 * started → the outbox never drained (561 queued, 0 delivered).
 *
 * These tests pin the additive alias-fallback behavior in the NON-sacred
 * bridgeOutboundGuard: the canonical names still win when present, the legacy
 * aliases are honoured when they are not, and placeholder secrets are always
 * rejected so a bogus HMAC key can never be treated as a real receiver.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  resolveReceiverUrl,
  resolveReceiverSecret,
  hasRealReceiver,
  isPlaceholderSecret,
  maySendOutboundBridge,
} from "../lib/bridgeOutboundGuard";

const BRIDGE_ENV_KEYS = [
  "COLLECTIVE_WEBHOOK_URL",
  "COLLECTIVE_WEBHOOK_SECRET",
  "BRIDGE_OUTBOUND_URL",
  "BRIDGE_OUTBOUND_HMAC_SECRET",
  "BRIDGE_INBOUND_HMAC_SECRET",
  "BRIDGE_ENABLED",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of BRIDGE_ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of BRIDGE_ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("W-AVI64 FIX 3: receiver URL alias fallback", () => {
  it("prefers the canonical COLLECTIVE_WEBHOOK_URL when present", () => {
    process.env.COLLECTIVE_WEBHOOK_URL = "https://collective.capavate.com/api/bridge/inbox";
    process.env.BRIDGE_OUTBOUND_URL = "https://legacy.example/inbox";
    expect(resolveReceiverUrl()).toBe("https://collective.capavate.com/api/bridge/inbox");
  });

  it("falls back to the legacy BRIDGE_OUTBOUND_URL when the canonical is unset", () => {
    process.env.BRIDGE_OUTBOUND_URL = "https://legacy.example/inbox";
    expect(resolveReceiverUrl()).toBe("https://legacy.example/inbox");
  });

  it("returns empty string when neither is set", () => {
    expect(resolveReceiverUrl()).toBe("");
  });
});

describe("W-AVI64 FIX 3: receiver secret alias fallback", () => {
  it("prefers the canonical COLLECTIVE_WEBHOOK_SECRET", () => {
    process.env.COLLECTIVE_WEBHOOK_SECRET = "real-canonical-secret-abc123";
    process.env.BRIDGE_INBOUND_HMAC_SECRET = "real-legacy-secret-xyz789";
    expect(resolveReceiverSecret()).toBe("real-canonical-secret-abc123");
  });

  it("falls back through BRIDGE_OUTBOUND_HMAC_SECRET then BRIDGE_INBOUND_HMAC_SECRET", () => {
    process.env.BRIDGE_INBOUND_HMAC_SECRET = "real-legacy-secret-xyz789";
    expect(resolveReceiverSecret()).toBe("real-legacy-secret-xyz789");

    process.env.BRIDGE_OUTBOUND_HMAC_SECRET = "real-outbound-secret-def456";
    expect(resolveReceiverSecret()).toBe("real-outbound-secret-def456");
  });
});

describe("W-AVI64 FIX 3: placeholder secrets are never a real receiver", () => {
  it("rejects the deploy-template placeholder YOUR_STRONG_SECRET", () => {
    expect(isPlaceholderSecret("YOUR_STRONG_SECRET")).toBe(true);
    expect(isPlaceholderSecret("changeme")).toBe(true);
    expect(isPlaceholderSecret("")).toBe(true);
    expect(isPlaceholderSecret("a-genuine-shared-secret-9f2c")).toBe(false);
  });

  it("hasRealReceiver requires a real URL AND a non-placeholder secret", () => {
    // URL present but the shipped .env placeholder secret → NOT a real receiver.
    process.env.BRIDGE_OUTBOUND_URL = "https://legacy.example/inbox";
    process.env.BRIDGE_INBOUND_HMAC_SECRET = "YOUR_STRONG_SECRET";
    expect(hasRealReceiver()).toBe(false);

    // Swap in a real shared secret via the legacy alias → now complete.
    process.env.BRIDGE_INBOUND_HMAC_SECRET = "a-genuine-shared-secret-9f2c";
    expect(hasRealReceiver()).toBe(true);
  });

  it("maySendOutboundBridge is true only when BRIDGE_ENABLED=1 AND the receiver is complete", () => {
    process.env.COLLECTIVE_WEBHOOK_URL = "https://collective.capavate.com/api/bridge/inbox";
    process.env.COLLECTIVE_WEBHOOK_SECRET = "a-genuine-shared-secret-9f2c";

    process.env.BRIDGE_ENABLED = "0";
    expect(maySendOutboundBridge()).toBe(false);

    process.env.BRIDGE_ENABLED = "1";
    expect(maySendOutboundBridge()).toBe(true);
  });
});
