/* v25.43 F13 — E2E: a fresh founder (no company) is routed to the
 * company-creation step FIRST, not straight to the paywall.
 *
 * Contract (App.tsx RequireActiveSubscription gate):
 *   BEFORE: if (!companyId) <Redirect to="/founder/subscribe" />
 *   AFTER:  if (!companyId) <Redirect to="/company-profile?onboarding=1" />
 * The INACTIVE_STATUSES redirect (a DIFFERENT state machine) must STILL go to
 * /founder/subscribe.
 *
 * Two layers:
 *  (1) HTTP — POST /api/auth/signup creates a fresh founder, and GET
 *      /api/auth/me confirms that founder has ZERO companies. That is exactly
 *      the runtime condition (`!companyId`) that triggers the App-level
 *      redirect, so we prove the precondition end-to-end against the real
 *      server.
 *  (2) Source — the App.tsx gate is client-side wouter routing (not HTTP
 *      reachable), so we assert the gate redirects a company-less founder to
 *      /company-profile?onboarding=1 (NOT /founder/subscribe), that the
 *      inactive-subscription redirect still targets /founder/subscribe, and
 *      that /company-profile renders the founder Company page so the onboarding
 *      step has a real surface.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { registerRoutes } from "../routes.ts";
import { getDb } from "../db/connection.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = resolve(__dirname, "../../client/src/App.tsx");
const COMPANY_PAGE = resolve(__dirname, "../../client/src/pages/founder/Company.tsx");

let app, server, port;
const STAMP = Date.now();
const EMAIL = `v2543_f13_${STAMP}@test.example`;

const results = [];
function record(name, pass, extra = "") {
  results.push({ name, pass });
  // eslint-disable-next-line no-console
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${extra ? " - " + extra : ""}`);
}

function call(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : undefined;
    const h = { ...headers };
    if (data) { h["content-type"] = "application/json"; h["content-length"] = String(Buffer.byteLength(data)); }
    const r = http.request({ hostname: "127.0.0.1", port, path, method, headers: h }, (res) => {
      let raw = "";
      const setCookie = res.headers["set-cookie"];
      res.on("data", (c) => (raw += c));
      res.on("end", () => { try { resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : {}, setCookie }); } catch { resolve({ status: res.statusCode ?? 0, body: raw, setCookie }); } });
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

describe("v25.43 F13 — company-first onboarding redirect", () => {
  beforeAll(async () => {
    getDb();
    app = express();
    app.use(express.json());
    server = http.createServer(app);
    await registerRoutes(server, app);
    await new Promise((resolve) => server.listen(0, () => { port = server.address().port; resolve(); }));
  }, 30_000);

  afterAll(async () => {
    await new Promise((resolve) => server.close(() => resolve()));
  });

  it("POST /api/auth/signup creates a fresh founder with ZERO companies", async () => {
    const signup = await call("POST", "/api/auth/signup", {
      email: EMAIL, name: "F13 Founder", password: "Sup3r$ecret!", portal: "founder",
    });
    const ok = signup.status >= 200 && signup.status < 300;
    record("signup 2xx", ok, `status ${signup.status}`);
    expect(ok).toBe(true);

    // Carry the session cookie to /api/auth/me to inspect the founder context.
    const cookie = (signup.setCookie || []).map((c) => c.split(";")[0]).join("; ");
    const me = await call("GET", "/api/auth/me", undefined, cookie ? { cookie } : {});
    const companies = me.body?.founder?.companies ?? [];
    const zeroCompanies = Array.isArray(companies) && companies.length === 0;
    record("fresh founder has no companies", zeroCompanies, `companies=${JSON.stringify(companies)}`);
    expect(zeroCompanies).toBe(true);
  });

  it("App.tsx gate redirects a company-less founder to /company-profile?onboarding=1 (NOT subscribe)", () => {
    const src = readFileSync(APP, "utf8");
    // The !companyId branch must target /company-profile?onboarding=1.
    const noCompanyBranch = src.match(/if \(!companyId\) \{[\s\S]{0,200}?<Redirect to="([^"]+)" \/>/);
    const target = noCompanyBranch ? noCompanyBranch[1] : "";
    const ok = target === "/company-profile?onboarding=1";
    record("no-company redirect target", ok, target || "no match");
    expect(ok).toBe(true);
  });

  it("the INACTIVE_STATUSES redirect still targets /founder/subscribe", () => {
    const src = readFileSync(APP, "utf8");
    const inactive = src.match(/INACTIVE_STATUSES\.has\(status\)\) \{[\s\S]{0,160}?<Redirect to="([^"]+)" \/>/);
    const target = inactive ? inactive[1] : "";
    const ok = target === "/founder/subscribe";
    record("inactive-subscription redirect preserved", ok, target || "no match");
    expect(ok).toBe(true);
  });

  it("/company-profile renders the founder Company page (onboarding surface)", () => {
    const src = readFileSync(APP, "utf8");
    const ok = /<Route path="\/company-profile">[\s\S]{0,160}?<FounderCompany \/>/.test(src);
    record("/company-profile -> FounderCompany", ok);
    expect(ok).toBe(true);
  });

  it("Company.tsx onboarding mode shows the welcome header and forwards to the dashboard on create (R3-8)", () => {
    // v25.43 R3-8 UPDATE: company creation now forwards to /founder/dashboard
    // (NOT /founder/subscribe). The founder subscribes later via the sidebar
    // Billing item or an upgrade CTA — the paywall is no longer a forced step.
    const src = readFileSync(COMPANY_PAGE, "utf8");
    const header = /Welcome to Capavate\. Create your company first\./.test(src);
    const reads = /get\("onboarding"\) === "1"/.test(src);
    const forwards = /onCreated=\{\(\) => navigate\("\/founder\/dashboard"\)\}/.test(src);
    const ok = header && reads && forwards;
    record("onboarding header + ?onboarding=1 + forward to dashboard", ok, `header=${header} reads=${reads} forwards=${forwards}`);
    expect(ok).toBe(true);
  });

  it("summary", () => {
    console.log(`\n  v25.43 F13 E2E: ${results.filter((r) => r.pass).length}/${results.length} assertions passed\n`);
    expect(results.every((r) => r.pass)).toBe(true);
  });
});
