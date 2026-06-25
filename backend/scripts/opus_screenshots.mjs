import { chromium } from "playwright";
import fs from "node:fs";

const BASE = "http://localhost:5050";
const OUT = "/home/user/workspace/build_spec/opus_logs/shots";
fs.mkdirSync(OUT, { recursive: true });

async function loginViaApi(context, email, password) {
  // Use API login to set the session cookie on the browser context.
  const resp = await context.request.post(`${BASE}/api/auth/login`, {
    data: { email, password },
    headers: { "content-type": "application/json" },
  });
  const body = await resp.json().catch(() => ({}));
  return { ok: resp.ok(), status: resp.status(), body };
}

async function shoot(context, label, path) {
  const page = await context.newPage();
  const clean = path.replace(/^#?\/?/, "");
  const url = `${BASE}/${clean}`;
  // wouter BrowserRouter — navigate directly to the path.
  await page.goto(url, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(4000);
  const file = `${OUT}/${label}.png`;
  await page.screenshot({ path: file, fullPage: true });
  // capture a little body text for verification
  const text = (await page.evaluate(() => document.body.innerText)).slice(0, 600);
  console.log(`SHOT ${label} -> ${file}`);
  console.log(`TEXT[${label}]: ${text.replace(/\n+/g, " | ").slice(0, 400)}`);
  await page.close();
}

const browser = await chromium.launch({
  executablePath: "/home/user/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome",
  args: ["--no-sandbox"],
});

// --- Aisha (collective member) ---
const aisha = await browser.newContext();
const a = await loginViaApi(aisha, "aisha@greenwood.capital", "password123");
console.log("AISHA LOGIN:", a.status, a.ok);
await shoot(aisha, "aisha_dashboard", "collective/dashboard");
await shoot(aisha, "aisha_partners", "collective/partners");
await shoot(aisha, "aisha_members", "collective/members");
await shoot(aisha, "aisha_chapters", "collective/chapters");
await aisha.close();

// --- Admin ---
const admin = await browser.newContext();
const ad = await loginViaApi(admin, "admin@capavate.io", "adminpass");
console.log("ADMIN LOGIN:", ad.status, ad.ok);
await shoot(admin, "admin_dashboard", "admin/dashboard");
await shoot(admin, "admin_regions", "admin/regions/extensions");
await admin.close();

// --- Chapterless member ---
const fresh = await browser.newContext();
const fr = await loginViaApi(fresh, "chapterless@opusaudit.test", "password123");
console.log("CHAPTERLESS LOGIN:", fr.status, fr.ok);
await shoot(fresh, "chapterless_dashboard", "collective/dashboard");
await fresh.close();

await browser.close();
console.log("ALL SHOTS DONE");
