const U = require('./u'), D = require('../dumpui');
(async () => {
  const o = await U.start('1001'); const { page } = o;
  const dump = async (n) => { await page.waitForTimeout(900); await o.shot('r5_' + n); console.log('=== ' + n); console.log(await D(page, '.drawer button, .drawer input, .drawer select, .drawer textarea')); };
  await page.click('.side >> text=แผนการดำเนินงาน'); await page.waitForTimeout(800);
  await page.click('[data-act="pedit"]'); await page.waitForTimeout(500);
  await page.click('text=ยังไม่มีแผน · กดเพื่อแตกขั้นตอน >> nth=0'); await page.waitForTimeout(800);
  await page.click(".drawer [data-act=add-step]"); await page.waitForTimeout(2500); await dump("added");

  console.log(o.log.join('\n')); await o.browser.close();
})();
