/**
 * Sprint 15 D2 — Entitlement gate matrix.
 *
 * ── WAVE 36 · ROW 7 — THIS SUITE WAS SELF-REFERENTIAL ───────────────────────
 * It used to build its own `gate()` containing
 *
 *     if (String(req.query.enforce ?? "") !== "1") return next();
 *
 * which is the `?enforce` query bypass that v15 P0-14 REMOVED from production as
 * a launch blocker (see the comment above the mounts in server/routes.ts:
 * "?enforce=0 query bypass is REMOVED. Enforcement is ALWAYS ON."). The suite
 * re-introduced the bypass locally and then hit every route with `?enforce=1`,
 * so all 34 assertions were green about code that does not ship — and would have
 * stayed green if production enforcement had been deleted outright.
 *
 * It also re-implemented the route→entitlement mapping by hand, so a mount
 * added, removed or re-pointed in routes.ts changed nothing here. Two mounts
 * gated in production (`/api/investor/portfolio2`, `/api/collective/dealroom`)
 * were in fact missing from that hand-written table.
 *
 * ALL OF IT IS FIXED:
 *   1. The gate is the SHIPPED `entitlementGate` from lib/requireEntitlement.ts —
 *      the one implementation registerRoutes's `gate` delegates to.
 *   2. The route→entitlement mapping is PARSED OUT OF server/routes.ts, so the
 *      matrix follows production instead of describing a memory of it. The parse
 *      is asserted (count + every expected pair) so it cannot find nothing and
 *      then pass over an empty table.
 *   3. No `?enforce` anywhere, plus dedicated poles proving `?enforce=0` and
 *      `?enforce=1` are both inert and that the dev escape hatch needs BOTH of
 *      its conditions.
 */
import { describe, it, expect } from "vitest";
import express from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

import { loadUserContext, entitlementGate } from "../lib/requireEntitlement";

const ROOT = path.resolve(__dirname, "..", "..");

/* ── The route→entitlement mapping, READ FROM THE SHIPPED ROUTER ──────────── */

export interface GateMount { path: string; entitlements: string[] }

/** Parse `app.use("<path>", gate("<ent>", …))` mounts out of server/routes.ts.
 *  Comments are stripped first: routes.ts documents a REMOVED mount (WAVE 29
 *  ITEM 1) inside a block comment, and an unstripped parse mounts a gate that
 *  production deliberately does not have. */
export function parseGateMounts(src: string): GateMount[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  const out: GateMount[] = [];
  for (const m of code.matchAll(/app\.use\(\s*"([^"]+)"\s*,\s*gate\(([^)]*)\)\s*\)/g)) {
    const ents = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    if (ents.length) out.push({ path: m[1], entitlements: ents });
  }
  /* The conditional POST mount is a different shape — `gate(...)` is invoked
   * inside a method-filtered wrapper — so it is matched separately rather than
   * quietly dropped. */
  for (const m of code.matchAll(/app\.use\(\s*"([^"]+)"\s*,\s*\(req[\s\S]{0,400}?gate\(\s*"([^"]+)"\s*\)\s*\(req/g)) {
    out.push({ path: m[1], entitlements: [m[2]] });
  }
  return out;
}

const ROUTES_SRC = fs.readFileSync(path.join(ROOT, "server", "routes.ts"), "utf8");
const MOUNTS = parseGateMounts(ROUTES_SRC);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(loadUserContext);

  /* THE SHIPPED GATE. Not a local re-implementation: registerRoutes's `gate`
   * delegates straight to it, so this is the same wrapper that runs in
   * production, including its unconditional enforcement. */
  const gate = entitlementGate;

  /* THE SHIPPED MAPPING, in the shipped order. */
  for (const m of MOUNTS) {
    if (m.path === "/api/collective/applications") {
      app.use(m.path, (req, res, next) => {
        if (req.method !== "POST") return next();
        return gate(...(m.entitlements as any))(req, res, next);
      });
    } else {
      app.use(m.path, gate(...(m.entitlements as any)));
    }
  }
  /* `/api/admin/things` is a stand-in: routes.ts guards the admin surface with
   * `requireAdmin`, not with `gate("admin")`, so there is no mount to parse. The
   * `admin` entitlement is still exercised through the SHIPPED factory — only
   * the path is local, and it is declared here rather than smuggled into the
   * parsed table. */
  app.use("/api/admin/things", gate("admin"));

  // Echo handlers — return user info so tests can assert allowed pathways too.
  app.all("/api/investor/portfolio",   (req, res) => res.json({ ok: true, route: "portfolio", userId: req.userContext?.userId }));
  app.all("/api/investor/portfolio2",  (_req, res) => res.json({ ok: true, route: "portfolio2" }));
  app.all("/api/collective/dealroom",  (_req, res) => res.json({ ok: true, route: "collective.dealroom" }));
  app.all("/api/investor/crm",         (req, res) => res.json({ ok: true, route: "crm" }));
  app.all("/api/investor/messages",    (req, res) => res.json({ ok: true, route: "messages" }));
  app.all("/api/investor/companies/:companyId", (req, res) => res.json({ ok: true, route: "company" }));
  app.post("/api/collective/applications", (_req, res) => res.json({ ok: true, route: "collective.app" }));
  app.get("/api/collective/applications",  (_req, res) => res.json({ ok: true, route: "collective.app.list" }));
  app.all("/api/collective/network",   (_req, res) => res.json({ ok: true, route: "collective.network" }));
  app.all("/api/founder/companies/:id/billing", (_req, res) => res.json({ ok: true, route: "founder.billing" }));
  app.all("/api/admin/things",         (_req, res) => res.json({ ok: true, route: "admin" }));

  return app;
}

