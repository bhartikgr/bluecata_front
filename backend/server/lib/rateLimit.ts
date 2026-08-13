/**
 * Sprint 17 D2 — sliding-window rate limiter.
 *
 * Per-key (user-id when authenticated, otherwise trusted client IP — see the
 * WAIVER-2 block at `resolveRateLimitClientIp`) per-route bucket.
 *   - Reads:  60 / minute
 *   - Writes: 10 / minute
 *   - Auth attempts: 5 failures → 15-minute lockout
 *
 * WAVE 21 · ITEM 4 (REVIEW A MAJOR) — ALL BUCKET STATE IS NOW DURABLE.
 * This module used to hold five `new Map()`s. Every quota therefore reset on
 * restart and multiplied by the worker count, which the file's own comments
 * admitted ("Pure in-memory ... For multi-process production, swap for Redis";
 * "Horizontal-scaling caveat: in-memory Map is per-process") before shipping
 * anyway. The security-relevant case is credential spray: an attacker at
 * strike 4 of the 5-strike lockout was returned to strike 0 by any deploy.
 * State now lives in `rate_limit_hit` / `rate_limit_lockout`
 * (migrations/0173_wave21_durable_rate_limit.sql) via ./rateLimitStore.
 * The MECHANISM and every numeric LIMIT are unchanged — only the storage.
 */
import type { Request, Response, NextFunction } from "express";
import {
  durableTick,
  durableRecordFailure,
  durableSetLockout,
  durableGetLockout,
  durableClearFailures,
  rateLimitStoreHealth,
  durableSnapshotHandle,
  _resetDurableRateLimitsForTests,
} from "./rateLimitStore";

export { rateLimitStoreHealth };

const WINDOW_MS = 60_000;
const READ_LIMIT = 60;
const WRITE_LIMIT = 10;
const AUTH_FAIL_LIMIT = 5;
const AUTH_LOCKOUT_MS = 15 * 60 * 1000;

/* ============================================================
 * WAVE 19 · WAIVER-2 (CP-MSG-05) — trusted-proxy resolution.
 *
 * Owner-granted waiver, 2026-08-11. Recorded in the sacred manifest as
 * WAIVER-2. This is the ONLY change to this file under that waiver.
 *
 * THE DEFECT. Both key builders in this file used to read
 * `req.headers["x-forwarded-for"]` directly and prefer it over `req.ip`, and
 * no `trust proxy` setting exists anywhere in `server/` (grepped: zero
 * occurrences). `x-forwarded-for` is a request header: any caller can send
 * any value. Rotating it therefore minted a fresh bucket per request, so the
 * limiter did not limit — measured at 63 consecutive 200s against a 60/min
 * bucket, and reproduced here before the fix.
 *
 * The blast radius was every limiter in the file, because two functions had
 * the same bug:
 *   • `clientKey`  → `collectiveRateLimit` (/api/collective, /api/partner,
 *     /api/messages) and `rateLimitMiddleware` (/api/auth/secure).
 *   • `authIpKey`  → `authLoginRateLimit` (10/min) and `authSignupRateLimit`
 *     (5/hour) — the credential-spray throttles, i.e. the ones where an
 *     unlimited caller matters most. This third path was found by grepping
 *     this file for the header, not from the report.
 * Both now go through ONE resolver, and a test fences that no limiter reads
 * the header directly again.
 *
 * FAIL CLOSED. `TRUSTED_PROXY_HOPS` is the number of proxies WE operate
 * immediately in front of this process. Absent, zero, negative or
 * unparseable ⇒ 0 ⇒ the header is ignored completely and the key is the
 * socket peer, which a client cannot forge. Trust is opt-in, never inferred.
 *
 * NO LIMIT MOVES. Anonymous callers are still limited exactly as before;
 * `READ_LIMIT`, `WRITE_LIMIT`, `AUTH_LOGIN_LIMIT`, `AUTH_SIGNUP_LIMIT` and
 * `AUTH_FAIL_LIMIT` are untouched. This changes who controls the key, not how
 * many requests are allowed — and a test asserts each constant verbatim.
 *
 * CORRECTION TO THE RECORD. Wave 18 additionally reported that authenticated
 * requests fall back to IP because `req.userContext` is unpopulated at limiter
 * time. That is NOT true: `app.use(loadUserContext)` is registered at
 * `server/routes.ts:534`, every limiter mounts at `:1043`+, and Express runs
 * `app.use` in registration order. Wave 18's harness omitted
 * `loadUserContext`, so it measured its own construction. The per-user branch
 * below is therefore left exactly as it was — it already worked — and Wave
 * 18's FROZEN-DEFECT pins asserting otherwise are removed rather than
 * inverted. `server/__tests__/wave19_waiver2_ratelimit_key.test.ts` proves
 * both halves of this on the real chain, including a control that reproduces
 * Wave 18's finding by removing that one middleware.
 * ============================================================ */

