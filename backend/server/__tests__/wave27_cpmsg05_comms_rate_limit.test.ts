/**
 * WAVE 27 · CP-MSG-05 — MSG-05 "Rate limiting" on the surface that actually
 * carries partner messages.
 *
 * ── WHY THIS FILE EXISTS AND WAVE 18's DID NOT COVER IT ────────────────────
 * `server/__tests__/wave18_cpmsg05_rate_limit_identity.test.ts` concluded MSG-05
 * was "WIRING, not BUILD-NEW" because `app.use("/api/messages",
 * collectiveRateLimit)` exists at `server/routes.ts:1047`. That is a true
 * statement about a prefix the partner messaging surface never calls. The
 * partner page calls `/api/comms/*`
 * (`client/src/pages/partner/PartnerMessages.tsx:53,61`), and so does the shared
 * composer (`client/src/components/comms/MessagesPage.tsx:301`). `/api/comms`
 * had no prefix limiter at all.
 *
 * The Wave 18 file is a well-built test of the wrong prefix — a check that
 * passed while checking nothing about the surface its own row named.
 *
 * ── THE ORDERING TRAP, ASSERTED RATHER THAN ASSUMED ────────────────────────
 * The obvious "fix" is one line: `app.use("/api/comms", collectiveRateLimit)`
 * next to the existing three. It would be INERT. `registerCommsRoutes(app)` runs
 * at `server/routes.ts:672`; the limiter block is at `:1045-1047`, and Express
 * dispatches in registration order. POLE A below proves that executably, so the
 * next wave cannot "simplify" the call-only mounts into a prefix mount and ship
 * a limiter that never fires.
 *
 * The same proof establishes a SECOND, larger finding, asserted at the bottom of
 * this file: `app.use("/api/partner", collectiveRateLimit)` at `:1046` is itself
 * inert, because every `/api/partner` route registers at `:978-1022`. That is
 * reported, not silently fixed — see `build_log/WAVE27_REPORT.md` §2.
 *
 * ── BOTH POLES ─────────────────────────────────────────────────────────────
 * A limiter that never 429s and a limiter that 429s the first request both
 * survive a one-sided test. Every case below pins the boundary from both sides:
 * request N at the limit succeeds, request N+1 is refused, and an unmounted
 * control on the identical handler is NOT refused.
 */
import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import {
  collectiveRateLimit,
  CollectiveBucketLimits,
  _resetRateLimitsForTests,
} from "../lib/rateLimit";
import { registerCommsRoutes } from "../commsStore";

const ROUTES_SRC = path.resolve(__dirname, "../routes.ts");

/** Minimal stand-in for a comms write handler: it persists, so a flood is a
 *  durable-write flood, which is the property MSG-05 is about. */
function makeHandler(sink: string[]) {
  return (req: express.Request, res: express.Response) => {
    sink.push(String(req.body?.body ?? ""));
    res.json({ ok: true, stored: sink.length });
  };
}

/** Production-shaped identity: the limiter keys per user via `req.userContext`.
 *  We do NOT install an auth shim that invents a key the real stack lacks —
 *  that is the defect `rateLimit.test.ts` was found to have. We set the header
 *  the shared resolver already reads in this repo's test posture and assert
 *  below that two DIFFERENT identities get INDEPENDENT buckets, which is the
 *  observable property that matters and cannot be faked by a shim. */
function withIdentity(userId: string) {
  return (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { userContext?: { userId: string } }).userContext = { userId };
    next();
  };
}