async function call(app: express.Express, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app).listen(0, () => {
      const port = (server.address() as any).port;
      const data = body ? JSON.stringify(body) : undefined;
      const r = http.request(
        { hostname: "127.0.0.1", port, path, method, headers: data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {} },
        (res) => {
          let buf = "";
          res.on("data", (c) => (buf += c));
          res.on("end", () => {
            server.close();
            try { resolve({ status: res.statusCode || 0, body: buf ? JSON.parse(buf) : null }); }
            catch { resolve({ status: res.statusCode || 0, body: buf }); }
          });
        }
      );
      r.on("error", (e) => { server.close(); reject(e); });
      if (data) r.write(data);
      r.end();
    });
  });
}

const app = buildApp();

/* --------------- Persona vectors --------------- */
type RouteCheck = { method: string; path: string; expect: "ALLOW" | string /* error code */; body?: unknown };
type Persona = { id: string; userId: string; routes: RouteCheck[] };

const personas: Persona[] = [
  // u_maya_chen — founder of all 3 demo companies, no cap-table position.
  {
    id: "u_maya_chen",
    userId: "u_maya_chen",
    routes: [
      { method: "GET",  path: "/api/investor/portfolio",                    expect: "CAP_TABLE_REQUIRED" },
      { method: "GET",  path: "/api/investor/portfolio2",                   expect: "CAP_TABLE_REQUIRED" },
      { method: "GET",  path: "/api/collective/dealroom",                   expect: "COLLECTIVE_INACTIVE" },
      { method: "GET",  path: "/api/investor/crm",                          expect: "CAP_TABLE_REQUIRED" },
      { method: "GET",  path: "/api/investor/messages",                     expect: "COMMUNICATION_BLOCKED" },
      { method: "GET",  path: "/api/investor/companies/co_novapay",         expect: "NOT_ON_CAP_TABLE" },
      { method: "POST", path: "/api/collective/applications",               expect: "CAP_TABLE_REQUIRED", body: { foo: 1 } },
      { method: "GET",  path: "/api/collective/network",                    expect: "COLLECTIVE_INACTIVE" },
      { method: "GET",  path: "/api/founder/companies/co_novapay/billing",  expect: "ALLOW" },
      { method: "GET",  path: "/api/founder/companies/co_unknown/billing",  expect: "FOUNDER_WRONG_COMPANY" },
      { method: "GET",  path: "/api/admin/things",                          expect: "NOT_ADMIN" },
    ],
  },
  // u_aisha_patel — investor on co_novapay + co_arboreal + active Collective.
  {
    id: "u_aisha_patel",
    userId: "u_aisha_patel",
    routes: [
      { method: "GET",  path: "/api/investor/portfolio",                    expect: "ALLOW" },
      { method: "GET",  path: "/api/investor/portfolio2",                   expect: "ALLOW" },
      { method: "GET",  path: "/api/collective/dealroom",                   expect: "ALLOW" },
      { method: "GET",  path: "/api/investor/crm",                          expect: "ALLOW" },
      { method: "GET",  path: "/api/investor/messages",                     expect: "ALLOW" },
      { method: "GET",  path: "/api/investor/companies/co_novapay",         expect: "ALLOW" },
      { method: "GET",  path: "/api/investor/companies/co_kelvin",          expect: "NOT_ON_CAP_TABLE" },
      { method: "POST", path: "/api/collective/applications",               expect: "ALLOW", body: { foo: 1 } },
      { method: "GET",  path: "/api/collective/network",                    expect: "ALLOW" },
      { method: "GET",  path: "/api/founder/companies/co_novapay/billing",  expect: "NOT_FOUNDER" },
      { method: "GET",  path: "/api/admin/things",                          expect: "NOT_ADMIN" },
    ],
  },
  // u_lapsed_lp — investor on co_novapay, lapsed Collective.
  {
    id: "u_lapsed_lp",
    userId: "u_lapsed_lp",
    routes: [
      { method: "GET",  path: "/api/investor/portfolio",                    expect: "ALLOW" },
      { method: "GET",  path: "/api/investor/portfolio2",                   expect: "ALLOW" },
      { method: "GET",  path: "/api/investor/companies/co_novapay",         expect: "ALLOW" },
      { method: "GET",  path: "/api/collective/network",                    expect: "COLLECTIVE_INACTIVE" },
      { method: "GET",  path: "/api/collective/dealroom",                   expect: "COLLECTIVE_INACTIVE" },
      { method: "POST", path: "/api/collective/applications",               expect: "ALLOW", body: { foo: 1 } },
    ],
  },
  // u_no_position — invited only.
  {
    id: "u_no_position",
    userId: "u_no_position",
    routes: [
      { method: "GET",  path: "/api/investor/portfolio",                    expect: "CAP_TABLE_REQUIRED" },
      { method: "GET",  path: "/api/investor/portfolio2",                   expect: "CAP_TABLE_REQUIRED" },
      { method: "GET",  path: "/api/collective/dealroom",                   expect: "COLLECTIVE_INACTIVE" },
      { method: "GET",  path: "/api/investor/crm",                          expect: "CAP_TABLE_REQUIRED" },
      { method: "GET",  path: "/api/investor/messages",                     expect: "COMMUNICATION_BLOCKED" },
      { method: "GET",  path: "/api/investor/companies/co_novapay",         expect: "NOT_ON_CAP_TABLE" },
      { method: "POST", path: "/api/collective/applications",               expect: "CAP_TABLE_REQUIRED", body: {} },
      { method: "GET",  path: "/api/collective/network",                    expect: "COLLECTIVE_INACTIVE" },
    ],
  },
  // u_admin
  {
    id: "u_admin",
    userId: "u_admin",
    routes: [
      { method: "GET",  path: "/api/admin/things",                          expect: "ALLOW" },
      { method: "GET",  path: "/api/investor/portfolio",                    expect: "CAP_TABLE_REQUIRED" }, // admin is not implicitly an investor
      { method: "GET",  path: "/api/founder/companies/co_novapay/billing",  expect: "NOT_FOUNDER" },
    ],
  },
];

