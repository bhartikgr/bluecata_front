/**
 * WAVE 28 · ITEM 1 — the `/api/partner` rate limiter was INERT. It is not now.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
 * `app.use("/api/partner", collectiveRateLimit)` sat at `server/routes.ts:1046`
 * while all eleven `/api/partner` route registrars ran at `:978-1022`. Express
 * dispatches `app.use(path, mw)` strictly in registration order, so a prefix
 * middleware registered BELOW its routes is never reached. 165 of the 205
 * registered `/api/partner` routes were therefore unrated while the source read
 * as protected. `/api/collective` lost 16 of 115 the same way.
 *
 * ── WHY THIS FILE DOES NOT READ THE SOURCE ─────────────────────────────────
 * Wave 27 pinned the finding by comparing LINE NUMBERS in `routes.ts`. That is
 * a true observation, but it is a check that reads the source, and this build
 * has now been bitten sixteen times by checks that passed while checking
 * nothing. Registration order IS the defect, so every assertion below is made
 * against the REAL `registerRoutes` stack: real HTTP requests through real
 * handlers, and the router's own path matchers walked in the router's own
 * order. Nothing here greps `routes.ts`, and no auth shim is installed — the
 * identities are the repo's real seeded partner personas.
 *
 * ── BOTH POLES, EVERYWHERE ─────────────────────────────────────────────────
 * A limiter that 429s everything and a limiter that 429s nothing both survive a
 * one-sided test. Each case below pins both sides:
 *   · a burst PAST the budget is refused          AND a normal request passes
 *   · the LAST request inside the budget succeeds AND the next one is refused
 *   · a prefix WITHOUT a limiter is never refused under the identical burst
 *   · the sweep's route-finder is shown able to FAIL (vacuous-matcher control)
 *
 * ── THE HEADER IS THE REAL PROOF ───────────────────────────────────────────
 * `collectiveRateLimit` sets `X-RateLimit-Bucket` / `-Limit` / `-Remaining`
 * (`server/lib/rateLimit.ts:702-705`) BEFORE it decides to allow or refuse.
 * Their presence proves the middleware was ENTERED. Their absence — which is
 * exactly what the pre-fix measurement recorded across 70 requests — proves it
 * was not. Absence of a 429 alone would prove nothing, because a merely
 * generous limit looks identical.
 *
 * ===========================================================================
 * WAVE 31 · W31-A2 — THE IDENTITIES IN THIS FILE WERE DEV-ONLY. THEY ARE NOT NOW.
 * ===========================================================================
 * Wave 29 §4.5 reported that this file fails under production identity posture
 * and left it. Wave 31 reproduced it by execution, diagnosed it, and fixed it.
 *
 * WHAT WAS WRONG. Every request here was identified by an `x-user-id` HEADER.
 * `resolvePersonaId` (server/lib/userContext.ts:484-486) honours that header
 * ONLY when `VITEST === "true"` AND `DISABLE_DEV_BYPASS !== "1"`. So:
 *
 *     vitest run <this file>                    -> 14/14 pass
 *     DISABLE_DEV_BYPASS=1 vitest run <same>    -> 2 fail, 12 pass
 *
 *   · case (1) got **401**, because the header conferred no identity at all;
 *   · case (4) — "buckets are PER IDENTITY" — got **429** for the colleague,
 *     because BOTH callers resolved to the same anonymous identity and shared
 *     one bucket.
 *
 * So the file's headline claim was UNTESTED. It did not prove buckets are per
 * identity; it proved they are per `x-user-id` header, and that header does not
 * exist in production. This is rule 3 — THE PROBE MUST MATCH THE CONTROL — and
 * the control here is the limiter's real key function, which reads the
 * authenticated identity, not a test affordance.
 *
 * THE FIX. Identity now comes from an HMAC-signed `cap_uid` SESSION COOKIE,
 * minted with the production signer (`signSessionValue`) and read by the
 * production extractor. That is the mechanism a real browser uses, and it works
 * in BOTH postures. Wave 19's `waiver2_ratelimit_key` harness established this
 * pattern for exactly this reason; this file now follows it.
 *
 * AND THE FILE ESTABLISHES ITS OWN PRECONDITION. Case (0) below asserts, by
 * execution, that the two personas resolve to DIFFERENT limiter bucket keys. It
 * does not read env vars, and it does not skip. The build has been burned by a
 * test that asserted `DISABLE_DEV_BYPASS=1` without SETTING it and reported
 * "7 skipped" in every normal run while guarding a live defect; a precondition
 * that can be quietly not-met is not a precondition. If the two identities ever
 * collapse into one again, case (0) FAILS LOUDLY and cases (1) and (4) are
 * known to be meaningless rather than silently green.
 *
 * NO `process.env` IS WRITTEN ANYWHERE IN THIS FILE, so there is nothing to
 * restore. The point is not to run under a forced posture — it is to be
 * INDIFFERENT to the posture, which is a stronger property and is what case (0)
 * measures.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import { registerRoutes } from "../routes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import {
  CollectiveBucketLimits,
  RATE_LIMIT_BYPASS_PATHS,
  _collectiveBucketSnapshot,
  _resetRateLimitsForTests,
} from "../lib/rateLimit";
import { signSessionValue, LEGACY_SESSION_COOKIE } from "../lib/sessionCookie";

/** Real seeded partner personas — NOT a shim that invents an identity the
 *  production stack does not have. That was the defect found in
 *  `rateLimit.test.ts`: it proved limits production never had. */
