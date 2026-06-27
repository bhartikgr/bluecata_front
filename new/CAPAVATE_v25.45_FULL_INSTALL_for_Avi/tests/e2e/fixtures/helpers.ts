/**
 * Shared helpers for Wave F3 Playwright tests.
 *
 * Selectors prefer real `data-testid` attributes captured from the v23.1 client
 * (see `client/src/pages/auth/Login.tsx`, `AdminLogin.tsx`, `PartnerLogin.tsx`).
 * If a future refactor renames a test-id, fix the production component first
 * AND update this helper — do not weaken the assertion.
 *
 * NEVER import production server code from here — these helpers drive the
 * live UI, that's the whole point of an E2E layer.
 *
 * IMPORTANT: the dev server in DEMO_SEED mode serves `/api/auth/me` with a
 * synthesized "default investor" identity (u_aisha_patel) even for fully
 * anonymous requests. This means `Login.tsx`'s `meProbe`-driven redirect
 * fires on every navigation to the login page, so the form's input fields
 * never mount. We therefore use the **API login + cookie injection** pattern
 * for `login()` instead of driving the form. The form itself is still
 * exercised by the `partner.spec.ts` "login-page-renders" test.
 */
import { expect, type Page, type APIRequestContext } from "@playwright/test";
import { PERSONAS, type PersonaKey } from "./personas";

/**
 * Generate a unique email per test run, avoiding seed-data collisions.
 */
export function randomEmail(prefix = "e2e"): string {
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}+${ts}+${rnd}@capavate.test`;
}

interface LoginOpts {
  waitForLanding?: boolean;
}

/**
 * Log a persona in by calling the JSON login API directly and copying the
 * resulting session cookie into the browser context. This is robust against
 * the dev-mode "default investor" identity that defeats UI form-driven login.
 *
 * Capavate has three distinct login routes (public investor/founder, dedicated
 * admin, dedicated partner) but they all eventually call `/api/auth/login`
 * with `{email, password}` (admin uses the same endpoint after Sprint 27
 * unification — see server/lib/authRoutes.ts). The session cookie name is
 * `cap_uid` on HTTP dev (`__Host-cap_uid` on production HTTPS).
 */
export async function login(
  page: Page,
  personaKey: PersonaKey,
  opts: LoginOpts = {},
): Promise<void> {
  const persona = PERSONAS[personaKey];

  // Step 1 — clear any latent state so we know the cookie we get is from
  // this login call only.
  await page.context().clearCookies();

  // Step 2 — POST credentials via the request context. Playwright will
  // capture the Set-Cookie headers automatically into the context.
  const res = await page.request.post("/api/auth/login", {
    headers: { "content-type": "application/json" },
    data: { email: persona.email, password: persona.password },
    failOnStatusCode: false,
  });

  if (res.status() !== 200) {
    const body = await res.text();
    throw new Error(
      `Login API failed for ${personaKey} (${persona.email}): ${res.status()} ${body.slice(0, 200)}`,
    );
  }

  // Step 3 — navigate to the persona's landing page. The session cookie is
  // already in the context so the route guards see an authed user.
  if (opts.waitForLanding !== false) {
    await page.goto(`/#${persona.homePath}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 2000 }).catch(() => {});
  }
}

/**
 * Wait for a toast notification containing the given text.
 */
export async function waitForToast(page: Page, text: string | RegExp) {
  const toast = page
    .locator('[data-testid^="toast"], [role="status"], .toast, [data-sonner-toast]')
    .filter({ hasText: text })
    .first();
  await expect(toast).toBeVisible({ timeout: 10_000 });
  return toast;
}

/**
 * Attach a console-error collector. Returns a function that yields the list.
 */
export function trackConsoleErrors(page: Page): () => string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return () => errors;
}

/**
 * Navigate via the hash router. `path` should NOT include the leading `#`.
 */
export async function gotoHash(page: Page, path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  await page.goto(`/#${normalized}`, { waitUntil: "domcontentloaded" });
}

/**
 * Ensure the test starts with NO session — clears cookies from the context.
 * Some Capavate auth pages (`Signup`, `Login`) proactively redirect away if
 * they detect a live session, which can mask test failures when contexts
 * accidentally share state.
 */
export async function ensureAnonymous(page: Page) {
  await page.context().clearCookies();
}

/**
 * Generic helper: try a series of selectors and return the first that exists.
 * Resolves to a Locator even if none match (use `.count()` to test).
 */
export function firstOf(page: Page, selectors: string[]) {
  return page.locator(selectors.join(", ")).first();
}
