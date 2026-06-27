const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  console.log("Launched browser!");
  await browser.close();
})();