const MANAGING = "u_avi_managing";
const VIEWER = "u_avi_viewer";

/**
 * A production-shaped session cookie (W31-A2).
 *
 * `signSessionValue` is the SAME signer the login endpoint uses and the value is
 * verified by the same HMAC check, so this is not a bypass — it is the ordinary
 * authenticated path with the login round-trip skipped. Unlike the `x-user-id`
 * header it replaced, it carries identity under `DISABLE_DEV_BYPASS=1` and
 * under `NODE_ENV=production`.
 */
function cookieFor(userId: string): string {
  return `${LEGACY_SESSION_COOKIE}=${encodeURIComponent(signSessionValue(userId))}`;
}

/**
 * The production cookie parser (`server/index.ts:76`) runs BEFORE
 * `registerRoutes`, so `req.cookies` is populated by the time `loadUserContext`
 * and the limiter run. `extractUserIdFromCookie` reads only `req.cookies`, never
 * the raw header, so omitting this would return every request to anonymity —
 * the exact failure this item fixes, reintroduced one layer down.
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

let app: Express;
let server: http.Server;

/* ─── W31-A2 · the pinned indices are made HARNESS-INDEPENDENT ──────────────
 *
 * Case (13) pins each inert mount as `name@idx claims=N missed=M`, where `idx`
 * is the layer's ABSOLUTE position in the app's middleware stack. That absolute
 * number counts middleware this HARNESS installs before `registerRoutes`, not
 * just middleware `routes.ts` registers — so adding the `cookieShim` above
 * shifted every pinned index by exactly +1 (1031 → 1032, 684 → 685, 621 → 622)
 * while every `claims` and `missed` pair stayed IDENTICAL.
 *
 * That is the pin working: it fired on a change and refused to be ignored. But
 * the change it detected was in the test file, not in the router, and a pin that
 * cannot tell those apart will be re-based on reflex the next time — which is
 * how a pin dies. `claims`/`missed` are the findings; the absolute index is an
 * artifact of who set up the app.
 *
 * So `sweep()` now reports the index RELATIVE TO THE START OF `registerRoutes`,
 * re-based onto the constant below so the pinned strings stay byte-identical to
 * Wave 28's and Wave 30's and remain directly comparable with
 * `WAVE28_REPORT.md` §1.6. NOTHING IS RE-PINNED and no expected value is edited.
 * The pin keeps exactly its old sensitivity to a real mount moving in
 * `routes.ts`, and loses only its false sensitivity to test plumbing.
 */
