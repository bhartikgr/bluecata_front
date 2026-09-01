/**
 * ════════════════════════════════════════════════════════════════════════════
 * WAVE 242 — `/api/healthz` STOPS ASSERTING `ok: true` AND STOPS REPORTING A
 * FABRICATED ZERO, WITHOUT FAILING A NORMAL LIVE INSTALL.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * THE DEFECT. In `server/routes.ts` the handler computed real signals and then
 * shipped `ok: true` as a LITERAL — eight lines below its own comment:
 *
 *     "The bridge was pointed at a host that does not resolve for months and
 *      this endpoint reported `ok: true` the whole time, so the
 *      misconfiguration was only visible on an admin page nobody opened."
 *
 * The endpoint stated the defect and then committed it. On the same object,
 * `emailOutboxBacklog: 0` was also a literal — a fabricated zero claiming
 * nothing was waiting to be sent, on an endpoint whose subject is a fabricated
 * truth value, while `server/emailStore.ts` keeps a real queue of
 * `status: "queued"` rows and exports `countOutboxByStatus()`.
 *
 * ── THE CONSTRAINT THAT SHAPES EVERY TEST BELOW ─────────────────────────────
 * This endpoint is how the developer confirms an install, and on live
 * `bridgeEnvOk: false` with a bridge backlog in the hundreds is the STEADY
 * STATE. So `ok` must NOT fold those in: doing so would report a healthy install
 * as a failure. §2 is therefore the load-bearing test — it proves `ok` stays
 * `true` and the status stays 200 **while** `degraded` is non-empty. A wave that
 * made this endpoint "honest" by failing it would have been a worse defect than
 * the one it fixed.
 *
 * ── WHY §3 INJECTS A DATABASE FAULT ─────────────────────────────────────────
 * `ok` is now `dbOk`, and in a test environment `getDb()` succeeds — so
 * `ok === true` and a test asserting it would pass IDENTICALLY against the old
 * `ok: true` literal. That is inert-proof mechanism 8, an unconditionally-true
 * predicate, and a disarm restoring the literal would have come back GREEN. §3
 * exists to give `ok` a case where the two implementations disagree: `getDb()`
 * is made to throw AFTER route registration, and `ok` must become `false` while
 * the HTTP status stays 200.
 *
 * Everything is driven over real HTTP against the production registrar.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { readFileSync } from "node:fs";

/** Fault-injection switch. OFF during `registerRoutes` so registration is
 *  completely unaffected; flipped on only inside §3, and off again after. */
const dbFault = { on: false };
vi.mock("../db/connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/connection")>();
  return {
    ...actual,
    getDb: (...args: unknown[]) => {
      if (dbFault.on) throw new Error("w242 injected: database unreachable");
      return (actual.getDb as (...a: unknown[]) => unknown)(...args);
    },
  };
});

import { registerRoutes } from "../routes";
import { enqueueEmail, countOutboxByStatus, _testEmail } from "../emailStore";
import {
  resolveBuildSha,
  buildShaSource,
  buildShaForRelease,
  UNKNOWN_BUILD_SHA,
} from "../lib/buildIdentity";

let app: Express;
let server: http.Server;
let port: number;

function get(path: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : null }); }
        catch { resolve({ status: res.statusCode ?? 0, body: data }); }
      });
    });
    r.on("error", reject);
    r.end();
  });
}

/** Strip comments before drawing any conclusion from source text. The stripper is
 *  verified against a fixture in §5, because this module's own prose contains the
 *  exact strings §5 searches for violations of. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Every key the endpoint published BEFORE this wave. None may disappear or be
 *  renamed: external monitors and the deploy runbook read these names. */
const PRE_WAVE_KEYS = [
  "ok", "version", "buildSha", "buildTime", "uptimeSec", "dbConnected",
  "bridgeOutboxBacklog", "emailOutboxBacklog", "bridgeEnvOk",
  "bridgeOutboundConfigured", "bridgeOutboxQueued", "outboxOverflowCount",
  "devIdentityBypassActive", "disableDevBypassSet", "devIdentityBypassAlarm",
  "timestamp",
];

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, () => { port = (server.address() as { port: number }).port; r(); }));
}, 120_000);

afterAll(async () => {
  dbFault.on = false;
  await new Promise<void>((r) => server.close(() => r()));
});

describe("W242 §1 — nothing was renamed, removed, or turned into an error", () => {
  it("responds 200 and still publishes every pre-wave field", async () => {
    const res = await get("/api/healthz");
    expect(res.status).toBe(200);
    for (const k of PRE_WAVE_KEYS) {
      expect(Object.keys(res.body), `missing pre-wave field: ${k}`).toContain(k);
    }
  });

  it("publishes the appended fields, and okBasis says what ok actually attests to", async () => {
    const res = await get("/api/healthz");
    expect(res.body.okBasis).toBe("process_is_serving_and_getDb_succeeded");
    expect(Array.isArray(res.body.degraded)).toBe(true);
    expect(typeof res.body.emailOutboxBacklogMeasured).toBe("boolean");
    expect(["BUILD_SHA_env", "GIT_SHA_env", "git_rev_parse", "unresolved"]).toContain(res.body.buildShaSource);
  });

  it("an unidentified build is reported as unidentified, not as a value", async () => {
    /* This tree is not a git repository and neither env var is set here, so the
       resolver legitimately degrades. The point is that the two fields agree:
       "unknown" is never published with a source that implies it was resolved. */
    const res = await get("/api/healthz");
    if (res.body.buildSha === UNKNOWN_BUILD_SHA) {
      expect(res.body.buildShaSource).toBe("unresolved");
    } else {
      expect(res.body.buildShaSource).not.toBe("unresolved");
    }
  });
});

