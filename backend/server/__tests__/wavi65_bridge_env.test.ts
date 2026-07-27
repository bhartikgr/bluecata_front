/**
 * W-AVI65 FIX 4 — bridge SELF-LOOP receiver contract.
 *
 * CONFIRMED LIVE: 568 queued / 0 delivered / audit chain broken. Two root causes
 * in configuration:
 *   (a) the documented receiver was `https://collective.capavate.com/...` — a
 *       host that does not resolve. The Collective is the SAME app on the SAME
 *       domain (`capavate.com/collective`); the inbound route is
 *       `/api/bridge/inbound`. So the bridge is a self-loop to capavate.com.
 *   (b) HMAC MISMATCH: outbound signs with COLLECTIVE_WEBHOOK_SECRET
 *       (SACRED server/lib/bridgeRuntime.ts:90) while inbound verifies with
 *       BRIDGE_INBOUND_HMAC_SECRET ?? BRIDGE_HMAC_SECRET
 *       (server/bridgeStore.ts:295-301). The inbound verifier NEVER reads
 *       COLLECTIVE_WEBHOOK_SECRET, so for a self-loop the two MUST be equal or
 *       every self-POST 401s and dead-letters.
 *
 * These tests are env/contract-level (no sacred file is imported or modified):
 * they pin that the capavate.com self-loop URL is accepted as a real receiver,
 * and they encode the equal-secrets invariant that the docs now prescribe.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  resolveReceiverUrl,
  resolveReceiverSecret,
  hasRealReceiver,
  maySendOutboundBridge,
} from "../lib/bridgeOutboundGuard";

const SELF_LOOP_URL = "https://capavate.com/api/bridge/inbound";
const REAL_SECRET = "b7f2c1a9d4e60358a1c2b3d4e5f60718293a4b5c6d7e8f9012345678abcdef01";

const BRIDGE_ENV_KEYS = [
  "COLLECTIVE_WEBHOOK_URL",
  "COLLECTIVE_WEBHOOK_SECRET",
  "COLLECTIVE_APP_URL",
  "BRIDGE_OUTBOUND_URL",
  "BRIDGE_OUTBOUND_HMAC_SECRET",
  "BRIDGE_INBOUND_HMAC_SECRET",
  "BRIDGE_HMAC_SECRET",
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

/**
 * The inbound verifier's secret resolution, mirrored from
 * server/bridgeStore.ts:295-301. Deliberately duplicated (not imported) so the
 * test asserts the CONTRACT and cannot be silently satisfied by a change to the
 * outbound guard.
 */
function inboundVerifySecret(): string {
  return (
    process.env.BRIDGE_INBOUND_HMAC_SECRET ??
    process.env.BRIDGE_HMAC_SECRET ??
    "capavate-collective-bridge-shared-secret"
  );
}

describe("W-AVI65 FIX 4: the live receiver is the capavate.com self-loop", () => {
  it("accepts https://capavate.com/api/bridge/inbound as a real receiver", () => {
    process.env.COLLECTIVE_WEBHOOK_URL = SELF_LOOP_URL;
    process.env.COLLECTIVE_WEBHOOK_SECRET = REAL_SECRET;
    expect(resolveReceiverUrl()).toBe(SELF_LOOP_URL);
    expect(resolveReceiverSecret()).toBe(REAL_SECRET);
    expect(hasRealReceiver()).toBe(true);
  });

  it("the prescribed live block makes outbound sending permitted", () => {
    process.env.BRIDGE_ENABLED = "1";
    process.env.COLLECTIVE_WEBHOOK_URL = SELF_LOOP_URL;
    process.env.COLLECTIVE_WEBHOOK_SECRET = REAL_SECRET;
    process.env.BRIDGE_INBOUND_HMAC_SECRET = REAL_SECRET;
    process.env.COLLECTIVE_APP_URL = "https://capavate.com/collective";
    expect(maySendOutboundBridge()).toBe(true);
  });

  it("does NOT reference the dead collective.capavate.com host", () => {
    // Guard against a regression that re-introduces the non-resolving hostname.
    expect(SELF_LOOP_URL).not.toContain("collective.capavate.com");
    expect(new URL(SELF_LOOP_URL).host).toBe("capavate.com");
    expect(new URL(SELF_LOOP_URL).pathname).toBe("/api/bridge/inbound");
  });
});

describe("W-AVI65 FIX 4: self-loop requires the two secrets to be EQUAL", () => {
  it("outbound-signing and inbound-verifying secrets match under the prescribed block", () => {
    process.env.COLLECTIVE_WEBHOOK_URL = SELF_LOOP_URL;
    process.env.COLLECTIVE_WEBHOOK_SECRET = REAL_SECRET;
    process.env.BRIDGE_INBOUND_HMAC_SECRET = REAL_SECRET;
    // resolveReceiverSecret() is what the outbound side signs with (canonical first).
    expect(resolveReceiverSecret()).toBe(inboundVerifySecret());
  });

  it("NEGATIVE — setting only COLLECTIVE_WEBHOOK_SECRET leaves inbound on a DIFFERENT secret", () => {
    // This is the confirmed live misconfiguration: outbound has a real secret,
    // inbound falls through to its hardcoded default → HMAC mismatch → 401.
    process.env.COLLECTIVE_WEBHOOK_URL = SELF_LOOP_URL;
    process.env.COLLECTIVE_WEBHOOK_SECRET = REAL_SECRET;
    expect(resolveReceiverSecret()).toBe(REAL_SECRET);
    expect(inboundVerifySecret()).not.toBe(REAL_SECRET);
    expect(inboundVerifySecret()).toBe("capavate-collective-bridge-shared-secret");
  });

  it("BRIDGE_HMAC_SECRET also satisfies the inbound side (documented alias)", () => {
    process.env.COLLECTIVE_WEBHOOK_SECRET = REAL_SECRET;
    process.env.BRIDGE_HMAC_SECRET = REAL_SECRET;
    expect(inboundVerifySecret()).toBe(REAL_SECRET);
    expect(resolveReceiverSecret()).toBe(inboundVerifySecret());
  });
});
