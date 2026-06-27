/* v25.43 R3-8 — E2E (source assertion): a founder with NO registered company
 * must never see the Subscribe page — they are redirected to the company
 * creation step.
 *
 * /founder/subscribe is a CLIENT route (wouter), so the guard lives in
 * client/src/pages/founder/Subscribe.tsx. This test proves the redirect is
 * wired in source:
 *   1. Subscribe.tsx imports `Redirect` from wouter.
 *   2. It computes a no-company condition from the entitlement context
 *      (`companies.length === 0`).
 *   3. When that condition holds it returns <Redirect to="/company-profile?onboarding=1" />.
 *
 * It also verifies the auth Login flow still routes no-company founders to the
 * same onboarding step (round-2 behaviour preserved), and that company creation
 * now forwards to /founder/dashboard (R3-8), NOT /founder/subscribe.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(__dirname, "../../client/src");
const subscribe = readFileSync(join(CLIENT, "pages/founder/Subscribe.tsx"), "utf8");
const login = readFileSync(join(CLIENT, "pages/auth/Login.tsx"), "utf8");
const company = readFileSync(join(CLIENT, "pages/founder/Company.tsx"), "utf8");

const results = [];
function record(name, pass, extra = "") {
  results.push({ name, pass });
  // eslint-disable-next-line no-console
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${extra ? " - " + extra : ""}`);
}

describe("v25.43 R3-8 — Subscribe gate for no-company founders", () => {
  it("Subscribe.tsx imports Redirect from wouter", () => {
    const ok = /import\s*\{[^}]*\bRedirect\b[^}]*\}\s*from\s*"wouter"/.test(subscribe);
    record("imports Redirect from wouter", ok);
    expect(ok).toBe(true);
  });

  it("Subscribe.tsx computes a no-company condition", () => {
    const ok = /companies\.length\s*===\s*0/.test(subscribe);
    record("companies.length === 0 condition", ok);
    expect(ok).toBe(true);
  });

  it("Subscribe.tsx redirects no-company founders to the onboarding step", () => {
    const ok = /<Redirect\s+to="\/company-profile\?onboarding=1"\s*\/>/.test(subscribe);
    record("redirect to /company-profile?onboarding=1", ok);
    expect(ok).toBe(true);
  });

  it("Login.tsx still routes no-company founders to the onboarding step", () => {
    const ok = login.includes('/company-profile?onboarding=1');
    record("login routes no-company founders to onboarding", ok);
    expect(ok).toBe(true);
  });

  it("company creation forwards to /founder/dashboard (not /founder/subscribe)", () => {
    const toDashboard = company.includes('navigate("/founder/dashboard")');
    const noSubscribeForward = !company.includes('navigate("/founder/subscribe")');
    record("onCreated -> /founder/dashboard", toDashboard && noSubscribeForward);
    expect(toDashboard && noSubscribeForward).toBe(true);
  });

  it("summary", () => {
    console.log(
      `\n  v25.43 R3-8 E2E: ${results.filter((r) => r.pass).length}/${results.length} assertions passed\n`,
    );
    expect(results.every((r) => r.pass)).toBe(true);
  });
});