/** Hard ceiling on configurable hops, so a fat-fingered value cannot be used
 *  to walk off the end of the forwarded chain into attacker-supplied text. */
const MAX_TRUSTED_PROXY_HOPS = 8;

/* ============================================================
 * WAVE 21 · ITEM 1 (REVIEW A CRITICAL) — out-of-range hop counts FAIL CLOSED.
 *
 * THE DEFECT (as shipped by Wave 19). This function used to end with
 * `return Math.min(n, MAX_TRUSTED_PROXY_HOPS)`. A configured
 * `TRUSTED_PROXY_HOPS=9999` was therefore silently *clamped* to 8 instead of
 * rejected. With a forwarded chain longer than 8 entries the resolver then
 * selected the 8th position from the right — a position the caller writes.
 * Review A minted two distinct buckets (`bucket-A`, `bucket-B`) from one
 * client, each with an independent quota, against `authIpKey` (login/signup
 * spray), every collective/general limiter, and `/api/auth/secure`.
 *
 * THE RULE. A misconfiguration must never WIDEN trust. Clamping converts an
 * operator error into an exploitable trust boundary; failing closed converts
 * it into a (loudly logged) loss of client-IP fidelity, which is the strictly
 * safer direction. Unset / `0` / negative / non-numeric already failed closed
 * and still do — that behaviour is preserved verbatim.
 * ============================================================ */

/** Emitted once per distinct bad value so a misconfigured deploy screams in
 *  the log on the first request instead of drowning the log per request. */
const loggedBadHopValues = new Set<string>();

function rejectHopConfig(raw: string, reason: string): 0 {
  if (!loggedBadHopValues.has(raw)) {
    loggedBadHopValues.add(raw);
    // eslint-disable-next-line no-console
    console.error(
      `[rateLimit] SECURITY: TRUSTED_PROXY_HOPS=${JSON.stringify(raw)} is ${reason}. ` +
        `Refusing to trust X-Forwarded-For; rate-limit keys fall back to the socket peer. ` +
        `Valid range is 1..${MAX_TRUSTED_PROXY_HOPS}, or unset to disable proxy trust.`,
    );
  }
  return 0;
}

/** Test/diagnostic hook: forget which bad values have already been logged. */
export function _resetTrustedProxyHopLogForTests(): void {
  loggedBadHopValues.clear();
}

/**
 * Number of trusted reverse proxies in front of this process, from
 * `TRUSTED_PROXY_HOPS`. Read per call rather than cached at module load so a
 * deployment can change it without a rebuild, and so tests need no reset hook.
 * Returns 0 — do not trust — for anything that is not an integer in
 * `1..MAX_TRUSTED_PROXY_HOPS`. Out-of-range values are REJECTED, not clamped.
 */
export function trustedProxyHopCount(): number {
  const rawEnv = process.env.TRUSTED_PROXY_HOPS;
  if (rawEnv === undefined) return 0;
  const raw = rawEnv.trim();
  if (raw === "") return 0;
  if (raw === "0") return 0;
  if (!/^\d+$/.test(raw)) return rejectHopConfig(raw, "not a non-negative integer");
  const n = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(n) || n <= 0) return rejectHopConfig(raw, "not a usable positive integer");
  if (n > MAX_TRUSTED_PROXY_HOPS) {
    return rejectHopConfig(raw, `above the maximum supported hop count (${MAX_TRUSTED_PROXY_HOPS})`);
  }
  return n;
}

