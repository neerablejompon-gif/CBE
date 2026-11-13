const U = require('./u'), D = require('../dumpui');
(async () => {
  const o = await U.start('1010', 'กปม'); const { page } = o;
  console.log('login', o.loginMs); await o.shot('A_01home'); console.log('SIDE', (await o.txt('.side')).replace(/\n/g, ' | '));
  await page.click('[data-go="review"]'); await page.waitForTimeout(1000); await o.shot('A_02review');
  console.log((await D(page, '.main [data-rv]')).split('\n').map(l => l.slice(l.indexOf('val='))).join(' ; '));
  await page.click('[data-rv="HCM"]'); await page.waitForTimeout(1200); await o.shot('A_03hcm', true);
  console.log((await D(page, '.main button, .main textarea, .main input, .main select')).split('\n').filter(l => !/"rv"|fyear|gran|id=month|theme|umenu|line|logout|open-nav/.test(l)).slice(0, 50).join('\n'));
  await o.browser.close();
})();
