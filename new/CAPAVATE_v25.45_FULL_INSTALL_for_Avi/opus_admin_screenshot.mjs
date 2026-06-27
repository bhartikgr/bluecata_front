import { chromium } from 'playwright';
import fs from 'fs';

const base = 'http://127.0.0.1:5055';
const outDir = '/home/user/workspace/build_spec/screenshots';
fs.mkdirSync(outDir, { recursive: true });
const log = [];

const browser = await chromium.launch({
  executablePath: '/home/user/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });

// 1) Login via API so the session cookie is set in this browser context.
const loginResp = await context.request.post(`${base}/api/auth/login`, {
  data: { email: 'admin@capavate.io', password: 'adminpass' },
  headers: { 'content-type': 'application/json' },
});
log.push({ step: 'login', status: loginResp.status(), ok: loginResp.ok() });
const loginJson = await loginResp.json().catch(() => ({}));
log.push({ isAdmin: loginJson?.ctx?.isAdmin });

// 2) Navigate to the admin dashboard.
const candidates = ['/admin', '/admin/dashboard', '/admin/platform', '/'];
let landed = null;
for (const path of candidates) {
  try {
    const resp = await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const bodyText = await page.locator('body').innerText({ timeout: 8000 }).catch(() => '');
    log.push({ step: 'nav', path, status: resp?.status(), textLen: bodyText.length, preview: bodyText.slice(0, 160).replace(/\n/g, ' ') });
    if (bodyText.length > 200) { landed = path; }
    await page.screenshot({ path: `${outDir}/opus_admin${path.replace(/\//g, '_') || '_root'}.png`, fullPage: true });
  } catch (e) {
    log.push({ step: 'nav_err', path, error: e.message });
  }
}

log.push({ landed, errors });
fs.writeFileSync(`${outDir}/opus_admin_capture_log.json`, JSON.stringify(log, null, 2));
console.log(JSON.stringify(log, null, 2));
await browser.close();
