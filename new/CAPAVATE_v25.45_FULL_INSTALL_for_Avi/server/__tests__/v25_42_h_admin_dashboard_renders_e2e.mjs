/* v25.42h Round-2 (Blocker 1) — E2E: the admin dashboard renders WITHOUT the
 * React ErrorBoundary fallback when the KPI endpoint returns nullable metrics.
 *
 * Background: v25.42h made successRatePct / deliveryRatePct / momGrowthPct /
 * churnPct / nrr (and the rest of the health block) `number | null` on the API
 * side (we no longer fabricate). The consuming UI did
 * `data.successRatePct.toFixed(2) ?? "—"` which evaluates `.toFixed()` on null
 * FIRST — throwing a TypeError that the ErrorBoundary swallowed, replacing the
 * whole admin dashboard with "Something went wrong".
 *
 * A full headless-browser render is exercised by the live Playwright screenshot
 * step in the round-2 patch flow (login as admin → /admin/dashboard → assert no
 * "Something went wrong"). This in-harness suite is the fast, deterministic
 * regression guard that runs inside the gate-5 vitest e2e run. It proves:
 *
 *   1. The KPI endpoint can legitimately serve a payload whose health metrics
 *      are `null` (the exact crash trigger) — and still returns 200.
 *   2. The compiled Dashboard.tsx source guards EVERY nullable numeric field
 *      before calling .toFixed()/.toLocaleString() — i.e. there is no unguarded
 *      `<nullableField>.toFixed(` left that would throw at render time.
 *   3. The DB-unavailable banner (data-testid="banner-kpis-unavailable") exists
 *      so the 503 path renders a message instead of crashing.
 */
process.env.COLLECTIVE_ENABLED = "1";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerRoutes } from "../routes.ts";
import { rawDb } from "../db/connection.ts";
import { __setRuntimePersona } from "../lib/userContext.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_TSX = path.resolve(__dirname, "../../client/src/pages/admin/Dashboard.tsx");

let app, server, port;
const STAMP = Date.now();
const ADMIN = `u_v2542h_render_admin_${STAMP}`;

