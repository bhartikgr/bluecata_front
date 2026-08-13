/**
 * WAVE 19 · WAIVER-2 / CP-MSG-05 — who controls the rate-limit bucket key.
 *
 * This suite exists to settle a disputed diagnosis empirically and then to fence
 * the fix. It is deliberately built on the REAL middleware chain, in production
 * registration order, with NO auth shim — because the previous suite's auth shim
 * is precisely what made thirteen green tests prove nothing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PART A — CORRECTING THE RECORD (measured, not argued)
 *
 * Wave 18 reported that authenticated requests fall back to the IP bucket
 * because `req.user` / `req.userContext` are unpopulated at limiter time. The
 * owner challenged that. Traced at source:
 *
 *   server/routes.ts:534    app.use(loadUserContext)          ← global
 *   server/routes.ts:1043   app.use("/api/collective", collectiveRateLimit)
 *   server/routes.ts:1044   app.use("/api/partner",    collectiveRateLimit)
 *   server/routes.ts:1045   app.use("/api/messages",   collectiveRateLimit)
 *   server/routes.ts:1306   app.use("/api/auth/secure", rateLimitMiddleware)
 *
 * Express runs `app.use` handlers in registration order, and `loadUserContext`
 * (`server/lib/requireEntitlement.ts:67`) assigns `req.userContext =
 * getUserContext(req)`, whose `userId` comes from the HMAC-verified `cap_uid`
 * cookie (`server/lib/userContext.ts:1023` → `resolvePersonaIdWithFallback` →
 * `resolvePersonaId`, `:471`). So `req.userContext.userId` IS populated before
 * every one of those limiters.
 *
 * VERDICT, asserted below rather than asserted in prose: **Wave 18 was WRONG on
 * this point.** Authenticated callers already get a per-user bucket in
 * production. Wave 18's own harness omitted `loadUserContext`, so it measured a
 * world it had built. That is a tenth "a check that passes may be checking
 * nothing" — and this time it produced a false POSITIVE finding, a defect report
 * for a defect that was not there. Its three FROZEN-DEFECT pins are therefore
 * removed, not merely superseded: leaving them would pin a defect that does not
 * exist and force a future wave to "fix" correct code.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PART B — THE DEFECT THAT IS REAL
 *
 * `clientKey` (`rateLimit.ts:26-31` pre-fix) and `authIpKey` (`:106-111` pre-fix)
 * both read `req.headers["x-forwarded-for"]` DIRECTLY and prefer it over
 * `req.ip`. No `trust proxy` setting exists anywhere in the server (grepped:
 * zero occurrences in `server/`). That header is fully attacker-controlled, so
 * an ANONYMOUS caller who rotates it mints a fresh bucket per request and is not
 * limited at all. Confirmed here by measurement, not by reading.
 *
 * THIRD PATH — `authIpKey` is a separate function with the identical defect and
 * it is the more dangerous one: it keys `authLoginRateLimit` (10/min) and
 * `authSignupRateLimit` (5/hour), the credential-spray throttles. The brief
 * named `/api/auth/secure` as the second path (correct — same `clientKey`); this
 * third one was found by grepping the file for `x-forwarded-for` rather than by
 * following the citation, and it is fixed by the same change.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PART C — WHAT THE FIX MAY NOT DO
 *
 * Not one limit moves. Anonymous callers remain limited; the change is who
 * controls the key, not how many requests are allowed. Both poles are proved:
 * a rotated header no longer mints buckets, AND two genuinely distinct peers
 * still get distinct buckets (a fix that keyed everyone to one constant would
 * also defeat rotation, and would be catastrophic — that is what the second
 * pole exists to catch).
 *
 * NO MONEY is rendered or computed anywhere on this path — a 429 body carries
 * `error`, `bucket` and `retryAfterMs` (milliseconds, an integer duration, not a
 * currency amount). The absence is fenced below rather than assumed.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import {
  collectiveRateLimit,
  rateLimitMiddleware,
  authLoginRateLimit,
  resolveRateLimitClientIp,
  trustedProxyHopCount,
  _resetRateLimitsForTests,
  _resetAuthRateLimitsForTests,
  _collectiveBucketSnapshot,
  CollectiveBucketLimits,
} from "../lib/rateLimit";
import { loadUserContext } from "../lib/requireEntitlement";
import { signSessionValue, LEGACY_SESSION_COOKIE } from "../lib/sessionCookie";

const REPO = path.resolve(__dirname, "../..");
const RATELIMIT_SRC = fs.readFileSync(path.join(REPO, "server/lib/rateLimit.ts"), "utf8");
const ROUTES_SRC = fs.readFileSync(path.join(REPO, "server/routes.ts"), "utf8");

/** Remove block and line comments so a source fence measures CODE, not prose. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/**
 * The production cookie parser (`server/index.ts:76`) runs before
 * `registerRoutes`, so `req.cookies` is populated at limiter time. Mirrored
 * here because `extractUserIdFromCookie` reads only `req.cookies`.
 */
