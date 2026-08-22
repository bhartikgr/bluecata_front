/**
 * WAVE 97B · R86 — STRIPE IS GONE, THE GATEWAY SEAM IS NOT.
 *
 * Owner, verbatim (2026-08-21):
 *   "remove stripe. I can add this at a later date. We are using Airwallex today."
 *
 * BOTH HALVES ARE BINDING, so this file has two jobs and they pull in opposite
 * directions on purpose:
 *
 *   A. Pin the REMOVAL. No live module, no route, no admin config row, no type
 *      member, no npm dependency and no lazy `require()` may name Stripe.
 *   B. Pin the SEAM. The resolver, the readiness probe, the webhook-source
 *      mapper, the credentials record, the public config list and the sacred
 *      adapter's per-gateway webhook registrar must all still be parameterised
 *      by gateway id, so "I can add this at a later date" stays a plug-in.
 *
 * A test that only did (A) would pass against a build that hard-coded Airwallex
 * everywhere and made the next gateway a rewrite. A test that only did (B) would
 * pass against Wave 97's blocked tree. Both are asserted here.
 *
 * This file also carries the replacement coverage for the two gateway-agnostic
 * behaviours that were the only non-Stripe assertions in the deleted
 * `collectiveBilling.test.ts` — see §5. Nothing was silently lost.
 *
 * Math-sacred zones are untouched: no captableCommitStore, no cap-table-engine.
 * Ruling: spec/OWNER_RULINGS_2026_08_13.md · R86.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { registerRoutes } from "../routes";
import {
  getDefaultGatewayId,
  resolveActiveGateway,
  isGatewayReady,
  listPublicGatewayConfig,
  webhookSourceToGateway,
  getGatewayCredentials,
  getAirwallexMode,
  getAirwallexApiBase,
  AIRWALLEX_DEMO_API_BASE,
} from "../lib/paymentGatewayResolver";
import { getPublicConfig, getPublicGatewayList } from "../paymentGatewayAdapter";
import { COLLECTIVE_TIER_CATALOG, getCollectiveBillingGatewayId } from "../lib/airwallexCollective";

const SERVER_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/* Personas that exist in the runtime identity table. */
const MAYA = "u_maya_chen";
const GHOST = "u_ghost_not_a_member";
const CHAPTER_ID = "chap_keiretsu_canada";
const FOREIGN_CHAPTER_ID = "chap_nyc";

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1";
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.COLLECTIVE_ENABLED;
});

