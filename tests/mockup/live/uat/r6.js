const U = require('./u'), D = require('../dumpui');
const skip = /fyear|gran|id=month|theme|umenu|line-open|logout|open-nav|sfilter|"sub"|"level"|pfilter|"filter"|"mt"|"pl"/;
(async () => {
  const o = await U.start('1001'); const { page } = o;
  const dump = async (n, sel) => { await page.waitForTimeout(1000); await o.shot('r6_' + n); console.log('=== ' + n); console.log((await D(page, sel.split(',').map(s => s + ' button,' + s + ' input,' + s + ' select,' + s + ' textarea').join(','))).split('\n').filter(l => !skip.test(l)).join('\n')); };
  await page.click('.side >> text=แผนปรับปรุง GAP'); await page.waitForTimeout(800);
  await o.shot('r6_gedit_off');
  await page.click('[data-pick] >> nth=0'); await dump('gapdrawer', '.drawer');
  await page.click('.drawer [data-act="add-step"]'); await dump('gapadded', '.drawer');
  await page.click('.drawer [data-pick=""]'); await page.waitForTimeout(400);
  await page.click('.side >> text=รายงานผลตามเกณฑ์'); await page.waitForTimeout(800);
  await page.click('[data-step="0"]'); await dump('s0', '.main .panel');
  await page.click('[data-step="3"]'); await dump('s3', '.main .panel');
  await page.click('[data-step="4"]'); await dump('s4', '.main .panel');
  console.log(o.log.join('\n')); await o.browser.close();
})();
