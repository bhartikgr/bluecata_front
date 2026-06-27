/* v25.45.1 GPT-5.5 Blocker 2 regression — when a founder hits the canonical
 * path /founder/billing, the app redirects to
 *   /founder/settings?tab=billing-subscription
 * and the Settings page must mount the Billing tab automatically. Before this
 * fix, Settings.tsx had `useState("profile")` with no URL parsing, so the
 * redirect landed on Profile instead and neither the Bug E auto-refresh nor
 * the Bug F reconcile-on-mount fired.
 *
 * This is a code-level regression because the actual tab selection happens in
 * a React component in the client bundle. We verify two contracts here:
 *
 *   1. The TAB_ALIAS map and initialTab logic exist in Settings.tsx source.
 *   2. The TAB_ALIAS includes the "billing-subscription" -> "billing" mapping.
 *   3. The useEffect that syncs URL <-> state exists.
 *   4. The /founder/billing route redirects to ?tab=billing-subscription.
 *
 * If a future refactor removes any of these, the test fails and the URL
 * deep-link contract breaks.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SETTINGS_PATH = resolve(process.cwd(), "client/src/pages/founder/Settings.tsx");
const APP_PATH = resolve(process.cwd(), "client/src/App.tsx");

describe("v25.45.1 GPT-5.5 Blocker 2 — Settings.tsx URL ?tab= contract", () => {
  const src = readFileSync(SETTINGS_PATH, "utf8");

  it("TAB_ALIAS map exists and maps 'billing-subscription' to 'billing'", () => {
    expect(src).toMatch(/TAB_ALIAS\s*:\s*Record<string,\s*string>/);
    expect(src).toMatch(/"billing-subscription"\s*:\s*"billing"/);
  });

  it("Settings.tsx initializes state from the URL ?tab= query string", () => {
    expect(src).toMatch(/new URLSearchParams\(window\.location\.search\)\.get\("tab"\)/);
    expect(src).toMatch(/useState\(initialTab\)/);
  });

  it("Settings.tsx syncs URL ?tab= when state changes (replaceState in useEffect)", () => {
    expect(src).toMatch(/window\.history\.replaceState/);
  });

  it("Unknown ?tab= value falls back to 'profile'", () => {
    expect(src).toMatch(/TAB_ALIAS\[raw\]\s*\?\?\s*"profile"/);
  });
});

describe("v25.45.1 GPT-5.5 Blocker 2 — /founder/billing redirect target", () => {
  const src = readFileSync(APP_PATH, "utf8");

  it("/founder/billing redirects to /founder/settings?tab=billing-subscription", () => {
    expect(src).toMatch(/\/founder\/billing/);
    expect(src).toMatch(/Redirect to="\/founder\/settings\?tab=billing-subscription"/);
  });
});