const PIN_TIME_HARNESS_LAYERS = 1; // measured: `app.use(express.json())` alone
let harnessLayers = 0; // measured at runtime, immediately before registerRoutes

function stackOf(a: Express): Array<Record<string, unknown>> {
  return (
    ((a as unknown as { _router?: { stack: unknown[] } })._router ??
      (a as unknown as { router: { stack: unknown[] } }).router) as { stack: unknown[] }
  ).stack as Array<Record<string, unknown>>;
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  app.use(cookieShim()); // W31-A2 — mirrors server/index.ts:76
  // Measured, not assumed: how many layers exist BEFORE routes.ts contributes
  // anything. Everything case (13) pins is offset by this.
  harnessLayers = stackOf(app).length;
  server = http.createServer(app);
  await registerRoutes(server, app);
  seedTestPartnerSandbox({ force: true });
}, 180_000);

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  _resetRateLimitsForTests();
});

const WRITE = CollectiveBucketLimits.write;

function postDeal(user: string, i: number) {
  return request(app)
    .post("/api/partner/me/pipeline")
    /* W31-A2: was `.set("x-user-id", user)`, which `resolvePersonaId` ignores
       unless the dev bypass is active. A signed session cookie is the identity
       a real browser presents, and it is honoured in every posture. */
    .set("Cookie", cookieFor(user))
    .send({ dealName: `W28 item1 ${user} ${i}` });
}