describe("W242 §2 — a normal live condition is reported, NOT failed", () => {
  it("bridgeEnvOk false appears in degraded while ok stays true and the status stays 200", async () => {
    /* MEASURED, NOT ASSUMED: in THIS tree no bridge env is set, so
       `inspectBridgeEnv()` finds nothing wrong and reports ok=true. The live
       steady state is the opposite — a webhook URL naming the host that does not
       resolve (`bridgeEnvAssert.ts` DEAD_HOST) — so the test reproduces exactly
       that env for the duration of one request rather than pretending the
       default state is the live one. `inspectBridgeEnv` reads `process.env` per
       call, so this drives the real code path. */
    const before = await get("/api/healthz");
    expect(before.body.bridgeEnvOk).toBe(true);
    expect(before.body.degraded).not.toContain("bridge_env_not_ok");

    const saved = process.env.COLLECTIVE_WEBHOOK_URL;
    process.env.COLLECTIVE_WEBHOOK_URL = "https://collective.capavate.com/hook";
    try {
      const res = await get("/api/healthz");
      expect(res.body.bridgeEnvOk).toBe(false);
      expect(res.body.degraded).toContain("bridge_env_not_ok");
      /* THE REQUIREMENT: the developer's install check must not go red for it. */
      expect(res.body.ok).toBe(true);
      expect(res.status).toBe(200);
      expect(res.body.dbConnected).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.COLLECTIVE_WEBHOOK_URL;
      else process.env.COLLECTIVE_WEBHOOK_URL = saved;
    }
  });

  it("degraded is a measurement, not a default — a real queued email moves it", async () => {
    /* Before: `emailOutboxBacklog: 0`, a hardcoded literal. This test could not
       have distinguished the fix from the defect at zero, so it MOVES the
       fixture: enqueue through the real store and require the number to follow.
       Inert-proof mechanism 3 is the one being defended against here. */
    const before = await get("/api/healthz");
    const baseline = countOutboxByStatus().queued;
    expect(before.body.emailOutboxBacklog).toBe(baseline);
    expect(before.body.emailOutboxBacklogMeasured).toBe(true);

    const vars = { recipient_name: "W242", new_status: "queued", action_required: "none" };
    enqueueEmail({ templateSlug: "kyc_update", recipient: "w242@example.test", recipientUserId: "u_w242", variables: vars });
    enqueueEmail({ templateSlug: "kyc_update", recipient: "w242b@example.test", recipientUserId: "u_w242b", variables: vars });

    const after = await get("/api/healthz");
    expect(after.body.emailOutboxBacklog).toBe(baseline + 2);
    expect(after.body.emailOutboxBacklog).not.toBe(0);
    expect(after.body.degraded).toContain("email_outbox_backlog");
    /* And a backlog still does not fail the install check. */
    expect(after.body.ok).toBe(true);
    expect(after.status).toBe(200);

    _testEmail.reset();
    const cleaned = await get("/api/healthz");
    expect(cleaned.body.emailOutboxBacklog).toBe(0);
    expect(cleaned.body.degraded).not.toContain("email_outbox_backlog");
  });
});

describe("W242 §3 — FAULT INJECTION: ok is no longer a literal", () => {
  it("with getDb() throwing, ok becomes false, degraded says so, and the status is STILL 200", async () => {
    /* Without this case `ok === true` in every reachable test state, so the
       assertion would hold identically against the old `ok: true` literal and
       the D-disarm for it would come back GREEN. */
    const healthy = await get("/api/healthz");
    expect(healthy.body.ok).toBe(true);

    dbFault.on = true;
    try {
      const faulted = await get("/api/healthz");
      expect(faulted.body.ok).toBe(false);
      expect(faulted.body.dbConnected).toBe(false);
      expect(faulted.body.degraded).toContain("database_unreachable");
      /* Deliberate: the status code is NOT changed by this wave. The install
         check, the portal footers and the rate-limit/guard exemptions all treat
         this path as infrastructure that answers 200. */
      expect(faulted.status).toBe(200);
    } finally {
      dbFault.on = false;
    }

    const recovered = await get("/api/healthz");
    expect(recovered.body.ok).toBe(true);
    expect(recovered.body.degraded).not.toContain("database_unreachable");
  });
});