describe("WAVE 27 · CP-MSG-05 — /api/comms message writes are rate limited", () => {
  beforeEach(() => {
    _resetRateLimitsForTests();
  });

  /* ────────────────────────────────────────────────────────────────────────
     POLE A — the ordering trap. This is the falsification harness for the
     "just add a prefix app.use" alternative.
     ──────────────────────────────────────────────────────────────────────── */
  it("(A) a prefix app.use registered AFTER the route is INERT — the one-line fix would not have worked", async () => {
    let limiterRan = 0;
    const app = express();
    app.use(express.json());
    // Mirrors production: routes at routes.ts:672, limiter block at :1045.
    app.post("/api/comms/x", (_q, s) => s.json({ ok: true }));
    app.use("/api/comms", (_q, _s, n) => { limiterRan++; n(); });

    await request(app).post("/api/comms/x").send({}).expect(200);
    expect(limiterRan).toBe(0); // the trap, proved
  });

  it("(A') the SAME middleware registered BEFORE the route does run — so (A) is an ordering fact, not a broken middleware", async () => {
    let limiterRan = 0;
    const app = express();
    app.use(express.json());
    app.use("/api/comms", (_q, _s, n) => { limiterRan++; n(); });
    app.post("/api/comms/x", (_q, s) => s.json({ ok: true }));

    await request(app).post("/api/comms/x").send({}).expect(200);
    expect(limiterRan).toBe(1);
  });

  /* ────────────────────────────────────────────────────────────────────────
     POLE B — the limiter actually refuses, at the documented boundary.
     ──────────────────────────────────────────────────────────────────────── */
  it("(B) send is refused with 429 only AFTER the write budget is spent — both sides of the boundary", async () => {
    const sink: string[] = [];
    const app = express();
    app.use(express.json());
    app.use(withIdentity("u_msg05_boundary"));
    app.post("/api/comms/channels/:id/messages", collectiveRateLimit, makeHandler(sink));

    const limit = CollectiveBucketLimits.write;
    expect(limit).toBeGreaterThan(1); // guard: a limit of 0/1 would make both poles trivially true

    for (let i = 0; i < limit; i++) {
      const r = await request(app).post("/api/comms/channels/c1/messages").send({ body: `m${i}` });
      expect(r.status).toBe(200); // LOWER pole: everything inside the budget goes through
    }
    expect(sink.length).toBe(limit); // and every one of them actually persisted

    const over = await request(app).post("/api/comms/channels/c1/messages").send({ body: "flood" });
    expect(over.status).toBe(429); // UPPER pole
    expect(over.body.error).toBe("rate_limited");
    expect(over.body.bucket).toBe("write");
    expect(sink.length).toBe(limit); // THE POINT: the refused write did NOT reach the sink
  });

  it("(B') the identical handler WITHOUT the mount is never refused — the control that proves (B) measures the mount, not the harness", async () => {
    const sink: string[] = [];
    const app = express();
    app.use(express.json());
    app.use(withIdentity("u_msg05_control"));
    app.post("/api/comms/channels/:id/messages", makeHandler(sink)); // no collectiveRateLimit

    const n = CollectiveBucketLimits.write + 5;
    for (let i = 0; i < n; i++) {
      const r = await request(app).post("/api/comms/channels/c1/messages").send({ body: `m${i}` });
      expect(r.status).toBe(200);
    }
    expect(sink.length).toBe(n); // this is the pre-wave behaviour, reproduced on demand
  });

  it("(C) the 429 body carries the retryAfterMs the client renders — the banner cannot be fed a fabricated number", async () => {
    const app = express();
    app.use(express.json());
    app.use(withIdentity("u_msg05_retry"));
    app.post("/api/comms/dm/start", collectiveRateLimit, (_q, s) => s.json({ ok: true }));

    for (let i = 0; i < CollectiveBucketLimits.write; i++) {
      await request(app).post("/api/comms/dm/start").send({ targetUserId: "t" });
    }
    const over = await request(app).post("/api/comms/dm/start").send({ targetUserId: "t" });
    expect(over.status).toBe(429);
    expect(typeof over.body.retryAfterMs).toBe("number");
    expect(over.body.retryAfterMs).toBeGreaterThan(0);
    /* The client falls back to a countdown-free refusal when this is absent
       (`MessagesPage.tsx` / `PartnerMessages.tsx`). Both branches are real. */
  });

  it("(D) buckets are per identity — one abuser cannot mute an unrelated partner", async () => {
    const app = express();
    app.use(express.json());
    app.post(
      "/api/comms/channels/:id/messages",
      (req, _res, next) => {
        (req as unknown as { userContext?: { userId: string } }).userContext = {
          userId: String(req.headers["x-test-identity"] ?? "anon"),
        };
        next();
      },
      collectiveRateLimit,
      (_q, s) => s.json({ ok: true }),
    );

    for (let i = 0; i < CollectiveBucketLimits.write; i++) {
      await request(app)
        .post("/api/comms/channels/c1/messages")
        .set("x-test-identity", "u_abuser")
        .send({ body: "x" });
    }
    await request(app)
      .post("/api/comms/channels/c1/messages")
      .set("x-test-identity", "u_abuser")
      .send({ body: "x" })
      .expect(429);

    // The victim pole: a different identity is unaffected.
    await request(app)
      .post("/api/comms/channels/c1/messages")
      .set("x-test-identity", "u_bystander")
      .send({ body: "x" })
      .expect(200);
  });

  /* ────────────────────────────────────────────────────────────────────────
     REAL-WIRING FENCES.

     A first draft of this file asserted the mounts by grepping `commsStore.ts`
     for the literal `app.post("...", collectiveRateLimit,`. That is a fixture,
     not the system: it passes if the text is present even when the wiring is
     broken, and fails on a harmless reformat. Cases (E)/(E') below instead call
     the REAL `registerCommsRoutes` and read back Express's own router stack, so
     they assert what the running server actually dispatches.
     ──────────────────────────────────────────────────────────────────────── */

  /** Handler-function names Express recorded for a given method+path, taken
   *  from the live router stack of a genuinely-registered comms app. */
  function handlerChain(method: "post" | "patch", routePath: string): string[] {
    const app = express();
    registerCommsRoutes(app as unknown as Parameters<typeof registerCommsRoutes>[0]);
    // Express 5 exposes `app.router`; Express 4 used `app._router`.
    const stack =
      ((app as unknown as { router?: { stack: unknown[] }; _router?: { stack: unknown[] } }).router ??
        (app as unknown as { _router: { stack: unknown[] } })._router).stack as Array<{
        route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: { name: string } }> };
      }>;
    const layer = stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
    if (!layer || !layer.route) {
      throw new Error(`route not registered at all: ${method.toUpperCase()} ${routePath}`);
    }
    return layer.route.stack.map((s) => s.handle.name);
  }

  const LIMITED: Array<["post" | "patch", string]> = [
    ["post", "/api/comms/channels/:id/messages"],
    ["patch", "/api/comms/messages/:id"],
    ["post", "/api/comms/messages/:id/reactions"],
    ["post", "/api/comms/posts"],
    ["post", "/api/comms/dm/start"],
  ];

  it("(E) the REAL router stack carries collectiveRateLimit on every comms write path this wave limited", () => {
    for (const [method, routePath] of LIMITED) {
      expect(
        handlerChain(method, routePath),
        `${method.toUpperCase()} ${routePath} dispatches without the limiter`,
      ).toContain("collectiveRateLimit");
    }
  });

  it("(E') the deliberate exclusions are still excluded in the REAL router stack — typing and read-receipts must NOT be write-bucketed", () => {
    /* Typing is debounced to 500ms client-side => up to 120/min of sustained
       typing against a 60/min write bucket. Limiting it breaks the indicator
       for a fast typist. If a future wave adds the limiter here, this test
       fails and forces the trade-off to be re-argued rather than absorbed.
       Note this case also fails if the route disappears entirely, because
       `handlerChain` throws rather than returning an empty chain — an absent
       route must not read as "correctly unlimited". */
    expect(handlerChain("post", "/api/comms/channels/:id/typing")).not.toContain("collectiveRateLimit");
    expect(handlerChain("post", "/api/comms/channels/:id/read")).not.toContain("collectiveRateLimit");
  });

  it("(E'') the fence can distinguish limited from unlimited at all — control against a vacuous matcher", () => {
    /* If `handlerChain` silently returned [] or every chain contained the
       limiter, (E) and (E') would both pass while proving nothing. Pin the
       contrast explicitly. */
    const limited = handlerChain("post", "/api/comms/dm/start");
    const unlimited = handlerChain("post", "/api/comms/channels/:id/typing");
    expect(limited.length).toBeGreaterThan(0);
    expect(unlimited.length).toBeGreaterThan(0);
    expect(limited).toContain("collectiveRateLimit");
    expect(unlimited).not.toContain("collectiveRateLimit");
    expect(() => handlerChain("post", "/api/comms/this/route/does/not/exist")).toThrow(
      /route not registered at all/,
    );
  });

  /* ────────────────────────────────────────────────────────────────────────
     (F) — RESOLVED BY WAVE 28. The pin below used to assert the OPPOSITE.

     Wave 27 discovered, while proving the ordering trap for /api/comms, that
     `app.use("/api/partner", collectiveRateLimit)` at `server/routes.ts:1046`
     was itself inert: all eleven partner registrars ran at `:978-1022`. Wave 27
     reported it rather than fixing it, because relocating the mount would newly
     rate-limit ~200 routes in a wave scoped to messaging, and left this pin so
     the finding could not rot in EITHER direction — it was written to fail the
     moment someone "tidied" the ordering without updating the report.

     WAVE 28 ITEM 1 fixed it and updated both sides together, exactly as this
     pin demanded. The three limiter mounts now sit at `~:604-606`, immediately
     after the `/api/admin` guard and before every registrar. See
     `build_log/WAVE28_REPORT.md` §1 and, far more importantly,
     `server/__tests__/wave28_item1_prefix_middleware_ordering.test.ts`, which
     replaces this line-number comparison with real requests against the real
     `registerRoutes` stack plus a generic router-stack sweep.

     This assertion is INVERTED rather than deleted: a line-number check is a
     weak instrument, but a silently removed pin is worse, and the Wave 28 file
     would not catch a partial revert that left the mount in place while moving
     a single registrar above it.
     ──────────────────────────────────────────────────────────────────────── */
  it("(F) the /api/partner prefix limiter is registered BEFORE its routes — the Wave 27 inert-limiter finding, now FIXED by Wave 28 and pinned in the resolved direction", () => {
    const src = fs.readFileSync(ROUTES_SRC, "utf8");
    const lines = src.split("\n");
    const lineOf = (needle: string) => lines.findIndex((l) => l.includes(needle)) + 1;

    const limiterLine = lineOf('app.use("/api/partner", collectiveRateLimit)');
    expect(limiterLine).toBeGreaterThan(0);

    /* Mounted exactly once. Two mounts would tick the bucket twice per request
       for every route below the second one, silently halving its budget. */
    expect(
      lines.filter((l) => l.includes('app.use("/api/partner", collectiveRateLimit)')).length,
    ).toBe(1);

    /* EVERY partner registrar Wave 27 enumerated, not just the first one — a
       check against `registerPartnerConsortiumRoutes` alone would pass while
       ten other registrars sat above the limiter. */
    for (const registrar of [
      "registerPartnerConsortiumRoutes(app)",
      "registerPartnerSelfServiceRoutes(app)",
      "registerWave14MoneyRoutes(app)",
      "registerPartnerRoutes(app)",
      "registerPartnerTasksFilesRoutes(app)",
      "registerAdminPartnerLifecycleRoutes(app)",
      "registerPartnerClientCrmRoutes(app)",
      "registerMfcrmRoutes(app)",
      "registerMfcrmPersonaRoutes(app)",
      "registerSpvEngineRoutes(app)",
      "registerPartnerPortfolioCompanyRoutes(app)",
    ]) {
      const at = lineOf(registrar);
      expect(at, `${registrar} not found in routes.ts`).toBeGreaterThan(0);
      expect(
        limiterLine,
        `The /api/partner limiter is registered BELOW ${registrar}, so it is inert for that registrar's routes. ` +
          `See WAVE28_REPORT.md §1 — do not move it back down.`,
      ).toBeLessThan(at);
    }

    /* And it must still be BELOW loadUserContext, or the per-user keying that
       WAIVER-2 depends on degrades to an IP key for authenticated callers. */
    expect(lineOf("app.use(loadUserContext)")).toBeLessThan(limiterLine);

    /* /api/messages and /api/collective were already ordered correctly for
       their own first registrar; they moved with the block and still are. */
    expect(lineOf('app.use("/api/messages", collectiveRateLimit)')).toBeLessThan(
      lineOf("registerMessagingRoutes(app)"),
    );
    expect(lineOf('app.use("/api/collective", collectiveRateLimit)')).toBeLessThan(
      lineOf("registerCollectiveRoutes(app)"),
    );
  });
});