/* ============================================================
 * WAVE 23 · ITEM 2 (REVIEW A CRITICAL) — the DEPLOYMENT INVARIANT is now
 * ENFORCED, not assumed.
 *
 * WHAT REVIEW A ACTUALLY SHOWED. With `TRUSTED_PROXY_HOPS=1` or `8`, the
 * selected `x-forwarded-for` entry is attacker-controllable *if and only if a
 * caller can reach this Node socket directly*. The hop algorithm itself is
 * correct and is unchanged below — it is exactly Express's numeric
 * `trust proxy` semantics. The hole was that the algorithm silently RELIED on
 * an unenforced deployment assumption: "nothing but our own proxies can open a
 * socket to this process."
 *
 * THE FIX. Convert that assumption into a check. When `hops > 0` the header is
 * honoured only if the DIRECT SOCKET PEER is itself a trusted proxy address.
 * If the peer is not trusted, the header is ignored *entirely* and the bucket
 * keys on the socket peer — the one value a remote caller cannot forge.
 *
 * FAIL CLOSED, in every direction:
 *   - unparseable / unknown peer  ⇒ not trusted ⇒ header ignored;
 *   - unparseable entry in the operator's allow-list ⇒ that entry is dropped
 *     and logged; it never widens trust;
 *   - an explicitly configured but EMPTY allow-list ⇒ nothing is trusted ⇒
 *     the header is always ignored.
 *
 * DEFAULT TRUSTED SET. Loopback plus the RFC1918 private ranges plus IPv6
 * loopback / unique-local / link-local — i.e. the addresses a co-located or
 * in-VPC reverse proxy actually presents. A proxy on the public internet is
 * NOT trusted by default and must be named explicitly.
 *
 * OVERRIDE. `TRUSTED_PROXY_PEERS` — a comma-separated list of IPv4/IPv6
 * addresses or CIDR blocks, e.g.
 *   TRUSTED_PROXY_PEERS="127.0.0.1,10.1.2.3/32,2001:db8::/32"
 * Setting it REPLACES the default set (it does not extend it), so an operator
 * can narrow trust as well as move it. A DB-driven override can be layered on
 * later by feeding `_setTrustedProxyPeerOverride()`; nothing here caches, so a
 * change takes effect on the next request.
 *
 * NO LIMIT MOVES, AND THE HOP ALGORITHM IS BYTE-FOR-BYTE THE SAME. This adds a
 * precondition in front of it; it does not alter how the entry is selected.
 * ============================================================ */

const DEFAULT_TRUSTED_PROXY_PEERS: readonly string[] = [
  "127.0.0.0/8",      // IPv4 loopback
  "10.0.0.0/8",       // RFC1918
  "172.16.0.0/12",    // RFC1918
  "192.168.0.0/16",   // RFC1918
  "::1/128",          // IPv6 loopback
  "fc00::/7",         // IPv6 unique-local (RFC4193)
  "fe80::/10",        // IPv6 link-local
];

/** Optional programmatic (e.g. DB-backed) override. `null` = not configured. */
let trustedProxyPeerOverride: string[] | null = null;

/** Configure the trusted-proxy allow-list from a source other than the
 *  environment (a platform-config row, a secrets store, a test). Pass `null`
 *  to fall back to `TRUSTED_PROXY_PEERS` / the defaults. */
export function _setTrustedProxyPeerOverride(list: string[] | null): void {
  trustedProxyPeerOverride = list;
  loggedBadPeerEntries.clear();
  loggedUntrustedPeers.clear();
}

const loggedBadPeerEntries = new Set<string>();
const loggedUntrustedPeers = new Set<string>();

/** Test/diagnostic hook: forget which peers/entries have already been logged. */
export function _resetTrustedProxyPeerLogForTests(): void {
  loggedBadPeerEntries.clear();
  loggedUntrustedPeers.clear();
}

/** Strip the decorations Node/Express can attach to a remote address:
 *  IPv4-mapped IPv6 (`::ffff:10.0.0.9`), an IPv6 zone id (`fe80::1%eth0`),
 *  and bracket/port forms (`[::1]:443`, `10.0.0.9:443`). */
