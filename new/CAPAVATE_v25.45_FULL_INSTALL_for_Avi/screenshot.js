const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  
  // Login as Aisha
  await page.goto('http://localhost:5003');
  // Just testing if browser launch works at all
  await browser.close();
})();
