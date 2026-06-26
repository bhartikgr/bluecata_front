/* v25.45 F2 — Step 1 (Company Contact Info) persistence.
 *
 * Root cause fixed: the wizard re-sends the WHOLE contact block on every
 * keystroke; on a fresh company companyEmail="" tripped z.string().email()
 * and threw "Save failed · Invalid patch" on EVERY Step-1 edit. The patch
 * schema now accepts the empty string for companyEmail (still UI-required).
 *
 * Asserts: (a) editing the Name field while email is empty no longer 400s,
 * (b) the change persists to the durable profilestore_company_profile row
 * (the "restart + reload" guarantee), (c) a later valid email persists too.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupFounder, recorder } from "./v25_45_helpers.mjs";
let h; const { results, record } = recorder();
beforeAll(async () => { h = await setupFounder("f2s1"); }, 60_000);
afterAll(async () => { await h.teardown(); });

describe("v25.45 F2 Step 1 persistence — E2E", () => {
  it("1. edit Name with empty email → 200 (no Invalid patch)", async () => {
    const r = await h.patchProfile({ contact: {
      companyName: "Acme Robotics", companyEmail: "", industry: null,
      phoneCountryCode: "", phoneNumber: "", companyWebsiteUrl: "",
      numberOfEmployees: null, dateOfIncorporation: "", oneSentenceHeadliner: "",
      problemStatement: "", solutionStatement: "", logoDataUrl: null,
    }});
    const ok = r.status === 200 && r.body?.contact?.companyName === "Acme Robotics";
    record("Step1 name edit w/ empty email → 200", ok, `status ${r.status} ${JSON.stringify(r.body?.errors ?? "")}`);
    expect(ok).toBe(true);
  });
  it("2. change persisted durably (survives restart/reload)", async () => {
    const d = h.readDurable();
    const ok = d?.contact?.companyName === "Acme Robotics";
    record("durable row has companyName", ok, `name ${d?.contact?.companyName}`);
    expect(ok).toBe(true);
  });
  it("3. later valid email + industry + website persists", async () => {
    const r = await h.patchProfile({ contact: {
      companyName: "Acme Robotics", companyEmail: "hello@acme.com", industry: "robotics",
      phoneCountryCode: "US", phoneNumber: "5551234", companyWebsiteUrl: "https://acme.com",
      numberOfEmployees: null, dateOfIncorporation: "", oneSentenceHeadliner: "We build robots",
      problemStatement: "", solutionStatement: "", logoDataUrl: null,
    }});
    const d = h.readDurable();
    const ok = r.status === 200 && d?.contact?.companyEmail === "hello@acme.com"
      && d?.contact?.industry === "robotics" && d?.contact?.companyWebsiteUrl === "https://acme.com";
    record("valid email/industry/website persist", ok, `status ${r.status}`);
    expect(ok).toBe(true);
  });
  it("4. GET reload returns the persisted contact", async () => {
    const r = await h.getProfile();
    const ok = r.status === 200 && r.body?.contact?.companyEmail === "hello@acme.com";
    record("GET reload reflects persisted email", ok, `email ${r.body?.contact?.companyEmail}`);
    expect(ok).toBe(true);
  });
  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.45 F2 Step1 E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
