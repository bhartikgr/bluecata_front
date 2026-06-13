#!/usr/bin/env node
/**
 * Sprint 17 deploy-time gate. Walks the live deployed proxy URL with playwright
 * and asserts every route renders without crashes. Fails the build if any
 * route is BLANK or has a pageError. Run with the deploy URL as arg:
 *   node scripts/check-deploy.mjs <DEPLOY_BASE_URL>
 */
import { chromium } from 'playwright';

const BASE = process.argv[2];
if (!BASE) { console.error('Usage: check-deploy.mjs <BASE_URL>'); process.exit(2); }

const ROUTES = [
  '/', '/auth/login', '/auth/signup', '/auth/forgot', '/auth/redeem',
  '/select-company',
  '/founder/dashboard', '/founder/company', '/founder/captable', '/founder/rounds',
  '/founder/crm', '/founder/dataroom', '/founder/messages', '/founder/reports',
  '/founder/activity', '/founder/settings',
  '/investor/dashboard', '/investor/invitations', '/investor/portfolio',
  '/investor/messages', '/investor/crm', '/investor/profile',
  '/admin/dashboard', '/admin/sync', '/admin/migration', '/admin/pricing',
  '/admin/email', '/admin/notifications', '/admin/bridge', '/admin/companies',
  '/admin/investors', '/admin/users', '/admin/audit-log', '/admin/reconciliation',
  '/admin/telemetry',
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const failures = [];

for (const route of ROUTES) {
  const errs = [];
  const oe = e => errs.push(e.message);
  page.on('pageerror', oe);
  await page.goto(BASE + '#' + route, { waitUntil: 'load', timeout: 25000 }).catch(()=>{});
  await page.waitForFunction(() => document.body.innerText.length > 100, { timeout: 8000 }).catch(()=>{});
  await page.waitForTimeout(1200);
  const txt = (await page.locator('body').innerText()).trim();
  if (errs.length) failures.push({ route, kind: 'PAGE_ERROR', detail: errs[0].slice(0, 200) });
  else if (txt.length < 200) failures.push({ route, kind: 'BLANK', detail: `body=${txt.length} chars` });
  page.off('pageerror', oe);
}
await browser.close();

if (failures.length) {
  console.error('\n=== DEPLOY GATE FAILED ===');
  failures.forEach(f => console.error(`  [${f.kind}] ${f.route} :: ${f.detail}`));
  process.exit(1);
}
console.log(`\n===> OK — All ${ROUTES.length} routes render cleanly on deployed site.`);
