const U = require('./u'), D = require('../dumpui');
(async () => {
  const o = await U.start(process.env.UID_); const { page } = o;
  if (process.env.KEY) { await page.click('.side >> text=รายงานผลตามเกณฑ์'); await page.waitForTimeout(800); await page.evaluate(k => document.querySelector('[data-open="' + k + '"]')?.click(), process.env.KEY); await page.waitForTimeout(800); await page.click('[data-step="0"]'); await page.waitForTimeout(900); console.log(await D(page, '.main .panel input, .main .panel button[data-full]')); }
  await o.shot('probe_' + process.env.UID_); const t = await o.txt(); console.log(t.slice(t.indexOf('TEST') + 4, t.indexOf('TEST') + 700));
  await o.browser.close();
})();
