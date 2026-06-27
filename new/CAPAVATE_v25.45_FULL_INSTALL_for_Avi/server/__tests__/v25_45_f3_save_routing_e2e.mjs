/* v25.45 F3c — post-save routing source contract + billing status source.
 *  - Company.tsx routes to /founder/dashboard when subscriptionStatus==='active'
 *    else /founder/subscribe (Free = active = Dashboard).
 *  - The billing endpoint now exposes subscriptionStatus (DB-driven).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { setupFounder, recorder } from "./v25_45_helpers.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const src = readFileSync(resolve(ROOT, "client/src/pages/founder/Company.tsx"), "utf8");

let h; const { results, record } = recorder();
beforeAll(async () => { h = await setupFounder("f3route"); }, 60_000);
afterAll(async () => { await h.teardown(); });

describe("v25.45 F3c save routing — E2E", () => {
  it("source: routes by subscriptionStatus active → dashboard, else subscribe", () => {
    const ok = src.includes('b?.subscriptionStatus === "active"')
      && src.includes('navigate(active ? "/founder/dashboard" : "/founder/subscribe")');
    record("post-save routing branch present", ok);
    expect(ok).toBe(true);
  });
  it("source: routing fires inside PATCH onSuccess (honest-save)", () => {
    const onSuccessIdx = src.indexOf("onSuccess: async () => {");
    const navIdx = src.indexOf('navigate(active ?');
    const ok = onSuccessIdx > -1 && navIdx > onSuccessIdx;
    record("routing after PATCH success", ok);
    expect(ok).toBe(true);
  });
  it("billing endpoint exposes subscriptionStatus mirroring the DB subscription", async () => {
    // Create a fresh company then read billing; assert the exposed
    // subscriptionStatus EQUALS the canonical subscriptionsStore row (proving
    // the value is DB-driven, not inferred). Note: in a bare test DB the Free
    // tier is not published so auto-activation no-ops and the row stays
    // pending_payment — in production founder_free IS published and flips to
    // active. We assert the field tracks the DB either way.
    const c = await h.req("POST", "/api/founder/companies/new", {
      userId: h.ids.FOUNDER, body: { name: "F3 Route Co", sector: "robotics" },
    });
    expect(c.status).toBe(201);
    const { getSubscription } = await import("../subscriptionsStore.ts");
    const dbStatus = getSubscription(c.body.companyId)?.status ?? null;
    const r = await h.req("GET", `/api/founder/companies/${c.body.companyId}/billing`, { userId: h.ids.FOUNDER });
    const ok = r.status === 200 && "subscriptionStatus" in (r.body ?? {})
      && r.body.subscriptionStatus === dbStatus;
    record("billing.subscriptionStatus mirrors DB", ok, `billing=${r.body?.subscriptionStatus} db=${dbStatus}`);
    expect(ok).toBe(true);
  });
  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.45 F3 save-routing E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
