const U = require('./u'), D = require('../dumpui');
(async () => {
  const o = await U.start('1001'); const { page } = o;
  console.log('loginMs', o.loginMs);
  await o.shot('r1_home'); console.log((await o.txt()).slice(0, 1500));
  console.log('SIDE', (await o.txt('.side')).replace(/\n/g, ' | '));
  console.log(await D(page, '.main button, .main input, .main select, .main textarea, .main [data-act]'));
  console.log(o.log.join('\n')); await o.browser.close();
})();