/* ══════════════════════════════════════════════════════════════════════════
   POLE 1 — the limiter is REACHED on a real /api/partner route.
   ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 28 · ITEM 1 — /api/partner is genuinely rate limited on the real stack", () => {
  /* (0) W31-A2 — THE PRECONDITION, ESTABLISHED BY THIS FILE, BY EXECUTION.

     Cases (1) and (4) are only meaningful if the two personas are two distinct
     identities AS THE LIMITER SEES THEM. Under the old `x-user-id` mechanism
     they were not, in any production-shaped posture: both collapsed to
     anonymous and shared a bucket, so "buckets are per identity" was asserted
     against a single identity and passed for the wrong reason.

     This case reads the limiter's OWN bucket keys — its internal state, not a
     re-derivation of what we think the key ought to be — and asserts they
     differ. It does not consult `process.env`: a check on the env var would
     only restate the configuration, whereas this measures the consequence. And
     it does not skip. A precondition that can be quietly not-met is not a
     precondition; this build has already paid for one of those. */
  it("(0) PRECONDITION — the two personas are two DISTINCT identities to the limiter", async () => {
    _resetRateLimitsForTests();
    const a = await postDeal(MANAGING, 900);
    const keysAfterA = Object.keys(_collectiveBucketSnapshot()).filter((k) =>
      k.endsWith(":cb:write"),
    );
    const b = await postDeal(VIEWER, 901);
    const keysAfterB = Object.keys(_collectiveBucketSnapshot()).filter((k) =>
      k.endsWith(":cb:write"),
    );

    // Both callers must be AUTHENTICATED — a 401 here is the old defect.
    expect(a.status).not.toBe(401);
    expect(b.status).not.toBe(401);
    // The limiter ran for both.
    expect(a.headers["x-ratelimit-bucket"]).toBe("write");
    expect(b.headers["x-ratelimit-bucket"]).toBe("write");
    // And it filed them under DIFFERENT keys. If identity collapsed, the second
    // request would land in the first one's bucket and the count stays at 1.
    expect(keysAfterA).toHaveLength(1);
    expect(keysAfterB).toHaveLength(2);
    expect(keysAfterB[0]).not.toBe(keysAfterB[1]);
  }, 60_000);

  it("(1) a NORMAL partner request still passes, and carries the limiter's own headers — the limiter ran and allowed it", async () => {
    const r = await postDeal(MANAGING, 0);

    // LOWER POLE: the fix must not break the route. A 429 here, or a 500, would
    // mean the relocation broke a working surface.
    expect([200, 201]).toContain(r.status);
    expect(r.body?.deal?.id ?? r.body?.id).toBeTruthy(); // the write really happened

    // AND the limiter was entered. This is the assertion the pre-fix tree failed:
    // 70 consecutive requests produced ZERO of these headers.
    expect(r.headers["x-ratelimit-bucket"]).toBe("write");
    expect(r.headers["x-ratelimit-limit"]).toBe(String(WRITE));
    expect(Number(r.headers["x-ratelimit-remaining"])).toBe(WRITE - 1);
  }, 60_000);

  it("(2) a burst PAST the budget is refused with 429 — and the last request INSIDE the budget is not", async () => {
    expect(WRITE).toBeGreaterThan(1); // a budget of 0 or 1 would make both poles trivial

    let lastInside: request.Response | null = null;
    for (let i = 0; i < WRITE; i++) {
      lastInside = await postDeal(MANAGING, i);
      // LOWER POLE, on EVERY request inside the budget, not just the first.
      expect(lastInside.status).not.toBe(429);
    }
    expect(lastInside!.headers["x-ratelimit-remaining"]).toBe("0");

    // UPPER POLE: exactly one past the budget.
    const over = await postDeal(MANAGING, WRITE);
    expect(over.status).toBe(429);
    expect(over.body.error).toBe("rate_limited");
    expect(over.body.bucket).toBe("write");
    // The client banner shipped by Wave 18/27 renders this field. A 429 without
    // it would make that banner a renderer for a response the server cannot produce.
    expect(typeof over.body.retryAfterMs).toBe("number");
    expect(over.body.retryAfterMs).toBeGreaterThan(0);
  }, 180_000);

  it("(3) CONTROL — an /api prefix with no limiter is NOT refused under the identical burst, so (2) measures the mount and not the harness", async () => {
    let refused = 0;
    let sawLimiterHeader = false;
    for (let i = 0; i <= WRITE + 4; i++) {
      const r = await request(app).get("/api/pricing-public").set("x-user-id", MANAGING);
      if (r.status === 429) refused++;
      if (r.headers["x-ratelimit-bucket"]) sawLimiterHeader = true;
    }
    expect(refused).toBe(0);
    expect(sawLimiterHeader).toBe(false); // no limiter on this prefix — both poles of the header signal
  }, 180_000);

  it("(4) buckets are PER IDENTITY — one partner user exhausting the budget does not mute a colleague", async () => {
    for (let i = 0; i < WRITE; i++) await postDeal(MANAGING, i);
    expect((await postDeal(MANAGING, WRITE)).status).toBe(429); // positive control first

    const other = await postDeal(VIEWER, 0);
    expect(other.status).not.toBe(429);
    // and the limiter DID run for the colleague — it simply allowed them.
    expect(other.headers["x-ratelimit-bucket"]).toBe("write");
  }, 180_000);

  it("(5) the refused request left DURABLE state, not a process-local bucket (migration 0173 is reused, not reintroduced)", async () => {
    for (let i = 0; i < WRITE; i++) await postDeal(MANAGING, i);

    const snap = _collectiveBucketSnapshot();
    const writeKeys = Object.keys(snap).filter((k) => k.endsWith(":cb:write"));
    expect(writeKeys.length).toBeGreaterThan(0);
    // The count came back out of `rate_limit_hit`, i.e. off disk, not out of a Map.
    expect(Math.max(...writeKeys.map((k) => snap[k]))).toBe(WRITE);

    // NEGATIVE POLE: after the durable reset there is nothing left to read, so
    // the snapshot above was reading real rows and not a constant.
    _resetRateLimitsForTests();
    const after = _collectiveBucketSnapshot();
    expect(Object.keys(after).filter((k) => k.endsWith(":cb:write")).length).toBe(0);
  }, 180_000);

  it("(6) reads and writes use SEPARATE buckets — an exhausted write budget does not lock the partner out of their own dashboard", async () => {
    for (let i = 0; i < WRITE; i++) await postDeal(MANAGING, i);
    expect((await postDeal(MANAGING, WRITE)).status).toBe(429);

    const read = await request(app).get("/api/partner/me/dashboard").set("x-user-id", MANAGING);
    expect(read.status).not.toBe(429);
    expect(read.headers["x-ratelimit-bucket"]).toBe("read");
    expect(read.headers["x-ratelimit-limit"]).toBe(String(CollectiveBucketLimits.read));
  }, 180_000);
});