function normalizeIp(raw: string): string {
  let s = String(raw ?? "").trim();
  if (s === "") return "";
  if (s.startsWith("[")) {
    const close = s.indexOf("]");
    if (close > 0) s = s.slice(1, close);
  } else if (s.includes(".") && s.includes(":") && !s.includes("::")) {
    // "10.0.0.9:443" — an IPv4 literal with a port. Plain IPv6 has no dot.
    s = s.slice(0, s.indexOf(":"));
  }
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  const mapped = /^::ffff:((?:\d{1,3}\.){3}\d{1,3})$/i.exec(s);
  if (mapped) s = mapped[1];
  return s.toLowerCase();
}

/** Parse an address to its raw bytes (4 for IPv4, 16 for IPv6), or null if it
 *  is not a valid literal. An IPv4-mapped IPv6 has already been folded to IPv4
 *  by `normalizeIp`, so the two families never need to be compared.
 *  Byte arrays rather than BigInt: this file compiles under an ES2019 target. */
function parseIp(ip: string): number[] | null {
  if (ip.includes(":")) {
    // IPv6, possibly with one "::" run and possibly a trailing IPv4 tail.
    if ((ip.match(/::/g) ?? []).length > 1) return null;
    let head = ip;
    const lastColon = head.lastIndexOf(":");
    const maybe4 = head.slice(lastColon + 1);
    if (maybe4.includes(".")) {
      const v4 = parseIp(maybe4);
      if (!v4 || v4.length !== 4) return null;
      const hex = (a: number, b: number) => ((a << 8) | b).toString(16);
      head = head.slice(0, lastColon + 1) + `${hex(v4[0], v4[1])}:${hex(v4[2], v4[3])}`;
    }
    const [left, right] = head.includes("::") ? head.split("::") : [head, null];
    const l = left === "" ? [] : left.split(":");
    const r = right == null ? null : right === "" ? [] : right.split(":");
    if (r != null && l.length + r.length > 8) return null;
    const groups =
      r == null ? l : [...l, ...new Array(8 - l.length - r.length).fill("0"), ...r];
    if (groups.length !== 8) return null;
    const bytes: number[] = [];
    for (const g of groups) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      const n = parseInt(g, 16);
      bytes.push((n >> 8) & 0xff, n & 0xff);
    }
    return bytes;
  }
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    bytes.push(n);
  }
  return bytes;
}

/** True if `ip` falls inside `entry`, which may be a bare address or CIDR.
 *  Returns null (not false) when the ENTRY is unparseable, so the caller can
 *  tell "operator typo" apart from "genuinely does not match". */
function ipMatchesEntry(ip: string, entry: string): boolean | null {
  const slash = entry.indexOf("/");
  const netRaw = slash >= 0 ? entry.slice(0, slash) : entry;
  const lenRaw = slash >= 0 ? entry.slice(slash + 1) : null;
  const net = parseIp(normalizeIp(netRaw));
  if (!net) return null;
  const totalBits = net.length * 8;
  let prefix: number;
  if (lenRaw == null) {
    prefix = totalBits;
  } else {
    if (!/^\d{1,3}$/.test(lenRaw)) return null;
    prefix = Number(lenRaw);
    if (prefix > totalBits) return null;
  }
  const addr = parseIp(ip);
  if (!addr) return false;
  if (addr.length !== net.length) return false;
  const fullBytes = prefix >> 3;
  for (let i = 0; i < fullBytes; i++) {
    if (addr[i] !== net[i]) return false;
  }
  const restBits = prefix & 7;
  if (restBits !== 0) {
    const mask = (0xff << (8 - restBits)) & 0xff;
    if ((addr[fullBytes] & mask) !== (net[fullBytes] & mask)) return false;
  }
  return true;
}

/** The configured allow-list, in precedence order:
 *  programmatic override → `TRUSTED_PROXY_PEERS` → the built-in defaults.
 *  An explicitly configured empty list means "trust nobody" and is honoured. */
