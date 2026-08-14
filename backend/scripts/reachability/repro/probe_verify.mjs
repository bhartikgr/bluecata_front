/* WAVE 40 — POST-FIX VERIFICATION in a real Chromium against the real app.
 *
 * Proves, for every one of the 16 SPV tabs, that the tab is reachable BY MOUSE
 * and BY KEYBOARD, and that the detail card survives both. The keyboard half is
 * the pole that FAILED before the fix (Enter on a tab trigger unmounted the
 * whole panel because the Card's onKeyDown caught the bubbled key), so a run of
 * this probe against the pre-fix tree is the "RED" evidence and this run is the
 * "GREEN" one.
 *
 * Usage:
 *   W40_EMAIL=… W40_PASSWORD=… node scripts/reachability/repro/probe_verify.mjs
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = process.env.BASE || "http://localhost:5199";
const CHROME =
  process.env.W40_CHROME || "/home/user/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome";
const EMAIL = process.env.W40_EMAIL || "partner@keiretsu.ca";
const PASSWORD = process.env.W40_PASSWORD || "password123";
const OUT = process.env.W40_OUT || "/home/user/workspace/build_log/wave40/verify_after.json";

const out = { base: BASE, console: [], pageerrors: [] };
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const ctx = await browser.newContext({
  baseURL: BASE,
  viewport: { width: Number(process.env.W40_W || 1400), height: Number(process.env.W40_H || 1000) },
});
const page = await ctx.newPage();
page.on("console", (m) => out.console.push(m.type() + ": " + m.text().slice(0, 200)));
page.on("pageerror", (e) => out.pageerrors.push(String(e).slice(0, 200)));

const login = await ctx.request.post("/api/auth/login", {
  headers: { "content-type": "application/json" },
  data: { email: EMAIL, password: PASSWORD },
  failOnStatusCode: false,
});
out.login = login.status();

await page.goto("/collective/partner/spv-engine", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
out.url = page.url();

const ids = await page.$$eval('[data-testid^="spv-row-"]', (els) =>
  els
    .map((e) => e.dataset.testid)
    .filter((t) => /^spv-row-spv_[0-9a-f]+$/.test(t))
    .map((t) => t.replace("spv-row-", "")),
);
out.spvIds = ids;
const spvId = ids[0];
out.spvId = spvId;

/* ---------- 0. the interactive-role nesting is GONE ---------- */
out.cardAttrs = await page.$eval(`[data-testid="spv-row-${spvId}"]`, (e) => ({
  role: e.getAttribute("role"),
  tabIndex: e.getAttribute("tabindex"),
  ariaExpanded: e.getAttribute("aria-expanded"),
}));

/* ---------- 1. the NEW real disclosure button expands the card ---------- */
const toggle = page.locator(`[data-testid="spv-row-toggle-${spvId}"]`);
out.toggleExists = await toggle.count();
await toggle.click();
await page.waitForTimeout(2500);
out.afterToggleClick = {
  detail: await page.locator(`[data-testid="spv-detail-${spvId}"]`).count(),
  tabs: await page.locator(`[data-testid="spv-tabs-${spvId}"]`).count(),
  ariaExpanded: await toggle.getAttribute("aria-expanded"),
  ariaControls: await toggle.getAttribute("aria-controls"),
};

const tabKeys = await page.$$eval('[data-testid^="spv-tab-"]', (els) =>
  els.map((e) => e.dataset.testid.replace("spv-tab-", "")),
);
out.tabKeys = tabKeys;

/* ---------- 2. MOUSE: every tab activates, card survives ---------- */
out.mouse = [];
for (const key of tabKeys) {
  const trig = page.locator(`[data-testid="spv-tab-${key}"]`);
  await trig.scrollIntoViewIfNeeded();
  const box = await trig.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(180);
  out.mouse.push({
    key,
    selected: await trig.getAttribute("aria-selected"),
    panelText: await page
      .locator(`[data-testid="spv-tabs-${spvId}"] [role="tabpanel"]:not([hidden])`)
      .first()
      .innerText()
      .then((t) => t.trim().length)
      .catch(() => -1),
    cardStillExpanded: await page.locator(`[data-testid="spv-detail-${spvId}"]`).count(),
  });
}

/* ---------- 3. KEYBOARD: focus a trigger, then Enter / Space / arrows ----------
   THIS IS THE POLE THAT FAILED BEFORE THE FIX. Enter on a trigger used to
   unmount the detail panel entirely. */