/* ══════════════════════════════════════════════════════════════════════════
   POLE 2 — nothing was WEAKENED and nothing was over-reached.
   ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 28 · ITEM 1 — no limit moved, and nothing was newly limited that must not be", () => {
  it("(7) every bucket limit is verbatim what it was before the relocation", () => {
    // Asserted as a whole object, so an ADDED bucket fails too, not only a changed one.
    expect(CollectiveBucketLimits).toEqual({ write: 60, read: 600, sse: 30 });
  });

  it("(8) the health bypass is intact — a liveness probe must never 429 or load balancers pull pods under burst", async () => {
    expect(Array.from(RATE_LIMIT_BYPASS_PATHS.values()).sort()).toEqual([
      "/api/health",
      "/api/healthz",
    ]);
    for (let i = 0; i <= WRITE + 4; i++) {
      const r = await request(app).get("/api/health");
      expect(r.status).not.toBe(429);
    }
  }, 180_000);

  it("(9) OVER-REACH GUARD — the comms typing indicator and read receipt are still NOT bucket-limited (Wave 27 §2.3 excluded them deliberately)", async () => {
    // POSITIVE CONTROL FIRST: the comms SEND path IS limited (Wave 27's five
    // call-only mounts). If this pole did not hold, the negative pole below
    // would be vacuous — it would pass on a tree with no comms limiter at all.
    const send = await request(app)
      .post("/api/comms/channels/c_nonexistent_w28/messages")
      .set("x-user-id", MANAGING)
      .send({ body: "w28 probe" });
    expect(send.headers["x-ratelimit-bucket"]).toBe("write");

    // NEGATIVE POLE: a 500 ms-debounced typing ping is ~120/min against a
    // 60/min write budget. Limiting it would break the indicator for a fast
    // typist. This wave must not have swept it in.
    for (const path of [
      "/api/comms/channels/c_nonexistent_w28/typing",
      "/api/comms/channels/c_nonexistent_w28/read",
    ]) {
      const r = await request(app).post(path).set("x-user-id", MANAGING).send({});
      expect(r.headers["x-ratelimit-bucket"]).toBeUndefined();
      expect(r.status).not.toBe(429);
    }
  }, 60_000);

  it("(10) the limiter is mounted ONCE per prefix — a duplicate mount would silently HALVE the effective budget", async () => {
    // The obvious wrong fix is to ADD a mount at the top and leave the old one
    // at :1046. Every route registered below the old mount would then tick the
    // bucket twice per request. Measured, not read: spend the budget one
    // request at a time on a route that WAS below the old mount, and require
    // the boundary to land at exactly WRITE, not WRITE/2.
    let refusedAt = -1;
    for (let i = 0; i <= WRITE + 1; i++) {
      const r = await request(app)
        .post("/api/partner/me/classifications")
        .set("x-user-id", MANAGING)
        .send({ sectorId: "w28-probe" });
      if (r.status === 429) {
        refusedAt = i;
        break;
      }
    }
    expect(refusedAt).toBe(WRITE); // not WRITE/2 — exactly one tick per request
  }, 180_000);
});

/* ══════════════════════════════════════════════════════════════════════════
   POLE 3 — the GENERIC sweep. This is the part that stops the defect class
   coming back somewhere else, and the part that records the instances this
   wave did NOT fix so they cannot rot in either direction.
   ══════════════════════════════════════════════════════════════════════════ */

/** Replace every `:param` with a literal so the middleware's matcher sees a
 *  concrete URL rather than a pattern. */