function trustedProxyPeerEntries(): readonly string[] {
  if (trustedProxyPeerOverride !== null) return trustedProxyPeerOverride;
  const raw = process.env.TRUSTED_PROXY_PEERS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_TRUSTED_PROXY_PEERS;
  return raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Is the DIRECT socket peer one of our own reverse proxies?
 *
 * This is the enforced form of the deployment invariant every proxy-aware
 * limiter (including Express `trust proxy`) silently assumes. Only when this
 * is true may `x-forwarded-for` be read at all.
 */
export function isTrustedProxyPeer(rawPeer: string | undefined | null): boolean {
  const peer = normalizeIp(rawPeer ?? "");
  if (peer === "" || peer === "unknown") return false;
  if (!parseIp(peer)) return false;
  let trusted = false;
  for (const entry of trustedProxyPeerEntries()) {
    const m = ipMatchesEntry(peer, entry);
    if (m === null) {
      if (!loggedBadPeerEntries.has(entry)) {
        loggedBadPeerEntries.add(entry);
        // eslint-disable-next-line no-console
        console.error(
          `[rateLimit] SECURITY: trusted-proxy peer entry ${JSON.stringify(entry)} is not a valid ` +
            `IP address or CIDR block. Ignoring it. Trust is never widened by a malformed entry.`,
        );
      }
      continue;
    }
    if (m) trusted = true;
  }
  return trusted;
}

/**
 * The client address to key a rate-limit bucket on.
 *
 * With `hops = 0` (the default and the fail-closed case) this is the socket
 * peer and nothing else. With `hops = n > 0` the address is taken `n` entries
 * from the right of `[...x-forwarded-for, socketPeer]`, which is the same
 * semantics Express uses for a numeric `trust proxy`: our own proxies appended
 * the rightmost `n` entries, so the first one they appended is the true peer
 * and everything to its left is caller-supplied text we must not read. If the
 * chain is shorter than the configured hop count the request did not traverse
 * the expected proxies, so we fall back to the socket rather than reach into
 * the forged prefix.
 *
 * WAVE 23 · ITEM 2: before any of that, the socket peer must itself be a
 * trusted proxy. A caller that reaches this process directly gets keyed on its
 * own socket address no matter what it puts in the header.
 */
export function resolveRateLimitClientIp(req: Request): string {
  const socketIp = (req as any).socket?.remoteAddress || req.ip || "unknown";
  const hops = trustedProxyHopCount();
  if (hops <= 0) return socketIp;
  // NOTE — exactly ONE executable read of the header exists in this file, and
  // it is this one. `wave19_waiver2_ratelimit_key.test.ts` fences that count.
  const rawHeader = req.headers["x-forwarded-for"];
  if (!isTrustedProxyPeer(socketIp)) {
    // The deployment invariant does not hold for THIS connection. Ignore the
    // header entirely; key on the peer, which the caller cannot forge.
    const peerKey = String(socketIp);
    if (rawHeader !== undefined && !loggedUntrustedPeers.has(peerKey)) {
      loggedUntrustedPeers.add(peerKey);
      // eslint-disable-next-line no-console
      console.error(
        `[rateLimit] SECURITY: X-Forwarded-For received from untrusted socket peer ${peerKey} ` +
          `while TRUSTED_PROXY_HOPS=${hops}. Ignoring the header and keying on the socket peer. ` +
          `If ${peerKey} really is your reverse proxy, add it to TRUSTED_PROXY_PEERS.`,
      );
    }
    return socketIp;
  }
  const header = Array.isArray(rawHeader) ? rawHeader.join(",") : (rawHeader ?? "");
  const chain = String(header)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const addresses = [...chain, socketIp];
  const idx = addresses.length - 1 - hops;
  if (idx < 0) return socketIp;
  return addresses[idx] || socketIp;
}

function clientKey(req: Request): string {
  const userId = (req as any).user?.id || (req as any).userContext?.userId || "";
  if (userId) return `u:${userId}`;
  return `ip:${resolveRateLimitClientIp(req)}`;
}

/* WAVE 21 ITEM 4: was a `buckets.get(key)` array of timestamps. Now a durable
 * sliding window over rate_limit_hit rows with byte-identical semantics —
 * same cutoff, same `oldestHitInWindow + WINDOW_MS` reset. Non-auth surface,
 * so it DEGRADES rather than fails closed if the store is unreachable (see the
 * availability policy in rateLimitStore.ts); the degradation is logged and is
 * reported by rateLimitStoreHealth(). */
function tick(key: string, limit: number, now: number): { ok: boolean; remaining: number; resetAt: number } {
  return durableTick(key, limit, WINDOW_MS, now, /* failClosed */ false);
}

/**
 * CP-038 — paths that are exempt from ALL rate limiters (main +
 * collective). Healthchecks and liveness probes must never 429, or load
 * balancers will start pulling pods out of rotation under burst load.
 */
export const RATE_LIMIT_BYPASS_PATHS: ReadonlySet<string> = new Set<string>([
  "/api/health",
  "/api/healthz",
]);

function isBypassed(req: Request): boolean {
  const fullPath = (req as any).originalUrl || req.path;
  // Compare both the original (mount-prefixed) URL and the local path so we
  // catch the route whether or not the limiter is mounted at a prefix.
  const localBypass = RATE_LIMIT_BYPASS_PATHS.has(req.path);
  if (localBypass) return true;
  if (typeof fullPath === "string") {
    const stripped = fullPath.split("?")[0];
    if (RATE_LIMIT_BYPASS_PATHS.has(stripped)) return true;
  }
  return false;
}

export function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  if (isBypassed(req)) return next();
  const isWrite = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  const limit = isWrite ? WRITE_LIMIT : READ_LIMIT;
  // Per-route bucket
  const route = req.path.replace(/\d+/g, ":id"); // collapse path numerics
  const key = `${clientKey(req)}:${req.method}:${route}`;
  const r = tick(key, limit, Date.now());
  res.setHeader("X-RateLimit-Limit", String(limit));
  res.setHeader("X-RateLimit-Remaining", String(r.remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.floor(r.resetAt / 1000)));
  if (!r.ok) return res.status(429).json({ error: "rate_limited", retryAfterMs: r.resetAt - Date.now() });
  next();
}

