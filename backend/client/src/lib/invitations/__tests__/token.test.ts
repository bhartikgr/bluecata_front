import { describe, it, expect } from "vitest";
import {
  TOKEN_BYTES,
  DEFAULT_TTL_MS,
  generateRawToken,
  hashToken,
  tokenHashEquals,
  issueInvitation,
  redeemInvitation,
  revokeInvitation,
  statusOf,
  findByToken,
} from "../token";

describe("invitation tokens (Sprint 7 / R200.gating §1)", () => {
  it("generates 256-bit base64url tokens with no padding", () => {
    const t = generateRawToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(t, "base64url").length).toBe(TOKEN_BYTES);
  });

  it("two consecutive tokens are distinct", () => {
    expect(generateRawToken()).not.toBe(generateRawToken());
  });

  it("hashToken yields a 64-hex-char SHA-256 digest", () => {
    const h = hashToken("not-a-real-token");
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    expect(hashToken("not-a-real-token")).toBe(h);
  });

  it("tokenHashEquals returns true only on exact match", () => {
    const a = "0".repeat(64);
    const b = "0".repeat(64);
    const c = "f" + "0".repeat(63);
    expect(tokenHashEquals(a, b)).toBe(true);
    expect(tokenHashEquals(a, c)).toBe(false);
    expect(tokenHashEquals(a, a + "x")).toBe(false);
  });

  it("issueInvitation persists the hash, never the raw token", () => {
    const { rawToken, record } = issueInvitation({
      id: "inv_1",
      roundId: "rnd_a",
      companyId: "co_a",
      companyName: "Test Co",
      inviteeEmail: "x@y.com",
    });
    expect(record.tokenHash).toBe(hashToken(rawToken));
    expect(JSON.stringify(record)).not.toContain(rawToken);
  });

  it("default TTL is 30 days, configurable per-issue", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const { record: a } = issueInvitation({
      id: "inv_a", roundId: "r", companyId: "c", companyName: "X", inviteeEmail: "x@y.com", now,
    });
    expect(new Date(a.expiresAt).getTime() - now.getTime()).toBe(DEFAULT_TTL_MS);

    const { record: b } = issueInvitation({
      id: "inv_b", roundId: "r", companyId: "c", companyName: "X", inviteeEmail: "x@y.com",
      now, ttlMs: 60 * 60 * 1000,
    });
    expect(new Date(b.expiresAt).getTime() - now.getTime()).toBe(60 * 60 * 1000);
  });

  it("redeemInvitation succeeds once and is single-use", () => {
    const { rawToken, record } = issueInvitation({
      id: "inv_2", roundId: "r", companyId: "c", companyName: "X", inviteeEmail: "x@y.com",
    });
    const records = [record];
    const r1 = redeemInvitation(records, rawToken);
    expect(r1.ok).toBe(true);
    expect(r1.record?.redeemed).toBe(true);
    expect(r1.record?.redeemedAt).not.toBeNull();

    const r2 = redeemInvitation(records, rawToken);
    expect(r2.ok).toBe(false);
    expect(r2.reason).toBe("already_redeemed");
  });

  it("redeemInvitation rejects unknown tokens with 'not_found'", () => {
    const r = redeemInvitation([], "made-up-token");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("not_found");
    expect(r.record).toBeUndefined();
  });

  it("redeemInvitation rejects revoked tokens", () => {
    const { rawToken, record } = issueInvitation({
      id: "inv_3", roundId: "r", companyId: "c", companyName: "X", inviteeEmail: "x@y.com",
    });
    revokeInvitation(record);
    const r = redeemInvitation([record], rawToken);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("revoked");
  });

  it("redeemInvitation rejects expired tokens", () => {
    const issuedAt = new Date("2026-01-01T00:00:00Z");
    const farFuture = new Date("2030-01-01T00:00:00Z");
    const { rawToken, record } = issueInvitation({
      id: "inv_4", roundId: "r", companyId: "c", companyName: "X", inviteeEmail: "x@y.com", now: issuedAt,
    });
    const r = redeemInvitation([record], rawToken, farFuture);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("expired");
  });

  it("statusOf transitions: active → redeemed → expired → revoked", () => {
    const issuedAt = new Date("2026-01-01T00:00:00Z");
    const { rawToken, record } = issueInvitation({
      id: "inv_5", roundId: "r", companyId: "c", companyName: "X", inviteeEmail: "x@y.com", now: issuedAt,
    });
    expect(statusOf(record, issuedAt)).toBe("active");
    expect(statusOf(record, new Date("2030-01-01T00:00:00Z"))).toBe("expired");
    redeemInvitation([record], rawToken, issuedAt);
    expect(statusOf(record, issuedAt)).toBe("redeemed");
    revokeInvitation(record);
    expect(statusOf(record, issuedAt)).toBe("revoked");
  });

  it("findByToken locates by hash without mutating", () => {
    const { rawToken, record } = issueInvitation({
      id: "inv_6", roundId: "r", companyId: "c", companyName: "X", inviteeEmail: "x@y.com",
    });
    const found = findByToken([record], rawToken);
    expect(found?.id).toBe("inv_6");
    expect(found?.redeemed).toBe(false);
  });

  it("hash digest is independent of input length", () => {
    expect(hashToken("a")).toHaveLength(64);
    expect(hashToken("a".repeat(10_000))).toHaveLength(64);
  });

  it("distinct raw tokens produce distinct hashes", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(hashToken(generateRawToken()));
    expect(seen.size).toBe(50);
  });

  it("a record persisted to JSON contains no plaintext token, only the hash", () => {
    const { rawToken, record } = issueInvitation({
      id: "inv_persist", roundId: "r", companyId: "c", companyName: "X", inviteeEmail: "x@y.com",
    });
    const serialized = JSON.stringify(record);
    expect(serialized).toContain(record.tokenHash);
    expect(serialized).not.toContain(rawToken);
  });

  it("redeem on a different record array still finds and mutates the matching record", () => {
    const { rawToken, record } = issueInvitation({
      id: "inv_arr", roundId: "r", companyId: "c", companyName: "X", inviteeEmail: "x@y.com",
    });
    const decoy = issueInvitation({
      id: "inv_decoy", roundId: "r", companyId: "c", companyName: "X", inviteeEmail: "d@y.com",
    }).record;
    const records = [decoy, record];
    const r = redeemInvitation(records, rawToken);
    expect(r.ok).toBe(true);
    expect(r.record?.id).toBe("inv_arr");
    expect(decoy.redeemed).toBe(false);
  });
});