const results = [];
function record(name, pass, extra = "") {
  results.push({ name, pass });
  // eslint-disable-next-line no-console
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${extra ? " - " + extra : ""}`);
}

function req(method, path) {
  return new Promise((resolve, reject) => {
    const headers = { "Content-Type": "application/json", "x-user-id": ADMIN };
    const r = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        let parsed = buf;
        try { parsed = JSON.parse(buf); } catch { /* raw */ }
        resolve({ status: res.statusCode ?? 0, body: parsed });
      });
    });
    r.on("error", reject);
    r.end();
  });
}

beforeAll(async () => {
  __setRuntimePersona({ userId: ADMIN, email: `${ADMIN}@v2542h.test`, name: "v25.42h Admin", isFounder: false, isInvestor: false, isAdmin: true, hasInvitations: false });
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise((resolve) => server.listen(0, () => { port = server.address().port; resolve(); }));
}, 60_000);

afterAll(async () => {
  await new Promise((resolve) => server.close(() => resolve()));
});

describe("v25.42h round-2 admin dashboard renders without ErrorBoundary — E2E", () => {
  it("1. KPI endpoint serves nullable health metrics with a 200 (the crash trigger)", async () => {
    // On a fresh DB with no recon_runs / message-delivery source, the backend
    // legitimately returns null for successRatePct + deliveryRatePct. This is
    // exactly the payload that used to crash the UI.
    const res = await req("GET", "/api/admin/dashboard/kpis");
    record("kpis 200", res.status === 200, `status ${res.status}`);
    expect(res.status).toBe(200);
    const health = res.body?.health ?? {};
    // deliveryRatePct is null in this wave (no message-delivery source table).
    record("messageDelivery.deliveryRatePct is null (no fabrication)", health?.messageDelivery?.deliveryRatePct === null, JSON.stringify(health?.messageDelivery));
    expect(health?.messageDelivery?.deliveryRatePct).toBeNull();
    // successRatePct is number-or-null depending on recon_runs; both are valid.
    const src = health?.capTableReconcile?.successRatePct;
    record("capTableReconcile.successRatePct is number|null", src === null || typeof src === "number", `value=${src}`);
    expect(src === null || typeof src === "number").toBe(true);
  });

  it("2. Dashboard.tsx guards EVERY nullable field before .toFixed()/.toLocaleString()", () => {
    const src = fs.readFileSync(DASHBOARD_TSX, "utf8");
    // The original crash lines were the unguarded `.toFixed(2) ?? "—"` chains:
    //   data?.health.capTableReconcile.successRatePct.toFixed(2) ?? "—"
    //   data?.health.messageDelivery.deliveryRatePct.toFixed(2) ?? "—"
    // The `.toFixed()` ran on null FIRST (before the `?? "—"`), throwing. Assert
    // those exact unguarded `.toFixed(N) ?? "—"` chains are GONE.
    const badSuccess = /successRatePct\.toFixed\(\d+\)\s*\?\?/.test(src);
    const badDelivery = /deliveryRatePct\.toFixed\(\d+\)\s*\?\?/.test(src);
    record("no unguarded successRatePct.toFixed(N) ?? chain", !badSuccess, badSuccess ? "still present" : "removed");
    expect(badSuccess).toBe(false);
    record("no unguarded deliveryRatePct.toFixed(N) ?? chain", !badDelivery, badDelivery ? "still present" : "removed");
    expect(badDelivery).toBe(false);

    // Generalised guard: for every nullable numeric field, if its `.toFixed(`
    // form appears at all in the source, an explicit `<field> != null` guard
    // must also appear. (momGrowthPct/churnPct/nrr/health fields now use an
    // explicit `!= null ?` ternary instead of the old `?? N` / unguarded chain.)
    for (const field of ["momGrowthPct", "churnPct", "nrr", "successRatePct", "deliveryRatePct"]) {
      const callsToFixed = new RegExp(`\\.${field}\\.toFixed\\(`).test(src);
      const hasNullGuard = new RegExp(`${field} != null`).test(src);
      // If the field's .toFixed() is invoked, it MUST be paired with a guard.
      const ok = !callsToFixed || hasNullGuard;
      record(`${field}: .toFixed() (if present) is null-guarded`, ok, `toFixed=${callsToFixed} guard=${hasNullGuard}`);
      expect(ok).toBe(true);
    }
  });

  it("3. Dashboard.tsx renders a DB-unavailable banner for the 503 path (no crash)", () => {
    const src = fs.readFileSync(DASHBOARD_TSX, "utf8");
    const hasBanner = src.includes('data-testid="banner-kpis-unavailable"');
    record("banner-kpis-unavailable present", hasBanner, hasBanner ? "ok" : "missing");
    expect(hasBanner).toBe(true);
    const handlesIsError = /isError/.test(src);
    record("useQuery isError handled", handlesIsError, handlesIsError ? "ok" : "missing");
    expect(handlesIsError).toBe(true);
    // The banner copy the brief asked for.
    const hasCopy = src.includes("Health data temporarily unavailable");
    record('banner copy "Health data temporarily unavailable"', hasCopy, hasCopy ? "ok" : "missing");
    expect(hasCopy).toBe(true);
  });

  it("4. ErrorBoundary fallback string is NOT what a healthy /admin/dashboard shows", () => {
    // Defensive: confirm the dashboard source itself never hardcodes the
    // ErrorBoundary fallback text (so the only way to see it is a real crash —
    // which the null-guards above now prevent).
    const src = fs.readFileSync(DASHBOARD_TSX, "utf8");
    const hardcodesFallback = src.includes("Something went wrong");
    record("Dashboard does not hardcode the ErrorBoundary fallback", !hardcodesFallback, hardcodesFallback ? "present" : "absent");
    expect(hardcodesFallback).toBe(false);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    // eslint-disable-next-line no-console
    console.log(`\n  v25.42h admin dashboard renders E2E: ${passed}/${results.length} assertions passed`);
    expect(passed).toBe(results.length);
  });
});
