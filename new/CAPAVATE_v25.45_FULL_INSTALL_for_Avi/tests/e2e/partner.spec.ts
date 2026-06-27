/**
 * Wave F3 — Partner / Consortium E2E suite (5 tests).
 *
 * Persona: partner@keiretsu.ca (Keiretsu consortium partner).
 * Real test-ids referenced:
 *   - Partner login: form-partner-login, input-partner-email,
 *                    input-partner-password, button-submit-partner-login
 *   - Partner signup CTA: button-apply-consortium, link-partner-apply
 *   - Consortium apply: button-consortium-apply-submit (POST /api/consortium-apply)
 *   - Header / homepage: link-header-partner-login, link-mobile-partner-login,
 *                        link-footer-partner-login
 */
import { test, expect } from "@playwright/test";
import { login, gotoHash, firstOf } from "./fixtures/helpers";

test.describe("Partner persona", () => {
  test("partner.login-page-renders — form not 404", async ({ page }) => {
    await gotoHash(page, "/partner/login");

    const notFound = page
      .locator(':text("404"), :text("Not Found"), [data-testid="not-found"]')
      .first();
    expect(await notFound.count()).toBe(0);

    await expect(page.locator('[data-testid="form-partner-login"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="input-partner-email"]')).toBeVisible();
    await expect(page.locator('[data-testid="input-partner-password"]')).toBeVisible();
  });

  test("partner.login-works — lands on /partner/dashboard", async ({ page }) => {
    await login(page, "partner");
    await expect(page).toHaveURL(/partner\/dashboard|collective\/partner/i, { timeout: 15_000 });
  });

  test("partner.signup-cta-links-apply — Apply button routes to /apply/consortium", async ({ page }) => {
    await gotoHash(page, "/partner/signup");

    const applyCta = firstOf(page, [
      '[data-testid="button-apply-consortium"]',
      '[data-testid="link-partner-apply"]',
      '[data-testid="link-apply-from-banner"]',
      'a[href*="apply/consortium"]',
    ]);
    await expect(applyCta).toBeVisible({ timeout: 10_000 });
    await applyCta.click();

    await expect(page).toHaveURL(/apply\/consortium/i, { timeout: 10_000 });
  });

  // Wave F4 FIX F4-3 (E2E-7, P0) — CLOSED. The public REST alias
  // `POST /api/consortium-applications` is now registered alongside the
  // canonical `/api/public/consortium/apply` (both share the same
  // rate-limited, no-auth handler in `server/consortiumApplyStore.ts`).
  // Regression coverage: `server/__tests__/consortiumApplyAnonymous.test.ts`.
  test("partner.consortium-apply-public-works — anon visit + submit does not 401", async ({ page }) => {
    // Visit /apply/consortium WITHOUT logging in — the form must render.
    await gotoHash(page, "/apply/consortium");

    const submitBtn = page.locator('[data-testid="button-consortium-apply-submit"]');
    await expect(submitBtn, "Public consortium-apply form must render anonymously").toBeVisible({
      timeout: 15_000,
    });

    // The headline contract: the *page* is reachable without auth. Submitting
    // the full form requires the server-validated payload schema that we
    // intentionally avoid here. Instead, probe the API endpoint directly:
    // POST with an empty body should NOT return 401/403 (anonymous access is
    // allowed; we expect 400 / 422 / 200, but never an auth gate).
    const res = await page.request.post("/api/consortium-applications", {
      headers: { "content-type": "application/json" },
      data: { _e2e: true },
      failOnStatusCode: false,
    });
    const status = res.status();
    expect(
      status,
      `Public POST /api/consortium-applications returned ${status}; must not be auth-gated`,
    ).not.toBe(401);
    expect(status).not.toBe(403);
    expect(status).toBeLessThan(500);
  });

  test("partner.discoverability — homepage header has Consortium Partners link", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 2000 }).catch(() => {});

    // Header dropdown trigger.
    const trigger = page.locator(
      'header [aria-haspopup="menu"], header button:has-text("Sign in")',
    ).first();
    if (await trigger.count()) await trigger.hover().catch(() => {});

    const link = firstOf(page, [
      '[data-testid="link-header-partner-login"]',
      '[data-testid="link-footer-partner-login"]',
      '[data-testid="link-footer-partner-signin"]',
      '[data-testid="link-mobile-partner-login"]',
      'a[href*="partner/login"]',
    ]);
    await expect(link, "Homepage must expose a Consortium Partner sign-in link").toBeVisible({
      timeout: 10_000,
    });
  });
});
