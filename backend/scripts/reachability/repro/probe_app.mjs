/* WAVE 40 — drive the REAL app in a REAL Chromium against a local server.
 *
 * This is the reproduction step the whole wave depends on: the shipped
 * PartnerSpvEngine page, the shipped SpvDetailTabs, a real browser engine.
 * jsdom cannot see this class of defect, which is precisely why 5 review
 * rounds and a green suite missed it.
 *
 * Usage: BASE=http://localhost:5199 node scripts/reachability/repro/probe_app.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:5199";
const CHROME =
  process.env.W40_CHROME || "/home/user/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome";
const EMAIL = process.env.W40_EMAIL || "partner@keiretsu.ca";
const PASSWORD = process.env.W40_PASSWORD || "password123";

const out = { base: BASE, console: [], pageerrors: [] };

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: Number(process.env.W40_W || 1400), height: Number(process.env.W40_H || 1000) } });
const page = await ctx.newPage();
page.on("console", (m) => out.console.push(m.type() + ": " + m.text().slice(0, 300)));
page.on("pageerror", (e) => out.pageerrors.push(String(e).slice(0, 300)));

const res = await ctx.request.post("/api/auth/login", {
  headers: { "content-type": "application/json" },
  data: { email: EMAIL, password: PASSWORD },
  failOnStatusCode: false,
});
out.login = { status: res.status(), body: (await res.text()).slice(0, 200) };

await page.goto("/collective/partner/spv-engine", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
out.url = page.url();
out.hasList = await page.locator('[data-testid="spv-engine-list"]').count();
const rows = await page.locator('[data-testid^="spv-row-"]').all();
out.rowCount = rows.length;
out.rowIds = await page.$$eval('[data-testid^="spv-row-"]', (els) =>
  els.map((e) => e.dataset.testid).filter((t) => !t.includes("jurisdiction") && !t.includes("vintage")),
);

if (out.rowCount) {
  // expand the first card by a real mouse click on its header text
  const first = page.locator('[data-testid^="spv-row-"]').first();
  const testid = await first.getAttribute("data-testid");
  out.firstCard = testid;
  const box = await first.boundingBox();
  await page.mouse.click(box.x + 60, box.y + 10);
  await page.waitForTimeout(2500);
  const spvId = testid.replace("spv-row-", "");
  out.detailMounted = await page.locator(`[data-testid="spv-detail-${spvId}"]`).count();
  out.tabsMounted = await page.locator(`[data-testid="spv-tabs-${spvId}"]`).count();
  out.triggers = await page.$$eval('[data-testid^="spv-tab-"]', (els) =>
    els.map((e) => ({
      id: e.dataset.testid,
      tabIndex: e.tabIndex,
      sel: e.getAttribute("aria-selected"),
      state: e.getAttribute("data-state"),
      w: Math.round(e.getBoundingClientRect().width),
      h: Math.round(e.getBoundingClientRect().height),
    })),
  );

  // real mouse click at coordinates on each non-default tab, in turn
  out.perTab = [];
  for (const key of [
    "mandate",
    "fees",
    "lps",
    "deployments",
    "distributions",
    "documents",
    "transfers",
    "close",
    "winddown",
    "compliance",
    "esignature",
    "nav",
    "k1",
    "sideletters",
    "reach",
  ]) {
    const loc = page.locator(`[data-testid="spv-tab-${key}"]`);
    const rec = { key, present: await loc.count() };
    if (rec.present) {
      try {
        if (process.env.W40_NOSCROLL !== "1") await loc.scrollIntoViewIfNeeded();
        const b = await loc.boundingBox();
        // what element is actually on top at that point?
        rec.topElement = await page.evaluate(
          ([x, y]) => {
            const el = document.elementFromPoint(x, y);
            return el ? `${el.tagName}.${(el.className || "").toString().slice(0, 40)}[${el.dataset?.testid ?? ""}]` : null;
          },
          [b.x + b.width / 2, b.y + b.height / 2],
        );
        await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
        await page.waitForTimeout(250);
        rec.selected = await loc.getAttribute("aria-selected").catch(() => "GONE");
        rec.state = await loc.getAttribute("data-state").catch(() => "GONE");
        rec.detailStillMounted = await page.locator(`[data-testid="spv-detail-${spvId}"]`).count();
        rec.activeTabs = await page.$$eval('[data-testid^="spv-tab-"]', (els) =>
          els.filter((e) => e.getAttribute("data-state") === "active").map((e) => e.dataset.testid),
        );
        rec.activePanelTextLen = await page.$$eval('[role="tabpanel"]', (els) =>
          els.filter((e) => !e.hasAttribute("hidden")).map((e) => e.textContent.length),
        );
      } catch (e) {
        rec.error = String(e).split("\n")[0];
      }
    }
    out.perTab.push(rec);
  }

  // keyboard: focus the tablist and arrow through
  try {
    await page.locator(`[data-testid="spv-tabs-${spvId}"] [role=tablist]`).focus();
    out.kbFocusAfterTablistFocus = await page.evaluate(
      () => document.activeElement?.dataset?.testid ?? document.activeElement?.tagName,
    );
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(200);
    out.kbAfterArrow = {
      focused: await page.evaluate(() => document.activeElement?.dataset?.testid ?? document.activeElement?.tagName),
      active: await page.$$eval('[data-testid^="spv-tab-"]', (els) =>
        els.filter((e) => e.getAttribute("data-state") === "active").map((e) => e.dataset.testid),
      ),
      detailMounted: await page.locator(`[data-testid="spv-detail-${spvId}"]`).count(),
    };
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    out.kbAfterEnter = {
      detailMounted: await page.locator(`[data-testid="spv-detail-${spvId}"]`).count(),
      active: await page.$$eval('[data-testid^="spv-tab-"]', (els) =>
        els.filter((e) => e.getAttribute("data-state") === "active").map((e) => e.dataset.testid),
      ),
    };
  } catch (e) {
    out.keyboardError = String(e).split("\n")[0];
  }
  await page.screenshot({ path: process.env.W40_SHOT || "/tmp/w40_app.png", fullPage: false });
}

await browser.close();
console.log(JSON.stringify(out, null, 2));
