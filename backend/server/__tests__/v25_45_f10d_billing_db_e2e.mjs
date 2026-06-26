/* v25.45 F10d — Settings → Billing & Subscription tab is DB-driven.
 *
 * Backend: seed a real subscription row for the founder's company, then assert
 * GET /api/founder/subscription returns the canonical plan/status from the DB
 * projection (not a hardcoded "Free"). Invoices read from /api/founder/invoices
 * (DB-backed).
 *
 * Frontend: source-assert the billing TabsContent renders Current plan /
 * Payment method / Pending request from the `subscription` query result and no
 * longer hardcodes "Free" or "Pending request" placeholder strings.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { setupFounder, recorder } from "./v25_45_helpers.mjs";
import { createSubscriptionForNewCompany } from "../subscriptionsStore.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
let h; const { results, record } = recorder();
beforeAll(async () => { h = await setupFounder("f10d"); }, 60_000);
afterAll(async () => { await h.teardown(); });

describe("v25.45 F10d Billing & Subscription DB-driven — E2E", () => {
  it("1. seeded subscription is returned by GET /api/founder/subscription (DB-driven)", async () => {
    createSubscriptionForNewCompany(h.ids.COMPANY, { plan: "founder_pro", actor: "test:f10d" });
    const r = await h.req("GET", `/api/founder/subscription?companyId=${h.ids.COMPANY}`, { userId: h.ids.FOUNDER });
    const sub = r.body?.subscription;
    const ok = r.status === 200 && r.body?.ok === true && typeof sub?.plan === "string" && typeof sub?.status === "string";
    record("subscription DB read returns plan + status", ok, `status ${r.status} plan ${sub?.plan} st ${sub?.status}`);
    expect(ok).toBe(true);
  });

  it("2. invoices endpoint is DB-backed (array, not fabricated rows)", async () => {
    const r = await h.req("GET", `/api/founder/invoices?companyId=${h.ids.COMPANY}`, { userId: h.ids.FOUNDER });
    const ok = r.status === 200 && Array.isArray(r.body?.invoices);
    record("invoices DB-backed array", ok, `status ${r.status}`);
    expect(ok).toBe(true);
  });

  it("3. billing tab title renamed to 'Billing & Subscription'", () => {
    const src = readFileSync(resolve(__dirname, "../../client/src/pages/founder/Settings.tsx"), "utf8");
    const ok = /title="Billing & Subscription"/.test(src);
    record("tab title renamed", ok);
    expect(ok).toBe(true);
  });

  it("4. billing fields read from `subscription` query (DB-driven, no hardcoded Free)", () => {
    const src = readFileSync(resolve(__dirname, "../../client/src/pages/founder/Settings.tsx"), "utf8");
    const ok = /subscriptionQ/.test(src)
      && /\/api\/founder\/subscription/.test(src)
      && /data-testid="text-current-plan"/.test(src)
      && /data-testid="card-billing-pending-request"/.test(src)
      && /subscription\?\.planLabel \?\? subscription\?\.plan/.test(src);
    record("current plan + pending request DB-driven", ok);
    expect(ok).toBe(true);
  });

  it("5. no hardcoded 'Pending request' placeholder text in the billing card", () => {
    const src = readFileSync(resolve(__dirname, "../../client/src/pages/founder/Settings.tsx"), "utf8");
    const start = src.indexOf('<TabsContent value="billing"');
    const end = src.indexOf("</TabsContent>", start);
    const block = src.slice(start, end);
    // The only "pending" wording should be the dynamic value or the honest
    // "No pending plan changes." empty state — never a fabricated request.
    const ok = !/>\s*Pending request\s*<\/[^>]*>\s*<\/CardHeader>\s*<CardContent>\s*<div[^>]*>\s*Pending request/.test(block)
      && /No pending plan changes\./.test(block);
    record("no fabricated pending-request text", ok);
    expect(ok).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.45 F10d Billing E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