/* ============================================================
 * Wave C FIX C4 — per-IP rate limit on /api/auth/login + /api/auth/signup.
 *
 * V23_FINAL_CODE_AUDIT.md R-4 (P1): pre-fix the unauthenticated login
 * and signup endpoints had no IP-based throttle. An attacker could
 * spray thousands of (email, password) pairs per second. The existing
 * `recordAuthFailure` lockout is per-email and only triggers AFTER 5
 * confirmed mismatches — it doesn't slow the spray itself.
 *
 * This middleware applies a tighter sliding-window cap on the auth
 * endpoints:
 *   • 10 attempts / minute / IP for /api/auth/login
 *   • 5 signups / hour / IP for /api/auth/signup
 * It's purely additive over the existing `rateLimitMiddleware` and
 * `recordAuthFailure` / `isLockedOut` flows so the audit trail and
 * lockout behavior are preserved.
 */
/* WAVE 21 ITEM 4: `authBuckets` (a Map) is gone; these two throttles are the
 * security-relevant durable case and now read/write rate_limit_hit rows. */
const AUTH_LOGIN_LIMIT = 10;        // per IP / minute
const AUTH_SIGNUP_LIMIT = 5;        // per IP / hour
const AUTH_SIGNUP_WINDOW_MS = 60 * 60 * 1000;

/* WAVE 19 · WAIVER-2 — third path. This function had the identical
 * attacker-controlled-header defect as `clientKey` and keys the login and
 * signup spray throttles, so a rotated header made those throttles inert.
 * Same central resolver, same fail-closed default. */
function authIpKey(req: Request): string {
  return `auth-ip:${resolveRateLimitClientIp(req)}`;
}

/* WAVE 21 ITEM 4. failClosed=true: if the durable store is unreachable these
 * throttles DENY. That costs nothing real — this app cannot authenticate
 * anyone without the users table either — and failing open here is exactly the
 * credential-spray window Review A raised. */
function authTick(
  key: string,
  limit: number,
  windowMs: number,
  now: number,
): { ok: boolean; remaining: number; resetAt: number; deniedByStoreOutage?: boolean } {
  return durableTick(key, limit, windowMs, now, /* failClosed */ true);
}

