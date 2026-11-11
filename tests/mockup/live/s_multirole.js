// 1010 = กปม. + reporter DT: role picker, self-review block (UI + server), switching
const L = require('./lib');
(async () => {
  const { browser, page, log, URL } = await L.open({ fresh: true });
  const post = (url, body) => page.evaluate(async ([u, b]) => { const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return r.status + ' ' + (await r.text()).slice(0, 110); }, [url, body]);
  await page.goto(URL); await page.waitForSelector('#loginForm');
  await page.fill('#em', '1010'); await page.fill('#pw', 'cbe@1010'); await page.click('.lg-btn');
  await page.waitForSelector('[data-role-login]', { timeout: 15000 });
  console.log('picker:', (await page.innerText('#loginMsg')).replace(/\s+/g, ' '));
  await page.screenshot({ path: 'role_picker.png' });
  const audit = await page.$$eval('[data-role-login]', a => a.find(b => /กปม/.test(b.innerText)).dataset.roleLogin);
  await page.click(`[data-role-login="${audit}"]`); await page.waitForSelector('.app', { timeout: 20000 }); await page.waitForTimeout(1000);
  console.log('me:', await page.evaluate(() => JSON.stringify({ role: U.role, self: U.self, roles: U.roles })));
  // review workspace on DT
  await page.click('.side >> text=พื้นที่ผู้ตรวจสอบ'); await page.waitForTimeout(900); await page.click('[data-rv="DT"]'); await page.waitForTimeout(700);
  const t = await page.innerText('.main');
  console.log('DT decide bar:', (t.match(/ตัวชี้วัดที่ท่านรายงานเอง[^\n]*/) || ['(none)'])[0], '| AI button:', !!(await page.$('[data-act="ai-run"]')), '| triage disabled:', await page.$eval('[data-tri="confirm"]', x => x.disabled).catch(() => 'no findings'));
  await page.screenshot({ path: 'role_self_review.png' });
  await page.click('[data-rv="RM"]'); await page.waitForTimeout(600);
  console.log('RM (not own): AI button:', !!(await page.$('[data-act="ai-run"]')), '| triage disabled:', await page.$eval('[data-tri="confirm"]', x => x.disabled).catch(() => 'no findings'));
  // server refuses review writes on DT (nothing is changed when refused)
  console.log('server wf DT:', await post('/api/save', { fy: 2570, ops: [{ s: 'wf', k: 'DT', v: 'approved' }], log: [] }));
  console.log('server tri DT:', await post('/api/save', { fy: 2570, ops: [{ s: 'tri', k: 'R1|DT|DT|1.1|1', v: 'confirm' }], log: [] }));
  console.log('server AI DT:', await post('/api/ai/check', { fy: 2570, items: [{ k: 'DT|DT|1.1|1', narr: 'x' }] }));
  // switch to reporter DT from the account menu
  await page.click('[data-act="umenu"]'); await page.waitForTimeout(300);
  console.log('menu switch items:', JSON.stringify(await page.$$eval('[data-role-switch]', a => a.map(x => x.innerText.trim()))));
  await Promise.all([page.waitForNavigation({ timeout: 20000 }), page.click('[data-role-switch]')]); await page.waitForSelector('.app'); await page.waitForTimeout(1200);
  console.log('after switch:', await page.evaluate(() => JSON.stringify({ role: U.role, ind: U.ind, self: U.self })), '| sidebar:', (await page.innerText('.side')).replace(/\s+/g, ' ').slice(0, 60));
  console.log('reporter tries approve DT:', await post('/api/save', { fy: 2570, ops: [{ s: 'wf', k: 'DT', v: 'approved' }], log: [] }));
  await page.click('[data-act="umenu"]'); await page.waitForTimeout(300); await Promise.all([page.waitForNavigation({ timeout: 20000 }), page.click('[data-role-switch]')]); await page.waitForSelector('.app'); await page.waitForTimeout(800);
  console.log('switched back:', await page.evaluate(() => U.role));
  console.log('--- log\n' + log.filter(x => !/^API GET/.test(x)).join('\n'));
  await browser.close();
})();