describe("W242 §4 — one build resolver, its precedence, and its refusal to name an unknown release", () => {
  const saved = { BUILD_SHA: process.env.BUILD_SHA, GIT_SHA: process.env.GIT_SHA };
  const set = (b?: string, g?: string) => {
    if (b === undefined) delete process.env.BUILD_SHA; else process.env.BUILD_SHA = b;
    if (g === undefined) delete process.env.GIT_SHA; else process.env.GIT_SHA = g;
  };
  afterAll(() => { set(saved.BUILD_SHA, saved.GIT_SHA); });

  it("BUILD_SHA wins over GIT_SHA — the precedence the old inline resolver declared", () => {
    set("bbbbbbb", "ggggggg");
    expect(resolveBuildSha()).toBe("bbbbbbb");
    expect(buildShaSource()).toBe("BUILD_SHA_env");
  });

  it("GIT_SHA is used when BUILD_SHA is absent", () => {
    set(undefined, "ggggggg");
    expect(resolveBuildSha()).toBe("ggggggg");
    expect(buildShaSource()).toBe("GIT_SHA_env");
  });

  it("THE CASE THAT WAS BROKEN: BUILD_SHA set, GIT_SHA unset — Sentry's release now matches healthz", () => {
    /* Pre-wave `sentry.ts` read GIT_SHA alone, so in exactly this configuration
       — the one the resolver's own precedence order tells a deploy to use —
       healthz reported the build and every Sentry event carried NO release. */
    set("deadbee", undefined);
    expect(resolveBuildSha()).toBe("deadbee");
    expect(buildShaForRelease()).toBe("deadbee");
    expect(process.env.GIT_SHA).toBeUndefined();
  });

  it("an unresolvable build yields 'unknown' and an UNDEFINED Sentry release, never a release named 'unknown'", () => {
    set(undefined, undefined);
    /* This tree is not a git repository, so `git rev-parse` fails here. */
    expect(resolveBuildSha()).toBe(UNKNOWN_BUILD_SHA);
    expect(buildShaSource()).toBe("unresolved");
    /* A release literally called "unknown" would group every unidentifiable
       deploy's errors into one bucket — an absence rendering as a fact. */
    expect(buildShaForRelease()).toBeUndefined();
  });

  it("the resolver is NOT process-cached, because a pre-existing test re-registers with a new env", () => {
    /* FOUND BY REGRESSION, NOT BY REASONING. The first version of this wave
       memoised the answer at module level. That made
       `server/__tests__/wfix4_item7_build_marker.test.ts:83` fail — it registers
       the routes a second time with BUILD_SHA/GIT_SHA cleared and PATH emptied
       and requires `buildSha` to become "unknown", and it got the FIRST
       registration's sha instead. The cache was removed; the test was not
       weakened. */
    set("firstvalue", undefined);
    expect(resolveBuildSha()).toBe("firstvalue");
    set("secondvalue", undefined);
    expect(resolveBuildSha()).toBe("secondvalue");
  });

  it("the healthz handler resolves the build ONCE at registration, so nothing shells out per request", () => {
    /* Without a cache, calling the resolver inside the handler would run
       `git rev-parse` on every hit of a PUBLIC, rate-limit-EXEMPT endpoint. The
       value is therefore captured in `registerRoutes` and closed over, exactly as
       the pre-wave inlined IIFE did. Asserted on comment-stripped source because
       this wave's own comments name the resolver repeatedly. */
    const src = stripComments(readFileSync("server/routes.ts", "utf8"));
    const idx = src.indexOf('app.get("/api/healthz"');
    expect(idx).toBeGreaterThan(0);
    const resolverCall = src.indexOf("resolveBuildIdentity()");
    expect(resolverCall).toBeGreaterThan(0);
    /* The single call site precedes the handler … */
    expect(resolverCall).toBeLessThan(idx);
    /* … and it is the only one. */
    expect(src.split("resolveBuildIdentity()").length - 1).toBe(1);
    /* The handler publishes the captured field, not a fresh resolution. */
    expect(src).toContain("buildShaSource: buildIdentity.source,");
  });
});

describe("W242 §5 — the third source is gone from source, and the stripper that proves it works", () => {
  it("the comment stripper removes both comment shapes and keeps code", () => {
    const probe = "keepA\n/* block process.env.GIT_SHA */\n// line process.env.GIT_SHA\nkeepB";
    const out = stripComments(probe);
    expect(out).toContain("keepA");
    expect(out).toContain("keepB");
    expect(out).not.toContain("block process.env.GIT_SHA");
    expect(out).not.toContain("line process.env.GIT_SHA");
  });

  it("sentry.ts resolves the release through the shared resolver and no longer reads GIT_SHA itself", () => {
    const src = stripComments(readFileSync("server/lib/sentry.ts", "utf8"));
    expect(src).toContain("buildShaForRelease()");
    /* The point of the change: it must not consult the env var directly any more.
       Asserted on STRIPPED source because this file's own comment explains the
       defect using that exact string. */
    expect(src).not.toContain("process.env.GIT_SHA");
  });

  it("the healthz handler no longer contains the two literals", () => {
    const src = stripComments(readFileSync("server/routes.ts", "utf8"));
    expect(src).not.toContain("emailOutboxBacklog: 0");
    expect(src).toContain("ok: dbOk,");
    expect(src).not.toContain("      ok: true,\n      version,");
  });
});
