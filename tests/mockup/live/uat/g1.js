const U = require('./u');
(async () => {
  const o = await U.start('1004'); const { page } = o;
  await page.click('.side >> text=แผนปรับปรุง GAP'); await page.waitForTimeout(900); await page.click('[data-act="gedit"]'); await page.waitForTimeout(500);
  const n = await page.$$eval('tr[data-pick]', a => a.length); await page.click('tr[data-pick] >> nth=0'); await page.waitForTimeout(900);
  console.log('edit mode: pickable rows', n, '| drawer opened', !!(await page.$('.drawer #ac'))); await o.shot('G_editmode_drawer'); await o.browser.close();
})();
