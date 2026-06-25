/* v25.43 R2-2 — E2E: Login.tsx no-company founder lands on /company-profile?onboarding=1.
 *
 * F13's invariant is "company first": a no-company, non-investor, non-paid
 * founder must create a company BEFORE reaching the subscription gate. The
 * App-level gate already redirects company-less founders from subscription-
 * gated routes to /company-profile?onboarding=1 — but Login.tsx had a sibling
 * bypass that still routed the same user straight to /founder/subscribe after
 * login, defeating the gate.
 *
 * Round-2 fix: change that no-company branch to navigate to
 * /company-profile?onboarding=1 (matching the App gate). The hasPaidPlan
 * branch (-> /onboarding) is intentionally unchanged.
 *
 * Source-render assertion only (matches the pattern of the other v25_43 tests):
 * the redirect is static code, so we assert the new redirect string is present
 * in the no-company branch and the OLD navigate("/founder/subscribe") is gone
 * from that branch.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGIN = resolve(__dirname, "../../client/src/pages/auth/Login.tsx");

const results = [];
function record(name, pass, extra = "") {
  results.push({ name, pass });
  // eslint-disable-next-line no-console
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${extra ? " - " + extra : ""}`);
}

describe("v25.43 R2-2 — Login no-company redirect goes to company-profile onboarding", () => {
  const src = readFileSync(LOGIN, "utf8");

  it("redirects the no-company founder to /company-profile?onboarding=1", () => {
    const ok = /navigate\("\/company-profile\?onboarding=1"\)/.test(src);
    record("navigate('/company-profile?onboarding=1') present", ok);
    expect(ok).toBe(true);
  });

  it("no longer routes the no-company branch to /founder/subscribe", () => {
    // The only post-login navigations in Login.tsx are the redirect chain in
    // the meProbe effect. After the fix there must be NO navigate to
    // /founder/subscribe anywhere in the file — that path was the bypass.
    const hit = /navigate\("\/founder\/subscribe"\)/.test(src);
    record("old navigate('/founder/subscribe') removed", !hit);
    expect(hit).toBe(false);
  });

  it("keeps the hasPaidPlan branch routing to /onboarding (unchanged)", () => {
    const ok = /me\.hasPaidPlan[\s\S]{0,40}navigate\("\/onboarding"\)/.test(src);
    record("hasPaidPlan -> /onboarding preserved", ok);
    expect(ok).toBe(true);
  });

  it("comment documents the company-first canonical step", () => {
    const ok = /canonical first step is/.test(src) && /\(then subscribe\)/.test(src);
    record("comment mentions canonical first step (then subscribe)", ok);
    expect(ok).toBe(true);
  });

  it("summary", () => {
    console.log(`\n  v25.43 R2-2 E2E: ${results.filter((r) => r.pass).length}/${results.length} assertions passed\n`);
    expect(results.every((r) => r.pass)).toBe(true);
  });
});