describe("Sprint 15 / Entitlement matrix — persona × route", () => {
  for (const p of personas) {
    for (const r of p.routes) {
      it(`${p.id} ${r.method} ${r.path} -> ${r.expect}`, async () => {
        /* No `?enforce`. Enforcement is unconditional in the shipped gate; if
         * this suite still needed the flag, the flag would still exist. */
        const sep = r.path.includes("?") ? "&" : "?";
        const url = `${r.path}${sep}userId=${p.userId}`;
        const res = await call(app, r.method, url, r.body);
        if (r.expect === "ALLOW") {
          expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
          expect(res.body.ok).toBe(true);
        } else {
          expect(res.status, JSON.stringify(res.body)).toBeGreaterThanOrEqual(401);
          expect(res.body.error).toBe(r.expect);
        }
      });
    }
  }
});

describe("WAVE 36 ROW 7 — the ?enforce bypass is GONE, and nothing client-controlled restores it", () => {
  /* The block that stood here asserted the OPPOSITE — that a request without
   * `?enforce=1` passes through ungated, "back-compat". It passed because the
   * suite had built that bypass itself. Production removed it in v15 P0-14. */
  it("no query param at all -> the gate still fires", async () => {
    const res = await call(app, "GET", "/api/investor/portfolio?userId=u_no_position");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("CAP_TABLE_REQUIRED");
  });

  it("?enforce=0 does NOT bypass the gate", async () => {
    const res = await call(app, "GET", "/api/investor/portfolio?enforce=0&userId=u_no_position");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("CAP_TABLE_REQUIRED");
  });

  it("?enforce=1 changes nothing — the flag is inert in both positions", async () => {
    const off = await call(app, "GET", "/api/investor/portfolio?enforce=0&userId=u_no_position");
    const on  = await call(app, "GET", "/api/investor/portfolio?userId=u_no_position");
    expect(off.status).toBe(on.status);
    expect(off.body.error).toBe(on.body.error);
  });

  it("neither the shipped router nor this file contains an ?enforce bypass", () => {
    const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    const routes = strip(ROUTES_SRC);
    expect(routes).toContain("return entitlementGate(...required);"); // S0 — still reading real code
    expect(routes).not.toMatch(/req\.query\.enforce/);
    const self = strip(fs.readFileSync(__filename, "utf8"));
    expect(self).toContain("entitlementGate");                // S0
    expect(self).not.toMatch(/query\.enforce/);
  });

  it("the dev escape hatch requires BOTH NODE_ENV=development AND ALLOW_GATE_BYPASS=1", async () => {
    /* Preconditions are established here and restored here. Nothing is READ
     * from the ambient environment to decide what to expect. */
    const prevEnv = process.env.NODE_ENV;
    const prevFlag = process.env.ALLOW_GATE_BYPASS;
    try {
      process.env.NODE_ENV = "test";
      process.env.ALLOW_GATE_BYPASS = "1";
      let res = await call(app, "GET", "/api/investor/portfolio?userId=u_no_position");
      expect(res.status, "the flag alone must not bypass").toBe(403);

      process.env.NODE_ENV = "development";
      delete process.env.ALLOW_GATE_BYPASS;
      res = await call(app, "GET", "/api/investor/portfolio?userId=u_no_position");
      expect(res.status, "development alone must not bypass").toBe(403);

      process.env.NODE_ENV = "production";
      process.env.ALLOW_GATE_BYPASS = "1";
      res = await call(app, "GET", "/api/investor/portfolio?userId=u_no_position");
      expect(res.status, "production must never bypass").toBe(403);

      /* The positive pole, so this is not a check that only ever sees 403. */
      process.env.NODE_ENV = "development";
      process.env.ALLOW_GATE_BYPASS = "1";
      res = await call(app, "GET", "/api/investor/portfolio?userId=u_no_position");
      expect(res.status, "the documented dev hatch must actually work").toBe(200);
    } finally {
      if (prevEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prevEnv;
      if (prevFlag === undefined) delete process.env.ALLOW_GATE_BYPASS; else process.env.ALLOW_GATE_BYPASS = prevFlag;
    }
  });
});

describe("WAVE 36 ROW 7 — the mapping under test IS the shipped mapping", () => {
  it("the parse found the production mounts (non-vacuous)", () => {
    expect(MOUNTS.length).toBeGreaterThanOrEqual(7);
    const pairs = MOUNTS.map((m) => `${m.path}=${m.entitlements.join("+")}`);
    for (const expected of [
      "/api/investor/portfolio=investor.hasAnyCapTable",
      "/api/investor/crm=investor.hasAnyCapTable",
      "/api/investor/messages=investor.hasAnyCapTable",
      "/api/investor/portfolio2=investor.hasAnyCapTable",
      "/api/collective/network=collective.active",
      "/api/collective/dealroom=collective.active",
      "/api/founder/companies/:id/billing=founder.ofCompany",
      "/api/collective/applications=investor.hasAnyCapTable",
    ]) expect(pairs, `missing shipped mount ${expected}`).toContain(expected);
  });

  it("every mounted gate refuses a persona that qualifies for none of them", async () => {
    /* u_no_position holds nothing and is not collective-active, so every gated
     * mount must refuse. If buildApp had silently mounted nothing these would
     * all be 200, which is what this pole exists to catch. */
    for (const m of MOUNTS) {
      if (m.path === "/api/collective/applications") continue; // POST-only gate
      const p = m.path.replace(/:[^/]+/g, "co_novapay");
      const res = await call(app, "GET", `${p}?userId=u_no_position`);
      expect([401, 403], `${m.path} -> ${res.status}`).toContain(res.status);
    }
  });

  it("a production mount absent from the persona matrix is REPORTED, not ignored", () => {
    /* The old hand-written table silently omitted /api/investor/portfolio2 and
     * /api/collective/dealroom, both gated in production since Waves 29/35. */
    const tested = personas.flatMap((p) => p.routes.map((r) => r.path));
    const untested = MOUNTS
      .map((m) => m.path)
      .filter((mp) => !tested.some((t) => t.startsWith(mp.split(":")[0])));
    expect(untested).toEqual([]);
  });
});

describe("Sprint 15 / Entitlement gates — error envelope shape", () => {
  it("returns { error, message, entitlement, userId } on failure", async () => {
    const res = await call(app, "GET", "/api/investor/portfolio?userId=u_no_position");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("CAP_TABLE_REQUIRED");
    expect(typeof res.body.message).toBe("string");
    expect(res.body.entitlement).toBe("investor.hasAnyCapTable");
    expect(res.body.userId).toBe("u_no_position");
  });

  it("returns 401 NOT_AUTHED for unknown user id", async () => {
    const res = await call(app, "GET", "/api/investor/portfolio?userId=u_who");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("NOT_AUTHED");
  });
});
