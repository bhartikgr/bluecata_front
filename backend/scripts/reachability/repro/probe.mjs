/* WAVE 40 — real-Chromium probe for the SPV tab defect.
 *
 * Runs the two variants in scripts/reachability/repro/app.tsx through a REAL
 * browser engine (Chromium via Playwright), not jsdom. Reports, per variant:
 *   - whether a real mouse click at coordinates selects a non-default tab
 *   - whether the selected panel actually renders text
 *   - whether keyboard arrow navigation moves the selection
 *   - the accessibility-tree view of the tablist (this is where the
 *     presentational-children rule shows up, if it shows up at all)
 *
 * Exit code 0 always; the JSON verdict on stdout is the artefact.
 */
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const url = "file://" + path.join(here, "index.html");

const out = {};

async function probeVariant(page, v) {
  const r = { variant: v };
  // expand
  if (v === "nested") await page.click('[data-testid="nested-card"]', { position: { x: 40, y: 8 } });
  else await page.click('[data-testid="flat-toggle"]');
  await page.waitForSelector(`[data-testid="${v}-tab-fees"]`);

  r.triggerTabIndexBefore = await page.$$eval(`[data-testid^="${v}-tab-"]`, (els) =>
    els.map((e) => ({ id: e.dataset.testid, tabIndex: e.tabIndex, sel: e.getAttribute("aria-selected") })),
  );
  r.tablistTabIndex = await page.$eval(`[data-testid="tabs-${v}"] [role=tablist]`, (e) => e.tabIndex);

  // ---- real mouse click at coordinates on the "fees" trigger --------------
  const box = await page.locator(`[data-testid="${v}-tab-fees"]`).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(120);
  r.afterMouseClick = {
    feesAriaSelected: await page.$eval(`[data-testid="${v}-tab-fees"]`, (e) => e.getAttribute("aria-selected")),
    feesDataState: await page.$eval(`[data-testid="${v}-tab-fees"]`, (e) => e.getAttribute("data-state")),
    overviewDataState: await page.$eval(`[data-testid="${v}-tab-overview"]`, (e) => e.getAttribute("data-state")),
    feesPanelText: await page.$eval(`[data-testid="${v}-panel-fees"]`, (e) => e.textContent.length).catch(() => null),
    feesPanelHidden: await page.$eval(`[data-testid="${v}-panel-fees"]`, (e) => e.hasAttribute("hidden")).catch(() => null),
    cardStillExpanded: await page.locator(`[data-testid="${v}-detail"]`).count(),
  };

  // ---- playwright click-by-role (accessibility-driven) -------------------
  try {
    await page.getByRole("tab", { name: "lps" }).click({ timeout: 2000 });
    await page.waitForTimeout(100);
    r.afterRoleClick = {
      ok: true,
      lpsAriaSelected: await page.$eval(`[data-testid="${v}-tab-lps"]`, (e) => e.getAttribute("aria-selected")),
    };
  } catch (e) {
    r.afterRoleClick = { ok: false, error: String(e).split("\n")[0] };
  }

  // ---- keyboard: arrow navigation from the currently selected trigger ----
  try {
    await page.locator(`[data-testid="${v}-tab-overview"]`).focus();
    const focusedBefore = await page.evaluate(() => document.activeElement?.dataset?.testid ?? document.activeElement?.tagName);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(120);
    const focusedAfter = await page.evaluate(() => document.activeElement?.dataset?.testid ?? document.activeElement?.tagName);
    r.keyboard = {
      focusedBefore,
      focusedAfter,
      moved: focusedBefore !== focusedAfter,
      cardStillExpanded: await page.locator(`[data-testid="${v}-detail"]`).count(),
      selectedAfterArrow: await page.$$eval(`[data-testid^="${v}-tab-"]`, (els) =>
        els.filter((e) => e.getAttribute("aria-selected") === "true").map((e) => e.dataset.testid),
      ),
    };
  } catch (e) {
    r.keyboard = { error: String(e).split("\n")[0] };
  }

  // ---- keyboard: Enter on a trigger (does the card swallow it?) ----------
  try {
    await page.locator(`[data-testid="${v}-tab-nav"]`).focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(120);
    r.enterOnTrigger = {
      cardStillExpanded: await page.locator(`[data-testid="${v}-detail"]`).count(),
      navSelected: await page
        .$eval(`[data-testid="${v}-tab-nav"]`, (e) => e.getAttribute("aria-selected"))
        .catch(() => "TRIGGER GONE (card collapsed)"),
    };
  } catch (e) {
    r.enterOnTrigger = { error: String(e).split("\n")[0] };
  }

  // ---- accessibility tree: are the tabs visible to AT at all? -----------
  try {
    const snap = await page.accessibility.snapshot({ root: await page.$(`#variant-${v}`) });
    const roles = [];
    (function walk(n) {
      if (!n) return;
      roles.push(n.role);
      (n.children || []).forEach(walk);
    })(snap);
    r.axRoles = Array.from(new Set(roles));
    r.axTabCount = roles.filter((x) => x === "tab").length;
  } catch (e) {
    r.axRoles = ["ERROR " + String(e).split("\n")[0]];
  }
  return r;
}

/* The sandboxed Playwright package expects a browser revision that is not
 * installed; point it at the Chromium that IS installed. Still a real browser
 * engine — that is the whole point of this probe. */
const CHROME = process.env.W40_CHROME || "/home/user/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const page = await browser.newPage();
page.on("console", (m) => {
  out.console = out.console || [];
  out.console.push(m.type() + ": " + m.text());
});
await page.goto(url);
out.nested = await probeVariant(page, "nested");
out.flat = await probeVariant(page, "flat");
await browser.close();
console.log(JSON.stringify(out, null, 2));
