const U = require('./u');
(async () => {
  let o = await U.start('1003'); let page = o.page;
  await page.click('[data-act="submit"]'); await page.waitForTimeout(600); await page.click('[data-act="submit"][data-confirm]'); await page.waitForTimeout(3000);
  console.log('SM after submit:', /รอ กปม\. ตรวจ/.test(await o.txt()), (await o.post('/api/save', { fy: 2570, ops: [{ s: 'patch', k: 'SCM|SM|2.1|self', v: 3 }], log: [] })).slice(0, 3));
  await o.shot('P_sm_submitted'); await o.browser.close();
  o = await U.start('1002'); page = o.page; const t = await o.txt();
  console.log('CM home draft + submit button:', /ฉบับร่าง/.test(t), !!(await page.$('[data-act="submit"]')), 'CM save:', (await o.post('/api/save', { fy: 2570, ops: [{ s: 'patch', k: 'SCM|CM|1.1|self', v: 3 }], log: [] })).slice(0, 3));
  await o.post('/api/save', { fy: 2570, ops: [{ s: 'patch', k: 'SCM|CM|1.1|self', v: null }], log: [] }); await o.shot('P_cm_home'); await o.browser.close();
  o = await U.start('1010', 'กปม'); page = o.page;
  await page.click('[data-go="review"]'); await page.waitForTimeout(1000);
  console.log('queue SCM:', (await page.innerText('[data-rv="SCM"]')).replace(/\s+/g, ' '), '| KMIM:', (await page.innerText('[data-rv="KMIM"]')).replace(/\s+/g, ' '));
  await page.click('[data-rv="SCM"]'); await page.waitForTimeout(1200); await o.shot('P_audit_scm');
  await page.click('[data-act="approve-rv"]'); await page.waitForTimeout(800);
  const f = await page.$('[data-act="force-approve"]'); if (f) await f.click(); await page.waitForTimeout(2500);
  await page.reload(); await page.waitForSelector('.app'); await page.waitForTimeout(800);
  console.log('wf after approve:', await page.evaluate(() => JSON.stringify(window.CBE_API.state.wf)));
  await page.click('[data-go="review"]'); await page.waitForTimeout(800); console.log('queue SCM after:', (await page.innerText('[data-rv="SCM"]')).replace(/\s+/g, ' '));
  // cleanup
  console.log('cleanup:', await o.post('/api/save', { fy: 2570, ops: [{ s: 'wf', k: 'SCM|SM', v: 'draft' }], log: [] }));
  await o.browser.close();
  o = await U.start('1003'); console.log('SM note cleanup:', await o.post('/api/save', { fy: 2570, ops: [{ s: 'wfnote', k: 'SCM|SM:sent', v: null }], log: [] })); await o.browser.close();
})().catch(e => console.log('CRASH', e.message.split('\n')[0]));
