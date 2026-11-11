// usage: node run.js step.js  — step exports async ({page,log,shot})
const L = require('./lib');
(async () => {
  const vp = process.env.VP ? { width: +process.env.VP.split('x')[0], height: +process.env.VP.split('x')[1] } : undefined;
  const { browser, page, log, save, URL } = await L.open({ vp });
  await page.goto(URL); await page.waitForSelector('.app', { timeout: 20000 }); await page.waitForTimeout(800);
  const shot = (n, full) => page.screenshot({ path: n + '.png', fullPage: !!full });
  try { await require('./' + process.argv[2])({ page, log, shot }); } catch (e) { console.log('STEP ERROR', e.message.split('\n').slice(0, 6).join(' | ')); await shot('error'); }
  await page.waitForTimeout(2500); // let autosave flush
  await save();
  console.log('--- log\n' + log.join('\n'));
  await browser.close();
})();
