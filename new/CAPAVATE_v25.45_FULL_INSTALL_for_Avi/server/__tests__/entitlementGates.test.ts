/**
 * Sprint 15 D2 — Entitlement gate matrix.
 *
 * For each persona × gated route, assert pass/block + correct error code.
 * Uses a fresh Express app with the same middleware wiring as production
 * (loadUserContext + the gate helpers).
 *
 * Note: gates are activated by `?enforce=1` (sandbox-friendly default).
 */
import { describe, it, expect } from "vitest";
import express from "express";
import http from "node:http";

import { loadUserContext, requireEntitlement } from "../lib/requireEntitlement";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(loadUserContext);

  // Mirror production gates from server/routes.ts.
  function gate(...e: Parameters<typeof requireEntitlement>): import("express").RequestHandler {
    const mw = requireEntitlement(...e);
    return (req, res, next) => {
      if (String(req.query.enforce ?? "") !== "1") return next();
      return mw(req, res, next);
    };
  }
  app.use("/api/investor/portfolio",   gate("investor.hasAnyCapTable"));
  app.use("/api/investor/crm",         gate("investor.hasAnyCapTable"));
  app.use("/api/investor/messages",    gate("investor.hasAnyCapTable"));
  app.use("/api/investor/companies/:companyId", gate("investor.onCapTableOf"));
  app.use("/api/collective/applications", (req, res, next) => {
    if (req.method !== "POST") return next();
    return gate("investor.hasAnyCapTable")(req, res, next);
  });
  app.use("/api/collective/network",   gate("collective.active"));
  app.use("/api/founder/companies/:id/billing", gate("founder.ofCompany"));
  app.use("/api/admin/things",         gate("admin"));

  // Echo handlers — return user info so tests can assert allowed pathways too.
  app.all("/api/investor/portfolio",   (req, res) => res.json({ ok: true, route: "portfolio", userId: req.userContext?.userId }));
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
const E = "?enforce=1";

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
      { method: "GET",  path: "/api/investor/companies/co_novapay",         expect: "ALLOW" },
      { method: "GET",  path: "/api/collective/network",                    expect: "COLLECTIVE_INACTIVE" },
      { method: "POST", path: "/api/collective/applications",               expect: "ALLOW", body: { foo: 1 } },
    ],
  },
  // u_no_position — invited only.
  {
    id: "u_no_position",
    userId: "u_no_position",
    routes: [
      { method: "GET",  path: "/api/investor/portfolio",                    expect: "CAP_TABLE_REQUIRED" },
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
        const sep = r.path.includes("?") ? "&" : "?";
        const url = `${r.path}${sep}enforce=1&userId=${p.userId}`;
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

describe("Sprint 15 / Entitlement gates — sandbox-friendly default (no ?enforce=1 -> pass-through)", () => {
  it("when enforce flag is missing, gates do not fire (back-compat)", async () => {
    const res = await call(app, "GET", "/api/investor/portfolio?userId=u_no_position");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe("Sprint 15 / Entitlement gates — error envelope shape", () => {
  it("returns { error, message, entitlement, userId } on failure", async () => {
    const res = await call(app, "GET", "/api/investor/portfolio?enforce=1&userId=u_no_position");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("CAP_TABLE_REQUIRED");
    expect(typeof res.body.message).toBe("string");
    expect(res.body.entitlement).toBe("investor.hasAnyCapTable");
    expect(res.body.userId).toBe("u_no_position");
  });

  it("returns 401 NOT_AUTHED for unknown user id", async () => {
    const res = await call(app, "GET", "/api/investor/portfolio?enforce=1&userId=u_who");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("NOT_AUTHED");
  });
});