function concrete(p: string): string {
  return p.replace(/:([A-Za-z0-9_]+)(\(.*?\))?/g, "x");
}

function layerMatches(layer: unknown, path: string): boolean {
  const ms = (layer as { matchers?: Array<(s: string) => unknown> }).matchers;
  if (!Array.isArray(ms)) return false;
  return ms.some((m) => {
    try {
      return m(path) !== false;
    } catch {
      return false;
    }
  });
}

import {
  WAVE38_INERT_PREFIX_MOUNTS,
  WAVE38_RATE_LIMIT_ESCAPEES,
  WAVE38_RATE_LIMITED_PREFIXES,
} from "./_fixtures/wave38_inert_prefix_mounts";

interface Finding {
  mw: string;
  idx: number;
  claims: number;
  missed: number;
  /**
   * WAVE 38 ROW 3 — a STABLE identity for this mount.
   *
   * `idx` is an absolute router-stack position. Every wave that registers a
   * route ahead of a mount shifts it, which is why this file has been re-pinned
   * in Waves 29, 30 and again now: the pin was tracking the router's ARITHMETIC,
   * not its BEHAVIOUR. `ordinal` is the mount's position among the mounts with
   * the SAME NAME, which changes only when a mount is genuinely added, removed
   * or reordered. `idx` is still reported, for diagnosis; it is no longer part
   * of any assertion.
   */
  ordinal: number;
  /** Concrete paths this mount governs, sorted. */
  coveredPaths: string[];
  /**
   * Concrete paths this mount CLAIMS but was registered BELOW, sorted. This is
   * the defect set itself, and pinning it by PATH rather than by count closes a
   * real hole in the old assertion: a count is unchanged when one route leaves
   * the missed set and another joins it, so the old pin could not see a route
   * newly escaping a security gate as long as the arithmetic balanced.
   */
  missedPaths: string[];
}

function sweep(): Finding[] {
  const stack = stackOf(app);
  /* Re-base absolute stack positions onto the pin's frame of reference. See the
     PIN_TIME_HARNESS_LAYERS note above: this subtracts the harness's own
     contribution so the reported index reflects `routes.ts` and nothing else. */
  const rebase = (i: number) => i - harnessLayers + PIN_TIME_HARNESS_LAYERS;

  const mws: Array<{ idx: number; name: string; layer: Record<string, unknown> }> = [];
  const routes: Array<{ idx: number; path: string; sig: string }> = [];
  stack.forEach((l, rawIdx) => {
    const idx = rebase(rawIdx);
    const route = l.route as { path: string; methods?: Record<string, boolean> } | undefined;
    // WAVE 38 ROW 3 — the pinned identity is METHOD-QUALIFIED. `GET /x` and
    // `POST /x` are two separate router layers that can sit on opposite sides
    // of a mount; a path-only pin silently collapses them, and the write is
    // usually the one that matters.
    if (route) routes.push({ idx, path: route.path, sig: `${methodsOf(route)} ${route.path}` });
    else mws.push({ idx, name: String(l.name), layer: l });
  });

  const out: Finding[] = [];
  const seenByName = new Map<string, number>();
  for (const m of mws) {
    if (layerMatches(m.layer, "/")) continue; // app-wide, no path prefix
    const covered = routes.filter((r) => layerMatches(m.layer, concrete(r.path)));
    const missedRoutes = covered.filter((r) => r.idx < m.idx);
    const ordinal = (seenByName.get(m.name) ?? 0) + 1;
    seenByName.set(m.name, ordinal);
    out.push({
      mw: m.name,
      idx: m.idx,
      ordinal,
      claims: covered.length,
      missed: missedRoutes.length,
      coveredPaths: covered.map((r) => r.sig).sort(),
      missedPaths: missedRoutes.map((r) => r.sig).sort(),
    });
  }
  return out;
}

/** WAVE 38 ROW 3 — stable key for a mount: name + ordinal among same-named mounts. */
function keyOf(f: Finding): string {
  return `${f.mw}#${f.ordinal}`;
}