/**
 * Test mode escape valve. The existing test suite includes broad scenarios
 * (sprint24_auth.test.ts performs 11 signups; patch2_avi_fixes uses many
 * login attempts) that pre-date this limiter. Rather than mutate every
 * pre-existing test to reset auth buckets in their setup, we honor an opt-out
 * env flag that is set ONLY in NODE_ENV=test runs. The dedicated
 * `authRateLimit.test.ts` enables enforcement by clearing this flag inside
 * its `beforeAll`, validating the production semantics end-to-end.
 */
function authRateLimitDisabledForTests(): boolean {
  return process.env.NODE_ENV === "test" &&
    process.env.ENFORCE_AUTH_RATELIMIT !== "1";
}

export function authLoginRateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (authRateLimitDisabledForTests()) { next(); return; }
  const key = `${authIpKey(req)}:login`;
  const r = authTick(key, AUTH_LOGIN_LIMIT, WINDOW_MS, Date.now());
  res.setHeader("X-RateLimit-Limit", String(AUTH_LOGIN_LIMIT));
  res.setHeader("X-RateLimit-Remaining", String(r.remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.floor(r.resetAt / 1000)));
  if (!r.ok) {
    // WAVE 21 ITEM 4: distinguish "you hit a quota" from "we cannot verify
    // your quota". Reporting a store outage as a quota breach would be the
    // same class of dishonest signal as the money and migration findings.
    if (r.deniedByStoreOutage) {
      res.status(503).json({
        ok: false,
        error: "rate_limit_store_unavailable",
        message: "Login is temporarily unavailable. Please try again shortly.",
      });
      return;
    }
    res.status(429).json({
      ok: false,
      error: "rate_limited",
      message: "Too many login attempts. Wait a minute and try again.",
      retryAfterMs: r.resetAt - Date.now(),
    });
    return;
  }
  next();
}

export function authSignupRateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (authRateLimitDisabledForTests()) { next(); return; }
  const key = `${authIpKey(req)}:signup`;
  const r = authTick(key, AUTH_SIGNUP_LIMIT, AUTH_SIGNUP_WINDOW_MS, Date.now());
  res.setHeader("X-RateLimit-Limit", String(AUTH_SIGNUP_LIMIT));
  res.setHeader("X-RateLimit-Remaining", String(r.remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.floor(r.resetAt / 1000)));
  if (!r.ok) {
    if (r.deniedByStoreOutage) {
      res.status(503).json({
        ok: false,
        error: "rate_limit_store_unavailable",
        message: "Signup is temporarily unavailable. Please try again shortly.",
      });
      return;
    }
    res.status(429).json({
      ok: false,
      error: "rate_limited",
      message: "Too many signup attempts from this network. Try again later.",
      retryAfterMs: r.resetAt - Date.now(),
    });
    return;
  }
  next();
}

/** Test helper — reset auth IP buckets between tests. */
export function _resetAuthRateLimitsForTests(): void {
  _resetDurableRateLimitsForTests();
}

export const AuthRateLimitConfig = {
  LOGIN_LIMIT: AUTH_LOGIN_LIMIT,
  LOGIN_WINDOW_MS: WINDOW_MS,
  SIGNUP_LIMIT: AUTH_SIGNUP_LIMIT,
  SIGNUP_WINDOW_MS: AUTH_SIGNUP_WINDOW_MS,
};

/** Auth-specific limiter: 5 fails in 15 min → lockout. */
/* WAVE 21 ITEM 4: `failures` and `lockouts` Maps are gone. A locked account
 * used to be silently unlocked by the next deploy; the lockout is now a durable
 * row and is auditable (first_locked_at / lock_count). */
const AUTH_FAILURE_KEY_PREFIX = "authfail:";

export function recordAuthFailure(key: string): void {
  const now = Date.now();
  const n = durableRecordFailure(`${AUTH_FAILURE_KEY_PREFIX}${key}`, AUTH_LOCKOUT_MS, now);
  if (n >= AUTH_FAIL_LIMIT) {
    durableSetLockout(`${AUTH_FAILURE_KEY_PREFIX}${key}`, now + AUTH_LOCKOUT_MS, now);
  }
}

export function isLockedOut(key: string): { locked: boolean; until?: number; unknown?: boolean } {
  return durableGetLockout(`${AUTH_FAILURE_KEY_PREFIX}${key}`, Date.now());
}

