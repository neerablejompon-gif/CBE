const U = require('./u');
(async () => {
  const o = await U.start('1001'); const { page, ctx } = o; let n = 0, st = [];
  await ctx.route('**/api/save', async r => { n++; if (n <= 2) return r.fulfill({ status: n === 1 ? 503 : 500, contentType: 'application/json', body: '{"error":"ระบบไม่ว่างชั่วคราว ลองใหม่อีกครั้ง"}' }); const resp = await r.fetch(); st.push(resp.status()); r.fulfill({ response: resp }); });
  let nav = 0; page.on('framenavigated', f => { if (f === page.mainFrame()) nav++; });
  await page.click('.side >> text=รายงานผลตามเกณฑ์'); await page.waitForTimeout(800);
  await page.click('[data-step="1"]'); await page.waitForTimeout(500);
  const txt = 'UAT retry ' + Date.now(); await page.fill('#narr', txt); await page.press('#narr', 'Tab');
  await page.waitForTimeout(2500); await o.shot('retry_toast');
  await page.waitForTimeout(16000);
  const saved = await page.evaluate(() => JSON.stringify(window.CBE_API.state.patch['DT|DT|1.1|1'].narrative));
  console.log('attempts', n, 'real statuses', st, 'reloads', nav, 'kept text', saved.includes('UAT retry'));
  await page.reload(); await page.waitForSelector('.app'); await page.waitForTimeout(1000);
  console.log('after reload server has text:', (await page.evaluate(() => window.CBE_API.state.patch['DT|DT|1.1|1'].narrative)) === txt);
  await o.browser.close();
})();
