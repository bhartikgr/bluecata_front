/**
 * WAVE 18 · CP-MSG-05 — MSG-05 "Rate limiting" (spec state ABSENT P2).
 *
 * ── WHAT IS AND IS NOT DELIVERED ───────────────────────────────────────────
 * The limiter EXISTS and IS mounted on the messaging surface —
 * `app.use("/api/messages", collectiveRateLimit)` (`server/routes.ts:1045`),
 * with `/api/collective` (:1043) and `/api/partner` (:1044). MSG-05 is
 * therefore WIRING, not BUILD-NEW, and this file fences that wiring.
 *
 * ── WAVE 19 · WAIVER-2 — THIS FILE HAS BEEN CORRECTED ──────────────────────
 * The owner granted the waiver on 2026-08-11 and the fix landed in
 * `server/lib/rateLimit.ts`. Two things changed here, and the second one is an
 * admission rather than an update:
 *
 * 1. THE THREE "FROZEN DEFECT" PINS ARE GONE, not inverted. They asserted that
 *    an authenticated caller keys on IP because `req.userContext` is
 *    unpopulated at limiter time. That diagnosis was WRONG.
 *    `app.use(loadUserContext)` is registered at `server/routes.ts:534` and
 *    every limiter mounts at `:1043`+; Express runs `app.use` in registration
 *    order, so `req.userContext.userId` was already populated in production.
 *    THIS FILE'S OWN `makeApp` OMITTED `loadUserContext` — so the pins measured
 *    a world the harness had built, and reported a defect that did not exist.
 *    `makeApp` now installs it, in production order. Leaving the pins would
 *    have forced a future wave to "fix" correct code.
 *
 * 2. THE DEFECT THAT WAS REAL — both key builders read the
 *    attacker-controlled `x-forwarded-for` header with no `trust proxy`
 *    configuration anywhere, so rotating it minted a fresh bucket per request
 *    and the limiter did not limit. That is fixed centrally in
 *    `resolveRateLimitClientIp`, fail-closed (no trust unless
 *    `TRUSTED_PROXY_HOPS` is set), with `authIpKey` — the login/signup spray
 *    throttles — fixed by the same change. Full proof, both poles, and the
 *    harness control that reproduces Wave 18's bad finding on demand:
 *    `server/__tests__/wave19_waiver2_ratelimit_key.test.ts`.
 *
 * Because trust now defaults to OFF, a forged `x-forwarded-for` no longer
 * appears in any bucket key. Assertions below that named a forged address
 * verbatim now assert the SHAPE (an `ip:` bucket that does NOT contain the
 * forged value) — which is the property that actually matters.
 *
 * ── WHY THE PRE-EXISTING SUITE DID NOT CATCH ANY OF THIS ───────────────────
 * `server/__tests__/rateLimit.test.ts` installs its own middleware,
 *   app.use((req) => { (req as any).userContext = { userId: header } })
 * ahead of the limiter, "mimicking how the real auth middleware would populate
 * req.userContext". Production has nothing in that position. All thirteen of
 * its tests pass against per-user buckets that exist only inside the test.
 * This file installs NO such shim.
 *
 * Both poles are asserted throughout: a limiter that never 429s and one that
 * 429s everybody both survive a one-sided test.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import {
  collectiveRateLimit,
  rateLimitMiddleware,
  CollectiveBucketLimits,
  RateLimitConfig,
  RATE_LIMIT_BYPASS_PATHS,
  _collectiveBucketSnapshot,
  _resetRateLimitsForTests,
} from "../lib/rateLimit";
import { signSessionValue, LEGACY_SESSION_COOKIE } from "../lib/sessionCookie";
import { loadUserContext } from "../lib/requireEntitlement";

/**
 * The real stack, minus the shim. Mounts mirror `server/routes.ts:1043-1045`
 * (prefix `app.use`, i.e. before any route-level auth middleware).
 */
/**
 * The production request stack parses the Cookie header into `req.cookies`
 * with an inline shim at `server/index.ts:76`, i.e. BEFORE `registerRoutes`
 * mounts the limiter. `readSessionCookie` (`server/lib/sessionCookie.ts:147`)
 * reads only `req.cookies`, so without this the identity fix would be inert.
 * Mirrored verbatim here, and fenced by a source test below so the ordering
 * cannot silently change.
 */