/** `GET,POST` style method list for a route layer, uppercased and sorted. */
function methodsOf(route: { methods?: Record<string, boolean> }): string {
  const m = route.methods ?? {};
  const names = Object.keys(m)
    .filter((k) => m[k])
    .map((k) => k.toUpperCase())
    .sort();
  return names.length > 0 ? names.join(",") : "?";
}

/** Every method-qualified route signature registered on the app, sorted. */
function allRouteSignatures(): string[] {
  return stackOf(app)
    .map((l) => l.route as { path: string; methods?: Record<string, boolean> } | undefined)
    .filter((r): r is { path: string; methods?: Record<string, boolean> } => Boolean(r?.path))
    .map((r) => `${methodsOf(r)} ${r.path}`)
    .sort();
}

/** The path half of a `METHOD /path` signature. */
function pathOf(sig: string): string {
  return sig.slice(sig.indexOf(" ") + 1);
}

describe("WAVE 28 · ITEM 1 — generic prefix-middleware ordering sweep over the whole router", () => {
  it("(11) the sweep's route-finder can FAIL — control, so a green sweep is not green because it found nothing", () => {
    const findings = sweep();
    expect(findings.length).toBeGreaterThan(5);
    // Every finding must have found real routes for at least some mounts; a
    // matcher walk that silently returned [] for everything would report zero
    // missed routes and look perfect.
    expect(findings.some((f) => f.claims > 100)).toBe(true);

    // And an intentionally vacuous matcher must be reported as covering nothing,
    // proving `layerMatches` is actually consulted rather than defaulting true.
    const vacuous = { matchers: [() => false] };
    expect(layerMatches(vacuous, "/api/partner/me/pipeline")).toBe(false);
    const always = { matchers: [(s: string) => ({ path: s, params: {} })] };
    expect(layerMatches(always, "/api/partner/me/pipeline")).toBe(true);
  }, 60_000);

  it("(12) NO `collectiveRateLimit` mount claims a single route registered above it — the ITEM 1 fix, asserted generically", () => {
    const limiters = sweep().filter((f) => f.mw === "collectiveRateLimit");
    // Three mounts: /api/collective, /api/partner, /api/messages.
    expect(limiters.length).toBe(3);
    // LOWER POLE: they must still claim real routes. A relocation onto a typo'd
    // prefix would report `missed: 0` for the happiest possible reason.
    for (const f of limiters) expect(f.claims, `${keyOf(f)} governs nothing`).toBeGreaterThan(0);
    // And each of the three prefixes must be represented, so three live mounts
    // on ONE prefix cannot masquerade as full coverage.
    const prefixesGoverned = WAVE38_RATE_LIMITED_PREFIXES.filter((pre) =>
      limiters.some((f) =>
        f.coveredPaths.some((sig) => pathOf(sig) === pre || pathOf(sig).startsWith(`${pre}/`)),
      ),
    );
    expect([...prefixesGoverned].sort()).toEqual([...WAVE38_RATE_LIMITED_PREFIXES].sort());
    // UPPER POLE: none of those claims is a lie.
    for (const f of limiters) expect(f.missedPaths, `${keyOf(f)} claims routes above it`).toEqual([]);
  }, 60_000);

  it("(12b) NO route under a rate-limited prefix escapes every `collectiveRateLimit` mount", () => {
    /* WAVE 38 ROW 3 — this replaces the old `claims=[13, 115, 220]` pin, and it
     * is the assertion that pin was reaching for.
     *
     * A raw claim count is a measure of how many routes exist under a prefix,
     * not of whether they are governed. It went red in Wave 29 and again in
     * Wave 30 for the entirely legitimate reason that new partner routes were
     * added BELOW the limiter — i.e. it cried wolf at the limiter WORKING — and
     * each time it was simply re-pinned. Meanwhile it could not see the case
     * that matters at all: a route registered under `/api/partner` that no
     * limiter governs would leave the count perfectly plausible.
     *
     * So: enumerate every registered route under the three rate-limited
     * prefixes, subtract everything the limiters govern, and require the
     * remainder to be exactly the pinned (empty) set. New routes below a
     * limiter no longer churn this; a new route that ESCAPES one fails it by
     * name. */
    const limiters = sweep().filter((f) => f.mw === "collectiveRateLimit");
    const governed = new Set(limiters.flatMap((f) => f.coveredPaths));
    const all = allRouteSignatures();
    // Anti-vacuity: if the route walk returned nothing, the escapee set would
    // be empty for the worst possible reason.
    expect(all.length).toBeGreaterThan(500);
    const underPrefix = all.filter((sig) =>
      WAVE38_RATE_LIMITED_PREFIXES.some((pre) => pathOf(sig) === pre || pathOf(sig).startsWith(`${pre}/`)),
    );
    expect(underPrefix.length).toBeGreaterThan(100);
    const escapees = [...new Set(underPrefix.filter((sig) => !governed.has(sig)))].sort();
    expect(escapees, "a route under a rate-limited prefix is not governed by any limiter").toEqual([
      ...WAVE38_RATE_LIMIT_ESCAPEES,
    ]);
  }, 60_000);

  it("(13) the OTHER inert prefix mounts found by this sweep are pinned EXACTLY, BY PATH — they are reported in WAVE28_REPORT.md §1.6, not silently fixed and not silently forgotten", () => {
    /* WAVE 38 ROW 3 — the pin moved from `name@stackIndex claims=N missed=M`
     * strings to `name#ordinal -> exact sorted list of missed PATHS`, held in
     * `_fixtures/wave38_inert_prefix_mounts.ts`. The reasoning is written out in
     * full at the top of that file. In short: the stack index made this pin go
     * red every wave for arithmetic reasons and it was re-based three times,
     * and the missed COUNT could not see one route leaving the missed set while
     * another joined it. Paths cannot be balanced against each other. */
    const findings = sweep().filter((f) => f.missed > 0);

    // Anti-vacuity: a sweep that found nothing must not read as "all clear".
    expect(findings.length).toBeGreaterThan(0);

    const actual: Record<string, string[]> = {};
    for (const f of findings) actual[keyOf(f)] = f.missedPaths;

    // The SET of inert mounts, by stable identity. A new one fails here.
    expect(Object.keys(actual).sort()).toEqual(Object.keys(WAVE38_INERT_PREFIX_MOUNTS).sort());

    // And the exact routes each one misses. A route newly escaping any of these
    // gates fails here, by name, even if the total is unchanged.
    for (const key of Object.keys(WAVE38_INERT_PREFIX_MOUNTS).sort()) {
      expect(actual[key], `missed-route set changed for ${key}`).toEqual([
        ...WAVE38_INERT_PREFIX_MOUNTS[key],
      ]);
    }

    // Self-check on the pin itself: an entry with no missed paths would be a
    // mount that is not inert at all and does not belong in this file.
    for (const [key, paths] of Object.entries(WAVE38_INERT_PREFIX_MOUNTS)) {
      expect(paths.length, `${key} is pinned as inert but misses nothing`).toBeGreaterThan(0);
      expect([...paths], `${key} pin is not in sorted order`).toEqual([...paths].sort());
    }
  }, 60_000);

  it("(14) `/api/partner-taxonomy` is NOT swept into the `/api/partner` bucket — a prefix mount must respect the path boundary", async () => {
    // If `app.use("/api/partner")` matched by string prefix rather than by path
    // segment, moving it to the top of the stack would have newly rate-limited
    // an unrelated route family. Both poles: the sibling prefix is untouched,
    // the real prefix is not.
    const sibling = await request(app).get("/api/partner-taxonomy").set("x-user-id", MANAGING);
    expect(sibling.headers["x-ratelimit-bucket"]).toBeUndefined();

    const real = await request(app).get("/api/partner/me/dashboard").set("x-user-id", MANAGING);
    expect(real.headers["x-ratelimit-bucket"]).toBe("read");
  }, 60_000);
});
