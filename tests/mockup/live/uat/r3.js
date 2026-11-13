const U = require('./u'), D = require('../dumpui');
const ctl = '.main button:not([data-sub]):not([data-open]), .main input, .main select, .main textarea';
(async () => {
  const o = await U.start('1001'); const { page } = o;
  const dump = async (n) => { await page.waitForTimeout(1000); await o.shot('r3_' + n); const t = await o.txt(); console.log('=== ' + n + '\n' + t.slice(t.indexOf('TEST') + 4, t.indexOf('TEST') + 1400)); console.log((await D(page, ctl)).split('\n').filter(l => !/fyear|gran|id=month|theme|umenu|line-open|logout|open-nav|sfilter/.test(l)).slice(0, 60).join('\n')); };
  await page.click('.side >> text=แผนการดำเนินงาน'); await dump('plan');
  await page.click('.side >> text=แผนปรับปรุง GAP'); await dump('gap');
  await page.click('.side >> text=รายงานผลตามเกณฑ์'); await page.waitForTimeout(800); await page.click('[data-step="0"]'); await dump('step1');
  await page.click('[data-step="2"]'); await dump('step3');
  await page.click('[data-step="3"]'); await dump('gap1');
  await page.click('[data-step="4"]'); await dump('gap2');
  await page.click('.side >> text=ทะเบียนหลักฐาน'); await dump('evreg');
  await page.click('.side >> text=ภาพรวมตัวชี้วัด'); await dump('overview');
  console.log(o.log.join('\n')); await o.browser.close();
})();