out.keyboard = [];
for (const key of tabKeys) {
  // Return to a known tab first so each key press is measured independently.
  await page.locator(`[data-testid="spv-tab-overview"]`).click();
  await page.waitForTimeout(120);
  const trig = page.locator(`[data-testid="spv-tab-${key}"]`);
  await trig.scrollIntoViewIfNeeded();
  await trig.focus();
  const focusedIsTrigger = await page.evaluate(
    (k) => document.activeElement?.getAttribute("data-testid") === `spv-tab-${k}`,
    key,
  );
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  out.keyboard.push({
    key,
    focusable: focusedIsTrigger,
    tabIndexWhenFocused: await trig.getAttribute("tabindex").catch(() => null),
    selectedAfterEnter: await trig.getAttribute("aria-selected").catch(() => "GONE"),
    cardStillExpandedAfterEnter: await page
      .locator(`[data-testid="spv-detail-${spvId}"]`)
      .count(),
  });
}

/* ---------- 4. ARROW KEYS move between tabs ---------- */
await page.locator(`[data-testid="spv-tab-overview"]`).click();
await page.locator(`[data-testid="spv-tab-overview"]`).focus();
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(200);
out.arrowRight = await page.evaluate(() => ({
  active: document.activeElement?.getAttribute("data-testid") ?? null,
  selected: document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("data-testid") ?? null,
}));
await page.keyboard.press("ArrowLeft");
await page.waitForTimeout(200);
out.arrowLeft = await page.evaluate(() => ({
  active: document.activeElement?.getAttribute("data-testid") ?? null,
  selected: document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("data-testid") ?? null,
}));

/* ---------- 5. Space on the SPV row toggle collapses the card ---------- */
await toggle.focus();
await page.keyboard.press("Space");
await page.waitForTimeout(600);
out.collapseBySpace = {
  detail: await page.locator(`[data-testid="spv-detail-${spvId}"]`).count(),
  ariaExpanded: await toggle.getAttribute("aria-expanded"),
};

/* ---------- 6. the blue link opens the TABBED view on the LPs tab ---------- */
await page.locator(`[data-testid="spv-open-detail-${spvId}"]`).click();
await page.waitForTimeout(2500);
out.blueLink = {
  url: page.url(),
  detail: await page.locator(`[data-testid="spv-detail-${spvId}"]`).count(),
  selectedTab: await page.evaluate(
    () => document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("data-testid") ?? null,
  ),
};

/* ---------- 7. the standalone page is STILL reachable by a plain click ---------- */
out.standaloneLinkCount = await page.locator(`[data-testid="spv-open-standalone-${spvId}"]`).count();
if (out.standaloneLinkCount) {
  await page.locator(`[data-testid="spv-open-standalone-${spvId}"]`).click();
  await page.waitForTimeout(2500);
  out.standalone = {
    url: page.url(),
    detailPanel: await page.locator('[data-testid="partner-spv-detail"]').count(),
    jurisdiction: await page
      .locator('[data-testid="partner-spv-jurisdiction"]')
      .innerText()
      .catch(() => null),
    capitalCallForm: await page.locator('[data-testid="partner-spv-capital-call-form"]').count(),
  };
}

/* ---------- 8. JURISDICTION AGREEMENT across the two surfaces ---------- */
out.jurisdictionCrossCheck = [];
for (const id of ids) {
  const listLabel = await page.request
    .get(`/api/partner/me/spv`)
    .then((r) => r.json())
    .then((j) => (j.spvs || []).find((s) => s.id === id))
    .catch(() => null);
  await page.goto(`/collective/partner/spvs/${id}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  const pageLabel = await page
    .locator('[data-testid="partner-spv-jurisdiction"]')
    .innerText()
    .catch(() => null);
  await page.goto("/collective/partner/spv-engine", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const cardLabel = await page
    .locator(`[data-testid="spv-row-jurisdiction-${id}"]`)
    .innerText()
    .catch(() => null);
  out.jurisdictionCrossCheck.push({
    id,
    storedColumn: listLabel?.jurisdiction ?? null,
    storedCountry: listLabel?.terms?.jurisdictionCountry ?? null,
    currency: listLabel?.currency ?? null,
    listCard: cardLabel,
    standalonePage: pageLabel,
    agree: (cardLabel || "").includes((pageLabel || "\u0000").trim()),
  });
}

await browser.close();
writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
