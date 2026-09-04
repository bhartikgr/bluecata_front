/**
 * server/lib/mfaTotp.ts — WAVE 305 · R251.
 *
 * REAL TOTP. RFC 6238 (TOTP) over RFC 4226 (HOTP), with RFC 4648 §6 base32.
 *
 * WHAT THIS REPLACES, AND WHY IT IS NOT A REFACTOR
 * -----------------------------------------------
 * `server/lib/secureAuthRoutes.ts` contains a scaffold pair:
 *
 *   POST /api/auth/secure/2fa/setup   — generates a "secret" and writes it to
 *     `auth_users.totp_secret` IMMEDIATELY, before anything has been verified.
 *     Its alphabet is labelled "RFC 4648 base32" and is
 *     "ABCDEFGHJKMNPQRSTUVWXYZ23456789" — which contains `8` and `9`. Base32 has
 *     no `8` and no `9`. That string is a Crockford-style human-friendly alphabet,
 *     not base32, so no standard authenticator app can decode a secret produced
 *     by it. Every QR code that route has ever emitted was undecodable.
 *
 *   POST /api/auth/secure/2fa/verify  — accepts ANY six digits. It never reads
 *     the stored secret. Its own comment says so.
 *
 * So the platform's MFA has never been able to verify a code. This module is the
 * first code in the tree that actually can. The scaffold is NOT deleted (R195.5)
 * — it is retired in place and told to name this replacement.
 *
 * DESIGN NOTES THAT MATTER
 * ------------------------
 *  1. NO DEPENDENCY. `node:crypto` HMAC only. Adding an npm package for 60 lines
 *     of RFC 4226 would put a supply-chain surface on the login path.
 *  2. DRIFT IS ±1 STEP, i.e. the window is {t-1, t, t+1}. That is the RFC 6238
 *     §5.2 recommendation and it is a CONSTANT here, not an env var, because a
 *     misconfigured window is indistinguishable from a working one until it is
 *     abused.
 *  3. `verifyTotp` RETURNS THE MATCHED STEP. The caller must persist it and refuse
 *     a step it has already accepted. Replay protection cannot live here because
 *     this module is pure — it has no store. Returning the step is what makes the
 *     caller's replay refusal possible, and `mfaStore.consumeTotpStep` is what
 *     performs it.
 *  4. COMPARISON IS TIMING-SAFE for every candidate step.
 *  5. NO MONEY, NO CURRENCY, NO `Number()` ON ANYTHING BUT A TIME COUNTER. The
 *     only arithmetic here is on an integer step counter and a six-digit modulus.
 */

import crypto from "node:crypto";

/* RFC 4648 §6 — THE ACTUAL BASE32 ALPHABET. 32 symbols: A-Z then 2-7.
 * There is no 0, 1, 8 or 9. A test asserts this string verbatim and asserts that
 * it does NOT contain "8" or "9", because that is precisely the defect the
 * scaffold shipped. */
export const RFC4648_BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 6238 §4 default. 30 seconds. A constant, deliberately not configurable. */
export const TOTP_STEP_SECONDS = 30;

/** RFC 6238 §5.2 — accept the previous and next step as well as the current one. */
export const TOTP_DRIFT_STEPS = 1;

/** Six digits, as every authenticator app assumes. */
export const TOTP_DIGITS = 6;

/**
 * A fresh secret. 20 bytes = 160 bits, which is RFC 4226 §4 R6's recommendation
 * and what Google Authenticator emits. 20 bytes is exactly 32 base32 characters
 * with no padding, so the encoded secret has no `=`.
 */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

/** RFC 4648 §6 base32 encode, no padding (authenticator apps do not want it). */
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += RFC4648_BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += RFC4648_BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/**
 * RFC 4648 §6 base32 decode. Returns null — never a partial buffer and never a
 * throw — for anything that is not decodable, so a corrupt stored secret makes
 * verification FAIL rather than crash the login route.
 *
 * Padding is tolerated. Whitespace is tolerated (users paste secrets in groups of
 * four). Case is tolerated. A character outside the alphabet is a hard null.
 */
export function base32Decode(input: string): Buffer | null {
  if (typeof input !== "string") return null;
  const cleaned = input.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (cleaned.length === 0) return null;
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of cleaned) {
    const idx = RFC4648_BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  if (out.length === 0) return null;
  return Buffer.from(out);
}

/** The RFC 6238 step counter for an epoch-millisecond instant. */
export function totpStepForTime(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
}

/**
 * RFC 4226 §5.3 HOTP, rendered as `TOTP_DIGITS` decimal digits with leading
 * zeroes preserved. Returns null if the secret cannot be decoded.
 */
export function totpCodeForStep(secretBase32: string, step: number): string | null {
  const key = base32Decode(secretBase32);
  if (!key || key.length === 0) return null;
  const counter = Buffer.alloc(8);
  /* 8-byte big-endian counter. Written as two 32-bit halves so this is exact for
   * every step value Date.now() can produce without going through a float. */
  counter.writeUInt32BE(Math.floor(step / 0x100000000), 0);
  counter.writeUInt32BE(step % 0x100000000, 4);
  const mac = crypto.createHmac("sha1", key).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const truncated =
    ((mac[offset]! & 0x7f) << 24) |
    ((mac[offset + 1]! & 0xff) << 16) |
    ((mac[offset + 2]! & 0xff) << 8) |
    (mac[offset + 3]! & 0xff);
  return String(truncated % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

export type TotpVerifyResult =
  | { ok: true; step: number }
  | { ok: false; reason: "malformed_code" | "bad_secret" | "no_match" };

/**
 * Verify a submitted code against a secret at a given time.
 *
 * RETURNS THE MATCHED STEP so the caller can refuse a replay. It does NOT itself
 * remember anything — see `mfaStore.consumeTotpStep`.
 *
 * `nowMs` is an explicit parameter with no default, so every test drives it with
 * a fixed vector and no test can accidentally depend on the wall clock.
 */
export function verifyTotp(secretBase32: string, code: string, nowMs: number): TotpVerifyResult {
  const submitted = typeof code === "string" ? code.replace(/\s/g, "") : "";
  if (!/^[0-9]{6}$/.test(submitted)) return { ok: false, reason: "malformed_code" };
  if (base32Decode(secretBase32) === null) return { ok: false, reason: "bad_secret" };
  const centre = totpStepForTime(nowMs);
  for (let d = -TOTP_DRIFT_STEPS; d <= TOTP_DRIFT_STEPS; d++) {
    const step = centre + d;
    if (step < 0) continue;
    const expected = totpCodeForStep(secretBase32, step);
    if (expected == null) return { ok: false, reason: "bad_secret" };
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(submitted, "utf8");
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return { ok: true, step };
  }
  return { ok: false, reason: "no_match" };
}

/**
 * The `otpauth://` URI an authenticator app scans.
 *
 * `issuer` and `label` are percent-encoded. `algorithm`, `digits` and `period` are
 * emitted explicitly rather than relying on app defaults, because a mismatch there
 * produces codes that look right and never validate.
 */
export function totpProvisioningUri(input: { secret: string; accountLabel: string; issuer: string }): string {
  const issuer = encodeURIComponent(input.issuer);
  const label = encodeURIComponent(input.accountLabel);
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${issuer}:${label}?${params.toString()}`;
}
