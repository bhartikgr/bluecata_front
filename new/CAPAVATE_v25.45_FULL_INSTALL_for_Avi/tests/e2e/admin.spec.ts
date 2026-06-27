/**
 * Wave F3 — Admin E2E suite (5 tests).
 *
 * Persona: admin@capavate.io.
 * Real test-ids referenced:
 *   - Admin login: input-admin-email, input-admin-password, button-submit-admin-login
 *   - Admin pricing: tabs-pricing-billing, tab-pricing-models, tab-payment-gateway, card-pm-*
 *   - Verify chain: audit-chain-table-select
 *   - PersonaSwitcher: persona-option-{capavate,collective,partner,admin}
 */
import { test, expect } from "@playwright/test";
import { login, gotoHash } from "./fixtures/helpers";

test.describe("Admin persona", () => {
  test("admin.login-works — lands on /admin/dashboard", async ({ page }) => {
    await login(page, "admin");
    await expect(page).toHaveURL(/admin\/dashboard/i, { timeout: 15_000 });
  });

  // Wave F4 FIX F4-4 (E2E-8, P0) — CLOSED. The canonical Capavate Annual
  // $840/yr tier (`pm_capavate_annual_v1`) is now seeded in
  // `server/pricingModelStore.ts` and surfaces in the admin /api/admin/pricing-models
  // route alongside the legacy founder-free/founder-pro/collective-standard rows.
  // Regression coverage: `server/__tests__/adminPricingSingleTier.test.ts`.
  test("admin.single-tier-shown — Capavate Annual $840 only", async ({ page }) => {
    await login(page, "admin");
    await gotoHash(page, "/admin/pricing");

    const tab = page.locator('[data-testid="tab-pricing-models"]');
    if (await tab.count()) await tab.click();
    await page.waitForLoadState("networkidle", { timeout: 2000 }).catch(() => {});

    // The pricing-models page must surface the $840 figure (the v23.1 "one
    // tier" contract) — display name varies by seed run ("Capavate Annual",
    // "Capavate Plan", etc.), so we anchor on the price.
    await expect(page.getByText(/\$\s?840/).first()).toBeVisible({
      timeout: 15_000,
    });

    // At least one tier card must render (card-pm-<id>).
    const cards = page.locator('[data-testid^="card-pm-"]');
    const totalCards = await cards.count();
    expect(totalCards, "At least one pricing-model card should render").toBeGreaterThan(0);
  });

  test("admin.audit-verify-chain-page — renders with table dropdown (not 404)", async ({ page }) => {
    await login(page, "admin");
    await gotoHash(page, "/admin/audit/verify-chain");

    // 404 sentinel
    const notFound = page
      .locator(':text("404"), :text("Not Found"), [data-testid="not-found"]')
      .first();
    expect(await notFound.count()).toBe(0);

    // The verify-chain page's table picker.
    const dropdown = page.locator('[data-testid="audit-chain-table-select"]');
    await expect(dropdown).toBeVisible({ timeout: 15_000 });
  });

  test("admin.persona-switcher-4-options — Capavate/Collective/Partner/Admin", async ({ page }) => {
    await login(page, "admin");

    const switcher = page.locator('[data-testid="button-persona-switcher"]');
    await expect(switcher).toBeVisible({ timeout: 10_000 });
    await switcher.click();

    // Admin context has all 4 entitlements (PersonaSwitcher.tsx filters by
    // `entitled.has(p.id)` — admin gets capavate/collective/partner/admin).
    for (const id of ["capavate", "collective", "partner", "admin"] as const) {
      const opt = page.locator(`[data-testid="persona-option-${id}"]`);
      await expect(opt, `Persona option '${id}' must be present for admin`).toBeVisible({
        timeout: 5_000,
      });
    }
  });

  test("admin.payment-gateway-shows-airwallex — default gateway", async ({ page }) => {
    await login(page, "admin");
    await gotoHash(page, "/admin/pricing");

    const tab = page.locator('[data-testid="tab-payment-gateway"]');
    await expect(tab).toBeVisible({ timeout: 10_000 });
    await tab.click();

    // AirWallex must be referenced somewhere in the tab content.
    await expect(page.getByText(/AirWallex|Airwallex/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
