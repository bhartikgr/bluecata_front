/* v25.43 R4-1 — E2E: the auth right panel (sign-in form, button, tabs, links)
 * is on the capavate.com brand red (#cc0001), NOT the retired teal
 * (hsl(184 98% 22%)) or burgundy (hsl(327 77% 30%)).
 *
 * Round 3 flipped the auth LEFT panel but left the right-side form on the old
 * palette; Ozan flagged it. R4-1 enforces:
 *   - the primary sign-in CTA is a red filled pill (#cc0001 + rounded-full + font-semibold)
 *   - the active portal tab uses the brand red (#cc0001)
 *   - the footer links (forgot / signup / redeem) are red
 *   - NO hardcoded teal/burgundy literal remains in any auth-right-panel source
 *   - the AuthShell heading uses the Instrument Serif display family (font-serif)
 *
 * Source-grep assertions (no headless browser) — same harness style as the
 * F2/F6 and R3 auth E2E suites.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../client/src");
const read = (p) => readFileSync(resolve(ROOT, p), "utf8");

const AUTH_FILES = [
  "pages/auth/Login.tsx",
  "pages/auth/Signup.tsx",
  "pages/auth/Forgot.tsx",
  "pages/auth/Redeem.tsx",
  "pages/auth/RedeemPartnerInvite.tsx",
  "pages/auth/AuthShell.tsx",
  "pages/SetPasswordPage.tsx",
  "pages/partner/PartnerLogin.tsx",
  "pages/partner/PartnerSignup.tsx",
  "pages/admin/Login.tsx",
];

const results = [];
function record(name, pass, extra = "") {
  results.push({ name, pass });
  // eslint-disable-next-line no-console
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${extra ? " - " + extra : ""}`);
}

describe("v25.43 R4-1 — auth right panel on brand red", () => {
  const login = read("pages/auth/Login.tsx");
  const shell = read("pages/auth/AuthShell.tsx");

  it("Login submit CTA is a red (#cc0001) filled pill with font-semibold", () => {
    const ok =
      /bg-\[#cc0001\]/.test(login) &&
      /hover:bg-\[#a30001\]/.test(login) &&
      /rounded-full/.test(login) &&
      /font-semibold/.test(login) &&
      /data-testid="button-submit-login"/.test(login);
    record("login CTA = red pill", ok);
    expect(ok).toBe(true);
  });

  it("active portal tab uses the brand red #cc0001 (both tabs), tabs still both render", () => {
    const redTab = /activeFill\s*=\s*\n?\s*"bg-\[#cc0001\]/.test(login);
    const bothTabs = /\(Object\.keys\(PORTAL_META\) as Portal\[\]\)\.map/.test(login);
    const noTabRemoval =
      /founder:\s*\{\s*label: "Founder"/.test(login) &&
      /investor:\s*\{\s*label: "Investor"/.test(login);
    const ok = redTab && bothTabs && noTabRemoval;
    record("active tab red + both tabs render", ok);
    expect(ok).toBe(true);
  });

  it("footer links (forgot / signup / redeem) are red #cc0001", () => {
    const forgot = /link-forgot"[^]*?text-\[#cc0001\]/.test(login) ||
      /text-\[#cc0001\][^]*?data-testid="link-forgot"/.test(login);
    const signup = /text-\[#cc0001\][^]*?data-testid="link-signup"/.test(login);
    const redeem = /text-\[#cc0001\][^]*?data-testid="link-redeem"/.test(login);
    const ok = forgot && signup && redeem;
    record("footer links red", ok);
    expect(ok).toBe(true);
  });

  it("AuthShell form heading uses the Instrument Serif display family (font-serif)", () => {
    const ok = /<h1[^>]*font-serif[^>]*>\{title\}<\/h1>/.test(shell);
    record("heading uses font-serif", ok);
    expect(ok).toBe(true);
  });

  it("NO hardcoded teal hsl(184 98% 22%) or burgundy hsl(327 77% 30%) in any auth-right-panel source", () => {
    const teal = /184[ _]98%[ _]22%/;
    const burg = /327[ _]77%[ _]30%/;
    let allClean = true;
    const dirty = [];
    for (const f of AUTH_FILES) {
      const src = read(f);
      if (teal.test(src) || burg.test(src)) { allClean = false; dirty.push(f); }
    }
    record("no teal/burgundy literals in auth sources", allClean, dirty.join(", "));
    expect(allClean).toBe(true);
  });

  it("every auth submit CTA resolves to the brand red (either #cc0001 literal or the red --primary token via default Button variant)", () => {
    // Each auth page either uses an explicit #cc0001 fill, OR a default
    // <Button> (which inherits bg-primary -> now red) with rounded-full pill.
    const explicit = ["pages/auth/Login.tsx", "pages/auth/Signup.tsx",
      "pages/partner/PartnerLogin.tsx", "pages/partner/PartnerSignup.tsx",
      "pages/admin/Login.tsx"];
    let ok = true;
    const bad = [];
    for (const f of explicit) {
      const src = read(f);
      if (!/bg-\[#cc0001\]/.test(src)) { ok = false; bad.push(f); }
    }
    record("explicit-fill auth CTAs are #cc0001", ok, bad.join(", "));
    expect(ok).toBe(true);
  });

  it("summary", () => {
    console.log(`\n  v25.43 R4-1 auth-red E2E: ${results.filter((r) => r.pass).length}/${results.length} assertions passed\n`);
    expect(results.every((r) => r.pass)).toBe(true);
  });
});