function cookieShim(): express.RequestHandler {
  return (req, _res, next) => {
    const r = req as express.Request & { cookies?: Record<string, string> };
    if (!r.cookies) {
      const header = req.headers.cookie;
      const out: Record<string, string> = {};
      if (typeof header === "string" && header.length > 0) {
        for (const part of header.split(";")) {
          const eq = part.indexOf("=");
          if (eq === -1) continue;
          const k = part.slice(0, eq).trim();
          const v = part.slice(eq + 1).trim();
          if (k.length > 0) {
            try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
          }
        }
      }
      r.cookies = out;
    }
    next();
  };
}

function makeApp() {
  const app = express();
  app.use(cookieShim());
  /* WAVE 19 WAIVER-2 — production order: routes.ts:534 registers
     loadUserContext globally, BEFORE the limiter mounts at :1043-1045. Its
     absence here is what made this file's original identity findings false. */
  app.use(loadUserContext);
  app.use("/api/collective", collectiveRateLimit);
  app.use("/api/partner", collectiveRateLimit);
  app.use("/api/messages", collectiveRateLimit);
  app.get("/api/messages", (_req, res) => res.json({ ok: true }));
  app.post("/api/messages", (_req, res) => res.json({ ok: true }));
  app.get("/api/messages/sse", (_req, res) => res.json({ ok: true }));
  app.post("/api/partner/me/crm/contacts", (_req, res) => res.json({ ok: true }));
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  return app;
}

/** A real signed session cookie — the production identity carrier. */
function cookieFor(userId: string): string {
  return `${LEGACY_SESSION_COOKIE}=${encodeURIComponent(signSessionValue(userId))}`;
}

const WRITE_LIMIT = CollectiveBucketLimits.write;

/** Exhaust `n` writes as `userId`, optionally from a claimed forwarded IP. */
async function writes(
  app: express.Express,
  n: number,
  opts: { userId?: string; xff?: string; path?: string } = {},
): Promise<number[]> {
  const codes: number[] = [];
  for (let i = 0; i < n; i += 1) {
    let r = request(app).post(opts.path ?? "/api/messages");
    if (opts.userId) r = r.set("Cookie", cookieFor(opts.userId));
    if (opts.xff) r = r.set("x-forwarded-for", opts.xff);
    const res = await r.send({});
    codes.push(res.status);
  }
  return codes;
}

const ENV_BEFORE_FILE = { ...process.env };