function cookieShim(): express.RequestHandler {
  return (req, _res, next) => {
    const r = req as express.Request & { cookies?: Record<string, string> };
    if (!r.cookies) {
      const out: Record<string, string> = {};
      for (const part of String(req.headers.cookie ?? "").split(";")) {
        const eq = part.indexOf("=");
        if (eq <= 0) continue;
        out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
      }
      r.cookies = out;
    }
    next();
  };
}

/**
 * The REAL chain, in production registration order:
 *   cookies → loadUserContext (routes.ts:534) → limiter (routes.ts:1043-1045)
 * NO auth shim. Nothing in this app assigns `userContext` by hand.
 *
 * `observed` records the bucket key the limiter actually used, read out of the
 * snapshot — the strongest available statement about identity, because it is the
 * limiter's own state rather than a re-derivation.
 */
function makeRealApp(opts: { withUserContext?: boolean } = {}) {
  const withUserContext = opts.withUserContext !== false;
  const app = express();
  app.use(cookieShim());
  if (withUserContext) app.use(loadUserContext);
  app.use("/api/collective", collectiveRateLimit);
  app.get("/api/collective/items", (_req, res) => {
    res.json({ ok: true });
  });
  app.post("/api/collective/items", (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

function cookieFor(userId: string): string {
  return `${LEGACY_SESSION_COOKIE}=${encodeURIComponent(signSessionValue(userId))}`;
}

/** Keys currently held by the collective limiter. */
function keys(): string[] {
  return Object.keys(_collectiveBucketSnapshot());
}

const ORIGINAL_ENV = { ...process.env };

/**
 * A HARNESS DEFECT CAUGHT BY THIS SUITE'S OWN SECOND POLE — recorded because it
 * is the exact failure mode the wave is under orders to hunt.
 *
 * With `DISABLE_DEV_BYPASS` unset and `NODE_ENV !== "production"`,
 * `resolvePersonaIdWithFallback` (`server/lib/userContext.ts:518`) hands every
 * ANONYMOUS request the demo persona `u_aisha_patel`. So `loadUserContext`
 * populated a userId even with no cookie, every "anonymous" request keyed on
 * `u:u_aisha_patel`, and the three anonymous tests below would have passed with
 * the header defect fully intact — they would have been measuring the demo
 * fallback, not the IP branch. Only the distinct-peers pole failed and exposed
 * it. Setting the production gate makes anonymous actually anonymous, and
 * `assertAnonymous` now fences that per test so it cannot silently regress.
 */
beforeEach(() => {
  _resetRateLimitsForTests();
  _resetAuthRateLimitsForTests();
  delete process.env.TRUSTED_PROXY_HOPS;
  process.env.DISABLE_DEV_BYPASS = "1";
});

/** Fails loudly if a supposedly anonymous request was given an identity. */
function assertAnonymous(): void {
  for (const k of keys()) {
    expect(k, "this request was NOT anonymous — the demo-persona fallback is active").toMatch(/^ip:/);
  }
}
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  _resetRateLimitsForTests();
  _resetAuthRateLimitsForTests();
});

/* ==================================================================== */
describe("WAIVER-2 PART A — the disputed diagnosis, settled by measurement", () => {
  it("SOURCE FENCE — loadUserContext is registered BEFORE every rate limiter", () => {
    const loadAt = ROUTES_SRC.indexOf("app.use(loadUserContext);");
    expect(loadAt).toBeGreaterThan(-1);
    for (const mount of [
      'app.use("/api/collective", collectiveRateLimit);',
      'app.use("/api/partner", collectiveRateLimit);',
      'app.use("/api/messages", collectiveRateLimit);',
      'app.use("/api/auth/secure", rateLimitMiddleware);',
    ]) {
      const at = ROUTES_SRC.indexOf(mount);
      expect(at, `mount not found: ${mount}`).toBeGreaterThan(-1);
      expect(at, `${mount} must register AFTER loadUserContext`).toBeGreaterThan(loadAt);
    }
  });

  it("WAVE 18 WAS WRONG — a genuinely authenticated request keys on the USER, not the IP", async () => {
    const app = makeRealApp();
    const r = await request(app)
      .get("/api/collective/items")
      .set("Cookie", cookieFor("u_avi_managing"))
      .set("x-forwarded-for", "203.0.113.9");
    expect(r.status).toBe(200);
    const k = keys();
    expect(k.length).toBe(1);
    expect(k[0]).toBe("u:u_avi_managing:cb:read");
    expect(k[0]).not.toMatch(/^ip:/);
    /* And the attacker-controlled header did NOT leak into the key. */
    expect(k[0]).not.toContain("203.0.113.9");
  });

  it("two authenticated users behind ONE IP get separate buckets (Wave 18's 'one office, one allowance' does not reproduce)", async () => {
    const app = makeRealApp();
    for (const uid of ["u_avi_managing", "u_avi_viewer"]) {
      await request(app)
        .post("/api/collective/items")
        .set("Cookie", cookieFor(uid))
        .set("x-forwarded-for", "198.51.100.7");
    }
    expect(keys().sort()).toEqual(["u:u_avi_managing:cb:write", "u:u_avi_viewer:cb:write"]);
  });

  it("HARNESS CONTROL — remove loadUserContext and Wave 18's finding DOES reproduce", async () => {
    /* This is the whole explanation of the bad report, executed. The same
       request, the same cookie, the same limiter — only the middleware Wave 18's
       harness omitted is omitted — and the key collapses to an IP bucket. A
       finding that appears or disappears with the harness is a finding about the
       harness. */
    const app = makeRealApp({ withUserContext: false });
    await request(app).get("/api/collective/items").set("Cookie", cookieFor("u_avi_managing"));
    expect(keys()[0]).toMatch(/^ip:/);
  });

  it("a TAMPERED cookie is NOT honoured as an identity — it falls to the anonymous bucket", async () => {
    const app = makeRealApp();
    await request(app)
      .get("/api/collective/items")
      .set("Cookie", `${LEGACY_SESSION_COOKIE}=u_admin.deadbeef`);
    const k = keys();
    expect(k.length).toBe(1);
    expect(k[0]).toMatch(/^ip:/);
    expect(k[0]).not.toContain("u_admin");
  });
});

/* ==================================================================== */
describe("WAIVER-2 PART B — the real defect: an attacker-controlled bucket key", () => {
  it("FALSIFICATION POLE 1 — a rotated x-forwarded-for no longer mints fresh buckets", async () => {
    const app = makeRealApp();
    /* Anonymous (no cookie), 65 requests, a different forged XFF each time.
       Pre-fix this produced 65 distinct keys and 65 × 200. */
    let last = 0;
    for (let i = 0; i < 65; i++) {
      const r = await request(app)
        .get("/api/collective/items")
        .set("x-forwarded-for", `203.0.113.${i}`);
      last = r.status;
    }
    assertAnonymous();
    expect(keys().length, "one anonymous peer must hold exactly one bucket").toBe(1);
    expect(keys()[0]).not.toMatch(/203\.0\.113/);
    /* 65 < the read limit of 600, so the request itself still succeeds — the
       point is the KEY, not a 429. Proven on the write bucket next. */
    expect(last).toBe(200);
  });

  it("FALSIFICATION POLE 1b — rotation can no longer outrun the WRITE limit", async () => {
    const app = makeRealApp();
    const limit = CollectiveBucketLimits.write;
    let refusals = 0;
    for (let i = 0; i < limit + 3; i++) {
      const r = await request(app)
        .post("/api/collective/items")
        .set("x-forwarded-for", `198.51.100.${i}`);
      if (r.status === 429) refusals += 1;
    }
    assertAnonymous();
    /* Wave 18 measured 63 consecutive 200s against a 60/min bucket by exactly
       this method. Now the overflow is refused. */
    expect(refusals).toBe(3);
  });

  it("FALSIFICATION POLE 2 — two GENUINELY distinct peers still get their own buckets", async () => {
    /* The pole that catches the catastrophic over-correction: a fix that keyed
       every anonymous caller to one constant would also defeat rotation, and
       would let one visitor lock out the internet. */
    process.env.TRUSTED_PROXY_HOPS = "1";
    const app = makeRealApp();
    await request(app).get("/api/collective/items").set("x-forwarded-for", "203.0.113.1");
    await request(app).get("/api/collective/items").set("x-forwarded-for", "203.0.113.2");
    const k = keys();
    expect(k.length).toBe(2);
    expect(k.some((x) => x.includes("203.0.113.1"))).toBe(true);
    expect(k.some((x) => x.includes("203.0.113.2"))).toBe(true);
  });

  it("FAIL CLOSED — with no trust configuration the header is ignored entirely", () => {
    delete process.env.TRUSTED_PROXY_HOPS;
    expect(trustedProxyHopCount()).toBe(0);
    const req = {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
      socket: { remoteAddress: "10.0.0.1" },
      ip: "10.0.0.1",
    } as unknown as express.Request;
    expect(resolveRateLimitClientIp(req)).toBe("10.0.0.1");
  });

  it("FAIL CLOSED — junk, negative and zero trust settings all mean DO NOT TRUST", () => {
    const req = {
      headers: { "x-forwarded-for": "1.2.3.4" },
      socket: { remoteAddress: "10.0.0.1" },
      ip: "10.0.0.1",
    } as unknown as express.Request;
    for (const v of ["", "0", "-1", "abc", "NaN", " ", "1.5x"]) {
      process.env.TRUSTED_PROXY_HOPS = v;
      expect(trustedProxyHopCount(), `hops for ${JSON.stringify(v)}`).toBe(0);
      expect(resolveRateLimitClientIp(req), `ip for ${JSON.stringify(v)}`).toBe("10.0.0.1");
    }
  });

  it("with ONE trusted hop the client is the entry the trusted proxy appended, not the attacker's prefix", () => {
    process.env.TRUSTED_PROXY_HOPS = "1";
    const req = {
      /* The attacker sent "evil"; our one trusted proxy appended the true peer. */
      headers: { "x-forwarded-for": "evil-forged, 203.0.113.55" },
      socket: { remoteAddress: "10.0.0.1" },
      ip: "10.0.0.1",
    } as unknown as express.Request;
    expect(resolveRateLimitClientIp(req)).toBe("203.0.113.55");
  });

  it("with TWO trusted hops the client is one further left — and a SHORT chain still cannot be forged past", () => {
    process.env.TRUSTED_PROXY_HOPS = "2";
    const two = {
      headers: { "x-forwarded-for": "evil, 203.0.113.55, 10.0.0.9" },
      socket: { remoteAddress: "10.0.0.1" },
      ip: "10.0.0.1",
    } as unknown as express.Request;
    expect(resolveRateLimitClientIp(two)).toBe("203.0.113.55");
    /* Chain shorter than the configured hop count: the honest reading is that
       the request did not traverse the expected proxies, so fall back to the
       socket rather than reach into attacker-supplied text. */
    const short = {
      headers: { "x-forwarded-for": "evil" },
      socket: { remoteAddress: "10.0.0.1" },
      ip: "10.0.0.1",
    } as unknown as express.Request;
    expect(resolveRateLimitClientIp(short)).toBe("10.0.0.1");
  });

  it("the hop count is CLAMPED — an absurd setting cannot be used to walk off the chain", () => {
    process.env.TRUSTED_PROXY_HOPS = "9999";
    expect(trustedProxyHopCount()).toBeLessThanOrEqual(8);
  });

  it("SOURCE FENCE — no limiter function reads x-forwarded-for directly any more", () => {
    /* One central resolver, or the next contributor reintroduces the bug in the
       function nobody remembered. COMMENTS ARE STRIPPED FIRST: the WAIVER-2
       doc block quotes the offending expression verbatim while explaining it,
       and a fence that counted that would be measuring prose. Exactly one
       EXECUTABLE read is permitted — the one inside `resolveRateLimitClientIp`. */
    const reads = stripComments(RATELIMIT_SRC).match(/headers\[\s*["']x-forwarded-for["']\s*\]/g) ?? [];
    expect(reads.length).toBe(1);
    expect(RATELIMIT_SRC).toContain("function resolveRateLimitClientIp");
    /* Both key builders must go through it. */
    expect(RATELIMIT_SRC).toMatch(/function clientKey[\s\S]{0,400}resolveRateLimitClientIp\(req\)/);
    expect(RATELIMIT_SRC).toMatch(/function authIpKey[\s\S]{0,400}resolveRateLimitClientIp\(req\)/);
  });

  it("FENCE POSITIVE POLE — the source fence FIRES on the pre-fix shape", () => {
    /* Proving the regex is not vacuous. This is the pre-fix `authIpKey` body. */
    const preFix = `function authIpKey(req: Request): string {
  const fwd = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
  return \`auth-ip:\${fwd || req.ip || "unknown"}\`;
}`;
    expect((preFix.match(/headers\[\s*["']x-forwarded-for["']\s*\]/g) ?? []).length).toBe(1);
    expect(/function authIpKey[\s\S]{0,400}resolveRateLimitClientIp\(req\)/.test(preFix)).toBe(false);
  });
});

/* ==================================================================== */
describe("WAIVER-2 PART C — the third path (auth spray) and unweakened limits", () => {
  function authApp() {
    const app = express();
    app.use(express.json());
    app.post("/api/auth/login", authLoginRateLimit, (_req, res) => {
      res.json({ ok: true });
    });
    return app;
  }

  it("THIRD PATH — a rotated x-forwarded-for no longer defeats the login throttle", async () => {
    process.env.NODE_ENV = "test";
    process.env.ENFORCE_AUTH_RATELIMIT = "1";
    const app = authApp();
    let refusals = 0;
    for (let i = 0; i < 13; i++) {
      const r = await request(app).post("/api/auth/login").set("x-forwarded-for", `203.0.113.${i}`);
      if (r.status === 429) refusals += 1;
    }
    /* 10/min limit → the last 3 must be refused. Pre-fix: zero refusals, an
       unlimited credential spray from a single host. */
    expect(refusals).toBe(3);
  });

  it("THE LIMITS THEMSELVES ARE UNCHANGED", () => {
    expect(CollectiveBucketLimits).toEqual({ write: 60, read: 600, sse: 30 });
    expect(RATELIMIT_SRC).toContain("const READ_LIMIT = 60;");
    expect(RATELIMIT_SRC).toContain("const WRITE_LIMIT = 10;");
    expect(RATELIMIT_SRC).toContain("const AUTH_LOGIN_LIMIT = 10;");
    expect(RATELIMIT_SRC).toContain("const AUTH_SIGNUP_LIMIT = 5;");
    expect(RATELIMIT_SRC).toContain("const AUTH_FAIL_LIMIT = 5;");
  });

  it("ANONYMOUS CALLERS ARE STILL LIMITED — the fix is about who owns the key, not about who is exempt", async () => {
    const app = makeRealApp();
    let refusals = 0;
    for (let i = 0; i < CollectiveBucketLimits.write + 2; i++) {
      const r = await request(app).post("/api/collective/items");
      if (r.status === 429) refusals += 1;
    }
    assertAnonymous();
    expect(refusals).toBe(2);
  });

  it("the legacy /api/auth/secure limiter is keyed by the same hardened resolver", async () => {
    const app = express();
    app.use(cookieShim());
    app.use(loadUserContext);
    app.use("/api/auth/secure", rateLimitMiddleware);
    app.post("/api/auth/secure/rotate", (_req, res) => {
      res.json({ ok: true });
    });
    let refusals = 0;
    for (let i = 0; i < 13; i++) {
      const r = await request(app)
        .post("/api/auth/secure/rotate")
        .set("x-forwarded-for", `198.51.100.${i}`);
      if (r.status === 429) refusals += 1;
    }
    /* WRITE_LIMIT = 10. Pre-fix rotation gave 13 × 200. */
    expect(refusals).toBe(3);
  });

  it("the 429 body carries a duration, and no money", async () => {
    const app = makeRealApp();
    let body: Record<string, unknown> = {};
    for (let i = 0; i < CollectiveBucketLimits.write + 1; i++) {
      const r = await request(app).post("/api/collective/items");
      if (r.status === 429) body = r.body;
    }
    expect(body.error).toBe("rate_limited");
    expect(body.bucket).toBe("write");
    expect(typeof body.retryAfterMs).toBe("number");
    expect(body.retryAfterMs as number).toBeGreaterThan(0);
    expect(body.retryAfterMs as number).toBeLessThanOrEqual(60_000);
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/[$€£¥]/);
    expect(text).not.toMatch(/\bUSD\b|\bJPY\b|\bKWD\b|amountMinor|currency/i);
  });

  it("health probes are still exempt after the change", async () => {
    /* Mounted at /api — the only arrangement where the bypass does any work.
       (Wave 18 fixed this same test in its own harness; the shape is kept.) */
    const app = express();
    app.use("/api", collectiveRateLimit);
    app.get("/api/health", (_req, res) => {
      res.json({ ok: true });
    });
    app.get("/api/other", (_req, res) => {
      res.json({ ok: true });
    });
    for (let i = 0; i < 100; i++) {
      const r = await request(app).get("/api/health").set("x-forwarded-for", `203.0.113.${i}`);
      expect(r.status).toBe(200);
    }
    expect(keys().length).toBe(0);
    /* Positive pole — the SAME mount does count a non-exempt path. */
    await request(app).get("/api/other");
    expect(keys().length).toBe(1);
  });
});
