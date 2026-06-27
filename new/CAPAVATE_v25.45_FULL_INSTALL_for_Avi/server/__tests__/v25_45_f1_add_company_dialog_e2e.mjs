/* v25.45 F1 — Add Company dialog.
 *  F1a Sector → Industry enum dropdown (single source of truth)
 *  F1b Plan picker removed
 *  F1c new marketing sub-copy
 *  F1d default plan resolved from active pricing model (not hardcoded), Free=active
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { setupFounder, recorder } from "./v25_45_helpers.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const dialogSrc = readFileSync(resolve(ROOT, "client/src/components/NewCompanyDialog.tsx"), "utf8");

let h; const { results, record } = recorder();
beforeAll(async () => { h = await setupFounder("f1"); }, 60_000);
afterAll(async () => { await h.teardown(); });

describe("v25.45 F1 Add Company dialog — E2E", () => {
  it("F1b: no Plan picker in source", () => {
    const ok = !dialogSrc.includes("ToggleGroup")
      && !dialogSrc.includes("toggle-group-new-company-plan")
      && !/toggle-plan-(free|pro|scale)/.test(dialogSrc);
    record("plan picker removed", ok);
    expect(ok).toBe(true);
  });
  it("F1a: Sector uses Industry enum dropdown", () => {
    const ok = dialogSrc.includes("INDUSTRY_OPTIONS")
      && dialogSrc.includes("select-new-company-sector")
      && !dialogSrc.includes('placeholder="Robotics"');
    record("sector bound to Industry enum", ok);
    expect(ok).toBe(true);
  });
  it("F1c: new company-creation sub-copy present (no 14-day trial)", () => {
    const ok = /managing your cap table, rounds, and investors/i.test(dialogSrc)
      && !dialogSrc.includes("14-day trial — no card required");
    record("new sub-copy present", ok);
    expect(ok).toBe(true);
  });
  it("F1b/F1d: create sends no plan field", () => {
    const ok = !/plan,\s*\/\//.test(dialogSrc) && !dialogSrc.includes("setPlan(");
    record("no plan field sent", ok);
    expect(ok).toBe(true);
  });
  it("F1d: new company defaults to active/Free (lands on Dashboard, not Subscribe)", async () => {
    // Create via the real endpoint with NO plan; assert subscription is active.
    const r = await h.req("POST", "/api/founder/companies/new", {
      userId: h.ids.FOUNDER,
      body: { name: "F1 Default Co", sector: "robotics", stage: "Seed", hq: "SF" },
    });
    const created = r.status === 201 && r.body?.ok && r.body?.companyId;
    record("company created without plan", !!created, `status ${r.status}`);
    expect(!!created).toBe(true);
    // Read subscription status for the new company.
    const sub = await h.req("GET", `/api/founder/companies/${r.body.companyId}/billing`, { userId: h.ids.FOUNDER });
    const planLabel = sub.body?.plan ?? sub.body?.billing?.plan ?? sub.body?.subscription?.plan;
    const status = sub.body?.subscriptionStatus ?? sub.body?.status ?? sub.body?.subscription?.status;
    const ok = sub.status === 200 && (status === "active" || /free/i.test(String(planLabel)));
    record("default plan active/Free", ok, `status=${status} plan=${planLabel}`);
    expect(ok).toBe(true);
  });
  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.45 F1 add-company E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