afterEach(() => {
  delete process.env.PAYMENT_GATEWAY_DEFAULT;
  delete process.env.AIRWALLEX_MODE;
  delete process.env.AIRWALLEX_API_KEY;
  delete process.env.AIRWALLEX_CLIENT_ID;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

function call(
  method: string,
  apiPath: string,
  opts: { body?: unknown; userId?: string } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    if (opts.userId) headers["x-user-id"] = opts.userId;
    const req = http.request(
      { host: "127.0.0.1", port, method, path: apiPath, headers },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let body: any = null;
          try {
            body = raw ? JSON.parse(raw) : null;
          } catch {
            body = raw;
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

/** Every live (non-archive, non-test, non-doc) source file in the tree. */
function liveSourceFiles(): string[] {
  const out: string[] = [];
  const skipDirs = new Set([
    "node_modules",
    ".g0-snapshot",
    "__tests__",
    "dist",
    "coverage",
    ".git",
    "uploads",
    "migrations",
    "migrations-pg",
  ]);
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (skipDirs.has(e.name)) continue;
        walk(path.join(dir, e.name));
      } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
        out.push(path.join(dir, e.name));
      }
    }
  };
  for (const top of ["server", "client", "shared"]) walk(path.join(REPO_ROOT, top));
  return out;
}

/* ============================================================
 * 1 · THE REMOVAL — the modules, the dependency, the reach
 * ============================================================ */
describe("WAVE 97B · R86 — the Stripe implementation is gone from disk", () => {
  it("all three Stripe gateway modules are deleted", () => {
    expect(existsSync(path.join(SERVER_DIR, "lib", "stripeGateway.ts"))).toBe(false);
    expect(existsSync(path.join(SERVER_DIR, "lib", "stripeCollective.ts"))).toBe(false);
    expect(existsSync(path.join(SERVER_DIR, "stripeGatewayAdapter.ts"))).toBe(false);
  });

  it("the Airwallex gateway modules they were deleted in favour of are still here", () => {
    // Fences the removal against over-reach: deleting Airwallex too would be a
    // far worse defect than leaving Stripe in.
    expect(existsSync(path.join(SERVER_DIR, "lib", "airwallexGateway.ts"))).toBe(true);
    expect(existsSync(path.join(SERVER_DIR, "lib", "airwallexCollective.ts"))).toBe(true);
    expect(existsSync(path.join(SERVER_DIR, "lib", "paymentGatewayResolver.ts"))).toBe(true);
    expect(existsSync(path.join(SERVER_DIR, "paymentGatewayAdapter.ts"))).toBe(true);
  });

  it("the `stripe` npm dependency is dropped from package.json", () => {
    const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
    expect(pkg.dependencies?.stripe).toBeUndefined();
    expect(pkg.devDependencies?.stripe).toBeUndefined();
  });

  it("NOTHING in live source imports or require()s a deleted Stripe module — static OR lazy", () => {
    // This is the assertion Wave 97 could not have written, and the one that
    // catches the dangerous case: a LAZY require() is invisible to any static
    // import scan, and the DSC vote handler had exactly one.
    const offenders: string[] = [];
    for (const f of liveSourceFiles()) {
      const src = readFileSync(f, "utf8");
      // Strip comments so the deliberate historical references in the
      // WAVE 97B comment blocks do not trip this fence.
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      if (
        /(?:from|require\s*\()\s*["'][^"']*\/?(stripeGateway|stripeCollective|stripeGatewayAdapter)["']/.test(code)
      ) {
        offenders.push(path.relative(REPO_ROOT, f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no live source module resolves the `stripe` SDK package", () => {
    const offenders: string[] = [];
    for (const f of liveSourceFiles()) {
      const code = readFileSync(f, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      if (/(?:from|require\s*\()\s*["']stripe["']/.test(code)) {
        offenders.push(path.relative(REPO_ROOT, f));
      }
    }
    expect(offenders).toEqual([]);
  });
});

/* ============================================================
 * 2 · THE REMOVAL — at the HTTP surface
 * ============================================================ */
describe("WAVE 97B · R86 — both Stripe webhook routes are unmounted", () => {
  it("POST /api/webhooks/payment-gateway/stripe reaches no gateway — only the v25.6 410 tombstone answers", async () => {
    /* MEASURED, NOT ASSUMED — and it corrects the record.
     *
     * In the FULL application this path answers 410, not 404, because a
     * PRE-EXISTING v25.6 middleware (`deprecateStripeFounderWebhook` in
     * server/lib/founderBillingExtensions.ts:79) is registered BEFORE
     * registerPaymentGatewayRoutes() and pre-empts it. That middleware is
     * deliberately KEPT: it is a stop signal telling an operator's old dashboard
     * webhook to reconfigure, and replacing it with a silent 404 would be worse.
     *
     * The consequence worth recording: the sacred adapter's Stripe route was
     * already SHADOWED in the running app before this wave — it was reachable
     * only when registerPaymentGatewayRoutes() was mounted alone, which is
     * exactly what the old airwallexGateway.test.ts did to get a 200 out of it.
     * That the handler itself is now GONE is proved directly in
     * airwallexGateway.test.ts, where a bare adapter app returns 404.
     *
     * What matters here is that nothing verifies a Stripe signature and nothing
     * dispatches a payment: no `gateway` field, no `idempotent` field, ok:false. */
    const r = await call("POST", "/api/webhooks/payment-gateway/stripe", {
      body: { type: "payment_intent.succeeded", data: { object: { id: "pi_x", status: "succeeded" } } },
    });
    expect(r.status).toBe(410);
    expect(r.body?.ok).toBe(false);
    expect(r.body?.error).toBe("gateway_deprecated");
    expect(r.body?.migration).toBe("airwallex");
    // Never processed as a payment event.
    expect(r.body?.gateway).toBeUndefined();
    expect(r.body?.idempotent).toBeUndefined();
    expect(r.status).not.toBe(200);
  });

  it("POST /api/webhooks/stripe (was stripeGatewayAdapter's route) is 404", async () => {
    const r = await call("POST", "/api/webhooks/stripe", {
      body: { id: "evt_x", type: "charge.refunded", data: { object: { metadata: {} } } },
    });
    expect(r.status).toBe(404);
  });

  it("the Airwallex webhook route IS still mounted and still answers 200 (the money path)", async () => {
    const r = await call("POST", "/api/webhooks/payment-gateway/airwallex", {
      body: {
        name: "payment_intent.succeeded",
        data: { object: { id: "int_w97b_seam", status: "SUCCEEDED", merchant_order_id: "co_w97b" } },
      },
    });
    expect(r.status).toBe(200);
    expect(r.body?.ok).toBe(true);
    expect(r.body?.gateway).toBe("airwallex");
  });

  it("the legacy generic /api/webhooks/payment-gateway endpoint is untouched", async () => {
    const r = await call("POST", "/api/webhooks/payment-gateway", {
      body: { type: "payment.succeeded", intentId: "leg_w97b", status: "succeeded", companyId: "co_legacy" },
    });
    expect(r.status).toBe(200);
    expect(r.body?.ok).toBe(true);
  });

  it("the deprecated Collective Stripe path still answers 410 with a stop signal — a tombstone, not wiring", async () => {
    // Deliberately KEPT. R86's scope is Stripe *wiring*; a permanent 410 that
    // tells an operator's old dashboard webhook to reconfigure is the opposite
    // of wiring, and deleting it would turn a clear stop signal into a silent
    // 404. It verifies no signature and reaches no gateway.
    const r = await call("POST", "/api/stripe/webhook/collective", { body: { id: "evt_x" } });
    expect(r.status).toBe(410);
    expect(r.body?.error).toBe("gateway_deprecated");
  });
});

/* ============================================================
 * 3 · THE REMOVAL — the admin config surface the owner named
 * ============================================================ */
describe("WAVE 97B · R86 — the admin gateway config no longer offers Stripe", () => {
  it("listPublicGatewayConfig() lists exactly one gateway and it is Airwallex", () => {
    const list = listPublicGatewayConfig();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe("airwallex");
    expect(list[0].isDefault).toBe(true);
    expect(JSON.stringify(list)).not.toMatch(/stripe/i);
  });

  it("getPublicConfig() — the body of GET /api/admin/payment-gateway/config — names AirWallex only", () => {
    const cfg = getPublicConfig();
    expect(cfg.name).toBe("AirWallex");
    expect(cfg.defaultGateway).toBe("airwallex");
    expect(JSON.stringify(cfg)).not.toMatch(/stripe/i);
  });

  it("GET /api/admin/payment-gateway/config returns no Stripe anywhere in its response", async () => {
    const r = await call("GET", "/api/admin/payment-gateway/config", { userId: "u_admin" });
    // Whatever the auth outcome, no response body may name Stripe.
    expect(JSON.stringify(r.body ?? {})).not.toMatch(/stripe/i);
  });

  it("the sacred adapter's Stripe label branch is gone from its source", () => {
    const src = readFileSync(path.join(SERVER_DIR, "paymentGatewayAdapter.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/["']Stripe["']/);
    expect(code).not.toMatch(/verifyStripeSig/);
    expect(code).not.toMatch(/payment-gateway\/stripe/);
  });

  it("PAYMENT_GATEWAY_DEFAULT=stripe cannot select a gateway that does not exist", () => {
    process.env.PAYMENT_GATEWAY_DEFAULT = "stripe";
    expect(getDefaultGatewayId()).toBe("airwallex");
    expect(resolveActiveGateway()).toBe("airwallex");
    expect(getPublicConfig().defaultGateway).toBe("airwallex");
  });

  it("GatewayCredentials no longer carries a stripe block, and STRIPE_* env vars are not consumed", () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_should_be_ignored";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_should_be_ignored";
    const creds = getGatewayCredentials();
    expect(Object.keys(creds)).toEqual(["airwallex"]);
    expect(JSON.stringify(creds)).not.toMatch(/should_be_ignored/);
    // A live-looking Stripe key must NOT make any gateway ready.
    expect(isGatewayReady("airwallex")).toBe(false);
  });

  it("webhookSourceToGateway maps a stripe path to null, not to a gateway", () => {
    expect(webhookSourceToGateway("/api/webhooks/payment-gateway/stripe")).toBeNull();
    expect(webhookSourceToGateway("stripe")).toBeNull();
    expect(webhookSourceToGateway("/api/webhooks/payment-gateway/airwallex")).toBe("airwallex");
  });
});

/* ============================================================
 * 4 · THE SEAM — "I can add this at a later date" must stay cheap
 * ============================================================ */
describe("WAVE 97B · R86 — THE SEAM IS STILL THERE (adding a gateway is a plug-in)", () => {
  it("every plug point still exists as a callable, gateway-parameterised function", () => {
    expect(typeof getDefaultGatewayId).toBe("function");
    expect(typeof resolveActiveGateway).toBe("function");
    expect(typeof isGatewayReady).toBe("function");
    expect(typeof webhookSourceToGateway).toBe("function");
    expect(typeof getGatewayCredentials).toBe("function");
    expect(typeof listPublicGatewayConfig).toBe("function");
    // The sacred adapter still delegates its list to the non-sacred resolver —
    // that delegation is what makes widening the resolver sufficient.
    expect(getPublicGatewayList()).toEqual(listPublicGatewayConfig());
  });

  it("isGatewayReady takes an id and fails CLOSED on an id it does not know", () => {
    // Cast is deliberate: this is the shape a future gateway arrives in before
    // its readiness branch is added. It must answer false, never true.
    expect(isGatewayReady("not_a_gateway" as unknown as "airwallex")).toBe(false);
  });

  it("the resolver still carries all six numbered EXTENSION POINTs for the next gateway", () => {
    const src = readFileSync(path.join(SERVER_DIR, "lib", "paymentGatewayResolver.ts"), "utf8");
    for (const n of [
      "EXTENSION POINT 1 of 6",
      "EXTENSION POINT 2 of 6",
      "EXTENSION POINT 3 of 6",
      "EXTENSION POINT 4 of 6",
      "EXTENSION POINT 5 of 6",
      "EXTENSION POINT 6 of 6",
    ]) {
      expect(src).toContain(n);
    }
  });

  it("the SACRED adapter marks where a second gateway's webhook route and verifier plug in", () => {
    const src = readFileSync(path.join(SERVER_DIR, "paymentGatewayAdapter.ts"), "utf8");
    expect(src).toContain("EXTENSION POINT");
    // The registrar is still parameterised by gateway id, not inlined.
    expect(src).toMatch(/function handleGatewayWebhook\(\s*gateway:\s*GatewayId/);
    expect(src).toMatch(/handleGatewayWebhook\("airwallex", req, res\)/);
  });

  it("the per-gateway branches inside the webhook handler survive, ready for a second id", () => {
    const src = readFileSync(path.join(SERVER_DIR, "paymentGatewayAdapter.ts"), "utf8");
    // If a later wave collapsed these into unconditional Airwallex code, adding
    // a gateway would become a rewrite of the sacred file. Fail if that happens.
    expect((src.match(/gateway === "airwallex"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

/* ============================================================
 * 5 · REPLACEMENT COVERAGE for the deleted collectiveBilling.test.ts
 *
 * That file was a v18 Phase B Stripe suite (18 failing / 1 passing / 9 skipped
 * against the Wave 95 baseline) and it imported `../lib/stripeCollective`, so it
 * could not survive the module deletion. Exactly two of its assertions were
 * gateway-agnostic. Both are re-asserted here, against the live Airwallex
 * routes, so the coverage is carried forward rather than dropped.
 * ============================================================ */
describe("WAVE 97B · R86 — Collective membership access gates (carried forward from the deleted Stripe suite)", () => {
  it("a ghost (non-collective-member) is rejected before reaching the checkout handler", async () => {
    // WAS: collectiveBilling.test.ts "ghost (non-collective-member) rejected
    // before reaching handler" (PASSING). Unchanged in substance.
    const r = await call("POST", "/api/collective/membership/checkout", {
      userId: GHOST,
      body: { tier: "basic", chapter_id: CHAPTER_ID },
    });
    expect([401, 403]).toContain(r.status);
  });

  it("cross-chapter isolation: a member of one chapter cannot buy into another", async () => {
    // WAS: collectiveBilling.test.ts "cross-chapter: member of
    // chap_keiretsu_canada cannot buy into chap_nyc" and the cross-tenant
    // isolation case, both of which reduced to this 403.
    const r = await call("POST", "/api/collective/membership/checkout", {
      userId: MAYA,
      body: { tier: "basic", chapter_id: FOREIGN_CHAPTER_ID },
    });
    expect([401, 403]).toContain(r.status);
  });

  it("the Collective billing module reports Airwallex as its gateway, with no Stripe union member left", () => {
    const gw = getCollectiveBillingGatewayId();
    expect(gw).toBe("airwallex");
    expect(String(gw)).not.toMatch(/stripe/i);
  });
});

/* ============================================================
 * 6 · SAFETY — the pole that matters most on a money path
 *
 * Wave 97's mutation M9 initially MISSED a real gap: its assertion only checked
 * that the gateway was in stub mode when NO key was present, so a build that
 * went live the instant a real key appeared would have passed. That fix is kept
 * and re-verified here, and extended to the case where a Stripe credential is
 * also lying around.
 * ============================================================ */
describe("WAVE 97B · R86 — Airwallex still refuses to go live by accident", () => {
  it("stub is the default EVEN WHEN a real API key is present (M9)", () => {
    process.env.AIRWALLEX_API_KEY = "aw_key_w97b_probe_not_a_real_credential";
    delete process.env.AIRWALLEX_MODE;
    expect(getAirwallexMode()).toBe("stub");
    expect(getAirwallexApiBase()).toBe(AIRWALLEX_DEMO_API_BASE);
  });

  it("stub is still the default when a Stripe-shaped live key is also present (M9b)", () => {
    process.env.AIRWALLEX_API_KEY = "aw_key_w97b_probe_not_a_real_credential";
    process.env.STRIPE_SECRET_KEY = "sk_live_w97b_probe_not_a_real_credential";
    delete process.env.AIRWALLEX_MODE;
    expect(getAirwallexMode()).toBe("stub");
    expect(getAirwallexApiBase()).toBe(AIRWALLEX_DEMO_API_BASE);
  });

  it("AIRWALLEX_MODE=live without a key falls back to stub — never production without a credential", () => {
    process.env.AIRWALLEX_MODE = "live";
    delete process.env.AIRWALLEX_API_KEY;
    expect(getAirwallexMode()).toBe("stub");
  });

  it("AIRWALLEX_MODE=test uses the DEMO host, never production", () => {
    process.env.AIRWALLEX_MODE = "test";
    expect(getAirwallexMode()).toBe("test");
    expect(getAirwallexApiBase()).toBe(AIRWALLEX_DEMO_API_BASE);
  });
});

/* ============================================================
 * 7 · THE ENTITLEMENT CATALOG the DSC vote gate depends on
 *
 * Structural half of the DSC proof. The behavioural half — a paying member
 * actually casting a vote over HTTP — is in
 * w97b_dsc_vote_paying_member.test.ts.
 * ============================================================ */
describe("WAVE 97B · R86 — the tier catalog the DSC vote gate reads now lives in airwallexCollective", () => {
  it("airwallexCollective exports the three tiers", () => {
    expect(COLLECTIVE_TIER_CATALOG.length).toBe(3);
    expect(COLLECTIVE_TIER_CATALOG.map((t) => t.tier).sort()).toEqual([
      "basic",
      "premium",
      "standard",
    ]);
  });

  it("standard and premium grant dsc:vote; basic does not — the entitlement decision is UNCHANGED", () => {
    const grants = (tier: string) =>
      COLLECTIVE_TIER_CATALOG.find((t) => t.tier === tier)?.entitlements.includes("dsc:vote");
    expect(grants("basic")).toBe(false);
    expect(grants("standard")).toBe(true);
    expect(grants("premium")).toBe(true);
  });

  it("the DSC vote handler's lazy require() points at airwallexCollective, not stripeCollective", () => {
    const src = readFileSync(path.join(SERVER_DIR, "collectiveDscVoteRoutes.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/require\("\.\/lib\/airwallexCollective"\)/);
    expect(code).not.toMatch(/stripeCollective/);
    // The entitlement read itself must still be there — this is the line whose
    // silent failure would 403 a paying member.
    expect(code).toMatch(/COLLECTIVE_TIER_CATALOG/);
    expect(code).toMatch(/dsc:vote/);
  });
});
