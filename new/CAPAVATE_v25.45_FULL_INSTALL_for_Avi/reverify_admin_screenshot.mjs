import { chromium } from 'playwright';
import fs from 'fs';

const base = 'http://127.0.0.1:5077';
const outDir = '/home/user/workspace/build_spec/screenshots';
fs.mkdirSync(outDir, { recursive: true });
const log = [];

const browser = await chromium.launch({
  executablePath: '/home/user/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await context.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });

// 1) Login via API so the session cookie is set in this browser context.
const loginResp = await context.request.post(`${base}/api/auth/login`, {
  data: { email: 'admin@capavate.io', password: 'adminpass' },
  headers: { 'content-type': 'application/json' },
});
const loginJson = await loginResp.json().catch(() => ({}));
log.push({ step: 'login', status: loginResp.status(), isAdmin: loginJson?.ctx?.isAdmin });

// 1b) Probe the KPI endpoint directly to confirm it returns the null-containing payload.
const kpiResp = await context.request.get(`${base}/api/admin/dashboard/kpis`);
const kpiJson = await kpiResp.json().catch(() => ({}));
log.push({
  step: 'kpi-probe', status: kpiResp.status(),
  successRatePct: kpiJson?.health?.capTableReconcile?.successRatePct,
  deliveryRatePct: kpiJson?.health?.messageDelivery?.deliveryRatePct,
  momGrowthPct: kpiJson?.summary?.momGrowthPct,
  nrr: kpiJson?.summary?.nrr,
});

// 2) Navigate to the admin dashboard.
const resp = await page.goto(`${base}/admin/dashboard`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(4000);

const bodyText = await page.locator('body').innerText({ timeout: 8000 }).catch(() => '');

// 3) Assertions — must render WITHOUT the ErrorBoundary fallback.
const hasErrorBoundary = /Something went wrong/i.test(bodyText);
const hasToFixedError = errors.some((e) => /toFixed/i.test(e));
const hasHeader = /Admin dashboard/i.test(bodyText);
const hasHealthTile = await page.locator('[data-testid="card-health-reconcile"]').count().catch(() => 0);
const hasKpiCard = await page.locator('[data-testid="stat-kpi-1"]').count().catch(() => 0);
const hasSurfaceToggle = await page.locator('[data-testid="dashboard-surface-toggle"]').count().catch(() => 0);
const reconcileText = await page.locator('[data-testid="card-health-reconcile"]').innerText().catch(() => '');
const msgText = await page.locator('[data-testid="card-health-msgs"]').innerText().catch(() => '');

log.push({
  step: 'nav', path: '/admin/dashboard', status: resp?.status(),
  textLen: bodyText.length,
  hasErrorBoundary,
  hasToFixedError,
  hasHeader,
  hasHealthTile, hasKpiCard, hasSurfaceToggle,
  reconcileTilePreview: reconcileText.replace(/\n/g, ' ').slice(0, 80),
  msgTilePreview: msgText.replace(/\n/g, ' ').slice(0, 80),
  preview: bodyText.slice(0, 220).replace(/\n/g, ' '),
});

await page.screenshot({ path: `${outDir}/reverify_admin_dashboard.png`, fullPage: true });

const pass = !hasErrorBoundary && !hasToFixedError && hasHeader && hasHealthTile > 0 && hasKpiCard > 0;
log.push({ VERDICT: pass ? 'PASS — renders without ErrorBoundary' : 'FAIL', errors });
fs.writeFileSync(`${outDir}/reverify_admin_capture_log.json`, JSON.stringify(log, null, 2));
console.log(JSON.stringify(log, null, 2));
await browser.close();
process.exit(pass ? 0 : 1);
