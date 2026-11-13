const U = require('./u'), D = require('../dumpui');
const skip = /fyear|gran|id=month|theme|umenu|line-open|logout|open-nav|sfilter|"sub"|"open"|"level"|"step"|pfilter|"filter"|"tab"/;
(async () => {
  const o = await U.start('1001'); const { page } = o;
  const dump = async (n) => { await page.waitForTimeout(900); await o.shot('r4_' + n); console.log('=== ' + n); console.log((await D(page, '.main button, .main input, .main select, .main textarea, .main [data-pk], .main tr[data-k]')).split('\n').filter(l => !skip.test(l)).slice(0, 40).join('\n')); };
  await page.click('.side >> text=แผนการดำเนินงาน'); await page.waitForTimeout(800);
  await page.click('[data-act="pedit"]'); await dump('pedit');
  await page.click('text=ยังไม่มีแผน · กดเพื่อแตกขั้นตอน >> nth=0'); await dump('prow');
  console.log(o.log.join('\n')); await o.browser.close();
})();