describe("CP-MSG-05 — the messaging limiter is keyed on the caller", () => {
  beforeEach(() => {
    _resetRateLimitsForTests();
    /* WAVE 19 — without this, `resolvePersonaIdWithFallback`
       (`server/lib/userContext.ts:518`) hands every ANONYMOUS request the demo
       persona `u_aisha_patel`, and the "anonymous" assertions below would be
       measuring the demo fallback instead of the IP branch. */
    process.env.DISABLE_DEV_BYPASS = "1";
    delete process.env.TRUSTED_PROXY_HOPS;
  });

  /* WAVE 19 — env must be RESTORED, not merely set. Without this the
     `DISABLE_DEV_BYPASS=1` above leaks out of this file into every suite that
     shares the worker process, and admin routes elsewhere start answering 403.
     Caught by `scripts/test_baseline_check.sh`, not by this file — a reminder
     that a suite can be green and still be doing damage. */
  afterEach(() => {
    process.env = { ...ENV_BEFORE_FILE };
  });

  it("mounts are what routes.ts says they are (documented, not assumed)", () => {
    /* If this drifts, the rest of the file is measuring a private app. */
    expect(CollectiveBucketLimits).toEqual({ write: 60, read: 600, sse: 30 });
    expect(RateLimitConfig.WINDOW_MS).toBe(60_000);
  });

  it("SACRED FENCE — rateLimit.ts is frozen at its post-WAIVER-2 bytes", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const crypto = require("node:crypto") as typeof import("node:crypto");
    const manifest = fs.readFileSync("sacred_baseline/SACRED_SHA256.txt", "utf8");
    const line = manifest.split("\n").find((l) => l.includes("server/lib/rateLimit.ts"));
    expect(line, "rateLimit.ts must still be in the sacred manifest").toBeTruthy();
    const baseHash = (line as string).trim().split(/\s+/)[0];
    /* WAVE 19 — the enforced hash is the KNOWN_DRIFT override when one exists.
       `sacred_baseline/SACRED_SHA256.txt` is an INPUT that waivers never
       rewrite (the WAIVER-1 precedent), so reading it alone would check the
       pre-waiver bytes and this fence would be measuring history. Resolve the
       override the same way `scripts/sacred_check.sh` does. */
    const check = fs.readFileSync("scripts/sacred_check.sh", "utf8");
    /* W31-A3 - THE ROW NOW CARRIES A FOURTH FIELD, AND THIS FENCE READS IT.
     *
     * This regex used to end at `([0-9a-f]{64})"`, i.e. it required the row to
     * terminate immediately after the frozen hash. When W31-A3 appended a waiver
     * id to every KNOWN_DRIFT row the match FAILED, `drift` became null, and
     * `expected` silently fell back to `baseHash` - the PRE-waiver bytes. The
     * fence then compared today's rateLimit.ts against its 2026-07 hash and
     * failed. That was correct behaviour from a fence whose parser had gone
     * blind, and it is exactly why rule 9 says a waiver change must visit BOTH
     * enforcement points: the shell gate and this test parse the same array
     * independently, and only one of them had been updated.
     *
     * The fourth field is now REQUIRED and CHECKED, which strengthens the fence.
     * The old code proved only that the string "WAIVER-2" appeared SOMEWHERE in
     * a 400-line script - a comment about an unrelated file would have satisfied
     * it. It now proves rateLimit.ts's OWN row is tagged WAIVER-2.
     *
     * WAVE 38 - THE FIFTH FIELD, AND THE SAME LESSON A THIRD TIME.
     *
     * Wave 38 Row 6 appended field 5 (the ratification state) to every
     * KNOWN_DRIFT row so that an operator reading `SACRED OK: 47/47` learns
     * whether a waived sacred edit was ever signed off. When Row 6 landed,
     * WAIVER-5 was PENDING OWNER RATIFICATION; the owner RATIFIED it on
     * 2026-08-13 (WAVE 48 - ITEM 2, ruling R13), and the assertion added at the
     * end of this test is this file's own independent record of that.
     * Row 6 updated the two
     * enforcement points it knew about - `scripts/sacred_check.sh` itself and
     * `server/__tests__/waveB_retirement_guard.test.ts`. THIS IS A THIRD ONE,
     * and nobody knew it existed until it broke: the four-field regex above
     * ended at `(WAIVER-\\d+)"`, requiring the row to TERMINATE after the waiver
     * id, so the five-field row did not match and `drift` went null again -
     * the identical failure W31-A3 documents one paragraph up, reintroduced by
     * the fix for a different instance of it.
     *
     * The parser is now written so that a SIXTH field cannot silently blind it
     * either: the row is matched up to its closing quote and split on `|`, and
     * the field COUNT is asserted EXACTLY rather than being encoded as "the row
     * ends here". A future field addition fails with a message that names the
     * problem - and names every consumer that must be visited - instead of
     * degrading this fence into a comparison against pre-waiver history.
     *
     * Exactly-5 is deliberate, and it was chosen after MEASUREMENT: a mutant
     * that appended a sixth field `|SOMEFUTUREFIELD` was accepted by
     * `scripts/sacred_check.sh` itself (`SCRIPT_EXIT=0`, summary unchanged) and
     * by a `>= 5` version of this fence. An unknown trailing field being
     * ignored everywhere is how field 5 came to exist in one reader and not the
     * others. This fence therefore fails on ANY change to the row shape, in
     * either direction, so the sweep is forced.
     *
     * Field 5 is REQUIRED and CHECKED against the closed vocabulary, both
     * poles: it must be exactly RATIFIED for this row (WAIVER-2 was
     * owner-granted 2026-08-11), and it must never be an unrecognised token -
     * unknown provenance must not read as approval. */
    const driftRow = check.match(/"server\/lib\/rateLimit\.ts\|([^"]*)"/);
    expect(
      driftRow,
      "rateLimit.ts must have a KNOWN_DRIFT row in scripts/sacred_check.sh. " +
        "A null match makes this fence fall back to the pre-waiver hash and " +
        "measure history instead of the freeze.",
    ).toBeTruthy();
    const fields = (driftRow as RegExpMatchArray)[1].split("|");
    expect(
      fields.length + 1,
      "KNOWN_DRIFT rows must carry EXACTLY 5 fields " +
        "(path|old|frozen|WAIVER-n|ratification-state). Got " +
        `${fields.length + 1}: ${JSON.stringify(fields)}. If the row shape ` +
        "changed, every reader of this manifest must be visited in the same " +
        "commit. The known consumers are listed in " +
        "build_log/WAVE38_REPORT.md - FIX 1 - and the enforcing ones are " +
        "scripts/sacred_check.sh, server/__tests__/waveB_retirement_guard.test.ts " +
        "and THIS file. A waiver installed in only some of them has caused three " +
        "separate incidents.",
    ).toBe(5);
    const [oldHash, frozenHash, waiverId, ratification] = fields;
    expect(oldHash, "field 2 must be a sha256").toMatch(/^[0-9a-f]{64}$/);
    expect(frozenHash, "field 3 must be a sha256").toMatch(/^[0-9a-f]{64}$/);
    expect(waiverId, "field 4 must be a waiver id").toMatch(/^WAIVER-\d+$/);
    /* Closed vocabulary - the NEGATIVE pole. An unrecognised or empty field 5
       must fail here rather than be read as "ratified by default". */
    expect(
      ["RATIFIED", "PENDING-OWNER-RATIFICATION"],
      `field 5 must be a recognised ratification state, got ${JSON.stringify(ratification)}`,
    ).toContain(ratification);
    const expected = frozenHash;
    /* The waiver must preserve the pre-waiver hash as evidence, not erase it. */
    expect(oldHash).toBe(baseHash);
    /* ...and this row must be governed by WAIVER-2 specifically. */
    expect(waiverId).toBe("WAIVER-2");
    /* ...and WAIVER-2 was owner-granted (Ozan Isinak, 2026-08-11), so its row
       must say so. A row silently flipped to PENDING would mean the gate is
       reporting an unratified edit where an owner-signed one is enforced;
       a row flipped the other way is the more dangerous direction and is
       covered by waveB_retirement_guard G-11 for WAIVER-5. */
    expect(ratification).toBe("RATIFIED");
    /* WAVE 48 - ITEM 2 (R13). THIS FILE IS THE THIRD ENFORCEMENT POINT, and the
       Wave 38 lesson is that a waiver's state recorded in only some readers is
       how three separate incidents happened. So the owner's 2026-08-13
       ratification of WAIVER-5 is recorded HERE too, independently: the
       Billing.tsx row must exist (a deleted waiver is not a ratified one), it
       must be tagged WAIVER-5, and its field 5 must read exactly RATIFIED. If a
       future wave un-ratifies it or drops the row, this assertion fails here as
       well as in waveB_retirement_guard G-11. */
    const waiver5Row = check.match(/"client\/src\/pages\/founder\/Billing\.tsx\|([^"]*)"/);
    expect(
      waiver5Row,
      "WAIVER-5's KNOWN_DRIFT row for client/src/pages/founder/Billing.tsx must " +
        "still be present in scripts/sacred_check.sh: ratifying a waiver records " +
        "a decision, it does not remove the freeze.",
    ).toBeTruthy();
    /* WAVE 75 · ITEM 1 (R70) — WAIVER-8 IS RECORDED AT THIS THIRD POINT TOO.
       `release/SACRED_DOC_v26_19_0.md` §3.4 names three enforcement sites, and this
       file is the third (the one Wave 58g found only by grepping). The Wave 38 /
       WAIVER-4/5/6 lesson is that a waiver recorded in only some readers is how
       four separate second-path misses happened, so WAIVER-8 — the owner-ratified
       R70 grant covering server/paymentGatewayAdapter.ts, whose two
       `ownershipPct: 1.0` literals rendered a confident `100.00%` on a brand-new
       company's dashboard — is asserted HERE as well: the row must exist, it must
       be tagged WAIVER-8, and field 5 must read exactly RATIFIED.

       ON THE ID: R70 condition 5 calls it "WAIVER-9", counting the eight
       KNOWN_DRIFT ROWS then in force. Field 4 is a waiver ID and the distinct ids
       were 1..7, so a WAIVER-9 row with no WAIVER-8 makes sacred_check.sh ABORT
       (exit 3) on its own closed-vocabulary check. Transcript:
       build_log/wave75/W75_WAIVER9_REGISTRATION.md §2. */
    const waiver8Row = check.match(/"server\/paymentGatewayAdapter\.ts\|([^"]*)"/);
    expect(
      waiver8Row,
      "WAIVER-8's KNOWN_DRIFT row for server/paymentGatewayAdapter.ts must be " +
        "present in scripts/sacred_check.sh: the sacred file was edited under an " +
        "owner-ratified waiver (R70), and an edited sacred file with no registered " +
        "waiver is worse than the defect it fixed.",
    ).toBeTruthy();
    const w8Fields = (waiver8Row as RegExpMatchArray)[1].split("|");
    expect(w8Fields.length + 1, "WAIVER-8 row must also carry EXACTLY 5 fields").toBe(5);
    expect(w8Fields[0], "field 2 must preserve the PRE-waiver bytes as evidence").toBe(
      "83757c546b41bce996cd55cdaf42c046bc8bc3cd3c0e457389ac0738b2911660",
    );
    expect(w8Fields[2], "the paymentGatewayAdapter.ts row must be governed by WAIVER-8").toBe("WAIVER-8");
    expect(
      w8Fields[3],
      "WAIVER-8 was OWNER-RATIFIED 2026-08-18 (R70); field 5 must say so",
    ).toBe("RATIFIED");
    /* And the ENFORCED bytes are the ones actually on disk — an exact pin, not an
       ignore, independently written here as the third copy.

       WAVE 97B RE-FREEZE (2026-08-21) — R86, owner's instruction "remove stripe.
       I can add this at a later date. We are using Airwallex today." The pin moved
       from 15679904…5a9c0d27 (Wave 75, R70) to 7b515904…a5f980372 because the
       Stripe wiring was removed from the sacred adapter. WAIVER-8's row is
       otherwise untouched — same path, same id, same RATIFIED state — so the two
       "9 under KNOWN_DRIFT freeze" / "all 9 waivers OWNER-RATIFIED" assertions in
       this same file are deliberately NOT changed and are still true. That is the
       mechanical consequence of a re-freeze rather than a new row.
       The prior hash is retained here and in sacred_check.sh's HASH LINEAGE. */
    expect(w8Fields[1]).toBe("7b5159047803610592ffb4fe32eee18c9261ae027f990073a1131a7a5f980372");
    expect(
      crypto.createHash("sha256").update(fs.readFileSync("server/paymentGatewayAdapter.ts")).digest("hex"),
    ).toBe(w8Fields[1]);

    const w5Fields = (waiver5Row as RegExpMatchArray)[1].split("|");
    expect(w5Fields.length + 1, "WAIVER-5 row must also carry EXACTLY 5 fields").toBe(5);
    expect(w5Fields[2], "the Billing.tsx row must be governed by WAIVER-5").toBe("WAIVER-5");
    expect(
      w5Fields[3],
      "WAIVER-5 was OWNER-RATIFIED 2026-08-13 (R13); field 5 must say so",
    ).toBe("RATIFIED");
    /* NEGATIVE POLE, so this is not a one-sided "everything is RATIFIED" check:
       the closed vocabulary still has two members, and an unrecognised token
       must not read as approval here either. */
    expect(["RATIFIED", "PENDING-OWNER-RATIFICATION"]).toContain(w5Fields[3]);
    const actual = crypto
      .createHash("sha256")
      .update(fs.readFileSync("server/lib/rateLimit.ts"))
      .digest("hex");
    /* WAVE 19 — the waiver landed and the recorded hash moved to the fixed
       bytes under WAIVER-2. This fence is kept exactly as it is: it now proves
       the NEW bytes are the frozen ones, so a further unwaived edit still
       fails. */
    expect(actual).toBe(expected);
  });

  it("SOURCE FENCE — cookies are parsed before routes, and the limiter is mounted on the messaging surface", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const index = fs.readFileSync("server/index.ts", "utf8");
    const cookieAt = index.indexOf("r.cookies = out;");
    const routesAt = index.indexOf("registerRoutes(");
    expect(cookieAt).toBeGreaterThan(-1);
    expect(routesAt).toBeGreaterThan(-1);
    /* If routes were registered first, `req.cookies` would be empty at limiter
       time and every caller would fall back to the IP bucket again — the exact
       defect this item fixes, reintroduced by ordering alone. */
    expect(cookieAt).toBeLessThan(routesAt);
    const routes = fs.readFileSync("server/routes.ts", "utf8");
    for (const mount of ["/api/collective", "/api/partner", "/api/messages"]) {
      expect(routes).toContain(`app.use("${mount}", collectiveRateLimit);`);
    }
  });

  it("CORRECTED (was FROZEN DEFECT) — a valid session cookie keys the bucket on the USER", async () => {
    const app = makeApp();
    await writes(app, 1, { userId: "u_avi_managing", xff: "203.0.113.9" });
    const keys = Object.keys(_collectiveBucketSnapshot());
    expect(keys).toHaveLength(1);
    /* Wave 18 pinned this as "ip:203.0.113.9:cb:write" and was wrong: its
       harness had no loadUserContext. With the real chain it always was, and
       is, the user. */
    expect(keys[0]).toBe("u:u_avi_managing:cb:write");
    expect(keys[0]).not.toContain("203.0.113.9");
  });

  it("CORRECTED (was FROZEN DEFECT) — two partners behind ONE egress IP have SEPARATE allowances", async () => {
    const app = makeApp();
    const a = await writes(app, WRITE_LIMIT, { userId: "u_avi_managing", xff: "203.0.113.9" });
    expect(a.filter((c) => c === 429)).toHaveLength(0);
    /* The colleague is NOT collateral damage. Wave 18 reported three 429s here;
       that was the missing middleware, not the product. */
    const b = await writes(app, 3, { userId: "u_avi_viewer", xff: "203.0.113.9" });
    expect(b).toEqual([200, 200, 200]);
    const snap = _collectiveBucketSnapshot();
    expect(Object.keys(snap).sort()).toEqual([
      "u:u_avi_managing:cb:write",
      "u:u_avi_viewer:cb:write",
    ]);
    expect(snap["u:u_avi_managing:cb:write"]).toBe(WRITE_LIMIT);
    expect(snap["u:u_avi_viewer:cb:write"]).toBe(3);
  });

  it("FIXED — rotating x-forwarded-for no longer mints a fresh bucket per request", async () => {
    const app = makeApp();
    const codes: number[] = [];
    for (let i = 0; i < WRITE_LIMIT + 3; i += 1) {
      const r = await request(app)
        .post("/api/messages")
        .set("Cookie", cookieFor("u_avi_managing"))
        .set("x-forwarded-for", `198.51.100.${i % 250}`)
        .send({});
      codes.push(r.status);
    }
    /* THE MEASURED DEFECT, now closed: Wave 18 recorded 63 consecutive 200s
       here. The tail is refused and the state collapses to ONE key. */
    expect(codes.filter((c) => c === 429)).toHaveLength(3);
    const keys = Object.keys(_collectiveBucketSnapshot());
    expect(keys).toEqual(["u:u_avi_managing:cb:write"]);
  });

  it("FIXED — an ANONYMOUS caller rotating x-forwarded-for is also bound to one bucket", async () => {
    /* The authenticated case above would pass even with the header defect
       intact, because the user branch wins before the IP branch is reached.
       This is the pole that actually exercises the fix. */
    const app = makeApp();
    const codes: number[] = [];
    for (let i = 0; i < WRITE_LIMIT + 3; i += 1) {
      const r = await request(app)
        .post("/api/messages")
        .set("x-forwarded-for", `192.0.2.${i % 250}`)
        .send({});
      codes.push(r.status);
    }
    expect(codes.filter((c) => c === 429)).toHaveLength(3);
    const keys = Object.keys(_collectiveBucketSnapshot());
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^ip:/);
    expect(keys[0]).not.toMatch(/192\.0\.2\./);
  });

  it("an anonymous caller still gets an IP bucket (fail-closed, unchanged)", async () => {
    const app = makeApp();
    const codes = await writes(app, WRITE_LIMIT + 1, { xff: "203.0.113.77" });
    expect(codes[codes.length - 1]).toBe(429);
    /* WAVE 19 — still exactly one IP bucket, and the limit still binds. The
       key is now the socket peer rather than the claimed header, so it is
       asserted by shape: an `ip:` bucket that does NOT carry the forged value. */
    const keys = Object.keys(_collectiveBucketSnapshot());
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^ip:.*:cb:write$/);
    expect(keys[0]).not.toContain("203.0.113.77");
  });

  it("a TAMPERED cookie is not honoured as an identity (true before and after the fix)", async () => {
    const app = makeApp();
    /* Same shape, broken HMAC. It must NOT open a `u:` bucket, and it must not
       500 — identity resolution failure means anonymous. */
    const res = await request(app)
      .post("/api/messages")
      .set("Cookie", `${LEGACY_SESSION_COOKIE}=u_avi_managing.deadbeef`)
      .set("x-forwarded-for", "203.0.113.5")
      .send({});
    expect(res.status).toBe(200);
    const tkeys = Object.keys(_collectiveBucketSnapshot());
    expect(tkeys).toHaveLength(1);
    expect(tkeys[0]).toMatch(/^ip:.*:cb:write$/);
    expect(tkeys[0]).not.toContain("u:u_avi_managing");
    expect(tkeys[0]).not.toContain("203.0.113.5");
  });

  it("the 429 is a rendered refusal with a retry hint, never a silent drop", async () => {
    const app = makeApp();
    await writes(app, WRITE_LIMIT, { userId: "u_avi_viewer", xff: "203.0.113.51" });
    const res = await request(app)
      .post("/api/messages")
      .set("Cookie", cookieFor("u_avi_viewer"))
      .set("x-forwarded-for", "203.0.113.51")
      .send({});
    expect(res.status).toBe(429);
    expect(res.body.error).toBe("rate_limited");
    expect(res.body.bucket).toBe("write");
    expect(typeof res.body.retryAfterMs).toBe("number");
    expect(res.body.retryAfterMs).toBeGreaterThan(0);
    expect(res.body.retryAfterMs).toBeLessThanOrEqual(RateLimitConfig.WINDOW_MS);
    expect(res.headers["x-ratelimit-bucket"]).toBe("write");
    expect(res.headers["x-ratelimit-limit"]).toBe(String(WRITE_LIMIT));
    expect(res.headers["x-ratelimit-remaining"]).toBe("0");
    /* Never a fabricated success body. */
    expect(res.body.ok).toBeUndefined();
  });

  it("reads, writes and SSE connects are independent buckets for the same caller", async () => {
    const app = makeApp();
    await writes(app, WRITE_LIMIT, { userId: "u_maya_chen", xff: "203.0.113.41" });
    const blocked = await writes(app, 1, { userId: "u_maya_chen", xff: "203.0.113.41" });
    expect(blocked[0]).toBe(429);
    /* Writes are spent; a read and an SSE connect must still work. */
    const read = await request(app)
      .get("/api/messages")
      .set("Cookie", cookieFor("u_maya_chen"))
      .set("x-forwarded-for", "203.0.113.41");
    expect(read.status).toBe(200);
    expect(read.headers["x-ratelimit-bucket"]).toBe("read");
    const sse = await request(app)
      .get("/api/messages/sse")
      .set("Cookie", cookieFor("u_maya_chen"))
      .set("x-forwarded-for", "203.0.113.41");
    expect(sse.status).toBe(200);
    expect(sse.headers["x-ratelimit-bucket"]).toBe("sse");
    const snap = _collectiveBucketSnapshot();
    /* WAVE 19 — these were `ip:203.0.113.41:...` under the old harness. The
       caller is authenticated, so the key is the user; the forged header is
       now absent from the key entirely. Bucket INDEPENDENCE, the thing this
       test is actually about, is unchanged. */
    expect(snap["u:u_maya_chen:cb:read"]).toBe(1);
    expect(snap["u:u_maya_chen:cb:sse"]).toBe(1);
    expect(Object.keys(snap).some((k) => k.includes("203.0.113.41"))).toBe(false);
  });

  it("the partner surface and messaging draw on ONE write allowance (no path in the key)", async () => {
    const app = makeApp();
    /* Deliberate contract statement, independent of the identity defect: the
       bucket key contains no path, so a partner's CRM writes and DM sends
       share a single write allowance. If that is ever split, this test must be
       updated on purpose. */
    await writes(app, 10, { userId: "u_avi_managing", xff: "203.0.113.31", path: "/api/partner/me/crm/contacts" });
    await writes(app, 5, { userId: "u_avi_managing", xff: "203.0.113.31", path: "/api/messages" });
    expect(_collectiveBucketSnapshot()["u:u_avi_managing:cb:write"]).toBe(15);
  });

  it("health probes are exempt and never consume a bucket", async () => {
    /* The first version of this test mounted the limiter at /api/collective,
       /api/partner and /api/messages — none of which contain /api/health — so
       it asserted an empty snapshot for a request the limiter never saw, and
       the falsification harness proved it survived disabling `isBypassed`
       entirely. It now mounts the limiter at `/api`, the only arrangement in
       which the bypass has any work to do. */
    const app = express();
    app.use(cookieShim());
    app.use(loadUserContext);
    app.use("/api", collectiveRateLimit);
    app.get("/api/health", (_req, res) => res.json({ ok: true }));
    app.post("/api/messages", (_req, res) => res.json({ ok: true }));
    expect(Array.from(RATE_LIMIT_BYPASS_PATHS.values())).toContain("/api/health");
    for (let i = 0; i < 5; i += 1) {
      const r = await request(app)
        .get("/api/health")
        .set("Cookie", cookieFor("u_avi_managing"))
        .set("x-forwarded-for", "203.0.113.61");
      expect(r.status).toBe(200);
      /* An exempt request must not even be counted — no headers, no bucket. */
      expect(r.headers["x-ratelimit-bucket"]).toBeUndefined();
    }
    expect(Object.keys(_collectiveBucketSnapshot())).toHaveLength(0);
    /* POSITIVE POLE — a non-exempt path through the SAME mount is counted, so
       the empty snapshot above is the bypass and not a dead limiter. */
    await request(app)
      .post("/api/messages")
      .set("Cookie", cookieFor("u_avi_managing"))
      .set("x-forwarded-for", "203.0.113.61")
      .send({});
    expect(_collectiveBucketSnapshot()["u:u_avi_managing:cb:write"]).toBe(1);
  });

  it("SECOND PATH — the legacy rateLimitMiddleware shares clientKey and is fixed by the same change", async () => {
    /* `clientKey` is shared with the /api/auth/secure limiter
       (`server/routes.ts:1306`), so the fix has to be correct there too, and
       its write allowance is a different, tighter number. */
    const app = express();
    app.use(cookieShim());
    app.use(loadUserContext);
    app.use("/api/auth/secure", rateLimitMiddleware);
    app.post("/api/auth/secure/rotate", (_req, res) => res.json({ ok: true }));
    /* Rotating IPs used to defeat this limiter completely. Now the caller is
       resolved from the cookie and the rotation is irrelevant. */
    const rotating: number[] = [];
    for (let i = 0; i < RateLimitConfig.WRITE_LIMIT + 1; i += 1) {
      const r = await request(app)
        .post("/api/auth/secure/rotate")
        .set("Cookie", cookieFor("u_daniel_okafor"))
        .set("x-forwarded-for", `192.0.2.${i}`)
        .send({});
      rotating.push(r.status);
    }
    expect(rotating.filter((c) => c === 200)).toHaveLength(RateLimitConfig.WRITE_LIMIT);
    expect(rotating[rotating.length - 1]).toBe(429);
    /* Fixed IP, a DIFFERENT caller: the tighter WRITE_LIMIT binds them
       independently. Both poles on one sink. */
    const pinned: number[] = [];
    for (let i = 0; i < RateLimitConfig.WRITE_LIMIT + 1; i += 1) {
      const r = await request(app)
        .post("/api/auth/secure/rotate")
        .set("Cookie", cookieFor("u_aisha_patel"))
        .set("x-forwarded-for", "192.0.2.200")
        .send({});
      pinned.push(r.status);
    }
    expect(pinned.filter((c) => c === 200)).toHaveLength(RateLimitConfig.WRITE_LIMIT);
    expect(pinned[pinned.length - 1]).toBe(429);
  });

  it("POSITIVE POLE for the harness itself — the snapshot really does grow", async () => {
    /* If `_collectiveBucketSnapshot` silently returned {} the isolation tests
       above would all pass vacuously. */
    const app = makeApp();
    expect(Object.keys(_collectiveBucketSnapshot())).toHaveLength(0);
    await writes(app, 2, { userId: "u_no_position", xff: "203.0.113.71" });
    expect(_collectiveBucketSnapshot()["u:u_no_position:cb:write"]).toBe(2);
    _resetRateLimitsForTests();
    expect(Object.keys(_collectiveBucketSnapshot())).toHaveLength(0);
  });

  it("no money and no counts leak into the limiter's refusal body", async () => {
    const app = makeApp();
    await writes(app, WRITE_LIMIT, { userId: "u_lapsed_lp", xff: "203.0.113.81" });
    const res = await request(app)
      .post("/api/messages")
      .set("Cookie", cookieFor("u_lapsed_lp"))
      .set("x-forwarded-for", "203.0.113.81")
      .send({});
    const body = JSON.stringify(res.body);
    for (const forbidden of ["amount", "Minor", "currency", "balance"]) {
      expect(body).not.toContain(forbidden);
    }
  });
});
