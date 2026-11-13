const U = require('./u'), D = require('../dumpui');
(async () => {
  const o = await U.start('1001'); const { page } = o;
  await page.click('[data-open="DT|DT|1.1|1"] >> nth=0'); await page.waitForTimeout(1200);
  await o.shot('r2_level', true); console.log((await o.txt()).slice(0, 2500));
  console.log(await D(page, '.main button, .main input, .main select, .main textarea'));
  console.log(o.log.join('\n')); await o.browser.close();
})();