export function clearAuthFailures(key: string): void {
  durableClearFailures(`${AUTH_FAILURE_KEY_PREFIX}${key}`);
}

/** For tests. */
export function _resetRateLimitsForTests(): void {
  // One durable store now backs every bucket, so one reset clears them all.
  _resetDurableRateLimitsForTests();
}

export const RateLimitConfig = { WINDOW_MS, READ_LIMIT, WRITE_LIMIT, AUTH_FAIL_LIMIT, AUTH_LOCKOUT_MS };

/* ============================================================
 * v19 Phase C — Collective bucket rate limits.
 *
 * Independent sliding-window per (user, bucket). Buckets:
 *   - write  (POST/PATCH/DELETE) : 60/min/user
 *   - read   (GET/HEAD/OPTIONS)  : 600/min/user
 *   - sse    (SSE connect)       : 30/min/user
 *
 * Applied via middleware to /api/collective/*, /api/partner/*,
 * /api/messages/*. Independent state from the existing `buckets` map
 * so the older /api/auth/secure limiter is unaffected.
 *
 * Horizontal-scaling caveat: in-memory Map is per-process. Multi-instance
 * deployments must back this with Redis (or a sticky-session LB).
 * ============================================================ */
/* WAVE 21 ITEM 4: `collectiveBuckets` Map removed; durable rows instead. The
 * "Horizontal-scaling caveat" above is thereby closed — the window is shared
 * across every process that talks to the same database. */

export type CollectiveBucket = "write" | "read" | "sse";

export const CollectiveBucketLimits: Record<CollectiveBucket, number> = {
  write: 60,
  read: 600,
  sse: 30,
};

function collectiveTick(
  key: string,
  limit: number,
  now: number,
): { ok: boolean; remaining: number; resetAt: number } {
  return durableTick(key, limit, WINDOW_MS, now, /* failClosed */ false);
}

function pickBucket(req: Request): CollectiveBucket {
  // SSE connect endpoint is `/api/collective/sse/*` (long-lived).
  // Use originalUrl because `app.use("/api/collective", ...)` strips the
  // prefix in `req.path` (so `/sse/feed` is the local view).
  const fullPath = (req as any).originalUrl || req.path;
  if (
    fullPath.includes("/sse") ||
    req.path.startsWith("/sse") ||
    req.path.endsWith("/sse")
  ) {
    return "sse";
  }
  const isWrite = !(["GET", "HEAD", "OPTIONS"] as string[]).includes(req.method);
  return isWrite ? "write" : "read";
}

/**
 * Per-(user, bucket) sliding-window limiter. Use as Express middleware on
 * route mount points: `app.use("/api/collective", collectiveRateLimit);`.
 */
export function collectiveRateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (isBypassed(req)) {
    next();
    return;
  }
  const bucket = pickBucket(req);
  const limit = CollectiveBucketLimits[bucket];
  const key = `${clientKey(req)}:cb:${bucket}`;
  const r = collectiveTick(key, limit, Date.now());
  res.setHeader("X-RateLimit-Bucket", bucket);
  res.setHeader("X-RateLimit-Limit", String(limit));
  res.setHeader("X-RateLimit-Remaining", String(r.remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.floor(r.resetAt / 1000)));
  if (!r.ok) {
    res.status(429).json({
      error: "rate_limited",
      bucket,
      retryAfterMs: r.resetAt - Date.now(),
    });
    return;
  }
  next();
}

/** Test helper exposing collective bucket state (read-only snapshot).
 *  WAVE 21 ITEM 4: reads the durable rows instead of the removed Map. The
 *  signature and the returned shape are unchanged so existing callers of this
 *  helper keep working. */
export function _collectiveBucketSnapshot(): Record<string, number> {
  const out: Record<string, number> = {};
  const db = durableSnapshotHandle();
  if (!db) return out;
  const cutoff = Date.now() - WINDOW_MS;
  const rows = db
    .prepare(
      `SELECT bucket_key AS k, count(*) AS n FROM rate_limit_hit
        WHERE hit_at > ? AND bucket_key LIKE '%:cb:%' GROUP BY bucket_key`,
    )
    .all(cutoff) as Array<{ k: string; n: number }>;
  for (const r of rows) out[r.k] = r.n;
  return out;
}
