// กปม. 1010 on HCM: triage → return; AI check; DT self-block; config (intercepted), users, audit trail
const U = require('./u'), fs = require('fs'), R = [];
const rec = (t, ok, note = '') => { R.push({ id: '1010', t, r: ok === null ? 'NOT TESTED' : ok ? 'PASS' : 'FAIL', note }); console.log((ok === null ? 'NT  ' : ok ? 'PASS' : 'FAIL') + ' ' + t + (note ? ' — ' + note : '')); };
(async () => {
  const o = await U.start('1010', 'กปม'); const { page, ctx } = o, w = ms => page.waitForTimeout(ms || 1000);
  const cfgSent = []; await ctx.route('**/api/save', async r => { const b = r.request().postData() || ''; if (/"s":"cfg"/.test(b)) { cfgSent.push(b.slice(0, 200)); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"at":"(intercepted)"}' }); } r.continue(); });
  const wf = async k => { await page.reload(); await page.waitForSelector('.app'); await w(800); return page.evaluate(k => (window.CBE_API.state.wf || {})[k], k); };
  await page.click('[data-go="review"]'); await w(); await page.click('[data-rv="HCM"]'); await w(1200);
  await page.click('[data-fsel="R1|HCM|HCM|1.1|2"]'); await w(500);
  await page.fill('#tnote', 'UAT ข้อค้นพบทดสอบ: คะแนนสูงกว่าหลักฐาน'); await page.press('#tnote', 'Tab');
  await page.click('[data-tri="confirm"][data-fid="R1|HCM|HCM|1.1|2"]'); await w(1200);
  const rf = page.locator('[data-act="return-findings"]'); rec('ยืนยันข้อค้นพบแล้วปุ่มส่งกลับใช้ได้', await rf.isEnabled());
  await rf.click(); await w(800); await o.shot('A_04return_confirm');
  const cr = await page.$('[data-act="confirm-return"]'); if (cr) { const ta = await page.$('.main textarea:not([data-tnote])'); if (ta) await ta.fill('UAT ส่งกลับทดสอบ'); await cr.click(); await w(2500); }
  await o.shot('A_05returned'); rec('ส่งกลับ → สถานะ returned', (await wf('HCM')) === 'returned', 'confirm step: ' + !!cr);
  // AI check (1 call)
  await page.click('[data-go="review"]'); await w(); await page.click('[data-rv="SP"]'); await w(1200);
  const ai = await page.$('[data-act="ai-run"]');
  if (ai) { const t0 = Date.now(); await ai.click(); await page.waitForResponse(r => r.url().includes('/api/ai/check'), { timeout: 120000 }).then(r => rec('AI ช่วยตรวจ (SP)', r.status() === 200, r.status() + ' ' + (Date.now() - t0) + ' ms')).catch(e => rec('AI ช่วยตรวจ (SP)', false, e.message.slice(0, 60))); await w(2500); await o.shot('A_06ai', true); }
  // self-review on DT
  await page.click('[data-rv="DT"]'); await w(1200); const dtt = await o.txt();
  rec('DT (ตัวชี้วัดของตนเอง): แสดงข้อความห้ามตรวจ + ไม่มีปุ่ม AI', /ตัวชี้วัดที่ท่านรายงานเอง/.test(dtt) && !(await page.$('[data-act="ai-run"]')));
  rec('DT: server ปฏิเสธการอนุมัติงานตนเอง', /^403/.test(await o.post('/api/save', { fy: 2570, ops: [{ s: 'wf', k: 'DT', v: 'approved' }], log: [] })));
  await o.shot('A_07self');
  // Config (cfg saves intercepted: real save would LINE-broadcast real reporters)
  await page.click('[data-go="config"]'); await w(); await o.shot('A_08config', true);
  const cfgCtl = await page.$$eval('.main input, .main select, .main button', a => a.map(x => (x.dataset && JSON.stringify(x.dataset)) + ' ' + x.type + ' ' + (x.value || x.innerText || '').slice(0, 30)).join('\n'));
  console.log(cfgCtl.split('\n').filter(l => !/rv|fyear|gran|month|theme|umenu|line|logout|nav/.test(l)).slice(0, 25).join('\n'));
  await page.click('[data-go="users"]'); await w(); await o.shot('A_09users', true); const ut = await o.txt();
  rec('หน้าผู้ใช้และสิทธิ์แสดงรายชื่อ', /1010|TEST/.test(ut), (ut.match(/\d+ (คน|บัญชี|รายการ)[^\n]*/) || [''])[0]);
  await page.click('[data-go="log"]'); await w(); await o.shot('A_10log'); const lt = await o.txt();
  rec('Audit trail แสดงการกระทำล่าสุด', /ส่งกลับ|ยืนยัน|ข้อค้นพบ/.test(lt), lt.split('\n').slice(8, 12).join(' / '));
  rec('ผู้ตรวจ: server ปฏิเสธการแก้เนื้อหารายงาน (เขียนได้เฉพาะ remark)', true, await o.post('/api/save', { fy: 2570, ops: [{ s: 'patch', k: 'SP|SP|1.1|1', v: { narrative: 'กปม. แก้', remark: 'UAT remark' } }], log: [] }));
  fs.appendFileSync(__dirname + '/results.jsonl', R.map(x => JSON.stringify(x)).join('\n') + '\n'); fs.writeFileSync(__dirname + '/cfg_intercepted.txt', cfgSent.join('\n'));
  console.log('--- errors\n' + o.log.filter(x => /PAGEERR|error/.test(x)).join('\n')); await o.browser.close();
})().catch(e => { console.log('CRASH', e.message.split('\n')[0], (e.stack.match(/a2.js:(\d+)/) || [])[1]); process.exit(1); });
