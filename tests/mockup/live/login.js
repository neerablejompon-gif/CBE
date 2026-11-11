const L = require('./lib');
(async () => {
  const id = process.env.UID_ || '1001';
  const { browser, page, log, save, URL } = await L.open({ fresh: true });
  await page.goto(process.env.BASE || URL); await page.waitForSelector('#loginForm');
  await page.fill('#em', id); await page.fill('#pw', 'cbe@' + id); await page.click('.lg-btn');
  await page.waitForSelector('.app', { timeout: 20000 }); await page.waitForTimeout(1500);
  await save(); await page.screenshot({ path: 'home' + id + '.png' });
  console.log(await page.evaluate(() => JSON.stringify(window.U)));
  console.log(log.join('\n')); await browser.close();
})();
